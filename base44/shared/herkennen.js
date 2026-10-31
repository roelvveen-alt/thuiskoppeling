/**
 * Herkennen welk apparaat stroom gebruikt (programmaatje 0.11.0, brug/herkennen.mjs).
 *
 * Het programmaatje raadt; de server bewaart alleen wat het stuurt (Meting.herkend)
 * en wat de gebruiker aanwees (Huis.herkend_labels), en geeft die labels terug aan
 * het programmaatje van dat huis. De app bedient niets: dit is alleen kijken.
 *
 *   Meting.herkend    mild nagekeken (herkendUit): wat niet klopt valt weg, de meting
 *                     niet. Gaat mee als het verandert en eens per minuut; zonder blijft
 *                     het vorige staan, met `moment` erbij zodat de site ziet hoe oud.
 *   Huis.herkend_labels  "Klopt" of "Dat was …" per gebeurtenis of per groep
 *                     onbekenden; alleen de eigenaar (en de beheerder) labelt (actie
 *                     labelHerkend, huisVoor met alleenEigenaar). Hooguit HOOGSTENS_LABELS.
 *   Dag.apparaten_kwh per dag per apparaat de kWh en keer (programmaatje 0.12.0, in
 *                     meting.dag.apparaten), mild nagekeken (dagApparatenUit); de
 *                     basis van die dag in Dag.basis_kwh. Alleen ontvangMeting schrijft.
 *   terug             in het antwoord van ontvangMeting (herkend_labels), alleen als het
 *                     programmaatje zegt dat het labels kent (brug.herkent) en er een
 *                     nieuwere is dan zijn brug.labels_op. Zonder aanroep extra: de labels
 *                     zitten in de Huis-rij die bij de sleutel toch al onthouden is.
 *   vragen (1.4.0)    een terugkerende groep (onbekend) draagt zijn handtekening mee: vorm,
 *                     de laatste begintijden, hoe vaak vandaag en per dag; en `kennis`: wat
 *                     het programmaatje kent en hoe zeker. De site vraagt de eigenaar "Wat is
 *                     het?". "Weet ik niet" of "Later" is een label { id, later: true } in
 *                     Huis.herkend_labels: het programmaatje krijgt dat nooit (labelsVoorBrug),
 *                     de stand zet `later` bij die groep (herkendVoorSite), een week lang.
 */
import { schoon } from './tekst.js';

/** Dezelfde lijst als brug/herkennen.mjs en src/lib/herkennen.js (base44/tests/herkennen.test.js). */
export const SOORTEN = Object.freeze([
  'koelkast',
  'vriezer',
  'wasmachine',
  'vaatwasser',
  'droger',
  'strijkijzer',
  'stofzuiger',
  'waterkoker',
  'oven',
  'airfryer',
  'magnetron',
  'kookplaat',
  'fohn',
  'spa',
  'boiler',
  'pomp',
  'warmtepomp',
  'auto',
  'anders',
]);
export const DELEN = Object.freeze(['verwarmt', 'trommel', 'centrifuge']);
/** puls en cyclus (0.11.0); traag, piek, golf en vlak sinds 1.4.0 (brug/herkennen.mjs, VORMEN). */
export const VORMEN = Object.freeze(['puls', 'cyclus', 'traag', 'piek', 'golf', 'vlak']);
const DAGDELEN = new Set(['nacht', 'ochtend', 'middag', 'avond']);
export const HOOGSTENS_LABELS = 100;
const HOOGSTENS_NU = 10;
const HOOGSTENS_RECENT = 20;
const HOOGSTENS_ONBEKEND = 5;
const HOOGSTENS_WEEK = 16;
/** Zoveel begintijden per groep (brug: HOOGSTENS_TIJDEN) en zoveel apparaten in kennis (HOOGSTENS_KENNIS). */
const HOOGSTENS_TIJDEN = 4;
const HOOGSTENS_KENNIS = 12;
/** Zo lang vraagt de app niet opnieuw naar een groep na "Weet ik niet" of "Later". */
export const LATER_MS = 7 * 86_400_000;
/** Per dag hooguit zoveel apparaten (brug/herkennen.mjs, HOOGSTENS_DAG_APPARATEN). */
export const HOOGSTENS_DAG_APPARATEN = 30;
const GRENS_W = 100_000;

