import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { middernacht } from './dag.mjs';

/**
 * Herkennen welk apparaat nu stroom gebruikt (programmaatje 0.11.0; per dag
 * geteld sinds 0.12.0), uit het
 * stroomspoor van het hele huis. Alleen kijken en raden: er gaat niets naar
 * de apparaten.
 *
 * Waarop het rekent:
 *
 *   1. Het huisverbruik, niet de P1. De Zendure springt binnen seconden bij,
 *      dan blijft de meterkast op nul terwijl het huis 2 kW meer gebruikt. Dus
 *      zon + batterij + net, zoals dag.mjs en verdeelStroom in de app. Wat al
 *      een eigen meter heeft (meting.apparaten, zoals de spa in huis B), gaat er
 *      eerst af: dat herkennen we niet nog eens. De P1 per fase is alleen een
 *      aanwijzing (op welke fase de sprong begon).
 *   2. Stappen: een sprong omhoog of omlaag die twee lezingen op rij (~10 s)
 *      blijft staan. Eén scheve lezing (twee meters die net niet tegelijk
 *      meten) telt niet. Een sprong die er lang over doet (een aanloop van
 *      20 s of meer) heet "traag": zo start een warmtepomp.
 *   3. Aan en uit koppelen: een stap omlaag sluit het apparaat dat er het best
 *      bij past. Daaruit: hoe groot (W), hoe lang, welke fase, hoe onrustig
 *      (een motor), of het pulseert (strijkijzer: steeds even aan), in cycli
 *      gaat (oven, droger: minuten aan en uit), of in een ritme terugkomt
 *      (koelkast: elke 20 tot 60 minuten).
 *   4. De basis: wat er overblijft als je de herkende apparaten aftrekt. Die
 *      wisselt langzaam (de warmtepomp in huis A, 400–500 W) en loopt mee
 *      zonder stappen te maken. Per huis geleerd: het laagste stabiele niveau
 *      van elke nacht (altijd-aan). Een warmtepomp nemen we alleen aan als het
 *      patroon erop wijst (de basis wisselt over de uren flink, op een hoog
 *      niveau) of als een trage aanloop als warmtepomp herkend is.
 *   5. Raden: startprofielen per soort apparaat (PROFIELEN) plus wat de
 *      gebruiker in de app aanwees (labels, per huis). Elke kandidaat krijgt
 *      een score van 0 tot 1; de zekerheid is de beste score, minder naarmate
 *      de tweede dichtbij komt. Een label telt zwaarder dan een profiel, en
 *      "Dat was X" maakt de soort die we eerst noemden daar minder waarschijnlijk.
 *   6. Slim, maar uitlegbaar:
 *      - Wat vaker terugkomt en nog onbekend is, komt in een groep ("Onbekend
 *        apparaat A: zo'n 1,2 kW, zo'n 20 minuten, meestal 's avonds, op L1").
 *        De app vraagt daar om; één label benoemt de hele groep (ook in de week).
 *      - Per apparaat het gewone tijdstip (uur en dag): valt een gebeurtenis in
 *        wat dat apparaat meestal doet, dan iets zekerder (tijdFactor, 0,85–1,15).
 *      - Per week per apparaat hoe vaak en hoeveel kWh, ook voor wat een eigen
 *        meter heeft (de spa in huis B); de app rekent er euro's bij.
 *      - Per dag net zo (0.12.0, dagVoorApp): per apparaat kWh en keer van
 *        vandaag, en hoeveel kWh de basis was. Dat gaat mee in meting.dag
 *        (apparaten, basis_kwh); de app bewaart het in de tabel Dag, voor het
 *        onderdeel Apparaten op Overzicht. Een herkend apparaat telt pas als
 *        het tien minuten uit is (rondAf). Sinds 0.13.0 de kWh naar de tijd
 *        verdeeld over de dagen (over middernacht), en wat bij een dag zou
 *        landen die al voorbij is (de app neemt die niet meer aan) bij vandaag:
 *        zo raakt wat na 23:50 uitgaat niet meer kwijt. Een puls of cyclus telt
 *        alleen de tijd dat hij echt aan was, niet de pauzes ertussen.
 *      - Zekerheid die meeleert: een handtekening die vaak bevestigd is wordt
 *        "zeker", een die vaak verbeterd wordt zakt. Een profiel alleen haalt
 *        nooit "zeker".
 * *   7. Handtekeningen (1.4.0): per gebeurtenis ook hoe het aangaat en zich
 *      gedraagt (vormVan: een korte piek bij het aangaan, traag aanlopen,
 *      golven, aan-en-uit, of één rustig blok) en of het traag afbouwt. Wat
 *      lijkt (zelfde familie van vorm, vermogen ±20%, duur, fase) komt in één
 *      groep; ook wat alleen op een profiel geraden is, zodat de app na
 *      VRAAG_NA keer kan vragen "Er komt iets terug van zo'n 1,8 kW … Wat is
 *      het?" (onbekend, met de begintijden, hoe vaak vandaag en per dag). Het
 *      antwoord komt terug als label op de groep; "weet ik niet" of "later"
 *      houdt de server zelf bij (een week niet vragen), daar merkt dit niets van.
 *      Een terugkerende groep zonder naam staat per dag apart in
 *      Overzicht › Apparaten ("Onbekend apparaat A, zo'n 1,8 kW"), niet in de
 *      Rest. En kennis: wat het programmaatje kent, en hoe zeker.
 *
 * Licht genoeg voor een oude telefoon: per lezing een paar optellingen; een
 * paar honderd gebeurtenissen in het geheugen. Wat de moeite waard is om een
 * herstart te overleven (labels, nachten, de laatste uren en gebeurtenissen),
 * staat in herkennen.json naast instellingen.json (in .gitignore).
 */

/** De soorten, op één plek; base44/shared/herkennen.js en src/lib/herkennen.js hebben dezelfde lijst (herkennen.test.js). */
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

/** Een deel van een apparaat dat de app erbij zegt ("Wasmachine, verwarmt"). */
export const DELEN = Object.freeze(['verwarmt', 'trommel', 'centrifuge']);

/**
 * Startprofielen: gangbare vermogens (W), hoe lang (s) en de vorm.
 *
 * Bronnen: richtwaarden van Milieu Centraal ("Energieverbruik van apparaten"),
 * typeplaatjes en opgaven van fabrikanten (waterkoker 2–3 kW, stofzuiger sinds
 * de EU-eis van 2017 hooguit 900 W, oudere tot 2 kW), en de open NILM-datasets
 * REDD (MIT, 2011) en UK-DALE (Kelly en Knottenbelt, 2015) voor de vormen
 * (koelkastritme, het verwarmen en de centrifuge van een wasmachine, het
 * pulseren van een strijkijzer). Ruim en ruw: genoeg om mee te beginnen; wat
 * de gebruiker aanwijst gaat voor.
 *
 *   vorm  vlak    een verwarmingselement: één blok, rustig
 *         ruis    een motor: onrustig (stofzuiger, föhn, kookplaat)
 *         puls    steeds even aan, korter dan anderhalve minuut (strijkijzer)
 *         cyclus  minuten aan en uit op een thermostaat (oven, droger)
 *         ritme   komt elke 10 minuten tot 3 uur terug (koelkast, vriezer)
 *         traag   loopt langzaam aan (warmtepomp)
 *   kans  hoe gewoon het apparaat is (0–1), als twee profielen even goed passen
 */
export const PROFIELEN = Object.freeze({
  koelkast: { w: [50, 200], duur: [300, 2700], vorm: 'ritme', kans: 1 },
  vriezer: { w: [70, 250], duur: [600, 3600], vorm: 'ritme', kans: 0.7 },
  wasmachine: { w: [1700, 2400], duur: [300, 1800], vorm: 'vlak', kans: 0.7, deel: 'verwarmt' },
  vaatwasser: { w: [1700, 2400], duur: [600, 1800], vorm: 'vlak', kans: 0.6, deel: 'verwarmt' },
  droger: { w: [1800, 2900], duur: [1800, 7200], vorm: 'cyclus', kans: 0.5 },
  strijkijzer: { w: [1000, 2600], duur: [300, 7200], vorm: 'puls', kans: 0.8 },
  stofzuiger: { w: [500, 2000], duur: [60, 1800], vorm: 'ruis', kans: 0.7 },
  waterkoker: { w: [1800, 3000], duur: [60, 360], vorm: 'vlak', kans: 0.9 },
  oven: { w: [1500, 3600], duur: [900, 7200], vorm: 'cyclus', kans: 0.6 },
  airfryer: { w: [1200, 2000], duur: [480, 2400], vorm: 'cyclus', kans: 0.5 },
  magnetron: { w: [700, 1500], duur: [30, 900], vorm: 'vlak', kans: 0.6 },
  kookplaat: { w: [1000, 3700], duur: [300, 3600], vorm: 'ruis', kans: 0.5 },
  fohn: { w: [800, 2200], duur: [60, 900], vorm: 'ruis', kans: 0.3 },
  spa: { w: [1300, 3000], duur: [1800, 28_800], vorm: 'vlak', kans: 0.3 },
  boiler: { w: [1200, 3000], duur: [1800, 14_400], vorm: 'vlak', kans: 0.3 },
  pomp: { w: [30, 800], duur: [1800, 43_200], vorm: 'vlak', kans: 0.4 },
  warmtepomp: { w: [300, 3000], duur: [1200, 43_200], vorm: 'traag', kans: 0.8 },
  auto: { w: [1400, 11_000], duur: [1800, 43_200], vorm: 'vlak', kans: 0.3 },
});

/** Een profiel alleen is nooit zekerder dan dit: dat is voor wat de gebruiker aanwees. */
export const PROFIEL_HOOGSTENS = 0.85;
/** Kleiner dan dit is geen apparaat maar meetruis of een lampje: dat loopt mee in de basis. */
export const MIN_W = 40;
/** Zoveel lezingen op rij moet een sprong blijven staan. */
const LEZINGEN = 2;
/** Zoveel lezingen zonder rust (een aanloop): de sprong heet traag. */
const TRAAG_NA = 4;
/** Komt het na zoveel lezingen nog niet tot rust, dan nemen we het nieuwe niveau zoals het is. */
const ONRUSTIG_NA = 24;
/** Korter dan dit (s) kan het een puls of een cyclus zijn. */
const KORT_S = 360;
/** Pulsen korter dan dit (s): strijkijzer; langer: een cyclus. */
const PULS_S = 90;
/** Zo lang (s) na een uit-stap kan het volgende stukje van dezelfde puls of cyclus nog komen. */
const GROEP_GAT_S = 120;
/**
 * Na zo lang aan hoort het bij de basis (een pomp, een wekker van 5 W die bleef hangen …).
 * Wat het tot dan gebruikte, telt dan (0.13.0): bij het apparaat als dat herkend is (een
 * warmtepomp), anders bij de basis. Daarna loopt het in de basis mee.
 */
