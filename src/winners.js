// Vitrina de productos ganadores (modo "winners").
// Solo se muestran estos productos (más los que marques con ⭐ en el panel).
// Cada ranura agrupa ofertas EQUIVALENTES (misma duración, misma forma de entrega y garantía
// parecida, revisado en las descripciones de los proveedores el 2026-11-01). El cliente ve UNA
// sola: la más barata con stock. Si ninguna tiene stock, la ranura no se muestra.
//
// Por qué estos: tendencias y "top" de Bunny, reposiciones frecuentes en los canales de KOKORO,
// promociones de otros mayoristas (SubExpress, Jero, Hsoulz, S-AI) y lo que más se pide en Colombia
// (streaming, ChatGPT, Gemini, CapCut, Canva, Office).
import { s } from './settings.js';

export const WINNERS = [
  // ---- Inteligencia artificial ----
  { key: 'gpt_fw', name: 'ChatGPT Plus 1 Mes · Garantía completa', ids: ['91191e45-9207-4245-a7b5-4213fff78fd8'] },
  { key: 'gpt_eco', name: 'ChatGPT Plus 1 Mes · Económico (Sin garantía)', ids: ['bunny:84', '2b9cc107-77cf-4565-99df-932da1044cc2'] },
  { key: 'gemini_plus_12', name: 'Gemini Plus 12 Meses · En tu Gmail', ids: ['bunny:93'] },
  { key: 'muse_1b', name: 'Muse AI · 1000 millones de tokens', ids: ['bunny:31', '630d58eb-7cd1-4707-a411-734a3e4ee08a'] },
  // ---- Diseño y edición ----
  { key: 'capcut_1m', name: 'CapCut Pro 1 Mes · Cuenta Team', ids: ['capcut_pro_team', 'bunny:3'] },
  { key: 'canva_3y', name: 'Canva Pro 3 Años · Cuenta lista', ids: ['canva_team_invite_pro'] },
  { key: 'adobe_express_12', name: 'Adobe Express Premium 12 Meses', ids: ['adobe_express_12m'] },
  // ---- Streaming y música ----
  { key: 'disney_espn', name: 'Disney+ Premium con ESPN 1 Mes', ids: ['link_disney_premium_nuplin'] },
  { key: 'max_std', name: 'Max Plan Estándar 1 Mes · Cuenta privada', ids: ['max_standar_mov_chile'] },
  { key: 'prime_6m', name: 'Prime Video 6 Meses · Cuenta privada', ids: ['prime_video_6m', 'bunny:41'] },
  { key: 'prime_1m', name: 'Prime Video 1 Mes · Cuenta privada', ids: ['bunny:52'] },
  { key: 'youtube_1m', name: 'YouTube Premium 1 Mes · Cuenta privada', ids: ['Youtube_premium_30d'] },
  { key: 'youtube_3m', name: 'YouTube Premium 3 Meses · En tu cuenta', ids: ['bunny:64'] },
  { key: 'spotify_3m', name: 'Spotify Premium 3 Meses · En tu cuenta', ids: ['bunny:11', 'code_spotify_90d'] },
  { key: 'crunchy_1m', name: 'Crunchyroll Premium 1 Mes · En tu cuenta', ids: ['crunchyroll_link_30days', 'bunny:45'] },
  { key: 'apple_music_5m', name: 'Apple Music 5 Meses · Link', ids: ['apple_music_link_5m', 'bunny:36'] },
  // ---- Educación ----
  { key: 'duolingo_12', name: 'Super Duolingo 12 Meses · En tu cuenta', ids: ['bunny:12', 'cf3a4cc4-8df7-4d15-bbe4-1836bec1c0da'] },
  { key: 'coursera_12', name: 'Coursera Premium 12 Meses', ids: ['1cb47ba8-de93-42c6-9a09-b662c59b076d'] },
  { key: 'linkedin_3m', name: 'LinkedIn Premium Career 3 Meses', ids: ['linkedin_career_3m'] },
  // ---- Office y productividad ----
  { key: 'm365_12', name: 'Microsoft 365 Personal 12 Meses', ids: ['Microsoft_365_personal'] },
  { key: 'office_2021', name: 'Office 2021 Pro Plus · Licencia', ids: ['2a45036b-b2c5-4a8a-a5fc-9141e43c1046'] },
  { key: 'windows_pro', name: 'Windows 10/11 Pro · Licencia', ids: ['be5b54d4-4f2b-49bc-ac40-2a40b299bbf9'] },
  { key: 'notion_3m', name: 'Notion Business 3 Meses · En tu cuenta', ids: ['notion_Bussines_code3m', 'bunny:38'] },
  { key: 'zoom_1m', name: 'Zoom Pro 1 Mes · Cuenta lista', ids: ['d176cebe-4251-46c0-a384-77eed3ffa59e', 'bunny:32'] },
  { key: 'ilovepdf_12', name: 'iLovePDF Premium 12 Meses', ids: ['ilove_pdf_12m', 'bunny:35'] },
  // ---- VPN ----
  { key: 'nord_3m', name: 'NordVPN 3 Meses · Cuenta lista', ids: ['nordvpn_shared_3m'] },
  { key: 'surfshark_2m', name: 'Surfshark VPN 2 Meses · Cuenta lista', ids: ['vpn_Surfshark_60d', 'bunny:90'] },
];

// Orden de "Más vendidos" mientras no haya ventas propias (las ventas reales van primero)
export const TOP_ORDER = ['gpt_eco', 'gemini_plus_12', 'capcut_1m', 'canva_3y', 'spotify_3m', 'disney_espn', 'youtube_1m', 'prime_6m', 'muse_1b', 'max_std'];

const slotOf = new Map();
WINNERS.forEach((w) => w.ids.forEach((id) => slotOf.set(id, w)));
export const winnerSlot = (id) => slotOf.get(id) || null;
export const winnersMode = () => s('catalog_mode') !== 'all';

// De la lista visible (ya sin ocultos), deja una oferta por ranura (la más barata con stock)
// y añade los destacados ⭐ que no estén en ninguna ranura.
export function curate(list, { priceOf, isFeatured }) {
  const byId = new Map(list.map((p) => [p.id, p]));
  const out = [];
  for (const w of WINNERS) {
    const offers = w.ids.map((id) => byId.get(id)).filter((p) => p && p.stock > 0);
    if (!offers.length) continue;
    offers.sort((a, b) => priceOf(a) - priceOf(b) || b.stock - a.stock);
    out.push({ ...offers[0], name: w.name, slot: w.key, offers: offers.length });
  }
  for (const p of list) if (!slotOf.has(p.id) && isFeatured(p.id)) out.push(p);
  return out;
}
