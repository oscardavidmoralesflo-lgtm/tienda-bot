import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import express from 'express';

export async function runProviderTests({test,users,orders,pricing,saveSettings,one}) {
  const settings=await import('../src/provider-settings.js');
  const providers=await import('../src/providers.js');
  const catalog=await import('../src/catalog.js');
  const state={calls:[],hmkPrice:1,hmkFail:false,hmkPartial:false,paiStock:5,safwanTimeout:false,readFailure:false};
  const server=http.createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=raw?JSON.parse(raw):{};state.calls.push({method:req.method,url:req.url,body,headers:req.headers});
    const json=(d,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(d));};
    const path=req.url.split('?')[0];
    if(req.method==='GET'&&(/\/me$/.test(path)||path==='/safwan/balance'))return json({balance:100,wallets:{USD:{balance_micros:100000000}},can_purchase:true});
    if(req.method==='GET'&&path.endsWith('/products')) {
      if(state.readFailure)return json({error:'offline'},503);
      if(path.startsWith('/hmk'))return json({data:[{id:1,name:'Producto HMK',price:String(state.hmkPrice),stock:10,in_stock:true,delivery:'instant',tiers:[]}]});
      if(path.startsWith('/resellwithme'))return json([{id:1,name:'Producto RWM',prices:{USD:{amount_micros:1000000}},available_qty:10,min_qty:1,max_qty:10,delivery:{type:'instant'},fulfillment_kind:'codes'}]);
      if(path.startsWith('/pai'))return json({products:[{service_id:'1',name:'Producto P-AI',unit_price:1,stock:state.paiStock,input_type:'quantity',price_per:1,min_quantity:1,max_quantity:10}]});
      return json({ok:true,products:[{id:1,name:'Producto Safwan',price:1,stock:10,available:true,warranty:'1 day'}]});
    }
    if(path==='/resellwithme/quotes')return json({id:'quote-locked',amount_minor:1000000,can_pay:true,delivery:{type:'instant'}},201);
    if(path==='/pai/quote')return json({stock:state.paiStock,stock_warning:state.paiStock<2?'Will queue':null,sufficient_balance:true,pricing:{final_total:2}});
    if(path==='/hmk/orders'&&req.method==='POST') {
      if(state.hmkFail)return json({error:{charged:false,code:'out_of_stock',message:'stock'}},409);
      return json({id:'H1',status:'delivered',total:String(state.hmkPrice*body.quantity),items:Array.from({length:state.hmkPartial?1:body.quantity},(_,i)=>`CODE-${i}`)},201);
    }
    if(path==='/resellwithme/orders'&&req.method==='POST')return json({order_id:'R1',status:'fulfilled',amount_minor:1000000,code:'RWM-CODE'},201);
    if(path==='/safwan/order'&&state.safwanTimeout)return req.socket.destroy();
    if(path==='/safwan/order')return json({ok:true,items:['SW-CODE'],total_cost:1});
    return json({error:'not found'},404);
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  for(const id of Object.keys(settings.PROVIDER_SPECS)) {
    process.env[`${id.toUpperCase()}_TEST_BASE`]=`${base}/${id}`;
    delete process.env[settings.PROVIDER_SPECS[id].env];
  }
  try {
    await test('credenciales cifradas: persisten sin aparecer en estado público',async()=>{
      for(const id of Object.keys(settings.PROVIDER_SPECS))await settings.saveProviderSettings(id,{key:`secret-test-${id}-0123456789`,enabled:true,selected:['1']});
      const row=await one("SELECT value FROM settings WHERE key='provider:hmk'");
      assert.ok(!row.value.includes('secret-test-hmk'));
      assert.ok(!JSON.stringify(settings.publicProviderSettings('hmk')).includes('secret-test-hmk'));
      await settings.loadProviderSettings();
      assert.equal(settings.providerConnection('hmk').key,'secret-test-hmk-0123456789');
    });
    await saveSettings({profit_protection:'1',protect_loyalty_costs:'1',min_profit_products:'0.50',min_profit_games:'0.10',min_margin_products:'15',min_margin_games:'5',risk_reserve_percent:'2',supplier_cost_percent:'2',payment_cost_percent:'3',referral_percent:'5',cashback_tiers:'10:1,50:2,200:3',recharge_bonus:'100000:3,200000:5',price_display:'usd',cop_rate:'0'});
    await test('mínimo estimado cubre comisiones, bonos, ñapa y referidos',async()=>{
      const p={id:'policy',price:1.2},sale=pricing.productUnitPrice(p);
      assert.equal(pricing.profitPolicy().salePct,18);
      assert.ok(pricing.estimatedProfit(1.2,sale)>=0.5);
      assert.ok(pricing.protectsProfit(1.2,sale));
    });
    await test('precio fijo no puede anular la ganancia mínima',async()=>{
      await pricing.saveOverride('policy','product','Prueba',{fixed_price:'0.05'});
      assert.ok(pricing.protectsProfit(1.2,pricing.productUnitPrice({id:'policy',price:1.2})));
      await pricing.saveOverride('policy','product','Prueba',{});
    });
    await test('descuento por volumen mantiene el mínimo por pedido',async()=>{
      const p={id:'bulk',price:1.2,bulk_discounts:[{min_qty:10,unit_price:1}]};
      assert.ok(pricing.protectsProfit(10,pricing.productUnitPrice(p,10)*10,'products',10));
    });
    await test('subir costo sube automáticamente el mínimo',async()=>{
      const a=pricing.productUnitPrice({id:'dyn',price:1}),b=pricing.productUnitPrice({id:'dyn',price:3});
      assert.ok(b>a);assert.ok(pricing.protectsProfit(3,b));
    });
    await test('normalización respeta micros USD y rechaza flujos incompatibles',async()=>{
      const rows=await providers.extraProducts('resellwithme',{all:true,fresh:true});assert.equal(rows[0].price,1);
      assert.equal(providers.normalizeProviderProduct('pai',{service_id:'x',name:'boost',unit_price:1,stock:100,input_type:'link',price_per:1000}).supported,false);
      assert.equal(providers.normalizeProviderProduct('hmk',{id:3,name:'manual',price:1,in_stock:true,stock:3,delivery:'manual'}).supported,false);
      assert.equal(providers.normalizeProviderProduct('resellwithme',{id:3,name:'multi',prices:{USD:{amount_micros:1000000}},stock:3,delivery:{type:'instant'},required_fields:['player','server']}).supported,false);
    });
    await test('solo publica productos seleccionados y compatibles',async()=>{
      await settings.saveProviderSettings('hmk',{enabled:true,selected:[]});
      assert.equal((await providers.extraProducts('hmk')).length,0);
      await settings.saveProviderSettings('hmk',{enabled:true,selected:['1']});
      assert.equal((await providers.extraProducts('hmk')).length,1);
    });
    await test('pago exige precio fresco: una caída no usa el catálogo antiguo',async()=>{
      await catalog.findProduct('hmk:1',true);state.readFailure=true;
      await assert.rejects(()=>catalog.findProduct('hmk:1',true));state.readFailure=false;
    });
    await users.upsertUser({id:9090,first_name:'Pruebas Proveedores'});await users.credit(9090,100,'recharge','mock');
    await test('HMK: guarda costo, compra y entrega con identidad persistida',async()=>{
      const p=(await providers.extraProducts('hmk',{fresh:true}))[0];
      const r=await orders.buyProduct({userId:9090,product:p,quantity:1,unitPrice:pricing.productUnitPrice(p)});
      assert.equal(r.order.status,'delivered');assert.equal(r.order.kind,'hmk');assert.match(r.order.delivery,/CODE/);
      const call=state.calls.find(x=>x.method==='POST'&&x.url==='/hmk/orders');assert.equal(call.body.idempotency_key,r.order.external_order_id);
    });
    await test('rechazo explícito sin cobro reembolsa una sola vez',async()=>{
      const before=(await users.getUser(9090)).balance;state.hmkFail=true;
      const p=(await providers.extraProducts('hmk',{fresh:true}))[0],r=await orders.buyProduct({userId:9090,product:p,quantity:1,unitPrice:pricing.productUnitPrice(p)});
      assert.equal(r.order.status,'refunded');assert.equal((await users.getUser(9090)).balance,before);await orders.refundOrder(r.order.id,'duplicate');assert.equal((await users.getUser(9090)).balance,before);state.hmkFail=false;
    });
    await test('RWM: usa cotización congelada y claves de idempotencia',async()=>{
      const p=(await providers.extraProducts('resellwithme',{fresh:true}))[0],r=await orders.buyProduct({userId:9090,product:p,quantity:1,unitPrice:pricing.productUnitPrice(p)});
      assert.equal(r.order.status,'delivered');assert.equal(r.order.cost,1);
      const call=state.calls.find(x=>x.method==='POST'&&x.url==='/resellwithme/orders');assert.equal(call.body.quote_id,'quote-locked');assert.equal(call.headers['idempotency-key'],r.order.external_order_id);
    });
    await test('P-AI: stock insuficiente no encola ni descuenta saldo',async()=>{
      const p=(await providers.extraProducts('pai',{fresh:true}))[0];state.paiStock=1;const before=(await users.getUser(9090)).balance;
      const r=await orders.buyProduct({userId:9090,product:p,quantity:2,unitPrice:3});
      assert.equal(r.ok,false);assert.equal((await users.getUser(9090)).balance,before);assert.ok(!state.calls.some(x=>x.url==='/pai/order'));state.paiStock=5;
    });
    await test('ganancia insuficiente no crea compra de proveedor',async()=>{
      const p=(await providers.extraProducts('hmk',{fresh:true}))[0],n=state.calls.filter(x=>x.url==='/hmk/orders').length;
      const r=await orders.buyProduct({userId:9090,product:p,quantity:1,unitPrice:1});assert.equal(r.ok,false);assert.equal(state.calls.filter(x=>x.url==='/hmk/orders').length,n);
    });
    await test('Safwan: timeout no reintenta, no cambia proveedor ni reembolsa a ciegas',async()=>{
      const p=(await providers.extraProducts('safwan',{fresh:true}))[0];state.safwanTimeout=true;
      const r=await orders.buyProduct({userId:9090,product:p,quantity:1,unitPrice:pricing.productUnitPrice(p)});
      assert.equal(r.order.status,'processing');const n=state.calls.filter(x=>x.url==='/safwan/order').length;await orders.refreshOrder(r.order);assert.equal(state.calls.filter(x=>x.url==='/safwan/order').length,n);state.safwanTimeout=false;
    });
    await test('entrega parcial queda pendiente para revisar',async()=>{
      state.hmkPartial=true;const p=(await providers.extraProducts('hmk',{fresh:true}))[0],r=await orders.buyProduct({userId:9090,product:p,quantity:2,unitPrice:3});
      assert.equal(r.order.status,'processing');assert.match(r.order.failure_reason,/parcial/);state.hmkPartial=false;
    });
    await test('404 al conciliar una orden no demuestra reembolso',async()=>{
      const row=await one("SELECT * FROM orders WHERE kind='hmk' AND status='processing' ORDER BY id DESC LIMIT 1");await orders.refreshOrder(row);assert.equal((await one('SELECT * FROM orders WHERE id=$1',[row.id])).refunded,false);
    });
    await test('configuración financiera inválida se rechaza antes de guardarse',async()=>{
      await assert.rejects(()=>saveSettings({payment_cost_percent:'99'}));
      await assert.rejects(()=>saveSettings({min_profit_products:'-1'}));
      assert.equal((await import('../src/settings.js')).s('payment_cost_percent'),'3');
    });
    await test('Telegram: aumento de precio exige confirmar otra vez; doble clic compra una sola vez',async()=>{
      const {createBot}=await import('../src/bot/index.js'),{query}=await import('../src/db.js'),{ref}=await import('../src/util.js');
      const out=[],bot=createBot();
      bot.api.config.use(async(prev,method,payload)=>{
        if(method==='getMe')return {ok:true,result:{id:1,is_bot:true,first_name:'Prueba',username:'NovaPlusTestBot'}};
        if(['sendMessage','editMessageText'].includes(method))out.push(payload.text);
        return {ok:true,result:{message_id:1,date:0,chat:{id:payload.chat_id||1,type:'private'},text:payload.text}};
      });
      await bot.init();const from={id:9191,is_bot:false,first_name:'Cliente'},chat={id:9191,type:'private'};
      await users.upsertUser(from);await users.credit(9191,50,'recharge','mock');await query("UPDATE users SET lang='es' WHERE id=9191");
      let uid=9000;const tap=data=>bot.handleUpdate({update_id:uid++,callback_query:{id:String(uid),from,chat_instance:'1',data,message:{message_id:1,date:0,chat,text:'x'}}});
      const before=(await users.getUser(9191)).balance,n=()=>state.calls.filter(c=>c.method==='POST'&&c.url==='/hmk/orders').length;
      await tap(`pq:${ref('hmk:1')}:1`);const purchases=n();state.hmkPrice=2;await tap('ok');
      assert.equal(n(),purchases);assert.equal((await users.getUser(9191)).balance,before);assert.ok(out.some(x=>x.includes('condiciones cambiaron')));
      await Promise.all([tap('ok'),tap('ok')]);assert.equal(n(),purchases+1);
      assert.equal(Number((await one("SELECT count(*) AS n FROM orders WHERE user_id=9191")).n),1);state.hmkPrice=1;
    });
    await test('panel de proveedores: autenticación, CSRF y claves siempre ocultas',async()=>{
      const {config}=await import('../src/config.js');config.adminPassword='provider-demo-password';config.sessionSecret='provider-demo-session';
      const {adminRouter}=await import('../src/web/admin.js');
      const app=express();app.use('/admin',adminRouter({notify:{user:async()=>true},botInfo:{username:'test'}}));
      const web=app.listen(0,'127.0.0.1');await once(web,'listening');const url=`http://127.0.0.1:${web.address().port}`;
      try {
        const denied=await fetch(url+'/admin/providers',{redirect:'manual'});assert.equal(denied.status,302);
        const login=await fetch(url+'/admin/login',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({password:config.adminPassword}),redirect:'manual'});
        const cookie=login.headers.get('set-cookie').split(';')[0];
        // Restablecer la clave de cifrado original usada en la primera parte de la prueba.
        process.env.PROVIDER_ENCRYPTION_KEY='test-provider-encryption-secret';
        const page=await fetch(url+'/admin/providers',{headers:{cookie}}),html=await page.text();assert.equal(page.status,200);assert.ok(html.includes('Proveedores'));assert.ok(!html.includes('secret-test-'));
        const token=html.match(/name="_csrf" value="([^"]+)"/)[1];
        const blocked=await fetch(url+'/admin/providers/hmk',{method:'POST',headers:{cookie,'content-type':'application/x-www-form-urlencoded'},body:'preserve_selection=1'});assert.equal(blocked.status,403);
        const saved=await fetch(url+'/admin/providers/hmk',{method:'POST',redirect:'manual',headers:{cookie,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({_csrf:token,preserve_selection:'1',enabled:'1'})});assert.equal(saved.status,302);
        const view=await fetch(url+'/admin/providers/hmk',{headers:{cookie}}),catalogHtml=await view.text();assert.equal(view.status,200);assert.ok(catalogHtml.includes('Producto HMK'));assert.ok(!catalogHtml.includes('secret-test-'));
        assert.equal((await fetch(url+'/admin/providers/constructor',{headers:{cookie}})).status,404);
      } finally {web.close();await once(web,'close');}
    });
  } finally {server.close();await once(server,'close');}
}
