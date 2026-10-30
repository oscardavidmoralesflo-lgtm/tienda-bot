// Catálogo, juegos, búsqueda y compra (bilingüe: ctx.lang = 'es' | 'en')
import { InlineKeyboard } from 'grammy';
import crypto from 'node:crypto';
import { kokoro } from '../kokoro.js';
import * as catalog from '../catalog.js';
import { productUnitPrice, productUnitCost, packPrice, gameFromPrice, isHidden, getOverride, fmt, fmtS, round4, copMode } from '../pricing.js';
import { s } from '../settings.js';
import { getUser, setState } from '../users.js';
import { buyProduct, buyGamePack, refreshOrder, askForCode, formatDelivery, sendConfirmationCode } from '../orders.js';
import { one, many } from '../db.js';
import { esc, tgHtml, ref, deref } from '../util.js';
import { DISPLAY_ORDER, CAT_BY_KEY, categoryOf, iconOf, catLabel } from '../categories.js';
import { t, errorText, localName } from '../i18n.js';
import { show, pager, cut, cancelKb, navRow, stockIcon, LINE } from './ui.js';

const PER_PAGE = 8;
const cur = () => copMode() ? 'COP' : s('currency');
const T = (ctx, key, vars) => t(ctx.lang, key, vars);
const en = (ctx) => ctx.lang === 'en';
// textos de los proveedores en el idioma del cliente
const pick = (ctx, es, other) => (en(ctx) ? other || es : es || other);
const termsOf = p => crypto.createHash('sha256').update(JSON.stringify([p.id,p.name,p.description_es,p.description_en,p.requires_activation_data,p.activation_data_type,p.input_fields,p.min_order,p.max_order])).digest('hex');

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
  DISPLAY_ORDER.filter((c) => count[c.key]).forEach((c, i) => {
    kb.text(`${c.icon} ${catLabel(c, ctx.lang)} (${count[c.key]})`, `c:${c.key}:0`);
    if (i % 2 === 1) kb.row();
  });
  kb.row().text(T(ctx, 'btn_top'), 'top').text(T(ctx, 'btn_search'), 'gs');
  navRow(kb, null, ctx.lang);
  const total = Object.values(count).reduce((a, b) => a + b, 0);
  await show(ctx, T(ctx, 'store_title', { line: LINE, n: total }), kb);
}
export const showProducts = (ctx) => showStore(ctx);

async function showCategory(ctx, key, page = 0) {
  const cat = CAT_BY_KEY[key] || CAT_BY_KEY.other;
  const list = (await visibleProducts()).filter((p) => categoryOf(p.name).key === cat.key);
  const kb = new InlineKeyboard();
  for (const p of list.slice(page * PER_PAGE, (page + 1) * PER_PAGE)) {
    kb.text(`${iconOf(p.name)} ${cut(localName(p.name, ctx.lang), 34)} · ${fmtS(productUnitPrice(p))}${p.stock > 0 ? '' : T(ctx, 'sold_out_tag')}`, `p:${ref(p.id)}`).row();
  }
  pager(kb, `c:${cat.key}:`, page, list.length, PER_PAGE);
  navRow(kb, 'st', ctx.lang);
  const avail = list.filter((p) => p.stock > 0).length;
  await show(ctx, T(ctx, 'cat_title', { icon: cat.icon, label: catLabel(cat, ctx.lang), line: LINE, n: avail, cur: cur() }), kb);
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
  for (const re of [/^gemini ai pro 18/i, /^chatgpt plus 1 mes/i, /^capcut pro team/i, /^canva pro edu/i, /^youtube premium 3/i, /^spotify premium 3/i, /^prime video 6/i, /^netflix/i]) {
    add(inStock.find((p) => re.test(p.name)));
  }
  return picked;
}

async function showTop(ctx) {
  const top = await bestSellers(10);
  const kb = new InlineKeyboard();
  top.forEach((p, i) => kb.text(`${['🥇', '🥈', '🥉'][i] || '⭐'} ${cut(localName(p.name, ctx.lang), 34)} · ${fmtS(productUnitPrice(p))}`, `p:${ref(p.id)}`).row());
  navRow(kb, 'st', ctx.lang);
  await show(ctx, T(ctx, 'top_title', { line: LINE }), kb);
}

