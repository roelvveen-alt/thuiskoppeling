import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { deelGelijk, useGelijk } from './gelijk';
import { VOORBEELD } from '@/api/base44Client';
import { naarInloggen, upload, vraag } from '@/api/huis';
import { fotoBron, wisFotoKast } from './fotoKast';
import { gasStandenUit } from './gasStanden';
import { apparatenUit } from './apparatenOverzicht';
import { herkendUit } from './herkennen';
import { lampenUit } from './lampen';
import { meterkastUit } from './meterkast';
import { leesLokaal, schrijfLokaal } from './lokaal';
import { LEGE_OPSTELLING, naarRij, uitOpslag } from './opstelling';
import { uurVan, VOORBEELD_VERMOGENS, voorbeeldStand } from './voorbeeld';
import { neemVroegeStand, onthoudLaatsteHuis } from './vroegeStand';
import { sturenUit } from './omvormerSturen';
import { spanningUit } from './spanning';

/**
 * Waar de cijfers vandaan komen: het voorbeeld, of de laatste meting die het
 * programmaatje thuis van deze omgeving naar Base44 stuurde. Altijd via de
 * functie huis (src/api/huis.js), die eerst kijkt of je erbij hoort; de site
 * leest de tabellen nooit zelf.
 *
 * Live lezen we zo vaak als het programmaatje stuurt (elke 5 seconden, of
 * trager als het zo is ingesteld), en niet zolang het scherm in de
 * achtergrond staat. Base44 remt bij ~115 aanroepen per 65 s, voor alle huizen
 * samen; de functie onthoudt wie je bent en het huis even (toegang.js), zodat
 * twee programmaatjes en drie open schermen er ruim onder blijven
 * (base44/tests/rem.test.js). Bij de rem vraagt een scherm de stand niet
 * opnieuw, maar wacht het 15 s tot een minuut. Komt er niets nieuws
 * (het programmaatje staat stil, of stuurde nog nooit) of staat er een
 * tabblad open zonder live cijfers, dan eens per 30 seconden. Lukt het niet,
 * dan wachten we steeds langer, tot een minuut. Wordt de app net bijgewerkt,
 * dan blijven we rustig proberen (15, 30, dan elke 60 s): zo komt een scherm
 * dat open blijft liggen vanzelf weer live.
 *
 * Bewust geen `entities.X.subscribe`: Base44 stuurt die meldingen per tabel
 * naar iedereen die ingelogd is, dus ook de cijfers van andermans huis.
 */

const VOORBEELD_TIK_MS = 2000;
export const LIVE_ELKE_MS = 5_000;
const LIVE_HOOGSTENS_MS = 60_000;
/** Zo vaak als er toch niets nieuws komt, of op een tabblad zonder live cijfers. */
export const RUSTIG_ELKE_MS = 30_000;
const BIJWERKEN_EERST_MS = 15_000;
/** Na de rem: minstens zo lang, plus tot 5 s toeval, zodat de schermen niet tegelijk terugkomen. */
export const NA_REM_MS = 15_000;
const NA_REM_TOEVAL_MS = 5_000;

/** Hoe lang tot de volgende stand na de rem: oplopend van 15 s (plus toeval) tot een minuut. */
export const wachtNaRem = (wacht, toeval = Math.random()) =>
  Math.min(Math.max(wacht * 2, NA_REM_MS) + Math.round(toeval * NA_REM_TOEVAL_MS), LIVE_HOOGSTENS_MS);
/** Ouder dan dit, en we zeggen dat er thuis iets stil lijkt te staan. */
export const OUD_NA_MS = 90_000;

const getal = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** De prijs van dit moment; zonder beide prijzen geen prijs (dan rekent de app niets uit). */
function prijsUit(p) {
  const afname = getal(p?.afname_kwh);
  const terug = getal(p?.teruglevering_kwh);
  if (afname === null || terug === null) return null;
  return {
    afname_kwh: afname,
    teruglevering_kwh: terug,
    zonnebonus_kwh: getal(p?.zonnebonus_kwh) ?? 0,
    van: typeof p?.van === 'string' ? p.van : null,
    tot: typeof p?.tot === 'string' ? p.tot : null,
    bron: typeof p?.bron === 'string' ? p.bron : '',
  };
}

function vandaagUit(v) {
  if (!v || typeof v !== 'object') return null;
  return {
    datum: typeof v.datum === 'string' ? v.datum : null,
    afname_kwh: getal(v.afname_kwh) ?? 0,
    teruglevering_kwh: getal(v.teruglevering_kwh) ?? 0,
    kosten_eur: getal(v.kosten_eur) ?? 0,
    opbrengst_eur: getal(v.opbrengst_eur) ?? 0,
    vaste_kosten_eur: getal(v.vaste_kosten_eur),
    compleet: v.compleet !== false,
  };
}

/** Dit jaar teruggeleverd tegenover het plafond van de Zonnebonus; zonder beide getallen niets. */
function jaarUit(j) {
  const kwh = getal(j?.teruglevering_kwh);
  const plafond = getal(j?.plafond_kwh);
  if (kwh === null || plafond === null) return null;
  // Het jaartal blijft mee, zodat vanNu op 1 januari het plafond van vorig jaar weglaat.
  const jaar = getal(j?.jaar);
  return jaar === null ? { teruglevering_kwh: kwh, plafond_kwh: plafond } : { jaar, teruglevering_kwh: kwh, plafond_kwh: plafond };
}