const ID_VORM = /^[a-z0-9-]{1,24}$/;
const SLEUTEL_VORM = /^[a-zA-Z0-9._:-]{1,60}$/;
const ISO_MOMENT = /^\d{4}-\d{2}-\d{2}T[0-9:.+\-Z]{5,30}$/;
const moment = (t) => typeof t === 'string' && t.length <= 40 && ISO_MOMENT.test(t) && Number.isFinite(Date.parse(t));
const goed = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const heel = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

/** Wat een regel in nu, recent of een label gemeen heeft; wat niet klopt valt weg, zonder id of vermogen: null. */
function deelUit(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r) || typeof r.id !== 'string' || !ID_VORM.test(r.id) || !goed(r.w, 0, GRENS_W)) return null;
  const naam = schoon(r.naam, 40);
  return {
    id: r.id,
    ...(SOORTEN.includes(r.soort) ? { soort: r.soort } : {}),
    ...(naam ? { naam } : {}),
    ...(DELEN.includes(r.deel) ? { deel: r.deel } : {}),
    w: Math.round(r.w),
    ...([1, 2, 3].includes(r.fase) ? { fase: r.fase } : {}),
    ...(VORMEN.includes(r.vorm) ? { vorm: r.vorm } : {}),
  };
}

function regelUit(r, tijden) {
  const d = deelUit(r);
  if (!d || !goed(r.zeker, 0, 1)) return null;
  for (const t of tijden) if (!moment(r[t])) return null;
  return {
    ...d,
    zeker: Math.round(r.zeker * 100) / 100,
    ...Object.fromEntries(tijden.map((t) => [t, r[t]])),
    ...(r.bevestigd === true ? { bevestigd: true } : {}),
    ...(typeof r.onbekend === 'string' && /^[A-Z]$/.test(r.onbekend) ? { onbekend: r.onbekend } : {}),
  };
}

const lijstUit = (lijst, hoogstens, maak) =>
  (Array.isArray(lijst) ? lijst.slice(0, hoogstens * 2) : [])
    .map(maak)
    .filter(Boolean)
    .slice(0, hoogstens);

function onbekendUit(c) {
  if (!c || typeof c !== 'object' || typeof c.id !== 'string' || !ID_VORM.test(c.id) || typeof c.letter !== 'string' || !/^[A-Z]$/.test(c.letter)) return null;
  if (!goed(c.w, 0, GRENS_W) || !goed(c.duur_s, 0, 86_400) || !heel(c.n, 1, 100_000)) return null;
  return {
    id: c.id,
    letter: c.letter,
    w: Math.round(c.w),
    duur_s: Math.round(c.duur_s),
    n: c.n,
    ...([1, 2, 3].includes(c.fase) ? { fase: c.fase } : {}),
    ...(DAGDELEN.has(c.dagdeel) ? { dagdeel: c.dagdeel } : {}),
    ...(heel(c.dag, 0, 6) ? { dag: c.dag } : {}),
    ...(SOORTEN.includes(c.vermoeden) ? { vermoeden: c.vermoeden } : {}),
    // De handtekening voor de vraag (1.4.0); een oudere brug stuurt ze niet.
    ...(VORMEN.includes(c.vorm) ? { vorm: c.vorm } : {}),
    ...(() => {
      const tijden = (Array.isArray(c.tijden) ? c.tijden.slice(-HOOGSTENS_TIJDEN) : []).filter(moment);
      return tijden.length ? { tijden } : {};
    })(),
    ...(heel(c.vandaag, 1, 100_000) ? { vandaag: c.vandaag } : {}),
    ...(goed(c.per_dag, 0, 10_000) ? { per_dag: Math.round(c.per_dag * 10) / 10 } : {}),
  };
}

/** Wat het programmaatje kent (1.4.0): { apparaten: [{ soort, naam?, zeker, aangewezen?, basis? }] }, of null. */
function kennisUit(k) {
  if (!k || typeof k !== 'object' || Array.isArray(k) || !Array.isArray(k.apparaten)) return null;
  const apparaten = lijstUit(k.apparaten, HOOGSTENS_KENNIS, (a) => {
    if (!a || typeof a !== 'object' || !SOORTEN.includes(a.soort) || !goed(a.zeker, 0, 1)) return null;
    const naam = schoon(a.naam, 40);
    return {
      soort: a.soort,
      ...(naam ? { naam } : {}),
      zeker: Math.round(a.zeker * 100) / 100,
      ...(heel(a.aangewezen, 1, 100_000) ? { aangewezen: a.aangewezen } : {}),
      ...(a.basis === true ? { basis: true } : {}),
    };
  });
  return { apparaten };
}

