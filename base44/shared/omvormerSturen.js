/**
 * De omvormer begrenzen als terugleveren geld kost (programmaatje 1.5.0), aan de kant van de
 * server, en de spanningswacht. De app bedient niets: de eigenaar zet alleen een instelling
 * (Huis.omvormer_sturen, actie omvormerSturen in huizen.js); het programmaatje thuis hoort die
 * via het antwoord van ontvangMeting (voorBrug) en beslist zelf (brug/omvormerPlan.mjs).
 *
 *   Huis.omvormer_sturen  { aan, op, niet_op: ['2026-11-01'], vrij_op, netto }
 *     aan      standaard uit; alleen de eigenaar zet het
 *     niet_op  dagen dat het niet mag ("Morgen niet"), hooguit HOOGSTENS_DAGEN
 *     vrij_op  wanneer de eigenaar "Nu weer aan" koos (het programmaatje geeft hem dan vrij
 *              en begrenst de rest van dat blok niet meer)
 *     netto    'afnemer' (standaard: over het jaar meer afnemen dan terugleveren, zoals de app
 *              altijd rekende) of 'terugleveraar' (dan geen saldering op het teveel)
 *
 * Meting.omvormer.sturen: wat het programmaatje meldt (plan, stand), mild nagekeken
 * (sturenUit); Meting.spanning: de spanningswacht (spanningUit). Kijkers zien sturen niet
 * (metingVoorKijker in afschermen.js) en niets ervan in het Logboek.
 */

import { schoon } from './tekst.js';

const DATUM = /^\d{4}-\d{2}-\d{2}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T[0-9:.+\-Z]{5,30}$/;
export const HOOGSTENS_DAGEN = 14;
export const NETTO = Object.freeze(['afnemer', 'terugleveraar']);

const iso = (t) => typeof t === 'string' && t.length <= 40 && ISO.test(t) && Number.isFinite(Date.parse(t));

/** De instelling uit de Huis-rij, schoon. Niets (of iets raars): uit. */
export function instellingVan(huis) {
  const r = huis?.omvormer_sturen;
  if (!r || typeof r !== 'object' || Array.isArray(r)) return { aan: false, niet_op: [], vrij_op: null, netto: 'afnemer', op: null };
  return {
    aan: r.aan === true,
    // Te veel (een rij van elders): de nieuwste houden, zoals wijzig de voorbije eerst weggooit.
    niet_op: [...new Set((Array.isArray(r.niet_op) ? r.niet_op : []).filter((d) => typeof d === 'string' && DATUM.test(d)))].sort().slice(-HOOGSTENS_DAGEN),
    vrij_op: iso(r.vrij_op) ? r.vrij_op : null,
    netto: NETTO.includes(r.netto) ? r.netto : 'afnemer',
    op: iso(r.op) ? r.op : null,
  };
}

/** Wat de eigenaar in de app ziet (alleen de eigenaar: huisVoorSite). */
export const voorSite = (huis) => instellingVan(huis);

/**
 * Wat ontvangMeting aan het programmaatje teruggeeft: alleen als het aan staat (anders niets:
 * dat is voor elke brug "uit"). Kost geen aanroep: het staat in de Huis-rij bij de sleutel.
 */
export function voorBrug(huis) {
  const i = instellingVan(huis);
  if (!i.aan) return null;
  // `op` (programmaatje 1.6.0): wanneer de eigenaar het laatst iets veranderde; zo weet het programmaatje
  // dat het na "werkt niet op deze omvormer" opnieuw mag proberen. Een oudere brug laat het liggen.
  return { aan: true, ...(i.niet_op.length ? { niet_op: i.niet_op } : {}), ...(i.vrij_op ? { vrij_op: i.vrij_op } : {}), ...(i.netto !== 'afnemer' ? { netto: i.netto } : {}), ...(i.op ? { op: i.op } : {}) };
}

export class SturenFout extends Error {}

/**
 * De nieuwe instelling na een wijziging van de eigenaar:
 *   { aan: true|false }                aan of uit (nog eens aan = opnieuw proberen na "werkt niet")
 *   { dag: '2026-11-01', niet: true }  die dag niet (false: toch wel)
 *   { nu_aan: true }                   "Nu weer aan"
 *   { netto: 'afnemer'|'terugleveraar' }
 * Dagen die voorbij zijn (voor `vandaag`) vallen weg. Hooguit HOOGSTENS_DAGEN komende dagen; een
 * dag erbij als het vol is: een SturenFout (de eigenaar ziet waarom), nooit stil weglaten.
 */
