/**
 * De verwachte zonne-opbrengst van morgen (en de rest van vandaag) op het
 * tabblad Voorspelling, per zonnebron van het huis, en wat dat betekent voor
 * de batterij en het geld. Puur rekenen, zonder Base44: alles komt uit wat de
 * site al heeft (de stand met het weerbericht, de opstelling, en de dagen die
 * Advies toch al ophaalt; zie src/lib/adviesBron.js). (De naam `voorspelling`
 * is al van de prijzen per kwartier.)
 *
 * Hoe het rekent en leert, per huis:
 *
 * 1. Natuurkunde vooraf (dag één, zonder iets geleerd): per uur het licht op
 *    de panelen uit de straling van Open-Meteo en de stand van de zon
 *    (src/lib/zonnestand.js, met een gewoon dak: 30° naar het zuiden), maal
 *    een gewone prestatieverhouding (PRESTATIE, 0,8: kabels, omvormer, warmte
 *    en vuil samen) maal het maximale vermogen van die plek (Opstelling
 *    `vermogens`, Instellingen › Namen; nooit meer dan dat maximum).
 * 2. Leren vanaf het eerste uur: elk heel uur waarin de zon gemeten is en het
 *    weerbericht de straling gaf (Dag zon_uur_wh en straling_uur_wh_m2, en de
 *    uren van vandaag uit de stand), vergelijken we met wat de natuurkunde zei.
 *    - Eén factor voor het hele huis (dak, schaduw, de echte stand van de
 *      panelen): gemeten ÷ voorspeld, met de natuurkunde als voorzichtige
 *      start (VOORAF_KWH_PER_KWP: telt als zoveel gemeten kWh per kWp). Na één
 *      zonnige dag weegt het gemeten al zwaarder dan de start.
 *    - Per plek een factor (welke plek beter of slechter doet dan gedacht),
 *      waar dat kan: met de zon per plek per uur (programmaatje 0.10.0, Dag
 *      zonnen_uur_wh) of per dag uit de omvormer (GoodWe: Dag omvormer_kwh, of
 *      het verschil van zijn teller omvormer_totaal_kwh tussen twee dagen).
 *    - Een seizoensfactor naar de stand van de zon (bakjes van zonshoogte en
 *      oost/zuid/west): een lage winterzon achter de bomen, of een dak op het
 *      westen, leert hij zo apart. Een stand die hij nog niet zag, rekent met 1.
 * 3. Zonder maximaal vermogen (zoals in huis B: één kWh-meter, geen omvormer):
 *    geen start, maar meteen het geleerde (een "vermogen" uit wat er gemeten
 *    is); de app vraagt om het vermogen in te vullen.
 *
 * Eerlijk over de zekerheid: hoeveel dagen geleerd, en een bandbreedte uit
 * hoe goed de dagen tot nu uitkwamen (anders een ruime schatting). Na een dag
 * zegt hij hoe goed de voorspelling van gisteren uitkwam: de bewaarde
 * voorspelling van eergisteren op dit toestel, of anders een terugblik (het
 * geleerde van daarvoor met het weer van gisteren).
 */

import { BEWOLKT_VANAF_PCT, batterijVoorAdvies, leerHuis, prijzenPerUur, rekenDoor, ZONNIG_TOT_PCT } from './advies';
import { euro, vermogen } from './opmaak';
import { lichtOpPanelen, plaatsUitZon, zonnestand } from './zonnestand';

const UUR_MS = 3_600_000;
/** Een gewone prestatieverhouding voor zonnepanelen in Nederland. */
export const PRESTATIE = 0.8;
/** De natuurkunde vooraf telt als zoveel gemeten kWh per kWp (een grijze herfstdag levert ~0,5, een zonnige ~3). */
export const VOORAF_KWH_PER_KWP = 1;
/** Per plek: zo zwaar telt "net als de rest" vooraf, in kWh per kWp. */
const PLEK_VOORAF_KWH_PER_KWP = 0.5;
/** Per stand van de zon: zo zwaar telt "zoals altijd" vooraf, in kWh per kWp. */
const STAND_VOORAF_KWH_PER_KWP = 0.5;
/** Een uur met minder licht dan dit (Wh/m²) zegt te weinig over de panelen. */
const LICHT_MIN = 20;
/** Zonder vermogen: na zoveel voorspelde kWh (per "kWp" van de rekenstart) is er genoeg geleerd om iets te zeggen. */
const ZONDER_VERMOGEN_MIN_KWH = 0.3;
/** Grenzen van de zonshoogte (graden) voor de seizoensfactor. */
export const HOOGTE_GRENZEN = Object.freeze([8, 16, 25, 35]);
/** Na zoveel dagen met zon is het geleerde stevig. */
export const GOED_NA_DAGEN = 7;
/** Zoveel dagen terug leert de zon (de dagen die Advies ophaalt; zie src/lib/adviesBron.js). */
export const LEER_DAGEN = 42;
/** Ouder dan dit noemen we het weerbericht oud (het programmaatje haalt het elk uur). */
export const BERICHT_OUD_MS = 3 * UUR_MS;

const getal = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const som = (lijst) => lijst.reduce((a, b) => a + b, 0);
const tussen = (v, min, max) => Math.min(max, Math.max(min, v));

