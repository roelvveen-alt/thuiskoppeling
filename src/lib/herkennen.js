/**
 * Welk apparaat gebruikt er nu stroom? Wat het programmaatje thuis raadt
 * (brug/herkennen.mjs, 0.11.0, Meting.herkend), in gewone woorden voor de kaart
 * op Apparaten (src/components/Herkennen.jsx). Alleen kijken: de app bedient
 * niets. Labelen ("Klopt", "Dat was …") gaat via de functie huis (labelHerkend).
 */
import { ouderDan } from './batterijGegevens';
import { leesLokaal, schrijfLokaal } from './lokaal';
import { opsomming } from './nuInWoorden';
import { euro, kwhDag, sindsWanneer, tijd, vermogen } from './opmaak';

/** Dezelfde lijst als brug/herkennen.mjs en base44/shared/herkennen.js (base44/tests/herkennen.test.js). */
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

/** Hoe een soort in de app heet. */
export const SOORT_NAAM = Object.freeze({
  koelkast: 'Koelkast',
  vriezer: 'Vriezer',
  wasmachine: 'Wasmachine',
  vaatwasser: 'Vaatwasser',
  droger: 'Droger',
  strijkijzer: 'Strijkijzer',
  stofzuiger: 'Stofzuiger',
  waterkoker: 'Waterkoker',
  oven: 'Oven',
  airfryer: 'Airfryer',
  magnetron: 'Magnetron',
  kookplaat: 'Kookplaat',
  fohn: 'Föhn',
  spa: 'Spa',
  boiler: 'Boiler',
  pomp: 'Pomp',
  warmtepomp: 'Warmtepomp',
  auto: 'Auto (laadpaal)',
  anders: 'Iets anders',
});

/** De vormen van een handtekening (brug 1.4.0, brug/herkennen.mjs VORMEN). */
export const VORMEN = Object.freeze(['puls', 'cyclus', 'traag', 'piek', 'golf', 'vlak']);

const DEEL_NAAM = { verwarmt: 'verwarmt', trommel: 'trommel', centrifuge: 'centrifuge' };
const DAGDEEL = { nacht: "'s nachts", ochtend: "'s ochtends", middag: "'s middags", avond: "'s avonds" };
const DAGDEEL_NA_DAG = { nacht: 'nacht', ochtend: 'ochtend', middag: 'middag', avond: 'avond' };
const DAGEN = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'];

/** Vanaf deze versie herkent het programmaatje apparaten. */
export const BRUG_MET_HERKENNEN = '0.11.0';
/** Ouder dan dit (ten opzichte van de stand) is het niet meer van nu: het programmaatje stuurt het elke minuut. */
export const HERKEND_OUD_MS = 3 * 60_000;

const getal = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const ms = (t) => {
  const v = typeof t === 'string' ? Date.parse(t) : Number.NaN;
  return Number.isFinite(v) ? v : null;
};
const tekst = (v) => (typeof v === 'string' && v ? v : null);

function regelUit(r) {
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || getal(r.w) === null) return null;
  return {
    id: r.id,
    soort: SOORTEN.includes(r.soort) ? r.soort : null,
    naam: tekst(r.naam),
    deel: DEEL_NAAM[r.deel] ? r.deel : null,
    w: r.w,
    zeker: getal(r.zeker) ?? 0,
    fase: [1, 2, 3].includes(r.fase) ? r.fase : null,
    vorm: ['puls', 'cyclus'].includes(r.vorm) ? r.vorm : null,
    bevestigd: r.bevestigd === true,
    onbekend: typeof r.onbekend === 'string' && /^[A-Z]$/.test(r.onbekend) ? r.onbekend : null,
    sinds: ms(r.sinds),
    van: ms(r.van),
    tot: ms(r.tot),
  };
}

/**
 * Meting.herkend als stand voor het scherm, of null (een oudere brug of een
 * functie die het nog niet doorgeeft). `oud`: het blok is ouder dan
 * HERKEND_OUD_MS ten opzichte van de meting; dan geen "nu".
 */
