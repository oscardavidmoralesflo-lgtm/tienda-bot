// Abre el panel de admin con datos de prueba (sin Telegram ni KOKORO real).  Uso: node test/preview-admin.js
import express from 'express';
import { rmSync } from 'node:fs';
import { startMock } from './mock-kokoro.js';

Object.assign(process.env, {
  KOKORO_BASE_URL: 'http://localhost:4010', KOKORO_API_TOKEN: 'sk_test', DATABASE_URL: '', PUBLIC_URL: '',
  ADMIN_PASSWORD: 'demo1234', SESSION_SECRET: 'preview', BOT_TOKEN: 'x', ADMIN_IDS: '999',
});
process.chdir(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
rmSync('./data', { recursive: true, force: true });
await startMock(4010);

const { initDb, query } = await import('../src/db.js');
const { loadSettings } = await import('../src/settings.js');
const { loadOverrides } = await import('../src/pricing.js');
const users = await import('../src/users.js');
const orders = await import('../src/orders.js');
const { kokoro } = await import('../src/kokoro.js');
const { adminRouter } = await import('../src/web/admin.js');
await initDb(); await loadSettings(); await loadOverrides();

const log = async (...a) => { console.log('[aviso]', ...a); return true; };
orders.setNotifier({ user: log, admins: log });
const fakeBot = { notify: { user: log, admins: log }, api: { getFile: async () => { throw new Error('sin telegram'); } } };
fakeBot.handleRecharge = async (id, approve, by, amount) => {
  const { one } = await import('../src/db.js');
  const r = await one(`UPDATE recharges SET status=$2, handled_by=$3, handled_at=now(), amount=COALESCE($4,amount) WHERE id=$1 AND status='pending' RETURNING *`, [id, approve ? 'approved' : 'rejected', by, amount ?? null]);
  if (!r) return { ok: false, error: 'Ya fue procesada' };
  if (approve) await users.credit(r.user_id, Number(r.amount), 'recharge', `Recarga #${r.id}`);
  return { ok: true };
};

// datos de ejemplo
await users.upsertUser({ id: 5001, first_name: 'Ana', username: 'ana_gamer' });
await users.upsertUser({ id: 5002, first_name: 'Luis', username: 'luis99' }, 5001);
await users.credit(5002, 25, 'recharge', 'Recarga #0');
const [p] = await kokoro.products();
await orders.buyProduct({ userId: 5002, product: { ...p, _unitCost: 3 }, quantity: 1, unitPrice: 3.6 });
const g = await kokoro.gamePacks('topup:free-fire');
await orders.buyGamePack({ userId: 5002, pack: g.products[0], game: g.game, unitPrice: 0.86, fields: { player_id: '12345' } });
await query("INSERT INTO recharges (user_id, amount, proof_type) VALUES (5001, 10, 'photo')");

const app = express();
app.use('/admin', adminRouter(fakeBot));
app.listen(3999, () => console.log('Panel de prueba: http://localhost:3999/admin  (contraseña: demo1234)'));
