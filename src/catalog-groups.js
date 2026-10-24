// Productos equivalentes entre proveedores. En cada grupo el bot muestra UNA sola opción:
// la más barata que tenga stock (si se agota, pasa sola a la siguiente).
// "name" es el nombre que verá el cliente. IDs de Bunny con prefijo "bunny:".
// Revisado el 2026-10-24 comparando los catálogos de KOKORO y Bunny.
export const GROUPS = [
  { name: 'Gemini AI PRO 18 Meses', items: ['bunny:57', 'gemini_pro_18m'] },
  { name: 'Spotify Premium 3 Meses', items: ['bunny:11', 'code_spotify_90d'] },
  { name: 'Super Duolingo 12 Meses', items: ['bunny:12', 'super_duolingo_12m', 'cf3a4cc4-8df7-4d15-bbe4-1836bec1c0da'] },
  { name: 'Zoom Pro 1 Mes', items: ['bunny:32', 'd176cebe-4251-46c0-a384-77eed3ffa59e'] },
  { name: 'ElevenLabs 1M Créditos 1 Mes', items: ['bunny:82', '01316437-5e32-4e04-b4dc-497144fd7c96'] },
  { name: 'iLovePDF Premium 1 Año', items: ['bunny:35', 'ilove_pdf_12m'] },
  { name: 'Apple Music 5 Meses (Link)', items: ['bunny:36', 'apple_music_link_5m'] },
  { name: 'Notion Business 3 Meses (Código)', items: ['bunny:38', 'notion_Bussines_code3m'] },
  { name: 'LinkedIn Career 3 Meses', items: ['bunny:40', 'linkedin_career_3m'] },
  { name: 'Prime Video 6 Meses', items: ['bunny:41', 'prime_video_6m'] },
  { name: 'Crunchyroll 1 Mes (Link)', items: ['bunny:45', 'crunchyroll_link_30days'] },
  { name: 'NordVPN 3 Meses (Link)', items: ['bunny:85', 'b43c40c1-6130-429b-9b9f-759650ade50d'] },
  { name: 'Windows 10/11 Pro Key', items: ['bunny:56', 'be5b54d4-4f2b-49bc-ac40-2a40b299bbf9'] },
  { name: 'Coursera Premium 12 Meses', items: ['bunny:59', '1cb47ba8-de93-42c6-9a09-b662c59b076d', '12'] },
  { name: 'YouTube Premium 3 Meses (Link)', items: ['bunny:64', 'youtube_premium_3m'] },
  { name: 'CapCut Pro Team 1 Mes', items: ['bunny:83', 'capcut_pro_team'] },
  { name: 'ChatGPT Plus 1 Mes (Sin garantía)', items: ['bunny:84', '2'] },
  { name: 'Cuentas Hotmail', items: ['bunny:2', 'hotmail-account'] },
  { name: 'Cuentas Outlook', items: ['bunny:29', 'outlook-accounts'] },
  { name: 'Muse AI 1 Billón de Tokens', items: ['bunny:31', '630d58eb-7cd1-4707-a411-734a3e4ee08a'] },
  { name: 'Canva Pro Edu (Invitación)', items: ['bunny:50', 'canva_team_invite_pro'] },
  { name: 'API Claude 10M Tokens', items: ['bunny:65', 'w4_6a22db2d0f516979ef98b1c0'] },
  { name: 'API Claude 50M Tokens', items: ['bunny:66', 'w4_6a3601a2718150c401005ff3'] },
  { name: 'API Claude 100M Tokens', items: ['bunny:67', 'w4_6a22dc740f516979ef98de98'] },
  { name: 'API Claude 500M Tokens', items: ['bunny:68', '62'] },
  { name: 'API Codex 10M Tokens', items: ['bunny:15', 'w4_6a4803a09ad6f6fd40a49ab8'] },
  { name: 'API Codex 50M Tokens', items: ['bunny:60', 'w4_6a4804849ad6f6fd40a4b833'] },
  { name: 'API Codex 100M Tokens', items: ['bunny:61', 'w4_6a4804d49ad6f6fd40a4c369'] },
];

// Productos que nunca se muestran a clientes (pruebas o servicios internos)
export const ALWAYS_HIDDEN = ['prueba_bot', 'bot_kokoro'];
