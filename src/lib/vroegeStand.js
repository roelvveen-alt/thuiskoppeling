import { base44, VOORBEELD } from '@/api/base44Client';
import { LOKAAL_LAATSTE_HUIS, vraag } from '@/api/huis';
import { leesLokaal, schrijfLokaal } from './lokaal';

/**
 * De eerste cijfers zo vroeg mogelijk (prestaties-18). Bij het openen vraagt
 * de site eerst wie je bent en welke huizen je hebt ('mijn'), en pas daarna
 * de stand van dat huis. Dat zijn twee keer heen en terug voordat er een
 * getal staat.
 *
 * Daarom: als dit toestel weet welk huis het de vorige keer opende, vraagt
 * het de stand daarvan meteen, nog vóór 'mijn' (het loket doet ze na elkaar,
 * in deze volgorde). Komt na 'mijn' hetzelfde huis op het scherm, dan neemt
 * useStand dat antwoord als zijn eerste lezing: geen vraag extra, en de
 * cijfers staan er tegelijk met het scherm. Een ander huis (de beheerder
 * wisselde, of iemand anders logde in): dan vervalt het, één vraag extra.
 *
 * Rechten: de functie toetst de stand zoals altijd (een huis waar je niet
 * (meer) in mag, geeft dezelfde 404 als een dat niet bestaat). Zonder token
 * vragen we niets: dan kan het alleen 401 worden, en 'mijn' stuurt naar het
 * inloggen. Uitloggen vergeet het huis (src/api/huis.js).
 */

export { LOKAAL_LAATSTE_HUIS };
/** Ouder dan dit (een trage 'mijn'): toch niet meer gebruiken, gewoon opnieuw vragen. */
export const VROEG_GELDIG_MS = 30_000;

let vroeg = null;
let begonnen = false;

/** Het huis dat nu open is: de volgende keer vraagt dit toestel zijn stand meteen. */
export function onthoudLaatsteHuis(huisId) {
  if (VOORBEELD || !huisId || leesLokaal(LOKAAL_LAATSTE_HUIS) === huisId) return;
  schrijfLokaal(LOKAAL_LAATSTE_HUIS, huisId);
}

/** Eén keer per pagina, vóór 'mijn': de stand van het huis van de vorige keer. */
export function vraagVroegeStand({ klok = Date.now } = {}) {
  if (VOORBEELD || begonnen) return;
  begonnen = true;
  const huisId = leesLokaal(LOKAAL_LAATSTE_HUIS);
  if (typeof huisId !== 'string' || !huisId) return;
  if (typeof base44?.auth?.heeftToken === 'function' && !base44.auth.heeftToken()) return;
  const belofte = vraag('stand', { huis_id: huisId }, { herhalen: false });
  // Niemand die erop wacht (een ander huis): dan geen "unhandled rejection".
  belofte.catch(() => {});
  vroeg = { huisId, belofte, tijd: klok() };
}

/**
 * Voor de eerste lezing van useStand: de vroege vraag, als die voor dit huis
 * was en nog vers genoeg. Daarna is hij op (één keer te nemen).
 */
export function neemVroegeStand(huisId, { klok = Date.now } = {}) {
  const v = vroeg;
  vroeg = null;
  if (!v || v.huisId !== huisId || klok() - v.tijd > VROEG_GELDIG_MS) return null;
  return v.belofte;
}

/** Alleen voor de tests: alsof de pagina net opent. */
export function vergeetVroegeStand() {
  vroeg = null;
  begonnen = false;
}
