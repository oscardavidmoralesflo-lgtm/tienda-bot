// Catálogo, juegos, búsqueda y compra
import { InlineKeyboard } from 'grammy';
import { kokoro } from '../kokoro.js';
import * as catalog from '../catalog.js';
import { productUnitPrice, productUnitCost, packPrice, gameFromPrice, isHidden, getOverride, money, copSuffix, fmt, fmtS, round4 } from '../pricing.js';
import { s } from '../settings.js';
import { getUser, setState } from '../users.js';
import { buyProduct, buyGamePack, refreshOrder, askForCode, formatDelivery, sendConfirmationCode } from '../orders.js';
import { one, many } from '../db.js';
import { esc, tgHtml, ref, deref, errorEs } from '../util.js';
import { DISPLAY_ORDER, CAT_BY_KEY, categoryOf, iconOf } from '../categories.js';
import { show, pager, cut, cancelKb, navRow, stockIcon, LINE, MENU } from './ui.js';

const PER_PAGE = 8;
const cur = () => s('currency');

// ===================== PRODUCTOS =====================
async function visibleProducts() {
  const list = await catalog.products();
  return list
    .filter((p) => !isHidden(p.id))
    .sort((a, b) => (b.stock > 0) - (a.stock > 0) || a.name.localeCompare(b.name));
}

// Tienda: categorías con cantidad de productos
export async function showStore(ctx) {
  const list = await visibleProducts();
  const count = {};
  for (const p of list) if (p.stock > 0) count[categoryOf(p.name).key] = (count[categoryOf(p.name).key] || 0) + 1;
  const kb = new InlineKeyboard();
  const cats = DISPLAY_ORDER.filter((c) => count[c.key]);
  cats.forEach((c, i) => {
    kb.text(`${c.icon} ${c.label} (${count[c.key]})`, `c:${c.key}:0`);
    if (i % 2 === 1) kb.row();
  });
  kb.row().text('🔥 Más vendidos', 'top').text('🔎 Buscar', 'gs');
  navRow(kb);
  const total = Object.values(count).reduce((a, b) => a + b, 0);
  await show(ctx, `🛍 <b>Tienda</b>\n${LINE}\n${total} productos disponibles con <b>entrega automática</b> ⚡\n\nElige una categoría:`, kb);
}
// compatibilidad con botones viejos
export const showProducts = (ctx) => showStore(ctx);

async function showCategory(ctx, key, page = 0) {
  const cat = CAT_BY_KEY[key] || CAT_BY_KEY.other;
  const list = (await visibleProducts()).filter((p) => categoryOf(p.name).key === cat.key);
  const kb = new InlineKeyboard();
  for (const p of list.slice(page * PER_PAGE, (page + 1) * PER_PAGE)) {
    kb.text(`${iconOf(p.name)} ${cut(p.name, 34)} · ${fmtS(productUnitPrice(p))}${p.stock > 0 ? '' : ' · agotado'}`, `p:${ref(p.id)}`).row();
  }
  pager(kb, `c:${cat.key}:`, page, list.length, PER_PAGE);
  navRow(kb, 'st');
  const avail = list.filter((p) => p.stock > 0).length;
  await show(ctx, `${cat.icon} <b>${cat.label}</b>\n${LINE}\n🟢 ${avail} disponibles · precios en ${cur()}\n\nToca un producto para ver detalles:`, kb);
}

// Más vendidos: ventas reales de los últimos 30 días; si aún no hay, los destacados y los populares
export async function bestSellers(limit = 5) {
  const list = await visibleProducts();
  const inStock = list.filter((p) => p.stock > 0);
  const byName = new Map(inStock.map((p) => [p.name, p]));
  const picked = [];
  const add = (p) => p && !picked.includes(p) && picked.length < limit && picked.push(p);
  const sold = await many(
    `SELECT product_name, count(*)::int AS n FROM orders WHERE status='delivered' AND kind <> 'game'
     AND created_at > now() - interval '30 days' GROUP BY product_name ORDER BY n DESC LIMIT 20`,
  ).catch(() => []);
  for (const r of sold) add(byName.get(r.product_name));
  for (const p of inStock) if (getOverride(p.id)?.featured) add(p);
  // populares por defecto (mientras no haya ventas reales)
  for (const re of [/^gemini ai pro 18/i, /^chatgpt plus 1 mes/i, /^capcut pro team/i, /^canva pro edu/i, /^youtube premium 3/i, /^spotify premium 3/i, /^prime video 6/i, /^netflix/i]) {
    add(inStock.find((p) => re.test(p.name)));
  }
  return picked;
}