async function findProduct(key, fresh = false) {
  const id = deref(key);
  if (!id) return null;
  const p = await catalog.findProduct(id, fresh);
  if (!p || isHidden(p.id)) return null;
  return p.displayName ? { ...p, name: p.displayName } : p;
}

export async function showProduct(ctx, key) {
  const p = await findProduct(key);
  if (!p) return show(ctx, T(ctx, 'not_available'), navRow(new InlineKeyboard(), 'st', ctx.lang));
  const cat = categoryOf(p.name);
  const unit = productUnitPrice(p);
  const stockTxt = p.stock > 0 ? (p.stock >= 999 ? T(ctx, 'unlimited') : p.stock) : T(ctx, 'sold_out');
  let text = `${iconOf(p.name)} <b>${esc(localName(p.name, ctx.lang))}</b>\n${LINE}\n`;
  text += `${T(ctx, 'p_price', { p: fmt(unit) })}\n`;
  text += `${T(ctx, 'p_stock', { s: `${stockIcon(p.stock)} ${stockTxt}` })}\n`;
  text += `${T(ctx, 'p_delivery')}\n`;
  text += T(ctx, 'p_cat', { c: `${cat.icon} ${catLabel(cat, ctx.lang)}` });
  if (p.min_order > 1) text += `\n${T(ctx, 'p_min', { n: p.min_order })}`;
  const tiers = (p.bulk_discounts || []).filter((x) => x.min_qty > 1);
  if (tiers.length) {
    text += `\n\n${T(ctx, 'p_bulk')}`;
    for (const x of tiers) text += `\n${T(ctx, 'p_bulk_item', { q: x.min_qty, p: fmt(productUnitPrice(p, x.min_qty)) })}`;
  }
  const desc = tgHtml(pick(ctx, p.description_es, p.description_en), 1500);
  if (desc) text += `\n${LINE}\n${desc}`;

  const kb = new InlineKeyboard();
  if (p.stock > 0) {
    const min = Math.max(1, p.min_order || 1);
    const opts = [...new Set([min, 2, 5, 10].filter((q) => q >= min && q <= p.stock))].slice(0, 4);
    kb.text(T(ctx, 'btn_buy_now', { price: fmtS(unit * min) }), `pq:${ref(p.id)}:${min}`).row();
    for (const q of opts.filter((q) => q !== min)) kb.text(`x${q}`, `pq:${ref(p.id)}:${q}`);
    kb.text(T(ctx, 'btn_other_qty'), `pqx:${ref(p.id)}`);
  } else {
    kb.text(T(ctx, 'btn_sold_out'), 'noop');
  }
  navRow(kb, `c:${cat.key}:0`, ctx.lang);
  await show(ctx, text, kb);
}

async function startProductPurchase(ctx, key, qty) {
  const p = await findProduct(key);
  if (!p) return show(ctx, T(ctx, 'not_available'));
  if (qty < (p.min_order || 1)) return ctx.reply(T(ctx, 'min_order_err', { n: p.min_order }));
  if (qty > p.stock) return ctx.reply(T(ctx, 'only_stock', { n: p.stock }));
  const draft = { type: 'product', productId: p.id, qty };
  if (p.requires_activation_data) {
    await setState(ctx.from.id, { step: 'activation', draft });
    const what = T(ctx, `what_${p.activation_data_type || 'default'}`);
    return ctx.reply(T(ctx, 'activation_need', { what: what.startsWith('what_') ? T(ctx, 'what_default') : what }), { reply_markup: cancelKb(ctx.lang) });
  }
  return confirmProduct(ctx, draft);
}

function confirmKeyboard(ctx, enough) {
  const kb = new InlineKeyboard();
  if (enough) kb.text(T(ctx, 'btn_confirm_pay'), 'ok').row().text(T(ctx, 'btn_cancel'), 'x');
  else kb.text(T(ctx, 'btn_recharge'), 'recharge').row().text(T(ctx, 'btn_cancel'), 'x');
  return kb;
}