const uurNotatie = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', hour: '2-digit', hourCycle: 'h23' });
const datumNotatie = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' });
const uurVan = (ms) => Number(uurNotatie.format(new Date(ms))) % 24;
export const datumVan = (ms) => datumNotatie.format(new Date(ms));
/** De dag na of voor "2026-10-30" (op de datumtekst: een dag is niet altijd 24 uur). */
export const dagErbij = (datum, n) => {
  const [j, m, d] = datum.split('-').map(Number);
  return new Date(Date.UTC(j, m - 1, d + n)).toISOString().slice(0, 10);
};
const klok = (ms) => `${String(uurVan(ms)).padStart(2, '0')}:00`;
const eenDecimaal = new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const heel = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0 });
/** "0,8 kWh", "9,4 kWh", "26 kWh": onder de 10 op een decimaal, daarboven heel (meer zegt een verwachting niet). */
export const kwhKort = (v) => `${v < 9.95 ? eenDecimaal.format(Math.max(0, v)) : heel.format(v)}\u00a0kWh`;

/** Middernacht in Nederland van `datum` (ms). */
export function middernachtVan(datum) {
  const [j, m, d] = datum.split('-').map(Number);
  for (const uren of [2, 1]) {
    const t = Date.UTC(j, m - 1, d) - uren * UUR_MS;
    if (datumVan(t) === datum && datumVan(t - 1) !== datum) return t;
  }
  return Date.UTC(j, m - 1, d) - UUR_MS;
}

/** Per uur van de klok (0 tot 23) het begin van dat uur op `datum` (ms); het dubbele uur als de klok terug gaat: het eerste. */
function urenVanDatum(datum) {
  const begin = middernachtVan(datum);
  const uit = Array(24).fill(null);
  for (let k = 0; k < 26; k++) {
    const t = begin + k * UUR_MS;
    if (datumVan(t) !== datum) break;
    const h = uurVan(t);
    if (uit[h] === null) uit[h] = t;
  }
  return uit;
}

/** In welk bakje van de zonnestand een uur valt: zonshoogte (0 tot 4) maal oost, zuid of west. */
function standVan(hoogte, richting) {
  const h = HOOGTE_GRENZEN.findIndex((g) => hoogte < g);
  const bakje = h === -1 ? HOOGTE_GRENZEN.length : h;
  const kant = richting < 150 ? 'oost' : richting <= 210 ? 'zuid' : 'west';
  return `${bakje}-${kant}`;
}

/**
 * De zonnebronnen van het huis uit de punten (puntenVoor in src/lib/opstelling.js):
 * [{ sleutel, naam, maxW }] (maxW: het maximale vermogen uit Namen, of null).
 */
export function bronnenUit(punten) {
  return (Array.isArray(punten) ? punten : []).filter((p) => p?.soort === 'zon').map((p) => ({ sleutel: p.sleutel, naam: p.naam, maxW: getal(p.eigenMax) }));
}

/**
 * Wat de natuurkunde per kWp zegt voor het uur dat begint op `begin` (kWh per
 * kWp, met de prestatieverhouding), en in welk bakje van de zonnestand het valt.
 */
function natuurkunde(begin, straling, plaats) {
  const licht = lichtOpPanelen(begin, straling, plaats);
  return { perKwp: (PRESTATIE * licht.schuin) / 1000, stand: standVan(licht.hoogte, licht.richting), hoogte: licht.hoogte };
}

/**
 * De uren om van te leren: elk heel uur met zon gemeten en straling uit het
 * weerbericht. Van de dagen (Dag) en van vandaag tot nu (stand.dag en
 * stand.weer). Per uur: { datum, begin, straling, zonWh, perPlek ({ [sleutel]: Wh } of null) }.
 */
export function leerUren({ dagen = [], dag = null, weer = null, vandaag, nu, tot = vandaag }) {
  const uit = [];
  for (const d of dagen) {
    if (!d?.datum || d.datum >= tot || !d.uren?.zonWh || !d.uren.stralingWh) continue;
    const begins = urenVanDatum(d.datum);
    for (let h = 0; h < 24; h++) {
      // Alleen een gewoon heel uur (het dubbele uur als de klok terug gaat: twee keer zoveel van beide, dat laten we liggen).
      if (d.uren.kwartieren[h] !== 4 || !(d.uren.stralingWh[h] >= LICHT_MIN) || begins[h] === null) continue;
      const perPlek = d.uren.zonnenWh ? Object.fromEntries(Object.entries(d.uren.zonnenWh).map(([s, wh]) => [s, wh[h]])) : null;
      uit.push({ datum: d.datum, begin: begins[h], straling: d.uren.stralingWh[h], zonWh: d.uren.zonWh[h], perPlek });
    }
  }
  // Vandaag tot nu: de hele uren die voorbij zijn, met vier kwartieren zon gemeten.
  if (tot >= vandaag && dag?.metingen && dag.zon && weer?.straling) {
    const perUur = new Map();
    for (let i = 0; i < dag.metingen.length; i++) {
      const begin = dag.van + i * dag.stapMs;
      const uurBegin = Math.floor(begin / UUR_MS) * UUR_MS;
      if (datumVan(begin) !== vandaag || uurBegin + UUR_MS > nu || !(dag.metingen[i] > 0) || dag.zon[i] == null) continue;
      const u = perUur.get(uurBegin) ?? { n: 0, wh: 0, plek: {} };
      u.n += 1;
      u.wh += Math.max(0, dag.zon[i]) / 4;
      for (const [s, rij] of Object.entries(dag.zonnen ?? {})) u.plek[s] = (u.plek[s] ?? 0) + Math.max(0, rij[i] ?? 0) / 4;
      perUur.set(uurBegin, u);
    }
    for (const [begin, u] of perUur) {
      const i = Math.round((begin - weer.van) / weer.stapMs);
      const straling = weer.straling[i];
      if (u.n !== 4 || !(straling >= LICHT_MIN)) continue;
      uit.push({ datum: vandaag, begin, straling, zonWh: u.wh, perPlek: dag.zonnen ? u.plek : null });
    }
  }
  return uit;
}

