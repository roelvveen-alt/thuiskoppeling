import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Wat je vandaag hebt betaald en verdiend, uit de tellers van de P1-meter.
 *
 * Bij elke meting kijken we hoeveel kWh er sinds de vorige meting bij is
 * gekomen (afname en teruglevering apart) en vermenigvuldigen dat met de prijs
 * van dat moment. Zo tellen we geen schattingen op, maar precies wat de meter
 * telt, met de prijs van het kwartier of uur waarin het gebeurde.
 *
 * Een dag loopt van middernacht tot middernacht, Nederlandse tijd. Wat er
 * tussen de laatste meting voor en de eerste na middernacht gebeurt, telt
 * mee voor de nieuwe dag (een paar seconden).
 *
 * Reserve: antwoordt de HomeWizard P1 niet (geen tellers), maar de Zendure P1
 * op dezelfde meterkast wel, dan tellen we met diens vermogen × de tijd sinds
 * de vorige meting. Komt de HomeWizard terug, dan telt van de sprong in zijn
 * tellers alleen wat de reserve nog niet telde: niets dubbel, en een korte
 * hapering (één gemiste meting) telt gewoon helemaal mee.
 */

/** Grotere sprongen zijn geen verbruik: de meter is vervangen, teruggezet of er was een lang gat. */
const HOOGSTENS_KWH_PER_STAP = 5;

/**
 * Langer dan dit tussen twee lezingen van de tellers (wifi weg, Android schoot het programmaatje af):
 * dan verdelen we de sprong gelijk over de tijd van het gat, elk kwartier met zijn eigen prijs, en
 * telt alleen wat na middernacht viel voor vandaag. Dat is een schatting: de dag heet dan niet compleet.
 * Ruim boven de langste gewone pauze (twee minuten als Base44 remt).
 */
const LANG_GAT_MS = 5 * 60_000;
const KWARTIER_MS = 15 * 60_000;

/** Langer tussen twee metingen van de Zendure P1: dat stuk tellen we niet (ook de reserve had een gat). */
const HOOGSTENS_RESERVE_STAP_MS = 60_000;

/** kWh bij de dag tellen, met de prijs van nu (zonder prijs: alleen kWh, en de dag is onvolledig). */
function boek(dag, erbij, eraf, prijs) {
  dag.afname_kwh += erbij;
  dag.teruglevering_kwh += eraf;
  if (prijs) {
    dag.kosten_eur += erbij * prijs.afname_kwh;
    dag.opbrengst_eur += eraf * prijs.teruglevering_kwh;
  } else {
    dag.zonder_prijs_kwh += erbij + eraf;
  }
}

/**
 * Een sprong over een lang gat: gelijk verdeeld over [van, tot), per kwartier met de prijs van dat
 * kwartier (prijsVoor), en alleen wat op `dag.datum` valt. Wat zo geteld is, staat ook in geschat_kwh.
 */
function boekOverGat(dag, erbij, eraf, van, tot, prijsVoor) {
  const duur = tot - van;
  for (let a = van; a < tot; ) {
    const b = Math.min(tot, (Math.floor(a / KWARTIER_MS) + 1) * KWARTIER_MS);
    // Kwartieren in Nederland vallen samen met die in UTC; middernacht is altijd een kwartiergrens.
    if (datumInNederland(a) === dag.datum) {
      const deel = (b - a) / duur;
      boek(dag, erbij * deel, eraf * deel, prijsVoor(a));
      dag.geschat_kwh = (dag.geschat_kwh ?? 0) + (erbij + eraf) * deel;
    }
    a = b;
  }
}

const dagNotatie = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' });

/** "2026-10-30" voor een moment, in Nederlandse tijd. */
export function datumInNederland(ms) {
  return dagNotatie.format(new Date(ms));
}

/** De datum na "2026-10-30", op de datumtekst: een dag is niet altijd 24 uur (zomer- en wintertijd). */
export function morgenVan(datum) {
  const [j, m, d] = datum.split('-').map(Number);
  return new Date(Date.UTC(j, m - 1, d + 1)).toISOString().slice(0, 10);
}

export function nieuweDag(datum) {
  return { datum, afname_kwh: 0, teruglevering_kwh: 0, kosten_eur: 0, opbrengst_eur: 0, zonder_prijs_kwh: 0, geschat_kwh: 0 };
}

/** Hoeveel kWh de teruglevering per uur hooguit kan stijgen (ruim boven elke thuisaansluiting), plus 1 kWh speling. */
const HOOGSTENS_KW = 25;

/** Een lagere tellerstand geloven we pas als nieuwe meter na zoveel lezingen op rij, over minstens een minuut. */
const NIEUWE_METER_LEZINGEN = 3;
const NIEUWE_METER_MS = 60_000;