const msUit = (tekst) => {
  const t = typeof tekst === 'string' ? Date.parse(tekst) : Number.NaN;
  return Number.isFinite(t) ? t : null;
};
const getallen = (rij) => (Array.isArray(rij) && rij.every((v) => typeof v === 'number' && Number.isFinite(v)) ? rij : null);
const woord = (v) => (typeof v === 'string' ? v : '');

/**
 * De prijzen per kwartier van vandaag en morgen (brug 0.4.0 en nieuwer), of
 * null. Alle rijen even lang, anders klopt er niets van.
 */
export function voorspellingUit(v) {
  const van = msUit(v?.van);
  const afname = getallen(v?.afname_kwh);
  const terug = getallen(v?.teruglevering_kwh);
  const bonus = getallen(v?.zonnebonus_kwh);
  if (van === null || !afname?.length || terug?.length !== afname.length || bonus?.length !== afname.length) return null;
  return { van, stapMs: (getal(v?.stap_min) ?? 15) * 60_000, afname, terug, bonus, schatting: v?.schatting === true, bron: woord(v?.bron) };
}

/**
 * Het weerbericht per uur van vandaag en morgen (brug 0.9.0, Open-Meteo), of
 * null: { van, stapMs, straling, bewolking, temp, code, neerslag, kans, stoten,
 * opgehaald, bron } (code tot en met stoten sinds brug 0.10.0). Plek i is
 * het uur vanaf van + i uur. Een reeks die er niet is, of niet even lang is als
 * de eerste, is null; zonder straling en bewolking null. Een oudere brug stuurt
 * het niet: dan rekent Advies zoals vroeger.
 */
export function weerUit(w) {
  const van = msUit(w?.van);
  if (van === null || getal(w?.stap_min) !== 60) return null;
  let lengte = null;
  const reeks = (rij) => {
    const r = getallen(rij);
    if (!r?.length || (lengte !== null && r.length !== lengte)) return null;
    lengte ??= r.length;
    return r;
  };
  const straling = reeks(w.straling_wm2);
  const bewolking = reeks(w.bewolking_pct);
  if (!straling && !bewolking) return null;
  const temp = reeks(w.temp_c);
  // Sinds brug 0.10.0 (het tabblad Voorspelling); een oudere brug: null.
  const code = reeks(w.weercode);
  return {
    van,
    stapMs: 3_600_000,
    straling,
    bewolking,
    temp,
    code: code && code.every(Number.isInteger) ? code : null,
    neerslag: reeks(w.neerslag_mm),
    kans: reeks(w.neerslag_kans_pct),
    stoten: reeks(w.windstoten_kmh),
    nu: weerNuUit(w.nu),
    opgehaald: msUit(w.opgehaald),
    bron: woord(w.bron),
  };
}

/** Het weer van nu (brug 0.9.0) voor de tekening (src/lib/weerBeeld.js), of null. */
function weerNuUit(n) {
  if (!n || typeof n !== 'object') return null;
  const uit = {
    code: Number.isInteger(n.code) ? n.code : null,
    neerslag: getal(n.neerslag_mm),
    wind: getal(n.wind_kmh),
    stoten: getal(n.windstoten_kmh),
    bewolking: getal(n.bewolking_pct),
  };
  return Object.values(uit).some((v) => v !== null) ? uit : null;
}

/**
 * Vandaag per kwartier (brug 0.4.0 en nieuwer), of null. Een kwartier zonder
 * meting wordt null in elke reeks: dan tekent de grafiek daar niets.
 */
export function dagUit(d) {
  const van = msUit(d?.van);
  const metingen = getallen(d?.metingen);
  if (van === null || !metingen?.length || getallen(d?.huis_w)?.length !== metingen.length) return null;
  const reeks = (rij) => {
    const r = getallen(rij);
    return r && r.length === metingen.length ? r.map((v, i) => (metingen[i] > 0 ? v : null)) : null;
  };
  const kwh = (v) => getal(d?.kwh?.[v]) ?? 0;
  const fasen = (Array.isArray(d.fasen) ? d.fasen : [])
    .filter((f) => [1, 2, 3].includes(f?.fase))
    .map((f) => ({ fase: f.fase, a: reeks(f.a), w: reeks(f.w), gemiddeldA: getal(f.gemiddeld_a), piekA: getal(f.piek_a) }))
    .filter((f) => f.a)
    .sort((a, b) => a.fase - b.fase);
  const week = (Array.isArray(d.week) ? d.week : [])
    .filter((dag) => typeof dag?.datum === 'string' && Array.isArray(dag.fasen))
    .map((dag) => ({ datum: dag.datum, fasen: dag.fasen.filter((f) => [1, 2, 3].includes(f?.fase) && getal(f.gemiddeld_a) !== null).map((f) => ({ fase: f.fase, gemiddeldA: f.gemiddeld_a, piekA: getal(f.piek_a) })) }));
  return {
    datum: typeof d.datum === 'string' ? d.datum : null,
    van,
    stapMs: (getal(d?.stap_min) ?? 15) * 60_000,
    sinds: msUit(d?.sinds) ?? van,
    metingen,
    huis: reeks(d.huis_w),
    zon: reeks(d.zon_w),
    batterij: reeks(d.batterij_w),
    net: reeks(d.net_w),
    procent: reeks(d.procent),
    kwh: { zon: kwh('zon'), huis: kwh('huis'), geladen: kwh('geladen'), ontladen: kwh('ontladen') },
    // Wie aan wie, per meting opgeteld (brug 1.2.0, src/lib/dagoverzicht.js); een oudere brug: null.
    stromenKwh:
      getal(d?.kwh?.zon_zelf) !== null && getal(d?.kwh?.net_huis) !== null ? { zonZelf: d.kwh.zon_zelf, netHuis: d.kwh.net_huis } : null,
    fasen: fasen.length ? fasen : null,
    week,
    // Per plek met panelen per kwartier (brug 0.10.0, bij twee of meer plekken): { [sleutel]: W[] }, anders null.
    zonnen: zonnenPerKwartier(d.zonnen, metingen),
    // Per apparaat van vandaag en de basis in kWh (brug 0.12.0, src/lib/apparatenOverzicht.js); een oudere brug: null.
    apparaten: apparatenUit(d.apparaten),
    basisKwh: getal(d.basis_kwh),
    // Gas, water en warmte van vandaag (brug 1.4.0, src/lib/meterkast.js); zonder meter (of een oudere brug): null.
    gasM3: getal(d.gas_m3),
    waterM3: getal(d.water_m3),
    warmteGj: getal(d.warmte_gj),
  };
}