export function herkendUit(h, standMoment = null) {
  if (!h || typeof h !== 'object' || Array.isArray(h)) return null;
  const moment = ms(h.moment);
  const stand = ms(standMoment);
  const oud = moment !== null && stand !== null && stand - moment > HERKEND_OUD_MS;
  const lijst = (v) => (Array.isArray(v) ? v.map(regelUit).filter(Boolean) : []);
  const b = h.basis;
  return {
    moment,
    oud,
    nu: oud ? [] : lijst(h.nu).filter((r) => r.sinds !== null),
    recent: lijst(h.recent).filter((r) => r.van !== null && r.tot !== null),
    onbekend: (Array.isArray(h.onbekend) ? h.onbekend : [])
      .filter((c) => c && typeof c.id === 'string' && typeof c.letter === 'string' && getal(c.w) !== null && getal(c.n) !== null)
      .map((c) => ({
        id: c.id,
        letter: c.letter,
        w: c.w,
        duur_s: getal(c.duur_s),
        n: c.n,
        fase: [1, 2, 3].includes(c.fase) ? c.fase : null,
        dagdeel: DAGDEEL[c.dagdeel] ? c.dagdeel : null,
        dag: Number.isInteger(c.dag) && c.dag >= 0 && c.dag <= 6 ? c.dag : null,
        vermoeden: SOORTEN.includes(c.vermoeden) ? c.vermoeden : null,
        // De handtekening voor de vraag (brug 1.4.0); een oudere brug stuurt ze niet.
        vorm: VORMEN.includes(c.vorm) ? c.vorm : null,
        tijden: (Array.isArray(c.tijden) ? c.tijden : []).map(ms).filter((t) => t !== null),
        vandaag: Number.isInteger(c.vandaag) && c.vandaag > 0 ? c.vandaag : null,
        perDag: getal(c.per_dag),
        later: c.later === true,
      })),
    // Wat het programmaatje kent (brug 1.4.0); null bij een oudere brug: dan geen vragen bovenaan.
    kennis:
      h.kennis && typeof h.kennis === 'object' && Array.isArray(h.kennis.apparaten)
        ? {
            apparaten: h.kennis.apparaten
              .filter((a) => a && SOORTEN.includes(a.soort) && getal(a.zeker) !== null)
              .map((a) => ({ soort: a.soort, naam: tekst(a.naam), zeker: a.zeker, aangewezen: Number.isInteger(a.aangewezen) && a.aangewezen > 0 ? a.aangewezen : 0, basis: a.basis === true })),
          }
        : null,
    basis: b && typeof b === 'object' && getal(b.w) !== null ? { w: b.w, altijd_w: getal(b.altijd_w), warmtepomp: b.warmtepomp === true } : null,
    week:
      h.week && typeof h.week === 'object' && typeof h.week.van === 'string'
        ? {
            van: h.week.van,
            apparaten: (Array.isArray(h.week.apparaten) ? h.week.apparaten : [])
              .filter((a) => a && getal(a.kwh) !== null && getal(a.keer) !== null && (SOORTEN.includes(a.soort) || typeof a.sleutel === 'string'))
              .map((a) => ({
                soort: SOORTEN.includes(a.soort) ? a.soort : null,
                sleutel: tekst(a.sleutel),
                naam: tekst(a.naam),
                keer: a.keer,
                kwh: a.kwh,
                dagdeel: DAGDEEL[a.dagdeel] ? a.dagdeel : null,
                dag: Number.isInteger(a.dag) && a.dag >= 0 && a.dag <= 6 ? a.dag : null,
              })),
          }
        : null,
  };
}

/** De zekerheid in woorden: zeker (vaak bevestigd), waarschijnlijk, misschien, of niets (dan is het onbekend). */
export function zekerWoord(zeker, bevestigd = false) {
  if (bevestigd || zeker >= 0.85) return 'zeker';
  if (zeker >= 0.6) return 'waarschijnlijk';
  if (zeker >= 0.35) return 'misschien';
  return null;
}

/** De naam van een regel: "Wasmachine, verwarmt", "Aquariumpomp", "Onbekend apparaat A" of "Iets onbekends". */
export function regelNaam(r) {
  const woord = zekerWoord(r.zeker, r.bevestigd);
  if (r.naam && (woord || r.bevestigd)) return r.naam;
  if (r.soort && woord) return `${SOORT_NAAM[r.soort]}${r.deel ? `, ${DEEL_NAAM[r.deel]}` : ''}`;
  if (r.onbekend) return `Onbekend apparaat ${r.onbekend}`;
  return 'Iets onbekends';
}

