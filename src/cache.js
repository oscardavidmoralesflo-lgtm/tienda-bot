// Caché "stale-while-revalidate": el cliente SIEMPRE recibe la respuesta al instante desde memoria.
// Si el dato está viejo se devuelve igual y se actualiza en segundo plano.
// El refresco programado (cada 3 min) mantiene todo al día aunque nadie esté usando el bot.
export const REFRESH_MS = 3 * 60_000;

const store = new Map(); // key -> { value, exp, fn, lastUsed, pending }

function load(key, fn, ttl) {
  const e = store.get(key) || { fn, lastUsed: Date.now() };
  e.fn = fn;
  if (!e.pending) {
    e.pending = fn()
      .then((value) => {
        e.value = value;
        e.has = true;
        e.exp = Date.now() + ttl;
        return value;
      })
      .finally(() => {
        e.pending = null;
      });
    store.set(key, e);
  }
  return e.pending;
}

export async function swr(key, fn, ttl = REFRESH_MS) {
  const e = store.get(key);
  if (e?.has) {
    e.lastUsed = Date.now();
    if (e.exp <= Date.now()) load(key, fn, ttl).catch((err) => console.error('cache', key, err.message));
    return e.value;
  }
  return load(key, fn, ttl);
}

// Fuerza datos frescos (para el momento de pagar) y actualiza la caché
export const fresh = (key, fn, ttl = REFRESH_MS) => load(key, fn, ttl);

// Refresca todo lo que se usó en los últimos 30 minutos (más lo marcado como permanente)
export async function refreshAll({ always = [] } = {}) {
  const cutoff = Date.now() - 30 * 60_000;
  const keys = [...store.entries()].filter(([k, e]) => e.fn && (always.includes(k) || e.lastUsed > cutoff)).map(([k]) => k);
  let ok = 0;
  for (const k of keys) {
    try {
      await load(k, store.get(k).fn, REFRESH_MS);
      ok++;
    } catch (err) {
      console.error('refresh', k, err.message);
    }
  }
  return { ok, total: keys.length };
}

export function clear(prefix = '') {
  for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k);
}
