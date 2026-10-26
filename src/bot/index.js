import { Bot, InlineKeyboard, GrammyError } from 'grammy';
import { config, isAdmin } from '../config.js';
import { one, many, query } from '../db.js';
import { kokoro } from '../kokoro.js';
import { s, num, saveSettings } from '../settings.js';
import { money, cop, productUnitPrice, fmt, fmtS, copMode, copRate, round4 } from '../pricing.js';
import { upsertUser, getUser, setState, setLang, credit, userOrders, referralStats } from '../users.js';
import { setNotifier, refreshOrder, formatDelivery, stats } from '../orders.js';
import { esc, fmtDate } from '../util.js';
import { iconOf } from '../categories.js';
import { levelOf } from '../loyalty.js';
import { t, localName, userLang, rememberLang, normLang } from '../i18n.js';
import { MENU, LEGACY, LINE, show, cancelKb, navRow, cut } from './ui.js';
import { bold, boldEnabled } from '../bold.js';
import { registerShop, handleShopText, showStore, showGames, bestSellers, doSearch } from './shop.js';

// "100000:3,200000:5" → % de bono para un monto en pesos
export function rechargeBonusPct(pesos) {
  let pct = 0;
  for (const part of String(s('recharge_bonus') || '').split(',')) {
    const [min, p] = part.split(':').map((x) => Number(String(x).trim()));
    if (Number.isFinite(min) && Number.isFinite(p) && pesos >= min) pct = Math.max(pct, p);
  }
  return pct;
}
const bonusTiers = () => String(s('recharge_bonus') || '').split(',')
  .map((x) => x.split(':').map((y) => Number(String(y).trim())))
  .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > 0)
  .sort((a, b) => a[0] - b[0]);
const pesosTxt = (n) => `$${Number(n).toLocaleString('es-CO')}`;

