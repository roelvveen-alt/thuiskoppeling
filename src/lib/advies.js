/**
 * Advies op het tabblad Huis: wanneer je het best stroom gebruikt (de
 * wasmachine, de vaatwasser) en wanneer juist zo min mogelijk. Alleen raad:
 * de app bedient niets.
 *
 * Alles hier is rekenen, zonder Base44. De cijfers komen uit wat de site al
 * heeft: de stand (batterij, prijzen per kwartier, vandaag per kwartier) en de
 * dagen van 'periode' (per uur van de klok wat het huis gebruikte en de zon
 * leverde, sinds november 2026; zie urenVan in
 * base44/functions/ontvangMeting/dagboek.js).
 *
 * Hoe het leert, per huis, en uitlegbaar:
 * - Het huis: per uur van de klok het gemiddelde van de dagen die er zijn,
 *   met één "gewone dag" (STANDAARD_HUIS, op de maat van dit huis) erbij als
 *   voorzichtige start. Hoe meer dagen, hoe minder die gewone dag telt.
 * - De zon: per uur het gemiddelde van de laatste ZON_DAGEN dagen. Levert
 *   vandaag tot nu toe duidelijk meer of minder dan gewoonlijk, dan rekent de
 *   rest van vandaag daarmee.
 * - De zon met het weer: dezelfde verwachting per uur als het tabblad
 *   Voorspelling (maakMorgen in src/lib/morgen.js, natuurkunde met de stand van
 *   de zon en het dak, geleerd per huis; via useVerwachting in
 *   src/lib/verwachting.js). Eén bron, zodat Huis en Voorspelling nooit iets
 *   anders zeggen (R19-RK-01). Alleen als die er niet is, de terugval hieronder.
 * - Terugval met het weer (brug 0.9.0, stand.weer van Open-Meteo): per uur de zonnestraling.
 *   Per huis leert de app wat de panelen bij zoveel licht leveren (zon-Wh per
 *   uur ÷ straling-Wh/m² van dat uur, uit Dag zon_uur_wh en
 *   straling_uur_wh_m2 en de uren van vandaag: leerVerhouding). Dan is de zon
 *   per uur die verhouding maal de straling, met een voorzichtige start: zolang
 *   er weinig licht geleerd is, telt het gemiddelde van de laatste dagen naar
 *   rato mee (weerGewicht). Zonder weerbericht: zoals hierboven.
 * - De batterij: hoe vol hij nu is, wat erin kan (batterij_info) en tot waar
 *   hij laadt en ontlaadt, met het verlies bij de temperatuur van de koudste
 *   accu (verliesBijTemperatuur). Per huis kiest de eigenaar zijn rol
 *   (Opstelling.batterij_rol): eigen gebruik (rekenDoor, zoals een Zendure
 *   "nul op de meter": zon over eerst in de batterij, tekort eerst eruit, nooit
 *   uit of naar het net) of handelen (rekenHandel: het goedkoopste plan met
 *   laden uit en leveren aan het net). Handelen is alleen een advies als het
 *   na verlies minstens HANDEL_DREMPEL_EUR oplevert, met het bedrag erbij.
 *
 * Het advies: voor elk uur van de komende 24 wat één kWh extra (een
 * wasmachine) in totaal kost, met de batterij erbij: zon die anders naar het
 * net ging kost alleen de teruglevering die je misloopt, stroom uit de
 * batterij mist je later, stroom uit het net kost de prijs van dat uur.
 * Zonder prijzen telt hoeveel er extra uit het net komt. Op de kaart staat
 * daarvan alleen het eenvoudige: goed moment, liever niet, het weer, en per
 * uur goed, gewoon of liever niet (src/components/Advies.jsx); de batterij
 * rekent mee maar komt niet in de zinnen ("vergeet de batterij, dat
 * gaat vanzelf").
 */

import { wolkenUit } from './weerVerwachting';

const UUR_MS = 3_600_000;
export const UREN = 24;
/** Zo lang draaien de wasmachine en de vaatwasser ongeveer: het blok van het advies. */
export const BLOK_UREN = 3;
/** Zoveel dagen terug kijkt de zon: het weer van nu lijkt meer op dat van vorige week dan van vorige maand. */
export const ZON_DAGEN = 7;
/** Zoveel dagen terug kijkt het huis (en zoveel vraagt de site op bij 'periode'). */
export const HUIS_DAGEN = 14;
/** Na zoveel dagen is het gewone verbruik per uur goed te zeggen. */
export const GOED_NA_DAGEN = 7;
/** Een Zendure SolarFlow 2400 AC laadt en levert hooguit zoveel. */
export const BATTERIJ_MAX_W = 2400;
/** Handelen is pas een advies als het na het verlies zoveel oplevert over de komende 24 uur. */
export const HANDEL_DREMPEL_EUR = 0.1;
/** Zonder inhoud uit de batterij: zoveel kWh per accu (Zendure AB3000), anders zoveel in totaal. */
const ACCU_KWH = 2.88;
const BATTERIJ_KWH_ONBEKEND = 5;
/** Een huis zonder geschiedenis en zonder dagtotalen: zoveel kWh per dag (een gewoon huishouden). */
const HUIS_KWH_ONBEKEND = 8;

/**
 * Een gewone dag in een Nederlands huis, per uur van de klok (aandeel van de
 * dag, ruwweg het profiel van een huishouden in het najaar): 's nachts weinig,
 * een bult in de ochtend, het meest rond het avondeten.
 */
const STANDAARD_RUW = [30, 26, 24, 23, 23, 25, 33, 45, 47, 42, 40, 41, 42, 40, 39, 40, 45, 56, 63, 62, 58, 54, 48, 39];
const STANDAARD_SOM = STANDAARD_RUW.reduce((a, b) => a + b, 0);
export const STANDAARD_HUIS = STANDAARD_RUW.map((v) => v / STANDAARD_SOM);

