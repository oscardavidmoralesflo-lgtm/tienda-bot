import { esc } from '../util.js';

// ---------- Íconos (trazo, estilo Lucide) ----------
const P = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/>',
  wallet: '<rect x="2.5" y="5.5" width="19" height="14" rx="3"/><path d="M16.5 12.5h2"/><path d="M2.5 9.5h19"/>',
  receipt: '<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.8.7 3 2.4 3.5 5.2"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  game: '<rect x="2" y="7" width="20" height="11" rx="5"/><path d="M7 10.5v4M5 12.5h4"/><circle cx="15.5" cy="11.5" r="1"/><circle cx="18" cy="13.5" r="1"/>',
  megaphone: '<path d="M3 11v3a1 1 0 0 0 1 1h3l6 4V6L7 10H4a1 1 0 0 0-1 1z"/><path d="M17 9.5a4 4 0 0 1 0 5.5M19.5 7a7.5 7.5 0 0 1 0 10.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  logout: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5M15 12H3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  refresh: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/>',
  trend: '<path d="m3 17 6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
  dollar: '<path d="M12 2v20"/><path d="M17 6.5c-.8-1.4-2.6-2.5-5-2.5-3 0-5 1.6-5 3.8 0 5 10 2.6 10 7.6 0 2.2-2.2 3.6-5 3.6-2.6 0-4.4-1.1-5.3-2.7"/>',
  bag: '<path d="M6 7h12l1 14H5z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  bank: '<path d="M3 10 12 4l9 6"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18"/>',
  rabbit: '<path d="M9 13c-3 0-5 2-5 4.5S6 21 9 21h6c3 0 5-1.5 5-3.5S18 13 15 13"/><path d="M9.5 13 8 4.5c-.2-1.2 1.6-1.6 2-.4L12 10l2-5.9c.4-1.2 2.2-.8 2 .4L14.5 13"/><circle cx="10" cy="16.5" r=".8"/><circle cx="14" cy="16.5" r=".8"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9z"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
  check: '<path d="m4 12.5 5 5L20 6.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  shield: '<path d="M12 3 4.5 6v6c0 4.5 3.2 8 7.5 9 4.3-1 7.5-4.5 7.5-9V6z"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
};
export const icon = (name, size = 18) =>
  `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;

const NAV = [
  ['Principal', [
    ['/admin', 'home', 'Resumen'],
    ['/admin/recharges', 'wallet', 'Recargas', 'recharges'],
    ['/admin/orders', 'receipt', 'Pedidos', 'orders'],
    ['/admin/users', 'users', 'Clientes'],
  ]],
  ['Catálogo', [
    ['/admin/products', 'box', 'Productos'],
    ['/admin/games', 'game', 'Juegos y gift cards'],
  ]],
  ['Marketing', [
    ['/admin/broadcast', 'megaphone', 'Difusión'],
  ]],
  ['Sistema', [
    ['/admin/settings', 'settings', 'Ajustes'],
  ]],
];

const FONT = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">';

const CSS = `
:root{
  --bg:#f2f7f6;--bg2:#e8f1ef;--surface:#ffffff;--surface2:#f6faf9;--border:#dfe9e6;--border2:#cbdcd7;
  --text:#0b1b19;--text2:#45605b;--muted:#7f9893;
  --brand:#0b9a7e;--brand2:#0b7c8c;--brand-soft:rgba(11,154,126,.11);--gold:#e9a23b;--gold-soft:rgba(233,162,59,.14);
  --ok:#0ea971;--ok-soft:rgba(14,169,113,.11);--bad:#e5484d;--bad-soft:rgba(229,72,77,.11);
  --warn:#d98a04;--warn-soft:rgba(217,138,4,.13);--info:#2f80ed;--info-soft:rgba(47,128,237,.11);
  --shadow:0 1px 2px rgba(16,20,45,.04),0 8px 24px -12px rgba(16,20,45,.12);
  --radius:16px;--grad:linear-gradient(135deg,#16c98f 0%,#0b9a8a 55%,#065a6b 100%);
}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){
  --bg:#06110f;--bg2:#091815;--surface:#0c1c19;--surface2:#10241f;--border:#19352f;--border2:#22463e;
  --text:#ecf7f4;--text2:#a9c5be;--muted:#6f8f88;--brand:#19c99a;--brand-soft:rgba(25,201,154,.14);--gold-soft:rgba(240,180,70,.15);
  --ok-soft:rgba(20,200,135,.14);--bad-soft:rgba(240,90,95,.15);--warn-soft:rgba(245,170,30,.15);--info-soft:rgba(70,150,255,.15);
  --shadow:0 1px 0 rgba(255,255,255,.03) inset,0 10px 30px -15px rgba(0,0,0,.6);
}}
:root[data-theme=dark]{
  --bg:#06110f;--bg2:#091815;--surface:#0c1c19;--surface2:#10241f;--border:#19352f;--border2:#22463e;
  --text:#ecf7f4;--text2:#a9c5be;--muted:#6f8f88;--brand:#19c99a;--brand-soft:rgba(25,201,154,.14);--gold-soft:rgba(240,180,70,.15);
  --ok-soft:rgba(20,200,135,.14);--bad-soft:rgba(240,90,95,.15);--warn-soft:rgba(245,170,30,.15);--info-soft:rgba(70,150,255,.15);
  --shadow:0 1px 0 rgba(255,255,255,.03) inset,0 10px 30px -15px rgba(0,0,0,.6);
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;font:14px/1.5 Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--text);font-feature-settings:"cv11","ss01";-webkit-font-smoothing:antialiased}
body:before{content:"";position:fixed;inset:-20% -10% auto auto;width:720px;height:720px;background:radial-gradient(closest-side,rgba(22,201,143,.12),transparent);pointer-events:none;z-index:0}
a{color:var(--brand);text-decoration:none}a:hover{text-decoration:underline}
.ic{flex:none;vertical-align:-3px}
.num{font-variant-numeric:tabular-nums}
/* ---------- estructura ---------- */
.app{display:grid;grid-template-columns:256px 1fr;min-height:100vh;position:relative;z-index:1}
.side{position:sticky;top:0;height:100vh;padding:20px 14px;border-right:1px solid var(--border);background:color-mix(in oklab,var(--surface) 72%,transparent);backdrop-filter:blur(14px);display:flex;flex-direction:column;gap:6px;overflow-y:auto}
.brand{display:flex;align-items:center;gap:11px;padding:4px 8px 18px}
.logo{width:38px;height:38px;border-radius:12px;background:var(--grad);display:grid;place-items:center;color:#fff;box-shadow:0 8px 20px -8px rgba(11,154,126,.8);overflow:hidden}
.brand b{display:block;font-size:15px;letter-spacing:-.01em}.brand small{color:var(--muted);font-size:12px}
.navsec{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding:14px 10px 6px}
.nav a{display:flex;align-items:center;gap:11px;padding:9px 11px;border-radius:11px;color:var(--text2);font-weight:500;text-decoration:none;transition:background .15s,color .15s}
.nav a:hover{background:var(--surface2);color:var(--text)}
.nav a.on{background:var(--brand-soft);color:var(--brand)}
.nav a.on .ic{color:var(--brand)}
.nav .badge{margin-left:auto}
.side .foot{margin-top:auto;padding-top:14px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:6px}
.status{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text2);padding:8px 11px;border-radius:11px;background:var(--surface2)}
.dot{width:8px;height:8px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 4px var(--ok-soft)}
.dot.warn{background:var(--warn);box-shadow:0 0 0 4px var(--warn-soft)}
.main{min-width:0;padding:26px 32px 60px}
.top{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:22px;flex-wrap:wrap}
.top h1{margin:0;font-size:26px;letter-spacing:-.025em;font-weight:750}
.top p{margin:4px 0 0;color:var(--muted)}
.top .actions{display:flex;gap:8px;flex-wrap:wrap}
.mobilebar{display:none}
/* ---------- componentes ---------- */
.grid{display:grid;gap:16px}
.g4{grid-template-columns:repeat(4,minmax(0,1fr))}.g3{grid-template-columns:repeat(3,minmax(0,1fr))}.g2{grid-template-columns:repeat(2,minmax(0,1fr))}
.g21{grid-template-columns:2fr 1fr}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);padding:18px;min-width:0}
.card h3{margin:0 0 4px;font-size:14px;font-weight:650;display:flex;align-items:center;gap:8px}
.card .sub{color:var(--muted);font-size:12.5px;margin:0 0 14px}
.stat{display:flex;flex-direction:column;gap:10px;position:relative;overflow:hidden}
.stat .chip{width:38px;height:38px;border-radius:11px;display:grid;place-items:center}
.stat .k{color:var(--text2);font-size:13px;font-weight:500}
.stat .v{font-size:26px;font-weight:750;letter-spacing:-.02em;line-height:1.1}
.stat .d{font-size:12px;color:var(--muted)}
.stat.hero{background:var(--grad);border:0;color:#fff}
.stat.hero .k,.stat.hero .d{color:rgba(255,255,255,.82)}
.stat.hero .chip{background:rgba(255,255,255,.18);color:#fff}
.stat.hero:after{content:"";position:absolute;right:-40px;top:-40px;width:160px;height:160px;border-radius:50%;background:rgba(255,255,255,.10)}
.c-brand{background:var(--brand-soft);color:var(--brand)}.c-ok{background:var(--ok-soft);color:var(--ok)}.c-bad{background:var(--bad-soft);color:var(--bad)}.c-warn{background:var(--warn-soft);color:var(--warn)}.c-info{background:var(--info-soft);color:var(--info)}
.ok{color:var(--ok)}.bad{color:var(--bad)}.warn{color:var(--warn)}.muted{color:var(--muted)}
.badge{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}
.b-ok{background:var(--ok-soft);color:var(--ok)}.b-bad{background:var(--bad-soft);color:var(--bad)}.b-warn{background:var(--warn-soft);color:var(--warn)}.b-info{background:var(--info-soft);color:var(--info)}.b-brand{background:var(--brand-soft);color:var(--brand)}.b-muted{background:var(--surface2);color:var(--text2);border:1px solid var(--border)}
.nav .badge{padding:1px 8px;font-size:11px}
/* tablas */
.tablewrap{overflow-x:auto;margin:0 -18px -18px;border-top:1px solid var(--border)}
table{width:100%;border-collapse:collapse}
th,td{padding:12px 18px;text-align:left;border-bottom:1px solid var(--border);vertical-align:middle;white-space:nowrap}
td.wrap{white-space:normal;min-width:220px}
th{font-size:11.5px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;background:var(--surface2);position:sticky;top:0}
tbody tr{transition:background .12s}tbody tr:hover{background:var(--surface2)}
tr:last-child td{border-bottom:0}
td.r,th.r{text-align:right}
.who{display:flex;align-items:center;gap:10px;min-width:0}
.av{width:32px;height:32px;border-radius:10px;display:grid;place-items:center;font-weight:700;font-size:12.5px;color:#fff;flex:none}
.who b{display:block;font-weight:600;color:var(--text)}.who small{color:var(--muted)}
.prod{display:flex;align-items:center;gap:10px}
/* formularios */
input,select,textarea{font:inherit;color:var(--text);background:var(--surface2);border:1px solid var(--border);border-radius:11px;padding:9px 12px;outline:none;transition:border .15s,box-shadow .15s;max-width:100%}
input:focus,select:focus,textarea:focus{border-color:var(--brand);box-shadow:0 0 0 4px var(--brand-soft)}
textarea{width:100%;min-height:120px;resize:vertical}
.in-sm{width:84px;padding:7px 10px}
.btn,button{font:inherit;font-weight:600;border:0;border-radius:11px;padding:9px 15px;background:var(--grad);color:#fff;cursor:pointer;display:inline-flex;align-items:center;gap:7px;text-decoration:none;box-shadow:0 6px 16px -8px rgba(11,154,126,.75);transition:transform .08s,filter .15s}
.btn:hover,button:hover{filter:brightness(1.07);text-decoration:none}.btn:active,button:active{transform:translateY(1px)}
.btn.ghost,button.ghost{background:var(--surface);color:var(--text);border:1px solid var(--border);box-shadow:none}
.btn.ghost:hover,button.ghost:hover{background:var(--surface2)}
button.okb{background:var(--ok);box-shadow:0 6px 16px -8px rgba(14,169,113,.8)}
button.badb{background:var(--surface);color:var(--bad);border:1px solid var(--bad-soft);box-shadow:none}
button.badb:hover{background:var(--bad-soft)}
button.sm,.btn.sm{padding:7px 11px;font-size:13px}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.field{margin-bottom:16px}.field label{display:block;font-weight:600;margin-bottom:6px;font-size:13.5px}
.help{font-size:12.5px;color:var(--muted);margin-top:5px}
.switch{position:relative;display:inline-flex;align-items:center;gap:10px;cursor:pointer;font-weight:500}
.switch input{appearance:none;width:38px;height:22px;border-radius:999px;background:var(--border2);border:0;padding:0;position:relative;cursor:pointer;transition:background .2s;flex:none}
.switch input:after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .2s}
.switch input:checked{background:var(--brand)}.switch input:checked:after{transform:translateX(16px)}
.switch input:focus{box-shadow:0 0 0 4px var(--brand-soft)}
.chips{display:flex;gap:8px;flex-wrap:wrap}
.chipf{padding:7px 12px;border-radius:999px;border:1px solid var(--border);background:var(--surface);color:var(--text2);font-weight:500;font-size:13px;cursor:pointer;text-decoration:none}
.chipf:hover{text-decoration:none;background:var(--surface2)}
.chipf.on{background:var(--brand-soft);border-color:transparent;color:var(--brand)}
.searchbox{position:relative}.searchbox .ic{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--muted)}
.searchbox input{padding-left:36px;width:280px}
pre{white-space:pre-wrap;word-break:break-all;background:var(--surface2);border:1px solid var(--border);padding:12px;border-radius:12px;margin:0;font:12.5px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace}
.kv{display:grid;grid-template-columns:170px 1fr;gap:0}.kv>div{padding:12px 0;border-bottom:1px solid var(--border)}.kv>div:nth-last-child(-n+2){border-bottom:0}.kv .k{color:var(--muted);font-weight:500}
.empty{text-align:center;padding:36px 10px;color:var(--muted)}.empty .big{font-size:34px;margin-bottom:6px}
.proof{width:64px;height:64px;object-fit:cover;border-radius:12px;border:1px solid var(--border)}
.bar{height:8px;border-radius:999px;background:var(--surface2);overflow:hidden}.bar i{display:block;height:100%;border-radius:999px;background:var(--grad)}
.toplist{display:flex;flex-direction:column;gap:14px}.toplist .t{display:flex;justify-content:space-between;gap:10px;font-size:13px;margin-bottom:6px}
.toast{position:fixed;top:18px;right:18px;z-index:50;background:var(--surface);border:1px solid var(--border);box-shadow:var(--shadow);border-radius:14px;padding:12px 16px;display:flex;align-items:center;gap:10px;animation:tin .35s ease,tout .4s ease 4.2s forwards;max-width:min(420px,calc(100vw - 36px))}
.toast .chip{width:28px;height:28px;border-radius:9px;display:grid;place-items:center}
@keyframes tin{from{opacity:0;transform:translateY(-8px)}}@keyframes tout{to{opacity:0;transform:translateY(-8px);visibility:hidden}}
.chart{width:100%;height:auto;display:block}
.legend{display:flex;gap:14px;font-size:12.5px;color:var(--text2)}.legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:-1px}
.split{display:flex;justify-content:space-between;align-items:center;gap:12px}
.sec-title{font-size:15px;font-weight:700;margin:26px 0 12px;letter-spacing:-.01em}
hr.sep{border:0;border-top:1px solid var(--border);margin:16px 0}
/* ---------- responsive ---------- */
@media (max-width:1200px){.g4{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:980px){
  .app{grid-template-columns:1fr}
  .side{position:fixed;inset:0 auto 0 0;width:270px;z-index:40;transform:translateX(-102%);transition:transform .25s ease;background:var(--surface)}
  body.navopen .side{transform:none;box-shadow:0 0 0 100vmax rgba(5,6,15,.45)}
  .mobilebar{display:flex;align-items:center;justify-content:space-between;gap:10px;position:sticky;top:0;z-index:30;padding:12px 16px;background:color-mix(in oklab,var(--surface) 85%,transparent);backdrop-filter:blur(12px);border-bottom:1px solid var(--border)}
  .mobilebar .brand{padding:0}
  .main{padding:18px 16px 50px}
  .g3,.g21,.g2{grid-template-columns:1fr}
  .searchbox input{width:100%}.searchbox{flex:1}
  .kv{grid-template-columns:1fr}.kv .k{padding-bottom:0;border-bottom:0}
}
@media (max-width:520px){.g4{grid-template-columns:1fr 1fr}.stat .v{font-size:21px}.top h1{font-size:22px}th,td{padding:10px 14px}.tablewrap{margin:0 -18px -18px}}
`;

const JS = `
(function(){
  try{var t=localStorage.getItem('theme');if(t)document.documentElement.dataset.theme=t;}catch(e){}
  window.toggleTheme=function(){var d=document.documentElement;var dark=d.dataset.theme?d.dataset.theme==='dark':matchMedia('(prefers-color-scheme: dark)').matches;d.dataset.theme=dark?'light':'dark';try{localStorage.setItem('theme',d.dataset.theme)}catch(e){}};
  window.toggleNav=function(){document.body.classList.toggle('navopen')};
  document.addEventListener('click',function(e){if(document.body.classList.contains('navopen')&&!e.target.closest('.side')&&!e.target.closest('[data-nav]'))document.body.classList.remove('navopen')});
  // filtro instantáneo en tablas: <input data-filter="#tabla">
  document.addEventListener('input',function(e){var f=e.target.getAttribute('data-filter');if(!f)return;var q=e.target.value.toLowerCase();document.querySelectorAll(f+' tbody tr').forEach(function(tr){tr.style.display=tr.textContent.toLowerCase().indexOf(q)>-1?'':'none'})});
})();
`;

// Logo de la marca (llave con argolla dorada) para la barra lateral y el login
let logoSeq = 0;
export const logoMark = (size = 38, k = ++logoSeq) => `<svg width="${size}" height="${size}" viewBox="0 0 512 512" aria-hidden="true"><defs><linearGradient id="lgbg${k}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#16C98F"/><stop offset=".55" stop-color="#0B9A8A"/><stop offset="1" stop-color="#065A6B"/></linearGradient><linearGradient id="lggd${k}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFE7A3"/><stop offset=".5" stop-color="#F7BE45"/><stop offset="1" stop-color="#E0921A"/></linearGradient></defs><rect width="512" height="512" rx="116" fill="url(#lgbg${k})"/><g transform="translate(256 258) scale(0.9) translate(-242 -237)"><circle cx="138" cy="132" r="50" fill="none" stroke="url(#lggd${k})" stroke-width="16"/><g stroke="#fff" stroke-linecap="round" fill="none"><circle cx="212" cy="208" r="76" stroke-width="42"/><path d="M266 262 L384 380" stroke-width="42"/><path d="M326 322 L356 292" stroke-width="34"/><path d="M366 362 L396 332" stroke-width="34"/></g><path d="M212 168 C217 196 224 203 252 208 C224 213 217 220 212 248 C207 220 200 213 172 208 C200 203 207 196 212 168 Z" fill="url(#lggd${k})"/></g></svg>`;

const AV_COLORS = ['#0b9a7e', '#e9a23b', '#2f80ed', '#e5484d', '#0891b2', '#7c3aed', '#d98a04', '#059669'];
export function avatar(name, id) {
  const n = String(name || '?').trim();
  const initials = (n.split(/\s+/).slice(0, 2).map((w) => w[0]).join('') || '?').toUpperCase();
  const color = AV_COLORS[Math.abs(Number(id) || n.length) % AV_COLORS.length];
  return `<span class="av" style="background:${color}">${esc(initials)}</span>`;
}

function shell(title, inner, { flash = '', path = '', badges = {}, shop = 'Panel', maintenance = false } = {}) {
  const nav = NAV.map(([sec, items]) => `<div class="navsec">${sec}</div><nav class="nav">${items.map(([href, ic, label, badgeKey]) => {
    const on = path === href || (href !== '/admin' && path.startsWith(href));
    const b = badgeKey && badges[badgeKey] ? `<span class="badge ${badgeKey === 'recharges' ? 'b-warn' : 'b-brand'}">${badges[badgeKey]}</span>` : '';
    return `<a href="${href}" class="${on ? 'on' : ''}">${icon(ic)}<span>${label}</span>${b}</a>`;
  }).join('')}</nav>`).join('');
  const brand = () => `<div class="brand"><div class="logo" style="background:none;box-shadow:0 8px 20px -8px rgba(11,154,126,.8)">${logoMark(38)}</div><div><b>${esc(shop)}</b><small>Tu tienda premium · panel</small></div></div>`;
  const toast = flash
    ? `<div class="toast" role="status"><span class="chip ${/error|inválid|no se pudo|falt/i.test(flash) ? 'c-bad' : 'c-ok'}">${icon(/error|inválid|no se pudo|falt/i.test(flash) ? 'x' : 'check', 16)}</span><span>${esc(flash)}</span></div>`
    : '';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · ${esc(shop)}</title><meta name="theme-color" content="#0b9a7e">${FONT}<style>${CSS}</style><script>${JS}</script></head><body>
<div class="mobilebar">${brand()}<button class="ghost sm" data-nav onclick="toggleNav()" aria-label="Menú">${icon('menu')}</button></div>
<div class="app"><aside class="side">${brand()}${nav}
<div class="foot"><div class="status"><span class="dot ${maintenance ? 'warn' : ''}"></span>${maintenance ? 'Bot en mantenimiento' : 'Bot en línea · precios cada 3 min'}</div>
<button class="ghost sm" onclick="toggleTheme()">${icon('moon', 16)} Cambiar tema</button>
<form method="post" action="/admin/logout"><button class="ghost sm" style="width:100%">${icon('logout', 16)} Cerrar sesión</button></form></div></aside>
<main class="main">${inner}</main></div>${toast}</body></html>`;
}

// page(título, contenido, { path, flash, subtitle, actions, badges, shop, maintenance })
export function page(title, body, opts = {}) {
  const head = `<div class="top"><div><h1>${esc(title)}</h1>${opts.subtitle ? `<p>${opts.subtitle}</p>` : ''}</div>${opts.actions ? `<div class="actions">${opts.actions}</div>` : ''}</div>`;
  return shell(title, head + body, opts);
}

export function loginPage(error = '', shop = 'Llavero') {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Entrar · ${esc(shop)}</title>${FONT}<style>${CSS}
.login{min-height:100vh;display:grid;place-items:center;padding:20px;position:relative;z-index:1}
.lcard{width:100%;max-width:400px;padding:34px 30px}
.lcard .logo{width:52px;height:52px;border-radius:16px;margin-bottom:18px}
.lcard h1{margin:0 0 6px;font-size:24px;letter-spacing:-.02em}
.lcard input{width:100%;padding:12px 14px}
.lcard button{width:100%;justify-content:center;padding:12px}
.lcard .err{display:flex;gap:8px;align-items:center;background:var(--bad-soft);color:var(--bad);padding:10px 12px;border-radius:11px;margin-bottom:14px;font-weight:500}
</style><script>${JS}</script></head><body><div class="login"><div class="card lcard">
<div class="logo" style="background:none">${logoMark(52)}</div><h1>${esc(shop)}</h1><p class="muted" style="margin:0 0 22px">Entra a tu panel de administración</p>
${error ? `<div class="err">${icon('x', 16)} ${esc(error)}</div>` : ''}
<form method="post" action="/admin/login"><div class="field"><label for="pw">Contraseña</label><input id="pw" type="password" name="password" autofocus autocomplete="current-password" placeholder="••••••••••"></div>
<button>${icon('shield', 16)} Entrar al panel</button></form>
<p class="help" style="text-align:center;margin-top:18px">${icon('bolt', 13)} Conexión segura · sesión de 7 días</p></div></div></body></html>`;
}

// ---------- Gráfica de ventas (SVG, sin librerías) ----------
export function salesChart(series) {
  const W = 720, H = 240, L = 44, R = 12, T = 14, B = 30;
  const max = Math.max(1, ...series.map((d) => d.revenue)) * 1.15;
  const step = (W - L - R) / Math.max(1, series.length - 1);
  const x = (i) => L + i * step;
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const line = (k) => series.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join(' ');
  const area = (k) => `${line(k)} L${x(series.length - 1).toFixed(1)},${H - B} L${L},${H - B} Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const v = (max / 1.15) * f;
    return `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--border)" stroke-dasharray="${f ? '3 4' : '0'}"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${v >= 100 ? Math.round(v) : v.toFixed(v ? 1 : 0)}</text>`;
  }).join('');
  const labels = series.map((d, i) => (i % 2 === series.length % 2 || i === series.length - 1)
    ? `<text x="${x(i)}" y="${H - 9}" text-anchor="middle" font-size="11" fill="var(--muted)">${d.label}</text>` : '').join('');
  const dots = series.map((d, i) => `<circle cx="${x(i)}" cy="${y(d.revenue)}" r="3.2" fill="var(--surface)" stroke="#14b88c" stroke-width="2"><title>${d.label}: ${d.revenue.toFixed(2)} facturado · ${d.profit.toFixed(2)} ganancia · ${d.orders} ventas</title></circle>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Ventas de los últimos ${series.length} días">
<defs><linearGradient id="gr" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#14b88c" stop-opacity=".35"/><stop offset="1" stop-color="#14b88c" stop-opacity="0"/></linearGradient>
<linearGradient id="gp" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#e9a23b" stop-opacity=".30"/><stop offset="1" stop-color="#e9a23b" stop-opacity="0"/></linearGradient></defs>
${ticks}<path d="${area('revenue')}" fill="url(#gr)"/><path d="${line('revenue')}" fill="none" stroke="#14b88c" stroke-width="2.5" stroke-linejoin="round"/>
<path d="${area('profit')}" fill="url(#gp)"/><path d="${line('profit')}" fill="none" stroke="#e9a23b" stroke-width="2.2" stroke-linejoin="round"/>${dots}${labels}</svg>`;
}