function weekRegelUit(a) {
  if (!a || typeof a !== 'object' || !heel(a.keer, 0, 100_000) || !goed(a.kwh, 0, 100_000)) return null;
  const soort = SOORTEN.includes(a.soort) ? a.soort : null;
  const sleutel = typeof a.sleutel === 'string' && SLEUTEL_VORM.test(a.sleutel) ? a.sleutel : null;
  if (!soort && !sleutel) return null;
  const naam = schoon(a.naam, 40);
  return {
    ...(soort ? { soort } : {}),
    ...(sleutel ? { sleutel } : {}),
    ...(naam ? { naam } : {}),
    keer: a.keer,
    kwh: Math.round(a.kwh * 10) / 10,
    ...(DAGDELEN.has(a.dagdeel) ? { dagdeel: a.dagdeel } : {}),
    ...(heel(a.dag, 0, 6) ? { dag: a.dag } : {}),
  };
}

/**
 * Per apparaat van één dag (meting.dag.apparaten, programmaatje 0.12.0), mild:
 * een regel zonder goede sleutel, kWh of keer valt weg, een sleutel die er al
 * stond ook; de rest blijft, meeste kWh eerst, hooguit HOOGSTENS_DAG_APPARATEN.
 * Elke regel: { sleutel, soort?, naam?, kwh, keer, gemeten }. gemeten: een
 * eigen meter (precies), anders herkend (een schatting). Geen lijst: null.
 */
export function dagApparatenUit(lijst) {
  if (!Array.isArray(lijst)) return null;
  const gezien = new Set();
  const uit = [];
  for (const a of lijst.slice(0, HOOGSTENS_DAG_APPARATEN * 2)) {
    if (!a || typeof a !== 'object' || typeof a.sleutel !== 'string' || !SLEUTEL_VORM.test(a.sleutel) || gezien.has(a.sleutel)) continue;
    if (!goed(a.kwh, 0, 2000) || !heel(a.keer, 0, 100_000)) continue;
    gezien.add(a.sleutel);
    const gemeten = a.gemeten === true;
    const naam = schoon(a.naam, 40);
    uit.push({
      sleutel: a.sleutel,
      ...(!gemeten && SOORTEN.includes(a.soort) ? { soort: a.soort } : {}),
      ...(naam ? { naam } : {}),
      kwh: Math.round(a.kwh * 1000) / 1000,
      keer: a.keer,
      gemeten,
    });
  }
  return uit.sort((a, b) => b.kwh - a.kwh).slice(0, HOOGSTENS_DAG_APPARATEN);
}

/** De basis van een dag in kWh (meting.dag.basis_kwh, 0.12.0), of null. */
export const basisKwhUit = (v) => (goed(v, 0, 2000) ? Math.round(v * 1000) / 1000 : null);

/**
 * Meting.herkend zoals het programmaatje het stuurt, mild: een regel die niet
 * klopt valt weg, de rest blijft. Zonder basis en zonder een enkele goede
 * regel: null (dan gaat het veld niet mee, en blijft het vorige staan).
 * @param {unknown} h
 * @param {Date} nu  ontvangsttijd: wordt herkend.moment
 */
export function herkendUit(h, nu) {
  if (!h || typeof h !== 'object' || Array.isArray(h)) return null;
  const b = h.basis;
  const basis =
    b && typeof b === 'object' && goed(b.w, 0, GRENS_W)
      ? { w: Math.round(b.w), ...(goed(b.altijd_w, 0, GRENS_W) ? { altijd_w: Math.round(b.altijd_w) } : {}), warmtepomp: b.warmtepomp === true }
      : null;
  const uit = {
    moment: nu.toISOString(),
    nu: lijstUit(h.nu, HOOGSTENS_NU, (r) => regelUit(r, ['sinds'])),
    recent: lijstUit(h.recent, HOOGSTENS_RECENT, (r) => regelUit(r, ['van', 'tot'])),
    onbekend: lijstUit(h.onbekend, HOOGSTENS_ONBEKEND, onbekendUit),
    ...(basis ? { basis } : {}),
  };
  const w = h.week;
  if (w && typeof w === 'object' && typeof w.van === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(w.van)) {
    uit.week = { van: w.van, apparaten: lijstUit(w.apparaten, HOOGSTENS_WEEK, weekRegelUit) };
  }
  const kennis = kennisUit(h.kennis);
  if (kennis) uit.kennis = kennis;
  if (!basis && !uit.nu.length && !uit.recent.length) return null;
  return uit;
}