async function showTop(ctx) {
  const top = await bestSellers(10);
  const kb = new InlineKeyboard();
  top.forEach((p, i) => kb.text(`${['🥇', '🥈', '🥉'][i] || '⭐'} ${cut(p.name, 34)} · ${fmtS(productUnitPrice(p))}`, `p:${ref(p.id)}`).row());
  navRow(kb, 'st');
  await show(ctx, `🔥 <b>Más vendidos</b>\n${LINE}\nLo que más están comprando nuestros clientes:`, kb);
}

async function findProduct(key, fresh = false) {
  const id = deref(key);
  if (!id) return null;
  const p = await catalog.findProduct(id, fresh);
  if (!p || isHidden(p.id)) return null;
  return p.displayName ? { ...p, name: p.displayName } : p;
}

async function showProduct(ctx, key) {
  const p = await findProduct(key);
  if (!p) return show(ctx, '⚠️ Este producto ya no está disponible.', navRow(new InlineKeyboard(), 'st'));
  const cat = categoryOf(p.name);
  const unit = productUnitPrice(p);
  let text = `${iconOf(p.name)} <b>${esc(p.name)}</b>\n${LINE}\n`;
  text += `💵 Precio: <b>${fmt(unit)}</b>\n`;
  text += `📦 Disponibles: ${stockIcon(p.stock)} ${p.stock > 0 ? (p.stock >= 999 ? 'ilimitado' : p.stock) : 'agotado'}\n`;
  text += '⚡ Entrega: automática al instante\n';
  text += `🗂 Categoría: ${cat.icon} ${cat.label}`;
  if (p.min_order > 1) text += `\n🔢 Compra mínima: ${p.min_order}`;
  const tiers = (p.bulk_discounts || []).filter((t) => t.min_qty > 1);
  if (tiers.length) {
    text += `\n\n🏷 <b>Descuento por volumen</b>`;
    for (const t of tiers) text += `\n• Desde ${t.min_qty}: ${fmt(productUnitPrice(p, t.min_qty))} c/u`;
  }
  const desc = tgHtml(p.description_es || p.description_en, 1500);
  if (desc) text += `\n${LINE}\n${desc}`;

  const kb = new InlineKeyboard();
  if (p.stock > 0) {
    const min = Math.max(1, p.min_order || 1);
    const opts = [...new Set([min, 2, 5, 10].filter((q) => q >= min && q <= p.stock))].slice(0, 4);
    kb.text(`🛒 Comprar ahora · ${fmtS(unit * min)}`, `pq:${ref(p.id)}:${min}`).row();
    const more = opts.filter((q) => q !== min);
    for (const q of more) kb.text(`x${q}`, `pq:${ref(p.id)}:${q}`);
    kb.text('✏️ Otra cantidad', `pqx:${ref(p.id)}`);
  } else {
    kb.text('🔔 Agotado · vuelve pronto', 'noop');
  }
  navRow(kb, `c:${cat.key}:0`);
  await show(ctx, text, kb);
}

async function startProductPurchase(ctx, key, qty) {
  const p = await findProduct(key);
  if (!p) return show(ctx, '⚠️ Este producto ya no está disponible.');
  if (qty < (p.min_order || 1)) return ctx.reply(`La compra mínima es ${p.min_order}.`);
  if (qty > p.stock) return ctx.reply(`Solo hay ${p.stock} en stock.`);
  const draft = { type: 'product', productId: p.id, qty };
  if (p.requires_activation_data) {
    await setState(ctx.from.id, { step: 'activation', draft });
    const what = { email: 'el correo electrónico', username: 'el @usuario', country: 'el país', link: 'el enlace', duolingo_id: 'tu ID de Duolingo' }[p.activation_data_type] || 'los datos de activación';
    return ctx.reply(`✍️ Este producto necesita ${what} para activarlo. Escríbelo aquí:`, { reply_markup: cancelKb() });
  }
  return confirmProduct(ctx, draft);
}

