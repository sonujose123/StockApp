import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { createStore } from '../src/store.js';
import { createApp } from '../src/app.js';
import { createWorker } from '../src/worker.js';
import { delay } from '../src/util.js';

const WEBHOOK_SECRET = 'whsec_test_value';
const SILENT = { debug() {}, info() {}, warn() {}, error() {} };

const BASE_ENV = {
  STOCK_API_URL: 'http://127.0.0.1:9/api/stock',
  STOCK_API_KEY: 'test-stock-key',
  RESEND_BASE_URL: 'http://127.0.0.1:9/resend',
  RESEND_API_KEY: 'test-resend-key',
  WEBHOOK_SECRET,
  ADMIN_PASSWORD: 'admin-test',
  EMAIL_FROM: 'Stockly <test@stockly.local>',
  LOG_LEVEL: 'error',
  RETRY_BASE_MS: '1',
  STOCK_TIMEOUT_MS: '500',
  MAIL_TIMEOUT_MS: '500',
  WORKER_INTERVAL_MS: '60000',
  RECONCILE_INTERVAL_MS: '60000',
};

function makeStock(handler) {
  return {
    calls: [],
    async getProduct(sku) {
      this.calls.push(sku);
      return handler(sku);
    },
  };
}

function makeMailer() {
  const mailer = {
    sent: [],
    attempts: [],
    failNext: 0,
    permanentFailNext: 0,
    async send(message) {
      mailer.attempts.push(message);
      if (mailer.permanentFailNext > 0) {
        mailer.permanentFailNext -= 1;
        const error = new Error('email rejected');
        error.retryable = false;
        throw error;
      }
      if (mailer.failNext > 0) {
        mailer.failNext -= 1;
        const error = new Error('email provider is down');
        error.retryable = true;
        throw error;
      }
      mailer.sent.push(message);
      return { id: `email_${mailer.sent.length}` };
    },
  };
  return mailer;
}

async function startHarness({ dir, stock, mailer, autoWake = false, overrides = {} } = {}) {
  const directory = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'stockly-test-'));
  const config = loadConfig({
    ...BASE_ENV,
    DATABASE_PATH: path.join(directory, 'stockly.db'),
    ...overrides,
  });
  const db = openDatabase(config.databasePath);
  const store = createStore(db);
  const worker = createWorker({ store, stock, mailer, config, logger: SILENT });
  const app = createApp({
    config,
    store,
    stock,
    worker: autoWake ? worker : { wake() {} },
    logger: SILENT,
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  let closed = false;

  return {
    baseUrl,
    config,
    db,
    store,
    worker,
    mailer,
    stock,
    dir: directory,
    async close({ keepFiles = false } = {}) {
      if (closed) return;
      closed = true;
      worker.stop();
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections?.();
      });
      store.close();
      if (!keepFiles) fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

function postJson(baseUrl, pathname, body) {
  return fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function webhook(baseUrl, body, secret = WEBHOOK_SECRET) {
  return fetch(`${baseUrl}/webhooks/stock`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Secret': secret,
    },
    body: JSON.stringify(body),
  });
}

const IN_STOCK = {
  name: 'Linen Camp Shirt',
  price: 89,
  currency: 'USD',
  imageUrl: 'https://cdn.example.com/linen.jpg',
  url: 'https://shop.example.com/products/linen-camp-shirt',
  inStock: true,
  quantity: 4,
};

test('embed is iframe-safe, designed, and shows the product', async (t) => {
  const stock = makeStock(() => IN_STOCK);
  const h = await startHarness({ stock });
  t.after(() => h.close());

  const res = await fetch(`${h.baseUrl}/embed?sku=LINEN-CAMP-M`);
  const html = await res.text();

  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-frame-options'), null);
  assert.match(res.headers.get('content-security-policy'), /frame-ancestors \*/);
  assert.match(html, /Linen Camp Shirt/);
  assert.match(html, /<form id="bis-form"/);
  assert.match(html, /Notify me/);
  assert.match(html, /One email when it's back/);
});

test('creates one open request, normalises email and rejects bad input', async (t) => {
  const h = await startHarness({ stock: makeStock(() => IN_STOCK) });
  t.after(() => h.close());

  const first = await postJson(h.baseUrl, '/api/requests', {
    email: '  Ada@Example.COM ',
    sku: 'LINEN-CAMP-M',
  });
  assert.equal(first.status, 201);
  assert.equal((await first.json()).duplicate, false);

  const duplicate = await postJson(h.baseUrl, '/api/requests', {
    email: 'ada@example.com',
    sku: 'LINEN-CAMP-M',
  });
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).duplicate, true);

  const invalidEmail = await postJson(h.baseUrl, '/api/requests', {
    email: 'not-an-email',
    sku: 'LINEN-CAMP-M',
  });
  assert.equal(invalidEmail.status, 400);

  const invalidSku = await postJson(h.baseUrl, '/api/requests', {
    email: 'ada@example.com',
    sku: '<script>',
  });
  assert.equal(invalidSku.status, 400);

  const rows = h.db.prepare('SELECT email, sku FROM requests').all();
  assert.deepEqual(rows, [{ email: 'ada@example.com', sku: 'LINEN-CAMP-M' }]);
});

