# Contexto del proyecto: Nova Plus (bot de Telegram revendedor)

> **Estado comprobado 2026-10-30:** El bot está desplegado en Northflank Developer Sandbox gratuito: equipo `oscardavidmoralesflo-lgtms-team`, proyecto `default`, servicio `nova-plus`, región US - Central, una instancia `nf-compute-20` (0,2 vCPU y 512 MB). Panel: https://p01--nova-plus--lrqtmg7p4xwj.code.run/admin. `/health` respondió 200 y Telegram confirmó el webhook en ese dominio sin mensajes pendientes ni errores. El usuario verificó una tarjeta; el plan sigue Free.
>
> Se integró la PR #1 y se aprobaron pruebas y Docker en GitHub Actions. El primer despliegue se verificó con `ghcr.io/oscardavidmoralesflo-lgtm/tienda-bot:23cc033d0568b5c0afec39e3737bcdd6e55f9550`; consultar el panel de Northflank para la etiqueta vigente. Es una etiqueta fija: otra publicación NO actualiza automáticamente el servicio; hay que seleccionar la imagen nueva y verificar el despliegue. Las claves de bot, proveedores y base de datos se configuraron en variables privadas con autorización explícita. Las cuatro variables Bold/Binance estaban vacías; sus recargas automáticas siguen sin configurar.
>
> KOKORO, Bunny, Safwan y P-AI tenían saldo 0. Safwan tiene 20 productos preseleccionados; P-AI tiene 2 (iLovePDF anual y Customer.io). Estas dos conexiones permanecen apagadas hasta contar con saldo. No se hicieron compras ni depósitos reales. Se retiraron pagos y soporte de ejemplo del bot: faltan los datos reales del dueño. El catálogo base mostró 201 artículos con stock; tener catálogo no implica tener fondos para comprarlos.
>
> Render conserva el servicio anterior, pero Auto-Deploy está Off y el comando de inicio termina sin arrancar el bot. Esto evita que otra instancia cambie el webhook al reiniciarse el cupo gratuito. Para volver a Render, restaurar `npm start` después de detener Northflank. No modificar otros servicios del workspace.
>
> Se añadieron `provider-settings.js`, `providers.js` y `/admin/providers`: credenciales cifradas y adaptadores SafwanTiger/P-AI/HMK/ResellWithMe. HMK/RWM requieren credenciales propias y siguen sin configurar.
>
> Los antiguos grupos automáticos se retiraron porque mezclaban garantías, duraciones y Vibi/ElevenLabs. `GROUPS` queda reservado para equivalencias que se revisen de verdad; `LEGACY_GROUPS` conserva la referencia anterior. Se bloquea el pago con catálogo no actualizado, subida de precio sin nueva confirmación y margen insuficiente. El mínimo estimado protege también precios fijos e incluye reservas configurables para comisiones/fidelización. Recomendación inicial: productos $0,50, juegos $0,10; los ajustes existentes no se sobrescriben al arrancar.
>
> Safwan y Bunny no se reintentan con resultado incierto; la revisión se hace en el panel. Las entregas parciales permanecen pendientes. Los callbacks de confirmación se reclaman atómicamente para evitar doble compra. Las compras de pruebas usan servidores simulados: nunca ejecutar `npm start` local contra el bot productivo para probar el panel.
>
> La etiqueta de moneda de categorías usa `COP` cuando `copMode()` está activo, igual que los precios mostrados. El resto de este documento mantiene referencias a la implementación previa; esta actualización tiene prioridad cuando exista una diferencia.

> Documento para retomar el proyecto. **No contiene contraseñas ni tokens**: se conservan en `.env` local y variables privadas de los alojamientos autorizados.

## 1. Qué es
**Nova Plus** es una tienda en Telegram que revende productos digitales (IA, streaming, diseño, Office, VPN, recargas de juegos, gift cards, keys) comprándolos automáticamente a dos proveedores mayoristas y cobrando al cliente con margen. Público principal: Colombia (precios en pesos), bilingüe español/inglés.

