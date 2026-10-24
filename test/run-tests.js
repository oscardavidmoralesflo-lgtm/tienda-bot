// Pruebas del motor de pedidos contra el KOKORO simulado.  Uso: npm test
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { startMock } from './mock-kokoro.js';

process.env.KOKORO_BASE_URL = 'http://localhost:4010';
process.env.KOKORO_API_TOKEN = 'sk_test';
process.env.DATABASE_URL = '';
process.env.PUBLIC_URL = '';
process.chdir(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
rmSync('./data', { recursive: true, force: true });

const mock = await startMock(4010);
const { initDb, one } = await import('../src/db.js');
const { loadSettings, saveSettings } = await import('../src/settings.js');
const pricing = await import('../src/pricing.js');
const users = await import('../src/users.js');
const orders = await import('../src/orders.js');
const { kokoro } = await import('../src/kokoro.js');

await initDb();
await loadSettings();
await pricing.loadOverrides();
const sent = [];
orders.setNotifier({ user: async (id, t) => sent.push([id, t]), admins: async (t) => sent.push(['admin', t]) });

let pass = 0;
const test = async (name, fn) => { await fn(); pass++; console.log('  ✓', name); };

await test('precios con margen 20% y descuento por volumen', async () => {
  const [netflix] = await kokoro.products();
  assert.equal(pricing.productUnitPrice(netflix), 3.6);
  assert.equal(pricing.productUnitPrice(netflix, 5), 3); // 2.5 * 1.2
  await pricing.saveOverride('netflix_1m', 'product', 'Netflix', { fixed_price: '4' });
  assert.equal(pricing.productUnitPrice(netflix), 4);
  assert.equal(pricing.productUnitPrice(netflix, 5), 3.33);
  await pricing.saveOverride('netflix_1m', 'product', 'Netflix', {});
  assert.equal(pricing.productUnitPrice(netflix), 3.6);
});

await users.upsertUser({ id: 111, first_name: 'Ana' });
await users.upsertUser({ id: 222, first_name: 'Beto' }, 111); // invitado por Ana
await test('referido guardado', async () => assert.equal((await users.getUser(222)).referred_by, 111));

await test('saldo insuficiente no cobra', async () => {
  const p = (await kokoro.products()).find((x) => x.id === 'netflix_1m');
  const r = await orders.buyProduct({ userId: 222, product: p, quantity: 1, unitPrice: 3.6 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'balance');
  assert.equal((await users.getUser(222)).balance, 0);
});

await users.credit(222, 20, 'recharge', 'test');
await test('compra de producto entregada, cobra y paga comisión al referido', async () => {
  const p = (await kokoro.products()).find((x) => x.id === 'netflix_1m');
  const r = await orders.buyProduct({ userId: 222, product: { ...p, _unitCost: 3 }, quantity: 2, unitPrice: 3.6 });
  assert.equal(r.ok, true);
  assert.equal(r.order.status, 'delivered');
  assert.match(r.order.delivery, /user0@mail.com:pass0\nuser1@mail.com:pass1/);
  assert.equal((await users.getUser(222)).balance, 12.8);
  assert.equal((await users.getUser(111)).balance, 0.36); // 5% de 7.20
  assert.equal(pricing.round2(Number(r.order.price) - Number(r.order.cost)), 1.2);
});

await test('error de la API (falta dato de activación) => reembolso', async () => {
  const p = (await kokoro.products()).find((x) => x.id === 'duo_plus');
  const r = await orders.buyProduct({ userId: 222, product: p, quantity: 1, unitPrice: 1.44 });
  assert.equal(r.ok, false);
  assert.equal(r.order.status, 'refunded');
  assert.equal((await users.getUser(222)).balance, 12.8);
});

await test('KOKORO sin saldo (402) => reembolso al cliente y alerta al admin', async () => {
  await users.credit(222, 1000, 'recharge', 'test');
  const p = (await kokoro.products()).find((x) => x.id === 'caro');
  const r = await orders.buyProduct({ userId: 222, product: p, quantity: 1, unitPrice: 600 });
  assert.equal(r.ok, false);
  assert.equal((await users.getUser(222)).balance, 1012.8);
  assert.ok(sent.some(([to, t]) => to === 'admin' && t.includes('Venta perdida')));
});

const g = await kokoro.gamePacks('topup:free-fire');
const pack = g.products[0];
await test('recarga de juego: en proceso y luego entregada por el verificador', async () => {
  const r = await orders.buyGamePack({ userId: 222, pack, game: g.game, unitPrice: pricing.packPrice(pack, g.game.id), fields: { player_id: '12345' } });
  assert.equal(r.ok, true);
  assert.equal(r.order.status, 'processing');
  assert.equal(pricing.packPrice(pack, g.game.id), 0.86); // 0.74 * 1.15 redondeado arriba
  await new Promise((res) => setTimeout(res, 2500));
  await orders.pollOpenOrders(); // aún <90s, el pending se salta pero processing no
  const o = await one('SELECT * FROM orders WHERE id=$1', [r.order.id]);
  assert.equal(o.status, 'delivered');
  assert.ok(sent.some(([to, t]) => to === 222 && t.includes(`Pedido #${o.id} entregado`)));
});

await test('recarga rechazada por el proveedor => reembolso automático', async () => {
  const before = (await users.getUser(222)).balance;
  const r = await orders.buyGamePack({ userId: 222, pack, game: g.game, unitPrice: 0.86, fields: { player_id: '999' } });
  assert.equal((await users.getUser(222)).balance, Math.round((before - 0.86) * 100) / 100);
  await new Promise((res) => setTimeout(res, 2500));
  await orders.refreshOrder(await one('SELECT * FROM orders WHERE id=$1', [r.order.id]));
  assert.equal((await users.getUser(222)).balance, before);
  // un segundo reembolso no debe sumar dos veces
  await orders.refundOrder(r.order.id, 'x');
  assert.equal((await users.getUser(222)).balance, before);
});

await test('el precio subió en KOKORO => no compra y reembolsa', async () => {
  const before = (await users.getUser(222)).balance;
  const r = await orders.buyGamePack({ userId: 222, pack: { ...pack, price: 0.5 }, game: g.game, unitPrice: 0.6, fields: { player_id: '1' } });
  assert.equal(r.ok, false);
  assert.match(r.message, /precio cambió/);
  assert.equal((await users.getUser(222)).balance, before);
});

await test('compras simultáneas no dejan saldo negativo', async () => {
  await users.upsertUser({ id: 333, first_name: 'Caro' });
  await users.credit(333, 4, 'recharge', 'test');
  const p = (await kokoro.products()).find((x) => x.id === 'netflix_1m');
  const rs = await Promise.all([1, 2, 3].map(() => orders.buyProduct({ userId: 333, product: p, quantity: 1, unitPrice: 3.6 })));
  assert.equal(rs.filter((r) => r.ok).length, 1);
  assert.ok((await users.getUser(333)).balance >= 0);
});

await test('ajustes guardados', async () => {
  await saveSettings({ markup_products: '30' });
  const [netflix] = await kokoro.products();
  assert.equal(pricing.productUnitPrice(netflix), 3.9);
});

console.log(`\n${pass} pruebas OK`);
mock.close();
process.exit(0);
