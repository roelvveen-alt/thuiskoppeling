/**
 * KOPIE, niet bijwerken: controle.js van ontvangMeting zoals die live staat sinds
 * uitrol/2026-10-31-0336 (voor programmaatje 1.4.0). base44/tests/nieuweBrug.test.js
 * laat zien dat een meting van brug 1.4.0 hier ook doorheen komt (wat deze versie
 * niet kent, valt stil weg). Staat bij de tests: gaat niet naar Base44.
 */
/**
 * Wat ontvangMeting aanneemt. Los van entry.ts, zodat de tests het zonder
 * Base44 kunnen nalopen (base44/tests/controle.test.js).
 *
 * Streng op vorm, mild op inhoud: een getal dat er niet is wordt null (die
 * meter is er dan niet), maar een getal dat geen getal is of absurd groot,
 * weigert de hele meting. Dan klopt er iets niet aan de kant van thuis.
 */

import { basisKwhUit, dagApparatenUit, herkendUit } from '../../shared/herkennen.js';
import { gemeldUit, publiekVorm } from '../../shared/opAfstand.js';
import { schoon } from '../../shared/tekst.js';

/** Meer dan 100 kW is geen huis meer. */
const GRENS_W = 100_000;
const HOOGSTENS_APPARATEN = 40;
const HOOGSTENS_ZONNEN = 10;

export class Afgekeurd extends Error {}

function vermogen(waarde, naam) {
  if (waarde === null || waarde === undefined) return null;
  if (typeof waarde !== 'number' || !Number.isFinite(waarde) || Math.abs(waarde) > GRENS_W) {
    throw new Afgekeurd(`${naam} is geen geldig vermogen`);
  }
  return Math.round(waarde);
}

function tekst(waarde, naam, { max, vorm } = {}) {
  if (typeof waarde !== 'string' || waarde.length === 0 || waarde.length > max || (vorm && !vorm.test(waarde))) {
    throw new Afgekeurd(`${naam} klopt niet`);
  }
  return waarde;
}

/** Een getal binnen grenzen, of de meting klopt niet. */
function getalTussen(waarde, naam, min, max) {
  if (typeof waarde !== 'number' || !Number.isFinite(waarde) || waarde < min || waarde > max) {
    throw new Afgekeurd(`${naam} klopt niet`);
  }
  return waarde;
}

const ISO_MOMENT = /^\d{4}-\d{2}-\d{2}T[0-9:.+\-Z]{5,30}$/;

/** Van welke meter het net komt: de HomeWizard P1, of de Zendure P1 als reserve. */
const NET_BRONNEN = new Set(['homewizard', 'zendure-p1']);

function netBronUit(b) {
  if (b === null || b === undefined) return null;
  if (!NET_BRONNEN.has(b)) throw new Afgekeurd('net_bron klopt niet');
  return b;
}

/**
 * Meer dan dit (euro per kWh, boven of onder nul) bestaat niet. Ruim: de
 * day-ahead-markt kan tot zo'n € 4 en die grens kan omhoog; "alles erin" komt
 * daar nog boven.
 */
const PRIJS_GRENS = 20;

/** De prijs van dit moment. */
function prijsUit(p) {
  if (p === null || p === undefined) return null;
  if (typeof p !== 'object' || Array.isArray(p)) throw new Afgekeurd('prijs klopt niet');
  return {
    afname_kwh: getalTussen(p.afname_kwh, 'prijs.afname_kwh', -PRIJS_GRENS, PRIJS_GRENS),
    teruglevering_kwh: getalTussen(p.teruglevering_kwh, 'prijs.teruglevering_kwh', -PRIJS_GRENS, PRIJS_GRENS),
    zonnebonus_kwh: p.zonnebonus_kwh === undefined ? 0 : getalTussen(p.zonnebonus_kwh, 'prijs.zonnebonus_kwh', 0, PRIJS_GRENS),
    van: p.van === undefined ? null : tekst(p.van, 'prijs.van', { max: 40, vorm: ISO_MOMENT }),
    tot: p.tot === undefined ? null : tekst(p.tot, 'prijs.tot', { max: 40, vorm: ISO_MOMENT }),
    bron: schoon(p.bron, 40),
  };
}

/** Wat er vandaag door de meterkast ging en wat dat kostte of opleverde. */
function vandaagUit(v) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object' || Array.isArray(v)) throw new Afgekeurd('vandaag klopt niet');
  return {
    datum: tekst(v.datum, 'vandaag.datum', { max: 10, vorm: /^\d{4}-\d{2}-\d{2}$/ }),
    afname_kwh: getalTussen(v.afname_kwh, 'vandaag.afname_kwh', 0, 2000),
    teruglevering_kwh: getalTussen(v.teruglevering_kwh, 'vandaag.teruglevering_kwh', 0, 2000),
    kosten_eur: getalTussen(v.kosten_eur, 'vandaag.kosten_eur', -2000, 2000),
    opbrengst_eur: getalTussen(v.opbrengst_eur, 'vandaag.opbrengst_eur', -2000, 2000),
    vaste_kosten_eur:
      v.vaste_kosten_eur === undefined || v.vaste_kosten_eur === null ? null : getalTussen(v.vaste_kosten_eur, 'vandaag.vaste_kosten_eur', -100, 100),
    compleet: v.compleet !== false,
  };
}

