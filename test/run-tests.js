// Pruebas del motor de pedidos contra el KOKORO simulado.  Uso: npm test
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { startMock } from './mock-kokoro.js';

process.env.KOKORO_BASE_URL = 'http://localhost:4010';
process.env.KOKORO_API_TOKEN = 'sk_test';
process.env.DATABASE_URL = '';
process.env.PUBLIC_URL = '';
process.env.BUNNY_API_KEY = 'bn_test';
process.env.BUNNY_BASE_URL = 'http://localhost:4010/bunny/api/v1';
process.env.BOLD_API_KEY = 'bold_test';
process.env.BOLD_SECRET_KEY = 'bold_secret_test';
process.env.BOLD_BASE_URL = 'http://localhost:4010/bold';
process.env.BOT_TOKEN = '1:test';
process.env.BINANCE_API_KEY = 'bnkey_test';
process.env.BINANCE_API_SECRET = 'bnsecret_test';
process.env.BINANCE_BASE_URL = 'http://localhost:4010/binance';
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
// las pruebas de cobros usan un margen fijo simple (20 % / 15 %); los tramos se prueban al final
await saveSettings({ price_tiers_products: '', price_tiers_games: '', min_profit_products: '0', min_profit_games: '0' });
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

const catalog = await import('../src/catalog.js');
await test('catálogo unificado: gana el más barato con stock y sin duplicados', async () => {
  const list = await catalog.products();
  const ids = list.map((p) => p.id);
  assert.ok(ids.includes('bunny:57'));            // Gemini en Bunny (1.50) le gana a KOKORO (2.50)
  assert.ok(!ids.includes('gemini_pro_18m'));
  assert.equal(list.find((p) => p.id === 'bunny:57').name, 'Gemini AI PRO 18 Meses');
  assert.ok(ids.includes('code_spotify_90d'));    // Spotify en Bunny está agotado -> KOKORO
  assert.ok(!ids.includes('bunny:11'));
  assert.ok(!ids.includes('prueba_bot'));         // productos internos ocultos
  assert.equal(list.find((p) => p.id === 'bunny:65').stock, 999); // stock ilimitado
  assert.equal(new Set(list.map((p) => p.name)).size, list.length);
});

await test('compra en Bunny: entrega el link con garantía y registra costo', async () => {
  await users.upsertUser({ id: 444, first_name: 'Dani' });
  await users.credit(444, 10, 'recharge', 'test');
  const p = await catalog.findProduct('bunny:57');
  const r = await orders.buyProduct({ userId: 444, product: { ...p, name: 'Gemini AI PRO 18 Meses' }, quantity: 1, unitPrice: pricing.productUnitPrice(p) });
  assert.equal(r.ok, true);
  assert.equal(r.order.status, 'delivered');
  assert.equal(r.order.kind, 'bunny');
  assert.match(r.order.delivery, /gemini\.link\/abc[\s\S]*Garantía: 30 days/);
  assert.equal(Number(r.order.cost), 1.5);
  assert.equal(Number(r.order.price), 1.8);
});

await test('Bunny sin respuesta: no reembolsa solo, avisa al admin y se entrega manual', async () => {
  const before = (await users.getUser(444)).balance;
  const p = await catalog.findProduct('bunny:99');
  const r = await orders.buyProduct({ userId: 444, product: p, quantity: 1, unitPrice: 1.2 });
  assert.equal(r.order.status, 'processing');
  assert.equal((await users.getUser(444)).balance, pricing.round2(before - 1.2));
  assert.ok(sent.some(([to, t]) => to === 'admin' && t.includes('sin respuesta clara')));
  await orders.pollOpenOrders(); // no debe tocar pedidos de Bunny
  const d = await orders.deliverManually(r.order.id, 'cuenta: x@y.com');
  assert.equal(d.status, 'delivered');
  assert.ok(sent.some(([to, t]) => to === 444 && t.includes('cuenta: x@y.com')));
});

await test('ajustes guardados', async () => {
  await saveSettings({ markup_products: '30' });
  const [netflix] = await kokoro.products();
  assert.equal(pricing.productUnitPrice(netflix), 3.9);
});

