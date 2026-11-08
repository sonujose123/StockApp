import { truncate } from '../util.js';

/**
 * Resend-compatible email client.
 *
 * RESEND_BASE_URL may point at a fake/recording endpoint; the standard
 * /emails route is appended unless the base already ends with it.
 */
export function createMailer({ baseUrl, apiKey, from, timeoutMs = 10000 }) {
  const endpoint = /\/emails\/?$/.test(baseUrl) ? baseUrl : `${baseUrl}/emails`;

  return {
    endpoint,
    async send({ to, subject, html, text, idempotencyKey }) {
      let response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            // Deterministic per request: retries after a crash reuse it.
            ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
          },
          body: JSON.stringify({
            from,
            to: [to],
            subject,
            html,
            ...(text ? { text } : {}),
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        if (error.name === 'TimeoutError' || error.name === 'AbortError') {
          error.message = `Email API timed out after ${timeoutMs}ms`;
        }
        error.retryable = true;
        throw error;
      }

      const raw = await response.text().catch(() => '');
      let body = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = null;
      }

      if (!response.ok) {
        const error = new Error(`Email API responded ${response.status}: ${truncate(raw, 300)}`);
        error.status = response.status;
        // 4xx means our payload/sender is wrong; retrying cannot help.
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      }

      return { id: body?.id ?? null, status: response.status };
    },
  };
}
