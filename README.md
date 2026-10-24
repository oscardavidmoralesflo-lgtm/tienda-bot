# Tienda Bot: tu bot revendedor de KOKORO SHOP

Tu propio bot de Telegram que vende el catálogo de KOKORO SHOP con **tu margen de ganancia**, conectado a su API oficial para revendedores. Incluye un **panel de administración web**.

## Cómo funciona el dinero
1. Tus clientes te pagan a ti (Binance, USDT, transferencia…) y envían el comprobante en el bot.
2. Tú apruebas la recarga (en Telegram con un botón o en el panel) → se les suma saldo en tu bot.
3. Cuando compran, el bot descuenta de su saldo, compra en KOKORO con **tu** saldo de KOKORO y les entrega al instante.
4. La diferencia entre tu precio y el costo de KOKORO es tu ganancia.

⚠️ Mantén saldo en KOKORO (en @Shop_KOKORO_BOT). Si no alcanza, el bot devuelve el dinero al cliente y te avisa.

## Dos proveedores: KOKORO + Bunny
El catálogo junta KOKORO y Bunny AI Store. Si un producto está en los dos, el bot muestra solo el **más barato con stock** (y cambia solo si se agota). La lista de productos equivalentes está en `src/catalog-groups.js`. Para activar Bunny pon `BUNNY_API_KEY` (en @bunnytoolss_bot → Bot API). Bunny no permite consultar pedidos: si uno queda sin respuesta, te llega un aviso y lo entregas o reembolsas desde el panel.

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

## Publicar gratis 24/7 (Render + Supabase)
1. **Base de datos (Supabase)**: en tu proyecto → *Connect* → *Session pooler* → copia la URL (con tu contraseña). Va en `DATABASE_URL`. Las tablas se crean solas en el esquema `tienda`.
2. **Render**: sube esta carpeta a un repositorio de GitHub → en Render *New → Blueprint* → elige el repo (usa `render.yaml`) → rellena las variables.
3. Render da una URL tipo `https://tienda-bot.onrender.com`. El bot configura el webhook solo. El panel queda en `/admin`.
4. El plan gratis de Render se "duerme" tras 15 min sin uso (el primer mensaje tarda ~30 s). Para evitarlo, crea un monitor gratis en uptimerobot.com que visite `https://TU-URL/health` cada 5 minutos.
