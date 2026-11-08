import crypto from 'node:crypto';
import express from 'express';
import {
  SESSION_COOKIE,
  clearedSessionCookie,
  createRateLimiter,
  createSession,
  parseCookies,
  sessionCookie,
  timingSafeEqualString,
  verifySession,
} from './security.js';
import {
  delay,
  escapeHtml,
  isValidEmail,
  normalizeEmail,
  normalizeSku,
  nowIso,
} from './util.js';
import { renderAdmin, renderLogin } from './views/admin.js';
import { renderEmbed } from './views/embed.js';
import { messagePage } from './views/layout.js';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const PAGE_SIZE = 25;

const ADMIN_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
const MESSAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; frame-ancestors 'none'; base-uri 'none'";

function singleQueryValue(value) {
  return typeof value === 'string' ? value : '';
}

export function createApp({ config, store, stock, worker, logger }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  const publicLimiter = createRateLimiter({ windowMs: 60_000, max: 600 });
  const loginLimiter = createRateLimiter({ windowMs: 10 * 60_000, max: 10 });

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  app.use(express.json({ limit: '32kb' }));
  app.use(express.urlencoded({ extended: false, limit: '16kb' }));

  function sendHtml(res, html, { status = 200, csp = MESSAGE_CSP, frame = null } = {}) {
    res.status(status);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', csp);
    if (frame) res.setHeader('X-Frame-Options', frame);
    res.send(html);
  }

  function requestIsSecure(req) {
    return req.secure || req.get('x-forwarded-proto') === 'https';
  }

  function basicAuthPassword(req) {
    const header = req.get('authorization') || '';
    if (!header.startsWith('Basic ')) return null;
    try {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
      const separator = decoded.indexOf(':');
      return separator >= 0 ? decoded.slice(separator + 1) : '';
    } catch {
      return null;
    }
  }

  function isAdmin(req) {
    const basicPassword = basicAuthPassword(req);
    if (basicPassword !== null && timingSafeEqualString(basicPassword, config.adminPassword)) {
      return true;
    }
    const cookies = parseCookies(req.headers.cookie || '');
    return verifySession(cookies[SESSION_COOKIE], config.adminPassword);
  }

  app.get('/healthz', (req, res) => {
    try {
      store.db.prepare('SELECT 1').get();
      res.setHeader('Cache-Control', 'no-store');
      res.json({ ok: true });
    } catch (error) {
      logger.error('health.database_failed', { error: error.message });
      res.status(503).json({ ok: false });
    }
  });

  app.get('/', (req, res) => res.redirect(302, '/embed'));
  app.get('/favicon.ico', (req, res) => res.status(204).end());

  app.get('/embed', async (req, res, next) => {
    try {
      const sku = normalizeSku(singleQueryValue(req.query.sku));
      let product = null;
      if (sku) {
        try {
          product = await stock.getProduct(sku, {
            timeout: Math.min(config.stockTimeoutMs, 2500),
            retries: 0,
          });
        } catch (error) {
          logger.warn('embed.product_lookup_failed', { sku, error: error.message });
        }
      }
      const nonce = crypto.randomBytes(16).toString('base64');
      const csp = `default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; font-src data:; frame-ancestors *; base-uri 'none'; form-action 'self'`;
      sendHtml(res, renderEmbed({ sku, product, nonce }), { csp });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/requests', (req, res) => {
    // JSON only. A cross-site HTML form can only send urlencoded, multipart or
    // text/plain bodies, so rejecting them closes the CSRF path without a token.
    if (!req.is('application/json')) {
      return res.status(415).json({
        error: 'unsupported_media_type',
        message: 'Send JSON with Content-Type: application/json.',
      });
    }

    const limit = publicLimiter(req.ip || 'unknown');
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSeconds));
      return res.status(429).json({
        error: 'rate_limited',
        message: 'Too many requests. Please try again in a minute.',
      });
    }

    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'invalid_body', message: 'Send email and sku as JSON.' });
    }

    const email = normalizeEmail(body.email);
    const sku = normalizeSku(body.sku);

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'invalid_email', message: 'Enter a valid email address.' });
    }
    if (!sku) {
      return res.status(400).json({ error: 'invalid_sku', message: 'That product code doesn\u2019t look right.' });
    }

    const { created, request } = store.createRequest({ email, sku, now: nowIso() });
    logger.info(created ? 'request.created' : 'request.duplicate', {
      requestId: request.id,
      sku,
    });

    if (created) worker.wake();

    return res.status(created ? 201 : 200).json({
      ok: true,
      status: request.status,
      duplicate: !created,
    });
  });

  app.post(
    '/webhooks/stock',
    express.json({
      type: ['application/json', 'application/*+json', 'text/plain'],
      limit: '64kb',
    }),
    (req, res) => {
      const providedSecret = req.get('x-webhook-secret') || '';
      if (
        config.webhookSecret.length === 0
        || !timingSafeEqualString(providedSecret, config.webhookSecret)
      ) {
        logger.warn('webhook.rejected', { ip: req.ip });
        return res.status(401).json({ error: 'unauthorized' });
      }

      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return res.status(400).json({ error: 'invalid_body' });
      }

      const eventId = typeof body.event_id === 'string' ? body.event_id.trim() : '';
      if (eventId.length === 0 || eventId.length > 200) {
        return res.status(400).json({ error: 'invalid_event_id' });
      }

      const sku = normalizeSku(body.sku);
      if (!sku) {
        return res.status(400).json({ error: 'invalid_sku' });
      }

      let quantity = null;
      if (body.quantity !== undefined && body.quantity !== null) {
        const parsed = Number(body.quantity);
        if (!Number.isFinite(parsed)) {
          return res.status(400).json({ error: 'invalid_quantity' });
        }
        quantity = Math.trunc(parsed);
      }

      const { inserted } = store.addStockEvent({
        eventId,
        sku,
        quantity,
        now: nowIso(),
      });

      if (inserted) {
        logger.info('webhook.received', { eventId, sku, quantity });
        worker.wake();
      } else {
        logger.info('webhook.duplicate', { eventId, sku });
      }

      return res.status(200).json({ ok: true, duplicate: !inserted });
    },
  );

  app.get('/admin/login', (req, res) => {
    if (isAdmin(req)) return res.redirect(302, '/admin');
    return sendHtml(res, renderLogin(), { csp: ADMIN_CSP, frame: 'DENY' });
  });

  app.post('/admin/login', async (req, res) => {
    const limit = loginLimiter(req.ip || 'unknown');
    if (!limit.allowed) {
      return sendHtml(
        res,
        renderLogin({ error: `Too many attempts. Try again in ${limit.retryAfterSeconds} seconds.` }),
        { status: 429, csp: ADMIN_CSP, frame: 'DENY' },
      );
    }

    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!timingSafeEqualString(password, config.adminPassword)) {
      logger.warn('admin.login_failed', { ip: req.ip });
      await delay(200);
      return sendHtml(res, renderLogin({ error: 'That password doesn\u2019t match. Try again.' }), {
        status: 401,
        csp: ADMIN_CSP,
        frame: 'DENY',
      });
    }

    const { token, expiresAt } = createSession(config.adminPassword, SESSION_TTL_MS);
    res.setHeader('Set-Cookie', sessionCookie(token, {
      maxAgeSeconds: Math.ceil((expiresAt - Date.now()) / 1000),
      secure: requestIsSecure(req),
    }));
    res.setHeader('Cache-Control', 'no-store');
    logger.info('admin.login_succeeded', { ip: req.ip });
    return res.redirect(303, '/admin');
  });

  app.post('/admin/logout', (req, res) => {
    res.setHeader('Set-Cookie', clearedSessionCookie({ secure: requestIsSecure(req) }));
    res.setHeader('Cache-Control', 'no-store');
    return res.redirect(303, '/admin/login');
  });

  app.post('/admin/requests/:id/retry', (req, res) => {
    if (!isAdmin(req)) return res.redirect(302, '/admin/login');
    const result = store.retryFailedRequest(req.params.id, nowIso());
    if (result.retried) {
      logger.info('request.requeued', { requestId: req.params.id });
      worker.wake();
      return res.redirect(303, '/admin?retried=1');
    }
    const reason = result.reason === 'open_request_exists' ? 'conflict' : 'invalid';
    return res.redirect(303, `/admin?retry=${reason}`);
  });

  app.get('/admin', (req, res, next) => {
    try {
      if (!isAdmin(req)) return res.redirect(302, '/admin/login');

      const requestedStatus = singleQueryValue(req.query.status);
      const status = ['pending', 'notified', 'failed'].includes(requestedStatus)
        ? requestedStatus
        : 'all';
      const q = singleQueryValue(req.query.q).trim().slice(0, 100);
      const requestedPage = Math.max(1, Number.parseInt(singleQueryValue(req.query.page), 10) || 1);

      let result = store.listRequests({
        status,
        q,
        limit: PAGE_SIZE,
        offset: (requestedPage - 1) * PAGE_SIZE,
      });
      let pageCount = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
      let page = requestedPage;
      if (page > pageCount) {
        page = pageCount;
        result = store.listRequests({ status, q, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
        pageCount = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
      }

      const stats = store.stats(new Date(Date.now() - 86_400_000).toISOString());
      const events = store.recentEvents(8);
      const notice = req.query.retried === '1'
        ? 'Request queued again. The worker will retry the email within a few seconds.'
        : req.query.retry === 'conflict'
          ? 'Another open alert already exists for that email and SKU.'
          : req.query.retry === 'invalid'
            ? 'That request is no longer retryable.'
            : '';

      return sendHtml(res, renderAdmin({
        rows: result.rows,
        total: result.total,
        page,
        pageCount,
        stats,
        events,
        filters: { status, q },
        notice,
      }), { csp: ADMIN_CSP, frame: 'DENY' });
    } catch (error) {
      return next(error);
    }
  });

  app.use((req, res) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/webhooks/')) {
      return res.status(404).json({ error: 'not_found' });
    }
    return sendHtml(res, messagePage({
      title: 'Not found',
      heading: 'That page went missing.',
      message: 'The link may be out of date, but the back-in-stock widget is still here.',
      actionHref: '/embed',
      actionLabel: 'Open the widget',
    }), { status: 404 });
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);

    const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 500
      ? error.status
      : 500;
    if (status >= 500) {
      logger.error('http.request_failed', {
        method: req.method,
        path: req.path,
        error: error.message,
      });
    }

    if (req.path.startsWith('/api/') || req.path.startsWith('/webhooks/')) {
      const code = error.type === 'entity.parse.failed'
        ? 'invalid_json'
        : status >= 500
          ? 'internal_error'
          : 'bad_request';
      return res.status(status).json({ error: code });
    }

    return sendHtml(res, messagePage({
      title: status >= 500 ? 'Server error' : 'Bad request',
      heading: status >= 500 ? 'Something broke on our side.' : 'That request didn\u2019t work.',
      message: status >= 500
        ? 'The team has been notified. Please try again in a moment.'
        : 'Please go back and try again.',
      actionHref: '/embed',
      actionLabel: 'Back to the widget',
    }), { status });
  });

  return app;
}
