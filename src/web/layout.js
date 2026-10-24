import { esc } from '../util.js';

const NAV = [
  ['/admin', '📊 Resumen'],
  ['/admin/recharges', '💳 Recargas'],
  ['/admin/orders', '🧾 Pedidos'],
  ['/admin/users', '👤 Clientes'],
  ['/admin/products', '🛍 Productos'],
  ['/admin/games', '🎮 Juegos'],
  ['/admin/broadcast', '📣 Difusión'],
  ['/admin/settings', '⚙️ Ajustes'],
];

const CSS = `
:root{--bg:#f5f6f8;--card:#fff;--text:#1d2129;--muted:#6b7280;--line:#e5e7eb;--accent:#4f46e5;--ok:#059669;--bad:#dc2626;--warn:#d97706}
@media (prefers-color-scheme: dark){:root{--bg:#0f1115;--card:#181b22;--text:#e8eaed;--muted:#9aa0aa;--line:#2a2f3a;--accent:#818cf8;--ok:#34d399;--bad:#f87171;--warn:#fbbf24}}
*{box-sizing:border-box}body{margin:0;font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--text)}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
header{background:var(--card);border-bottom:1px solid var(--line);padding:10px 16px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;position:sticky;top:0;z-index:5}
header .brand{font-weight:700;margin-right:12px}
header nav a{padding:6px 10px;border-radius:8px;color:var(--text);white-space:nowrap}header nav a.on{background:var(--accent);color:#fff}
header nav{display:flex;gap:4px;flex-wrap:wrap;flex:1}header form{margin:0}
main{max-width:1200px;margin:0 auto;padding:16px}
h1{font-size:20px;margin:4px 0 16px}h2{font-size:16px;margin:18px 0 10px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px;margin-bottom:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px}
.card .k{color:var(--muted);font-size:12px}.card .v{font-size:22px;font-weight:700;margin-top:2px}
.box{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:16px;overflow-x:auto}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:12px;color:var(--muted);font-weight:600;white-space:nowrap}tr:last-child td{border-bottom:0}
input,select,textarea{font:inherit;color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:7px 9px;max-width:100%}
textarea{width:100%;min-height:110px}
button,.btn{font:inherit;border:0;border-radius:8px;padding:7px 12px;background:var(--accent);color:#fff;cursor:pointer;display:inline-block}
button.ok{background:var(--ok)}button.bad{background:var(--bad)}button.ghost{background:transparent;color:var(--text);border:1px solid var(--line)}
.muted{color:var(--muted)}.ok{color:var(--ok)}.bad{color:var(--bad)}.warn{color:var(--warn)}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.flash{padding:10px 14px;border-radius:10px;margin-bottom:14px;background:var(--card);border:1px solid var(--line)}
.pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;border:1px solid var(--line)}
pre{white-space:pre-wrap;word-break:break-all;background:var(--bg);padding:8px;border-radius:8px;margin:0}
label.f{display:block;margin:12px 0 4px;font-weight:600}.help{font-size:12px;color:var(--muted)}
.w80{width:80px}.w100{width:100px}
img.proof{max-width:120px;max-height:120px;border-radius:8px;border:1px solid var(--line)}
@media (max-width:640px){main{padding:12px}td,th{padding:6px}.hide-sm{display:none}}
`;

export function page(title, body, { path = '', flash = '' } = {}) {
  const nav = NAV.map(([href, label]) => `<a href="${href}" class="${path === href ? 'on' : ''}">${label}</a>`).join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Panel</title><style>${CSS}</style></head><body>
<header><span class="brand">🛠 Panel</span><nav>${nav}</nav><form method="post" action="/admin/logout"><button class="ghost">Salir</button></form></header>
<main>${flash ? `<div class="flash">${esc(flash)}</div>` : ''}<h1>${esc(title)}</h1>${body}</main></body></html>`;
}

export function loginPage(error = '') {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Entrar · Panel</title><style>${CSS} .login{max-width:340px;margin:12vh auto}</style></head><body>
<main class="login"><div class="box"><h1>🛠 Panel de administración</h1>
${error ? `<p class="bad">${esc(error)}</p>` : ''}
<form method="post" action="/admin/login"><label class="f">Contraseña</label><input type="password" name="password" autofocus style="width:100%">
<p><button style="width:100%">Entrar</button></p></form></div></main></body></html>`;
}
