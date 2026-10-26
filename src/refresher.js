// Actualiza precios y stock cada 3 minutos y mantiene el servidor despierto
import { config } from './config.js';
import { kokoro } from './kokoro.js';
import { bunny } from './bunny.js';
import * as cache from './cache.js';
import { setAutoCop } from './pricing.js';
import { sendRenewals } from './orders.js';

const KINDS = ['topup', 'giftcard', 'key'];
export const lastRefresh = { at: null, ok: 0, total: 0, ms: 0 };

// Tasa del dólar en pesos colombianos (gratis, se actualiza 1 vez por hora)
let lastFx = 0;
export async function updateFx(force = false) {
  if (!force && Date.now() - lastFx < 60 * 60_000) return;
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(10_000) });
    const j = await r.json();
    if (j?.rates?.COP > 1000) {
      setAutoCop(j.rates.COP);
      lastFx = Date.now();
    }
  } catch (e) {
    console.error('tasa COP', e.message);
  }
}

// Carga inicial: catálogo, juegos de cada categoría y los paquetes de los juegos del menú
export async function warmUp() {
  const t = Date.now();
  updateFx(true);
  await Promise.allSettled([kokoro.products(), bunny.products(), ...KINDS.map((kind) => kokoro.games({ kind }))]);
  // paquetes de los primeros juegos de cada categoría (los más usados) para que abran al instante
  const lists = await Promise.allSettled(KINDS.map((kind) => kokoro.games({ kind })));
  const ids = lists.flatMap((r) => (r.status === 'fulfilled' ? (r.value.games || []).slice(0, 8).map((g) => g.id) : []));
  for (const id of ids) await kokoro.gamePacks(id).catch(() => {});
  console.log(`✅ Catálogo precargado en ${((Date.now() - t) / 1000).toFixed(1)} s (${ids.length} juegos)`);
}

async function tick() {
  const t = Date.now();
  const r = await cache.refreshAll({ always: ['k:products', 'b:products', ...KINDS.map((k) => `k:games::${k}:0`)] });
  Object.assign(lastRefresh, { at: new Date(), ...r, ms: Date.now() - t });
  updateFx();
  sendRenewals().catch((e) => console.error('renovaciones', e.message));
  // Render (plan gratis) duerme el servidor tras 15 min sin visitas: esta visita lo mantiene despierto
  if (config.publicUrl && process.env.KEEP_ALIVE !== '0') {
    fetch(`${config.publicUrl}/health`, { signal: AbortSignal.timeout(10_000) }).catch(() => {});
  }
}

export function startRefresher() {
  setInterval(() => tick().catch((e) => console.error('refresher', e.message)), cache.REFRESH_MS);
}
