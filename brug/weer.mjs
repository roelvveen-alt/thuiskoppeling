import { datumInNederland, morgenVan } from './kosten.mjs';
import { inGewoneWoorden, vraagJson } from './web.mjs';
import { STANDAARD_PLAATS } from './zon.mjs';

/**
 * Het weerbericht voor Advies (sinds 0.9.0) en het tabblad Voorspelling
 * (sinds 0.10.0): per uur de zonnestraling, de bewolking en de temperatuur van
 * vandaag en morgen, en sinds 0.10.0 ook de weercode, de neerslag, de kans op
 * neerslag en de windstoten, bij Open-Meteo (gratis, geen sleutel, geen account):
 *
 *   GET https://api.open-meteo.com/v1/forecast?latitude=52.10&longitude=5.18
 *       &hourly=shortwave_radiation,cloud_cover,temperature_2m,weather_code,precipitation,precipitation_probability,wind_gusts_10m
 *       &current=weather_code,precipitation,wind_speed_10m,wind_gusts_10m,cloud_cover,is_day
 *       &timezone=Europe%2FAmsterdam&forecast_days=2
 *   → { utc_offset_seconds: 3600,
 *       current: { weather_code: 61, precipitation: 0.4, wind_speed_10m: 22.3, wind_gusts_10m: 41.0, cloud_cover: 100, is_day: 1 },
 *       current_units: { precipitation: 'mm', wind_speed_10m: 'km/h', wind_gusts_10m: 'km/h', cloud_cover: '%' },
 *       hourly_units: { shortwave_radiation: 'W/m²', cloud_cover: '%', temperature_2m: '°C', weather_code: 'wmo code',
 *                       precipitation: 'mm', precipitation_probability: '%', wind_gusts_10m: 'km/h' },
 *       hourly: { time: ['2026-10-30T00:00', …] (lokale tijd, zonder zone),
 *                 shortwave_radiation: [W/m², …], cloud_cover: [%, …], temperature_2m: [°C, …], weather_code: [61, …],
 *                 precipitation: [mm, …], precipitation_probability: [%, …], wind_gusts_10m: [km/h, …] } }
 *
 * De straling is bij Open-Meteo het gemiddelde over het uur ervóór ("preceding
 * hour mean"): de waarde bij 10:00 hoort bij 09:00–10:00. Zo ook de neerslag
 * (de som van het uur ervóór), de kans daarop (meer dan 0,1 mm in het uur
 * ervóór) en de windstoten (de hoogste van het uur ervóór). Wij zetten alles op
 * het begin van het uur: plek i in het blok is het uur [van + i uur, van + i + 1
 * uur), met de straling, neerslag en stoten van dat uur en de bewolking,
 * temperatuur en weercode aan het eind ervan (zo geeft Open-Meteo die). `van`
 * is dus een uur vóór de eerste tijd van Open-Meteo: 23:00 gisteren, en het
 * blok loopt tot 23:00 morgen.
 *
 * `current` is het weer van nu (sinds 0.9.0 ook op de tekening van het huis,
 * src/lib/weerBeeld.js): de WMO-weercode, neerslag, wind en windstoten op
 * 10 m, en de bewolking. is_day vragen we mee, maar dag en nacht op de tekening
 * komen uit zon op en onder (zon.mjs), zodat ze overal hetzelfde omslaan.
 *
 * Alleen lezen; de plaats gaat afgerond op twee decimalen (ongeveer een
 * kilometer) naar Open-Meteo, verder niets.
 */

const UUR_MS = 3_600_000;
/** Zoveel uren gaan mee: vandaag en morgen. */
export const WEER_UREN = 48;
/** Gelukt: het volgende uur niet opnieuw. Mislukt: over een kwartier nog eens (Open-Meteo is gratis en ruim). */
export const WEER_ELKE_MS = 60 * 60_000;
const WEER_OPNIEUW_MS = 15 * 60_000;
/** Lukt ophalen niet, dan houden we het laatste goede bericht zo lang; daarna geen weer (en Advies rekent zoals vroeger). */
export const WEER_HOUDBAAR_MS = 3 * 60 * 60_000;
/** Harde eindtijd voor één vraag aan Open-Meteo. */
const WEER_TIJD_MS = 15_000;