function zonnenPerKwartier(lijst, metingen) {
  if (!Array.isArray(lijst)) return null;
  const uit = {};
  for (const z of lijst) {
    const w = getallen(z?.w);
    if (typeof z?.sleutel === 'string' && z.sleutel && w?.length === metingen.length) uit[z.sleutel] = w.map((v, i) => (metingen[i] > 0 ? v : null));
  }
  return Object.keys(uit).length >= 2 ? uit : null;
}

/** Per fase van de P1-meter nu, of null (oude brug, of geen fasen). */
export function fasenUit(lijst) {
  if (!Array.isArray(lijst)) return null;
  const fasen = lijst
    .filter((f) => [1, 2, 3].includes(f?.fase))
    .map((f) => ({ fase: f.fase, w: getal(f.w), a: getal(f.a), v: getal(f.v) }))
    .sort((a, b) => a.fase - b.fase);
  return fasen.length ? fasen : null;
}

/** Wat er aan het programmaatje gekoppeld is (brug 0.4.0 en nieuwer); zonder dat veld null. */
export function gekoppeldUit(lijst) {
  if (!Array.isArray(lijst)) return null;
  return lijst
    .filter((a) => a && typeof a.sleutel === 'string' && a.sleutel)
    .map((a) => ({
      sleutel: a.sleutel,
      naam: woord(a.naam),
      merk: woord(a.merk),
      soort: woord(a.soort),
      rol: woord(a.rol),
      manier: woord(a.manier),
      adres: typeof a.adres === 'string' && a.adres ? a.adres : null,
      ok: a.ok === true,
      sinds: msUit(a.sinds),
      w: getal(a.w),
    }));
}

const BATTERIJ_GETALLEN = [
  'temp_c',
  'temp_min_c',
  'behuizing_c',
  'spanning_v',
  'stroom_a',
  'laadgrens_pct',
  'ontlaadgrens_pct',
  'vol_over_min',
  'leeg_over_min',
  'wifi_dbm',
  'pakketten',
  'inhoud_kwh',
  'gezondheid_pct',
  'storing_niveau',
  // Programmaatje 1.4.0: celspanningen en de ingestelde limieten.
  'cel_min_v',
  'cel_max_v',
  'invoer_limiet_w',
  'uitvoer_limiet_w',
  'omvormer_max_w',
];
const BATTERIJ_JA_NEE = ['verwarmt', 'kalibreert', 'storing'];

/**
 * Meer over de batterij (brug 0.5.0 en nieuwer): temperatuur, spanning,
 * grenzen, hoe lang nog. Alleen bekende velden met een echt getal of een echt
 * ja/nee; zonder (een oudere brug of een functie die nog niet bijgewerkt is) null.
 */
export function batterijInfoUit(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
  const uit = {};
  for (const veld of BATTERIJ_GETALLEN) if (getal(b[veld]) !== null) uit[veld] = b[veld];
  for (const veld of BATTERIJ_JA_NEE) if (typeof b[veld] === 'boolean') uit[veld] = b[veld];
  const accus = accusUit(b.accus);
  if (accus.length) uit.accus = accus;
  const geleerd = geleerdUit(b.geleerd);
  if (geleerd) uit.geleerd = geleerd;
  return Object.keys(uit).length ? uit : null;
}

/**
 * Wat het programmaatje van de batterij leerde (1.4.0, brug/batterijLeren.mjs): hoeveel kWh er echt
 * uit (leveren) of in (laden) gaat per procent, en uit hoeveel metingen. Zonder (een oudere brug of
 * functie): null; een getal dat er niet is: weg.
 */
function geleerdUit(g) {
  if (!g || typeof g !== 'object' || Array.isArray(g)) return null;
  const uit = {};
  for (const veld of ['kwh_per_pct_leveren', 'kwh_per_pct_laden']) if (getal(g[veld]) !== null && g[veld] > 0) uit[veld] = g[veld];
  if (!Object.keys(uit).length) return null;
  return { ...uit, metingen: getal(g.metingen) ?? 0 };
}

/** Tot drie SolarFlow 2400 AC's met elk 6 accu's (programmaatje 1.4.0). */
export const HOOGSTENS_ACCUS = 18;

