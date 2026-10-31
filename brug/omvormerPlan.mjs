import { datumInNederland } from './kosten.mjs';
import { AAN as SCHAKELAAR_AAN, UIT as SCHAKELAAR_UIT, VRIJ } from './omvormerSturen.mjs';
import { EINDE_SALDERING, kaleTeruglevering, naPlafond, waardeTeruglevering } from './prijzen.mjs';
import { inGewoneWoorden } from './web.mjs';

/**
 * De omvormer begrenzen als terugleveren geld kost (programmaatje 1.5.0, 1.6.0): het plan en de
 * besturing. Het schrijven zelf (twee registers, een harde lijst van waarden: de grens 40336 en
 * de schakelaar 40327) staat in omvormerSturen.mjs; hier wordt alleen beslist wanneer, hoeveel
 * en hoe vaak. Begrenzen = de grens zetten en dan de schakelaar aan; bijstellen = alleen de
 * grens; vrijgeven = alleen de schakelaar uit (de grens blijft staan, zoals de installateur hem
 * achterliet: met de schakelaar uit doet die niets).
 *
 * Wanneer loont het (31-10-2026: "kijk ook naar 2027 als saldering wegvalt")?
 *   Niet bij elke negatieve prijs. Per kwartier de echte waarde van een teruggeleverde kWh
 *   (waardeTeruglevering in prijzen.mjs): met saldering (tot 2027) en als je over het jaar
 *   meer afneemt dan teruglevert, komt de energiebelasting terug; dan is terugleveren pas
 *   onder nul als ook de prijs met belasting onder nul is. Vanaf 2027 (of als je meer
 *   teruglevert dan afneemt) telt alleen de kale prijs plus de Zonnebonus. Alleen kwartieren
 *   met een waarde onder nul vormen een blok; een negatieve kale prijs die door de saldering
 *   niet loont, staat er wel bij ('loont-niet'), zodat de app het kan uitleggen.
 *
 * Hoeveel ("kan ik al mijn stroom zelf gebruiken, dan moet hij uiteraard aanblijven"):
 *   Gedeeltelijk, tot ongeveer wat het huis en de batterij nu zelf gebruiken (plus MARGE_W),
 *   in stappen van 10% van het vermogen van de omvormer; helemaal uit (0%) alleen als ook
 *   afnemen geld oplevert (afnameprijs onder nul): dan is stroom uit het net beter dan eigen
 *   zon. Ook als 0% volgens de som per uur net goedkoper lijkt, niet zolang afnemen geld kost
 *   (1.6.1): dan komt het huis uit het net, gaat hij weer omhoog, en zo heen en weer. Geen
 *   teruglevering van betekenis (alles wordt zelf gebruikt): niet begrenzen.
 *
 * Live bijsturen, met hysterese (elke ronde, uit de meting: net, zon, batterij):
 *   vrij, en er gaat > EXPORT_W terug, EXPORT_DUUR_MS lang      → begrenzen tot verbruik + marge
 *   begrensd, en er komt > TEKORT_W uit het net (of de batterij
 *     levert), TEKORT_DUUR_MS lang (de wasmachine gaat aan)      → ophogen, of vrijgeven
 *   begrensd, en er gaat nog > EXPORT_W terug, EXPORT_DUUR_MS    → iets verlagen
 *   De drempels liggen uit elkaar, de doelen hebben een marge en de stappen zijn grof: zo
 *   gaat het niet heen en weer. Begrensd rekent hij met wat de zon zou kunnen (de laatste
 *   lezing zonder grens, hooguit ZON_ONTHOUDEN_MS oud), niet met wat de grens nog doorlaat (1.6.1).
 *
 * De schrijfrem (de registers zijn instellingen die een herstart overleven; we nemen aan dat
 * de omvormer ze in flashgeheugen bewaart, dus zuinig). Elke schrijfactie telt, op beide
 * registers: één begrenzing = 2 (grens en schakelaar; de grens niet als hij al goed staat),
 * bijstellen = 1, vrijgeven = 1.
 *   omlaag (ook het eerste begrenzen): minstens OMLAAG_TUSSEN_MS na de vorige schrijfactie
 *   omhoog: minstens OMHOOG_TUSSEN_MS (de wasmachine wacht niet vijf minuten)
 *   hooguit MAX_PER_UUR per uur en MAX_PER_DAG per dag, ook na een herstart (omvormer-sturen.json);
 *   begrenzen begint alleen als er ruimte is voor beide schrijfacties en één keer opnieuw;
 *   vrijgeven mag altijd (vrij is de veilige stand; na een mislukte poging wel OPNIEUW_NA_FOUT_MS
 *   wachten). Na elke schrijfactie teruglezen; klopt het niet: één keer opnieuw, dan opgeven,
 *   vrijgeven en het blok verder met rust laten.
 *
 * De zelfcontrole (1.6.0: "als je denkt dat het werkt, zetten we het gewoon aan"): na
 * elke begrenzing kijkt hij CONTROLE_WACHT_MS tot CONTROLE_MS lang of het effect er is (alleen
 * als er genoeg zon was om het te zien: ZICHTBAAR_W meer dan de grens). Levert de omvormer niet
 * meer dan ongeveer de grens, of zakt de teruglevering op de P1 duidelijk: "nagekeken: werkt"
 * (met datum). Blijft hij leveren, of levert hij veel minder dan bedoeld (0 W bij 50%: de grens
 * telt dan anders): eerst nog één keer kijken (1.6.1: een wolk), dan pas vrij, en niet meer
 * proberen tot de eigenaar het in de app opnieuw aanzet ("werkt niet op deze omvormer"; bewaard
 * in omvormer-sturen.json, in de app en het Logboek). "Veel minder dan bedoeld" telt alleen als
 * de zon elders niet ook viel: zakte een andere zonmeter net zo, haalde hij de grens even toch,
 * of wisselde de zon vooraf al sterk, dan is het het weer en geen oordeel (1.6.1).
 *
 * Verder: alleen als de eigenaar het in de app aanzette (standaard uit; een oudere functie stuurt
 * het niet mee: uit). Per dag "niet", en "Nu weer aan" (meteen vrij, de rest van dat blok niet
 * meer). Zet iemand anders de schakelaar uit (de app van GoodWe), dan vechten we niet. Staat de
 * schakelaar aan terwijl wij hem niet aanzetten: niets schrijven (die is van een ander); staat hij
 * uit, dan is de omvormer vrij, wat de grens ook zegt. Slaapt de omvormer: wachten (geen fout). Bij het opstarten (als
 * het ooit aanstond): lezen, en staat hij buiten een blok door ons begrensd, vrijgeven. Bij het
 * stoppen (stop()): niets meer schrijven behalve vrijgeven, kort wachten op een lopende ronde, en
 * vrijgeven als de schakelaar misschien door ons aan staat (ook midden in het begrenzen, 1.6.1).
 */

