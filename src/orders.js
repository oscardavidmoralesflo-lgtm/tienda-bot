// Motor de pedidos: cobra al cliente, compra en KOKORO, entrega y reembolsa si algo falla.
import crypto from 'node:crypto';
import { config } from './config.js';
import { one, many, query, tx } from './db.js';
import { kokoro, KokoroError } from './kokoro.js';
import { bunny, BunnyError, balanceOf } from './bunny.js';
import { credit, getUser } from './users.js';
import { num, s } from './settings.js';
import { money, round2, round4, fmt, protectsProfit } from './pricing.js';
import { isExtraProvider, quoteExtra, purchaseExtra, normalizedExtraOrder, readExtraOrder, providerNames, ProviderError } from './providers.js';
import { esc } from './util.js';
import { t, errorText, localName, userLang } from './i18n.js';
import { levelOf, durationDays } from './loyalty.js';

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
  const lang = await userLang(o.user_id);
  await notifier.user(o.user_id, t(lang, 'n_refund', {
    id: o.id, name: esc(localName(o.product_name, lang)), reason: reason ? t(lang, 'n_reason', { r: esc(reason) }) : '', amt: fmt(o.price), bal: fmt(bal),
  }));
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
  await notifier.user(u.referred_by, t(await userLang(u.referred_by), 'n_referral', { amt: fmt(amount) }));
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
  await payCashback(updated).catch((e) => console.error('ñapa', e.message));
  await scheduleRenewal(updated).catch((e) => console.error('renovación', e.message));
  return updated;
}

// ===================== FIDELIZACIÓN =====================
// "Ñapa": devuelve un % de la compra en saldo según el nivel del cliente
async function payCashback(o) {
  const r = await one("SELECT COALESCE(sum(price),0) AS t FROM orders WHERE user_id=$1 AND status='delivered'", [o.user_id]);
  const lang = await userLang(o.user_id);
  const lvl = levelOf(Number(r.t), lang);
  if (!(lvl.pct > 0)) return;
  const marked = await one('UPDATE orders SET cashback_paid = TRUE WHERE id=$1 AND cashback_paid = FALSE RETURNING id', [o.id]);
  if (!marked) return;
  const amount = round4((Number(o.price) * lvl.pct) / 100);
  if (amount <= 0) return;
  await credit(o.user_id, amount, 'cashback', `Ñapa ${lvl.pct}% pedido #${o.id}`, o.id);
  await notifier.user(o.user_id, t(lang, 'n_cashback', { amt: fmt(amount), pct: lvl.pct, lvl: lvl.name }));
}

// Programa el recordatorio de renovación (ej: Netflix 1 mes → aviso 3 días antes de vencer)
async function scheduleRenewal(o) {
  const before = num('renew_reminder_days');
  const days = durationDays(o.product_name);
  if (!(before > 0) || !days || days <= before + 1 || o.kind === 'game') return;
  await query(`UPDATE orders SET renew_at = now() + ($2 || ' days')::interval WHERE id = $1`, [o.id, String(days - before)]);
}

export async function sendRenewals() {
  const due = await many(
    `SELECT * FROM orders WHERE status='delivered' AND reminded = FALSE AND renew_at IS NOT NULL AND renew_at <= now()
     ORDER BY renew_at LIMIT 25`,
  );
  for (const o of due) {
    const mark = await one('UPDATE orders SET reminded = TRUE WHERE id=$1 AND reminded = FALSE RETURNING id', [o.id]);
    if (!mark) continue;
    const lang = await userLang(o.user_id);
    await notifier.user(o.user_id, t(lang, 'n_renew', { name: esc(localName(o.product_name, lang)), d: num('renew_reminder_days') }),
      { reply_markup: { inline_keyboard: [[{ text: t(lang, 'btn_renew'), callback_data: `rn:${o.id}` }], [{ text: t(lang, 'btn_view_store'), callback_data: 'st' }]] } });
  }
  return due.length;
}