/** Wat er dit kalenderjaar is teruggeleverd, tegenover het plafond van de Zonnebonus. */
function jaarUit(j) {
  if (j === null || j === undefined) return null;
  if (typeof j !== 'object' || Array.isArray(j) || !Number.isInteger(j.jaar)) throw new Afgekeurd('jaar klopt niet');
  return {
    jaar: getalTussen(j.jaar, 'jaar.jaar', 2020, 2100),
    teruglevering_kwh: getalTussen(j.teruglevering_kwh, 'jaar.teruglevering_kwh', 0, 1_000_000),
    plafond_kwh: getalTussen(j.plafond_kwh, 'jaar.plafond_kwh', 0, 1_000_000),
  };
}

/** Een rij getallen binnen grenzen: niet leeg, hooguit `hoogstens` lang, en zo nodig precies `lengte`. */
function rij(waarde, naam, { min, max, hoogstens, lengte }) {
  if (!Array.isArray(waarde) || waarde.length === 0 || waarde.length > hoogstens || (lengte !== undefined && waarde.length !== lengte)) {
    throw new Afgekeurd(`${naam} klopt niet`);
  }
  return waarde.map((v, i) => getalTussen(v, `${naam}[${i}]`, min, max));
}

/** Tekst van thuis: zonder stuurtekens en omkeertekens, op lengte (base44/shared/tekst.js). */
const kort = schoon;

/** Vandaag en morgen per kwartier; een dag van 25 uur meegerekend. */
const HOOGSTENS_PRIJSKWARTIEREN = 200;
const HOOGSTENS_DAGKWARTIEREN = 100;
const HOOGSTENS_GEKOPPELD = 60;

/** De prijzen per kwartier van vandaag en (vanaf ~13:00) morgen, voor de grafiek. */
function voorspellingUit(v) {
  if (typeof v !== 'object' || Array.isArray(v)) throw new Afgekeurd('voorspelling klopt niet');
  const grens = { min: -PRIJS_GRENS, max: PRIJS_GRENS, hoogstens: HOOGSTENS_PRIJSKWARTIEREN };
  const afname = rij(v.afname_kwh, 'voorspelling.afname_kwh', grens);
  const lengte = afname.length;
  if (v.stap_min !== 15) throw new Afgekeurd('voorspelling.stap_min klopt niet');
  return {
    van: tekst(v.van, 'voorspelling.van', { max: 40, vorm: ISO_MOMENT }),
    stap_min: 15,
    afname_kwh: afname,
    teruglevering_kwh: rij(v.teruglevering_kwh, 'voorspelling.teruglevering_kwh', { ...grens, lengte }),
    zonnebonus_kwh: rij(v.zonnebonus_kwh, 'voorspelling.zonnebonus_kwh', { ...grens, min: 0, lengte }),
    schatting: v.schatting === true,
    bron: kort(v.bron, 40),
  };
}

/** Per reeks van het weer: de grenzen en op hoeveel decimalen (brug/weer.mjs kijkt hetzelfde na). */
const WEER_REEKSEN = {
  straling_wm2: [0, 1500, 0],
  bewolking_pct: [0, 100, 0],
  temp_c: [-60, 60, 1],
  // Sinds 0.10.0 (het tabblad Voorspelling); de weercode moet een heel getal zijn.
  weercode: [0, 99, 0, true],
  neerslag_mm: [0, 500, 1],
  neerslag_kans_pct: [0, 100, 0],
  windstoten_kmh: [0, 500, 0],
};
/** Vandaag en morgen per uur (48), met wat ruimte. */
const HOOGSTENS_WEERUREN = 72;

/**
 * Het weerbericht per uur (programmaatje 0.9.0, brug/weer.mjs), mild zoals
 * batterij_info: het is een extra voor Advies, dus wat niet klopt gaat niet
 * mee en de meting wel. Een reeks met een vreemde waarde, of die niet even lang
 * is als de eerste goede, valt weg; zonder een geldig begin, een stap van 60
 * minuten, of zonder straling en bewolking: null (dan blijft het vorige
 * bericht in de rij staan, want het veld gaat dan niet mee).
 */
