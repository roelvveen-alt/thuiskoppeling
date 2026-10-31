import { datumInNederland } from './kosten.mjs';

/**
 * Wat er vandaag gebeurde, per kwartier: het gemiddelde vermogen van de zon,
 * het huis, de batterij en het net, en hoe vol de batterij was. Plus kWh van
 * vandaag (vermogen × tijd tussen twee metingen) voor zon, huis, batterij
 * laden en ontladen. Afnemen en terugleveren telt de P1-meter zelf (kosten.mjs).
 *
 * Sinds 1.2.0 ook per meting (elke 5 s) wie aan wie leverde, met dezelfde
 * verdeling als de app (stromenNu hieronder, verdeelStroom in src/lib/stroom.js):
 * `kwh.zon_zelf` (zon naar huis of batterij) en `kwh.net_huis` (net naar huis).
 * Daarmee rekent de server eigen verbruik en zelfvoorzienend precies; eerst
 * deed hij dat op kwartiergemiddelden, en dan vielen afnemen en terugleveren
 * binnen een kwartier tegen elkaar weg (rekenregels-7). Een dag die al liep
 * onder een oudere versie (vandaag.json zonder die tellers) stuurt ze niet:
 * dan rekent de server die dag nog zoals eerst; de volgende dag telt het mee.
 *
 * Het huis: alles wat binnenkomt min alles wat eruit gaat, nooit onder 0 —
 * dezelfde som als de site (src/lib/stroom.js) en de server (kwartierDelen in
 * base44/functions/ontvangMeting/dagboek.js); dag.test.js houdt ze gelijk:
 *
 *     huis = zon + batterij (plus = levert) + net (plus = afnemen)
 *
 * Per fase van de P1-meter: per kwartier de gemiddelde stroom (A) en het
 * vermogen (W), en over de dag het gemiddelde en de piek. Van de laatste 7
 * dagen blijven die daggemiddelden bewaard (`week`), zodat de app kan zeggen
 * welke fase gemiddeld het hoogst en het laagst zit.
 *
 * Panelen op meer plekken (meting.zonnen, bijvoorbeeld het huis en het
 * dierenverblijf; sinds 0.10.0): per plek ook het gemiddelde per kwartier
 * (`zonnen`), zodat de app per plek leert wat de panelen bij zoveel licht
 * leveren (het tabblad Voorspelling). Met één plek is dat gewoon de zon, dan
 * gaat het niet apart mee.
 *
 * Bewaard in vandaag.json (overleeft een herstart); een nieuwe dag begint
 * leeg (alleen de week gaat mee). Geen null in wat naar de app gaat: per
 * kwartier staat er hoeveel metingen erin zitten (`metingen`), 0 = geen
 * meting, en dan is de waarde 0.
 */

export const STAP_MIN = 15;
const STAP_MS = STAP_MIN * 60_000;
/** Langer dan dit tussen twee metingen telt niet als verbruik: het programmaatje stond stil. */
const HOOGSTENS_GAT_MS = 60_000;
/** Een dag met de wisseling naar wintertijd heeft 25 uur. */
const HOOGSTENS_KWARTIEREN = 100;
/** Dezelfde grenzen als ontvangMeting/controle.js (vermogen in W, stroom per fase in A). */
const GRENS_W = 100_000;
const GRENS_FASE_A = 1000;
const binnen = (v, min, max) => (v === null ? null : Math.min(max, Math.max(min, v)));
/** Hooguit zoveel plekken met panelen apart in de dag (de app neemt er ook zoveel aan). */
export const HOOGSTENS_ZONNEN = 6;
/** Een sleutel van een zonnebron zoals de app hem aanneemt. */
const ZON_SLEUTEL = /^[\w.:-]{1,60}$/;

/** Middernacht (Nederlandse tijd) van de dag waarin `ms` valt, in ms. */
export function middernacht(ms) {
  const datum = datumInNederland(ms);
  const [j, m, d] = datum.split('-').map(Number);
  // Middernacht in Nederland is 22:00 of 23:00 UTC de dag ervoor.
  for (const uren of [2, 1]) {
    const kandidaat = Date.UTC(j, m - 1, d) - uren * 3_600_000;
    if (datumInNederland(kandidaat) === datum && datumInNederland(kandidaat - 1) !== datum) return kandidaat;
  }
  return Date.UTC(j, m - 1, d) - 3_600_000;
}

