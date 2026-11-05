// Vitrina de productos ganadores (modo "winners").
// Solo se muestran estos productos (más los que marques con ⭐ en el panel).
// Cada ranura agrupa ofertas EQUIVALENTES (misma duración, misma forma de entrega y garantía
// parecida, revisado en las descripciones de los proveedores). El cliente ve UNA sola: la de
// menor costo con stock. Si ninguna tiene stock, la ranura no se muestra.
//
// "cop" = precio objetivo en pesos que ve el cliente (editable en Panel → Productos → 🏆 Vitrina).
// Si el costo sube y ese precio ya no deja la ganancia mínima, el bot usa el precio protegido.
// Si el bot cambia a una oferta más barata, el cliente paga lo mismo y tú ganas la diferencia.
//
// Selección del 2026-11-01, revisada el 2026-11-05: "top/trending" de Bunny, reposiciones de
// KOKORO, promociones de otros mayoristas y lo que más se pide en Colombia.
// Precios del 2026-11-05: por debajo de Mercado Libre Colombia y de los precios oficiales.
import { s } from './settings.js';

export const WINNERS = [
  // ---- Inteligencia artificial ----
  { key: 'gpt_fw', cop: 49900, name: 'ChatGPT Plus 1 Mes · Garantía completa', ids: ['91191e45-9207-4245-a7b5-4213fff78fd8'] },
  { key: 'gpt_eco', cop: 26900, name: 'ChatGPT Plus 1 Mes · Económico (Sin garantía)', ids: ['bunny:84', '2b9cc107-77cf-4565-99df-932da1044cc2'] },
  // Jero: link de 3 meses en tu cuenta Google, pide tarjeta para verificar, sin garantía (igual que el de KOKORO)
  { key: 'gemini_pro_3m', cop: 7900, name: 'Gemini AI Pro 3 Meses · En tu cuenta Google', ids: ['df31e1db-17be-4d27-9e44-4949578ec406'],
    // La API de Jero (nombres en turco: "Aylık" = meses) aún no lo publica; solo está en su bot
    match: [{ src: 'jero', re: /^gemini ai pro\W+3 (months?|ayl[ıi]k)$/i }] },
  { key: 'gemini_plus_12', cop: 9900, name: 'Gemini Plus 12 Meses · En tu cuenta Google', ids: ['bunny:93'] },
  { key: 'muse_1b', cop: 4900, name: 'Muse AI · 1000 millones de tokens', ids: ['bunny:31', '630d58eb-7cd1-4707-a411-734a3e4ee08a'] },
  // ---- Diseño y edición ----
  // jero:14 = "CapCut Pro 1 Aylık" en su API (cuenta personal, garantía 25 días)
  { key: 'capcut_1m', cop: 12900, name: 'CapCut Pro 1 Mes · Cuenta Team', ids: ['capcut_pro_team', 'bunny:3', 'jero:14', 'subexpress:1'],
    match: [{ src: 'subexpress', re: /^capcut pro 30 days\s*\|\s*fw/i }, { src: 'jero', re: /^capcut pro 1 (month|ayl[ıi]k)$/i }] },
  { key: 'canva_3y', cop: 9900, name: 'Canva Pro 3 Años · Cuenta lista', ids: ['canva_team_invite_pro'] },
  { key: 'canva_own', cop: 14900, name: 'Canva Pro 3 Años · En tu correo', ids: ['canva_team_invite_own_email_pro'] },
  { key: 'adobe_express_12', cop: 7900, name: 'Adobe Express Premium 12 Meses', ids: ['adobe_express_12m'] },
  // ---- Streaming y música ----
  { key: 'disney_espn', cop: 36900, name: 'Disney+ Premium con ESPN 1 Mes', ids: ['link_disney_mov_chile', 'link_disney_premium_nuplin'] },
  { key: 'max_std', cop: 11900, name: 'Max Plan Estándar 1 Mes · Cuenta privada', ids: ['max_standar_mov_chile', 'max_standar_vtr'] },
  { key: 'prime_6m', cop: 19900, name: 'Prime Video 6 Meses · Cuenta privada', ids: ['prime_video_6m', 'bunny:41'] },
  { key: 'prime_1m', cop: 7900, name: 'Prime Video 1 Mes · Cuenta privada', ids: ['bunny:52'] },
  { key: 'youtube_1m', cop: 11900, name: 'YouTube Premium 1 Mes · Cuenta privada', ids: ['Youtube_premium_30d'] },
  { key: 'youtube_3m', cop: 24900, name: 'YouTube Premium 3 Meses · En tu cuenta', ids: ['bunny:64'] },
  { key: 'spotify_3m', cop: 12900, name: 'Spotify Premium 3 Meses · En tu cuenta', ids: ['bunny:11', 'code_spotify_90d'] },
  { key: 'crunchy_1m', cop: 6900, name: 'Crunchyroll Premium 1 Mes · En tu cuenta', ids: ['crunchyroll_link_30days', 'bunny:45'] },
  { key: 'apple_music_5m', cop: 9900, name: 'Apple Music 5 Meses · Link', ids: ['apple_music_link_5m', 'bunny:36'] },
  // ---- Educación ----
  { key: 'duolingo_12', cop: 14900, name: 'Super Duolingo 12 Meses · En tu cuenta', ids: ['bunny:12', 'cf3a4cc4-8df7-4d15-bbe4-1836bec1c0da'] },
  { key: 'coursera_12', cop: 19900, name: 'Coursera Premium 12 Meses', ids: ['1cb47ba8-de93-42c6-9a09-b662c59b076d'] },
  { key: 'linkedin_3m', cop: 14900, name: 'LinkedIn Premium Career 3 Meses', ids: ['linkedin_career_3m'] },
  // ---- Office y productividad ----
  { key: 'm365_12', cop: 19900, name: 'Microsoft 365 Personal 12 Meses', ids: ['Microsoft_365_personal'] },
  { key: 'office365_12', cop: 9900, name: 'Office 365 Pro Plus 12 Meses · Cuenta privada', ids: ['jero:83'],
    match: [{ src: 'jero', re: /^office 365 pro plus$/i }] },
  { key: 'office_2021', cop: 14900, name: 'Office 2021 Pro Plus · Licencia', ids: ['2a45036b-b2c5-4a8a-a5fc-9141e43c1046'] },
  { key: 'windows_pro', cop: 14900, name: 'Windows 10/11 Pro · Licencia', ids: ['be5b54d4-4f2b-49bc-ac40-2a40b299bbf9'] },
  { key: 'notion_3m', cop: 9900, name: 'Notion Business 3 Meses · En tu cuenta', ids: ['notion_Bussines_code3m', 'bunny:38'] },
  { key: 'zoom_1m', cop: 17900, name: 'Zoom Pro 1 Mes · Cuenta lista', ids: ['d176cebe-4251-46c0-a384-77eed3ffa59e', 'bunny:32'] },
  { key: 'ilovepdf_12', cop: 12900, name: 'iLovePDF Premium 12 Meses', ids: ['ilove_pdf_12m', 'bunny:35'] },
  // ---- VPN ----
  // La cuenta compartida de NordVPN (nordvpn_shared_3m) pide un código por botón que este bot no maneja: se usa el link.
  { key: 'nord_3m', cop: 16900, name: 'NordVPN 3 Meses · En tu cuenta', ids: ['b43c40c1-6130-429b-9b9f-759650ade50d', 'subexpress:7'],
    match: [{ src: 'subexpress', re: /^nord ?vpn 3m activation link/i }] },
  { key: 'surfshark_2m', cop: 12900, name: 'Surfshark VPN 2 Meses · Cuenta lista', ids: ['vpn_Surfshark_60d', 'bunny:90'] },
];

