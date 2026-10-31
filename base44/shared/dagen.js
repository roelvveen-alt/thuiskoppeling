/**
 * De dagen van een huis (tabel Dag, base44/entities/Dag.jsonc): datums in
 * Nederlandse tijd, en welke velden de site te zien krijgt. Gedeeld door
 * ontvangMeting (die de rij van vandaag schrijft, zie dagboek.js daar) en de
 * functie huis (actie periode, die ze leest).
 */

const dagNotatie = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' });

/** "2026-10-30" voor een moment (ms), in Nederlandse tijd. Zo rekent het programmaatje ook (brug/kosten.mjs). */
export const datumInNederland = (ms) => dagNotatie.format(new Date(ms));

const uurNotatie = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', hour: '2-digit', hourCycle: 'h23' });

/** Het uur van de klok in Nederland (0 tot 23) voor een moment (ms); ook op de dagen dat de klok verzet wordt. */
export const uurInNederland = (ms) => Number(uurNotatie.format(new Date(ms))) % 24;

const DATUM = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Het dagnummer (dagen sinds 1 januari 1970) van een echte datum als
 * "2026-10-30", of null: geen 30 februari, geen 2026-1-5, niets voor 2020 of na 2100.
 */
export function dagNummer(datum) {
  const deel = typeof datum === 'string' ? DATUM.exec(datum) : null;
  if (!deel) return null;
  const [jaar, maand, dag] = [Number(deel[1]), Number(deel[2]), Number(deel[3])];
  if (jaar < 2020 || jaar > 2100) return null;
  const ms = Date.UTC(jaar, maand - 1, dag);
  const terug = new Date(ms);
  if (terug.getUTCFullYear() !== jaar || terug.getUTCMonth() !== maand - 1 || terug.getUTCDate() !== dag) return null;
  return ms / 86_400_000;
}

/** Hooguit zoveel dagen in één periode: een jaar, met wat ruimte. */
export const HOOGSTENS_DAGEN = 400;

/** Wat de site van een dag te zien krijgt: niet bij welk huis, niet wie de rij maakte. */
export const DAG_VELDEN = Object.freeze([
  'datum',
  'zon_kwh',
  'huis_kwh',
  'geladen_kwh',
  'ontladen_kwh',
  'afname_kwh',
  'teruglevering_kwh',
  'kosten_eur',
  'opbrengst_eur',
  'vaste_kosten_eur',
  'zonnebonus_eur',
  'afname_prijs_kwh',
  'teruglevering_prijs_kwh',
  'compleet',
  'eigen_verbruik',
  'zelfvoorzienend',
  'fasen',
  'kwartieren',
  'huis_uur_wh',
  'zon_uur_wh',
  'straling_uur_wh_m2',
  'uur_kwartieren',
  'zonnen_uur_wh',
  'omvormer_kwh',
  'omvormer_totaal_kwh',
  'omvormer_bij',
  'apparaten_kwh',
  'basis_kwh',
  'gas_m3',
  'water_m3',
  'warmte_gj',
  'sinds',
  'bijgewerkt',
]);