/**
 * Per accu (brug 0.7.0 en nieuwer): { nr, temp_c, procent }, op nummer, hooguit
 * HOOGSTENS_ACCUS (18: drie 2400 AC's met elk 6, sinds 1.4.0; daarvoor 8). Sinds 1.4.0 ook cel_min_v, cel_max_v, gezondheid_pct, cycli en verwarmt
 * (alleen als het er is). Zonder (een oudere brug of functie) een lege lijst; een
 * getal dat er niet is: null.
 */
function accusUit(lijst) {
  if (!Array.isArray(lijst)) return [];
  const gezien = new Set();
  const erbij = (a) => ({
    ...Object.fromEntries(['cel_min_v', 'cel_max_v', 'gezondheid_pct', 'cycli'].filter((v) => getal(a[v]) !== null).map((v) => [v, a[v]])),
    ...(a.verwarmt === true ? { verwarmt: true } : {}),
  });
  return lijst
    .filter((a) => a && typeof a === 'object' && Number.isInteger(a.nr) && a.nr > 0 && !gezien.has(a.nr) && gezien.add(a.nr))
    .map((a) => ({ nr: a.nr, temp_c: getal(a.temp_c), procent: getal(a.procent), ...erbij(a) }))
    .filter((a) => a.temp_c !== null || a.procent !== null)
    .sort((a, b) => a.nr - b.nr)
    .slice(0, HOOGSTENS_ACCUS);
}

/** Een lijst { v, a } (paneelrijen, fasen) met een echte spanning; hooguit `hoogstens`. */
const metenUit = (lijst, hoogstens) =>
  (Array.isArray(lijst) ? lijst : [])
    .filter((m) => m && typeof m === 'object' && getal(m.v) !== null)
    .slice(0, hoogstens)
    .map((m) => ({ v: m.v, a: getal(m.a) }));

/** Foutbits en beperkingen: hele getallen 0–31, elk één keer, op volgorde. */
const bitsUit = (lijst) => (Array.isArray(lijst) ? [...new Set(lijst.filter((b) => Number.isInteger(b) && b >= 0 && b <= 31))].sort((a, b) => a - b) : []);

/**
 * Wat de omvormer zelf meldt (brug 0.6.0 en nieuwer, GoodWe): stand,
 * storingen, spanningen, temperatuur, opbrengst. Zonder (een oudere brug of
 * een functie die nog niet bijgewerkt is) null. Elk getal dat er niet is: null.
 */
export function omvormerUit(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o) || typeof o.stand !== 'string' || !o.stand) return null;
  return {
    stand: o.stand,
    bij: typeof o.bij === 'string' && o.bij ? o.bij : null,
    w: getal(o.w),
    rijen: metenUit(o.rijen, 4),
    fasen: metenUit(o.fasen, 3),
    hz: getal(o.hz),
    temp_c: getal(o.temp_c),
    vandaag_kwh: getal(o.vandaag_kwh),
    totaal_kwh: getal(o.totaal_kwh),
    storingen: bitsUit(o.storingen),
    waarschuwing: getal(o.waarschuwing) ?? 0,
    beperkt: bitsUit(o.beperkt),
    // Programmaatje 1.4.0 (src/lib/omvormer.js); een oudere brug of functie: null.
    pf: getal(o.pf),
    bus_v: getal(o.bus_v),
    koelplaat_c: getal(o.koelplaat_c),
    uren: getal(o.uren),
    isolatie_kohm: getal(o.isolatie_kohm),
    lekstroom_ma: getal(o.lekstroom_ma),
    // Begrenzen bij een negatieve prijs (programmaatje 1.5.0, src/lib/omvormerSturen.js); alleen de eigenaar krijgt het.
    sturen: sturenUit(o.sturen),
  };
}

function zonUit(z) {
  const op = msUit(z?.op);
  const onder = msUit(z?.onder);
  return op !== null && onder !== null && onder > op ? { op, onder } : null;
}

/** Het programmaatje zelf: versie, sinds wanneer, hoe vaak, prijsbron. */
export function brugUit(b) {
  if (!b || typeof b !== 'object' || typeof b.versie !== 'string' || !b.versie) return null;
  // Wat er mis is volgens het programmaatje (0.5.2 en nieuwer); zonder (een oudere brug of functie) een lege lijst.
  const meldingen = (Array.isArray(b.meldingen) ? b.meldingen : [])
    .filter((m) => m && typeof m.tekst === 'string' && m.tekst)
    .map((m) => ({ soort: woord(m.soort), tekst: m.tekst, sinds: msUit(m.sinds) }));
  return {
    versie: b.versie,
    gestart: msUit(b.gestart),
    elkeSeconden: getal(b.elke_seconden),
    prijzen: typeof b.prijzen === 'string' && b.prijzen ? b.prijzen : null,
    meldingen,
    // Zon op en onder van vandaag (0.7.0), in ms; een oudere brug: null (dan dag op het licht, zie isDag).
    zon: zonUit(b.zon),
    // Op afstand instellen (0.7.0): het publieke deel, en wat het programmaatje al opgepakt heeft. Oudere brug: null en [].
    publiek: typeof b.publiek === 'string' && b.publiek ? b.publiek : null,
    opAfstand: (Array.isArray(b.op_afstand) ? b.op_afstand : [])
      .filter((m) => m && typeof m.veld === 'string' && typeof m.op === 'string')
      .map((m) => ({ veld: m.veld, op: m.op, ok: m.ok === true, fout: typeof m.fout === 'string' ? m.fout : null })),
  };
}