async function confirmProduct(ctx, draft) {
  const p = await findProduct(draft.productId);
  if (!p) return ctx.reply(T(ctx, 'not_available'));
  const unit = productUnitPrice(p, draft.qty);
  const total = round4(unit * draft.qty);
  const u = await getUser(ctx.from.id);
  await setState(ctx.from.id, { step: 'confirm', draft: { ...draft, total, terms:termsOf(p) } });
  let text = `${T(ctx, 'confirm_title')}\n${LINE}\n${iconOf(p.name)} ${esc(localName(p.name, ctx.lang))}\n${T(ctx, 'c_qty', { q: draft.qty })}\n${T(ctx, 'c_unit', { p: fmt(unit) })}\n${LINE}\n${T(ctx, 'c_total', { t: fmt(total) })}`;
  if (draft.activation) text += `\n${T(ctx, 'c_data', { d: esc(draft.activation) })}`;
  text += `\n${T(ctx, 'c_balance', { b: fmt(u.balance) })}`;
  const enough = Number(u.balance) >= total;
  if (!enough) text += `\n\n${T(ctx, 'c_missing', { m: fmt(total - Number(u.balance)) })}`;
  await show(ctx, text, confirmKeyboard(ctx, enough));
}

async function executeProduct(ctx, draft) {
  let p;
  try { p=await findProduct(draft.productId,true); }
  catch { return ctx.reply(T(ctx,'quote_unavailable')); }
  if (!p || p.stock < draft.qty) return ctx.reply(T(ctx, 'no_stock_now'));
  const unit = productUnitPrice(p, draft.qty);
  if(!draft.terms || draft.terms!==termsOf(p) || round4(unit*draft.qty)>Number(draft.total)+0.0001) {
    await ctx.reply(T(ctx,'price_changed'));
    return confirmProduct(ctx,draft);
  }
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
const KINDS = ['topup', 'giftcard', 'key'];

export async function showGames(ctx, kind = 'topup', page = 0) {
  let data;
  try {
    data = await kokoro.games({ kind });
  } catch (e) {
    return show(ctx, `⚠️ ${esc(errorText(e, ctx.lang))}`, navRow(new InlineKeyboard(), null, ctx.lang));
  }
  const games = (data.games || []).filter((g) => !isHidden(g.id));
  const kb = new InlineKeyboard();
  for (const k of KINDS) {
    const label = T(ctx, `kind_${k}`);
    kb.text(k === kind ? `✅ ${label.split(' ').slice(1).join(' ')}` : label, `g:${k}:0`);
  }
  kb.row();
  for (const g of games.slice(page * PER_PAGE, (page + 1) * PER_PAGE)) {
    const from = gameFromPrice(g);
    kb.text(`${g.emoji_base ? g.emoji_base + ' ' : ''}${cut(g.name, 34)}${from ? T(ctx, 'from_price', { p: fmtS(from) }) : ''}`, `gg:${ref(g.id)}`).row();
  }
  pager(kb, `g:${kind}:`, page, games.length, PER_PAGE);
  kb.row().text(T(ctx, 'btn_search_game'), 'gs');
  navRow(kb, null, ctx.lang);
  await show(ctx, T(ctx, 'games_title', { line: LINE, kind: T(ctx, `kind_${kind}`), empty: games.length ? '' : T(ctx, 'games_empty') }), kb);
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
    return show(ctx, `⚠️ ${esc(errorText(e, ctx.lang))}`);
  }
  if (!g) return show(ctx, T(ctx, 'menu_expired'));
  const { game, packs } = g;
  if (!packs.length) return show(ctx, T(ctx, 'no_packs', { g: esc(game.name) }));
  const regions = [...new Map(packs.map((p) => [p.region || '-', pick(ctx, p.region_name_es, p.region_name) || p.region || 'Global'])).entries()];
  const gk = ref(game.id);
  if (regions.length > 1 && !region) {
    const kb = new InlineKeyboard();
    regions.forEach(([slug, name], i) => {
      kb.text(cut(name, 30), `gr:${gk}:${slug}:0`);
      if (i % 2 === 1) kb.row();
    });
    navRow(kb, `g:${game.kind || 'topup'}:0`, ctx.lang);
    return show(ctx, `${game.emoji_base || '🎮'} <b>${esc(game.name)}</b>\n${LINE}\n${T(ctx, 'pick_region')}`, kb);
  }
  const list = region ? packs.filter((p) => (p.region || '-') === region) : packs;
  const kb = new InlineKeyboard();
  for (const p of list.slice(page * PER_PAGE, (page + 1) * PER_PAGE)) {
    kb.text(`${cut(p.pack || p.name, 34)} · ${fmtS(packPrice(p, game.id))}`, `pk:${gk}:${ref(p.id)}`).row();
  }
  pager(kb, `gr:${gk}:${region || '-'}:`, page, list.length, PER_PAGE);
  navRow(kb, regions.length > 1 ? `gg:${gk}` : `g:${game.kind || 'topup'}:0`, ctx.lang);
  const regionName = region ? regions.find(([s2]) => s2 === region)?.[1] : null;
  await show(ctx, `${game.emoji_base || '🎮'} <b>${esc(game.name)}</b>${regionName ? ` — ${esc(regionName)}` : ''}\n${LINE}\n${T(ctx, 'pick_pack')}`, kb);
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
  if (!r) return show(ctx, T(ctx, 'pack_unavailable'));
  const { game, pack } = r;
  const price = packPrice(pack, game.id);
  let text = `${game.emoji_base || '🎮'} <b>${esc(game.name)}</b>\n💎 <b>${esc(pack.pack || pack.name)}</b>\n${LINE}\n${T(ctx, 'p_price', { p: fmt(price) })}`;
  const regionName = pick(ctx, pack.region_name_es, pack.region_name);
  if (regionName) text += `\n${T(ctx, 'pk_region', { r: esc(regionName) })}`;
  const dt = pick(ctx, pack.delivery_time_es, pack.delivery_time);
  if (dt) text += `\n${T(ctx, 'pk_delivery', { d: esc(dt) })}`;
  text += `\n${T(ctx, pack.delivery === 'code' ? 'pk_code' : 'pk_account')}`;
  if (pack.account_region === 'US') text += `\n${T(ctx, 'pk_us')}`;
  if (pack.requires_confirmation_code) text += `\n${T(ctx, 'pk_supercell')}`;
  const extra = tgHtml(pick(ctx, pack.description_es, pack.description), 800);
  if (extra) text += `\n\n${extra}`;
  const how = en(ctx)
    ? pack.how_to_activate || pack.how_to_redeem || pack.how_to_activate_es || pack.how_to_redeem_es
    : pack.how_to_activate_es || pack.how_to_redeem_es || pack.how_to_activate || pack.how_to_redeem;
  if (how) text += `\n\n${T(ctx, 'pk_how')}\n${tgHtml(how, 800)}`;

  const gk = ref(game.id);
  const pkk = ref(pack.id);
  const kb = new InlineKeyboard();
  kb.text(T(ctx, 'btn_buy_now', { price: fmtS(price) }), `pb:${gk}:${pkk}:1`);
  if (pack.delivery === 'code') {
    const max = Math.min(pack.max_quantity || 10, 10);
    kb.row();
    for (const q of [2, 3, 5].filter((q) => q <= max)) kb.text(`x${q}`, `pb:${gk}:${pkk}:${q}`);
  }
  navRow(kb, pack.region ? `gr:${gk}:${pack.region}:0` : `gg:${gk}`, ctx.lang);
  await show(ctx, text, kb);
}