function weerUit(w) {
  if (!w || typeof w !== 'object' || Array.isArray(w) || w.stap_min !== 60) return null;
  const moment = (t) => typeof t === 'string' && t.length <= 40 && ISO_MOMENT.test(t) && Number.isFinite(Date.parse(t));
  if (!moment(w.van)) return null;
  const uit = { van: w.van, stap_min: 60 };
  let lengte = null;
  for (const [veld, [min, max, decimalen, heel]] of Object.entries(WEER_REEKSEN)) {
    const rij = w[veld];
    if (!Array.isArray(rij) || rij.length === 0 || rij.length > HOOGSTENS_WEERUREN || (lengte !== null && rij.length !== lengte)) continue;
    if (!rij.every((v) => goedGetal(v, min, max) && (!heel || Number.isInteger(v)))) continue;
    lengte ??= rij.length;
    uit[veld] = rij.map((v) => afgerond(v, decimalen));
  }
  if (!uit.straling_wm2 && !uit.bewolking_pct) return null;
  const nu = weerNuUit(w.nu);
  if (nu) uit.nu = nu;
  if (moment(w.opgehaald)) uit.opgehaald = w.opgehaald;
  uit.bron = kort(w.bron, 40);
  return uit;
}

/** Het weer van nu (0.9.0, voor de tekening): per veld de grenzen en de decimalen. */
const WEER_NU_GETALLEN = { neerslag_mm: [0, 500, 1], wind_kmh: [0, 400, 0], windstoten_kmh: [0, 500, 0], bewolking_pct: [0, 100, 0] };

/** { code, neerslag_mm, wind_kmh, windstoten_kmh, bewolking_pct }, mild: wat niet klopt valt weg; niets over: null. */
function weerNuUit(n) {
  if (!n || typeof n !== 'object' || Array.isArray(n)) return null;
  const uit = {};
  if (Number.isInteger(n.code) && n.code >= 0 && n.code <= 99) uit.code = n.code;
  for (const [veld, [min, max, decimalen]] of Object.entries(WEER_NU_GETALLEN)) {
    if (goedGetal(n[veld], min, max)) uit[veld] = afgerond(n[veld], decimalen);
  }
  return Object.keys(uit).length ? uit : null;
}

/** Meer dan 1.000 A of V per fase bestaat in een huis niet. */
const GRENS_FASE = 1000;

/** Per fase van de P1-meter: 1, 2 of 3, elk hooguit één keer. */
function fasenLijst(lijst, naam, maak) {
  if (!Array.isArray(lijst) || lijst.length === 0 || lijst.length > 3) throw new Afgekeurd(`${naam} klopt niet`);
  const gezien = new Set();
  return lijst.map((f, i) => {
    if (!f || typeof f !== 'object' || ![1, 2, 3].includes(f.fase) || gezien.has(f.fase)) throw new Afgekeurd(`${naam} ${i + 1} klopt niet`);
    gezien.add(f.fase);
    return { fase: f.fase, ...maak(f, `${naam} L${f.fase}`) };
  });
}

/** Per fase nu: vermogen (met teken), stroom en spanning; wat ontbreekt staat er niet. */
function fasenNuUit(lijst) {
  return fasenLijst(lijst, 'fasen', (f, naam) => ({
    ...(f.w == null ? {} : { w: vermogen(f.w, `${naam}.w`) }),
    ...(f.a == null ? {} : { a: getalTussen(f.a, `${naam}.a`, 0, GRENS_FASE) }),
    ...(f.v == null ? {} : { v: getalTussen(f.v, `${naam}.v`, 0, GRENS_FASE) }),
  }));
}

/** Een kWh-getal van vandaag (0 tot 2000), of null. */
const kwhOfNiets = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 2000 ? v : null);

/**
 * Wie aan wie leverde, per meting opgeteld (programmaatje 1.2.0): zon naar
 * huis of batterij, en net naar huis. Mild en samen: ontbreekt er één of klopt
 * er één niet, dan gaan ze geen van beide mee; de dag wel.
 */
function stromenKwhUit(kwh) {
  const zonZelf = kwhOfNiets(kwh.zon_zelf);
  const netHuis = kwhOfNiets(kwh.net_huis);
  return zonZelf === null || netHuis === null ? {} : { zon_zelf: zonZelf, net_huis: netHuis };
}

