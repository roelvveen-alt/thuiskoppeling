/**
 * Wie mag wat in een omgeving (een Huis). Deze regels staan één keer, hier.
 *
 * Elke functie leest en schrijft met de rol van de server, en die gaat om
 * alle rechtenregels van Base44 heen. Daarom toetst elke actie hier: de
 * functie huis (mijn, stand, opstelling, de namen, delen, de sleutel) en
 * ontvangMeting (via de sleutel van het programmaatje). Het overzicht van alle
 * huizen is alleen voor de beheerder (alleenBeheerder). Een tweede kopie is
 * hoe in een andere Base44-app een gat ontstond: de lijst werd dichtgezet,
 * de export bleef open.
 *
 * De regel kan niet in de rechtenregels (rls) van de tabellen zelf:
 * `user_condition` vergelijkt alleen vaste velden van de gebruiker, zoals de
 * rol, en weet niets van leden. Huis, Meting en Opstelling blijven daarom
 * alleen voor de beheerder, en de site leest alles via de functies.
 *
 * Op afstand instellen (zetOpAfstand, wisOpAfstand) is beheren: alleen de
 * eigenaar (en de beheerder), via huisVoor met alleenEigenaar. Een kijker
 * ziet er niets van (huisVoorSite in huizen.js).
 *
 * Inloggen is nog geen toestemming. De registratie van Base44 is niet af te
 * sluiten: wie het adres kent, maakt een account. Zo iemand ziet niets en mag
 * niets maken, tot een eigenaar hem uitnodigt.
 *
 * De beheerder van de app (rol admin in Base44) is super-beheerder: hij
 * ziet en beheert elke omgeving, en is de enige die er een maakt en tussen
 * omgevingen wisselt (2026-10-30: "alleen admin kan wisselen tussen
 * huizen, user niet"). Een gewone gebruiker hoort bij precies één omgeving;
 * een andere bestaat voor hem niet.
 */
import { sha256Hex, sleutelVorm } from './sleutel.js';

export const HOOGSTENS_LEDEN = 20;
/** Zoveel omgevingen mag één persoon zelf maken; meer is geen huis meer maar een vergissing. */
export const HOOGSTENS_EIGEN_HUIZEN = 5;

/** Een fout met een HTTP-status en een vaste code voor de site; de tekst is voor mensen. */
export class Fout extends Error {
  constructor(status, code, bericht) {
    super(bericht);
    this.status = status;
    this.code = code;
  }
}

/** "Bestaat niet" en "niet van jou" zijn hetzelfde antwoord: een vreemde leert er niets uit. */
export const geenHuis = () => new Fout(404, 'geenHuis', 'Deze omgeving bestaat niet (meer) of je mag er niet in.');

export const emailVan = (tekst) => (typeof tekst === 'string' ? tekst.trim().toLowerCase() : '');

/** Een id van Base44, of in elk geval iets dat er zo uitziet. */
export const idVorm = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(id);

/** Ingelogd, en het account staat niet uit. */
export function magInDeApp(user) {
  return Boolean(user?.id) && user.is_active !== false;
}

/** De beheerder van de app (rol admin in Base44), met een account dat aan staat. */
export function isBeheerder(user) {
  return magInDeApp(user) && user.role === 'admin';
}

/** De leden van een huis, schoon: kleine letters, zonder lege. */
export function ledenVan(huis) {
  return (Array.isArray(huis?.leden) ? huis.leden : []).map((lid) => ({ email: emailVan(lid?.email) })).filter((lid) => lid.email);
}

/**
 * 'eigenaar', 'kijker' of null. De eigenaar op id (dat blijft vast, ook als
 * het e-mailadres ooit verandert), een kijker op e-mailadres: zo nodig je
 * iemand uit, nog voordat hij een account heeft. De beheerder heeft in elke
 * omgeving de rechten van de eigenaar.
 *
 * Dit zegt alleen of iemand ergens bij hoort; dat een gewone gebruiker maar
 * één omgeving mag openen, regelt huisVoor (met eigenHuisUit).
 */
export function rolIn(huis, user) {
  if (!huis || !magInDeApp(user)) return null;
  if (isBeheerder(user)) return 'eigenaar';
  if (huis.eigenaar_id && huis.eigenaar_id === user.id) return 'eigenaar';
  const email = emailVan(user.email);
  if (email && ledenVan(huis).some((lid) => lid.email === email)) return 'kijker';
  return null;
}

/**
 * Alleen de beheerder van de app, of een 403: het overzicht van alle huizen
 * (actie overzicht). Een gewone gebruiker of kijker ziet daar niets van, ook
 * niet hoeveel huizen er zijn. Toets dit vóór je iets leest.
 */
export function alleenBeheerder(user) {
  if (!isBeheerder(user)) throw new Fout(403, 'alleenBeheerder', 'Dit is alleen voor de beheerder van de app.');
}

