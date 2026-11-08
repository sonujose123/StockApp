const REQUIRED = [
  'STOCK_API_URL',
  'STOCK_API_KEY',
  'RESEND_API_KEY',
  'RESEND_BASE_URL',
  'WEBHOOK_SECRET',
  'ADMIN_PASSWORD',
];

function trimTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function readPort(value, fallback) {
  const port = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return fallback;
  return port;
}

function readPositiveInt(value, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * Express "trust proxy" setting. The default matches the documented deployment
 * (one reverse proxy in front of the app). Set 0/false to stop trusting
 * X-Forwarded-For, which is what makes rate-limit keys client-spoofable.
 */
function readTrustProxy(value) {
  const raw = String(value ?? '').trim();
  if (raw === '') return 1;
  if (/^(false|off|no|0)$/i.test(raw)) return false;
  return /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : raw;
}

function assertHttpUrl(name, value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute http(s) URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${name} must use http or https`);
  }
}

export function loadConfig(env = process.env, { validate = true } = {}) {
  const missing = validate
    ? REQUIRED.filter((key) => !String(env[key] || '').trim())
    : [];
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const stockApiUrl = trimTrailingSlash(env.STOCK_API_URL);
  const resendBaseUrl = trimTrailingSlash(env.RESEND_BASE_URL);
  if (validate) {
    assertHttpUrl('STOCK_API_URL', stockApiUrl);
    assertHttpUrl('RESEND_BASE_URL', resendBaseUrl);
  }

  return {
    port: readPort(env.PORT, 3000),
    trustProxy: readTrustProxy(env.TRUST_PROXY),
    databasePath: String(env.DATABASE_PATH || './data/stockly.db').trim(),
    stockApiUrl,
    stockApiKey: String(env.STOCK_API_KEY || '').trim(),
    resendBaseUrl,
    resendApiKey: String(env.RESEND_API_KEY || '').trim(),
    webhookSecret: String(env.WEBHOOK_SECRET || ''),
    adminPassword: String(env.ADMIN_PASSWORD || ''),
    emailFrom: String(env.EMAIL_FROM || 'Stockly <alerts@stockly.app>').trim(),
    shopUrl: trimTrailingSlash(env.SHOP_URL),
    // Operational knobs, overridable for tests but deliberately not part of the
    // required env surface the challenge specifies.
    stockTimeoutMs: readPositiveInt(env.STOCK_TIMEOUT_MS, 6000),
    mailTimeoutMs: readPositiveInt(env.MAIL_TIMEOUT_MS, 10000),
    workerIntervalMs: readPositiveInt(env.WORKER_INTERVAL_MS, 1000),
    jobLeaseMs: readPositiveInt(env.JOB_LEASE_MS, 45000),
    maxAttempts: readPositiveInt(env.MAX_ATTEMPTS, 6),
    retryBaseMs: readPositiveInt(env.RETRY_BASE_MS, 5000),
    reconcileIntervalMs: readPositiveInt(env.RECONCILE_INTERVAL_MS, 30000),
    logLevel: String(env.LOG_LEVEL || 'info').toLowerCase(),
  };
}
