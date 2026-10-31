import { datumInNederland } from './kosten.mjs';

/**
 * De spanningswacht (programmaatje 1.5.0, 1.6.0), ALLEEN LEZEN: voor elk huis, ook met alleen een
 * HomeWizard P1 en kWh-meters (zoals in huis B). In huis B valt de omvormer soms uit op zonnige
 * dagen, waarschijnlijk door een te hoge netspanning. In Nederland schakelt een omvormer af als
 * het 10-minutengemiddelde boven 253 V komt (of kort ver erboven).
 *
 *   bijhouden   per fase het lopende 10-minutengemiddelde, de piek van de laatste minuut, en
 *               de hoogste spanning van vandaag (met het moment); de spanning per fase uit de beste
 *               bron (spanningenUit: de omvormer, een driefase zonmeter, een andere driefase meter, de P1)
 *   uitval      valt de zon overdag binnen UITVAL_BINNEN_MS van minstens UITVAL_VAN_W naar
 *               bijna niets, terwijl een fase in de minuten ervoor hoog stond (10 min gemiddeld
 *               ≥ UITVAL_GEM_V of een piek ≥ UITVAL_PIEK_V), dan is dat waarschijnlijk uitval door
 *               hoge spanning: een regel in brug.log, een melding in de app (een kwartier, en dus
 *               één regel in het Logboek), en een regel in de lijst voor de netbeheerder. Een wolk
 *               laat de zon niet in een halve minuut naar nul vallen; begrensde het programmaatje
 *               zelf (omvormer-sturing), dan telt het niet
 *               Bij een GoodWe telt ook wat hij zelf meldt: storingsbit 17 ("netspanning buiten de
 *               grenzen", STORINGEN in goodwe.mjs) is het sterkste bewijs, ook zonder hoge P1-meting
 *   dichtbij    hoe vaak een fase vandaag boven DICHTBIJ_V kwam (een keer = tot hij weer
 *               DICHTBIJ_WEG_MS onder DICHTBIJ_LAAG_V bleef), en hoe vaak hij toen uitviel: zo ziet
 *               de eigenaar hoe dicht hij bij de grens zit ("vandaag 3 keer boven 250 V, niet uitgevallen")
 *   tellen      per dag en per maand hoe vaak, en de lijst (datum, tijd, fase, spanning) van de
 *               laatste HOOGSTENS_LIJST keer; bewaard in spanning.json (ook na een herstart)
 *
 * Er wordt NIETS geschreven of bijgestuurd vanwege de spanning (31-10-2026: "eerst leren
 * of het gebeurt"); de beveiliging van de omvormer zelf raken we nooit aan.
 *
 * Naar de app gaat het blok `spanning` (eens per minuut, versturen.mjs); een oudere functie laat
 * het stil vallen. De melding gaat via brug.meldingen (soort 'spanning'): die kent elke functie.
 */

export const TIEN_MIN_MS = 10 * 60_000;
export const PIEK_MS = 60_000;
/** Uitval herkennen: van minstens zoveel W … */
export const UITVAL_VAN_W = 800;
/** … naar bijna niets (hooguit dit, of 3% van wat het was) … */
export const UITVAL_NAAR_W = 40;
/** … binnen zo lang. */
export const UITVAL_BINNEN_MS = 30_000;
/** Hoog in de minuten ervoor: 10 min gemiddeld of een piek. */
export const UITVAL_GEM_V = 251;
export const UITVAL_PIEK_V = 256;
export const UITVAL_TERUGKIJK_MS = 5 * 60_000;
/** Pas weer een nieuwe uitval als de zon terug is. */
export const HERSTEL_W = 300;
/** Een melding staat een kwartier in de app. */
export const MELDING_MS = 15 * 60_000;
/** Vanaf deze spanning in de let-op-kleur in de app. */
export const LET_OP_V = 250;
/** Dicht bij de grens: boven deze spanning telt een keer; voorbij als hij zo lang onder DICHTBIJ_LAAG_V bleef. */
export const DICHTBIJ_V = 250;
export const DICHTBIJ_LAAG_V = 248;
export const DICHTBIJ_WEG_MS = 2 * 60_000;
/** De storingsbit van de GoodWe voor een netspanning buiten de grenzen (goodwe.mjs, STORINGEN). */
export const BIT_NETSPANNING = 17;
export const HOOGSTENS_LIJST = 30;

