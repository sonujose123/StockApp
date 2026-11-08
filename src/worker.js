import { isoAfter, nowIso, truncate } from './util.js';
import { renderEmail } from './views/email.js';

const MAX_BACKOFF_MS = 15 * 60 * 1000;

function backoffMs(attempts, baseMs) {
  const exponent = Math.max(0, attempts - 1);
  return Math.min(baseMs * 3 ** exponent, MAX_BACKOFF_MS);
}

/**
 * Durable background processor.
 *
 * Two queues live in SQLite: stock events (verified, not trusted) and the email
 * outbox (one row per request). Both are claimed in transactions and retried
 * with backoff, so a restart loses nothing and a duplicate delivery cannot
 * create a second email.
 */
export function createWorker({ store, stock, mailer, config, logger }) {
  let timer = null;
  let running = false;
  let nextReconcileAt = 0;

  async function processStockEvent(event) {
    let product;
    try {
      product = await stock.getProduct(event.sku, {
        timeout: config.stockTimeoutMs,
        retries: 2,
      });
    } catch (error) {
      const detail = truncate(error.message, 500);
      const retryable = error.retryable !== false;
      if (retryable && event.attempts < config.maxAttempts) {
        const nextAt = isoAfter(backoffMs(event.attempts, config.retryBaseMs));
        store.retryStockEvent(event.event_id, detail, nextAt);
        logger.warn('webhook.stock_check_retry', {
          eventId: event.event_id,
          sku: event.sku,
          attempts: event.attempts,
          nextAttemptAt: nextAt,
        });
      } else {
        store.finishStockEvent(event.event_id, 'failed', detail, nowIso());
        logger.error('webhook.stock_check_failed', {
          eventId: event.event_id,
          sku: event.sku,
          error: detail,
        });
      }
      return;
    }

    if (!product) {
      store.finishStockEvent(event.event_id, 'ignored', 'Stock API does not know this SKU', nowIso());
      logger.info('webhook.unknown_sku', { eventId: event.event_id, sku: event.sku });
      return;
    }

    const available = product.inStock === true && (product.quantity === null || product.quantity > 0);
    if (!available) {
      store.finishStockEvent(
        event.event_id,
        'ignored',
        `Stock API reports ${product.quantity ?? 'no'} available`,
        nowIso(),
      );
      logger.info('webhook.no_stock', {
        eventId: event.event_id,
        sku: event.sku,
        quantity: product.quantity,
        inStock: product.inStock,
      });
      return;
    }

    const queued = store.enqueueForSku(event.sku, nowIso());
    store.finishStockEvent(event.event_id, 'processed', `Queued ${queued} notification(s)`, nowIso());
    logger.info('webhook.processed', {
      eventId: event.event_id,
      sku: event.sku,
      queued,
    });
  }

  async function processJob(job) {
    // Product data only decorates the email; a stock API hiccup must not stop
    // the email from going out.
    let product = null;
    try {
      product = await stock.getProduct(job.sku, {
        timeout: Math.min(config.stockTimeoutMs, 4000),
        retries: 0,
      });
    } catch (error) {
      logger.warn('email.product_lookup_failed', {
        requestId: job.request_id,
        sku: job.sku,
        error: error.message,
      });
    }

    const message = renderEmail({ request: job, product, config });

    try {
      const result = await mailer.send({
        to: job.email,
        subject: message.subject,
        html: message.html,
        text: message.text,
        idempotencyKey: job.idempotency_key,
      });
      store.completeJob({ job, providerId: result.id, now: nowIso() });
      logger.info('email.sent', {
        requestId: job.request_id,
        sku: job.sku,
        attempt: job.attempts,
        providerId: result.id,
      });
    } catch (error) {
      const detail = truncate(error.message, 500);
      const retryable = error.retryable !== false;
      if (retryable && job.attempts < config.maxAttempts) {
        const nextAt = isoAfter(backoffMs(job.attempts, config.retryBaseMs));
        store.retryJob({ job, error: detail, nextAttemptAt: nextAt });
        logger.warn('email.retry_scheduled', {
          requestId: job.request_id,
          attempts: job.attempts,
          nextAttemptAt: nextAt,
          error: detail,
        });
      } else {
        store.failJob({ job, error: detail, now: nowIso() });
        logger.error('email.failed', {
          requestId: job.request_id,
          attempts: job.attempts,
          error: detail,
        });
      }
    }
  }

  /**
   * Safety net for requests that arrive while an item is already in stock, or
   * just after the webhook was processed. It cannot create duplicates: the
   * outbox is unique per request.
   */
  const RECONCILE_BATCH_SIZE = 20;

  async function reconcile() {
    const skus = store.listPendingSkus(RECONCILE_BATCH_SIZE + 1);
    if (skus.length > RECONCILE_BATCH_SIZE) {
      skus.length = RECONCILE_BATCH_SIZE;
      logger.warn('reconcile.batch_limited', { batchSize: RECONCILE_BATCH_SIZE });
    }
    for (const row of skus) {
      try {
        const product = await stock.getProduct(row.sku, {
          timeout: Math.min(config.stockTimeoutMs, 4000),
          retries: 0,
        });
        if (!product || product.inStock !== true) continue;
        if (product.quantity !== null && product.quantity <= 0) continue;
        const queued = store.enqueueForSku(row.sku, nowIso());
        if (queued > 0) {
          logger.info('reconcile.queued', { sku: row.sku, queued });
        }
      } catch (error) {
        logger.warn('reconcile.lookup_failed', { sku: row.sku, error: error.message });
      }
    }
  }

  async function tick() {
    if (running) return { skipped: true };
    running = true;
    let events = 0;
    let jobs = 0;
    try {
      for (let i = 0; i < 10; i += 1) {
        const event = store.claimStockEvent(nowIso(), config.jobLeaseMs);
        if (!event) break;
        events += 1;
        try {
          await processStockEvent(event);
        } catch (error) {
          // The lease reclaims the event; one bad event must not stop the queue.
          logger.error('worker.event_unexpected_failure', {
            eventId: event.event_id,
            error: error.message,
          });
        }
      }
      for (let i = 0; i < 10; i += 1) {
        const job = store.claimJob(nowIso(), config.jobLeaseMs);
        if (!job) break;
        jobs += 1;
        try {
          await processJob(job);
        } catch (error) {
          logger.error('worker.job_unexpected_failure', {
            requestId: job.request_id,
            error: error.message,
          });
        }
      }
      if (Date.now() >= nextReconcileAt) {
        nextReconcileAt = Date.now() + config.reconcileIntervalMs;
        await reconcile();
      }
      return { events, jobs };
    } finally {
      running = false;
    }
  }

  function wake() {
    setImmediate(() => {
      tick().catch((error) => logger.error('worker.tick_failed', { error: error.message }));
    });
  }

  return {
    tick,
    wake,
    start() {
      store.recoverInterrupted();
      timer = setInterval(() => {
        tick().catch((error) => logger.error('worker.tick_failed', { error: error.message }));
      }, config.workerIntervalMs);
      timer.unref?.();
      wake();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