/** Na zoveel geleerd licht (Wh/m², over de uren die tellen; een herfstdag ~1.000–2.000) telt het weerbericht helemaal. */
export const STRALING_GOED_WH_M2 = 2500;
/** Een uur met minder licht dan dit (Wh/m²) zegt te weinig over de panelen. */
const STRALING_UUR_MIN = 50;
/** Onder zoveel geleerd licht (Wh/m²) is er nog geen verhouding. */
const STRALING_MIN_WH_M2 = 200;
/** Tot zoveel procent bewolking heet het zonnig, boven zoveel bewolkt (brug/weer.mjs zegt hetzelfde in proef; de band van morgen.js ook). */
export const ZONNIG_TOT_PCT = 35;
export const BEWOLKT_VANAF_PCT = 70;

const uurNotatie = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', hour: '2-digit', hourCycle: 'h23' });
const datumNotatie = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Het uur van de klok in Nederland (0 tot 23). */
export const uurVan = (ms) => Number(uurNotatie.format(new Date(ms))) % 24;
const datumVan = (ms) => datumNotatie.format(new Date(ms));
/** De datum na "2026-10-30", op de datumtekst (een dag is niet altijd 24 uur). */
const dagNa = (datum) => {
  const [j, m, d] = datum.split('-').map(Number);
  return new Date(Date.UTC(j, m - 1, d + 1)).toISOString().slice(0, 10);
};
/** "13:00" voor het begin van een uur. */
export const klok = (ms) => `${String(uurVan(ms)).padStart(2, '0')}:00`;

const getal = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const som = (lijst) => lijst.reduce((a, b) => a + b, 0);
const gemiddelde = (lijst) => (lijst.length ? som(lijst) / lijst.length : null);
const tussen = (v, min, max) => Math.min(max, Math.max(min, v));

/**
 * Per uur van de klok het gemiddelde vermogen (W) uit één dag: { huis, zon }
 * per uur, null als er dat uur minder dan een half uur gemeten is.
 */
function urenVanDag(uren) {
  return Array.from({ length: UREN }, (_, h) => {
    const kw = uren.kwartieren[h];
    if (!(kw >= 2)) return null;
    const uurDeel = kw / 4;
    return { huis: uren.huisWh[h] / uurDeel, zon: uren.zonWh ? uren.zonWh[h] / uurDeel : null };
  });
}

/** Vandaag per uur uit de dag per kwartier (stand.dag), alleen uren die al voorbij zijn. */
function urenVanVandaag(dag, nu) {
  if (!dag?.metingen) return null;
  const huisWh = Array(UREN).fill(0);
  const zonWh = Array(UREN).fill(0);
  const kwartieren = Array(UREN).fill(0);
  let metZon = false;
  for (let i = 0; i < dag.metingen.length; i++) {
    const begin = dag.van + i * dag.stapMs;
    // Alleen hele uren die voorbij zijn: een half uur van nu zegt nog niets.
    const uurEinde = Math.floor(begin / UUR_MS) * UUR_MS + UUR_MS;
    if (!(dag.metingen[i] > 0) || uurEinde > nu || dag.huis?.[i] == null) continue;
    const h = uurVan(begin);
    huisWh[h] += Math.max(0, dag.huis[i]) / 4;
    if (dag.zon?.[i] != null) {
      zonWh[h] += Math.max(0, dag.zon[i]) / 4;
      metZon = true;
    }
    kwartieren[h] += 1;
  }
  return kwartieren.some((k) => k > 0) ? { huisWh, zonWh: metZon ? zonWh : null, kwartieren } : null;
}

/**
 * Wat de app van dit huis geleerd heeft.
 *
 * @param {{ dagen?: Array, dag?: object|null, nu: number, vandaag?: string }} opties
 *   dagen: uit dagenUit (src/lib/periode.js), met `uren`; dag: stand.dag (vandaag per kwartier)
 * @returns {{ huisW: number[], zonW: number[], dagen: number, zonDagen: number, vandaagTelt: boolean,
 *   zonVandaag: number|null, metPanelen: boolean, huisKwhDag: number }}
 *   huisW en zonW: per uur van de klok (0 tot 23) het verwachte vermogen.
 *   zonVandaag: vandaag tot nu toe tegenover gewoonlijk (1 = net zoveel), of null als dat nog niets zegt.
 */
export function leerHuis({ dagen = [], dag = null, nu, vandaag = datumVan(nu), weer = null }) {
  const eerder = dagen.filter((d) => d?.datum && d.datum < vandaag).sort((a, b) => (a.datum < b.datum ? 1 : -1));
  const metUren = eerder.filter((d) => d.uren).slice(0, HUIS_DAGEN);
  const perDag = metUren.map((d) => urenVanDag(d.uren));
  const vanVandaag = urenVanVandaag(dag, nu);
  const vandaagUren = vanVandaag ? urenVanDag(vanVandaag) : null;

  // De maat van een gewone dag: de dagtotalen die er zijn (ook van voor de uren), anders vandaag, anders een gewoon huis.
  const totalen = eerder.filter((d) => getal(d.huis) !== null && (d.kwartieren ?? 96) >= 80).map((d) => d.huis);
  const huisKwhDag = gemiddelde(totalen) ?? HUIS_KWH_ONBEKEND;

  const huisW = Array.from({ length: UREN }, (_, h) => {
    const monsters = [...perDag, ...(vandaagUren ? [vandaagUren] : [])].map((d) => d[h]?.huis).filter((v) => getal(v) !== null);
    // Eén gewone dag erbij: met weinig dagen voorzichtig, met veel dagen telt hij bijna niet meer.
    const standaard = STANDAARD_HUIS[h] * huisKwhDag * 1000;
    return (som(monsters) + standaard) / (monsters.length + 1);
  });

  const zonPerDag = perDag.slice(0, ZON_DAGEN).filter((d) => d.some((u) => u?.zon != null));
  const zonW = Array.from({ length: UREN }, (_, h) => {
    const monsters = zonPerDag.map((d) => d[h]?.zon).filter((v) => getal(v) !== null);
    return monsters.length ? gemiddelde(monsters) : 0;
  });
  const zonDagen = zonPerDag.length;

  // Vandaag tot nu toe tegenover gewoonlijk, over de uren die al voorbij zijn en waarin gewoonlijk zon is.
  let zonVandaag = null;
  if (zonDagen && vandaagUren) {
    let gewoon = 0;
    let echt = 0;
    vandaagUren.forEach((u, h) => {
      if (u?.zon == null || zonW[h] < 50) return;
      gewoon += zonW[h];
      echt += u.zon;
    });
    if (gewoon >= 300) zonVandaag = tussen(echt / gewoon, 0.2, 2);
  }

  const metPanelen = zonDagen > 0 || Boolean(vanVandaag?.zonWh?.some((v) => v > 0));
  // Wat de panelen bij zoveel licht leveren: de dagen met straling, en vandaag tot nu met het weerbericht.
  const vandaagMetLicht = vanVandaag && weer ? { ...vanVandaag, stralingWh: stralingVandaag(weer, vandaag, nu) } : null;
  const licht = leerVerhouding([...metUren.map((d) => d.uren), ...(vandaagMetLicht ? [vandaagMetLicht] : [])]);
  return {
    huisW,
    zonW,
    dagen: metUren.length,
    zonDagen,
    vandaagTelt: Boolean(vandaagUren?.some(Boolean)),
    zonVandaag,
    metPanelen,
    huisKwhDag,
    verhouding: licht.verhouding,
    weerGewicht: licht.gewicht,
  };
}

