/**
 * Welke tekening, waar elk rondje op de foto staat en welke je wilt zien.
 *
 * Plekken zijn procenten van de breedte en hoogte van de foto, zodat ze op
 * een telefoon en een groot scherm op dezelfde plek in het huis vallen.
 *
 *   { tekening, punten: { [sleutel]: { x, y } }, verborgen: [sleutel, …], namen: { [sleutel]: naam },
 *     vermogens: { [sleutel]: max_w }, faseGrens: A|null, zekering: A|null, batterijRol: 'eigen'|'handelen' }
 *
 * Een punt zonder eigen plek krijgt de beginplek die bij de tekening past.
 * Een punt zonder eigen naam heet zoals thuis het noemt (de naam uit
 * instellingen.json van het programmaatje), of Zon, Huis, Batterij, Net.
 * Een maximaal vermogen (Instellingen › Namen) geeft het rondje een ring die
 * meegroeit (src/lib/ringen.js); de batterij heeft er standaard een.
 * De grens en de zekering per fase (ook in Namen) gebruikt src/lib/fasen.js;
 * null is de standaard (20 A en 25 A). De rol van de batterij is voor het
 * Advies (src/lib/advies.js): eigen gebruik (standaard) of handelen.
 * gasStanden (ronde 23): zelf ingevulde gasmeterstanden (src/lib/gasStanden.js).
 */

import { gasStandenUit } from './gasStanden';

/**
 * De tekeningen om uit te kiezen (HuisTekening.jsx); de eerste is de standaard.
 * Een sleutel is 1 tot 30 kleine letters: zo neemt de server hem aan
 * (base44/shared/huizen.js), dus een nieuwe tekening vraagt daar niets.
 */
export const TEKENINGEN = Object.freeze([
  { sleutel: 'dierenverblijf', naam: 'Met dierenverblijf' },
  { sleutel: 'schuur', naam: 'Met schuur' },
  { sleutel: 'huis', naam: 'Alleen het huis' },
  { sleutel: 'garage', naam: 'Vrijstaand met garage en carport' },
]);

const tekeningUit = (waarde) => (TEKENINGEN.some((t) => t.sleutel === waarde) ? waarde : TEKENINGEN[0].sleutel);

export const LEGE_OPSTELLING = Object.freeze({ tekening: TEKENINGEN[0].sleutel, punten: {}, verborgen: [], namen: {}, vermogens: {}, faseGrens: null, zekering: null, batterijRol: 'eigen', gasStanden: [], zonFase: null });

/** Zo lang mag een eigen naam zijn, net als de naam van een omgeving. */
export const NAAM_MAX = 40;

/** Een maximaal vermogen is 100 tot 100.000 W, net als op de server (base44/shared/huizen.js). */
export const MAX_W = Object.freeze({ laag: 100, hoog: 100_000 });
/** Zonder eigen maximum: wat een SolarFlow 2400 AC hooguit laadt of levert. */
export const BATTERIJ_STANDAARD_W = 2400;

/** Een bruikbaar maximum, afgerond op hele watt, of null. */
export function geldigMax(w) {
  return typeof w === 'number' && Number.isFinite(w) && w >= MAX_W.laag && w <= MAX_W.hoog ? Math.round(w) : null;
}

/**
 * Beginplekken bij de standaardtekening (met dierenverblijf, en ook bij de
 * schuur en alleen het huis): de zon op de panelen van het huis, het huis op
 * de gevel, de batterij rechts ernaast (bij het dierenverblijf in de carport),
 * het net rechtsonder. In huis A staan ze hier al sinds de eerste tekening.
 */
export const KERN_PLEK = Object.freeze({
  zon: { x: 40, y: 38 },
  huis: { x: 40, y: 62 },
  batterij: { x: 64, y: 80 },
  net: { x: 88, y: 86 },
});

/** Zonder tweede plek met panelen komt een volgende zonnebron in de lucht. */
const IN_DE_LUCHT = [
  { x: 16, y: 26 },
  { x: 64, y: 22 },
];

/** De apparaten zitten links in het huis, waar geen andere lijnen langs lopen. */
const APPARAAT_PLEKKEN = [
  { x: 28, y: 55 },
  { x: 24, y: 74 },
  { x: 9, y: 62 },
  { x: 50, y: 93 },
  { x: 9, y: 44 },
];

