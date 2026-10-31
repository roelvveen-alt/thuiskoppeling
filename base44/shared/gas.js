/**
 * Gasmeterstanden die de eigenaar zelf invult (Instellingen › Gas;
 * 31-10-2026: "Gasverbruik (meterstand) invullen bij Instellingen"), voor een
 * huis waar de P1-meter het gas niet doorgeeft, of als controle. Bewaard op de
 * rij Opstelling van dat huis (gas_standen), alleen via de actie gasStand van de
 * functie huis (huizen.js): alleen de eigenaar, vers gelezen vlak voor het schrijven.
 *
 * Mild nagekeken: een echte datum (niet in de toekomst), een stand van 0 of meer
 * (hooguit drie decimalen, zoals de meter), en oplopend: een stand is niet lager
 * dan die van een eerdere datum en niet hoger dan die van een latere. Per datum
 * één stand (een nieuwe vervangt de oude). Hooguit HOOGSTENS_GAS_STANDEN; daarboven
 * valt de oudste weg.
 */
import { dagNummer, datumInNederland } from './dagen.js';

export const HOOGSTENS_GAS_STANDEN = 400;
/** Meer dan dit is geen gasmeter in een huis. */
const GROOTSTE_STAND = 100_000_000;

export class GasFout extends Error {}

const nl = (v) => v.toLocaleString('nl-NL', { maximumFractionDigits: 3 });
const DATUM = /^\d{4}-\d{2}-\d{2}$/;

/** De lijst uit de rij, schoon en op datum; wat niet klopt valt weg. */
export function gasStandenUit(lijst) {
  if (!Array.isArray(lijst)) return [];
  const perDatum = new Map();
  for (const s of lijst) {
    if (!s || typeof s !== 'object' || typeof s.datum !== 'string' || !DATUM.test(s.datum) || dagNummer(s.datum) === null) continue;
    if (typeof s.stand !== 'number' || !Number.isFinite(s.stand) || s.stand < 0 || s.stand > GROOTSTE_STAND) continue;
    perDatum.set(s.datum, { datum: s.datum, stand: Math.round(s.stand * 1000) / 1000 });
  }
  return [...perDatum.values()].sort((a, b) => (a.datum < b.datum ? -1 : 1)).slice(-HOOGSTENS_GAS_STANDEN);
}

/** Wat de eigenaar invulde: { datum, stand }, of een GasFout in gewone woorden. */
export function gasStandUit(ruw, nuMs) {
  if (!ruw || typeof ruw !== 'object') throw new GasFout('Vul een datum en een meterstand in.');
  const { datum, stand } = ruw;
  if (typeof datum !== 'string' || !DATUM.test(datum) || dagNummer(datum) === null) throw new GasFout('Deze datum klopt niet.');
  // Vandaag in Nederland mag (en een uur speling rond middernacht), morgen nog niet.
  if (datum > datumInNederland(nuMs + 3_600_000)) throw new GasFout('Een meterstand van later dan vandaag kan nog niet.');
  if (typeof stand !== 'number' || !Number.isFinite(stand) || stand < 0 || stand > GROOTSTE_STAND) throw new GasFout('Vul de meterstand in als getal in m³, bijvoorbeeld 2569,646.');
  return { datum, stand: Math.round(stand * 1000) / 1000 };
}

/** De lijst met deze stand erbij (een stand op dezelfde datum vervangt de oude); niet oplopend: GasFout. */
export function metGasStand(lijst, nieuw) {
  const anders = gasStandenUit(lijst).filter((s) => s.datum !== nieuw.datum);
  const eerder = anders.filter((s) => s.datum < nieuw.datum).at(-1);
  const later = anders.find((s) => s.datum > nieuw.datum);
  if (eerder && nieuw.stand < eerder.stand) {
    throw new GasFout(`Deze stand is lager dan die van ${eerder.datum} (${nl(eerder.stand)} m³). Een gasmeter telt alleen op.`);
  }
  if (later && nieuw.stand > later.stand) {
    throw new GasFout(`Deze stand is hoger dan die van ${later.datum} (${nl(later.stand)} m³). Een gasmeter telt alleen op.`);
  }
  return gasStandenUit([...anders, nieuw]);
}

/** De lijst zonder de stand van die datum. */
export function zonderGasStand(lijst, datum) {
  if (typeof datum !== 'string' || !DATUM.test(datum)) throw new GasFout('Deze datum klopt niet.');
  return gasStandenUit(lijst).filter((s) => s.datum !== datum);
}