/**
 * Per uur van de klok de straling van vandaag tot nu uit het weerbericht
 * (Wh/m²), alleen hele uren die voorbij zijn (zoals urenVanVandaag).
 */
function stralingVandaag(weer, vandaag, nu) {
  if (!weer?.straling) return null;
  const som = Array(UREN).fill(0);
  weer.straling.forEach((w, i) => {
    const t = weer.van + i * weer.stapMs;
    if (datumVan(t) !== vandaag || t + weer.stapMs > nu) return;
    som[uurVan(t)] += w;
  });
  return som;
}

/**
 * Wat de panelen van dit huis leveren bij zoveel licht: zon-Wh per uur ÷
 * straling-Wh/m² van dat uur, over de hele uren met genoeg licht (zon_uur_wh
 * en straling_uur_wh_m2 in Dag). { verhouding (Wh per Wh/m², of null),
 * gewicht (0 tot 1: hoeveel het weerbericht meetelt, naar het geleerde licht) }.
 */
export function leerVerhouding(uren) {
  let zon = 0;
  let licht = 0;
  for (const u of uren) {
    if (!u?.zonWh || !u.stralingWh) continue;
    for (let h = 0; h < UREN; h++) {
      if (!(u.kwartieren[h] >= 4) || !(u.stralingWh[h] >= STRALING_UUR_MIN)) continue;
      zon += Math.max(0, u.zonWh[h]);
      licht += u.stralingWh[h];
    }
  }
  if (licht < STRALING_MIN_WH_M2) return { verhouding: null, gewicht: 0 };
  return { verhouding: zon / licht, gewicht: Math.min(1, licht / STRALING_GOED_WH_M2) };
}

/**
 * Het weerbericht voor Advies, of null als het er niet is:
 * { op(t) → { straling, bewolking, temp } voor het uur waarin t valt (of null), van, tot }.
 * Zelfde regel als Voorspelling (berichtVan in morgen.js): elk uur dat het
 * bericht dekt, telt, hoe oud het ook is (het programmaatje stuurt een bericht
 * hooguit 3 uur mee, brug/weer.mjs).
 */
export function weerVoorAdvies(weer) {
  if (!weer || !Number.isFinite(weer.van)) return null;
  const lengte = (weer.straling ?? weer.bewolking ?? []).length;
  if (!lengte) return null;
  const tot = weer.van + lengte * weer.stapMs;
  const op = (t) => {
    const i = Math.floor((t - weer.van) / weer.stapMs);
    if (i < 0 || i >= lengte) return null;
    return { straling: weer.straling?.[i] ?? null, bewolking: weer.bewolking?.[i] ?? null, temp: weer.temp?.[i] ?? null };
  };
  return { op, van: weer.van, tot, straling: Boolean(weer.straling), bewolking: Boolean(weer.bewolking) };
}

/**
 * De zon in het uur dat begint op t (W): met het weerbericht de geleerde
 * verhouding maal de straling, naar rato van weerGewicht gemengd met het
 * gewone (het gemiddelde van de laatste dagen); anders het gewone.
 */
function zonVoorUur(geleerd, bericht, t, gewoon) {
  const straling = bericht?.op(t)?.straling;
  if (straling === null || straling === undefined || geleerd.verhouding === null) return gewoon;
  return geleerd.weerGewicht * geleerd.verhouding * straling + (1 - geleerd.weerGewicht) * gewoon;
}

/** Per uur vanaf `begin` de gemiddelde prijs (afname en teruglevering) uit de kwartieren; null zonder prijs. */
export function prijzenPerUur(voorspelling, begin, aantal = UREN) {
  return Array.from({ length: aantal }, (_, k) => {
    const van = begin + k * UUR_MS;
    if (!Array.isArray(voorspelling?.afname) || !Array.isArray(voorspelling.terug)) return null;
    const afname = [];
    const terug = [];
    voorspelling.afname.forEach((a, i) => {
      const t = voorspelling.van + i * voorspelling.stapMs;
      if (t < van || t >= van + UUR_MS) return;
      if (getal(a) !== null) afname.push(a);
      if (getal(voorspelling.terug[i]) !== null) terug.push(voorspelling.terug[i]);
    });
    return afname.length ? { afname: gemiddelde(afname), terug: terug.length ? gemiddelde(terug) : gemiddelde(afname) } : null;
  });
}

