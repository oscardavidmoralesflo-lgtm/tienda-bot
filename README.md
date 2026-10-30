# Tienda Bot: tu bot revendedor de KOKORO SHOP

Tu propio bot de Telegram que vende el catálogo de KOKORO SHOP con **tu margen de ganancia**, conectado a su API oficial para revendedores. Incluye un **panel de administración web**.

## Cómo funciona el dinero
1. Tus clientes te pagan a ti (Binance, USDT, transferencia…) y envían el comprobante en el bot.
2. Tú apruebas la recarga (en Telegram con un botón o en el panel) → se les suma saldo en tu bot.
3. Cuando compran, el bot descuenta de su saldo, compra en KOKORO con **tu** saldo de KOKORO y les entrega al instante.
4. La diferencia entre tu precio y el costo de KOKORO es tu ganancia.

⚠️ Mantén saldo en KOKORO (en @Shop_KOKORO_BOT). Si no alcanza, el bot devuelve el dinero al cliente y te avisa.

## Proveedores y ganancia protegida

KOKORO y Bunny mantienen sus conexiones existentes. El panel **Proveedores** añade adaptadores para **SafwanTiger, P-AI, HMK y ResellWithMe**, con claves cifradas en la base privada, consulta de saldo y selección de los productos que se publican. Las claves opcionales también pueden configurarse mediante sus variables de entorno en `.env.example`.

Las API de Safwan y P-AI se comprobaron mediante consultas de catálogo autenticadas. HMK y ResellWithMe están implementados contra sus referencias públicas y se prueban con simuladores; requieren una cuenta y clave propias antes de habilitarlos. SubExpress, Fuk y Jero no se anuncian como conectados porque no se verificó una API de compra adecuada.

Precios y stock se refrescan cada 3 minutos. Al pagar se exige una actualización válida y, donde el proveedor lo ofrece, una cotización. Si aumentan el precio o cambian las condiciones del producto, el cliente debe confirmar otra vez. No se agrupan ofertas solo porque compartan nombre: los antiguos grupos mezclaban garantías, plazos o plataformas distintas.

En Ajustes → Precios se configuran mínimo por pedido, margen mínimo sobre venta, costos de cobro/cambio y reserva de incidencias. La protección también se aplica a precios fijos y descuenta una reserva por los máximos vigentes de referidos, ñapa y bonos. Es una **estimación**, no una garantía frente a comisiones desconocidas o cambios de costo posteriores a una cotización no vinculante. Los ajustes existentes se conservan; para arrancar se recomienda mínimo de productos $0,50 y juegos $0,10.

Cada intención de compra tiene una referencia persistida. Una respuesta incierta no provoca otra compra ni un cambio de proveedor. Bunny y Safwan requieren revisión manual de estos casos porque no documentan una consulta de estado utilizable; los demás se concilian mediante lectura. Una entrega parcial tampoco se marca completa automáticamente.

Las conexiones nuevas empiezan apagadas y no publican todo el catálogo. Conectar una clave no financia los pedidos ni acredita autorización de las marcas para revender promociones o cuentas. Se deben comprobar elegibilidad, región y garantía por producto.

## Funciones del bot (clientes)
- 🛍 Catálogo de productos digitales con stock en vivo, descuentos por volumen y entrega instantánea
- 🎮 Recargas de juegos (Free Fire, PUBG, Mobile Legends, Supercell…), gift cards y keys de PC
- ✅ Verificación gratis del ID del jugador antes de pagar (muestra el nombre del jugador)
- 📧 Flujo completo de Supercell (pide el código de confirmación al cliente)
- 🔎 Búsqueda en todo el catálogo (también escribiendo cualquier texto)
- 💰 Saldo, historial de movimientos y recargas con comprobante
- 📦 Mis pedidos: vuelve a ver credenciales/códigos cuando quiera
- ↩️ Reembolso automático si el proveedor falla o rechaza el pedido
- 👥 Programa de referidos con comisión automática
- 🛠 Modo mantenimiento, mensaje de bienvenida y métodos de pago editables

## Panel de administración (`/admin`)
- Resumen: saldo en KOKORO, ventas, facturación y **ganancia** (hoy y total)
- Recargas: ver comprobante, corregir monto, aprobar/rechazar
- Pedidos: detalle, consultar estado en KOKORO, reenviar entrega, reembolsar
- Clientes: buscar, ajustar saldo, enviar mensaje, bloquear
- Productos y juegos: margen propio, precio fijo u ocultar cada producto/juego/paquete
- Difusión: mensaje a todos los clientes
- Ajustes: márgenes, referidos, textos, soporte, alerta de saldo bajo

En Telegram (solo admins): `/admin`, `/addsaldo ID MONTO`, `/usuario ID`, y botones para aprobar recargas.

## Probar en tu PC
```bash
npm install
copy .env.example .env      # rellena BOT_TOKEN, KOKORO_API_TOKEN, ADMIN_IDS, ADMIN_PASSWORD
npm start                   # panel en http://localhost:3000/admin
```
Sin `DATABASE_URL` usa una base de datos local en `./data`.

Pruebas automáticas (con un KOKORO simulado, no gasta saldo): `npm test`

## Despliegue con contenedor

`Dockerfile` usa Node 22 y solo copia dependencias y `src`; `.env`, datos locales y pruebas se excluyen de la imagen. `.github/workflows/container.yml` ejecuta pruebas y construye Docker en cada PR a `main`. Al publicar en `main`, sube la imagen a `ghcr.io/oscardavidmoralesflo-lgtm/tienda-bot` con etiqueta de commit y `latest`.

En Northflank, crear un servicio desde una imagen externa y elegir exclusivamente recursos permitidos por Developer Sandbox. Este proyecto se desplegó con una instancia de 0,2 vCPU y 512 MB. En la cuenta utilizada fue necesario verificar una tarjeta, manteniendo el plan gratuito.

Configurar las credenciales como variables privadas autorizadas, `PUBLIC_URL` con la URL HTTPS del servicio, `PORT=3000`, `KEEP_ALIVE=0` y comprobación HTTP de `/health`. Mantener `DATABASE_URL` y `DB_SCHEMA=tienda` para conservar usuarios y saldos. El servidor configura el webhook de Telegram al arrancar.

Si el alojamiento usa una etiqueta de commit fija, publicar en GitHub no cambia automáticamente el servidor: hay que seleccionar y comprobar la imagen nueva. No ejecutar dos instancias contra la base de datos productiva.

Render sigue disponible mediante `render.yaml`, dentro de sus cuotas o con un plan autorizado. Las visitas periódicas no eliminan sus cuotas mensuales gratuitas. Para migrar, detener el alojamiento anterior, restaurar `npm start` si estaba pausado y configurar `PUBLIC_URL` en el destino.

El alojamiento gratuito no financia compras a proveedores. Antes de aceptar pagos, configurar datos reales de recepción y soporte, comprobar saldo mayorista y verificar condiciones del producto. Una prueba con simuladores no prueba una entrega real.