/** Mag deze persoon een omgeving maken? Alleen de beheerder van de app. */
export function magMaken(user) {
  return isBeheerder(user);
}

/**
 * De ene omgeving van een gewone gebruiker: de oudste waar hij eigenaar of
 * kijker is (op id, zoals alleHuizen bladert), of null. Hoort hij er door een
 * vergissing bij meer, dan blijft het deze; uitnodigen laat dat niet meer toe.
 */
export function eigenHuisUit(huizen, user) {
  if (!magInDeApp(user)) return null;
  return [...huizen].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).find((huis) => rolIn(huis, user) !== null) ?? null;
}

/**
 * Wat de functies even onthouden, per isolate, zodat de rem van Base44
 * (~115 aanroepen per 65 s, voor alle huizen samen) niet volloopt met
 * controles die elke 5 s hetzelfde antwoord geven. Eén Map per functie; de
 * sleutels hebben een voorvoegsel (gebruiker-id, `huis:`, `me:`, `meting:`,
 * `sleutel:`). De tests geven een eigen, lege Map.
 */
const EIGEN_HUIS = new Map();
const EIGEN_HUIS_MS = 60_000;
/**
 * Zo lang mag een leesvraag (stand, periode, logboek) een eerder antwoord van
 * auth.me en de Huis-rij gebruiken, en 'mijn' en 'opstelling' alleen dat van
 * auth.me (ronde 21). Daarmee is de prijs vastgelegd: een kijker die eruit
 * gehaald wordt, of een account dat op inactief gaat, ziet de cijfers nog
 * hooguit zo lang; schrijven en beheren toetsen altijd vers
 * (base44/tests/rem.test.js en toegang.test.js houden het onder een minuut).
 */
export const LEZEN_ONTHOUDEN_MS = 30_000;
const HOOGSTENS_ONTHOUDEN = 500;

/** Iets uit het geheugen, als het er nog geldig in staat. */
export function uitGeheugen(geheugen, sleutel, nu = Date.now()) {
  const bekend = geheugen.get(sleutel);
  return bekend && bekend.tot > nu ? bekend.waarde : undefined;
}

/** Iets onthouden tot nu + ms; wordt het geheugen te vol, dan eerst wat verlopen is eruit. */
export function onthoud(geheugen, sleutel, waarde, ms, nu = Date.now()) {
  if (geheugen.size >= HOOGSTENS_ONTHOUDEN) {
    for (const [k, v] of geheugen) if (v && typeof v === 'object' && v.tot <= nu) geheugen.delete(k);
    if (geheugen.size >= HOOGSTENS_ONTHOUDEN) geheugen.clear();
  }
  geheugen.set(sleutel, { waarde, tot: nu + ms });
}

/**
 * Per gebruiker even onthouden welke zijn ene omgeving is, zodat 'stand' (elke
 * 5 s) niet elke keer alle huizen hoeft te lezen. Alleen een id, geen recht:
 * of hij er nog bij hoort, toetst huisVoor met de Huis-rij. 'mijn' (bij het
 * openen van de app) zet hem opnieuw.
 */
export function onthoudEigenHuis(user, id, { geheugen = EIGEN_HUIS, nu = Date.now() } = {}) {
  onthoud(geheugen, user.id, id, EIGEN_HUIS_MS, nu);
}

/**
 * Goedkope remmen tegen wie de gedeelde rem van Base44 wil leegtrekken
 * (ronde 19, B2): een verzonnen brugsleutel of een onzin-token kost anders
 * elke keer een aanroep (Huis.filter of auth.me), voor alle huizen samen.
 *
 *   - Wat niets opleverde, onthouden we ONBEKEND_ONTHOUDEN_MS: dezelfde
 *     sleutel of hetzelfde token nog eens is meteen 401, zonder aanroep.
 *   - Hooguit HOOGSTENS_ONBEKEND mislukte opzoekingen per REM_VENSTER_MS per
 *     isolate (de emmer). Is die vol, dan krijgt een sleutel of token dat we
 *     nog niet kennen een 429 (even wachten), ook zonder aanroep. Wat de
 *     laatste BEKEND_MS goed was (de eigen bruggen en schermen), gaat er
 *     langs: een aanval houdt de echte huizen niet tegen.
 *
 * Na "Nieuwe sleutel" is de nieuwe sleutel een andere hash, dus niet in het
 * geheugen van wat niets opleverde: die werkt meteen (behalve als de emmer net
 * vol is; dan na hooguit REM_VENSTER_MS, en het programmaatje wacht bij een
 * 429 toch al langer).
 */
export const ONBEKEND_ONTHOUDEN_MS = 60_000;
export const HOOGSTENS_ONBEKEND = 10;
export const REM_VENSTER_MS = 65_000;
export const BEKEND_MS = 15 * 60_000;