/**
 * Per dag wat de omvormer zei (kWh), voor de plek waar hij bij hoort: Dag
 * omvormer_kwh, of anders het verschil van zijn teller met de dag ervoor.
 * [{ datum, kwh, bij }]
 */
export function omvormerDagen(dagen = [], tot) {
  const opDatum = new Map(dagen.filter((d) => d?.omvormer).map((d) => [d.datum, d]));
  const uit = [];
  for (const d of opDatum.values()) {
    if (d.datum >= tot) continue;
    let kwh = d.omvormer.kwh;
    const vorige = opDatum.get(dagErbij(d.datum, -1))?.omvormer;
    if (kwh === null && d.omvormer.totaal !== null && vorige?.totaal != null) kwh = d.omvormer.totaal - vorige.totaal;
    if (kwh !== null && kwh >= 0 && kwh < 2000) uit.push({ datum: d.datum, kwh, bij: d.omvormer.bij });
  }
  return uit;
}

/**
 * Leer de zon van dit huis.
 *
 * @param {{ dagen?: Array, dag?: object|null, weer?: object|null, bronnen: Array<{ sleutel: string, naam: string, maxW: number|null }>,
 *   plaats: { breedte: number, lengte: number }, vandaag: string, nu: number, tot?: string }} o
 *   tot: alleen dagen vóór deze datum (voor de terugblik op gisteren); standaard vandaag, en dan telt vandaag tot nu ook mee
 * @returns {{ bronnen: Array<{ sleutel, naam, maxW, kwp, geschat: boolean, factor: number, perPlek: boolean }>,
 *   factor: number|null, standen: Record<string, number>, dagen: number, vandaagTelt: boolean, uren: number,
 *   zonderVermogen: boolean, spreiding: number|null, dagFouten: number[], perUur: (begin: number, straling: number) => { w: number, perBron: Record<string, number> }|null }}
 */