const kort = (v) => Math.round(v * 10) / 10;
const heel = (v) => Math.round(v);

const uurNotatie = new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** Waar de spanning vandaan komt, in gewone woorden (ook in de app: src/lib/spanning.js). */
export const BRON_TEKST = Object.freeze({
  omvormer: 'gemeten door de omvormer',
  zon: 'gemeten door de kWh-meter op de zonnepanelen',
  p1: 'gemeten door de slimme meter (P1)',
  meter: 'gemeten door een kWh-meter',
});

/** De sleutels van de wacht: de drie fasen, en de fase van de eenfase-zonmeter. */
const SLEUTEL = /^(L[123]|zon)$/;

const netspanning = (v) => typeof v === 'number' && Number.isFinite(v) && v > 150 && v < 300;

/** Wat een sleutel van de spanningswacht in woorden is: "L2", of "zonnefase" (de fase van een eenfase-zonmeter). */
export const labelVan = (sleutel) => (sleutel === 'zon' ? 'zonnefase' : sleutel);

const naamVan = (h) => (typeof h?.meter?.naam === 'string' && h.meter.naam.trim() ? h.meter.naam.trim().slice(0, 40) : null);
const lijstVan = (h) => (Array.isArray(h?.spanning) ? h.spanning : []).filter((f) => Number.isInteger(f?.fase) && f.fase >= 1 && f.fase <= 3 && netspanning(f.v));

/**
 * De spanning per fase uit de beste bron die er is, per fase (programmaatje 1.6.0):
 *   1. de omvormer (de GoodWe meet zijn eigen drie fasen; het dichtst bij waar hij uitvalt)
 *   2. een driefase kWh-meter op de zon (in huis B, 31-10-2026: de SolarEdge SE6K levert op
 *      alle drie de fasen en de zonmeter is driefase, net als die van de spa): die zit het
 *      dichtst bij de omvormer
 *   3. een andere driefase kWh-meter in huis (in huis B: de meter van de spa)
 *   4. de slimme meter (P1), als die spanning doorgeeft
 * En apart een eenfase kWh-meter op de zon, voor zijn eigen fase ('zon'): daar valt een
 * eenfase-omvormer uit. Welke fase dat is, weten we niet (de eigenaar kiest het bij Namen).
 *
 * Geeft { fasen: [{ fase, v, bron, sleutel?, naam? }], zon: { v, sleutel, naam? }|null,
 * spanningen: [{ sleutel: 'L1'|'L2'|'L3'|'zon', v, bron }] (voor de wacht), bron: de bron van de
 * eerste fase (of 'zon', of null), tweede: { bron, naam?, fasen: [{ fase, v }] }|null }.
 * `tweede`: komen de fasen van een driefase zonmeter, dan de volgende driefase bron (de spa-meter,
 * anders de P1), om per fase het verschil te zien (zon min die meter).
 */