/**
 * Het dierenverblijf staat achter het huis (HuisTekening.jsx): het rondje op
 * zijn panelen, links, waar het onder het huis vandaan komt. Het heeft een
 * eigen kWh-meter en de kabel komt bij de meterkast binnen
 * (31-10-2026): de lijn loopt daarom niet dwars over het huis maar om het huis
 * heen, langs de goot (de witte rand onder het dak, y 48,5–51,2%) tot boven de
 * meterkast en dan omlaag het huis in.
 */
export const DIERENVERBLIJF_PLEK = Object.freeze({
  x: 69,
  y: 50,
  route: Object.freeze({ naar: 'huis', langs: Object.freeze([Object.freeze({ x: 49, y: 50 })]) }),
});

/**
 * In huis B (tekening garage) liggen de panelen op de achterkant van het dak: het
 * rondje boven het huis. Een lijn komt van achter het huis (de nok) omhoog naar
 * het rondje (`aanloop`), en vandaar loopt de stroom voor het huis omlaag naar
 * de meterkast (het huis-rondje), zoals de andere stroom: duidelijk, geen
 * doorkijkje (31-10-2026).
 */
export const PANELEN_ACHTER_PLEK = Object.freeze({
  // Iets links van het midden: zo blijft het kaartje erboven vrij van het geldbordje rechtsboven.
  x: 44,
  y: 13,
  route: Object.freeze({
    naar: 'huis',
    // Eerst van achter het huis (de nok, waar de panelen aan de andere kant liggen) omhoog naar het rondje …
    // Hij begint op het dak (achter de nok, dus onzichtbaar: `achter` is het dak in procenten) en komt boven de nok tevoorschijn.
    aanloop: Object.freeze({
      x: 63,
      y: 36,
      achter: Object.freeze([
        [32.5, 50.1],
        [94.5, 50.1],
        [80, 26.4],
        [47, 26.4],
      ]),
    }),
    // … dan voor het huis recht omlaag tot de goot en schuin naar de meterkast.
    langs: Object.freeze([Object.freeze({ x: 44, y: 50 })]),
  }),
});

/**
 * Beginplekken per tekening (HuisTekening.jsx, staand 4:5). Bij `zon` eerst
 * de panelen op het huis, dan die op het dierenverblijf of de schuur, daarna
 * in de lucht.
 *
 * Een beginplek kan een `route` hebben ({ naar, langs: [{ x, y }, …], aanloop? }, in
 * procenten): dan loopt de lijn naar `naar` langs die punten (route() in
 * src/lib/vorm.js) in plaats van in een boog. Met `aanloop` ({ x, y }) komt er
 * ook een lijn van die plek naar het rondje zelf (waar de stroom vandaan komt). Alleen zolang beide rondjes op
 * hun beginplek staan: wie er een verplaatst (Indelen), krijgt weer de
 * gewone boog.
 */
export const BEGINPLEKKEN = Object.freeze({
  dierenverblijf: { ...KERN_PLEK, zon: [KERN_PLEK.zon, DIERENVERBLIJF_PLEK, ...IN_DE_LUCHT], apparaten: APPARAAT_PLEKKEN },
  schuur: { ...KERN_PLEK, zon: [KERN_PLEK.zon, { x: 84, y: 59 }, ...IN_DE_LUCHT], apparaten: APPARAAT_PLEKKEN },
  huis: { ...KERN_PLEK, zon: [KERN_PLEK.zon, ...IN_DE_LUCHT], apparaten: APPARAAT_PLEKKEN },
  // Vrijstaand: de panelen liggen op de achterkant van het dak
  // (31-10-2026), dus het zon-rondje staat boven het huis in de lucht en de
  // lijn loopt van achter het huis recht over het dak naar het huis (de
  // meterkast) bij de voordeur. De batterij in de garage; de apparaten rechts
  // en links in huis.
  garage: {
    zon: [PANELEN_ACHTER_PLEK, ...IN_DE_LUCHT],
    huis: { x: 52, y: 64 },
    batterij: { x: 14, y: 77 },
    net: { x: 88, y: 86 },
    apparaten: [
      { x: 72, y: 55 },
      { x: 36, y: 57 },
      { x: 74, y: 71 },
      { x: 32, y: 92 },
      { x: 88, y: 62 },
    ],
  },
});

function plekUit(rij, i, reserve) {
  if (i < rij.length) return rij[i];
  const rest = i - rij.length;
  return { x: 12 + (rest % 5) * 19, y: reserve };
}

const RAND = 4;
const binnen = (v) => Math.min(100 - RAND, Math.max(RAND, Math.round(v * 10) / 10));

