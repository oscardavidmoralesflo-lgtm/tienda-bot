// Cliente de la API de KOKORO SHOP (https://api.shopdigital.app)
import crypto from 'node:crypto';
import { config } from './config.js';
import * as cache from './cache.js';

export class KokoroError extends Error {
  constructor(message, { status, code, body, network } = {}) {
    super(message);
    this.status = status;   // código HTTP (undefined si fue un fallo de red)
    this.code = code;       // código de error de la API (games/esim/social)
    this.body = body || {};
    this.network = !!network;
  }
  // true = es seguro que NO se cobró nada (el error lo devolvió la API antes de cobrar)
  get definitelyNotCharged() {
    if ([400, 401, 402, 404, 409, 422].includes(this.status)) return true;
    // 503 con código (games_unavailable, keys_loading…) se rechaza antes de cobrar
    return this.status === 503 && !!this.code;
  }
}

async function call(method, path, { query, body, timeout = 30000 } = {}) {
  const url = new URL(config.kokoroBase + path);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${config.kokoroToken}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeout),
      });
    } catch (e) {
      throw new KokoroError(`No se pudo conectar con KOKORO: ${e.message}`, { network: true });
    }
    if (res.status !== 429) break;
    const wait = Math.min(Number(res.headers.get('retry-after')) || 2, 10);
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw new KokoroError(`Respuesta inválida de KOKORO (HTTP ${res.status})`, { status: res.status, network: res.status >= 500 });
  }
  data._http = res.status;
  if (!res.ok || data.success === false) {
    // Compras de juegos: success:false + status:refunded => ya reembolsado, nada cobrado
    if (res.ok && data.status === 'refunded') return data;
    // 202 = pagado pero la entrega está pendiente (revisión manual)
    if (res.status === 202) return { ...data, status: data.status || 'processing' };
    throw new KokoroError(data.error || `Error HTTP ${res.status}`, {
      status: res.status,
      code: data.code,
      body: data,
      network: res.status >= 500,
    });
  }
  return data;
}

// ---- caché simple en memoria ----
const cached = (key, _ttl, fn) => cache.swr(`k:${key}`, fn);
export const clearCache = () => cache.clear('k:');
const loadProducts = () => call('GET', '/api/products').then((d) => d.products || []);

export const kokoro = {
  balance: () => call('GET', '/api/balance'),

  // Productos digitales (siempre desde memoria; fresh=true al momento de pagar)
  products: (fresh = false) => (fresh ? cache.fresh('k:products', loadProducts) : cache.swr('k:products', loadProducts)),
  purchase: (body) => call('POST', '/api/purchase', { body: { credentials_format: 'lines', ...body }, timeout: 60000 }),
  productOrder: (orderId) => call('GET', '/api/orders', { query: { order_id: orderId, credentials_format: 'lines' } }),

  // Juegos, gift cards y keys
  games: ({ q, kind, all } = {}) =>
    cached(`games:${q || ''}:${kind || ''}:${all ? 1 : 0}`, q ? 60_000 : 300_000, () =>
      call('GET', '/api/games', { query: { q, kind, all: all ? '1' : undefined } })),
  gamePacks: (gameId, { region, country } = {}) =>
    cached(`packs:${gameId}:${region || ''}:${country || ''}`, 120_000, () =>
      call('GET', `/api/games/${encodeURIComponent(gameId)}/products`, { query: { region, country } })),
  validate: (body) => call('POST', '/api/games/validate', { body }),
  gamePurchase: (body) => call('POST', '/api/games/purchase', { body, timeout: 60000 }),
  gameOrder: (orderId) => call('GET', '/api/games/orders', { query: { order_id: orderId } }),
  sendCode: (orderId, code) => call('POST', `/api/games/orders/${encodeURIComponent(orderId)}/code`, { body: { code } }),
};

// Verifica la firma de los webhooks: sha256=HMAC_SHA256(token, timestamp + "." + body)
export function verifyWebhook(rawBody, timestamp, signature) {
  if (!timestamp || !signature) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 600) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', config.kokoroToken).update(`${timestamp}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