export function leerZon({ dagen = [], dag = null, weer = null, bronnen, plaats, vandaag, nu, tot = vandaag }) {
  const bekend = bronnen.filter((b) => b.maxW);
  const gemKwp = bekend.length ? som(bekend.map((b) => b.maxW)) / 1000 / bekend.length : 1;
  const zonderVermogen = bekend.length === 0;
  const lijst = bronnen.map((b) => ({ ...b, kwp: b.maxW ? b.maxW / 1000 : gemKwp, geschat: !b.maxW, factor: 1, perPlek: false }));
  const totaalKwp = som(lijst.map((b) => b.kwp));

  const uren = leerUren({ dagen, dag, weer, vandaag, nu, tot }).map((u) => ({ ...u, ...natuurkunde(u.begin, u.straling, plaats) }));

  // 1. Eén factor voor het hele huis, met de natuurkunde als start (zonder vermogen: geen start).
  const vooraf = zonderVermogen ? 0 : VOORAF_KWH_PER_KWP * som(bekend.map((b) => b.maxW / 1000));
  const gemeten = som(uren.map((u) => u.zonWh / 1000));
  const voorspeld = som(uren.map((u) => u.perKwp * totaalKwp));
  let factor = null;
  if (!zonderVermogen) factor = tussen((gemeten + vooraf) / (voorspeld + vooraf), 0.2, 2);
  else if (voorspeld >= ZONDER_VERMOGEN_MIN_KWH) factor = tussen(gemeten / voorspeld, 0.02, 50);

  if (factor !== null && lijst.length > 1) {
    // 2. Per plek: met de zon per plek per uur (0.10.0), of per dag uit de omvormer.
    const perPlek = new Map(lijst.map((b) => [b.sleutel, { m: 0, p: 0 }]));
    const metUur = new Set();
    for (const u of uren) {
      if (!u.perPlek) continue;
      metUur.add(u.datum);
      for (const b of lijst) {
        const wh = getal(u.perPlek[b.sleutel]);
        if (wh === null) continue;
        const s = perPlek.get(b.sleutel);
        s.m += wh / 1000;
        s.p += factor * b.kwp * u.perKwp;
      }
    }
    const opDag = new Map();
    for (const u of uren) opDag.set(u.datum, [...(opDag.get(u.datum) ?? []), u]);
    for (const o of omvormerDagen(dagen, tot)) {
      if (metUur.has(o.datum)) continue;
      const bij = lijst.find((b) => b.sleutel === o.bij) ?? lijst[0];
      const dagUren = opDag.get(o.datum);
      const dagRij = dagen.find((d) => d.datum === o.datum);
      // Alleen een dag die we ook uur voor uur kennen (anders weten we niet welk licht erbij hoorde).
      if (!dagUren?.length || !dagRij) continue;
      const perKwp = som(dagUren.map((u) => u.perKwp));
      const deel = som(dagUren.map((u) => u.zonWh)) / 1000 / Math.max(0.001, getal(dagRij.zon) ?? som(dagUren.map((u) => u.zonWh)) / 1000);
      const s = perPlek.get(bij.sleutel);
      s.m += o.kwh * tussen(deel, 0, 1);
      s.p += factor * bij.kwp * perKwp;
      if (lijst.length === 2 && getal(dagRij.zon) !== null) {
        const ander = lijst.find((b) => b !== bij);
        const a = perPlek.get(ander.sleutel);
        a.m += Math.max(0, dagRij.zon - o.kwh) * tussen(deel, 0, 1);
        a.p += factor * ander.kwp * perKwp;
      }
    }
    for (const b of lijst) {
      const s = perPlek.get(b.sleutel);
      if (!(s.p > 0)) continue;
      const v = PLEK_VOORAF_KWH_PER_KWP * b.kwp;
      b.factor = tussen((s.m + v) / (s.p + v), 0.1, 10);
      b.perPlek = s.m > 0.2;
    }
  }

  // 3. De seizoensfactor naar de stand van de zon, op wat overblijft.
  const standen = {};
  if (factor !== null) {
    const perStand = new Map();
    const schaal = som(lijst.map((b) => factor * b.factor * b.kwp));
    for (const u of uren) {
      const s = perStand.get(u.stand) ?? { m: 0, p: 0 };
      s.m += u.zonWh / 1000;
      s.p += u.perKwp * schaal;
      perStand.set(u.stand, s);
    }
    const v = STAND_VOORAF_KWH_PER_KWP * schaal;
    for (const [stand, s] of perStand) standen[stand] = tussen((s.m + v) / (s.p + v), 0.3, 2);
  }

  /** Per uur: wat elke plek levert (W), gemiddeld over het uur dat begint op `begin`, bij `straling` W/m². */
  const perUur = (begin, straling) => {
    if (factor === null || getal(straling) === null) return null;
    const n = natuurkunde(begin, straling, plaats);
    const seizoen = standen[n.stand] ?? 1;
    const perBron = {};
    for (const b of lijst) {
      const w = factor * b.factor * b.kwp * n.perKwp * seizoen * 1000;
      perBron[b.sleutel] = b.maxW ? Math.min(b.maxW, w) : w;
    }
    return { w: som(Object.values(perBron)), perBron };
  };

  // Hoe goed de dagen tot nu uitkwamen met wat hij nu weet (alleen dagen met genoeg zon om iets te zeggen).
  const dagFouten = [];
  const perDag = new Map();
  for (const u of uren) {
    if (u.datum === vandaag) continue;
    const d = perDag.get(u.datum) ?? { m: 0, p: 0 };
    d.m += u.zonWh / 1000;
    d.p += (perUur(u.begin, u.straling)?.w ?? 0) / 1000;
    perDag.set(u.datum, d);
  }
  for (const d of perDag.values()) if (d.p >= 0.5 && d.m > 0.05) dagFouten.push(Math.log(d.m / d.p));
  const spreiding = dagFouten.length >= 3 ? Math.sqrt(som(dagFouten.map((f) => f * f)) / dagFouten.length) : null;

  return {
    bronnen: lijst,
    factor,
    standen,
    dagen: perDag.size,
    vandaagTelt: uren.some((u) => u.datum === vandaag),
    uren: uren.length,
    zonderVermogen,
    spreiding,
    dagFouten,
    perUur,
  };
}

/** Zo ver zit een weerbericht een dag vooruit er minstens naast (relatief): op een wisselende herfstdag vaak 20–40%. */
export const BAND_VOORUIT_MIN = 0.25;
/** Bij wisselende bewolking (tussen ZONNIG_TOT_PCT en BEWOLKT_VANAF_PCT) nog ruimer: dan weet het bericht het minst. */
export const BAND_VOORUIT_WISSELEND = 0.35;
/** Zoveel dagen met een bewaarde voorspelling en wat het werd: dan telt de echte fout van een dag vooruit. */
const BAND_BEWAARD_DAGEN = 3;

/**
 * Bandbreedte (relatief, plus en min) voor morgen (R19-RK-06). Hoe goed de
 * geleerde dagen uitkwamen (met de straling van die dag zelf) is te mooi: de
 * fout van een weerbericht een dag vooruit zit er niet in. Dus: zijn er minstens
 * BAND_BEWAARD_DAGEN dagen waarvan dit toestel de voorspelling bewaarde, dan
 * hoe ver die ernaast zaten; anders minstens BAND_VOORUIT_MIN (bij wisselende
 * bewolking BAND_VOORUIT_WISSELEND).
 */