export function wijzig(huis, invoer, nu) {
  if (!invoer || typeof invoer !== 'object' || Array.isArray(invoer)) throw new SturenFout('Deze vraag klopt niet.');
  const oud = instellingVan(huis);
  const op = new Date(nu).toISOString();
  const vandaag = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam' }).format(new Date(nu));
  const uit = { aan: oud.aan, niet_op: oud.niet_op.filter((d) => d >= vandaag), vrij_op: oud.vrij_op, netto: oud.netto, op };
  let iets = false;
  if (invoer.aan !== undefined) {
    if (typeof invoer.aan !== 'boolean') throw new SturenFout('Deze vraag klopt niet.');
    uit.aan = invoer.aan;
    iets = true;
  }
  if (invoer.dag !== undefined) {
    if (typeof invoer.dag !== 'string' || !DATUM.test(invoer.dag) || invoer.dag < vandaag || typeof invoer.niet !== 'boolean') throw new SturenFout('Kies vandaag of een dag later.');
    // De voorbije dagen zijn er al af (hierboven); past de nieuwe dag dan nog niet, dan een duidelijke
    // fout, nooit stil een dag weglaten (1.6.1: eerder bleef de vroegste staan en viel de nieuwe weg).
    const dagen = new Set(uit.niet_op);
    if (invoer.niet) dagen.add(invoer.dag);
    else dagen.delete(invoer.dag);
    if (dagen.size > HOOGSTENS_DAGEN) throw new SturenFout(`Er staan al ${HOOGSTENS_DAGEN} dagen op "niet". Haal er eerst een weg.`);
    uit.niet_op = [...dagen].sort();
    iets = true;
  }
  if (invoer.nu_aan !== undefined) {
    if (invoer.nu_aan !== true) throw new SturenFout('Deze vraag klopt niet.');
    uit.vrij_op = op;
    iets = true;
  }
  if (invoer.netto !== undefined) {
    if (!NETTO.includes(invoer.netto)) throw new SturenFout('Deze vraag klopt niet.');
    uit.netto = invoer.netto;
    iets = true;
  }
  if (!iets) throw new SturenFout('Deze vraag klopt niet.');
  return uit;
}

/* ---------- Wat het programmaatje meldt (controle.js), mild ---------- */

const STANDEN = new Set(['onbekend', 'vrij', 'begrensd', 'eigen']);
const MODI = new Set(['deels', 'uit', 'loont-niet']);
const NIET = new Set(['dag', 'nu-aan', 'mislukt', 'anders']);
const FOUTEN = new Set(['begrenzen', 'vrijgeven', 'eigen', 'rem']);
const UITKOMSTEN = new Set(['bezig', 'werkt', 'werkt-niet']);

/** sturen.controle (programmaatje 1.6.0): de zelfcontrole na een begrenzing, mild; iets raars: null. */
function controleUit(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c) || !UITKOMSTEN.has(c.uitkomst)) return null;
  return {
    uitkomst: c.uitkomst,
    ...(iso(c.op) ? { op: c.op } : {}),
    ...(Number.isInteger(c.pct) && c.pct >= 0 && c.pct <= 100 ? { pct: c.pct } : {}),
    ...(getal(c.voor_w, 0, 100_000) ? { voor_w: Math.round(c.voor_w) } : {}),
    ...(getal(c.na_w, 0, 100_000) ? { na_w: Math.round(c.na_w) } : {}),
    ...(c.via === 'omvormer' || c.via === 'net' ? { via: c.via } : {}),
    ...(c.reden === 'geen-effect' || c.reden === 'te-veel' ? { reden: c.reden } : {}),
  };
}

/** sturen.oorspronkelijk (1.6.0): hoe de omvormer stond voor het programmaatje hem ooit bediende. */
function oorspronkelijkUit(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o) || !Number.isInteger(o.grens_pct) || o.grens_pct < 0 || o.grens_pct > 65_535 || typeof o.schakelaar !== 'boolean') return null;
  return { grens_pct: o.grens_pct, schakelaar: o.schakelaar, ...(iso(o.op) ? { op: o.op } : {}) };
}
const getal = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

