import express from 'express';
import crypto from 'node:crypto';
import { webhookCallback } from 'grammy';
import { config, checkConfig } from './config.js';
import { initDb } from './db.js';
import { loadSettings } from './settings.js';
import { loadOverrides } from './pricing.js';
import { verifyWebhook } from './kokoro.js';
import { handleWebhook, pollOpenOrders } from './orders.js';
import { createBot, setupCommands } from './bot/index.js';
import { adminRouter } from './web/admin.js';
import { warmUp, startRefresher } from './refresher.js';

const missing = checkConfig();
if (missing.length) {
  console.error(`❌ Faltan variables de entorno: ${missing.join(', ')}. Revisa el archivo .env (copia .env.example).`);
  process.exit(1);
}

const dbKind = await initDb();
await loadSettings();
await loadOverrides();
console.log(`✅ Base de datos: ${dbKind === 'local' ? 'local (./data)' : 'PostgreSQL'}`);

const bot = createBot();
await bot.init();
console.log(`✅ Bot: @${bot.botInfo.username}`);
await setupCommands(bot).catch((e) => console.error('setMyCommands', e.message));

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.get('/', (req, res) => res.redirect('/admin'));
app.get('/health', (req, res) => res.json({ ok: true }));

// Webhook de KOKORO (avisos de pedidos entregados / reembolsados / que piden código)
app.post('/kokoro/webhook', express.text({ type: '*/*', limit: '1mb' }), async (req, res) => {
  const raw = typeof req.body === 'string' ? req.body : '';
  if (!verifyWebhook(raw, req.get('X-Kokoro-Timestamp'), req.get('X-Kokoro-Signature'))) {
    return res.status(401).json({ ok: false });
  }
  res.json({ ok: true });
  try {
    await handleWebhook(JSON.parse(raw));
  } catch (e) {
    console.error('webhook KOKORO', e.message);
  }
});

app.use('/admin', adminRouter(bot));

// Telegram: webhook si hay URL pública (Render), si no, long polling (tu PC)
const hookSecret = crypto.createHash('sha256').update(`hook:${config.botToken}`).digest('hex').slice(0, 32);
if (config.publicUrl) {
  app.post(`/tg/${hookSecret}`, express.json({ limit: '2mb' }), webhookCallback(bot, 'express', { timeoutMilliseconds: 8_000, onTimeout: 'return' }));
}

app.use((err, req, res, next) => {
  console.error('HTTP', err);
  res.status(500).send('Error interno');
});

app.listen(config.port, async () => {
  console.log(`✅ Panel admin: ${config.publicUrl || `http://localhost:${config.port}`}/admin`);
  if (config.publicUrl) {
    await bot.api.setWebhook(`${config.publicUrl}/tg/${hookSecret}`, { drop_pending_updates: false, allowed_updates: ['message', 'callback_query'] });
    console.log('✅ Webhook de Telegram configurado');
  } else {
    await bot.api.deleteWebhook();
    bot.start({ allowed_updates: ['message', 'callback_query'], onStart: () => console.log('✅ Bot escuchando (modo local)') });
  }
});

// Precios y stock: carga inicial y refresco cada 3 minutos
warmUp().catch((e) => console.error('warmUp', e.message));
startRefresher();

// Revisa pedidos abiertos cada 45 s
setInterval(() => pollOpenOrders().catch((e) => console.error('poll', e.message)), 45_000);

const stop = async () => {
  if (!config.publicUrl) await bot.stop().catch(() => {});
  process.exit(0);
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