/** "Koelkast (110 W)". */
export const regelTekst = (r) => `${regelNaam(r)} (${vermogen(r.w)})`;

/**
 * Wat er nu aan staat, per zekerheid: [{ woord: 'Waarschijnlijk', regels: [...] }, …],
 * met eerst wat het zekerst is. Onbekend als laatste.
 */
export function nuPerZekerheid(nu) {
  const volgorde = ['zeker', 'waarschijnlijk', 'misschien', null];
  const kop = { zeker: 'Aan', waarschijnlijk: 'Waarschijnlijk aan', misschien: 'Misschien aan', null: 'Ook aan, nog onbekend' };
  return volgorde
    .map((woord) => ({ woord, kop: kop[woord], regels: nu.filter((r) => zekerWoord(r.zeker, r.bevestigd) === woord) }))
    .filter((g) => g.regels.length);
}

/** De korte regel op de kaart: "Altijd aan: zo'n 200 W", of "Altijd aan, met de warmtepomp: zo'n 450 W". */
export function basisKort(basis) {
  if (!basis) return null;
  return `Altijd aan${basis.warmtepomp ? ', met de warmtepomp' : ''}: zo’n ${vermogen(Math.round(basis.w / 10) * 10)}`;
}

/** "’s nachts op z’n laagst zo’n 380 W" als dat 50 W of meer anders is dan nu, anders null. */
export function nachtZin(basis) {
  if (!basis || basis.altijd_w === null || basis.altijd_w === undefined || Math.abs(basis.altijd_w - basis.w) < 50) return null;
  return `’s nachts op z’n laagst zo’n ${vermogen(basis.altijd_w)}`;
}

/**
 * De hoofdregel van de kaart: wat er nu aan staat, het zekerst eerst, met het
 * woord erbij als het niet zeker is: "Wasmachine, verwarmt (2,1 kW,
 * waarschijnlijk) en Koelkast (110 W, misschien)". Niets: null.
 */
export function nuRegel(nu) {
  const rijen = nuPerZekerheid(nu).flatMap((g) => g.regels);
  return rijen.length
    ? opsomming(
        rijen.map((r) => {
          const woord = zekerWoord(r.zeker, r.bevestigd);
          return `${regelNaam(r)} (${vermogen(r.w)}${woord && woord !== 'zeker' ? `, ${woord}` : ''})`;
        }),
      )
    : null;
}

/**
 * Het kopje van het uitklapblok onder de kaart. De eigenaar: "Eerder vandaag en
 * aanwijzen" (of "Aanwijzen wat het is" als er vandaag nog niets was), met het
 * aantal open vragen ("Wat is dit?") erbij. Een kijker kan niets aanwijzen:
 * "Eerder vandaag", of "Onbekende apparaten".
 * @param {{ eigenaar: boolean, nu: number, eerder: number, onbekend: number, vragen: number }} aantallen
 */
export function uitklapTitel({ eigenaar, nu = 0, eerder = 0, onbekend = 0, vragen = 0 }) {
  const erbij = vragen ? ` (${vragen} ${vragen === 1 ? 'vraag' : 'vragen'})` : '';
  if (eigenaar && eerder) return `Eerder vandaag en aanwijzen${erbij}`;
  if (eigenaar && (nu || onbekend)) return `Aanwijzen wat het is${erbij}`;
  if (eerder) return 'Eerder vandaag';
  if (onbekend) return 'Onbekende apparaten';
  return 'Meer';
}

/** Wanneer meestal: "meestal zaterdagochtend", "meestal 's avonds", "meestal op zaterdag", of null. */
export function gewoonteZin({ dag, dagdeel }) {
  if (dag !== null && dag !== undefined && dagdeel) return `meestal ${DAGEN[dag]}${DAGDEEL_NA_DAG[dagdeel]}`;
  if (dagdeel) return `meestal ${DAGDEEL[dagdeel]}`;
  if (dag !== null && dag !== undefined) return `meestal op ${DAGEN[dag]}`;
  return null;
}