async function confirmProduct(ctx, draft) {
  const p = await findProduct(draft.productId);
  if (!p) return ctx.reply('⚠️ Este producto ya no está disponible.');
  const unit = productUnitPrice(p, draft.qty);
  const total = round4(unit * draft.qty);
  const u = await getUser(ctx.from.id);
  await setState(ctx.from.id, { step: 'confirm', draft: { ...draft, total } });
  let text = `🧾 <b>Confirma tu compra</b>\n${LINE}\n${iconOf(p.name)} ${esc(p.name)}\n🔢 Cantidad: ${draft.qty}\n💵 Precio unitario: ${fmt(unit)}\n${LINE}\n💳 <b>Total: ${fmt(total)}</b>`;
  if (draft.activation) text += `\n✍️ Datos: <code>${esc(draft.activation)}</code>`;
  text += `\n💰 Tu saldo: ${fmt(u.balance)}`;
  const kb = new InlineKeyboard();
  if (Number(u.balance) >= total) kb.text('✅ Confirmar y pagar', 'ok').row().text('❌ Cancelar', 'x');
  else {
    text += `\n\n⚠️ Te faltan <b>${fmt(total - Number(u.balance))}</b>`;
    kb.text('💰 Recargar saldo', 'recharge').row().text('❌ Cancelar', 'x');
  }
  await show(ctx, text, kb);
}

async function executeProduct(ctx, draft) {
  const p = await findProduct(draft.productId, true);
  if (!p || p.stock < draft.qty) return ctx.reply('⚠️ Ya no hay stock suficiente. No se te cobró nada.');
  const unit = productUnitPrice(p, draft.qty);
  const res = await buyProduct({
    userId: ctx.from.id,
    product: { ...p, _unitCost: productUnitCost(p, draft.qty) },
    quantity: draft.qty,
    unitPrice: unit,
    activationData: draft.activation,
  });
  return reportResult(ctx, res);
}

// ===================== JUEGOS =====================
const KINDS = { topup: '🎮 Recargas', giftcard: '🎁 Gift cards', key: '🔑 Keys PC' };

export async function showGames(ctx, kind = 'topup', page = 0) {
  let data;
  try {
    data = await kokoro.games({ kind });
  } catch (e) {
    return show(ctx, `⚠️ ${esc(errorEs(e))}`, navRow(new InlineKeyboard()));
  }
  const games = (data.games || []).filter((g) => !isHidden(g.id));
  const kb = new InlineKeyboard();
  for (const [k, label] of Object.entries(KINDS)) kb.text(k === kind ? `✅ ${label.split(' ').slice(1).join(' ')}` : label, `g:${k}:0`);
  kb.row();
  for (const g of games.slice(page * PER_PAGE, (page + 1) * PER_PAGE)) {
    const from = gameFromPrice(g);
    kb.text(`${g.emoji_base ? g.emoji_base + ' ' : ''}${cut(g.name, 34)}${from ? ` · desde ${fmtS(from)}` : ''}`, `gg:${ref(g.id)}`).row();
  }
  pager(kb, `g:${kind}:`, page, games.length, PER_PAGE);
  kb.row().text('🔎 Buscar juego', 'gs');
  navRow(kb);
  await show(ctx, `🎮 <b>Juegos y Gift Cards</b>\n${LINE}\nRecargas directas a tu ID, gift cards y keys de PC.\n✅ Verificamos tu cuenta <b>antes</b> de cobrar.\n\n${KINDS[kind]}${games.length ? '' : '\n\n(no hay juegos en esta categoría)'}:`, kb);
}

async function loadGame(gameKey) {
  const gameId = deref(gameKey);
  if (!gameId) return null;
  const data = await kokoro.gamePacks(gameId);
  const packs = (data.products || []).filter((p) => p.in_stock !== false && !isHidden(p.id));
  return { game: data.game || { id: gameId, name: gameId }, packs };
}

