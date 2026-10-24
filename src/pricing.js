// Calcula tus precios de venta a partir del costo de KOKORO + tu margen.
import { many, query } from './db.js';
import { num } from './settings.js';

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

function applyMarkup(cost, markup) {
  return Math.max(ceil2(cost * (1 + markup / 100)), 0.01);
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
  const markup = o?.markup != null ? Number(o.markup) : num('markup_products');
  return applyMarkup(cost, markup);
}

// ---- Juegos (packs) ----
export function packPrice(pack, gameId) {
  const po = getOverride(pack.id);
  if (po?.fixed_price != null) return round2(po.fixed_price);
  const go = getOverride(gameId || pack.game_id);
  const markup = po?.markup != null ? Number(po.markup) : go?.markup != null ? Number(go.markup) : num('markup_games');
  return applyMarkup(Number(pack.price), markup);
}

export function gameFromPrice(game) {
  if (game.from_price == null) return null;
  const go = getOverride(game.id);
  const markup = go?.markup != null ? Number(go.markup) : num('markup_games');
  return applyMarkup(Number(game.from_price), markup);
}
