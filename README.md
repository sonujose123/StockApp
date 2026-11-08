# Stockly — back-in-stock alerts

A small, production-shaped service for “email me when it’s back in stock”:

- an **embeddable widget** (`GET /embed`) that works inside someone else’s store,
- a **JSON API** for alert requests (`POST /api/requests`),
- a **verified stock webhook** consumer (`POST /webhooks/stock`),
- a **password-protected admin** view (`GET /admin`) with statuses and notification times,
- a **mobile-friendly HTML email** sent through a Resend-compatible endpoint.

Built for the Back-in-Stock challenge. Node 24 / Express / SQLite. One Docker container, no external database or queue.

---

## Run it with Docker

```bash
docker build -t stockly .
docker run --rm -p 3000:3000 \
  -e PORT=3000 \
  -e STOCK_API_URL=https://harness-production-e601.up.railway.app/api/stock \
  -e STOCK_API_KEY=... \
  -e RESEND_API_KEY=... \
  -e RESEND_BASE_URL=https://... \
  -e WEBHOOK_SECRET=... \
  -e ADMIN_PASSWORD=choose-one \
  stockly
```

Only the challenge’s environment variables are required. The app listens on `0.0.0.0:$PORT` (default `3000`) and creates `/data/stockly.db` on boot.

To keep data if you replace the container, mount a volume:

```bash
-v stockly-data:/data
```

The database survives a process restart either way.

### Health check

```bash
curl localhost:3000/healthz
# {"ok":true}
```

---

## Local development

```bash
npm install
cp .env.example .env      # fill in the harness values
npm run dev
```

Expose the port to the test server while developing:

```bash
cloudflared tunnel --url http://localhost:3000
```

Then put the generated `https://…/webhooks/stock` URL and your `WEBHOOK_SECRET` into the harness dashboard. Any tunnel works; the app does not need a public deployment.

---

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `PORT` | no | HTTP port. Default `3000`. |
| `DATABASE_PATH` | no | SQLite file. Default `./data/stockly.db`; `/data/stockly.db` in Docker. |
| `STOCK_API_URL` | yes | Base URL. `GET {url}/{sku}` is treated as the source of truth. |
| `STOCK_API_KEY` | yes | Sent as `Authorization: Bearer …`. |
| `RESEND_API_KEY` | yes | Bearer token for the email endpoint. |
| `RESEND_BASE_URL` | yes | Base URL; the app posts to `{base}/emails`. |
| `WEBHOOK_SECRET` | yes | Required value of `X-Webhook-Secret`. |
| `ADMIN_PASSWORD` | yes | Protects `/admin`; also signs the admin session cookie. |
| `EMAIL_FROM` | no | Sender. Default `Stockly <alerts@stockly.app>`. |
| `SHOP_URL` | no | Fallback CTA destination if the stock API returns no product URL. |
| `TRUST_PROXY` | no | Express `trust proxy` setting. Default `1` (one proxy hop). `0` stops trusting `X-Forwarded-For`. |

Operational knobs (`STOCK_TIMEOUT_MS`, `MAIL_TIMEOUT_MS`, `MAX_ATTEMPTS`, `RETRY_BASE_MS`, `WORKER_INTERVAL_MS`, `RECONCILE_INTERVAL_MS`, `JOB_LEASE_MS`, `LOG_LEVEL`) have sensible defaults and are not needed to run.

No secrets are committed. `.env` is git-ignored.

---

## HTTP surface

| Route | Behaviour |
| --- | --- |
| `GET /embed?sku=…` | Responsive form. No `X-Frame-Options`, and CSP allows framing. Shows the product, price and stock state when the stock API knows the SKU. |
| `POST /api/requests` | `{ email, sku }` JSON. Returns `201` for a new request, `200` with `duplicate: true` for an existing open one, `400` for invalid input. |
| `POST /webhooks/stock` | Requires `X-Webhook-Secret`. Deduplicates on `event_id`, stores the event, returns `200` immediately and verifies stock asynchronously. |
| `GET /admin` | Login-protected list: customer, SKU, requested time, status, notification time. Failed sends have a Retry action. Also shows the latest stock webhooks. |
| `POST /admin/requests/:id/retry` | Login-protected. Requeues a permanently failed send and resets its outbox row. |
| `GET /healthz` | Liveness plus a database read. |

`/admin` accepts the signed login cookie, and also HTTP Basic (`Authorization: Basic base64(anything:ADMIN_PASSWORD)`) for scripts.

---

## How duplicate and missed emails are prevented

This is the part the challenge is really about. There are five independent guards.

### 1. The webhook is never trusted

- `X-Webhook-Secret` is compared in constant time; a bad or missing header is `401` and nothing is stored.
- The payload only tells us **which SKU** to check. The app re-fetches the product from `STOCK_API_URL/{sku}` and sends only when that response says `in_stock` **and** the quantity is positive. A webhook claiming `quantity: 99` for something the API says is sold out produces no email.
- SKUs are validated and URL-encoded. The app never fetches a URL supplied by the payload, so a crafted SKU cannot become SSRF.

### 2. Webhook replays are collapsed at the database

`stock_events.event_id` is a primary key. The insert uses `ON CONFLICT DO NOTHING`, so two simultaneous deliveries of the same event produce exactly one row; both requests still return `200`, which is what a retrying sender expects. Processing then happens from that durable row, not from the HTTP request.

### 3. Open requests are unique

A partial unique index enforces one *open* request per `(sku, email)`:

```sql
CREATE UNIQUE INDEX idx_requests_open ON requests (sku, email) WHERE status = 'pending';
```

