// Servidor KOKORO de mentira para probar sin gastar saldo real
import express from 'express';

export function startMock(port = 4010) {
  const app = express();
  app.use(express.json());
  let balance = 50;
  const orders = [];
  const products = [
    { id: 'netflix_1m', name: 'Netflix 1 mes', price: 3, stock: 5, min_order: 1, bulk_discounts: [{ min_qty: 5, unit_price: 2.5 }], requires_activation_data: false, description_es: '<p><strong>Cuenta</strong> privada<br>1 mes</p><script>x</script>' },
    { id: 'duo_plus', name: 'Duolingo Plus', price: 1.2, stock: 10, min_order: 1, requires_activation_data: true, activation_data_type: 'email', description_es: 'Activación en tu correo' },
    { id: 'caro', name: 'Producto caro', price: 500, stock: 3, min_order: 1, description_es: '' },
  ];
  const packs = [
    { id: 'rg_ff100', game_id: 'topup:free-fire', name: 'Free Fire', pack: '100 diamantes', region: 'latam', region_name_es: 'Latam', price: 0.74, in_stock: true, delivery: 'account', validation: 'region', fields: [{ key: 'player_id', label_es: 'ID de jugador', type: 'text', required: true }] },
    { id: 'rg_ff520', game_id: 'topup:free-fire', name: 'Free Fire', pack: '520 diamantes', region: 'brasil', region_name_es: 'Brasil', price: 3.6, in_stock: true, delivery: 'account', validation: 'region', fields: [{ key: 'player_id', label_es: 'ID de jugador', type: 'text', required: true }] },
  ];
  const auth = (req, res, next) => (req.headers.authorization === 'Bearer sk_test' ? next() : res.status(401).json({ success: false, error: 'Invalid token' }));
  app.use(auth);
  app.get('/api/balance', (req, res) => res.json({ success: true, user_id: 1, balance }));
  app.get('/api/products', (req, res) => res.json({ success: true, count: products.length, products }));
  app.post('/api/purchase', (req, res) => {
    const { product_id, quantity = 1, external_order_id, activation_data } = req.body;
    const dup = orders.find((o) => o.external_order_id === external_order_id);
    if (dup) return res.json({ ...dup, idempotent_replay: true });
    const p = products.find((x) => x.id === product_id);
    if (!p) return res.status(404).json({ success: false, error: 'Product not found' });
    if (p.requires_activation_data && !activation_data) return res.status(400).json({ success: false, error: 'activation_data required' });
    if (quantity > p.stock) return res.status(409).json({ success: false, error: 'Out of stock', available: p.stock });
    let unit = p.price;
    for (const t of p.bulk_discounts || []) if (quantity >= t.min_qty) unit = t.unit_price;
    const total = unit * quantity;
    if (total > balance) return res.status(402).json({ success: false, error: 'Insufficient balance', balance, required: total });
    balance -= total;
    p.stock -= quantity;
    const items = Array.from({ length: quantity }, (_, i) => `user${i}@mail.com:pass${i}`);
    const o = { success: true, order_id: `K${orders.length + 1}`, external_order_id, product: p.name, quantity, total, remaining_balance: balance, items, credentials: items.join('\n'), units: quantity, kind: 'product', status: 'delivered' };
    orders.push(o);
    res.json(o);
  });
  app.get('/api/orders', (req, res) => res.json({ success: true, orders: orders.filter((o) => o.kind === 'product' && (!req.query.order_id || o.external_order_id === req.query.order_id)) }));
  app.get('/api/games', (req, res) => res.json({ success: true, games: [{ id: 'topup:free-fire', name: 'Free Fire', kind: 'topup', enabled: true, packs: 2, from_price: 0.74, delivery: 'account' }] }));
  app.get('/api/games/:id/products', (req, res) => res.json({ success: true, game: { id: req.params.id, name: 'Free Fire', kind: 'topup' }, products: packs }));
  app.post('/api/games/validate', (req, res) => {
    const pid = req.body.fields?.player_id;
    if (pid === '000') return res.json({ success: true, validation: 'region', valid: false, message: 'Player not found' });
    res.json({ success: true, validation: 'region', valid: true, player_name: 'ProGamer', account_region_name: 'Latam', region_matches: true });
  });
  app.post('/api/games/purchase', (req, res) => {
    const { product_id, external_order_id, fields, max_price } = req.body;
    const p = packs.find((x) => x.id === product_id);
    if (max_price != null && p.price > max_price) return res.status(409).json({ success: false, code: 'price_changed', error: 'Price changed', price: p.price });
    if (p.price > balance) return res.status(402).json({ success: false, error: 'Insufficient balance', balance, required: p.price });
    balance -= p.price;
    const o = { success: true, order_id: `G${orders.length + 1}`, external_order_id, product_id, status: 'processing', total: p.price, remaining_balance: balance, kind: 'game', fields };
    orders.push(o);
    // se entrega 2 segundos después; el ID "999" lo rechaza el proveedor
    setTimeout(() => {
      if (fields.player_id === '999') { o.status = 'refunded'; o.failure_reason = 'Provider rejected'; balance += p.price; }
      else { o.status = 'delivered'; o.delivery = { type: 'account', player_id: fields.player_id, nickname: 'ProGamer' }; }
    }, 2000);
    res.status(202).json(o);
  });
  app.get('/api/games/orders', (req, res) => res.json({ success: true, orders: orders.filter((o) => o.kind === 'game' && (!req.query.order_id || o.external_order_id === req.query.order_id)) }));
  return new Promise((r) => { const s = app.listen(port, () => r(s)); });
}
