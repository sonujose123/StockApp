import crypto from 'node:crypto';

export const SESSION_COOKIE = 'stockly_admin';

export function timingSafeEqualString(a, b) {
  const left = crypto.createHash('sha256').update(String(a ?? '')).digest();
  const right = crypto.createHash('sha256').update(String(b ?? '')).digest();
  return crypto.timingSafeEqual(left, right);
}

function sessionKey(password) {
  return crypto.createHash('sha256').update(`stockly-admin-session:${password}`).digest();
}

export function createSession(password, ttlMs) {
  const expiresAt = Date.now() + ttlMs;
  const nonce = crypto.randomBytes(9).toString('base64url');
  const payload = `v1.${expiresAt}.${nonce}`;
  const signature = crypto.createHmac('sha256', sessionKey(password)).update(payload).digest('base64url');
  return { token: `${payload}.${signature}`, expiresAt };
}

export function verifySession(token, password) {
  if (typeof token !== 'string' || token === '') return false;
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return false;
  const [, expiresAtRaw, nonce, signature] = parts;
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
  const payload = `v1.${expiresAtRaw}.${nonce}`;
  const expected = crypto.createHmac('sha256', sessionKey(password)).update(payload).digest('base64url');
  return timingSafeEqualString(signature, expected);
}

export function parseCookies(header = '') {
  const cookies = {};
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    try {
      cookies[name] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      cookies[name] = part.slice(index + 1).trim();
    }
  }
  return cookies;
}

export function sessionCookie(token, { maxAgeSeconds, secure }) {
  const attributes = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

export function clearedSessionCookie({ secure }) {
  const attributes = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

export function createRateLimiter({ windowMs, max }) {
  const buckets = new Map();
  let lastSweep = Date.now();

  return function check(key) {
    const now = Date.now();
    if (now - lastSweep > windowMs) {
      for (const [bucketKey, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(bucketKey);
      }
      lastSweep = now;
    }
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    return {
      allowed: bucket.count <= max,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  };
}
