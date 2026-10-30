// Las claves se cifran en la tabla privada settings; nunca se devuelven al navegador.
import crypto from 'node:crypto';
import { config } from './config.js';
import { many, query } from './db.js';

export const PROVIDER_SPECS = {
  safwan: { name: 'SafwanTiger', base: 'https://safwantigershopbot-production.up.railway.app/api', env: 'SAFWAN_API_KEY', docs: 'https://web.telegram.org/a/#8443251417' },
  hmk: { name: 'HMK', base: 'https://api.hmk.digital/api/v1', env: 'HMK_API_KEY', docs: 'https://www.hmkstore.com/en/developers' },
  resellwithme: { name: 'ResellWithMe', base: 'https://resellwithme.com/api/v1', env: 'RESELLWITHME_API_KEY', docs: 'https://resellwithme.com/api/v1/doc?lang=en' },
  pai: { name: 'P-AI', base: 'https://p-ai.world/api/v1', env: 'PAI_API_KEY', docs: 'https://p-ai.world/developers' },
};
const saved = new Map();
function encryptionKey() {
  const secret = process.env.PROVIDER_ENCRYPTION_KEY || config.sessionSecret || config.adminPassword;
  if (!secret) throw new Error('Configura SESSION_SECRET antes de guardar claves de proveedores.');
  return crypto.createHash('sha256').update(secret).digest();
}
function encrypt(value, id) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  c.setAAD(Buffer.from(id));
  const data = Buffer.concat([c.update(value, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map(x => x.toString('base64')).join('.');
}
function decrypt(value, id) {
  const [iv, tag, data] = value.split('.').map(x => Buffer.from(x, 'base64'));
  const c = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  c.setAAD(Buffer.from(id)); c.setAuthTag(tag);
  return Buffer.concat([c.update(data), c.final()]).toString('utf8');
}
export async function loadProviderSettings() {
  saved.clear();
  for (const r of await many("SELECT key, value FROM settings WHERE key LIKE 'provider:%'")) {
    const id = r.key.slice(9);
    if (!Object.hasOwn(PROVIDER_SPECS,id)) continue;
    try { saved.set(id, JSON.parse(r.value)); } catch { /* conexión inválida: permanece apagada */ }
  }
}
export function providerConnection(id) {
  const spec = PROVIDER_SPECS[id];
  if (!Object.hasOwn(PROVIDER_SPECS,id)) throw new Error('Proveedor desconocido');
  const row = saved.get(id) || {};
  let key = process.env[spec.env] || '', keyError = false;
  if (!key && row.secret) {
    try { key = decrypt(row.secret, id); } catch { keyError = true; }
  }
  return { key, enabled: row.enabled === true && !!key, selected: row.selected || [], keyError };
}
export function publicProviderSettings(id) {
  const c = providerConnection(id);
  return { ...PROVIDER_SPECS[id], id, configured: !!c.key, enabled: c.enabled, selected: c.selected, keyError: c.keyError };
}
export async function saveProviderSettings(id, { key, enabled, selected, removeKey = false }) {
  if (!Object.hasOwn(PROVIDER_SPECS,id)) throw new Error('Proveedor desconocido');
  const old = saved.get(id) || {};
  const raw = String(key || '').trim();
  if (raw && (raw.length < 10 || raw.length > 1024 || /\s/.test(raw))) throw new Error('Clave de API inválida.');
  const ids = [...new Set((selected || []).map(String).map(x => x.trim()).filter(Boolean))];
  if (ids.length > 2000 || ids.some(x => x.length > 160 || /[\r\n\x00]/.test(x))) throw new Error('Lista de productos inválida.');
  const row = { enabled: !!enabled, selected: ids, secret: removeKey ? undefined : raw ? encrypt(raw, id) : old.secret };
  // Borrar una clave guardada no revoca una clave configurada en el entorno del servidor.
  if (removeKey) row.enabled = false;
  if (row.enabled && !row.secret && !process.env[PROVIDER_SPECS[id].env]) throw new Error('Guarda primero una clave de API.');
  await query('INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [`provider:${id}`, JSON.stringify(row)]);
  saved.set(id, row);
  return publicProviderSettings(id);
}