test('concurrent submissions still produce a single open request', async (t) => {
  const h = await startHarness({ stock: makeStock(() => IN_STOCK) });
  t.after(() => h.close());

  const responses = await Promise.all(
    Array.from({ length: 8 }, (_, index) => postJson(h.baseUrl, '/api/requests', {
      email: `racer${index % 2}@example.com`,
      sku: 'RACE-SKU',
    })),
  );
  assert.equal(responses.filter((response) => response.status === 201).length, 2);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM requests').get().n, 2);
});

test('rejects a bad webhook secret without recording the event', async (t) => {
  const h = await startHarness({ stock: makeStock(() => IN_STOCK) });
  t.after(() => h.close());

  const response = await webhook(h.baseUrl, { event_id: 'evt-bad', sku: 'LINEN', quantity: 9 }, 'wrong');
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, 'unauthorized');
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM stock_events').get().n, 0);
});

test('verifies stock, sends exactly one designed email, and ignores replays', async (t) => {
  const mailer = makeMailer();
  const h = await startHarness({ stock: makeStock(() => IN_STOCK), mailer });
  t.after(() => h.close());

  await postJson(h.baseUrl, '/api/requests', { email: 'grace@example.com', sku: 'LINEN-CAMP-M' });
  const accepted = await webhook(h.baseUrl, {
    event_id: 'evt-restock-1',
    sku: 'LINEN-CAMP-M',
    quantity: 4,
    reason: 'manual_restock',
  });
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).duplicate, false);

  await h.worker.tick();

  assert.equal(mailer.sent.length, 1);
  const email = mailer.sent[0];
  assert.equal(email.to, 'grace@example.com');
  assert.match(email.subject, /Linen Camp Shirt is back in stock/);
  assert.match(email.html, /It's back\./);
  assert.match(email.html, /It&#39;s back\.|It's back\./);
  assert.match(email.html, /Shop the restock/);
  assert.match(email.text, /https:\/\/shop\.example\.com\/products\/linen-camp-shirt/);
  assert.equal(email.idempotencyKey, `bis-${h.db.prepare('SELECT id FROM requests').get().id}`);

  const request = h.db.prepare('SELECT * FROM requests').get();
  assert.equal(request.status, 'notified');
  assert.ok(request.notified_at);

  const job = h.db.prepare('SELECT * FROM outbox').get();
  assert.equal(job.status, 'sent');
  assert.equal(job.attempts, 1);

  const replay = await webhook(h.baseUrl, {
    event_id: 'evt-restock-1',
    sku: 'LINEN-CAMP-M',
    quantity: 4,
  });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).duplicate, true);
  await h.worker.tick();
  assert.equal(mailer.sent.length, 1);
});