export function bandVan(geleerd, { bewaard = null, dagen = [], vandaag = null, bewolking = null } = {}) {
  let model;
  if (geleerd.spreiding !== null) model = geleerd.spreiding * 1.3;
  else if (geleerd.zonderVermogen) model = geleerd.dagen > 0 ? 0.35 : 0.45;
  else model = geleerd.dagen > 0 || geleerd.vandaagTelt ? 0.3 : 0.4;
  const fouten = [];
  for (const [datum, voorspeld] of Object.entries(bewaard ?? {})) {
    if (vandaag === null || !(datum < vandaag) || !(getal(voorspeld) >= 0.5)) continue;
    const d = dagen.find((r) => r?.datum === datum);
    const gemeten = getal(d?.zon);
    if (gemeten === null || !(gemeten > 0.05) || !((d.kwartieren ?? 0) >= 80)) continue;
    fouten.push(Math.log(gemeten / voorspeld));
  }
  const wisselend = getal(bewolking) !== null && bewolking > ZONNIG_TOT_PCT && bewolking <= BEWOLKT_VANAF_PCT;
  const vooruit =
    fouten.length >= BAND_BEWAARD_DAGEN ? Math.sqrt(som(fouten.map((f) => f * f)) / fouten.length) * 1.3 : wisselend ? BAND_VOORUIT_WISSELEND : BAND_VOORUIT_MIN;
  return tussen(Math.max(model, vooruit), 0.12, 0.6);
}

/** Het weerbericht als { op(t) → plek i of -1, van, tot } (stand.weer, src/lib/bron.js weerUit). */
function berichtVan(weer) {
  if (!weer || !Number.isFinite(weer.van)) return null;
  const lengte = (weer.straling ?? weer.bewolking ?? []).length;
  if (!lengte) return null;
  const plek = (t) => {
    const i = Math.floor((t - weer.van) / weer.stapMs);
    return i >= 0 && i < lengte ? i : -1;
  };
  return { plek, van: weer.van, tot: weer.van + lengte * weer.stapMs };
}

/** "a", "a en b", "a, b en c". */
const opsomming = (delen) => (delen.length <= 1 ? (delen[0] ?? '') : `${delen.slice(0, -1).join(', ')} en ${delen.at(-1)}`);

/**
 * De verwachting voor de rest van vandaag en morgen.
 *
 * @param {{ stand: object|null, dagen?: Array, punten?: Array, nu: number, bewaard?: Record<string, number>|null }} o
 *   stand: zoals standUitRij (src/lib/bron.js), na vanNu; dagen: uit dagenUit (src/lib/periode.js);
 *   punten: puntenVoor(opstelling, stand) (de zonnebronnen met hun vermogen); bewaard: per datum de
 *   voorspelde kWh die dit toestel eerder bewaarde (voor "hoe kwam gisteren uit")
 * @returns {null | object}  null zonder stand; zie de velden onderaan
 */
