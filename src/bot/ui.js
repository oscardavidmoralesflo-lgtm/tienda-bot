import { InlineKeyboard, Keyboard } from 'grammy';

export const MENU = {
  products: '🛍 Productos',
  games: '🎮 Juegos y Gift Cards',
  search: '🔎 Buscar',
  balance: '💰 Mi saldo',
  recharge: '➕ Recargar saldo',
  orders: '📦 Mis pedidos',
  referrals: '👥 Invitar amigos',
  support: '🆘 Soporte',
};

export const mainKeyboard = () =>
  new Keyboard()
    .text(MENU.products).text(MENU.games).row()
    .text(MENU.search).text(MENU.orders).row()
    .text(MENU.balance).text(MENU.recharge).row()
    .text(MENU.referrals).text(MENU.support)
    .resized()
    .persistent();

// Muestra una pantalla: edita el mensaje si viene de un botón, si no envía uno nuevo
export async function show(ctx, text, keyboard) {
  const opts = { parse_mode: 'HTML', reply_markup: keyboard, link_preview_options: { is_disabled: true } };
  if (ctx.callbackQuery?.message?.text) {
    try {
      await ctx.editMessageText(text, opts);
      return;
    } catch (e) {
      if (String(e.description || e.message).includes('not modified')) return;
    }
  }
  try {
    await ctx.reply(text, opts);
  } catch (e) {
    // si el HTML viene mal formado, se envía como texto plano
    if (String(e.description || '').includes("can't parse")) {
      await ctx.reply(text.replace(/<[^>]+>/g, ''), { reply_markup: keyboard });
    } else throw e;
  }
}

export function pager(kb, prefix, page, total, perPage) {
  const pages = Math.ceil(total / perPage);
  if (pages <= 1) return kb;
  kb.row();
  if (page > 0) kb.text('⬅️', `${prefix}${page - 1}`);
  kb.text(`${page + 1}/${pages}`, 'noop');
  if (page < pages - 1) kb.text('➡️', `${prefix}${page + 1}`);
  return kb;
}

export const cut = (t, n = 48) => (t.length > n ? t.slice(0, n - 1) + '…' : t);
export const cancelKb = () => new InlineKeyboard().text('❌ Cancelar', 'x');
