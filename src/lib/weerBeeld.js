/**
 * Het weer van nu op de tekening van het huis (programmaatje 0.9.0:
 * stand.weer.nu, uit Open-Meteo `current`). Hier alleen de vertaling van de
 * WMO-weercode naar wat er getekend wordt; HuisTekening tekent het, HuisBeeld
 * zet bij een eigen foto alleen een klein icoon in de hoek.
 *
 * De WMO-weercodes (WMO 4677, zoals Open-Meteo ze geeft):
 *
 *   0            onbewolkt
 *   1, 2, 3      vrijwel onbewolkt, half bewolkt, bewolkt
 *   45, 48       mist, mist met rijp
 *   51, 53, 55   motregen: licht, matig, dicht
 *   56, 57       ijzel-motregen: licht, dicht
 *   61, 63, 65   regen: licht, matig, zwaar
 *   66, 67       ijzel: licht, zwaar
 *   71, 73, 75   sneeuw: licht, matig, zwaar
 *   77           korrelsneeuw
 *   80, 81, 82   regenbuien: licht, matig, hevig
 *   85, 86       sneeuwbuien: licht, zwaar
 *   95           onweer (licht of matig)
 *   96, 99       onweer met hagel: licht, zwaar
 *
 * Wind (km/h op 10 m): vanaf 39 km/h gemiddeld (6 Beaufort, krachtig) of
 * stoten vanaf 60 km/h "stevig" (de molen draait sneller, de bomen wiegen);
 * vanaf 62 km/h (8 Beaufort, stormachtig) of stoten vanaf 90 km/h (KNMI-code
 * oranje) "storm".
 *
 * brug/weer.mjs heeft dezelfde woorden (weerWoord) voor proef;
 * base44/tests/weer.test.js houdt ze gelijk.
 */

/** Per code: de woorden, de wolken (0 geen, 1 een paar, 2 half, 3 dicht), en wat er valt (soort en zwaar). */
export const WMO = {
  0: { tekst: 'onbewolkt', wolken: 0 },
  1: { tekst: 'vrijwel onbewolkt', wolken: 1 },
  2: { tekst: 'half bewolkt', wolken: 2 },
  3: { tekst: 'bewolkt', wolken: 3 },
  45: { tekst: 'mist', wolken: 3, mist: true },
  48: { tekst: 'mist met rijp', wolken: 3, mist: true },
  51: { tekst: 'lichte motregen', wolken: 3, valt: 'motregen' },
  53: { tekst: 'motregen', wolken: 3, valt: 'motregen' },
  55: { tekst: 'dichte motregen', wolken: 3, valt: 'motregen', zwaar: true },
  56: { tekst: 'lichte ijzel', wolken: 3, valt: 'motregen' },
  57: { tekst: 'ijzel', wolken: 3, valt: 'motregen', zwaar: true },
  61: { tekst: 'lichte regen', wolken: 3, valt: 'regen' },
  63: { tekst: 'regen', wolken: 3, valt: 'regen' },
  65: { tekst: 'zware regen', wolken: 3, valt: 'regen', zwaar: true },
  66: { tekst: 'lichte ijzel', wolken: 3, valt: 'regen' },
  67: { tekst: 'zware ijzel', wolken: 3, valt: 'regen', zwaar: true },
  71: { tekst: 'lichte sneeuw', wolken: 3, valt: 'sneeuw' },
  73: { tekst: 'sneeuw', wolken: 3, valt: 'sneeuw' },
  75: { tekst: 'zware sneeuw', wolken: 3, valt: 'sneeuw', zwaar: true },
  77: { tekst: 'korrelsneeuw', wolken: 3, valt: 'sneeuw' },
  80: { tekst: 'lichte regenbuien', wolken: 2, valt: 'regen' },
  81: { tekst: 'regenbuien', wolken: 2, valt: 'regen' },
  82: { tekst: 'hevige regenbuien', wolken: 3, valt: 'regen', zwaar: true },
  85: { tekst: 'sneeuwbuien', wolken: 2, valt: 'sneeuw' },
  86: { tekst: 'zware sneeuwbuien', wolken: 3, valt: 'sneeuw', zwaar: true },
  95: { tekst: 'onweer', wolken: 3, valt: 'regen', onweer: true },
  96: { tekst: 'onweer met hagel', wolken: 3, valt: 'hagel', onweer: true },
  99: { tekst: 'zwaar onweer met hagel', wolken: 3, valt: 'hagel', zwaar: true, onweer: true },
};

