// Motor de pedidos: cobra al cliente, compra en KOKORO, entrega y reembolsa si algo falla.
import crypto from 'node:crypto';
import { config } from './config.js';
import { one, many, query, tx } from './db.js';
import { kokoro, KokoroError } from './kokoro.js';
import { bunny, BunnyError, balanceOf } from './bunny.js';
import { credit, getUser } from './users.js';
import { num, s } from './settings.js';
import { money, round2 } from './pricing.js';
import { esc, errorEs } from './util.js';

let notifier = { user: async () => {}, admins: async () => {} };
export const setNotifier = (n) => { notifier = n; };

const newExternalId = () => `${config.shopPrefix}-${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;

// Crea el pedido y cobra al cliente en una sola transacción. null = saldo insuficiente.
async function createOrder({ userId, kind, productId, productName, quantity, cost, price, input }) {
  const ext = newExternalId();
  return tx(async (t) => {
    const r = await t.query('UPDATE users SET balance = balance - $1 WHERE id = $2 AND balance >= $1 RETURNING balance', [
      price, userId,
    ]);
    if (!r.rows[0]) return null;
    const o = (await t.query(
      `INSERT INTO orders (user_id, kind, product_id, product_name, quantity, cost, price, status, external_order_id, input)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9) RETURNING *`,
      [userId, kind, productId, productName, quantity, cost, price, ext, JSON.stringify(input || {})],
    )).rows[0];
    await t.query('INSERT INTO transactions (user_id, amount, type, note, order_id) VALUES ($1,$2,$3,$4,$5)', [
      userId, -price, 'purchase', productName, o.id,
    ]);
    return o;
  });
}

async function update(orderId, fields) {
  const keys = Object.keys(fields);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  return one(`UPDATE orders SET ${sets}, updated_at = now() WHERE id = $1 RETURNING *`, [orderId, ...keys.map((k) => fields[k])]);
}

// Reembolsa una sola vez (protegido contra dobles reembolsos)
export async function refundOrder(orderId, reason) {
  const o = await one(
    `UPDATE orders SET refunded = TRUE, status = 'refunded', failure_reason = $2, updated_at = now()
     WHERE id = $1 AND refunded = FALSE RETURNING *`,
    [orderId, reason || null],
  );
  if (!o) return null;
  const bal = await credit(o.user_id, Number(o.price), 'refund', `Reembolso pedido #${o.id}`, o.id);
  await notifier.user(o.user_id,
    `↩️ <b>Pedido #${o.id} reembolsado</b>\n${esc(o.product_name)}\n` +
    (reason ? `Motivo: ${esc(reason)}\n` : '') +
    `Se devolvieron <b>${money(o.price)} ${s('currency')}</b> a tu saldo. Saldo actual: <b>${money(bal)}</b>`);
  return o;
}

async function payReferral(o) {
  const pct = num('referral_percent');
  if (pct <= 0 || o.referral_paid) return;
  const u = await getUser(o.user_id);
  if (!u?.referred_by) return;
  const marked = await one('UPDATE orders SET referral_paid = TRUE WHERE id=$1 AND referral_paid = FALSE RETURNING id', [o.id]);
  if (!marked) return;
  const amount = round2((Number(o.price) * pct) / 100);
  if (amount <= 0) return;
  await credit(u.referred_by, amount, 'referral', `Comisión por compra de ${u.first_name || u.id}`, o.id);
  await notifier.user(u.referred_by, `🎁 Ganaste <b>${money(amount)} ${s('currency')}</b> por la compra de un referido.`);
}

async function checkLowBalance(remaining) {
  const limit = num('low_balance_alert');
  if (remaining != null && limit > 0 && Number(remaining) < limit) {
    await notifier.admins(`⚠️ Tu saldo en KOKORO está bajo: <b>${money(remaining)} USDT</b>. Recarga en @Shop_KOKORO_BOT para no perder ventas.`);
  }
}

export function formatDelivery(o) {
  if (!o.delivery) return '';
  return `<pre>${esc(o.delivery)}</pre>`;
}

async function markDelivered(o, delivery, kokoroOrderId) {
  const updated = await one(
    `UPDATE orders SET status='delivered', delivery=$2, kokoro_order_id=COALESCE($3, kokoro_order_id), action_required=NULL, updated_at=now()
     WHERE id=$1 AND status <> 'delivered' AND refunded = FALSE RETURNING *`,
    [o.id, delivery || null, kokoroOrderId || null],
  );
  if (!updated) return null;
  await payReferral(updated);
  return updated;
}