/**
 * Hoeveel er dit kalenderjaar is teruggeleverd, voor het plafond van de
 * Zonnebonus ("de eerste 7.500 kWh die je per kalenderjaar teruglevert").
 * Uit de teller van de P1-meter, dus ook goed als het programmaatje een tijd
 * uit stond: begin_kwh is de tellerstand die bij 0 kWh dit jaar hoort.
 * De eerste keer in een jaar telt `al` mee: wat er dit jaar al was
 * teruggeleverd (uit de Zonneplan-app), alleen voor het jaar dat erbij staat.
 *
 * De meter hapert soms (één keer 0 of een te lage stand, na een herstart of
 * update van de HomeWizard). Daarom vergelijken we met de laatste goede stand
 * (teller_kwh): een stap omhoog telt als hij kan (hooguit 25 kW × de tijd
 * sinds de vorige lezing, plus 1 kWh; een week uit kan dus). Een losse lage of
 * onmogelijke lezing slaan we over. Een lagere stand is pas een nieuwe meter na
 * een paar lezingen op rij over minstens een minuut; dan tellen we verder vanaf
 * wat er al was.
 *
 * @param {{ jaar: number, begin_kwh: number|null, teruglevering_kwh: number, teller_kwh?: number, moment?: number,
 *           lager?: { teller_kwh: number, sinds: number, keer: number }|null }|null} jaar  de vorige stand
 * @param {{ teruglevering_kwh: number|null }|null} tellers  P1-tellers nu
 * @param {{ jaar: number, kwh: number }|null} al
 */
export function volgJaar(jaar, tellers, nu, al = null) {
  const nr = Number(datumInNederland(nu).slice(0, 4));
  const vorig = jaar?.jaar === nr ? jaar : null;
  const teller = tellers?.teruglevering_kwh;
  const start = vorig?.teruglevering_kwh ?? (al?.jaar === nr ? al.kwh : 0);
  if (!Number.isFinite(teller)) return vorig ?? { jaar: nr, begin_kwh: null, teruglevering_kwh: start };
  if (!Number.isFinite(vorig?.begin_kwh)) {
    return { jaar: nr, begin_kwh: teller - start, teruglevering_kwh: start, teller_kwh: teller, moment: nu, lager: null };
  }
  // Oudere standen (van voor teller_kwh): boven het begin is goed, zoals vroeger; anders het begin plus wat er geteld is.
  const oud = !Number.isFinite(vorig.teller_kwh);
  const laatste = oud ? (teller >= vorig.begin_kwh ? teller : vorig.begin_kwh + vorig.teruglevering_kwh) : vorig.teller_kwh;
  const stap = teller - laatste;

  if (stap < 0) {
    // Lager dan de laatste goede stand: een hapering, of een nieuwe meter. Eerst zien, dan geloven.
    const l = vorig.lager;
    const verder = l && teller >= l.teller_kwh;
    const lager = verder ? { ...l, keer: l.keer + 1 } : { teller_kwh: teller, sinds: nu, keer: 1 };
    if (lager.keer >= NIEUWE_METER_LEZINGEN && nu - lager.sinds >= NIEUWE_METER_MS) {
      // Een nieuwe of teruggezette meter: verder tellen vanaf wat er al was, met wat hij sindsdien telde.
      const begin = lager.teller_kwh - vorig.teruglevering_kwh;
      return { jaar: nr, begin_kwh: begin, teruglevering_kwh: teller - begin, teller_kwh: teller, moment: nu, lager: null };
    }
    return { ...vorig, lager };
  }

  const uren = Number.isFinite(vorig.moment) ? Math.max(0, nu - vorig.moment) / 3_600_000 : Infinity;
  if (stap > HOOGSTENS_KW * uren + 1) return { ...vorig, lager: null }; // onmogelijk veel: overslaan
  return { jaar: nr, begin_kwh: vorig.begin_kwh, teruglevering_kwh: teller - vorig.begin_kwh, teller_kwh: teller, moment: nu, lager: null };
}

/**
 * @param {{ dag: object|null, vorige: { afname_kwh, teruglevering_kwh }|null, jaar?: object|null,
 *           reserve?: { moment: number, afname_kwh: number, teruglevering_kwh: number }|null }} stand
 * @param {{ afname_kwh: number|null, teruglevering_kwh: number|null }|null} tellers  P1-tellers nu
 * @param {{ afname_kwh: number, teruglevering_kwh: number }|null} prijs  € per kWh op dit moment
 * @param {number} nu  ms
 * @param {{ reserveW?: number|null, prijsVoor?: (ms: number) => object|null }} [opties]
 *   reserveW: vermogen van de Zendure P1 nu (plus afnemen, min terugleveren);
 *   prijsVoor: de prijs van een eerder moment, voor een lang gat (zonder: de prijs van nu)
 * @returns {{ dag: object, vorige: object|null, jaar: object|null, reserve: object|null }}
 *   jaar gaat ongewijzigd mee (zie volgJaar), behalve wat de reserve teruglevert:
 *   dat telt er tijdelijk bij, tot de teller van de HomeWizard het weer weet.
 */