/** Vandaag per kwartier: gemiddelden van zon, huis, batterij en net, en de kWh tot nu. */
function dagUit(d) {
  if (typeof d !== 'object' || Array.isArray(d)) throw new Afgekeurd('dag klopt niet');
  if (d.stap_min !== 15) throw new Afgekeurd('dag.stap_min klopt niet');
  const metingen = rij(d.metingen, 'dag.metingen', { min: 0, max: 10_000, hoogstens: HOOGSTENS_DAGKWARTIEREN }).map(Math.round);
  const lengte = metingen.length;
  const reeks = (veld, min, max) => (d[veld] === undefined ? {} : { [veld]: rij(d[veld], `dag.${veld}`, { min, max, hoogstens: HOOGSTENS_DAGKWARTIEREN, lengte }).map(Math.round) });
  const kwh = d.kwh;
  if (!kwh || typeof kwh !== 'object' || Array.isArray(kwh)) throw new Afgekeurd('dag.kwh klopt niet');
  return {
    datum: tekst(d.datum, 'dag.datum', { max: 10, vorm: /^\d{4}-\d{2}-\d{2}$/ }),
    van: tekst(d.van, 'dag.van', { max: 40, vorm: ISO_MOMENT }),
    stap_min: 15,
    sinds: tekst(d.sinds, 'dag.sinds', { max: 40, vorm: ISO_MOMENT }),
    metingen,
    huis_w: rij(d.huis_w, 'dag.huis_w', { min: 0, max: GRENS_W, hoogstens: HOOGSTENS_DAGKWARTIEREN, lengte }).map(Math.round),
    ...reeks('zon_w', 0, GRENS_W),
    ...reeks('batterij_w', -GRENS_W, GRENS_W),
    ...reeks('net_w', -GRENS_W, GRENS_W),
    ...reeks('procent', 0, 100),
    kwh: {
      zon: getalTussen(kwh.zon, 'dag.kwh.zon', 0, 2000),
      huis: getalTussen(kwh.huis, 'dag.kwh.huis', 0, 2000),
      geladen: getalTussen(kwh.geladen, 'dag.kwh.geladen', 0, 2000),
      ontladen: getalTussen(kwh.ontladen, 'dag.kwh.ontladen', 0, 2000),
      ...stromenKwhUit(kwh),
    },
    ...(d.fasen == null
      ? {}
      : {
          fasen: fasenLijst(d.fasen, 'dag.fasen', (f, naam) => ({
            a: rij(f.a, `${naam}.a`, { min: 0, max: GRENS_FASE, hoogstens: HOOGSTENS_DAGKWARTIEREN, lengte }),
            w: rij(f.w, `${naam}.w`, { min: -GRENS_W, max: GRENS_W, hoogstens: HOOGSTENS_DAGKWARTIEREN, lengte }).map(Math.round),
            gemiddeld_a: getalTussen(f.gemiddeld_a, `${naam}.gemiddeld_a`, 0, GRENS_FASE),
            piek_a: getalTussen(f.piek_a, `${naam}.piek_a`, 0, GRENS_FASE),
          })),
        }),
    ...(d.week == null ? {} : { week: weekUit(d.week) }),
    ...(() => {
      const zonnen = dagZonnenUit(d.zonnen, lengte);
      return zonnen ? { zonnen } : {};
    })(),
    // Per apparaat van vandaag en de basis (0.12.0), mild: wat niet klopt valt weg, de dag niet.
    ...(() => {
      const apparaten = dagApparatenUit(d.apparaten);
      const basis = basisKwhUit(d.basis_kwh);
      return { ...(apparaten ? { apparaten } : {}), ...(basis === null ? {} : { basis_kwh: basis }) };
    })(),
  };
}

/** Per plek met panelen in de dag (0.10.0): hooguit zoveel plekken. */
const HOOGSTENS_DAGZONNEN = 6;

/**
 * Per plek met panelen per kwartier (programmaatje 0.10.0), mild: een plek
 * zonder geldige sleutel, dubbel, of met een rij die niet even lang is als de
 * metingen of een rare waarde heeft, valt weg; de dag zelf niet. Minder dan
 * twee plekken over: null (één plek is gewoon zon_w).
 */
function dagZonnenUit(lijst, lengte) {
  if (!Array.isArray(lijst)) return null;
  const gezien = new Set();
  const uit = [];
  for (const z of lijst.slice(0, HOOGSTENS_DAGZONNEN)) {
    if (!z || typeof z !== 'object' || typeof z.sleutel !== 'string' || !/^[\w.:-]{1,60}$/.test(z.sleutel) || gezien.has(z.sleutel)) continue;
    if (!Array.isArray(z.w) || z.w.length !== lengte || !z.w.every((v) => goedGetal(v, 0, GRENS_W))) continue;
    gezien.add(z.sleutel);
    uit.push({ sleutel: z.sleutel, w: z.w.map(Math.round) });
  }
  return uit.length >= 2 ? uit : null;
}

/** De daggemiddelden per fase van de laatste 7 dagen. */
function weekUit(week) {
  if (!Array.isArray(week) || week.length > 7) throw new Afgekeurd('dag.week klopt niet');
  return week.map((dag, i) => {
    if (!dag || typeof dag !== 'object') throw new Afgekeurd(`dag.week ${i + 1} klopt niet`);
    return {
      datum: tekst(dag.datum, `dag.week ${i + 1}`, { max: 10, vorm: /^\d{4}-\d{2}-\d{2}$/ }),
      fasen: fasenLijst(dag.fasen, `dag.week ${i + 1}`, (f, naam) => ({
        gemiddeld_a: getalTussen(f.gemiddeld_a, `${naam}.gemiddeld_a`, 0, GRENS_FASE),
        piek_a: getalTussen(f.piek_a, `${naam}.piek_a`, 0, GRENS_FASE),
      })),
    };
  });
}