const DAGEN_BEWAARD = 7;

/** Per fase het daggemiddelde en de piek van een logboek, of null als er geen fasen waren. */
function faseSamenvatting(logboek) {
  const fasen = Object.entries(logboek?.fasenDag ?? {})
    .filter(([, f]) => f.n > 0)
    .map(([fase, f]) => ({ fase: Number(fase), gemiddeld_a: Math.round((f.som / f.n) * 100) / 100, piek_a: Math.round(f.piek * 10) / 10 }));
  return fasen.length ? { datum: logboek.datum, fasen } : null;
}

/**
 * Gas, water en warmte van de dag (1.4.0), uit de standen van de meters die aan
 * de slimme meter hangen (meterkastUit in homewizard.mjs): per soort de stand
 * aan het begin van de dag en de laatste. Een nieuwe dag begint bij de laatste
 * stand van gisteren, zodat er tussen twee dagen niets verloren gaat. Per soort
 * de naam van het veld in de app en de grootste sprong tussen twee lezingen die
 * nog kan (een nieuwe meter, of een rare lezing: dan telt die sprong niet mee).
 */
export const DAG_METERS = Object.freeze({
  gas: { veld: 'gas_m3', eenheid: 'm3', sprong: 50 },
  water: { veld: 'water_m3', eenheid: 'm3', sprong: 20 },
  warmte: { veld: 'warmte_gj', eenheid: 'GJ', sprong: 5 },
});

/** Wat er van de meters naar een nieuwe dag gaat: de laatste stand wordt het begin. */
const metersNaarNieuweDag = (meters) =>
  Object.fromEntries(Object.entries(meters ?? {}).filter(([, m]) => typeof m?.laatst === 'number').map(([soort, m]) => [soort, { begin: m.laatst, laatst: m.laatst }]));

/** De meters van deze meting erbij: { soort: { begin, laatst } }. */
function metersBij(oud, meting) {
  const meters = { ...(oud ?? {}) };
  for (const m of Array.isArray(meting?.meterkast?.meters) ? meting.meterkast.meters : []) {
    const regel = DAG_METERS[m?.soort];
    const stand = getal(m?.stand);
    if (!regel || m.eenheid !== regel.eenheid || stand === null || stand < 0) continue;
    const vorig = meters[m.soort];
    if (!vorig) {
      meters[m.soort] = { begin: stand, laatst: stand };
      continue;
    }
    const sprong = stand - vorig.laatst;
    // Terug of te ver vooruit (een nieuwe meter): wat er vandaag al was, blijft; die sprong telt niet.
    meters[m.soort] = sprong < 0 || sprong > regel.sprong ? { begin: stand - (vorig.laatst - vorig.begin), laatst: stand } : { begin: vorig.begin, laatst: stand };
  }
  return meters;
}

/** Wat de meters vandaag telden, in de velden van de app: { gas_m3: 1.234, … }; zonder meters leeg. */
export function metersVandaag(meters) {
  const uit = {};
  for (const [soort, regel] of Object.entries(DAG_METERS)) {
    const m = meters?.[soort];
    if (typeof m?.begin === 'number' && typeof m?.laatst === 'number') uit[regel.veld] = Math.round(Math.max(0, m.laatst - m.begin) * 1000) / 1000;
  }
  return uit;
}

/**
 * Het blok meterkast voor de app met bij elke meter wat hij vandaag telde
 * (`vandaag`, uit het logboek van vandaag): zo staat "gas vandaag" ook op Nu,
 * elke meting, en niet pas als de dag (eens per minuut) meegaat.
 */
export function meterkastMetVandaag(meterkast, logboek) {
  if (!meterkast?.meters?.length) return meterkast ?? null;
  const vandaag = metersVandaag(logboek?.meters);
  return {
    ...meterkast,
    meters: meterkast.meters.map((m) => {
      const veld = DAG_METERS[m.soort]?.eenheid === m.eenheid ? DAG_METERS[m.soort].veld : null;
      return veld && vandaag[veld] !== undefined ? { ...m, vandaag: vandaag[veld] } : m;
    }),
  };
}

