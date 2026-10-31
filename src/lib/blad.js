/**
 * Het onderblad (Detail.jsx) gedraagt zich als op een telefoon ("wil
 * gewoon het geopende menu kunnen swipen of wegswipen"):
 *
 * - de pagina erachter staat stil zolang het blad open is;
 * - in het blad zelf scroll je gewoon;
 * - staat het blad bovenaan en veeg je omlaag, dan gaat het mee met je vinger,
 *   en ver genoeg (of snel genoeg) losgelaten gaat het dicht.
 */

/** Pas na zoveel pixels weten we welke kant het op gaat. */
export const RICHTING_PX = 6;

/** Zo ver omlaag (of een kwart van het blad, als dat minder is) en het gaat dicht. */
export const DICHT_PX = 120;

/** Een vlotte veeg sluit ook bij een korte afstand: pixels per milliseconde. */
export const DICHT_SNELHEID = 0.6;

/**
 * Eén stap van een veeg. `staat` is null voor een nieuwe aanraking.
 *   { y }                        het begin (touchstart)
 *   { y, scrollTop }             vinger beweegt (touchmove)
 * Geeft de nieuwe staat: { beginY, beginT, modus: 'wacht' | 'slepen' | 'scrollen', dy }.
 */
export function veegStap(staat, { y, scrollTop = 0, t = 0 }) {
  if (!staat) return { beginY: y, beginT: t, modus: 'wacht', dy: 0 };
  if (staat.modus === 'scrollen') return staat;
  const d = y - staat.beginY;
  if (staat.modus === 'wacht') {
    if (Math.abs(d) < RICHTING_PX) return staat;
    // Omhoog, of het blad is al naar beneden gescrold: gewoon scrollen in het blad.
    if (d < 0 || scrollTop > 0) return { ...staat, modus: 'scrollen' };
  }
  return { ...staat, modus: 'slepen', dy: Math.max(0, d) };
}

/** Losgelaten: dicht, of terug naar boven. */
export function veegDicht(staat, { hoogte, t }) {
  if (!staat || staat.modus !== 'slepen') return false;
  const grens = Math.min(DICHT_PX, Math.max(40, hoogte * 0.25));
  const snelheid = t > staat.beginT ? staat.dy / (t - staat.beginT) : 0;
  return staat.dy >= grens || (staat.dy >= 30 && snelheid >= DICHT_SNELHEID);
}

/**
 * De pagina vastzetten zolang het blad open is, ook op een iPhone (daar helpt
 * overflow: hidden op de body alleen niet). Geeft een functie die alles
 * terugzet, ook de plek waar je was.
 */
export function zetPaginaVast(doc = document, win = window) {
  const y = win.scrollY;
  const stijl = doc.body.style;
  const oud = { position: stijl.position, top: stijl.top, left: stijl.left, right: stijl.right, overflow: stijl.overflow };
  Object.assign(stijl, { position: 'fixed', top: `-${y}px`, left: '0', right: '0', overflow: 'hidden' });
  return () => {
    Object.assign(stijl, oud);
    win.scrollTo(0, y);
  };
}

/** Vanaf deze breedte is het blad een kaart in plaats van een onderblad (index.css, .blad). */
export const KAART_VANAF_PX = 720;
/** Vanaf deze breedte staan foto en kaarten naast elkaar: het blad staat dan rechts, naast de foto (index.css). */
export const NAAST_VANAF_PX = 1024;
/** Ruimte tussen blad en schermrand, en tussen blad en rondje. */
const RAND_PX = 24;
const LUCHT_PX = 16;
/** Kleiner dan dit maken we het blad niet, ook niet als het rondje dan half onder het blad valt. */
const MINSTE_PX = 240;

/**
 * Waar het blad komt op een groot scherm, zodat het het aangetikte rondje
 * niet afdekt (weergave-17). Op een telefoon (< 720 px) gewoon onderaan. Vanaf
 * 1024 px staat het rechts naast de foto (CSS). Daartussen staat de foto in
 * het midden: zit het rondje in de onderste helft van het scherm, dan komt het
 * blad bovenaan, anders onderaan, en nooit hoger dan de ruimte naast het
 * rondje.
 *
 * @param {{ breed: number, hoog: number, rondje: { top: number, bottom: number } | null }} scherm
 * @returns {{ plek: 'onder'|'boven'|'naast', max: number|null }}  max: hoogste hoogte in px, null = zoals de CSS
 */
export function bladPlek({ breed, hoog, rondje }) {
  if (!(breed >= KAART_VANAF_PX)) return { plek: 'onder', max: null };
  if (breed >= NAAST_VANAF_PX) return { plek: 'naast', max: null };
  if (!rondje) return { plek: 'onder', max: null };
  const hoogstens = Math.round(hoog * 0.8);
  const boven = (rondje.top + rondje.bottom) / 2 > hoog / 2;
  const ruimte = boven ? rondje.top - RAND_PX - LUCHT_PX : hoog - rondje.bottom - RAND_PX - LUCHT_PX;
  return { plek: boven ? 'boven' : 'onder', max: Math.min(hoogstens, Math.max(MINSTE_PX, Math.floor(ruimte))) };
}
