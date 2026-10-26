// Fidelización: niveles con "Ñapa" (cashback) y duración de suscripciones para recordar renovaciones.
import { s } from './settings.js';
import { categoryOf } from './categories.js';

const LEVELS = ['🥉 Bronce', '🥈 Plata', '🥇 Oro', '💎 Diamante', '👑 Leyenda'];

// "10:1,50:2,200:3" → [{ min: 10, pct: 1 }, …] (total comprado en USD → % de ñapa)
export function cashbackTiers() {
  return String(s('cashback_tiers') || '')
    .split(',')
    .map((t) => t.trim().split(':').map(Number))
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b))
    .map(([min, pct]) => ({ min, pct }))
    .sort((a, b) => a.min - b.min);
}

// Nivel según lo comprado: nombre, % de ñapa y cuánto falta para el siguiente
export function levelOf(totalUsd) {
  const tiers = cashbackTiers();
  let idx = 0;
  tiers.forEach((t, i) => { if (totalUsd >= t.min) idx = i + 1; });
  const next = tiers[idx];
  return {
    name: LEVELS[Math.min(idx, LEVELS.length - 1)],
    pct: idx > 0 ? tiers[idx - 1].pct : 0,
    next: next ? { name: LEVELS[Math.min(idx + 1, LEVELS.length - 1)], missing: next.min - totalUsd, pct: next.pct } : null,
  };
}

// Duración de una suscripción a partir del nombre ("18 Meses", "1M", "30D", "1 Year"…). null si no aplica.
const NO_RENEW = new Set(['api', 'mail', 'social']);
export function durationDays(name) {
  if (!name || NO_RENEW.has(categoryOf(name).key)) return null;
  const n = String(name).toLowerCase();
  if (/lifetime|de por vida|vitalicio/.test(n)) return null;
  const units = [
    [/(?<![a-z\d])(\d{1,3})\s*(meses|mes|months?|m)(?![a-z])/, 30],
    [/(?<![a-z\d])(\d{1,3})\s*(d[ií]as?|days?|d)(?![a-z])/, 1],
    [/(?<![a-z\d])(\d{1,2})\s*(años?|years?|y)(?![a-z])/, 365],
  ];
  let best = null;
  for (const [re, mult] of units) {
    const m = n.match(re);
    if (m && (best === null || m.index < best.index)) best = { index: m.index, days: Number(m[1]) * mult };
  }
  return best && best.days >= 3 && best.days <= 3 * 365 ? best.days : null;
}
