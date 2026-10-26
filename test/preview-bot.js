// Simula conversaciones con el bot SIN Telegram: usa el catálogo real (solo lectura) y una base local,
// captura lo que el bot respondería y genera test/bot-preview.html para verlo como un chat.
// Uso: node test/preview-bot.js
import { writeFileSync, rmSync } from 'node:fs';

process.chdir(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
await import('dotenv/config');
Object.assign(process.env, { DATABASE_URL: '', PUBLIC_URL: '', BOT_TOKEN: '1:preview', ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'x' });
rmSync('./data', { recursive: true, force: true });
process.env.DOTENV_CONFIG_PATH = '../.env';
const dotenv = await import('dotenv');
const real = dotenv.config({ path: '../.env' }).parsed || {};
process.env.KOKORO_API_TOKEN = real.KOKORO_API_TOKEN;
process.env.BUNNY_API_KEY = real.BUNNY_API_KEY;

const { initDb } = await import('../src/db.js');
const { loadSettings, saveSettings } = await import('../src/settings.js');
const { loadOverrides } = await import('../src/pricing.js');
const { updateFx, warmUp } = await import('../src/refresher.js');
const { createBot } = await import('../src/bot/index.js');
const users = await import('../src/users.js');
await initDb();
await loadSettings();
await saveSettings({ support_contact: '@soporte_tienda', channel_url: 'https://t.me/tu_canal' });
await loadOverrides();
await updateFx(true);
await warmUp();

const screens = [];
let msgId = 100;
const bot = createBot();
bot.api.config.use(async (prev, method, payload) => {
  if (method === 'getMe') return { ok: true, result: { id: 1, is_bot: true, first_name: 'Mi Tienda Digital', username: 'MiTiendaDigital2847_bot' } };
  if (['sendMessage', 'editMessageText', 'sendPhoto'].includes(method)) {
    screens.push({ method, text: payload.text || payload.caption || '', kb: payload.reply_markup?.inline_keyboard || [] });
    return { ok: true, result: { message_id: ++msgId, date: 0, chat: { id: 7, type: 'private' }, text: payload.text } };
  }
  return { ok: true, result: true };
});
await bot.init();

const from = { id: 7, is_bot: false, first_name: 'Laura', username: 'laura_co' };
let uid = 1;
const send = (text) => bot.handleUpdate({ update_id: uid++, message: { message_id: uid, date: 0, chat: { id: 7, type: 'private' }, from, text, ...(text.startsWith('/') ? { entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }] } : {}) } });
const tap = (data) => bot.handleUpdate({ update_id: uid++, callback_query: { id: String(uid), from, chat_instance: '1', data, message: { message_id: 50, date: 0, chat: { id: 7, type: 'private' }, text: 'x' } } });
const label = (t) => screens.push({ label: t });

await users.upsertUser(from);
await users.credit(7, 12.5, 'recharge', 'demo');
label('/start → menú principal'); await send('/start');
label('🛍 Tienda'); await tap('st');
label('🤖 Categoría IA'); await tap('c:ai:0');
const firstProduct = screens.at(-1).kb[0][0].callback_data;
label('Ficha de producto'); await tap(firstProduct);
const buyBtn = screens.at(-1).kb.flat().find((b) => b.callback_data.startsWith('pq:')).callback_data;
label('🛒 Comprar ahora → confirmación'); await tap(buyBtn);
label('🎮 Juegos y Gift Cards'); await tap('g:topup:0');
label('Free Fire'); await tap('gg:topup:free-fire');
label('👤 Mi perfil'); await tap('pf');
label('💰 Recargar saldo'); await tap('recharge');
label('Elegir 10 USDT'); await tap('amt:10');
label('🔎 Búsqueda escribiendo "gemini"'); await send('gemini');
label('🎁 Invita y gana'); await tap('ref');

// --- HTML tipo Telegram ---
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const tg = (html) => esc(html)
  .replace(/&lt;(\/?)(b|i|u|s|code|pre|blockquote)&gt;/g, '<$1$2>')
  .replace(/&lt;a href=&quot;(.*?)&quot;&gt;/g, '<a href="$1">').replace(/&lt;\/a&gt;/g, '</a>')
  .replace(/\n/g, '<br>');
const body = screens.map((sc) => sc.label
  ? `<div class="label">${esc(sc.label)}</div>`
  : `<div class="msg"><div class="bubble">${tg(sc.text)}</div>${sc.kb.map((row) => `<div class="row">${row.map((b) => `<span class="btn">${esc(b.text)}</span>`).join('')}</div>`).join('')}</div>`).join('');
writeFileSync('bot-preview.html', `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vista previa del bot</title>
<style>body{margin:0;background:#0e1621 url() ;font:15px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#fff}.wrap{max-width:430px;margin:0 auto;padding:16px}
.label{margin:22px 0 8px;text-align:center}.label{color:#8b9bb0;font-size:12px;text-transform:uppercase;letter-spacing:.06em}
.bubble{background:#182533;border-radius:14px 14px 14px 4px;padding:9px 12px;white-space:normal;word-wrap:break-word}
.bubble code,.bubble pre{background:#0f1a24;border-radius:4px;padding:1px 4px;font-family:ui-monospace,Consolas,monospace;font-size:13px;color:#7fd1ff}
.row{display:flex;gap:4px;margin-top:4px}.btn{flex:1;text-align:center;background:rgba(43,82,120,.55);border-radius:8px;padding:8px 4px;font-size:13px;color:#fff}
a{color:#6ab3f3}blockquote{margin:6px 0;padding:4px 10px;border-left:3px solid #6ab3f3;background:rgba(106,179,243,.08);border-radius:4px}</style><div class="wrap">${body}</div>`);
console.log(`OK: ${screens.filter((s) => !s.label).length} pantallas → test/bot-preview.html`);
process.exit(0);