export function maakMorgen({ stand, dagen = [], punten = [], nu, bewaard = null }) {
  if (!stand) return null;
  const vandaag = datumVan(nu);
  const morgen = dagErbij(vandaag, 1);
  const gisteren = dagErbij(vandaag, -1);
  const bronnen = bronnenUit(punten);
  const plaats = plaatsUitZon(stand.brug?.zon);
  const weer = stand.weer ?? null;
  const bericht = berichtVan(weer);
  const metPanelen = bronnen.length > 0;
  const vraagVermogen = bronnen.filter((b) => !b.maxW).map((b) => b.naam);
  const basis = { vandaag, morgen, plaats, bronnen, metPanelen, vraagVermogen, metWeer: Boolean(bericht), weerOud: Boolean(weer?.opgehaald) && nu - weer.opgehaald > BERICHT_OUD_MS };
  if (!metPanelen) return { ...basis, zon: null, zinnen: [], toelichting: [] };

  const geleerd = leerZon({ dagen, dag: stand.dag, weer, bronnen, plaats, vandaag, nu });
  const begin = Math.floor(nu / UUR_MS) * UUR_MS;

  // Per uur vanaf het uur van nu tot het eind van morgen: de zon per plek uit het weerbericht.
  const uren = [];
  for (let t = begin; datumVan(t) <= morgen; t += UUR_MS) {
    const i = bericht ? bericht.plek(t) : -1;
    const straling = i >= 0 ? (weer.straling?.[i] ?? null) : null;
    const zon = straling === null ? null : geleerd.perUur(t, straling);
    uren.push({ begin: t, uur: uurVan(t), datum: datumVan(t), deel: t === begin ? tussen((t + UUR_MS - nu) / UUR_MS, 0, 1) : 1, straling, zonW: zon?.w ?? null, perBron: zon?.perBron ?? null });
  }
  const morgenUren = uren.filter((u) => u.datum === morgen);
  const vandaagUren = uren.filter((u) => u.datum === vandaag);
  // De bewolking van morgen, over de uren met licht: bij wisselend bewolkt is de band ruimer.
  const bewolkingen = morgenUren.filter((u) => u.straling > 20).map((u) => weer.bewolking?.[bericht.plek(u.begin)]).filter((v) => getal(v) !== null);
  const band = bandVan(geleerd, { bewaard, dagen, vandaag, bewolking: bewolkingen.length ? som(bewolkingen) / bewolkingen.length : null });
  // Morgen gedekt: elk uur waarin de zon op is, staat in het bericht (het laatste uur van de dag valt er altijd net buiten).
  const zonOp = (u) => zonnestand(u.begin + UUR_MS / 2, plaats).hoogte > -1;
  const gedekt = morgenUren.length > 0 && morgenUren.filter(zonOp).every((u) => u.straling !== null);
  const kanRekenen = geleerd.factor !== null;

  const zon = kanRekenen && gedekt ? zonVan(morgenUren, geleerd, band) : null;
  const vandaagNog = kanRekenen && vandaagUren.length && vandaagUren.filter(zonOp).every((u) => u.straling !== null)
    ? som(vandaagUren.map((u) => ((u.zonW ?? 0) * u.deel) / 1000))
    : null;

  // De batterij en het geld: van nu tot het eind van morgen doorgerekend met eigen gebruik (rekenDoor in advies.js).
  const batterij = batterijVoorAdvies(stand);
  const geldEnBatterij = zon ? doorrekenen({ uren, stand, dagen, nu, batterij, morgen }) : null;

  const terug = gisterenUitgekomen({ dagen, bewaard, gisteren, bronnen, plaats, nu, vandaag });

  const zinnen = [];
  const toelichting = [];
  if (zon) {
    zinnen.push(`Morgen zo'n ${kwhKort(zon.kwh)} zon (tussen ${kwhKort(zon.laag)} en ${kwhKort(zon.hoog)}).`);
    if (zon.piek) zinnen.push(`Het meest ${zon.piek.tijd} (tot zo'n ${vermogen(zon.piek.w)}).`);
    if (geldEnBatterij?.batterijZin) zinnen.push(geldEnBatterij.batterijZin);
    if (geldEnBatterij?.geldZin) zinnen.push(geldEnBatterij.geldZin);
  } else if (!bericht) {
    zinnen.push('Er is (nog) geen weerbericht van thuis: zonder weet ik niet hoeveel zon er morgen komt.');
  } else if (!gedekt) {
    zinnen.push('Het weerbericht reikt nog niet tot en met morgen; zodra het programmaatje een nieuw bericht haalt (elk uur), staat het hier.');
  } else {
    zinnen.push('Hoeveel zon je panelen morgen geven, weet ik pas na een paar uur zon: ik ken hun vermogen nog niet.');
  }
  if (vandaagNog !== null && vandaagNog >= 0.05) zinnen.push(`Vandaag nog zo'n ${kwhKort(vandaagNog)} zon.`);

  toelichting.push(zekerheidZin(geleerd));
  if (terug) toelichting.push(terug.zin);
  if (vraagVermogen.length) {
    toelichting.push(
      geleerd.zonderVermogen
        ? `Vul bij Instellingen › Namen het maximale vermogen van ${opsomming(vraagVermogen)} in (in watt piek, op het typeplaatje of de factuur): dan klopt dit vanaf de eerste dag, zonder dat ik eerst hoef te leren.`
        : `Van ${opsomming(vraagVermogen)} ken ik het maximale vermogen niet: ik reken met het gemiddelde van de andere plekken. Vul het in bij Instellingen › Namen.`,
    );
  }
  if (basis.weerOud && weer?.opgehaald) toelichting.push(`Het weerbericht is van ${klok(weer.opgehaald)}; het programmaatje haalt het elk uur.`);
  if (geldEnBatterij?.prijsToelichting) toelichting.push(geldEnBatterij.prijsToelichting);

  const zekerheid = geleerd.factor === null ? 'laag' : geleerd.dagen >= GOED_NA_DAGEN ? 'goed' : geleerd.dagen >= 2 ? 'redelijk' : 'laag';
  return {
    ...basis,
    geleerd,
    band,
    zekerheid,
    uren,
    morgenUren,
    zon,
    vandaagNog,
    batterij: geldEnBatterij?.batterij ?? null,
    geld: geldEnBatterij?.geld ?? null,
    gisteren: terug,
    zinnen,
    toelichting,
  };
}

/** Morgen: de kWh, per plek, de bandbreedte en het piekmoment (twee uur achter elkaar met de meeste zon). */
function zonVan(morgenUren, geleerd, band) {
  const kwh = som(morgenUren.map((u) => u.zonW ?? 0)) / 1000;
  const perBron = geleerd.bronnen.map((b) => ({
    sleutel: b.sleutel,
    naam: b.naam,
    kwh: som(morgenUren.map((u) => u.perBron?.[b.sleutel] ?? 0)) / 1000,
    piekW: Math.max(0, ...morgenUren.map((u) => u.perBron?.[b.sleutel] ?? 0)),
    geschat: b.geschat,
    perPlek: b.perPlek,
  }));
  let piek = null;
  for (let k = 0; k + 1 < morgenUren.length; k++) {
    const w = ((morgenUren[k].zonW ?? 0) + (morgenUren[k + 1].zonW ?? 0)) / 2;
    if (w >= 100 && (!piek || w > piek.gem)) piek = { gem: w, k };
  }
  return {
    kwh,
    laag: kwh * (1 - band),
    hoog: kwh * (1 + band),
    perBron,
    piek: piek
      ? { tijd: `tussen ${klok(morgenUren[piek.k].begin)} en ${klok(morgenUren[piek.k + 1].begin + UUR_MS)}`, w: Math.max(morgenUren[piek.k].zonW, morgenUren[piek.k + 1].zonW) }
      : null,
  };
}

/** "vandaag rond 15:00", "morgen rond 14:00" of "rond middernacht" (t: het eind van een uur). */
function wanneerTekst(t, van) {
  if (uurVan(t) === 0) return 'rond middernacht';
  return `${datumVan(t) === datumVan(van) ? 'vandaag' : 'morgen'} rond ${klok(t)}`;
}

