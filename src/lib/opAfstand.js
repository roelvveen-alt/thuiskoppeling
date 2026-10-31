/**
 * Op afstand instellen, de kant van de browser (programmaatje 0.7.0): een
 * geheim (nu alleen de Zendure-cloudsleutel) versleutelen met het publieke
 * deel van het programmaatje thuis (Meting.brug.publiek), met Web Crypto.
 * Alleen het versleutelde stuk gaat naar de server; die kan het niet lezen.
 * Zie base44/shared/opAfstand.js (server) en brug/opAfstand.mjs (thuis).
 *
 *   een nieuwe AES-256-GCM-sleutel per keer → de waarde versleutelen, met
 *   het veld in de controle (extraData) → die AES-sleutel inpakken met
 *   RSA-OAEP (SHA-256) en het publieke deel
 */

/** Wat op afstand mag, met de naam in de app. Dezelfde lijst als op de server en thuis. */
export const VELDEN = Object.freeze({ 'zendure.cloudsleutel': 'Zendure-cloudsleutel' });

/** Vanaf deze versie kan het programmaatje iets op afstand overnemen. */
export const BRUG_MET_OP_AFSTAND = '0.7.0';

const tekstNaarBytes = (tekst) => new TextEncoder().encode(tekst);
const naarBase64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const uitBase64 = (tekst) => Uint8Array.from(atob(tekst), (t) => t.charCodeAt(0));

/** Hetzelfde als thuis (brug/opAfstand.mjs): het veld zit in de controle van AES-GCM. */
export const extraData = (veld) => tekstNaarBytes(`thuis-energie op-afstand v1 ${veld}`);

/** Een publiek deel zoals het programmaatje het stuurt (RSA 2048, SPKI in base64), of niet. */
export const publiekVorm = (tekst) => typeof tekst === 'string' && tekst.length >= 300 && tekst.length <= 800 && /^[A-Za-z0-9+/]+={0,2}$/.test(tekst);