// ===================== PRODUCTOS DIGITALES =====================
export async function buyProduct({ userId, product, quantity, unitPrice, activationData }) {
  const cost = round2(Number(product._unitCost ?? product.price) * quantity);
  const price = round2(unitPrice * quantity);
  const isBunny = product.source === 'bunny';
  const o = await createOrder({
    userId, kind: isBunny ? 'bunny' : 'product', productId: product.id, productName: product.name, quantity, cost, price,
    input: activationData ? { activation_data: activationData } : {},
  });
  if (!o) return { ok: false, reason: 'balance' };
  if (isBunny) return buyFromBunny(o, product, quantity, unitPrice);

  const body = { product_id: product.id, quantity, external_order_id: o.external_order_id };
  if (activationData) body.activation_data = activationData;

  let res;
  try {
    res = await callWithRetry(() => kokoro.purchase(body));
  } catch (e) {
    return handlePurchaseError(o, e);
  }
  await checkLowBalance(res.remaining_balance);
  const delivery = Array.isArray(res.items) && res.items.length ? res.items.join('\n') : res.credentials || '';
  if (res._http === 202 || res.status === 'processing' || !delivery) {
    const p = await update(o.id, { status: 'processing', kokoro_order_id: res.order_id || null });
    return { ok: true, order: p, processing: true };
  }
  const d = await markDelivered(o, delivery, res.order_id);
  return { ok: true, order: d || o };
}

// ===================== BUNNY =====================
async function buyFromBunny(o, product, quantity, unitPrice) {
  let res;
  try {
    // Bunny exige vender a precio >= mayorista (nunca por debajo)
    const sellingPrice = Math.max(round2(unitPrice), Number(product.price));
    res = await bunny.createOrder({ productId: product.sourceId, quantity, sellingPrice });
  } catch (e) {
    if (e instanceof BunnyError && e.definitelyNotCharged) {
      if (/balance|insufficient|fund|saldo/i.test(e.message)) {
        await notifier.admins(`🚨 <b>Venta perdida por saldo insuficiente en Bunny</b>\nPedido #${o.id}: ${esc(o.product_name)} (costo ${money(o.cost)} USDT). Recarga en @bunnytoolss_bot → Deposit.`);
        await refundOrder(o.id, FRIENDLY[402]);
        return { ok: false, reason: 'api', message: FRIENDLY[402], order: await one('SELECT * FROM orders WHERE id=$1', [o.id]) };
      }
      const reason = /stock/i.test(e.message) ? 'Sin stock en este momento.' : e.message;
      await refundOrder(o.id, reason);
      return { ok: false, reason: 'api', message: reason, order: await one('SELECT * FROM orders WHERE id=$1', [o.id]) };
    }
    // Sin respuesta clara: Bunny no permite consultar pedidos, así que lo revisa el admin (no se reintenta para no cobrar doble)
    await update(o.id, { status: 'processing', failure_reason: `Revisar en Bunny: ${String(e.message).slice(0, 250)}` });
    await notifier.admins(`⚠️ <b>Pedido #${o.id} (Bunny) sin respuesta clara</b>\n${esc(o.product_name)}\nRevisa tu historial en @bunnytoolss_bot. Luego, en el panel → Pedidos → #${o.id}, entrega manualmente o reembolsa.`);
    return { ok: true, processing: true, order: await one('SELECT * FROM orders WHERE id=$1', [o.id]) };
  }
  const ord = res.order || res.data || res;
  const item = ord.delivered_item ?? ord.delivered_items ?? ord.items ?? ord.item ?? ord.delivery ?? ord.credentials;
  const delivery = Array.isArray(item) ? item.join('\n') : String(item || '');
  if (!delivery) {
    await update(o.id, { status: 'processing', kokoro_order_id: ord.order_code || null, failure_reason: 'Bunny no devolvió el producto' });
    await notifier.admins(`⚠️ Pedido #${o.id} (Bunny ${esc(ord.order_code || '')}) pagado pero sin datos de entrega. Revísalo en @bunnytoolss_bot y entrégalo desde el panel.`);
    return { ok: true, processing: true, order: await one('SELECT * FROM orders WHERE id=$1', [o.id]) };
  }
  const full = ord.warranty_info ? `${delivery}\n\n🛡 Garantía: ${ord.warranty_info}` : delivery;
  const d = await markDelivered(o, full, ord.order_code || ord.order_id || null);
  checkBunnyBalance().catch(() => {});
  return { ok: true, order: d || o };
}

async function checkBunnyBalance() {
  const limit = num('low_balance_alert');
  if (limit <= 0) return;
  const p = await bunny.profile();
  const bal = balanceOf(p);
  if (Number.isFinite(bal) && bal < limit) {
    await notifier.admins(`⚠️ Tu saldo en Bunny está bajo: <b>${money(bal)} USDT</b>. Recarga en @bunnytoolss_bot → Deposit.`);
  }
}