/** Per reeks: het veld bij Open-Meteo, de eenheid, de grenzen en op hoeveel decimalen. */
const REEKSEN = {
  straling_wm2: { veld: 'shortwave_radiation', eenheid: 'W/m²', min: 0, max: 1500, decimalen: 0 },
  bewolking_pct: { veld: 'cloud_cover', eenheid: '%', min: 0, max: 100, decimalen: 0 },
  temp_c: { veld: 'temperature_2m', eenheid: '°C', min: -60, max: 60, decimalen: 1 },
  // Sinds 0.10.0, voor het tabblad Voorspelling: de weercode (WMO, een heel getal), neerslag, kans en stoten.
  weercode: { veld: 'weather_code', eenheid: 'wmo code', min: 0, max: 99, decimalen: 0, heel: true },
  neerslag_mm: { veld: 'precipitation', eenheid: 'mm', min: 0, max: 500, decimalen: 1 },
  neerslag_kans_pct: { veld: 'precipitation_probability', eenheid: '%', min: 0, max: 100, decimalen: 0 },
  windstoten_kmh: { veld: 'wind_gusts_10m', eenheid: 'km/h', min: 0, max: 500, decimalen: 0 },
};

const uurNotatie = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', hour: '2-digit', hourCycle: 'h23' });
const uurInNederland = (ms) => Number(uurNotatie.format(new Date(ms))) % 24;
const afgerond = (v, decimalen) => Math.round(v * 10 ** decimalen) / 10 ** decimalen;

/** Het adres bij Open-Meteo voor een plaats uit de instellingen ({ breedte, lengte }); zonder plaats De Bilt. */
export function weerAdres(plaats) {
  const breedte = (plaats?.breedte ?? STANDAARD_PLAATS.breedte).toFixed(2);
  const lengte = (plaats?.lengte ?? STANDAARD_PLAATS.lengte).toFixed(2);
  return (
    `https://api.open-meteo.com/v1/forecast?latitude=${breedte}&longitude=${lengte}` +
    '&hourly=shortwave_radiation,cloud_cover,temperature_2m,weather_code,precipitation,precipitation_probability,wind_gusts_10m' +
    '&current=weather_code,precipitation,wind_speed_10m,wind_gusts_10m,cloud_cover,is_day' +
    '&timezone=Europe%2FAmsterdam&forecast_days=2'
  );
}

const LOKALE_TIJD = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** "2026-10-30T10:00" (lokale tijd) met de afwijking van UTC → ms (UTC), of null. */
function echteTijd(tekst, offsetS) {
  const m = typeof tekst === 'string' ? LOKALE_TIJD.exec(tekst) : null;
  if (!m) return null;
  const [j, mnd, d, u, min] = m.slice(1).map(Number);
  const ms = Date.UTC(j, mnd - 1, d, u, min);
  const terug = new Date(ms);
  if (terug.getUTCMonth() !== mnd - 1 || terug.getUTCDate() !== d || u > 23 || min > 59) return null;
  return ms - offsetS * 1000;
}

/**
 * Het antwoord van Open-Meteo, streng op vorm en verdraagzaam op inhoud:
 *
 * - Geen `hourly.time`, geen geldige `utc_offset_seconds`, of geen enkele
 *   bruikbare tijd: een fout (dan klopt het hele antwoord niet).
 * - De tijden moeten per uur oplopen; bij de eerste die dat niet doet houdt
 *   het op (er staat nooit een gat in). Hooguit WEER_UREN uur.
 * - Een reeks die ontbreekt, een andere eenheid heeft, niet even lang is als
 *   de tijden, of een waarde mist of buiten de grenzen heeft: null (die reeks
 *   is er dan niet, de rest wel). Een weercode moet een heel getal zijn; een
 *   code die wij (nog) niet kennen mag, die vertaalt de site als bewolking.
 *   Open-Meteo geeft de kans op neerslag soms niet voor elk uur (null): dan is
 *   die reeks er niet.
 * - Geen straling en geen bewolking over: een fout (zonder die twee zegt het
 *   bericht niets over de zon).
 *
 * @returns {{ van: number, stap_min: 60, straling_wm2: number[]|null, bewolking_pct: number[]|null, temp_c: number[]|null,
 *   weercode: number[]|null, neerslag_mm: number[]|null, neerslag_kans_pct: number[]|null, windstoten_kmh: number[]|null }}
 */