function fieldsToAsk(ctx, pack, game) {
  const f = (pack.fields || []).filter((x) => x.required !== false);
  const list = f.map((x) => ({
    key: x.key,
    label: pick(ctx, x.label_es, x.label) || x.key,
    hint: pick(ctx, x.hint_es, x.hint) || '',
    type: x.type,
    options: x.options,
  }));
  if ((game.kind === 'key' || pack.platform) && !list.some((x) => x.key === 'country')) {
    list.push({ key: '__country', label: T(ctx, 'country_field'), hint: T(ctx, 'country_hint'), type: 'country' });
  }
  return list;
}

async function startGamePurchase(ctx, gameKey, packKey, qty) {
  const r = await getPack(gameKey, packKey);
  if (!r) return show(ctx, T(ctx, 'pack_unavailable'));
  const draft = { type: 'game', gameId: r.game.id, packId: r.pack.id, qty, fields: {}, ask: fieldsToAsk(ctx, r.pack, r.game), i: 0 };
  return askNextField(ctx, draft);
}

async function askNextField(ctx, draft) {
  const f = draft.ask[draft.i];
  if (!f) return validateAndConfirmGame(ctx, draft);
  await setState(ctx.from.id, { step: 'field', draft });
  const head = `✍️ <b>${esc(f.label)}</b>${f.hint ? `\n<i>${esc(f.hint)}</i>` : ''}`;
  if (f.type === 'select' && f.options?.length) {
    const kb = new InlineKeyboard();
    f.options.slice(0, 40).forEach((o, i) => {
      kb.text(cut(o.label || o.value, 30), `fs:${i}`);
      if (i % 2 === 1) kb.row();
    });
    kb.row().text(T(ctx, 'btn_cancel'), 'x');
    return ctx.reply(head, { parse_mode: 'HTML', reply_markup: kb });
  }
  return ctx.reply(`${head}\n\n${T(ctx, 'type_here')}`, { parse_mode: 'HTML', reply_markup: cancelKb(ctx.lang) });
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
  if (!r) return ctx.reply(T(ctx, 'pack_unavailable'));
  const { game, pack } = r;
  const retryKb = new InlineKeyboard().text(T(ctx, 'btn_retry'), `pb:${ref(game.id)}:${ref(pack.id)}:${draft.qty}`);
  let check = '';
  if (pack.validation && pack.validation !== 'none') {
    await ctx.replyWithChatAction('typing');
    try {
      const v = await kokoro.validate({ product_id: pack.id, fields: draft.fields });
      if (v.valid === false || v.region_matches === false) {
        await setState(ctx.from.id, null);
        const msg = v.region_matches === false
          ? T(ctx, 'region_mismatch', { r: esc(v.account_region_name || v.account_region) })
          : esc(en(ctx) ? v.message || T(ctx, 'account_not_found') : T(ctx, 'account_not_found'));
        return ctx.reply(`❌ ${msg}`, { parse_mode: 'HTML', reply_markup: retryKb });
      }
      if (v.player_name) check += `\n${T(ctx, 'player', { p: esc(v.player_name) })}`;
      if (v.account_region_name) check += `\n${T(ctx, 'acc_region', { r: esc(v.account_region_name) })}`;
    } catch (e) {
      if (e.definitelyNotCharged && e.status === 400) {
        await setState(ctx.from.id, null);
        return ctx.reply(`❌ ${esc(errorText(e, ctx.lang))}`, { parse_mode: 'HTML', reply_markup: retryKb });
      }
      // si la verificación no está disponible, se puede comprar igual
    }
  }
  const unit = packPrice(pack, game.id);
  const total = round4(unit * draft.qty);
  const u = await getUser(ctx.from.id);
  await setState(ctx.from.id, { step: 'confirm', draft: { ...draft, total } });
  let text = `${T(ctx, 'confirm_title')}\n${LINE}\n🎮 ${esc(game.name)} — ${esc(pack.pack || pack.name)}${draft.qty > 1 ? ` x${draft.qty}` : ''}`;
  for (const f of draft.ask) {
    const val = f.key === '__country' ? draft.country : draft.fields[f.key];
    const label = f.options?.find((o) => o.value === val)?.label || val;
    text += `\n${esc(f.label)}: <code>${esc(label)}</code>`;
  }
  text += check;
  text += `\n${LINE}\n${T(ctx, 'c_total', { t: fmt(total) })}\n${T(ctx, 'c_balance', { b: fmt(u.balance) })}`;
  const enough = Number(u.balance) >= total;
  if (!enough) text += `\n\n${T(ctx, 'c_missing', { m: fmt(total - Number(u.balance)) })}`;
  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: confirmKeyboard(ctx, enough) });
}

