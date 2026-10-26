// Cliente de Bold (Colombia) para recargas automáticas con links de pago.
// Docs: https://developers.bold.co/pagos-en-linea/api-link-de-pagos y https://developers.bold.co/webhook
import crypto from 'node:crypto';
import { config } from './config.js';
import { s } from './settings.js';

export const boldEnabled = () => !!(config.boldApiKey && config.boldSecretKey) && s('bold_enabled') !== '0';

async function call(method, path, body) {
  let res;
  try {
    res = await fetch(`${config.boldBase}${path}`, {
      method,
      headers: { Authorization: `x-api-key ${config.boldApiKey}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new Error(`No se pudo conectar con Bold: ${e.message}`);
  }
  let data = {};
  try {
    data = await res.json();
  } catch { /* sin cuerpo */ }
  const errors = Array.isArray(data.errors) ? data.errors : [];
  if (!res.ok || errors.length) {
    const msg = errors.map((e) => e.message || e.detail || JSON.stringify(e)).join('; ') || data.message || `HTTP ${res.status}`;
    throw new Error(`Bold: ${msg}`);
  }
  return data;
}

const methods = () => String(s('bold_methods') || 'PSE,NEQUI,BOTON_BANCOLOMBIA')
  .split(',').map((m) => m.trim().toUpperCase()).filter(Boolean);

export const bold = {
  // Crea un link de pago por un monto fijo en pesos. Devuelve { id: 'LNK_…', url }
  async createLink({ pesos, reference, description }) {
    const body = {
      amount_type: 'CLOSE',
      amount: { currency: 'COP', total_amount: Math.round(pesos), tip_amount: 0, taxes: [] },
      reference: String(reference).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60),
      description: String(description).slice(0, 100),
      payment_methods: methods(),
    };
    if (config.publicUrl) body.callback_url = `${config.publicUrl}/pago/listo`;
    const d = await call('POST', '/online/link/v1', body);
    return { id: d.payload?.payment_link, url: d.payload?.url };
  },
  // Estado del link: ACTIVE, PROCESSING, PAID, REJECTED, CANCELLED, EXPIRED
  getLink: (id) => call('GET', `/online/link/v1/${encodeURIComponent(id)}`),
  paymentMethods: () => call('GET', '/online/link/v1/payment_methods'),
};

// Firma del webhook: HMAC-SHA256(llave secreta, base64(cuerpo crudo)) en hex, en la cabecera x-bold-signature
export function verifyBoldSignature(rawBody, signature) {
  if (!signature || !config.boldSecretKey) return false;
  const encoded = Buffer.from(rawBody, 'utf8').toString('base64');
  const expected = crypto.createHmac('sha256', config.boldSecretKey).update(encoded).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