/**
 * De zware delen (dag, voorspelling, weer, gekoppeld) stuurt 'stand' alleen als ze
 * anders zijn dan wat de site al heeft (prestaties-7). Hier: de meting weer
 * heel maken met wat bewaard is ('bekend'), en bewaren wat nieuw binnenkwam
 * met zijn kenmerk. Een oude functie stuurt geen kenmerken: dan is er niets
 * te bewaren en vraagt de site ook niets weg.
 */
export function metBekendeDelen(antwoord, bewaard = {}) {
  const meting = antwoord?.meting;
  if (!meting || typeof meting !== 'object') return { meting: null, bewaard: {} };
  const heel = { ...meting };
  for (const deel of Array.isArray(antwoord.bekend) ? antwoord.bekend : []) {
    if (bewaard[deel] && heel[deel] === undefined) heel[deel] = bewaard[deel].waarde;
  }
  const nieuw = {};
  const kenmerken = antwoord.kenmerken && typeof antwoord.kenmerken === 'object' ? antwoord.kenmerken : {};
  for (const [deel, kenmerk] of Object.entries(kenmerken)) {
    if (typeof kenmerk === 'string' && heel[deel] !== undefined) nieuw[deel] = { kenmerk, waarde: heel[deel] };
  }
  return { meting: heel, bewaard: nieuw };
}

/** Wat de site al heeft, voor 'stand' (heb); leeg = niets meesturen. */
export const hebVan = (bewaard) => Object.fromEntries(Object.entries(bewaard).map(([deel, b]) => [deel, b.kenmerk]));

/** Een rij uit Base44 (base44/entities/Meting.jsonc) als stand voor het scherm. */
export function standUitRij(rij) {
  return {
    moment: typeof rij?.moment === 'string' ? rij.moment : null,
    prijs: prijsUit(rij?.prijs),
    vandaag: vandaagUit(rij?.vandaag),
    jaar: jaarUit(rij?.jaar),
    fasen: fasenUit(rij?.fasen),
    voorspelling: voorspellingUit(rij?.voorspelling),
    // Het weer voor Advies (brug 0.9.0); een oudere meting: null.
    weer: weerUit(rij?.weer),
    dag: dagUit(rij?.dag),
    gekoppeld: gekoppeldUit(rij?.gekoppeld),
    brug: brugUit(rij?.brug),
    net_w: getal(rij?.net_w),
    // Van welke meter net_w komt: de HomeWizard P1, of de Zendure P1 als reserve (brug/samenvoegen.mjs).
    net_bron: ['homewizard', 'zendure-p1'].includes(rij?.net_bron) ? rij.net_bron : null,
    net_zendure_w: getal(rij?.net_zendure_w),
    zon_w: getal(rij?.zon_w),
    zonnen: (Array.isArray(rij?.zonnen) ? rij.zonnen : [])
      .filter((z) => z && typeof z.sleutel === 'string' && z.sleutel)
      .map((z) => ({ sleutel: z.sleutel, naam: typeof z.naam === 'string' ? z.naam : '', vermogen_w: getal(z.vermogen_w) })),
    batterij_w: getal(rij?.batterij_w),
    batterij_procent: getal(rij?.batterij_procent),
    batterij_info: batterijInfoUit(rij?.batterij_info),
    omvormer: omvormerUit(rij?.omvormer),
    // De spanningswacht (brug 1.5.0, src/lib/spanning.js); een oudere meting: null.
    spanning: spanningUit(rij?.spanning),
    // Tarief, piek, gas en water uit de meterkast (brug 1.4.0, src/lib/meterkast.js); een oudere meting: null.
    meterkast: meterkastUit(rij?.meterkast),
    apparaten: (Array.isArray(rij?.apparaten) ? rij.apparaten : [])
      .filter((a) => a && typeof a.sleutel === 'string' && a.sleutel)
      .map((a) => ({
        sleutel: a.sleutel,
        naam: typeof a.naam === 'string' ? a.naam : '',
        soort: typeof a.soort === 'string' ? a.soort : 'stekker',
        vermogen_w: getal(a.vermogen_w),
      })),
    // Lampen en schakelaars zonder meter (brug 0.8.0, Tuya); een oudere meting: leeg.
    lampen: lampenUit(rij?.lampen),
    // Welk apparaat er stroom gebruikt (brug 0.11.0, src/lib/herkennen.js); een oudere meting: null.
    herkend: herkendUit(rij?.herkend, rij?.moment),
  };
}

/**
 * @param {string|null} huisId  de gekozen omgeving; null in het voorbeeld
 * @param {string} moment  sleutel uit MOMENTEN; alleen voor het voorbeeld
 * @param {string} tekening  de gekozen tekening; het voorbeeld past zijn zonnebronnen erop aan
 * @returns {{ stand: object|null, status: string }}  status is een van:
 *   voorbeeld, laden, live,
 *   leeg            Base44 werkt, maar thuis heeft nog niets gestuurd (dan tonen we het voorbeeld)
 *   fout, rem       even niet; de laatste cijfers blijven staan en we proberen het opnieuw
 *   geenHuis        deze omgeving is weg, of je hoort er niet meer bij
 *   nietBijgewerkt  de functie is nog niet gepubliceerd
 */