async function showGame(ctx, gameKey, region = null, page = 0) {
  let g;
  try {
    g = await loadGame(gameKey);
  } catch (e) {
    return show(ctx, `⚠️ ${esc(errorEs(e))}`);
  }
  if (!g) return show(ctx, '⚠️ Menú expirado. Abre de nuevo 🎮 Juegos.');
  const { game, packs } = g;
  if (!packs.length) return show(ctx, `😕 ${esc(game.name)} no tiene paquetes disponibles ahora.`);
  const regions = [...new Map(packs.map((p) => [p.region || '-', p.region_name_es || p.region_name || p.region || 'Global'])).entries()];
  const gk = ref(game.id);
  // con varias regiones, primero se elige la región
  if (regions.length > 1 && !region) {
    const kb = new InlineKeyboard();
    regions.forEach(([slug, name], i) => {
      kb.text(cut(name, 30), `gr:${gk}:${slug}:0`);
      if (i % 2 === 1) kb.row();
    });
    navRow(kb, `g:${game.kind || 'topup'}:0`);
    return show(ctx, `${game.emoji_base || '🎮'} <b>${esc(game.name)}</b>\n${LINE}\n🌎 Elige la región de tu cuenta:`, kb);
  }
  const list = region ? packs.filter((p) => (p.region || '-') === region) : packs;
  const kb = new InlineKeyboard();
  for (const p of list.slice(page * PER_PAGE, (page + 1) * PER_PAGE)) {
    kb.text(`${cut(p.pack || p.name, 34)} · ${fmtS(packPrice(p, game.id))}`, `pk:${gk}:${ref(p.id)}`).row();
  }
  pager(kb, `gr:${gk}:${region || '-'}:`, page, list.length, PER_PAGE);
  navRow(kb, regions.length > 1 ? `gg:${gk}` : `g:${game.kind || 'topup'}:0`);
  const regionName = region ? regions.find(([s2]) => s2 === region)?.[1] : null;
  await show(ctx, `${game.emoji_base || '🎮'} <b>${esc(game.name)}</b>${regionName ? ` — ${esc(regionName)}` : ''}\n${LINE}\n💎 Elige un paquete:`, kb);
}

async function getPack(gameKey, packKey) {
  const g = await loadGame(gameKey);
  if (!g) return null;
  const packId = deref(packKey);
  const pack = g.packs.find((p) => p.id === packId);
  return pack ? { game: g.game, pack } : null;
}

async function showPack(ctx, gameKey, packKey) {
  const r = await getPack(gameKey, packKey);
  if (!r) return show(ctx, '⚠️ Este paquete ya no está disponible. Vuelve a abrir el juego.');
  const { game, pack } = r;
  const price = packPrice(pack, game.id);
  let text = `${game.emoji_base || '🎮'} <b>${esc(game.name)}</b>\n💎 <b>${esc(pack.pack || pack.name)}</b>\n${LINE}\n💵 Precio: <b>${fmt(price)}</b>`;
  if (pack.region_name_es || pack.region_name) text += `\n🌎 Región: ${esc(pack.region_name_es || pack.region_name)}`;
  if (pack.delivery_time_es || pack.delivery_time) text += `\n⚡ Entrega: ${esc(pack.delivery_time_es || pack.delivery_time)}`;
  text += `\n📬 ${pack.delivery === 'code' ? 'Recibes un código' : 'Se recarga directo en tu cuenta'}`;
  if (pack.account_region === 'US') text += '\n🇺🇸 Requiere cuenta de Estados Unidos';
  if (pack.requires_confirmation_code) text += '\n📧 Después de pagar te pediremos el código que Supercell envía a tu correo (30 min).';
  const extra = tgHtml(pack.description_es || pack.description, 800);
  if (extra) text += `\n\n${extra}`;
  const how = pack.how_to_activate_es || pack.how_to_redeem_es || pack.how_to_activate || pack.how_to_redeem;
  if (how) text += `\n\n<b>Cómo activar:</b>\n${tgHtml(how, 800)}`;

  const gk = ref(game.id);
  const pkk = ref(pack.id);
  const kb = new InlineKeyboard();
  if (pack.delivery === 'code') {
    const max = Math.min(pack.max_quantity || 10, 10);
    kb.text(`🛒 Comprar ahora · ${fmtS(price)}`, `pb:${gk}:${pkk}:1`).row();
    for (const q of [2, 3, 5].filter((q) => q <= max)) kb.text(`x${q}`, `pb:${gk}:${pkk}:${q}`);
  } else {
    kb.text(`🛒 Comprar ahora · ${fmtS(price)}`, `pb:${gk}:${pkk}:1`);
  }
  navRow(kb, pack.region ? `gr:${gk}:${pack.region}:0` : `gg:${gk}`);
  await show(ctx, text, kb);
}

