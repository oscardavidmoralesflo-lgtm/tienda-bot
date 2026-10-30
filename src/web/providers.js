import express from 'express';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { PROVIDER_SPECS, publicProviderSettings, saveProviderSettings } from '../provider-settings.js';
import { providerStatus, extraProducts, extraBalance, clearProviderCache } from '../providers.js';
import { productUnitPrice, estimatedProfit, money } from '../pricing.js';
import { esc } from '../util.js';

const csrf=req=>crypto.createHmac('sha256',config.sessionSecret).update(`providers:${req.headers.cookie||''}`).digest('hex');
const input=req=>`<input type="hidden" name="_csrf" value="${csrf(req)}">`;
const redirect=(res,id,msg)=>res.redirect(`/admin/providers${id?`/${id}`:''}?m=${encodeURIComponent(msg)}`);
export function providersRouter(render) {
  const r=express.Router();
  r.use((req,res,next)=>{
    if(req.method==='GET')return next();
    const a=Buffer.from(String(req.body?._csrf||'')),b=Buffer.from(csrf(req));
    if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return res.status(403).send('La sesión del formulario venció. Vuelve a abrir Proveedores.');
    next();
  });
  r.get('/',async(req,res)=>{
    const cards=Object.keys(PROVIDER_SPECS).map(id=>{
      const p=providerStatus(id);
      return `<div class="card"><h3>${esc(p.name)}</h3><p class="sub">${p.enabled?'Activo para los productos seleccionados':p.configured?'Clave guardada; conexión apagada':'Pendiente de clave'}</p>
        ${p.error?`<p class="warn">${esc(p.error)}</p>`:''}${p.keyError?'<p class="bad">No se puede descifrar la clave. Restablece SESSION_SECRET o guarda la clave de nuevo.</p>':''}
        <form method="post" action="/admin/providers/${id}">${input(req)}<label>Clave de API</label><input type="password" name="key" autocomplete="new-password" placeholder="${p.configured?'Guardada; deja vacío para conservar':'Pega la clave emitida por el proveedor'}" style="width:100%">
        <input type="hidden" name="preserve_selection" value="1"><p><label><input type="checkbox" name="enabled" ${p.enabled?'checked':''}> Activar productos seleccionados</label></p>
        <p class="help">La clave se cifra al guardarla y nunca vuelve al navegador. ${p.selected.length} productos seleccionados.</p>
        <div class="row"><button>Guardar conexión</button>${p.configured?`<a class="btn ghost" href="/admin/providers/${id}">Ver catálogo y saldo</a>`:''}<a href="${esc(p.docs)}" target="_blank" rel="noopener noreferrer">Documentación</a></div></form></div>`;
    }).join('');
    const body=`<div class="card" style="margin-bottom:16px"><h3>Proveedores conectados</h3><p>KOKORO y Bunny conservan sus claves en las variables del servidor. Los nuevos proveedores solo publican productos seleccionados; nunca se agrupan por parecido del nombre.</p><p class="help">Precios y stock cada 3 minutos, con comprobación al pagar. Un resultado de compra incierto pasa a revisión, sin volver a comprar.</p></div><div class="grid g2">${cards}</div><div class="card" style="margin-top:16px"><h3>SubExpress, Fuk Store y Jero</h3><p>Catálogos investigados, todavía sin una API de pedidos verificada. No se anuncian como conectados ni se realizan compras desde tu sesión personal de Telegram.</p></div>`;
    await render(req,res,'Proveedores',body,{subtitle:'Conexiones, saldo y selección de productos',actions:'<a class="btn ghost" href="/admin/settings#precios">Ganancia mínima</a>'});
  });
  r.get('/:id',async(req,res)=>{
    const id=String(req.params.id);if(!Object.hasOwn(PROVIDER_SPECS,id))return res.sendStatus(404);
    const p=publicProviderSettings(id);let products=[],balance=null,error='',canPurchase=true;
    if(p.configured) {
      const results=await Promise.allSettled([extraProducts(id,{all:true,fresh:req.query.fresh==='1'}),extraBalance(id)]);
      if(results[0].status==='fulfilled')products=results[0].value;else error=results[0].reason.message;
      if(results[1].status==='fulfilled'){balance=results[1].value.balance;canPurchase=results[1].value.canPurchase;}else error=[error,results[1].reason.message].filter(Boolean).join(' · ');
    }
    const rows=products.map(x=>{
      const sale=productUnitPrice(x),profit=estimatedProfit(x.price,sale);
      return `<tr><td><input form="selection" type="checkbox" name="selected" value="${esc(x.sourceId)}" ${p.selected.includes(x.sourceId)?'checked':''} ${!x.supported?'disabled':''}></td><td class="wrap"><b>${esc(x.name)}</b><small class="muted" style="display:block">ID ${esc(x.sourceId)}${!x.supported?' · Requiere otro flujo o entrega manual':''}</small><details><summary>Condiciones del proveedor</summary><div>${x.description_es}</div></details></td><td class="num r">${x.stock}</td><td class="num r">${money(x.price)}</td><td class="num r">${money(sale)}</td><td class="num r">${money(profit)}</td></tr>`;
    }).join('');
    const body=`<div class="card" style="margin-bottom:16px"><div class="split"><b>Saldo ${esc(p.name)}: ${balance==null?'sin confirmar':money(balance)+' USD'}</b><span>${products.length} productos consultados</span></div>${balance===0||!canPurchase?'<p class="warn">El proveedor necesita saldo o habilitar el nivel de compra. Conectar la API no financia los pedidos.</p>':''}${error?`<p class="bad">${esc(error)}</p>`:''}<p class="help">Solo se publican artículos seleccionados con flujo compatible. Revisa plan, región, elegibilidad y garantía. La ganancia estimada reserva los costos configurados.</p></div>
      <form id="selection" method="post" action="/admin/providers/${id}">${input(req)}<div class="card" style="margin-bottom:16px"><label><input type="checkbox" name="enabled" ${p.enabled?'checked':''}> Activar esta conexión</label><button style="float:right">Guardar selección</button></div><input type="hidden" name="catalog_loaded" value="${error?'0':'1'}"></form><div class="card"><div class="tablewrap"><table><thead><tr><th>Vender</th><th>Producto y condiciones</th><th>Stock</th><th>Costo</th><th>Tu precio</th><th>Ganancia estimada</th></tr></thead><tbody>${rows||'<tr><td colspan="6">Guarda una clave válida y actualiza el catálogo.</td></tr>'}</tbody></table></div></div>`;
    await render(req,res,p.name,body,{subtitle:'La selección no realiza compras',actions:`<a class="btn ghost" href="/admin/providers">Volver</a><a class="btn" href="/admin/providers/${id}?fresh=1">Consultar ahora</a>`});
  });
  r.post('/:id',async(req,res)=>{
    const id=String(req.params.id);if(!Object.hasOwn(PROVIDER_SPECS,id))return res.sendStatus(404);
    try {
      const old=publicProviderSettings(id);let selected=old.selected;
      if(!req.body.preserve_selection) {
        if(req.body.catalog_loaded!=='1')throw new Error('No se guardó la selección: el catálogo no está confirmado.');
        const rows=await extraProducts(id,{all:true}),valid=new Set(rows.filter(x=>x.supported).map(x=>x.sourceId));
        selected=(Array.isArray(req.body.selected)?req.body.selected:req.body.selected?[req.body.selected]:[]).map(String);
        if(selected.some(x=>!valid.has(x)))throw new Error('La selección incluye un producto no compatible.');
      }
      await saveProviderSettings(id,{key:req.body.key,enabled:!!req.body.enabled,selected});clearProviderCache(id);
      return redirect(res,id,'Conexión guardada. Comprueba saldo y productos antes de vender.');
    } catch(e) {return redirect(res,'',e.message);}
  });
  return r;
}