export const WIND_STEVIG_KMH = 39;
export const STOTEN_STEVIG_KMH = 60;
export const WIND_STORM_KMH = 62;
export const STOTEN_STORM_KMH = 90;
/** Ouder dan dit is het weer van "nu" niet meer van nu (het programmaatje haalt het elk uur). */
export const NU_HOUDBAAR_MS = 2 * 3_600_000;

const getal = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Wolken uit de bewolking (%) als er geen code is. */
const wolkenUit = (pct) => (pct < 20 ? 0 : pct < 50 ? 1 : pct < 85 ? 2 : 3);

/**
 * Wat er nu getekend wordt, of null (geen weer: een oudere brug, of te oud;
 * dan blijft de tekening zoals altijd).
 *
 * @param {object|null} weer  stand.weer (weerUit in src/lib/bron.js), met `nu`
 * @param {number} nu  ms
 * @returns {null | { code: number|null, tekst: string, wolken: 0|1|2|3, valt: null|'motregen'|'regen'|'sneeuw'|'hagel',
 *   zwaar: boolean, onweer: boolean, mist: boolean, wind: null|'stevig'|'storm', windKmh: number|null }}
 */
export function weerBeeld(weer, nu) {
  const w = weer?.nu;
  if (!w) return null;
  if (weer.opgehaald == null || !(nu - weer.opgehaald <= NU_HOUDBAAR_MS)) return null;
  const code = Number.isInteger(w.code) && WMO[w.code] ? w.code : null;
  const bewolking = getal(w.bewolking);
  if (code === null && bewolking === null) return null;
  const soort = code === null ? { tekst: bewolking < 20 ? 'onbewolkt' : bewolking < 85 ? 'half bewolkt' : 'bewolkt', wolken: wolkenUit(bewolking) } : WMO[code];
  // Valt er neerslag terwijl de code zegt van niet (een bui net begonnen): dan regen of motregen.
  const mm = getal(w.neerslag);
  const valt = soort.valt ?? (mm !== null && mm >= 0.1 && !soort.mist ? (mm >= 0.5 ? 'regen' : 'motregen') : null);
  const windKmh = getal(w.wind);
  const stoten = getal(w.stoten);
  const wind =
    (windKmh ?? 0) >= WIND_STORM_KMH || (stoten ?? 0) >= STOTEN_STORM_KMH
      ? 'storm'
      : (windKmh ?? 0) >= WIND_STEVIG_KMH || (stoten ?? 0) >= STOTEN_STEVIG_KMH
        ? 'stevig'
        : null;
  return {
    code,
    tekst: soort.tekst,
    wolken: valt && soort.wolken < 2 ? 2 : soort.wolken,
    valt,
    zwaar: Boolean(soort.zwaar) || (mm ?? 0) >= 4,
    onweer: Boolean(soort.onweer),
    mist: Boolean(soort.mist),
    wind,
    windKmh,
  };
}

/** Eén zin voor een schermlezer en de titel van het icoon: "Weer nu: lichte regen, harde wind". */
export function weerZin(beeld) {
  if (!beeld) return null;
  const wind = beeld.wind === 'storm' ? ', storm' : beeld.wind === 'stevig' ? ', harde wind' : '';
  return `Weer nu: ${beeld.tekst}${wind}`;
}

/**
 * Welk lucide-icoon bij een eigen foto in de hoek staat (de naam; HuisBeeld
 * kiest het onderdeel). Dag en nacht volgen de tekening (isDag).
 */
export function weerIcoon(beeld, dag) {
  if (!beeld) return null;
  if (beeld.onweer) return 'CloudLightning';
  if (beeld.valt === 'hagel') return 'CloudHail';
  if (beeld.valt === 'sneeuw') return 'CloudSnow';
  if (beeld.valt === 'regen') return beeld.wolken < 3 ? (dag ? 'CloudSunRain' : 'CloudMoonRain') : 'CloudRain';
  if (beeld.valt === 'motregen') return 'CloudDrizzle';
  if (beeld.mist) return 'CloudFog';
  if (beeld.wind) return 'Wind';
  if (beeld.wolken === 0) return dag ? 'Sun' : 'Moon';
  if (beeld.wolken <= 2) return dag ? 'CloudSun' : 'CloudMoon';
  return 'Cloudy';
}