function fieldsToAsk(pack, game) {
  const f = (pack.fields || []).filter((x) => x.required !== false);
  const list = f.map((x) => ({ key: x.key, label: x.label_es || x.label || x.key, hint: x.hint_es || x.hint || '', type: x.type, options: x.options }));
  if ((game.kind === 'key' || pack.platform) && !list.some((x) => x.key === 'country')) {
    list.push({ key: '__country', label: 'País donde activarás la key', hint: 'Ej: México o MX', type: 'country' });
  }
  return list;
}

async function startGamePurchase(ctx, gameKey, packKey, qty) {
  const r = await getPack(gameKey, packKey);
  if (!r) return show(ctx, '⚠️ Este paquete ya no está disponible.');
  const draft = { type: 'game', gameId: r.game.id, packId: r.pack.id, qty, fields: {}, ask: fieldsToAsk(r.pack, r.game), i: 0 };
  return askNextField(ctx, draft);
}

async function askNextField(ctx, draft) {
  const f = draft.ask[draft.i];
  if (!f) return validateAndConfirmGame(ctx, draft);
  await setState(ctx.from.id, { step: 'field', draft });
  const text = `✍️ <b>${esc(f.label)}</b>${f.hint ? `\n<i>${esc(f.hint)}</i>` : ''}\n\nEscríbelo aquí 👇`;
  if (f.type === 'select' && f.options?.length) {
    const kb = new InlineKeyboard();
    f.options.slice(0, 40).forEach((o, i) => {
      kb.text(cut(o.label || o.value, 30), `fs:${i}`);
      if (i % 2 === 1) kb.row();
    });
    kb.row().text('❌ Cancelar', 'x');
    return ctx.reply(`✍️ <b>${esc(f.label)}</b>${f.hint ? `\n<i>${esc(f.hint)}</i>` : ''}`, { parse_mode: 'HTML', reply_markup: kb });
  }
  return ctx.reply(text, { parse_mode: 'HTML', reply_markup: cancelKb() });
}

async function setField(ctx, draft, value) {
  const f = draft.ask[draft.i];
  if (f.key === '__country') draft.country = value;
  else draft.fields[f.key] = value;
  draft.i += 1;
  return askNextField(ctx, draft);
}