/** Een gat tussen twee blokken tot zo lang wordt overbrugd (één kwartier). */
export const OVERBRUG_MS = 15 * 60_000;
/** Zoveel teruglevering telt pas (W), en zo lang (hysterese). */
export const EXPORT_W = 300;
export const EXPORT_DUUR_MS = 2 * 60_000;
/** Zoveel uit het net (of uit de batterij) terwijl hij begrensd staat (W), en zo lang. */
export const TEKORT_W = 150;
export const TEKORT_DUUR_MS = 60_000;
/** Bovenop het eigen verbruik, zodat een kleine piek niet meteen uit het net komt. */
export const MARGE_W = 300;
/** Begrenzen moet minstens zoveel per uur schelen (€). */
export const MARGE_EUR_PER_UUR = 0.01;
/** De schrijfrem. */
export const OMLAAG_TUSSEN_MS = 5 * 60_000;
export const OMHOOG_TUSSEN_MS = 60_000;
export const MAX_PER_UUR = 8;
export const MAX_PER_DAG = 30;
/** De zelfcontrole: zo lang na het begrenzen eerst wachten (hij zakt rustig), en tot wanneer kijken. */
export const CONTROLE_WACHT_MS = 60_000;
export const CONTROLE_MS = 3 * 60_000;
/** Zoveel mag hij boven de grens leveren en toch "werkt" (of 5% van zijn vermogen, als dat meer is). */
export const CONTROLE_MARGE_W = 400;
/** Zoveel moet hij vooraf boven de grens leveren om het effect te kunnen zien. */
export const ZICHTBAAR_W = 600;
/** Een andere zonmeter telt bij de zelfcontrole pas mee vanaf zoveel (W). */
export const ANDERE_ZON_W = 300;
/** Zo lang kijkt de zelfcontrole terug naar de zon vóór het begrenzen (wisselde die al sterk?). */
export const PATROON_MS = 5 * 60_000;
/** Zo lang geldt de laatste lezing zonder grens als wat de zon zou kunnen (begrensd bijsturen). */
export const ZON_ONTHOUDEN_MS = 30 * 60_000;
/** Bij het stoppen hooguit zo lang wachten op een lopende ronde, dan toch vrijgeven. */
export const STOP_WACHT_MS = 5_000;
/** Na een lezing zonder antwoord zo lang niet opnieuw vragen. */
export const LEES_OPNIEUW_MS = 60_000;
/** Tijdens een blok eens per zoveel nakijken of hij nog staat zoals wij hem zetten. */
export const NAKIJKEN_MS = 15 * 60_000;
/** Een grens die niet van ons is: zo vaak opnieuw kijken. */
export const EIGEN_OPNIEUW_MS = 30 * 60_000;
/** Vrijgeven lukte niet: zo lang wachten voor het opnieuw gaat. */
export const OPNIEUW_NA_FOUT_MS = 5 * 60_000;
/** Opgestart in een blok: zo lang wachten op de instelling uit de app (daarna: uit). */
export const WACHT_OP_APP_MS = 2 * 60_000;
/** Zoveel blokken gaan hooguit naar de app (vandaag en morgen). */
export const HOOGSTENS_BLOKKEN = 8;

const UUR_MS = 60 * 60_000;
const DAG_MS = 24 * UUR_MS;

/** De instelling als de app niets zegt (een oudere functie, of nog geen antwoord): uit. */
export const UIT = Object.freeze({ aan: false, niet_op: new Set(), vrij_op: null, nettoAfnemer: true, op: null });

const DATUM = /^\d{4}-\d{2}-\d{2}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T[0-9:.+\-Z]{5,30}$/;

/**
 * Wat de functie ontvangMeting terugstuurt (omvormer_sturen), mild: alleen `aan: true` zet het
 * aan; al het andere (of niets) is uit. `op`: wanneer de eigenaar het laatst iets veranderde. `netto: 'terugleveraar'` als de eigenaar zegt dat hij
 * over het jaar meer teruglevert dan afneemt; anders afnemer (zoals de app altijd rekende).
 */
export function instellingUit(ruw) {
  if (!ruw || typeof ruw !== 'object' || Array.isArray(ruw) || ruw.aan !== true) return UIT;
  const niet = Array.isArray(ruw.niet_op) ? ruw.niet_op.filter((d) => typeof d === 'string' && DATUM.test(d)).slice(0, 31) : [];
  const vrij = typeof ruw.vrij_op === 'string' && ruw.vrij_op.length <= 40 && ISO.test(ruw.vrij_op) && Number.isFinite(Date.parse(ruw.vrij_op)) ? ruw.vrij_op : null;
  // Wanneer de eigenaar het laatst iets veranderde (functie 1.6.0 en nieuwer): opnieuw aanzetten na "werkt niet".
  const op = typeof ruw.op === 'string' && ruw.op.length <= 40 && ISO.test(ruw.op) && Number.isFinite(Date.parse(ruw.op)) ? ruw.op : null;
  return { aan: true, niet_op: new Set(niet), vrij_op: vrij, nettoAfnemer: ruw.netto !== 'terugleveraar', op };
}

/** Het vermogen van de omvormer uit zijn type: "GW8K-DT" → 8000, "GW8000-DT" → 8000, anders null. */
export function nominaalUitType(type) {
  const t = String(type ?? '');
  const k = t.match(/GW(\d{1,3}(?:\.\d)?)K/i);
  if (k) return Math.round(Number(k[1]) * 1000);
  const w = t.match(/GW(\d{4,6})(?:[^\d]|$)/i);
  return w ? Number(w[1]) : null;
}

/**
 * De prijzen van een tijdvak voor de besturing: { v: waarde van terugleveren, kaal: zonder
 * saldering, a: afnemen } (€/kWh), of null. `kwhDitJaar`: voor het plafond van de Zonnebonus.
 */
export function prijzenVan(t, { nettoAfnemer = true, kwhDitJaar = 0, jaar = null } = {}) {
  if (!t || t.schatting || !Number.isFinite(t.van) || !Number.isFinite(t.tot) || !(t.tot > t.van)) return null;
  const vak = naPlafond(t, jaar === null || datumInNederland(t.van).slice(0, 4) === jaar ? kwhDitJaar : 0);
  const v = waardeTeruglevering(vak, { nettoAfnemer });
  const a = vak.afname_kwh;
  if (!Number.isFinite(v) || !Number.isFinite(a)) return null;
  const kaal = kaleTeruglevering(vak);
  return { v, a, kaal: Number.isFinite(kaal) ? kaal : null };
}

/**
 * De blokken van `vanaf` tot zo ver als de prijzen gaan: [{ van, tot, laagste (v, €/kWh),
 * hoogsteAfname, modus }], op volgorde. modus 'deels' (begrenzen tot het eigen verbruik),
 * 'uit' (ook afnemen levert geld op), of 'loont-niet' (de kale prijs is negatief maar met de
 * saldering niet). Alleen echte prijzen (een schatting begrenst nooit).
 */
export function planUit(tijdvakken, { vanaf, prijsVan = (t) => prijzenVan(t) } = {}) {
  const lijst = (Array.isArray(tijdvakken) ? tijdvakken : [])
    .filter((t) => t && t.tot > vanaf)
    .map((t) => ({ t, p: prijsVan(t) }))
    .filter(({ p }) => p)
    .sort((x, y) => x.t.van - y.t.van);
  const blokken = [];
  for (const { t, p } of lijst) {
    const soort = p.v < 0 ? 'begrenzen' : p.kaal !== null && p.kaal < 0 ? 'loont-niet' : null;
    if (!soort) continue;
    const vorige = blokken.at(-1);
    if (vorige && vorige.soort === soort && t.van - vorige.tot <= OVERBRUG_MS) {
      vorige.tot = Math.max(vorige.tot, t.tot);
      vorige.laagste = Math.min(vorige.laagste, soort === 'begrenzen' ? p.v : p.kaal);
      vorige.hoogsteAfname = Math.max(vorige.hoogsteAfname, p.a);
    } else {
      blokken.push({ soort, van: t.van, tot: t.tot, laagste: soort === 'begrenzen' ? p.v : p.kaal, hoogsteAfname: p.a });
    }
  }
  return blokken.map(({ soort, ...b }) => ({ ...b, modus: soort === 'loont-niet' ? 'loont-niet' : b.hoogsteAfname < 0 ? 'uit' : 'deels', ...(soort === 'loont-niet' && b.van < EINDE_SALDERING ? { reden: 'saldering' } : {}) }));
}

/** De prijzen van dit moment, alleen als elk tijdvak dat over `nu` gaat het eens is (anders null: niet begrenzen). */
export function prijsNu(tijdvakken, nu, prijsVan = (t) => prijzenVan(t)) {
  const geldend = (Array.isArray(tijdvakken) ? tijdvakken : []).filter((t) => t && t.van <= nu && nu < t.tot);
  if (!geldend.length) return null;
  const p = geldend.map(prijsVan);
  if (p.some((x) => !x) || new Set(p.map((x) => Math.sign(x.v))).size > 1 || new Set(p.map((x) => Math.sign(x.a))).size > 1) return null;
  return p[0];
}

/** De stap (0, 10, … 100%) die minstens `w` watt laat leveren bij een omvormer van `nominaal` watt. */
export function stapVoor(w, nominaal) {
  if (!(nominaal > 0)) return VRIJ;
  return Math.min(VRIJ, Math.max(0, Math.ceil((Math.max(0, w) / nominaal) * 10) * 10));
}