const LANG_AAN_MS = 12 * 3600_000;
/**
 * Zoveel groepen onbekenden hooguit; een groep die nog geen drie keer kwam en zo lang wegbleef, vervalt.
 * Sinds 1.4.0 komt ook wat alleen op een profiel geraden is in een groep (zo kan de app vragen of
 * het klopt), daarom twaalf in plaats van acht.
 */
export const HOOGSTENS_ONBEKEND = 12;
/** Zo vaak moet iets met dezelfde handtekening terugkomen voor de app ernaar vraagt. */
export const VRAAG_NA = 3;
/** Zoveel begintijden per groep onthouden ("vandaag 3 keer: om 07:10, 12:30 en 18:05"). */
const HOOGSTENS_TIJDEN = 4;
/** Zoveel apparaten in de korte lijst "wat ik ken" (kennis). */
export const HOOGSTENS_KENNIS = 12;
const ONBEKEND_VERVALT_MS = 14 * 86_400_000;
/** Zo ver terug kijken voor een ritme. */
const GESCHIEDENIS_MS = 6 * 3600_000;
/** Na een wasmachine die verwarmde, zo lang kijken of de trommel en de centrifuge komen. */
const NA_VERWARMEN_MS = 2 * 3600_000;
export const HOOGSTENS_NU = 10;
export const HOOGSTENS_RECENT = 20;
/** Per dag hooguit zoveel apparaten mee naar de app (meeste kWh eerst); de server neemt er net zo veel aan. */
export const HOOGSTENS_DAG_APPARATEN = 30;
/** Zoveel labels onthouden, de nieuwste; de server houdt er net zo veel (base44/shared/herkennen.js). */
export const HOOGSTENS_LABELS = 100;

