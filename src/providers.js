// Adaptadores basados en las referencias oficiales de cada proveedor (30-10-2026).
import { PROVIDER_SPECS, providerConnection, publicProviderSettings } from './provider-settings.js';
import * as cache from './cache.js';

export const providerNames = { kokoro: 'KOKORO', bunny: 'Bunny', ...Object.fromEntries(Object.entries(PROVIDER_SPECS).map(([id,p]) => [id,p.name])) };
export const isExtraProvider = id => Object.hasOwn(PROVIDER_SPECS, id);
const health = new Map();
const safeText = value => String(value ?? '').replace(/\{\{ce:\d+\|([^}]+)\}\}/g,'$1').replace(/<[^>]*>/g, '').trim();
const htmlText = value => safeText(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replace(/\n/g,'<br>');
const stockOf = (value, available) => available === false ? 0 : Number.isFinite(Number(value)) && value !== null ? Math.max(0, Number(value)) : available === true ? 999 : 0;

export class ProviderError extends Error {
  constructor(message, { provider, status, code, notCharged = false, orderId } = {}) {
    super(message); Object.assign(this, { provider, status, code, definitelyNotCharged: notCharged, orderId });
  }
}
export function clearProviderCache(id) { cache.clear(id ? `p:${id}:` : 'p:'); }
export function providerStatus(id) { return { ...publicProviderSettings(id), ...(health.get(id) || {}) }; }
export async function providerRequest(id, method, path, body, headers = {}) {
  const { key } = providerConnection(id);
  if (!key) throw new ProviderError(`Falta la clave de ${providerNames[id]}.`, { provider:id, notCharged:true });
  const spec = PROVIDER_SPECS[id];
  // Las pruebas solo pueden cambiar el host a loopback; el panel no acepta URLs arbitrarias.
  const testBase = process.env.NODE_ENV === 'test' && process.env[`${id.toUpperCase()}_TEST_BASE`];
  if (testBase && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(testBase)) throw new Error('Host de prueba inválido');
  let res;
  try {
    res = await fetch(`${testBase || spec.base}${path}`, {
      method, redirect:'error', signal:AbortSignal.timeout(method === 'GET' ? 20000 : 60000),
      headers: { ...(id === 'resellwithme' ? { Authorization:`Bearer ${key}` } : { 'X-API-Key':key }), ...(body ? { 'Content-Type':'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ProviderError(`${spec.name} no respondió.`, { provider:id });
  }
  let data;
  try { data = await res.json(); } catch { throw new ProviderError(`Respuesta inválida de ${spec.name}.`, { provider:id, status:res.status }); }
  if (!res.ok || data.success === false || data.ok === false || data.status === 'error') {
    const err = typeof data.error === 'object' ? data.error : data;
    const notCharged = err.charged === false || data.wallet_status === 'not_charged' ||
      (!data.order_id && !err.order_id && [400,401,402,403,404,422].includes(res.status));
    throw new ProviderError(`${spec.name}: ${safeText(err.message || data.message || (typeof data.error === 'string' ? data.error : '') || `HTTP ${res.status}`).replaceAll(key,'[oculto]').slice(0,220)}`, {
      provider:id, status:res.status, code:err.code || data.code, notCharged, orderId:data.order_id || err.order_id,
    });
  }
  if(Array.isArray(data)) { data._http=res.status; return data; }
  return { ...data, _http:res.status };
}

export function normalizeProviderProduct(id, p) {
  let sourceId, price, stock, min = 1, max = 1000, fields = [], supported = true, delivery = 'instant', desc = p.description || '';
  if (id === 'safwan') {
    sourceId=p.id;price=Number(p.price);stock=p.unlimited_stock&&p.available?999:stockOf(p.stock,p.available);
    if(p.warranty)desc=`Garantía declarada: ${p.warranty}\n\n${desc}`;
  } else if (id === 'hmk') {
    sourceId=p.id; price=Number(p.price); stock=stockOf(p.stock,p.in_stock); min=p.min_quantity||1; max=p.max_quantity||1000;
    delivery=p.delivery || 'instant';
    if (p.input_required) fields=[{key:'customer_input',label:p.input_label||'Email',required:true}];
    if (p.sandbox) supported=false;
    if (p.warranty_days != null) desc+=`\nGarantía declarada: ${p.warranty_days} días.`;
  } else if (id === 'resellwithme') {
    sourceId=p.id; price=Number(p.prices?.USD?.amount_micros)/1e6;
    stock=stockOf(p.available_qty ?? p.stock); min=p.min_qty||1; max=p.max_qty||1;
    fields=(p.required_fields || p.input_fields?.filter(f=>f.required).map(f=>f.key) || []).map(key=>({key,required:true}));
    delivery=p.delivery?.type || 'standard';
    supported=(!p.quantity_unit || p.quantity_unit === 'item') && (!p.fulfillment_kind || p.fulfillment_kind === 'codes');
  } else if (id === 'pai') {
    sourceId=p.service_id; price=Number(p.unit_price); stock=stockOf(p.stock); min=p.min_quantity||1; max=p.max_quantity||10000;
    supported=p.input_type === 'quantity' && Number(p.price_per || 1) === 1;
    // Los servicios que piden credenciales de clientes y los boosts necesitan otro flujo.
  }
  supported &&= fields.length <= 1 && sourceId != null && Number.isFinite(price) && price > 0 && delivery === 'instant';
  if(id!=='pai'&&!Number.isSafeInteger(Number(sourceId)))supported=false;
  // P-AI no declara modo de entrega en el listado de códigos; se exige stock y cotización al pagar.
  const name=safeText(p.name);
  if (!name || !Number.isFinite(Number(min)) || !Number.isFinite(Number(max))) supported=false;
  return {
    id:`${id}:${sourceId}`,source:id,sourceId:String(sourceId),name,price,stock:Math.min(stock,Number(max)),
    min_order:Number(min),max_order:Number(max),requires_activation_data:fields.length===1,
    activation_data_type:fields[0]?.key === 'email' ? 'email' : 'default',input_fields:fields,
    description_es:htmlText(desc),description_en:htmlText(desc),bulk_discounts:id==='hmk' ? (p.tiers||[]).map(t=>({min_qty:Number(t.min_quantity),unit_price:Number(t.price)})).filter(t=>t.min_qty>0&&t.unit_price>0) : [],
    supported,delivery_mode:delivery,checked_at:new Date().toISOString(),
  };
}
async function load(id) {
  try {
    const d=await providerRequest(id,'GET','/products');
    const rows=Array.isArray(d) ? d : d.products || d.data || [];
    if (!Array.isArray(rows)) throw new Error('Formato de catálogo no reconocido');
    const products=rows.map(p=>normalizeProviderProduct(id,p));
    health.set(id,{lastSuccess:new Date().toISOString(),error:null,count:products.length});
    return products;
  } catch(e) { health.set(id,{...health.get(id),error:e.message});throw e; }
}
export async function extraProducts(id, {fresh=false,all=false}={}) {
  const c=providerConnection(id);
  if (!c.key || (!all && !c.enabled)) return [];
  const rows=await (fresh ? cache.fresh(`p:${id}:products`,()=>load(id)) : cache.swr(`p:${id}:products`,()=>load(id)));
  return all ? rows : rows.filter(p=>p.supported && c.selected.includes(p.sourceId));
}
export async function extraBalance(id) {
  const d=await providerRequest(id,'GET',id==='safwan'?'/balance':'/me');
  const value=id==='resellwithme' ? Number(d.wallets?.USD?.balance_micros)/1e6 : Number(d.balance);
  return {balance:Number.isFinite(value)?value:null,canPurchase:d.can_purchase!==false};
}
export async function quoteExtra(id,product,quantity,activationData) {
  const fresh=(await extraProducts(id,{fresh:true})).find(x=>x.sourceId===product.sourceId);
  if(!fresh || !fresh.supported || fresh.stock<quantity || quantity<fresh.min_order || quantity>fresh.max_order) throw new ProviderError('Producto sin disponibilidad para esa cantidad.',{provider:id,notCharged:true});
  if(fresh.requires_activation_data && !String(activationData||'').trim()) throw new ProviderError('Falta el dato de activación.',{provider:id,notCharged:true});
  if(id==='resellwithme') {
    const q=await providerRequest(id,'POST','/quotes',{product_id:Number(product.sourceId),qty:quantity});
    if(!q.id || q.can_pay===false || q.delivery?.type!=='instant') throw new ProviderError('El proveedor no puede entregar de inmediato o necesita saldo.',{provider:id,notCharged:true});
    const cost=Number(q.amount_minor)/1e6;
    if(!Number.isFinite(cost)||cost<=0) throw new ProviderError('Cotización inválida.',{provider:id,notCharged:true});
    return {cost,quoteId:q.id,product:fresh};
  }
  if(id==='pai') {
    const q=await providerRequest(id,'GET',`/quote?${new URLSearchParams({service_id:product.sourceId,quantity:String(quantity)})}`);
    if(q.stock_warning || Number(q.stock)<quantity || q.sufficient_balance===false) throw new ProviderError('El proveedor no tiene stock o saldo para entrega inmediata.',{provider:id,notCharged:true});
    const cost=Number(q.pricing?.final_total);
    if(!Number.isFinite(cost)||cost<=0) throw new ProviderError('Cotización inválida.',{provider:id,notCharged:true});
    return {cost,product:fresh};
  }
  let unit=fresh.price;
  for(const t of fresh.bulk_discounts)if(quantity>=t.min_qty)unit=Math.min(unit,t.unit_price);
  const cost=Math.round(unit*quantity*10000)/10000;
  const wallet=await extraBalance(id);
  if(wallet.balance==null||wallet.balance+0.00001<cost||!wallet.canPurchase)throw new ProviderError('El proveedor necesita saldo antes de comprar.',{provider:id,notCharged:true});
  return {cost,product:fresh};
}
export async function purchaseExtra(id,o,product,quote,activationData) {
  if(id==='safwan')return providerRequest(id,'POST','/order',{product_id:Number(product.sourceId),quantity:o.quantity,request_id:o.external_order_id});
  if(id==='hmk')return providerRequest(id,'POST','/orders',{product_id:Number(product.sourceId),quantity:o.quantity,idempotency_key:o.external_order_id,...(activationData?{customer_input:activationData}:{})});
  if(id==='resellwithme')return providerRequest(id,'POST','/orders',{product_id:Number(product.sourceId),qty:o.quantity,quote_id:quote.quoteId,...(activationData?{fields:{[product.input_fields[0].key]:activationData}}:{})},{'Idempotency-Key':o.external_order_id});
  return providerRequest(id,'POST','/order',{service_id:product.sourceId,quantity:o.quantity,external_order_id:o.external_order_id});
}
export async function readExtraOrder(o) {
  const id=o.kind;
  if(id==='safwan')return null; // No hay consulta de pedidos documentada: revisión manual si la respuesta es incierta.
  if(id==='hmk')return providerRequest(id,'GET',`/orders/by-key/${encodeURIComponent(o.external_order_id)}`);
  if(id==='resellwithme') {
    if(o.kokoro_order_id)return providerRequest(id,'GET',`/orders/${encodeURIComponent(o.kokoro_order_id)}`);
    // Solo lectura tras respuesta incierta: no se crea otra orden para intentar recuperarla.
    const d=await providerRequest(id,'GET','/orders');
    const rows=Array.isArray(d)?d:d.orders||d.data||[];
    return rows.find(x=>x.idempotency_key===o.external_order_id||x.external_order_id===o.external_order_id)||null;
  }
  if(o.kokoro_order_id)return providerRequest(id,'GET',`/order/${encodeURIComponent(o.kokoro_order_id)}`);
  const d=await providerRequest(id,'GET','/orders');
  return (d.orders||d.data||[]).find(x=>x.external_order_id===o.external_order_id)||null;
}
export function normalizedExtraOrder(id,d) {
  const p=d?.order||d?.data||d||{};
  const status=p.status||'';
  const items=id==='hmk'?p.items:id==='pai'?p.products:id==='safwan'?p.items||p.delivered_items:null;
  const delivery=Array.isArray(items)?items.filter(x=>typeof x==='string').join('\n'):String(id==='hmk'?p.content||'':id==='resellwithme'?p.code||'':id==='safwan'?p.credentials||p.delivered_item||'':'');
  const amount=id==='hmk'?Number(p.total):id==='pai'?Number(p.total_cost):id==='safwan'?Number(p.total_cost??p.total):Number(p.amount_minor)/1e6;
  return {id:p.order_id||p.id||null,status,delivery,cost:Number.isFinite(amount)?amount:null,itemCount:Array.isArray(items)?items.length:null,
    delivered:(['delivered','fulfilled','completed'].includes(status)||(id==='safwan'&&d?.ok===true&&!status))&&!!delivery,
    refunded:status==='refunded'||p.wallet_status==='refunded',
    // Un fallo sin confirmación financiera permanece en revisión.
  };
}