/**
 * Zoveel gaat er verloren bij laden en weer leveren samen (heen en terug, 0
 * tot 1), bij deze temperatuur van de accu's (°C).
 *
 * 10 tot 40 °C: ervaring met een Zendure in de praktijk (leidend). Rond 25–30 °C
 * ongeveer 6%; boven 30 °C naar rato oplopend tot 10% bij 40 °C (en niet
 * hoger daarboven, dan schakelt hij af); van 25 naar 10 °C komen er zo'n
 * 5 procentpunten bij (11% bij 10 °C).
 *
 * Onder 10 °C (LFP, zoals in de AB3000X) wordt het snel slechter; bronnen:
 * - EVS24 (Brussel 2009), "Low temperature performance of LiFePO4 50 Ah
 *   cells": energierendement 66% bij −20 °C, beter naarmate het warmer is
 *   (https://citelec.vub.ac.be/EVS24/files/proceedings/EVS-24-4020339.pdf).
 * - Politecnico di Torino, LFP-module: capaciteit 15% lager bij −10 °C en
 *   35% bij −20 °C (https://iris.polito.it/retrieve/handle/11583/3005569/949890).
 * - Zendure AB3000X: laden 0 tot 55 °C (sommige bladen 50 °C), leveren −20
 *   tot 60 °C, onder 0 °C verwarmt hij zichzelf eerst (dat kost ook stroom)
 *   (https://manuals.plus/zendure/ab3000x-add-on-battery-manual).
 * Daaruit: van 11% bij 10 °C rechtlijnig naar 19% bij 0 °C en 34% bij
 * −20 °C (het verlies van 66% rendement), en niet verder dan dat.
 * Zonder temperatuur: null (zie VERLIES_ZONDER_TEMPERATUUR).
 */
export function verliesBijTemperatuur(temp) {
  if (typeof temp !== 'number' || !Number.isFinite(temp)) return null;
  const lijn = (t, [t1, v1], [t2, v2]) => v1 + ((t - t1) / (t2 - t1)) * (v2 - v1);
  if (temp >= 40) return 0.1;
  if (temp > 30) return lijn(temp, [30, 0.06], [40, 0.1]);
  if (temp >= 25) return 0.06;
  if (temp >= 10) return lijn(temp, [25, 0.06], [10, 0.11]);
  if (temp >= 0) return lijn(temp, [10, 0.11], [0, 0.19]);
  if (temp >= -20) return lijn(temp, [0, 0.19], [-20, 0.34]);
  return 0.34;
}

/** Zonder temperatuur van de accu's: een vaste schatting, ergens in het midden (zo'n 15–20 °C binnen). */
export const VERLIES_ZONDER_TEMPERATUUR = 0.08;

/**
 * Welk deel van de inhoud bruikbaar is bij deze temperatuur (0 tot 1): vanaf
 * 10 °C alles, bij −10 °C 85% en bij −20 °C 65% (Politecnico di Torino,
 * zie verliesBijTemperatuur), daartussen rechtlijnig, en niet minder dan 65%.
 * Zonder temperatuur: alles.
 */
export function capaciteitBijTemperatuur(temp) {
  if (typeof temp !== 'number' || !Number.isFinite(temp) || temp >= 10) return 1;
  if (temp >= -10) return 0.85 + ((temp + 10) / 20) * 0.15;
  if (temp >= -20) return 0.65 + ((temp + 20) / 10) * 0.2;
  return 0.65;
}

/** De koudste accu (batterij_info.accus[].temp_c), anders temp_min_c, anders temp_c; null zonder temperatuur. */
export function koudsteAccu(info) {
  const perAccu = (Array.isArray(info?.accus) ? info.accus : []).map((a) => getal(a?.temp_c)).filter((t) => t !== null);
  if (perAccu.length) return Math.min(...perAccu);
  return getal(info?.temp_min_c) ?? getal(info?.temp_c);
}

/**
 * Het verwachte rendement nu, heen en terug: { rendement (0 tot 1), temp
 * (de koudste accu, of null), geschat (zonder temperatuur), laadtNiet (onder
 * 0 °C laadt een LFP-accu niet; de Zendure verwarmt zich eerst) }.
 */
export function rendementNu(info) {
  const temp = koudsteAccu(info);
  const verlies = verliesBijTemperatuur(temp) ?? VERLIES_ZONDER_TEMPERATUUR;
  return { rendement: 1 - verlies, temp, geschat: temp === null, laadtNiet: temp !== null && temp < 0 };
}

/**
 * De batterij voor het advies, of null zonder batterij. kWh: wat erin zit;
 * min en max: de ontlaadgrens en de laadgrens; geschat: de inhoud is niet gemeld.
 */
export function batterijVoorAdvies(stand) {
  const procent = getal(stand?.batterij_procent);
  if (procent === null) return null;
  const info = stand?.batterij_info ?? {};
  const gemeld = getal(info.inhoud_kwh);
  const pakketten = getal(info.pakketten);
  const inhoud = gemeld && gemeld > 0 ? gemeld : pakketten && pakketten > 0 ? pakketten * ACCU_KWH : BATTERIJ_KWH_ONBEKEND;
  const minPct = tussen(getal(info.ontlaadgrens_pct) ?? 10, 0, 100);
  const maxPct = tussen(getal(info.laadgrens_pct) ?? 100, minPct, 100);
  const nu = rendementNu(info);
  const min = (minPct / 100) * inhoud;
  // Bij kou is niet alles bruikbaar: de bovenkant zakt.
  const max = min + ((maxPct - minPct) / 100) * inhoud * capaciteitBijTemperatuur(nu.temp);
  return {
    inhoud,
    kwh: (tussen(procent, 0, 100) / 100) * inhoud,
    min,
    max,
    procent,
    geschat: !(gemeld > 0),
    // Het verlies heen en terug, gelijk verdeeld over laden en leveren.
    heen: Math.sqrt(nu.rendement),
    rendement: nu.rendement,
    temp: nu.temp,
    laadtNiet: nu.laadtNiet,
  };
}

/**
 * De komende uren doorgerekend: per uur zon, huis (plus `extra`), wat de
 * batterij doet en wat er van of naar het net gaat, en wat dat kost.
 * Prijzen die ontbreken: het gemiddelde van de bekende. `deel`: hoeveel van
 * elk uur nog komt (het uur van nu is al half voorbij).
 */
