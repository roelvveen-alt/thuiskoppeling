import { useMemo } from 'react';
import { VOORBEELD } from '@/api/base44Client';
import { vraag } from '@/api/huis';
import { useHerhaald } from './herhaald';
import { STORINGEN } from './omvormer';
import { sindsWanneer } from './opmaak';

/**
 * Het logboek van storingen van een huis (kaart Logboek op Apparaten): wat er
 * mis was, wanneer het begon en hoe lang het duurde. ontvangMeting schrijft
 * het (base44/functions/ontvangMeting/logboek.js), de functie huis geeft de
 * laatste 50 (actie logboek). Hier de woorden.
 */

/** Zo vaak hooguit, en alleen met Apparaten open: storingen beginnen en eindigen niet elke paar seconden. */
export const LOGBOEK_ELKE_MS = 2 * 60_000;

/** Vaste spatie: getal en eenheid blijven bij elkaar. */
const SP = '\u00a0';

const msUit = (t) => {
  const ms = typeof t === 'string' ? Date.parse(t) : Number.NaN;
  return Number.isFinite(ms) ? ms : null;
};

/** Wat de functie gaf, schoon en nieuwste eerst. Een oudere functie kent de vraag niet: dan niets. */
export function gebeurtenissenUit(lijst) {
  return (Array.isArray(lijst) ? lijst : [])
    .filter((g) => g && typeof g === 'object' && msUit(g.begin) !== null)
    .map((g) => ({
      id: String(g.id ?? `${g.sleutel}-${g.begin}`),
      sleutel: typeof g.sleutel === 'string' ? g.sleutel : '',
      soort: typeof g.soort === 'string' ? g.soort : '',
      wat: typeof g.wat === 'string' ? g.wat : '',
      begin: msUit(g.begin),
      eind: msUit(g.eind),
      loopt: g.loopt === true,
    }))
    .sort((a, b) => b.begin - a.begin);
}

/** Wat er mis was, in gewone woorden. De omvormer met de naam van zijn storingsbit (src/lib/omvormer.js). */
export function watTekst(g) {
  const bit = /^omvormer:(\d+)$/.exec(g.sleutel)?.[1];
  if (bit !== undefined && STORINGEN[bit]) return `Omvormer: ${STORINGEN[bit]}`;
  if (g.soort === 'stil') return 'Geen cijfers van het programmaatje';
  return g.wat || 'Storing';
}

/** 45 min → "45 min", 125 min → "2 u 5 min", 50 uur → "2 dagen 2 u". */
export function duurTekst(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'minder dan een minuut';
  if (min < 60) return `${min}${SP}min`;
  const uur = Math.floor(min / 60);
  if (uur < 24) return min % 60 ? `${uur}${SP}u ${min % 60}${SP}min` : `${uur}${SP}u`;
  const dagen = Math.floor(uur / 24);
  const rest = uur % 24;
  return `${dagen === 1 ? '1 dag' : `${dagen} dagen`}${rest ? ` ${rest}${SP}u` : ''}`;
}

/** Hoe lang, of dat het nog loopt. Zonder einde en niet meer open: het einde is niet bekend. */
export function hoeLang(g, nu) {
  if (g.eind !== null) return duurTekst(g.eind - g.begin);
  if (g.loopt) return `loopt nog (al ${duurTekst(Math.max(0, nu - g.begin))})`;
  return 'einde onbekend';
}

/** "14:02", "gisteren 14:02" of "29-10 14:02". */
export const wanneer = (g, nu) => sindsWanneer(g.begin, nu);

/** Het voorbeeld: twee gebeurtenissen van vandaag, zodat je ziet hoe het eruitziet. */
export function voorbeeldLogboek(nu) {
  const uur = 3_600_000;
  return [
    { id: 'vb-2', sleutel: 'meter:hw-p1', soort: 'meter', wat: 'P1-meter antwoordt niet', begin: nu - 2 * uur, eind: nu - 2 * uur + 4 * 60_000, loopt: false },
    { id: 'vb-1', sleutel: 'stil', soort: 'stil', wat: 'Geen cijfers van het programmaatje', begin: nu - 7 * uur, eind: nu - 7 * uur + 23 * 60_000, loopt: false },
  ];
}

/**
 * Het logboek van dit huis, alleen zolang `actief` (Apparaten open), hooguit
 * eens per LOGBOEK_ELKE_MS.
 * @returns {{ gebeurtenissen: ReturnType<typeof gebeurtenissenUit>, status: string }}
 *   status: voorbeeld, laden, klaar, nietBijgewerkt (de functie kent het nog niet), geweigerd, fout
 */
export function useLogboek(huisId, actief, nu) {
  const uit = useHerhaald({
    werk: () => vraag('logboek', { huis_id: huisId }),
    sleutel: VOORBEELD || !huisId ? null : `logboek:${huisId}`,
    actief,
    elkeMs: LOGBOEK_ELKE_MS,
  });
  const gebeurtenissen = useMemo(() => gebeurtenissenUit(uit.data?.gebeurtenissen), [uit.data]);
  const opUur = Math.floor(nu / 3_600_000);
  const voorbeeld = useMemo(() => (VOORBEELD ? voorbeeldLogboek(opUur * 3_600_000) : null), [opUur]);
  if (voorbeeld) return { gebeurtenissen: voorbeeld, status: 'voorbeeld' };
  return { gebeurtenissen, status: uit.status };
}