test('simultaneous duplicate webhooks produce one email', async (t) => {
  const mailer = makeMailer();
  const h = await startHarness({ stock: makeStock(() => IN_STOCK), mailer });
  t.after(() => h.close());

  await postJson(h.baseUrl, '/api/requests', { email: 'dup@example.com', sku: 'BURST-SKU' });
  const responses = await Promise.all(
    Array.from({ length: 6 }, () => webhook(h.baseUrl, {
      event_id: 'evt-burst',
      sku: 'BURST-SKU',
      quantity: 2,
    })),
  );
  assert.ok(responses.every((response) => response.status === 200));
  const bodies = await Promise.all(responses.map((response) => response.json()));
  assert.equal(bodies.filter((body) => body.duplicate === false).length, 1);

  await h.worker.tick();
  assert.equal(mailer.sent.length, 1);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM outbox').get().n, 1);
});

test('trusts the stock API over the webhook quantity', async (t) => {
  const mailer = makeMailer();
  let product = { ...IN_STOCK, inStock: false, quantity: 0 };
  const h = await startHarness({ stock: makeStock(() => product), mailer });
  t.after(() => h.close());

  await postJson(h.baseUrl, '/api/requests', { email: 'soldout@example.com', sku: 'COURT-SHOE' });

  const webhookSaysInStock = await webhook(h.baseUrl, {
    event_id: 'evt-claims-stock',
    sku: 'COURT-SHOE',
    quantity: 99,
  });
  assert.equal(webhookSaysInStock.status, 200);
  await h.worker.tick();

  assert.equal(mailer.sent.length, 0);
  assert.equal(h.db.prepare('SELECT status FROM requests').get().status, 'pending');
  assert.equal(h.db.prepare('SELECT status FROM stock_events').get().status, 'ignored');

  product = { ...IN_STOCK, inStock: true, quantity: 2 };
  await webhook(h.baseUrl, { event_id: 'evt-really-back', sku: 'COURT-SHOE', quantity: 0 });
  await h.worker.tick();

  assert.equal(mailer.sent.length, 1);
  assert.equal(h.db.prepare('SELECT status FROM requests').get().status, 'notified');
});

test('retries a failed stock check without losing the alert', async (t) => {
  const mailer = makeMailer();
  let calls = 0;
  const stock = makeStock(() => {
    calls += 1;
    if (calls <= 2) {
      const error = new Error('stock API unreachable');
      error.retryable = true;
      throw error;
    }
    return IN_STOCK;
  });
  const h = await startHarness({ stock, mailer, overrides: { RETRY_BASE_MS: '20' } });
  t.after(() => h.close());

  await postJson(h.baseUrl, '/api/requests', { email: 'retry@example.com', sku: 'RETRY-SKU' });
  await webhook(h.baseUrl, { event_id: 'evt-retry', sku: 'RETRY-SKU', quantity: 1 });
  await h.worker.tick();

  const firstEvent = h.db.prepare('SELECT * FROM stock_events').get();
  assert.equal(firstEvent.status, 'received');
  assert.equal(firstEvent.attempts, 1);
  assert.equal(mailer.sent.length, 0);

  await delay(30);
  await h.worker.tick();

  assert.equal(mailer.sent.length, 1);
  const event = h.db.prepare('SELECT * FROM stock_events').get();
  assert.equal(event.status, 'processed');
  assert.equal(event.attempts, 2);
});

