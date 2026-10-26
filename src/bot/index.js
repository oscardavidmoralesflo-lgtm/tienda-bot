import { Bot, InlineKeyboard, GrammyError } from 'grammy';
import { config, isAdmin } from '../config.js';
import { one, many, query } from '../db.js';
import { kokoro } from '../kokoro.js';
import { s, num } from '../settings.js';
import { money, cop, copSuffix, productUnitPrice, fmt, fmtS, copMode, copRate, round4 } from '../pricing.js';
import { upsertUser, getUser, setState, credit, userOrders, referralStats } from '../users.js';
import { setNotifier, refreshOrder, formatDelivery, stats } from '../orders.js';
import { esc, fmtDate, STATUS_ES } from '../util.js';
import { iconOf } from '../categories.js';
import { levelOf } from '../loyalty.js';
import { MENU, LEGACY, LINE, show, cancelKb, navRow, cut } from './ui.js';
import { registerShop, handleShopText, showStore, showGames, bestSellers, doSearch } from './shop.js';

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
      sendTo(ctx.dbUser.referred_by, `🎉 <b>${esc(ctx.from.first_name || 'Alguien')}</b> se unió con tu enlace. Ganarás el ${num('referral_percent')}% de sus compras.`);
    }
    const admin = isAdmin(ctx.from.id);
    if (ctx.dbUser.banned && !admin) return ctx.reply('🚫 Tu cuenta está bloqueada. Contacta a soporte: ' + s('support_contact'));
    if (s('maintenance') === '1' && !admin) return ctx.reply('🛠 Estamos en mantenimiento. Vuelve en un rato.');
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

  // ---------- menú principal ----------
  const mainMenu = async (ctx) => {
    await clearState(ctx);
    const u = ctx.dbUser;
    const top = await bestSellers(5);
    const greeting = s('welcome_text').replaceAll('{name}', esc(ctx.from.first_name || '')).replaceAll('{shop}', esc(s('shop_name')));
    let text = `${greeting}\n${LINE}\n`;
    if (top.length) {
      text += '🔥 <b>Más vendidos</b>\n';
      text += top.map((p, i) => `${['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][i]} ${esc(cut(p.name, 38))} — <b>${fmtS(productUnitPrice(p))}</b>`).join('\n');
      text += `\n${LINE}\n`;
    }
    text += `💰 Tu saldo: <b>${fmt(u.balance)}</b>\n🆔 Tu ID: <code>${u.id}</code>`;
    const kb = new InlineKeyboard()
      .text('🛍 Tienda', 'st').text('🎮 Juegos y Gift Cards', 'g:topup:0').row()
      .text('🔥 Más vendidos', 'top').text('🔎 Buscar', 'gs').row()
      .text('💰 Recargar saldo', 'recharge').text('👤 Mi perfil', 'pf').row()
      .text('📦 Mis pedidos', 'ol').text('🎁 Invita y gana', 'ref').row()
      .text('🆘 Soporte', 'sup');
    const channel = s('channel_url');
    if (/^https:\/\/t\.me\//.test(channel)) kb.url('📢 Canal', channel);
    await show(ctx, text, kb);
  };

  bot.command(['start', 'menu'], async (ctx) => {
    // quita el teclado viejo de abajo (el menú ahora va dentro del mensaje, como las tiendas grandes)
    ctx.reply('⚡', { reply_markup: { remove_keyboard: true } })
      .then((m) => ctx.api.deleteMessage(ctx.chat.id, m.message_id))
      .catch(() => {});
    await mainMenu(ctx);
  });
  bot.callbackQuery('m', mainMenu);
  bot.command('cancelar', async (ctx) => {
    await setState(ctx.from.id, null);
    await ctx.reply('Operación cancelada.', { reply_markup: new InlineKeyboard().text('🏠 Menú', 'm') });
  });
  bot.callbackQuery('x', async (ctx) => {
    await setState(ctx.from.id, null);
    await ctx.editMessageReplyMarkup().catch(() => {});
    await ctx.reply('❌ Cancelado.', { reply_markup: new InlineKeyboard().text('🏠 Menú', 'm').text('🛍 Tienda', 'st') });
  });
  bot.callbackQuery('noop', () => {});

  // ---------- perfil ----------
  const showProfile = async (ctx) => {
    const u = await getUser(ctx.from.id);
    const o = await one("SELECT count(*)::int AS n, COALESCE(sum(price),0) AS t FROM orders WHERE user_id=$1 AND status='delivered'", [u.id]);
    const r = await referralStats(u.id);
    const lvl = levelOf(Number(o.t));
    const level = `${lvl.name}${lvl.pct ? ` · 🎁 Ñapa ${lvl.pct}% en cada compra` : ''}`;
    const nextLine = lvl.next ? `\n🚀 Te faltan <b>${fmt(lvl.next.missing)}</b> en compras para ${lvl.next.name} (ñapa ${lvl.next.pct}%)` : '';
    const text =
      `👤 <b>Mi perfil</b>\n${LINE}\n` +
      `🙋 ${esc(u.first_name || '')}${u.username ? ` (@${esc(u.username)})` : ''}\n` +
      `🆔 ID: <code>${u.id}</code>\n` +
      `🏅 Nivel: ${level}${nextLine}\n${LINE}\n` +
      `💰 Saldo: <b>${fmt(u.balance)}</b>\n` +
      `🛒 Compras: ${o.n} · Total: ${fmt(o.t)}\n` +
      `👥 Invitados: ${r.invited} · Ganado: ${fmt(r.earned)}\n` +
      `📅 Cliente desde: ${fmtDate(u.created_at).slice(0, 10)}`;
    const kb = new InlineKeyboard()
      .text('💰 Recargar saldo', 'recharge').text('📦 Mis pedidos', 'ol').row()
      .text('📜 Movimientos', 'tx').text('🎁 Invita y gana', 'ref');
    await show(ctx, text, navRow(kb));
  };
  bot.callbackQuery('pf', showProfile);
  bot.command('saldo', showProfile);

  bot.callbackQuery('tx', async (ctx) => {
    const tx = await many('SELECT * FROM transactions WHERE user_id=$1 ORDER BY id DESC LIMIT 12', [ctx.from.id]);
    const names = { recharge: 'Recarga', purchase: 'Compra', refund: 'Reembolso', adjust: 'Ajuste', referral: 'Comisión referido', cashback: '🎁 Ñapa' };
    let text = `📜 <b>Movimientos</b>\n${LINE}\n`;
    text += tx.length
      ? tx.map((t) => `${t.amount >= 0 ? '🟢 +' : '🔴 −'}${fmt(Math.abs(t.amount))} · ${names[t.type] || t.type}${t.note && t.type === 'purchase' ? ` · ${esc(cut(t.note, 28))}` : ''}\n<i>${fmtDate(t.created_at)}</i>`).join('\n')
      : 'Aún no tienes movimientos.';
    await show(ctx, text, navRow(new InlineKeyboard(), 'pf'));
  });

  // ---------- recargas ----------
  // En modo pesos el cliente elige/escribe pesos; el saldo se guarda en USD con la tasa del momento.
  const minCop = () => Math.ceil((num('min_recharge') * copRate()) / 1000) * 1000;
  const startRecharge = async (ctx) => {
    await setState(ctx.from.id, { step: 'recharge_amount' });
    const qr = s('payment_qr');
    if (qr) ctx.replyWithPhoto(qr, { caption: '📲 Escanea este QR desde la app de tu banco o Nequi (Bre-B)' }).catch(() => {});
    let text = `💰 <b>Recargar saldo</b>\n${LINE}\n${s('payment_instructions')}\n${LINE}\n`;
    const kb = new InlineKeyboard();
    if (copMode()) {
      text += `✍️ Elige cuánto recargar o escribe otro monto en pesos (mínimo <b>$${minCop().toLocaleString('es-CO')}</b>):`;
      [10000, 20000, 50000, 100000].filter((a) => a >= minCop()).forEach((a, i) => {
        kb.text(`$${a.toLocaleString('es-CO')}`, `amc:${a}`);
        if (i % 2 === 1) kb.row();
      });
    } else {
      const min = num('min_recharge');
      if (cop(1)) text += `💱 Tasa: 1 ${cur()} = <b>${cop(1)}</b>\n`;
      text += `✍️ Elige un monto o escribe otro (mínimo ${fmt(min)}):`;
      [5, 10, 20, 50].filter((a) => a >= min).forEach((a, i) => {
        kb.text(`${a} ${cur()}`, `amt:${a}`);
        if (i % 2 === 1) kb.row();
      });
    }
    kb.row().text('❌ Cancelar', 'x');
    await show(ctx, text, kb);
  };
  bot.command('recargar', startRecharge);
  bot.callbackQuery('recharge', startRecharge);

  // amount = USD que se acreditan; pesos = lo que el cliente paga (en modo pesos)
  const askProof = async (ctx, amount, pesos = null) => {
    await setState(ctx.from.id, { step: 'recharge_proof', amount, cop: pesos });
    const text =
      `🧾 <b>Recarga de ${pesos ? '$' + pesos.toLocaleString('es-CO') + ' COP' : fmt(amount)}</b>\n${LINE}\n` +
      (!pesos && cop(amount) ? `💵 Debes pagar: <b>${cop(amount)}</b>\n` : '') +
      `1️⃣ Paga con uno de los métodos de arriba\n2️⃣ Envía aquí la <b>captura o foto del comprobante</b> 📸\n\nTe avisamos apenas se acredite ✅`;
    await show(ctx, text, cancelKb());
  };
  bot.callbackQuery(/^amt:(\d+)$/, (ctx) => askProof(ctx, Number(ctx.match[1])));
  bot.callbackQuery(/^amc:(\d+)$/, (ctx) => {
    const pesos = Number(ctx.match[1]);
    return askProof(ctx, round4(pesos / copRate()), pesos);
  });

  // El admin configura el QR de cobro enviándole al bot la foto con el texto /qr
  bot.on('message:photo', async (ctx, next) => {
    if (!isAdmin(ctx.from.id) || !String(ctx.message.caption || '').toLowerCase().startsWith('/qr')) return next();
    const { saveSettings } = await import('../settings.js');
    await saveSettings({ payment_qr: ctx.message.photo.at(-1).file_id });
    await ctx.reply('✅ QR de cobro guardado. Los clientes lo verán al recargar. (Para quitarlo: /qr_borrar)');
  });
  bot.command('qr_borrar', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    const { saveSettings } = await import('../settings.js');
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
    const paid = st.cop ? `$${Number(st.cop).toLocaleString('es-CO')} COP` : fmt(st.amount);
    await ctx.reply(
      `📨 <b>¡Comprobante recibido!</b>\n${LINE}\nSolicitud #${r.id} por ${paid}\n⏱ La revisamos en pocos minutos y te avisamos aquí.`,
      { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('🛍 Ver tienda', 'st').text('🏠 Menú', 'm') },
    );
    const caption = `💵 <b>Recarga #${r.id}</b>\nCliente: ${esc(ctx.from.first_name || '')} ${ctx.from.username ? '@' + esc(ctx.from.username) : ''} (<code>${ctx.from.id}</code>)\nPagó: <b>${paid}</b>\nSe acreditan: <b>${money(st.amount)} USDT</b>`;
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
      kb.text('🛍 Ir a la tienda', 'st');
      return show(ctx, `📦 <b>Mis pedidos</b>\n${LINE}\nAún no tienes pedidos. ¡Tu primera compra te espera! 🛍`, navRow(kb));
    }
    for (const o of orders) kb.text(`${STATUS_ES[o.status]?.split(' ')[0] || ''} #${o.id} · ${cut(o.product_name, 28)} · ${fmtS(o.price)}`, `o:${o.id}`).row();
    await show(ctx, `📦 <b>Mis pedidos</b>\n${LINE}\nTus últimos ${orders.length} pedidos. Toca uno para ver los datos de acceso:`, navRow(kb, 'pf'));
  };
  bot.command('pedidos', showOrders);
  bot.callbackQuery('ol', showOrders);
  bot.callbackQuery(/^o:(\d+)$/, async (ctx) => {
    let o = await one('SELECT * FROM orders WHERE id=$1 AND user_id=$2', [Number(ctx.match[1]), ctx.from.id]);
    if (!o) return;
    if (['pending', 'processing', 'action_required'].includes(o.status)) o = await refreshOrder(o);
    let text = `🧾 <b>Pedido #${o.id}</b>\n${LINE}\n${iconOf(o.product_name)} ${esc(o.product_name)}\n🔢 Cantidad: ${o.quantity}\n💳 Total: ${fmt(o.price)}\n📍 Estado: ${STATUS_ES[o.status] || o.status}\n📅 ${fmtDate(o.created_at)} UTC`;
    if (o.status === 'delivered') text += `\n${LINE}\n${formatDelivery(o)}`;
    if (o.failure_reason && o.status === 'refunded') text += `\n↩️ Motivo: ${esc(o.failure_reason)}`;
    if (o.status === 'action_required') text += '\n\n📧 Escribe aquí el código de confirmación que Supercell envió a tu correo.';
    const kb = new InlineKeyboard();
    if (['pending', 'processing', 'action_required'].includes(o.status)) kb.text('🔄 Actualizar', `o:${o.id}`);
    kb.text('🆘 Ayuda con este pedido', 'sup');
    if (o.status === 'action_required') await setState(ctx.from.id, { step: 'supercell_code', orderId: o.id });
    await show(ctx, text, navRow(kb, 'ol'));
  });

  // ---------- referidos y soporte ----------
  const showReferrals = async (ctx) => {
    const st = await referralStats(ctx.from.id);
    const link = `https://t.me/${ctx.me.username}?start=ref${ctx.from.id}`;
    const text =
      `🎁 <b>Invita y gana</b>\n${LINE}\n` +
      `Gana el <b>${num('referral_percent')}%</b> de cada compra que hagan tus amigos, para siempre y directo a tu saldo 💸\n\n` +
      `🔗 Tu enlace personal:\n<code>${link}</code>\n${LINE}\n` +
      `👥 Invitados: <b>${st.invited}</b>\n💰 Ganado: <b>${fmt(st.earned)}</b>`;
    const share = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(`🛍 ${s('shop_name')}: cuentas premium, IA y recargas con entrega automática`)}`;
    await show(ctx, text, navRow(new InlineKeyboard().url('📤 Compartir mi enlace', share), 'pf'));
  };
  bot.callbackQuery('ref', showReferrals);

  const showSupport = (ctx) =>
    show(
      ctx,
      `🆘 <b>Soporte</b>\n${LINE}\n¿Tienes un problema con un pedido? Escríbenos y te ayudamos rápido:\n\n💬 ${esc(s('support_contact'))}\n\n📌 Indica tu <b>número de pedido</b> (lo ves en 📦 Mis pedidos) y una captura del problema.`,
      navRow(new InlineKeyboard().text('📦 Mis pedidos', 'ol')),
    );
  bot.command('soporte', showSupport);
  bot.callbackQuery('sup', showSupport);

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
      `🛠 <b>Panel rápido</b>\n${LINE}\n🏦 Saldo KOKORO: <b>${kb}</b>\n👤 Clientes: ${st.users} (+${st.users_today} hoy)\n🧾 Ventas: ${st.orders}\n💵 Facturado: ${money(st.revenue)} (hoy ${money(st.revenue_today)})\n📈 Ganancia: ${money(st.profit)} (hoy ${money(st.profit_today)})\n⏳ Pedidos abiertos: ${st.open_orders}\n💳 Recargas pendientes: ${st.pending_recharges}\n👛 Saldo total de clientes: ${money(st.customer_balances)}\n\n` +
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
      if (a > 0) await sendTo(Number(id), `💰 Se acreditaron <b>${fmt(a)}</b> a tu saldo. Saldo actual: <b>${fmt(bal)}</b>`, { reply_markup: new InlineKeyboard().text('🛍 Ir a la tienda', 'st') });
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
      await sendTo(r.user_id, `✅ <b>¡Recarga aprobada!</b>\n${LINE}\n➕ ${fmt(r.amount)}\n💰 Saldo actual: <b>${fmt(bal)}</b>\n\n¡Ya puedes comprar! 🛍`, { reply_markup: new InlineKeyboard().text('🛍 Ir a la tienda', 'st').text('🔥 Más vendidos', 'top') });
    } else {
      await sendTo(r.user_id, `❌ Tu solicitud de recarga #${r.id} fue rechazada. Si crees que es un error, contacta a ${esc(s('support_contact'))}.`, { reply_markup: new InlineKeyboard().text('🆘 Soporte', 'sup') });
    }
    return { ok: true, recharge: r };
  }
  bot.handleRecharge = handleRecharge;

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
          return ctx.reply('🔎 ¿Qué buscas? Escribe el nombre (ej: netflix, free fire, spotify):', { reply_markup: cancelKb() });
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
        if (!pesos || pesos < minCop() || pesos > 20_000_000) {
          return ctx.reply(`Escribe el monto en pesos, sin puntos (ej: 30000). Mínimo $${minCop().toLocaleString('es-CO')}.`);
        }
        return askProof(ctx, round4(pesos / copRate()), pesos);
      }
      const amount = Number(text.replace(',', '.').replace(/[^\d.]/g, ''));
      if (!amount || amount < num('min_recharge') || amount > 100000) {
        return ctx.reply(`Escribe un monto válido en ${cur()} (mínimo ${fmt(num('min_recharge'))}).`);
      }
      return askProof(ctx, amount);
    }
    if (st?.step === 'recharge_proof') return ctx.reply('📸 Envía la captura del comprobante como imagen (o /cancelar).');
    if (await handleShopText(ctx, st, text)) return;
    // cualquier otro texto = búsqueda rápida
    if (text.length >= 2 && !text.startsWith('/')) return doSearch(ctx, text);
    return mainMenu(ctx);
  });

  bot.catch((err) => {
    console.error('Error en el bot:', err.error?.message || err.error);
    err.ctx?.reply('⚠️ Ocurrió un error. Inténtalo de nuevo en un momento.', { reply_markup: new InlineKeyboard().text('🏠 Menú', 'm') }).catch(() => {});
  });

  return bot;
}

