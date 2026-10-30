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

export async function saveOverride(itemId, kind, name, { markup, fixed_price, hidden, featured }) {
  const clean = (v) => (v === '' || v === undefined || v === null || Number.isNaN(Number(v)) ? null : Number(v));
  const m = clean(markup);
  const f = clean(fixed_price);
  const h = !!hidden;
  const ft = !!featured;
  if (m === null && f === null && !h && !ft) {
    await query('DELETE FROM overrides WHERE item_id = $1', [itemId]);
  } else {
    await query(
      `INSERT INTO overrides (item_id, kind, name, markup, fixed_price, hidden, featured, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,now())
       ON CONFLICT (item_id) DO UPDATE SET kind=$2, name=$3, markup=$4, fixed_price=$5, hidden=$6, featured=$7, updated_at=now()`,
      [itemId, kind, name, m, f, h, ft],
    );
  }
  await loadOverrides();
}

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
// redondea hacia arriba al centavo (ignorando el ruido de los decimales flotantes)
const ceil2 = (n) => Math.ceil(Math.round(n * 100 * 1000) / 1000) / 100;
export const money = (n) => Number(n || 0).toFixed(2);

const nonnegative = key => Math.max(0, num(key));
function largestPct(text) {
  return Math.max(0,...String(text||'').split(',').map(x=>Number(x.split(':')[1])).filter(Number.isFinite));
}
export function profitPolicy(kind = 'products') {
  const loyalty = setting('protect_loyalty_costs') === '1'
    ? nonnegative('referral_percent') + largestPct(setting('cashback_tiers')) + largestPct(setting('recharge_bonus')) : 0;
  return {
    protected:setting('profit_protection') !== '0',
    salePct:nonnegative('payment_cost_percent') + nonnegative('risk_reserve_percent') + loyalty,
    supplierPct:nonnegative('supplier_cost_percent'),
    minProfit:nonnegative(kind==='games'?'min_profit_games':'min_profit_products'),
    marginPct:nonnegative(kind==='games'?'min_margin_games':'min_margin_products'),
  };
}
export function minimumSale(cost, kind = 'products', qty = 1) {
  const p=profitPolicy(kind),q=Math.max(1,qty),c=Number(cost)*(1+p.supplierPct/100);
  if(!Number.isFinite(c)||c<0)throw new Error('Costo inválido');
  if(!p.protected)return ceil2(Math.max(Number(cost)+p.minProfit/q,0.01));
  if(p.salePct+p.marginPct>=100)throw new Error('Comisiones y margen deben sumar menos de 100%.');
  return ceil2(Math.max((c+p.minProfit/q)/(1-p.salePct/100),c/(1-(p.salePct+p.marginPct)/100),0.01));
}
export function estimatedProfit(cost, sale, kind = 'products') {
  const p=profitPolicy(kind);
  return round4(Number(sale)*(1-p.salePct/100)-Number(cost)*(1+p.supplierPct/100));
}
export function protectsProfit(cost, sale, kind = 'products', qty = 1) {
  const p=profitPolicy(kind);
  if(!p.protected)return Number(sale)>=Number(cost);
  const net=estimatedProfit(cost,sale,kind);
  return net+0.0001>=p.minProfit && net+0.0001>=Number(sale)*p.marginPct/100;
}
function protectedPrice(cost, requested, kind, qty = 1) {
  return finalize(Math.max(Number(requested),minimumSale(cost,kind,qty)));
}

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
    return protectedPrice(cost, round2(Number(o.fixed_price) * ratio), 'products', qty);
  }
  const markup = o?.markup != null ? Number(o.markup) : tierPct(cost, 'products');
  // la ganancia mínima es por pedido: en compras por volumen se reparte entre las unidades
  return protectedPrice(cost, applyMarkup(cost, markup, num('min_profit_products') / Math.max(1, qty)), 'products', qty);
}

// ---- Juegos (packs) ----
export function packPrice(pack, gameId) {
  const po = getOverride(pack.id);
  if (po?.fixed_price != null) return protectedPrice(Number(pack.price),round2(po.fixed_price),'games');
  const go = getOverride(gameId || pack.game_id);
  const cost = Number(pack.price);
  const markup = po?.markup != null ? Number(po.markup) : go?.markup != null ? Number(go.markup) : tierPct(cost, 'games');
  return protectedPrice(cost,applyMarkup(cost, markup, num('min_profit_games')),'games');
}

export function gameFromPrice(game) {
  if (game.from_price == null) return null;
  const go = getOverride(game.id);
  const cost = Number(game.from_price);
  const markup = go?.markup != null ? Number(go.markup) : tierPct(cost, 'games');
  return protectedPrice(cost,applyMarkup(cost, markup, num('min_profit_games')),'games');
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
export const copSuffix = (usd) => (!copMode() && cop(usd) ? ` (≈ ${cop(usd)})` : '');

// ---------- Precios en pesos colombianos "limpios" ----------
export const round4 = (n) => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;
// true = el bot muestra y cobra en pesos (con tasa disponible)
export function copMode() {
  return String(setting('price_display') || 'cop').toLowerCase() === 'cop' && copRate() > 0;
}
// Redondeo comercial: menos de 5.000 → a la centena; desde 5.000 → termina en 400 o 900 (ej: 5.209 → 5.400, 23.423 → 23.900)
export function cleanCop(v) {
  if (!(v > 0)) return 0;
  if (v < 5000) return Math.ceil(v / 100) * 100;
  return Math.ceil((v + 100) / 500) * 500 - 100;
}
// convierte un precio en USD al USD equivalente de un precio redondo en pesos (lo que se cobra y se muestra coincide)
export function finalize(usd) {
  if (!copMode()) return usd;
  const r = copRate();
  return round4(cleanCop(usd * r) / r);
}
const pesos = (usd) => {
  const v = Math.round((Number(usd) * copRate()) / 10) * 10;
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('es-CO');
};
// Formato para clientes: "$5.400 COP" en modo pesos, "1.59 USDT" si no
export const fmt = (usd) => (copMode() ? `${pesos(usd)} COP` : `${money(usd)} ${setting('currency')}`);
// Formato corto para botones: "$5.400" (en Colombia el $ es peso) o "$1.59"
export const fmtS = (usd) => (copMode() ? pesos(usd) : `$${money(usd)}`);