test('survives a restart with a queued email and reuses its idempotency key', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stockly-restart-'));
  const stock = makeStock(() => IN_STOCK);
  const firstMailer = makeMailer();
  firstMailer.failNext = 1;

  const first = await startHarness({
    dir,
    stock,
    mailer: firstMailer,
    overrides: { RETRY_BASE_MS: '1000' },
  });
  await postJson(first.baseUrl, '/api/requests', { email: 'restart@example.com', sku: 'RESTART-SKU' });
  await webhook(first.baseUrl, { event_id: 'evt-restart', sku: 'RESTART-SKU', quantity: 1 });
  await first.worker.tick();

  const before = first.db.prepare('SELECT * FROM outbox').get();
  assert.equal(before.status, 'pending');
  assert.equal(before.attempts, 1);
  assert.equal(firstMailer.sent.length, 0);
  await delay(5);
  await first.close({ keepFiles: true });

  const secondMailer = makeMailer();
  const second = await startHarness({ dir, stock, mailer: secondMailer });
  // Move the persisted retry deadline into the past to model a restart after
  // the backoff window, without making the test sleep for a second.
  second.db.prepare('UPDATE outbox SET next_attempt_at = ?').run(new Date().toISOString());
  t.after(async () => {
    await second.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await second.worker.tick();

  assert.equal(secondMailer.sent.length, 1);
  const after = second.db.prepare('SELECT * FROM outbox').get();
  assert.equal(after.status, 'sent');
  assert.equal(after.attempts, 2);
  assert.equal(
    firstMailer.attempts[0].idempotencyKey,
    secondMailer.sent[0].idempotencyKey,
  );
  assert.equal(second.db.prepare('SELECT status FROM requests').get().status, 'notified');
});

test('admin is password protected and shows status and notification time', async (t) => {
  const mailer = makeMailer();
  const h = await startHarness({ stock: makeStock(() => IN_STOCK), mailer });
  t.after(() => h.close());

  await postJson(h.baseUrl, '/api/requests', { email: 'adminview@example.com', sku: 'ADMIN-SKU' });
  await webhook(h.baseUrl, { event_id: 'evt-admin', sku: 'ADMIN-SKU', quantity: 1 });
  await h.worker.tick();

  const anonymous = await fetch(`${h.baseUrl}/admin`, { redirect: 'manual' });
  assert.equal(anonymous.status, 302);
  assert.equal(anonymous.headers.get('location'), '/admin/login');

  const loginPage = await fetch(`${h.baseUrl}/admin/login`);
  assert.equal(loginPage.status, 200);
  assert.match(await loginPage.text(), /Admin password/);

  const wrong = await fetch(`${h.baseUrl}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'password=nope',
    redirect: 'manual',
  });
  assert.equal(wrong.status, 401);

  const success = await fetch(`${h.baseUrl}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'password=admin-test',
    redirect: 'manual',
  });
  assert.equal(success.status, 303);
  const setCookie = success.headers.get('set-cookie');
  assert.match(setCookie, /stockly_admin=/);
  assert.match(setCookie, /HttpOnly/);
  const cookie = setCookie.split(';')[0];

  const admin = await fetch(`${h.baseUrl}/admin`, { headers: { Cookie: cookie } });
  const html = await admin.text();
  assert.equal(admin.status, 200);
  assert.equal(admin.headers.get('x-frame-options'), 'DENY');
  assert.equal(admin.headers.get('cache-control'), 'no-store');
  assert.match(html, /adminview@example\.com/);
  assert.match(html, /class="pill notified"/);
  assert.match(html, /<time datetime="/);

  const search = await fetch(`${h.baseUrl}/admin?q=nobody`, { headers: { Cookie: cookie } });
  assert.match(await search.text(), /No requests yet/);

  const basic = await fetch(`${h.baseUrl}/admin`, {
    headers: {
      Authorization: `Basic ${Buffer.from('admin:admin-test').toString('base64')}`,
    },
  });
  assert.equal(basic.status, 200);

  const logout = await fetch(`${h.baseUrl}/admin/logout`, {
    method: 'POST',
    headers: { Cookie: cookie },
    redirect: 'manual',
  });
  assert.equal(logout.status, 303);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
});

test('reconciles a request that arrives while the item is already in stock', async (t) => {
  const mailer = makeMailer();
  const h = await startHarness({ stock: makeStock(() => IN_STOCK), mailer });
  t.after(() => h.close());

  // No webhook at all: the item is already back when the customer asks.
  await postJson(h.baseUrl, '/api/requests', { email: 'already@example.com', sku: 'ALREADY-BACK' });
  await h.worker.tick();
  await h.worker.tick();

  assert.equal(mailer.sent.length, 1);
  assert.equal(h.db.prepare('SELECT status FROM requests').get().status, 'notified');
});

test('escapes a hostile product name in the embed', async (t) => {
  const stock = makeStock(() => ({ ...IN_STOCK, name: '<script>alert(1)</script>' }));
  const h = await startHarness({ stock });
  t.after(() => h.close());

  const html = await (await fetch(`${h.baseUrl}/embed?sku=XSS-SKU`)).text();

  assert.equal(html.includes('<script>alert(1)</script>'), false);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /data-product="&lt;script&gt;/);
});

test('rejects a form-encoded alert submission', async (t) => {
  const h = await startHarness({ stock: makeStock(() => IN_STOCK) });
  t.after(() => h.close());

  const response = await fetch(`${h.baseUrl}/api/requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'email=form@example.com&sku=FORM-SKU',
  });

  assert.equal(response.status, 415);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM requests').get().n, 0);
});

test('ignores a webhook for a SKU the stock API does not know', async (t) => {
  const mailer = makeMailer();
  const h = await startHarness({ stock: makeStock(() => null), mailer });
  t.after(() => h.close());

  await postJson(h.baseUrl, '/api/requests', { email: 'ghost@example.com', sku: 'GHOST-SKU' });
  await webhook(h.baseUrl, { event_id: 'evt-ghost', sku: 'GHOST-SKU', quantity: 1 });
  await h.worker.tick();

  assert.equal(mailer.sent.length, 0);
  const event = h.db.prepare('SELECT status, last_error FROM stock_events').get();
  assert.equal(event.status, 'ignored');
  assert.match(event.last_error, /does not know this SKU/);
  assert.equal(h.db.prepare('SELECT status FROM requests').get().status, 'pending');
});

test('reclaims a stock event stranded mid-processing', async (t) => {
  const mailer = makeMailer();
  const h = await startHarness({ stock: makeStock(() => IN_STOCK), mailer });
  t.after(() => h.close());

  await postJson(h.baseUrl, '/api/requests', { email: 'stranded@example.com', sku: 'STRANDED-SKU' });
  await webhook(h.baseUrl, { event_id: 'evt-stranded', sku: 'STRANDED-SKU', quantity: 1 });
  // Model a tick that claimed the event and died before finishing it.
  h.db.prepare("UPDATE stock_events SET status = 'processing', attempts = 1, lease_until = ?")
    .run(new Date(Date.now() - 1000).toISOString());

  await h.worker.tick();

  assert.equal(mailer.sent.length, 1);
  const event = h.db.prepare('SELECT status, attempts FROM stock_events').get();
  assert.equal(event.status, 'processed');
  assert.equal(event.attempts, 2);
});

test('throttles repeated admin login failures', async (t) => {
  const h = await startHarness({ stock: makeStock(() => IN_STOCK) });
  t.after(() => h.close());

  const statuses = [];
  for (let attempt = 0; attempt < 11; attempt += 1) {
    const response = await fetch(`${h.baseUrl}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'password=wrong',
      redirect: 'manual',
    });
    statuses.push(response.status);
  }

  assert.deepEqual(statuses.slice(0, 10), Array(10).fill(401));
  assert.equal(statuses[10], 429);
});