await test('margen por tramos + ganancia mínima por pedido + precio en COP', async () => {
  await saveSettings({ price_tiers_products: '1:60,3:40,10:30,30:20,*:12', min_profit_products: '0.20', price_tiers_games: '5:20,20:12,*:8', min_profit_games: '0.10', cop_rate: '4100', price_display: 'usd' });
  const p = (c, extra = {}) => ({ id: 'x' + c, price: c, bulk_discounts: [], ...extra });
  assert.equal(pricing.productUnitPrice(p(0.04)), 0.24);        // barato: manda la ganancia mínima (0.04 + 0.20)
  assert.equal(pricing.productUnitPrice(p(0.04), 10), 0.07);    // por volumen la mínima se reparte: 0.04 + 0.02 → 60 % = 0.07
  assert.equal(pricing.productUnitPrice(p(1.5)), 2.1);          // hasta 3 USD: 40 %
  assert.equal(pricing.productUnitPrice(p(8)), 10.4);           // hasta 10 USD: 30 %
  assert.equal(pricing.productUnitPrice(p(124.76)), 139.74);    // caro: 12 %
  assert.equal(pricing.packPrice({ id: 'pk', price: 0.74 }, 'g'), 0.89); // recarga barata: 20 %
  assert.equal(pricing.packPrice({ id: 'pk2', price: 38 }, 'g'), 41.04); // recarga cara: 8 %
  assert.equal(pricing.cop(2.1), '8.700 COP');
  await saveSettings({ cop_rate: '0' });
  assert.equal(pricing.copSuffix(2.1), '');
});

await test('precios en pesos redondos: lo que se muestra es exactamente lo que se cobra', async () => {
  await saveSettings({ cop_rate: '3276', price_display: 'cop' });
  assert.equal(pricing.cleanCop(5209), 5400);
  assert.equal(pricing.cleanCop(23423), 23900);
  assert.equal(pricing.cleanCop(2621), 2700);
  assert.equal(pricing.cleanCop(9140), 9400);
  const p = { id: 'cp1', price: 0.99, bulk_discounts: [] }; // Gemini 18 meses
  const usd = pricing.productUnitPrice(p);
  assert.equal(pricing.fmtS(usd), '$5.400');
  assert.equal(pricing.fmt(usd), '$5.400 COP');
  assert.equal(Math.round(pricing.round4(usd * 3) * 3276), 16200); // 3 unidades = 16.200 exactos
  // el cliente con saldo de 5.400 puede pagarlo
  await users.upsertUser({ id: 555, first_name: 'Cop' });
  await users.credit(555, usd, 'recharge', 'test');
  const prod = (await kokoro.products()).find((x) => x.id === 'netflix_1m');
  const unit = pricing.productUnitPrice(prod);
  assert.ok(pricing.fmtS(unit).endsWith('00'));
  await saveSettings({ cop_rate: '0', price_display: 'cop' });
  assert.equal(pricing.fmt(1.5), '1.50 USDT'); // sin tasa vuelve a USDT
});

await test('caché: responde al instante con dato viejo y refresca en segundo plano', async () => {
  const cache = await import('../src/cache.js');
  let calls = 0;
  const slow = () => new Promise((r) => setTimeout(() => r(++calls), 300));
  assert.equal(await cache.swr('t:x', slow, 1), 1);           // primera vez espera
  await new Promise((r) => setTimeout(r, 5));                  // ya venció (ttl 1 ms)
  const t = Date.now();
  assert.equal(await cache.swr('t:x', slow, 1), 1);           // devuelve el viejo sin esperar
  assert.ok(Date.now() - t < 50);
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(await cache.swr('t:x', slow, 60_000), 2);      // ya quedó el nuevo
  const r = await cache.refreshAll({ always: ['t:x'] });
  assert.ok(r.ok >= 1);
});