/**
 * Hoe lang tot de volgende vraag, na een gelukte lezing. Gewoon: zo vaak als
 * het programmaatje stuurt (nooit vaker dan elke 5 s). Rustig (30 s): op een
 * tabblad zonder live cijfers, als er nog nooit iets kwam, of als de laatste
 * meting ouder is dan OUD_NA_MS.
 */
export function wachtNaLezing(stand, { snel = true, nu = Date.now() } = {}) {
  if (!snel || !stand?.moment) return RUSTIG_ELKE_MS;
  const oud = nu - new Date(stand.moment).getTime();
  if (!(oud < OUD_NA_MS)) return RUSTIG_ELKE_MS;
  const brug = stand.brug?.elkeSeconden;
  return Math.max(LIVE_ELKE_MS, Math.min(brug > 0 ? brug * 1000 : 0, RUSTIG_ELKE_MS));
}

/**
 * `snel`: er staat iets open met live cijfers (Huis, Nu, een blad). Zo niet,
 * dan vragen we eens per 30 s; gaat het weer open, dan meteen.
 */
/**
 * Het voorbeeld is van nu: het moment, en het weer opgehaald aan het begin van
 * dit uur (zoals het programmaatje het elk uur haalt). Niet elke tik een ander
 * tijdstip: dan blijft het weer hetzelfde object en rekent de verwachting niet
 * elke 2 s opnieuw (prestaties-19).
 */
function vanNuGemaakt(stand) {
  const nu = Date.now();
  return { ...stand, moment: new Date(nu).toISOString(), weer: stand.weer ? { ...stand.weer, opgehaald: nu - (nu % 3_600_000) } : null };
}

export function useStand(huisId, moment, tekening, { snel = true } = {}) {
  const [live, setLive] = useState({ stand: null, status: VOORBEELD ? 'voorbeeld' : 'laden' });
  const [tik, setTik] = useState(0);
  const metVoorbeeld = VOORBEELD || live.status === 'leeg';
  const snelRef = useRef(snel);
  const opnieuwRef = useRef(null);

  useEffect(() => {
    if (!metVoorbeeld) return undefined;
    const id = setInterval(() => setTik((t) => t + 1), VOORBEELD_TIK_MS);
    return () => clearInterval(id);
  }, [metVoorbeeld]);

  useEffect(() => {
    const was = snelRef.current;
    snelRef.current = snel;
    if (snel && !was) opnieuwRef.current?.();
  }, [snel]);

  useEffect(() => {
    if (VOORBEELD || !huisId) return undefined;
    onthoudLaatsteHuis(huisId);
    let gestopt = false;
    let bezig = false;
    let wacht = LIVE_ELKE_MS;
    // De eerste lezing: de stand die al bij het openen gevraagd werd, als die voor dit huis was (src/lib/vroegeStand.js).
    let eerste = true;
    let vorige = 0;
    let timer;
    // De zware delen die al binnen zijn, met hun kenmerk (per omgeving opnieuw).
    let bewaard = {};

    const lees = async () => {
      clearTimeout(timer);
      // Komt het scherm terug terwijl er nog een lezing loopt, dan niet een
      // tweede reeks beginnen: die lopende plant de volgende zelf.
      if (gestopt || bezig || document.visibilityState === 'hidden') return;
      bezig = true;
      vorige = Date.now();
      try {
        // Niet herhalen bij de rem: deze vraag komt toch zo weer (hieronder, na een langere pauze).
        const heb = hebVan(bewaard);
        const vroeg = eerste ? neemVroegeStand(huisId) : null;
        eerste = false;
        const antwoord = await (vroeg ?? vraag('stand', Object.keys(heb).length ? { huis_id: huisId, heb } : { huis_id: huisId }, { herhalen: false }));
        if (gestopt) return;
        const heel = metBekendeDelen(antwoord, bewaard);
        bewaard = heel.bewaard;
        const meting = heel.meting;
        const stand = meting?.moment ? standUitRij(meting) : null;
        // Zelfde meting als net (thuis stuurde niets nieuws): niets zetten, dan rekent en tekent het scherm niet alles opnieuw.
        // Zelfde inhoud: dezelfde delen houden (deelGelijk), zodat wat daarop rekent of tekent niets hoeft te doen (prestaties-19).
        setLive((oud) => {
          if (stand && oud.status === 'live' && oud.stand?.moment === stand.moment) return oud;
          if (!stand) return oud.status === 'leeg' && oud.stand === null ? oud : { stand: null, status: 'leeg' };
          const zelfde = deelGelijk(oud.stand, stand);
          return zelfde === oud.stand && oud.status === 'live' ? oud : { stand: zelfde, status: 'live' };
        });
        wacht = wachtNaLezing(stand, { snel: snelRef.current });
      } catch (fout) {
        if (gestopt) return;
        if (fout.soort === 'inloggen') {
          naarInloggen();
          return;
        }
        if (['geenHuis', 'uitgeschakeld'].includes(fout.soort)) {
          // Vaker vragen helpt niet; het scherm erboven weet wat te doen.
          setLive({ stand: null, status: 'geenHuis' });
          return;
        }
        if (fout.soort === 'nietBijgewerkt') {
          // Even tijdens een uitrol: rustig blijven proberen, de kop zegt "zo weer live".
          setLive((oud) => (oud.status === 'nietBijgewerkt' ? oud : { stand: null, status: 'nietBijgewerkt' }));
          wacht = Math.min(Math.max(wacht * 2, BIJWERKEN_EERST_MS), LIVE_HOOGSTENS_MS);
        } else {
          // De laatste cijfers blijven staan; de kop zegt dat het even niet lukt.
          const soort = fout.soort === 'rem' ? 'rem' : 'fout';
          setLive((oud) => (oud.status === soort ? oud : { stand: oud.stand, status: soort }));
          wacht = fout.soort === 'rem' ? wachtNaRem(wacht) : Math.min(wacht * 2, LIVE_HOOGSTENS_MS);
        }
      } finally {
        bezig = false;
      }
      if (!gestopt) timer = setTimeout(lees, wacht);
    };

    // Gaat er weer iets open met live cijfers: meteen lezen, tenzij dat net al gebeurde.
    opnieuwRef.current = () => {
      if (Date.now() - vorige >= LIVE_ELKE_MS) lees();
    };
    const terug = () => {
      if (document.visibilityState === 'visible') lees();
    };
    lees();
    document.addEventListener('visibilitychange', terug);
    return () => {
      gestopt = true;
      opnieuwRef.current = null;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', terug);
    };
  }, [huisId]);

  const voorbeeld = useMemo(() => {
    if (!metVoorbeeld) return null;
    // Middernacht op dit toestel: daar beginnen de nepdag en de nepprijzen.
    const dagBegin = new Date().setHours(0, 0, 0, 0);
    const stand = voorbeeldStand(uurVan(moment), tik, tekening, dagBegin);
    // Het weer van het voorbeeld is van nu (zie voorbeeldWeer).
    return vanNuGemaakt(stand);
  }, [metVoorbeeld, moment, tik, tekening]);
  // Wat bij een tik niet veranderde (prijzen, de dag, de voorspelling, het weer), houdt zijn oude object.
  const vasteVoorbeeld = useGelijk(voorbeeld);

  if (metVoorbeeld) return { stand: vasteVoorbeeld, status: VOORBEELD ? 'voorbeeld' : 'leeg' };
  return live;
}

