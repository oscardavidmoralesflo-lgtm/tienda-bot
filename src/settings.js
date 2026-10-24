import { many, query } from './db.js';

// Valores por defecto. Todo se puede cambiar desde el panel de admin (Ajustes).
export const DEFAULTS = {
  shop_name: 'Mi Tienda Digital',
  currency: 'USDT',
  markup_products: '20',   // % de ganancia sobre productos digitales
  markup_games: '15',      // % de ganancia sobre recargas de juegos, gift cards y keys
  referral_percent: '5',   // % de cada compra que gana quien invitó al cliente
  min_recharge: '1',
  low_balance_alert: '10', // te avisa cuando tu saldo en KOKORO baje de esto
  maintenance: '0',
  welcome_text:
    '👋 ¡Hola {name}! Bienvenido a <b>{shop}</b>.\n\n' +
    'Aquí compras cuentas, licencias, recargas de juegos y gift cards con entrega automática al instante.\n\n' +
    'Usa el menú de abajo para empezar 👇',
  payment_instructions:
    '💳 <b>Métodos de pago</b>\n\n' +
    '• Binance Pay ID: <code>000000000</code>\n' +
    '• USDT (TRC20): <code>Txxxxxxxxxxxxxxxxxxxxx</code>\n\n' +
    'Después de pagar, envía aquí la captura del comprobante.',
  support_contact: '@tu_usuario',
};

let cache = null;

export async function loadSettings() {
  const rows = await many('SELECT key, value FROM settings');
  cache = { ...DEFAULTS };
  for (const r of rows) cache[r.key] = r.value;
  return cache;
}

export function s(key) {
  return (cache || DEFAULTS)[key] ?? DEFAULTS[key];
}
export const num = (key) => Number(s(key)) || 0;

export async function saveSettings(values) {
  for (const [key, value] of Object.entries(values)) {
    if (!(key in DEFAULTS)) continue;
    await query(
      'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      [key, String(value ?? '')],
    );
  }
  return loadSettings();
}
