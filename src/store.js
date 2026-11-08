import { escapeLike, isoAfter, newId } from './util.js';

export function createStore(db) {
  const insertRequest = db.prepare(`
    INSERT INTO requests (id, email, sku, status, created_at)
    VALUES (?, ?, ?, 'pending', ?)
  `);
  const findOpenRequest = db.prepare(`
    SELECT * FROM requests WHERE sku = ? AND email = ? AND status = 'pending'
  `);
  const requestById = db.prepare(`SELECT * FROM requests WHERE id = ?`);

  const insertEvent = db.prepare(`
    INSERT INTO stock_events (event_id, sku, quantity, received_at, next_attempt_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(event_id) DO NOTHING
  `);
  const eventById = db.prepare(`SELECT * FROM stock_events WHERE event_id = ?`);

  const insertJob = db.prepare(`
    INSERT INTO outbox (id, request_id, status, attempts, next_attempt_at, idempotency_key, created_at)
    VALUES (?, ?, 'pending', 0, ?, ?, ?)
    ON CONFLICT(request_id) DO NOTHING
  `);
  const pendingForSku = db.prepare(`
    SELECT id FROM requests WHERE sku = ? AND status = 'pending'
  `);
  const pendingSkus = db.prepare(`
    SELECT sku, MIN(created_at) AS oldest, COUNT(*) AS count
    FROM requests
    WHERE status = 'pending'
    GROUP BY sku
    ORDER BY oldest ASC
    LIMIT ?
  `);
  const jobById = db.prepare(`
    SELECT o.*, r.email, r.sku, r.status AS request_status
    FROM outbox o
    JOIN requests r ON r.id = o.request_id
    WHERE o.id = ?
  `);

  const claimJob = db.transaction((now, leaseMs) => {
    const candidate = db.prepare(`
      SELECT o.id
      FROM outbox o
      JOIN requests r ON r.id = o.request_id
      WHERE r.status = 'pending'
        AND (
          (o.status = 'pending' AND o.next_attempt_at <= ?)
          OR (o.status = 'sending' AND o.lease_until <= ?)
        )
      ORDER BY o.created_at ASC
      LIMIT 1
    `).get(now, now);
    if (!candidate) return null;

    const leaseUntil = isoAfter(leaseMs);
    const result = db.prepare(`
      UPDATE outbox
      SET status = 'sending', attempts = attempts + 1, lease_until = ?
      WHERE id = ?
        AND (
          status = 'pending'
          OR (status = 'sending' AND lease_until <= ?)
        )
    `).run(leaseUntil, candidate.id, now);
    if (result.changes !== 1) return null;
    return jobById.get(candidate.id);
  });

  const completeJob = db.transaction((jobId, requestId, providerId, now) => {
    db.prepare(`
      UPDATE outbox
      SET status = 'sent', sent_at = ?, provider_id = ?, lease_until = NULL, last_error = NULL
      WHERE id = ?
    `).run(now, providerId, jobId);
    db.prepare(`
      UPDATE requests
      SET status = 'notified', notified_at = ?, last_error = NULL
      WHERE id = ? AND status = 'pending'
    `).run(now, requestId);
  });

  const retryJob = db.prepare(`
    UPDATE outbox
    SET status = 'pending', lease_until = NULL, next_attempt_at = ?, last_error = ?
    WHERE id = ?
  `);

  const retryFailedRequestTx = db.transaction((requestId, now) => {
    const request = requestById.get(requestId);
    if (!request || request.status !== 'failed') return { retried: false, reason: 'not_failed' };
    // The partial unique index only allows one *pending* request per SKU + email.
    if (findOpenRequest.get(request.sku, request.email)) {
      return { retried: false, reason: 'open_request_exists' };
    }
    db.prepare(`UPDATE requests SET status = 'pending', last_error = NULL WHERE id = ?`)
      .run(requestId);
    const requeued = db.prepare(`
      UPDATE outbox
      SET status = 'pending', attempts = 0, next_attempt_at = ?, lease_until = NULL,
          last_error = NULL, sent_at = NULL, provider_id = NULL
      WHERE request_id = ?
    `).run(now, requestId);
    if (requeued.changes === 0) {
      insertJob.run(newId(), requestId, now, `bis-${requestId}`, now);
    }
    return { retried: true };
  });

  const failJob = db.transaction((jobId, requestId, error, now) => {
    db.prepare(`
      UPDATE outbox
      SET status = 'failed', lease_until = NULL, last_error = ?
      WHERE id = ?
    `).run(error, jobId);
    db.prepare(`
      UPDATE requests
      SET status = 'failed', last_error = ?
      WHERE id = ? AND status = 'pending'
    `).run(error, requestId);
  });

  return {
    db,

    createRequest({ email, sku, now }) {
      const id = newId();
      try {
        insertRequest.run(id, email, sku, now);
        return { created: true, request: requestById.get(id) };
      } catch (error) {
        if (String(error.code || '').startsWith('SQLITE_CONSTRAINT')) {
          const existing = findOpenRequest.get(sku, email);
          if (existing) return { created: false, request: existing };
        }
        throw error;
      }
    },

    getRequest(id) {
      return requestById.get(id);
    },

    addStockEvent({ eventId, sku, quantity, now }) {
      const result = insertEvent.run(eventId, sku, quantity, now, now);
      return { inserted: result.changes === 1, event: eventById.get(eventId) };
    },

    claimStockEvent(now, leaseMs) {
      return db.transaction(() => {
        const candidate = db.prepare(`
          SELECT event_id FROM stock_events
          WHERE (status = 'received' AND next_attempt_at <= ?)
             OR (status = 'processing' AND lease_until <= ?)
          ORDER BY received_at ASC
          LIMIT 1
        `).get(now, now);
        if (!candidate) return null;

        const result = db.prepare(`
          UPDATE stock_events
          SET status = 'processing', attempts = attempts + 1, lease_until = ?
          WHERE event_id = ?
            AND (
              (status = 'received' AND next_attempt_at <= ?)
              OR (status = 'processing' AND lease_until <= ?)
            )
        `).run(isoAfter(leaseMs), candidate.event_id, now, now);
        if (result.changes !== 1) return null;
        return eventById.get(candidate.event_id);
      })();
    },

    finishStockEvent(eventId, status, note, now) {
      db.prepare(`
        UPDATE stock_events
        SET status = ?, processed_at = ?, last_error = ?, lease_until = NULL
        WHERE event_id = ?
      `).run(status, now, note || null, eventId);
    },

    retryStockEvent(eventId, error, nextAttemptAt) {
      db.prepare(`
        UPDATE stock_events
        SET status = 'received', next_attempt_at = ?, last_error = ?, lease_until = NULL
        WHERE event_id = ?
      `).run(nextAttemptAt, error, eventId);
    },

    enqueueForSku(sku, now) {
      return db.transaction(() => {
        let queued = 0;
        for (const request of pendingForSku.all(sku)) {
          const result = insertJob.run(newId(), request.id, now, `bis-${request.id}`, now);
          queued += result.changes;
        }
        return queued;
      })();
    },

    claimJob(now, leaseMs) {
      return claimJob(now, leaseMs);
    },

    getJob(id) {
      return jobById.get(id);
    },

    retryFailedRequest(id, now) {
      return retryFailedRequestTx(id, now);
    },

    completeJob({ job, providerId, now }) {
      completeJob(job.id, job.request_id, providerId, now);
    },

    retryJob({ job, error, nextAttemptAt }) {
      retryJob.run(nextAttemptAt, error, job.id);
    },

    failJob({ job, error, now }) {
      failJob(job.id, job.request_id, error, now);
    },

    listPendingSkus(limit) {
      return pendingSkus.all(limit);
    },

    recoverInterrupted() {
      // A restart means no send or stock check from this instance is still in
      // flight. Requeue them; the provider idempotency key protects a send that
      // was accepted just before the process died.
      db.transaction(() => {
        db.prepare(`UPDATE stock_events SET status = 'received', lease_until = NULL WHERE status = 'processing'`).run();
        db.prepare(`UPDATE outbox SET status = 'pending', lease_until = NULL WHERE status = 'sending'`).run();
      })();
    },

    listRequests({ status = 'all', q = '', limit = 25, offset = 0 }) {
      const clauses = [];
      const params = [];
      if (['pending', 'notified', 'failed'].includes(status)) {
        clauses.push('status = ?');
        params.push(status);
      }
      if (q) {
        clauses.push(`(email LIKE ? ESCAPE '\\' OR sku LIKE ? ESCAPE '\\')`);
        const like = `%${escapeLike(q)}%`;
        params.push(like, like);
      }
      const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
      const rows = db.prepare(`
        SELECT * FROM requests ${where}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `).all(...params, limit, offset);
      const total = db.prepare(`SELECT COUNT(*) AS count FROM requests ${where}`).get(...params).count;
      return { rows, total };
    },

    stats(sinceIso) {
      const row = db.prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN status = 'notified' THEN 1 ELSE 0 END) AS notified,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
          SUM(CASE WHEN notified_at IS NOT NULL AND notified_at >= ? THEN 1 ELSE 0 END) AS notifiedRecently
        FROM requests
      `).get(sinceIso);
      return {
        total: Number(row.total || 0),
        pending: Number(row.pending || 0),
        notified: Number(row.notified || 0),
        failed: Number(row.failed || 0),
        notifiedRecently: Number(row.notifiedRecently || 0),
      };
    },

    recentEvents(limit = 8) {
      return db.prepare(`
        SELECT * FROM stock_events ORDER BY received_at DESC LIMIT ?
      `).all(limit);
    },

    close() {
      db.close();
    },
  };
}
