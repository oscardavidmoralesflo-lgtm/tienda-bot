// Verificación de pagos recibidos en tu cuenta de Binance (llave de SOLO LECTURA).
// - Binance Pay: GET /sapi/v1/pay/transactions (amount positivo = ingreso)
// - Depósitos on-chain: GET /sapi/v1/capital/deposit/hisrec (status 1 = éxito)
import crypto from 'node:crypto';
import { config } from './config.js';
import { s } from './settings.js';

export const binanceEnabled = () => !!(config.binanceKey && config.binanceSecret) && s('binance_enabled') !== '0';
export const STABLES = ['USDT', 'USDC', 'FDUSD'];

async function signedGet(path, params = {}) {
  const qs = new URLSearchParams({ ...params, recvWindow: '10000', timestamp: String(Date.now()) }).toString();
  const signature = crypto.createHmac('sha256', config.binanceSecret).update(qs).digest('hex');
  let res;
  try {
    res = await fetch(`${config.binanceBase}${path}?${qs}&signature=${signature}`, {
      headers: { 'X-MBX-APIKEY': config.binanceKey },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new Error(`No se pudo conectar con Binance: ${e.message}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Binance: ${data.msg || data.message || `HTTP ${res.status}`}`);
  return data;
}

const DAYS = 7 * 24 * 3600_000;

export const binance = {
  // Pagos de Binance Pay de los últimos 7 días
  async payTransactions() {
    const d = await signedGet('/sapi/v1/pay/transactions', { startTime: String(Date.now() - DAYS), endTime: String(Date.now()), limit: '100' });
    return Array.isArray(d.data) ? d.data : [];
  },
  // Depósitos por blockchain de los últimos 7 días
  async deposits() {
    const d = await signedGet('/sapi/v1/capital/deposit/hisrec', { startTime: String(Date.now() - DAYS), endTime: String(Date.now()) });
    return Array.isArray(d) ? d : [];
  },
};

// Busca un pago por su ID (Order ID de Binance Pay o TxID de depósito).
// Devuelve { found, status: 'ok'|'pending'|'wrong_coin'|'not_incoming', amount, coin, kind, payer }
export async function findPayment(rawId) {
  const id = String(rawId || '').trim();
  if (!id) return { found: false };
  const pays = await binance.payTransactions();
  const p = pays.find((x) => String(x.transactionId) === id || String(x.orderId || '') === id);
  if (p) {
    const amount = Number(p.amount);
    if (!(amount > 0)) return { found: true, status: 'not_incoming' };
    const coin = String(p.currency || '').toUpperCase();
    if (!STABLES.includes(coin)) return { found: true, status: 'wrong_coin', coin, amount };
    return { found: true, status: 'ok', amount, coin, kind: 'pay', payer: p.payerInfo?.binanceId || p.payerInfo?.name || '' };
  }
  const deps = await binance.deposits();
  const d = deps.find((x) => String(x.txId || '').toLowerCase() === id.toLowerCase() || String(x.id) === id);
  if (d) {
    const coin = String(d.coin || '').toUpperCase();
    const amount = Number(d.amount);
    if (!STABLES.includes(coin)) return { found: true, status: 'wrong_coin', coin, amount };
    if (![1, 6].includes(Number(d.status))) return { found: true, status: 'pending', amount, coin };
    return { found: true, status: 'ok', amount, coin, kind: `deposit:${d.network || ''}`, payer: d.address || '' };
  }
  return { found: false };
}