function geldigePlek(plek) {
  if (!plek || !Number.isFinite(plek.x) || !Number.isFinite(plek.y)) return null;
  return { x: binnen(plek.x), y: binnen(plek.y) };
}

/** Een beginplek als plek voor een punt: x en y, en de route als die er is. */
function beginplek(plek) {
  return plek.route ? { x: plek.x, y: plek.y, route: plek.route } : { x: plek.x, y: plek.y };
}

/** De sleutel van het blad met alle plekken met panelen samen (de Zon-tegel op Nu). */
export const ZON_SAMEN = 'zon-samen';

/**
 * Bij panelen op twee of meer plekken: één punt "Zon" voor ze allemaal samen,
 * voor het blad achter de Zon-tegel op Nu (die toont ook het totaal). Het staat
 * niet op de foto; daar heeft elke plek zijn eigen rondje. Eén plek: null.
 */
export function zonSamen(punten) {
  const plekken = (punten ?? []).filter((p) => p.soort === 'zon');
  if (plekken.length < 2) return null;
  return { sleutel: ZON_SAMEN, naam: 'Zon', soort: 'zon', plekken: plekken.map((p) => p.sleutel), zichtbaar: false };
}

/**
 * Alle punten die bij deze stand horen, met plek, zichtbaarheid en naam. Een
 * meter die thuis niet bestaat (null in de stand) krijgt geen punt; het huis
 * altijd. Panelen op meer plekken (stand.zonnen) krijgen elk een eigen zon-punt.
 *
 * Elk punt heeft `naam` (wat overal in de app staat), `bronNaam` (de naam van
 * thuis) en `eigenNaam` (wat de eigenaar in de app intypte, of ''). Bij de
 * zon en de batterij ook `eigenMax` (wat de eigenaar invulde, of null) en
 * `max_w` (wat telt: dat, of bij de batterij BATTERIJ_STANDAARD_W).
 * Een punt op een beginplek met een route (BEGINPLEKKEN) heeft ook `route`,
 * zolang het punt waar die heen gaat er is en ook op zijn beginplek staat.
 */
export function puntenVoor(opstelling, stand) {
  const plekken = opstelling?.punten ?? {};
  const verborgen = new Set(opstelling?.verborgen ?? []);
  const namen = opstelling?.namen ?? {};
  const vermogens = opstelling?.vermogens ?? {};
  const lijst = [];
  const voeg = (punt, standaard) => {
    const eigenNaam = typeof namen[punt.sleutel] === 'string' ? namen[punt.sleutel] : '';
    const metMax = punt.soort === 'zon' || punt.soort === 'batterij';
    const eigenMax = metMax ? geldigMax(vermogens[punt.sleutel]) : null;
    lijst.push({
      ...punt,
      naam: eigenNaam.trim() || punt.naam,
      bronNaam: punt.naam,
      eigenNaam,
      ...(metMax ? { eigenMax, max_w: eigenMax ?? (punt.soort === 'batterij' ? BATTERIJ_STANDAARD_W : null) } : {}),
      ...(geldigePlek(plekken[punt.sleutel]) ?? beginplek(standaard)),
      zichtbaar: !verborgen.has(punt.sleutel),
    });
  };

  const begin = BEGINPLEKKEN[tekeningUit(opstelling?.tekening)];
  const zonnen = (Array.isArray(stand?.zonnen) ? stand.zonnen : []).filter((z) => z?.sleutel);
  if (zonnen.length) {
    zonnen.forEach((z, i) => voeg({ sleutel: z.sleutel, naam: z.naam || 'Zon', soort: 'zon' }, plekUit(begin.zon, i, 8)));
  } else if (stand?.zon_w != null) {
    voeg({ sleutel: 'zon', naam: 'Zon', soort: 'zon' }, begin.zon[0]);
  }
  voeg({ sleutel: 'huis', naam: 'Huis', soort: 'huis' }, begin.huis);
  if (stand?.batterij_w != null) voeg({ sleutel: 'batterij', naam: 'Batterij', soort: 'batterij' }, begin.batterij);
  if (stand?.net_w != null) voeg({ sleutel: 'net', naam: 'Net', soort: 'net' }, begin.net);
  (stand?.apparaten ?? []).forEach((a, i) =>
    voeg({ sleutel: a.sleutel, naam: a.naam || 'Apparaat', soort: 'apparaat', icoon: a.soort }, plekUit(begin.apparaten, i, 93)),
  );
  // Een route past alleen bij de beginplek aan de andere kant: staat dat punt ergens anders (of is het er niet), dan een gewone boog.
  return lijst.map((punt) => {
    if (!punt.route) return punt;
    const doel = punt.route.naar;
    if (lijst.some((p) => p.sleutel === doel) && !geldigePlek(plekken[doel])) return punt;
    const { route: _route, ...zonder } = punt;
    return zonder;
  });
}