/** meting.omvormer.sturen: wat niet klopt valt weg; zonder geldige stand: null. */
export function sturenUit(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s) || !STANDEN.has(s.stand)) return null;
  const blokken = (Array.isArray(s.blokken) ? s.blokken : []).slice(0, 8).flatMap((b) => {
    if (!b || typeof b !== 'object' || !iso(b.van) || !iso(b.tot) || !(Date.parse(b.tot) > Date.parse(b.van)) || !getal(b.laagste, -20, 20)) return [];
    return [
      {
        van: b.van,
        tot: b.tot,
        laagste: Math.round(b.laagste * 10_000) / 10_000,
        modus: MODI.has(b.modus) ? b.modus : 'deels',
        ...(b.reden === 'saldering' ? { reden: 'saldering' } : {}),
        ...(NIET.has(b.niet) ? { niet: b.niet } : {}),
      },
    ];
  });
  const controle = controleUit(s.controle);
  const oorspronkelijk = oorspronkelijkUit(s.oorspronkelijk);
  return {
    aan: s.aan === true,
    stand: s.stand,
    ...(Number.isInteger(s.pct) && s.pct >= 0 && s.pct <= 100 ? { pct: s.pct } : {}),
    ...(iso(s.sinds) ? { sinds: s.sinds } : {}),
    ...(s.door === 'programmaatje' ? { door: 'programmaatje' } : {}),
    ...(Number.isInteger(s.aanpassingen) && s.aanpassingen >= 0 && s.aanpassingen <= 1000 ? { aanpassingen: s.aanpassingen } : {}),
    ...(getal(s.doel_w, 0, 100_000) ? { doel_w: Math.round(s.doel_w) } : {}),
    ...(Number.isInteger(s.grens_pct) && s.grens_pct >= 0 && s.grens_pct <= 65_535 ? { grens_pct: s.grens_pct } : {}),
    ...(getal(s.verbruik_w, 0, 100_000) ? { verbruik_w: Math.round(s.verbruik_w) } : {}),
    blokken,
    ...(s.nu_aan === true ? { nu_aan: true } : {}),
    ...(FOUTEN.has(s.fout) ? { fout: s.fout, ...(iso(s.fout_sinds) ? { fout_sinds: s.fout_sinds } : {}) } : {}),
    ...(iso(s.vrij_op) ? { vrij_op: s.vrij_op } : {}),
    // Programmaatje 1.6.0: de grens in watt (voor de regel tijdens een blok), de zelfcontrole en hoe hij oorspronkelijk stond.
    ...(getal(s.grens_w, 0, 100_000) ? { grens_w: Math.round(s.grens_w) } : {}),
    ...(controle ? { controle } : {}),
    ...(oorspronkelijk ? { oorspronkelijk } : {}),
  };
}

const SLEUTEL = /^(L[123]|zon)$/;
const BRONNEN = new Set(['omvormer', 'p1', 'meter', 'zon']);
const volt = (v) => getal(v, 100, 400);
const kort = (v) => Math.round(v * 10) / 10;
const naamUit = (n) => (typeof n === 'string' ? schoon(n.replace(/[<>]/g, ''), 40) : '');

/** meting.spanning (de spanningswacht, brug/spanning.mjs): mild; niets bruikbaars: null. */
export function spanningUit(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s) || typeof s.datum !== 'string' || !DATUM.test(s.datum)) return null;
  const lijst = (l, n, maak) => (Array.isArray(l) ? l.slice(0, n).flatMap((x) => (x && typeof x === 'object' ? maak(x) : [])) : []);
  const teller = (v) => (Number.isInteger(v) && v >= 0 && v <= 100_000 ? v : 0);
  return {
    datum: s.datum,
    herkomst: lijst(s.herkomst, 4, (x) => (SLEUTEL.test(x.sleutel ?? '') && BRONNEN.has(x.bron) ? [{ sleutel: x.sleutel, bron: x.bron, ...(naamUit(x.naam) ? { naam: naamUit(x.naam) } : {}) }] : [])),
    nu: lijst(s.nu, 4, (x) => (SLEUTEL.test(x.sleutel ?? '') && volt(x.v) ? [{ sleutel: x.sleutel, v: kort(x.v), ...(volt(x.gem10) ? { gem10: kort(x.gem10) } : {}) }] : [])),
    hoogste: lijst(s.hoogste, 4, (x) => (SLEUTEL.test(x.sleutel ?? '') && volt(x.v) ? [{ sleutel: x.sleutel, v: kort(x.v), ...(iso(x.op) ? { op: x.op } : {}) }] : [])),
    verschil: lijst(s.verschil, 3, (x) => (/^L[123]$/.test(x.sleutel ?? '') && getal(x.v, -50, 50) ? [{ sleutel: x.sleutel, v: kort(x.v), ...(iso(x.op) ? { op: x.op } : {}) }] : [])),
    // Programmaatje 1.6.0: twee driefase meters (zon en spa); met welke meter de zonmeter per fase vergeleken is.
    ...(naamUit(s.verschil_met) ? { verschil_met: naamUit(s.verschil_met) } : {}),
    uitval_vandaag: teller(s.uitval_vandaag),
    boven_250_vandaag: teller(s.boven_250_vandaag),
    boven_250_uitgevallen: teller(s.boven_250_uitgevallen),
    ...(typeof s.maand === 'string' && /^\d{4}-\d{2}$/.test(s.maand) ? { maand: s.maand } : {}),
    uitval_maand: teller(s.uitval_maand),
    lijst: lijst(s.lijst, 30, (x) => (iso(x.op) && SLEUTEL.test(x.sleutel ?? '') && volt(x.v) ? [{ op: x.op, sleutel: x.sleutel, v: kort(x.v), ...(volt(x.gem) ? { gem: kort(x.gem) } : {}), ...(x.omvormer === true ? { omvormer: true } : {}) }] : [])),
  };
}

