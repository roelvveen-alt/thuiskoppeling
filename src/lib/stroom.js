/**
 * Wie levert er nu stroom aan wie?
 *
 * De meters geven per plek één getal: wat er bij de meterkast in of uit gaat,
 * wat de panelen leveren en wat de batterij laadt of levert. Welke watt van de
 * zon in de wasmachine belandt, meet niemand. Wat het huis gebruikt volgt uit
 * de som (alles wat binnenkomt min alles wat eruit gaat), en dat verdelen we
 * met de batterij voorop ("bat is leidend"):
 *
 *   batterij laadt   de zon eerst naar de batterij (tot wat die laadt), dan naar
 *                    het huis, de rest naar het net. Wat de batterij meer laadt
 *                    dan de zon geeft, komt uit het net, en wat het huis dan nog
 *                    mist ook.
 *   batterij levert  de zon eerst naar het huis; de batterij vult aan wat het
 *                    huis nog mist, de rest van de batterij gaat naar het net;
 *                    het net vult aan wat dan nog ontbreekt.
 *
 * De wens bij het laden: "daar moet komen dat de accu laadt met de zon energie en
 * hoeveel + wat er dan nog overblijft die 49 w dat gaat naar het net", en
 * "leveren de 2 zonnen meters samen 1000 w en trek ik 2300 naar de bat komt er
 * 1300 uit het net". Eerst kreeg het huis de zon vóór de batterij. Om 11:08
 * (zon 1.078 W, batterij laadt 2.418 W, huis 460 W) stond er dan "het huis
 * draait helemaal op de zon" en "de batterij laadt 1,8 kW uit het net", terwijl
 * je de zon in de batterij zag gaan.
 *
 * Bij het leveren blijft de zon eerst voor het huis. Daar ging eerst de zon
 * naar het net en kreeg het huis de rest; in huis A stond dan "het huis komt
 * van de batterij" terwijl de zon 680 W gaf en de batterij 1,7 kW aan het net
 * verkocht.
 *
 * Alles in hele watts: elke meter wordt eerst afgerond (elke zonnemeter, de
 * batterij, het net), daarna rekenen we. Zo is het huis overal precies
 * hetzelfde getal en telt elke som tot op de watt op. Ook per plek met panelen
 * (stand.zonnen, bijvoorbeeld het hoofddak en het dierenverblijf): elke
 * zon-stroom wordt naar rato verdeeld, in hele watts die per plek optellen tot
 * wat die plek levert en per stroom tot het totaal. De zon is de som van die
 * plekken.
 *
 * Tekens, zoals de meters ze geven:
 *   net_w       plus = je neemt af van het net, min = je levert terug
 *   batterij_w  plus = de batterij levert (ontladen), min = de batterij laadt
 *   zon_w       wat de panelen leveren (nooit min)
 *
 * Een meter die er niet is, staat op null; die doet niet mee en krijgt geen lijn.
 */
import { NIETS_W, STROOM_W } from './nuInWoorden';

/** Onder dit vermogen tekenen we geen lijn: dat is meetruis of sluipverbruik van de meter zelf (nuInWoorden.js). */
export const DREMPEL_W = STROOM_W;

const plus = (w) => (Number.isFinite(w) && w > 0 ? w : 0);

/** Hele watts met het teken erbij, zoals vermogen() ze laat zien: −647,5 → −648, 0,4 → 0. Geen getal: null. */
export function heleWatt(w) {
  if (typeof w !== 'number' || !Number.isFinite(w)) return null;
  const heel = Math.round(Math.abs(w));
  return w < 0 && heel > 0 ? -heel : heel;
}

/**
 * Elke stroom van de zon over de plekken met panelen, naar rato van wat elke
 * plek levert, in hele watts. Plek voor plek: wat er van elke stroom nog over
 * is, naar rato; de grootste resten krijgen de laatste watt. Zo telt elke plek
 * op tot wat hij levert en elke stroom tot zijn totaal; de laatste plek krijgt
 * precies wat er over is.
 *
 * @param {Array<{ sleutel: string, w: number }>} bronnen  plekken met meer dan 0 W
 * @param {Record<string, number>} totalen  per bestemming; samen evenveel als de bronnen
 */
function overPlekken(bronnen, totalen) {
  const naar = Object.keys(totalen);
  const rest = naar.map((n) => totalen[n]);
  let restZon = bronnen.reduce((som, b) => som + b.w, 0);
  const uit = [];
  bronnen.forEach((bron, i) => {
    let delen = [...rest];
    if (i < bronnen.length - 1) {
      const precies = rest.map((r) => (r * bron.w) / restZon);
      delen = precies.map(Math.floor);
      let over = bron.w - delen.reduce((som, d) => som + d, 0);
      const volgorde = precies.map((p, j) => ({ j, deel: p - Math.floor(p) })).sort((a, b) => b.deel - a.deel || a.j - b.j);
      for (const { j } of volgorde) {
        if (over <= 0) break;
        delen[j] += 1;
        over -= 1;
      }
    }
    naar.forEach((n, j) => {
      rest[j] -= delen[j];
      uit.push({ van: bron.sleutel, naar: n, w: delen[j] });
    });
    restZon -= bron.w;
  });
  return uit;
}