export function weerUitOpenMeteo(json) {
  const uurlijks = json?.hourly;
  if (!uurlijks || typeof uurlijks !== 'object' || !Array.isArray(uurlijks.time)) throw new Error('onverwacht antwoord van Open-Meteo');
  const offset = json.utc_offset_seconds;
  if (!Number.isInteger(offset) || Math.abs(offset) > 18 * 3600) throw new Error('Open-Meteo gaf geen tijdzone mee');
  const tijden = [];
  for (const tekst of uurlijks.time) {
    const ms = echteTijd(tekst, offset);
    if (ms === null || (tijden.length && ms !== tijden.at(-1) + UUR_MS)) break;
    tijden.push(ms);
    if (tijden.length >= WEER_UREN) break;
  }
  if (!tijden.length) throw new Error('Open-Meteo gaf geen tijden');
  const eenheden = json.hourly_units && typeof json.hourly_units === 'object' ? json.hourly_units : {};
  const uit = { van: tijden[0] - UUR_MS, stap_min: 60 };
  for (const [naam, r] of Object.entries(REEKSEN)) {
    const rij = uurlijks[r.veld];
    const eenheid = eenheden[r.veld];
    const goed =
      Array.isArray(rij) &&
      rij.length === uurlijks.time.length &&
      (eenheid === undefined || eenheid === r.eenheid) &&
      rij.slice(0, tijden.length).every((v) => typeof v === 'number' && Number.isFinite(v) && v >= r.min && v <= r.max && (!r.heel || Number.isInteger(v)));
    uit[naam] = goed ? rij.slice(0, tijden.length).map((v) => afgerond(v, r.decimalen)) : null;
  }
  if (!uit.straling_wm2 && !uit.bewolking_pct) throw new Error('Open-Meteo gaf geen straling en geen bewolking');
  const nu = nuUitOpenMeteo(json.current, json.current_units);
  if (nu) uit.nu = nu;
  return uit;
}

/** Het weer van nu: per veld bij Open-Meteo, de eenheid en de grenzen. */
const NU_VELDEN = {
  neerslag_mm: { veld: 'precipitation', eenheid: 'mm', min: 0, max: 500, decimalen: 1 },
  wind_kmh: { veld: 'wind_speed_10m', eenheid: 'km/h', min: 0, max: 400, decimalen: 0 },
  windstoten_kmh: { veld: 'wind_gusts_10m', eenheid: 'km/h', min: 0, max: 500, decimalen: 0 },
  bewolking_pct: { veld: 'cloud_cover', eenheid: '%', min: 0, max: 100, decimalen: 0 },
};

/**
 * De weercodes (WMO 4677) die Open-Meteo geeft, in woorden voor proef. De
 * site heeft dezelfde woorden (WMO in src/lib/weerBeeld.js, met wat er
 * getekend wordt); base44/tests/weer.test.js houdt ze gelijk.
 */
export const WEER_WOORDEN = {
  0: 'onbewolkt',
  1: 'vrijwel onbewolkt',
  2: 'half bewolkt',
  3: 'bewolkt',
  45: 'mist',
  48: 'mist met rijp',
  51: 'lichte motregen',
  53: 'motregen',
  55: 'dichte motregen',
  56: 'lichte ijzel',
  57: 'ijzel',
  61: 'lichte regen',
  63: 'regen',
  65: 'zware regen',
  66: 'lichte ijzel',
  67: 'zware ijzel',
  71: 'lichte sneeuw',
  73: 'sneeuw',
  75: 'zware sneeuw',
  77: 'korrelsneeuw',
  80: 'lichte regenbuien',
  81: 'regenbuien',
  82: 'hevige regenbuien',
  85: 'sneeuwbuien',
  86: 'zware sneeuwbuien',
  95: 'onweer',
  96: 'onweer met hagel',
  99: 'zwaar onweer met hagel',
};

/**
 * Het weer van nu uit `current`, verdraagzaam: een veld dat ontbreekt, een
 * andere eenheid heeft of buiten de grenzen valt, is er niet; een onbekende
 * weercode ook niet. Niets over: null (dan alleen de uren).
 */