export function verplaats(opstelling, sleutel, x, y) {
  return {
    ...LEGE_OPSTELLING,
    ...opstelling,
    punten: { ...(opstelling?.punten ?? {}), [sleutel]: { x: binnen(x), y: binnen(y) } },
  };
}

export function wisselZichtbaar(opstelling, sleutel) {
  const verborgen = new Set(opstelling?.verborgen ?? []);
  if (verborgen.has(sleutel)) verborgen.delete(sleutel);
  else verborgen.add(sleutel);
  return { ...LEGE_OPSTELLING, ...opstelling, verborgen: [...verborgen] };
}

export function beginplekken(opstelling) {
  return { ...LEGE_OPSTELLING, ...opstelling, punten: {} };
}

/**
 * Een eigen naam voor een rondje, zoals de eigenaar hem intypt (spaties
 * blijven staan tot het bewaren). Leeg = weer de naam van thuis.
 */
export function zetNaam(opstelling, sleutel, naam) {
  const namen = { ...(opstelling?.namen ?? {}) };
  const tekst = typeof naam === 'string' ? naam.slice(0, NAAM_MAX) : '';
  if (tekst.trim()) namen[sleutel] = tekst;
  else delete namen[sleutel];
  return { ...LEGE_OPSTELLING, ...opstelling, namen };
}

/**
 * Het maximale vermogen van een rondje. Alleen een bruikbaar getal blijft
 * staan (de invoer in Namen geeft pas door als het klopt); leeg of null haalt
 * het weg: dan geen ring bij de zon, en bij de batterij weer de standaard.
 */
export function zetVermogen(opstelling, sleutel, w) {
  const vermogens = { ...(opstelling?.vermogens ?? {}) };
  const max = geldigMax(w);
  if (max === null) delete vermogens[sleutel];
  else vermogens[sleutel] = max;
  return { ...LEGE_OPSTELLING, ...opstelling, vermogens };
}

/** Een grens of zekering per fase is 1 tot 200 A, net als op de server (base44/shared/huizen.js). */
export const AMPERE = Object.freeze({ laag: 1, hoog: 200 });

/** Een bruikbare stroom in ampère, op een tiende, of null. */
export function geldigeAmpere(a) {
  return typeof a === 'number' && Number.isFinite(a) && a >= AMPERE.laag && a <= AMPERE.hoog ? Math.round(a * 10) / 10 : null;
}

/** De grens ('faseGrens') of de zekering ('zekering') per fase; leeg of null: weer de standaard. */
export function zetFase(opstelling, veld, a) {
  if (veld !== 'faseGrens' && veld !== 'zekering') return opstelling;
  return { ...LEGE_OPSTELLING, ...opstelling, [veld]: geldigeAmpere(a) };
}

/** De rollen van de batterij voor het Advies, zoals op de server (BATTERIJ_ROLLEN in base44/shared/huizen.js); de eerste is de standaard. */
export const BATTERIJ_ROLLEN = Object.freeze([
  { sleutel: 'eigen', naam: 'Eigen gebruik' },
  { sleutel: 'handelen', naam: 'Handelen' },
]);
const batterijRolUit = (rol) => (BATTERIJ_ROLLEN.some((r) => r.sleutel === rol) ? rol : BATTERIJ_ROLLEN[0].sleutel);

/** De rol van de batterij in het Advies: 'eigen' of 'handelen'; iets anders wordt eigen gebruik. Alleen advies: de app stuurt niets. */
export function zetBatterijRol(opstelling, rol) {
  return { ...LEGE_OPSTELLING, ...opstelling, batterijRol: batterijRolUit(rol) };
}

/** Op welke fase de zonnemeter zit (1, 2 of 3; iets anders: niet bekend). Alleen om de spanning naast die van dezelfde fase te zetten. */
const zonFaseUit = (f) => ([1, 2, 3].includes(f) ? f : null);
export function zetZonFase(opstelling, fase) {
  return { ...LEGE_OPSTELLING, ...opstelling, zonFase: zonFaseUit(fase) };
}