/**
 * Wat een stand per uur kost (€; negatief = levert op), als de omvormer `p` procent mag en de
 * zon nu `zonGoodWe` watt geeft: wat over is na het eigen verbruik gaat terug (prijs v), wat
 * tekort is komt uit het net (prijs a). `andereZon`: zon die niet via deze omvormer loopt.
 */
export function kostenPerUur({ p, zonGoodWe, andereZon = 0, eigen, nominaal, v, a }) {
  const mag = p >= VRIJ ? zonGoodWe : p <= 0 ? 0 : nominaal > 0 ? (nominaal * p) / 100 : zonGoodWe;
  const levert = Math.min(zonGoodWe, mag) + andereZon;
  const terug = Math.max(0, levert - eigen);
  const tekort = Math.max(0, eigen - levert);
  return (tekort * a - terug * v) / 1000;
}

/**
 * De beste stand voor nu: de stap die het meest scheelt tegenover vrij, of VRIJ als niets
 * minstens MARGE_EUR_PER_UUR scheelt. Gedeeltelijk tot ongeveer het eigen verbruik plus de
 * marge; helemaal uit alleen als afnemen geld oplevert (a < 0) en dat volgens de som beter is.
 * Kost afnemen geld, dan nooit 0%, ook niet als de som dat net goedkoper vindt (1.6.1: anders
 * komt het huis uit het net, gaat hij omhoog, weer omlaag, en zo heen en weer).
 * Zonder nominaal vermogen kan alleen 0% (helemaal uit). `zonGoodWe`: wat de zon via de GoodWe
 * zou kunnen (begrensd: de schatting zonder grens, niet wat de grens nog doorlaat).
 */
export function kiesStap({ zonGoodWe, andereZon = 0, eigen, nominaal, v, a }) {
  const basis = kostenPerUur({ p: VRIJ, zonGoodWe, andereZon, eigen, nominaal, v, a });
  const deels = nominaal > 0 ? stapVoor(eigen - andereZon + MARGE_W, nominaal) : VRIJ;
  let beste = { p: VRIJ, winst: 0 };
  for (const p of new Set([deels, ...(a < 0 ? [0] : [])])) {
    if (p >= VRIJ) continue;
    const winst = basis - kostenPerUur({ p, zonGoodWe, andereZon, eigen, nominaal, v, a });
    if (winst > beste.winst + 1e-9) beste = { p, winst };
  }
  return beste.winst >= MARGE_EUR_PER_UUR ? beste : { p: VRIJ, winst: 0 };
}

const uurNotatie = new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** "12:00" in Nederlandse tijd. */
export const kloktijd = (ms) => uurNotatie.format(new Date(ms));

/** −0,034 €/kWh → "−3 ct"; kleiner dan een cent met één decimaal ("−0,4 ct"). */
export function centTekst(euro) {
  const ct = euro * 100;
  const tekst = Math.abs(ct) >= 0.95 ? String(Math.round(Math.abs(ct))) : Math.abs(ct).toFixed(1).replace('.', ',');
  return `${ct < 0 ? '−' : ''}${tekst} ct`;
}

/** 1234 → "1,2 kW". */
export const kwTekst = (w) => `${(Math.round(w / 100) / 10).toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kW`;

const dagNaamVan = (ms, nu) => {
  const d = datumInNederland(ms);
  if (d === datumInNederland(nu)) return 'vandaag';
  if (d === datumInNederland(nu + DAG_MS) || d === datumInNederland(nu + DAG_MS + 2 * UUR_MS)) return 'morgen';
  return d.split('-').reverse().slice(0, 2).join('-');
};

/** De zinnen bij een plan, voor proef en het logboek. `verbruikW`: het gewone eigen verbruik overdag, als dat bekend is. */
export function planZinnen(blokken, nu, { verbruikW = null } = {}) {
  if (!blokken?.length) return ['geen negatieve terugleverprijs in de prijzen die er nu zijn'];
  return blokken.map((b) => {
    const wanneer = `${dagNaamVan(b.van, nu)} ${kloktijd(b.van)}–${kloktijd(b.tot)}`;
    if (b.modus === 'loont-niet') return `${wanneer}: de prijs is negatief, maar ${b.reden === 'saldering' ? 'door de saldering loont begrenzen nog niet (vanaf 2027 wel)' : 'begrenzen loont niet'}`;
    const kost = `terugleveren kost dan tot ${centTekst(-b.laagste).replace('−', '')}/kWh`;
    if (b.modus === 'uit') return `${wanneer} helemaal uit: ${kost} en stroom uit het net levert zelfs geld op`;
    return `${wanneer} begrensd tot ${verbruikW ? `~${kwTekst(verbruikW + MARGE_W)}` : 'ongeveer je eigen verbruik'}: ${kost}, je eigen verbruik blijft van de zon (past zich aan)`;
  });
}

/** De middelste waarde (voor de zelfcontrole: één uitschieter telt niet). */
const midden = (l) => {
  const g = [...l].sort((x, y) => x - y);
  return g.length ? (g.length % 2 ? g[(g.length - 1) / 2] : (g[g.length / 2 - 1] + g[g.length / 2]) / 2) : null;
};

/**
 * De zelfcontrole na een begrenzing (1.6.0: "als je denkt dat het werkt, zetten we het
 * gewoon aan"): werkt het wel op deze omvormer? `c`: { pct, voorW, terugVoor, verwachtW,
 * andereVoor, wisselend }, de monsters [{ w, terug, andere }] uit CONTROLE_WACHT_MS tot
 * CONTROLE_MS na het begrenzen (andere: zon die niet via de GoodWe loopt).
 * Geeft null (te weinig monsters), { uitkomst: 'werkt', via: 'omvormer'|'net' },
 * { uitkomst: 'werkt-niet', reden: 'geen-effect'|'te-veel' } of (1.6.1) { uitkomst: 'onzeker',
 * reden: 'zon-viel' }: hij leverde veel minder dan bedoeld, maar de zon viel elders ook (een
 * andere zonmeter zakte net zo), hij haalde de grens even toch, of de zon wisselde vooraf al sterk.
 */
export function beoordeel(c, monsters, nominaal) {
  const w = monsters.map((m) => m.w).filter(Number.isFinite);
  if (w.length < 3) return null;
  const naW = midden(w);
  const terugNa = midden(monsters.map((m) => m.terug).filter(Number.isFinite)) ?? c.terugVoor;
  const marge = Math.max(CONTROLE_MARGE_W, nominaal > 0 ? nominaal * 0.05 : 0);
  const basis = { naW: Math.round(naW), terugNa: Math.round(terugNa) };
  // Het tegendeel: veel minder dan bedoeld (0 W bij 50%): dan telt de grens anders dan we denken (0,1% in plaats van %).
  if (c.pct >= 30 && c.verwachtW >= 1000 && c.voorW >= c.verwachtW && naW < c.verwachtW * 0.3) {
    // Of was het een wolk (1.6.1)? Dan zakt een andere zonmeter net zo, haalt hij de grens even toch, of wisselde de zon al.
    const andereNa = midden(monsters.map((m) => m.andere).filter(Number.isFinite));
    const andereViel = Number.isFinite(c.andereVoor) && c.andereVoor >= ANDERE_ZON_W && andereNa !== null && andereNa < c.andereVoor * 0.7;
    if (andereViel || Math.max(...w) >= c.verwachtW * 0.7 || c.wisselend === true) return { uitkomst: 'onzeker', reden: 'zon-viel', ...basis };
    return { uitkomst: 'werkt-niet', reden: 'te-veel', ...basis };
  }
  if (naW <= c.verwachtW + marge) return { uitkomst: 'werkt', via: 'omvormer', ...basis };
  // Met een GoodWe-meter begrenst hij misschien alleen wat naar het net gaat: dan zakt de teruglevering op de P1.
  if (c.terugVoor >= ZICHTBAAR_W && terugNa <= c.terugVoor * 0.5) return { uitkomst: 'werkt', via: 'net', ...basis };
  return { uitkomst: 'werkt-niet', reden: 'geen-effect', ...basis };
}