/** Een fout die geduld.js als de rem ziet: de functie antwoordt dan 429 met Retry-After (remAntwoord). */
export const remFout = () => Object.assign(new Error('Rate limit exceeded: te veel onbekende pogingen'), { status: 429 });

/** De momenten in een emmer die nog binnen REM_VENSTER_MS vallen. */
const inVenster = (geheugen, sleutel, nu) => (uitGeheugen(geheugen, sleutel, nu) ?? []).filter((t) => nu - t < REM_VENSTER_MS);
const pogingen = (geheugen, soort, nu) => inVenster(geheugen, `emmer:${soort}`, nu);

/**
 * Een emmer: past er nog één bij (hooguit `max` per REM_VENSTER_MS), dan telt
 * hij mee en is het antwoord true; anders false, en telt hij niet mee.
 */
export function inEmmer(geheugen, sleutel, max, nu = Date.now()) {
  const tijden = inVenster(geheugen, sleutel, nu);
  if (tijden.length >= max) return false;
  onthoud(geheugen, sleutel, [...tijden, nu], REM_VENSTER_MS, nu);
  return true;
}

/**
 * Zo vaak per REM_VENSTER_MS mag één token de functie huis laten nagaan wie er
 * belt (auth.me), ook een geldig token van een account dat nergens bij hoort
 * (de registratie staat open). Daarboven 429 zonder aanroep. Een scherm komt er
 * niet aan: een leesvraag gebruikt auth.me hooguit eens per LEZEN_ONTHOUDEN_MS,
 * en beheren (opslaan, delen, het overzicht) gaat een paar keer per minuut.
 */
export const HOOGSTENS_PER_TOKEN = 20;

/**
 * Vóór het opzoeken van een sleutel of token (soort 'sleutel' of 'token', op
 * zijn hash): 'onbekend' (leverde net niets op: 401), 'vol' (de emmer is vol:
 * 429) of null (opzoeken mag).
 */
export function voorOpzoeken(geheugen, soort, hash, nu = Date.now()) {
  if (uitGeheugen(geheugen, `geen-${soort}:${hash}`, nu)) return 'onbekend';
  if (!uitGeheugen(geheugen, `bekend-${soort}:${hash}`, nu) && pogingen(geheugen, soort, nu).length >= HOOGSTENS_ONBEKEND) return 'vol';
  return null;
}

/** Na het opzoeken: goed (dan langs de emmer), of niets (onthouden, en het telt in de emmer). */
export function naOpzoeken(geheugen, soort, hash, gevonden, nu = Date.now()) {
  if (gevonden) {
    geheugen.delete(`geen-${soort}:${hash}`);
    onthoud(geheugen, `bekend-${soort}:${hash}`, true, BEKEND_MS, nu);
    return;
  }
  geheugen.delete(`bekend-${soort}:${hash}`);
  onthoud(geheugen, `geen-${soort}:${hash}`, true, ONBEKEND_ONTHOUDEN_MS, nu);
  inEmmer(geheugen, `emmer:${soort}`, HOOGSTENS_ONBEKEND, nu);
}

async function eigenHuisId(db, user, { geheugen = EIGEN_HUIS, nu = Date.now() } = {}) {
  const bekend = uitGeheugen(geheugen, user.id, nu);
  if (bekend !== undefined) return bekend;
  const id = eigenHuisUit(await alleHuizen(db), user)?.id ?? null;
  onthoudEigenHuis(user, id, { geheugen, nu });
  return id;
}

/**
 * De Huis-rij: vers, of voor een leesvraag (`onthouden`) hooguit
 * LEZEN_ONTHOUDEN_MS oud. Een vers gelezen rij (schrijven, beheren) haalt de
 * onthouden versie weg, zodat na een wijziging de volgende stand vers leest.
 * Een huis dat er niet is, wordt niet onthouden.
 */
async function huisRij(db, huisId, { onthouden, geheugen = EIGEN_HUIS, nu = Date.now() }) {
  const sleutel = `huis:${huisId}`;
  if (!onthouden) {
    geheugen.delete(sleutel);
    return db.Huis.get(huisId);
  }
  const bekend = uitGeheugen(geheugen, sleutel, nu);
  if (bekend) return bekend;
  const huis = await db.Huis.get(huisId);
  if (huis) onthoud(geheugen, sleutel, huis, LEZEN_ONTHOUDEN_MS, nu);
  return huis;
}

/**
 * Alle huizen, op id gebladerd (stabiel: bladeren op een datum kan rijen
 * overslaan of dubbel geven). Voor een handvol huizen is dat één aanroep. Een
 * mislukte bladzijde is een fout, geen halve lijst: magMaken rekent erop.
 */