async function validateAndConfirmGame(ctx, draft) {
  const r = await getPack(ref(draft.gameId), ref(draft.packId));
  if (!r) return ctx.reply('⚠️ Este paquete ya no está disponible.');
  const { game, pack } = r;
  let check = '';
  if (pack.validation && pack.validation !== 'none') {
    await ctx.replyWithChatAction('typing');
    try {
      const v = await kokoro.validate({ product_id: pack.id, fields: draft.fields });
      if (v.valid === false || v.region_matches === false) {
        await setState(ctx.from.id, null);
        const msg = v.region_matches === false
          ? `La cuenta es de la región <b>${esc(v.account_region_name || v.account_region)}</b> y el paquete es de otra región. Elige un paquete de tu región.`
          : esc(v.message || 'No encontramos esa cuenta. Revisa los datos.');
        return ctx.reply(`❌ ${msg}`, { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('🔁 Intentar de nuevo', `pb:${ref(game.id)}:${ref(pack.id)}:${draft.qty}`) });
      }
      if (v.player_name) check += `\n👤 Jugador: <b>${esc(v.player_name)}</b>`;
      if (v.account_region_name) check += `\n🌎 Región de la cuenta: ${esc(v.account_region_name)}`;
    } catch (e) {
      if (e.definitelyNotCharged && e.status === 400) {
        await setState(ctx.from.id, null);
        return ctx.reply(`❌ ${esc(errorEs(e))}`, { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('🔁 Intentar de nuevo', `pb:${ref(game.id)}:${ref(pack.id)}:${draft.qty}`) });
      }
      // si la verificación no está disponible, se puede comprar igual
    }
  }
  const unit = packPrice(pack, game.id);
  const total = round4(unit * draft.qty);
  const u = await getUser(ctx.from.id);
  await setState(ctx.from.id, { step: 'confirm', draft: { ...draft, total } });
  let text = `🧾 <b>Confirma tu compra</b>\n${LINE}\n🎮 ${esc(game.name)} — ${esc(pack.pack || pack.name)}${draft.qty > 1 ? ` x${draft.qty}` : ''}`;
  for (const f of draft.ask) {
    const val = f.key === '__country' ? draft.country : draft.fields[f.key];
    const label = f.options?.find((o) => o.value === val)?.label || val;
    text += `\n${esc(f.label)}: <code>${esc(label)}</code>`;
  }
  text += check;
  text += `\n${LINE}\n💳 <b>Total: ${fmt(total)}</b>\n💰 Tu saldo: ${fmt(u.balance)}`;
  const kb = new InlineKeyboard();
  if (Number(u.balance) >= total) kb.text('✅ Confirmar y pagar', 'ok').row().text('❌ Cancelar', 'x');
  else {
    text += `\n\n⚠️ Te faltan <b>${fmt(total - Number(u.balance))}</b>`;
    kb.text('💰 Recargar saldo', 'recharge').row().text('❌ Cancelar', 'x');
  }
  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
}

async function executeGame(ctx, draft) {
  const r = await getPack(ref(draft.gameId), ref(draft.packId));
  if (!r) return ctx.reply('⚠️ Este paquete ya no está disponible. No se te cobró nada.');
  const res = await buyGamePack({
    userId: ctx.from.id,
    pack: r.pack,
    game: r.game,
    unitPrice: packPrice(r.pack, r.game.id),
    quantity: draft.qty,
    fields: draft.fields,
    country: draft.country,
  });
  return reportResult(ctx, res);
}

// ===================== RESULTADO DE COMPRA =====================
async function reportResult(ctx, res) {
  if (!res.ok && res.reason === 'balance') {
    return ctx.reply('⚠️ Saldo insuficiente.', { reply_markup: new InlineKeyboard().text('💰 Recargar saldo', 'recharge').text('🏠 Menú', 'm') });
  }
  const after = new InlineKeyboard().text('📦 Mis pedidos', 'ol').text('🛍 Seguir comprando', 'st').row().text('🏠 Menú', 'm');
  if (!res.ok) return ctx.reply(`❌ <b>No se pudo completar la compra</b>\n${esc(res.message)}\n\n💰 No se te cobró nada (el saldo fue devuelto).`, { parse_mode: 'HTML', reply_markup: after });
  const o = res.order;
  if (o.status === 'delivered') {
    return ctx.reply(`✅ <b>¡Compra exitosa!</b>\n${LINE}\n🧾 Pedido <b>#${o.id}</b> · ${esc(o.product_name)}\n💳 Pagado: ${fmt(o.price)}\n${LINE}\n${formatDelivery(o)}\n\n💾 Guarda esta información. Siempre la tienes en 📦 Mis pedidos.\n🙌 ¡Gracias por tu compra!`, { parse_mode: 'HTML', reply_markup: after });
  }
  if (o.status === 'refunded') {
    return ctx.reply(`↩️ El proveedor rechazó el pedido #${o.id}${o.failure_reason ? `: ${esc(o.failure_reason)}` : ''}. Tu saldo fue devuelto.`, { parse_mode: 'HTML', reply_markup: after });
  }
  if (o.status === 'action_required') {
    await askForCode(o);
  } else {
    await ctx.reply(`⏳ <b>Pedido #${o.id} en proceso</b>\n${esc(o.product_name)}\n\nNormalmente tarda unos segundos. Te aviso aquí en cuanto esté listo.`, { parse_mode: 'HTML', reply_markup: after });
  }
  // revisiones rápidas para entregar lo antes posible
  for (const delay of [5000, 15000, 40000, 90000]) {
    setTimeout(async () => {
      const cur2 = await one('SELECT * FROM orders WHERE id=$1', [o.id]);
      if (cur2 && ['pending', 'processing', 'action_required'].includes(cur2.status)) await refreshOrder(cur2);
    }, delay);
  }
}