async function executeGame(ctx, draft) {
  const r = await getPack(ref(draft.gameId), ref(draft.packId));
  if (!r) return ctx.reply(T(ctx, 'pack_unavailable'));
  if(round4(packPrice(r.pack,r.game.id)*draft.qty)>Number(draft.total)+0.0001) {
    await ctx.reply(T(ctx,'price_changed'));
    return validateAndConfirmGame(ctx,draft);
  }
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
    return ctx.reply(T(ctx, 'insufficient'), { reply_markup: new InlineKeyboard().text(T(ctx, 'btn_recharge'), 'recharge').text(T(ctx, 'btn_menu'), 'm') });
  }
  const after = new InlineKeyboard().text(T(ctx, 'btn_orders'), 'ol').text(T(ctx, 'btn_keep_shopping'), 'st').row().text(T(ctx, 'btn_menu'), 'm');
  if (!res.ok) return ctx.reply(T(ctx, 'purchase_failed', { m: esc(res.message) }), { parse_mode: 'HTML', reply_markup: after });
  const o = res.order;
  const name = esc(localName(o.product_name, ctx.lang));
  if (o.status === 'delivered') {
    return ctx.reply(T(ctx, 'purchase_ok', { line: LINE, id: o.id, name, p: fmt(o.price), delivery: formatDelivery(o) }), { parse_mode: 'HTML', reply_markup: after });
  }
  if (o.status === 'refunded') {
    return ctx.reply(T(ctx, 'provider_rejected', { id: o.id, r: o.failure_reason ? `: ${esc(o.failure_reason)}` : '' }), { parse_mode: 'HTML', reply_markup: after });
  }
  if (o.status === 'action_required') await askForCode(o);
  else await ctx.reply(T(ctx, 'processing', { id: o.id, name }), { parse_mode: 'HTML', reply_markup: after });
  // revisiones rápidas para entregar lo antes posible
  for (const delay of [5000, 15000, 40000, 90000]) {
    setTimeout(async () => {
      const c = await one('SELECT * FROM orders WHERE id=$1', [o.id]);
      if (c && ['pending', 'processing', 'action_required'].includes(c.status)) await refreshOrder(c);
    }, delay);
  }
}