// Orden de "Más vendidos" mientras no haya ventas propias (las ventas reales van primero)
export const TOP_ORDER = ['gpt_eco', 'gemini_plus_12', 'capcut_1m', 'canva_own', 'spotify_3m', 'disney_espn', 'youtube_1m', 'prime_6m', 'muse_1b', 'max_std'];

const slotOf = new Map();
WINNERS.forEach((w) => w.ids.forEach((id) => slotOf.set(id, w)));
// Mayoristas conectados por API (Jero, SubExpress…): sus IDs solo se conocen con la clave,
// así que se reconocen por proveedor + nombre exacto revisado (ver "match" en cada ranura).
// Se ignoran emojis y símbolos al inicio del nombre (SubExpress los usa: "🖤 CapCut Pro 30 Days | FW").
const cleanName = (n) => String(n || '').replace(/^[^\p{L}\p{N}]+/u, '').trim();
const matchesRule = (w, p) => (w.match || []).some((r) => r.src === p.source && r.re.test(cleanName(p.name)));
// Ranura de un producto (acepta el producto o solo su ID)
export function winnerSlot(x) {
  if (!x) return null;
  if (typeof x === 'string') return slotOf.get(x) || null;
  return slotOf.get(x.id) || WINNERS.find((w) => matchesRule(w, x)) || null;
}
export const inSlot = (w, p) => w.ids.includes(p.id) || matchesRule(w, p);
export const winnersMode = () => s('catalog_mode') !== 'all';

// Precios objetivo guardados desde el panel (ajuste winner_prices = {"gpt_fw":49900,...}); vacío = el de este archivo
function savedPrices() {
  try { return JSON.parse(s('winner_prices') || '{}') || {}; } catch { return {}; }
}
export function targetCop(key) {
  const saved = savedPrices();
  const v = Object.hasOwn(saved, key) ? Number(saved[key]) : WINNERS.find((w) => w.key === key)?.cop;
  return Number(v) > 0 ? Number(v) : 0; // 0 = usar el margen automático
}

// Producto con el nombre y el precio objetivo de su ranura (solo en modo vitrina)
export function asSlotProduct(p) {
  const w = winnersMode() ? winnerSlot(p) : null;
  return w ? { ...p, name: w.name, slot: w.key, targetCop: targetCop(w.key) } : p;
}

// De la lista visible (ya sin ocultos), deja una oferta por ranura (la de menor costo con stock)
// y añade los destacados ⭐ que no estén en ninguna ranura.
export function curate(list, { priceOf, isFeatured }) {
  const out = [];
  for (const w of WINNERS) {
    const offers = list.filter((p) => p.stock > 0 && inSlot(w, p));
    if (!offers.length) continue;
    offers.sort((a, b) => priceOf(a) - priceOf(b) || Number(a.price) - Number(b.price) || b.stock - a.stock);
    out.push({ ...offers[0], name: w.name, slot: w.key, offers: offers.length, targetCop: targetCop(w.key) });
  }
  for (const p of list) if (!winnerSlot(p) && isFeatured(p.id)) out.push(p);
  return out;
}