- Bot actual: `@MiTiendaDigital2847_bot` (nombre visible "Nova Plus"). Pendiente: crear `@NovaPlusStoreBot` en @BotFather y cambiar el token (el usuario de un bot no se puede renombrar).
- Panel admin actual: https://p01--nova-plus--lrqtmg7p4xwj.code.run/admin (misma `ADMIN_PASSWORD`). La URL anterior de Render está inactiva.
- Repositorio (público, sin secretos): https://github.com/oscardavidmoralesflo-lgtm/tienda-bot
- Admin de Telegram (ID): 1309369460

## 2. Modelo de negocio
1. El cliente **recarga saldo** en el bot (prepago).
2. Compra con su saldo; el bot compra al proveedor con el saldo del dueño y entrega al instante.
3. Ganancia = precio de venta − costo del proveedor.
- El dueño debe mantener saldo (USDT) en KOKORO (@Shop_KOKORO_BOT) y Bunny (@bunnytoolss_bot).

## 3. Arquitectura
- **Node.js 20+ (ESM)**, `grammy` (bot), `express` (panel + webhooks), `pg` (PostgreSQL), `@electric-sql/pglite` (base local para pruebas sin `DATABASE_URL`).
- **Hosting actual**: Northflank Developer Sandbox con imagen Docker de GHCR y etiqueta fija de commit. GitHub Actions prueba y publica una imagen al integrar a `main`; después se selecciona la nueva imagen en Northflank. Render `srv-dbeh5u5g1s2s73fj7igg` queda como destino anterior inactivo. El bot usa webhook de Telegram (`/tg/<hash>`); en local usa polling.
- **Base de datos**: Supabase, proyecto `tienda-bot` (id `mjfptoobualwppugqhja`), esquema privado `tienda`, rol propio `tienda_bot` vía session pooler `aws-0-us-east-1`. RLS activado. Las tablas se crean/actualizan solas al arrancar (`src/schema.sql`, con `ALTER … IF NOT EXISTS`). **No tocar el proyecto Supabase "stoa"** (es de otra app del usuario).
- Northflank usa `KEEP_ALIVE=0`; los refrescos de precios y pedidos siguen activos. Mantener despierto Render gratuito no elimina su cuota mensual compartida.

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
Protección guardada: mínimo estimado de 0,50 USD por pedido de productos y 0,10 USD en juegos; margen mínimo sobre venta de 15 % y 5 %; reserva de incidencias de 2 % y reserva de máximos de referidos, ñapa y bonos. Los márgenes por tramos siguen disponibles. Los cargos desconocidos no están garantizados por esta estimación.

## 8. Comandos útiles
```bash
npm install
npm test                    # 42 pruebas, sin compras reales
node test/preview-bot.js    # genera test/bot-preview.html
node test/preview-admin.js  # panel de prueba en http://localhost:3999/admin (contraseña demo1234)
npm start                   # ¡OJO! en local quita el webhook del bot de producción
```
Publicar en `main` activa las pruebas y la imagen GHCR. Desplegar requiere seleccionar su etiqueta de commit en Northflank y comprobar `/health`, webhook y panel. El usuario pide operar GitHub y los alojamientos mediante Egolite.

## 9. Pendientes
1. Recibir los datos reales de cobro y soporte; reemplazar en el panel el aviso temporal de recargas pendientes de habilitación.
1b. Binance/Bold siguen sin claves. Si se habilitan, verificar condiciones del procesador y configurar callbacks en el dominio de Northflank. Las pruebas de pago requieren autorización de un importe concreto.
2. El usuario debe recargar al menos un proveedor. Los cuatro proveedores consultados estaban en 0; no se efectuaron depósitos.
3. Probar una compra real en Bunny (formato de respuesta de compra aún no visto en real).
4. Llenar en el panel: datos reales de pago (llave Bre-B, Nequi), contacto de soporte, canal.
5. Crear `@NovaPlusStoreBot` y cambiar `BOT_TOKEN`.
6. Mantener el alojamiento gratuito hasta que el usuario decida migrar. No contratar un plan de pago sin autorización explícita.

## 10. Notas para quien continúe
- Nunca subir `.env` al repositorio (está en `.gitignore`).
- Los textos al cliente van siempre por `i18n.js` (clave en ES y EN; hay prueba que lo exige).
- Bunny no tiene consulta de pedidos ni protección de duplicados: nunca reintentar compras; si queda dudosa, se entrega/reembolsa desde el panel.
- KOKORO sí es idempotente (`external_order_id`).