// Entrega manual desde el panel (para pedidos que quedaron pendientes)
export async function deliverManually(orderId, delivery) {
  const o = await one('SELECT * FROM orders WHERE id=$1', [orderId]);
  if (!o || o.refunded) return null;
  const d = await markDelivered(o, delivery, null);
  if (d) await notifyDelivered(d);
  return d;
}

// ===================== JUEGOS / GIFT CARDS / KEYS =====================
export async function buyGamePack({ userId, pack, game, unitPrice, quantity = 1, fields, country }) {
  const cost = round2(Number(pack.price) * quantity);
  const price = round2(unitPrice * quantity);
  const name = `${game?.name || pack.name} — ${pack.pack || pack.name}${quantity > 1 ? ` x${quantity}` : ''}`;
  const o = await createOrder({
    userId, kind: 'game', productId: pack.id, productName: name, quantity, cost, price,
    input: { fields, country, game_id: game?.id },
  });
  if (!o) return { ok: false, reason: 'balance' };

  const body = {
    product_id: pack.id,
    external_order_id: o.external_order_id,
    fields,
    max_price: Number(pack.price), // si KOKORO subió el precio, no compra (409 price_changed)
  };
  if (quantity > 1) body.quantity = quantity;
  if (country) body.country = country;
  if (config.publicUrl) body.webhook_url = `${config.publicUrl}/kokoro/webhook`;

  let res;
  try {
    res = await callWithRetry(() => kokoro.gamePurchase(body));
  } catch (e) {
    return handlePurchaseError(o, e);
  }
  return { ok: true, order: await applyGameOrder(o, res, { silent: true }) };
}

export async function sendConfirmationCode(order, code) {
  const res = await kokoro.sendCode(order.external_order_id, code);
  return applyGameOrder(order, res, { silent: true });
}

// Aplica el estado que devuelve KOKORO a nuestro pedido. Avisa al cliente si cambia.
async function applyGameOrder(o, k, { silent = false } = {}) {
  if (k.remaining_balance != null) await checkLowBalance(k.remaining_balance);
  if (k.status === 'refunded') {
    await refundOrder(o.id, k.failure_reason || k.error || 'El proveedor rechazó el pedido');
    return one('SELECT * FROM orders WHERE id=$1', [o.id]);
  }
  if (k.status === 'delivered') {
    const d = k.delivery || {};
    const lines = [];
    if (d.code) lines.push(d.code);
    if (Array.isArray(d.items) && d.items.length) lines.push(...d.items.filter((x) => x !== d.code));
    if (d.type === 'account') lines.push(`Recarga enviada a la cuenta ${d.player_id || ''}${d.server_id ? ` (${d.server_id})` : ''}${d.nickname ? ` — ${d.nickname}` : ''}`);
    if (d.note) lines.push(d.note);
    const delivered = await markDelivered(o, lines.join('\n') || 'Entregado', k.order_id);
    if (delivered && !silent) await notifyDelivered(delivered);
    return delivered || one('SELECT * FROM orders WHERE id=$1', [o.id]);
  }
  // processing / action_required
  const ar = k.action_required || null;
  const wasWaiting = o.status === 'action_required';
  const updated = await update(o.id, {
    status: ar ? 'action_required' : 'processing',
    kokoro_order_id: k.order_id || o.kokoro_order_id,
    action_required: ar ? JSON.stringify(ar) : null,
  });
  if (ar && !wasWaiting && !silent) await askForCode(updated);
  return updated;
}

export async function askForCode(o) {
  const ar = typeof o.action_required === 'string' ? JSON.parse(o.action_required) : o.action_required;
  const { setState } = await import('./users.js');
  await setState(o.user_id, { step: 'supercell_code', orderId: o.id });
  const until = ar?.expires_at ? new Date(ar.expires_at).toISOString().slice(11, 16) + ' UTC' : '30 minutos';
  await notifier.user(o.user_id,
    `📧 <b>Pedido #${o.id}: falta un paso</b>\n\nSupercell envió un <b>código de confirmación</b> al correo de tu cuenta.\n` +
    `Escríbelo aquí en el chat (tienes hasta las ${until}). Si no llega a tiempo, el pedido se reembolsa automáticamente.`);
}

export async function notifyDelivered(o) {
  await notifier.user(o.user_id,
    `✅ <b>Pedido #${o.id} entregado</b>\n${esc(o.product_name)}\n\n${formatDelivery(o)}`);
}

async function callWithRetry(fn) {
  // Los fallos de red se reintentan con el mismo external_order_id: KOKORO nunca cobra dos veces.
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!(e instanceof KokoroError) || !e.network) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw last;
}

const FRIENDLY = {
  402: 'El servicio no está disponible en este momento. Inténtalo más tarde.',
  409: 'Sin stock suficiente o el precio cambió. Vuelve a abrir el producto.',
};