/**
 * @param {{ zon_w?: number|null, net_w?: number|null, batterij_w?: number|null,
 *           zonnen?: Array<{ sleutel: string, vermogen_w?: number|null }>,
 *           apparaten?: Array<{ sleutel: string, vermogen_w?: number|null }> }} stand
 * @returns {{
 *   huis_w: number, zon_w: number, overig_w: number,
 *   batterij_w: number|null, net_w: number|null,
 *   plekken: Array<{ sleutel: string, w: number }>,
 *   soorten: Record<'zon>batterij'|'zon>huis'|'zon>net'|'batterij>huis'|'batterij>net'|'net>batterij'|'net>huis', number>,
 *   stromen: Array<{ van: string, naar: string, w: number }>,
 * }}
 *   batterij_w, net_w en plekken: de meters in hele watts (plekken: elke plek met panelen die iets meet).
 *   soorten: elke stroom per soort, precies (om mee te rekenen, zoals in dagoverzicht.js).
 *   stromen: om te laten zien, per plek; zonder meetruis: niets onder 5 W, geen zon-stromen
 *   als de zon onder 20 W blijft, en niets naar of uit het net als dat binnen ±20 W blijft.
 */
export function verdeelStroom(stand) {
  const plekken = (Array.isArray(stand?.zonnen) ? stand.zonnen : [])
    .filter((z) => z?.sleutel)
    .map((z) => ({ sleutel: z.sleutel, w: heleWatt(z.vermogen_w) }))
    .filter((z) => z.w !== null);
  const bronnen = plekken.filter((z) => z.w > 0);
  const zon = Array.isArray(stand?.zonnen) && stand.zonnen.length ? bronnen.reduce((som, z) => som + z.w, 0) : plus(heleWatt(stand?.zon_w));
  const batterij = heleWatt(stand?.batterij_w);
  const net = heleWatt(stand?.net_w);
  const laden = plus(-(batterij ?? 0));
  const ontladen = plus(batterij);
  const afname = plus(net);
  const terug = plus(-(net ?? 0));

  // Wat het huis gebruikt: alles wat binnenkomt min alles wat eruit gaat.
  // Kloppen de meters onderling even niet (ze meten niet op precies hetzelfde
  // moment), dan wordt het hooguit 0, nooit min.
  const huisNodig = Math.max(0, zon + ontladen + afname - laden - terug);

  // De batterij gaat voor: laadt hij, dan krijgt hij de zon eerst.
  const zonNaarBatterij = Math.min(zon, laden);
  const zonNaarHuis = Math.min(zon - zonNaarBatterij, huisNodig);
  const zonNaarNet = Math.min(zon - zonNaarBatterij - zonNaarHuis, terug);

  // Levert hij, dan vult hij eerst het huis aan; de rest gaat naar het net.
  const batterijNaarHuis = Math.min(ontladen, huisNodig - zonNaarHuis);
  const batterijNaarNet = Math.min(ontladen - batterijNaarHuis, Math.max(0, terug - zonNaarNet));

  // Het net: eerst wat de batterij meer laadt dan de zon geeft, dan wat het huis nog mist.
  const netNaarBatterij = Math.min(afname, laden - zonNaarBatterij);
  const netNaarHuis = Math.min(afname - netNaarBatterij, huisNodig - zonNaarHuis - batterijNaarHuis);

  const huis_w = zonNaarHuis + batterijNaarHuis + netNaarHuis;
  const soorten = {
    'zon>batterij': zonNaarBatterij,
    'zon>huis': zonNaarHuis,
    'zon>net': zonNaarNet,
    'batterij>huis': batterijNaarHuis,
    'batterij>net': batterijNaarNet,
    'net>batterij': netNaarBatterij,
    'net>huis': netNaarHuis,
  };

  // Wat we laten zien: geen meetruis, en dezelfde grenzen als de zinnen (nuInWoorden.js).
  const geenZon = zon < NIETS_W;
  const netStil = net === null || Math.abs(net) < NIETS_W;
  const telt = (van, naar) => {
    if (soorten[`${van}>${naar}`] < STROOM_W) return false;
    if (van === 'zon' && geenZon) return false;
    return !(netStil && (van === 'net' || naar === 'net'));
  };
  const zonNaar = { batterij: zonNaarBatterij, huis: zonNaarHuis, net: zonNaarNet };
  const zonStromen = bronnen.length
    ? overPlekken(bronnen, zonNaar).filter((s) => s.w > 0 && telt('zon', s.naar))
    : Object.entries(zonNaar)
        .filter(([naar]) => telt('zon', naar))
        .map(([naar, w]) => ({ van: 'zon', naar, w }));
  const stromen = [
    ...zonStromen,
    ...[
      ['batterij', 'net'],
      ['batterij', 'huis'],
      ['net', 'batterij'],
      ['net', 'huis'],
    ]
      .filter(([van, naar]) => telt(van, naar))
      .map(([van, naar]) => ({ van, naar, w: soorten[`${van}>${naar}`] })),
  ];

  let apart = 0;
  for (const apparaat of stand?.apparaten ?? []) {
    const w = plus(heleWatt(apparaat?.vermogen_w));
    apart += w;
    if (w >= STROOM_W) stromen.push({ van: 'huis', naar: apparaat.sleutel, w });
  }

  return {
    huis_w,
    zon_w: zon,
    batterij_w: batterij,
    net_w: net,
    plekken,
    // Wat het huis gebruikt zonder eigen meter: lampen, de router, de tv.
    overig_w: Math.max(0, huis_w - apart),
    soorten,
    stromen,
  };
}