export function createBot() {
  const bot = new Bot(config.botToken);
  const cur = () => s('currency');
  const T = (ctx, key, vars) => t(ctx.lang, key, vars);
  const textSetting = (ctx, key) => (ctx.lang === 'en' ? s(`${key}_en`) || s(key) : s(key));

  // ---------- avisos (los usa el motor de pedidos y el panel) ----------
  const sendTo = async (chatId, html, extra = {}) => {
    try {
      await bot.api.sendMessage(chatId, html, { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra });
      return true;
    } catch (e) {
      if (e instanceof GrammyError && e.error_code === 403) await query('UPDATE users SET blocked_bot=TRUE WHERE id=$1', [chatId]);
      else console.error('sendTo', chatId, e.message);
      return false;
    }
  };
  const notifyAdmins = async (html, extra) => {
    for (const id of config.adminIds) await sendTo(id, html, extra);
  };
  setNotifier({ user: sendTo, admins: notifyAdmins });
  bot.notify = { user: sendTo, admins: notifyAdmins };

  // ---------- middleware ----------
  bot.use(async (ctx, next) => {
    if (!ctx.from || ctx.chat?.type !== 'private') return;
    const text = ctx.message?.text || '';
    const refMatch = text.match(/^\/start\s+ref(\d+)/);
    ctx.dbUser = await upsertUser(ctx.from, refMatch ? Number(refMatch[1]) : null);
    ctx.lang = normLang(ctx.dbUser.lang);
    if (ctx.dbUser.isNew && ctx.dbUser.referred_by) {
      const rl = await userLang(ctx.dbUser.referred_by);
      sendTo(ctx.dbUser.referred_by, t(rl, 'ref_joined', { name: esc(ctx.from.first_name || '—'), pct: num('referral_percent') }));
    }
    const admin = isAdmin(ctx.from.id);
    if (ctx.dbUser.banned && !admin) return ctx.reply(T(ctx, 'blocked', { c: s('support_contact') }));
    if (s('maintenance') === '1' && !admin) return ctx.reply(T(ctx, 'maintenance'));
    // primera vez: elegir idioma antes de cualquier otra cosa
    if (!ctx.dbUser.lang && !/^lang:/.test(ctx.callbackQuery?.data || '')) return askLanguage(ctx);
    return next();
  });

  // responde al botón al instante (quita el "cargando" sin esperar a que termine la acción)
  bot.on('callback_query', async (ctx, next) => {
    ctx.answerCallbackQuery().catch(() => {});
    await next();
  });

  const clearState = async (ctx) => {
    if (ctx.dbUser?.state) await setState(ctx.from.id, null);
  };

  // ---------- idioma ----------
  async function askLanguage(ctx) {
    const kb = new InlineKeyboard().text('🇪🇸 Español', 'lang:es').text('🇺🇸 English', 'lang:en');
    const name = s('shop_name');
    await show(ctx, `✦ <b>${esc(name)}</b>\n${LINE}\n${t('es', 'lang_pick')}`, kb);
  }
  bot.callbackQuery(/^lang:(es|en)$/, async (ctx) => {
    const lang = ctx.match[1];
    await setLang(ctx.from.id, lang);
    rememberLang(ctx.from.id, lang);
    ctx.lang = lang;
    ctx.dbUser.lang = lang;
    await mainMenu(ctx);
  });
  bot.command(['idioma', 'language'], askLanguage);
  bot.callbackQuery('lang', askLanguage);

  // ---------- menú principal ----------
  const mainMenu = async (ctx) => {
    await clearState(ctx);
    const u = ctx.dbUser;
    const top = await bestSellers(5);
    const greeting = textSetting(ctx, 'welcome_text').replaceAll('{name}', esc(ctx.from.first_name || '')).replaceAll('{shop}', esc(s('shop_name')));
    let text = `${greeting}\n${LINE}\n`;
    if (top.length) {
      text += `${T(ctx, 'menu_top')}\n`;
      text += top.map((p, i) => `${['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][i]} ${esc(cut(localName(p.name, ctx.lang), 38))} — <b>${fmtS(productUnitPrice(p))}</b>`).join('\n');
      text += `\n${LINE}\n`;
    }
    text += T(ctx, 'menu_balance', { bal: fmt(u.balance), id: u.id });
    const kb = new InlineKeyboard()
      .text(T(ctx, 'btn_store'), 'st').text(T(ctx, 'btn_games'), 'g:topup:0').row()
      .text(T(ctx, 'btn_top'), 'top').text(T(ctx, 'btn_search'), 'gs').row()
      .text(T(ctx, 'btn_recharge'), 'recharge').text(T(ctx, 'btn_profile'), 'pf').row()
      .text(T(ctx, 'btn_orders'), 'ol').text(T(ctx, 'btn_ref'), 'ref').row()
      .text(T(ctx, 'btn_support'), 'sup').text(T(ctx, 'btn_lang'), 'lang');
    const channel = s('channel_url');
    if (/^https:\/\/t\.me\//.test(channel)) kb.row().url(T(ctx, 'btn_channel'), channel);
    await show(ctx, text, kb);
  };

  bot.command(['start', 'menu'], async (ctx) => {
    // quita el teclado viejo de abajo (el menú ahora va dentro del mensaje)
    ctx.reply('✦', { reply_markup: { remove_keyboard: true } })
      .then((m) => ctx.api.deleteMessage(ctx.chat.id, m.message_id))
      .catch(() => {});
    await mainMenu(ctx);
  });
  bot.callbackQuery('m', mainMenu);
  bot.command(['cancelar', 'cancel'], async (ctx) => {
    await setState(ctx.from.id, null);
    await ctx.reply(T(ctx, 'cancelled_op'), { reply_markup: new InlineKeyboard().text(T(ctx, 'btn_menu'), 'm') });
  });
  bot.callbackQuery('x', async (ctx) => {
    await setState(ctx.from.id, null);
    await ctx.editMessageReplyMarkup().catch(() => {});
    await ctx.reply(T(ctx, 'cancelled'), { reply_markup: new InlineKeyboard().text(T(ctx, 'btn_menu'), 'm').text(T(ctx, 'btn_store'), 'st') });
  });
  bot.callbackQuery('noop', () => {});

  // ---------- perfil ----------
  const showProfile = async (ctx) => {
    const u = await getUser(ctx.from.id);
    const o = await one("SELECT count(*)::int AS n, COALESCE(sum(price),0) AS t FROM orders WHERE user_id=$1 AND status='delivered'", [u.id]);
    const r = await referralStats(u.id);
    const lvl = levelOf(Number(o.t), ctx.lang);
    const text = T(ctx, 'profile', {
      line: LINE,
      name: `${esc(u.first_name || '')}${u.username ? ` (@${esc(u.username)})` : ''}`,
      id: u.id,
      level: `${lvl.name}${lvl.pct ? T(ctx, 'napa_line', { pct: lvl.pct }) : ''}`,
      next: lvl.next ? T(ctx, 'next_level', { amt: fmt(lvl.next.missing), lvl: lvl.next.name, pct: lvl.next.pct }) : '',
      bal: fmt(u.balance),
      n: o.n,
      total: fmt(o.t),
      inv: r.invited,
      earned: fmt(r.earned),
      since: fmtDate(u.created_at).slice(0, 10),
    });
    const kb = new InlineKeyboard()
      .text(T(ctx, 'btn_recharge'), 'recharge').text(T(ctx, 'btn_orders'), 'ol').row()
      .text(T(ctx, 'btn_tx'), 'tx').text(T(ctx, 'btn_ref'), 'ref').row()
      .text(T(ctx, 'btn_lang'), 'lang');
    await show(ctx, text, navRow(kb, null, ctx.lang));
  };
  bot.callbackQuery('pf', showProfile);
  bot.command(['saldo', 'balance'], showProfile);

  bot.callbackQuery('tx', async (ctx) => {
    const tx = await many('SELECT * FROM transactions WHERE user_id=$1 ORDER BY id DESC LIMIT 12', [ctx.from.id]);
    let text = `${T(ctx, 'tx_title')}\n${LINE}\n`;
    text += tx.length
      ? tx.map((x) => `${x.amount >= 0 ? '🟢 +' : '🔴 −'}${fmt(Math.abs(x.amount))} · ${T(ctx, `tx_${x.type}`)}${x.note && x.type === 'purchase' ? ` · ${esc(cut(localName(x.note, ctx.lang), 28))}` : ''}\n<i>${fmtDate(x.created_at)}</i>`).join('\n')
      : T(ctx, 'tx_empty');
    await show(ctx, text, navRow(new InlineKeyboard(), 'pf', ctx.lang));
  });

  // ---------- recargas ----------
  // En modo pesos el cliente elige/escribe pesos; el saldo se guarda en USD con la tasa del momento.
  const minCop = () => Math.ceil((num('min_recharge') * copRate()) / 1000) * 1000;
  const startRecharge = async (ctx) => {
    await setState(ctx.from.id, { step: 'recharge_amount' });
    const qr = s('payment_qr');
    if (qr) ctx.replyWithPhoto(qr, { caption: T(ctx, 'qr_caption') }).catch(() => {});
    let text = `${T(ctx, 'rc_title')}\n${LINE}\n${textSetting(ctx, 'payment_instructions')}\n${LINE}\n`;
    const kb = new InlineKeyboard();
    if (copMode()) {
      const tiers = bonusTiers();
      if (tiers.length) text += `${T(ctx, 'rc_bonus_hint', { list: tiers.map(([a, p]) => T(ctx, 'rc_bonus_item', { pct: p, amt: pesosTxt(a) })).join(' · ') })}\n`;
      text += T(ctx, 'rc_pick_cop', { min: pesosTxt(minCop()) });
      [20000, 50000, 100000, 200000].filter((a) => a >= minCop()).forEach((a, i) => {
        const pct = rechargeBonusPct(a);
        kb.text(`${pesosTxt(a)}${pct ? ` 🎉+${pct}%` : ''}`, `amc:${a}`);
        if (i % 2 === 1) kb.row();
      });
    } else {
      const min = num('min_recharge');
      if (cop(1)) text += `${T(ctx, 'rc_rate', { cur: cur(), rate: cop(1) })}\n`;
      text += T(ctx, 'rc_pick_usd', { min: fmt(min) });
      [5, 10, 20, 50].filter((a) => a >= min).forEach((a, i) => {
        kb.text(`${a} ${cur()}`, `amt:${a}`);
        if (i % 2 === 1) kb.row();
      });
    }
    kb.row().text(T(ctx, 'btn_cancel'), 'x');
    await show(ctx, text, kb);
  };
  bot.command(['recargar', 'topup'], startRecharge);
  bot.callbackQuery('recharge', startRecharge);

  // amount = USD que se acreditan; pesos = lo que el cliente paga (en modo pesos)
  const askProof = async (ctx, amount, pesos = null) => {
    await setState(ctx.from.id, { step: 'recharge_proof', amount, cop: pesos });
    const pct = pesos ? rechargeBonusPct(pesos) : 0;
    const text =
      `${T(ctx, 'rc_proof_title', { amt: pesos ? `${pesosTxt(pesos)} COP` : fmt(amount) })}\n${LINE}\n` +
      (!pesos && cop(amount) ? `${T(ctx, 'rc_must_pay', { amt: cop(amount) })}\n` : '') +
      (pct ? `${T(ctx, 'rc_bonus_note', { pct })}\n` : '') +
      T(ctx, 'rc_steps');
    await show(ctx, text, cancelKb(ctx.lang));
  };
  bot.callbackQuery(/^amt:(\d+)$/, (ctx) => askProof(ctx, Number(ctx.match[1])));
  bot.callbackQuery(/^amc:(\d+)$/, (ctx) => {
    const pesos = Number(ctx.match[1]);
    return chooseMethod(ctx, round4(pesos / copRate()), pesos);
  });

  // ---------- recarga automática con Bold ----------
  // total que paga el cliente en línea (monto + % de la pasarela, redondeado a la centena)
  const onlineTotal = (pesos) => Math.ceil((pesos * (1 + num('bold_surcharge') / 100)) / 100) * 100;
  const chooseMethod = async (ctx, amount, pesos) => {
    if (!pesos || !boldEnabled()) return askProof(ctx, amount, pesos);
    await setState(ctx.from.id, { step: 'recharge_method', amount, cop: pesos });
    const pct = rechargeBonusPct(pesos);
    const fee = num('bold_surcharge');
    const total = onlineTotal(pesos);
    const text = T(ctx, 'rc_choose', {
      amt: `${pesosTxt(pesos)} COP`,
      bonus: pct ? ` · 🎉 +${pct}%` : '',
      line: LINE,
      fee: fee > 0 ? T(ctx, 'rc_fee_note', { pct: fee }) : '',
    });
    const kb = new InlineKeyboard()
      .text(T(ctx, 'btn_pay_online', { total: pesosTxt(total) }), 'pon').row()
      .text(T(ctx, 'btn_pay_manual'), 'pmn').row()
      .text(T(ctx, 'btn_cancel'), 'x');
    await show(ctx, text, kb);
  };
  bot.callbackQuery('pmn', async (ctx) => {
    const st = ctx.dbUser.state;
    if (st?.step !== 'recharge_method') return startRecharge(ctx);
    return askProof(ctx, st.amount, st.cop);
  });
  bot.callbackQuery('pon', async (ctx) => {
    const st = ctx.dbUser.state;
    if (st?.step !== 'recharge_method' || !boldEnabled()) return startRecharge(ctx);
    await setState(ctx.from.id, null);
    const total = onlineTotal(st.cop);
    const r = await one(
      `INSERT INTO recharges (user_id, amount, amount_cop, method, status, bold_total) VALUES ($1,$2,$3,'bold','link',$4) RETURNING *`,
      [ctx.from.id, st.amount, st.cop, total],
    );
    const ref = `${config.shopPrefix}rc${r.id}t${Date.now().toString(36)}`;
    try {
      const link = await bold.createLink({ pesos: total, reference: ref, description: `${s('shop_name')} · Recarga #${r.id}` });
      if (!link.url) throw new Error('Bold no devolvió el link');
      await query('UPDATE recharges SET bold_link=$2, bold_url=$3, bold_ref=$4 WHERE id=$1', [r.id, link.id, link.url, ref]);
      const kb = new InlineKeyboard().url(T(ctx, 'btn_open_link', { total: pesosTxt(total) }), link.url).row().text(T(ctx, 'btn_menu'), 'm');
      await show(ctx, T(ctx, 'rc_link', { amt: `${pesosTxt(st.cop)} COP`, line: LINE, total: `${pesosTxt(total)} COP` }), kb);
    } catch (e) {
      console.error('Bold link', e.message);
      await query("UPDATE recharges SET status='failed', handled_by=$2 WHERE id=$1", [r.id, `bold: ${String(e.message).slice(0, 80)}`]);
      await setState(ctx.from.id, { step: 'recharge_method', amount: st.amount, cop: st.cop });
      await show(ctx, T(ctx, 'rc_link_error'), new InlineKeyboard().text(T(ctx, 'btn_pay_manual'), 'pmn').row().text(T(ctx, 'btn_menu'), 'm'));
    }
  });

  // El admin configura el QR de cobro enviándole al bot la foto con el texto /qr
  bot.on('message:photo', async (ctx, next) => {
    if (!isAdmin(ctx.from.id) || !String(ctx.message.caption || '').toLowerCase().startsWith('/qr')) return next();
    await saveSettings({ payment_qr: ctx.message.photo.at(-1).file_id });
    await ctx.reply('✅ QR de cobro guardado. Los clientes lo verán al recargar. (Para quitarlo: /qr_borrar)');
  });
  bot.command('qr_borrar', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await saveSettings({ payment_qr: '' });
    await ctx.reply('🗑 QR de cobro eliminado.');
  });

  bot.on(['message:photo', 'message:document'], async (ctx, next) => {
    const st = ctx.dbUser.state;
    if (st?.step !== 'recharge_proof') return next();
    const photo = ctx.message.photo?.at(-1);
    const fileId = photo ? photo.file_id : ctx.message.document.file_id;
    const type = photo ? 'photo' : 'document';
    const r = await one('INSERT INTO recharges (user_id, amount, amount_cop, proof_file_id, proof_type) VALUES ($1,$2,$3,$4,$5) RETURNING *', [
      ctx.from.id, st.amount, st.cop || null, fileId, type,
    ]);
    await setState(ctx.from.id, null);
    const paid = st.cop ? `${pesosTxt(st.cop)} COP` : fmt(st.amount);
    await ctx.reply(T(ctx, 'rc_received', { line: LINE, id: r.id, amt: paid }), {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard().text(T(ctx, 'btn_view_store'), 'st').text(T(ctx, 'btn_menu'), 'm'),
    });
    const pct = st.cop ? rechargeBonusPct(st.cop) : 0;
    const caption = `💵 <b>Recarga #${r.id}</b>\nCliente: ${esc(ctx.from.first_name || '')} ${ctx.from.username ? '@' + esc(ctx.from.username) : ''} (<code>${ctx.from.id}</code>) · ${ctx.lang.toUpperCase()}\nPagó: <b>${paid}</b>\nSe acreditan: <b>${money(st.amount)} USDT</b>${pct ? ` + bono ${pct}%` : ''}`;
    const kb = new InlineKeyboard().text('✅ Aprobar', `ra:${r.id}`).text('❌ Rechazar', `rr:${r.id}`);
    for (const id of config.adminIds) {
      try {
        const send = type === 'photo' ? bot.api.sendPhoto.bind(bot.api) : bot.api.sendDocument.bind(bot.api);
        await send(id, fileId, { caption, parse_mode: 'HTML', reply_markup: kb });
      } catch (e) {
        console.error('aviso recarga', e.message);
      }
    }
  });

  // ---------- pedidos ----------
  const showOrders = async (ctx) => {
    const orders = await userOrders(ctx.from.id, 10);
    const kb = new InlineKeyboard();
    if (!orders.length) {
      kb.text(T(ctx, 'btn_go_store'), 'st');
      return show(ctx, `${T(ctx, 'orders_title')}\n${LINE}\n${T(ctx, 'orders_empty')}`, navRow(kb, null, ctx.lang));
    }
    for (const o of orders) kb.text(`${T(ctx, `st_${o.status}`).split(' ')[0]} #${o.id} · ${cut(localName(o.product_name, ctx.lang), 28)} · ${fmtS(o.price)}`, `o:${o.id}`).row();
    await show(ctx, `${T(ctx, 'orders_title')}\n${LINE}\n${T(ctx, 'orders_list', { n: orders.length })}`, navRow(kb, 'pf', ctx.lang));
  };
  bot.command(['pedidos', 'orders'], showOrders);
  bot.callbackQuery('ol', showOrders);
  bot.callbackQuery(/^o:(\d+)$/, async (ctx) => {
    let o = await one('SELECT * FROM orders WHERE id=$1 AND user_id=$2', [Number(ctx.match[1]), ctx.from.id]);
    if (!o) return;
    if (['pending', 'processing', 'action_required'].includes(o.status)) o = await refreshOrder(o);
    let text = T(ctx, 'order_detail', {
      id: o.id, line: LINE, icon: iconOf(o.product_name), name: esc(localName(o.product_name, ctx.lang)),
      q: o.quantity, total: fmt(o.price), status: T(ctx, `st_${o.status}`), date: fmtDate(o.created_at),
    });
    if (o.status === 'delivered') text += `\n${LINE}\n${formatDelivery(o)}`;
    if (o.failure_reason && o.status === 'refunded') text += T(ctx, 'order_reason', { r: esc(o.failure_reason) });
    if (o.status === 'action_required') text += T(ctx, 'supercell_prompt');
    const kb = new InlineKeyboard();
    if (['pending', 'processing', 'action_required'].includes(o.status)) kb.text(T(ctx, 'btn_refresh'), `o:${o.id}`);
    kb.text(T(ctx, 'btn_help_order'), 'sup');
    if (o.status === 'action_required') await setState(ctx.from.id, { step: 'supercell_code', orderId: o.id });
    await show(ctx, text, navRow(kb, 'ol', ctx.lang));
  });

  // ---------- referidos y soporte ----------
  const showReferrals = async (ctx) => {
    const st = await referralStats(ctx.from.id);
    const link = `https://t.me/${ctx.me.username}?start=ref${ctx.from.id}`;
    const text = T(ctx, 'ref_body', { line: LINE, pct: num('referral_percent'), link, inv: st.invited, earned: fmt(st.earned) });
    const share = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(T(ctx, 'ref_share_text', { shop: s('shop_name') }))}`;
    await show(ctx, text, navRow(new InlineKeyboard().url(T(ctx, 'btn_share'), share), 'pf', ctx.lang));
  };
  bot.callbackQuery('ref', showReferrals);

  const showSupport = (ctx) =>
    show(ctx, T(ctx, 'support_body', { line: LINE, c: esc(s('support_contact')) }), navRow(new InlineKeyboard().text(T(ctx, 'btn_orders'), 'ol'), null, ctx.lang));
  bot.command(['soporte', 'support'], showSupport);
  bot.callbackQuery('sup', showSupport);

  // ---------- tienda ----------
  registerShop(bot);

  // ---------- admin en Telegram (siempre en español) ----------
  bot.command('admin', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    const st = await stats();
    let kb = '';
    try {
      kb = `${money((await kokoro.balance()).balance)} USDT`;
    } catch (e) {
      kb = `error: ${esc(e.message)}`;
    }
    await ctx.reply(
      `🛠 <b>Panel rápido</b>\n${LINE}\n🏦 Saldo KOKORO: <b>${kb}</b>\n👤 Clientes: ${st.users} (+${st.users_today} hoy)\n🧾 Ventas: ${st.orders}\n💵 Facturado: ${money(st.revenue)} (hoy ${money(st.revenue_today)})\n📈 Ganancia: ${money(st.profit)} (hoy ${money(st.profit_today)})\n⏳ Pedidos abiertos: ${st.open_orders}\n💳 Recargas pendientes: ${st.pending_recharges}\n👛 Saldo total de clientes: ${money(st.customer_balances)}\n\n` +
        (config.publicUrl ? `🌐 Panel web: ${config.publicUrl}/admin\n\n` : '') +
        'Comandos:\n<code>/addsaldo ID MONTO</code> — sumar (o restar con negativo)\n<code>/usuario ID</code> — ver cliente\nFoto con <code>/qr</code> — QR de cobro',
      { parse_mode: 'HTML', link_preview_options: { is_disabled: true } },
    );
  });
  bot.command('addsaldo', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    const [id, amount] = ctx.match.split(/\s+/);
    const a = Number(amount);
    if (!Number(id) || !a) return ctx.reply('Uso: /addsaldo ID MONTO');
    try {
      const bal = await credit(Number(id), a, a > 0 ? 'recharge' : 'adjust', `Admin ${ctx.from.id}`);
      await ctx.reply(`✅ Nuevo saldo de ${id}: ${money(bal)}`);
      const ul = await userLang(Number(id));
      if (a > 0) await sendTo(Number(id), t(ul, 'credited', { amt: fmt(a), bal: fmt(bal) }), { reply_markup: new InlineKeyboard().text(t(ul, 'btn_go_store'), 'st') });
    } catch (e) {
      await ctx.reply(`❌ ${e.message}`);
    }
  });
  bot.command('usuario', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    const u = await getUser(Number(ctx.match));
    if (!u) return ctx.reply('No encontrado');
    const o = await one("SELECT count(*)::int AS n, COALESCE(sum(price),0) AS t FROM orders WHERE user_id=$1 AND status='delivered'", [u.id]);
    await ctx.reply(`👤 ${esc(u.first_name || '')} ${u.username ? '@' + esc(u.username) : ''}\nID: <code>${u.id}</code>\nIdioma: ${u.lang || '—'}\nSaldo: ${money(u.balance)}\nCompras: ${o.n} (${money(o.t)})\nBloqueado: ${u.banned ? 'sí' : 'no'}\nAlta: ${fmtDate(u.created_at)}`, { parse_mode: 'HTML' });
  });

  bot.callbackQuery(/^r([ar]):(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    const approve = ctx.match[1] === 'a';
    const res = await handleRecharge(Number(ctx.match[2]), approve, `tg:${ctx.from.id}`);
    const note = res.ok ? (approve ? `\n\n✅ APROBADA por ${esc(ctx.from.first_name)}` : `\n\n❌ RECHAZADA por ${esc(ctx.from.first_name)}`) : `\n\n⚠️ ${res.error}`;
    const cap = (ctx.callbackQuery.message?.caption || '') + note;
    await ctx.editMessageCaption({ caption: cap, parse_mode: 'HTML' }).catch(() => {});
  });

  async function handleRecharge(id, approve, by, amountOverride) {
    const r = await one(
      `UPDATE recharges SET status=$2, handled_by=$3, handled_at=now(), amount=COALESCE($4, amount)
       WHERE id=$1 AND status IN ('pending','link') RETURNING *`,
      [id, approve ? 'approved' : 'rejected', by, amountOverride ?? null],
    );
    if (!r) return { ok: false, error: 'Ya fue procesada' };
    const ul = await userLang(r.user_id);
    if (approve) {
      let bal = await credit(r.user_id, Number(r.amount), 'recharge', `Recarga #${r.id}`);
      // bono por recarga grande (según lo que pagó en pesos)
      const pesos = Number(r.amount_cop) || (copRate() ? Number(r.amount) * copRate() : 0);
      const pct = rechargeBonusPct(pesos);
      let bonusTxt = '';
      if (pct > 0) {
        const bonus = round4((Number(r.amount) * pct) / 100);
        bal = await credit(r.user_id, bonus, 'bonus', `Bono ${pct}% recarga #${r.id}`);
        bonusTxt = t(ul, 'rc_approved_bonus', { amt: fmt(bonus) });
      }
      await sendTo(r.user_id, t(ul, 'rc_approved', { line: LINE, amt: fmt(r.amount), bonus: bonusTxt, bal: fmt(bal) }), {
        reply_markup: new InlineKeyboard().text(t(ul, 'btn_go_store'), 'st').text(t(ul, 'btn_top'), 'top'),
      });
    } else {
      await sendTo(r.user_id, t(ul, 'rc_rejected', { id: r.id, c: esc(s('support_contact')) }), { reply_markup: new InlineKeyboard().text(t(ul, 'btn_support'), 'sup') });
    }
    return { ok: true, recharge: r };
  }
  bot.handleRecharge = handleRecharge;

  // Webhook de Bold: SALE_APPROVED acredita la recarga; SALE_REJECTED avisa al cliente
  async function findBoldRecharge(reference) {
    if (!reference) return null;
    return one("SELECT * FROM recharges WHERE method='bold' AND (bold_link=$1 OR bold_ref=$1) ORDER BY id DESC LIMIT 1", [reference]);
  }
  bot.handleBoldEvent = async (ev) => {
    const data = ev?.data || {};
    const ref = data.metadata?.reference || data.reference;
    const r = await findBoldRecharge(ref);
    if (!r) return { ok: false, reason: 'recarga no encontrada' };
    if (ev.type === 'SALE_APPROVED') {
      if (r.status !== 'link') return { ok: true, reason: 'ya procesada' };
      const paid = Number(data.amount?.total || 0);
      if (paid && Number(r.bold_total) && paid + 1 < Number(r.bold_total)) {
        await notifyAdmins(`⚠️ Bold: la recarga #${r.id} se pagó con un monto menor (${pesosTxt(paid)} de ${pesosTxt(r.bold_total)}). Revísala en el panel.`);
        await query("UPDATE recharges SET status='pending', handled_by='bold: monto menor' WHERE id=$1 AND status='link'", [r.id]);
        return { ok: false, reason: 'monto menor' };
      }
      return handleRecharge(r.id, true, `bold:${data.payment_method || 'online'}`);
    }
    if (ev.type === 'SALE_REJECTED' && r.status === 'link') {
      const ul = await userLang(r.user_id);
      const kb = r.bold_url ? new InlineKeyboard().url(t(ul, 'btn_open_link', { total: pesosTxt(r.bold_total) }), r.bold_url) : undefined;
      await sendTo(r.user_id, t(ul, 'rc_link_rejected', { id: r.id }), kb ? { reply_markup: kb } : {});
    }
    return { ok: true };
  };
  // Por si un webhook no llega: revisa los links abiertos (cada pocos minutos)
  bot.pollBold = async () => {
    if (!boldEnabled()) return;
    const open = await many("SELECT * FROM recharges WHERE method='bold' AND status='link' AND bold_link IS NOT NULL ORDER BY id LIMIT 20");
    for (const r of open) {
      try {
        const l = await bold.getLink(r.bold_link);
        const st = l.status || l.payload?.status;
        if (st === 'PAID') await handleRecharge(r.id, true, 'bold:verificado');
        else if (['EXPIRED', 'CANCELLED'].includes(st) || Date.now() - new Date(r.created_at).getTime() > 48 * 3600_000) {
          await query("UPDATE recharges SET status='expired', handled_at=now() WHERE id=$1 AND status='link'", [r.id]);
        }
      } catch (e) {
        console.error('Bold poll', r.id, e.message);
      }
    }
  };

  // ---------- texto libre: atajos, pasos y búsqueda ----------
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;
    const st = ctx.dbUser.state;
    const action = Object.entries(MENU).find(([, label]) => label === text)?.[0] || LEGACY[text];
    if (action) {
      await clearState(ctx);
      switch (action) {
        case 'home': return mainMenu(ctx);
        case 'store': return showStore(ctx);
        case 'games': return showGames(ctx, 'topup', 0);
        case 'search':
          await setState(ctx.from.id, { step: 'search' });
          return ctx.reply(T(ctx, 'ask_search'), { reply_markup: cancelKb(ctx.lang) });
        case 'profile': return showProfile(ctx);
        case 'recharge': return startRecharge(ctx);
        case 'orders': return showOrders(ctx);
        case 'referrals': return showReferrals(ctx);
        case 'support': return showSupport(ctx);
      }
    }
    if (st?.step === 'recharge_amount') {
      if (copMode()) {
        const pesos = Number(text.replace(/[^\d]/g, ''));
        if (!pesos || pesos < minCop() || pesos > 20_000_000) return ctx.reply(T(ctx, 'rc_bad_cop', { min: pesosTxt(minCop()) }));
        return chooseMethod(ctx, round4(pesos / copRate()), pesos);
      }
      const amount = Number(text.replace(',', '.').replace(/[^\d.]/g, ''));
      if (!amount || amount < num('min_recharge') || amount > 100000) {
        return ctx.reply(T(ctx, 'rc_bad_usd', { cur: cur(), min: fmt(num('min_recharge')) }));
      }
      return askProof(ctx, amount);
    }
    if (st?.step === 'recharge_proof') return ctx.reply(T(ctx, 'rc_send_photo'));
    if (await handleShopText(ctx, st, text)) return;
    // cualquier otro texto = búsqueda rápida
    if (text.length >= 2 && !text.startsWith('/')) return doSearch(ctx, text);
    return mainMenu(ctx);
  });

  bot.catch((err) => {
    console.error('Error en el bot:', err.error?.message || err.error);
    const lang = err.ctx?.lang || 'es';
    err.ctx?.reply(t(lang, 'generic_error'), { reply_markup: new InlineKeyboard().text(t(lang, 'btn_menu'), 'm') }).catch(() => {});
  });

  return bot;
}