async function handlePurchaseError(o, e) {
  if (e instanceof KokoroError && e.definitelyNotCharged) {
    if (e.status === 402) {
      await notifier.admins(`🚨 <b>Venta perdida por saldo insuficiente en KOKORO</b>\nPedido #${o.id}: ${esc(o.product_name)} (costo ${money(o.cost)} USDT).\nTu saldo: ${money(e.body.balance)} USDT. Recarga en @Shop_KOKORO_BOT.`);
    }
    const reason = e.status === 402 ? FRIENDLY[402] : errorEs(e);
    await refundOrder(o.id, reason);
    return { ok: false, reason: 'api', message: reason, order: await one('SELECT * FROM orders WHERE id=$1', [o.id]) };
  }
  // Resultado desconocido (sin respuesta): se deja pendiente y el verificador automático lo resuelve.
  await update(o.id, { status: 'processing', failure_reason: String(e.message).slice(0, 300) });
  await notifier.admins(`⚠️ Pedido #${o.id} sin respuesta clara de KOKORO (${esc(e.message)}). Se verificará automáticamente.`);
  return { ok: true, processing: true, order: await one('SELECT * FROM orders WHERE id=$1', [o.id]) };
}

// ===================== VERIFICACIÓN DE ESTADO =====================
export async function refreshOrder(o) {
  if (o.kind === 'bunny') return o; // Bunny no tiene consulta de pedidos: lo resuelve el admin
  try {
    if (o.kind === 'game') {
      const r = await kokoro.gameOrder(o.external_order_id);
      const k = (r.orders || [])[0];
      if (!k) return maybeRefundMissing(o);
      return applyGameOrder(o, k);
    }
    const r = await kokoro.productOrder(o.external_order_id);
    const k = (r.orders || [])[0];
    if (!k) return maybeRefundMissing(o);
    if (k.status === 'delivered' || ((k.items?.length || k.credentials) && k.status !== 'refunded' && k.status !== 'cancelled')) {
      const delivery = k.items?.length ? k.items.join('\n') : k.credentials;
      if (delivery) {
        const d = await markDelivered(o, delivery, k.order_id);
        if (d) await notifyDelivered(d);
        return d || o;
      }
    }
    if (k.status === 'refunded' || k.status === 'cancelled') {
      await refundOrder(o.id, 'El proveedor canceló el pedido');
    }
    return one('SELECT * FROM orders WHERE id=$1', [o.id]);
  } catch (e) {
    console.error('refreshOrder', o.id, e.message);
    return o;
  }
}

// Si KOKORO no tiene el pedido después de 10 minutos, nunca se cobró: reembolsamos.
async function maybeRefundMissing(o) {
  if (Date.now() - new Date(o.created_at).getTime() > 10 * 60_000) {
    await refundOrder(o.id, 'El pedido no llegó al proveedor');
  }
  return one('SELECT * FROM orders WHERE id=$1', [o.id]);
}

export async function pollOpenOrders() {
  const open = await many(
    `SELECT * FROM orders WHERE status IN ('pending','processing','action_required') AND kind <> 'bunny'
     AND created_at > now() - interval '3 days' ORDER BY id LIMIT 30`,
  );
  for (const o of open) {
    if (o.status === 'pending' && Date.now() - new Date(o.created_at).getTime() < 90_000) continue; // aún comprando
    await refreshOrder(o);
  }
}

// Webhook de KOKORO (order.delivered / order.refunded / order.action_required)
export async function handleWebhook(event) {
  const data = event?.data || {};
  const ext = data.external_order_id;
  if (!ext) return;
  const o = await one('SELECT * FROM orders WHERE external_order_id=$1', [ext]);
  if (!o || o.kind !== 'game') return;
  await applyGameOrder(o, data);
}

export async function stats() {
  return one(`
    SELECT
      (SELECT count(*) FROM users)::int AS users,
      (SELECT count(*) FROM users WHERE created_at > now() - interval '1 day')::int AS users_today,
      (SELECT count(*) FROM orders WHERE status='delivered')::int AS orders,
      (SELECT COALESCE(sum(price),0) FROM orders WHERE status='delivered') AS revenue,
      (SELECT COALESCE(sum(price-cost),0) FROM orders WHERE status='delivered') AS profit,
      (SELECT COALESCE(sum(price),0) FROM orders WHERE status='delivered' AND created_at > now() - interval '1 day') AS revenue_today,
      (SELECT COALESCE(sum(price-cost),0) FROM orders WHERE status='delivered' AND created_at > now() - interval '1 day') AS profit_today,
      (SELECT count(*) FROM orders WHERE status IN ('pending','processing','action_required'))::int AS open_orders,
      (SELECT count(*) FROM recharges WHERE status='pending')::int AS pending_recharges,
      (SELECT COALESCE(sum(balance),0) FROM users) AS customer_balances
  `);
}

export { query };
