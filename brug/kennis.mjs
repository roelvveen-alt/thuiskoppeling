import { datumInNederland } from './kosten.mjs';

/**
 * Kennis terug (1.4.0, 31-10-2026: "zorg dat die kennis terugkomt om de app
 * te verbeteren"): hooguit eens per dag per apparaat een lijst van de VELDNAMEN
 * die elk apparaat teruggeeft, zodat de beheerder (en Claude) in de app ziet wat
 * er nog meer te halen is. Alleen lezen, net als de rest.
 *
 * Wat er NOOIT in komt (hard weggefilterd, hier en nog eens in de app,
 * base44/functions/ontvangMeting/controle.js): serienummers, MAC- en
 * IP-adressen, wifinamen, sleutels, tokens, en überhaupt geen tekst. Van een
 * veld gaat alleen de naam mee; een getal erbij alleen als de naam niet naar
 * iets herkenbaars ruikt (IDENTITEIT) en het getal geen id of tijd kan zijn
 * (kleiner dan GROOT_GETAL). Per veld één regel: "naam" of "naam=getal".
 */

/** Veldnamen waarvan de waarde iemand of iets herkenbaar maakt: daarvan nooit een waarde. */
export const IDENTITEIT = /(^|[^a-z])(sn|serial|serie|mac|ip|ipv4|ipv6|ssid|bssid|wifi_ssid|token|key|secret|pass|password|pwd|id|uid|uuid|unique|device_?id|devid|host|url|addr|address|adres|name|naam|owner|email|mail|lat|lon|lng|gps|location)([^a-z]|$)/i;
/** Ook als het ergens in de naam zit (deviceKey, uniqueId, wifiSsid, productKey). */
const IDENTITEIT_IN = /(serial|ssid|token|secret|password|unique|devicekey|productkey|appkey|deviceid|macaddr|ipaddr|hostname)/i;
/** Een getal zo groot kan een tijd, een id of een serienummer zijn: dan alleen de naam. */
export const GROOT_GETAL = 1e9;
/** Zo mag een veldnaam eruitzien (de rest valt weg). */
const NAAM = /^[A-Za-z0-9_.[\]:-]{1,60}$/;
/** Hooguit zoveel velden per apparaat, en zoveel apparaten. */
export const HOOGSTENS_VELDEN = 160;
export const HOOGSTENS_APPARATEN = 12;

/**
 * Zo groot mag het blok kennis hooguit zijn (JSON-tekens), zodat het met de stand
 * altijd in één meting past (HOOGSTENS_TEKENS in versturen.mjs: 18.000; de
 * stand zelf is met 18 accu's zo'n 6.000). Gemeten in huis A past alles er ruim in.
 */
export const HOOGSTENS_KENNIS_TEKENS = 8000;

/** Te groot: van het apparaat met de meeste velden de laatste weg, tot het past (in plaats). */
export function binnenGrens(blok, grens = HOOGSTENS_KENNIS_TEKENS) {
  while (JSON.stringify(blok).length > grens) {
    const grootste = blok.apparaten.reduce((a, b) => (b.velden.length > a.velden.length ? b : a));
    if (grootste.velden.length <= 1) break;
    grootste.velden.pop();
  }
  return blok;
}

export const isIdentiteit = (naam) => IDENTITEIT.test(naam) || IDENTITEIT_IN.test(naam.replace(/[_.[\]:-]/g, ''));

/** Eén regel voor een veld: "naam" of "naam=getal" (afgerond op 3 decimalen). Null als de naam niet deugt. */
export function veldRegel(naam, waarde) {
  if (typeof naam !== 'string' || !NAAM.test(naam)) return null;
  if (typeof waarde === 'number' && Number.isFinite(waarde) && Math.abs(waarde) < GROOT_GETAL && !isIdentiteit(naam)) {
    return `${naam}=${Math.round(waarde * 1000) / 1000}`;
  }
  return naam;
}

/**
 * Alle veldnamen van een antwoord (JSON), ook binnenin: "external[].type",
 * "packData[].maxVol". Een rij telt één keer (de eerste waarde). Op volgorde,
 * hooguit HOOGSTENS_VELDEN.
 */
export function veldenVan(json, { voor = '', diepte = 0, uit = new Map() } = {}) {
  if (!json || typeof json !== 'object' || diepte > 3) return [...uit.values()];
  const items = Array.isArray(json) ? [['[]', json.find((x) => x !== null && x !== undefined)]] : Object.entries(json);
  for (const [sleutel, waarde] of items) {
    if (uit.size >= HOOGSTENS_VELDEN) break;
    const naam = Array.isArray(json) ? `${voor}[]` : voor ? `${voor}.${sleutel}` : sleutel;
    if (waarde && typeof waarde === 'object') {
      veldenVan(waarde, { voor: naam, diepte: diepte + 1, uit });
      continue;
    }
    if (uit.has(naam)) continue;
    const regel = veldRegel(naam, waarde);
    if (regel) uit.set(naam, regel);
  }
  return [...uit.values()].sort((a, b) => a.localeCompare(b, 'en'));
}

/**
 * Houdt per apparaat bij wat het teruggeeft: hooguit eens per dag (de eerste
 * lezing van die dag) een nieuwe lijst. `blok()` geeft wat er mee moet als er
 * een lijst is die nog niet verstuurd is (dan alle lijsten samen; de app
 * bewaart de laatste set), anders null. `verstuurd()` na een geslaagde verzending.
 * Zo gaat het hooguit eens per dag per apparaat mee: 's nachts de meters en de
 * batterij, bij zonsopkomst de omvormer.
 */
export function kennisVolger() {
  const per = new Map();
  return {
    /** @param {string} sleutel  @param {string} soort  @param {() => string[]} maak  pas aangeroepen als het nodig is */
    zie(sleutel, soort, maak, nu) {
      if (typeof sleutel !== 'string' || !/^[a-zA-Z0-9._:-]{1,60}$/.test(sleutel)) return;
      const datum = datumInNederland(nu);
      if (per.get(sleutel)?.datum === datum) return;
      if (!per.has(sleutel) && per.size >= HOOGSTENS_APPARATEN) return;
      let velden;
      try {
        velden = maak();
      } catch {
        return;
      }
      if (!Array.isArray(velden) || !velden.length) return;
      per.set(sleutel, { sleutel, soort: String(soort).slice(0, 40), datum, velden: velden.slice(0, HOOGSTENS_VELDEN), verstuurd: false });
    },
    blok() {
      const lijst = [...per.values()];
      if (!lijst.some((a) => !a.verstuurd)) return null;
      return binnenGrens({ apparaten: lijst.map(({ sleutel, soort, datum, velden }) => ({ sleutel, soort, datum, velden: [...velden] })) });
    },
    verstuurd() {
      for (const a of per.values()) a.verstuurd = true;
    },
  };
}
