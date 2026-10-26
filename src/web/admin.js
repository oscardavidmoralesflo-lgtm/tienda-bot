// Panel de administración web (/admin)
import express from 'express';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { one, many } from '../db.js';
import { kokoro, clearCache } from '../kokoro.js';
import { bunny, bunnyEnabled, balanceOf } from '../bunny.js';
import * as catalog from '../catalog.js';
import { warmUp, lastRefresh } from '../refresher.js';
import { s, DEFAULTS, saveSettings } from '../settings.js';
import { money, productUnitPrice, packPrice, gameFromPrice, getOverride, saveOverride, tierPct, copRate, cop } from '../pricing.js';
import { credit } from '../users.js';
import { stats, refreshOrder, refundOrder, notifyDelivered, deliverManually } from '../orders.js';
import { categoryOf, DISPLAY_ORDER, iconOf } from '../categories.js';
import { esc, fmtDate, STATUS_ES } from '../util.js';
import { page, loginPage, icon, avatar, salesChart, donut } from './layout.js';

const COOKIE = 'adm';
const SESSION_HOURS = 24 * 7;

function sign(value) {
  return crypto.createHmac('sha256', config.sessionSecret).update(value).digest('hex');
}
function makeToken() {
  const exp = String(Date.now() + SESSION_HOURS * 3600_000);
  return `${exp}.${sign(exp)}`;
}
function validToken(t) {
  if (!t) return false;
  const [exp, sig] = t.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const a = Buffer.from(sign(exp));
  const b = Buffer.from(sig);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const readCookie = (req, name) =>
  (req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).find(([k]) => k === name)?.[1];

const fails = new Map(); // intentos fallidos por IP

// ---------- piezas visuales ----------
const STATUS_CLASS = { delivered: 'b-ok', refunded: 'b-bad', failed: 'b-bad', pending: 'b-info', processing: 'b-info', action_required: 'b-warn' };
const statusBadge = (st) => `<span class="badge ${STATUS_CLASS[st] || 'b-muted'}">${STATUS_ES[st] || esc(st)}</span>`;
const who = (u, id) => `<div class="who">${avatar(u.first_name || u.username || id, id)}<div style="min-width:0"><b>${esc(u.first_name || 'Sin nombre')}</b><small>${u.username ? '@' + esc(u.username) : `ID ${id}`}</small></div></div>`;
const back = (res, url, msg) => res.redirect(`${url}${url.includes('?') ? '&' : '?'}m=${encodeURIComponent(msg)}`);
const cur = () => s('currency');
const stat = (label, value, { ic = 'trend', color = 'brand', sub = '', hero = false } = {}) =>
  `<div class="card stat ${hero ? 'hero' : ''}"><div class="split"><span class="k">${label}</span><span class="chip c-${color}">${icon(ic)}</span></div><div class="v num">${value}</div>${sub ? `<div class="d">${sub}</div>` : ''}</div>`;
const sourceBadge = (src) => (src === 'bunny' ? '<span class="badge b-brand">🐰 Bunny</span>' : '<span class="badge b-info">🏦 KOKORO</span>');
const emptyBox = (emoji, text) => `<div class="empty"><div class="big">${emoji}</div>${text}</div>`;

async function salesSeries(days = 14) {
  const rows = await many(
    `SELECT to_char(d, 'YYYY-MM-DD') AS day,
            COALESCE(sum(o.price), 0) AS revenue, COALESCE(sum(o.price - o.cost), 0) AS profit, count(o.id)::int AS orders
     FROM generate_series(current_date - ${days - 1}, current_date, interval '1 day') AS d
     LEFT JOIN orders o ON o.status = 'delivered' AND o.created_at::date = d::date
     GROUP BY d ORDER BY d`,
  );
  return rows.map((r) => ({ ...r, revenue: Number(r.revenue), profit: Number(r.profit), label: r.day.slice(8, 10) + '/' + r.day.slice(5, 7) }));
}

export function adminRouter(bot) {
  const r = express.Router();
  r.use(express.urlencoded({ extended: false, limit: '200kb' }));

  // ---------- login ----------
  r.get('/login', (req, res) => res.send(loginPage('', s('shop_name'))));
  r.post('/login', (req, res) => {
    const ip = req.ip;
    const f = fails.get(ip) || { n: 0, t: Date.now() };
    if (Date.now() - f.t > 15 * 60_000) { f.n = 0; f.t = Date.now(); }
    if (f.n >= 10) return res.status(429).send(loginPage('Demasiados intentos. Espera 15 minutos.', s('shop_name')));
    const given = Buffer.from(String(req.body.password || ''));
    const real = Buffer.from(config.adminPassword);
    const ok = given.length === real.length && crypto.timingSafeEqual(given, real);
    if (!ok) {
      f.n += 1;
      fails.set(ip, f);
      return res.status(401).send(loginPage('Contraseña incorrecta', s('shop_name')));
    }
    fails.delete(ip);
    const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.setHeader('Set-Cookie', `${COOKIE}=${makeToken()}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}${secure ? '; Secure' : ''}`);
    res.redirect('/admin');
  });
  r.post('/logout', (req, res) => {
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/admin; Max-Age=0`);
    res.redirect('/admin/login');
  });

  // todo lo demás requiere sesión
  r.use((req, res, next) => (validToken(readCookie(req, COOKIE)) ? next() : res.redirect('/admin/login')));

  const render = async (req, res, title, body, extra = {}) => {
    const b = await one(
      `SELECT (SELECT count(*) FROM recharges WHERE status='pending')::int AS recharges,
              (SELECT count(*) FROM orders WHERE status IN ('pending','processing','action_required'))::int AS orders`,
    );
    res.send(page(title, body, {
      path: req.baseUrl + req.path.replace(/\/$/, ''),
      flash: req.query.m,
      badges: b,
      shop: s('shop_name'),
      maintenance: s('maintenance') === '1',
      ...extra,
    }));
  };

  // ---------- resumen ----------
  r.get('/', async (req, res) => {
    const [st, series, top, recent, kb, bb] = await Promise.all([
      stats(),
      salesSeries(14),
      many(`SELECT product_name, count(*)::int AS n, sum(price) AS revenue, sum(price - cost) AS profit FROM orders
            WHERE status='delivered' AND created_at > now() - interval '30 days' GROUP BY product_name ORDER BY n DESC, revenue DESC LIMIT 6`),
      many('SELECT o.*, u.first_name, u.username FROM orders o LEFT JOIN users u ON u.id=o.user_id ORDER BY o.id DESC LIMIT 8'),
      kokoro.balance().then((d) => Number(d.balance)).catch(() => null),
      bunnyEnabled() ? bunny.profile().then(balanceOf).catch(() => null) : Promise.resolve(null),
    ]);
    const last7 = series.slice(-7).reduce((a, d) => ({ revenue: a.revenue + d.revenue, profit: a.profit + d.profit, orders: a.orders + d.orders }), { revenue: 0, profit: 0, orders: 0 });
    const margin = st.revenue > 0 ? Math.round((st.profit / st.revenue) * 100) : 0;
    const provTotal = (kb || 0) + (bb || 0);
    const cover = Number(st.customer_balances) > 0 ? Math.min(100, Math.round((provTotal / Number(st.customer_balances)) * 100)) : 100;

    // ventas por categoría (30 días)
    const byCat = {};
    for (const t of top) byCat[categoryOf(t.product_name).label] = (byCat[categoryOf(t.product_name).label] || 0) + Number(t.revenue);
    const colors = ['#d4af62', '#10b981', '#5b7fa6', '#a97f33', '#8a8f9c', '#c26a5a', '#6b4e71'];
    const parts = Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([label, value], i) => ({ label, value, color: colors[i % colors.length] }));
    const maxTop = Math.max(1, ...top.map((t) => t.n));

    const body = `
      <div class="grid g4">
        ${stat('Ganancia hoy', `${money(st.profit_today)} <small style="font-size:14px;font-weight:600">${cur()}</small>`, { ic: 'trend', hero: true, sub: `${money(st.revenue_today)} facturado hoy${cop(st.profit_today) ? ' · ≈ ' + cop(st.profit_today) : ''}` })}
        ${stat('Facturado (7 días)', money(last7.revenue), { ic: 'dollar', color: 'info', sub: `${last7.orders} ventas · ${money(last7.profit)} de ganancia` })}
        ${stat('Ganancia total', money(st.profit), { ic: 'bag', color: 'ok', sub: `Margen real: ${margin}% · ${st.orders} ventas` })}
        ${stat('Clientes', st.users, { ic: 'users', color: 'brand', sub: `+${st.users_today} hoy` })}
      </div>

      <div class="grid g21" style="margin-top:16px">
        <div class="card"><div class="split"><div><h3>${icon('trend')} Ventas de los últimos 14 días</h3><p class="sub">Facturación y ganancia diaria en ${cur()}</p></div>
          <div class="legend"><span><i style="background:#d4af62"></i>Facturado</span><span><i style="background:#10b981"></i>Ganancia</span></div></div>
          ${salesChart(series)}</div>
        <div class="card"><h3>${icon('wallet')} Saldos con proveedores</h3><p class="sub">Lo que tienes disponible para vender</p>
          <div class="grid" style="gap:12px">
            <div class="split"><span class="row" style="gap:10px"><span class="chip c-info" style="width:34px;height:34px;border-radius:10px;display:grid;place-items:center">${icon('bank', 17)}</span><span><b>KOKORO</b><br><small class="muted">@Shop_KOKORO_BOT</small></span></span><b class="num ${kb === null ? 'bad' : kb < Number(s('low_balance_alert')) ? 'warn' : ''}">${kb === null ? 'Error' : money(kb)}</b></div>
            <div class="split"><span class="row" style="gap:10px"><span class="chip c-brand" style="width:34px;height:34px;border-radius:10px;display:grid;place-items:center">${icon('rabbit', 17)}</span><span><b>Bunny</b><br><small class="muted">@bunnytoolss_bot</small></span></span><b class="num ${bb === null ? 'muted' : bb < Number(s('low_balance_alert')) ? 'warn' : ''}">${bb === null ? (bunnyEnabled() ? 'Error' : '—') : money(bb)}</b></div>
            <hr class="sep" style="margin:4px 0">
            <div class="split"><span class="muted">Saldo cargado por tus clientes</span><b class="num">${money(st.customer_balances)}</b></div>
            <div><div class="split" style="margin-bottom:6px;font-size:12.5px"><span class="muted">Cobertura</span><b class="${cover < 100 ? 'warn' : 'ok'}">${cover}%</b></div><div class="bar"><i style="width:${cover}%"></i></div>
            <p class="help">${cover < 100 ? '⚠️ Recarga a tus proveedores: tus clientes tienen más saldo del que puedes cubrir.' : '✅ Tus proveedores cubren todo el saldo de tus clientes.'}</p></div>
          </div></div>
      </div>

      <div class="grid g3" style="margin-top:16px">
        ${stat('Recargas pendientes', st.pending_recharges, { ic: 'wallet', color: st.pending_recharges ? 'warn' : 'ok', sub: st.pending_recharges ? '<a href="/admin/recharges">Revisar ahora →</a>' : 'Todo al día' })}
        ${stat('Pedidos en proceso', st.open_orders, { ic: 'clock', color: st.open_orders ? 'info' : 'ok', sub: st.open_orders ? '<a href="/admin/orders?status=open">Ver pedidos →</a>' : 'Sin pendientes' })}
        ${stat('Facturado total', money(st.revenue), { ic: 'dollar', color: 'brand', sub: `Tasa: 1 USD = ${copRate() ? copRate().toLocaleString('es-CO') + ' COP' : '—'}` })}
      </div>

      <div class="grid g2" style="margin-top:16px">
        <div class="card"><h3>${icon('star')} Más vendidos (30 días)</h3><p class="sub">Por número de ventas</p>
          ${top.length ? `<div class="toplist">${top.map((t) => `<div><div class="t"><span>${iconOf(t.product_name)} ${esc(t.product_name)}</span><b class="num">${t.n} · <span class="ok">+${money(t.profit)}</span></b></div><div class="bar"><i style="width:${Math.round((t.n / maxTop) * 100)}%"></i></div></div>`).join('')}</div>` : emptyBox('📈', 'Cuando vendas, aquí verás tus productos estrella')}</div>
        <div class="card"><h3>${icon('box')} Ventas por categoría</h3><p class="sub">Facturación de los últimos 30 días</p>${donut(parts)}</div>
      </div>

      <div class="card" style="margin-top:16px"><div class="split"><div><h3>${icon('receipt')} Últimos pedidos</h3><p class="sub">Las ventas más recientes de tu bot</p></div><a class="btn ghost sm" href="/admin/orders">Ver todos</a></div>
        ${ordersTable(recent)}</div>`;
    const actions = `<a class="btn ghost" href="https://t.me/${esc(bot.botInfo?.username || '')}" target="_blank">${icon('send', 16)} Abrir mi bot</a><form method="post" action="/admin/cache" style="margin:0"><button>${icon('refresh', 16)} Actualizar catálogo</button></form>`;
    await render(req, res, 'Resumen', body, { subtitle: `${new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })} · todo tu negocio de un vistazo`, actions });
  });

  // ---------- recargas ----------
  r.get('/recharges', async (req, res) => {
    const pending = await many("SELECT r.*, u.first_name, u.username FROM recharges r LEFT JOIN users u ON u.id=r.user_id WHERE r.status='pending' ORDER BY r.id");
    const done = await many("SELECT r.*, u.first_name, u.username FROM recharges r LEFT JOIN users u ON u.id=r.user_id WHERE r.status<>'pending' ORDER BY r.id DESC LIMIT 50");
    const proofUrl = (x) => `/admin/file?id=${encodeURIComponent(x.proof_file_id)}`;
    const proof = (x) => (x.proof_file_id
      ? (x.proof_type === 'photo'
        ? `<a href="${proofUrl(x)}" target="_blank"><img class="proof" style="width:100%;height:180px" src="${proofUrl(x)}" loading="lazy" alt="Comprobante"></a>`
        : `<a class="btn ghost" href="${proofUrl(x)}" target="_blank">${icon('link', 16)} Ver archivo</a>`)
      : '<span class="muted">Sin comprobante</span>');
    const cards = pending.map((x) => `<div class="card"><div class="split" style="margin-bottom:12px">${who(x, x.user_id)}<span class="badge b-warn">#${x.id}</span></div>
        ${proof(x)}
        <div class="split" style="margin:12px 0 6px"><span class="muted">Monto declarado</span><b class="num" style="font-size:18px">${money(x.amount)} ${cur()}</b></div>
        ${x.amount_cop ? `<div class="split" style="margin-bottom:10px"><span class="muted">Dice que pagó</span><b class="num" style="color:var(--gold);font-size:18px">$${Number(x.amount_cop).toLocaleString('es-CO')} COP</b></div>`
          : cop(x.amount) ? `<div class="split" style="margin-bottom:10px"><span class="muted">Debió pagar</span><b class="num">${cop(x.amount)}</b></div>` : ''}
        <p class="help" style="margin:0 0 12px">${icon('clock', 13)} ${fmtDate(x.created_at)} UTC</p>
        <form method="post" action="/admin/recharges/${x.id}" class="row">
          <input name="amount" class="in-sm num" value="${money(x.amount)}" inputmode="decimal" aria-label="Monto a acreditar" title="Puedes corregir el monto antes de aprobar">
          <button class="okb" name="do" value="approve">${icon('check', 16)} Aprobar</button>
          <button class="badb" name="do" value="reject" onclick="return confirm('¿Rechazar la recarga #${x.id}?')">${icon('x', 16)} Rechazar</button></form></div>`).join('');
    const body = `
      ${pending.length ? `<div class="grid g3">${cards}</div>` : `<div class="card">${emptyBox('🎉', 'No hay recargas pendientes. ¡Todo al día!')}</div>`}
      <div class="sec-title">Historial</div>
      <div class="card"><div class="tablewrap"><table><thead><tr><th>#</th><th>Cliente</th><th class="r">Monto</th><th>Estado</th><th>Aprobada por</th><th>Fecha</th></tr></thead><tbody>
      ${done.map((x) => `<tr><td class="muted">#${x.id}</td><td><a href="/admin/users/${x.user_id}">${who(x, x.user_id)}</a></td><td class="r num"><b>${money(x.amount)}</b></td>
        <td>${x.status === 'approved' ? '<span class="badge b-ok">Aprobada</span>' : '<span class="badge b-bad">Rechazada</span>'}</td><td class="muted">${esc(x.handled_by || '')}</td><td class="muted">${fmtDate(x.handled_at)}</td></tr>`).join('') || `<tr><td colspan="6">${emptyBox('🧾', 'Aún no hay historial')}</td></tr>`}
      </tbody></table></div></div>`;
    await render(req, res, 'Recargas', body, { subtitle: 'Revisa el comprobante, corrige el monto si hace falta y aprueba con un clic. El cliente recibe el aviso al instante.' });
  });
  r.post('/recharges/:id', async (req, res) => {
    const approve = req.body.do === 'approve';
    const amount = Number(String(req.body.amount || '').replace(',', '.'));
    if (approve && !(amount > 0)) return back(res, '/admin/recharges', 'Monto inválido');
    const out = await bot.handleRecharge(Number(req.params.id), approve, 'panel', approve ? amount : null);
    back(res, '/admin/recharges', out.ok ? (approve ? `Recarga #${req.params.id} aprobada: +${money(amount)} ${cur()}` : 'Recarga rechazada') : out.error);
  });
  // muestra el comprobante guardado en Telegram
  r.get('/file', async (req, res) => {
    try {
      const f = await bot.api.getFile(String(req.query.id));
      const tg = await fetch(`https://api.telegram.org/file/bot${config.botToken}/${f.file_path}`);
      res.setHeader('Content-Type', tg.headers.get('content-type') || 'application/octet-stream');
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.send(Buffer.from(await tg.arrayBuffer()));
    } catch {
      res.status(404).send('No disponible');
    }
  });

  // ---------- pedidos ----------
  function ordersTable(rows, { compact = false } = {}) {
    if (!rows.length) return emptyBox('🛒', 'Aún no hay pedidos');
    return `<div class="tablewrap"><table><thead><tr><th>Pedido</th><th>Cliente</th><th>Producto</th><th class="r">Precio</th>${compact ? '' : '<th class="r">Costo</th>'}<th class="r">Ganancia</th><th>Estado</th>${compact ? '' : '<th>Fecha</th>'}</tr></thead><tbody>
      ${rows.map((o) => `<tr><td><a href="/admin/orders/${o.id}"><b>#${o.id}</b></a></td><td><a href="/admin/users/${o.user_id}" style="text-decoration:none">${who(o, o.user_id)}</a></td>
      <td class="wrap">${iconOf(o.product_name)} ${esc(o.product_name)}${o.quantity > 1 ? ` <span class="badge b-muted">x${o.quantity}</span>` : ''}</td><td class="r num">${money(o.price)}</td>${compact ? '' : `<td class="r num muted">${money(o.cost)}</td>`}
      <td class="r num ${o.status === 'delivered' ? 'ok' : 'muted'}">${o.status === 'delivered' ? '+' + money(o.price - o.cost) : '—'}</td><td>${statusBadge(o.status)}</td>${compact ? '' : `<td class="muted">${fmtDate(o.created_at)}</td>`}</tr>`).join('')}
    </tbody></table></div>`;
  }
  r.get('/orders', async (req, res) => {
    const st = String(req.query.status || '');
    const q = String(req.query.q || '').trim();
    const where = [];
    const params = [];
    if (st === 'open') where.push("o.status IN ('pending','processing','action_required')");
    else if (st) { params.push(st); where.push(`o.status = $${params.length}`); }
    if (q) {
      params.push(`%${q}%`);
      where.push(`(o.product_name ILIKE $${params.length} OR o.external_order_id ILIKE $${params.length} OR CAST(o.user_id AS TEXT) = $${params.length + 1} OR CAST(o.id AS TEXT) = $${params.length + 1})`);
      params.push(q.replace('#', ''));
    }
    const rows = await many(`SELECT o.*, u.first_name, u.username FROM orders o LEFT JOIN users u ON u.id=o.user_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY o.id DESC LIMIT 200`, params);
    const chip = (v, l) => `<a class="chipf ${st === v ? 'on' : ''}" href="/admin/orders?status=${v}${q ? `&q=${encodeURIComponent(q)}` : ''}">${l}</a>`;
    const body = `<div class="card"><div class="split" style="margin-bottom:16px;flex-wrap:wrap">
        <div class="chips">${chip('', 'Todos')}${chip('open', '⏳ En proceso')}${chip('delivered', '✅ Entregados')}${chip('action_required', '📧 Esperando código')}${chip('refunded', '↩️ Reembolsados')}</div>
        <form class="row" style="margin:0"><input type="hidden" name="status" value="${esc(st)}"><div class="searchbox">${icon('search', 16)}<input name="q" value="${esc(q)}" placeholder="Producto, #pedido o ID de cliente"></div><button class="sm">Buscar</button></form></div>
      ${ordersTable(rows)}</div>`;
    await render(req, res, 'Pedidos', body, { subtitle: `${rows.length} pedidos${st ? ' filtrados' : ''} · haz clic en uno para ver la entrega, reenviarla o reembolsar` });
  });
  r.get('/orders/:id', async (req, res) => {
    const o = await one('SELECT o.*, u.first_name, u.username FROM orders o LEFT JOIN users u ON u.id=o.user_id WHERE o.id=$1', [Number(req.params.id)]);
    if (!o) return back(res, '/admin/orders', 'Pedido no encontrado');
    const input = typeof o.input === 'string' ? JSON.parse(o.input) : o.input;
    const kv = (k, v) => `<div class="k">${k}</div><div>${v}</div>`;
    const body = `<div class="grid g21">
      <div class="card"><h3>${icon('receipt')} Detalle del pedido</h3><p class="sub">${statusBadge(o.status)} ${o.failure_reason ? `<span class="muted"> · ${esc(o.failure_reason)}</span>` : ''}</p>
        <div class="kv">
          ${kv('Cliente', `<a href="/admin/users/${o.user_id}" style="text-decoration:none">${who(o, o.user_id)}</a>`)}
          ${kv('Producto', `${iconOf(o.product_name)} <b>${esc(o.product_name)}</b><br><small class="muted">${esc(o.product_id)}</small>`)}
          ${kv('Cantidad', o.quantity)}
          ${kv('Precio de venta', `<b class="num">${money(o.price)} ${cur()}</b>`)}
          ${kv('Costo', `<span class="num">${money(o.cost)} ${cur()}</span>`)}
          ${kv('Ganancia', `<b class="num ok">+${money(o.price - o.cost)} ${cur()}</b>`)}
          ${kv('Proveedor', sourceBadge(o.kind === 'bunny' ? 'bunny' : 'kokoro'))}
          ${kv('ID en el proveedor', `<span class="num">${esc(o.kokoro_order_id || '—')}</span><br><small class="muted">${esc(o.external_order_id)}</small>`)}
          ${kv('Fecha', `${fmtDate(o.created_at)} UTC`)}
          ${input && Object.keys(input).length ? kv('Datos del cliente', `<pre>${esc(JSON.stringify(input, null, 1))}</pre>`) : ''}
        </div></div>
      <div class="grid" style="gap:16px;align-content:start">
        <div class="card"><h3>${icon('box')} Entrega</h3><p class="sub">Lo que recibió el cliente</p>${o.delivery ? `<pre>${esc(o.delivery)}</pre>` : emptyBox('📭', 'Todavía sin entregar')}</div>
        <div class="card"><h3>${icon('bolt')} Acciones</h3><p class="sub">Gestiona este pedido</p><div class="grid" style="gap:8px">
          ${o.kind !== 'bunny' ? `<form method="post" action="/admin/orders/${o.id}/refresh"><button class="ghost" style="width:100%">${icon('refresh', 16)} Consultar estado en KOKORO</button></form>` : ''}
          ${o.status === 'delivered' ? `<form method="post" action="/admin/orders/${o.id}/resend"><button class="ghost" style="width:100%">${icon('send', 16)} Reenviar entrega al cliente</button></form>` : ''}
          ${!o.refunded ? `<form method="post" action="/admin/orders/${o.id}/refund" onsubmit="return confirm('¿Devolver ${money(o.price)} al saldo del cliente? Esto NO cancela el pedido en el proveedor.')"><button class="badb" style="width:100%">${icon('x', 16)} Reembolsar al cliente</button></form>` : '<span class="badge b-bad">Ya reembolsado</span>'}
        </div></div>
        ${o.status !== 'delivered' && !o.refunded ? `<div class="card"><h3>${icon('check')} Entregar manualmente</h3><p class="sub">Pega la cuenta, código o link que te dio el proveedor</p><form method="post" action="/admin/orders/${o.id}/deliver"><textarea name="delivery" required placeholder="correo@ejemplo.com | contraseña"></textarea><p style="margin:10px 0 0"><button class="okb">${icon('send', 16)} Marcar entregado y enviar</button></p></form></div>` : ''}
      </div></div>`;
    await render(req, res, `Pedido #${o.id}`, body, { subtitle: `<a href="/admin/orders">← Volver a pedidos</a>` });
  });
  r.post('/orders/:id/:action', async (req, res) => {
    const o = await one('SELECT * FROM orders WHERE id=$1', [Number(req.params.id)]);
    if (!o) return back(res, '/admin/orders', 'Pedido no encontrado');
    const url = `/admin/orders/${o.id}`;
    if (req.params.action === 'refresh') {
      const n = await refreshOrder(o);
      return back(res, url, `Estado: ${STATUS_ES[n?.status] || n?.status}`);
    }
    if (req.params.action === 'resend') {
      await notifyDelivered(o);
      return back(res, url, 'Entrega reenviada al cliente');
    }
    if (req.params.action === 'deliver') {
      const text = String(req.body.delivery || '').trim();
      if (!text) return back(res, url, 'Falta escribir la entrega');
      const d = await deliverManually(o.id, text);
      return back(res, url, d ? 'Entregado y enviado al cliente' : 'No se pudo (¿ya estaba entregado o reembolsado?)');
    }
    if (req.params.action === 'refund') {
      const r2 = await refundOrder(o.id, 'Reembolso manual del administrador');
      return back(res, url, r2 ? 'Reembolsado al saldo del cliente' : 'Ya estaba reembolsado');
    }
    back(res, url, 'Acción desconocida');
  });

  // ---------- clientes ----------
  r.get('/users', async (req, res) => {
    const q = String(req.query.q || '').trim();
    const base = `SELECT u.*, COALESCE(o.n,0)::int AS orders, COALESCE(o.t,0) AS spent FROM users u
      LEFT JOIN (SELECT user_id, count(*) AS n, sum(price) AS t FROM orders WHERE status='delivered' GROUP BY user_id) o ON o.user_id=u.id`;
    const rows = q
      ? await many(`${base} WHERE CAST(u.id AS TEXT)=$1 OR u.username ILIKE $2 OR u.first_name ILIKE $2 ORDER BY u.last_seen DESC LIMIT 200`, [q.replace('@', ''), `%${q.replace('@', '')}%`])
      : await many(`${base} ORDER BY u.last_seen DESC LIMIT 200`);
    const body = `<div class="card"><div class="split" style="margin-bottom:16px;flex-wrap:wrap"><p class="sub" style="margin:0">${rows.length} clientes${q ? ` para “${esc(q)}”` : ' · ordenados por actividad reciente'}</p>
      <form class="row" style="margin:0"><div class="searchbox">${icon('search', 16)}<input name="q" value="${esc(q)}" placeholder="ID, @usuario o nombre"></div><button class="sm">Buscar</button></form></div>
      <div class="tablewrap"><table><thead><tr><th>Cliente</th><th>ID</th><th class="r">Saldo</th><th class="r">Compras</th><th class="r">Total gastado</th><th>Última actividad</th><th>Estado</th></tr></thead><tbody>
      ${rows.map((u) => `<tr><td><a href="/admin/users/${u.id}" style="text-decoration:none">${who(u, u.id)}</a></td><td class="num muted">${u.id}</td><td class="r num"><b>${money(u.balance)}</b></td><td class="r num">${u.orders}</td><td class="r num">${money(u.spent)}</td><td class="muted">${fmtDate(u.last_seen)}</td>
      <td>${u.banned ? '<span class="badge b-bad">Bloqueado</span>' : u.blocked_bot ? '<span class="badge b-muted">Bloqueó el bot</span>' : '<span class="badge b-ok">Activo</span>'}</td></tr>`).join('') || `<tr><td colspan="7">${emptyBox('👥', 'Sin clientes todavía')}</td></tr>`}
      </tbody></table></div></div>`;
    await render(req, res, 'Clientes', body, { subtitle: 'Saldo, compras y estado de cada cliente' });
  });
  r.get('/users/:id', async (req, res) => {
    const u = await one('SELECT * FROM users WHERE id=$1', [Number(req.params.id)]);
    if (!u) return back(res, '/admin/users', 'Cliente no encontrado');
    const [orders, txs, invited, agg] = await Promise.all([
      many('SELECT o.*, $2::text AS first_name, $3::text AS username FROM orders o WHERE user_id=$1 ORDER BY id DESC LIMIT 30', [u.id, u.first_name || '', u.username || '']),
      many('SELECT * FROM transactions WHERE user_id=$1 ORDER BY id DESC LIMIT 30', [u.id]),
      one('SELECT count(*)::int AS n FROM users WHERE referred_by=$1', [u.id]),
      one("SELECT count(*)::int AS n, COALESCE(sum(price),0) AS t, COALESCE(sum(price-cost),0) AS p FROM orders WHERE user_id=$1 AND status='delivered'", [u.id]),
    ]);
    const TX = { recharge: ['Recarga', 'b-ok'], purchase: ['Compra', 'b-info'], refund: ['Reembolso', 'b-warn'], adjust: ['Ajuste', 'b-muted'], referral: ['Comisión referido', 'b-brand'] };
    const body = `<div class="card" style="margin-bottom:16px"><div class="split" style="flex-wrap:wrap">
        <div class="row" style="gap:14px">${avatar(u.first_name || u.username || u.id, u.id).replace('class="av"', 'class="av" style="width:52px;height:52px;border-radius:15px;font-size:18px;')}<div><div style="font-size:19px;font-weight:700">${esc(u.first_name || 'Sin nombre')}</div><div class="muted">${u.username ? '@' + esc(u.username) + ' · ' : ''}ID <span class="num">${u.id}</span>${u.referred_by ? ` · invitado por <a href="/admin/users/${u.referred_by}">${u.referred_by}</a>` : ''}</div></div></div>
        <div class="row">${u.banned ? '<span class="badge b-bad">Bloqueado</span>' : '<span class="badge b-ok">Activo</span>'}<span class="badge b-muted">Cliente desde ${fmtDate(u.created_at).slice(0, 10)}</span></div></div></div>
      <div class="grid g4">
        ${stat('Saldo', money(u.balance), { ic: 'wallet', color: 'brand', sub: cop(u.balance) ? '≈ ' + cop(u.balance) : '' })}
        ${stat('Compras', agg.n, { ic: 'bag', color: 'info', sub: `${money(agg.t)} ${cur()} en total` })}
        ${stat('Ganancia que te dejó', money(agg.p), { ic: 'trend', color: 'ok' })}
        ${stat('Invitados', invited.n, { ic: 'users', color: 'warn' })}
      </div>
      <div class="grid g3" style="margin-top:16px">
        <div class="card"><h3>${icon('wallet')} Ajustar saldo</h3><p class="sub">Positivo suma, negativo resta</p>
          <form method="post" action="/admin/users/${u.id}/balance"><div class="field"><input name="amount" class="num" style="width:100%" placeholder="Ej: 10 o -5" inputmode="decimal" required></div>
          <div class="field"><input name="note" style="width:100%" placeholder="Nota (opcional)"></div>
          <label class="switch" style="margin-bottom:14px"><input type="checkbox" name="notify" checked> Avisar al cliente</label><br><button>${icon('check', 16)} Aplicar</button></form></div>
        <div class="card"><h3>${icon('send')} Enviar mensaje</h3><p class="sub">Llega directo a su chat con el bot</p>
          <form method="post" action="/admin/users/${u.id}/message"><textarea name="text" style="min-height:96px" placeholder="Hola 👋 …"></textarea><p style="margin:10px 0 0"><button>${icon('send', 16)} Enviar</button></p></form></div>
        <div class="card"><h3>${icon('shield')} Acceso</h3><p class="sub">${u.banned ? 'Este cliente no puede usar el bot' : 'Bloquea a clientes problemáticos'}</p>
          <form method="post" action="/admin/users/${u.id}/ban" onsubmit="return confirm('¿Seguro?')"><button class="${u.banned ? 'okb' : 'badb'}">${u.banned ? icon('check', 16) + ' Desbloquear cliente' : icon('x', 16) + ' Bloquear cliente'}</button></form></div>
      </div>
      <div class="sec-title">Pedidos</div><div class="card">${ordersTable(orders)}</div>
      <div class="sec-title">Movimientos</div><div class="card"><div class="tablewrap"><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Detalle</th><th class="r">Monto</th></tr></thead><tbody>
      ${txs.map((t) => `<tr><td class="muted">${fmtDate(t.created_at)}</td><td><span class="badge ${(TX[t.type] || ['', 'b-muted'])[1]}">${(TX[t.type] || [t.type])[0]}</span></td><td class="wrap">${esc(t.note || '')}</td><td class="r num ${t.amount >= 0 ? 'ok' : 'bad'}"><b>${t.amount >= 0 ? '+' : ''}${money(t.amount)}</b></td></tr>`).join('') || `<tr><td colspan="4">${emptyBox('📜', 'Sin movimientos')}</td></tr>`}
      </tbody></table></div></div>`;
    await render(req, res, 'Cliente', body, { subtitle: `<a href="/admin/users">← Volver a clientes</a>` });
  });
  r.post('/users/:id/balance', async (req, res) => {
    const id = Number(req.params.id);
    const amount = Number(String(req.body.amount || '').replace(',', '.'));
    if (!amount) return back(res, `/admin/users/${id}`, 'Monto inválido');
    try {
      const bal = await credit(id, amount, amount > 0 ? 'recharge' : 'adjust', req.body.note || 'Ajuste desde el panel');
      if (req.body.notify) {
        await bot.notify.user(id, amount > 0
          ? `💰 Se acreditaron <b>${money(amount)} ${cur()}</b> a tu saldo. Saldo actual: <b>${money(bal)}</b>`
          : `ℹ️ Se ajustó tu saldo en ${money(amount)} ${cur()}. Saldo actual: <b>${money(bal)}</b>`);
      }
      back(res, `/admin/users/${id}`, `Nuevo saldo: ${money(bal)} ${cur()}`);
    } catch (e) {
      back(res, `/admin/users/${id}`, `Error: ${e.message}`);
    }
  });
  r.post('/users/:id/ban', async (req, res) => {
    const u = await one('UPDATE users SET banned = NOT banned WHERE id=$1 RETURNING banned', [Number(req.params.id)]);
    back(res, `/admin/users/${req.params.id}`, u?.banned ? 'Cliente bloqueado' : 'Cliente desbloqueado');
  });
  r.post('/users/:id/message', async (req, res) => {
    const ok = await bot.notify.user(Number(req.params.id), String(req.body.text || '').slice(0, 4000));
    back(res, `/admin/users/${req.params.id}`, ok ? 'Mensaje enviado' : 'No se pudo enviar (¿bloqueó el bot o el HTML es inválido?)');
  });

  // ---------- productos ----------
  r.get('/products', async (req, res) => {
    let products = [];
    let err = '';
    try {
      if (req.query.fresh === '1') await Promise.allSettled([kokoro.products(true), bunny.products(true)]);
      products = await catalog.allProducts();
    } catch (e) {
      err = e.message;
    }
    const cat = String(req.query.cat || '');
    const src = String(req.query.src || '');
    const counts = {};
    for (const p of products) counts[categoryOf(p.name).key] = (counts[categoryOf(p.name).key] || 0) + 1;
    let list = products;
    if (cat) list = list.filter((p) => categoryOf(p.name).key === cat);
    if (src) list = list.filter((p) => p.source === src);
    list.sort((a, b) => (a.group || a.name).localeCompare(b.group || b.name) || a.price - b.price);
    const link = (c, sr) => `/admin/products?${new URLSearchParams({ ...(c ? { cat: c } : {}), ...(sr ? { src: sr } : {}) })}`;
    const chips = `<a class="chipf ${!cat ? 'on' : ''}" href="${link('', src)}">Todas (${products.length})</a>${DISPLAY_ORDER.filter((c) => counts[c.key]).map((c) => `<a class="chipf ${cat === c.key ? 'on' : ''}" href="${link(c.key, src)}">${c.icon} ${c.label} (${counts[c.key]})</a>`).join('')}`;
    const srcChips = `<a class="chipf ${!src ? 'on' : ''}" href="${link(cat, '')}">Ambos</a><a class="chipf ${src === 'kokoro' ? 'on' : ''}" href="${link(cat, 'kokoro')}">🏦 KOKORO</a><a class="chipf ${src === 'bunny' ? 'on' : ''}" href="${link(cat, 'bunny')}">🐰 Bunny</a>`;
    const backUrl = link(cat, src);
    const rows = list.map((p) => {
      const o = getOverride(p.id) || {};
      const fid = `f_${crypto.createHash('md5').update(p.id).digest('hex').slice(0, 10)}`;
      const c = categoryOf(p.name);
      const price = productUnitPrice(p);
      const profit = price - Number(p.price);
      return `<tr style="${p.winner ? '' : 'opacity:.5'}">
        <td class="wrap"><div class="prod"><span style="font-size:18px">${iconOf(p.name)}</span><div><b>${esc(p.name)}</b>${p.group ? `<div style="font-size:12px" class="${p.winner ? 'ok' : 'muted'}">${p.winner ? '✅ Visible en el bot' : '⏸ Oculto: hay uno más barato'}${p.displayName ? ` como “${esc(p.group)}”` : ''}</div>` : ''}<div class="row" style="gap:6px;margin-top:5px"><span class="badge b-muted">${c.icon} ${c.label}</span>${sourceBadge(p.source)}</div></div></div></td>
        <td class="r num">${p.stock > 0 ? (p.stock >= 999 ? '∞' : p.stock) : '<span class="badge b-bad">Agotado</span>'}</td>
        <td class="r num muted">${money(p.price)}</td>
        <td class="r num"><b>${money(price)}</b><div class="ok" style="font-size:12px">+${money(profit)}</div></td>
        <td><input form="${fid}" name="markup" class="in-sm num" style="width:70px" value="${o.markup ?? ''}" placeholder="${tierPct(Number(p.price), 'products')}%" title="Margen % (vacío = automático por tramos)"></td>
        <td><input form="${fid}" name="fixed_price" class="in-sm num" style="width:76px" value="${o.fixed_price ?? ''}" placeholder="—" title="Precio fijo"></td>
        <td><label class="switch" title="Destacar en Más vendidos"><input form="${fid}" type="checkbox" name="featured" ${o.featured ? 'checked' : ''}></label></td>
        <td><label class="switch" title="Ocultar del bot"><input form="${fid}" type="checkbox" name="hidden" ${o.hidden ? 'checked' : ''}></label></td>
        <td><form id="${fid}" method="post" action="/admin/overrides" style="margin:0"><input type="hidden" name="item_id" value="${esc(p.id)}"><input type="hidden" name="kind" value="product"><input type="hidden" name="name" value="${esc(p.name)}"><input type="hidden" name="back" value="${esc(backUrl)}"><button class="sm">Guardar</button></form></td></tr>`;
    }).join('');
    const body = `
      ${err ? `<div class="card" style="margin-bottom:16px"><b class="bad">Error al leer el catálogo:</b> ${esc(err)}</div>` : ''}
      ${catalog.bunnyStatus().error ? `<div class="card" style="margin-bottom:16px"><b class="warn">Bunny no respondió:</b> ${esc(catalog.bunnyStatus().error)}</div>` : ''}
      <div class="card" style="margin-bottom:16px"><div class="chips" style="margin-bottom:12px">${chips}</div><div class="split" style="flex-wrap:wrap"><div class="chips">${srcChips}</div>
        <div class="searchbox">${icon('search', 16)}<input data-filter="#ptable" placeholder="Filtrar al instante…"></div></div></div>
      <div class="card"><div class="tablewrap"><table id="ptable"><thead><tr><th>Producto</th><th class="r">Stock</th><th class="r">Costo</th><th class="r">Tu precio</th><th>Margen</th><th>Precio fijo</th><th>⭐</th><th>Ocultar</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="9">${emptyBox('📦', 'No hay productos con ese filtro')}</td></tr>`}</tbody></table></div></div>`;
    const actions = `<a class="btn ghost" href="/admin/settings#precios">${icon('settings', 16)} Márgenes</a><a class="btn" href="/admin/products?fresh=1">${icon('refresh', 16)} Recargar precios</a>`;
    await render(req, res, 'Productos', body, {
      subtitle: `KOKORO + Bunny unidos: cuando un producto está en ambos, el bot muestra solo el más barato con stock. Margen automático por tramos (${esc(s('price_tiers_products') || s('markup_products') + '%')}).`,
      actions,
    });
  });

  // ---------- juegos ----------
  r.get('/games', async (req, res) => {
    const kind = ['topup', 'giftcard', 'key'].includes(req.query.kind) ? req.query.kind : 'topup';
    const q = String(req.query.q || '').trim();
    let games = [];
    let err = '';
    try {
      games = (await kokoro.games(q ? { q } : { kind })).games || [];
    } catch (e) {
      err = e.message;
    }
    const tab = (k, l) => `<a class="chipf ${k === kind && !q ? 'on' : ''}" href="/admin/games?kind=${k}">${l}</a>`;
    const rows = games.map((g) => {
      const o = getOverride(g.id) || {};
      const fid = `g_${crypto.createHash('md5').update(g.id).digest('hex').slice(0, 10)}`;
      return `<tr><td class="wrap"><a href="/admin/game?id=${encodeURIComponent(g.id)}" style="text-decoration:none"><div class="prod"><span style="font-size:18px">${esc(g.emoji_base || '🎮')}</span><div><b>${esc(g.name)}</b><div class="muted" style="font-size:11px">${esc(g.id)}${g.enabled === false ? ' · solo por búsqueda' : ''}</div></div></div></a></td>
        <td class="r num">${g.packs ?? ''}</td><td class="r num muted">${g.from_price != null ? money(g.from_price) : '—'}</td><td class="r num"><b>${gameFromPrice(g) != null ? money(gameFromPrice(g)) : '—'}</b></td>
        <td><input form="${fid}" name="markup" class="in-sm num" value="${o.markup ?? ''}" placeholder="${tierPct(Number(g.from_price || 0), 'games')}%"></td>
        <td><label class="switch"><input form="${fid}" type="checkbox" name="hidden" ${o.hidden ? 'checked' : ''}></label></td>
        <td><form id="${fid}" method="post" action="/admin/overrides" style="margin:0"><input type="hidden" name="item_id" value="${esc(g.id)}"><input type="hidden" name="kind" value="game"><input type="hidden" name="name" value="${esc(g.name)}"><input type="hidden" name="back" value="/admin/games?kind=${kind}${q ? `&q=${encodeURIComponent(q)}` : ''}"><button class="sm">Guardar</button></form></td></tr>`;
    }).join('');
    const body = `${err ? `<div class="card" style="margin-bottom:16px"><b class="bad">Error al leer KOKORO:</b> ${esc(err)}</div>` : ''}
      <div class="card" style="margin-bottom:16px"><div class="split" style="flex-wrap:wrap"><div class="chips">${tab('topup', '🎮 Recargas')}${tab('giftcard', '🎁 Gift cards')}${tab('key', '🔑 Keys PC')}</div>
      <form class="row" style="margin:0"><div class="searchbox">${icon('search', 16)}<input name="q" value="${esc(q)}" placeholder="Buscar en todo el catálogo"></div><button class="sm">Buscar</button></form></div></div>
      <div class="card"><div class="tablewrap"><table><thead><tr><th>Juego</th><th class="r">Paquetes</th><th class="r">Desde (costo)</th><th class="r">Desde (tu precio)</th><th>Margen</th><th>Ocultar</th><th></th></tr></thead><tbody>
      ${rows || `<tr><td colspan="7">${emptyBox('🎮', 'Sin resultados')}</td></tr>`}</tbody></table></div></div>`;
    await render(req, res, 'Juegos y gift cards', body, { subtitle: `Margen automático por tramos (${esc(s('price_tiers_games') || s('markup_games') + '%')}). Entra a un juego para ajustar paquetes concretos.` });
  });
  r.get('/game', async (req, res) => {
    const id = String(req.query.id || '');
    let data;
    try {
      data = await kokoro.gamePacks(id);
    } catch (e) {
      return back(res, '/admin/games', `Error: ${e.message}`);
    }
    const game = data.game || { id, name: id };
    const rows = (data.products || []).map((p) => {
      const o = getOverride(p.id) || {};
      const fid = `k_${crypto.createHash('md5').update(p.id).digest('hex').slice(0, 10)}`;
      const price = packPrice(p, game.id);
      return `<tr><td><b>${esc(p.pack || p.name)}</b></td><td><span class="badge b-muted">${esc(p.region_name_es || p.region_name || p.region || 'Global')}</span></td><td>${p.in_stock === false ? '<span class="badge b-bad">Sin stock</span>' : '<span class="badge b-ok">Disponible</span>'}</td>
        <td class="r num muted">${money(p.price)}</td><td class="r num"><b>${money(price)}</b><div class="ok" style="font-size:12px">+${money(price - p.price)}</div></td>
        <td><input form="${fid}" name="markup" class="in-sm num" value="${o.markup ?? ''}" placeholder="auto"></td>
        <td><input form="${fid}" name="fixed_price" class="in-sm num" value="${o.fixed_price ?? ''}" placeholder="—"></td>
        <td><label class="switch"><input form="${fid}" type="checkbox" name="hidden" ${o.hidden ? 'checked' : ''}></label></td>
        <td><form id="${fid}" method="post" action="/admin/overrides" style="margin:0"><input type="hidden" name="item_id" value="${esc(p.id)}"><input type="hidden" name="kind" value="pack"><input type="hidden" name="name" value="${esc(`${game.name} — ${p.pack || p.name}`)}"><input type="hidden" name="back" value="/admin/game?id=${encodeURIComponent(id)}"><button class="sm">Guardar</button></form></td></tr>`;
    }).join('');
    const body = `<div class="card"><div class="split" style="margin-bottom:14px"><span class="muted">${(data.products || []).length} paquetes</span><div class="searchbox">${icon('search', 16)}<input data-filter="#gtable" placeholder="Filtrar paquetes o región…"></div></div>
      <div class="tablewrap"><table id="gtable"><thead><tr><th>Paquete</th><th>Región</th><th>Stock</th><th class="r">Costo</th><th class="r">Tu precio</th><th>Margen</th><th>Precio fijo</th><th>Ocultar</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
    await render(req, res, `${game.emoji_base || '🎮'} ${game.name}`, body, { path: '/admin/games', subtitle: `<a href="/admin/games?kind=${game.kind || 'topup'}">← Volver a juegos</a>` });
  });
  r.post('/overrides', async (req, res) => {
    const { item_id, kind, name, markup, fixed_price, hidden, featured } = req.body;
    if (!item_id) return back(res, '/admin', 'Falta el producto');
    await saveOverride(String(item_id), String(kind), String(name || ''), {
      markup: String(markup ?? '').replace(',', '.').replace('%', ''),
      fixed_price: String(fixed_price ?? '').replace(',', '.'),
      hidden: !!hidden,
      featured: !!featured,
    });
    const to = String(req.body.back || '/admin').startsWith('/admin') ? String(req.body.back) : '/admin';
    back(res, to, `Guardado: ${name || item_id}`);
  });

  // ---------- difusión ----------
  r.get('/broadcast', async (req, res) => {
    const n = await one('SELECT count(*)::int AS n FROM users WHERE blocked_bot=FALSE AND banned=FALSE');
    const body = `<div class="grid g2">
      <div class="card"><h3>${icon('megaphone')} Nuevo mensaje</h3><p class="sub">Llegará a <b>${n.n}</b> clientes activos. Admite &lt;b&gt;negrita&lt;/b&gt;, &lt;i&gt;cursiva&lt;/i&gt; y enlaces.</p>
        <form method="post" action="/admin/broadcast" onsubmit="return confirm('¿Enviar a ${n.n} clientes?')">
        <textarea id="bc" name="text" required style="min-height:200px" placeholder="🔥 <b>¡Nuevo stock!</b>&#10;Gemini PRO 18 meses a solo 1.59 USDT ⚡"></textarea>
        <div class="row" style="margin-top:12px"><button>${icon('send', 16)} Enviar a todos</button><span class="help">Se envía en segundo plano y te aviso por Telegram al terminar.</span></div></form></div>
      <div class="card"><h3>${icon('send')} Vista previa</h3><p class="sub">Así lo verán tus clientes</p>
        <div style="background:#0e1621;border-radius:14px;padding:18px;min-height:200px"><div id="pv" style="background:#182533;color:#fff;border-radius:14px 14px 14px 4px;padding:10px 13px;max-width:92%;white-space:pre-wrap;word-wrap:break-word;font-size:14.5px;line-height:1.45">Escribe tu mensaje…</div></div>
        <p class="help">💡 Consejos: anuncia productos nuevos, bajadas de precio o recargas con bonus. Evita enviar más de 1–2 mensajes por semana.</p></div></div>
      <script>(function(){var t=document.getElementById('bc'),p=document.getElementById('pv');function e(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
      function r(){var h=e(t.value||'Escribe tu mensaje…').replace(/&lt;(\\/?)(b|i|u|s|code)&gt;/g,'<$1$2>').replace(/&lt;a href=&quot;(.*?)&quot;&gt;(.*?)&lt;\\/a&gt;/g,'<a style="color:#6ab3f3" href="$1">$2</a>');p.innerHTML=h}t.addEventListener('input',r)})();</script>`;
    await render(req, res, 'Difusión', body, { subtitle: 'Envía promociones y novedades a todos tus clientes' });
  });
  r.post('/broadcast', async (req, res) => {
    const text = String(req.body.text || '').trim().slice(0, 4000);
    if (!text) return back(res, '/admin/broadcast', 'Falta escribir el mensaje');
    const users = await many('SELECT id FROM users WHERE blocked_bot=FALSE AND banned=FALSE');
    (async () => {
      let ok = 0;
      for (const u of users) {
        if (await bot.notify.user(u.id, text)) ok++;
        await new Promise((r2) => setTimeout(r2, 60)); // respeta los límites de Telegram
      }
      await bot.notify.admins(`📣 Difusión terminada: ${ok}/${users.length} entregados.`);
    })();
    back(res, '/admin/broadcast', `Enviando a ${users.length} clientes. Te aviso por Telegram al terminar.`);
  });

  // ---------- ajustes ----------
  const SECTIONS = [
    ['tienda', 'bag', 'Tienda', 'Datos que ven tus clientes', [
      ['shop_name', 'Nombre de la tienda', 'text'],
      ['support_contact', 'Contacto de soporte', 'text', 'Ej: @tu_usuario'],
      ['channel_url', 'Canal de Telegram (opcional)', 'text', 'Ej: https://t.me/tu_canal — aparece como botón 📢 Canal en el menú.'],
      ['welcome_text', 'Encabezado del menú principal', 'area', 'Usa {name} para el nombre del cliente y {shop} para el nombre de la tienda.'],
    ]],
    ['precios', 'trend', 'Precios y márgenes', 'Cómo se calcula tu ganancia', [
      ['price_tiers_products', 'Margen por tramos — productos', 'text', 'Formato COSTO_MÁX:%. Ej: 1:60,3:40,10:30,30:20,*:12 = hasta 1 USD ganas 60 %, hasta 3 USD 40 %… el resto 12 %. Vacío = margen general.'],
      ['min_profit_products', 'Ganancia mínima por pedido — productos (USD)', 'number', 'Para que lo muy barato también deje ganancia. Ej: 0.20'],
      ['price_tiers_games', 'Margen por tramos — juegos, gift cards y keys', 'text', 'Las recargas de juegos son muy competidas: márgenes más bajos. Ej: 5:20,20:12,*:8'],
      ['min_profit_games', 'Ganancia mínima por pedido — juegos (USD)', 'number'],
      ['markup_products', 'Margen general productos (%)', 'number', 'Solo se usa si dejas vacíos los tramos.'],
      ['markup_games', 'Margen general juegos (%)', 'number', 'Solo se usa si dejas vacíos los tramos.'],
    ]],
    ['pagos', 'wallet', 'Pagos y moneda', 'Recargas y precios en pesos', [
      ['payment_instructions', 'Instrucciones de pago', 'area', 'Tus métodos: llave Bre-B, Nequi, Binance… El cliente las ve al recargar.'],
      ['cop_rate', 'Pesos colombianos por 1 USD', 'text', 'auto = tasa del día + margen (recomendado). También un número fijo (ej: 3300) o 0 para no mostrar COP.'],
      ['cop_spread', 'Margen sobre la tasa automática (%)', 'number', 'Cubre lo que te cuesta convertir pesos a USDT. Recomendado: 3.'],
      ['price_display', 'Mostrar precios en', 'text', 'cop = pesos redondos ($5.400) — recomendado para Colombia · usd = USDT'],
      ['min_recharge', 'Recarga mínima (USD)', 'number', 'En pesos se redondea a miles. Ej: 3 USD ≈ $10.000.'],
      ['currency', 'Moneda interna', 'text'],
    ]],
    ['crecimiento', 'users', 'Fidelización y referidos', 'Haz que tus clientes vuelvan', [
      ['cashback_tiers', 'Ñapa por nivel', 'text', 'Formato COMPRADO_USD:%. Ej: 10:1,50:2,200:3 = Plata 1 %, Oro 2 %, Diamante 3 % devuelto en saldo en cada compra. Vacío = sin ñapa.'],
      ['renew_reminder_days', 'Recordar renovación (días antes de vencer)', 'number', 'El bot avisa al cliente antes de que venza su suscripción, con botón para renovar. 0 = desactivado.'],
      ['referral_percent', 'Comisión por referido (%)', 'number', 'Lo que gana un cliente por cada compra de sus invitados. 0 = desactivado. Sale de tu ganancia.'],
      ['low_balance_alert', 'Avisarme si el saldo de un proveedor baja de (USD)', 'number'],
    ]],
  ];
  const FIELDS = SECTIONS.flatMap((x) => x[4]);
  r.get('/settings', async (req, res) => {
    const field = ([k, label, type, help]) => `<div class="field"><label for="${k}">${label}</label>
      ${type === 'area' ? `<textarea id="${k}" name="${k}">${esc(s(k))}</textarea>` : `<input id="${k}" name="${k}" value="${esc(s(k))}" ${type === 'number' ? 'inputmode="decimal" class="num"' : ''} style="width:100%">`}
      ${help ? `<div class="help">${esc(help)}</div>` : ''}</div>`;
    const body = `<form method="post" action="/admin/settings"><div class="grid g2">
      ${SECTIONS.map(([id, ic, title, sub, fields]) => `<div class="card" id="${id}"><h3>${icon(ic)} ${title}</h3><p class="sub">${sub}</p>${fields.map(field).join('')}</div>`).join('')}
      </div>
      <div class="card" style="margin-top:16px"><div class="split" style="flex-wrap:wrap"><label class="switch"><input type="checkbox" name="maintenance" ${s('maintenance') === '1' ? 'checked' : ''}> Modo mantenimiento <span class="muted">(el bot no atiende a clientes)</span></label>
      <button>${icon('check', 16)} Guardar ajustes</button></div></div></form>
      <div class="sec-title">Sistema</div>
      <div class="grid g3">
        <div class="card"><h3>${icon('link')} Conexiones</h3><p class="sub">Proveedores y Telegram</p>
          <div class="grid" style="gap:10px">
          <div class="split"><span>🏦 API KOKORO</span>${config.kokoroToken ? '<span class="badge b-ok">Conectada</span>' : '<span class="badge b-bad">Falta token</span>'}</div>
          <div class="split"><span>🐰 API Bunny</span>${bunnyEnabled() ? '<span class="badge b-ok">Conectada</span>' : '<span class="badge b-warn">Sin API key</span>'}</div>
          <div class="split"><span>🤖 Bot</span><a href="https://t.me/${esc(bot.botInfo?.username || '')}" target="_blank">@${esc(bot.botInfo?.username || '')}</a></div>
          <div class="split"><span>👤 Admins</span><span class="num muted">${config.adminIds.join(', ') || '—'}</span></div></div></div>
        <div class="card"><h3>${icon('refresh')} Catálogo</h3><p class="sub">Precios y stock se actualizan solos cada 3 minutos</p>
          <div class="split" style="margin-bottom:12px"><span class="muted">Última actualización</span><b>${lastRefresh.at ? fmtDate(lastRefresh.at).slice(11) + ' UTC' : 'pendiente'}</b></div>
          <div class="split" style="margin-bottom:14px"><span class="muted">Listas actualizadas</span><b class="num">${lastRefresh.ok}/${lastRefresh.total} · ${(lastRefresh.ms / 1000).toFixed(1)} s</b></div>
          <form method="post" action="/admin/cache" style="margin:0"><button class="ghost" style="width:100%">${icon('refresh', 16)} Actualizar ahora</button></form></div>
        <div class="card"><h3>${icon('dollar')} Tasa COP</h3><p class="sub">${String(s('cop_rate')).toLowerCase() === 'auto' ? `Automática + ${esc(s('cop_spread'))}%` : 'Fija'}</p>
          <div class="v num" style="font-size:28px;font-weight:750">${copRate() ? copRate().toLocaleString('es-CO') : '—'}</div><p class="help">pesos por 1 USD${copRate() ? ` · 10 ${cur()} = ${cop(10)}` : ''}</p></div>
      </div>`;
    await render(req, res, 'Ajustes', body, { subtitle: 'Configura tu tienda, tus márgenes y tus métodos de pago' });
  });
  r.post('/settings', async (req, res) => {
    const values = {};
    for (const [k, , type] of FIELDS) {
      if (req.body[k] === undefined) continue;
      let v = String(req.body[k]);
      if (type === 'number') {
        v = v.replace(',', '.');
        if (Number.isNaN(Number(v))) return back(res, '/admin/settings', `Valor inválido en "${k}"`);
      }
      values[k] = v;
    }
    values.maintenance = req.body.maintenance ? '1' : '0';
    await saveSettings(values);
    back(res, '/admin/settings', 'Ajustes guardados');
  });
  r.post('/cache', async (req, res) => {
    clearCache();
    bunny.clearCache();
    await warmUp().catch(() => {});
    back(res, String(req.get('referer') || '').includes('/admin/settings') ? '/admin/settings' : '/admin', 'Catálogo actualizado desde los proveedores');
  });

  return r;
}

export { DEFAULTS };