export function rekenDoor({ uren, batterij, extra = null }) {
  const bekend = uren.filter((u) => u.prijs);
  const gemAfname = gemiddelde(bekend.map((u) => u.prijs.afname));
  const gemTerug = gemiddelde(bekend.map((u) => u.prijs.terug));
  const heen = batterij?.heen ?? Math.sqrt(1 - VERLIES_ZONDER_TEMPERATUUR);
  let kwh = batterij?.kwh ?? 0;
  let kosten = 0;
  let uitNet = 0;
  const stappen = uren.map((u, k) => {
    const huis = (u.huisW + (extra?.[k] ?? 0)) * u.deel;
    const zon = u.zonW * u.deel;
    const over = zon - huis;
    let batterijWh = 0;
    if (batterij && over > 0 && !batterij.laadtNiet) {
      const ruimte = Math.max(0, batterij.max - kwh) * 1000;
      batterijWh = -Math.min(over, BATTERIJ_MAX_W * u.deel, ruimte / heen);
      kwh += (-batterijWh * heen) / 1000;
    } else if (batterij && over < 0) {
      const voorraad = Math.max(0, kwh - batterij.min) * 1000;
      batterijWh = Math.min(-over, BATTERIJ_MAX_W * u.deel, voorraad * heen);
      kwh -= batterijWh / heen / 1000;
    }
    const netWh = huis - zon - batterijWh;
    const afname = u.prijs?.afname ?? gemAfname;
    const terug = u.prijs?.terug ?? gemTerug;
    if (netWh > 0) {
      uitNet += netWh / 1000;
      if (afname !== null) kosten += (netWh / 1000) * afname;
    } else if (terug !== null) kosten += (netWh / 1000) * terug;
    return { netW: u.deel > 0 ? netWh / u.deel : 0, batterijW: u.deel > 0 ? batterijWh / u.deel : 0, kwh };
  });
  // Wat er aan het eind nog in de batterij zit, scheelt later stroom uit het net.
  const rest = batterij ? Math.max(0, kwh - batterij.min) * heen : 0;
  return { stappen, kosten: kosten - rest * (gemAfname ?? 0), uitNet: uitNet - rest, metPrijs: gemAfname !== null };
}

/** Zoveel standen tussen de ontlaadgrens en de laadgrens rekent het handelsplan door. */
const HANDEL_STANDEN = 48;

/**
 * Handelen: het goedkoopste plan voor de batterij over de komende uren, met
 * de prijzen van afnemen en terugleveren (met Zonnebonus), het verlies bij
 * laden en leveren, de grenzen en hooguit BATTERIJ_MAX_W. Laden mag ook uit
 * het net, leveren ook aan het net. Gerekend van achter naar voren over
 * HANDEL_STANDEN standen van de batterij (dynamisch programmeren): voor elke
 * stand en elk uur wat het vanaf daar nog kost. Wat er aan het eind in zit,
 * telt zoals bij rekenDoor. Zelfde antwoord als rekenDoor; zonder prijzen of
 * zonder batterij: rekenDoor.
 */
export function rekenHandel({ uren, batterij, extra = null }) {
  const bekend = uren.filter((u) => u.prijs);
  if (!batterij || !bekend.length || !(batterij.max > batterij.min)) return rekenDoor({ uren, batterij, extra });
  const gemAfname = gemiddelde(bekend.map((u) => u.prijs.afname));
  const gemTerug = gemiddelde(bekend.map((u) => u.prijs.terug));
  const { heen } = batterij;
  const n = HANDEL_STANDEN;
  const stap = (batterij.max - batterij.min) / n;
  const stand = (i) => batterij.min + i * stap;
  const kostVanNet = (netWh, u) => (netWh > 0 ? (netWh / 1000) * (u.prijs?.afname ?? gemAfname) : (netWh / 1000) * (u.prijs?.terug ?? gemTerug));

  // Van achter naar voren: wat het vanaf uur k in stand i nog kost (en welke stand daarna).
  let verder = Array.from({ length: n + 1 }, (_, i) => -(stand(i) - batterij.min) * heen * gemAfname);
  const keuzes = [];
  for (let k = uren.length - 1; k >= 0; k--) {
    const u = uren[k];
    const over = (u.zonW - u.huisW - (extra?.[k] ?? 0)) * u.deel;
    const maxWh = BATTERIJ_MAX_W * u.deel;
    const omhoog = batterij.laadtNiet ? 0 : Math.floor((maxWh * heen) / 1000 / stap + 1e-9);
    const omlaag = Math.floor((maxWh / heen) / 1000 / stap + 1e-9);
    const nu = new Array(n + 1);
    const kies = new Array(n + 1);
    for (let i = 0; i <= n; i++) {
      let beste = Infinity;
      let naar = i;
      for (let j = Math.max(0, i - omlaag); j <= Math.min(n, i + omhoog); j++) {
        const d = (j - i) * stap * 1000;
        const batterijWh = d > 0 ? -d / heen : -d * heen;
        const kost = kostVanNet(-over - batterijWh, u) + verder[j];
        if (kost < beste - 1e-12) {
          beste = kost;
          naar = j;
        }
      }
      nu[i] = beste;
      kies[i] = naar;
    }
    keuzes[k] = kies;
    verder = nu;
  }

  // Vooruit: het plan vanaf de stand van nu (afgerond op de dichtstbijzijnde stand).
  let i = Math.round(tussen((batterij.kwh - batterij.min) / stap, 0, n));
  let kosten = 0;
  let uitNet = 0;
  const stappen = uren.map((u, k) => {
    const j = keuzes[k][i];
    const d = (j - i) * stap * 1000;
    const batterijWh = d > 0 ? -d / heen : -d * heen;
    const netWh = (u.huisW + (extra?.[k] ?? 0) - u.zonW) * u.deel - batterijWh;
    kosten += kostVanNet(netWh, u);
    if (netWh > 0) uitNet += netWh / 1000;
    i = j;
    return { netW: u.deel > 0 ? netWh / u.deel : 0, batterijW: u.deel > 0 ? batterijWh / u.deel : 0, kwh: stand(j) };
  });
  const rest = (stand(i) - batterij.min) * heen;
  return { stappen, kosten: kosten - rest * gemAfname, uitNet: uitNet - rest, metPrijs: true };
}

/** Kwantiel van een rij getallen (0 tot 1). */
function kwantiel(lijst, q) {
  const s = [...lijst].sort((a, b) => a - b);
  if (!s.length) return null;
  const p = (s.length - 1) * q;
  const o = Math.floor(p);
  return s[o] + (s[Math.min(s.length - 1, o + 1)] - s[o]) * (p - o);
}

