import { many, query } from './db.js';

// Valores por defecto. Todo se puede cambiar desde el panel de admin (Ajustes).
export const DEFAULTS = {
  shop_name: 'Mi Tienda Digital',
  currency: 'USDT',
  markup_products: '20',   // % general (solo si no hay tramos)
  markup_games: '15',
  // Margen por tramos según el costo (recomendado): barato = más %, caro = menos % para ser competitivo
  price_tiers_products: '1:60,3:40,10:30,30:20,*:12',
  price_tiers_games: '5:20,20:12,*:8',
  min_profit_products: '0.20', // ganancia mínima por pedido (USD)
  min_profit_games: '0.10',
  cop_rate: 'auto',            // pesos por 1 USD: 'auto' (tasa del día + margen), un número fijo, o 0 = no mostrar COP
  cop_spread: '3',             // % que se suma a la tasa automática (lo que te cuesta convertir COP → USDT)
  referral_percent: '5',   // % de cada compra que gana quien invitó al cliente
  min_recharge: '1',
  low_balance_alert: '10', // te avisa cuando tu saldo en KOKORO baje de esto
  maintenance: '0',
  welcome_text:
    '👋 ¡Hola {name}! Bienvenido a <b>{shop}</b>.\n\n' +
    'Aquí compras cuentas, licencias, recargas de juegos y gift cards con entrega automática al instante.\n\n' +
    'Usa el menú de abajo para empezar 👇',
  payment_instructions:
    '💳 <b>Métodos de pago</b> (sin comisión)\n\n' +
    '• Bre-B (llave): <code>@tu_llave</code>\n' +
    '• Nequi: <code>300 000 0000</code>\n' +
    '• Binance Pay ID: <code>000000000</code>\n\n' +
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