/**
 * De lijnen op de tekening: hoe de stroom echt loopt. Alles gaat via de
 * meterkast in huis: de panelen en de batterij leveren aan het huis, en wat
 * het huis over heeft, gaat via de slimme meter naar het net. Er loopt dus
 * nooit een lijn van de zon of de batterij rechtstreeks naar het net (de wens:
 * "Alles gaat via de slimme meter (huis), van daar naar het net").
 *
 * Dezelfde grenzen als de zinnen: onder 20 W zon samen geen zon-lijnen, en
 * binnen ±20 W geen lijn naar of van het net (daar zegt de app "niets").
 *
 * Wie aan wie levert (verdeelStroom) blijft voor de detailbladen en de tegels.
 *
 * @returns {Array<{ van: string, naar: string, w: number }>}
 */
export function lijnenVoorTekening(stand) {
  const lijnen = [];
  const zonnen = Array.isArray(stand?.zonnen) && stand.zonnen.length ? stand.zonnen.filter((z) => z?.sleutel) : null;
  const zonLijnen = zonnen
    ? zonnen.map((z) => ({ van: z.sleutel, naar: 'huis', w: plus(heleWatt(z.vermogen_w)) }))
    : [{ van: 'zon', naar: 'huis', w: plus(heleWatt(stand?.zon_w)) }];
  if (zonLijnen.reduce((som, l) => som + l.w, 0) >= NIETS_W) lijnen.push(...zonLijnen);

  const batterij = heleWatt(stand?.batterij_w) ?? 0;
  lijnen.push(batterij > 0 ? { van: 'batterij', naar: 'huis', w: batterij } : { van: 'huis', naar: 'batterij', w: plus(-batterij) });
  const net = heleWatt(stand?.net_w) ?? 0;
  if (Math.abs(net) >= NIETS_W) lijnen.push(net > 0 ? { van: 'net', naar: 'huis', w: net } : { van: 'huis', naar: 'net', w: -net });

  for (const apparaat of stand?.apparaten ?? []) lijnen.push({ van: 'huis', naar: apparaat.sleutel, w: plus(heleWatt(apparaat?.vermogen_w)) });
  return lijnen.filter((l) => l.w >= STROOM_W);
}

/** De stromen die bij één punt horen, uitgesplitst naar wat erin komt en wat eruit gaat. */
export function stromenBij(sleutel, stromen) {
  return {
    erin: stromen.filter((s) => s.naar === sleutel),
    eruit: stromen.filter((s) => s.van === sleutel),
  };
}

/**
 * De stromen van een groep punten samen (alle plekken met panelen: het blad
 * "Zon" van de Zon-tegel op Nu, weergave-18), per ander punt opgeteld, met
 * `naam` als de sleutel van de groep. Stromen binnen de groep tellen niet.
 *
 * @param {string[]} sleutels  de punten in de groep
 * @param {string} naam  de sleutel van de groep (ZON_SAMEN)
 */
export function stromenSamen(sleutels, naam, stromen) {
  const binnen = new Set(sleutels);
  const tel = (kant) => {
    const som = new Map();
    for (const s of stromen) {
      const hier = kant === 'erin' ? s.naar : s.van;
      const ander = kant === 'erin' ? s.van : s.naar;
      if (binnen.has(hier) && !binnen.has(ander)) som.set(ander, (som.get(ander) ?? 0) + s.w);
    }
    return [...som].map(([ander, w]) => (kant === 'erin' ? { van: ander, naar: naam, w } : { van: naam, naar: ander, w }));
  };
  return { erin: tel('erin'), eruit: tel('eruit') };
}