const LOKAAL_OPSTELLING = 'thuis-energie.opstelling.v1';
const LOKAAL_FOTO = 'thuis-energie.foto.v1';
/** De link naar de foto verloopt na een uur; ruim daarvoor halen we een nieuwe. */
const FOTO_VERVERS_MS = 50 * 60_000;

/** Een foto kleiner maken voordat hij ergens heen gaat: lange kant 1600 px, JPEG. */
async function verklein(bestand, lang = 1600) {
  const url = URL.createObjectURL(bestand);
  try {
    const beeld = await new Promise((klaar, mis) => {
      const img = new Image();
      img.onload = () => klaar(img);
      img.onerror = () => mis(new Error('Deze foto kan ik niet openen. Kies een JPG of PNG.'));
      img.src = url;
    });
    const schaal = Math.min(1, lang / Math.max(beeld.naturalWidth, beeld.naturalHeight));
    const doek = document.createElement('canvas');
    doek.width = Math.round(beeld.naturalWidth * schaal);
    doek.height = Math.round(beeld.naturalHeight * schaal);
    doek.getContext('2d').drawImage(beeld, 0, 0, doek.width, doek.height);
    return await new Promise((klaar) => doek.toBlob(klaar, 'image/jpeg', 0.82));
  } finally {
    URL.revokeObjectURL(url);
  }
}

const alsDataUrl = (blob) =>
  new Promise((klaar, mis) => {
    const lezer = new FileReader();
    lezer.onload = () => klaar(lezer.result);
    lezer.onerror = () => mis(lezer.error);
    lezer.readAsDataURL(blob);
  });

/**
 * De indeling van de foto en de foto zelf. In het voorbeeld op dit toestel,
 * live via de functie huis: lezen mag iedereen van de omgeving, bewaren
 * alleen de eigenaar (dat toetst de functie, niet deze site). Alles gaat door
 * één loket, dus na elkaar; verslepen wordt pas na een korte stilte bewaard.
 *
 * @param {string|null} huisId  de gekozen omgeving; null in het voorbeeld
 * @param {boolean} eigenaar  alleen de eigenaar bewaart; een kijker leest
 */
