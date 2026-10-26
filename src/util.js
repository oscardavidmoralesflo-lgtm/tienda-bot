// Escapa texto para el modo HTML de Telegram y para el panel web
export const esc = (v) =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Convierte las descripciones HTML de KOKORO a las etiquetas que Telegram acepta
export function tgHtml(html, max = 2500) {
  if (!html) return '';
  let t = String(html)
    .replace(/\r/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|ul|ol)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<(strong|h[1-6])(\s[^>]*)?>/gi, '<b>')
    .replace(/<\/strong>/gi, '</b>')
    .replace(/<em(\s[^>]*)?>/gi, '<i>')
    .replace(/<\/em>/gi, '</i>');
  // quita cualquier etiqueta que Telegram no soporte
  t = t.replace(/<\/?([a-z0-9-]+)(\s[^>]*)?>/gi, (m, tag) => {
    tag = tag.toLowerCase();
    if (['b', 'i', 'u', 's', 'code', 'pre', 'blockquote'].includes(tag)) return m.startsWith('</') ? `</${tag}>` : `<${tag}>`;
    if (tag === 'a') {
      if (m.startsWith('</')) return '</a>';
      const href = m.match(/href\s*=\s*["']([^"']+)["']/i);
      return href && /^https?:\/\//.test(href[1]) ? `<a href="${esc(href[1])}">` : '<a>';
    }
    return '';
  });
  t = t.replace(/<a>([\s\S]*?)<\/a>/g, '$1').replace(/<\/blockquote>\s*\n+/g, '</blockquote>\n').replace(/\n{3,}/g, '\n\n').trim();
  if (t.length > max) t = stripTags(t).slice(0, max) + '…';
  return t;
}
export const stripTags = (h) => String(h || '').replace(/<[^>]+>/g, '');

const ERRORS = {
  out_of_stock: 'No hay stock suficiente en este momento.',
  price_changed: 'El precio cambió. Vuelve a abrir el producto para ver el precio nuevo.',
  player_not_found: 'No encontramos esa cuenta de jugador. Revisa el ID.',
  region_mismatch: 'La región de la cuenta no coincide con la del paquete. Elige un paquete de tu región.',
  missing_field: 'Falta un dato obligatorio.',
  invalid_field: 'Uno de los datos no es válido. Revísalo.',
  missing_country: 'Falta el país de activación.',
  ambiguous_country: 'El país no es claro. Escribe el nombre completo o el código de 2 letras (ej: MX).',
  invalid_country: 'País no válido.',
  key_not_available_in_country: 'Esta key no se puede activar en ese país.',
  quantity_not_allowed: 'Este producto solo se compra de 1 en 1.',
  product_not_found: 'El producto ya no está disponible.',
  games_unavailable: 'Las recargas no están disponibles en este momento. Inténtalo en un minuto.',
  fields_unavailable: 'Servicio temporalmente no disponible. Inténtalo en un minuto.',
  keys_loading: 'El catálogo de keys se está cargando. Inténtalo en un minuto.',
  in_progress: 'Ya hay un pedido igual en proceso.',
  code_rejected: 'El código no es correcto. Revisa el correo y vuelve a escribirlo.',
  invalid_code: 'El código no es válido (3 a 20 letras o números, sin espacios).',
  not_awaiting_code: 'Este pedido ya no está esperando un código.',
};
export function errorEs(e) {
  if (e?.code && ERRORS[e.code]) return ERRORS[e.code];
  if (e?.status === 409) return ERRORS.out_of_stock;
  return e?.message || 'Error desconocido';
}

// IDs cortos para botones (Telegram limita callback_data a 64 bytes)
const refs = new Map();
const back = new Map();
let counter = 0;
export function ref(id) {
  id = String(id);
  if (id.length <= 24 && !id.startsWith('~')) return id;
  if (back.has(id)) return back.get(id);
  const k = `~${(counter++).toString(36)}`;
  refs.set(k, id);
  back.set(id, k);
  return k;
}
export const deref = (k) => (k?.startsWith('~') ? refs.get(k) : k);

export const fmtDate = (d) => (d ? new Date(d).toISOString().replace('T', ' ').slice(0, 16) : '');

export const STATUS_ES = {
  pending: '⏳ Procesando',
  processing: '⏳ Procesando',
  action_required: '📧 Esperando código',
  delivered: '✅ Entregado',
  refunded: '↩️ Reembolsado',
  failed: '❌ Fallido',
};
