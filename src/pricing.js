// Calcula tus precios de venta a partir del costo de KOKORO + tu margen.
import { many, query } from './db.js';
import { num, s as setting } from './settings.js';

let overrides = new Map();

export async function loadOverrides() {
  const rows = await many('SELECT * FROM overrides');
  overrides = new Map(rows.map((r) => [r.item_id, r]));
}
export const getOverride = (id) => overrides.get(id) || null;
export const isHidden = (id) => !!overrides.get(id)?.hidden;

export async function saveOverride(itemId, kind, name, { markup, fixed_price, hidden }) {
  const clean = (v) => (v === '' || v === undefined || v === null || Number.isNaN(Number(v)) ? null : Number(v));
  const m = clean(markup);
  const f = clean(fixed_price);
  const h = !!hidden;
  if (m === null && f === null && !h) {
    await query('DELETE FROM overrides WHERE item_id = $1', [itemId]);
  } else {
    await query(
      `INSERT INTO overrides (item_id, kind, name, markup, fixed_price, hidden, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,now())
       ON CONFLICT (item_id) DO UPDATE SET kind=$2, name=$3, markup=$4, fixed_price=$5, hidden=$6, updated_at=now()`,
      [itemId, kind, name, m, f, h],
    );
  }
  await loadOverrides();
}

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
// redondea hacia arriba al centavo (ignorando el ruido de los decimales flotantes)
const ceil2 = (n) => Math.ceil(Math.round(n * 100 * 1000) / 1000) / 100;
export const money = (n) => Number(n || 0).toFixed(2);

function applyMarkup(cost, markup, minProfit = 0) {
  return Math.max(ceil2(Math.max(cost * (1 + markup / 100), cost + minProfit)), 0.01);
}

// Tramos de margen: "1:60,3:40,10:30,30:20,*:12" = costo hasta 1 USD → 60 %, hasta 3 USD → 40 %, … el resto 12 %
const tierCache = new Map();
export function parseTiers(text) {
  if (tierCache.has(text)) return tierCache.get(text);
  const tiers = String(text || '')
    .split(',')
    .map((t) => t.trim().split(':'))
    .filter(([a, b]) => a && b !== undefined && !Number.isNaN(Number(b)))
    .map(([a, b]) => ({ max: a.trim() === '*' ? Infinity : Number(a), pct: Number(b) }))
    .filter((t) => !Number.isNaN(t.max))
    .sort((x, y) => x.max - y.max);
  tierCache.set(text, tiers);
  return tiers;
}
// % que corresponde a un costo: por tramos si hay, si no el margen general
export function tierPct(cost, kind) {
  const tiers = parseTiers(setting(kind === 'games' ? 'price_tiers_games' : 'price_tiers_products'));
  const t = tiers.find((x) => cost <= x.max);
  if (t) return t.pct;
  return num(kind === 'games' ? 'markup_games' : 'markup_products');
}

// ---- Productos digitales ----
export function productUnitCost(product, qty = 1) {
  let unit = Number(product.price);
  for (const t of product.bulk_discounts || []) {
    if (qty >= t.min_qty && Number(t.unit_price) < unit) unit = Number(t.unit_price);
  }
  return unit;
}

export function productUnitPrice(product, qty = 1) {
  const o = getOverride(product.id);
  const cost = productUnitCost(product, qty);
  if (o?.fixed_price != null) {
    // precio fijo por unidad; los descuentos por volumen se aplican en la misma proporción
    const ratio = Number(product.price) > 0 ? cost / Number(product.price) : 1;
    return round2(Number(o.fixed_price) * ratio);
  }
  const markup = o?.markup != null ? Number(o.markup) : tierPct(cost, 'products');
  // la ganancia mínima es por pedido: en compras por volumen se reparte entre las unidades
  return applyMarkup(cost, markup, num('min_profit_products') / Math.max(1, qty));
}

// ---- Juegos (packs) ----
export function packPrice(pack, gameId) {
  const po = getOverride(pack.id);
  if (po?.fixed_price != null) return round2(po.fixed_price);
  const go = getOverride(gameId || pack.game_id);
  const cost = Number(pack.price);
  const markup = po?.markup != null ? Number(po.markup) : go?.markup != null ? Number(go.markup) : tierPct(cost, 'games');
  return applyMarkup(cost, markup, num('min_profit_games'));
}

export function gameFromPrice(game) {
  if (game.from_price == null) return null;
  const go = getOverride(game.id);
  const cost = Number(game.from_price);
  const markup = go?.markup != null ? Number(go.markup) : tierPct(cost, 'games');
  return applyMarkup(cost, markup, num('min_profit_games'));
}

// Equivalente en pesos colombianos (redondeado hacia arriba a 100 COP). Vacío si no hay tasa.
let autoCop = null; // tasa USD→COP del día (la actualiza el refresco automático)
export const setAutoCop = (v) => { autoCop = Number(v) || null; };
export function copRate() {
  const v = String(setting('cop_rate') || '').trim().toLowerCase();
  if (v === 'auto') return autoCop ? Math.ceil(autoCop * (1 + num('cop_spread') / 100)) : 0;
  return Number(v) > 0 ? Number(v) : 0;
}
export function cop(usd) {
  const rate = copRate();
  if (!(rate > 0)) return '';
  const v = Math.ceil((Number(usd) * rate) / 100) * 100;
  return v.toLocaleString('es-CO') + ' COP';
}
export const copSuffix = (usd) => (cop(usd) ? ` (≈ ${cop(usd)})` : '');