export function spanningenUit({ meting = null, omvormer = null, homewizard = [] } = {}) {
  const kandidaten = [];
  const goodwe = [];
  (Array.isArray(omvormer?.fasen) ? omvormer.fasen : []).forEach((f, i) => {
    if (netspanning(f?.v)) goodwe.push({ fase: i + 1, v: f.v });
  });
  if (goodwe.length) kandidaten.push({ bron: 'omvormer', fasen: goodwe });
  const opZon = (h) => ['zon', 'zon-en-batterij'].includes(h?.meter?.rol);
  const driefase = (homewizard ?? []).filter((h) => h?.meter?.rol !== 'net' && lijstVan(h).length >= 2);
  // Eerst een driefase meter op de zon (het dichtst bij de omvormer), dan een andere in huis.
  for (const h of [...driefase.filter(opZon), ...driefase.filter((x) => !opZon(x))]) {
    kandidaten.push({ bron: opZon(h) ? 'zon' : 'meter', sleutel: h.meter.sleutel, naam: naamVan(h), fasen: lijstVan(h) });
  }
  const p1 = (Array.isArray(meting?.fasen) ? meting.fasen : []).filter((f) => Number.isInteger(f?.fase) && netspanning(f.v)).map((f) => ({ fase: f.fase, v: f.v }));
  if (p1.length) kandidaten.push({ bron: 'p1', fasen: p1 });
  const fasen = [];
  for (const fase of [1, 2, 3]) {
    for (const k of kandidaten) {
      const f = k.fasen.find((x) => x.fase === fase);
      if (!f) continue;
      fasen.push({ fase, v: f.v, bron: k.bron, ...(k.sleutel ? { sleutel: k.sleutel } : {}), ...(k.naam ? { naam: k.naam } : {}) });
      break;
    }
  }
  const zonMeter = (homewizard ?? []).find((h) => opZon(h) && lijstVan(h).length === 1);
  const zon = zonMeter ? { v: lijstVan(zonMeter)[0].v, sleutel: zonMeter.meter.sleutel, ...(naamVan(zonMeter) ? { naam: naamVan(zonMeter) } : {}) } : null;
  const spanningen = [...fasen.map((f) => ({ sleutel: `L${f.fase}`, v: f.v, bron: f.sleutel ?? f.bron })), ...(zon ? [{ sleutel: 'zon', v: zon.v, bron: zon.sleutel }] : [])];
  // Driefase zonmeter: de volgende bron om mee te vergelijken (de spa-meter, anders de P1).
  const zonIndex = kandidaten.findIndex((k) => k.bron === 'zon');
  const ander = zonIndex >= 0 ? kandidaten.slice(zonIndex + 1).find((k) => k.bron === 'meter' || k.bron === 'p1') : null;
  const tweede = ander && fasen.some((f) => f.bron === 'zon') ? { bron: ander.bron, ...(ander.naam ? { naam: ander.naam } : {}), fasen: ander.fasen } : null;
  return { fasen, zon, spanningen, bron: fasen[0]?.bron ?? (zon ? 'zon' : null), tweede };
}

/**
 * @param {{ opgeslagen?: object|null, bewaar?: (staat: object) => void }} [o]
 */
