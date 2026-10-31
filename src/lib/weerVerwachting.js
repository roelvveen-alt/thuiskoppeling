/**
 * Het weer van de rest van vandaag en van morgen per dagdeel, voor het
 * tabblad Voorspelling: per dagdeel een icoon en woorden (zon, wolken, regen
 * met kans en mm, onweer, windstoten, sneeuw, mist) en de temperatuur.
 *
 * Uit stand.weer (src/lib/bron.js weerUit): per uur straling, bewolking en
 * temperatuur (programmaatje 0.9.0) en sinds 0.10.0 ook de weercode, de
 * neerslag, de kans erop en de windstoten. De woorden en wat er valt komen
 * uit dezelfde vertaling als de tekening van het huis (WMO in
 * src/lib/weerBeeld.js), het icoon ook (weerIcoon). Een oudere brug: alleen
 * zon en wolken (uit de bewolking), en `uitgebreid` is onwaar.
 */

import { dagNaam } from './periode';
import { STOTEN_STEVIG_KMH, STOTEN_STORM_KMH, WMO, weerIcoon } from './weerBeeld';
import { zonnestand } from './zonnestand';

const UUR_MS = 3_600_000;

export const DAGDELEN = Object.freeze([
  { sleutel: 'nacht', naam: 'Nacht', van: 0, tot: 6 },
  { sleutel: 'ochtend', naam: 'Ochtend', van: 6, tot: 12 },
  { sleutel: 'middag', naam: 'Middag', van: 12, tot: 18 },
  { sleutel: 'avond', naam: 'Avond', van: 18, tot: 24 },
]);

/** Vanaf zoveel mm in een dagdeel noemen we het nat, ook als de code droog zegt (een bui). */
const NAT_MM = 0.3;
/** Vanaf zoveel procent kans noemen we de kans, ook zonder regen in de code. */
const KANS_NOEMEN = 30;

const getal = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const uurNotatie = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', hour: '2-digit', hourCycle: 'h23' });
const datumNotatie = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' });
const uurVan = (ms) => Number(uurNotatie.format(new Date(ms))) % 24;
const datumVan = (ms) => datumNotatie.format(new Date(ms));
const dagErbij = (datum, n) => {
  const [j, m, d] = datum.split('-').map(Number);
  return new Date(Date.UTC(j, m - 1, d + n)).toISOString().slice(0, 10);
};
const mm = (v) => `${String(Math.round(v * 10) / 10).replace('.', ',')}\u00a0mm`;
export const graden = (t) => `${String(Math.round(t)).replace('-', '−')}\u00a0°C`;

/** Hoe zwaar een weercode weegt in een dagdeel: onweer boven hagel, sneeuw, regen, motregen, mist, en dan wolken. */
function gewicht(code) {
  const w = WMO[code];
  if (!w) return -1;
  if (w.onweer) return 6;
  if (w.valt === 'hagel') return 5;
  if (w.valt === 'sneeuw') return 4;
  if (w.valt === 'regen') return w.zwaar ? 3.5 : 3;
  if (w.valt === 'motregen') return 2;
  if (w.mist) return 1;
  return 0;
}

/** Wolken (0 tot 3) uit de bewolking in procent, zoals de tekening. */
export const wolkenUit = (pct) => (pct < 20 ? 0 : pct < 50 ? 1 : pct < 85 ? 2 : 3);
const wolkWoord = (wolken, dag) => (wolken === 0 ? (dag ? 'zonnig' : 'helder') : wolken === 1 ? (dag ? 'zon en wat wolken' : 'vrijwel helder') : wolken === 2 ? (dag ? 'zon en wolken' : 'half bewolkt') : 'bewolkt');

/**
 * Eén dagdeel uit de uren erin (plekken in het bericht): wat er het meest
 * toe doet (onweer, sneeuw, regen …), anders hoe bewolkt, met de kans, de mm,
 * de windstoten en de temperatuur.
 */
function dagdeelVan(weer, plekken, plaats) {
  const waarden = (rij) => (rij ? plekken.map((i) => rij[i]).filter((v) => getal(v) !== null) : []);
  const temps = waarden(weer.temp);
  const bewolking = waarden(weer.bewolking);
  const neerslag = waarden(weer.neerslag);
  const kansen = waarden(weer.kans);
  const stoten = waarden(weer.stoten);
  const codes = waarden(weer.code);
  // Dag of nacht: is de zon in de meeste uren op?
  const dag = plekken.filter((i) => zonnestand(weer.van + (i + 0.5) * weer.stapMs, plaats).hoogte > 0).length * 2 > plekken.length;

  const gemBewolking = bewolking.length ? bewolking.reduce((a, b) => a + b, 0) / bewolking.length : null;
  const somMm = neerslag.length ? neerslag.reduce((a, b) => a + b, 0) : null;
  const kans = kansen.length ? Math.max(...kansen) : null;
  const stoot = stoten.length ? Math.max(...stoten) : null;
  const zwaarste = codes.length ? codes.reduce((b, c) => (gewicht(c) > gewicht(b) || (gewicht(c) === gewicht(b) && c > b) ? c : b)) : null;
  const soort = zwaarste !== null && gewicht(zwaarste) > 0 ? WMO[zwaarste] : null;

  let wolken = gemBewolking === null ? (soort?.wolken ?? 2) : wolkenUit(gemBewolking);
  let valt = soort?.valt ?? null;
  // Een bui die de code niet zegt, maar de mm wel.
  if (!valt && !soort?.mist && somMm !== null && somMm >= NAT_MM) valt = somMm >= 1 ? 'regen' : 'motregen';
  if (valt && wolken < 2) wolken = 2;
  const wind = stoot !== null && stoot >= STOTEN_STORM_KMH ? 'storm' : stoot !== null && stoot >= STOTEN_STEVIG_KMH ? 'stevig' : null;
  const tekst = soort ? soort.tekst : valt ? (valt === 'regen' ? 'buien' : 'af en toe motregen') : gemBewolking === null ? 'onbekend' : wolkWoord(wolken, dag);

  const details = [];
  if ((valt || (kans !== null && kans >= KANS_NOEMEN)) && kans !== null) details.push(`${kans}% kans`);
  if (somMm !== null && somMm >= 0.1) details.push(mm(somMm));
  if (wind === 'storm') details.push(`zware windstoten tot ${Math.round(stoot)} km/h`);
  else if (wind === 'stevig') details.push(`windstoten tot ${Math.round(stoot)} km/h`);

  const beeld = { onweer: Boolean(soort?.onweer), valt, mist: Boolean(soort?.mist), wind, wolken };
  return {
    icoon: weerIcoon(beeld, dag),
    tekst,
    details,
    dag,
    wolken,
    valt,
    onweer: beeld.onweer,
    mist: beeld.mist,
    wind,
    kans,
    mm: somMm,
    stoten: stoot,
    tempMin: temps.length ? Math.min(...temps) : null,
    tempMax: temps.length ? Math.max(...temps) : null,
  };
}

