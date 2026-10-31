import { VERSIES } from './tuya.mjs';

/**
 * Het stuk "tuya" in instellingen.json, nagekeken (instellingen.mjs roept
 * dit aan). Per apparaat:
 *
 *   { "naam": "Pomp", "id": "bf…", "local_key": "…16 tekens…", "adres": "192.168.1.50",
 *     "versie": "3.4", "wat": "meter" | "lamp" | "schakelaar",
 *     "spots": true,            alleen bij lamp/schakelaar: de spotjes in het overstek
 *     "soort": "pomp",          alleen bij een meter: het plaatje in de app
 *     "dp": { "aan": 1, "vermogen": 19, "schaal": 1, "helderheid": 22, … } }   uit de Tuya-cloud
 *
 * De local_key is geheim (zoals de andere sleutels in dit bestand); het
 * Access Secret van de Tuya-cloud staat er nooit in.
 */

export const TUYA_WAT = ['meter', 'lamp', 'schakelaar'];
/** Hooguit zoveel Tuya-apparaten (de app neemt hooguit 40 apparaten en 20 lampen aan). */
export const HOOGSTENS_TUYA = 30;

const ADRES = /^[a-zA-Z0-9.-]{1,253}$/;
const ID = /^[a-zA-Z0-9]{10,40}$/;
/** Een local_key is 16 zichtbare tekens (ook leestekens, zoals Tuya ze maakt). */
export const LOCAL_KEY = /^[\x21-\x7e]{16}$/;
const DP_GRENZEN = { aan: [1, 255], vermogen: [1, 255], schaal: [0, 4], helderheid: [1, 255], helderheid_min: [0, 10_000], helderheid_max: [1, 10_000] };

/** De vaste sleutel in de app: "Spots overstek" → tuya-spots-overstek. */
export function tuyaSleutelVan(naam) {
  const kort = String(naam ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
  return `tuya-${kort || 'apparaat'}`;
}

/** Alleen de bekende datapunten, als geheel getal binnen de grenzen. */
function dpUit(dp) {
  if (!dp || typeof dp !== 'object' || Array.isArray(dp)) return null;
  const uit = {};
  for (const [veld, [min, max]] of Object.entries(DP_GRENZEN)) {
    if (Number.isInteger(dp[veld]) && dp[veld] >= min && dp[veld] <= max) uit[veld] = dp[veld];
  }
  return Object.keys(uit).length ? uit : null;
}

/**
 * @param {unknown} ruw  i.tuya
 * @param {string[]} fouten  hier komen de fouten bij, in gewone woorden
 * @param {Set<string>} sleutels  de sleutels die al bestaan (HomeWizard); de nieuwe komen erbij
 * @returns {object[]}  nagekeken apparaten
 */
export function controleerTuya(ruw, fouten, sleutels = new Set()) {
  if (ruw === undefined || ruw === null) return [];
  if (!Array.isArray(ruw) || ruw.length > HOOGSTENS_TUYA) {
    fouten.push(`tuya: een lijst met hooguit ${HOOGSTENS_TUYA} apparaten (maak hem met: node brug.mjs instellen).`);
    return [];
  }
  const uit = [];
  ruw.forEach((a, n) => {
    const waar = `tuya[${n}]`;
    if (!a || typeof a !== 'object') return fouten.push(`${waar}: geen apparaat.`);
    const naam = typeof a.naam === 'string' ? a.naam.trim() : '';
    if (!naam || naam.length > 40) fouten.push(`${waar}.naam: geef het apparaat een naam (hooguit 40 tekens).`);
    if (typeof a.id !== 'string' || !ID.test(a.id)) fouten.push(`${waar}.id: het id uit de Tuya-cloud ontbreekt of klopt niet.`);
    if (typeof a.local_key !== 'string' || !LOCAL_KEY.test(a.local_key)) fouten.push(`${waar}.local_key: de local key is 16 tekens; haal hem op met: node brug.mjs instellen.`);
    if (typeof a.adres !== 'string' || !ADRES.test(a.adres)) fouten.push(`${waar}.adres: het IP-adres in de wifi ontbreekt of klopt niet (bijvoorbeeld 192.168.1.50).`);
    if (!VERSIES.includes(a.versie)) fouten.push(`${waar}.versie: kies "3.3", "3.4" of "3.5" (de Tuya-versie van het apparaat).`);
    if (!TUYA_WAT.includes(a.wat)) fouten.push(`${waar}.wat: kies "meter", "lamp" of "schakelaar".`);
    if (a.spots !== undefined && typeof a.spots !== 'boolean') fouten.push(`${waar}.spots: true of false, of laat het weg.`);
    const sleutel = typeof a.sleutel === 'string' && /^tuya-[a-z0-9-]{1,55}$/.test(a.sleutel) ? a.sleutel : tuyaSleutelVan(naam);
    if (sleutels.has(sleutel)) fouten.push(`${waar}: twee apparaten met dezelfde naam; geef ze elk een eigen naam.`);
    sleutels.add(sleutel);
    const dp = dpUit(a.dp);
    uit.push({
      naam,
      id: a.id,
      local_key: a.local_key,
      adres: a.adres,
      versie: a.versie,
      wat: a.wat,
      sleutel,
      ...(a.wat === 'meter' ? { soort: typeof a.soort === 'string' && /^[a-z]{1,20}$/.test(a.soort) ? a.soort : 'stekker' } : {}),
      ...(a.wat !== 'meter' && a.spots === true ? { spots: true } : {}),
      ...(dp ? { dp } : {}),
    });
  });
  return uit;
}