const MERKEN = new Set(['HomeWizard', 'Zendure', 'GoodWe']);
const ROLLEN = new Set(['net', 'zon', 'zon-en-batterij', 'apparaat', 'batterij', 'vergelijk', 'omvormer']);
// cloud-reserve (brug 0.6.2): een Zendure die lokaal is ingesteld maar nu via de cloud gaat, omdat hij lokaal niet antwoordt.
const MANIEREN = new Set(['v1', 'v2', 'lokaal', 'cloud', 'cloud-reserve']);

/** Wat er aan het programmaatje gekoppeld is. Geen geheimen: die stuurt het programmaatje ook niet. */
function gekoppeldUit(lijst) {
  if (!Array.isArray(lijst) || lijst.length > HOOGSTENS_GEKOPPELD) throw new Afgekeurd('gekoppeld klopt niet');
  const gezien = new Set();
  return lijst.map((a, i) => {
    if (!a || typeof a !== 'object' || Array.isArray(a)) throw new Afgekeurd(`gekoppeld ${i + 1} klopt niet`);
    const sleutel = tekst(a.sleutel, `sleutel van gekoppeld ${i + 1}`, { max: 60, vorm: /^[a-zA-Z0-9._:-]+$/ });
    if (gezien.has(sleutel)) throw new Afgekeurd(`${sleutel} staat er twee keer in`);
    gezien.add(sleutel);
    if (!MERKEN.has(a.merk) || !ROLLEN.has(a.rol) || !MANIEREN.has(a.manier)) throw new Afgekeurd(`gekoppeld ${sleutel} klopt niet`);
    return {
      sleutel,
      naam: kort(a.naam, 40),
      merk: a.merk,
      soort: kort(a.soort, 40),
      rol: a.rol,
      manier: a.manier,
      ok: a.ok === true,
      ...(a.adres == null ? {} : { adres: tekst(a.adres, `adres van ${sleutel}`, { max: 64, vorm: /^[a-zA-Z0-9.:-]+$/ }) }),
      ...(a.sinds == null ? {} : { sinds: tekst(a.sinds, `sinds van ${sleutel}`, { max: 40, vorm: ISO_MOMENT }) }),
      ...(a.w == null ? {} : { w: vermogen(a.w, `vermogen van ${sleutel}`) }),
    };
  });
}

/**
 * Meer over de batterij (programmaatje 0.5.0 en nieuwer, brug/zendure.mjs):
 * per veld de grenzen en op hoeveel decimalen. Ruimer dan wat het programmaatje
 * zelf al nakijkt.
 */
const BATTERIJ_GETALLEN = {
  temp_c: [-50, 120, 1],
  temp_min_c: [-50, 120, 1],
  behuizing_c: [-50, 120, 1],
  spanning_v: [0, 100, 1],
  stroom_a: [0, 500, 1],
  laadgrens_pct: [0, 100, 0],
  ontlaadgrens_pct: [0, 100, 0],
  vol_over_min: [0, 43_200, 0],
  leeg_over_min: [0, 43_200, 0],
  wifi_dbm: [-150, 0, 0],
  pakketten: [0, 20, 0],
  inhoud_kwh: [0, 100, 2],
  gezondheid_pct: [0, 100, 1],
  storing_niveau: [0, 999, 0],
};
const BATTERIJ_JA_NEE = ['verwarmt', 'kalibreert', 'storing'];

const afgerond = (v, decimalen) => Math.round(v * 10 ** decimalen) / 10 ** decimalen;

/**
 * Anders dan de rest mild: dit is extra, dus wat niet klopt (een onbekende
 * sleutel, geen getal, buiten de grenzen, een ja/nee dat geen ja/nee is) gaat
 * niet mee, en de rest van de meting wel. De stand van nu mag niet stuklopen op
 * een vreemde waarde van een nieuwere of oudere Zendure. Niets over: null.
 */
function batterijInfoUit(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
  const uit = {};
  for (const [veld, [min, max, decimalen]] of Object.entries(BATTERIJ_GETALLEN)) {
    const v = b[veld];
    if (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max) uit[veld] = afgerond(v, decimalen);
  }
  for (const veld of BATTERIJ_JA_NEE) if (typeof b[veld] === 'boolean') uit[veld] = b[veld];
  const accus = accusUit(b.accus);
  if (accus) uit.accus = accus;
  return Object.keys(uit).length ? uit : null;
}

const HOOGSTENS_ACCUS = 8;
const goedGetal = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

/**
 * Per accu (programmaatje 0.7.0): { nr, temp_c, procent }, net zo mild: een
 * accu zonder geldig nummer, of zonder temperatuur en procent, valt weg; een
 * nummer telt één keer. Hooguit acht. Niets over: null.
 */