await test('categorías de la tienda y productos prohibidos ocultos', async () => {
  const { categoryOf } = await import('../src/categories.js');
  assert.equal(categoryOf('Gemini AI PRO 18 Meses').key, 'ai');
  assert.equal(categoryOf('Coursera 12M+ Gemini PRO 3M').key, 'edu');
  assert.equal(categoryOf('API Claude 10M Tokens').key, 'api');
  assert.equal(categoryOf('YouTube Premium 3 Meses (Link)').key, 'stream');
  assert.equal(categoryOf('GitHub Accounts — 1 Month+ Old').key, 'mail');
  assert.equal(categoryOf('GitHub Pro + Student 2 Year').key, 'dev');
  assert.equal(categoryOf('Windows 10/11 Pro Key').key, 'office');
  const { ALWAYS_HIDDEN } = await import('../src/catalog-groups.js');
  assert.ok(ALWAYS_HIDDEN.includes('links_shops_ccs') && ALWAYS_HIDDEN.includes('method_capcut'));
});

await test('ñapa por nivel y recordatorio de renovación', async () => {
  const { query: q } = await import('../src/db.js');
  await users.upsertUser({ id: 777, first_name: 'Fiel' });
  await users.credit(777, 100, 'recharge', 'test');
  const p = (await kokoro.products()).find((x) => x.id === 'netflix_1m');
  // compra 1: 15 USD acumulados → Plata (1 %)
  const r1 = await orders.buyProduct({ userId: 777, product: { ...p, name: 'Netflix 1 Mes', _unitCost: 3 }, quantity: 1, unitPrice: 15 });
  assert.equal(r1.order.status, 'delivered');
  const cb = await one("SELECT * FROM transactions WHERE user_id=777 AND type='cashback'");
  assert.equal(Number(cb.amount), 0.15);
  assert.ok(sent.some(([to, t]) => to === 777 && t.includes('ñapa')));
  // renovación programada a 30 - 3 = 27 días
  const o = await one('SELECT renew_at FROM orders WHERE id=$1', [r1.order.id]);
  const days = (new Date(o.renew_at) - Date.now()) / 86400000;
  assert.ok(days > 26.9 && days < 27.1);
  // al vencer se envía el recordatorio una sola vez
  await q("UPDATE orders SET renew_at = now() - interval '1 minute' WHERE id=$1", [r1.order.id]);
  assert.equal(await orders.sendRenewals(), 1);
  assert.equal(await orders.sendRenewals(), 0);
  assert.ok(sent.some(([to, t]) => to === 777 && t.includes('vence en')));
});