const getal = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const rond10 = (w) => Math.round(w / 10) * 10;
const rondZeker = (z) => Math.round(Math.min(1, Math.max(0, z)) * 20) / 20;
const iso = (ms) => new Date(ms).toISOString();
const mediaan = (rij) => {
  if (!rij.length) return null;
  const s = [...rij].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const meestal = (rij) => {
  const tel = new Map();
  for (const v of rij) if (v !== null && v !== undefined) tel.set(v, (tel.get(v) ?? 0) + 1);
  return [...tel].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};

/**
 * Het huisverbruik, zoals dag.mjs en verdeelStroom in de app: elke meter eerst
 * op hele watts, zon nooit onder 0, en zonder net niet te weten (null).
 */
export function huisVerbruik(meting) {
  const net = getal(meting?.net_w);
  if (net === null) return null;
  const zon = getal(meting?.zon_w) ?? 0;
  const batterij = getal(meting?.batterij_w) ?? 0;
  return Math.max(0, Math.max(0, Math.round(zon)) + Math.round(batterij) + Math.round(net));
}

/** Wat al een eigen meter heeft (meting.apparaten: HomeWizard-stekkers, kWh-meters, Tuya): samen, in watt. */
export function eigenGemeten(meting) {
  return (Array.isArray(meting?.apparaten) ? meting.apparaten : []).reduce((som, a) => som + Math.max(0, getal(a?.vermogen_w) ?? 0), 0);
}

/** Per fase wat de P1 nu meet (plus = afnemen); zonder: een lege Map. */
function fasenVan(lijst) {
  const uit = new Map();
  for (const f of Array.isArray(lijst) ? lijst : []) if ([1, 2, 3].includes(f?.fase) && getal(f.w) !== null) uit.set(f.fase, f.w);
  return uit;
}

/**
 * Op welke fase een sprong begon: de fase die het meest in dezelfde richting
 * veranderde, als dat minstens de helft van de sprong is. De Zendure kan op
 * een andere fase tegensturen; daarom alleen de eerste lezing van de sprong,
 * en alleen als aanwijzing.
 */
export function faseVanSprong(voor, na, delta) {
  if (!voor?.size || !na?.size || !delta) return null;
  let beste = null;
  let grootst = 0;
  for (const [fase, w] of na) {
    if (!voor.has(fase)) continue;
    const verschil = (w - voor.get(fase)) * Math.sign(delta);
    if (verschil > grootst) {
      grootst = verschil;
      beste = fase;
    }
  }
  return grootst >= 0.5 * Math.abs(delta) ? beste : null;
}

/** 1 binnen [laag, hoog], daarbuiten zacht minder (naar verhouding). */
function binnen(v, [laag, hoog], zacht) {
  if (v >= laag && v <= hoog) return 1;
  const r = v < laag ? laag / Math.max(v, 1) : v / hoog;
  return Math.exp(-(((r - 1) / zacht) ** 2));
}

/** Hoe goed de duur past. Loopt het nog, dan telt alleen "al te lang". */
function duurPast(duur, bereik, klaar) {
  if (!klaar) return duur <= bereik[1] ? 1 : binnen(duur, [0, bereik[1]], 0.5);
  return binnen(duur, bereik, 0.5);
}

/** Hoe goed de vorm past bij een profiel. */
function vormPast(vorm, k) {
  const onrust = getal(k.ruis);
  let s;
  switch (vorm) {
    case 'puls':
      s = k.vorm === 'puls' ? 1 : k.vorm === 'cyclus' ? 0.5 : k.klaar || k.duur_s > 2 * PULS_S ? 0.25 : 0.6;
      break;
    case 'cyclus':
      s = k.vorm === 'cyclus' ? 1 : k.vorm === 'puls' ? 0.5 : !k.klaar && k.duur_s < 600 ? 0.6 : 0.4;
      break;
    case 'ritme':
      s = k.vorm ? 0.3 : k.ritme ? 1 : 0.55;
      break;
    case 'ruis':
      s = k.vorm ? 0.3 : onrust === null ? 0.7 : onrust >= 0.015 ? 1 : 0.45;
      break;
    case 'traag':
      s = k.vorm ? 0.3 : k.traag ? 1 : 0.35;
      break;
    default:
      // vlak
      s = (k.vorm ? 0.3 : 1) * (onrust !== null && onrust >= 0.02 ? 0.5 : 1);
  }
  // Een ritme wijst sterk op koelkast of vriezer, een trage aanloop op een warmtepomp.
  if (k.ritme && vorm !== 'ritme') s *= 0.6;
  if (k.traag && vorm !== 'traag') s *= 0.5;
  return s;
}

/**
 * De score van één profiel voor deze kenmerken, 0 tot 1 (nog zonder de
 * bovengrens van PROFIEL_HOOGSTENS).
 * @param {{ w: [number, number], duur: [number, number], vorm: string, kans: number }} p
 * @param {{ w: number, duur_s: number, klaar: boolean, traag?: boolean, ruis?: number|null, vorm?: string|null, ritme?: boolean }} k
 */
export function scoreProfiel(p, k) {
  return binnen(k.w, p.w, 0.15) * duurPast(k.duur_s, p.duur, k.klaar) * vormPast(p.vorm, k) * p.kans;
}

/**
 * De vorm van een handtekening in één woord (1.4.0): hoe het aangaat en zich gedraagt.
 *   puls    steeds even aan (korter dan anderhalve minuut), zoals een strijkijzer
 *   cyclus  minuten aan en uit op een thermostaat, zoals een oven of droger
 *   traag   loopt langzaam aan (20 s of meer), zoals een warmtepomp
 *   piek    begint met een korte piek boven het niveau (aanloopstroom van een motor of compressor)
 *   golf    onrustig terwijl het aan staat (een motor: stofzuiger, centrifuge)
 *   vlak    één rustig blok (een verwarmingselement: waterkoker, boiler)
 */
export const VORMEN = Object.freeze(['puls', 'cyclus', 'traag', 'piek', 'golf', 'vlak']);
/** Vormen die op elkaar lijken: een korte piek of wat golven mist een meting van 5 s weleens, aan-en-uit of traag niet. */
const FAMILIE = Object.freeze({ puls: 'aanuit', cyclus: 'aanuit', traag: 'traag', piek: 'blok', golf: 'blok', vlak: 'blok' });

/** De vorm van deze kenmerken (VORMEN). */
export function vormVan(k) {
  if (k.vorm === 'puls' || k.vorm === 'cyclus') return k.vorm;
  if (k.traag) return 'traag';
  if (getal(k.piek_w) !== null && k.piek_w > 0) return 'piek';
  if ((getal(k.ruis) ?? 0) >= 0.015) return 'golf';
  return 'vlak';
}

/** Hoe goed twee vormen bij elkaar passen: 1 gelijk, 0,85 dezelfde familie, anders 0,7. */
const vormFactor = (a, b) => (a === b ? 1 : FAMILIE[a] && FAMILIE[a] === FAMILIE[b] ? 0.85 : 0.7);

/** Hoe dicht een vermogen bij een ander ligt: 1 gelijk, 0,78 bij 10% verschil. */
const wDichtbij = (a, b) => Math.exp(-(((a - b) / Math.max(15, 0.2 * b)) ** 2));

/**
 * De score van een geleerde handtekening (uit de labels van de gebruiker).
 * Zelflerend: hoe vaker bevestigd (n), hoe zwaarder (tot 0,99); elke keer dat
 * de gebruiker hem verbeterde ("Dat was …" terwijl wij deze noemden), zakt hij.
 */
export function scoreHandtekening(h, k) {
  const sW = wDichtbij(k.w, h.w);
  let sD = 1;
  if (h.duur_s) {
    if (k.klaar) {
      const r = Math.max(k.duur_s, h.duur_s) / Math.max(1, Math.min(k.duur_s, h.duur_s));
      sD = Math.exp(-(((r - 1) / 1.0) ** 2));
    } else if (k.duur_s > 1.5 * h.duur_s) {
      sD = Math.exp(-(((k.duur_s / (1.5 * h.duur_s) - 1) / 1.0) ** 2));
    }
  }
  const sF = h.fase && k.fase && h.fase !== k.fase ? 0.6 : 1;
  // Een label met een vorm (puls, cyclus, en sinds 1.4.0 ook traag, piek, golf, vlak) tegen de vorm van nu.
  const sV = h.vorm ? vormFactor(h.vorm, vormVan(k)) : k.vorm ? 0.8 : 1;
  const betrouwbaar = (h.n + 1) / (h.n + 1 + 2 * (h.verbeterd ?? 0));
  return sW * sD * sF * sV * Math.min(0.99, 0.85 + 0.05 * h.n) * betrouwbaar;
}

/**
 * Het gewone tijdstip als extra aanwijzing: valt dit uur (±1) in wat een
 * apparaat meestal doet, dan iets zekerder, anders iets minder (0,85–1,15).
 * Pas na vijf keer; daarvoor telt het niet mee.
 */
export function tijdFactor(gewoonte, uur) {
  if (!gewoonte || gewoonte.n < 5 || !Number.isInteger(uur)) return 1;
  const deel = [uur - 1, uur, uur + 1].reduce((som, u) => som + (gewoonte.uren[(u + 24) % 24] ?? 0), 0) / gewoonte.n;
  return Math.min(1.15, Math.max(0.85, 1 + 0.6 * (deel - 0.125)));
}

/**
 * Wat is het? Alle profielen, de geleerde handtekeningen en wat de volgorde
 * zegt (`extra`, zoals de trommel na het verwarmen) tegen elkaar.
 * `tegen`: wat de gebruiker afwees ("Dat was niet X" bij dit vermogen).
 * Geeft { soort, naam?, deel?, zeker }; soort null als niets genoeg past.
 */
export function herken(k, { handtekeningen = [], tegen = [], extra = [], gewoonten = null, uur = null } = {}) {
  const kandidaten = [];
  for (const [soort, p] of Object.entries(PROFIELEN)) {
    kandidaten.push({ soort, naam: null, deel: p.deel ?? null, s: Math.min(PROFIEL_HOOGSTENS, scoreProfiel(p, k)) });
  }
  for (const h of handtekeningen) {
    kandidaten.push({ soort: h.soort, naam: h.naam ?? null, deel: null, s: scoreHandtekening(h, k), geleerd: true, vaak: h.n >= 3 && !h.verbeterd });
  }
  for (const e of extra) kandidaten.push({ soort: e.soort, naam: null, deel: e.deel ?? null, s: e.s });
  for (const t of tegen) {
    const f = wDichtbij(k.w, t.w);
    if (f < 0.3) continue;
    for (const c of kandidaten) if (c.soort === t.soort && (c.naam ?? null) === (t.naam ?? null) && !c.geleerd) c.s *= 1 - 0.7 * f;
  }
  // Per soort (en eigen naam) de beste, met het gewone tijdstip van dit huis erbij.
  const perSoort = new Map();
  for (const c of kandidaten) {
    const sleutel = `${c.soort}|${c.naam ?? ''}`;
    if (gewoonten) c.s *= tijdFactor(gewoonten.get(sleutel), uur);
    if (!perSoort.has(sleutel) || perSoort.get(sleutel).s < c.s) perSoort.set(sleutel, c);
  }
  const rij = [...perSoort.values()].sort((a, b) => b.s - a.s);
  const [beste, tweede] = rij;
  if (!beste || beste.s <= 0) return { soort: null, zeker: 0 };
  // Eerlijk: de beste, min de helft van de tweede. Een profiel alleen haalt zo nooit "zeker" (0,85);
  // dat lukt alleen met wat de gebruiker vaker bevestigde.
  // Wees de gebruiker dit apparaat al minstens drie keer aan (en nooit verbeterd), dan twijfelt een algemeen profiel maar half mee.
  const twijfel = Math.min(1, tweede?.s ?? 0) * (beste.vaak && !tweede?.geleerd ? 0.5 : 1);
  const zeker = Math.min(1, beste.s) - 0.5 * twijfel;
  if (zeker < 0.2) return { soort: null, zeker: rondZeker(zeker) };
  return {
    soort: beste.soort,
    ...(beste.naam ? { naam: beste.naam } : {}),
    ...(beste.deel ? { deel: beste.deel } : {}),
    zeker: rondZeker(zeker),
    // Uit wat de gebruiker aanwees (niet alleen een profiel): dan hoeft de app er niet meer naar te vragen.
    ...(beste.geleerd ? { geleerd: true } : {}),
  };
}

const ID_VORM = /^[a-z0-9-]{1,24}$/;
const ISO_VORM = /^\d{4}-\d{2}-\d{2}T[0-9:.+\-Z]{5,30}$/;
/** Stuurtekens, onzichtbare tekens en omkeertekens eruit, zoals base44/shared/tekst.js. */
// eslint-disable-next-line no-control-regex -- juist deze tekens moeten eruit
const ONZICHTBAAR = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;
const schoonNaam = (tekst) => (typeof tekst === 'string' ? Array.from(tekst.normalize('NFC').replace(/[\t\n\r]/g, ' ').replace(ONZICHTBAAR, '').replace(/ {2,}/g, ' ').trim()).slice(0, 40).join('').trim() : '');

/**
 * Wat de app teruggaf (herkend_labels in het antwoord van ontvangMeting), mild
 * nagekeken: een label dat niet klopt valt weg. Op volgorde van `op`, de
 * nieuwste HOOGSTENS_LABELS.
 */
export function labelsUit(lijst) {
  if (!Array.isArray(lijst)) return [];
  const perId = new Map();
  for (const l of lijst.slice(0, HOOGSTENS_LABELS * 2)) {
    if (!l || typeof l !== 'object' || !ID_VORM.test(l.id ?? '') || !SOORTEN.includes(l.soort)) continue;
    if (typeof l.op !== 'string' || !ISO_VORM.test(l.op)) continue;
    const w = getal(l.w);
    if (w === null || w < MIN_W || w > 100_000) continue;
    const duur = getal(l.duur_s);
    const naam = schoonNaam(l.naam);
    const label = {
      id: l.id,
      soort: l.soort,
      ...(naam ? { naam } : {}),
      w: Math.round(w),
      ...(duur !== null && duur > 0 && duur <= 86_400 ? { duur_s: Math.round(duur) } : {}),
      ...([1, 2, 3].includes(l.fase) ? { fase: l.fase } : {}),
      ...(VORMEN.includes(l.vorm) ? { vorm: l.vorm } : {}),
      ...(SOORTEN.includes(l.was) ? { was: l.was } : {}),
      // Een label voor een hele groep ("Onbekend apparaat A", 0.11.0) telt voor zoveel keer.
      ...(Number.isInteger(l.aantal) && l.aantal > 1 && l.aantal <= 500 ? { aantal: l.aantal } : {}),
      op: l.op,
    };
    const oud = perId.get(l.id);
    if (!oud || oud.op <= label.op) perId.set(l.id, label);
  }
  return [...perId.values()].sort((a, b) => (a.op < b.op ? -1 : a.op > b.op ? 1 : 0)).slice(-HOOGSTENS_LABELS);
}

/**
 * De geleerde handtekeningen uit de labels: per soort (en eigen naam) de
 * labels met een vergelijkbaar vermogen (±25%) samen, met de middelste
 * waarden. En wat de gebruiker afwees: "Dat was X" terwijl wij Y zeiden.
 */
export function handtekeningenUit(labels) {
  const groepen = new Map();
  for (const l of labels) {
    const sleutel = `${l.soort}|${l.naam ?? ''}`;
    if (!groepen.has(sleutel)) groepen.set(sleutel, []);
    groepen.get(sleutel).push(l);
  }
  const handtekeningen = [];
  for (const lijst of groepen.values()) {
    const opW = [...lijst].sort((a, b) => a.w - b.w);
    let bak = [];
    const sluit = () => {
      if (!bak.length) return;
      const duren = bak.map((l) => l.duur_s).filter(Boolean);
      handtekeningen.push({
        soort: bak[0].soort,
        ...(bak[0].naam ? { naam: bak[0].naam } : {}),
        w: Math.round(mediaan(bak.map((l) => l.w))),
        ...(duren.length ? { duur_s: Math.round(mediaan(duren)) } : {}),
        fase: meestal(bak.map((l) => l.fase ?? null)),
        vorm: meestal(bak.map((l) => l.vorm ?? null)),
        n: bak.reduce((som, l) => som + (l.aantal ?? 1), 0),
      });
      bak = [];
    };
    for (const l of opW) {
      if (bak.length && l.w > 1.25 * bak[0].w) sluit();
      bak.push(l);
    }
    sluit();
  }
  const tegen = labels.filter((l) => l.was && l.was !== l.soort).map((l) => ({ soort: l.was, w: l.w, op: l.op }));
  // Verbeterd: een "Dat was …" bij dit vermogen, gegeven nadat deze handtekening er was (wij noemden hem toen dus).
  for (const h of handtekeningen) {
    const sinds = labels.filter((l) => l.soort === h.soort && (l.naam ?? null) === (h.naam ?? null)).map((l) => l.op).sort()[0];
    h.verbeterd = tegen.filter((t) => t.soort === h.soort && !h.naam && t.op > sinds && wDichtbij(t.w, h.w) >= 0.5).length;
  }
  return { handtekeningen, tegen };
}

const UUR_NL = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', hour: '2-digit', hourCycle: 'h23' });
const DATUM_NL = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' });
/** Het uur in Nederland (0–23). */
export const uurInNederland = (ms) => Number(UUR_NL.format(ms));

/** De datum in Nederland en de dag van de week (0 = maandag … 6 = zondag). */
function dagInNederland(ms) {
  const datum = DATUM_NL.format(ms);
  const [j, m, d] = datum.split('-').map(Number);
  return { datum, dag: (new Date(Date.UTC(j, m - 1, d)).getUTCDay() + 6) % 7 };
}

/** De maandag van de week van dit moment (in Nederland), als 'JJJJ-MM-DD'. */
export function weekVan(ms) {
  const { datum, dag } = dagInNederland(ms);
  const [j, m, d] = datum.split('-').map(Number);
  return new Date(Date.UTC(j, m - 1, d - dag)).toISOString().slice(0, 10);
}

/**
 * De sleutel van een herkend apparaat in de dag: 'h:wasmachine', of met een
 * eigen naam 'h:anders:aquariumpomp' (kleine letters, zonder accenten, hooguit
 * 60 tekens). Zo blijft hij van dag tot dag hetzelfde en botst hij niet met
 * de sleutel van een meter.
 */
export function herkendSleutel(soort, naam = null) {
  const deel = (v) =>
    String(v ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  const n = deel(naam);
  return `h:${deel(soort) || 'anders'}${n ? `:${n}` : ''}`.slice(0, 60);
}

/** De volgende middernacht in Nederland na `ms` (dagen van 23, 24 of 25 uur). */
const volgendeMiddernacht = (ms) => middernacht(middernacht(ms) + 26 * 3600_000);

/**
 * De kWh van stukken [van, tot, w] per dag (Nederlandse tijd), over middernacht naar de tijd
 * verdeeld. Wat op een dag vóór `vandaag` zou landen (die dag is al voorbij; de app neemt een
 * oudere dag niet meer aan), telt bij `vandaag`, op moment `nu`. Geeft [{ datum, ms, kwh }],
 * oudste eerst (ms: een moment op die dag, voor de week).
 */
export function kwhPerDag(stukken, { nu = null } = {}) {
  const vandaag = nu === null ? null : DATUM_NL.format(nu);
  const per = new Map();
  for (const [van, tot, w] of stukken) {
    let a = van;
    while (a < tot) {
      const grens = Math.min(tot, volgendeMiddernacht(a));
      let datum = DATUM_NL.format(a);
      let ms = a;
      if (vandaag !== null && datum < vandaag) {
        datum = vandaag;
        ms = nu;
      }
      const d = per.get(datum) ?? { datum, ms, kwh: 0 };
      d.kwh += (Math.max(0, w) * (grens - a)) / 3.6e9;
      per.set(datum, d);
      a = grens;
    }
  }
  return [...per.values()].sort((x, y) => x.ms - y.ms);
}

/** Het dagdeel waarin iets meestal gebeurt (minstens 60% van de keren), of null. */

export function dagdeelVan(uren) {
  const n = uren.reduce((s, v) => s + v, 0);
  if (n < 3) return null;
  const delen = { nacht: [0, 6], ochtend: [6, 12], middag: [12, 18], avond: [18, 24] };
  for (const [naam, [van, tot]] of Object.entries(delen)) {
    if (uren.slice(van, tot).reduce((s, v) => s + v, 0) >= 0.6 * n) return naam;
  }
  return null;
}

/** De dag van de week waarop iets meestal gebeurt (minstens de helft van minstens vier keer), of null. */
export function dagVan(dagen) {
  const n = dagen.reduce((s, v) => s + v, 0);
  if (n < 4) return null;
  const top = dagen.indexOf(Math.max(...dagen));
  return dagen[top] >= 0.5 * n ? top : null;
}

const leegUren = () => Array(24).fill(0);
const leegDagen = () => Array(7).fill(0);
const rijVan = (v, lengte) => (Array.isArray(v) && v.length === lengte && v.every((x) => getal(x) !== null && x >= 0) ? v : null);

/**
 * Wijst de basis op een warmtepomp? Uit de gemiddelden per vijf minuten van de
 * basis van de laatste twaalf uur: minstens twee uur aan vakken, flink
 * wisselend (het verschil tussen de lage en de hoge vakken minstens 80 W) op
 * een hoog niveau (de middelste minstens 300 W). In huis B (rond 200 W, rustig)
 * dus niet; in huis A (400–500 W, wisselend) wel. 's Zomers, als hij uit
 * staat, verdwijnt hij zo ook weer uit de zin.
 */
export function warmtepompPatroon(vakken) {
  const waarden = vakken.filter((u) => u.n >= 20).map((u) => u.som / u.n);
  if (waarden.length < 24) return false;
  const s = [...waarden].sort((a, b) => a - b);
  const p = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return p(0.9) - p(0.1) >= 80 && mediaan(s) >= 300;
}

/** Een verwarmingsblok dat een wasmachine kan zijn (of een vaatwasser): daarna komen trommel en centrifuge. */
const isVerwarmen = (k) => k.klaar && k.w >= 1700 && k.w <= 2600 && k.duur_s >= 300 && k.duur_s <= 2400 && !k.vorm;

/**
 * De herkenner van één huis.
 * @param {{ staat?: object|null }} [opties]  staat: wat bewaar() eerder gaf (herkennen.json)
 */
export function maakHerkenner({ staat = null } = {}) {
  // Het niveau van nu (de stabiele stand van het huisverbruik min eigen meters) en de stap in wording.
  let niveau = null;
  let kandidaten = [];
  let fasenVoor = new Map();
  let vorigeX = null;
  // Hoe onrustig het is (gemiddelde afwijking van een rustige lezing), nu en zonder apparaten.
  let onrust = 10;
  let onrustLeeg = 10;
  let teller = 0;
  /** Wat nu aan staat: { id, w, van, fase, traag, onrustSom, onrustN, label? } */
  let actief = [];
  /** Open groepen van korte stukjes (puls, cyclus): { id, w, leden: [{ id, w, van, tot }] } */
  let groepen = [];
  /** De laatste gebeurtenissen voor de app (nieuwste eerst), met hun kenmerken om opnieuw te raden. */
  let recent = [];
  /** Afgelopen gebeurtenissen voor het ritme: { w, van, tot } */
  let geschiedenis = [];
  /** Verwarmingsblokken van de laatste uren: { id, tot } */
  let verwarmd = [];
  /** Per nacht het laagste niveau over vijf minuten: { datum, w } */
  let nachten = [];
  /** Per vijf minuten de basis (met een herkende warmtepomp erbij), de laatste twaalf uur: { vijf, som, n } */
  let vakken = [];
  let vak = null;
  let labels = [];
  let geleerd = { handtekeningen: [], tegen: [] };
  let warmtepompGezien = 0;
  /** Per soort (en eigen naam) wanneer het meestal gebeurt: { uren[24], dagen[7], n } */
  let gewoonten = new Map();
  /** Terugkerende onbekende: { id, letter, w, duur_s, fasen[3], uren[24], dagen[7], n, laatst } */
  let onbekend = [];
  let letters = 0;
  /** Per week (maandag) per apparaat: { soort?, naam?, sleutel?, keer, kwh } */
  let weken = {};
  /** Per dag (JJJJ-MM-DD, Nederlandse tijd): { apparaten: { [sleutel]: { soort?, naam?, sleutel?, keer, kwh } }, basis } (kWh); vandaag en gisteren. */
  let dagen = {};
  /** De meters met een eigen meter: staan ze aan (om de keren te tellen)? */
  const metersAan = new Map();
  let vorigeRonde = null;

  if (staat && typeof staat === 'object' && staat.v === 1) {
    labels = labelsUit(staat.labels);
    geleerd = handtekeningenUit(labels);
    const lijst = (v) => (Array.isArray(v) ? v : []);
    nachten = lijst(staat.nachten).filter((n) => typeof n?.datum === 'string' && getal(n.w) !== null).slice(-14);
    vakken = lijst(staat.vakken).filter((u) => getal(u?.vijf) !== null && getal(u.som) !== null && getal(u.n) !== null).slice(-144);
    geschiedenis = lijst(staat.geschiedenis).filter((g) => getal(g?.w) !== null && getal(g.van) !== null && getal(g.tot) !== null);
    recent = lijst(staat.recent).filter((r) => typeof r?.id === 'string' && getal(r.w) !== null && getal(r.van) !== null && getal(r.tot) !== null && r.k);
    verwarmd = lijst(staat.verwarmd).filter((v) => typeof v?.id === 'string' && getal(v.tot) !== null);
    warmtepompGezien = getal(staat.warmtepomp_gezien) ?? 0;
    for (const [sleutel, g] of Object.entries(staat.gewoonten && typeof staat.gewoonten === 'object' ? staat.gewoonten : {})) {
      const uren = rijVan(g?.uren, 24);
      const dagen = rijVan(g?.dagen, 7);
      if (uren && dagen && getal(g.n) !== null) gewoonten.set(sleutel, { uren, dagen, n: g.n });
    }
    onbekend = lijst(staat.onbekend).filter((c) => typeof c?.id === 'string' && getal(c.w) !== null && getal(c.n) !== null && rijVan(c.uren, 24) && rijVan(c.dagen, 7) && rijVan(c.fasen, 3));
    letters = getal(staat.letters) ?? onbekend.length;
    if (staat.weken && typeof staat.weken === 'object') weken = staat.weken;
    if (staat.dagen && typeof staat.dagen === 'object' && !Array.isArray(staat.dagen)) dagen = staat.dagen;
  }

  const nieuwId = (ms) => {
    teller = (teller + 1) % 1296;
    return `${Math.floor(ms / 1000).toString(36)}-${teller.toString(36)}`;
  };
  const labelVan = (id) => (id ? (labels.find((l) => l.id === id) ?? null) : null);
  /** Het label van een gebeurtenis: van hemzelf, of van zijn groep onbekenden ("Onbekend apparaat A"). */
  const labelVoor = (r) => labelVan(r.id) ?? labelVan(r.cluster);

  /** Een ritme: minstens twee eerdere van ongeveer hetzelfde vermogen, elk 3 tot 60 minuten, die elke 10 minuten tot 3 uur begonnen. */
  function ritmeVan(w, van) {
    const zelfde = geschiedenis
      .filter((g) => g.van < van && van - g.van <= GESCHIEDENIS_MS && Math.abs(g.w - w) <= Math.max(25, 0.25 * w))
      .filter((g) => g.tot - g.van >= 180_000 && g.tot - g.van <= 3600_000)
      .map((g) => g.van)
      .sort((a, b) => a - b);
    if (zelfde.length < 2) return false;
    const begins = [...zelfde.slice(-3), van];
    for (let i = 1; i < begins.length; i += 1) {
      const tussen = begins[i] - begins[i - 1];
      if (tussen < 600_000 || tussen > 3 * 3600_000) return false;
    }
    return true;
  }

  /** De trommel of centrifuge na het verwarmen (een wasmachine), als het past. */
  function volgorde(k, van) {
    // Alleen wat draait als een trommel: pulsen of cycli, of onrustig (een motor). Een koelkast is dat niet.
    if (k.w < 60 || k.w > 700 || !(k.vorm || (getal(k.ruis) ?? 0) >= 0.015)) return [];
    const ervoor = verwarmd.find((v) => van >= v.tot && van - v.tot <= NA_VERWARMEN_MS);
    if (!ervoor) return [];
    if (!ervoor.gevolgd) {
      // Nu weten we het: dat verwarmen was een wasmachine. Die regel in Eerder opnieuw raden.
      ervoor.gevolgd = true;
      const r = recent.find((x) => x.id === ervoor.id);
      if (r) zetRecent({ ...r, ...raad(r.k, r.van, r.id, r.cluster) });
    }
    return [{ soort: 'wasmachine', deel: k.w < 350 ? 'trommel' : 'centrifuge', s: 0.8 }];
  }

  const opties = (extra = [], van = null) => ({ ...geleerd, extra, gewoonten, uur: van === null ? null : uurInNederland(van) });

  function raad(k, van, id, cluster = null) {
    const label = labelVan(id) ?? labelVan(cluster);
    if (label) return { soort: label.soort, ...(label.naam ? { naam: label.naam } : {}), zeker: 1, bevestigd: true };
    const extra = [...volgorde(k, van)];
    if (verwarmd.some((v) => v.id === id && v.gevolgd)) extra.push({ soort: 'wasmachine', deel: 'verwarmt', s: 0.85 });
    return herken(k, opties(extra, van));
  }

  /** De vorm die een groep meestal heeft (minstens 60% van minstens twee keer), of null. */
  function hoofdVorm(c) {
    const rij = Object.entries(c.vormen && typeof c.vormen === 'object' ? c.vormen : {}).filter(([v, n]) => VORMEN.includes(v) && getal(n) !== null);
    const totaal = rij.reduce((som, [, n]) => som + n, 0);
    const [vorm, n] = rij.sort((a, b) => b[1] - a[1])[0] ?? [];
    return vorm && totaal >= 2 && n >= 0.6 * totaal ? vorm : null;
  }

  /**
   * Welke groep onbekenden past het best bij deze kenmerken, of null (1.4.0: de handtekening).
   * Moet kloppen: het vermogen (±20%, minstens 30 W), de duur (hooguit 2,5 keer zo lang of kort; loopt
   * het nog en is het korter dan gewoonlijk, dan nog niet), de fase als die bekend is, en de familie
   * van de vorm (aan-en-uit, traag, of één blok). Daarbinnen de beste: dichtst bij in vermogen en duur,
   * en dezelfde vorm iets zwaarder dan alleen dezelfde familie.
   */
  function clusterVoor(k) {
    const kv = vormVan(k);
    let beste = null;
    let besteS = 0;
    for (const c of onbekend) {
      const hoogst = Math.max(...c.fasen);
      if (k.fase && hoogst > 0 && k.fase !== c.fasen.indexOf(hoogst) + 1) continue;
      const rW = Math.abs(k.w - c.w) / Math.max(30, 0.2 * c.w);
      if (rW > 1) continue;
      const loopt = !k.klaar && k.duur_s < c.duur_s;
      const duurR = Math.max(k.duur_s, c.duur_s) / Math.max(1, Math.min(k.duur_s, c.duur_s));
      if (!loopt && duurR > 2.5) continue;
      const hv = hoofdVorm(c);
      if (hv && FAMILIE[hv] !== FAMILIE[kv]) continue;
      const score = Math.exp(-(rW ** 2)) * (loopt ? 1 : Math.exp(-(Math.log(duurR) ** 2))) * (hv ? vormFactor(hv, kv) : 1);
      if (score > besteS) {
        beste = c;
        besteS = score;
      }
    }
    return beste;
  }

  /** Een letter die geen andere groep heeft ("Onbekend apparaat A"), pas als hij vaker terugkomt. */
  function vrijeLetter() {
    const bezet = new Set(onbekend.map((c) => c.letter).filter(Boolean));
    for (let i = 0; i < 26; i += 1) {
      const letter = String.fromCharCode(65 + ((letters + i) % 26));
      if (!bezet.has(letter)) {
        letters += i + 1;
        return letter;
      }
    }
    return 'Z';
  }

  /**
   * In de groep onbekenden zetten (of een nieuwe beginnen). Hooguit HOOGSTENS_ONBEKEND groepen
   * (0.13.0): een nieuwe blijft altijd staan; eruit gaat eerst een oude die nog geen drie keer kwam
   * (de langst niet geziene), en pas als die er niet zijn de nieuwe zelf. Een groep die nog geen drie
   * keer kwam en twee weken wegbleef, vervalt; zo raakt de lijst niet vol met eenmalige dingen.
   * `delen`: de kWh per dag (kwhPerDag), voor de week en de dag als de groep later een naam krijgt.
   * `alGeteld` (1.4.0): op een profiel geraden en al bij die soort geteld; dan alleen de handtekening
   * bijwerken (zo kan de app vragen of het klopt), niet nog eens tellen.
   */
  function bijOnbekend(r, delen, { alGeteld = false } = {}) {
    let c = clusterVoor(r.k);
    if (!c) {
      c = { id: `g-${r.id}`.slice(0, 24), letter: null, w: r.w, duur_s: r.k.duur_s, fasen: [0, 0, 0], uren: leegUren(), dagen: leegDagen(), n: 0, laatst: r.tot };
      onbekend.push(c);
    }
    // Het gemiddelde over hooguit de laatste twintig keer: zo volgt het een apparaat dat iets verandert.
    const m = Math.min(c.n, 19);
    c.w = Math.round((c.w * m + r.w) / (m + 1));
    c.duur_s = Math.round((c.duur_s * m + r.k.duur_s) / (m + 1));
    if (r.k.fase) c.fasen[r.k.fase - 1] += 1;
    c.uren[uurInNederland(r.van)] += 1;
    const { datum, dag } = dagInNederland(r.van);
    c.dagen[dag] += 1;
    c.n += 1;
    c.laatst = r.tot;
    // De handtekening (1.4.0): hoe het aangaat en zich gedraagt, wanneer het begon, op hoeveel dagen.
    const vorm = vormVan(r.k);
    c.vormen = { ...(c.vormen && typeof c.vormen === 'object' ? c.vormen : {}) };
    c.vormen[vorm] = (c.vormen[vorm] ?? 0) + 1;
    c.tijden = [...(Array.isArray(c.tijden) ? c.tijden : []), r.van].slice(-HOOGSTENS_TIJDEN);
    if (c.datum !== datum) {
      c.datum = datum;
      c.op_dag = 0;
      c.dagen_gezien = (c.dagen_gezien ?? 0) + 1;
    }
    c.op_dag = (c.op_dag ?? 0) + 1;
    c.keren = (c.keren ?? 0) + 1;
    if (!c.letter && c.n >= VRAAG_NA) c.letter = vrijeLetter();
    if (alGeteld && r.soort) {
      // Nu op een profiel herkend (de koelkast na een paar keer in zijn ritme): wat de groep eerder zonder
      // naam bijhield, hoort daar ook bij. Dan staat hij niet half als "Onbekend apparaat A" in Overzicht.
      verhuisGroep(c, { soort: r.soort, ...(r.naam ? { naam: r.naam } : {}) });
    } else if (!alGeteld) {
      // Per week en per dag bijhouden (alleen de laatste twee), zodat een label voor de groep ze alsnog kan tellen.
      c.weken = Object.fromEntries(Object.entries({ ...(c.weken ?? {}) }).sort().slice(-1));
      c.perDag = Object.fromEntries(Object.entries({ ...(c.perDag ?? {}) }).sort().slice(-1));
      r.inGroep = delen.map((d, i) => ({ datum: d.datum, week: weekVan(d.ms), kwh: d.kwh, keer: i === 0 ? 1 : 0 }));
      for (const d of r.inGroep) {
        c.weken[d.week] ??= { keer: 0, kwh: 0 };
        c.weken[d.week].keer += d.keer;
        c.weken[d.week].kwh += d.kwh;
        c.perDag[d.datum] ??= { keer: 0, kwh: 0 };
        c.perDag[d.datum].keer += d.keer;
        c.perDag[d.datum].kwh += d.kwh;
      }
    }
    // Wat we bij elk lid vermoedden ("misschien koelkast"): het meest genoemde gaat mee als vermoeden.
    if (r.soort) {
      c.gok = c.gok && typeof c.gok === 'object' ? c.gok : {};
      c.gok[r.soort] = (c.gok[r.soort] ?? 0) + 1;
    }
    r.cluster = c.id;
    onbekend = onbekend.filter((x) => x === c || r.tot - x.laatst <= (x.n >= 3 ? 4 : 1) * ONBEKEND_VERVALT_MS);
    if (onbekend.length > HOOGSTENS_ONBEKEND) {
      const zwak = onbekend.filter((x) => x !== c && x.n < 3).sort((a, b) => a.laatst - b.laatst)[0];
      // Allemaal al vaker gezien (de app vraagt erom): dan wacht deze nieuwe tot er een benoemd is of vervalt.
      const weg = zwak ?? c;
      onbekend = onbekend.filter((x) => x !== weg);
      if (weg === c) {
        delete r.cluster;
        delete r.inGroep;
      }
    }
  }

  /**
   * Wat een groep onbekenden per week en per dag bijhield, bij een apparaat tellen (een label voor de
   * groep, of een profiel dat hem nu herkent), en de leden als geteld markeren. De groep zelf houdt
   * daarna niets meer bij tot er een nieuw lid zonder naam komt.
   */
  function verhuisGroep(c, wat) {
    const sleutel = `${wat.soort}|${wat.naam ?? ''}`;
    for (const [week, t] of Object.entries(c.weken ?? {})) {
      if (!(week in weken) && week < Object.keys(weken).sort()[0]) continue;
      weken[week] ??= {};
      const doel = (weken[week][sleutel] ??= { ...wat, keer: 0, kwh: 0 });
      doel.keer += t.keer;
      doel.kwh += t.kwh;
    }
    // En per dag, als die dag er nog is (vandaag of gisteren).
    for (const [dag, t] of Object.entries(c.perDag ?? {})) {
      if (!dagen[dag]) continue;
      const doel = (dagen[dag].apparaten[sleutel] ??= { ...wat, keer: 0, kwh: 0 });
      doel.keer += t.keer;
      doel.kwh += t.kwh;
    }
    c.weken = {};
    c.perDag = {};
    for (const r of recent) {
      if (r.cluster !== c.id) continue;
      r.geteld = true;
      delete r.inGroep;
    }
  }

  /** De stukken van een gebeurtenis: [van, tot, w]; een puls of cyclus heeft er een per keer aan (0.13.0). */
  const stukkenVan = (r) => (Array.isArray(r.stukken) && r.stukken.length ? r.stukken : [[r.van, r.tot, r.w]]);

  /** Bijtellen in de week en de dag, per deel (kwhPerDag); de keer bij het eerste deel. */
  function telDelen(sleutel, wat, delen, keer = 1) {
    delen.forEach((d, i) => tel(sleutel, wat, d.ms, d.kwh, i === 0 ? keer : 0));
  }

  /** De dag (Nederlandse tijd) in de telling per dag; alleen vandaag en gisteren blijven. */
  function dagVoor(ms) {
    const datum = DATUM_NL.format(ms);
    dagen[datum] ??= { apparaten: {}, basis: 0 };
    for (const d of Object.keys(dagen).sort().slice(0, -2)) delete dagen[d];
    return dagen[datum] ?? { apparaten: {}, basis: 0 };
  }

  /** Bijtellen in de week en de dag: keer en kWh per apparaat. */
  function tel(sleutel, wat, van, kwh, keer = 1) {
    const week = weekVan(van);
    weken[week] ??= {};
    const t = (weken[week][sleutel] ??= { ...wat, keer: 0, kwh: 0 });
    t.keer += keer;
    t.kwh += kwh;
    // Alleen deze en vorige week.
    for (const w of Object.keys(weken).sort().slice(0, -2)) delete weken[w];
    const d = dagVoor(van);
    const td = (d.apparaten[sleutel] ??= { ...wat, keer: 0, kwh: 0 });
    td.keer += keer;
    td.kwh += kwh;
  }

  /**
   * Een gebeurtenis die klaar is (tien minuten na het einde: dan hoort er geen
   * stukje puls of cyclus meer bij): het gewone tijdstip bijwerken, tellen in
   * de week, of (onbekend) in een groep onbekenden zetten.
   */
  function rondAf(r, t) {
    r.afgerond = true;
    const label = labelVoor(r);
    const soort = label?.soort ?? r.soort;
    const naam = label?.naam ?? r.naam;
    const zeker = label ? 1 : r.zeker;
    if (soort && zeker >= 0.6) {
      const sleutel = `${soort}|${naam ?? ''}`;
      const g = gewoonten.get(sleutel) ?? { uren: leegUren(), dagen: leegDagen(), n: 0 };
      g.uren[uurInNederland(r.van)] += 1;
      g.dagen[dagInNederland(r.van).dag] += 1;
      g.n += 1;
      // Na 200 keer de oude helft vergeten: zo volgt het een nieuwe gewoonte.
      if (g.n > 200) {
        g.uren = g.uren.map((v) => v / 2);
        g.dagen = g.dagen.map((v) => v / 2);
        g.n /= 2;
      }
      gewoonten.set(sleutel, g);
    }
    // Naar de tijd over de dagen verdeeld; een dag die al voorbij is (na middernacht), telt bij vandaag.
    const delen = kwhPerDag(stukkenVan(r), { nu: t });
    if (soort && zeker >= 0.5) {
      telDelen(`${soort}|${naam ?? ''}`, { soort, ...(naam ? { naam } : {}) }, delen);
      r.geteld = true;
    }
    // In een groep (1.4.0): alles wat de gebruiker nog niet aanwees, ook wat alleen op een profiel
    // geraden is ("misschien een koelkast"). Komt het terug, dan vraagt de app of het klopt. Wat uit een
    // aangewezen handtekening herkend is, kent de gebruiker al.
    if (!label && !(r.geleerd && zeker >= 0.6)) bijOnbekend(r, delen, { alGeteld: Boolean(r.geteld) });
  }

  /**
   * Een apparaat dat twaalf uur aan staat (LANG_AAN_MS), hoort voortaan bij de basis. Wat het tot
   * nu gebruikte, telt alsnog (0.13.0): bij het apparaat als het herkend is (een warmtepomp), anders
   * bij de basis. Voorheen telde die tijd nergens en stond hij in Overzicht als "Rest".
   */
  function langAan(a, t) {
    const r = raad(kenmerkenActief(a, t), a.van, a.id);
    const delen = kwhPerDag([[a.van, t, a.w]], { nu: t });
    if (r.soort && r.zeker >= 0.5) telDelen(`${r.soort}|${r.naam ?? ''}`, { soort: r.soort, ...(r.naam ? { naam: r.naam } : {}) }, delen);
    else for (const d of delen) dagVoor(d.ms).basis += d.kwh;
  }

  function onrustVan(a) {
    if (a.w < 300 || a.onrustN < 3) return null;
    return Math.max(0, a.onrustSom / a.onrustN - onrustLeeg) / a.w;
  }

  function kenmerkenActief(a, nu) {
    return { w: a.w, duur_s: (nu - a.van) / 1000, klaar: false, traag: a.traag, ...(a.piek_w ? { piek_w: a.piek_w } : {}), ruis: onrustVan(a), vorm: null, ritme: ritmeVan(a.w, a.van), fase: a.fase };
  }

  /** In de lijst Eerder (nieuwste eerst); een gebeurtenis met hetzelfde id wordt vervangen. */
  function zetRecent(item) {
    recent = [item, ...recent.filter((r) => r.id !== item.id)].sort((a, b) => b.tot - a.tot).slice(0, HOOGSTENS_RECENT * 2);
  }

  function groepKenmerken(g) {
    const duren = g.leden.map((l) => (l.tot - l.van) / 1000);
    return {
      w: Math.round(mediaan(g.leden.map((l) => l.w))),
      duur_s: (g.leden.at(-1).tot - g.leden[0].van) / 1000,
      klaar: true,
      traag: false,
      ruis: null,
      vorm: mediaan(duren) <= PULS_S ? 'puls' : 'cyclus',
      ritme: false,
      fase: meestal(g.leden.map((l) => l.fase ?? null)),
    };
  }

  /**
   * Een apparaat ging uit: als gebeurtenis bewaren, en kijken of het bij een puls of cyclus hoort.
   * `uit`: de stap omlaag; ging die traag (een warmtepomp die afbouwt), dan staat dat in de handtekening.
   */
  function sluit(a, tot, uit = null) {
    const duur = (tot - a.van) / 1000;
    const k = {
      w: a.w,
      duur_s: duur,
      klaar: true,
      traag: a.traag,
      ...(a.piek_w ? { piek_w: a.piek_w } : {}),
      ...(uit?.traag ? { uit_traag: true } : {}),
      ruis: onrustVan(a),
      vorm: null,
      ritme: ritmeVan(a.w, a.van),
      fase: a.fase,
    };
    geschiedenis.push({ w: a.w, van: a.van, tot });
    if (isVerwarmen(k)) verwarmd.push({ id: a.id, tot });
    zetRecent({ id: a.id, w: a.w, van: a.van, tot, k, ...raad(k, a.van, a.id) });
    if (duur > KORT_S) return;
    let g = groepen.find((x) => Math.abs(x.w - a.w) <= Math.max(40, 0.25 * x.w) && (a.van - x.leden.at(-1).tot) / 1000 <= Math.max(GROEP_GAT_S, 1.5 * duur));
    if (!g) {
      g = { id: a.id, w: a.w, leden: [] };
      groepen.push(g);
    }
    g.leden.push({ id: a.id, w: a.w, van: a.van, tot, fase: a.fase });
    g.w = Math.round(mediaan(g.leden.map((l) => l.w)));
    if (g.leden.length >= 3) {
      // Eén regel voor de hele puls of cyclus, in plaats van elk stukje.
      const leden = new Set(g.leden.map((l) => l.id));
      recent = recent.filter((r) => !leden.has(r.id) || r.id === g.id);
      const gk = groepKenmerken(g);
      // De stukken: zo telt alleen de tijd dat hij echt aan was, niet de pauzes ertussen.
      const stukken = g.leden.slice(-500).map((l) => [l.van, l.tot, l.w]);
      zetRecent({ id: g.id, w: gk.w, van: g.leden[0].van, tot, k: gk, groep: true, stukken, ...raad(gk, g.leden[0].van, g.id) });
    }
  }

  /** Een sprong verwerken: omhoog = iets ging aan, omlaag = het best passende ging uit. */
  function verwerk(stap) {
    const { delta, t } = stap;
    if (delta >= MIN_W) {
      actief.push({ id: nieuwId(t), w: Math.round(delta), van: t, fase: stap.fase, traag: stap.traag, ...(stap.piek_w ? { piek_w: stap.piek_w } : {}), onrustSom: 0, onrustN: 0 });
      return;
    }
    if (delta > -MIN_W) return;
    const uit = -delta;
    const past = (a) => Math.abs(a.w - uit) <= Math.max(40, 0.3 * a.w);
    let beste = actief.filter(past).sort((a, b) => Math.abs(a.w - uit) - Math.abs(b.w - uit))[0];
    if (beste) {
      actief = actief.filter((a) => a !== beste);
      sluit(beste, t, stap);
      return;
    }
    // Twee tegelijk uit (in dezelfde vijf seconden)?
    for (let i = 0; i < actief.length && !beste; i += 1) {
      for (let j = i + 1; j < actief.length; j += 1) {
        if (Math.abs(actief[i].w + actief[j].w - uit) <= Math.max(50, 0.2 * uit)) {
          const twee = [actief[i], actief[j]];
          actief = actief.filter((a) => !twee.includes(a));
          for (const a of twee) sluit(a, t);
          beste = true;
          break;
        }
      }
    }
    // Anders: iets van vóór de start, of de basis die zakte. Niets te sluiten.
  }

  /** De stap-vinder: geeft een sprong { t, delta, traag, fase } of null. */
  function vindStap(x, t, fasen) {
    if (niveau === null) {
      niveau = x;
      vorigeX = x;
      fasenVoor = fasen;
      return null;
    }
    const drempel = Math.max(MIN_W, 0.05 * niveau, 3 * onrust);
    const d = x - niveau;
    const sprong = Math.abs(x - vorigeX);
    vorigeX = x;
    // Geen sprong ten opzichte van de vorige lezing, alleen verder van het niveau: dat is kruipen
    // (een warmtepomp die langzaam meer gaat doen). Dan loopt het niveau sneller mee, zonder stap.
    const kruipt = !kandidaten.length && Math.abs(d) >= drempel && sprong < 0.6 * drempel;
    if (Math.abs(d) < drempel || kruipt) {
      kandidaten = [];
      onrust += 0.05 * (Math.abs(d) - onrust);
      if (!actief.length) onrustLeeg += 0.05 * (Math.abs(d) - onrustLeeg);
      const nieuwste = actief.at(-1);
      if (nieuwste) {
        nieuwste.onrustSom += Math.abs(d);
        nieuwste.onrustN += 1;
      }
      // Langzaam meelopen: zo wordt een warmtepomp die van 400 naar 500 W kruipt geen reeks stappen.
      niveau += (kruipt ? 0.5 : 0.15) * d;
      fasenVoor = fasen;
      return null;
    }
    kandidaten.push({ x, t, fasen });
    if (kandidaten.length < LEZINGEN) return null;
    const laatste = kandidaten.slice(-LEZINGEN).map((c) => c.x);
    const gem = laatste.reduce((s, v) => s + v, 0) / laatste.length;
    const spreiding = Math.max(...laatste) - Math.min(...laatste);
    const rustig = spreiding <= Math.max(40, 0.08 * Math.abs(gem - niveau));
    // Terug bij het oude niveau na een uitschieter: dan was er niets.
    if (!rustig && kandidaten.length < ONRUSTIG_NA) return null;
    const delta = gem - niveau;
    // Een korte piek bij het aangaan (1.4.0): de hoogste lezing ver boven waar het daarna blijft, zoals de
    // aanloopstroom van een motor of compressor. Met een lezing per 5 s zien we hem niet altijd.
    const top = delta > 0 ? Math.max(...kandidaten.map((c) => c.x)) - niveau : 0;
    const piek = delta >= MIN_W && top >= 1.3 * delta && top - delta >= 40 ? Math.round(top) : null;
    const stap = {
      t: kandidaten[0].t,
      delta,
      traag: kandidaten.length >= TRAAG_NA,
      fase: faseVanSprong(fasenVoor, kandidaten[0].fasen, delta),
      ...(piek ? { piek_w: piek } : {}),
    };
    niveau = gem;
    kandidaten = [];
    fasenVoor = fasen;
    return stap;
  }

  /** Wat er na elke lezing opgeruimd moet: groepen die klaar zijn, apparaten die te lang aan staan, een basis onder nul. */
  function ruimOp(t) {
    groepen = groepen.filter((g) => {
      const laatste = g.leden.at(-1);
      const open = (t - laatste.tot) / 1000 <= Math.max(GROEP_GAT_S, 1.5 * ((laatste.tot - laatste.van) / 1000));
      return open || actief.some((a) => Math.abs(a.w - g.w) <= Math.max(40, 0.25 * g.w));
    });
    // Na 12 uur aan: dat is de basis geworden; wat het tot nu gebruikte, telt nog (langAan).
    for (const a of actief) if (t - a.van >= LANG_AAN_MS) langAan(a, t);
    actief = actief.filter((a) => t - a.van < LANG_AAN_MS);
    // Staat er meer aan dan het niveau toelaat, dan zijn er (ongezien) uitgegaan: de oudste eerst weg.
    while (actief.length && niveau - actief.reduce((s, a) => s + a.w, 0) < -Math.max(60, 0.1 * niveau)) actief.shift();
    while (actief.length > 3 * HOOGSTENS_NU) actief.shift();
    geschiedenis = geschiedenis.filter((g) => t - g.tot <= GESCHIEDENIS_MS).slice(-300);
    verwarmd = verwarmd.filter((v) => t - v.tot <= NA_VERWARMEN_MS);
    recent = recent.filter((r) => t - r.tot <= 24 * 3600_000);
    for (const r of recent) if (!r.afgerond && t - r.tot > 600_000) rondAf(r, t);
  }

  /** Wat er aan de basis is: rust = niveau min wat aan staat; met een warmtepomp die als apparaat herkend is erbij. */
  function basisNu(t) {
    const rust = Math.max(0, niveau - actief.reduce((s, a) => s + a.w, 0));
    let pomp = 0;
    for (const a of actief) {
      const r = raad(kenmerkenActief(a, t), a.van, a.id);
      if (r.soort === 'warmtepomp' && r.zeker >= 0.5) pomp += a.w;
    }
    return { rust, pomp };
  }

  /** Het laagste niveau van de nacht (vijf minuten gemiddeld) en de basis per vijf minuten. */
  function volgBasis(t) {
    const { rust, pomp } = basisNu(t);
    volgBasisDag(t, rust);
    if (pomp) warmtepompGezien = t;
    const vijf = Math.floor(t / 300_000);
    if (!vak || vak.vijf !== vijf) {
      if (vak && vak.n >= 20) {
        const w = vak.som / vak.n;
        const datum = DATUM_NL.format(vak.vijf * 300_000);
        if (uurInNederland(vak.vijf * 300_000) < 5) {
          const nacht = nachten.find((n) => n.datum === datum);
          if (nacht) nacht.w = Math.min(nacht.w, Math.round(w));
          else nachten = [...nachten, { datum, w: Math.round(w) }].slice(-14);
        }
      }
      vak = { vijf, som: 0, n: 0 };
    }
    vak.som += rust;
    vak.n += 1;
    if (vakken.at(-1)?.vijf !== vijf) vakken = [...vakken.filter((v) => vijf - v.vijf < 144), { vijf, som: 0, n: 0 }];
    const v = vakken.at(-1);
    v.som += Math.round(rust + pomp);
    v.n += 1;
  }

  /**
   * De basis in kWh per dag: wat er na aftrek van wat aan staat overblijft
   * (altijd-aan, een warmtepomp die kruipt), keer de tijd sinds de vorige
   * ronde. Een warmtepomp die als apparaat herkend is, telt bij dat apparaat
   * (rondAf), niet hier: zo telt niets twee keer.
   */
  let basisDt = 0;
  function volgBasisDag(t, rust) {
    if (basisDt > 0) dagVoor(t).basis += (rust * basisDt) / 3.6e9;
  }

  /**
   * Wat het programmaatje kent, voor de korte regel "Ik ken nu 4 apparaten van je" (1.4.0): eerst wat de
   * gebruiker aanwees (de handtekeningen uit de labels: hoe vaak, en hoe zeker), dan wat het deze week
   * uit zichzelf herkende (op een profiel), met de middelste zekerheid van de laatste keren, en een
   * warmtepomp in de basis. Hooguit HOOGSTENS_KENNIS. Geen namen van meters: die staan al apart.
   */
  function kennisVoorApp(nu, warmtepomp) {
    const per = new Map();
    for (const h of geleerd.handtekeningen) {
      const sleutel = `${h.soort}|${h.naam ?? ''}`;
      const zeker = Math.min(0.99, 0.85 + 0.05 * h.n) * ((h.n + 1) / (h.n + 1 + 2 * (h.verbeterd ?? 0)));
      const oud = per.get(sleutel);
      per.set(sleutel, { soort: h.soort, ...(h.naam ? { naam: h.naam } : {}), zeker: Math.max(oud?.zeker ?? 0, zeker), aangewezen: (oud?.aangewezen ?? 0) + h.n });
    }
    for (const [sleutel, t] of Object.entries(weken[weekVan(nu)] ?? {})) {
      if (!SOORTEN.includes(t.soort) || per.has(sleutel) || !(t.keer >= 1)) continue;
      const zekerheden = recent.filter((r) => r.soort === t.soort && (r.naam ?? '') === (t.naam ?? '') && getal(r.zeker) !== null).map((r) => r.zeker);
      per.set(sleutel, { soort: t.soort, ...(t.naam ? { naam: t.naam } : {}), zeker: mediaan(zekerheden) ?? 0.5 });
    }
    if (warmtepomp && !per.has('warmtepomp|')) per.set('warmtepomp|', { soort: 'warmtepomp', zeker: 0.6, basis: true });
    const apparaten = [...per.values()]
      .sort((a, b) => (b.aangewezen ?? 0) - (a.aangewezen ?? 0) || b.zeker - a.zeker)
      .slice(0, HOOGSTENS_KENNIS)
      .map((a) => ({ ...a, zeker: rondZeker(a.zeker) }));
    return { apparaten };
  }

  /** Hoe de groep in Overzicht › Apparaten heet: "Onbekend apparaat A, zo'n 1,8 kW". */
  const onbekendNaam = (c) => `Onbekend apparaat ${c.letter}, zo’n ${c.w < 1000 ? `${rond10(c.w)} W` : `${(Math.round(c.w / 100) / 10).toFixed(1).replace('.', ',')} kW`}`;

  return {
    /**
     * Eén meetronde (elke ~5 s).
     * @param {{ nu: number, meting: object }} ronde
     */
    ronde({ nu, meting }) {
      const huis = huisVerbruik(meting);
      if (huis === null) {
        kandidaten = [];
        return;
      }
      const rest = Math.max(0, huis - eigenGemeten(meting));
      // Wat een eigen meter heeft (zoals de spa in huis B), telt in de week mee: keer en kWh.
      const dt = vorigeRonde === null ? 0 : Math.min(30_000, Math.max(0, nu - vorigeRonde));
      vorigeRonde = nu;
      basisDt = dt;
      for (const a of Array.isArray(meting?.apparaten) ? meting.apparaten : []) {
        const w = Math.max(0, getal(a?.vermogen_w) ?? 0);
        if (typeof a?.sleutel !== 'string' || !/^[a-zA-Z0-9._:-]{1,60}$/.test(a.sleutel)) continue;
        const aan = metersAan.get(a.sleutel) ?? false;
        const keer = !aan && w >= 50 ? 1 : 0;
        metersAan.set(a.sleutel, w >= 50 || (aan && w >= 20));
        if (w > 0 || keer) tel(`meter:${a.sleutel}`, { sleutel: a.sleutel, ...(schoonNaam(a.naam) ? { naam: schoonNaam(a.naam) } : {}) }, nu, (w * dt) / 3.6e9, keer);
      }
      const stap = vindStap(rest, nu, fasenVan(meting?.fasen));
      if (stap) verwerk(stap);
      ruimOp(nu);
      volgBasis(nu);
    },

    /**
     * Wat er mee naar de app gaat (Meting.herkend), of null zolang er nog niets gemeten is.
     *   nu      wat er nu waarschijnlijk aan staat (hooguit 10, grootste eerst)
     *   recent  wat er eerder aan stond (hooguit 20, nieuwste eerst)
     *   basis   { w, altijd_w?, warmtepomp }: de langzame basis, het laagste van de nachten, en of daar een warmtepomp in zit
     */
    voorApp(nu) {
      if (niveau === null) return null;
      const items = [];
      const inGroep = new Set();
      for (const g of groepen) {
        if (g.leden.length < 3) continue;
        const loopt = actief.find((a) => Math.abs(a.w - g.w) <= Math.max(40, 0.25 * g.w));
        if (loopt) inGroep.add(loopt.id);
        const gk = { ...groepKenmerken(g), klaar: false, duur_s: (nu - g.leden[0].van) / 1000 };
        items.push({ id: g.id, w: g.w, sinds: g.leden[0].van, k: gk, ...raad(gk, g.leden[0].van, g.id) });
      }
      for (const a of actief) {
        if (inGroep.has(a.id)) continue;
        const k = kenmerkenActief(a, nu);
        items.push({ id: a.id, w: a.w, sinds: a.van, k, ...raad(k, a.van, a.id) });
      }
      // Nog onbekend, maar het lijkt op een groep die vaker terugkwam: dan die letter erbij ("Onbekend apparaat A").
      for (const i of items) {
        if (i.soort && i.zeker >= 0.35) continue;
        const c = clusterVoor({ ...i.k, duur_s: Math.max(i.k.duur_s, 1) });
        if (c && c.n >= VRAAG_NA && c.letter) i.onbekend = c.letter;
      }
      const basis = basisNu(nu);
      const pompItems = items.filter((i) => i.soort === 'warmtepomp' && !i.bevestigd && i.zeker >= 0.5);
      const opApp = (i) => ({
        id: i.id,
        ...(i.soort ? { soort: i.soort } : {}),
        ...(i.naam ? { naam: i.naam } : {}),
        ...(i.deel ? { deel: i.deel } : {}),
        w: rond10(i.w),
        zeker: i.zeker,
        ...(i.k.fase ? { fase: i.k.fase } : {}),
        ...(i.k.vorm ? { vorm: i.k.vorm } : {}),
        ...(i.bevestigd ? { bevestigd: true } : {}),
        ...(i.onbekend && !i.bevestigd ? { onbekend: i.onbekend } : {}),
      });
      const letterVan = (id) => onbekend.find((c) => c.id === id && c.n >= VRAAG_NA)?.letter;
      const vandaag = DATUM_NL.format(nu);
      const altijd = mediaan(nachten.map((n) => n.w));
      const warmtepomp = warmtepompPatroon(vakken) || nu - warmtepompGezien < 48 * 3600_000;
      return {
        nu: items
          .filter((i) => !pompItems.includes(i))
          .sort((a, b) => b.w - a.w)
          .slice(0, HOOGSTENS_NU)
          .map((i) => ({ ...opApp(i), sinds: iso(i.sinds) })),
        recent: recent
          .slice(0, HOOGSTENS_RECENT)
          .map((r) => {
            const label = labelVoor(r);
            // De letter alleen bij wat we zelf niet (of nauwelijks) kennen; "Waterkoker" blijft "Waterkoker".
            const letter = r.soort && r.zeker >= 0.35 ? undefined : letterVan(r.cluster);
            const nu2 = label ? { ...r, soort: label.soort, naam: label.naam, deel: undefined, zeker: 1, bevestigd: true } : { ...r, onbekend: letter };
            return { ...opApp(nu2), van: iso(r.van), tot: iso(r.tot) };
          }),
        // Terugkerend en nog niet aangewezen (minstens VRAAG_NA keer): de app vraagt "Wat is het?"; één label
        // benoemt ze allemaal. Eerst wat de laatste drie dagen kwam, dan wat we zelf niet eens vermoeden, dan het vaakst.
        onbekend: onbekend
          .filter((c) => c.n >= VRAAG_NA)
          .map((c) => {
            const gok = Object.entries(c.gok ?? {}).sort((a, b) => b[1] - a[1])[0];
            return { c, vermoeden: gok && SOORTEN.includes(gok[0]) && gok[1] >= 0.5 * c.n ? gok[0] : null, kort: nu - c.laatst <= 3 * 86_400_000 };
          })
          .sort((a, b) => Number(b.kort) - Number(a.kort) || Number(Boolean(a.vermoeden)) - Number(Boolean(b.vermoeden)) || b.c.n - a.c.n)
          .slice(0, 5)
          .map(({ c, vermoeden }) => {
            c.letter ??= vrijeLetter();
            const fase = Math.max(...c.fasen) >= 0.6 * c.n ? c.fasen.indexOf(Math.max(...c.fasen)) + 1 : null;
            const dagdeel = dagdeelVan(c.uren);
            const dag = dagVan(c.dagen);
            const vorm = hoofdVorm(c);
            const tijden = (Array.isArray(c.tijden) ? c.tijden : []).filter((t) => getal(t) !== null);
            return {
              id: c.id,
              letter: c.letter,
              w: rond10(c.w),
              duur_s: Math.round(c.duur_s / 10) * 10,
              n: c.n,
              ...(fase ? { fase } : {}),
              ...(dagdeel ? { dagdeel } : {}),
              ...(dag !== null ? { dag } : {}),
              ...(vermoeden ? { vermoeden } : {}),
              // De handtekening voor de vraag (1.4.0): de vorm, wanneer het de laatste keren begon, hoe vaak vandaag en per dag.
              ...(vorm ? { vorm } : {}),
              ...(tijden.length ? { tijden: tijden.map(iso) } : {}),
              ...(c.datum === vandaag && c.op_dag ? { vandaag: c.op_dag } : {}),
              ...(c.dagen_gezien >= 2 && c.keren ? { per_dag: Math.round((10 * c.keren) / c.dagen_gezien) / 10 } : {}),
            };
          }),
        // Wat het programmaatje kent (1.4.0): per apparaat hoe zeker, en hoe vaak de gebruiker het aanwees.
        kennis: kennisVoorApp(nu, warmtepomp),
        // Deze week per apparaat: hoe vaak en hoeveel kWh (herkend en met een eigen meter), met wanneer het meestal is.
        week: (() => {
          const van = weekVan(nu);
          const apparaten = Object.entries(weken[van] ?? {})
            .filter(([, t]) => t.kwh >= 0.05 || t.keer > 0)
            .sort((a, b) => b[1].kwh - a[1].kwh)
            .slice(0, 12)
            .map(([sleutel, t]) => {
              const g = gewoonten.get(sleutel);
              const dagdeel = g ? dagdeelVan(g.uren) : null;
              const dag = g ? dagVan(g.dagen) : null;
              return {
                ...(t.soort ? { soort: t.soort } : {}),
                ...(t.naam ? { naam: t.naam } : {}),
                ...(t.sleutel ? { sleutel: t.sleutel } : {}),
                keer: Math.round(t.keer),
                kwh: Math.round(t.kwh * 10) / 10,
                ...(dagdeel ? { dagdeel } : {}),
                ...(dag !== null ? { dag } : {}),
              };
            });
          return { van, apparaten };
        })(),
        basis: {
          // Op 25 W: zo verandert het blok niet bij elke paar watt die de warmtepomp kruipt.
          w: Math.round((basis.rust + basis.pomp) / 25) * 25,
          ...(altijd !== null ? { altijd_w: Math.round(altijd / 10) * 10 } : {}),
          warmtepomp,
        },
      };
    },

    /**
     * Per apparaat van één dag (0.12.0): wat er mee gaat in meting.dag, of {} als er
     * die dag nog niets geteld is (dan gaat er niets extra mee).
     *   apparaten  hooguit HOOGSTENS_DAG_APPARATEN, meeste kWh eerst:
     *              { sleutel, soort?, naam?, kwh (op 0,01), keer, gemeten? }
     *              gemeten: true = een eigen meter (sleutel van die meter), anders herkend
     *              (sleutel 'h:soort' of 'h:soort:naam', zoals de app hem terugkent)
     *   basis_kwh  de basis van die dag (altijd-aan, een kruipende warmtepomp)
     * @param {string} datum  'JJJJ-MM-DD' (de datum van meting.dag)
     */
    dagVoorApp(datum) {
      const d = dagen[datum];
      if (!d) return {};
      const r2 = (v) => Math.round(v * 100) / 100;
      // Wat vaker terugkomt maar nog geen naam heeft (1.4.0), staat er apart in, niet in de Rest:
      // "Onbekend apparaat A, zo'n 1,8 kW". Alleen wat nog nergens anders geteld is (perDag).
      const groepen = onbekend
        .filter((c) => c.n >= VRAAG_NA && c.letter && c.perDag?.[datum])
        .map((c) => [`onbekend|${c.id}`, { onbekend: c, keer: c.perDag[datum].keer, kwh: c.perDag[datum].kwh }]);
      const apparaten = [...Object.entries(d.apparaten), ...groepen]
        .filter(([, t]) => t.kwh >= 0.005 || t.keer > 0)
        .sort((a, b) => b[1].kwh - a[1].kwh)
        .slice(0, HOOGSTENS_DAG_APPARATEN)
        .map(([sleutel, t]) => {
          if (t.onbekend) return { sleutel: `h:onbekend:${t.onbekend.id}`.slice(0, 60), naam: onbekendNaam(t.onbekend), kwh: r2(t.kwh), keer: Math.round(t.keer) };
          const gemeten = sleutel.startsWith('meter:');
          return {
            sleutel: gemeten ? t.sleutel : herkendSleutel(t.soort, t.naam),
            ...(t.soort && !gemeten ? { soort: t.soort } : {}),
            ...(t.naam ? { naam: t.naam } : {}),
            kwh: r2(t.kwh),
            keer: Math.round(t.keer),
            ...(gemeten ? { gemeten: true } : {}),
          };
        });
      return { apparaten, basis_kwh: r2(d.basis) };
    },

    /** Het moment van het nieuwste label (of null): gaat mee in het brugblok (brug.labels_op). */
    get labelsOp() {
      return labels.at(-1)?.op ?? null;
    },

    /** De labels uit de app overnemen (alle, de server stuurt de hele lijst); de handtekeningen opnieuw. */
    zetLabels(lijst) {
      const nieuw = labelsUit(lijst);
      if (!nieuw.length) return false;
      labels = nieuw;
      geleerd = handtekeningenUit(labels);
      // Wat er al stond: opnieuw raden met wat we nu weten.
      recent = recent.map((r) => ({ ...r, soort: undefined, naam: undefined, deel: undefined, bevestigd: undefined, geleerd: undefined, ...raad(r.k, r.van, r.id, r.cluster) }));
      // Een groep onbekenden die nu een naam kreeg: zijn keren en kWh alsnog in de week.
      for (const c of onbekend) {
        const l = labelVan(c.id);
        if (!l) continue;
        verhuisGroep(c, { soort: l.soort, ...(l.naam ? { naam: l.naam } : {}) });
        // En wanneer hij meestal kwam: dat is nu de gewoonte van dit apparaat.
        const sleutel = `${l.soort}|${l.naam ?? ''}`;
        const g = gewoonten.get(sleutel) ?? { uren: leegUren(), dagen: leegDagen(), n: 0 };
        gewoonten.set(sleutel, { uren: g.uren.map((v, i) => v + c.uren[i]), dagen: g.dagen.map((v, i) => v + c.dagen[i]), n: g.n + c.n });
      }
      // Pas nu benoemd (zelf, of via zijn groep): alsnog tellen in de week.
      for (const r of recent) {
        if (r.afgerond && !r.geteld && labelVoor(r)) {
          const l = labelVoor(r);
          telDelen(`${l.soort}|${l.naam ?? ''}`, { soort: l.soort, ...(l.naam ? { naam: l.naam } : {}) }, kwhPerDag(stukkenVan(r)));
          r.geteld = true;
          // Stond hij in een groep onbekenden zonder naam: daar weer uit, anders telt een label op
          // die groep hem straks nog eens (0.13.0). Van 0.12.0: zoals bijOnbekend hem toen telde.
          const c = onbekend.find((x) => x.id === r.cluster);
          if (c && !labelVan(c.id)) {
            const delen = r.inGroep ?? [{ datum: DATUM_NL.format(r.van), week: weekVan(r.van), kwh: (r.w * (r.tot - r.van)) / 3.6e9, keer: 1 }];
            for (const d of delen) {
              for (const [rij, sleutel] of [[c.perDag, d.datum], [c.weken, d.week]]) {
                const t = rij?.[sleutel];
                if (!t) continue;
                t.keer = Math.max(0, t.keer - d.keer);
                t.kwh = Math.max(0, t.kwh - d.kwh);
              }
            }
            delete r.inGroep;
          }
        }
      }

      // Een groep onbekenden met een label is niet onbekend meer; de handtekening neemt het over.
      onbekend = onbekend.filter((c) => !labelVan(c.id));
      return true;
    },

    /** Wat in herkennen.json gaat: klein, en genoeg om na een herstart verder te gaan. */
    bewaar() {
      return {
        v: 1,
        labels,
        nachten,
        vakken,
        geschiedenis: geschiedenis.slice(-300),
        recent: recent.slice(0, HOOGSTENS_RECENT * 2),
        verwarmd,
        warmtepomp_gezien: warmtepompGezien,
        gewoonten: Object.fromEntries(gewoonten),
        onbekend,
        letters,
        weken,
        dagen,
      };
    },
  };
}

const tekstPad = (pad) => (pad instanceof URL ? fileURLToPath(pad) : String(pad));

function leesStaat(pad) {
  try {
    const staat = JSON.parse(fs.readFileSync(pad, 'utf8'));
    return staat && typeof staat === 'object' && !Array.isArray(staat) ? staat : null;
  } catch {
    return null;
  }
}

/**
 * herkennen.json lezen, zo veilig als vandaag.json (0.13.0): kapot of weg, dan de vorige
 * (herkennen.json.vorige). Alleen met `log` (het draaiende programmaatje) gaat een kapot bestand
 * opzij als herkennen.json.kapot, met één regel in het logboek. Allebei weg: null (dan begint het
 * herkennen opnieuw; de labels komen weer van de app).
 */
export function laadHerkennen(pad, { log = null } = {}) {
  const doel = tekstPad(pad);
  const staat = leesStaat(doel);
  if (staat) return staat;
  if (log && fs.existsSync(doel)) {
    try {
      fs.renameSync(doel, `${doel}.kapot`);
      log(`${path.basename(doel)} was kapot; ik heb hem opzij gezet als ${path.basename(doel)}.kapot.`);
    } catch {
      // Opzij zetten lukte niet: dan wordt hij bij de volgende keer bewaren vervangen.
    }
  }
  const vorige = leesStaat(`${doel}.vorige`);
  if (vorige && log) log(`${path.basename(doel)} was kapot of weg; ik ga verder met de vorige.`);
  return vorige;
}

/**
 * herkennen.json bewaren zoals vandaag.json (bewaarStand in kosten.mjs): eerst naast (.nieuw), naar
 * de opslag geschreven (fsync), de vorige als .vorige bewaard, dan erover. Zo laat een harde uitval
 * (stroom weg, lege accu) altijd een heel bestand achter. Gooit niet: geeft de fout, of null.
 */
export function bewaarHerkennen(pad, staat) {
  try {
    const doel = tekstPad(pad);
    const nieuw = `${doel}.nieuw`;
    const fd = fs.openSync(nieuw, 'w');
    try {
      fs.writeSync(fd, JSON.stringify(staat));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (fs.existsSync(doel)) fs.renameSync(doel, `${doel}.vorige`);
    fs.renameSync(nieuw, doel);
    return null;
  } catch (fout) {
    return fout;
  }
}

