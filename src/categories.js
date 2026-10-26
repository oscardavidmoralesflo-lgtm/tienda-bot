// Categorías de la tienda. Cada producto cae en la PRIMERA categoría cuyo patrón coincide con su nombre.
// El orden importa (ej: "Coursera + Gemini" va a Educación antes que a IA).
export const CATEGORIES = [
  { key: 'api', icon: '🔌', label: 'APIs de IA', re: /\bapi\b/i },
  { key: 'social', icon: '📈', label: 'Redes sociales', re: /likes|views|groups telegram|facebook|sms panel/i },
  { key: 'mail', icon: '📧', label: 'Correos y cuentas', re: /hotmail|outlook|gmail|mail accounts|github accounts?\b(?! pro)|chatgpt free account/i },
  { key: 'vpn', icon: '🔒', label: 'VPN y antivirus', re: /vpn|proton|mcafee|eset|antivirus|surfshark/i },
  { key: 'edu', icon: '🎓', label: 'Educación', re: /duolingo|coursera|linkedin|udemy|quillbot|grammarly|jetbrain/i },
  { key: 'stream', icon: '🎬', label: 'Streaming y música', re: /netflix|disney|prime video|amazon prime|max plan|crunchyroll|youtube|spotify|apple music|apple tv|tv360|hulu|discord|brain/i },
  { key: 'design', icon: '🎨', label: 'Diseño y edición', re: /canva|capcut|adobe|figma|photoshop|corel|autodesk|alight|framer|descript|meitu|magic patterns|mobbin|miro/i },
  { key: 'dev', icon: '💻', label: 'Desarrollo y no-code', re: /bolt|lovable|cursor|railway|posthog|n8n|warp|github/i },
  { key: 'office', icon: '💼', label: 'Office y productividad', re: /office|microsoft|windows|notion|zoom|ilove ?pdf|readwise|granola|wispr|wisper/i },
  { key: 'ai', icon: '🤖', label: 'Inteligencia Artificial', re: /chatgpt|gemini|claude|grok|perplexity|muse|manus|eleven|kling|heygen|leonardo|higgsfield|veo|pangram|brain\.fm|codex|deepseek/i },
  { key: 'other', icon: '✨', label: 'Otros', re: /.*/ },
];

export const CAT_BY_KEY = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));

// Orden en que se muestran en la tienda (lo más vendido primero)
export const DISPLAY_ORDER = ['ai', 'stream', 'design', 'office', 'edu', 'vpn', 'api', 'dev', 'mail', 'social', 'other']
  .map((k) => CAT_BY_KEY[k]);

const memo = new Map();
export function categoryOf(name) {
  if (memo.has(name)) return memo.get(name);
  const c = CATEGORIES.find((x) => x.re.test(name)) || CAT_BY_KEY.other;
  memo.set(name, c);
  return c;
}

// Íconos por producto para que la lista se vea como en las tiendas grandes
const ICONS = [
  [/chatgpt|codex/i, '🟢'], [/gemini/i, '✨'], [/claude/i, '🟠'], [/grok/i, '⚫'], [/deepseek|qwen/i, '🐳'],
  [/netflix/i, '🔴'], [/disney/i, '🏰'], [/prime/i, '📦'], [/youtube/i, '▶️'], [/spotify/i, '🎧'],
  [/apple/i, '🍎'], [/crunchyroll/i, '🍥'], [/max plan/i, '🎞'], [/canva/i, '🎨'], [/capcut/i, '✂️'],
  [/adobe|photoshop/i, '🅰️'], [/figma/i, '🖌'], [/office|microsoft/i, '📊'], [/windows/i, '🪟'],
  [/notion/i, '📓'], [/zoom/i, '📹'], [/duolingo/i, '🦉'], [/coursera|udemy/i, '🎓'], [/linkedin/i, '💼'],
  [/vpn|proton/i, '🛡'], [/hotmail|outlook|gmail|mail/i, '📧'], [/eleven/i, '🎙'], [/kling|veo|heygen|leonardo|higgsfield/i, '🎬'],
  [/likes/i, '❤️'], [/views/i, '👁'], [/discord/i, '🎮'], [/github/i, '🐙'],
];
export function iconOf(name) {
  return ICONS.find(([re]) => re.test(name))?.[1] || '🔹';
}