Concurrent submissions race into SQLite; one insert wins, the others return the existing request with `duplicate: true`. Emails are normalised (trim + lowercase), so `Ada@Example.com` and `ada@example.com` are the same person. Once a request is `notified`, a later restock may legitimately create a new request.

### 4. The outbox makes sending idempotent

Each request gets one `outbox` row, with a `UNIQUE` constraint on `request_id`. A worker claims a row atomically (`pending → sending`, with a lease), sends, then commits `sending → sent` and `request → notified` in one transaction.

- The `Idempotency-Key` is deterministic: `bis-{request_id}`. If the process dies after Resend accepted the message but before SQLite recorded it, the retry reuses the same key, so the provider can suppress the duplicate.
- On startup, any interrupted `processing` stock events and `sending` jobs are requeued. Because this is a single-instance deployment, no send from the previous process is still in flight.
- The outbox row is created only after a successful stock check, and a unique index means even a bug that enqueues twice cannot send twice.

### 5. Missed alerts are retried, not dropped

- Stock API timeouts and 5xx responses retry with exponential backoff (5s, 15s, 45s, 135s, …) up to 6 attempts. 4xx payload/auth problems fail permanently instead of looping.
- Email 5xx / 429 / network failures retry; 4xx fails and is surfaced as `failed` on the admin page, where it can be requeued in one click once the cause is fixed.
- Both queues are leased (`JOB_LEASE_MS`): work claimed by a tick that died is reclaimed by a later tick instead of waiting for a restart.
- A reconciliation pass every 30 seconds checks pending requests against current stock — 20 SKUs per pass, and `reconcile.batch_limited` is logged when that cap is reached. It closes the race where a request arrives just after a webhook, or while an item is already back in stock, without creating duplicates.
- SQLite runs in WAL mode with `synchronous = FULL`; all state transitions are transactions.

### The residual trade-off

Delivery is effectively exactly-once while the provider honours idempotency keys. If a provider ignored them **and** the process were killed in the few milliseconds between an accepted send and the commit, one duplicate would be possible. The alternative (marking sent before calling the provider) would risk zero emails in the same window, which is worse for customers. Retries and crash recovery favour the customer hearing from us.

---

## Tests

```bash
npm test
```

The suite also runs in CI (`.github/workflows/test.yml`) on Node 24.

21 tests, using fake stock and email services and a throwaway SQLite database. They cover:

- the embed response being frameable and showing product context,
- email normalisation and rejection of invalid input,
- concurrent submissions producing one open request,
- a bad webhook secret storing nothing,
- stock verification, exactly one email, and replay handling,
- six simultaneous duplicate webhooks producing one email,
- the stock API overriding a lying webhook quantity,
- stock API failure retry and eventual delivery,
- restart recovery with a queued email, reusing the same idempotency key,
- admin redirect/login/session/search/Basic auth and notification times,
- the stock client’s payload normalisation and Bearer auth,
- the Resend payload (`from`, `to[]`, `subject`, `html`, `text`, `Idempotency-Key`) and retry classification,
- reconciliation delivering an alert when the item is already back in stock,
- product names being escaped in the widget,
- JSON-only submissions, login throttling, JSON vs HTML 404s and unknown-SKU webhooks being ignored,
- lease recovery for a stock event stranded mid-processing,
- an admin requeueing a permanently failed send.

Docker was also smoke-tested with only the environment variables above: boot, `/healthz`, `/embed`, `/admin` auth, webhook rejection and SQLite creation under `/data`.

---

## Design notes

- **SQLite rather than Postgres** keeps the Docker contract honest: one container, no external services, durable state. WAL handles the write rates of this workload comfortably. Multiple replicas would need a shared database and a real queue; that is deliberately out of scope.
- **Server-rendered pages, no build step.** The widget, admin and login pages are plain HTML/CSS with one small inline script for the form. This keeps the image small and the surfaces fast inside an iframe.
- **Email is table-based** with inline styles and a single mobile media query, because email clients are not browsers.
- **No analytics, no customer accounts, no tracking pixels.** The service stores only email, SKU, status and timestamps.
- **No unsubscribe route** is included because the challenge’s email is a one-time transactional alert; the footer explains why it was sent. Adding a signed unsubscribe link would be the next production step.

---

## Project layout

```
src/
  server.js           bootstrap, graceful shutdown
  app.js              routes, auth, headers, validation
  worker.js           durable stock-event + email outbox worker
  store.js            all SQL and atomic state transitions
  db.js               WAL setup and migrations
  security.js         constant-time checks, signed sessions, rate limits
  clients/
    stock.js          inventory API client + payload normalisation
    mailer.js         Resend-compatible client
  views/
    embed.js          iframe-safe widget
    admin.js          login + request dashboard
    email.js          HTML/text email
Dockerfile
test/
```

---

## AI tools and time

Built with **Freebuff’s coding agent (Buffy)** in a single session: architecture, implementation, tests, Docker verification and visual QA. Time from empty workspace to verified container: **about one hour**, including the fake-harness testing and design passes.

The full request → stock check → email flow was verified locally against a simulated store and a Resend-compatible capture endpoint. The Docker image was built and smoke-tested with only the six required environment variables. The app was then run against the live challenge harness: it loaded the live catalogue, accepted a request, processed a signed webhook received through an HTTPS tunnel, re-checked availability, and the harness email endpoint returned a provider ID for the message. The harness’s own webhook simulator still needs its dashboard pointed at `/webhooks/stock` for continuous traffic. No production credentials or real customer data were used.
