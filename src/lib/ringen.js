/**
 * Wat de rondjes op de foto naast het getal laten zien (wens van 30 oktober 2026):
 *
 * - het batterij-icoon met vier streepjes: hoe vol hij is (0, 25, 50, 75, 100%);
 * - een ring om de batterij: hoe hard hij nu laadt of levert, tegen zijn
 *   maximum (groen bij laden, oranje bij leveren, leeg als hij stilstaat);
 * - een ring om een plek met panelen: wat die nu levert, tegen zijn maximum.
 *   Zonder maximum (Instellingen › Namen) geen ring.
 *
 * Het maximum zit op het punt als `max_w` (zie puntenVoor in opstelling.js).
 */
import { vermogen } from './opmaak';
import { DREMPEL_W } from './stroom';

/** Hoeveel van de vier streepjes: 0% → 0, 25% → 1, 50% → 2, 75% → 3, 100% → 4; daartussen het dichtstbij. */
export function streepjesVoor(procent) {
  if (typeof procent !== 'number' || !Number.isFinite(procent)) return null;
  return Math.min(4, Math.max(0, Math.round(procent / 25)));
}

/**
 * De ring om een rondje, of null als het er geen heeft.
 *
 * @param {{ soort: string, max_w?: number|null }} punt
 * @param {number|null|undefined} w  wat het nu doet; bij de batterij plus = levert, min = laadt
 * @returns {{ deel: number, soort: 'laden' | 'leveren' | 'stil' | 'zon' } | null}  deel van 0 tot 1
 */
export function ringVoor(punt, w) {
  const max = punt?.max_w;
  if (!(typeof max === 'number' && max > 0)) return null;
  const bekend = typeof w === 'number' && Number.isFinite(w);
  if (punt.soort === 'batterij') {
    if (!bekend || Math.abs(w) < DREMPEL_W) return { deel: 0, soort: 'stil' };
    return { deel: Math.min(1, Math.abs(w) / max), soort: w < 0 ? 'laden' : 'leveren' };
  }
  if (punt.soort === 'zon') {
    return { deel: bekend && w >= DREMPEL_W ? Math.min(1, w / max) : 0, soort: 'zon' };
  }
  return null;
}

/** De ring in woorden, voor wie de foto niet ziet (achter de naam en het getal van het rondje). */
export function ringTekst(ring, max) {
  if (!ring) return '';
  if (ring.soort === 'stil') return 'staat stil';
  const deel = `${Math.round(ring.deel * 100)}% van ${vermogen(max)}`;
  if (ring.soort === 'laden') return `laadt op ${deel}`;
  if (ring.soort === 'leveren') return `levert op ${deel}`;
  return deel;
}
