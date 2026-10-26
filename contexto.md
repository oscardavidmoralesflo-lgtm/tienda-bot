# Contexto del proyecto: Nova Plus (bot de Telegram revendedor)

> Documento para retomar el proyecto con otra IA o desarrollador. **No contiene contraseñas ni tokens**: esos están solo en `.env` (local) y en las variables de entorno de Render.

## 1. Qué es
**Nova Plus** es una tienda en Telegram que revende productos digitales (IA, streaming, diseño, Office, VPN, recargas de juegos, gift cards, keys) comprándolos automáticamente a dos proveedores mayoristas y cobrando al cliente con margen. Público principal: Colombia (precios en pesos), bilingüe español/inglés.

- Bot actual: `@MiTiendaDigital2847_bot` (nombre visible "Nova Plus"). Pendiente: crear `@NovaPlusStoreBot` en @BotFather y cambiar el token (el usuario de un bot no se puede renombrar).
- Panel admin: https://tienda-bot-dspr.onrender.com/admin (contraseña en `.env` → `ADMIN_PASSWORD`).
- Repositorio (público, sin secretos): https://github.com/oscardavidmoralesflo-lgtm/tienda-bot
- Admin de Telegram (ID): 1309369460

## 2. Modelo de negocio
1. El cliente **recarga saldo** en el bot (prepago).
2. Compra con su saldo; el bot compra al proveedor con el saldo del dueño y entrega al instante.
3. Ganancia = precio de venta − costo del proveedor.
- El dueño debe mantener saldo (USDT) en KOKORO (@Shop_KOKORO_BOT) y Bunny (@bunnytoolss_bot).

## 3. Arquitectura
- **Node.js 20+ (ESM)**, `grammy` (bot), `express` (panel + webhooks), `pg` (PostgreSQL), `@electric-sql/pglite` (base local para pruebas sin `DATABASE_URL`).
- **Hosting**: Render (plan free, región Virginia), servicio `srv-dbeh5u5g1s2s73fj7igg`, auto-deploy al hacer push a `main`. El bot usa webhook de Telegram (`/tg/<hash>`); en local usa polling.
- **Base de datos**: Supabase, proyecto `tienda-bot` (id `mjfptoobualwppugqhja`), esquema privado `tienda`, rol propio `tienda_bot` vía session pooler `aws-0-us-east-1`. RLS activado. Las tablas se crean/actualizan solas al arrancar (`src/schema.sql`, con `ALTER … IF NOT EXISTS`). **No tocar el proyecto Supabase "stoa"** (es de otra app del usuario).
- Keep-alive: el propio servidor se visita cada 3 min para que Render free no se duerma (consume ~744 h/mes de las 750 gratis compartidas con otros servicios del usuario).

### Archivos principales (`src/`)
| Archivo | Función |
|---|---|
| `server.js` | Arranque, rutas: `/admin`, `/health`, `/kokoro/webhook`, `/bold/webhook`, `/pago/listo`, webhook de Telegram; timers |
| `config.js` | Variables de entorno |
| `db.js`, `schema.sql` | Conexión (Postgres o PGlite) y esquema |
| `settings.js` | Ajustes editables desde el panel (con valores por defecto) |
| `kokoro.js` | Cliente API KOKORO (`https://api.shopdigital.app`, Bearer token) |
| `bunny.js` | Cliente API Bunny (`https://bunnytoolsbot.tech/api/v1`, header `X-API-Key`). La API real usa `product_id`, `base_price`, `description` (difiere de su doc) |
| `bold.js` | Cliente Bold (links de pago) + verificación de firma del webhook |
| `catalog.js`, `catalog-groups.js` | Catálogo unificado KOKORO+Bunny; productos equivalentes agrupados → se muestra solo el más barato con stock; productos ocultos (incluye "Links Shop de Ccs" y "Method Capcut" por ser fraude) |
| `categories.js` | Categorías automáticas por nombre (IA, Streaming, Diseño, Office…) en ES/EN |
| `pricing.js` | Márgenes por tramos, ganancia mínima, overrides por producto, tasa COP y precios redondos en pesos |
| `orders.js` | Motor de compras: cobro atómico, compra al proveedor, entrega, reembolsos, referidos, ñapa (cashback), recordatorio de renovación |
| `loyalty.js` | Niveles (Bronce/Plata/Oro/Diamante), duración de suscripciones |
| `refresher.js`, `cache.js` | Caché "stale-while-revalidate"; refresco de precios/stock cada 3 min; tasa USD→COP cada hora |
| `i18n.js` | Todos los textos del bot en español e inglés |
| `users.js` | Usuarios, saldo, idioma |
| `bot/index.js` | Menú, idioma, perfil, recargas (manual y Bold), pedidos, referidos, soporte, comandos admin |
| `bot/shop.js` | Tienda, categorías, fichas, juegos, búsqueda, compra |
| `bot/ui.js` | Utilidades de teclados/mensajes |
| `web/admin.js`, `web/layout.js` | Panel admin premium (ónix y oro, tema claro/oscuro, gráficas) |
| `test/` | `run-tests.js` (22 pruebas con proveedores simulados), `preview-bot.js` (simulador de conversaciones → `bot-preview.html`), `preview-admin.js` (panel con datos de ejemplo) |
| `brand/` | Logo Nova Plus (estrella nova de 4 puntas que forma un "+", órbita dorada, fondo ónix): `logo.svg`, `wordmark.svg`, PNGs |