await test('bilingüe: mismas claves, textos usados existen y avisos en inglés', async () => {
  const fs = await import('node:fs');
  const { DICT, t, localName } = await import('../src/i18n.js');
  const es = Object.keys(DICT.es).sort();
  const en = Object.keys(DICT.en).sort();
  assert.deepEqual(en, es);
  // toda clave fija usada en el código existe en el diccionario
  const code = ['src/bot/index.js', 'src/bot/shop.js', 'src/orders.js', 'src/bot/ui.js', 'src/web/admin.js']
    .map((f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')).join('\n');
  const used = [...code.matchAll(/\bt\((?:ctx\.lang|lang|ul|rl|'es'|'en'|await userLang\([^)]*\)), '([a-z_0-9]+)'/g), ...code.matchAll(/\bT\(ctx, '([a-z_0-9]+)'/g)].map((m) => m[1]);
  const missing = [...new Set(used)].filter((k) => !(k in DICT.es));
  assert.deepEqual(missing, []);
  assert.equal(t('en', 'p_price', { p: '$5.400 COP' }), '💵 Price: <b>$5.400 COP</b>');
  assert.equal(localName('Gemini AI PRO 18 Meses', 'en'), 'Gemini AI PRO 18 Months');
  // un cliente en inglés recibe sus avisos en inglés
  const { query: q } = await import('../src/db.js');
  await users.upsertUser({ id: 888, first_name: 'John' });
  await q("UPDATE users SET lang='en' WHERE id=888");
  await users.credit(888, 50, 'recharge', 'test');
  const p = (await kokoro.products()).find((x) => x.id === 'netflix_1m');
  await orders.buyProduct({ userId: 888, product: { ...p, name: 'Netflix 1 Mes', _unitCost: 3 }, quantity: 1, unitPrice: 12 });
  assert.ok(sent.some(([to, m]) => to === 888 && m.includes('Your cashback')));
});

await test('bono por recarga grande', async () => {
  const { rechargeBonusPct } = await import('../src/bot/index.js');
  await saveSettings({ recharge_bonus: '100000:3,200000:5' });
  assert.equal(rechargeBonusPct(50000), 0);
  assert.equal(rechargeBonusPct(100000), 3);
  assert.equal(rechargeBonusPct(250000), 5);
});

await test('Bold: recarga en línea se acredita sola (con bono), sin duplicados y con firma válida', async () => {
  const crypto = await import('node:crypto');
  const { verifyBoldSignature } = await import('../src/bold.js');
  const { createBot } = await import('../src/bot/index.js');
  await saveSettings({ cop_rate: '4000', price_display: 'cop', recharge_bonus: '100000:3,200000:5', bold_surcharge: '3.5', bold_enabled: '1' });
  // bot real con la API de Telegram interceptada
  const out = [];
  const bot = createBot();
  bot.api.config.use(async (prev, method, payload) => {
    if (method === 'getMe') return { ok: true, result: { id: 1, is_bot: true, first_name: 'Nova Plus', username: 'NovaPlusTestBot' } };
    if (['sendMessage', 'editMessageText'].includes(method)) out.push({ to: payload.chat_id, text: payload.text, kb: payload.reply_markup?.inline_keyboard || [] });
    return { ok: true, result: { message_id: 1, date: 0, chat: { id: payload.chat_id || 1, type: 'private' }, text: payload.text } };
  });
  await bot.init();
  const from = { id: 4242, is_bot: false, first_name: 'Ana' };
  const { query: q } = await import('../src/db.js');
  await users.upsertUser(from);
  await q("UPDATE users SET lang='es' WHERE id=4242");
  let uid = 1;
  const tap = (data) => bot.handleUpdate({ update_id: uid++, callback_query: { id: String(uid), from, chat_instance: '1', data, message: { message_id: 5, date: 0, chat: { id: 4242, type: 'private' }, text: 'x' } } });
  await tap('amc:100000');
  assert.ok(out.at(-1).text.includes('¿Cómo quieres pagar?'));
  assert.ok(out.at(-1).kb.flat().some((b) => b.callback_data === 'pon' && b.text.includes('$103.500')));
  await tap('pon');
  const linkMsg = out.at(-1);
  assert.ok(linkMsg.kb.flat().some((b) => b.url === 'https://checkout.bold.co/LNK_TEST1'));
  const r = await one("SELECT * FROM recharges WHERE user_id=4242 AND method='bold'");
  assert.equal(r.status, 'link');
  assert.equal(Number(r.bold_total), 103500);
  // firma del webhook
  const ev = { id: 'evt1', type: 'SALE_APPROVED', data: { payment_method: 'PSE', amount: { currency: 'COP', total: 103500 }, metadata: { reference: r.bold_link } } };
  const raw = JSON.stringify(ev);
  const sig = crypto.createHmac('sha256', 'bold_secret_test').update(Buffer.from(raw).toString('base64')).digest('hex');
  assert.ok(verifyBoldSignature(raw, sig));
  assert.ok(!verifyBoldSignature(raw, sig.replace(/.$/, '0')));
  // pago aprobado → saldo + bono 3 %
  const before = (await users.getUser(4242)).balance;
  await bot.handleBoldEvent(ev);
  const after = (await users.getUser(4242)).balance;
  assert.equal(pricing.round4(after - before), pricing.round4(25 * 1.03)); // 100.000 / 4.000 = 25 USD + 3 %
  assert.ok(out.some((m) => m.to === 4242 && m.text.includes('¡Recarga aprobada!') && m.text.includes('Bono')));
  // Bold reenvía el mismo aviso: no se acredita dos veces
  await bot.handleBoldEvent(ev);
  assert.equal((await users.getUser(4242)).balance, after);
  // respaldo: si el webhook no llega, la verificación periódica lo detecta
  await tap('amc:20000');
  await tap('pon');
  const r2 = await one("SELECT * FROM recharges WHERE user_id=4242 AND method='bold' ORDER BY id DESC LIMIT 1");
  mock.boldLinks.get(r2.bold_link).status = 'PAID';
  await bot.pollBold();
  assert.equal((await one('SELECT status FROM recharges WHERE id=$1', [r2.id])).status, 'approved');
  await saveSettings({ cop_rate: '0' });
});

await test('Binance: el cliente pega el Order ID / TxID y se acredita solo, sin duplicados', async () => {
  const { createBot } = await import('../src/bot/index.js');
  await saveSettings({ cop_rate: '4000', recharge_bonus: '100000:3,200000:5', binance_enabled: '1', binance_pay_id: '123456789', binance_trc20: 'TXyzTRC20addr' });
  const out = [];
  const bot = createBot();
  bot.api.config.use(async (prev, method, payload) => {
    if (method === 'getMe') return { ok: true, result: { id: 1, is_bot: true, first_name: 'Nova Plus', username: 'NovaPlusTestBot' } };
    if (['sendMessage', 'editMessageText'].includes(method)) out.push({ to: payload.chat_id, text: payload.text, kb: payload.reply_markup?.inline_keyboard || [] });
    return { ok: true, result: { message_id: 1, date: 0, chat: { id: payload.chat_id || 1, type: 'private' }, text: payload.text } };
  });
  await bot.init();
  const from = { id: 5151, is_bot: false, first_name: 'Leo' };
  const { query: q } = await import('../src/db.js');
  await users.upsertUser(from);
  await q("UPDATE users SET lang='es' WHERE id=5151");
  let uid = 1000;
  const chat = { id: 5151, type: 'private' };
  const tap = (data) => bot.handleUpdate({ update_id: uid++, callback_query: { id: String(uid), from, chat_instance: '1', data, message: { message_id: 5, date: 0, chat, text: 'x' } } });
  const say = (text) => bot.handleUpdate({ update_id: uid++, message: { message_id: uid, date: 0, chat, from, text, ...(text.startsWith('/') ? { entities: [{ type: 'bot_command', offset: 0, length: text.length }] } : {}) } });
  // menú de recarga → elegir Binance
  await say('/recargar');
  assert.ok(out.at(-1).kb.flat().some((b) => b.callback_data === 'rbn'));
  await tap('rbn');
  assert.ok(out.at(-1).text.includes('123456789') && out.at(-1).text.includes('TXyzTRC20addr'));
  // pago que aún no aparece
  await say('400000111222333');
  assert.ok(out.at(-1).text.includes('Aún no encontramos'));
  // llega el pago de Binance Pay (30 USDT = 120.000 COP → bono 3 %)
  mock.binancePays.push({ transactionId: '400000111222333', amount: '30', currency: 'USDT', payerInfo: { binanceId: 777 } });
  const before = (await users.getUser(5151)).balance;
  await say('400000111222333');
  const after = (await users.getUser(5151)).balance;
  assert.equal(pricing.round4(after - before), pricing.round4(30 * 1.03));
  assert.ok(out.some((m) => m.to === 5151 && m.text.includes('¡Recarga aprobada!')));
  // el mismo ID otra vez: no acredita
  await tap('rbn');
  await say('400000111222333');
  assert.ok(out.at(-1).text.includes('ya fue usado'));
  assert.equal((await users.getUser(5151)).balance, after);
  // un pago enviado (negativo) no cuenta
  mock.binancePays.push({ transactionId: '500000999', amount: '-10', currency: 'USDT' });
  await say('500000999');
  assert.ok(out.at(-1).text.includes('Aún no encontramos'));
  // otra moneda: no acredita y avisa
  mock.binancePays.push({ transactionId: '600000555', amount: '0.01', currency: 'BTC' });
  await say('600000555');
  assert.ok(out.at(-1).text.includes('BTC'));
  // depósito TRC20: pendiente y luego confirmado
  const dep = { txId: 'abc123deftrc20hash', coin: 'USDT', amount: '12', network: 'TRX', status: 0, address: 'TXyz' };
  mock.binanceDeps.push(dep);
  await say('abc123deftrc20hash');
  assert.ok(out.at(-1).text.includes('confirmando'));
  dep.status = 1;
  const b2 = (await users.getUser(5151)).balance;
  await say('abc123deftrc20hash');
  assert.equal(pricing.round4((await users.getUser(5151)).balance - b2), 12);
  const rows = await (await import('../src/db.js')).many("SELECT ext_tx FROM recharges WHERE user_id=5151 AND method='binance' AND status='approved'");
  assert.equal(rows.length, 2);
  await saveSettings({ cop_rate: '0' });
});

console.log(`\n${pass} pruebas OK`);
mock.close();
process.exit(0);
