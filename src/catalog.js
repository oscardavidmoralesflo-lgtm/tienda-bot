// Catálogo unificado: KOKORO + Bunny, sin duplicados, con el mejor costo de cada producto.
import { kokoro } from './kokoro.js';
import { bunny, bunnyEnabled } from './bunny.js';
import { GROUPS, ALWAYS_HIDDEN } from './catalog-groups.js';

const groupOf = new Map();
GROUPS.forEach((g, i) => g.items.forEach((id) => groupOf.set(id, i)));

let lastBunnyError = null;
export const bunnyStatus = () => ({ enabled: bunnyEnabled(), error: lastBunnyError });

async function sources(fresh) {
  const [k, b] = await Promise.allSettled([kokoro.products(fresh), bunny.products(fresh)]);
  if (k.status === 'rejected' && b.status === 'rejected') throw k.reason;
  lastBunnyError = b.status === 'rejected' ? b.reason.message : null;
  if (b.status === 'rejected') console.error('Bunny:', b.reason.message);
  const kp = k.status === 'fulfilled' ? k.value.map((p) => ({ ...p, source: 'kokoro' })) : [];
  return [...kp, ...(b.status === 'fulfilled' ? b.value : [])];
}

// Todos los productos de ambos proveedores, marcando cuál gana en cada grupo (para el panel)
export async function allProducts(fresh = false) {
  const list = (await sources(fresh)).filter((p) => !ALWAYS_HIDDEN.includes(p.id));
  const best = new Map();
  for (const p of list) {
    const g = groupOf.get(p.id);
    if (g === undefined) continue;
    const cur = best.get(g);
    if (!cur || better(p, cur)) best.set(g, p);
  }
  return list.map((p) => {
    const g = groupOf.get(p.id);
    if (g === undefined) return { ...p, group: null, winner: true };
    const w = best.get(g);
    return { ...p, group: GROUPS[g].name, winner: w.id === p.id, displayName: GROUPS[g].name };
  });
}

// con stock gana el más barato; a igual precio, el de más stock
function better(a, b) {
  const sa = a.stock > 0;
  const sb = b.stock > 0;
  if (sa !== sb) return sa;
  if (a.price !== b.price) return a.price < b.price;
  return a.stock > b.stock;
}

// Lo que ven los clientes: un producto por grupo, con nombre limpio
export async function products(fresh = false) {
  return (await allProducts(fresh))
    .filter((p) => p.winner)
    .map((p) => (p.displayName ? { ...p, name: p.displayName } : p));
}

export async function findProduct(id, fresh = false) {
  return (await allProducts(fresh)).find((p) => p.id === id) || null;
}