export function telBij(stand, tellers, prijs, nu, { reserveW = null, prijsVoor = () => prijs } = {}) {
  const datum = datumInNederland(nu);
  const dag = stand?.dag?.datum === datum ? { ...stand.dag } : nieuweDag(datum);
  let jaar = stand?.jaar ?? null;
  const reserve = stand?.reserve ?? null;
  const geldig = tellers && Number.isFinite(tellers.afname_kwh) && Number.isFinite(tellers.teruglevering_kwh);

  if (!geldig) {
    if (!Number.isFinite(reserveW)) return { dag, vorige: stand?.vorige ?? null, jaar, reserve };
    // De HomeWizard antwoordt niet: tellen met de Zendure P1, vermogen × de tijd sinds de vorige keer.
    const geteld = { afname_kwh: reserve?.afname_kwh ?? 0, teruglevering_kwh: reserve?.teruglevering_kwh ?? 0 };
    const stap = Number.isFinite(reserve?.moment) ? nu - reserve.moment : null;
    if (stap !== null && stap > 0 && stap <= HOOGSTENS_RESERVE_STAP_MS) {
      const kwh = (Math.abs(reserveW) * stap) / 3_600_000_000;
      const erbij = reserveW > 0 ? kwh : 0;
      const eraf = reserveW < 0 ? kwh : 0;
      boek(dag, erbij, eraf, prijs);
      geteld.afname_kwh += erbij;
      geteld.teruglevering_kwh += eraf;
      if (jaar && eraf > 0) jaar = { ...jaar, teruglevering_kwh: jaar.teruglevering_kwh + eraf };
    }
    return { dag, vorige: stand?.vorige ?? null, jaar, reserve: { moment: nu, ...geteld } };
  }

  const vorige = stand?.vorige;
  if (vorige) {
    // Na een gat met de reserve: alleen wat die nog niet telde.
    const erbij = tellers.afname_kwh - vorige.afname_kwh;
    const eraf = tellers.teruglevering_kwh - vorige.teruglevering_kwh;
    // Een lang gat zonder reserve: de grens groeit mee met de tijd (25 kW × de uren, plus 1 kWh).
    const gat = Number.isFinite(vorige.moment) ? nu - vorige.moment : null;
    const lang = gat !== null && gat > LANG_GAT_MS && !reserve;
    const grens = lang ? Math.max(HOOGSTENS_KWH_PER_STAP, (HOOGSTENS_KW * gat) / 3_600_000 + 1) : HOOGSTENS_KWH_PER_STAP;
    if (erbij >= 0 && eraf >= 0 && erbij < grens && eraf < grens) {
      if (lang) boekOverGat(dag, erbij, eraf, vorige.moment, nu, prijsVoor);
      else boek(dag, Math.max(0, erbij - (reserve?.afname_kwh ?? 0)), Math.max(0, eraf - (reserve?.teruglevering_kwh ?? 0)), prijs);
    } else {
      // Een onmogelijke stap (een hapering van de meter): de laatste goede stand houden, zodat de
      // stap erna gewoon telt. Pas na een paar keer op rij is het echt (nieuwe meter, lang gat);
      // dan is de dag niet compleet.
      const vreemd = (stand?.vreemd ?? 0) + 1;
      if (vreemd < NIEUWE_METER_LEZINGEN) return { dag, vorige, jaar, reserve, vreemd };
      dag.onvolledig = true;
    }
  }
  return { dag, vorige: { afname_kwh: tellers.afname_kwh, teruglevering_kwh: tellers.teruglevering_kwh, moment: nu }, jaar, reserve: null };
}

/**
 * De vaste kosten van één dag: levering en netbeheer, min de korting op de
 * energiebelasting. Die staan per maand op de rekening, dus gedeeld door de
 * dagen van die maand. Min = per saldo krijg je geld terug.
 * @param {{ levering_per_maand: number, netbeheer_per_maand: number, vermindering_energiebelasting_per_maand: number }|null} vast
 */
export function vastPerDag(vast, datum) {
  if (!vast) return null;
  const [j, m] = datum.split('-').map(Number);
  const dagen = new Date(Date.UTC(j, m, 0)).getUTCDate();
  return (vast.levering_per_maand + vast.netbeheer_per_maand - vast.vermindering_energiebelasting_per_maand) / dagen;
}

