import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const MIGRATIONS = [
  `
  CREATE TABLE requests (
    id          TEXT PRIMARY KEY,
    email       TEXT NOT NULL,
    sku         TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'notified', 'failed')),
    created_at  TEXT NOT NULL,
    notified_at TEXT,
    last_error  TEXT
  );

  -- One *open* request per customer + product. Notified requests may be
  -- submitted again for a future restock, which is why this is partial.
  CREATE UNIQUE INDEX idx_requests_open
    ON requests (sku, email) WHERE status = 'pending';
  CREATE INDEX idx_requests_created ON requests (created_at DESC);
  CREATE INDEX idx_requests_sku_status ON requests (sku, status);

  CREATE TABLE stock_events (
    event_id        TEXT PRIMARY KEY,
    sku             TEXT NOT NULL,
    quantity        INTEGER,
    status          TEXT NOT NULL DEFAULT 'received'
                    CHECK (status IN ('received', 'processing', 'processed', 'ignored', 'failed')),
    received_at     TEXT NOT NULL,
    processed_at    TEXT,
    attempts        INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL,
    last_error      TEXT
  );
  CREATE INDEX idx_events_due ON stock_events (status, next_attempt_at);

  CREATE TABLE outbox (
    id              TEXT PRIMARY KEY,
    request_id      TEXT NOT NULL UNIQUE REFERENCES requests(id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
    attempts        INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL,
    lease_until     TEXT,
    idempotency_key TEXT NOT NULL,
    provider_id     TEXT,
    last_error      TEXT,
    created_at      TEXT NOT NULL,
    sent_at         TEXT
  );
  CREATE INDEX idx_outbox_due ON outbox (status, next_attempt_at);
  `,
  `
  -- Stock events carry a lease as well: an event claimed by a tick that died is
  -- reclaimed after JOB_LEASE_MS instead of waiting for a restart.
  ALTER TABLE stock_events ADD COLUMN lease_until TEXT;
  CREATE INDEX idx_events_lease ON stock_events (status, lease_until);
  `,
];

export function openDatabase(databasePath) {
  if (databasePath !== ':memory:') {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  }
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

function migrate(db) {
  const current = Number(db.pragma('user_version', { simple: true }));
  for (let version = current; version < MIGRATIONS.length; version += 1) {
    db.transaction(() => {
      db.exec(MIGRATIONS[version]);
      db.pragma(`user_version = ${version + 1}`);
    })();
  }
}