/**
 * Van het uur van nu tot het eind van morgen doorgerekend (rekenDoor: eigen
 * gebruik, zon over eerst in de batterij): wanneer de batterij vol is, wat er
 * naar het net gaat, en met de prijzen wat het kost en wat de zon scheelt.
 */
function doorrekenen({ uren, stand, dagen, nu, batterij, morgen }) {
  const huis = leerHuis({ dagen, dag: stand.dag, nu });
  const prijzen = prijzenPerUur(stand.voorspelling, uren[0].begin, uren.length);
  const rij = uren.map((u, k) => ({ begin: u.begin, uur: u.uur, deel: u.deel, huisW: huis.huisW[u.uur], zonW: u.zonW ?? 0, prijs: prijzen[k] }));
  const met = rekenDoor({ uren: rij, batterij });
  const opMorgen = (k) => uren[k].datum === morgen;
  // Wat de zon van morgen scheelt: alleen morgen zonder zon, vandaag gelijk (dan begint de batterij om middernacht in beide gelijk).
  const zonder = rekenDoor({ uren: rij.map((u, k) => (opMorgen(k) ? { ...u, zonW: 0 } : u)), batterij });
  const ks = uren.map((_, k) => k).filter(opMorgen);

  let batterijUit = null;
  let batterijZin = null;
  if (batterij) {
    const isVol = (k) => met.stappen[k].kwh >= batterij.max - 0.05;
    const vol = ks.find(isVol);
    // De eerste keer vol van nu tot het eind van morgen (voor het batterijblad: dezelfde verwachting als hier).
    const eersteVol = uren.findIndex((_, k) => isVol(k));
    const procenten = ks.map((k) => Math.round((met.stappen[k].kwh / batterij.inhoud) * 100));
    const beginMorgen = ks[0] > 0 ? Math.round((met.stappen[ks[0] - 1].kwh / batterij.inhoud) * 100) : Math.round(batterij.procent);
    // De stand om middernacht telt mee: "hooguit" is nooit minder dan waarmee hij morgen begint (R19-RK-05).
    const hoogste = Math.max(beginMorgen, ...procenten);
    const naarNet = som(ks.map((k) => Math.max(0, -met.stappen[k].netW) / 1000));
    batterijUit = {
      vol: vol === undefined ? null : uren[vol].begin + UUR_MS,
      eersteVol: eersteVol === -1 ? null : uren[eersteVol].begin + UUR_MS,
      eersteVolTekst: eersteVol === -1 ? null : wanneerTekst(uren[eersteVol].begin + UUR_MS, uren[0].begin),
      alVol: batterij.kwh >= batterij.max - 0.05,
      hoogste,
      beginMorgen,
      naarNetKwh: naarNet,
      laadtNiet: batterij.laadtNiet,
    };
    if (batterij.laadtNiet) batterijZin = 'De batterij is onder 0 °C: dan laadt hij niet met de zon, hij verwarmt zich eerst.';
    else if (vol !== undefined) {
      const daarna = naarNet >= 0.1 ? `; daarna gaat zo'n ${kwhKort(naarNet)} naar het net` : '';
      batterijZin = `De batterij is morgen rond ${klok(uren[vol].begin + UUR_MS)} vol (om middernacht zo'n ${beginMorgen}%)${daarna}.`;
    } else if (hoogste <= beginMorgen) {
      batterijZin = `De batterij laadt morgen nauwelijks bij: om middernacht zo'n ${beginMorgen}%, daarna minder.`;
    } else {
      batterijZin = `De batterij komt morgen niet vol: hooguit zo'n ${hoogste}% (om middernacht zo'n ${beginMorgen}%).`;
    }
  }

  // Het geld van morgen: per uur wat van of naar het net gaat, maal de prijs van dat uur.
  const bekend = prijzen.filter(Boolean);
  let geld = null;
  let geldZin = null;
  let prijsToelichting = null;
  if (bekend.length) {
    const gemAfname = som(bekend.map((p) => p.afname)) / bekend.length;
    const gemTerug = som(bekend.map((p) => p.terug)) / bekend.length;
    const kost = (stappen) =>
      som(
        ks.map((k) => {
          const net = (stappen[k].netW * uren[k].deel) / 1000;
          const p = prijzen[k];
          return net > 0 ? net * (p?.afname ?? gemAfname) : net * (p?.terug ?? gemTerug);
        }),
      );
    const kosten = kost(met.stappen);
    const scheelt = kost(zonder.stappen) - kosten;
    const metPrijzen = ks.every((k) => prijzen[k]);
    geld = { kosten, scheelt, metPrijzen };
    const saldo = kosten >= 0 ? `betaal je per saldo zo'n ${euro(kosten)} voor stroom uit het net` : `krijg je per saldo zo'n ${euro(-kosten)} terug`;
    geldZin = `${metPrijzen ? 'Met de prijzen van morgen' : 'Met de prijzen van vandaag'} scheelt de zon zo'n ${euro(scheelt)}; dan ${saldo}.`;
    if (!metPrijzen) prijsToelichting = 'De prijzen van morgen komen rond 13:00 (Zonneplan); tot dan reken ik met het gemiddelde van de prijzen die er zijn.';
  } else {
    prijsToelichting = 'Nog geen stroomprijzen: zonder kan ik niet zeggen wat de zon morgen scheelt.';
  }
  return { batterij: batterijUit, batterijZin, geld, geldZin, prijsToelichting };
}

