/**
 * Nepcijfers voor het voorbeeld: een gewone dag bij een voorbeeldhuis (huis A).
 * Panelen op het huis (GoodWe) en op het dierenverblijf, een Zendure
 * SolarFlow 2400 AC en een P1-meter. Geen meting; zo zie je hoe het scherm
 * werkt voordat het programmaatje thuis draait.
 *
 * Geen apparaten met een eigen meter, net als in huis A: de wasmachine en de
 * vaatwasser draaien wel, maar zitten in het verbruik van het huis.
 *
 * De batterij laadt 's nachts van 01:00 tot ongeveer 03:10 met 2300 W uit het
 * net (goedkope stroom), net als in de HomeWizard-grafiek. In de dure ochtend
 * (07:45 tot 09:30) verkoopt hij 1700 W aan het net, zoals in huis A om 08:26.
 * Rond twaalf uur schuift er een wolk voor de zon, terwijl de batterij op vol
 * vermogen bijlaadt (de stroom is dan goedkoop): wat de zon niet geeft, komt
 * uit het net ("leveren de 2 zonnen meters samen 1000 w en trek ik 2300
 * naar de bat komt er 1300 uit het net"). De rest van de dag werkt hij "nul op
 * de meter": hij vangt wat de panelen over hebben en vult aan wat het huis
 * tekortkomt, tot 2400 W.
 *
 * Alles hangt af van het uur (0–24) en een tik-teller voor wat beweging, zodat
 * de tests geen klok of tijdzone nodig hebben.
 */
import { sturenUit } from './omvormerSturen';
import { spanningUit } from './spanning';
import { herkendUit } from './herkennen';

// "Zon hoofddak", zoals de eerste meter in huis A heet: "Huis" zou in Nu in woorden lijken op het huis dat stroom gebruikt.
export const VOORBEELD_ZONNEN = [
  // Dezelfde sleutels als bij de meters op Apparaten (gekoppeld), zoals live: één apparaat, niet twee.
  { sleutel: 'hw-zon-batterij', naam: 'Zon hoofddak' },
  { sleutel: 'hw-zon-dierenverblijf', naam: 'Zon dierenverblijf' },
];

/**
 * Het maximale vermogen zoals in huis A (Instellingen › Namen): het hoofddak
 * 8000 W, het dierenverblijf 3000 W, de batterij 2400 W. Zo staan de ringen om
 * de rondjes ook in het voorbeeld; wat je zelf invult, gaat voor.
 */
/** Het voorbeeld draait de nieuwste versie van het programmaatje, zodat alles erin te zien is. */
export const VOORBEELD_BRUG_VERSIE = '1.6.1';

export const VOORBEELD_VERMOGENS = Object.freeze({ 'hw-zon-batterij': 8000, 'hw-zon-dierenverblijf': 3000, batterij: 2400 });

/** Momenten om snel naar te springen, met wat er dan te zien is (en wat Nu in woorden dan zegt). */
export const MOMENTEN = [
  { sleutel: 'nu', naam: 'Nu' },
  // Geen zon, de batterij laadt uit het net.
  { sleutel: 'nacht', naam: '01:30 laden', uur: 1.5 },
  // De zon voor het huis, de batterij verkoopt aan het net.
  { sleutel: 'verkopen', naam: '08:30 verkopen', uur: 8.5 },
  // De zon draait de was, de batterij vangt het beetje dat over is.
  { sleutel: 'wassen', naam: '10:15 wassen', uur: 10.25 },
  // Een wolk: de batterij laadt met de zon én uit het net.
  { sleutel: 'wolk', naam: '12:00 wolk', uur: 12 },
  // Volop zon: de batterij eerst, dan het huis, de rest naar het net.
  { sleutel: 'middag', naam: '13:00 zon', uur: 13 },
  // Geen zon: de batterij en het net samen voor de vaatwasser.
  { sleutel: 'avond', naam: '19:45 koken', uur: 19.75 },
];

const BATTERIJ_MAX_W = 2400;
const NACHTLADEN_W = 2300;
const NACHTLADEN = [1, 3.2];
/** De dure ochtend: de batterij verkoopt aan het net. */
const VERKOPEN_W = 1700;
const VERKOPEN = [7.75, 9.5];
/** De wolk rond twaalf uur: de panelen geven een kwart, en de batterij laadt op vol vermogen bij. */
const WOLK = [11.75, 12.25];
const WOLK_ZON = 0.25;
const BIJLADEN_W = 2300;

const binnen = (uur, [van, tot]) => uur >= van && uur < tot;