function accusUit(lijst) {
  if (!Array.isArray(lijst)) return null;
  const gezien = new Set();
  const uit = [];
  for (const a of lijst.slice(0, HOOGSTENS_ACCUS * 2)) {
    if (uit.length >= HOOGSTENS_ACCUS) break;
    if (!a || typeof a !== 'object' || Array.isArray(a) || !Number.isInteger(a.nr) || a.nr < 1 || a.nr > 20 || gezien.has(a.nr)) continue;
    const temp = goedGetal(a.temp_c, -50, 120) ? afgerond(a.temp_c, 1) : null;
    const procent = goedGetal(a.procent, 0, 100) ? Math.round(a.procent) : null;
    if (temp === null && procent === null) continue;
    gezien.add(a.nr);
    uit.push({ nr: a.nr, ...(temp === null ? {} : { temp_c: temp }), ...(procent === null ? {} : { procent }) });
  }
  return uit.length ? uit : null;
}

/** Wat de omvormer meldt (programmaatje 0.6.0, brug/goodwe.mjs): de standen, en per getal grenzen en decimalen. */
const OMVORMER_STANDEN = new Set(['normaal', 'wacht', 'storing', 'controle', 'onbekend', 'slaapt', 'weg']);
const OMVORMER_GETALLEN = {
  w: [0, GRENS_W, 0],
  hz: [40, 70, 2],
  temp_c: [-50, 120, 1],
  vandaag_kwh: [0, 2000, 1],
  totaal_kwh: [0, 100_000_000, 1],
  waarschuwing: [1, 65_535, 0],
};
/** Een paneelrij: hooguit 1.500 V (DT-serie: 1.100 V) en 100 A; een fase: hooguit 500 V en 200 A. */
const RIJ_GRENZEN = { v: 1500, a: 100 };
const FASE_GRENZEN = { v: 500, a: 200 };

/** Een rij { v, a } binnen grenzen; wat niet klopt valt weg. Niets over: null. */
function metenLijst(lijst, hoogstens, grenzen) {
  if (!Array.isArray(lijst) || lijst.length === 0 || lijst.length > hoogstens) return null;
  const uit = [];
  for (const m of lijst) {
    if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
    const v = m.v;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > grenzen.v) return null;
    const a = typeof m.a === 'number' && Number.isFinite(m.a) && m.a >= 0 && m.a <= grenzen.a ? afgerond(m.a, 1) : null;
    uit.push({ v: afgerond(v, 1), ...(a === null ? {} : { a }) });
  }
  return uit;
}

/** Bits 0–31, elk één keer, op volgorde; wat niet klopt valt weg. */
function bitsLijst(lijst) {
  if (!Array.isArray(lijst)) return null;
  const bits = [...new Set(lijst.filter((b) => Number.isInteger(b) && b >= 0 && b <= 31))].sort((a, b) => a - b);
  return bits.length ? bits : null;
}

/**
 * De omvormer, mild zoals batterij_info: een onbekend veld, een getal buiten de
 * grenzen of een rare lijst gaat niet mee, de rest van de meting wel. Zonder
 * geldige stand: null (dan weten we niet wat de getallen betekenen).
 */
function omvormerUit(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o) || !OMVORMER_STANDEN.has(o.stand)) return null;
  const uit = { stand: o.stand };
  if (typeof o.bij === 'string' && /^[a-zA-Z0-9._:-]{1,60}$/.test(o.bij)) uit.bij = o.bij;
  for (const [veld, [min, max, decimalen]] of Object.entries(OMVORMER_GETALLEN)) {
    const v = o[veld];
    if (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max) uit[veld] = afgerond(v, decimalen);
  }
  const rijen = metenLijst(o.rijen, 4, RIJ_GRENZEN);
  if (rijen) uit.rijen = rijen;
  const fasen = metenLijst(o.fasen, 3, FASE_GRENZEN);
  if (fasen) uit.fasen = fasen;
  const storingen = bitsLijst(o.storingen);
  if (storingen) uit.storingen = storingen;
  const beperkt = bitsLijst(o.beperkt);
  if (beperkt) uit.beperkt = beperkt;
  return uit;
}

/** Lampen en schakelaars zonder meter (programmaatje 0.8.0, Tuya). */
const HOOGSTENS_LAMPEN = 20;
const LAMP_SOORTEN = new Set(['lamp', 'schakelaar']);

/**
 * Lampen, mild zoals batterij_info: een lamp zonder geldige sleutel, of met een
 * sleutel die er al is (ook bij zonnen en apparaten), valt weg; een rare
 * helderheid of rol ook, de lamp zelf niet. Aan: waar, onwaar of null (niet
 * bekend). Hooguit twintig. Niets over: null.
 */
function lampenUit(lijst, bezet) {
  if (!Array.isArray(lijst)) return null;
  const uit = [];
  for (const l of lijst.slice(0, HOOGSTENS_LAMPEN * 2)) {
    if (uit.length >= HOOGSTENS_LAMPEN) break;
    if (!l || typeof l !== 'object' || Array.isArray(l)) continue;
    if (typeof l.sleutel !== 'string' || !/^[a-zA-Z0-9._:-]{1,60}$/.test(l.sleutel) || bezet.has(l.sleutel)) continue;
    bezet.add(l.sleutel);
    const helderheid = Number.isInteger(l.helderheid) && l.helderheid >= 1 && l.helderheid <= 100 ? l.helderheid : null;
    uit.push({
      sleutel: l.sleutel,
      naam: schoon(l.naam, 40),
      soort: LAMP_SOORTEN.has(l.soort) ? l.soort : 'lamp',
      aan: typeof l.aan === 'boolean' ? l.aan : null,
      ...(helderheid === null ? {} : { helderheid }),
      ...(l.rol === 'spots' ? { rol: 'spots' } : {}),
    });
  }
  return uit.length ? uit : null;
}