/**
 * Het blok van `lengte` uren met de laagste (of hoogste) extra kosten, binnen
 * de uren waarvoor `mag(u)` geldt; null als er geen is. Blokken die bijna
 * even goed (of slecht) zijn (binnen `speling` per uur), kiezen we op de
 * prijs van dat moment: dan wint het goedkoopste (of duurste) blok, niet het
 * eerste.
 */
function blok(uren, { lengte, hoogste = false, mag, speling }) {
  const kandidaten = [];
  for (let s = 0; s + lengte <= uren.length; s++) {
    const stuk = uren.slice(s, s + lengte);
    if (!stuk.every(mag)) continue;
    kandidaten.push({ van: s, tot: s + lengte, totaal: som(stuk.map((u) => u.extraKost)), prijs: som(stuk.map((u) => u.prijs?.afname ?? 0)) });
  }
  if (!kandidaten.length) return null;
  const teken = hoogste ? -1 : 1;
  const uiterste = Math.min(...kandidaten.map((k) => teken * k.totaal));
  const bijna = kandidaten.filter((k) => teken * k.totaal <= uiterste + speling * lengte + 1e-9);
  return bijna.reduce((b, k) => (teken * k.prijs < teken * b.prijs - 1e-9 ? k : b));
}

/** "12:00–15:00", met "morgen" ervoor als het blok morgen begint (voor de tabel en de tests). */
function tijdVan(uren, b) {
  const van = uren[b.van].begin;
  const dag = datumVan(van) === datumVan(uren[0].begin) ? '' : 'morgen ';
  return `${dag}${klok(van)}–${klok(uren[b.tot - 1].begin + UUR_MS)}`;
}

/**
 * Het blok in gewone woorden, zoals je het zegt: "Nu tot 13 uur", "Vandaag
 * tussen 17 en 20 uur", "Morgen tussen 10 en 13 uur", "Vandaag van 21 uur tot
 * middernacht".
 */
export function momentTekst(uren, b) {
  const van = uren[b.van].begin;
  const totUur = uurVan(uren[b.tot - 1].begin + UUR_MS);
  const tot = totUur === 0 ? 'middernacht' : `${totUur} uur`;
  if (b.van === 0) return `Nu tot ${tot}`;
  const dag = datumVan(van) === datumVan(uren[0].begin) ? 'Vandaag' : 'Morgen';
  return totUur === 0 ? `${dag} van ${uurVan(van)} uur tot middernacht` : `${dag} tussen ${uurVan(van)} en ${tot}`;
}
const meerderheid = (stuk, f) => stuk.filter(f).length * 2 > stuk.length;

/**
 * Het advies voor de komende 24 uur, eenvoudig ("denk aan een oud
 * dametje dat simpel hulp nodig heeft"): hooguit drie korte regels (goed
 * moment, liever niet, het weer) en per uur goed, gewoon of liever niet. Geen
 * zinnen over de batterij: die doet zijn werk vanzelf. Wel rekent het advies
 * met de batterij (eigen gebruik, of handelen als de eigenaar dat bij
 * Instellingen › Namen koos en het genoeg oplevert).
 *
 * De zon per uur komt uit de verwachting van het tabblad Voorspelling
 * (`verwachting`: maakMorgen in src/lib/morgen.js, via useVerwachting in
 * src/lib/verwachting.js): één bron, zodat Huis en Voorspelling nooit iets
 * anders zeggen, en het beste moment het dak volgt (oost of west, R19-RK-01 en
 * -02). Alleen zonder (geen zonnebronnen, of nog niets geleerd) zoals vroeger:
 * de gewone zon van de laatste dagen, met het weerbericht naar rato.
 *
 * @param {{ stand: object|null, dagen?: Array, nu: number, rol?: 'eigen'|'handelen', verwachting?: object|null }} opties
 *   stand: zoals standUitRij (src/lib/bron.js), na vanNu; dagen: uit dagenUit, met uren;
 *   rol: wat de batterij doet (Opstelling.batterij_rol); verwachting: maakMorgen(...) of null
 * @returns {null | {
 *   uren: Array<{ begin: number, uur: number, morgen: boolean, zonW: number, huisW: number, netW: number, procent: number|null,
 *     prijs: { afname: number, terug: number }|null, extraKost: number, soort: 'gunstig'|'gewoon'|'duur', waarom: string[] }>,
 *   regels: Array<{ soort: 'goed'|'liever'|'gewoon'|'weer', kop: string, tekst: string, icoon?: string }>,
 *   zinnen: string[], toelichting: string[], leertNog: boolean, eenheid: 'euro'|'kwh', zekerheid: 'laag'|'redelijk'|'goed',
 *   zonBron: 'voorspelling'|'weer'|'dagen'|null, geleerd: ReturnType<typeof leerHuis>,
 *   beste: { tijd: string, tekst: string, eerste: number, laatste: number }|null,
 *   slechtste: { tijd: string, tekst: string, eerste: number, laatste: number }|null,
 *   rol: 'eigen'|'handelen', handelt: boolean, winst: number|null, batterij: ReturnType<typeof batterijVoorAdvies> }}
 *   soort per uur: met het blok van het goede moment altijd 'gunstig' en dat van liever niet 'duur'.
 */