export function nuUitOpenMeteo(nu, eenheden) {
  if (!nu || typeof nu !== 'object' || Array.isArray(nu)) return null;
  const units = eenheden && typeof eenheden === 'object' ? eenheden : {};
  const uit = {};
  if (Number.isInteger(nu.weather_code) && WEER_WOORDEN[nu.weather_code]) uit.code = nu.weather_code;
  for (const [naam, r] of Object.entries(NU_VELDEN)) {
    const v = nu[r.veld];
    const eenheid = units[r.veld];
    if (typeof v === 'number' && Number.isFinite(v) && v >= r.min && v <= r.max && (eenheid === undefined || eenheid === r.eenheid)) uit[naam] = afgerond(v, r.decimalen);
  }
  return Object.keys(uit).length ? uit : null;
}

/**
 * Het blok `weer` voor de app (Meting.weer, zie base44/entities/Meting.jsonc):
 * alleen de reeksen die er zijn, met wanneer het is opgehaald.
 */
export function weerVoorApp(weer, opgehaald) {
  if (!weer) return null;
  return {
    van: new Date(weer.van).toISOString(),
    stap_min: 60,
    ...Object.fromEntries(Object.keys(REEKSEN).filter((naam) => weer[naam]).map((naam) => [naam, weer[naam]])),
    ...(weer.nu ? { nu: weer.nu } : {}),
    opgehaald: new Date(Math.round(opgehaald / 1000) * 1000).toISOString(),
    bron: 'open-meteo',
  };
}

/** Eén keer het weer bij Open-Meteo; een fout als het niet lukt. */
export async function haalWeer(plaats, { vraag = vraagJson } = {}) {
  const { status, json } = await vraag(weerAdres(plaats), { tijd: WEER_TIJD_MS });
  if (status !== 200) throw new Error(`Open-Meteo antwoordde ${status}`);
  return weerUitOpenMeteo(json);
}

/** Tot zoveel procent bewolking heet het zonnig, vanaf boven zoveel bewolkt (src/lib/advies.js zegt hetzelfde). */
export const ZONNIG_TOT_PCT = 35;
export const BEWOLKT_VANAF_PCT = 70;

/**
 * Morgen in het kort, voor proef: de straling over de dag (kWh per m²), de
 * gemiddelde bewolking zolang de zon op is (straling boven nul; zonder straling
 * 9:00–17:00) en die in woorden. Null als morgen niet in het bericht staat.
 */
export function morgenInHetKort(blok, nu) {
  if (!blok) return null;
  const morgen = morgenVan(datumInNederland(nu));
  const van = Date.parse(blok.van);
  const lengte = (blok.straling_wm2 ?? blok.bewolking_pct ?? []).length;
  const uren = Array.from({ length: lengte }, (_, i) => i).filter((i) => datumInNederland(van + i * UUR_MS) === morgen);
  if (uren.length < 12) return null;
  const straling = blok.straling_wm2 ? uren.reduce((a, i) => a + blok.straling_wm2[i], 0) / 1000 : null;
  const licht = uren.filter((i) => (blok.straling_wm2 ? blok.straling_wm2[i] > 0 : uurInNederland(van + i * UUR_MS) >= 9 && uurInNederland(van + i * UUR_MS) < 17));
  const bewolking = blok.bewolking_pct && licht.length ? Math.round(licht.reduce((a, i) => a + blok.bewolking_pct[i], 0) / licht.length) : null;
  const woorden = bewolking === null ? null : bewolking <= ZONNIG_TOT_PCT ? 'veel zon' : bewolking > BEWOLKT_VANAF_PCT ? 'bewolkt, weinig zon' : 'wisselend bewolkt';
  // Sinds 0.10.0: hoeveel regen er morgen valt (een oudere stand van het bericht heeft dat niet: null).
  const neerslag = blok.neerslag_mm ? afgerond(uren.reduce((a, i) => a + blok.neerslag_mm[i], 0), 1) : null;
  return { kwh_m2: straling === null ? null : afgerond(straling, 1), bewolking_pct: bewolking, woorden, neerslag_mm: neerslag };
}