// Dona por categoría
export function donut(parts) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  if (!total) return '<div class="empty"><div class="big">🍩</div>Aún no hay ventas para mostrar</div>';
  const C = 2 * Math.PI * 52;
  let off = 0;
  const arcs = parts.map((p) => {
    const len = (p.value / total) * C;
    const s = `<circle r="52" cx="70" cy="70" fill="none" stroke="${p.color}" stroke-width="18" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 70 70)"><title>${esc(p.label)}: ${p.value.toFixed(2)}</title></circle>`;
    off += len;
    return s;
  }).join('');
  return `<div class="row" style="gap:18px;align-items:center;flex-wrap:nowrap"><svg width="140" height="140" viewBox="0 0 140 140" style="flex:none">${arcs}<text x="70" y="66" text-anchor="middle" font-size="11" fill="var(--muted)">Total</text><text x="70" y="84" text-anchor="middle" font-size="16" font-weight="700" fill="var(--text)">${total.toFixed(0)}</text></svg>
<div style="display:flex;flex-direction:column;gap:7px;min-width:0">${parts.map((p) => `<div class="row" style="gap:8px;flex-wrap:nowrap;font-size:12.5px"><i style="width:10px;height:10px;border-radius:3px;background:${p.color};flex:none"></i><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.label)}</span><b class="num" style="margin-left:auto">${Math.round((p.value / total) * 100)}%</b></div>`).join('')}</div></div>`;
}
