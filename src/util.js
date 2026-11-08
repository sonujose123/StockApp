import crypto from 'node:crypto';

export const nowIso = () => new Date().toISOString();

export function isoAfter(ms, from = Date.now()) {
  return new Date(from + ms).toISOString();
}

export function newId() {
  return crypto.randomUUID();
}

export function truncate(value, max) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function isValidEmail(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 254) return false;
  const [local, domain, ...rest] = value.split('@');
  if (rest.length > 0 || !local || !domain || local.length > 64) return false;
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)) return false;
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(domain);
}

export function normalizeSku(value) {
  const sku = String(value ?? '').trim();
  if (sku.length === 0 || sku.length > 120) return null;
  // SKUs are opaque identifiers, never URLs or paths we build by hand.
  return /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(sku) ? sku : null;
}

export function safeHttpUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function formatMoney(value, currency) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number' || /^\d+(?:\.\d+)?$/.test(String(value))) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return '';
    const code = typeof currency === 'string' && /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : 'USD';
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: code,
        maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
      }).format(amount);
    } catch {
      return `$${amount.toFixed(2)}`;
    }
  }
  return String(value);
}

const dateTimeFormatter = new Intl.DateTimeFormat('en-AU', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: 'UTC',
});

export function formatDateTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return `${dateTimeFormatter.format(date)} UTC`;
}

export function escapeLike(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(level = 'info') {
  const threshold = LEVELS[level] ?? LEVELS.info;
  const write = (levelName, message, fields = {}) => {
    if ((LEVELS[levelName] ?? 20) < threshold) return;
    const entry = { time: nowIso(), level: levelName, message, ...fields };
    const line = JSON.stringify(entry);
    if (levelName === 'error' || levelName === 'warn') console.error(line);
    else console.log(line);
  };
  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
  };
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