/** Een nieuwe dag; de daggemiddelden per fase van de vorige dag gaan mee in de week, de meterstanden als begin. */
export function nieuwLogboek(nu, vorig = null) {
  const gisteren = faseSamenvatting(vorig);
  const week = [...(vorig?.week ?? []), ...(gisteren ? [gisteren] : [])].slice(-DAGEN_BEWAARD);
  const meters = metersNaarNieuweDag(vorig?.meters);
  return {
    datum: datumInNederland(nu),
    van: middernacht(nu),
    sinds: nu,
    laatste: null,
    kwartieren: [],
    kwh: { zon: 0, huis: 0, geladen: 0, ontladen: 0, zon_zelf: 0, net_huis: 0 },
    fasenDag: {},
    week,
    ...(Object.keys(meters).length ? { meters } : {}),
  };
}

const getal = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const plus = (w) => (Number.isFinite(w) && w > 0 ? w : 0);
/** Hele watts, zoals heleWatt in src/lib/stroom.js (een halve watt weg van nul). */
const heleWatt = (w) => {
  if (w === null) return null;
  const heel = Math.round(Math.abs(w));
  return w < 0 && heel > 0 ? -heel : heel;
};

/**
 * Eén meting verdeeld zoals de app (verdeelStroom in src/lib/stroom.js) en de
 * server (kwartierDelen in base44/functions/ontvangMeting/dagboek.js): eerst
 * elke meter op hele watts, de batterij gaat voor. Alleen wat eigen verbruik
 * en zelfvoorzienend nodig hebben, zonder drempels. dag.test.js houdt het gelijk.
 * @returns {{ zonZelf: number, netHuis: number }} W: zon naar huis of batterij, net naar huis
 */
export function stromenNu(zonW, batterijW, netW) {
  const zon = plus(heleWatt(zonW));
  const batterij = heleWatt(batterijW);
  const net = heleWatt(netW);
  const laden = plus(-(batterij ?? 0));
  const ontladen = plus(batterij);
  const afname = plus(net);
  const terug = plus(-(net ?? 0));
  const huisNodig = Math.max(0, zon + ontladen + afname - laden - terug);
  const zonNaarBatterij = Math.min(zon, laden);
  const zonNaarHuis = Math.min(zon - zonNaarBatterij, huisNodig);
  const batterijNaarHuis = Math.min(ontladen, huisNodig - zonNaarHuis);
  const netNaarBatterij = Math.min(afname, laden - zonNaarBatterij);
  const netNaarHuis = Math.min(afname - netNaarBatterij, huisNodig - zonNaarHuis - batterijNaarHuis);
  return { zonZelf: zonNaarHuis + zonNaarBatterij, netHuis: netNaarHuis };
}

/**
 * Eén meting erbij (geeft een nieuw logboek; het oude blijft zoals het was).
 * @param {object|null} logboek
 * @param {{ zon_w, batterij_w, net_w, batterij_procent }} meting  zoals maakMeting hem geeft
 */