/**
 * Het weer van de rest van vandaag en van morgen per dagdeel, of null zonder
 * weerbericht.
 *
 * @param {object|null} weer  stand.weer (src/lib/bron.js weerUit)
 * @param {number} nu  ms
 * @param {{ breedte: number, lengte: number }} plaats  (plaatsUitZon in src/lib/zonnestand.js)
 * @returns {null | { uitgebreid: boolean, dagen: Array<{ datum: string, naam: string, titel: string, delen: Array<object>,
 *   tempMin: number|null, tempMax: number|null, mm: number|null, droog: boolean|null }> }}
 */
export function weerPerDagdeel(weer, nu, plaats) {
  if (!weer || !Number.isFinite(weer.van)) return null;
  const lengte = (weer.straling ?? weer.bewolking ?? []).length;
  if (!lengte) return null;
  const vandaag = datumVan(nu);
  const morgen = dagErbij(vandaag, 1);
  const uurNu = Math.floor(nu / UUR_MS) * UUR_MS;
  const dagen = [];
  for (const [datum, naam] of [
    [vandaag, 'Vandaag'],
    [morgen, 'Morgen'],
  ]) {
    const plekken = [];
    for (let i = 0; i < lengte; i++) {
      const t = weer.van + i * weer.stapMs;
      if (datumVan(t) === datum && (datum !== vandaag || t >= uurNu)) plekken.push(i);
    }
    if (!plekken.length) continue;
    const delen = DAGDELEN.map((d) => {
      const erin = plekken.filter((i) => {
        const h = uurVan(weer.van + i * weer.stapMs);
        return h >= d.van && h < d.tot;
      });
      // Een dagdeel van vandaag waar nog maar een uur van over is, of dat het bericht maar half dekt: weg.
      if (erin.length < (datum === vandaag ? 2 : 4)) return null;
      return { ...d, uren: erin.length, ...dagdeelVan(weer, erin, plaats) };
    }).filter(Boolean);
    if (!delen.length) continue;
    const temps = plekken.map((i) => weer.temp?.[i]).filter((v) => getal(v) !== null);
    const mms = weer.neerslag ? plekken.map((i) => weer.neerslag[i]) : null;
    const totaalMm = mms ? mms.reduce((a, b) => a + b, 0) : null;
    dagen.push({
      datum,
      naam,
      titel: `${naam}, ${dagNaam(datum)}`,
      delen,
      tempMin: temps.length ? Math.min(...temps) : null,
      tempMax: temps.length ? Math.max(...temps) : null,
      mm: totaalMm,
      droog: totaalMm === null ? null : totaalMm < 0.1,
    });
  }
  return dagen.length ? { uitgebreid: Boolean(weer.code), dagen } : null;
}

/**
 * Eén zin over een dag: "Morgen: 4 tot 11 °C, droog, windstoten tot 64 km/h (avond)."
 * Met `kaal`: zonder de naam en de temperatuur (die staan er dan al boven): "Droog, windstoten …".
 */
export function dagZin(dag, { kaal = false } = {}) {
  const delen = [];
  if (!kaal && dag.tempMin !== null && dag.tempMax !== null) delen.push(Math.round(dag.tempMin) === Math.round(dag.tempMax) ? graden(dag.tempMax) : `${graden(dag.tempMin).replace('\u00a0°C', '')} tot ${graden(dag.tempMax)}`);
  if (dag.droog === true) delen.push('droog');
  else if (dag.mm !== null) delen.push(`${mm(dag.mm)} regen`);
  const stormig = dag.delen.find((d) => d.wind === 'storm') ?? dag.delen.find((d) => d.wind === 'stevig');
  if (stormig) delen.push(`${stormig.wind === 'storm' ? 'zware windstoten' : 'windstoten'} tot ${Math.round(stormig.stoten)} km/h (${stormig.naam.toLowerCase()})`);
  const onweer = dag.delen.find((d) => d.onweer);
  if (onweer) delen.push(`kans op onweer (${onweer.naam.toLowerCase()})`);
  if (kaal) return delen.length ? `${delen.join(', ').replace(/^./, (c) => c.toUpperCase())}.` : '';
  return `${dag.naam}: ${delen.join(', ')}.`;
}
