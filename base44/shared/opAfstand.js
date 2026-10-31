/**
 * Op afstand instellen (programmaatje 0.7.0): de eigenaar zet in de app een
 * geheim klaar voor het programmaatje thuis, zonder erheen te gaan. Nu alleen
 * de Zendure-cloudsleutel (als reserve); de lijst VELDEN houdt het klein.
 *
 * Hoe het veilig blijft:
 *
 *   1. Het programmaatje maakt één keer een sleutelpaar (RSA-OAEP 2048) en
 *      bewaart het privé-deel thuis (brug/op-afstand.json, 0600). Alleen het
 *      publieke deel gaat mee in de meting (brug.publiek).
 *   2. De browser van de eigenaar versleutelt de waarde met dat publieke deel
 *      (Web Crypto: een nieuwe AES-256-GCM-sleutel per keer, die met RSA-OAEP
 *      ingepakt; src/lib/opAfstand.js). De server krijgt en bewaart alleen het
 *      versleutelde stuk (Huis.op_afstand) en kan het zelf niet lezen. De app
 *      laat daarna alleen zien wanneer het is klaargezet, nooit de waarde.
 *   3. ontvangMeting geeft het stuk terug aan het programmaatje met de
 *      sleutel van dát huis, alleen als het voor zijn sleutelpaar is
 *      (`voor`, de vingerafdruk van het publieke deel) en nieuwer dan wat het
 *      meldt al te hebben (brug.op_afstand). Zonder klaargezet stuk kost dat
 *      niets extra: het staat in de Huis-rij die bij de sleutel al gelezen is.
 *
   4. Het publieke deel komt via de server (in de meting) bij de browser. Wie
 *      de sleutel van het programmaatje heeft (of de rij Meting kan
 *      schrijven), kan er een eigen publiek deel in zetten en zo een volgende
 *      waarde opvangen (ronde 19, B1). Daarom vertrouwen bij eerste gebruik:
 *      de eerste keer dat de eigenaar iets klaarzet, zet de server de
 *      vingerafdruk vast (Huis.brug_publiek_vast). Daarna weigert zetOpAfstand
 *      een stuk voor een ander sleutelpaar (409 anderPaar), tenzij de eigenaar
 *      die nieuwe vingerafdruk in de app bevestigt (nieuw_paar). De app laat
 *      de korte vingerafdruk zien (kortAfdruk: "a1b2 c3d4 e5f6 0718"), en het
 *      programmaatje dezelfde bij `node brug.mjs proef`: zo vergelijkt de
 *      eigenaar ze, en ziet hij het als er een ander paar opduikt.
 *
 * Wat het niet tegenhoudt: wie de sleutel van het programmaatje heeft, kan
 * zich nog steeds met een eigen publiek deel melden; dan waarschuwt de app,
 * en zonder bevestiging gaat er niets voor dat paar klaar. Die sleutel blijft
 * dus geheim; kwijt of in verkeerde handen: Instellingen › Delen › Nieuwe
 * sleutel.
 *
 * Wie mag klaarzetten en wissen: alleen de eigenaar (en de beheerder), zie
 * huisVoor met alleenEigenaar in toegang.js. Een kijker ziet er niets van.
 */

/** De velden die op afstand mogen; het programmaatje heeft dezelfde lijst (brug/opAfstand.mjs). */
export const VELDEN = Object.freeze(['zendure.cloudsleutel']);

/** Wat het programmaatje terugmeldt als het een stuk niet kon overnemen (brug/opAfstand.mjs). */
export const FOUTEN = Object.freeze(['sleutelpaar', 'ongeldig', 'geen-zendure', 'bewaren']);

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const ISO_MOMENT = /^\d{4}-\d{2}-\d{2}T[0-9:.+\-Z]{5,30}$/;
export const VINGERAFDRUK = /^[0-9a-f]{32}$/;

const b64 = (tekst, min, max) => typeof tekst === 'string' && tekst.length >= min && tekst.length <= max && tekst.length % 4 === 0 && BASE64.test(tekst);

/** Het publieke deel van het programmaatje: RSA 2048 als SPKI (DER) in base64, zo'n 392 tekens. */
export const publiekVorm = (tekst) => b64(tekst, 300, 800);

export const veldVorm = (veld) => typeof veld === 'string' && VELDEN.includes(veld);

/**
 * Het versleutelde stuk zoals de site het stuurt, nagekeken op vorm (de
 * inhoud kan de server niet lezen). Fout: null.
 *   v        1 (de manier: RSA-OAEP-2048/SHA-256 om AES-256-GCM)
 *   voor     vingerafdruk van het publieke deel waarmee versleuteld is
 *   sleutel  de AES-sleutel, ingepakt met RSA-OAEP (256 bytes)
 *   iv       12 bytes
 *   data     de waarde, met AES-GCM (met de controle erachter)
 */
export function pakketUit(ruw) {
  if (!ruw || typeof ruw !== 'object' || Array.isArray(ruw)) return null;
  if (ruw.v !== 1 || typeof ruw.voor !== 'string' || !VINGERAFDRUK.test(ruw.voor)) return null;
  if (!b64(ruw.sleutel, 344, 344) || !b64(ruw.iv, 16, 16) || !b64(ruw.data, 24, 2000)) return null;
  return { v: 1, voor: ruw.voor, sleutel: ruw.sleutel, iv: ruw.iv, data: ruw.data };
}