export function logMeting(logboek, meting, nu) {
  const vers = logboek?.datum === datumInNederland(nu) ? logboek : nieuwLogboek(nu, logboek);
  const index = Math.floor((nu - vers.van) / STAP_MS);
  if (index < 0 || index >= HOOGSTENS_KWARTIEREN) return vers;

  // Binnen de grenzen die de app aanneemt (ontvangMeting/controle.js): één rare lezing
  // (de Zendure meldt 101 %) mag de dag niet laten afkeuren.
  const zon = binnen(getal(meting?.zon_w), -GRENS_W, GRENS_W);
  const batterij = binnen(getal(meting?.batterij_w), -GRENS_W, GRENS_W);
  const net = binnen(getal(meting?.net_w), -GRENS_W, GRENS_W);
  const procent = binnen(getal(meting?.batterij_procent), 0, 100);
  // Zonder net is het huis niet te weten: alle teruglevering zou dan "huis" worden.
  // Zoals verdeelStroom in src/lib/stroom.js: eerst elke meter op hele watts, zon nooit onder 0
  // (dag.test.js loopt dezelfde gevallen door als de site en de server).
  const heel = (v) => Math.round(v ?? 0);
  const huis = net === null ? null : Math.max(0, Math.max(0, heel(zon)) + heel(batterij) + heel(net));

  const kwartieren = [...vers.kwartieren];
  const oud = kwartieren[index] ?? { n: 0, zon: 0, huis: 0, batterij: 0, net: 0, procent: 0, np: 0, nz: 0, nb: 0, nn: 0, nh: 0, heeft: {} };
  // Per reeks een eigen teller: een meting zonder net (of zon, of batterij) telt daar niet als 0 mee.
  // Een kwartier van een oudere versie had er één voor alles (n).
  const teller = (veld) => oud[veld] ?? oud.n;
  // Per fase: som van stroom en vermogen in dit kwartier, en over de dag gemiddelde en piek.
  const fasen = { ...(oud.f ?? {}) };
  const fasenDag = { ...(vers.fasenDag ?? {}) };
  for (const f of Array.isArray(meting?.fasen) ? meting.fasen : []) {
    const a = binnen(getal(f?.a), 0, GRENS_FASE_A);
    if (a === null || ![1, 2, 3].includes(f.fase)) continue;
    const w = binnen(getal(f.w), -GRENS_W, GRENS_W) ?? 0;
    const q = fasen[f.fase] ?? { a: 0, w: 0, n: 0 };
    fasen[f.fase] = { a: q.a + a, w: q.w + w, n: q.n + 1 };
    const d = fasenDag[f.fase] ?? { som: 0, n: 0, piek: 0 };
    fasenDag[f.fase] = { som: d.som + a, n: d.n + 1, piek: Math.max(d.piek, a) };
  }
  // Per plek met panelen: som en aantal in dit kwartier (alleen bij meer dan één plek nuttig, zie dagVoorApp).
  const perZon = { ...(oud.z ?? {}) };
  for (const z of Array.isArray(meting?.zonnen) ? meting.zonnen : []) {
    const w = binnen(getal(z?.vermogen_w), -GRENS_W, GRENS_W);
    if (w === null || typeof z.sleutel !== 'string' || !ZON_SLEUTEL.test(z.sleutel)) continue;
    if (!perZon[z.sleutel] && Object.keys(perZon).length >= HOOGSTENS_ZONNEN) continue;
    const q = perZon[z.sleutel] ?? { s: 0, n: 0 };
    perZon[z.sleutel] = { s: q.s + Math.max(0, w), n: q.n + 1 };
  }
  kwartieren[index] = {
    f: fasen,
    ...(Object.keys(perZon).length ? { z: perZon } : {}),
    n: oud.n + 1,
    zon: oud.zon + (zon ?? 0),
    huis: oud.huis + (huis ?? 0),
    batterij: oud.batterij + (batterij ?? 0),
    net: oud.net + (net ?? 0),
    procent: oud.procent + (procent ?? 0),
    np: oud.np + (procent === null ? 0 : 1),
    nz: teller('nz') + (zon === null ? 0 : 1),
    nb: teller('nb') + (batterij === null ? 0 : 1),
    nn: teller('nn') + (net === null ? 0 : 1),
    nh: teller('nh') + (huis === null ? 0 : 1),
    heeft: { ...oud.heeft, ...(zon === null ? {} : { zon: true }), ...(batterij === null ? {} : { batterij: true }), ...(net === null ? {} : { net: true }) },
  };

  const kwh = { ...vers.kwh };
  const gat = vers.laatste === null ? null : nu - vers.laatste;
  if (gat !== null && gat > 0 && gat <= HOOGSTENS_GAT_MS) {
    const uren = gat / 3_600_000;
    kwh.zon += (Math.max(0, zon ?? 0) * uren) / 1000;
    kwh.huis += ((huis ?? 0) * uren) / 1000;
    kwh.geladen += (Math.max(0, -(batterij ?? 0)) * uren) / 1000;
    kwh.ontladen += (Math.max(0, batterij ?? 0) * uren) / 1000;
    // Wie aan wie (1.2.0), alleen als de dag ermee begon (een dag van een oudere versie heeft ze niet).
    // Zonder net is het huis niet te weten (huis is dan null): dan ook geen stromen.
    if (typeof kwh.zon_zelf === 'number' && typeof kwh.net_huis === 'number' && huis !== null) {
      const s = stromenNu(zon, batterij, net);
      kwh.zon_zelf += (s.zonZelf * uren) / 1000;
      kwh.net_huis += (s.netHuis * uren) / 1000;
    }
  }
  const meters = metersBij(vers.meters, meting);
  return { ...vers, laatste: nu, kwartieren, kwh, fasenDag, ...(Object.keys(meters).length ? { meters } : {}) };
}