// ===================== BÚSQUEDA =====================
export async function doSearch(ctx, q) {
  q = q.trim().slice(0, 60);
  if (q.length < 2) return ctx.reply('Escribe al menos 2 letras.');
  const lower = q.toLowerCase();
  const prods = (await visibleProducts()).filter((p) => p.name.toLowerCase().includes(lower)).slice(0, 10);
  let games = [];
  try {
    games = ((await kokoro.games({ q })).games || []).filter((g) => !isHidden(g.id)).slice(0, 10);
  } catch { /* juegos no disponibles */ }
  if (!prods.length && !games.length) return ctx.reply(`😕 No encontré nada para "${q}". Prueba con otra palabra o explora la tienda.`, { reply_markup: new InlineKeyboard().text('🛍 Ver tienda', 'st').text('🏠 Menú', 'm') });
  const kb = new InlineKeyboard();
  for (const p of prods) kb.text(`${iconOf(p.name)} ${cut(p.name, 36)} · ${fmtS(productUnitPrice(p))}`, `p:${ref(p.id)}`).row();
  for (const g of games) {
    const from = gameFromPrice(g);
    kb.text(`🎮 ${cut(g.name, 36)}${from ? ` · desde ${fmtS(from)}` : ''}`, `gg:${ref(g.id)}`).row();
  }
  navRow(kb, 'st');
  await ctx.reply(`🔎 <b>Resultados para "${esc(q)}"</b>\n${LINE}\n${prods.length + games.length} encontrados:`, { parse_mode: 'HTML', reply_markup: kb });
}

// ===================== REGISTRO =====================
export function registerShop(bot) {
  bot.callbackQuery(/^pl:(\d+)$/, (ctx) => showStore(ctx));
  bot.callbackQuery('st', (ctx) => showStore(ctx));
  // Renovar desde el recordatorio: abre el mismo producto (o su equivalente más barato hoy)
  bot.callbackQuery(/^rn:(\d+)$/, async (ctx) => {
    const o = await one('SELECT * FROM orders WHERE id=$1 AND user_id=$2', [Number(ctx.match[1]), ctx.from.id]);
    const list = await visibleProducts();
    const p = o && (list.find((x) => x.name === o.product_name) || list.find((x) => x.id === o.product_id));
    return p ? showProduct(ctx, ref(p.id)) : showStore(ctx);
  });
  bot.callbackQuery('top', (ctx) => showTop(ctx));
  bot.callbackQuery(/^c:(\w+):(\d+)$/, (ctx) => showCategory(ctx, ctx.match[1], Number(ctx.match[2])));
  bot.callbackQuery(/^p:(.+)$/, (ctx) => showProduct(ctx, ctx.match[1]));
  bot.callbackQuery(/^pq:(.+):(\d+)$/, (ctx) => startProductPurchase(ctx, ctx.match[1], Number(ctx.match[2])));
  bot.callbackQuery(/^pqx:(.+)$/, async (ctx) => {
    await setState(ctx.from.id, { step: 'qty', productKey: ctx.match[1] });
    await ctx.reply('🔢 Escribe la cantidad que quieres comprar:', { reply_markup: cancelKb() });
  });

  bot.callbackQuery(/^g:(\w+):(\d+)$/, (ctx) => showGames(ctx, ctx.match[1], Number(ctx.match[2])));
  bot.callbackQuery(/^gg:(.+)$/, (ctx) => showGame(ctx, ctx.match[1]));
  bot.callbackQuery(/^gr:(.+):([^:]+):(\d+)$/, (ctx) => showGame(ctx, ctx.match[1], ctx.match[2] === '-' ? null : ctx.match[2], Number(ctx.match[3])));
  bot.callbackQuery(/^pk:(.+):([^:]+)$/, (ctx) => showPack(ctx, ctx.match[1], ctx.match[2]));
  bot.callbackQuery(/^pb:(.+):([^:]+):(\d+)$/, (ctx) => startGamePurchase(ctx, ctx.match[1], ctx.match[2], Number(ctx.match[3])));
  bot.callbackQuery('gs', async (ctx) => {
    await setState(ctx.from.id, { step: 'search' });
    await ctx.reply('🔎 Escribe el nombre del juego o producto (ej: free fire, netflix, steam):', { reply_markup: cancelKb() });
  });
  bot.callbackQuery(/^fs:(\d+)$/, async (ctx) => {
    const st = ctx.dbUser.state;
    const f = st?.step === 'field' ? st.draft.ask[st.draft.i] : null;
    const opt = f?.options?.[Number(ctx.match[1])];
    if (!opt) return ctx.reply('⚠️ Opción expirada. Empieza la compra de nuevo.');
    await ctx.editMessageReplyMarkup().catch(() => {});
    return setField(ctx, st.draft, opt.value);
  });

  bot.callbackQuery('ok', async (ctx) => {
    const st = ctx.dbUser.state;
    if (st?.step !== 'confirm') return ctx.reply('⚠️ Esta compra expiró. Empieza de nuevo.');
    await setState(ctx.from.id, null); // evita doble clic
    await ctx.editMessageReplyMarkup().catch(() => {});
    await ctx.replyWithChatAction('typing');
    return st.draft.type === 'product' ? executeProduct(ctx, st.draft) : executeGame(ctx, st.draft);
  });
}