/** Een duur in gewone woorden: "zo'n 20 minuten", "zo'n 2 uur". */
export function duurZin(seconden) {
  if (seconden === null || seconden === undefined) return null;
  const min = Math.max(1, Math.round(seconden / 60));
  if (min < 90) return `zo’n ${min} ${min === 1 ? 'minuut' : 'minuten'}`;
  return `zo’n ${Math.round(min / 60)} uur`;
}

/** "Onbekend apparaat A: zo'n 1,2 kW, zo'n 20 minuten, meestal 's avonds, op L1 (4 keer gezien)". */
export function onbekendZin(c) {
  const delen = [`zo’n ${vermogen(c.w)}`, duurZin(c.duur_s), gewoonteZin(c), c.fase ? `op L${c.fase}` : null].filter(Boolean);
  return `Onbekend apparaat ${c.letter}: ${delen.join(', ')} (${c.n} keer gezien)`;
}

/**
 * Deze week per apparaat, in woorden: "Spa: 12 keer, 8,4 kWh, zo'n € 2,10".
 * Euro's met de afnameprijs van nu (een schatting: de zon of de batterij kan het betaald hebben).
 * `namen`: eigen namen uit de app per sleutel (Instellingen › Namen).
 */
export function weekRegels(week, { prijs = null, namen = {} } = {}) {
  if (!week?.apparaten?.length) return [];
  return week.apparaten
    .filter((a) => a.kwh >= 0.1)
    .map((a) => {
      const naam = (a.sleutel && namen[a.sleutel]) || a.naam || (a.soort ? SOORT_NAAM[a.soort] : a.sleutel);
      const geld = prijs?.afname_kwh > 0 ? `, zo’n ${euro(a.kwh * prijs.afname_kwh)}` : '';
      const keer = a.keer > 0 ? `${a.keer} keer, ` : '';
      const gewoonte = gewoonteZin(a);
      return { sleutel: a.sleutel ?? `${a.soort}|${a.naam ?? ''}`, naam, tekst: `${keer}${kwhDag(a.kwh)}${geld}`, gewoonte };
    });
}

/** Wat er op de kaart moet: niets (geen brug), "werk bij" (een oudere brug), "even geduld" (nog geen blok), of de kaart. */
export function kaartStand(herkend, brugVersie) {
  if (herkend) return 'kaart';
  if (!brugVersie) return 'niets';
  return ouderDan(brugVersie, BRUG_MET_HERKENNEN) ? 'bijwerken' : 'geduld';
}

/** Het label voor de functie huis (labelHerkend) bij een regel: "Klopt" (soort = wat we zeiden) of "Dat was …". */
export function labelVoor(r, { soort, naam = null }) {
  const duur = r.van !== null && r.tot !== null ? Math.round((r.tot - r.van) / 1000) : null;
  return {
    id: r.id,
    soort,
    ...(naam ? { naam } : {}),
    w: r.w,
    ...(duur ? { duur_s: duur } : {}),
    ...(r.fase ? { fase: r.fase } : {}),
    ...(r.vorm ? { vorm: r.vorm } : {}),
    ...(r.soort ? { was: r.soort } : {}),
  };
}

/**
 * Het label voor een hele groep onbekenden: één keer kiezen, alle keren benoemd. Met de vorm (brug
 * 1.4.0), zodat de handtekening ook zegt hoe het aangaat, en wat het programmaatje vermoedde (`was`):
 * klopt dat niet, dan noemt het die soort bij dit vermogen voortaan minder snel.
 */
export function labelVoorGroep(c, { soort, naam = null }) {
  return {
    id: c.id,
    soort,
    ...(naam ? { naam } : {}),
    w: c.w,
    ...(c.duur_s ? { duur_s: c.duur_s } : {}),
    ...(c.fase ? { fase: c.fase } : {}),
    ...(c.vorm ? { vorm: c.vorm } : {}),
    ...(c.vermoeden ? { was: c.vermoeden } : {}),
    ...(c.n > 1 ? { aantal: Math.min(500, c.n) } : {}),
  };
}

/** "Weet ik niet" of "Later" op een vraag: de server laat die groep een week rusten (Huis.herkend_labels). */
export const laterLabel = (c) => ({ id: c.id, later: true });

/* ---- Vragen (brug 1.4.0) ---- */