export async function setupCommands(bot) {
  await bot.api.setMyCommands([
    { command: 'start', description: '🏠 Menú principal' },
    { command: 'saldo', description: '👤 Mi perfil y saldo' },
    { command: 'recargar', description: '💰 Recargar saldo' },
    { command: 'pedidos', description: '📦 Mis pedidos' },
    { command: 'soporte', description: '🆘 Ayuda y soporte' },
    { command: 'cancelar', description: '❌ Cancelar la operación actual' },
  ]);
  // Nombre y descripción que ven los clientes antes de pulsar "Iniciar"
  await bot.api.setMyName(`${s('shop_name')} 🔑`).catch(() => {});
  await bot.api.setMyDescription(
    `🔑 ${s('shop_name')} — todas tus suscripciones premium en un solo lugar.\n\n` +
      '🤖 ChatGPT, Gemini, Claude · 🎬 Netflix, YouTube, Spotify · 🎨 Canva, CapCut · 💼 Office · 🎮 Recargas de juegos\n\n' +
      '💵 Precios en pesos colombianos\n⚡ Entrega automática al instante 24/7\n🎁 Ñapa: te devolvemos saldo en cada compra\n⏰ Te avisamos antes de que venza tu suscripción\n🛡 Garantía y soporte en español',
  ).catch(() => {});
  await bot.api.setMyShortDescription(`🔑 ${s('shop_name')}: IA, streaming y apps premium en pesos, con entrega al instante y ñapa en cada compra.`).catch(() => {});
}
