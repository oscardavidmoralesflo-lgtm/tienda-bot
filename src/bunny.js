// Cliente de la API de revendedores de Bunny AI Store (https://bunnytoolsbot.tech/developer)
import { config } from './config.js';

export class BunnyError extends Error {
  constructor(message, { status, body, network } = {}) {
    super(message);
    this.status = status;
    this.body = body || {};
    this.network = !!network;
  }
  // Bunny rechaza antes de cobrar (precio, stock, saldo). Solo un fallo de red o un 5xx es dudoso.
  get definitelyNotCharged() {
    return !this.network && this.status >= 400 && this.status < 500;
  }
}

export const bunnyEnabled = () => !!config.bunnyKey;

async function call(method, path, body, timeout = 30000) {
  let res;
  try {
    res = await fetch(`${config.bunnyBase}${path}`, {
      method,
      headers: { 'X-API-Key': config.bunnyKey, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    throw new BunnyError(`No se pudo conectar con Bunny: ${e.message}`, { network: true });
  }
  let data = {};
  try {
    data = await res.json();
  } catch {
    if (res.ok) throw new BunnyError('Respuesta inválida de Bunny', { status: res.status, network: true });
  }
  if (!res.ok || data.status === 'error' || data.success === false) {
    throw new BunnyError(data.message || data.error || `Error HTTP ${res.status}`, {
      status: res.ok ? 400 : res.status,
      body: data,
      network: res.status >= 500,
    });
  }
  return data;
}

// stock "∞" / null / negativo => ilimitado
const stockOf = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 999;
};

// Limpia nombres: quita la categoría entre paréntesis del final, símbolos raros y espacios dobles
export function cleanName(n) {
  return String(n || '')
    .replace(/\s*\((Codex & Claud[^)]*|Mails Good Quality|Muse Ai)\)\s*$/i, '')
    .replace(/\s\?\s/g, ' – ')
    .replace(/\bACCONT\b/g, 'Account')
    .replace(/Account,s/g, 'Accounts')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Convierte un producto de Bunny al mismo formato que KOKORO
// (la API real usa product_id/base_price/description; la documentación dice id/price/warranty_info)
export function normalize(p) {
  const id = p.product_id ?? p.id;
  const desc = String(p.description || '').replace(/\r/g, '').replace(/\n/g, '<br>');
  const warranty = p.warranty_info ? `🛡 <b>Garantía:</b> ${p.warranty_info}` : '';
  return {
    id: `bunny:${id}`,
    name: cleanName(p.name),
    price: Number(p.base_price ?? p.price),
    stock: stockOf(p.stock_count ?? p.stock),
    min_order: 1,
    bulk_discounts: [],
    requires_activation_data: false,
    activation_data_type: null,
    emoji_base: null,
    description_es: [desc, warranty].filter(Boolean).join('<br><br>'),
    description_en: [desc, warranty].filter(Boolean).join('<br><br>'),
    source: 'bunny',
    sourceId: Number(id),
  };
}

export const balanceOf = (profile) => Number(profile?.merchant?.balance ?? profile?.balance);

let cache = null;
export const bunny = {
  async products(fresh = false) {
    if (!bunnyEnabled()) return [];
    if (!fresh && cache && cache.exp > Date.now()) return cache.value;
    const d = await call('GET', '/products');
    const value = (d.products || []).map(normalize).filter((p) => p.name && p.price > 0);
    cache = { value, exp: Date.now() + 60_000 };
    return value;
  },
  profile: () => call('GET', '/profile'),
  // Una sola llamada, sin reintentos: Bunny no protege contra pedidos duplicados.
  createOrder: ({ productId, quantity, sellingPrice }) =>
    call('POST', '/order/create', { product_id: productId, quantity, selling_price: sellingPrice }, 60000),
  clearCache: () => { cache = null; },
};