/** Een vast reeksje willekeurige getallen per tik (mulberry32), zodat het voorbeeld leeft maar testbaar blijft. */
function ruis(tik) {
  let a = (tik * 2654435761 + 12345) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hoe hoog de zon staat, 0 tot 1. */
/** De nepzon komt op om half acht en gaat onder om half zeven. */
const ZON_OP_UUR = 7.5;
const ZON_ONDER_UUR = 18.5;

function zonnestand(uur) {
  if (uur <= ZON_OP_UUR || uur >= ZON_ONDER_UUR) return 0;
  return Math.pow(Math.sin((Math.PI * (uur - ZON_OP_UUR)) / (ZON_ONDER_UUR - ZON_OP_UUR)), 1.4);
}

function wasmachine(uur) {
  if (uur < 10 || uur >= 11.5) return 0;
  if (uur < 10.35) return 2050; // het water opwarmen
  return 170 + 110 * Math.abs(Math.sin(uur * 37));
}

function vaatwasser(uur) {
  if (uur < 19.5 || uur >= 21) return 0;
  if (uur < 19.85 || (uur > 20.55 && uur < 20.75)) return 1950;
  return 55;
}

/** Wat altijd aanstaat (koelkast, router, het dierenverblijf) plus licht en koken. */
function rest(uur) {
  let w = 520;
  if (uur >= 7 && uur < 8.5) w += 350;
  if (uur >= 17.5 && uur < 23.5) w += 300;
  return w;
}

/** Hoe vol de batterij in het voorbeeld is: 's nachts vol, 's ochtends verkocht, middag weer vol. */
function vulling(uur) {
  const punten = [
    [0, 24],
    [1, 20],
    [3.2, 96],
    [7.75, 86],
    [9.5, 48],
    [11.75, 63],
    [12.25, 75],
    [15, 100],
    [17.5, 100],
    [24, 24],
  ];
  for (let i = 1; i < punten.length; i++) {
    const [u1, p1] = punten[i];
    const [u0, p0] = punten[i - 1];
    if (uur <= u1) return p0 + ((p1 - p0) * (uur - u0)) / (u1 - u0);
  }
  return punten[punten.length - 1][1];
}

/**
 * Een gewone herfstdag op de stroommarkt (EPEX, € per kWh zonder btw):
 * 's nachts goedkoop, een dip als de zon volop schijnt, duur rond het eten.
 */
const MARKT = [
  [0, 0.085],
  [5, 0.08],
  [7.5, 0.125],
  [9, 0.11],
  [11, 0.07],
  [13, 0.045],
  [15, 0.075],
  [17.5, 0.155],
  [19.5, 0.17],
  [21.5, 0.12],
  [24, 0.09],
];

function tussen(punten, x) {
  for (let i = 1; i < punten.length; i++) {
    const [x1, y1] = punten[i];
    const [x0, y0] = punten[i - 1];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return punten[punten.length - 1][1];
}

const rond = (v, n) => Math.round(v * 10 ** n) / 10 ** n;

/** Morgen: een zonnige zaterdag, met rond één uur even een prijs onder nul. */
const MARKT_MORGEN = [
  [0, 0.09],
  [5, 0.082],
  [7.5, 0.13],
  [9, 0.1],
  [11, 0.03],
  [12, -0.06],
  [13, -0.12],
  [14, -0.08],
  [15, 0.02],
  [17.5, 0.16],
  [19.5, 0.185],
  [21.5, 0.125],
  [24, 0.095],
];

/**
 * De prijs van het kwartier, met de opbouw en de regels van Zonneplan (zie
 * brug/prijzen.mjs): inkoopvergoeding, energiebelasting en btw erbij; overdag
 * de Zonnebonus; terugleveren is in 2026 evenveel als afnemen (saldering).
 */
export function voorbeeldPrijs(uur, markt = MARKT) {
  const kwartier = Math.floor((((uur % 24) + 24) % 24) * 4) / 4;
  // Inkoopvergoeding € 0,02 met btw (contract Zonneplan), zoals brug/energyzero.mjs.
  const zonderBelasting = tussen(markt, kwartier) * 1.21 + 0.02;
  const alles = zonderBelasting + 0.09161 * 1.21;
  const bonus = zonnestand(kwartier + 0.125) > 0 && zonderBelasting > 0 ? 0.1 * zonderBelasting : 0;
  return {
    afname_kwh: rond(alles, 5),
    // Uit de afgeronde delen, zodat terugleveren precies afnemen plus de Zonnebonus is (zoals de app ze toont).
    teruglevering_kwh: rond(rond(alles, 5) + rond(bonus, 5), 5),
    zonnebonus_kwh: rond(bonus, 5),
    van: null,
    tot: null,
    bron: 'voorbeeld',
  };
}

/** Wat de meterkast vandaag tot dit uur deed: per kwartier, met de prijs van dat kwartier. */
function voorbeeldVandaag(uur) {
  const dag = { afname_kwh: 0, teruglevering_kwh: 0, kosten_eur: 0, opbrengst_eur: 0 };
  for (let kwartier = 0; kwartier + 0.25 <= uur; kwartier += 0.25) {
    const { net_w } = vermogensOp(kwartier + 0.125);
    const prijs = voorbeeldPrijs(kwartier);
    const kwh = (Math.abs(net_w) * 0.25) / 1000;
    if (net_w >= 0) {
      dag.afname_kwh += kwh;
      dag.kosten_eur += kwh * prijs.afname_kwh;
    } else {
      dag.teruglevering_kwh += kwh;
      dag.opbrengst_eur += kwh * prijs.teruglevering_kwh;
    }
  }
  return {
    datum: null,
    afname_kwh: rond(dag.afname_kwh, 3),
    teruglevering_kwh: rond(dag.teruglevering_kwh, 3),
    kosten_eur: rond(dag.kosten_eur, 4),
    opbrengst_eur: rond(dag.opbrengst_eur, 4),
    vaste_kosten_eur: rond(VAST_PER_DAG, 4),
    compleet: true,
  };
}

/**
 * Vaste kosten per dag zoals in een voorbeeldcontract: levering € 6,25 en netbeheer
 * € 39,66 per maand, min de korting op de energiebelasting (€ 52,41
 * per maand in 2026).
 */
const VAST_PER_DAG = ((6.25 + 39.66 - 52.41) * 12) / 365;

/**
 * De zonnebronnen passend bij de tekening: bij een schuur heet de tweede
 * plek zo, en zonder bijgebouw met panelen (alleen het huis, of vrijstaand
 * met garage) liggen alle panelen samen op het huis.
 */
function zonnenBij(zonnen, tekening) {
  if (tekening === 'huis' || tekening === 'garage') return [{ ...zonnen[0], naam: 'Zon', vermogen_w: zonnen[0].vermogen_w + zonnen[1].vermogen_w }];
  if (tekening === 'schuur') return [zonnen[0], { ...zonnen[1], naam: 'Zon schuur' }];
  return zonnen;
}

const KWARTIER_MS = 15 * 60_000;

/** De spanning per fase zonder belasting; terugleveren duwt hem iets omhoog, afnemen iets omlaag. */
const SPANNING = [231.4, 229.6, 232.2];

/**
 * De drie fasen bij een stand, zoals de P1-meter ze per fase meet. Het dak en
 * de batterij hangen aan L1, de panelen van het dierenverblijf aan L3, en de
 * keuken en de koelkast vooral aan L2. Samen weer precies het net: daarom
 * zie je 's avonds L1 terugleveren (de batterij) terwijl L2 en L3 afnemen.
 */
function fasenOp(stand) {
  const huis = Math.max(0, stand.zon_w + stand.batterij_w + stand.net_w);
  const l2 = 0.62 * huis;
  const l3 = 0.1 * huis - (stand.zonnen[1]?.vermogen_w ?? 0);
  return [stand.net_w - l2 - l3, l2, l3].map((w, i) => {
    const v = SPANNING[i] - w / 2000;
    return { fase: i + 1, w: Math.round(w), a: rond(Math.abs(w) / v, 1), v: rond(v, 1) };
  });
}

/** "2026-10-30" voor een moment, in de tijd van dit toestel. */
function datumOp(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** De daggemiddelden per fase van de zeven dagen voor vandaag (oudste eerst), elke dag een beetje anders. */
function voorbeeldWeek(dagBegin) {
  const hele = voorbeeldDag(24, dagBegin).fasen;
  return Array.from({ length: 7 }, (_, k) => {
    const d = 7 - k;
    return {
      datum: datumOp(dagBegin - d * 86_400_000 + 12 * 3_600_000),
      fasen: hele.map((f) => {
        const mate = 1 + 0.12 * Math.sin(1.3 * d + 2 * f.fase);
        return { fase: f.fase, gemiddeldA: rond(f.gemiddeldA * mate, 1), piekA: rond(f.piekA * (1 + 0.1 * Math.cos(d + f.fase)), 1) };
      }),
    };
  });
}

/** De prijzen per kwartier van vandaag en morgen, in de vorm van de app (zie voorspellingUit in bron.js). */
export function voorbeeldVoorspelling(dagBegin) {
  const v = { van: dagBegin, stapMs: KWARTIER_MS, afname: [], terug: [], bonus: [], schatting: false, bron: 'Zonneplan (voorbeeld)' };
  for (let i = 0; i < 192; i++) {
    const p = voorbeeldPrijs((i % 96) / 4, i < 96 ? MARKT : MARKT_MORGEN);
    v.afname.push(rond(p.afname_kwh, 4));
    v.terug.push(rond(p.teruglevering_kwh, 4));
    v.bonus.push(rond(p.zonnebonus_kwh, 4));
  }
  return v;
}

/**
 * Vandaag per kwartier tot dit uur, in de vorm van de app (zie dagUit in
 * bron.js): wat het programmaatje bijhoudt sinds versie 0.4.0.
 */
export function voorbeeldDag(uur, dagBegin) {
  const n = Math.min(96, Math.floor(uur * 4) + 1);
  const dag = { datum: null, van: dagBegin, stapMs: KWARTIER_MS, sinds: dagBegin, metingen: [], zon: [], huis: [], batterij: [], net: [], procent: [] };
  const kwh = { zon: 0, huis: 0, geladen: 0, ontladen: 0 };
  const fasen = [1, 2, 3].map((fase) => ({ fase, a: [], w: [], som: 0, tijd: 0, hoogste: 0 }));
  for (let q = 0; q < n; q++) {
    const laatste = q === n - 1;
    const u = laatste ? uur : q / 4 + 0.125;
    const stand = vermogensOp(u, q);
    const { zon_w, batterij_w, net_w } = stand;
    const huis = Math.max(0, zon_w + batterij_w + net_w);
    // Het lopende kwartier is nog niet vol.
    const deel = laatste ? Math.max(0.05, uur * 4 - q) : 1;
    dag.metingen.push(Math.round(180 * deel));
    dag.zon.push(zon_w);
    dag.huis.push(huis);
    dag.batterij.push(batterij_w);
    dag.net.push(net_w);
    dag.procent.push(Math.round(vulling(u)));
    const uren = 0.25 * deel;
    kwh.zon += (zon_w * uren) / 1000;
    kwh.huis += (huis * uren) / 1000;
    kwh.geladen += (Math.max(0, -batterij_w) * uren) / 1000;
    kwh.ontladen += (Math.max(0, batterij_w) * uren) / 1000;
    fasenOp(stand).forEach((f, i) => {
      const lijn = fasen[i];
      lijn.a.push(f.a);
      lijn.w.push(f.w);
      lijn.som += f.a * deel;
      lijn.tijd += deel;
      lijn.hoogste = Math.max(lijn.hoogste, f.a);
    });
  }
  return {
    ...dag,
    ...voorbeeldApparatenVandaag(uur, kwh.huis),
    kwh: { zon: rond(kwh.zon, 3), huis: rond(kwh.huis, 3), geladen: rond(kwh.geladen, 3), ontladen: rond(kwh.ontladen, 3) },
    // Binnen een kwartier piekt het hoger dan het gemiddelde (de waterkoker, de wasmachine die opwarmt).
    fasen: fasen.map((f) => ({ fase: f.fase, a: f.a, w: f.w, gemiddeldA: rond(f.som / f.tijd, 1), piekA: rond(f.hoogste * 1.3, 1) })),
  };
}

/**
 * Per apparaat van vandaag tot dit uur, zoals het programmaatje het telt
 * (brug 0.12.0) en de site het leest (dagUit in bron.js): de koelkast de hele
 * dag, de waterkoker en het strijkijzer 's ochtends, de wasmachine als hij
 * klaar is, en de basis (de warmtepomp). Alles herkend: huis A heeft geen
 * apparaten met een eigen meter.
 */
function voorbeeldApparatenVandaag(uur, huisKwh) {
  const basisKwh = rond(Math.min(0.45 * uur, 0.62 * huisKwh), 2);
  const lijst = [
    { sleutel: 'h:koelkast', soort: 'koelkast', kwh: rond(0.042 * uur, 2), keer: Math.floor(uur * 1.6), gemeten: false },
    ...(uur >= 7.6 ? [{ sleutel: 'h:waterkoker', soort: 'waterkoker', kwh: uur >= 12.5 ? 0.22 : 0.11, keer: uur >= 12.5 ? 2 : 1, gemeten: false }] : []),
    ...(uur >= 8.9 ? [{ sleutel: 'h:strijkijzer', soort: 'strijkijzer', kwh: 0.48, keer: 1, gemeten: false }] : []),
    ...(uur >= 10.7 ? [{ sleutel: 'h:wasmachine', soort: 'wasmachine', kwh: 1.15, keer: 1, gemeten: false }] : []),
    ...(uur >= 18.6 ? [{ sleutel: 'h:oven', soort: 'oven', kwh: 1.3, keer: 1, gemeten: false }] : []),
    // Wat vaker terugkomt en nog geen naam heeft (brug 1.4.0): apart, niet in de Rest.
    ...(uur >= 7.9 ? [{ sleutel: 'h:onbekend:g-vb-b', naam: 'Onbekend apparaat B, zo’n 1,8 kW', kwh: 0.6 * TERUG_B.filter((t) => t + 0.67 <= uur).length, keer: TERUG_B.filter((t) => t + 0.67 <= uur).length, gemeten: false }] : []),
  ].filter((a) => a.kwh > 0);
  return { apparaten: lijst.sort((a, b) => b.kwh - a.kwh), basisKwh };
}

/** Drie accu's van 2,88 kWh (AB3000X) aan de 2400 AC, zoals in huis A; 4% gaat verloren bij het omzetten. */
const ACCUS = 3;
const ACCU_KWH = 8.64;
const OMZETTEN = 0.96;

/**
 * Wat de 2400 AC zelf over zijn batterij meldt (zie batterijInfoUit in
 * bron.js), passend bij het uur: hoe harder hij laadt of levert, hoe warmer de
 * accu's en de Zendure binnenin; de spanning loopt op met de vulling.
 */
function voorbeeldBatterijInfo({ batterij_w, batterij_procent }) {
  const last = Math.min(1, Math.abs(batterij_w) / BATTERIJ_MAX_W);
  const laadt = batterij_w <= -5;
  const levert = batterij_w >= 5;
  const spanning = rond(50.4 + 2.8 * (batterij_procent / 100) + (laadt ? 0.6 : levert ? -0.5 : 0), 1);
  const warm = rond(18.5 + 6 * last, 1);
  const info = {
    temp_c: warm,
    temp_min_c: rond(warm - 1.8, 1),
    behuizing_c: rond(24 + 15 * last, 1),
    spanning_v: spanning,
    laadgrens_pct: 100,
    ontlaadgrens_pct: 10,
    pakketten: ACCUS,
    inhoud_kwh: ACCU_KWH,
    verwarmt: false,
    kalibreert: false,
    wifi_dbm: -58,
    storing: false,
    // Per accu (brug 0.7.0): de eerste het warmst, de laatste het koelst; de vulling scheelt een procent.
    // Programmaatje 1.4.0: de laagste en hoogste cel, en wat er in de Zendure-app ingesteld is.
    cel_min_v: rond(3.2 + 0.12 * (batterij_procent / 100) - 0.01, 2),
    cel_max_v: rond(3.2 + 0.12 * (batterij_procent / 100) + 0.02, 2),
    invoer_limiet_w: 2400,
    uitvoer_limiet_w: 2400,
    omvormer_max_w: 2400,
    accus: Array.from({ length: ACCUS }, (_, i) => {
      const cel = 3.2 + 0.12 * ((batterij_procent + 1 - i) / 100);
      return {
        nr: i + 1,
        temp_c: rond(warm - (1.8 * i) / (ACCUS - 1), 1),
        procent: Math.max(0, Math.min(100, Math.round(batterij_procent + 1 - i))),
        cel_min_v: rond(cel - 0.01, 2),
        cel_max_v: rond(cel + 0.02, 2),
      };
    }),
  };
  if (laadt || levert) info.stroom_a = rond(Math.abs(batterij_w) / spanning, 1);
  const minuten = (deel, accuW) => (deel > 0 ? Math.round(((deel / 100) * ACCU_KWH * 60_000) / accuW) : null);
  const vol = laadt ? minuten(100 - batterij_procent, -batterij_w * OMZETTEN) : null;
  const leeg = levert ? minuten(batterij_procent - 10, batterij_w / OMZETTEN) : null;
  if (vol) info.vol_over_min = vol;
  if (leeg) info.leeg_over_min = leeg;
  return info;
}

/**
 * Wat de GoodWe GW8000-DT in huis A (op het hoofddak) zelf meldt, passend bij het
 * uur (zie omvormerUit in bron.js): één paneelrij rond de 600 V (de tweede ingang is leeg), drie fasen
 * rond 230 V, warmer naarmate hij meer levert, en 's nachts slaapt hij (met de
 * opbrengst van vandaag).
 */
function voorbeeldOmvormer(uur) {
  let vandaag = 0;
  for (let k = 0; k + 0.25 <= uur; k += 0.25) vandaag += (vermogensOp(k + 0.125).zonnen[0].vermogen_w * 0.25) / 1000;
  const vandaag_kwh = rond(vandaag, 1);
  const totaal_kwh = rond(13_350.2 + vandaag, 1);
  const w = vermogensOp(uur).zonnen[0].vermogen_w;
  const bij = VOORBEELD_ZONNEN[0].sleutel;
  if (w < 20) return { stand: 'slaapt', bij, vandaag_kwh, totaal_kwh };
  const last = Math.min(1, w / 8000);
  const rij = (v, deel) => ({ v: rond(v, 1), a: rond((w * deel) / v, 1) });
  return {
    stand: 'normaal',
    bij,
    w,
    // de GW8000-DT in huis A gebruikt één ingang; de tweede meldt 0 V (de app laat die weg).
    rijen: [rij(560 + 60 * last, 1), { v: 0, a: 0 }],
    fasen: [231.4, 229.8, 232.1].map((v) => ({ v: rond(v + 1.5 * last, 1), a: rond(w / 3 / v, 1) })),
    hz: 50.01,
    temp_c: rond(21 + 24 * last, 1),
    vandaag_kwh,
    totaal_kwh,
    // Programmaatje 1.4.0: arbeidsfactor, busspanning, koelplaat, uren, isolatie van de panelen en lekstroom.
    pf: rond(0.97 + 0.02 * last, 3),
    bus_v: rond(615 + 10 * last, 1),
    koelplaat_c: rond(23 + 28 * last, 1),
    uren: 8451 + Math.floor(uur),
    isolatie_kohm: 1850,
    lekstroom_ma: rond(6 + 8 * last, 1),
  };
}

/**
 * De meterkast (programmaatje 1.4.0, meterkastUit in brug/homewizard.mjs): het tarief
 * (dal 's nachts, van 23:00 tot 07:00) en een gasmeter aan de slimme meter, met wat
 * hij vandaag telde: 's ochtends douchen, 's avonds koken.
 */
export const VOORBEELD_GAS_BEGIN = 2569.646;
export function voorbeeldMeterkast(uur, dagBegin) {
  const u = ((uur % 24) + 24) % 24;
  const telt = (van, tot, m3) => Math.max(0, Math.min(1, (u - van) / (tot - van))) * m3;
  const vandaag = rond(telt(6.5, 8, 0.32) + telt(17.5, 19, 0.18) + 0.01 * u, 3);
  // De gasmeter geeft elke 5 minuten een stand door.
  const op = dagBegin === null ? null : new Date(dagBegin + Math.floor((u * 60) / 5) * 5 * 60_000).toISOString();
  return {
    tarief: u < 7 || u >= 23 ? 1 : 2,
    meters: [{ soort: 'gas', stand: rond(VOORBEELD_GAS_BEGIN + vandaag, 3), eenheid: 'm3', ...(op ? { op } : {}), vandaag }],
  };
}

/**
 * Het begrenzen bij een negatieve prijs (programmaatje 1.5.0, 1.6.0) in het voorbeeld: vandaag van
 * 12:15 tot 15:15 en morgen van 13:00 tot 13:30 kost terugleveren geld; tussen 12:15 en 15:15
 * staat hij begrensd tot ongeveer het eigen verbruik (om 13:20 één keer omhoog bijgesteld:
 * de wasmachine). Zoals sturenUit in src/lib/omvormerSturen.js het geeft.
 */
export function voorbeeldSturen(u, dagBegin) {
  const op = (uur) => new Date(dagBegin + uur * 3_600_000).toISOString();
  const begrensd = u >= 12.25 && u < 15.25;
  return sturenUit({
    aan: true,
    stand: u >= 6 && u < 21 ? 'vrij' : 'onbekend',
    ...(begrensd ? { stand: 'begrensd', pct: u >= 13.33 ? 30 : 20, grens_w: u >= 13.33 ? 2400 : 1600, sinds: op(12.25), door: 'programmaatje', aanpassingen: u >= 13.33 ? 1 : 0, doel_w: u >= 13.33 ? 2200 : 1300 } : {}),
    verbruik_w: 950,
    // Programmaatje 1.6.0: de zelfcontrole (de eerste drie minuten bezig, daarna nagekeken) en hoe hij stond (zoals in huis A).
    ...(begrensd && u < 12.3
      ? { controle: { uitkomst: 'bezig', pct: 20, voor_w: 3100 } }
      : u >= 12.3
        ? { controle: { uitkomst: 'werkt', op: op(12.3), pct: 20, voor_w: 3100, na_w: 1580, via: 'omvormer' } }
        : {}),
    oorspronkelijk: { grens_pct: 2, schakelaar: false, op: op(-12) },
    blokken: [
      ...(u < 15.25 ? [{ van: op(12.25), tot: op(15.25), laagste: -0.034, modus: 'deels' }] : []),
      // Morgen het halfuur dat ook bij de prijzen onder nul staat: dan levert afnemen geld op, dus helemaal uit.
      { van: op(24 + 13), tot: op(24 + 13.5), laagste: -0.014, modus: 'uit' },
    ],
  });
}

/**
 * De spanningswacht in het voorbeeld (programmaatje 1.5.0): in huis A meet de omvormer de drie
 * fasen; met veel zon loopt L2 op tot boven 250 V (vandaag één keer, niet uitgevallen), en
 * vorige maand viel hij één keer uit. Zoals spanningUit in src/lib/spanning.js het geeft.
 */
export function voorbeeldSpanning(u, dagBegin, omvormer = null) {
  const zon = Math.max(0, Math.sin(((u - 7) / 13) * Math.PI));
  // Dezelfde spanning als de omvormer (zijn drie fasen); 's nachts slaapt hij, dan rustig rond 231 V.
  const vanOmvormer = (omvormer?.fasen ?? []).map((f) => f.v);
  const nu = (vanOmvormer.length === 3 ? vanOmvormer : [231.4, 229.8, 232.1]).map((v) => rond(v, 1));
  const datum = new Date(dagBegin).toISOString().slice(0, 10);
  return spanningUit({
    datum,
    herkomst: [1, 2, 3].map((f) => ({ sleutel: `L${f}`, bron: 'omvormer' })),
    nu: nu.map((v, i) => ({ sleutel: `L${i + 1}`, v, gem10: rond(v - 0.6, 1) })),
    hoogste: nu.map((v, i) => ({ sleutel: `L${i + 1}`, v: u >= 13 ? [243.4, 251.3, 241.8][i] : rond(v + 2 * zon, 1), op: new Date(dagBegin + Math.min(u, 13) * 3_600_000).toISOString() })),
    uitval_vandaag: 0,
    boven_250_vandaag: u >= 13 ? 1 : 0,
    boven_250_uitgevallen: 0,
    maand: datum.slice(0, 7),
    uitval_maand: 0,
    lijst: [{ op: new Date(dagBegin - 12 * 86_400_000 + 13.7 * 3_600_000).toISOString(), sleutel: 'L2', v: 256.1, gem: 253.2, omvormer: true }],
  });
}

/** Wat er in huis A gekoppeld is, met wat elk apparaat nu meet (zie gekoppeldUit in bron.js). */
function voorbeeldGekoppeld(stand, omvormer) {
  const [huis, dier] = stand.zonnen;
  const apparaat = (sleutel, naam, merk, soort, rol, manier, adres, w) => ({ sleutel, naam, merk, soort, rol, manier, adres, ok: true, sinds: null, w });
  return [
    apparaat('hw-meterkast', 'Meterkast', 'HomeWizard', 'P1-meter', 'net', 'v1', '192.168.1.64', stand.net_w),
    apparaat('hw-zon-batterij', 'zon + batterij', 'HomeWizard', 'kWh-meter', 'zon-en-batterij', 'v1', '192.168.1.62', -(huis.vermogen_w + stand.batterij_w)),
    apparaat('hw-zon-dierenverblijf', 'Zon dierenverblijf', 'HomeWizard', 'kWh-meter', 'zon', 'v1', '192.168.1.61', -dier.vermogen_w),
    apparaat('zendure', 'Zendure-batterij', 'Zendure', 'SolarFlow 2400 AC', 'batterij', 'lokaal', '192.168.1.63', stand.batterij_w),
    apparaat('zendure-p1', 'Zendure P1-meter', 'Zendure', 'P1-meter', 'vergelijk', 'lokaal', '192.168.0.64', stand.net_zendure_w),
    apparaat('goodwe', 'Omvormer', 'GoodWe', 'GW8000-DT', 'omvormer', 'lokaal', '192.168.1.40', omvormer.w ?? null),
  ];
}

/** Wanneer "Onbekend apparaat B" (zo'n 1,8 kW, 40 minuten, met een piek bij het aangaan) vandaag begint: 07:10, 12:30, 18:05. */
const TERUG_B = [7 + 10 / 60, 12.5, 18 + 5 / 60];

/**
 * Wat het programmaatje in het voorbeeld herkent (brug 0.11.0): de koelkast,
 * 's ochtends de wasmachine, eerder vandaag de waterkoker en het strijkijzer,
 * een onbekende die terugkomt, de warmtepomp als basis en de week. Sinds
 * brug 1.4.0 ook de handtekening van wat terugkomt (zodat de app een vraag
 * stelt: "Er komt iets terug van zo'n 1,8 kW …") en wat het al kent.
 */
export function voorbeeldHerkend(u, dagBegin) {
  const iso = (uur) => new Date(dagBegin + uur * 3_600_000).toISOString();
  const vandaagB = TERUG_B.filter((t) => t <= u);
  const nu = [{ id: 'vb-koel', soort: 'koelkast', w: 110, zeker: 0.5, sinds: iso(Math.max(0, u - 0.2)) }];
  if (u >= 9 && u < 10.5) nu.unshift({ id: 'vb-was', soort: 'wasmachine', deel: 'verwarmt', w: 2100, zeker: 0.65, sinds: iso(9) });
  const recent = [
    { id: 'vb-strijk', soort: 'strijkijzer', w: 2000, zeker: 0.75, vorm: 'puls', van: iso(8.5), tot: iso(8.75) },
    { id: 'vb-kachel', w: 1200, zeker: 0.2, onbekend: 'A', van: iso(7.9), tot: iso(8.2) },
    { id: 'vb-ketel', soort: 'waterkoker', w: 2200, zeker: 1, bevestigd: true, van: iso(7.5), tot: iso(7.55) },
  ].filter((r) => Date.parse(r.tot) <= dagBegin + u * 3_600_000);
  return herkendUit({
    nu,
    recent,
    onbekend: [
      {
        id: 'g-vb-b',
        letter: 'B',
        w: 1800,
        duur_s: 2400,
        n: 5 + vandaagB.length,
        vorm: 'piek',
        tijden: [iso(-6), ...vandaagB.map(iso)].slice(-4),
        ...(vandaagB.length ? { vandaag: vandaagB.length } : {}),
        per_dag: 2.7,
      },
      { id: 'g-vb-kachel', letter: 'A', w: 1200, duur_s: 1200, n: 4, dagdeel: 'ochtend', fase: 1, vorm: 'vlak', tijden: [iso(-40), iso(-16), iso(7.9)].filter((t) => Date.parse(t) <= dagBegin + u * 3_600_000) },
    ],
    basis: { w: 450, altijd_w: 400, warmtepomp: true },
    kennis: {
      apparaten: [
        { soort: 'waterkoker', zeker: 0.95, aangewezen: 3 },
        { soort: 'strijkijzer', zeker: 0.75 },
        { soort: 'wasmachine', zeker: 0.65 },
        { soort: 'koelkast', zeker: 0.55 },
        { soort: 'warmtepomp', zeker: 0.6, basis: true },
      ],
    },
    week: {
      van: new Date(dagBegin).toISOString().slice(0, 10),
      apparaten: [
        { soort: 'spa', keer: 9, kwh: 25.2, dagdeel: 'avond' },
        { soort: 'wasmachine', keer: 3, kwh: 3.1, dag: 5, dagdeel: 'ochtend' },
        { soort: 'waterkoker', keer: 14, kwh: 1.4, dagdeel: 'ochtend' },
      ],
    },
  });
}

/**
 * @param {number} uur  0 tot 24, mag een breuk zijn (10.25 = kwart over tien)
 * @param {number} tik  telt op zolang het scherm open staat; geeft wat beweging
 * @param {string} tekening  'dierenverblijf' (standaard), 'schuur', 'huis' of 'garage' (zie opstelling.js)
 * @param {number|null} dagBegin  middernacht (ms); dan ook de dag per kwartier, de prijzen van
 *   vandaag en morgen, de gekoppelde apparaten en het programmaatje zelf
 */
export function voorbeeldStand(uur, tik = 0, tekening = 'dierenverblijf', dagBegin = null) {
  const u = ((uur % 24) + 24) % 24;
  const stand = vermogensOp(u, tik);
  const basis = {
    ...stand,
    zonnen: zonnenBij(stand.zonnen, tekening),
    prijs: voorbeeldPrijs(u),
    vandaag: voorbeeldVandaag(u),
    jaar: { teruglevering_kwh: 6830, plafond_kwh: 7500 },
    fasen: fasenOp(stand),
    batterij_info: voorbeeldBatterijInfo(stand),
    omvormer: voorbeeldOmvormer(u),
    weer: voorbeeldWeer(u),
    meterkast: voorbeeldMeterkast(u, dagBegin),
  };
  if (dagBegin === null) return basis;
  return {
    ...basis,
    // Het moment van het voorbeeld: de tabbladen zetten daar hun "nu".
    klok: dagBegin + u * 3_600_000,
    dag: { ...voorbeeldDag(u, dagBegin), week: voorbeeldWeek(dagBegin) },
    voorspelling: voorbeeldVoorspelling(dagBegin),
    gekoppeld: voorbeeldGekoppeld(stand, basis.omvormer),
    // 1.5.0: het begrenzen bij een negatieve prijs, en de spanningswacht.
    omvormer: { ...basis.omvormer, sturen: voorbeeldSturen(u, dagBegin) },
    spanning: voorbeeldSpanning(u, dagBegin, basis.omvormer),
    herkend: voorbeeldHerkend(u, dagBegin),
    brug: {
      // De versie van het programmaatje nu (brug/versie.mjs; voorbeeld.test.js houdt ze gelijk).
      versie: VOORBEELD_BRUG_VERSIE,
      gestart: dagBegin + Math.max(0, Math.min(u - 0.25, 6.7)) * 3_600_000,
      elkeSeconden: 5,
      prijzen: 'Zonneplan',
      // Een vaste zonsopkomst en -ondergang, passend bij de nepzon (zonnestand): de tekening schakelt erop.
      zon: { op: dagBegin + ZON_OP_UUR * 3_600_000, onder: dagBegin + ZON_ONDER_UUR * 3_600_000 },
    },
  };
}

/**
 * Het weer van nu in het voorbeeld (alleen `nu`, voor de tekening; zonder
 * uren, dus Advies rekent er niet mee): 's nachts helder, 's ochtends mist,
 * rond de wolk van twaalf uur een bui, 's avonds lichte regen met harde wind.
 * `opgehaald` zet de site op het moment van tonen (useStand in bron.js).
 */
export function voorbeeldWeer(u) {
  const nu = (code, wind = 12, neerslag = 0, bewolking = null) => ({ code, neerslag, wind, stoten: Math.round(wind * 1.8), bewolking });
  const weer = (n) => ({ van: null, stapMs: 3_600_000, straling: null, bewolking: null, temp: null, nu: n, opgehaald: null, bron: 'voorbeeld' });
  if (u < 6 || u >= 22) return weer(nu(0, 8, 0, 5));
  if (binnen(u, VERKOPEN)) return weer(nu(45, 6, 0, 100));
  if (binnen(u, WOLK)) return weer(nu(80, 25, 0.8, 70));
  if (u >= 19 && u < 22) return weer(nu(61, 44, 0.4, 100));
  return weer(nu(1, 14, 0, 20));
}

/** Wat elke meter op dit uur meet. */
function vermogensOp(u, tik = 0) {
  const r = ruis(tik);
  const wiebel = (w, mate) => w * (1 + mate * (r() - 0.5));

  const stand = zonnestand(u) * (binnen(u, WOLK) ? WOLK_ZON : 1);
  const zonnen = [
    { ...VOORBEELD_ZONNEN[0], vermogen_w: Math.round(wiebel(3200 * stand, 0.08)) },
    { ...VOORBEELD_ZONNEN[1], vermogen_w: Math.round(wiebel(1200 * stand, 0.08)) },
  ];
  const zon_w = zonnen.reduce((som, z) => som + z.vermogen_w, 0);
  // Zonder eigen meter: de was en de vaat tellen mee in het huis.
  const was = Math.round(wiebel(wasmachine(u), 0.04));
  const vaat = Math.round(wiebel(vaatwasser(u), 0.04));
  const huis = Math.round(wiebel(rest(u), 0.06)) + was + vaat;
  const batterij_procent = Math.round(vulling(u));

  let batterij_w = 0;
  if (binnen(u, NACHTLADEN)) {
    batterij_w = -NACHTLADEN_W;
  } else if (binnen(u, VERKOPEN)) {
    batterij_w = VERKOPEN_W;
  } else if (binnen(u, WOLK)) {
    batterij_w = -BIJLADEN_W;
  } else {
    const over = zon_w - huis;
    if (over > 0 && batterij_procent < 99) batterij_w = -Math.min(over, BATTERIJ_MAX_W);
    if (over < 0 && batterij_procent > 10) batterij_w = Math.min(-over, BATTERIJ_MAX_W);
  }
  batterij_w = Math.round(batterij_w);

  // De batterij regelt een paar seconden achter de feiten aan: bij de meter
  // blijft altijd een klein beetje over, de ene keer erin, de andere eruit.
  const net_w = Math.round(huis - zon_w - batterij_w + 24 * (r() - 0.5));
  // De Zendure P1-meter op dezelfde meterkast meet niet op precies hetzelfde moment.
  const net_zendure_w = Math.round(net_w + 16 * (r() - 0.5));

  return { net_w, net_zendure_w, zon_w, zonnen, batterij_w, batterij_procent, apparaten: [] };
}

/** Het uur van een moment uit MOMENTEN; "nu" is de klok van dit toestel. */
export function uurVan(momentSleutel, nu = new Date()) {
  const moment = MOMENTEN.find((m) => m.sleutel === momentSleutel);
  if (moment?.uur != null) return moment.uur;
  return nu.getHours() + nu.getMinutes() / 60 + nu.getSeconds() / 3600;
}

const DAG_MS = 86_400_000;

/** Hoeveel kwartieren een dag heeft: 92 als de zomertijd begint, 100 als hij eindigt (de laatste zondag van maart en oktober). */
function kwartierenOp(n) {
  const d = new Date(n * DAG_MS);
  const maand = d.getUTCMonth();
  if (maand !== 2 && maand !== 9) return 96;
  const laatste = new Date(Date.UTC(d.getUTCFullYear(), maand + 1, 0));
  const laatsteZondag = laatste.getUTCDate() - laatste.getUTCDay();
  if (d.getUTCDate() !== laatsteZondag) return 96;
  return maand === 2 ? 92 : 100;
}

/**
 * Eén nepdag zoals de server hem geeft (actie periode, base44/shared/dagen.js),
 * voor een huis zoals huis A: 11 kWp aan panelen, de Zendure die 's
 * winters 's nachts goedkoop uit het net laadt en overdag de zon vangt, en
 * terugleveren met saldering (2026). Zomer veel zon, winter weinig, en elke
 * dag ander weer; alleen de datum telt, dus elke keer hetzelfde.
 */
function voorbeeldDagRij(n) {
  const d = new Date(n * DAG_MS);
  const jaar = d.getUTCFullYear();
  const maand = d.getUTCMonth();
  const dagVanJaar = Math.round((n * DAG_MS - Date.UTC(jaar, 0, 1)) / DAG_MS) + 1;
  const r = ruis(n);
  // 0 rond 21 december, 1 rond 21 juni.
  const seizoen = 0.5 - 0.5 * Math.cos((2 * Math.PI * (dagVanJaar - 355)) / 365);
  const winter = 1 - seizoen;
  const zon = (12 + 58 * seizoen) * Math.min(1, 0.25 + 0.8 * r());
  const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
  const huis = (13.5 + 3 * winter + (weekend ? 2 : 0)) * (0.9 + 0.2 * r());
  // 's Nachts laden uit het net: 's winters vol, 's zomers doet de zon het.
  const nacht = seizoen < 0.35 ? 5 : seizoen < 0.7 ? 3 : 1;
  const zonHuis = Math.min(zon, 0.4 * huis);
  const zonBatterij = Math.min(zon - zonHuis, 9);
  const zonNet = zon - zonHuis - zonBatterij;
  const geladen = nacht + zonBatterij;
  const ontladen = 0.9 * geladen;
  const batterijHuis = Math.min(ontladen, huis - zonHuis);
  const batterijNet = ontladen - batterijHuis;
  const netHuis = huis - zonHuis - batterijHuis;
  const afname = nacht + netHuis;
  const terug = zonNet + batterijNet;
  const kosten = nacht * (0.19 + 0.03 * winter + 0.02 * r()) + netHuis * (0.24 + 0.05 * winter + 0.03 * r());
  const opbrengst = zonNet * (0.2 + 0.03 * winter + 0.02 * r()) + batterijNet * (0.3 + 0.04 * r());
  const dagenInMaand = new Date(Date.UTC(jaar, maand + 1, 0)).getUTCDate();
  return {
    datum: d.toISOString().slice(0, 10),
    zon_kwh: rond(zon, 3),
    huis_kwh: rond(huis, 3),
    geladen_kwh: rond(geladen, 3),
    ontladen_kwh: rond(ontladen, 3),
    afname_kwh: rond(afname, 3),
    teruglevering_kwh: rond(terug, 3),
    kosten_eur: rond(kosten, 4),
    opbrengst_eur: rond(opbrengst, 4),
    vaste_kosten_eur: rond((6.25 + 39.66 - 52.41) / dagenInMaand, 4),
    // 10% van de prijs zonder belasting, met btw: ruim een cent per kWh, alleen overdag.
    zonnebonus_eur: rond(zonNet * 0.011, 4),
    afname_prijs_kwh: rond(kosten / afname, 5),
    teruglevering_prijs_kwh: terug >= 0.05 ? rond(opbrengst / terug, 5) : null,
    compleet: true,
    // Gas (programmaatje 1.4.0): douchen en koken, 's winters meer; vast per dag (zonder de ruis te verschuiven).
    gas_m3: rond((0.35 + 1.6 * winter) * (0.9 + 0.2 * (((n * 7919) % 100) / 100)), 3),
    eigen_verbruik: rond((zonHuis + zonBatterij) / zon, 4),
    zelfvoorzienend: rond(1 - netHuis / huis, 4),
    fasen: [
      [3.5, 14],
      [1.9, 9.8],
      [1.4, 6.6],
    ].map(([a, piek], i) => ({ fase: i + 1, gemiddeld_a: rond(a * (0.85 + 0.3 * winter) * (0.9 + 0.2 * r()), 2), piek_a: rond(piek * (0.85 + 0.3 * r()), 1) })),
    kwartieren: kwartierenOp(n),
    // Per uur van de klok, voor Advies (zoals urenVan in base44/functions/ontvangMeting/dagboek.js).
    ...urenVoorbeeld(huis, zon),
    // Per apparaat (brug 0.12.0): alles herkend, zoals in huis A; de basis is vooral de warmtepomp.
    ...apparatenVoorbeeld(huis, r, weekend, winter),
  };
}

/** De apparaten van een nepdag zoals Dag.apparaten_kwh ze bewaart; samen nooit meer dan het huis. */
function apparatenVoorbeeld(huis, r, weekend, winter) {
  const lijst = [
    { sleutel: 'h:koelkast', soort: 'koelkast', kwh: 0.9 + 0.2 * r(), keer: 34 + Math.round(6 * r()) },
    { sleutel: 'h:waterkoker', soort: 'waterkoker', kwh: 0.18 + 0.12 * r(), keer: 3 + Math.round(3 * r()) },
    r() < 0.5 && { sleutel: 'h:wasmachine', soort: 'wasmachine', kwh: 1.0 + 0.4 * r(), keer: 1 },
    r() < 0.45 && { sleutel: 'h:vaatwasser', soort: 'vaatwasser', kwh: 0.9 + 0.3 * r(), keer: 1 },
    (weekend || r() < 0.2) && { sleutel: 'h:droger', soort: 'droger', kwh: 1.8 + 0.8 * r(), keer: 1 },
    r() < 0.3 && { sleutel: 'h:strijkijzer', soort: 'strijkijzer', kwh: 0.35 + 0.3 * r(), keer: 1 },
    r() < 0.6 && { sleutel: 'h:oven', soort: 'oven', kwh: 0.9 + 0.8 * r(), keer: 1 },
  ]
    .filter(Boolean)
    .map((a) => ({ ...a, kwh: rond(a.kwh, 2), gemeten: false }));
  return { apparaten_kwh: lijst.sort((a, b) => b.kwh - a.kwh), basis_kwh: rond(huis * (0.5 + 0.08 * winter), 2) };
}

/** Het huis en de zon van een nepdag per uur: het huis als een gewone dag, de zon met de nepzon mee. */
const HUIS_VORM = [30, 26, 24, 23, 23, 25, 33, 45, 47, 42, 40, 41, 42, 40, 39, 40, 45, 56, 63, 62, 58, 54, 48, 39];
function urenVoorbeeld(huisKwh, zonKwh) {
  const zonVorm = Array.from({ length: 24 }, (_, h) => zonnestand(h + 0.5));
  const verdeel = (kwh, vorm) => {
    const totaal = vorm.reduce((a, b) => a + b, 0);
    return vorm.map((v) => Math.round((kwh * 1000 * v) / totaal));
  };
  return { huis_uur_wh: verdeel(huisKwh, HUIS_VORM), zon_uur_wh: verdeel(zonKwh, zonVorm), uur_kwartieren: Array(24).fill(4) };
}

/**
 * Nepdagen voor Week, Maand, Kwartaal en Jaar: elke dag van `van` tot en met
 * `tot` ("2026-10-26"), maar alleen tot en met gisteren: vandaag komt uit de
 * stand, net als live.
 */
export function voorbeeldDagen(van, tot, vandaag) {
  const nummer = (datum) => Date.parse(`${datum}T00:00:00Z`) / DAG_MS;
  const einde = Math.min(nummer(tot), nummer(vandaag) - 1);
  const dagen = [];
  for (let n = nummer(van); n <= einde; n++) dagen.push(voorbeeldDagRij(n));
  return dagen;
}