/* ---------- Het Logboek (logboek.js) ---------- */

/** De sleutels van de gebeurtenissen over het sturen: een kijker ziet ze niet (actie logboek). */
export const LOGBOEK_VOORVOEGSEL = 'omvormer-sturen:';

const procentTekst = (s) => (Number.isInteger(s.pct) ? `${s.pct}%` : '');

/**
 * Wat er nu openstaat over het sturen, voor het Logboek: [{ sleutel, wat }]. Eén regel per
 * blok zolang hij begrensd staat (de tekst groeit mee: hoe vaak bijgesteld; bij het einde
 * komt de laatste tekst in de rij), "Nu weer aan" zolang dat blok loopt, en een mislukte poging.
 */
export function sturenGebeurtenissen(s) {
  if (!s || typeof s !== 'object') return [];
  const uit = [];
  if (s.stand === 'begrensd' && s.door === 'programmaatje') {
    const bij = s.aanpassingen > 0 ? `, ${s.aanpassingen} keer bijgesteld aan het verbruik` : '';
    uit.push({ sleutel: `${LOGBOEK_VOORVOEGSEL}begrensd`, wat: `Omvormer begrensd door het programmaatje (terugleveren kostte geld)${procentTekst(s) ? `, op ${procentTekst(s)}` : ''}${bij}` });
  }
  if (s.nu_aan === true) uit.push({ sleutel: `${LOGBOEK_VOORVOEGSEL}nu-aan`, wat: '"Nu weer aan" in de app: de omvormer levert weer vol, de rest van dit blok' });
  const fout = {
    begrenzen: 'Omvormer begrenzen lukte niet; het programmaatje gaf hem vrij',
    vrijgeven: 'Omvormer vrijgeven lukte niet; het programmaatje probeert het opnieuw',
    eigen: `Omvormer heeft een eigen grens${Number.isInteger(s.grens_pct) ? ` (${s.grens_pct}%)` : ''}; het programmaatje stuurt hem niet`,
  }[s.fout];
  if (fout) uit.push({ sleutel: `${LOGBOEK_VOORVOEGSEL}fout-${s.fout}`, wat: fout });
  // De zelfcontrole (1.6.0): zolang het "werkt niet op deze omvormer" is (tot de eigenaar het opnieuw aanzet).
  const c = s.controle;
  if (c && typeof c === 'object' && c.uitkomst === 'werkt-niet') {
    const kw = (w) => `${(Math.round(w / 100) / 10).toFixed(1).replace('.', ',')} kW`;
    const getallen = Number.isFinite(c.voor_w) && Number.isFinite(c.na_w) ? ` (van ${kw(c.voor_w)} naar ${kw(c.na_w)}${Number.isInteger(c.pct) ? ` bij ${c.pct}%` : ''})` : '';
    const waarom = c.reden === 'te-veel' ? `hij leverde veel minder dan bedoeld${getallen}` : `begrenzen had geen effect${getallen}`;
    uit.push({ sleutel: `${LOGBOEK_VOORVOEGSEL}werkt-niet`, wat: `Begrenzen werkt niet op deze omvormer: ${waarom}; het programmaatje gaf hem vrij en stuurt hem niet meer tot je het in de app opnieuw aanzet` });
  }
  return uit;
}
