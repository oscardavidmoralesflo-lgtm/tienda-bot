import { InlineKeyboard, Keyboard } from 'grammy';

// Botones fijos de abajo (atajos). La navegación completa va en botones dentro del mensaje.
export const MENU = {
  home: '🏠 Menú',
  store: '🛍 Tienda',
  profile: '👤 Mi perfil',
  recharge: '💰 Recargar',
};
// Etiquetas del teclado anterior (para clientes que aún lo tienen)
export const LEGACY = {
  '🛍 Productos': 'store',
  '🎮 Juegos y Gift Cards': 'games',
  '🔎 Buscar': 'search',
  '💰 Mi saldo': 'profile',
  '➕ Recargar saldo': 'recharge',
  '📦 Mis pedidos': 'orders',
  '👥 Invitar amigos': 'referrals',
  '🆘 Soporte': 'support',
};

export const LINE = '━━━━━━━━━━━━━━━━━━';

export const mainKeyboard = () =>
  new Keyboard().text(MENU.home).text(MENU.store).row().text(MENU.profile).text(MENU.recharge).resized().persistent();

// Muestra una pantalla: edita el mensaje si viene de un botón (instantáneo), si no envía uno nuevo
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
  kb.text(page > 0 ? '◀️' : '·', page > 0 ? `${prefix}${page - 1}` : 'noop');
  kb.text(`${page + 1} / ${pages}`, 'noop');
  kb.text(page < pages - 1 ? '▶️' : '·', page < pages - 1 ? `${prefix}${page + 1}` : 'noop');
  return kb;
}

// Fila de navegación estándar: Atrás + Menú
export function navRow(kb, back) {
  kb.row();
  if (back) kb.text('⬅️ Atrás', back);
  kb.text('🏠 Menú', 'm');
  return kb;
}

export const cut = (t, n = 48) => (t.length > n ? t.slice(0, n - 1) + '…' : t);
export const cancelKb = () => new InlineKeyboard().text('❌ Cancelar', 'x');
export const stockIcon = (n) => (n > 20 ? '🟢' : n > 0 ? '🟡' : '🔴');
