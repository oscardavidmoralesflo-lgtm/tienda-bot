import { Bot, InlineKeyboard, GrammyError } from 'grammy';
import { config, isAdmin } from '../config.js';
import { one, many, query } from '../db.js';
import { kokoro } from '../kokoro.js';
import { s, num } from '../settings.js';
import { money } from '../pricing.js';
import { upsertUser, getUser, setState, credit, userOrders, referralStats } from '../users.js';
import { setNotifier, refreshOrder, formatDelivery, stats } from '../orders.js';
import { esc, fmtDate, STATUS_ES } from '../util.js';
import { MENU, mainKeyboard, show, cancelKb } from './ui.js';
import { registerShop, handleShopText, showProducts, showGames } from './shop.js';

export function createBot() {
  const bot = new Bot(config.botToken);
  const cur = () => s('currency');

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
    if (ctx.dbUser.isNew && ctx.dbUser.referred_by) {
      await sendTo(ctx.dbUser.referred_by, `👥 <b>${esc(ctx.from.first_name || 'Alguien')}</b> se unió con tu enlace de invitación. Ganarás el ${num('referral_percent')}% de sus compras.`);
    }
    const admin = isAdmin(ctx.from.id);
    if (ctx.dbUser.banned && !admin) return ctx.reply('🚫 Tu cuenta está bloqueada. Contacta a soporte: ' + s('support_contact'));
    if (s('maintenance') === '1' && !admin) return ctx.reply('🛠 Estamos en mantenimiento. Vuelve en un rato.');
    return next();
  });

  // responde siempre a los botones para que no queden "cargando"
  bot.on('callback_query', async (ctx, next) => {
    try {
      await next();
    } finally {
      await ctx.answerCallbackQuery().catch(() => {});
    }
  });

  // ---------- comandos ----------
  const welcome = async (ctx) => {
    await setState(ctx.from.id, null);
    const text = s('welcome_text')
      .replaceAll('{name}', esc(ctx.from.first_name || ''))
      .replaceAll('{shop}', esc(s('shop_name')));
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: mainKeyboard() });
  };
  bot.command(['start', 'menu'], welcome);
  bot.command('cancelar', async (ctx) => {
    await setState(ctx.from.id, null);
    await ctx.reply('Operación cancelada.', { reply_markup: mainKeyboard() });
  });
  bot.callbackQuery('x', async (ctx) => {
    await setState(ctx.from.id, null);
    await ctx.editMessageReplyMarkup().catch(() => {});
    await ctx.reply('❌ Cancelado.', { reply_markup: mainKeyboard() });
  });
  bot.callbackQuery('noop', () => {});

  // ---------- saldo ----------
  const showBalance = async (ctx) => {
    const u = await getUser(ctx.from.id);
    const tx = await many('SELECT * FROM transactions WHERE user_id=$1 ORDER BY id DESC LIMIT 5', [ctx.from.id]);
    let text = `💰 <b>Tu saldo:</b> ${money(u.balance)} ${cur()}\n🆔 Tu ID: <code>${u.id}</code>`;
    if (tx.length) {
      text += '\n\n<b>Últimos movimientos</b>';
      const names = { recharge: 'Recarga', purchase: 'Compra', refund: 'Reembolso', adjust: 'Ajuste', referral: 'Referido' };
      for (const t of tx) text += `\n${t.amount >= 0 ? '🟢 +' : '🔴 '}${money(t.amount)} · ${names[t.type] || t.type}${t.note ? ` · ${esc(t.note).slice(0, 40)}` : ''}`;
    }
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text(MENU.recharge, 'recharge') });
  };
  bot.command('saldo', showBalance);

  // ---------- recargas ----------
  const startRecharge = async (ctx) => {
    await setState(ctx.from.id, { step: 'recharge_amount' });
    await ctx.reply(
      `${s('payment_instructions')}\n\n✍️ Escribe el <b>monto</b> que vas a recargar (mínimo ${money(num('min_recharge'))} ${cur()}):`,
      { parse_mode: 'HTML', reply_markup: cancelKb() },
    );
  };
  bot.command('recargar', startRecharge);
  bot.callbackQuery('recharge', startRecharge);

  bot.on(['message:photo', 'message:document'], async (ctx, next) => {
    const st = ctx.dbUser.state;
    if (st?.step !== 'recharge_proof') return next();
    const photo = ctx.message.photo?.at(-1);
    const fileId = photo ? photo.file_id : ctx.message.document.file_id;
    const type = photo ? 'photo' : 'document';
    const r = await one('INSERT INTO recharges (user_id, amount, proof_file_id, proof_type) VALUES ($1,$2,$3,$4) RETURNING *', [
      ctx.from.id, st.amount, fileId, type,
    ]);
    await setState(ctx.from.id, null);
    await ctx.reply(`📨 Recibimos tu comprobante (solicitud #${r.id} por ${money(st.amount)} ${cur()}).\nTe avisaremos apenas se acredite tu saldo.`, { reply_markup: mainKeyboard() });
    const caption = `💵 <b>Recarga #${r.id}</b>\nCliente: ${esc(ctx.from.first_name || '')} ${ctx.from.username ? '@' + esc(ctx.from.username) : ''} (<code>${ctx.from.id}</code>)\nMonto: <b>${money(st.amount)} ${cur()}</b>`;
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
    if (!orders.length) return show(ctx, '📦 Aún no tienes pedidos.');
    const kb = new InlineKeyboard();
    for (const o of orders) kb.text(`#${o.id} ${STATUS_ES[o.status]?.split(' ')[0] || ''} ${o.product_name.slice(0, 30)} · $${money(o.price)}`, `o:${o.id}`).row();
    await show(ctx, '📦 <b>Tus últimos pedidos</b>\nToca uno para ver los detalles:', kb);
  };
  bot.command('pedidos', showOrders);
  bot.callbackQuery('ol', showOrders);
  bot.callbackQuery(/^o:(\d+)$/, async (ctx) => {
    let o = await one('SELECT * FROM orders WHERE id=$1 AND user_id=$2', [Number(ctx.match[1]), ctx.from.id]);
    if (!o) return;
    if (['pending', 'processing', 'action_required'].includes(o.status)) o = await refreshOrder(o);
    let text = `📦 <b>Pedido #${o.id}</b>\n${esc(o.product_name)}\nCantidad: ${o.quantity}\nTotal: ${money(o.price)} ${cur()}\nEstado: ${STATUS_ES[o.status] || o.status}\nFecha: ${fmtDate(o.created_at)} UTC`;
    if (o.status === 'delivered') text += `\n\n${formatDelivery(o)}`;
    if (o.failure_reason && o.status === 'refunded') text += `\nMotivo: ${esc(o.failure_reason)}`;
    if (o.status === 'action_required') text += '\n\n📧 Escribe aquí el código de confirmación que Supercell envió a tu correo.';
    const kb = new InlineKeyboard();
    if (['pending', 'processing', 'action_required'].includes(o.status)) kb.text('🔄 Actualizar', `o:${o.id}`);
    kb.text('⬅️ Volver', 'ol');
    if (o.status === 'action_required') await setState(ctx.from.id, { step: 'supercell_code', orderId: o.id });
    await show(ctx, text, kb);
  });

  // ---------- referidos y soporte ----------
  const showReferrals = async (ctx) => {
    const st = await referralStats(ctx.from.id);
    const link = `https://t.me/${ctx.me.username}?start=ref${ctx.from.id}`;
    await ctx.reply(
      `👥 <b>Invita amigos y gana</b>\n\nGanas el <b>${num('referral_percent')}%</b> de cada compra que hagan tus invitados, directo a tu saldo.\n\n🔗 Tu enlace:\n<code>${link}</code>\n\n👤 Invitados: ${st.invited}\n💰 Ganado: ${money(st.earned)} ${cur()}`,
      { parse_mode: 'HTML' },
    );
  };
  const showSupport = (ctx) =>
    ctx.reply(`🆘 <b>Soporte</b>\n\n¿Tienes un problema con un pedido? Escríbenos: ${esc(s('support_contact'))}\nIndica el número de pedido (lo ves en 📦 Mis pedidos).`, { parse_mode: 'HTML' });
  bot.command('soporte', showSupport);

  // ---------- tienda ----------
  registerShop(bot);

  // ---------- admin en Telegram ----------
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
      `🛠 <b>Panel rápido</b>\n\n🏦 Saldo KOKORO: <b>${kb}</b>\n👤 Clientes: ${st.users} (+${st.users_today} hoy)\n🧾 Ventas: ${st.orders}\n💵 Facturado: ${money(st.revenue)} (hoy ${money(st.revenue_today)})\n📈 Ganancia: ${money(st.profit)} (hoy ${money(st.profit_today)})\n⏳ Pedidos abiertos: ${st.open_orders}\n💳 Recargas pendientes: ${st.pending_recharges}\n👛 Saldo total de clientes: ${money(st.customer_balances)}\n\n` +
        (config.publicUrl ? `🌐 Panel web: ${config.publicUrl}/admin\n\n` : '') +
        'Comandos:\n<code>/addsaldo ID MONTO</code> — sumar (o restar con negativo)\n<code>/usuario ID</code> — ver cliente',
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
      if (a > 0) await sendTo(Number(id), `💰 Se acreditaron <b>${money(a)} ${cur()}</b> a tu saldo. Saldo actual: <b>${money(bal)}</b>`);
    } catch (e) {
      await ctx.reply(`❌ ${e.message}`);
    }
  });
  bot.command('usuario', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    const u = await getUser(Number(ctx.match));
    if (!u) return ctx.reply('No encontrado');
    const o = await one("SELECT count(*)::int AS n, COALESCE(sum(price),0) AS t FROM orders WHERE user_id=$1 AND status='delivered'", [u.id]);
    await ctx.reply(`👤 ${esc(u.first_name || '')} ${u.username ? '@' + esc(u.username) : ''}\nID: <code>${u.id}</code>\nSaldo: ${money(u.balance)}\nCompras: ${o.n} (${money(o.t)})\nBloqueado: ${u.banned ? 'sí' : 'no'}\nAlta: ${fmtDate(u.created_at)}`, { parse_mode: 'HTML' });
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
       WHERE id=$1 AND status='pending' RETURNING *`,
      [id, approve ? 'approved' : 'rejected', by, amountOverride ?? null],
    );
    if (!r) return { ok: false, error: 'Ya fue procesada' };
    if (approve) {
      const bal = await credit(r.user_id, Number(r.amount), 'recharge', `Recarga #${r.id}`);
      await sendTo(r.user_id, `✅ <b>Recarga aprobada</b>\nSe acreditaron <b>${money(r.amount)} ${cur()}</b>. Saldo actual: <b>${money(bal)} ${cur()}</b>\n\n¡Gracias por tu compra! 🛍`);
    } else {
      await sendTo(r.user_id, `❌ Tu solicitud de recarga #${r.id} fue rechazada. Si crees que es un error, contacta a ${esc(s('support_contact'))}.`);
    }
    return { ok: true, recharge: r };
  }
  bot.handleRecharge = handleRecharge;

  // ---------- texto libre: menú y pasos ----------
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;
    const st = ctx.dbUser.state;
    const menuAction = Object.entries(MENU).find(([, label]) => label === text)?.[0];
    if (menuAction) {
      await setState(ctx.from.id, null);
      switch (menuAction) {
        case 'products': return showProducts(ctx, 0);
        case 'games': return showGames(ctx, 'topup', 0);
        case 'search':
          await setState(ctx.from.id, { step: 'search' });
          return ctx.reply('🔎 ¿Qué buscas? Escribe el nombre (ej: netflix, free fire, spotify):', { reply_markup: cancelKb() });
        case 'balance': return showBalance(ctx);
        case 'recharge': return startRecharge(ctx);
        case 'orders': return showOrders(ctx);
        case 'referrals': return showReferrals(ctx);
        case 'support': return showSupport(ctx);
      }
    }
    if (st?.step === 'recharge_amount') {
      const amount = Number(text.replace(',', '.').replace(/[^\d.]/g, ''));
      if (!amount || amount < num('min_recharge') || amount > 100000) {
        return ctx.reply(`Escribe un monto válido (mínimo ${money(num('min_recharge'))}).`);
      }
      await setState(ctx.from.id, { step: 'recharge_proof', amount });
      return ctx.reply(`📸 Perfecto: ${money(amount)} ${cur()}.\nAhora envía la <b>captura o foto del comprobante</b> de pago.`, { parse_mode: 'HTML', reply_markup: cancelKb() });
    }
    if (st?.step === 'recharge_proof') return ctx.reply('📸 Envía la captura del comprobante como imagen (o /cancelar).');
    if (await handleShopText(ctx, st, text)) return;
    // cualquier otro texto = búsqueda rápida
    if (text.length >= 2 && !text.startsWith('/')) {
      const { doSearch } = await import('./shop.js');
      return doSearch(ctx, text);
    }
    return ctx.reply('Usa el menú de abajo 👇', { reply_markup: mainKeyboard() });
  });

  bot.catch((err) => {
    console.error('Error en el bot:', err.error?.message || err.error);
    err.ctx?.reply('⚠️ Ocurrió un error. Inténtalo de nuevo en un momento.').catch(() => {});
  });

  return bot;
}

export async function setupCommands(bot) {
  await bot.api.setMyCommands([
    { command: 'start', description: 'Menú principal' },
    { command: 'saldo', description: 'Ver mi saldo' },
    { command: 'recargar', description: 'Recargar saldo' },
    { command: 'pedidos', description: 'Mis pedidos' },
    { command: 'soporte', description: 'Ayuda y soporte' },
    { command: 'cancelar', description: 'Cancelar la operación actual' },
  ]);
}