// Mensajes de texto según el paso en que está el cliente. Devuelve true si lo manejó.
export async function handleShopText(ctx, st, text) {
  switch (st?.step) {
    case 'search':
      await setState(ctx.from.id, null);
      await doSearch(ctx, text);
      return true;
    case 'qty': {
      const qty = parseInt(text, 10);
      if (!qty || qty < 1 || qty > 1000) {
        await ctx.reply('Escribe un número válido (ej: 3).');
        return true;
      }
      await setState(ctx.from.id, null);
      await startProductPurchase(ctx, st.productKey, qty);
      return true;
    }
    case 'activation':
      if (text.length > 200) {
        await ctx.reply('Es demasiado largo, revisa el dato.');
        return true;
      }
      await confirmProduct(ctx, { ...st.draft, activation: text.trim() });
      return true;
    case 'field': {
      const v = text.trim();
      if (!v || v.length > 120) {
        await ctx.reply('Dato no válido, inténtalo de nuevo.');
        return true;
      }
      await setField(ctx, st.draft, v);
      return true;
    }
    case 'supercell_code': {
      const code = text.trim().replace(/\s+/g, '');
      if (!/^[A-Za-z0-9._-]{3,20}$/.test(code)) {
        await ctx.reply('El código debe tener de 3 a 20 letras o números, sin espacios.');
        return true;
      }
      const o = await one('SELECT * FROM orders WHERE id=$1 AND user_id=$2', [st.orderId, ctx.from.id]);
      if (!o || o.status !== 'action_required') {
        await setState(ctx.from.id, null);
        await ctx.reply('Este pedido ya no está esperando un código.');
        return true;
      }
      try {
        await sendConfirmationCode(o, code);
        await setState(ctx.from.id, null);
        await ctx.reply(`✅ Código enviado. Tu pedido #${o.id} se completará en unos minutos y te aviso aquí.`);
        for (const d of [20000, 60000, 180000]) {
          setTimeout(async () => {
            const c = await one('SELECT * FROM orders WHERE id=$1', [o.id]);
            if (c && ['processing', 'action_required'].includes(c.status)) await refreshOrder(c);
          }, d);
        }
      } catch (e) {
        await ctx.reply(`❌ ${errorEs(e)}`);
      }
      return true;
    }
    default:
      return false;
  }
}