## 4. Funciones del bot
- Primera vez: elegir idioma (🇪🇸/🇺🇸); todo se traduce después (`/idioma`, `/language`).
- Menú inline: Tienda, Juegos y Gift Cards, Más vendidos, Buscar, Recargar, Mi perfil, Pedidos, Invita y gana, Soporte, Idioma, Canal.
- Precios en **pesos redondos** (terminan en 400/900); internamente el saldo se guarda en USD.
- Juegos (KOKORO): verificación del ID del jugador antes de cobrar, flujo Supercell con código.
- Fidelización: **Ñapa** (cashback 1/2/3 % por nivel), **recordatorio de renovación** 3 días antes de vencer, referidos 5 %, **bono por recarga** (+3 % desde $100.000, +5 % desde $200.000).
- Recargas:
  - **Manual (0 % comisión)**: Bre-B/Nequi/Binance + captura → el admin aprueba con un botón (Telegram o panel). El admin puede fijar un QR enviando la foto al bot con `/qr`.
  - **Automática con Binance (USDT/USDC/FDUSD, 0 % comisión)** — método principal, como KOKORO y Bunny: el cliente paga a tu Binance Pay ID (o deposita por TRC20/BEP20), pega el **Order ID** o **TxID** en el bot, y el bot lo verifica con una llave de **solo lectura** (`src/binance.js`: `/sapi/v1/pay/transactions` y `/sapi/v1/capital/deposit/hisrec`, últimos 7 días) y acredita 1:1 en USD + bono por recarga. El ID se guarda en `recharges.ext_tx` (índice único) para que no se use dos veces. Pagos salientes, otra moneda o depósitos sin confirmar no se acreditan (avisa al admin si es otra moneda).
  - **Automática con Bold** (apagada por defecto: las pasarelas colombianas no permiten estos productos; programada y probada con simulador): link de pago PSE/Nequi/Botón Bancolombia, recargo 3,5 % al cliente, webhook firmado (`x-bold-signature` = HMAC-SHA256(llave secreta, base64(body))) + verificación cada 2 min. Bre-B no está disponible en links de Bold.
- Comandos admin en Telegram: `/admin`, `/addsaldo ID MONTO`, `/usuario ID`, `/qr` (con foto), `/qr_borrar`.

## 5. Panel admin
Resumen (ganancia, gráfica 14 días, saldos de proveedores y cobertura, más vendidos, ventas por categoría), Recargas, Pedidos (entregar manual, reembolsar, reenviar), Clientes (saldo, mensajes, bloqueo, idioma), Productos (margen, precio fijo, ocultar, destacar ⭐, filtros), Juegos, Difusión, Ajustes (tienda, márgenes, pagos/COP, Bold, fidelización, textos ES/EN).

## 6. Variables de entorno (valores solo en `.env` y Render)
`BOT_TOKEN`, `KOKORO_API_TOKEN`, `BUNNY_API_KEY`, `BINANCE_API_KEY`, `BINANCE_API_SECRET` (solo lectura), `BOLD_API_KEY`, `BOLD_SECRET_KEY`, `ADMIN_IDS`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `SHOP_PREFIX`, `DATABASE_URL`, `DB_SCHEMA=tienda`, `PUBLIC_URL` (Render la detecta sola).

## 7. Márgenes recomendados (por defecto)
Productos por costo: ≤1 USD 60 % · ≤3 USD 40 % · ≤10 USD 30 % · ≤30 USD 20 % · resto 12 %, mínimo 0,20 USD por pedido. Juegos: ≤5 USD 20 % · ≤20 USD 12 % · resto 8 %. Tasa COP: automática + 3 %.

## 8. Comandos útiles
```bash
npm install
npm test                    # 22 pruebas, no gasta saldo real
node test/preview-bot.js    # genera test/bot-preview.html
node test/preview-admin.js  # panel de prueba en http://localhost:3999/admin (contraseña demo1234)
npm start                   # ¡OJO! en local quita el webhook del bot de producción
```
Desplegar: `git push` a `main` → Render despliega solo.

## 9. Pendientes
1. Binance: crear llave API con SOLO "Enable Reading", ponerla en `.env`/Render, y en Panel → Ajustes poner el Binance Pay ID y direcciones TRC20/BEP20; hacer una recarga real de 1 USDT de prueba.
1b. (Opcional, apagado) Crear cuenta Bold, activar llaves de "Botón de pagos", pegarlas en `.env`/Render y configurar el webhook `https://tienda-bot-dspr.onrender.com/bold/webhook`; hacer un pago real pequeño de prueba.
2. Recargar saldo en KOKORO y Bunny (estaban en $0).
3. Probar una compra real en Bunny (formato de respuesta de compra aún no visto en real).
4. Llenar en el panel: datos reales de pago (llave Bre-B, Nequi), contacto de soporte, canal.
5. Crear `@NovaPlusStoreBot` y cambiar `BOT_TOKEN`.
6. Opcional: Render Starter ($7/mes) para más velocidad y no depender del keep-alive.

## 10. Notas para quien continúe
- Nunca subir `.env` al repositorio (está en `.gitignore`).
- Los textos al cliente van siempre por `i18n.js` (clave en ES y EN; hay prueba que lo exige).
- Bunny no tiene consulta de pedidos ni protección de duplicados: nunca reintentar compras; si queda dudosa, se entrega/reembolsa desde el panel.
- KOKORO sí es idempotente (`external_order_id`).