/** Wat er in Huis.op_afstand staat, schoon: per veld hooguit één, met een moment. */
export function klaargezet(huis) {
  const lijst = Array.isArray(huis?.op_afstand) ? huis.op_afstand : [];
  const uit = new Map();
  for (const s of lijst) {
    if (!s || typeof s !== 'object' || !veldVorm(s.veld) || typeof s.op !== 'string' || !ISO_MOMENT.test(s.op)) continue;
    const pakket = pakketUit(s);
    if (pakket) uit.set(s.veld, { veld: s.veld, op: s.op, ...pakket });
  }
  return [...uit.values()];
}

/** Wat de eigenaar in de app ziet: welk veld, wanneer, voor welk sleutelpaar. Nooit het stuk zelf. */
export const voorSite = (huis) => klaargezet(huis).map(({ veld, op, voor }) => ({ veld, op, voor }));

/** Het nieuwe Huis.op_afstand: dit veld vervangen (of weg, zonder pakket), de rest blijft. */
export function metVeld(huis, veld, pakket, op) {
  const rest = klaargezet(huis).filter((s) => s.veld !== veld);
  return pakket ? [...rest, { veld, op, ...pakket }] : rest;
}

/**
 * Wat het programmaatje meldt over wat het al heeft (brug.op_afstand, mild):
 * per veld het moment van het laatste stuk dat het oppakte, en of dat lukte.
 */
export function gemeldUit(lijst) {
  if (!Array.isArray(lijst)) return null;
  const uit = new Map();
  for (const m of lijst.slice(0, 8)) {
    if (!m || typeof m !== 'object' || !veldVorm(m.veld) || typeof m.op !== 'string' || m.op.length > 40 || !ISO_MOMENT.test(m.op)) continue;
    uit.set(m.veld, { veld: m.veld, op: m.op, ok: m.ok === true, ...(m.ok !== true && FOUTEN.includes(m.fout) ? { fout: m.fout } : {}) });
  }
  return [...uit.values()];
}

/**
 * Het sleutelpaar dat de eigenaar vertrouwt (de vingerafdruk), of null. Een
 * rij van vóór ronde 19 heeft dat veld niet: dan het paar van wat er al
 * klaarstaat (daar koos de eigenaar toen voor), en anders nog geen.
 */
export function vastVan(huis) {
  if (typeof huis?.brug_publiek_vast === 'string' && VINGERAFDRUK.test(huis.brug_publiek_vast)) return huis.brug_publiek_vast;
  return klaargezet(huis)[0]?.voor ?? null;
}

/** De korte vingerafdruk om met het oog te vergelijken: de eerste 16 tekens in groepjes van vier ("a1b2 c3d4 e5f6 0718"). */
export const kortAfdruk = (voor) => (typeof voor === 'string' && VINGERAFDRUK.test(voor) ? voor.slice(0, 16).match(/.{4}/g).join(' ') : null);

/**
 * Mag dit pakket klaar? `bevestigd` is de vingerafdruk die de eigenaar in de
 * app als nieuw paar bevestigde (nieuw_paar), of niets. Een bevestiging geldt
 * alleen voor precies dat paar.
 * @returns {{ ok: true, vast: object } | { ok: false, vast: string }}
 *   ok: `vast` zijn de velden erbij voor Huis (leeg als het paar al vaststond);
 *   niet ok: `vast` is de vingerafdruk die vaststaat
 */
export function paarVoorKlaarzetten(huis, pakket, bevestigd, op) {
  const vast = vastVan(huis);
  if (vast === pakket.voor) return { ok: true, vast: typeof huis?.brug_publiek_vast === 'string' && huis.brug_publiek_vast === vast ? {} : { brug_publiek_vast: vast, brug_publiek_vast_op: op } };
  if (vast && bevestigd !== pakket.voor) return { ok: false, vast };
  return { ok: true, vast: { brug_publiek_vast: pakket.voor, brug_publiek_vast_op: op } };
}

/** De vingerafdruk van een publiek deel: de eerste 32 tekens van de SHA-256 over de bytes (DER). */
export async function vingerafdrukVan(publiek) {
  const bytes = Uint8Array.from(atob(publiek), (t) => t.charCodeAt(0));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...hash].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

/**
 * Wat ontvangMeting aan het programmaatje teruggeeft: de klaargezette stukken
 * voor zijn sleutelpaar die nieuwer zijn dan wat het meldt. Zonder brugblok
 * (dat gaat eens per minuut mee) of zonder publiek deel (een oudere versie):
 * niets. Geen aanroep naar Base44.
 *
 * @param {object} huis  de Huis-rij (of wat huisBijSleutel ervan onthoudt)
 * @param {object|null} brug  meting.brug zoals controle.js hem doorliet
 */
export async function voorBrug(huis, brug) {
  const lijst = klaargezet(huis);
  if (!lijst.length || !brug || !publiekVorm(brug.publiek)) return [];
  const voor = await vingerafdrukVan(brug.publiek);
  // Alleen voor het paar dat de eigenaar vertrouwt (zetOpAfstand zorgt daar al voor; dit is de tweede deur).
  const vast = vastVan(huis);
  if (vast && vast !== voor) return [];
  const heeft = new Map((gemeldUit(brug.op_afstand) ?? []).map((m) => [m.veld, m.op]));
  return lijst.filter((s) => s.voor === voor && !(heeft.has(s.veld) && heeft.get(s.veld) >= s.op));
}