/**
 * De besturing. `verbinding` is { leesGrens(), leesSchakelaar(), schrijfGrens(procent),
 * schrijfSchakelaar(0|1) } (omvormerVerbinding in omvormerSturen.mjs, of een nep in de tests).
 * `opgeslagen`: wat in omvormer-sturen.json stond; `bewaar(staat)` schrijft het weg (na elke
 * verandering die een herstart moet overleven).
 */
export function maakStuurder({ verbinding, log = () => {}, opgeslagen = null, bewaar = () => {}, gestart = Date.now(), stopWachtMs = STOP_WACHT_MS }) {
  const o = opgeslagen && typeof opgeslagen === 'object' ? opgeslagen : {};
  const getallen = (l) => (Array.isArray(l) ? l.filter((m) => Number.isFinite(m)) : []);
  const oorspronkelijkUit = (x) =>
    x && typeof x === 'object' && Number.isInteger(x.grens) && typeof x.schakelaar === 'boolean' && Number.isFinite(x.op) ? { grens: x.grens, schakelaar: x.schakelaar, op: x.op } : null;
  const controleUit = (x) => {
    if (!x || typeof x !== 'object' || !['werkt', 'werkt-niet'].includes(x.uitkomst) || !Number.isFinite(x.op)) return null;
    const g = (v) => (Number.isFinite(v) ? Math.round(v) : null);
    return { uitkomst: x.uitkomst, op: x.op, pct: Number.isInteger(x.pct) ? x.pct : null, voorW: g(x.voorW), naW: g(x.naW), ...(x.via ? { via: x.via } : {}), ...(x.reden ? { reden: x.reden } : {}) };
  };
  const st = {
    // Volgens de laatste lezing: onbekend, vrij (schakelaar uit), begrensd (door ons, op st.pct),
    // eigen (de schakelaar staat aan, niet door ons) of twijfel (onze schakelaar, maar een andere grens).
    bekend: 'onbekend',
    waarde: null,
    schakelaar: null,
    // Wat WIJ het laatst in de grens schreven, sinds wanneer, in welk blok; na een herstart uit het bestand.
    pct: Number.isInteger(o.pct) ? o.pct : null,
    // Zetten WIJ de schakelaar aan (1.6.0)? Alleen dan is een aan-staande schakelaar van ons. Een bestand
    // van 1.5.0 kent dit niet: dan is hij niet van ons (1.5.0 raakte de schakelaar nooit aan).
    aanDoorOns: o.schakelaar_door_ons === true,
    sinds: Number.isFinite(o.sinds) ? o.sinds : null,
    blokVan: Number.isFinite(o.blok_van) ? o.blok_van : null,
    aanpassingen: Number.isInteger(o.aanpassingen) ? o.aanpassingen : 0,
    laagste: Number.isInteger(o.laagste) ? o.laagste : null,
    hoogste: Number.isInteger(o.hoogste) ? o.hoogste : null,
    schrijven: getallen(o.schrijven),
    // Blokken die we niet meer begrenzen: van → reden ('nu-aan', 'mislukt', 'anders').
    klaar: new Map((Array.isArray(o.klaar) ? o.klaar : []).filter((k) => Array.isArray(k) && Number.isFinite(k[0]) && typeof k[1] === 'string').map(([van, reden]) => [van, reden])),
    vrijOpGezien: typeof o.vrij_op_gezien === 'string' ? o.vrij_op_gezien : null,
    // Stond het ooit aan (of schreven we ooit)? Zo niet, dan raakt het programmaatje de omvormer niet aan.
    ooit: o.ooit === true,
    // Hoe de omvormer stond toen het programmaatje hem voor het eerst las (de installateur): voor de geschiedenis.
    oorspronkelijk: oorspronkelijkUit(o.oorspronkelijk),
    // De zelfcontrole: de laatste uitkomst (werkt / werkt-niet, met datum), en de lopende.
    controle: controleUit(o.controle),
    controleNu: null,
    instelling: null,
    fout: null,
    laatsteLees: -Infinity,
    nietVoor: 0,
    blokken: [],
    planKern: null,
    wakker: false,
    nominaal: null,
    // Hysterese: sinds wanneer gaat er te veel terug, of komt er te veel uit het net.
    exportSinds: null,
    tekortSinds: null,
    // Het gewone eigen verbruik overdag (W), langzaam gemiddeld: voor "begrensd tot ~1,2 kW" in het plan.
    verbruikGem: Number.isFinite(o.verbruik_gem) ? o.verbruik_gem : null,
    doelW: null,
    // Wat de zon via de GoodWe zou kunnen: de laatste lezing zonder grens { w, op } (1.6.1).
    zonVrij: null,
    // De zon via de GoodWe van de laatste minuten, zonder grens: [[nu, w]] (wisselde hij al sterk?).
    zonReeks: [],
    // Het programmaatje stopt (1.6.1): niets meer schrijven behalve vrijgeven.
    stoppen: false,
  };
  // De ronde die nu loopt (stop() wacht er kort op).
  let lopend = null;

  const opslaan = (nu) => {
    st.schrijven = st.schrijven.filter((m) => nu - m < DAG_MS);
    for (const van of st.klaar.keys()) if (nu - van > 2 * DAG_MS) st.klaar.delete(van);
    bewaar({
      schrijven: st.schrijven,
      pct: st.pct,
      schakelaar_door_ons: st.aanDoorOns,
      sinds: st.sinds,
      blok_van: st.blokVan,
      aanpassingen: st.aanpassingen,
      laagste: st.laagste,
      hoogste: st.hoogste,
      klaar: [...st.klaar],
      vrij_op_gezien: st.vrijOpGezien,
      ooit: st.ooit,
      ...(st.oorspronkelijk ? { oorspronkelijk: st.oorspronkelijk } : {}),
      ...(st.controle ? { controle: st.controle } : {}),
      ...(st.verbruikGem === null ? {} : { verbruik_gem: Math.round(st.verbruikGem) }),
    });
  };

  const zetFout = (soort, nu, tekst) => {
    if (st.fout?.soort !== soort) {
      st.fout = { soort, sinds: nu };
      if (tekst) log(tekst);
    }
  };

  /** Wie is de baas: schakelaar uit = vrij (wat de grens ook zegt); aan, niet door ons = eigen; door ons = begrensd (of twijfel). */
  const standVan = ({ schakelaar, grens }) => (!schakelaar ? 'vrij' : !st.aanDoorOns ? 'eigen' : grens === st.pct ? 'begrensd' : 'twijfel');

  const telling = (nu) => ({ uur: st.schrijven.filter((m) => nu - m < UUR_MS).length, dag: st.schrijven.filter((m) => nu - m < DAG_MS).length });
  const vorigeSchrijf = () => (st.schrijven.length ? Math.max(...st.schrijven) : -Infinity);
  /** Ruimte voor `nodig` schrijfacties binnen de rem per uur en per dag? (Vrijgeven telt mee, maar wacht nooit.) */
  const ruimte = (nu, nodig) => {
    const { uur, dag } = telling(nu);
    return uur + nodig <= MAX_PER_UUR && dag + nodig <= MAX_PER_DAG;
  };
  /** Mag er nu een nieuwe stap beginnen: lang genoeg na de vorige (omlaag 5 min, omhoog 1 min), en ruimte voor `nodig`. */
  const magStap = (omhoog, nu, nodig) => nu - vorigeSchrijf() >= (omhoog ? OMHOOG_TUSSEN_MS : OMLAAG_TUSSEN_MS) && ruimte(nu, nodig);

  /** Schakelaar en grens lezen. null = geen antwoord (of de schakelaar staat aan en de grens is onbekend). */
  async function lees(nu) {
    st.laatsteLees = nu;
    let schakelaar;
    try {
      schakelaar = await verbinding.leesSchakelaar();
    } catch {
      return null;
    }
    let grens = null;
    try {
      grens = await verbinding.leesGrens();
    } catch {
      if (schakelaar) return null;
    }
    st.schakelaar = schakelaar;
    st.waarde = grens;
    // Uit is uit: wie hem hierna aanzet, zijn wij niet (tot we het zelf doen).
    if (!schakelaar) st.aanDoorOns = false;
    if (!st.oorspronkelijk && grens !== null) {
      st.oorspronkelijk = { grens, schakelaar, op: nu };
      log(`Omvormer, zoals hij stond voor het programmaatje hem ooit bediende: grens ${grens}%, grensschakelaar ${schakelaar ? 'aan' : 'uit'} (bewaard in omvormer-sturen.json).`);
      opslaan(nu);
    }
    return { schakelaar, grens };
  }

  /**
   * Eén register zetten en teruglezen, één keer opnieuw als het niet klopt. true = het staat er.
   * Vrijgeven (de schakelaar uit) wacht nooit op de rem; al het andere wel.
   */
  async function zet(soort, waarde, nu) {
    const vrijgeven = soort === 'schakelaar' && waarde === SCHAKELAAR_UIT;
    for (let poging = 0; poging < 2; poging += 1) {
      if (!vrijgeven && st.stoppen) {
        log(`Omvormer: het programmaatje stopt; ${soort === 'grens' ? 'de grens' : 'de schakelaar'} schrijf ik niet meer.`);
        return false;
      }
      if (!vrijgeven && !ruimte(nu, 1)) {
        log(`Omvormer: de schrijfrem houdt ${soort === 'grens' ? 'de grens' : 'de schakelaar'} tegen.`);
        return false;
      }
      st.schrijven.push(nu);
      st.ooit = true;
      let fout = null;
      try {
        if (soort === 'grens') await verbinding.schrijfGrens(waarde);
        else await verbinding.schrijfSchakelaar(waarde);
      } catch (f) {
        fout = f;
      }
      let terug;
      try {
        terug = soort === 'grens' ? await verbinding.leesGrens() : (await verbinding.leesSchakelaar()) ? SCHAKELAAR_AAN : SCHAKELAAR_UIT;
      } catch {
        terug = null;
      }
      if (terug !== null) {
        if (soort === 'grens') st.waarde = terug;
        else st.schakelaar = terug === SCHAKELAAR_AAN;
      }
      if (terug === waarde) return true;
      const wat = soort === 'grens' ? `grens op ${waarde}%` : waarde === SCHAKELAAR_AAN ? 'grensschakelaar aan' : 'vrijgeven (grensschakelaar uit)';
      const gelezen = terug === null ? 'teruglezen lukte niet' : soort === 'grens' ? `hij staat op ${terug}%` : `de schakelaar staat ${terug ? 'aan' : 'uit'}`;
      log(`Omvormer ${wat}: ${fout ? inGewoneWoorden(fout) : gelezen}${poging === 0 ? '; ik probeer het nog één keer.' : '.'}`);
    }
    return false;
  }

  const blokSamenvatting = () =>
    st.aanpassingen > 0 ? `, ${st.aanpassingen} keer bijgesteld (tussen ${st.laagste}% en ${st.hoogste}%)` : st.laagste !== null ? ` (${st.laagste}%)` : '';

  /** Vrijgeven: de schakelaar uit, met teruglezen (de grens blijft staan). Geeft true als hij (nu) vrij staat. */
  async function geefVrij(nu, reden) {
    st.controleNu = null;
    if (await zet('schakelaar', SCHAKELAAR_UIT, nu)) {
      st.aanDoorOns = false;
      st.bekend = 'vrij';
      if (st.sinds !== null) log(`Omvormer weer vrij (grensschakelaar uit, volle kracht)${reden ? `: ${reden}` : ''}; begrensd sinds ${kloktijd(st.sinds)}${blokSamenvatting()}.`);
      else log(`Omvormer weer vrij (grensschakelaar uit, volle kracht)${reden ? `: ${reden}` : ''}.`);
      st.sinds = null;
      st.blokVan = null;
      st.aanpassingen = 0;
      st.laagste = null;
      st.hoogste = null;
      st.doelW = null;
      // Hij komt nu rustig op gang: dat is geen wisselende zon.
      st.zonReeks = [];
      if (st.fout?.soort === 'vrijgeven') st.fout = null;
      return true;
    }
    // Niet gelukt: we weten niet hoe hij staat (misschien nog door ons begrensd). Dus blijven lezen en
    // opnieuw vrijgeven; nooit 'vrij' aannemen (1.6.1).
    st.bekend = 'onbekend';
    st.nietVoor = nu + OPNIEUW_NA_FOUT_MS;
    zetFout('vrijgeven', nu, `Omvormer vrijgeven lukte niet; ik probeer het over ${OPNIEUW_NA_FOUT_MS / 60_000} minuten opnieuw.`);
    return false;
  }

  /** Begrenzen vanuit vrij: eerst de grens (teruglezen), dan de schakelaar aan (teruglezen). */
  async function begrens(p, nu, huidig, prijs, voor) {
    // Vlak ervoor vers lezen: zette iemand de schakelaar intussen aan, dan is hij niet van ons.
    const l = await lees(nu);
    if (!l) {
      st.bekend = 'onbekend';
      return false;
    }
    // De lezing zegt hoe hij nu staat; pas na elke geslaagde stap nemen we een nieuwe stand aan (1.6.1).
    st.bekend = standVan(l);
    if (st.bekend !== 'vrij') {
      if (st.bekend === 'eigen') zetFout('eigen', nu, `Omvormer: de grensschakelaar staat aan (grens ${l.grens}%), niet door het programmaatje; ik stuur hem niet.`);
      return false;
    }
    if (st.stoppen) return false;
    const mislukt = (tekst) => {
      st.klaar.set(huidig.van, 'mislukt');
      zetFout('begrenzen', nu, tekst);
    };
    const wisselend = (() => {
      const w = st.zonReeks.filter(([t]) => nu - t <= PATROON_MS).map(([, x]) => x);
      return w.length >= 3 && Math.min(...w) < Math.max(...w) * 0.7;
    })();
    st.pct = p;
    // De grens alleen schrijven als hij nog niet goed staat (zuinig met het flashgeheugen).
    if (l.grens !== p && !(await zet('grens', p, nu))) {
      // De schakelaar staat nog uit: hij is gewoon vrij gebleven.
      if (!st.stoppen) mislukt('Omvormer begrenzen lukte niet (de grens nam hij niet aan); hij blijft vrij en dit blok laat ik met rust.');
      return false;
    }
    // Stopt het programmaatje intussen: de schakelaar niet meer aanzetten (hij staat nog uit, dus vrij).
    if (st.stoppen) return false;
    // Al onthouden en bewaard vóór het schrijven: zo is hij na een stroomstoring of herstart nog steeds van ons.
    st.aanDoorOns = true;
    opslaan(nu);
    // Vanaf hier weten we het niet zeker tot hij teruggelezen is: niet meer 'vrij' (1.6.1).
    st.bekend = 'onbekend';
    if (!(await zet('schakelaar', SCHAKELAAR_AAN, nu))) {
      mislukt('Omvormer begrenzen lukte niet (de grensschakelaar ging niet aan); ik geef hem vrij en laat dit blok verder met rust.');
      await geefVrij(nu, 'na het mislukte begrenzen');
      return false;
    }
    st.bekend = 'begrensd';
    st.sinds = nu;
    st.blokVan = huidig.van;
    st.aanpassingen = 0;
    st.laagste = p;
    st.hoogste = p;
    if (st.fout && st.fout.soort !== 'eigen') st.fout = null;
    log(`Omvormer begrensd door het programmaatje op ${p}%${st.doelW !== null ? ` (~${kwTekst(st.doelW)}, het eigen verbruik)` : ''} tot ${kloktijd(huidig.tot)}; terugleveren kost nu ${centTekst(-prijs.v).replace('−', '')}/kWh.`);
    // De zelfcontrole: alleen als er genoeg zon is om het effect te zien.
    const verwachtW = p <= 0 ? 0 : st.nominaal > 0 ? (st.nominaal * p) / 100 : null;
    if (verwachtW !== null && Number.isFinite(voor.w) && voor.w - verwachtW >= ZICHTBAAR_W) {
      st.controleNu = { van: nu, pct: p, voorW: voor.w, terugVoor: voor.terug, andereVoor: voor.andere ?? null, wisselend, verwachtW, poging: 1, monsters: [] };
    } else if (!st.controle) {
      log('Omvormer: te weinig zon om na te kijken of begrenzen werkt; dat doe ik bij een volgende begrenzing.');
    }
    return true;
  }

  /** Bijstellen terwijl hij door ons begrensd staat: alleen de grens. */
  async function stelBij(p, nu, huidig) {
    st.controleNu = null;
    const vorige = st.pct;
    st.pct = p;
    if (await zet('grens', p, nu)) {
      st.aanpassingen += 1;
      st.laagste = Math.min(st.laagste ?? p, p);
      st.hoogste = Math.max(st.hoogste ?? p, p);
      if (st.fout && st.fout.soort !== 'eigen') st.fout = null;
      return true;
    }
    // Bijstellen lukte niet: dan liever helemaal vrij (bij twijfel vrij).
    st.pct = vorige;
    st.klaar.set(huidig.van, 'mislukt');
    zetFout('begrenzen', nu, 'Omvormer bijstellen lukte niet; ik geef hem vrij en laat dit blok verder met rust.');
    await geefVrij(nu, 'na het mislukte bijstellen');
    return false;
  }

  /**
   * De lopende zelfcontrole bijwerken (elke ronde). Geeft het oordeel als hij klaar is (beoordeel), anders null.
   * Werkt het niet, of is het niet te zeggen (een wolk): eerst nog één keer kijken (1.6.1); is het de tweede
   * keer nog niet te zeggen, dan geen oordeel (bij een volgende begrenzing opnieuw).
   */
  function volgControle(nu, w, terug, andere) {
    const c = st.controleNu;
    if (!c) return null;
    if (st.bekend !== 'begrensd' || st.pct !== c.pct) {
      st.controleNu = null;
      return null;
    }
    if (nu - c.van >= CONTROLE_WACHT_MS) c.monsters.push({ w, terug, andere });
    if (nu - c.van < CONTROLE_MS) return null;
    st.controleNu = null;
    const b = beoordeel(c, c.monsters, st.nominaal);
    if (!b) return null;
    if (b.uitkomst !== 'werkt' && c.poging === 1) {
      // Hij staat al een paar minuten begrensd: meteen weer monsters nemen.
      st.controleNu = { ...c, van: nu - CONTROLE_WACHT_MS, poging: 2, monsters: [] };
      log(
        b.uitkomst === 'onzeker'
          ? `Omvormer nakijken: hij leverde ${kwTekst(b.naW)} bij ${c.pct}%, maar de zon viel ook (een wolk?); ik kijk nog één keer.`
          : `Omvormer nakijken: ${b.reden === 'te-veel' ? `hij leverde maar ${kwTekst(b.naW)} bij ${c.pct}%` : `hij bleef ~${kwTekst(b.naW)} leveren bij ${c.pct}%`}; ik kijk nog één keer voor ik het opgeef.`,
      );
      return null;
    }
    if (b.uitkomst === 'onzeker') {
      log('Omvormer: nakijken lukte niet door wisselende zon; dat doe ik bij een volgende begrenzing.');
      return null;
    }
    return { ...b, c };
  }

  /** Het oordeel van de zelfcontrole vastleggen (met datum) en zeggen. */
  function legControleVast(nu, b) {
    const { c } = b;
    st.controle = { uitkomst: b.uitkomst, op: nu, pct: c.pct, voorW: Math.round(c.voorW), naW: b.naW, ...(b.via ? { via: b.via } : {}), ...(b.reden ? { reden: b.reden } : {}) };
    if (b.uitkomst === 'werkt') {
      log(`Omvormer nagekeken: begrenzen werkt (${b.via === 'net' ? `de teruglevering ging van ${kwTekst(c.terugVoor)} naar ${kwTekst(b.terugNa)}` : `van ${kwTekst(c.voorW)} naar ${kwTekst(b.naW)}`} bij ${c.pct}%).`);
      return;
    }
    log(
      b.reden === 'te-veel'
        ? `Omvormer nagekeken: hij leverde veel minder dan bedoeld (${kwTekst(b.naW)} bij ${c.pct}%, verwacht ~${kwTekst(c.verwachtW)}); de grens telt hier anders. Ik geef hem vrij en stuur hem niet meer tot je het in de app opnieuw aanzet.`
        : `Omvormer nagekeken: begrenzen werkt niet op deze omvormer (bleef ~${kwTekst(b.naW)}, was ${kwTekst(c.voorW)}, bij ${c.pct}%). Ik geef hem vrij en stuur hem niet meer tot je het in de app opnieuw aanzet.`,
    );
  }

  /**
   * Na een lezing: wat betekent die (eigen, twijfel, of veranderd door een ander)? Geeft true als de
   * ronde hier klaar is (er is vrijgegeven of iets vastgelegd).
   */
  async function naLezing(nu, l, vorige, huidig) {
    st.bekend = standVan(l);
    if (st.bekend === 'eigen') {
      zetFout('eigen', nu, `Omvormer: de grensschakelaar staat aan (grens ${l.grens}%), niet door het programmaatje; ik stuur hem niet.`);
    } else if (st.fout?.soort === 'eigen') {
      st.fout = null;
    }
    if (st.bekend === 'twijfel') {
      // Onze schakelaar, maar een grens die wij niet zo zetten: bij twijfel vrij, en dit blok met rust.
      if (huidig) st.klaar.set(huidig.van, 'anders');
      await geefVrij(nu, `de grens staat op ${l.grens}%, niet zoals het programmaatje hem zette`);
      opslaan(nu);
      return true;
    }
    if (vorige === 'begrensd' && st.bekend !== 'begrensd' && huidig) {
      // Iemand anders zette de schakelaar uit (de app van GoodWe, of een herstart van de omvormer): niet vechten.
      st.klaar.set(huidig.van, 'anders');
      st.sinds = null;
      st.blokVan = null;
      log(`Omvormer staat nu ${st.bekend === 'vrij' ? 'vrij (grensschakelaar uit)' : `op ${l.grens}%`}, maar niet door het programmaatje; de rest van dit blok laat ik hem met rust.`);
      opslaan(nu);
      return true;
    }
    return false;
  }

  /** Mag er in dit blok begrensd worden (de instelling, de zelfcontrole, de dag, "nu weer aan", de prijs van nu)? */
  function magBlok(nu, huidig, prijs) {
    if (!huidig || huidig.modus === 'loont-niet') return false;
    const inst = st.instelling ?? UIT;
    if (!inst.aan || st.controle?.uitkomst === 'werkt-niet' || inst.niet_op.has(datumInNederland(huidig.van)) || st.klaar.has(huidig.van)) return false;
    // Op het moment zelf nog één keer de prijs: geen, een schatting of tegenstrijdig, of niet onder nul: niet.
    return Boolean(prijs && prijs.v < 0);
  }

  /**
   * Eén ronde (zie ronde() hieronder): het plan bijwerken, de metingen volgen en zo nodig lezen of schrijven.
   */
  async function rondeBinnen({ nu, tijdvakken = [], prijsVan = (t, opties) => prijzenVan(t, opties), omvormerStand = null, meting = {}, nominaal = null }) {
    const inst = st.instelling ?? UIT;
    if (nominaal > 0) st.nominaal = nominaal;
    const pv = (t) => prijsVan(t, { nettoAfnemer: inst.nettoAfnemer });
    // Ook de blokken van vandaag die al bezig zijn (vanaf een dag terug), zodat een blok zijn begin houdt.
    st.blokken = planUit(tijdvakken, { vanaf: nu - DAG_MS, prijsVan: pv }).filter((b) => b.tot > nu).slice(0, HOOGSTENS_BLOKKEN);
    const kern = JSON.stringify(st.blokken.map((b) => [b.van, b.tot, b.modus]));
    if (kern !== st.planKern) {
      if (st.planKern !== null || st.blokken.length) log(`Omvormer, plan: ${planZinnen(st.blokken, nu, { verbruikW: st.verbruikGem }).join('; ')}${inst.aan ? '' : ' (staat uit in de app)'}.`);
      st.planKern = kern;
    }
    const huidig = st.blokken.find((b) => b.van <= nu && nu < b.tot) ?? null;
    const prijs = prijsNu(tijdvakken, nu, pv);

    // De metingen van deze ronde: wat er terug gaat, wat er tekort is, en het eigen verbruik (huis plus wat de batterij laadt).
    const getal = (g) => (typeof g === 'number' && Number.isFinite(g) ? g : null);
    const net = getal(meting.netW);
    const zon = getal(meting.zonW) ?? 0;
    const bat = getal(meting.batterijW) ?? 0;
    const goodweW = getal(meting.omvormerW);
    const eigen = net === null ? null : Math.max(0, zon + net + bat) + Math.max(0, -bat);
    const andereZon = goodweW === null ? 0 : Math.max(0, zon - goodweW);
    // Voor de zelfcontrole: zon die niet via de GoodWe loopt (een andere zonmeter), als die er is.
    const andereW = goodweW === null || getal(meting.zonW) === null ? null : andereZon;
    // Wat de zon via de GoodWe zou kunnen (1.6.1). Staat hij vrij, of levert hij duidelijk minder dan de grens,
    // dan is wat hij levert de zon; staat hij tegen de grens aan, dan de laatste lezing zonder grens.
    const grensW = st.bekend === 'begrensd' && st.pct !== null && st.nominaal > 0 ? (st.nominaal * st.pct) / 100 : null;
    if (goodweW !== null && (st.bekend === 'vrij' || (grensW !== null && goodweW < grensW * 0.9))) st.zonVrij = { w: goodweW, op: nu };
    if (goodweW !== null && st.bekend === 'vrij') st.zonReeks = [...st.zonReeks.filter(([t]) => nu - t <= PATROON_MS), [nu, goodweW]];
    const zonKan = goodweW === null ? 0 : grensW !== null && st.zonVrij && nu - st.zonVrij.op <= ZON_ONTHOUDEN_MS ? Math.max(goodweW, st.zonVrij.w) : goodweW;
    if (eigen !== null && zon > 50) st.verbruikGem = st.verbruikGem === null ? eigen : st.verbruikGem + (eigen - st.verbruikGem) * 0.002;
    const terug = net === null ? 0 : Math.max(0, -net);
    const tekort = net === null ? 0 : Math.max(0, net) + Math.max(0, bat);
    st.exportSinds = terug > EXPORT_W ? (st.exportSinds ?? nu) : null;
    st.tekortSinds = tekort > TEKORT_W ? (st.tekortSinds ?? nu) : null;

    let veranderd = false;
    // "Nu weer aan" uit de app: de rest van dit blok niet meer begrenzen.
    if (inst.vrij_op && inst.vrij_op !== st.vrijOpGezien) {
      st.vrijOpGezien = inst.vrij_op;
      veranderd = true;
      if (huidig && Date.parse(inst.vrij_op) >= huidig.van - 5 * 60_000 && !st.klaar.has(huidig.van)) {
        st.klaar.set(huidig.van, 'nu-aan');
        log('Omvormer: "Nu weer aan" uit de app; de rest van dit blok begrens ik hem niet meer.');
      }
    }
    st.wakker = Boolean(omvormerStand) && !['slaapt', 'weg'].includes(omvormerStand);
    // Nooit aangezet en nooit geschreven: de omvormer niet aanraken (ook niet lezen).
    if (!st.ooit || !st.wakker || nu < st.nietVoor) {
      if (veranderd) opslaan(nu);
      return;
    }
    // De zelfcontrole na een begrenzing: werkt het niet, dan eerst vers lezen (zette een ander hem
    // intussen vrij?), en staat hij nog zoals wij hem zetten: meteen vrij en niet meer proberen.
    const oordeel = volgControle(nu, goodweW, net === null ? null : terug, andereW);
    if (oordeel?.uitkomst === 'werkt') {
      legControleVast(nu, oordeel);
      veranderd = true;
    } else if (oordeel) {
      const l = await lees(nu);
      if (l === null) {
        st.bekend = 'onbekend';
        st.nietVoor = nu + LEES_OPNIEUW_MS;
        if (veranderd) opslaan(nu);
        return;
      }
      if (standVan(l) === 'begrensd') {
        legControleVast(nu, oordeel);
        if (huidig) st.klaar.set(huidig.van, 'mislukt');
        await geefVrij(nu, 'begrenzen werkt niet op deze omvormer');
        opslaan(nu);
        return;
      }
      if (await naLezing(nu, l, 'begrensd', huidig)) return;
    }
    const moetLezen =
      st.bekend === 'onbekend' ||
      (st.bekend === 'eigen' && nu - st.laatsteLees >= EIGEN_OPNIEUW_MS) ||
      (st.bekend === 'begrensd' && huidig !== null && nu - st.laatsteLees >= NAKIJKEN_MS);
    if (moetLezen) {
      const vorige = st.bekend;
      const l = await lees(nu);
      if (l === null) {
        st.nietVoor = nu + LEES_OPNIEUW_MS;
        if (veranderd) opslaan(nu);
        return;
      }
      if (await naLezing(nu, l, vorige, huidig)) return;
    }
    if (st.bekend === 'eigen' || st.bekend === 'onbekend') {
      if (veranderd) opslaan(nu);
      return;
    }

    const blokMag = magBlok(nu, huidig, prijs);
    // Opgestart in een blok en de app zei nog niets: even wachten (behalve als hij al vrij staat: dan niets te doen).
    if (blokMag === false && huidig && st.instelling === null && nu - gestart < WACHT_OP_APP_MS && st.bekend === 'begrensd') {
      if (veranderd) opslaan(nu);
      return;
    }
    if (!blokMag) {
      if (st.bekend === 'begrensd') {
        await geefVrij(nu, huidig ? 'niet (meer) begrenzen in dit blok' : 'terugleveren kost geen geld meer');
        opslaan(nu);
      } else if (veranderd) opslaan(nu);
      return;
    }

    // In een blok, en het mag. Wat zou nu het beste zijn?
    // Begrensd: niet rekenen met wat de grens nog doorlaat, maar met wat de zon zou kunnen (1.6.1).
    const keuze = eigen === null ? { p: VRIJ } : kiesStap({ zonGoodWe: zonKan, andereZon, eigen, nominaal, v: prijs.v, a: prijs.a });
    const doelW = eigen === null ? null : Math.max(0, eigen - andereZon + MARGE_W);
    if (st.bekend === 'vrij') {
      // Begrenzen alleen als er al een tijd flink wat terug gaat (alles zelf gebruikt: hij blijft aan).
      if (st.exportSinds === null || nu - st.exportSinds < EXPORT_DUUR_MS || keuze.p >= VRIJ) {
        if (veranderd) opslaan(nu);
        return;
      }
      // Begrenzen kost twee schrijfacties (grens en schakelaar), plus ruimte voor één keer opnieuw.
      if (!magStap(false, nu, 3)) {
        zetFout('rem', nu, `Omvormer: begrenzen wacht op de schrijfrem (${telling(nu).uur} keer het afgelopen uur, ${telling(nu).dag} vandaag; hooguit ${MAX_PER_UUR} per uur, ${MAX_PER_DAG} per dag, en ${OMLAAG_TUSSEN_MS / 60_000} minuten ertussen).`);
        if (veranderd) opslaan(nu);
        return;
      }
      st.doelW = keuze.p === 0 ? 0 : doelW;
      await begrens(keuze.p, nu, huidig, prijs, { w: goodweW, terug, andere: andereW });
      st.exportSinds = null;
      opslaan(nu);
      return;
    }

    // Tijdens de zelfcontrole niet bijsturen (dan zou het oordeel niet kloppen); hooguit drie minuten.
    if (st.controleNu) {
      if (veranderd) opslaan(nu);
      return;
    }
    // Begrensd door ons: bijsturen op wat het huis nu doet.
    const helemaalUit = st.pct === 0 && prijs.a < 0;
    if (!helemaalUit && st.tekortSinds !== null && nu - st.tekortSinds >= TEKORT_DUUR_MS) {
      // De wasmachine ging aan (of de batterij moet bijspringen): omhoog, en anders vrij.
      let p = nominaal > 0 && doelW !== null ? stapVoor(doelW, nominaal) : VRIJ;
      if (p <= st.pct) p = Math.min(VRIJ, st.pct + 10);
      if (nu - vorigeSchrijf() < OMHOOG_TUSSEN_MS) return;
      st.tekortSinds = null;
      if (p >= VRIJ || !ruimte(nu, 2)) {
        await geefVrij(nu, 'het huis gebruikt meer dan hij mocht leveren');
        // Zo houdt het blok niet op: na OMLAAG_TUSSEN_MS mag hij weer begrenzen als er weer genoeg terug gaat.
      } else {
        st.doelW = doelW;
        await stelBij(p, nu, huidig);
      }
      opslaan(nu);
      return;
    }
    if (st.exportSinds !== null && nu - st.exportSinds >= EXPORT_DUUR_MS && keuze.p < st.pct) {
      if (!magStap(false, nu, 2)) return;
      st.exportSinds = null;
      st.doelW = keuze.p === 0 ? 0 : doelW;
      await stelBij(keuze.p, nu, huidig);
      opslaan(nu);
      return;
    }
    if (veranderd) opslaan(nu);
  }

  return {
    /**
     * De instelling uit het antwoord van de app (na elk goed antwoord; zonder veld: uit). Zette
     * de eigenaar het opnieuw aan (uit → aan, of een nieuwere `op`) na "werkt niet": opnieuw proberen.
     */
    zetInstelling(ruw) {
      const vorige = st.instelling;
      const inst = instellingUit(ruw);
      st.instelling = inst;
      if (inst.aan && !st.ooit) st.ooit = true;
      if (st.controle?.uitkomst === 'werkt-niet' && inst.aan) {
        const opnieuwAan = (vorige !== null && !vorige.aan) || (inst.op !== null && Date.parse(inst.op) > st.controle.op);
        if (opnieuwAan) {
          st.controle = null;
          log('Omvormer: opnieuw aangezet in de app; bij de volgende begrenzing kijk ik weer na of het werkt.');
          opslaan(Date.now());
        }
      }
    },

    /**
     * Eén ronde: het plan bijwerken, de metingen volgen en zo nodig lezen of schrijven.
     * @param {object} r
     * @param {number} r.nu
     * @param {object[]} r.tijdvakken  prijzen.alle()
     * @param {(t: object, o: { nettoAfnemer: boolean }) => object|null} [r.prijsVan]  { v, a, kaal } per tijdvak (prijzenVan)
     * @param {string|null} r.omvormerStand  uit goodweVolger ('slaapt' of 'weg': niets vragen)
     * @param {{ netW?: number|null, zonW?: number|null, batterijW?: number|null, omvormerW?: number|null }} [r.meting]
     *   net plus = afnemen; batterij plus = levert, min = laadt; zon: alle panelen samen; omvormer: wat de GoodWe levert
     * @param {number|null} [r.nominaal]  het vermogen van de omvormer (W), uit zijn type
     */
    async ronde(r) {
      if (st.stoppen) return;
      const p = rondeBinnen(r);
      lopend = p;
      try {
        await p;
      } finally {
        if (lopend === p) lopend = null;
      }
    },

    /**
     * Bij het stoppen van het programmaatje (1.6.1): niets meer schrijven behalve vrijgeven, kort
     * wachten op een lopende ronde (hooguit stopWachtMs), en vrijgeven als de schakelaar misschien
     * door ons aan staat (ook midden in het begrenzen, schakelaar_door_ons in het bestand).
     * Geeft wat er gebeurde: 'niets', 'vrij' of 'mislukt'.
     */
    async stop(nu = Date.now()) {
      st.stoppen = true;
      let bleefHangen = false;
      if (lopend) {
        let wekker;
        const klaar = await Promise.race([
          lopend.then(() => true, () => true),
          new Promise((r) => {
            wekker = setTimeout(() => r(false), stopWachtMs);
            wekker.unref?.();
          }),
        ]);
        clearTimeout(wekker);
        bleefHangen = !klaar;
      }
      if (!st.ooit || !st.aanDoorOns) return 'niets';
      // Niet zeker hoe hij staat (midden in het begrenzen, of na een herstart): eerst lezen. Een ronde die
      // blijft hangen kan zijn schakelaar-opdracht al verstuurd hebben: dan niet lezen maar meteen vrij.
      if (!bleefHangen && st.bekend !== 'begrensd' && st.bekend !== 'twijfel') {
        const l = await lees(nu);
        if (l === null) {
          if (!st.wakker) return 'niets';
        } else if (!['begrensd', 'twijfel'].includes(standVan(l))) {
          st.bekend = standVan(l);
          opslaan(nu);
          return 'niets';
        }
      }
      const ok = await geefVrij(nu, 'het programmaatje stopt');
      opslaan(nu);
      return ok ? 'vrij' : 'mislukt';
    },

    /** Het blok `sturen` in meting.omvormer: wat de app laat zien (en het logboek van de functie gebruikt). */
    voorApp(nu) {
      const inst = st.instelling ?? UIT;
      const huidig = st.blokken.find((b) => b.van <= nu && nu < b.tot) ?? null;
      const reden = (b) => (b.modus === 'loont-niet' ? null : (st.klaar.get(b.van) ?? (inst.niet_op.has(datumInNederland(b.van)) ? 'dag' : null)));
      const iso = (ms) => new Date(ms).toISOString();
      const rond = (g) => Math.round(g * 10_000) / 10_000;
      const stand = st.bekend === 'twijfel' ? 'onbekend' : st.bekend;
      const c = st.controle;
      return {
        aan: inst.aan,
        stand,
        ...(stand === 'begrensd' && st.pct !== null ? { pct: st.pct } : {}),
        ...(stand === 'begrensd' && st.pct !== null && st.nominaal > 0 ? { grens_w: Math.round((st.nominaal * st.pct) / 100) } : {}),
        ...(stand === 'begrensd' && st.sinds !== null ? { sinds: iso(st.sinds), door: 'programmaatje', aanpassingen: st.aanpassingen } : {}),
        ...(stand === 'begrensd' && st.doelW !== null ? { doel_w: Math.round(st.doelW) } : {}),
        ...(stand === 'eigen' && Number.isInteger(st.waarde) ? { grens_pct: st.waarde } : {}),
        ...(st.verbruikGem !== null ? { verbruik_w: Math.round(st.verbruikGem) } : {}),
        blokken: st.blokken.map((b) => ({
          van: iso(b.van),
          tot: iso(b.tot),
          laagste: rond(b.laagste),
          modus: b.modus,
          ...(b.reden ? { reden: b.reden } : {}),
          ...(reden(b) ? { niet: reden(b) } : {}),
        })),
        ...(huidig && st.klaar.get(huidig.van) === 'nu-aan' ? { nu_aan: true } : {}),
        ...(st.fout ? { fout: st.fout.soort, fout_sinds: iso(st.fout.sinds) } : {}),
        ...(st.vrijOpGezien ? { vrij_op: st.vrijOpGezien } : {}),
        // De zelfcontrole (1.6.0): bezig, of de laatste uitkomst met datum; zonder = nog niet nagekeken.
        ...(st.controleNu
          ? { controle: { uitkomst: 'bezig', pct: st.controleNu.pct, voor_w: Math.round(st.controleNu.voorW) } }
          : c
            ? { controle: { uitkomst: c.uitkomst, op: iso(c.op), ...(c.pct !== null ? { pct: c.pct } : {}), ...(c.voorW !== null ? { voor_w: c.voorW } : {}), ...(c.naW !== null ? { na_w: c.naW } : {}), ...(c.via ? { via: c.via } : {}), ...(c.reden ? { reden: c.reden } : {}) } }
            : {}),
        ...(st.oorspronkelijk ? { oorspronkelijk: { grens_pct: st.oorspronkelijk.grens, schakelaar: st.oorspronkelijk.schakelaar, op: iso(st.oorspronkelijk.op) } } : {}),
      };
    },

    /** Voor de tests en proef. */
    get staat() {
      return st;
    },
  };
}