const HOOGSTENS_MELDINGEN = 8;

/**
 * Wat er mis is volgens het programmaatje (0.5.2 en nieuwer, brug/gekoppeld.mjs), voor bovenaan
 * Apparaten. Mild: een melding die niet klopt valt weg, de rest blijft. Een lege lijst wist ze.
 */
function meldingenUit(lijst) {
  return lijst.slice(0, HOOGSTENS_MELDINGEN).flatMap((m) => {
    if (!m || typeof m !== 'object' || Array.isArray(m)) return [];
    const soort = typeof m.soort === 'string' && /^[a-z-]{1,20}$/.test(m.soort) ? m.soort : null;
    const uitleg = schoon(m.tekst, 160);
    if (!soort || !uitleg) return [];
    const sinds = typeof m.sinds === 'string' && m.sinds.length <= 40 && ISO_MOMENT.test(m.sinds) ? m.sinds : null;
    return [{ soort, tekst: uitleg, ...(sinds ? { sinds } : {}) }];
  });
}

/** Het programmaatje zelf: welke versie, sinds wanneer, hoe vaak, en waar de prijzen vandaan komen. */
function brugUit(b) {
  if (typeof b !== 'object' || Array.isArray(b)) throw new Afgekeurd('brug klopt niet');
  return {
    versie: tekst(b.versie, 'brug.versie', { max: 20, vorm: /^[0-9A-Za-z.+-]+$/ }),
    gestart: tekst(b.gestart, 'brug.gestart', { max: 40, vorm: ISO_MOMENT }),
    elke_seconden: getalTussen(b.elke_seconden, 'brug.elke_seconden', 1, 3600),
    ...(typeof b.prijzen === 'string' && kort(b.prijzen, 40) ? { prijzen: kort(b.prijzen, 40) } : {}),
    ...(Array.isArray(b.meldingen) ? { meldingen: meldingenUit(b.meldingen) } : {}),
    // Op afstand instellen (0.7.0, base44/shared/opAfstand.js), mild: wat niet klopt valt weg.
    ...(publiekVorm(b.publiek) ? { publiek: b.publiek } : {}),
    ...(gemeldUit(b.op_afstand) ? { op_afstand: gemeldUit(b.op_afstand) } : {}),
    // Zon op en onder van vandaag (0.7.0), voor dag en nacht in de tekening; mild.
    ...(zonUit(b.zon) ? { zon: zonUit(b.zon) } : {}),
    // Herkennen (0.11.0): het kan labels aannemen, en het nieuwste dat het al heeft (base44/shared/herkennen.js); mild.
    ...(b.herkent === true ? { herkent: true } : {}),
    ...(typeof b.labels_op === 'string' && b.labels_op.length <= 40 && ISO_MOMENT.test(b.labels_op) ? { labels_op: b.labels_op } : {}),
  };
}

/** { op, onder }: twee echte tijden, op vóór onder, hooguit een dag ertussen. Anders null. */
function zonUit(z) {
  if (!z || typeof z !== 'object' || Array.isArray(z)) return null;
  const tijd = (t) => (typeof t === 'string' && t.length <= 40 && ISO_MOMENT.test(t) ? Date.parse(t) : Number.NaN);
  const op = tijd(z.op);
  const onder = tijd(z.onder);
  if (!Number.isFinite(op) || !Number.isFinite(onder) || !(onder > op) || onder - op > 86_400_000) return null;
  return { op: z.op, onder: z.onder };
}

/**
 * @param {unknown} ruw  wat het programmaatje stuurde
 * @param {Date} nu      ontvangsttijd (wordt het moment van de meting)
 * @returns {{ ok: true, meting: object, overgeslagen: string[] } | { ok: false, fout: string }}
 *   overgeslagen: losse blokken die niet klopten ("dag: dag.procent klopt niet"); de rest staat erin
 */
