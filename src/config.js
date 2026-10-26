import 'dotenv/config';

const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);

export const config = {
  botToken: process.env.BOT_TOKEN || '',
  kokoroToken: process.env.KOKORO_API_TOKEN || '',
  kokoroBase: (process.env.KOKORO_BASE_URL || 'https://api.shopdigital.app').replace(/\/$/, ''),
  // Segundo proveedor (opcional): Bunny AI Store
  bunnyKey: process.env.BUNNY_API_KEY || '',
  // Recargas automáticas con Binance (llave de SOLO LECTURA)
  binanceKey: process.env.BINANCE_API_KEY || '',
  binanceSecret: process.env.BINANCE_API_SECRET || '',
  binanceBase: (process.env.BINANCE_BASE_URL || 'https://api.binance.com').replace(/\/$/, ''),
  // Recargas automáticas con Bold (llave de identidad y llave secreta de "Botón de pagos")
  boldApiKey: process.env.BOLD_API_KEY || '',
  boldSecretKey: process.env.BOLD_SECRET_KEY || '',
  boldBase: (process.env.BOLD_BASE_URL || 'https://integrations.api.bold.co').replace(/\/$/, ''),
  bunnyBase: (process.env.BUNNY_BASE_URL || 'https://bunnytoolsbot.tech/api/v1').replace(/\/$/, ''),
  // Sin DATABASE_URL se usa una base de datos local en ./data (solo para pruebas en tu PC)
  databaseUrl: process.env.DATABASE_URL || '',
  // Esquema propio dentro de la base de datos (para no mezclar con otras tablas)
  dbSchema: (process.env.DB_SCHEMA || '').replace(/[^a-z0-9_]/gi, ''),
  // Render pone RENDER_EXTERNAL_URL automáticamente
  publicUrl: (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, ''),
  port: Number(process.env.PORT || 3000),
  adminPassword: process.env.ADMIN_PASSWORD || '',
  adminIds: list(process.env.ADMIN_IDS).map(Number).filter(Number.isFinite),
  sessionSecret: process.env.SESSION_SECRET || '',
  // Prefijo de tus pedidos en KOKORO (debe ser único en toda la plataforma)
  shopPrefix: (process.env.SHOP_PREFIX || 'mitienda').replace(/[^A-Za-z0-9]/g, '').slice(0, 20) || 'mitienda',
};

export function checkConfig() {
  const missing = [];
  if (!config.botToken) missing.push('BOT_TOKEN');
  if (!config.kokoroToken) missing.push('KOKORO_API_TOKEN');
  if (!config.adminPassword) missing.push('ADMIN_PASSWORD');
  if (!config.sessionSecret) config.sessionSecret = `${config.adminPassword}:${config.botToken}`;
  return missing;
}

export const isAdmin = (id) => config.adminIds.includes(Number(id));