export async function alleHuizen(db, { pagina = 200, max = 2000 } = {}) {
  const uit = [];
  const gezien = new Set();
  for (let vanaf = 0; uit.length < max; vanaf += pagina) {
    const groep = await db.Huis.list('id', pagina, vanaf);
    for (const huis of groep) {
      if (!huis?.id || gezien.has(huis.id)) continue;
      gezien.add(huis.id);
      uit.push(huis);
    }
    if (groep.length < pagina) break;
  }
  return uit;
}

/**
 * Het huis met dit id, vers gelezen, als deze persoon erin mag. Met
 * `alleenEigenaar` alleen voor de eigenaar: kijkers kijken, meer niet. Een
 * gewone gebruiker mag alleen zijn ene omgeving openen; een andere geeft
 * dezelfde 404 als een die niet bestaat, ook als hij daar (nog) bij staat.
 * Met `onthouden` (alleen leesvragen) mag de rij LEZEN_ONTHOUDEN_MS oud zijn;
 * de rechten worden toch elke keer met deze gebruiker getoetst.
 */
export async function huisVoor(db, user, huisId, { alleenEigenaar = false, onthouden = false, geheugen, nu } = {}) {
  if (!idVorm(huisId)) throw geenHuis();
  // Eerst zijn ene omgeving (meestal uit het geheugen), dan pas de rij: een ander id kost zo geen Huis.get (B4).
  if (!isBeheerder(user) && (await eigenHuisId(db, user, { geheugen, nu })) !== huisId) throw geenHuis();
  const huis = await huisRij(db, huisId, { onthouden: onthouden && !alleenEigenaar, geheugen, nu });
  const rol = rolIn(huis, user);
  if (!rol || huis.id !== huisId) throw geenHuis();
  if (alleenEigenaar && rol !== 'eigenaar') {
    throw new Fout(403, 'alleenEigenaar', 'Dat mag alleen de eigenaar van deze omgeving. Jij kijkt mee.');
  }
  return { huis, rol };
}

/**
 * Het huis bij de sleutel van het programmaatje thuis, of null. De sleutel
 * zelf staat nergens; we zoeken op zijn SHA-256. Wie deze sleutel heeft, krijgt
 * ook wat de eigenaar op afstand klaarzette (versleuteld voor het sleutelpaar
 * van het programmaatje; base44/shared/opAfstand.js).
 *
 * Met een `geheugen` (ontvangMeting) onthouden we bij een bekende sleutel
 * alleen het id, LEZEN_ONTHOUDEN_MS lang: zo kost een meting elke 5 s één
 * aanroep in plaats van twee. Na "Nieuwe sleutel" werkt de oude dus nog
 * hooguit zo lang; de nieuwe werkt meteen. Een onbekende sleutel is
 * ONBEKEND_ONTHOUDEN_MS lang meteen null, en te veel onbekende sleutels achter
 * elkaar geven een 429 zonder aanroep (voorOpzoeken, de emmer).
 */
export async function huisBijSleutel(db, sleutel, { geheugen = null, nu = Date.now() } = {}) {
  if (!sleutelVorm(sleutel)) return null;
  const hash = await sha256Hex(sleutel);
  if (geheugen) {
    const bekend = uitGeheugen(geheugen, `sleutel:${hash}`, nu);
    if (bekend) return bekend;
    const poort = voorOpzoeken(geheugen, 'sleutel', hash, nu);
    if (poort === 'onbekend') return null;
    if (poort === 'vol') throw remFout();
  }
  const rijen = await db.Huis.filter({ brug_sleutel_hash: hash }, 'id', 2);
  // Twee huizen met dezelfde sleutel kan niet (24 willekeurige bytes); als het toch zo is, geen van beide.
  const huis = rijen.length === 1 ? rijen[0] : null;
  if (geheugen) naOpzoeken(geheugen, 'sleutel', hash, Boolean(huis), nu);
  // Met wat er op afstand klaarstaat (versleuteld, opAfstand.js): zo kost dat geen aanroep extra.
  // Na klaarzetten of wissen ziet ontvangMeting het dus hooguit LEZEN_ONTHOUDEN_MS later.
  // De labels voor het herkennen (herkennen.js) net zo; na labelen ziet het programmaatje ze dus hooguit zo laat.
  if (huis && geheugen) {
    onthoud(
      geheugen,
      `sleutel:${hash}`,
      // De instelling voor de omvormer (1.5.0, omvormerSturen.js) net zo: na aan- of uitzetten hooguit LEZEN_ONTHOUDEN_MS later.
      { id: huis.id, op_afstand: huis.op_afstand ?? null, brug_publiek_vast: huis.brug_publiek_vast ?? null, herkend_labels: huis.herkend_labels ?? null, omvormer_sturen: huis.omvormer_sturen ?? null },
      LEZEN_ONTHOUDEN_MS,
      nu,
    );
  }
  return huis;
}