// ===================== BÚSQUEDA =====================
export async function doSearch(ctx, q) {
  q = q.trim().slice(0, 60);
  if (q.length < 2) return ctx.reply(T(ctx, 'search_min'));
  const lower = q.toLowerCase();
  const prods = (await visibleProducts())
    .filter((p) => p.name.toLowerCase().includes(lower) || localName(p.name, 'en').toLowerCase().includes(lower))
    .slice(0, 10);
  let games = [];
  try {
    games = ((await kokoro.games({ q })).games || []).filter((g) => !isHidden(g.id)).slice(0, 10);
  } catch { /* juegos no disponibles */ }
  if (!prods.length && !games.length) {
    return ctx.reply(T(ctx, 'search_none', { q }), { reply_markup: new InlineKeyboard().text(T(ctx, 'btn_view_store'), 'st').text(T(ctx, 'btn_menu'), 'm') });
  }
  const kb = new InlineKeyboard();
  for (const p of prods) kb.text(`${iconOf(p.name)} ${cut(localName(p.name, ctx.lang), 36)} · ${fmtS(productUnitPrice(p))}`, `p:${ref(p.id)}`).row();
  for (const g of games) {
    const from = gameFromPrice(g);
    kb.text(`🎮 ${cut(g.name, 36)}${from ? T(ctx, 'from_price', { p: fmtS(from) }) : ''}`, `gg:${ref(g.id)}`).row();
  }
  navRow(kb, 'st', ctx.lang);
  await ctx.reply(T(ctx, 'search_title', { q: esc(q), line: LINE, n: prods.length + games.length }), { parse_mode: 'HTML', reply_markup: kb });
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
    await ctx.reply(T(ctx, 'ask_qty'), { reply_markup: cancelKb(ctx.lang) });
  });

  bot.callbackQuery(/^g:(\w+):(\d+)$/, (ctx) => showGames(ctx, ctx.match[1], Number(ctx.match[2])));
  bot.callbackQuery(/^gg:(.+)$/, (ctx) => showGame(ctx, ctx.match[1]));
  bot.callbackQuery(/^gr:(.+):([^:]+):(\d+)$/, (ctx) => showGame(ctx, ctx.match[1], ctx.match[2] === '-' ? null : ctx.match[2], Number(ctx.match[3])));
  bot.callbackQuery(/^pk:(.+):([^:]+)$/, (ctx) => showPack(ctx, ctx.match[1], ctx.match[2]));
  bot.callbackQuery(/^pb:(.+):([^:]+):(\d+)$/, (ctx) => startGamePurchase(ctx, ctx.match[1], ctx.match[2], Number(ctx.match[3])));
  bot.callbackQuery('gs', async (ctx) => {
    await setState(ctx.from.id, { step: 'search' });
    await ctx.reply(T(ctx, 'ask_search'), { reply_markup: cancelKb(ctx.lang) });
  });
  bot.callbackQuery(/^fs:(\d+)$/, async (ctx) => {
    const st = ctx.dbUser.state;
    const f = st?.step === 'field' ? st.draft.ask[st.draft.i] : null;
    const opt = f?.options?.[Number(ctx.match[1])];
    if (!opt) return ctx.reply(T(ctx, 'option_expired'));
    await ctx.editMessageReplyMarkup().catch(() => {});
    return setField(ctx, st.draft, opt.value);
  });

  bot.callbackQuery('ok', async (ctx) => {
    const st = ctx.dbUser.state;
    if (st?.step !== 'confirm') return ctx.reply(T(ctx, 'purchase_expired'));
    // Dos callbacks pueden leer el mismo estado antes de que termine el primero.
    const claimed=await one('UPDATE users SET state=NULL WHERE id=$1 AND state=$2::jsonb RETURNING id',[ctx.from.id,JSON.stringify(st)]);
    if(!claimed)return ctx.reply(T(ctx,'purchase_expired'));
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
        await ctx.reply(T(ctx, 'bad_number'));
        return true;
      }
      await setState(ctx.from.id, null);
      await startProductPurchase(ctx, st.productKey, qty);
      return true;
    }
    case 'activation':
      if (text.length > 200) {
        await ctx.reply(T(ctx, 'too_long'));
        return true;
      }
      await confirmProduct(ctx, { ...st.draft, activation: text.trim() });
      return true;
    case 'field': {
      const v = text.trim();
      if (!v || v.length > 120) {
        await ctx.reply(T(ctx, 'bad_value'));
        return true;
      }
      await setField(ctx, st.draft, v);
      return true;
    }
    case 'supercell_code': {
      const code = text.trim().replace(/\s+/g, '');
      if (!/^[A-Za-z0-9._-]{3,20}$/.test(code)) {
        await ctx.reply(T(ctx, 'code_format'));
        return true;
      }
      const o = await one('SELECT * FROM orders WHERE id=$1 AND user_id=$2', [st.orderId, ctx.from.id]);
      if (!o || o.status !== 'action_required') {
        await setState(ctx.from.id, null);
        await ctx.reply(T(ctx, 'code_not_waiting'));
        return true;
      }
      try {
        await sendConfirmationCode(o, code);
        await setState(ctx.from.id, null);
        await ctx.reply(T(ctx, 'code_sent', { id: o.id }));
        for (const d of [20000, 60000, 180000]) {
          setTimeout(async () => {
            const c = await one('SELECT * FROM orders WHERE id=$1', [o.id]);
            if (c && ['processing', 'action_required'].includes(c.status)) await refreshOrder(c);
          }, d);
        }
      } catch (e) {
        await ctx.reply(`❌ ${errorText(e, ctx.lang)}`);
      }
      return true;
    }
    default:
      return false;
  }
}