export function useOpstelling(huisId, eigenaar) {
  const [opstelling, setOpstelling] = useState(() => {
    if (!VOORBEELD) return { ...LEGE_OPSTELLING };
    // In het voorbeeld de maxima zoals in huis A, zodat de ringen er staan; wat hier al bewaard is, gaat voor.
    const lokaal = uitOpslag(leesLokaal(LOKAAL_OPSTELLING));
    return { ...lokaal, vermogens: { ...VOORBEELD_VERMOGENS, ...lokaal.vermogens } };
  });
  const [foto, setFoto] = useState(() => (VOORBEELD ? leesLokaal(LOKAAL_FOTO) : null));
  const [melding, setMelding] = useState(null);
  const uitstel = useRef(null);
  // De laatste stand, ook tussen twee renders in: wijzig() rekent hierop verder.
  const huidige = useRef(opstelling);
  // Al iets veranderd voordat de indeling binnen was? Dan die niet overschrijven.
  const veranderd = useRef(false);
  // Welke foto er nu staat (kenmerk van de server en wat in <img src> staat).
  const fotoNu = useRef({ id: null, bron: null });

  // Dezelfde foto (zelfde kenmerk): niets doen, dus ook niet opnieuw ophalen.
  // Een andere: uit de kast van dit toestel of één keer van internet.
  const zetFoto = useCallback(async (url, id, nogNodig = () => true) => {
    if (id && id === fotoNu.current.id && fotoNu.current.bron) return;
    const bron = await fotoBron(id, url);
    if (!nogNodig()) return;
    const oud = fotoNu.current.bron;
    if (oud?.startsWith('blob:') && oud !== bron) URL.revokeObjectURL(oud);
    fotoNu.current = { id: (bron && id) || null, bron };
    if (!url) wisFotoKast();
    setFoto(bron);
  }, []);

  useEffect(() => {
    if (VOORBEELD || !huisId) return undefined;
    let gestopt = false;
    const haal = async (eerste) => {
      try {
        const uit = await vraag('opstelling', { huis_id: huisId });
        if (gestopt) return;
        // Een kijker ziet bij het verversen ook wat de eigenaar intussen veranderde.
        if ((eerste && !veranderd.current) || !eigenaar) {
          huidige.current = uitOpslag(uit?.opstelling);
          setOpstelling(huidige.current);
        }
        await zetFoto(uit?.foto_url ?? null, uit?.foto_id, () => !gestopt);
      } catch (fout) {
        if (gestopt) return;
        if (fout.soort === 'inloggen') naarInloggen();
        else if (eerste) setMelding('De indeling kon niet geladen worden; je ziet de beginstand.');
      }
    };
    // Eén tik later, zodat 'stand' (useStand, in dezelfde render) eerst in de rij van het loket staat:
    // de cijfers wil je het eerst zien, de tekening staat er al.
    const eerst = setTimeout(() => haal(true), 0);
    const id = setInterval(() => haal(false), FOTO_VERVERS_MS);
    return () => {
      gestopt = true;
      clearTimeout(eerst);
      clearInterval(id);
    };
  }, [huisId, eigenaar, zetFoto]);

  const bewaar = useCallback(
    async (velden) => {
      try {
        return await vraag('bewaarOpstelling', { huis_id: huisId, opstelling: velden });
      } catch (fout) {
        setMelding(fout.soort === 'alleenEigenaar' ? fout.message : 'Bewaren lukte niet. Probeer het zo nog eens.');
        return null;
      }
    },
    [huisId],
  );

  const wijzig = useCallback(
    (maak) => {
      if (!VOORBEELD && !eigenaar) return;
      const nieuw = maak(huidige.current);
      huidige.current = nieuw;
      veranderd.current = true;
      setOpstelling(nieuw);
      clearTimeout(uitstel.current);
      uitstel.current = setTimeout(() => {
        if (VOORBEELD) schrijfLokaal(LOKAAL_OPSTELLING, nieuw);
        else bewaar(naarRij(nieuw));
      }, 600);
    },
    [bewaar, eigenaar],
  );

  const kiesFoto = useCallback(
    async (bestand) => {
      setMelding(null);
      try {
        const klein = await verklein(bestand);
        if (VOORBEELD) {
          const data = await alsDataUrl(klein);
          setFoto(data);
          if (!schrijfLokaal(LOKAAL_FOTO, data)) setMelding('De foto blijft staan tot je deze pagina sluit.');
          return;
        }
        const fotoUri = await upload(new File([klein], 'huis.jpg', { type: 'image/jpeg' }));
        const uit = await bewaar({ foto_uri: fotoUri });
        if (uit) await zetFoto(uit.foto_url ?? null, uit.foto_id);
      } catch (fout) {
        setMelding(fout?.message?.startsWith('Deze foto') ? fout.message : 'De foto kon niet bewaard worden. Probeer het nog eens.');
      }
    },
    [bewaar, zetFoto],
  );

  const wisFoto = useCallback(async () => {
    setMelding(null);
    if (VOORBEELD) {
      setFoto(null);
      schrijfLokaal(LOKAAL_FOTO, null);
      return;
    }
    if (await bewaar({ foto_uri: '' })) await zetFoto(null, null);
  }, [bewaar, zetFoto]);

  /**
   * Een gasmeterstand erbij ({ stand: { datum, stand } }) of eraf ({ verwijder: datum }), via de
   * actie gasStand (alleen de eigenaar; de server kijkt na: oplopend, hooguit 400). In het
   * voorbeeld op dit toestel. Geeft { ok } of { fout: zin voor mensen }.
   */
  const gasStand = useCallback(
    async (verzoek) => {
      const zet = (standen) => {
        huidige.current = { ...huidige.current, gasStanden: gasStandenUit(standen) };
        setOpstelling(huidige.current);
      };
      if (VOORBEELD) {
        const oud = huidige.current.gasStanden ?? [];
        const nieuw = verzoek.verwijder !== undefined ? oud.filter((s) => s.datum !== verzoek.verwijder) : [...oud.filter((s) => s.datum !== verzoek.stand?.datum), verzoek.stand];
        zet(nieuw);
        schrijfLokaal(LOKAAL_OPSTELLING, huidige.current);
        return { ok: true };
      }
      if (!eigenaar) return { fout: 'Alleen de eigenaar vult meterstanden in.' };
      try {
        const uit = await vraag('gasStand', { huis_id: huisId, ...verzoek });
        zet(uit?.gas_standen);
        return { ok: true };
      } catch (fout) {
        if (fout.soort === 'inloggen') naarInloggen();
        return { fout: fout.message || 'Bewaren lukte niet. Probeer het zo nog eens.' };
      }
    },
    [huisId, eigenaar],
  );

  return { opstelling, wijzig, foto, kiesFoto, wisFoto, melding, gasStand };
}