export function spanningWacht({ opgeslagen = null, bewaar = () => {} } = {}) {
  const o = opgeslagen && typeof opgeslagen === 'object' ? opgeslagen : {};
  const lijstUit = (l) =>
    (Array.isArray(l) ? l : []).filter((x) => x && typeof x.op === 'string' && SLEUTEL.test(x.sleutel ?? '') && typeof x.v === 'number').slice(-HOOGSTENS_LIJST);
  const st = {
    monsters: new Map(), // sleutel ('L1', 'L2', 'L3', 'zon') → { bron, rij: [{ t, v }] } van de laatste 10 minuten
    dag: typeof o.dag?.datum === 'string' && o.dag.hoogste && typeof o.dag.hoogste === 'object' ? o.dag : null, // { datum, hoogste: { sleutel: { v, op } }, uitval, … }
    maand: typeof o.maand?.maand === 'string' ? o.maand : null, // { maand, uitval }
    lijst: lijstUit(o.lijst),
    zon: [], // [{ t, w }] van de laatste minuut
    wachtOpHerstel: false,
    meldingen: [], // { tekst, sinds }
    // Een keer dicht bij de grens: sinds wanneer, sinds wanneer weer laag, en of hij toen uitviel.
    dichtbij: null,
    bitWas: false,
    herkomst: null,
  };

  const opslaan = () => bewaar({ dag: st.dag, maand: st.maand, lijst: st.lijst });

  /** Het 10-minutengemiddelde, de piek van de laatste minuut en de hoogste van de laatste UITVAL_TERUGKIJK_MS, per fase. */
  function toestand(nu) {
    const uit = [];
    for (const [sleutel, { rij }] of [...st.monsters].sort((a, b) => a[0].localeCompare(b[0]))) {
      const vers = rij.filter((m) => nu - m.t <= TIEN_MIN_MS);
      if (!vers.length) continue;
      const gem = vers.reduce((s, m) => s + m.v, 0) / vers.length;
      const piek = Math.max(...vers.filter((m) => nu - m.t <= PIEK_MS).map((m) => m.v), -Infinity);
      const terug = vers.filter((m) => nu - m.t <= UITVAL_TERUGKIJK_MS).map((m) => m.v);
      uit.push({ sleutel, gem: kort(gem), piek: Number.isFinite(piek) ? kort(piek) : null, hoogsteRecent: terug.length ? kort(Math.max(...terug)) : null, laatste: kort(vers.at(-1).v), duurMs: nu - vers[0].t });
    }
    return uit;
  }

  return {
    toestand,

    /**
     * Eén ronde. Geeft de nieuwe zinnen voor brug.log.
     * @param {{ nu: number, spanningen: { sleutel: string, v: number, bron?: string }[], fasen?: object[], zon?: object|null, tweede?: object|null, zonW: number|null, nacht: boolean, zelfBegrensd?: boolean, storingen?: number[] }} r
     *   spanningen, fasen, zon en tweede zoals spanningenUit ze geeft;
     *   zonW: de zon die uit kan vallen (de omvormer, anders alle zon samen); zelfBegrensd: het programmaatje begrensde hem zelf;
     *   storingen: de storingsbits van de GoodWe (omvormer.storingen), als die er is
     */
    ronde({ nu, spanningen = [], fasen = [], zon = null, tweede = null, zonW = null, nacht = false, zelfBegrensd = false, storingen = [] }) {
      const zinnen = [];
      // Waar elke spanning vandaan komt, voor de app ("gemeten door de spa-meter").
      st.herkomst = [
        ...fasen.map((f) => ({ sleutel: `L${f.fase}`, bron: f.bron, ...(f.naam ? { naam: f.naam } : {}) })),
        ...(zon ? [{ sleutel: 'zon', bron: 'zon', ...(zon.naam ? { naam: zon.naam } : {}) }] : []),
      ];
      const datum = datumInNederland(nu);
      if (st.dag?.datum !== datum) st.dag = { datum, hoogste: {}, uitval: 0, dichtbij: 0, dichtbij_uitval: 0 };
      st.dag.dichtbij ??= 0;
      st.dag.dichtbij_uitval ??= 0;
      if (st.maand?.maand !== datum.slice(0, 7)) st.maand = { maand: datum.slice(0, 7), uitval: 0 };
      let veranderd = false;
      for (const { sleutel, v, bron = null } of spanningen) {
        if (!SLEUTEL.test(sleutel)) continue;
        // Wisselt de bron van een fase (de omvormer slaapt, dan de P1), dan begint zijn gemiddelde opnieuw: geen mengsel.
        const oud = st.monsters.get(sleutel);
        const m = oud && oud.bron === bron ? oud : { bron, rij: [] };
        m.rij.push({ t: nu, v });
        while (m.rij.length && nu - m.rij[0].t > TIEN_MIN_MS) m.rij.shift();
        st.monsters.set(sleutel, m);
        const h = st.dag.hoogste[sleutel];
        if (!h || v > h.v) {
          st.dag.hoogste[sleutel] = { v: kort(v), op: new Date(nu).toISOString() };
          // Niet elke tiende volt bewaren: alleen een hele volt erbij.
          if (!h || heel(v) > heel(h.v)) veranderd = true;
        }
      }

      // Het verschil per fase tussen de zonmeter en een meter in huis (zon min die fase), het grootste van vandaag:
      //   eenfase zonmeter: tegen elke fase van de driefase meter (welke fase de zon is, weten we niet; de app toont
      //     het bij de fase die de eigenaar kiest);
      //   driefase zonmeter (in huis B, 1.6.0): per fase tegen dezelfde fase van de andere meter (L1 zon − L1 spa, enz.).
      const zonNu = spanningen.find((x) => x.sleutel === 'zon')?.v;
      const paren =
        typeof zonNu === 'number'
          ? fasen.filter((x) => x.bron === 'meter' || x.bron === 'p1').map((f) => ({ fase: f.fase, verschil: kort(zonNu - f.v) }))
          : tweede
            ? fasen.filter((x) => x.bron === 'zon').flatMap((f) => {
                const t = tweede.fasen.find((x) => x.fase === f.fase);
                return t && netspanning(t.v) ? [{ fase: f.fase, verschil: kort(f.v - t.v) }] : [];
              })
            : [];
      if (paren.length) {
        st.dag.verschil ??= {};
        if (tweede?.naam && typeof zonNu !== 'number') st.dag.verschil_met = tweede.naam;
        for (const { fase, verschil } of paren) {
          const oud = st.dag.verschil[`L${fase}`];
          if (!oud || Math.abs(verschil) > Math.abs(oud.v)) {
            st.dag.verschil[`L${fase}`] = { v: verschil, op: new Date(nu).toISOString() };
            if (!oud || Math.abs(heel(verschil)) > Math.abs(heel(oud.v))) veranderd = true;
          }
        }
      }

      // Dicht bij de grens: een keer begint boven DICHTBIJ_V en is voorbij na DICHTBIJ_WEG_MS onder DICHTBIJ_LAAG_V.
      if (spanningen.length) {
        const hoogste = Math.max(...spanningen.map((x) => x.v));
        if (hoogste > DICHTBIJ_V) {
          if (!st.dichtbij) {
            st.dichtbij = { sinds: nu, laag: null, uitval: false };
            st.dag.dichtbij += 1;
            veranderd = true;
          }
          st.dichtbij.laag = null;
        } else if (st.dichtbij && hoogste < DICHTBIJ_LAAG_V) {
          st.dichtbij.laag ??= nu;
          if (nu - st.dichtbij.laag >= DICHTBIJ_WEG_MS) st.dichtbij = null;
        }
      }

      const uitval = (hoog, waarom) => {
        const tijd = uurNotatie.format(new Date(nu));
        const piek = hoog ? (hoog.hoogsteRecent ?? hoog.laatste) : null;
        // Meten de zonmeter en een driefase meter allebei: allebei erbij (welke fase de zon is, weten we niet).
        const laatste = new Map(toestand(nu).map((f) => [f.sleutel, f.laatste]));
        const meterFasen = fasen.filter((f) => f.bron === 'meter' || f.bron === 'p1');
        const meterNaam = meterFasen[0]?.naam ?? (meterFasen[0]?.bron === 'p1' ? 'P1' : 'meter');
        const teken = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(heel(v))}`;
        // Twee driefase meters (zon en spa, 1.6.0): het verschil per fase van nu (zon min de andere meter).
        const perFase = tweede
          ? fasen
              .filter((f) => f.bron === 'zon')
              .flatMap((f) => {
                const t = tweede.fasen.find((x) => x.fase === f.fase);
                return t && netspanning(t.v) ? [`L${f.fase} ${teken(f.v - t.v)}`] : [];
              })
          : [];
        const beide = !hoog
          ? ''
          : perFase.length
            ? `; verschil met ${tweede.naam ?? (tweede.bron === 'p1' ? 'P1' : 'meter')} ${perFase.join(', ')} V`
            : !zon || !meterFasen.length
              ? ''
              : hoog.sleutel === 'zon'
                ? `; ${meterNaam} ${meterFasen.map((f) => `L${f.fase} ${heel(laatste.get(`L${f.fase}`) ?? f.v)}`).join('/')} V`
                : `; zonmeter ${heel(laatste.get('zon') ?? zon.v)} V`;
        const kern = hoog
          ? `Omvormer viel om ${tijd} uit bij hoge netspanning${waarom}: ${labelVan(hoog.sleutel)} ${heel(piek)} V (10 min gem. ${heel(hoog.gem)} V)`
          : `Omvormer viel om ${tijd} uit${waarom}`;
        const slot = '. Meld het bij de netbeheerder.';
        const tekst = `${kern}${(kern + beide + slot).length <= 160 ? beide : ''}${slot}`;
        st.meldingen.push({ tekst, sinds: nu });
        st.dag.uitval += 1;
        st.maand.uitval += 1;
        if (st.dichtbij && !st.dichtbij.uitval) {
          st.dichtbij.uitval = true;
          st.dag.dichtbij_uitval += 1;
        }
        if (hoog) st.lijst = [...st.lijst, { op: new Date(nu).toISOString(), sleutel: hoog.sleutel, v: kort(piek), gem: kort(hoog.gem), ...(waarom ? { omvormer: true } : {}) }].slice(-HOOGSTENS_LIJST);
        zinnen.push(tekst);
        veranderd = true;
      };
      const hoogsteFase = (filter) =>
        toestand(nu)
          .filter(filter)
          .sort((a, b) => (b.hoogsteRecent ?? b.gem) - (a.hoogsteRecent ?? a.gem))[0] ?? null;

      // De GoodWe zegt het zelf (storingsbit 17): het sterkste bewijs, ook als de P1-meter het niet zo hoog zag.
      const bit = Array.isArray(storingen) && storingen.includes(BIT_NETSPANNING);
      if (bit && !st.bitWas && !st.wachtOpHerstel) {
        st.wachtOpHerstel = true;
        uitval(hoogsteFase(() => true), ' (melding van de omvormer)');
      }
      st.bitWas = bit;

      // Uitval herkennen: de zon van flink naar bijna niets, binnen een halve minuut, overdag.
      if (typeof zonW === 'number' && Number.isFinite(zonW)) {
        st.zon.push({ t: nu, w: zonW });
        while (st.zon.length && nu - st.zon[0].t > UITVAL_BINNEN_MS) st.zon.shift();
        if (st.wachtOpHerstel && zonW >= HERSTEL_W && !bit) st.wachtOpHerstel = false;
        const was = Math.max(...st.zon.filter((z) => z.t < nu).map((z) => z.w), -Infinity);
        const weg = zonW <= Math.max(UITVAL_NAAR_W, was * 0.03);
        if (!nacht && !zelfBegrensd && !st.wachtOpHerstel && was >= UITVAL_VAN_W && weg) {
          st.wachtOpHerstel = true;
          const hoog = hoogsteFase((f) => f.gem >= UITVAL_GEM_V || (f.hoogsteRecent ?? 0) >= UITVAL_PIEK_V);
          // Zonder hoge spanning: geen spanningsuitval (een storing, of de omvormer zelf); dat zegt de omvormer of de meter al.
          if (hoog) uitval(hoog, '');
        }
      }
      st.meldingen = st.meldingen.filter((m) => nu - m.sinds < MELDING_MS);
      if (veranderd) opslaan();
      return zinnen;
    },

    /** Wat er nu als melding in de app staat ({ tekst, sinds }), voor brug.meldingen (soort 'spanning'). */
    meldingen: () => st.meldingen.map((m) => ({ ...m })),

    /** Het blok `spanning` voor de app. */
    voorApp(nu) {
      const nuFasen = toestand(nu);
      const hoogste = Object.entries(st.dag?.hoogste ?? {})
        .filter(([sleutel]) => SLEUTEL.test(sleutel))
        .map(([sleutel, h]) => ({ sleutel, v: h.v, op: h.op }))
        .sort((a, b) => a.sleutel.localeCompare(b.sleutel));
      // Ook zonder spanning een blok (bron null): dan zegt de app "deze meterkast geeft geen spanning door".
      return {
        // Waar elke spanning vandaan komt; leeg: deze meterkast geeft geen spanning door.
        herkomst: st.herkomst ?? [],
        datum: st.dag?.datum ?? datumInNederland(nu),
        nu: nuFasen.map((f) => ({ sleutel: f.sleutel, v: f.laatste, gem10: f.gem })),
        hoogste,
        // Het grootste verschil vandaag tussen de zonmeter en elke fase van de andere meter (zon min fase), als ze er allebei zijn.
        verschil: Object.entries(st.dag?.verschil ?? {})
          .filter(([sleutel, x]) => /^L[123]$/.test(sleutel) && typeof x?.v === 'number')
          .map(([sleutel, x]) => ({ sleutel, v: x.v, op: x.op }))
          .sort((a, b) => a.sleutel.localeCompare(b.sleutel)),
        // Twee driefase meters (1.6.0): met welke meter de driefase zonmeter vergeleken is (de naam, zoals "Spa").
        ...(typeof st.dag?.verschil_met === 'string' ? { verschil_met: st.dag.verschil_met } : {}),
        uitval_vandaag: st.dag?.uitval ?? 0,
        boven_250_vandaag: st.dag?.dichtbij ?? 0,
        boven_250_uitgevallen: st.dag?.dichtbij_uitval ?? 0,
        maand: st.maand?.maand ?? datumInNederland(nu).slice(0, 7),
        uitval_maand: st.maand?.uitval ?? 0,
        lijst: st.lijst.slice(-HOOGSTENS_LIJST),
      };
    },

    get staat() {
      return st;
    },
  };
}