/** "Geleerd van 3 dagen en vandaag tot nu." of hoe de schatting nu gemaakt is. */
function zekerheidZin(geleerd) {
  const vermogens = geleerd.bronnen.filter((b) => b.maxW).map((b) => vermogen(b.maxW));
  const dagen = geleerd.dagen;
  const vandaag = geleerd.vandaagTelt ? (dagen ? ' en vandaag tot nu' : 'vandaag tot nu') : '';
  if (geleerd.factor === null) return 'Nog niets geleerd: er is nog geen uur met zon en een weerbericht bewaard.';
  if (!dagen && !geleerd.vandaagTelt) {
    return `Nog niets geleerd: een natuurkundige schatting uit het vermogen van je panelen (${opsomming(vermogens)}), de straling uit het weerbericht en de stand van de zon. Elke zonnige dag maakt het beter.`;
  }
  const hoeveel = dagen ? `${dagen} ${dagen === 1 ? 'dag' : 'dagen'}` : '';
  const perPlek = geleerd.bronnen.some((b) => b.perPlek) && geleerd.bronnen.length > 1 ? ', per plek' : '';
  const start = geleerd.zonderVermogen ? '' : ', met de natuurkunde als start';
  const stevig = dagen >= GOED_NA_DAGEN ? '' : ' Na een week met zon is het stevig.';
  return `Geleerd van ${hoeveel}${vandaag}${perPlek}${start}.${stevig}`;
}

/** Wat de dagen vóór `datum` voorspellen voor `datum`, met de straling die het weerbericht die dag gaf (kWh). */
function terugblik({ dagen, bronnen, plaats, nu, vandaag, datum }) {
  const dagRij = dagen.find((d) => d.datum === datum);
  if (!dagRij?.uren?.stralingWh) return null;
  const eerder = leerZon({ dagen, dag: null, weer: null, bronnen, plaats, vandaag, nu, tot: datum });
  if (eerder.factor === null) return null;
  const begins = urenVanDatum(datum);
  const wh = begins.map((t, h) => (t === null ? 0 : (eerder.perUur(t, dagRij.uren.stralingWh[h])?.w ?? 0)));
  return som(wh) / 1000;
}

/**
 * Hoe kwam de voorspelling van gisteren uit? Met wat dit toestel eergisteren
 * bewaarde ('bewaard'), anders een terugblik. Null zonder een hele dag gisteren.
 */
function gisterenUitgekomen({ dagen, bewaard, gisteren, bronnen, plaats, nu, vandaag }) {
  const dagRij = dagen.find((d) => d.datum === gisteren);
  const gemeten = getal(dagRij?.zon) ?? (dagRij?.uren?.zonWh ? som(dagRij.uren.zonWh) / 1000 : null);
  if (gemeten === null || !((dagRij.kwartieren ?? 0) >= 80)) return null;
  const opgeslagen = getal(bewaard?.[gisteren]);
  const soort = opgeslagen !== null ? 'bewaard' : 'terugblik';
  const voorspeld = opgeslagen ?? terugblik({ dagen, bronnen, plaats, nu, vandaag, datum: gisteren });
  if (voorspeld === null || (voorspeld < 0.05 && gemeten < 0.05)) return null;
  const verschil = voorspeld > 0 ? gemeten / voorspeld - 1 : null;
  const hoe =
    verschil === null
      ? ''
      : Math.abs(verschil) < 0.05
        ? ': vrijwel precies'
        : ` (${Math.round(Math.abs(verschil) * 100)}% ${verschil > 0 ? 'meer' : 'minder'})`;
  const zin =
    soort === 'bewaard'
      ? `Gisteren voorspelde ik ${kwhKort(voorspeld)} zon; het werd ${kwhKort(gemeten)}${hoe}.`
      : `Terugblik op gisteren: met het weer van gisteren had ik ${kwhKort(voorspeld)} gezegd; het werd ${kwhKort(gemeten)}${hoe}.`;
  return { datum: gisteren, voorspeld, gemeten, soort, zin };
}

/** Zoveel dagen bewaart dit toestel de voorspelling van morgen (voor "hoe kwam gisteren uit"). */
const BEWAARD_DAGEN = 4;

/**
 * De voorspelde kWh van `datum` erbij in wat dit toestel bewaart, per huis:
 * { [huisId]: { [datum]: kWh } }, per huis hooguit BEWAARD_DAGEN datums (de
 * nieuwste). Geeft een nieuw voorwerp; het oude blijft zoals het was.
 */
export function metBewaard(oud, huisId, datum, kwh) {
  const alles = oud && typeof oud === 'object' && !Array.isArray(oud) ? oud : {};
  const vanHuis = alles[huisId] && typeof alles[huisId] === 'object' ? alles[huisId] : {};
  const rond = Math.round(kwh * 100) / 100;
  if (vanHuis[datum] === rond) return alles;
  const datums = Object.entries({ ...vanHuis, [datum]: rond })
    .filter(([d, v]) => /^\d{4}-\d{2}-\d{2}$/.test(d) && getal(v) !== null)
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .slice(0, BEWAARD_DAGEN);
  return { ...alles, [huisId]: Object.fromEntries(datums) };
}