// ===================== PRODUCTOS DIGITALES =====================
export async function buyProduct({ userId, product, quantity, unitPrice, activationData }) {
  let cost = round4(Number(product._unitCost ?? product.price) * quantity);
  const price = round4(unitPrice * quantity);
  const isBunny = product.source === 'bunny';
  const extra=isExtraProvider(product.source);
  const lang=await userLang(userId);
  if(!Number.isSafeInteger(quantity)||quantity<1||!Number.isFinite(price)||price<=0||!Number.isFinite(cost)||cost<0)return {ok:false,reason:'price',message:t(lang,'quote_invalid')};
  let quote;
  if(extra) {
    try { quote=await quoteExtra(product.source,product,quantity,activationData);cost=quote.cost; }
    catch(e) { return {ok:false,reason:'quote',message:t(lang,'quote_unavailable')}; }
  }
  if(!protectsProfit(cost,price,'products',quantity))return {ok:false,reason:'price',message:t(lang,'price_changed')};
  const o = await createOrder({
    userId, kind: extra ? product.source : isBunny ? 'bunny' : 'product', productId: product.id, productName: product.name, quantity, cost, price,
    input: { ...(activationData ? { activation_data: activationData } : {}), ...(quote?.quoteId ? {quote_id:quote.quoteId} : {}) },
  });
  if (!o) return { ok: false, reason: 'balance' };
  if(extra)return buyFromExtra(o,product,quote,activationData);
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

async function applyExtraOrder(o,response,notify=false) {
  const r=normalizedExtraOrder(o.kind,response);
  const fields={};
  if(r.id)fields.kokoro_order_id=String(r.id);
  if(r.cost!=null&&r.cost>=0)fields.cost=r.cost;
  if(Object.keys(fields).length)o=await update(o.id,fields);
  if(r.refunded){await refundOrder(o.id,t(await userLang(o.user_id),'err_provider_cancelled'));return one('SELECT * FROM orders WHERE id=$1',[o.id]);}
  if(r.delivered) {
    if(r.itemCount!=null&&r.itemCount<o.quantity) {
      await notifier.admins(`⚠️ Pedido #${o.id}: entrega parcial de ${esc(providerNames[o.kind])}. Revisa el pedido antes de completarlo o reembolsarlo.`);
      return update(o.id,{status:'processing',delivery:r.delivery,failure_reason:'Entrega parcial; revisión manual necesaria'});
    }
    const d=await markDelivered(o,r.delivery,r.id);
    if(d&&notify)await notifyDelivered(d);
    if(!protectsProfit(Number(o.cost),Number(o.price),'products',o.quantity))await notifier.admins(`⚠️ Pedido #${o.id}: ${esc(providerNames[o.kind])} cobró un costo diferente de la cotización. Revisa el margen en el panel.`);
    return d||o;
  }
  return update(o.id,{status:'processing',failure_reason:r.status?`Estado proveedor: ${r.status}`:'Esperando confirmación de entrega'});
}
async function buyFromExtra(o,product,quote,activationData) {
  try { return {ok:true,order:await applyExtraOrder(o,await purchaseExtra(o.kind,o,product,quote,activationData))}; }
  catch(e) {
    if(e instanceof ProviderError&&e.definitelyNotCharged) {
      const message=t(await userLang(o.user_id),'quote_unavailable');
      await refundOrder(o.id,message);return {ok:false,reason:'api',message,order:await one('SELECT * FROM orders WHERE id=$1',[o.id])};
    }
    const p=await update(o.id,{status:'processing',...(e.orderId?{kokoro_order_id:String(e.orderId)}:{}),failure_reason:'Respuesta incierta del proveedor: revisar la misma orden; no volver a comprar.'});
    await notifier.admins(`⚠️ Pedido #${o.id} (${esc(providerNames[o.kind])}) pendiente de conciliación. No se volvió a comprar ni se cambió de proveedor. Referencia: <code>${esc(o.external_order_id)}</code>.`);
    return {ok:true,processing:true,order:p};
  }
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
        const msg = t(await userLang(o.user_id), 'err_unavailable');
        await refundOrder(o.id, msg);
        return { ok: false, reason: 'api', message: msg, order: await one('SELECT * FROM orders WHERE id=$1', [o.id]) };
      }
      const reason = /stock/i.test(e.message) ? t(await userLang(o.user_id), 'err_out_of_stock') : e.message;
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
  const price = round4(unitPrice * quantity);
  if(!Number.isSafeInteger(quantity)||quantity<1||!Number.isFinite(cost)||!Number.isFinite(price)||!protectsProfit(cost,price,'games',quantity))return {ok:false,reason:'price',message:t(await userLang(userId),'price_changed')};
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
    await refundOrder(o.id, k.failure_reason || k.error || t(await userLang(o.user_id), 'err_provider_rejected'));
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
  const lang = await userLang(o.user_id);
  const until = ar?.expires_at ? new Date(ar.expires_at).toISOString().slice(11, 16) + ' UTC' : t(lang, 'n_30min');
  await notifier.user(o.user_id, t(lang, 'n_code', { id: o.id, until }));
}

export async function notifyDelivered(o) {
  const lang = await userLang(o.user_id);
  await notifier.user(o.user_id, t(lang, 'n_delivered', { id: o.id, name: esc(localName(o.product_name, lang)), delivery: formatDelivery(o) }));
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
    const lang = await userLang(o.user_id);
    const reason = e.status === 402 ? t(lang, 'err_unavailable') : errorText(e, lang);
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
  if(isExtraProvider(o.kind)) {
    if(o.status==='delivered'||o.refunded)return o;
    try { const r=await readExtraOrder(o);return r?await applyExtraOrder(o,r,true):o; }
    catch { return o; } // Un 404/timeout no prueba que se haya reembolsado.
  }
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
      await refundOrder(o.id, t(await userLang(o.user_id), 'err_provider_cancelled'));
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
    await refundOrder(o.id, t(await userLang(o.user_id), 'err_no_charge_provider'));
  }
  return one('SELECT * FROM orders WHERE id=$1', [o.id]);
}

export async function pollOpenOrders() {
  const open = await many(
    `SELECT * FROM orders WHERE status IN ('pending','processing','action_required') AND kind NOT IN ('bunny','safwan')
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
