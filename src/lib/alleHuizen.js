import { useMemo } from 'react';
import { VOORBEELD } from '@/api/base44Client';
import { vraag } from '@/api/huis';
import { useHerhaald } from './herhaald';
import { NIETS_W } from './nuInWoorden';
import { procent, tijd, vermogen, versieKort } from './opmaak';
import { verdeelStroom } from './stroom';

/**
 * Het overzicht van alle huizen voor de beheerder (Instellingen › Account):
 * per omgeving de kern van nu, hoe oud de laatste meting is, de brugversie en
 * of er een storing open staat. Eén vraag voor alle huizen samen (actie
 * overzicht; de server weigert iedereen behalve de beheerder, toegang.js),
 * hooguit eens per 30 s en alleen met dat scherm open.
 */

export const OVERZICHT_ELKE_MS = 30_000;
/** Ouder dan dit, en de regel zegt in let-op dat er geen cijfers meer komen. */
export const STIL_NA_MS = 5 * 60_000;

const getal = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Het antwoord van de functie als Map huis-id → kern; zonder meting null. Een oudere functie: een lege Map. */
export function huizenUit(antwoord) {
  const uit = new Map();
  for (const h of Array.isArray(antwoord?.huizen) ? antwoord.huizen : []) {
    if (!h || typeof h.id !== 'string') continue;
    const m = h.meting;
    const moment = typeof m?.moment === 'string' ? Date.parse(m.moment) : Number.NaN;
    if (!m || !Number.isFinite(moment)) {
      uit.set(h.id, null);
      continue;
    }
    const stand = { zon_w: getal(m.zon_w), batterij_w: getal(m.batterij_w), net_w: getal(m.net_w), zonnen: [] };
    uit.set(h.id, {
      moment,
      zon_w: stand.zon_w,
      batterij_w: stand.batterij_w,
      batterij_procent: getal(m.batterij_procent),
      net_w: stand.net_w,
      // Hetzelfde getal als overal in de app (stroom.js); zonder netmeter weten we het niet.
      huis_w: stand.net_w === null ? null : verdeelStroom(stand).huis_w,
      brugVersie: typeof m.brug_versie === 'string' && m.brug_versie ? m.brug_versie : null,
      storingen: (Array.isArray(m.storingen) ? m.storingen : []).filter((s) => typeof s?.wat === 'string' && s.wat).map((s) => s.wat),
      // Wat elk apparaat teruggeeft (programmaatje 1.4.0); een oudere functie of brug: null.
      kennis: kennisUit(m.kennis),
    });
  }
  return uit;
}

/**
 * De kennislijst (programmaatje 1.4.0, alleen voor de beheerder): per apparaat
 * welke velden het teruggeeft, met een getal als dat niets herkenbaars is. Zo is
 * te zien wat er nog meer uit te halen is. Zonder: null.
 */
export function kennisUit(k) {
  if (!k || typeof k !== 'object' || !Array.isArray(k.apparaten)) return null;
  const apparaten = k.apparaten
    .filter((a) => a && typeof a.sleutel === 'string' && Array.isArray(a.velden))
    .map((a) => ({
      sleutel: a.sleutel,
      soort: typeof a.soort === 'string' && a.soort ? a.soort : a.sleutel,
      datum: typeof a.datum === 'string' ? a.datum : null,
      velden: a.velden.filter((v) => typeof v === 'string' && v),
    }))
    .filter((a) => a.velden.length);
  return apparaten.length ? { op: typeof k.op === 'string' ? Date.parse(k.op) : null, apparaten } : null;
}

/**
 * De regels onder de naam van een huis:
 *   kern     "Zon 1,1 kW · Batterij 57% · Net 49 W terug · Huis 458 W"
 *   staat    { tekst: "Bijgewerkt 18:02 · brug 0.6.1", letOp } of "Geen cijfers sinds 18:02" (let-op, ouder dan 5 min)
 *   storing  de open storing(en) in let-op, of null
 */
export function kernRegels(k, nu) {
  if (!k) return { kern: '', staat: { tekst: 'Nog geen cijfers van thuis', letOp: true }, storing: null };
  const net =
    // Binnen ±20 W geen richting (zoals de tegel Net), wel het getal.
    k.net_w === null ? null : Math.abs(k.net_w) < NIETS_W ? `Net ${vermogen(k.net_w)}` : `Net ${vermogen(k.net_w)} ${k.net_w > 0 ? 'uit' : 'terug'}`;
  const kern = [
    k.zon_w === null ? null : `Zon ${vermogen(k.zon_w)}`,
    k.batterij_procent === null ? null : `Batterij ${procent(k.batterij_procent)}`,
    net,
    k.huis_w === null ? null : `Huis ${vermogen(k.huis_w)}`,
  ]
    .filter(Boolean)
    .join(' · ');
  const stil = !(nu - k.moment < STIL_NA_MS);
  const brug = k.brugVersie ? ` · brug ${versieKort(k.brugVersie)}` : '';
  const staat = stil ? { tekst: `Geen cijfers sinds ${tijd(k.moment)}${brug}`, letOp: true } : { tekst: `Bijgewerkt ${tijd(k.moment)}${brug}`, letOp: false };
  const storing = k.storingen.length ? `${k.storingen[0]}${k.storingen.length > 1 ? ` (en nog ${k.storingen.length - 1})` : ''}` : null;
  return { kern, staat, storing };
}

/**
 * Alle huizen, alleen voor de beheerder en alleen zolang `actief`.
 * @returns {{ perHuis: Map<string, object|null>, status: string }}  status: uit, laden, klaar, geweigerd, nietBijgewerkt, fout
 */
export function useAlleHuizen(actief) {
  const aan = actief && !VOORBEELD;
  const uit = useHerhaald({ werk: () => vraag('overzicht'), sleutel: aan ? 'overzicht' : null, actief: aan, elkeMs: OVERZICHT_ELKE_MS });
  const perHuis = useMemo(() => huizenUit(uit.data), [uit.data]);
  return { perHuis, status: aan ? uit.status : 'uit' };
}