export async function setupCommands(bot) {
  const shop = s('shop_name');
  await bot.api.setMyCommands([
    { command: 'start', description: '🏠 Menú principal' },
    { command: 'saldo', description: '👤 Mi perfil y saldo' },
    { command: 'recargar', description: '💰 Recargar saldo' },
    { command: 'pedidos', description: '📦 Mis pedidos' },
    { command: 'soporte', description: '🆘 Ayuda y soporte' },
    { command: 'idioma', description: '🌐 Cambiar idioma' },
    { command: 'cancelar', description: '❌ Cancelar la operación actual' },
  ]);
  await bot.api.setMyCommands([
    { command: 'start', description: '🏠 Main menu' },
    { command: 'balance', description: '👤 My profile & balance' },
    { command: 'topup', description: '💰 Top up balance' },
    { command: 'orders', description: '📦 My orders' },
    { command: 'support', description: '🆘 Help & support' },
    { command: 'language', description: '🌐 Change language' },
    { command: 'cancel', description: '❌ Cancel current action' },
  ], { language_code: 'en' }).catch(() => {});
  // Nombre y descripción (español por defecto, inglés para Telegram en inglés)
  await bot.api.setMyName(shop).catch(() => {});
  await bot.api.setMyDescription(
    `${shop.toUpperCase()} — Acceso premium\n\n` +
      'Inteligencia artificial, streaming, diseño y software original, en pesos colombianos.\n\n' +
      '• Entrega automática e inmediata, 24/7\n• Garantía y soporte en español e inglés\n• Recompensas en saldo en cada compra\n• Aviso antes de que venza tu suscripción',
  ).catch(() => {});
  await bot.api.setMyDescription(
    `${shop.toUpperCase()} — Premium access\n\n` +
      'Premium AI, streaming, design and original software.\n\n' +
      '• Instant automatic delivery, 24/7\n• Warranty and support in English and Spanish\n• Balance rewards on every purchase\n• Reminder before your subscription expires',
    { language_code: 'en' },
  ).catch(() => {});
  await bot.api.setMyShortDescription(`${shop} — IA, streaming y software premium. Entrega inmediata y garantía.`).catch(() => {});
  await bot.api.setMyShortDescription(`${shop} — Premium AI, streaming and software. Instant delivery and warranty.`, { language_code: 'en' }).catch(() => {});
}