export function maakAdvies({ stand, dagen = [], nu, rol = 'eigen', verwachting = null }) {
  if (!stand) return null;
  const bericht = weerVoorAdvies(stand.weer);
  const geleerd = leerHuis({ dagen, dag: stand.dag, nu, weer: bericht ? stand.weer : null });
  // Panelen: geleerd, of de meting meldt een zonnemeter (ook in huis B: een kWh-meter, geen omvormer).
  const panelen = geleerd.metPanelen || stand.zon_w != null || Boolean(stand.zonnen?.length);
  const batterij = batterijVoorAdvies(stand);
  // Beide rekenwijzen beginnen bij dezelfde bruikbare stand (R19-RK-03): onder de ontlaadgrens of boven de
  // koude bovengrens krijgt het handelsplan anders kWh cadeau (of mist het die).
  const rekenBatterij = batterij ? { ...batterij, kwh: tussen(batterij.kwh, batterij.min, batterij.max) } : null;
  const begin = Math.floor(nu / UUR_MS) * UUR_MS;
  const prijzen = prijzenPerUur(stand.voorspelling, begin);
  const vandaag = datumVan(nu);

  // De zon per uur van Voorspelling (één bron); per uur dat daar niets staat de oude schatting.
  const zonVanVoorspelling = new Map();
  for (const u of verwachting?.uren ?? []) if (getal(u.zonW) !== null) zonVanVoorspelling.set(u.begin, u.zonW);

  const basis = Array.from({ length: UREN }, (_, k) => {
    const t = begin + k * UUR_MS;
    const h = uurVan(t);
    const vandaagNog = datumVan(t) === vandaag;
    const zonFactor = vandaagNog && geleerd.zonVandaag !== null ? geleerd.zonVandaag : 1;
    return {
      begin: t,
      uur: h,
      deel: k === 0 ? tussen((t + UUR_MS - nu) / UUR_MS, 0, 1) : 1,
      huisW: geleerd.huisW[h],
      zonW: zonVanVoorspelling.get(t) ?? zonVoorUur(geleerd, bericht, t, geleerd.zonW[h] * zonFactor),
      prijs: prijzen[k],
    };
  });
  const metWeer = Boolean(bericht?.straling) && geleerd.verhouding !== null;
  const zonBron = !panelen ? null : zonVanVoorspelling.size ? 'voorspelling' : metWeer ? 'weer' : geleerd.zonDagen ? 'dagen' : null;

  const eigen = rekenDoor({ uren: basis, batterij: rekenBatterij });
  const eenheid = eigen.metPrijs ? 'euro' : 'kwh';
  // Handelen alleen met prijzen en een batterij, en alleen als het na verlies echt iets oplevert.
  const handel = rol === 'handelen' && batterij && eenheid === 'euro' ? rekenHandel({ uren: basis, batterij: rekenBatterij }) : null;
  const winst = handel ? eigen.kosten - handel.kosten : null;
  const handelt = Boolean(handel) && winst >= HANDEL_DREMPEL_EUR;
  const reken = handelt ? rekenHandel : rekenDoor;
  const gewoon = handelt ? handel : eigen;
  const kostVan = (r) => (eenheid === 'euro' ? r.kosten : r.uitNet);
  // Eén kWh extra in uur k (een uur lang 1.000 W, in het uur van nu naar rato): wat kost dat in totaal?
  const extraKosten = basis.map((u, k) => {
    if (!(u.deel > 0)) return 0;
    const extra = Array(UREN).fill(0);
    extra[k] = 1000;
    return (kostVan(reken({ uren: basis, batterij: rekenBatterij, extra })) - kostVan(gewoon)) / u.deel;
  });

  const afnamePrijzen = prijzen.filter(Boolean).map((p) => p.afname);
  const goedkoop = kwantiel(afnamePrijzen, 0.25);
  const duur = kwantiel(afnamePrijzen, 0.75);
  const midden = kwantiel(afnamePrijzen, 0.5);
  // Het goedkoopste uur, en het duurste zonder een enkele uitschieter (het negende tiende): zo maakt één
  // vreemd uur niet alle andere "gunstig".
  const laag = Math.min(...extraKosten);
  const hoog = kwantiel(extraKosten, 0.9);
  // Zo weinig verschil (een paar cent, of een paar honderd Wh) is geen advies waard.
  const verschilTelt = hoog - laag >= (eenheid === 'euro' ? 0.03 : 0.2);
  // Goed of liever niet alleen als het echt afwijkt van een gewoon uur (het midden): kosten de meeste uren
  // hetzelfde (de batterij is leeg, alles uit het net), dan zijn die gewoon, niet allemaal "liever niet".
  const gewoonUur = kwantiel(extraKosten, 0.5);
  const afwijking = eenheid === 'euro' ? 0.02 : 0.1;

  const uren = basis.map((u, k) => {
    const stap = gewoon.stappen[k];
    const waarom = [];
    if (u.prijs && u.prijs.afname < 0) waarom.push('negatief');
    if (stap.netW < -100) waarom.push('zonOver');
    // Goedkoop en duur: bij het kwart goedkoopste of duurste uren, en echt onder of boven het midden.
    if (u.prijs && afnamePrijzen.length >= 6 && u.prijs.afname <= goedkoop && u.prijs.afname < midden - 0.005) waarom.push('goedkoop');
    if (u.prijs && afnamePrijzen.length >= 6 && u.prijs.afname >= duur && u.prijs.afname > midden + 0.005) waarom.push('duur');
    const plek = verschilTelt ? tussen((extraKosten[k] - laag) / (hoog - laag), 0, 1) : 0.5;
    return {
      begin: u.begin,
      uur: u.uur,
      morgen: datumVan(u.begin) !== vandaag,
      zonW: Math.round(u.zonW),
      huisW: Math.round(u.huisW),
      netW: Math.round(stap.netW),
      batterijW: Math.round(stap.batterijW),
      procent: batterij ? Math.round((stap.kwh / batterij.inhoud) * 100) : null,
      prijs: u.prijs,
      extraKost: extraKosten[k],
      // Gunstig: dicht bij het goedkoopste uur; duur: dicht bij het duurste. De rest is gewoon.
      soort: plek <= 0.3 && gewoonUur - extraKosten[k] >= afwijking ? 'gunstig' : plek >= 0.8 && extraKosten[k] - gewoonUur >= afwijking ? 'duur' : 'gewoon',
      waarom,
    };
  });

  // Het uur van nu telt alleen mee als er nog genoeg van over is.
  const vanaf = basis[0].deel >= 0.5 ? 0 : 1;
  const wakker = (u) => u.uur >= 7 && u.uur <= 22;
  const telt = (u) => uren.indexOf(u) >= vanaf;
  const speling = eenheid === 'euro' ? 0.02 : 0.05;
  const beste = verschilTelt ? blok(uren, { lengte: BLOK_UREN, mag: (u) => telt(u) && wakker(u), speling }) : null;
  const gevonden = verschilTelt ? blok(uren, { lengte: BLOK_UREN, hoogste: true, mag: (u) => telt(u) && u.uur >= 6, speling }) : null;
  const slechtste = gevonden && (!beste || gevonden.tot <= beste.van || gevonden.van >= beste.tot) ? gevonden : null;
  // De tijdlijn zegt hetzelfde als de regels: het goede blok groen, het blok van liever niet oranje.
  if (beste) for (let k = beste.van; k < beste.tot; k++) uren[k].soort = 'gunstig';
  if (slechtste) for (let k = slechtste.van; k < slechtste.tot; k++) uren[k].soort = 'duur';

  const regels = [];
  if (beste) {
    const stuk = uren.slice(beste.van, beste.tot);
    const toe = meerderheid(stuk, (u) => u.waarom.includes('negatief')) ? ' Je krijgt dan zelfs geld toe.' : '';
    regels.push({ soort: 'goed', kop: 'Goed moment', tekst: `${momentTekst(uren, beste)}: goed om stroom te gebruiken, zoals wassen, vaatwasser of drogen.${toe}` });
  }
  if (slechtste) regels.push({ soort: 'liever', kop: 'Liever niet', tekst: `${momentTekst(uren, slechtste)}.` });
  if (!regels.length) regels.push({ soort: 'gewoon', kop: 'Maakt weinig uit', tekst: 'De komende uren maakt het weinig uit wanneer je stroom gebruikt.' });
  const weer = panelen && bericht ? weerRegel(bericht, nu, begin) : null;
  if (weer) regels.push(weer);

  const toelichting = [];
  if (geleerd.dagen === 0) {
    toelichting.push(
      geleerd.vandaagTelt
        ? 'Ik leer nog: ik ken je huis pas sinds vandaag, dus ik reken ook met een gewone dag. Na een week wordt dit beter.'
        : 'Ik leer nog: er zijn nog geen dagen van je huis bewaard, dus ik reken met een gewone dag. Na een week wordt dit beter.',
    );
  } else if (geleerd.dagen < GOED_NA_DAGEN) {
    toelichting.push(`Ik leer nog (${geleerd.dagen} ${geleerd.dagen === 1 ? 'dag' : 'dagen'} bekeken): na een week wordt dit beter.`);
  } else {
    toelichting.push(`Geleerd van de laatste ${geleerd.dagen} dagen van je huis.`);
  }
  if (zonBron === 'voorspelling') toelichting.push('De zon per uur is dezelfde als op het tabblad Weer: uit het weerbericht en wat de app van je panelen leerde.');
  else if (zonBron === 'weer') toelichting.push('De zon komt uit het weerbericht (Open-Meteo), met wat je panelen bij zoveel licht leveren.');
  else if (zonBron === 'dagen') {
    if (geleerd.zonVandaag !== null && geleerd.zonVandaag < 0.6) toelichting.push('Vandaag tot nu toe minder zon dan gewoonlijk; voor de rest van de dag reken ik ook met minder.');
    else if (geleerd.zonVandaag !== null && geleerd.zonVandaag > 1.4) toelichting.push('Vandaag tot nu toe meer zon dan gewoonlijk; voor de rest van de dag reken ik ook met meer.');
    toelichting.push('Het weer zit er nog niet in: de zon is geschat op de laatste dagen.');
  } else if (panelen) toelichting.push('Hoeveel zon je panelen geven, weet ik pas na een dag; tot dan reken ik zonder zon.');
  if (eenheid === 'kwh') toelichting.push('Nog geen stroomprijzen: dit advies gaat alleen over de zon en je verbruik.');
  else if (prijzen.some((p) => !p)) toelichting.push('De prijzen van morgen komen rond 13:00; tot dan reken ik daar met het gemiddelde.');

  const zekerheid = geleerd.dagen >= GOED_NA_DAGEN && eenheid === 'euro' ? 'goed' : geleerd.dagen >= 3 ? 'redelijk' : 'laag';
  return {
    uren,
    regels,
    zinnen: regels.map((r) => r.tekst),
    toelichting,
    leertNog: geleerd.dagen < GOED_NA_DAGEN,
    eenheid,
    zekerheid,
    zonBron,
    geleerd,
    rol,
    handelt,
    winst,
    batterij,
    beste: beste ? { tijd: tijdVan(uren, beste), tekst: momentTekst(uren, beste), eerste: beste.van, laatste: beste.tot - 1 } : null,
    slechtste: slechtste ? { tijd: tijdVan(uren, slechtste), tekst: momentTekst(uren, slechtste), eerste: slechtste.van, laatste: slechtste.tot - 1 } : null,
  };
}