/**
 * Wat de app krijgt: per kwartier het gemiddelde, afgerond op hele watt en
 * procenten. Een reeks die vandaag nooit een waarde had (bijvoorbeeld geen
 * batterij) gaat niet mee. Ontbrekende batterijprocenten houden de vorige
 * waarde vast; een lijn die naar 0% duikt omdat de batterij even niet
 * antwoordde, zou niet kloppen.
 */
export function dagVoorApp(logboek) {
  if (!logboek || logboek.kwartieren.length === 0) return null;
  const k = Array.from({ length: logboek.kwartieren.length }, (_, i) => logboek.kwartieren[i] ?? null);
  const TELLER = { zon: 'nz', batterij: 'nb', net: 'nn', huis: 'nh' };
  const gemiddeld = (veld) =>
    k.map((q) => {
      const n = q ? (q[TELLER[veld]] ?? q.n) : 0;
      return n ? Math.round(q[veld] / n) : 0;
    });
  const heeft = (veld) => k.some((q) => q?.heeft?.[veld]);
  let vorig = 0;
  const procent = k.map((q) => {
    if (q && q.np) vorig = Math.round(q.procent / q.np);
    return q && q.n ? vorig : 0;
  });
  const r = (v) => Math.round(v * 1000) / 1000;
  const samenvatting = faseSamenvatting(logboek);
  const fasen = (samenvatting?.fasen ?? []).map(({ fase, gemiddeld_a, piek_a }) => ({
    fase,
    a: k.map((q) => (q?.f?.[fase]?.n ? Math.round((q.f[fase].a / q.f[fase].n) * 10) / 10 : 0)),
    w: k.map((q) => (q?.f?.[fase]?.n ? Math.round(q.f[fase].w / q.f[fase].n) : 0)),
    gemiddeld_a,
    piek_a,
  }));
  // Per plek met panelen, op volgorde van eerste keer gezien; alleen bij twee of meer plekken.
  const sleutels = [];
  for (const q of k) for (const sleutel of Object.keys(q?.z ?? {})) if (!sleutels.includes(sleutel)) sleutels.push(sleutel);
  const zonnen =
    sleutels.length >= 2
      ? sleutels.slice(0, HOOGSTENS_ZONNEN).map((sleutel) => ({ sleutel, w: k.map((q) => (q?.z?.[sleutel]?.n ? Math.round(q.z[sleutel].s / q.z[sleutel].n) : 0)) }))
      : [];
  return {
    datum: logboek.datum,
    van: new Date(logboek.van).toISOString(),
    stap_min: STAP_MIN,
    sinds: new Date(logboek.sinds).toISOString(),
    metingen: k.map((q) => q?.n ?? 0),
    huis_w: gemiddeld('huis'),
    ...(heeft('zon') ? { zon_w: gemiddeld('zon') } : {}),
    ...(heeft('batterij') ? { batterij_w: gemiddeld('batterij'), procent } : {}),
    ...(heeft('net') ? { net_w: gemiddeld('net') } : {}),
    kwh: {
      zon: r(logboek.kwh.zon),
      huis: r(logboek.kwh.huis),
      geladen: r(logboek.kwh.geladen),
      ontladen: r(logboek.kwh.ontladen),
      // 1.2.0: per meting verdeeld (een oudere functie laat ze stil vallen, controle.js neemt alleen wat hij kent).
      ...(typeof logboek.kwh.zon_zelf === 'number' && typeof logboek.kwh.net_huis === 'number'
        ? { zon_zelf: r(logboek.kwh.zon_zelf), net_huis: r(logboek.kwh.net_huis) }
        : {}),
    },
    ...(fasen.length ? { fasen } : {}),
    ...(zonnen.length ? { zonnen } : {}),
    ...(logboek.week?.length ? { week: logboek.week } : {}),
    // Gas, water en warmte van vandaag (1.4.0); een oudere functie laat ze stil vallen.
    ...metersVandaag(logboek.meters),
  };
}