export function controleerMeting(ruw, nu) {
  try {
    if (!ruw || typeof ruw !== 'object' || Array.isArray(ruw)) throw new Afgekeurd('Geen meting');

    const overgeslagen = [];
    const los = (veld, maak) => {
      if (ruw[veld] == null) return {};
      try {
        return { [veld]: maak(ruw[veld]) };
      } catch (fout) {
        if (!(fout instanceof Afgekeurd)) throw fout;
        overgeslagen.push(`${veld}: ${fout.message}`);
        return {};
      }
    };

    const zon = vermogen(ruw.zon_w, 'zon_w');
    const procentRuw = vermogen(ruw.batterij_procent, 'batterij_procent');

    // Sleutels zijn uniek over zonnen en apparaten samen, en geen van de vaste punten.
    const gezien = new Set(['zon', 'huis', 'batterij', 'net']);
    const lijstVan = (veld, wat, hoogstens) => {
      const lijst = ruw[veld] ?? [];
      if (!Array.isArray(lijst) || lijst.length > hoogstens) throw new Afgekeurd(`${veld} klopt niet`);
      return lijst.map((a, i) => {
        if (!a || typeof a !== 'object') throw new Afgekeurd(`${wat} ${i + 1} klopt niet`);
        const sleutel = tekst(a.sleutel, `sleutel van ${wat} ${i + 1}`, { max: 60, vorm: /^[a-zA-Z0-9._:-]+$/ });
        if (gezien.has(sleutel)) throw new Afgekeurd(`${sleutel} staat er twee keer in`);
        gezien.add(sleutel);
        const w = vermogen(a.vermogen_w, `vermogen van ${sleutel}`);
        return { sleutel, naam: schoon(a.naam, 40), vermogen_w: w === null ? null : Math.max(0, w), a };
      });
    };

    const zonnen = lijstVan('zonnen', 'zonnebron', HOOGSTENS_ZONNEN).map(({ sleutel, naam, vermogen_w }) => ({ sleutel, naam, vermogen_w }));
    const apparaten = lijstVan('apparaten', 'apparaat', HOOGSTENS_APPARATEN).map(({ sleutel, naam, vermogen_w, a }) => ({
      sleutel,
      naam,
      soort: typeof a.soort === 'string' && /^[a-z]{1,20}$/.test(a.soort) ? a.soort : 'stekker',
      vermogen_w,
    }));

    return {
      ok: true,
      meting: {
        moment: nu.toISOString(),
        net_w: vermogen(ruw.net_w, 'net_w'),
        net_bron: netBronUit(ruw.net_bron),
        net_zendure_w: vermogen(ruw.net_zendure_w, 'net_zendure_w'),
        zon_w: zon === null ? null : Math.max(0, zon),
        zonnen,
        batterij_w: vermogen(ruw.batterij_w, 'batterij_w'),
        batterij_procent: procentRuw === null ? null : Math.min(100, Math.max(0, procentRuw)),
        // Elke keer, net als batterij_w: zonder (een oudere versie, of de Zendure antwoordt even niet) leeg.
        batterij_info: batterijInfoUit(ruw.batterij_info),
        // Ook elke keer: zonder omvormer (of een oudere versie) leeg.
        omvormer: omvormerUit(ruw.omvormer),
        apparaten,
        // Lampen en schakelaars (0.8.0), elke keer zoals apparaten; zonder (een oudere versie) leeg.
        lampen: lampenUit(ruw.lampen, gezien),
        bron: schoon(ruw.bron, 40),
        // Een prijs die niet klopt, houdt de stand niet tegen: dan deze keer zonder prijs.
        prijs: (() => {
          try {
            return prijsUit(ruw.prijs);
          } catch (fout) {
            if (!(fout instanceof Afgekeurd)) throw fout;
            overgeslagen.push(`prijs: ${fout.message}`);
            return null;
          }
        })(),
        vandaag: vandaagUit(ruw.vandaag),
        jaar: jaarUit(ruw.jaar),
        // Elke keer, net als net_w: zonder fasen (de P1-meter antwoordt even niet) leeg, dus nooit van een tijd terug.
        fasen: ruw.fasen == null ? null : fasenNuUit(ruw.fasen),
        // Deze vier stuurt het programmaatje niet elke keer mee (de voorspelling als
        // hij verandert, de rest elke minuut). Base44 voegt een update samen met de
        // rij: een veld dat hier ontbreekt, houdt zijn vorige waarde.
        // Klopt een van deze losse blokken niet (een rare lezing, of een vorm van een nieuwer
        // programmaatje), dan alleen dat blok niet: de stand van nu komt altijd binnen.
        ...los('voorspelling', voorspellingUit),
        // Het weer (0.9.0) net zo, maar mild: wat niet klopt valt stil weg, en zonder geldig weer blijft het vorige staan.
        ...(() => {
          const weer = weerUit(ruw.weer);
          return weer ? { weer } : {};
        })(),
        // Wat het programmaatje herkent (0.11.0), mild zoals het weer: wat niet klopt valt weg, en zonder blijft het vorige staan.
        ...(() => {
          const herkend = herkendUit(ruw.herkend, nu);
          return herkend ? { herkend } : {};
        })(),
        ...los('dag', dagUit),
        ...los('gekoppeld', gekoppeldUit),
        ...los('brug', brugUit),
      },
      overgeslagen,
    };
  } catch (fout) {
    if (fout instanceof Afgekeurd) return { ok: false, fout: fout.message };
    throw fout;
  }
}
