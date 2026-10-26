import { many, query } from './db.js';

// Valores por defecto. Todo se puede cambiar desde el panel de admin (Ajustes).
export const DEFAULTS = {
  shop_name: 'Nova Plus',
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
  price_display: 'cop',        // 'cop' = el bot muestra y cobra en pesos redondos; 'usd' = en USDT
  payment_qr: '',              // file_id de Telegram del QR de cobro (se configura enviando la foto con /qr)
  // Fidelización
  cashback_tiers: '10:1,50:2,200:3', // "Ñapa": total comprado (USD) → % que se devuelve en saldo (Plata 1 %, Oro 2 %, Diamante 3 %)
  renew_reminder_days: '3',    // días antes del vencimiento para recordar la renovación (0 = desactivado)
  // Bono por recargas grandes (en pesos): "100000:3,200000:5" = +3 % desde $100.000, +5 % desde $200.000
  recharge_bonus: '100000:3,200000:5',
  // Recargas automáticas con Binance (USDT): el cliente paga y envía el Order ID / TxID
  binance_enabled: '1',
  binance_pay_id: '',      // tu Binance Pay ID (número)
  binance_trc20: '',       // tu dirección USDT TRC20 (opcional)
  binance_bep20: '',       // tu dirección USDT BEP20/BSC (opcional)
  // Recargas automáticas con Bold (PSE, Nequi, Botón Bancolombia)
  bold_enabled: '0', // las pasarelas colombianas no permiten este tipo de productos; se deja apagado
  bold_methods: 'PSE,NEQUI,BOTON_BANCOLOMBIA',
  bold_surcharge: '3.5', // % que paga el cliente por usar la pasarela (cubre la comisión de Bold). 0 = la asumes tú
  // Textos en inglés (clientes que eligen English)
  welcome_text_en:
    '<b>{shop}</b> — Premium access\n' +
    'Hi {name}, welcome.\n' +
    'Premium AI, streaming and software, with instant delivery and warranty.',
  payment_instructions_en:
    '💳 <b>Payment methods</b> (no fees)\n\n' +
    '• Bre-B (key): <code>@your_key</code>\n' +
    '• Nequi: <code>300 000 0000</code>\n' +
    '• Binance Pay ID: <code>000000000</code>\n\n' +
    'After paying, send the receipt screenshot here.',
  referral_percent: '5',   // % de cada compra que gana quien invitó al cliente
  min_recharge: '1',
  low_balance_alert: '10', // te avisa cuando tu saldo en KOKORO baje de esto
  maintenance: '0',
  welcome_text:
    '<b>{shop}</b> — Acceso premium\n' +
    'Hola {name}, bienvenido.\n' +
    'IA, streaming y software premium en pesos, con entrega inmediata y garantía.',
  channel_url: '', // enlace a tu canal de Telegram (https://t.me/...) para el botón 📢 Canal
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