/** Wat proef laat zien: "morgen veel zon (5,2 kWh/m²), bewolking 30%, droog", of "niet bereikbaar". */
export function weerRegel(blok, nu, fout = null) {
  if (!blok) return fout ? `niet bereikbaar (${fout})` : 'niet bereikbaar';
  const kort = morgenInHetKort(blok, nu);
  if (!kort) return 'binnen, maar morgen staat er niet in';
  const kwh = kort.kwh_m2 === null ? '' : ` (${String(kort.kwh_m2).replace('.', ',')} kWh/m²)`;
  const bewolking = kort.bewolking_pct === null ? '' : `, bewolking ${kort.bewolking_pct}%`;
  const regen = kort.neerslag_mm === null ? '' : kort.neerslag_mm >= 0.1 ? `, ${String(kort.neerslag_mm).replace('.', ',')} mm regen` : ', droog';
  return `morgen ${kort.woorden ?? 'zon'}${kwh}${bewolking}${regen}`;
}

/** Het weer van nu in één regel voor proef: "lichte regen, 0,4 mm, wind 22 km/h (stoten 41 km/h)". */
export function nuRegel(blok) {
  const nu = blok?.nu;
  if (!nu) return null;
  const delen = [
    nu.code !== undefined ? WEER_WOORDEN[nu.code] : nu.bewolking_pct !== undefined ? `bewolking ${nu.bewolking_pct}%` : null,
    nu.neerslag_mm > 0 ? `${String(nu.neerslag_mm).replace('.', ',')} mm` : null,
    nu.wind_kmh !== undefined ? `wind ${nu.wind_kmh} km/h${nu.windstoten_kmh !== undefined ? ` (stoten ${nu.windstoten_kmh} km/h)` : ''}` : null,
  ].filter(Boolean);
  return delen.length ? delen.join(', ') : null;
}

/**
 * Houdt het weerbericht bij: meteen bij het starten, daarna hooguit eens per
 * uur (WEER_ELKE_MS); lukt het niet, over een kwartier nog eens. Het laatste
 * goede bericht blijft WEER_HOUDBAAR_MS bruikbaar; daarna geen weer. Eén regel
 * in het logboek als het misgaat (en weer als de reden verandert), één als
 * het weer lukt. Gooit nooit.
 *
 * @param {{ haal: () => Promise<object>, log?: (t: string) => void, klok?: () => number }} o
 */
export function weerVolger({ haal, log = () => {}, klok = Date.now }) {
  let laatste = null;
  let nietVoor = 0;
  let bezig = null;
  let laatsteFout = '';

  async function ververs() {
    try {
      const weer = await haal();
      laatste = { blok: weerVoorApp(weer, klok()), op: klok() };
      if (laatsteFout) log('Weerbericht (Open-Meteo): lukt weer.');
      laatsteFout = '';
      nietVoor = klok() + WEER_ELKE_MS;
    } catch (fout) {
      const tekst = inGewoneWoorden(fout);
      if (tekst !== laatsteFout) log(`Weerbericht (Open-Meteo): ${tekst}. Ik houd het laatste bericht (hooguit 3 uur oud) en probeer het over een kwartier opnieuw.`);
      laatsteFout = tekst;
      nietVoor = klok() + WEER_OPNIEUW_MS;
    }
  }

  return {
    /** Ophalen als het tijd is (op de achtergrond); de belofte is klaar als dat gebeurd is. */
    tik() {
      const nu = klok();
      // Sprong de klok terug, dan niet urenlang wachten.
      if (nietVoor - nu > WEER_ELKE_MS) nietVoor = 0;
      if (!bezig && nu >= nietVoor) {
        bezig = ververs().finally(() => {
          bezig = null;
        });
      }
      return bezig ?? Promise.resolve();
    },
    /** Het blok voor de meting, of null (nog niets, of het laatste goede is te oud). */
    blok() {
      if (!laatste) return null;
      const leeftijd = klok() - laatste.op;
      return leeftijd >= 0 && leeftijd < WEER_HOUDBAAR_MS ? laatste.blok : null;
    },
    /** Wat er misging bij de laatste poging, of null. */
    fout: () => laatsteFout || null,
  };
}