test('returns JSON for unknown API routes and a page elsewhere', async (t) => {
  const h = await startHarness({ stock: makeStock(() => IN_STOCK) });
  t.after(() => h.close());

  const api = await fetch(`${h.baseUrl}/api/nope`);
  assert.equal(api.status, 404);
  assert.equal((await api.json()).error, 'not_found');

  const page = await fetch(`${h.baseUrl}/missing-page`);
  const html = await page.text();
  assert.equal(page.status, 404);
  assert.match(html, /That page went missing/);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
});

test('lets an admin requeue a permanently failed request', async (t) => {
  const mailer = makeMailer();
  const h = await startHarness({ stock: makeStock(() => IN_STOCK), mailer });
  t.after(() => h.close());

  await postJson(h.baseUrl, '/api/requests', { email: 'retry-admin@example.com', sku: 'RETRY-ADMIN' });
  mailer.permanentFailNext = 1;
  await webhook(h.baseUrl, { event_id: 'evt-retry-admin', sku: 'RETRY-ADMIN', quantity: 1 });
  await h.worker.tick();

  const failed = h.db.prepare('SELECT * FROM requests').get();
  assert.equal(failed.status, 'failed');

  const retry = await fetch(`${h.baseUrl}/admin/requests/${failed.id}/retry`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from('admin:admin-test').toString('base64')}` },
    redirect: 'manual',
  });
  assert.equal(retry.status, 303);
  assert.match(retry.headers.get('location'), /retried=1/);

  await h.worker.tick();

  assert.equal(mailer.sent.length, 1);
  assert.equal(h.db.prepare('SELECT status FROM requests').get().status, 'notified');
});