/** Hooguit zoveel vragen tegelijk bovenaan de kaart: niet zeuren. */
export const HOOGSTENS_VRAGEN = 2;
/** Na "Weet ik niet" of "Later" een week niet; na een antwoord een dag niet (dan heeft het programmaatje het allang). */
export const LATER_MS = 7 * 86_400_000;
export const BEANTWOORD_MS = 86_400_000;
const LATER_SLEUTEL = 'herkennen-later';

/**
 * Wat dit toestel zelf onthoudt: { [groep-id]: tot (ms) }. Zo verdwijnt een vraag meteen, ook als de
 * functie het "later" nog niet kent (site en functies gaan niet tegelijk live) of nog even onthoudt.
 */
export function leesUitgesteld(nu = Date.now()) {
  const ruw = leesLokaal(LATER_SLEUTEL);
  if (!ruw || typeof ruw !== 'object' || Array.isArray(ruw)) return {};
  return Object.fromEntries(Object.entries(ruw).filter(([, tot]) => typeof tot === 'number' && tot > nu));
}

export function zetUitgesteld(id, nu = Date.now(), duur = LATER_MS) {
  const nieuw = { ...leesUitgesteld(nu), [id]: nu + duur };
  schrijfLokaal(LATER_SLEUTEL, nieuw);
  return nieuw;
}

/**
 * De vragen voor de eigenaar bovenaan de kaart: terugkerende groepen (minstens drie keer) waar hij
 * nog niets op zei, hooguit HOOGSTENS_VRAGEN, in de volgorde van het programmaatje. Alleen met een
 * brug die zijn handtekeningen meestuurt (kennis); een oudere: geen (dan staat "Wat is dit?" zoals
 * vroeger in het blok eronder).
 */
export function vragenVan(herkend, { uitgesteld = {} } = {}) {
  if (!herkend?.kennis || herkend.oud) return [];
  return herkend.onbekend.filter((c) => c.n >= 3 && !c.later && !uitgesteld[c.id]).slice(0, HOOGSTENS_VRAGEN);
}

/** Hoe het aangaat en zich gedraagt, in gewone woorden. */
const VORM_ZIN = {
  puls: 'Het gaat steeds even aan en weer uit.',
  cyclus: 'Het gaat om de paar minuten aan en uit.',
  traag: 'Het komt langzaam op gang en zakt langzaam weer af.',
  piek: 'Bij het aangaan is er eerst een korte piek, zoals bij een motor.',
  golf: 'Terwijl het aan staat, gaat het wat op en neer, zoals bij een motor.',
  vlak: 'Het is één rustig blok, zoals iets dat verwarmt.',
};

/** "07:10, 12:30 en 18:05". */
const tijdenLijst = (tijden) => opsomming(tijden.map((t) => tijd(t)));

/**
 * De vraag in zinnen: [kop, wanneer, vorm, gewoonte]; wat niet bekend is, valt weg.
 *   "Er komt iets terug van zo'n 1,8 kW, zo'n 40 minuten."
 *   "Vandaag 3 keer: om 07:10, 12:30 en 18:05."  /  "Al 5 keer gezien, het laatst gisteren 18:05."
 *   "Bij het aangaan is er eerst een korte piek, zoals bij een motor."
 *   "Meestal 's avonds, zo'n 2 keer per dag."
 */
export function vraagZinnen(c, nuRuw) {
  const nu = Number(nuRuw);
  const duur = duurZin(c.duur_s);
  const kop = `Er komt iets terug van zo’n ${vermogen(c.w)}${duur ? `, ${duur.replace('zo’n ', 'ongeveer ')}` : ''}.`;
  const begin = new Date(nu).setHours(0, 0, 0, 0);
  const vandaagTijden = c.tijden.filter((t) => t >= begin && t <= nu + 60_000);
  const wanneer =
    c.vandaag && vandaagTijden.length
      ? c.vandaag <= vandaagTijden.length
        ? `Vandaag ${c.vandaag} keer: om ${tijdenLijst(vandaagTijden)}.`
        : `Vandaag ${c.vandaag} keer, het laatst om ${tijd(vandaagTijden.at(-1))}.`
      : c.tijden.length
        ? `Al ${c.n} keer gezien, het laatst ${sindsWanneer(c.tijden.at(-1), nu)}.`
        : `Al ${c.n} keer gezien.`;
  const gewoonte = gewoonteZin(c);
  const perDag = c.perDag && c.perDag >= 1.5 ? `zo’n ${Math.round(c.perDag)} keer per dag` : null;
  const vaak = [gewoonte, perDag].filter(Boolean).join(', ');
  return [kop, wanneer, c.vorm ? VORM_ZIN[c.vorm] : null, vaak ? `${vaak[0].toUpperCase()}${vaak.slice(1)}.` : null].filter(Boolean);
}