/**
 * Eén regel over het weer van morgen (vóór 6:00: van vandaag), in gewone
 * woorden, met de wolken zoals het tabblad Voorspelling ze telt (wolkenUit in
 * src/lib/weerVerwachting.js): "Morgen veel wolken, weinig zon." Geen kWh en
 * niets over de batterij. Null als het bericht die dag niet dekt.
 */
function weerRegel(bericht, nu, begin) {
  const vroeg = uurVan(nu) < 6;
  const doel = vroeg ? datumVan(nu) : dagNa(datumVan(nu));
  const naam = vroeg ? 'Vandaag' : 'Morgen';
  const opDoel = [];
  for (let t = begin; t < begin + 50 * UUR_MS; t += UUR_MS) {
    const datum = datumVan(t);
    if (datum > doel) break;
    if (datum === doel && bericht.op(t)) opDoel.push(t);
  }
  if (opDoel.length < (vroeg ? 12 : 20)) return null;
  const licht = opDoel.filter((t) => (bericht.straling ? bericht.op(t).straling > 20 : uurVan(t) >= 9 && uurVan(t) < 17));
  const bewolkingen = licht.map((t) => bericht.op(t).bewolking).filter((v) => getal(v) !== null);
  if (!bewolkingen.length) return null;
  const wolken = wolkenUit(gemiddelde(bewolkingen));
  const woorden = ['veel zon', 'veel zon, een paar wolken', 'zon en wolken', 'veel wolken, weinig zon'][wolken];
  const icoon = ['zon', 'zonWolk', 'zonWolk', 'wolk'][wolken];
  return { soort: 'weer', kop: 'Het weer', tekst: `${naam} ${woorden}.`, icoon };
}
