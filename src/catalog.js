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
// Grupos manuales (catalog-groups.js) y, además, productos con exactamente el mismo nombre
const nameKey = (n) => `name:${String(n).toLowerCase().replace(/\s+/g, ' ').trim()}`;
const keyOf = (p) => (groupOf.has(p.id) ? `g:${groupOf.get(p.id)}` : nameKey(p.name));

export async function allProducts(fresh = false) {
  const list = (await sources(fresh)).filter((p) => !ALWAYS_HIDDEN.includes(p.id));
  const best = new Map();
  const size = new Map();
  for (const p of list) {
    const k = keyOf(p);
    size.set(k, (size.get(k) || 0) + 1);
    const cur = best.get(k);
    if (!cur || better(p, cur)) best.set(k, p);
  }
  return list.map((p) => {
    const k = keyOf(p);
    const manual = groupOf.has(p.id) ? GROUPS[groupOf.get(p.id)].name : null;
    if (!manual && size.get(k) === 1) return { ...p, group: null, winner: true };
    const groupName = manual || p.name;
    return { ...p, group: groupName, winner: best.get(k).id === p.id, displayName: manual || undefined };
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

// fresh=true (al pagar) solo vuelve a consultar el proveedor de ESE producto
export async function findProduct(id, fresh = false) {
  if (fresh) {
    if (String(id).startsWith('bunny:')) await bunny.products(true).catch(() => {});
    else await kokoro.products(true).catch(() => {});
  }
  return (await allProducts(false)).find((p) => p.id === id) || null;
}