/**
 * De keuzes bij "Wat is het?", in de volgorde die thuis het vaakst voorkomt. Waar geen soort voor is
 * (verlichting), is het "Iets anders" met die naam: zo kent elk programmaatje en elke functie het al.
 */
export const KEUZES = Object.freeze([
  { waarde: 'koelkast', tekst: 'Koelkast', soort: 'koelkast' },
  { waarde: 'vriezer', tekst: 'Vriezer', soort: 'vriezer' },
  { waarde: 'wasmachine', tekst: 'Wasmachine', soort: 'wasmachine' },
  { waarde: 'droger', tekst: 'Droger', soort: 'droger' },
  { waarde: 'vaatwasser', tekst: 'Vaatwasser', soort: 'vaatwasser' },
  { waarde: 'oven', tekst: 'Oven', soort: 'oven' },
  { waarde: 'waterkoker', tekst: 'Waterkoker', soort: 'waterkoker' },
  { waarde: 'warmtepomp', tekst: 'Warmtepomp', soort: 'warmtepomp' },
  { waarde: 'boiler', tekst: 'Boiler', soort: 'boiler' },
  { waarde: 'kookplaat', tekst: 'Kookplaat (inductie)', soort: 'kookplaat' },
  { waarde: 'stofzuiger', tekst: 'Stofzuiger', soort: 'stofzuiger' },
  { waarde: 'strijkijzer', tekst: 'Strijkijzer', soort: 'strijkijzer' },
  { waarde: 'auto', tekst: 'Laadpaal of auto', soort: 'auto' },
  { waarde: 'pomp', tekst: 'Pomp', soort: 'pomp' },
  { waarde: 'verlichting', tekst: 'Verlichting', soort: 'anders', naam: 'Verlichting' },
  { waarde: 'airfryer', tekst: 'Airfryer', soort: 'airfryer' },
  { waarde: 'magnetron', tekst: 'Magnetron', soort: 'magnetron' },
  { waarde: 'fohn', tekst: 'Föhn', soort: 'fohn' },
  { waarde: 'spa', tekst: 'Spa of bubbelbad', soort: 'spa' },
  { waarde: 'anders', tekst: 'Iets anders (zelf typen)', soort: 'anders' },
]);

/** Elke soort staat erin (de lijst is compleet). */
export const KEUZE_VAN = Object.freeze(Object.fromEntries(KEUZES.map((k) => [k.waarde, k])));

/**
 * "Ik ken nu 4 apparaten van je; 2 vragen staan open." Zonder kennis (een oudere brug): null.
 * @param {{ apparaten: Array }|null} kennis
 * @param {number} open  het aantal vragen dat nu openstaat (0 voor een kijker)
 */
export function kennisZin(kennis, open = 0) {
  if (!kennis) return null;
  const n = kennis.apparaten.length;
  const ken = n ? `Ik ken nu ${n} ${n === 1 ? 'apparaat' : 'apparaten'} van je` : 'Ik leer je apparaten nog kennen';
  return `${ken}${open ? `; ${open} ${open === 1 ? 'vraag staat' : 'vragen staan'} open` : ''}.`;
}

/** Per apparaat dat het kent: { naam, woord, uitleg } ("Koelkast", "zeker", "4 keer aangewezen"). */
export function kennisRegels(kennis) {
  if (!kennis) return [];
  return kennis.apparaten.map((a) => ({
    sleutel: `${a.soort}|${a.naam ?? ''}`,
    naam: a.naam ?? SOORT_NAAM[a.soort],
    woord: zekerWoord(a.zeker) ?? 'nog onzeker',
    uitleg: a.aangewezen ? `${a.aangewezen} keer aangewezen` : a.basis ? 'in wat altijd aan staat' : 'uit zichzelf herkend',
  }));
}
