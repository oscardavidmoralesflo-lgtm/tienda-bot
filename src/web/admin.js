// Panel de administración web (/admin)
import express from 'express';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { one, many, query } from '../db.js';
import { kokoro, clearCache } from '../kokoro.js';
import { bunny, bunnyEnabled } from '../bunny.js';
import * as catalog from '../catalog.js';
import { s, DEFAULTS, saveSettings } from '../settings.js';
import { money, productUnitPrice, packPrice, gameFromPrice, getOverride, saveOverride } from '../pricing.js';
import { credit } from '../users.js';
import { stats, refreshOrder, refundOrder, notifyDelivered, deliverManually } from '../orders.js';
import { esc, fmtDate, STATUS_ES } from '../util.js';
import { page, loginPage } from './layout.js';

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

const statusPill = (st) => `<span class="pill">${STATUS_ES[st] || esc(st)}</span>`;
const userLabel = (u) => `${esc(u.first_name || '')}${u.username ? ` <span class="muted">@${esc(u.username)}</span>` : ''}`;
const back = (res, url, msg) => res.redirect(`${url}${url.includes('?') ? '&' : '?'}m=${encodeURIComponent(msg)}`);

export function adminRouter(bot) {
  const r = express.Router();
  r.use(express.urlencoded({ extended: false, limit: '200kb' }));

  // ---------- login ----------
  r.get('/login', (req, res) => res.send(loginPage()));
  r.post('/login', (req, res) => {
    const ip = req.ip;
    const f = fails.get(ip) || { n: 0, t: Date.now() };
    if (Date.now() - f.t > 15 * 60_000) { f.n = 0; f.t = Date.now(); }
    if (f.n >= 10) return res.status(429).send(loginPage('Demasiados intentos. Espera 15 minutos.'));
    const given = Buffer.from(String(req.body.password || ''));
    const real = Buffer.from(config.adminPassword);
    const ok = given.length === real.length && crypto.timingSafeEqual(given, real);
    if (!ok) {
      f.n += 1;
      fails.set(ip, f);
      return res.status(401).send(loginPage('Contraseña incorrecta'));
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
  const render = (req, res, title, body) => res.send(page(title, body, { path: req.baseUrl + req.path.replace(/\/$/, ''), flash: req.query.m }));

  // ---------- resumen ----------
  r.get('/', async (req, res) => {
    const st = await stats();
    let kb;
    try {
      kb = `${money((await kokoro.balance()).balance)} USDT`;
    } catch (e) {
      kb = `<span class="bad">Error: ${esc(e.message)}</span>`;
    }
    let bb = '<span class="muted" style="font-size:13px">sin conectar</span>';
    if (bunnyEnabled()) {
      try {
        bb = `${money((await bunny.profile()).merchant?.balance)} USDT`;
      } catch (e) {
        bb = `<span class="bad" style="font-size:13px">Error: ${esc(e.message)}</span>`;
      }
    }
    const recent = await many('SELECT o.*, u.first_name, u.username FROM orders o LEFT JOIN users u ON u.id=o.user_id ORDER BY o.id DESC LIMIT 10');
    const card = (k, v, cls = '') => `<div class="card"><div class="k">${k}</div><div class="v ${cls}">${v}</div></div>`;
    const body = `
      <div class="cards">
        ${card('🏦 Saldo en KOKORO', kb)}
        ${card('🐰 Saldo en Bunny', bb)}
        ${card('💵 Facturado hoy', money(st.revenue_today))}
        ${card('📈 Ganancia hoy', money(st.profit_today), 'ok')}
        ${card('💵 Facturado total', money(st.revenue))}
        ${card('📈 Ganancia total', money(st.profit), 'ok')}
        ${card('🧾 Ventas', st.orders)}
        ${card('👤 Clientes', `${st.users} <span class="muted" style="font-size:13px">+${st.users_today} hoy</span>`)}
        ${card('👛 Saldo de clientes', money(st.customer_balances))}
        ${card('💳 Recargas pendientes', `<a href="/admin/recharges">${st.pending_recharges}</a>`, st.pending_recharges ? 'warn' : '')}
        ${card('⏳ Pedidos abiertos', `<a href="/admin/orders?status=open">${st.open_orders}</a>`)}
      </div>
      <p class="help">Recuerda: el saldo en KOKORO debe cubrir lo que tus clientes tienen cargado (${money(st.customer_balances)}). Se recarga en <a href="https://t.me/Shop_KOKORO_BOT" target="_blank">@Shop_KOKORO_BOT</a>.</p>
      <h2>Últimos pedidos</h2>${ordersTable(recent)}`;
    render(req, res, 'Resumen', body);
  });

  // ---------- recargas ----------
  r.get('/recharges', async (req, res) => {
    const pending = await many("SELECT r.*, u.first_name, u.username FROM recharges r LEFT JOIN users u ON u.id=r.user_id WHERE r.status='pending' ORDER BY r.id");
    const done = await many("SELECT r.*, u.first_name, u.username FROM recharges r LEFT JOIN users u ON u.id=r.user_id WHERE r.status<>'pending' ORDER BY r.id DESC LIMIT 50");
    const proof = (x) => (x.proof_file_id ? (x.proof_type === 'photo'
      ? `<a href="/admin/file?id=${encodeURIComponent(x.proof_file_id)}" target="_blank"><img class="proof" src="/admin/file?id=${encodeURIComponent(x.proof_file_id)}" loading="lazy" alt="comprobante"></a>`
      : `<a href="/admin/file?id=${encodeURIComponent(x.proof_file_id)}" target="_blank">📎 Ver archivo</a>`) : '');
    const body = `
      <div class="box"><h2 style="margin-top:0">Pendientes (${pending.length})</h2>
      ${pending.length ? `<table><tr><th>#</th><th>Cliente</th><th>Comprobante</th><th>Monto</th><th>Acción</th></tr>
      ${pending.map((x) => `<tr><td>${x.id}<div class="muted">${fmtDate(x.created_at)}</div></td>
        <td><a href="/admin/users/${x.user_id}">${userLabel(x)}</a><div class="muted">${x.user_id}</div></td>
        <td>${proof(x)}</td>
        <td colspan="2"><form method="post" action="/admin/recharges/${x.id}" class="row">
          <input name="amount" class="w100" value="${money(x.amount)}" inputmode="decimal">
          <button class="ok" name="do" value="approve">✅ Aprobar</button>
          <button class="bad" name="do" value="reject" onclick="return confirm('¿Rechazar la recarga?')">Rechazar</button></form>
          <div class="help">Puedes corregir el monto antes de aprobar.</div></td></tr>`).join('')}</table>` : '<p class="muted">No hay recargas pendientes 🎉</p>'}
      </div>
      <h2>Historial</h2><div class="box"><table><tr><th>#</th><th>Cliente</th><th>Monto</th><th>Estado</th><th class="hide-sm">Por</th><th>Fecha</th></tr>
      ${done.map((x) => `<tr><td>${x.id}</td><td><a href="/admin/users/${x.user_id}">${userLabel(x)}</a></td><td>${money(x.amount)}</td>
        <td>${x.status === 'approved' ? '<span class="ok">Aprobada</span>' : '<span class="bad">Rechazada</span>'}</td><td class="hide-sm muted">${esc(x.handled_by || '')}</td><td>${fmtDate(x.handled_at)}</td></tr>`).join('')}
      </table></div>`;
    render(req, res, 'Recargas', body);
  });
  r.post('/recharges/:id', async (req, res) => {
    const approve = req.body.do === 'approve';
    const amount = Number(String(req.body.amount || '').replace(',', '.'));
    if (approve && !(amount > 0)) return back(res, '/admin/recharges', 'Monto inválido');
    const out = await bot.handleRecharge(Number(req.params.id), approve, 'panel', approve ? amount : null);
    back(res, '/admin/recharges', out.ok ? (approve ? `Recarga #${req.params.id} aprobada: +${money(amount)}` : 'Recarga rechazada') : out.error);
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
  function ordersTable(rows) {
    if (!rows.length) return '<div class="box muted">Sin pedidos</div>';
    return `<div class="box"><table><tr><th>#</th><th>Cliente</th><th>Producto</th><th>Precio</th><th class="hide-sm">Costo</th><th class="hide-sm">Ganancia</th><th>Estado</th><th class="hide-sm">Fecha</th></tr>
      ${rows.map((o) => `<tr><td><a href="/admin/orders/${o.id}">#${o.id}</a></td><td><a href="/admin/users/${o.user_id}">${userLabel(o)}</a></td>
      <td>${esc(o.product_name)}${o.quantity > 1 ? ` <span class="muted">x${o.quantity}</span>` : ''}</td><td>${money(o.price)}</td><td class="hide-sm muted">${money(o.cost)}</td>
      <td class="hide-sm ${o.status === 'delivered' ? 'ok' : 'muted'}">${o.status === 'delivered' ? money(o.price - o.cost) : '—'}</td><td>${statusPill(o.status)}</td><td class="hide-sm muted">${fmtDate(o.created_at)}</td></tr>`).join('')}
    </table></div>`;
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
    const opt = (v, l) => `<option value="${v}" ${st === v ? 'selected' : ''}>${l}</option>`;
    const body = `<form class="row" style="margin-bottom:12px"><input name="q" value="${esc(q)}" placeholder="Buscar producto, #pedido o ID cliente">
      <select name="status">${opt('', 'Todos')}${opt('open', 'Abiertos')}${opt('delivered', 'Entregados')}${opt('refunded', 'Reembolsados')}${opt('action_required', 'Esperando código')}</select><button>Filtrar</button></form>${ordersTable(rows)}`;
    render(req, res, 'Pedidos', body);
  });
  r.get('/orders/:id', async (req, res) => {
    const o = await one('SELECT o.*, u.first_name, u.username FROM orders o LEFT JOIN users u ON u.id=o.user_id WHERE o.id=$1', [Number(req.params.id)]);
    if (!o) return back(res, '/admin/orders', 'Pedido no encontrado');
    const input = typeof o.input === 'string' ? JSON.parse(o.input) : o.input;
    const body = `<div class="box"><table>
      <tr><th>Cliente</th><td><a href="/admin/users/${o.user_id}">${userLabel(o)}</a> (${o.user_id})</td></tr>
      <tr><th>Producto</th><td>${esc(o.product_name)} <span class="muted">${esc(o.product_id)}</span></td></tr>
      <tr><th>Cantidad</th><td>${o.quantity}</td></tr>
      <tr><th>Precio / Costo</th><td>${money(o.price)} / ${money(o.cost)} → ganancia <b>${money(o.price - o.cost)}</b></td></tr>
      <tr><th>Estado</th><td>${statusPill(o.status)} ${o.failure_reason ? `<div class="muted">${esc(o.failure_reason)}</div>` : ''}</td></tr>
      <tr><th>Datos del cliente</th><td><pre>${esc(JSON.stringify(input || {}, null, 1))}</pre></td></tr>
      <tr><th>Entrega</th><td>${o.delivery ? `<pre>${esc(o.delivery)}</pre>` : '<span class="muted">—</span>'}</td></tr>
      <tr><th>Proveedor</th><td>${o.kind === 'bunny' ? '🐰 Bunny' : '🏦 KOKORO'}</td></tr>
      <tr><th>ID proveedor</th><td>${esc(o.kokoro_order_id || '—')} · <span class="muted">${esc(o.external_order_id)}</span></td></tr>
      <tr><th>Fecha</th><td>${fmtDate(o.created_at)} UTC</td></tr></table>
      <div class="row" style="margin-top:12px">
        ${o.kind !== 'bunny' ? `<form method="post" action="/admin/orders/${o.id}/refresh"><button class="ghost">🔄 Consultar estado en KOKORO</button></form>` : ''}
        ${o.status === 'delivered' ? `<form method="post" action="/admin/orders/${o.id}/resend"><button class="ghost">📨 Reenviar entrega al cliente</button></form>` : ''}
        ${!o.refunded ? `<form method="post" action="/admin/orders/${o.id}/refund" onsubmit="return confirm('¿Devolver ${money(o.price)} al saldo del cliente? Esto NO cancela el pedido en KOKORO.')"><button class="bad">↩️ Reembolsar al cliente</button></form>` : ''}
      </div>
      ${o.status !== 'delivered' && !o.refunded ? `<h2>Entregar manualmente</h2><form method="post" action="/admin/orders/${o.id}/deliver"><textarea name="delivery" required placeholder="Pega aquí la cuenta, código o link que recibiste del proveedor"></textarea><p><button class="ok">✅ Marcar entregado y enviar al cliente</button></p></form>` : ''}</div>`;
    render(req, res, `Pedido #${o.id}`, body);
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
      return back(res, url, 'Entrega reenviada');
    }
    if (req.params.action === 'deliver') {
      const text = String(req.body.delivery || '').trim();
      if (!text) return back(res, url, 'Escribe la entrega');
      const d = await deliverManually(o.id, text);
      return back(res, url, d ? 'Entregado y enviado al cliente' : 'No se pudo (¿ya estaba entregado o reembolsado?)');
    }
    if (req.params.action === 'refund') {
      const r2 = await refundOrder(o.id, 'Reembolso manual del administrador');
      return back(res, url, r2 ? 'Reembolsado' : 'Ya estaba reembolsado');
    }
    back(res, url, 'Acción desconocida');
  });

  // ---------- clientes ----------
  r.get('/users', async (req, res) => {
    const q = String(req.query.q || '').trim();
    const rows = q
      ? await many("SELECT * FROM users WHERE CAST(id AS TEXT)=$1 OR username ILIKE $2 OR first_name ILIKE $2 ORDER BY last_seen DESC LIMIT 100", [q.replace('@', ''), `%${q.replace('@', '')}%`])
      : await many('SELECT * FROM users ORDER BY last_seen DESC LIMIT 100');
    const body = `<form class="row" style="margin-bottom:12px"><input name="q" value="${esc(q)}" placeholder="ID, @usuario o nombre"><button>Buscar</button></form>
      <div class="box"><table><tr><th>Cliente</th><th>ID</th><th>Saldo</th><th class="hide-sm">Última vez</th><th class="hide-sm">Estado</th></tr>
      ${rows.map((u) => `<tr><td><a href="/admin/users/${u.id}">${userLabel(u)}</a></td><td>${u.id}</td><td>${money(u.balance)}</td><td class="hide-sm muted">${fmtDate(u.last_seen)}</td>
      <td class="hide-sm">${u.banned ? '<span class="bad">Bloqueado</span>' : u.blocked_bot ? '<span class="muted">Bloqueó el bot</span>' : '<span class="ok">Activo</span>'}</td></tr>`).join('')}
      </table></div>`;
    render(req, res, 'Clientes', body);
  });
  r.get('/users/:id', async (req, res) => {
    const u = await one('SELECT * FROM users WHERE id=$1', [Number(req.params.id)]);
    if (!u) return back(res, '/admin/users', 'Cliente no encontrado');
    const orders = await many('SELECT o.*, $2::text AS first_name, NULL AS username FROM orders o WHERE user_id=$1 ORDER BY id DESC LIMIT 30', [u.id, u.first_name || '']);
    const txs = await many('SELECT * FROM transactions WHERE user_id=$1 ORDER BY id DESC LIMIT 30', [u.id]);
    const invited = await one('SELECT count(*)::int AS n FROM users WHERE referred_by=$1', [u.id]);
    const body = `<div class="cards">
        <div class="card"><div class="k">Saldo</div><div class="v">${money(u.balance)}</div></div>
        <div class="card"><div class="k">ID</div><div class="v" style="font-size:16px">${u.id}</div></div>
        <div class="card"><div class="k">Invitó</div><div class="v">${invited.n}</div></div>
        <div class="card"><div class="k">Alta</div><div class="v" style="font-size:14px">${fmtDate(u.created_at)}</div></div></div>
      <div class="box"><b>${userLabel(u)}</b> ${u.referred_by ? `<span class="muted">· invitado por <a href="/admin/users/${u.referred_by}">${u.referred_by}</a></span>` : ''}
        <h2>Ajustar saldo</h2><form method="post" action="/admin/users/${u.id}/balance" class="row">
          <input name="amount" class="w100" placeholder="+10 o -5" inputmode="decimal" required><input name="note" placeholder="Nota (opcional)">
          <label class="row"><input type="checkbox" name="notify" checked> avisar al cliente</label><button>Aplicar</button></form>
        <h2>Enviar mensaje</h2><form method="post" action="/admin/users/${u.id}/message"><textarea name="text" placeholder="Mensaje (admite HTML de Telegram: &lt;b&gt;, &lt;i&gt;, &lt;code&gt;)"></textarea><p><button>Enviar</button></p></form>
        <form method="post" action="/admin/users/${u.id}/ban"><button class="${u.banned ? 'ok' : 'bad'}">${u.banned ? '✅ Desbloquear cliente' : '🚫 Bloquear cliente'}</button></form>
      </div>
      <h2>Pedidos</h2>${ordersTable(orders)}
      <h2>Movimientos</h2><div class="box"><table><tr><th>Fecha</th><th>Monto</th><th>Tipo</th><th>Nota</th></tr>
      ${txs.map((t) => `<tr><td class="muted">${fmtDate(t.created_at)}</td><td class="${t.amount >= 0 ? 'ok' : 'bad'}">${t.amount >= 0 ? '+' : ''}${money(t.amount)}</td><td>${esc(t.type)}</td><td>${esc(t.note || '')}</td></tr>`).join('')}
      </table></div>`;
    render(req, res, 'Cliente', body);
  });
  r.post('/users/:id/balance', async (req, res) => {
    const id = Number(req.params.id);
    const amount = Number(String(req.body.amount || '').replace(',', '.'));
    if (!amount) return back(res, `/admin/users/${id}`, 'Monto inválido');
    try {
      const bal = await credit(id, amount, amount > 0 ? 'recharge' : 'adjust', req.body.note || 'Ajuste desde el panel');
      if (req.body.notify) {
        await bot.notify.user(id, amount > 0
          ? `💰 Se acreditaron <b>${money(amount)} ${s('currency')}</b> a tu saldo. Saldo actual: <b>${money(bal)}</b>`
          : `ℹ️ Se ajustó tu saldo en ${money(amount)} ${s('currency')}. Saldo actual: <b>${money(bal)}</b>`);
      }
      back(res, `/admin/users/${id}`, `Nuevo saldo: ${money(bal)}`);
    } catch (e) {
      back(res, `/admin/users/${id}`, e.message);
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

  // ---------- precios: productos ----------
  r.get('/products', async (req, res) => {
    let products = [];
    let err = '';
    try {
      if (req.query.fresh === '1') { clearCache(); bunny.clearCache(); }
      products = await catalog.allProducts();
    } catch (e) {
      err = e.message;
    }
    const q = String(req.query.q || '').toLowerCase();
    if (q) products = products.filter((p) => p.name.toLowerCase().includes(q));
    products.sort((a, b) => (a.group || a.name).localeCompare(b.group || b.name) || a.price - b.price);
    const body = `<p class="help">Margen general actual: <b>${esc(s('markup_products'))}%</b> (cámbialo en <a href="/admin/settings">Ajustes</a>). Aquí puedes poner un margen distinto o un precio fijo por producto, u ocultarlo del bot. Deja vacío para usar el margen general.</p>
      ${err ? `<p class="bad">Error al leer el catálogo: ${esc(err)}</p>` : ''}
      ${catalog.bunnyStatus().error ? `<p class="bad">Bunny no respondió: ${esc(catalog.bunnyStatus().error)}</p>` : ''}
      <p class="help">🏦 = KOKORO · 🐰 = Bunny. Cuando un producto está en los dos, el bot muestra solo el <b>más barato con stock</b> (✅) y oculta el otro (⏸). Si el ganador se agota, cambia solo.</p>
      <form class="row" style="margin-bottom:12px"><input name="q" value="${esc(req.query.q || '')}" placeholder="Buscar producto"><button>Buscar</button><a class="btn" style="background:transparent;color:var(--accent)" href="/admin/products?fresh=1">🔄 Recargar catálogo</a></form>
      <div class="box"><table><tr><th>Producto</th><th>Origen</th><th>Stock</th><th>Costo</th><th>Tu precio</th><th>Margen %</th><th>Precio fijo</th><th>Ocultar</th><th></th></tr>
      ${products.map((p) => {
        const o = getOverride(p.id) || {};
        const formId = `f_${crypto.createHash('md5').update(p.id).digest('hex').slice(0, 10)}`;
        return `<tr style="${p.winner ? '' : 'opacity:.55'}"><td>${esc(p.emoji_base || '')} ${esc(p.name)}${p.group ? `<div style="font-size:12px">${p.winner ? '✅ Se muestra como' : '⏸ Oculto (hay uno mejor):'} <b>${esc(p.group)}</b></div>` : ''}<div class="muted" style="font-size:11px">${esc(p.id)}</div></td><td>${p.source === 'bunny' ? '🐰' : '🏦'}</td><td>${p.stock}</td><td>${money(p.price)}</td>
        <td><b>${money(productUnitPrice(p))}</b></td>
        <td><input form="${formId}" name="markup" class="w80" value="${o.markup ?? ''}" placeholder="${esc(s('markup_products'))}"></td>
        <td><input form="${formId}" name="fixed_price" class="w80" value="${o.fixed_price ?? ''}"></td>
        <td><input form="${formId}" type="checkbox" name="hidden" ${o.hidden ? 'checked' : ''}></td>
        <td><form id="${formId}" method="post" action="/admin/overrides"><input type="hidden" name="item_id" value="${esc(p.id)}"><input type="hidden" name="kind" value="product">
        <input type="hidden" name="name" value="${esc(p.name)}"><input type="hidden" name="back" value="/admin/products${q ? `?q=${encodeURIComponent(q)}` : ''}"><button>Guardar</button></form></td></tr>`;
      }).join('')}
      </table></div>`;
    render(req, res, 'Productos', body);
  });

  // ---------- precios: juegos ----------
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
    const tab = (k, l) => `<a class="btn" style="${k === kind && !q ? '' : 'background:transparent;color:var(--accent);border:1px solid var(--line)'}" href="/admin/games?kind=${k}">${l}</a>`;
    const body = `<p class="help">Margen general de juegos: <b>${esc(s('markup_games'))}%</b>. Puedes poner un margen distinto por juego, o entrar a un juego para ajustar paquetes concretos.</p>
      ${err ? `<p class="bad">Error al leer KOKORO: ${esc(err)}</p>` : ''}
      <div class="row" style="margin-bottom:12px">${tab('topup', '🎮 Recargas')}${tab('giftcard', '🎁 Gift cards')}${tab('key', '🔑 Keys')}
      <form class="row"><input name="q" value="${esc(q)}" placeholder="Buscar en todo el catálogo"><button>Buscar</button></form></div>
      <div class="box"><table><tr><th>Juego</th><th>Paquetes</th><th>Desde (costo)</th><th>Desde (tu precio)</th><th>Margen %</th><th>Ocultar</th><th></th></tr>
      ${games.map((g) => {
        const o = getOverride(g.id) || {};
        const formId = `g_${crypto.createHash('md5').update(g.id).digest('hex').slice(0, 10)}`;
        return `<tr><td><a href="/admin/game?id=${encodeURIComponent(g.id)}">${esc(g.emoji_base || '')} ${esc(g.name)}</a><div class="muted" style="font-size:11px">${esc(g.id)}${g.enabled === false ? ' · solo por búsqueda' : ''}</div></td>
        <td>${g.packs ?? ''}</td><td>${g.from_price != null ? money(g.from_price) : '—'}</td><td><b>${gameFromPrice(g) != null ? money(gameFromPrice(g)) : '—'}</b></td>
        <td><input form="${formId}" name="markup" class="w80" value="${o.markup ?? ''}" placeholder="${esc(s('markup_games'))}"></td>
        <td><input form="${formId}" type="checkbox" name="hidden" ${o.hidden ? 'checked' : ''}></td>
        <td><form id="${formId}" method="post" action="/admin/overrides"><input type="hidden" name="item_id" value="${esc(g.id)}"><input type="hidden" name="kind" value="game">
        <input type="hidden" name="name" value="${esc(g.name)}"><input type="hidden" name="back" value="/admin/games?kind=${kind}${q ? `&q=${encodeURIComponent(q)}` : ''}"><button>Guardar</button></form></td></tr>`;
      }).join('')}</table></div>`;
    render(req, res, 'Juegos y gift cards', body);
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
    const body = `<p><a href="/admin/games?kind=${game.kind || 'topup'}">⬅️ Volver</a></p>
      <div class="box"><table><tr><th>Paquete</th><th>Región</th><th>Stock</th><th>Costo</th><th>Tu precio</th><th>Margen %</th><th>Precio fijo</th><th>Ocultar</th><th></th></tr>
      ${(data.products || []).map((p) => {
        const o = getOverride(p.id) || {};
        const formId = `k_${crypto.createHash('md5').update(p.id).digest('hex').slice(0, 10)}`;
        return `<tr><td>${esc(p.pack || p.name)}</td><td>${esc(p.region_name_es || p.region_name || p.region || '')}</td><td>${p.in_stock === false ? '<span class="bad">No</span>' : 'Sí'}</td>
        <td>${money(p.price)}</td><td><b>${money(packPrice(p, game.id))}</b></td>
        <td><input form="${formId}" name="markup" class="w80" value="${o.markup ?? ''}"></td>
        <td><input form="${formId}" name="fixed_price" class="w80" value="${o.fixed_price ?? ''}"></td>
        <td><input form="${formId}" type="checkbox" name="hidden" ${o.hidden ? 'checked' : ''}></td>
        <td><form id="${formId}" method="post" action="/admin/overrides"><input type="hidden" name="item_id" value="${esc(p.id)}"><input type="hidden" name="kind" value="pack">
        <input type="hidden" name="name" value="${esc(`${game.name} — ${p.pack || p.name}`)}"><input type="hidden" name="back" value="/admin/game?id=${encodeURIComponent(id)}"><button>Guardar</button></form></td></tr>`;
      }).join('')}</table></div>`;
    render(req, res, game.name, body);
  });
  r.post('/overrides', async (req, res) => {
    const { item_id, kind, name, markup, fixed_price, hidden } = req.body;
    if (!item_id) return back(res, '/admin', 'Falta el producto');
    await saveOverride(String(item_id), String(kind), String(name || ''), {
      markup: String(markup ?? '').replace(',', '.'),
      fixed_price: String(fixed_price ?? '').replace(',', '.'),
      hidden: !!hidden,
    });
    const to = String(req.body.back || '/admin').startsWith('/admin') ? String(req.body.back) : '/admin';
    back(res, to, `Guardado: ${name || item_id}`);
  });

  // ---------- difusión ----------
  r.get('/broadcast', async (req, res) => {
    const n = await one('SELECT count(*)::int AS n FROM users WHERE blocked_bot=FALSE AND banned=FALSE');
    const body = `<div class="box"><p>Envía un mensaje a todos tus clientes activos (<b>${n.n}</b>). Admite HTML de Telegram: &lt;b&gt;negrita&lt;/b&gt;, &lt;i&gt;cursiva&lt;/i&gt;, &lt;a href="..."&gt;enlace&lt;/a&gt;.</p>
      <form method="post" action="/admin/broadcast" onsubmit="return confirm('¿Enviar a todos los clientes?')"><textarea name="text" required placeholder="🔥 ¡Nuevos productos disponibles!"></textarea>
      <p><button>📣 Enviar a todos</button></p></form></div>`;
    render(req, res, 'Difusión', body);
  });
  r.post('/broadcast', async (req, res) => {
    const text = String(req.body.text || '').trim().slice(0, 4000);
    if (!text) return back(res, '/admin/broadcast', 'Mensaje vacío');
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
  const FIELDS = [
    ['shop_name', 'Nombre de la tienda', 'text'],
    ['markup_products', 'Margen de ganancia en productos (%)', 'number', 'Se suma al costo de KOKORO. Ej: 20 = cobras 20% más.'],
    ['markup_games', 'Margen de ganancia en juegos / gift cards / keys (%)', 'number'],
    ['referral_percent', 'Comisión por referido (%)', 'number', 'Lo que gana un cliente por cada compra de sus invitados. 0 = desactivado. Sale de tu ganancia.'],
    ['min_recharge', 'Recarga mínima', 'number'],
    ['currency', 'Moneda que se muestra', 'text'],
    ['low_balance_alert', 'Avisarme si mi saldo en KOKORO baja de', 'number'],
    ['support_contact', 'Contacto de soporte', 'text', 'Ej: @tu_usuario'],
    ['welcome_text', 'Mensaje de bienvenida', 'area', 'Usa {name} para el nombre del cliente y {shop} para el nombre de la tienda. Admite HTML de Telegram.'],
    ['payment_instructions', 'Instrucciones de pago (al recargar)', 'area', 'Pon aquí tus métodos de pago: Binance Pay, USDT, transferencia, etc.'],
  ];
  r.get('/settings', async (req, res) => {
    const body = `<div class="box"><form method="post" action="/admin/settings">
      ${FIELDS.map(([k, label, type, help]) => `<label class="f" for="${k}">${label}</label>
        ${type === 'area' ? `<textarea id="${k}" name="${k}">${esc(s(k))}</textarea>` : `<input id="${k}" name="${k}" value="${esc(s(k))}" ${type === 'number' ? 'inputmode="decimal"' : ''} style="width:100%;max-width:420px">`}
        ${help ? `<div class="help">${esc(help)}</div>` : ''}`).join('')}
      <label class="f"><input type="checkbox" name="maintenance" ${s('maintenance') === '1' ? 'checked' : ''}> Modo mantenimiento (el bot no atiende a clientes)</label>
      <p><button>💾 Guardar ajustes</button></p></form></div>
      <div class="box"><h2 style="margin-top:0">Conexión</h2>
      <p>API Bunny: ${bunnyEnabled() ? '✅ configurada' : '<span class="warn">sin API key (pon BUNNY_API_KEY)</span>'}</p>
      <p>API KOKORO: <code>${esc(config.kokoroBase)}</code> · token ${config.kokoroToken ? '✅ configurado' : '<span class="bad">falta</span>'}</p>
      <p>Admins de Telegram: ${config.adminIds.length ? config.adminIds.map((i) => `<code>${i}</code>`).join(', ') : '<span class="bad">ninguno (pon ADMIN_IDS)</span>'}</p>
      <p>URL pública: ${config.publicUrl ? esc(config.publicUrl) : '<span class="muted">modo local (polling)</span>'}</p>
      <form method="post" action="/admin/cache"><button class="ghost">🔄 Vaciar caché del catálogo</button></form></div>`;
    render(req, res, 'Ajustes', body);
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
    clearCache();
    back(res, '/admin/settings', 'Ajustes guardados');
  });
  r.post('/cache', (req, res) => {
    clearCache();
    back(res, '/admin/settings', 'Caché vaciada');
  });

  return r;
}

export { DEFAULTS };
