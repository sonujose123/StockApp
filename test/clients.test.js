import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createStockClient } from '../src/clients/stock.js';
import { createMailer } from '../src/clients/mailer.js';

async function startServer(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      handler(req, res, body);
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections?.();
    }),
  };
}

test('stock client sends auth, follows the SKU route and normalises fields', async (t) => {
  const server = await startServer((req, res) => {
    if (req.url === '/api/stock/SKU-1') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        product: {
          name: 'Trail Runner',
          price: { amount: 129.99, currency: 'USD' },
          image_url: 'https://cdn.example.com/runner.jpg',
          url: 'https://shop.example.com/p/runner',
        },
        quantity: 4,
        in_stock: true,
      }));
      return;
    }
    if (req.url === '/api/stock/MISSING') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{}');
      return;
    }
    res.writeHead(500);
    res.end('boom');
  });
  t.after(() => server.close());

  const client = createStockClient({
    baseUrl: `${server.url}/api/stock`,
    apiKey: 'stock-key',
    timeoutMs: 1000,
  });

  const product = await client.getProduct('SKU-1', { retries: 0 });
  assert.equal(product.sku, 'SKU-1');
  assert.equal(product.name, 'Trail Runner');
  assert.equal(product.price, 129.99);
  assert.equal(product.currency, 'USD');
  assert.equal(product.quantity, 4);
  assert.equal(product.inStock, true);
  assert.match(product.imageUrl, /runner\.jpg/);
  assert.equal(server.requests[0].headers.authorization, 'Bearer stock-key');

  assert.equal(await client.getProduct('MISSING', { retries: 0 }), null);

  await assert.rejects(
    () => client.getProduct('FAIL', { retries: 0 }),
    (error) => error.retryable === true,
  );
});

test('mailer posts the Resend payload with an idempotency key', async (t) => {
  const server = await startServer((req, res) => {
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'em_123' }));
  });
  t.after(() => server.close());

  const mailer = createMailer({
    baseUrl: `${server.url}/resend`,
    apiKey: 're_test_key',
    from: 'Stockly <alerts@stockly.test>',
    timeoutMs: 1000,
  });

  const result = await mailer.send({
    to: 'customer@example.com',
    subject: 'It is back',
    html: '<p>Back</p>',
    text: 'Back',
    idempotencyKey: 'bis-abc',
  });

  assert.equal(result.id, 'em_123');
  assert.equal(server.requests[0].url, '/resend/emails');
  assert.equal(server.requests[0].headers.authorization, 'Bearer re_test_key');
  assert.equal(server.requests[0].headers['idempotency-key'], 'bis-abc');

  const payload = JSON.parse(server.requests[0].body);
  assert.equal(payload.from, 'Stockly <alerts@stockly.test>');
  assert.deepEqual(payload.to, ['customer@example.com']);
  assert.equal(payload.subject, 'It is back');
  assert.equal(payload.html, '<p>Back</p>');
  assert.equal(payload.text, 'Back');
});

test('mailer separates retryable from permanent failures', async (t) => {
  const server = await startServer((req, res) => {
    res.writeHead(req.url.startsWith('/retry') ? 503 : 422, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'nope' }));
  });
  t.after(() => server.close());

  const retryable = createMailer({
    baseUrl: `${server.url}/retry`,
    apiKey: 'key',
    from: 'a@b.co',
    timeoutMs: 1000,
  });
  await assert.rejects(
    () => retryable.send({ to: 'a@b.co', subject: 's', html: 'h', idempotencyKey: 'k' }),
    (error) => error.retryable === true && error.status === 503,
  );

  const permanent = createMailer({
    baseUrl: `${server.url}/permanent`,
    apiKey: 'key',
    from: 'a@b.co',
    timeoutMs: 1000,
  });
  await assert.rejects(
    () => permanent.send({ to: 'a@b.co', subject: 's', html: 'h', idempotencyKey: 'k' }),
    (error) => error.retryable === false && error.status === 422,
  );
});