/** Een andere tekening: de rondjes gaan naar de beginplekken die daarbij horen. */
export function kiesTekening(opstelling, tekening) {
  const nieuw = tekeningUit(tekening);
  if (nieuw === tekeningUit(opstelling?.tekening)) return opstelling;
  return { ...LEGE_OPSTELLING, ...opstelling, tekening: nieuw, punten: {} };
}

/**
 * Een opstelling uit opslag (dit toestel of Base44) terug naar de vorm
 * hierboven. Wat er niet in hoort, valt weg; kapotte invoer geeft de lege.
 * Base44 bewaart plekken en namen als lijst ([{ sleutel, x, y }],
 * [{ sleutel, naam }]), dit toestel als object; beide gaan erin.
 */
export function uitOpslag(ruw) {
  if (!ruw || typeof ruw !== 'object') return { ...LEGE_OPSTELLING };
  const punten = {};
  const bron = Array.isArray(ruw.punten)
    ? ruw.punten.map((p) => [p?.sleutel, p])
    : Object.entries(ruw.punten ?? {});
  for (const [sleutel, plek] of bron) {
    const geldig = geldigePlek(plek);
    if (typeof sleutel === 'string' && sleutel && geldig) punten[sleutel] = geldig;
  }
  const verborgen = Array.isArray(ruw.verborgen) ? ruw.verborgen.filter((s) => typeof s === 'string' && s) : [];
  const namen = {};
  const naamBron = Array.isArray(ruw.namen)
    ? ruw.namen.map((n) => [n?.sleutel, n?.naam])
    : ruw.namen && typeof ruw.namen === 'object'
      ? Object.entries(ruw.namen)
      : [];
  for (const [sleutel, naam] of naamBron) {
    const schoon = typeof naam === 'string' ? naam.trim().slice(0, NAAM_MAX) : '';
    if (typeof sleutel === 'string' && sleutel && schoon) namen[sleutel] = schoon;
  }
  const vermogens = {};
  const maxBron = Array.isArray(ruw.vermogens)
    ? ruw.vermogens.map((v) => [v?.sleutel, v?.max_w])
    : ruw.vermogens && typeof ruw.vermogens === 'object'
      ? Object.entries(ruw.vermogens)
      : [];
  for (const [sleutel, w] of maxBron) {
    const max = geldigMax(w);
    if (typeof sleutel === 'string' && sleutel && max !== null) vermogens[sleutel] = max;
  }
  return {
    tekening: tekeningUit(ruw.tekening),
    punten,
    verborgen,
    namen,
    vermogens,
    // Base44 als fase_grens_a en zekering_a, dit toestel zoals hier.
    faseGrens: geldigeAmpere(ruw.faseGrens ?? ruw.fase_grens_a),
    zekering: geldigeAmpere(ruw.zekering ?? ruw.zekering_a),
    batterijRol: batterijRolUit(ruw.batterijRol ?? ruw.batterij_rol),
    // Zelf ingevulde gasmeterstanden (Instellingen › Gas, ronde 23). Niet in naarRij: die bewaart de actie gasStand apart.
    gasStanden: gasStandenUit(ruw.gasStanden ?? ruw.gas_standen),
    // Op welke fase de zonnemeter zit (1.5.0, Instellingen › Namen); niet bekend: null.
    zonFase: zonFaseUit(ruw.zonFase ?? ruw.zon_fase),
  };
}

/** De vorm waarin Base44 hem bewaart (zie base44/entities/Opstelling.jsonc). */
export function naarRij(opstelling) {
  const { tekening, punten, verborgen, namen, vermogens, faseGrens, zekering, batterijRol, zonFase } = uitOpslag(opstelling);
  return {
    tekening,
    punten: Object.entries(punten).map(([sleutel, { x, y }]) => ({ sleutel, x, y })),
    verborgen,
    namen: Object.entries(namen).map(([sleutel, naam]) => ({ sleutel, naam })),
    vermogens: Object.entries(vermogens).map(([sleutel, max_w]) => ({ sleutel, max_w })),
    // Null wist de eigen waarde; een oudere functie laat deze twee velden liggen.
    fase_grens_a: faseGrens,
    zekering_a: zekering,
    // Een oudere functie laat dit veld ook liggen (dan blijft het advies op eigen gebruik).
    batterij_rol: batterijRol,
    // 1.5.0; een oudere functie laat het liggen.
    zon_fase: zonFase,
  };
}