/** De vingerafdruk van het publieke deel: de eerste 32 tekens van de SHA-256 over de bytes. */
export async function vingerafdruk(publiek, { subtle = globalThis.crypto.subtle } = {}) {
  const hash = new Uint8Array(await subtle.digest('SHA-256', uitBase64(publiek)));
  return [...hash].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

/**
 * De korte vingerafdruk om met het oog te vergelijken met wat het
 * programmaatje laat zien (node brug.mjs proef): de eerste 16 tekens in
 * groepjes van vier, "a1b2 c3d4 e5f6 0718". Zelfde als kortAfdruk op de server.
 */
export const kortAfdruk = (voor) => (typeof voor === 'string' && /^[0-9a-f]{32}$/.test(voor) ? voor.slice(0, 16).match(/.{4}/g).join(' ') : null);

/**
 * Het sleutelpaar van het programmaatje tegenover het paar dat de eigenaar
 * vertrouwt (huis.publiek_vast, vastgezet door de server bij de eerste keer
 * klaarzetten; ronde 19):
 *
 *   onbekend   de vingerafdruk is er (nog) niet
 *   eerste     nog niets vastgezet (of een oudere functie): vergelijk hem één keer
 *   zelfde     het vertrouwde paar
 *   ander      een ander paar: eerst vergelijken en bevestigen, dan pas invullen
 */
export function paarVan(voor, vast) {
  if (!voor) return 'onbekend';
  if (typeof vast !== 'string' || !vast) return 'eerste';
  return voor === vast ? 'zelfde' : 'ander';
}

/**
 * Wat er mis is met een geplakte cloudsleutel, in gewone woorden, of null.
 * Zoals leesCloudsleutel in brug/zendure.mjs: base64 van "<adres>.<appKey>".
 */
export function cloudsleutelFout(ruw) {
  const tekst = String(ruw ?? '').trim();
  if (!tekst) return 'Plak de Autorisatiecloudsleutel uit de Zendure-app.';
  let uit;
  try {
    uit = atob(tekst);
  } catch {
    uit = '';
  }
  const punt = uit.lastIndexOf('.');
  const adres = uit.slice(0, punt);
  const appKey = uit.slice(punt + 1);
  if (tekst.length < 16 || tekst.length > 600 || punt < 1 || !/^https?:\/\/[^\s/]+/.test(adres) || !/^\S+$/.test(appKey)) {
    return 'Dit lijkt geen Autorisatiecloudsleutel uit de Zendure-app. Kopieer hem opnieuw (Profiel › Autorisatiecloudsleutel › Ophalen).';
  }
  // Zoals isZendureAdres in brug/zendure.mjs (programmaatje 0.13.0): alleen https naar de Zendure-cloud.
  if (!isZendureAdres(adres)) {
    return 'Deze cloudsleutel wijst niet naar Zendure (alleen https en een adres van zendure.tech, zendure.com of zendure.cn). Kopieer hem opnieuw uit de Zendure-app.';
  }
  return null;
}

/** De domeinen van de Zendure-cloud; brug/zendure.mjs heeft dezelfde lijst (brug/zendure.test.js houdt ze gelijk). */
export const ZENDURE_DOMEINEN = Object.freeze(['zendure.tech', 'zendure.com', 'zendure.cn']);

/** Wijst dit adres naar de Zendure-cloud? Alleen https, poort 443, geen inlog, een host op een Zendure-domein. */
export function isZendureAdres(adres) {
  let url;
  try {
    url = new URL(adres);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return ZENDURE_DOMEINEN.some((d) => host === d || host.endsWith(`.${d}`));
}


/**
 * Versleutelen voor het programmaatje met dit publieke deel.
 * @returns {Promise<{ v: 1, voor: string, sleutel: string, iv: string, data: string }>}
 */
export async function versleutel(publiek, veld, waarde, { crypto = globalThis.crypto } = {}) {
  const { subtle } = crypto;
  const rsa = await subtle.importKey('spki', uitBase64(publiek), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  const aes = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const inhoud = tekstNaarBytes(JSON.stringify({ veld, waarde }));
  const data = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: extraData(veld) }, aes, inhoud);
  const sleutel = await subtle.encrypt({ name: 'RSA-OAEP' }, rsa, await subtle.exportKey('raw', aes));
  return { v: 1, voor: await vingerafdruk(publiek, { subtle }), sleutel: naarBase64(sleutel), iv: naarBase64(iv), data: naarBase64(data) };
}

/**
 * Hoe het ervoor staat, per veld, voor het kopje "Op afstand instellen".
 *
 *   geen          niets klaargezet
 *   wacht         klaargezet; het programmaatje heeft het nog niet opgehaald (binnen een paar minuten)
 *   overgenomen   het programmaatje heeft het overgenomen
 *   mislukt       het programmaatje kon het niet overnemen (`fout`)
 *   anderPaar     versleuteld voor een ander sleutelpaar dan het programmaatje nu meldt: eerst de
 *                 vingerafdruk vergelijken en bevestigen (paarVan), pas dan opnieuw invullen
 *
 * @param {{ veld, op, voor } | undefined} klaar  uit huis.op_afstand (functie huis, 'mijn')
 * @param {{ publiek?: string|null, opAfstand?: Array }} brug  uit de stand (bron.js, brugUit)
 * @param {string|null} voor  de vingerafdruk van brug.publiek
 */
export function staatVan(klaar, brug, voor) {
  if (!klaar) return { soort: 'geen' };
  const gemeld = (brug?.opAfstand ?? []).find((m) => m.veld === klaar.veld);
  if (gemeld && gemeld.op >= klaar.op) return gemeld.ok ? { soort: 'overgenomen', op: klaar.op } : { soort: 'mislukt', op: klaar.op, fout: gemeld.fout ?? null };
  if (voor && klaar.voor !== voor) return { soort: 'anderPaar', op: klaar.op };
  return { soort: 'wacht', op: klaar.op };
}

/** Waarom het programmaatje het niet overnam, in gewone woorden (de codes uit brug/opAfstand.mjs). */
export const FOUT_TEKST = {
  sleutelpaar: 'Het programmaatje kon hem niet openen (een ander sleutelpaar). Vul hem opnieuw in.',
  ongeldig: 'Het programmaatje vond het geen geldige cloudsleutel. Kijk hem na en vul hem opnieuw in.',
  'geen-zendure': 'Bij het programmaatje staat geen Zendure in de instellingen. Zet die er eerst in met de instelhulp (node brug.mjs instellen).',
  bewaren: 'Het programmaatje kon zijn instellingen niet bewaren. Is de opslag vol?',
};