/**
 * Eén label zoals de site het stuurt (actie labelHerkend); klopt het niet: null.
 * `{ id, later: true }` (1.4.0): "Weet ik niet" of "Later" op een vraag; alleen het id.
 */
export function labelUit(ruw) {
  if (ruw && typeof ruw === 'object' && ruw.later === true) return typeof ruw.id === 'string' && ID_VORM.test(ruw.id) ? { id: ruw.id, later: true } : null;
  const d = deelUit(ruw);
  if (!d || !d.soort || d.w < 1) return null;
  if (d.soort === 'anders' && !d.naam) return null;
  return {
    ...d,
    ...(goed(ruw.duur_s, 1, 86_400) ? { duur_s: Math.round(ruw.duur_s) } : {}),
    ...(SOORTEN.includes(ruw.was) ? { was: ruw.was } : {}),
    ...(heel(ruw.aantal, 2, 500) ? { aantal: ruw.aantal } : {}),
  };
}

/** Wat er in Huis.herkend_labels staat, schoon: per id het nieuwste, op volgorde van `op`, de laatste HOOGSTENS_LABELS. */
export function labelsVan(huis) {
  const perId = new Map();
  for (const l of Array.isArray(huis?.herkend_labels) ? huis.herkend_labels : []) {
    const label = labelUit(l);
    if (!label || !moment(l.op)) continue;
    const oud = perId.get(label.id);
    if (!oud || oud.op <= l.op) perId.set(label.id, { ...label, op: l.op });
  }
  return [...perId.values()].sort((a, b) => (a.op < b.op ? -1 : a.op > b.op ? 1 : 0)).slice(-HOOGSTENS_LABELS);
}

/** Het nieuwe Huis.herkend_labels: dit label erbij (een oud label met hetzelfde id gaat weg), de oudste eruit boven de grens. */
export function metLabel(huis, label, op) {
  return [...labelsVan(huis).filter((l) => l.id !== label.id), { ...label, op }].slice(-HOOGSTENS_LABELS);
}

/**
 * Wat ontvangMeting het programmaatje teruggeeft: alle labels, maar alleen als
 * het zegt ze te kennen (brug.herkent, 0.11.0) en er een nieuwere is dan wat
 * het al heeft (brug.labels_op). Een oudere brug stuurt dat niet: niets.
 */
export function labelsVoorBrug(huis, brug) {
  if (!brug || brug.herkent !== true) return [];
  // "Weet ik niet" en "Later" zijn voor de app: het programmaatje heeft er niets aan (en een oudere zou
  // zo'n label nooit aannemen, en het dan elke minuut opnieuw krijgen).
  const labels = labelsVan(huis).filter((l) => !l.later);
  if (!labels.length) return [];
  const nieuwste = labels.at(-1).op;
  return typeof brug.labels_op === 'string' && brug.labels_op >= nieuwste ? [] : labels;
}

/** De groepen waar de eigenaar de afgelopen week "Weet ik niet" of "Later" op zei: Set van id's. */
export function uitgesteldVan(huis, nu) {
  const grens = new Date(nu - LATER_MS).toISOString();
  return new Set(labelsVan(huis).filter((l) => l.later && l.op >= grens).map((l) => l.id));
}

/**
 * Meting.herkend zoals de site het krijgt (stand), zonder het blok zelf te veranderen (dat kan uit
 * het geheugen komen). De eigenaar: `later` bij een groep die hij een week laat rusten. Een kijker
 * krijgt geen vragen: geen begintijden en geen `later` (de site vraagt een kijker toch niets).
 * @param {object|null|undefined} herkend
 * @param {{ rol: string, uitgesteld?: Set<string> }} opties
 */
export function herkendVoorSite(herkend, { rol, uitgesteld = new Set() }) {
  if (!herkend || typeof herkend !== 'object' || !Array.isArray(herkend.onbekend) || !herkend.onbekend.length) return herkend;
  const onbekend = herkend.onbekend.map((c) => {
    if (!c || typeof c !== 'object') return c;
    const rest = Object.fromEntries(Object.entries(c).filter(([veld]) => veld !== 'tijden' && veld !== 'later'));
    if (rol !== 'eigenaar') return rest;
    return { ...rest, ...(c.tijden ? { tijden: c.tijden } : {}), ...(uitgesteld.has(c.id) ? { later: true } : {}) };
  });
  return { ...herkend, onbekend };
}