/** Afgerond voor de app: kWh op 3 decimalen, euro's op 4 (centen tellen zich anders scheef op). */
export function dagVoorApp(dag, vasteKosten = null) {
  if (!dag) return null;
  const r = (v, n) => Math.round(v * 10 ** n) / 10 ** n;
  return {
    datum: dag.datum,
    afname_kwh: r(dag.afname_kwh, 3),
    teruglevering_kwh: r(dag.teruglevering_kwh, 3),
    kosten_eur: r(dag.kosten_eur, 4),
    opbrengst_eur: r(dag.opbrengst_eur, 4),
    vaste_kosten_eur: vasteKosten === null ? null : r(vasteKosten, 4),
    // Zonder prijs, geschat over een gat, of een sprong die niet te tellen was: niet compleet.
    compleet: dag.zonder_prijs_kwh < 0.001 && !((dag.geschat_kwh ?? 0) >= 0.001) && dag.onvolledig !== true,
  };
}

const tekstPad = (pad) => (pad instanceof URL ? fileURLToPath(pad) : String(pad));

/**
 * De stand van vandaag bewaren, zodat een herstart van het programmaatje de
 * dag niet kwijtraakt. Eerst naar vandaag.json.nieuw (en echt op de schijf,
 * fsync), dan hernoemen: valt de stroom weg of schiet Android het programmaatje
 * af, dan is er nooit een half bestand. De vorige goede blijft als
 * vandaag.json.vorige, voor als het toch misgaat.
 * Geeft de fout terug als het niet lukte (niet stoppen; wel één keer melden), anders null.
 */
export function bewaarStand(pad, stand) {
  const doel = tekstPad(pad);
  const nieuw = `${doel}.nieuw`;
  try {
    const fd = fs.openSync(nieuw, 'w');
    try {
      fs.writeSync(fd, `${JSON.stringify(stand)}\n`);
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

const tijdNotatie = new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit' });

/** Het bestand als JSON, of null als het er niet is of kapot is. */
function leesStand(pad) {
  try {
    return JSON.parse(fs.readFileSync(pad, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Een andere dag begint opnieuw maar onthoudt de tellers (en wat de reserve
 * in een lopend gat al telde, zodat dat niet dubbel gaat); de jaarstand
 * blijft tot 1 januari. Het logboek per kwartier (dag.mjs) gaat altijd mee:
 * bij een nieuwe dag begint logMeting zelf opnieuw, en houdt de week met de
 * daggemiddelden per fase.
 * Is vandaag.json kapot of weg, dan gaan we verder met vandaag.json.vorige
 * (en zeggen dat via `log`); een kapot bestand gaat opzij als vandaag.json.kapot.
 */
export function laadStand(pad, nu, { log: melden = null } = {}) {
  // Alleen met `log` (het draaiende programmaatje) zetten we een kapot bestand opzij; proef kijkt alleen.
  const log = melden ?? (() => {});
  const datum = datumInNederland(nu);
  const doel = tekstPad(pad);
  let stand = leesStand(doel);
  if (stand === null && melden && fs.existsSync(doel)) {
    // Er is wel een bestand, maar het is kapot: opzij zetten (om na te kijken), niet stil overschrijven.
    try {
      fs.renameSync(doel, `${doel}.kapot`);
      log(`${path.basename(doel)} was kapot; ik heb hem opzij gezet als ${path.basename(doel)}.kapot.`);
    } catch {
      // Opzij zetten lukte niet: dan wordt hij bij de volgende keer bewaren gewoon vervangen.
    }
  }
  if (stand === null) {
    const vorige = leesStand(`${doel}.vorige`);
    if (vorige !== null) {
      let wanneer = '';
      try {
        wanneer = ` van ${tijdNotatie.format(fs.statSync(`${doel}.vorige`).mtime)}`;
      } catch {
        // Geen tijd: dan zonder.
      }
      log(`${path.basename(doel)} was kapot of weg; ik ga verder met de stand${wanneer}.`);
      stand = vorige;
    }
  }
  if (stand === null || typeof stand !== 'object') return { dag: null, vorige: null, jaar: null, logboek: null, reserve: null, bewaard_op: null };
  const jaar = stand?.jaar?.jaar === Number(datum.slice(0, 4)) ? stand.jaar : null;
  const logboek = stand?.logboek ?? null;
  const reserve = stand?.reserve ?? null;
  // Wanneer dit het laatst bewaard is: een klok daarvoor klopt niet (zie klokKlopt in bewaking.mjs).
  const bewaard_op = Number.isFinite(stand?.bewaard_op) ? stand.bewaard_op : null;
  return stand?.dag?.datum === datum
    ? { ...stand, jaar, logboek, reserve, bewaard_op }
    : { dag: null, vorige: stand?.vorige ?? null, jaar, logboek, reserve, bewaard_op };
}
