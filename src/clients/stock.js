import { delay, truncate } from '../util.js';

/**
 * Client for the store's inventory API.
 *
 * Everything downstream treats its answer as the source of truth: a webhook
 * only tells us *which* SKU to look at, never whether it is available.
 */
export function createStockClient({ baseUrl, apiKey, timeoutMs = 6000, logger }) {
  async function getJson(url, { timeout, retries }) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await fetch(url, {
          headers: {
            Accept: 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          signal: AbortSignal.timeout(timeout),
        });

        if (response.status === 404) return { notFound: true, data: null };

        if (response.status === 429 || response.status >= 500) {
          const error = new Error(`Stock API responded ${response.status}`);
          error.status = response.status;
          error.retryable = true;
          lastError = error;
        } else if (!response.ok) {
          const body = truncate(await response.text().catch(() => ''), 200);
          const error = new Error(`Stock API responded ${response.status}${body ? `: ${body}` : ''}`);
          error.status = response.status;
          error.retryable = false;
          throw error;
        } else {
          return { notFound: false, data: await response.json() };
        }
      } catch (error) {
        lastError = error;
        if (error.name === 'TimeoutError' || error.name === 'AbortError') {
          error.message = `Stock API timed out after ${timeout}ms`;
          error.retryable = true;
        } else if (error instanceof TypeError) {
          // fetch() rejects with TypeError for DNS / connection failures.
          error.retryable = true;
        }
      }

      if (attempt < retries && lastError?.retryable !== false) {
        await delay(250 * 2 ** attempt);
        continue;
      }
      throw lastError;
    }
    throw lastError;
  }

  return {
    async getProduct(sku, { timeout = timeoutMs, retries = 2 } = {}) {
      const url = `${baseUrl}/${encodeURIComponent(sku)}`;
      try {
        const result = await getJson(url, { timeout, retries });
        if (result.notFound || !result.data) return null;
        return normalizeProduct(result.data, sku);
      } catch (error) {
        logger?.warn('stock.fetch_failed', { sku, error: error.message });
        throw error;
      }
    },
  };
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function toNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalises the handful of product/inventory shapes a store API may return.
 * Unknown fields fall back to the SKU rather than breaking an alert.
 */
export function normalizeProduct(payload, sku) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const product = payload.product && typeof payload.product === 'object' ? payload.product : payload;
  const inventory = payload.inventory && typeof payload.inventory === 'object'
    ? payload.inventory
    : product.inventory;

  const quantity = toNumber(firstDefined(
    payload.quantity,
    payload.inventory_quantity,
    payload.stock,
    inventory?.quantity,
    product.quantity,
    product.stock,
  ));

  const inStockRaw = firstDefined(
    payload.in_stock,
    payload.inStock,
    payload.available,
    inventory?.in_stock,
    inventory?.available,
    product.in_stock,
    product.available,
  );
  const inStock = typeof inStockRaw === 'boolean'
    ? inStockRaw
    : quantity !== null
      ? quantity > 0
      : false;

  const priceRaw = firstDefined(product.price, payload.price);
  const price = priceRaw && typeof priceRaw === 'object'
    ? firstDefined(priceRaw.amount, priceRaw.value, priceRaw.formatted)
    : priceRaw;
  const currency = firstDefined(
    typeof priceRaw === 'object' ? priceRaw.currency : undefined,
    payload.currency,
    product.currency,
  );

  const images = firstDefined(product.images, payload.images);
  const imageUrl = firstDefined(
    product.image_url,
    product.imageUrl,
    product.image,
    payload.image_url,
    Array.isArray(images) ? images[0] : undefined,
  );

  const link = firstDefined(
    product.url,
    product.product_url,
    product.productUrl,
    product.permalink,
    payload.url,
    payload.product_url,
  );

  const name = firstDefined(product.name, product.title, payload.name, payload.title);

  return {
    sku,
    name: typeof name === 'string' && name.trim() ? name.trim() : `Product ${sku}`,
    price: price === undefined ? null : price,
    currency: typeof currency === 'string' ? currency : null,
    imageUrl: typeof imageUrl === 'string' ? imageUrl : null,
    url: typeof link === 'string' ? link : null,
    quantity,
    inStock,
  };
}
