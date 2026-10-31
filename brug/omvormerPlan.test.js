import { describe, expect, it } from 'vitest';
import {
  beoordeel,
  CONTROLE_MS,
  EXPORT_DUUR_MS,
  instellingUit,
  kiesStap,
  MAX_PER_DAG,
  MAX_PER_UUR,
  maakStuurder,
  nominaalUitType,
  OMLAAG_TUSSEN_MS,
  planUit,
  planZinnen,
  prijsNu,
  prijzenVan,
  stapVoor,
  TEKORT_DUUR_MS,
  WACHT_OP_APP_MS,
} from './omvormerPlan.mjs';
import { TOEGESTAAN } from './omvormerSturen.mjs';
import { EINDE_SALDERING, zonneplanTijdvak } from './prijzen.mjs';

const KW = 15 * 60_000;
/** Een kwartier met Zonneplan-regels: zonder belasting `zonder`, met belasting +0,13 (energiebelasting met btw). */
const kwartier = (van, zonder, { eb = 0.13, isDag = true } = {}) => zonneplanTijdvak({ van, tot: van + KW, alles: zonder + eb, zonderBelasting: zonder, isDag });
/** Kwartieren vanaf `begin` met deze prijzen zonder belasting. */
const reeks = (begin, prijzen, opties) => prijzen.map((p, i) => kwartier(begin + i * KW, p, opties));

// Een zomerdag in 2027 (geen saldering) en een in 2026 (met saldering). 12:00 Nederlandse tijd = 10:00 UTC.
const ZOMER_2027 = Date.parse('2027-06-01T10:00:00Z');
const ZOMER_2026 = Date.parse('2026-06-01T10:00:00Z');

describe('wat terugleveren waard is: saldering tot 2027', () => {
  it('2026, netto-afnemer: de energiebelasting komt terug via de saldering; een kale prijs van −10 ct is dan +3 ct waard', () => {
    const p = prijzenVan(kwartier(ZOMER_2026, -0.1));
    expect(p.v).toBeCloseTo(0.03, 9);
    expect(p.kaal).toBeCloseTo(-0.1, 9);
    expect(p.a).toBeCloseTo(0.03, 9);
  });
  it('2026, netto-terugleveraar: wat je meer teruglevert dan afneemt, wordt niet gesaldeerd: −10 ct', () => {
    expect(prijzenVan(kwartier(ZOMER_2026, -0.1), { nettoAfnemer: false }).v).toBeCloseTo(-0.1, 9);
  });
  it('2027: geen saldering meer, voor iedereen de kale prijs', () => {
    expect(prijzenVan(kwartier(ZOMER_2027, -0.1)).v).toBeCloseTo(-0.1, 9);
    expect(prijzenVan(kwartier(ZOMER_2027, -0.1), { nettoAfnemer: false }).v).toBeCloseTo(-0.1, 9);
    // De grens ligt op één constante: middernacht 1 januari 2027.
    expect(prijzenVan(kwartier(EINDE_SALDERING - KW, -0.1)).v).toBeCloseTo(0.03, 9);
    expect(prijzenVan(kwartier(EINDE_SALDERING, -0.1)).v).toBeCloseTo(-0.1, 9);
  });
  it('de Zonnebonus telt mee, en na het plafond niet meer; een schatting doet niet mee', () => {
    const vak = kwartier(ZOMER_2027, 0.02);
    expect(prijzenVan(vak).v).toBeCloseTo(0.022, 9);
    expect(prijzenVan(vak, { kwhDitJaar: 8000 }).v).toBeCloseTo(0.02, 9);
    expect(prijzenVan({ ...vak, schatting: true })).toBeNull();
  });
});

describe('het plan', () => {
  it('2027: aaneengesloten negatieve kwartieren worden één blok; een gat van één kwartier wordt overbrugd', () => {
    const t = reeks(ZOMER_2027, [0.05, -0.02, -0.04, 0.01, -0.03, 0.05, 0.05, -0.01]);
    const b = planUit(t, { vanaf: ZOMER_2027 });
    expect(b).toHaveLength(2);
    expect(b[0]).toMatchObject({ van: ZOMER_2027 + KW, tot: ZOMER_2027 + 5 * KW, modus: 'deels' });
    expect(b[0].laagste).toBeCloseTo(-0.04, 9);
    expect(b[1]).toMatchObject({ van: ZOMER_2027 + 7 * KW, tot: ZOMER_2027 + 8 * KW });
  });
  it('2026, netto-afnemer: negatief maar door de saldering loont het niet; terugleveraar: wel', () => {
    const t = reeks(ZOMER_2026, [-0.05, -0.05]);
    const afnemer = planUit(t, { vanaf: ZOMER_2026 });
    expect(afnemer).toEqual([expect.objectContaining({ modus: 'loont-niet', reden: 'saldering' })]);
    expect(planZinnen(afnemer, ZOMER_2026 - 86_400_000)[0]).toMatch(/door de saldering loont begrenzen nog niet \(vanaf 2027 wel\)/);
    const terug = planUit(t, { vanaf: ZOMER_2026, prijsVan: (vak) => prijzenVan(vak, { nettoAfnemer: false }) });
    expect(terug).toEqual([expect.objectContaining({ modus: 'deels' })]);
  });
  it('ook afnemen negatief: helemaal uit', () => {
    const t = reeks(ZOMER_2027, [-0.2, -0.2]);
    expect(planUit(t, { vanaf: ZOMER_2027 })[0].modus).toBe('uit');
    expect(planZinnen(planUit(t, { vanaf: ZOMER_2027 }), ZOMER_2027 - 86_400_000)[0]).toMatch(/^morgen 12:00–12:30 helemaal uit: terugleveren kost dan tot 20 ct\/kWh/);
  });
  it('de zin bij gedeeltelijk: tot ongeveer het eigen verbruik', () => {
    const b = planUit(reeks(ZOMER_2027, [-0.04, -0.04]), { vanaf: ZOMER_2027 });
    expect(planZinnen(b, ZOMER_2027 - 86_400_000, { verbruikW: 900 })[0]).toBe('morgen 12:00–12:30 begrensd tot ~1,2 kW: terugleveren kost dan tot 4 ct/kWh, je eigen verbruik blijft van de zon (past zich aan)');
  });
  it('tegenstrijdige of ontbrekende prijs van nu: geen prijs (dus niet begrenzen)', () => {
    const t = reeks(ZOMER_2027, [-0.1]);
    expect(prijsNu(t, ZOMER_2027 + 1000).v).toBeCloseTo(-0.1, 9);
    expect(prijsNu([...t, kwartier(ZOMER_2027, 0.1)], ZOMER_2027 + 1000)).toBeNull();
    expect(prijsNu(t, ZOMER_2027 + KW + 1000)).toBeNull();
  });
});

describe('hoeveel begrenzen: gedeeltelijk of helemaal uit', () => {
  it('het type geeft het vermogen; de stap laat minstens het doel leveren', () => {
    expect(nominaalUitType('GW8K-DT')).toBe(8000);
    expect(nominaalUitType('GW8000-DT')).toBe(8000);
    expect(nominaalUitType('iets anders')).toBeNull();
    expect(stapVoor(1500, 8000)).toBe(20);
    expect(stapVoor(0, 8000)).toBe(0);
    expect(stapVoor(9000, 8000)).toBe(100);
  });
  it('afnemen kost geld: gedeeltelijk, tot het eigen verbruik plus de marge (niet helemaal uit)', () => {
    const k = kiesStap({ zonGoodWe: 5000, eigen: 1200, nominaal: 8000, v: -0.04, a: 0.1 });
    expect(k.p).toBe(20);
    expect(k.winst).toBeGreaterThan(0.1);
  });
  it('afnemen levert ook geld op: helemaal uit', () => {
    expect(kiesStap({ zonGoodWe: 5000, eigen: 1200, nominaal: 8000, v: -0.2, a: -0.07 }).p).toBe(0);
  });
  it('alles wordt zelf gebruikt: niet begrenzen', () => {
    expect(kiesStap({ zonGoodWe: 1000, eigen: 1500, nominaal: 8000, v: -0.04, a: 0.1 }).p).toBe(100);
  });
  it('zonder vermogen van de omvormer alleen helemaal uit, en alleen als afnemen geld oplevert', () => {
    expect(kiesStap({ zonGoodWe: 5000, eigen: 1200, nominaal: null, v: -0.04, a: 0.15 }).p).toBe(100);
    // 1.6.1: ook als uit volgens de som net goedkoper is (12 ct afnemen tegen 15 ct terugleveren): niet
    // helemaal uit zolang afnemen geld kost; zo gaat het niet heen en weer tussen 0% en het verbruik.
    expect(kiesStap({ zonGoodWe: 5000, eigen: 1200, nominaal: null, v: -0.04, a: 0.1 }).p).toBe(100);
    expect(kiesStap({ zonGoodWe: 5000, eigen: 1200, nominaal: null, v: -0.04, a: -0.01 }).p).toBe(0);
  });
  it('1.6.1: helemaal uit (0%) alleen als afnemen geld oplevert, ook als 0% volgens de som goedkoper lijkt', () => {
    // 2027: kaal −10 ct, afnemen +3 ct, huis 1 kW, zon 4 kW. 0% kost 1 kW × 3 ct = 3 ct per uur, 20% (1,6 kW)
    // 0,6 kW × 10 ct = 6 ct; toch 20%: bij 0% komt het huis uit het net en gaat hij weer omhoog.
    expect(kiesStap({ zonGoodWe: 4000, eigen: 1000, nominaal: 8000, v: -0.1, a: 0.03 }).p).toBe(20);
    expect(kiesStap({ zonGoodWe: 4000, eigen: 1000, nominaal: 8000, v: -0.1, a: -0.01 }).p).toBe(0);
  });
});

describe('instelling uit de app', () => {
  it('zonder veld (een oudere functie), of iets raars: uit', () => {
    for (const ruw of [null, undefined, {}, { aan: 'ja' }, [], { aan: 1 }]) expect(instellingUit(ruw).aan).toBe(false);
    const i = instellingUit({ aan: true, niet_op: ['2027-06-02', 'rommel'], vrij_op: '2027-06-01T10:20:00.000Z', netto: 'terugleveraar' });
    expect(i).toMatchObject({ aan: true, vrij_op: '2027-06-01T10:20:00.000Z', nettoAfnemer: false, op: null });
    expect(instellingUit({ aan: true, op: '2027-06-01T10:00:00.000Z' }).op).toBe('2027-06-01T10:00:00.000Z');
    expect(instellingUit({ aan: true, op: 'gisteren' }).op).toBeNull();
    expect([...i.niet_op]).toEqual(['2027-06-02']);
  });
});

/**
 * Een nep-omvormer zonder netwerk, zoals bij Tim (31-10-2026): grens 2%, schakelaar uit. Houdt
 * grens en schakelaar bij en telt wat er geschreven ('grens 20', 'schakelaar 1') en gelezen wordt.
 * `effectief()`: wat de omvormer echt mag (100 = vrij), `eenheid`: 1 = procent, 0.1 = per mille.
 */
function nepVerbinding({ grens = 2, schakelaar = 0 } = {}) {
  const s = { grens, schakelaar, schrijven: [], lezen: 0, faalSchrijf: false, faalLees: false, negeer: false, negeerSchakelaar: false, eenheid: 1, werktNiet: false };
  const fout = () => Object.assign(new Error('geen antwoord'), { code: 'ETIMEDOUT' });
  return {
    s,
    effectief: () => (s.schakelaar && !s.werktNiet ? Math.min(100, s.grens * s.eenheid) : 100),
    async leesGrens() {
      s.lezen += 1;
      if (s.faalLees) throw fout();
      return s.grens;
    },
    async leesSchakelaar() {
      s.lezen += 1;
      if (s.faalLees) throw fout();
      return s.schakelaar !== 0;
    },
    async schrijfGrens(p) {
      if (!TOEGESTAAN.includes(p)) throw new Error('niet toegestaan');
      s.schrijven.push(`grens ${p}`);
      if (s.faalSchrijf) throw fout();
      if (!s.negeer) s.grens = p;
    },
    async schrijfSchakelaar(a) {
      if (a !== 0 && a !== 1) throw new Error('niet toegestaan');
      s.schrijven.push(`schakelaar ${a}`);
      if (s.faalSchrijf) throw fout();
      if (!s.negeerSchakelaar) s.schakelaar = a;
    },
  };
}

/**
 * Een middag in juni 2027 met een negatief blok van 12:00 tot 14:00 (NL), en een huis dat
 * `huisW` gebruikt terwijl de GoodWe `zonW` kan leveren. Het net volgt uit wat de omvormer mag.
 */
function middag({ prijzen = [0.05, ...Array(8).fill(-0.05), 0.05], ...rest } = {}) {
  const begin = ZOMER_2027 - KW;
  const tijdvakken = reeks(begin, prijzen);
  const verbinding = rest.verbinding ?? nepVerbinding();
  const logs = [];
  const bewaard = [];
  const stuurder = maakStuurder({ verbinding, log: (t) => logs.push(t), opgeslagen: rest.opgeslagen ?? null, bewaar: (x) => bewaard.push(JSON.parse(JSON.stringify(x))), gestart: rest.gestart ?? begin, ...(rest.stopWachtMs ? { stopWachtMs: rest.stopWachtMs } : {}) });
  // andereZonW: panelen die niet via de GoodWe lopen (een eigen zonmeter).
  const wereld = { nu: begin, huisW: 800, zonW: 5000, andereZonW: 0, batterijW: 0, stand: 'normaal' };
  const meting = () => {
    const e = verbinding.effectief();
    const mag = e >= 100 ? wereld.zonW : Math.min(wereld.zonW, (8000 * e) / 100);
    // Net: plus = afnemen. Wat de batterij laadt (batterijW min) komt er bij het huis bij.
    return { netW: wereld.huisW - wereld.batterijW - mag - wereld.andereZonW, zonW: mag + wereld.andereZonW, batterijW: wereld.batterijW, omvormerW: mag };
  };
  const ronde = () => stuurder.ronde({ nu: wereld.nu, tijdvakken, omvormerStand: wereld.stand, meting: meting(), nominaal: 8000 });
  /** Zo lang rondes van 5 s draaien. */
  const loop = async (ms) => {
    for (let t = 0; t < ms; t += 5000) {
      await ronde();
      wereld.nu += 5000;
    }
  };
  return { begin, tijdvakken, verbinding, stuurder, wereld, loop, ronde, logs, bewaard };
}

const BEGRENS_20 = ['grens 20', 'schakelaar 1'];

describe('de besturing (nep-omvormer)', () => {
  it('UIT als de instelling ontbreekt: hij leest en schrijft niets', async () => {
    const m = middag();
    m.wereld.nu = ZOMER_2027 + 1000;
    await m.loop(10 * 60_000);
    expect(m.verbinding.s.schrijven).toEqual([]);
    expect(m.verbinding.s.lezen).toBe(0);
    expect(m.stuurder.voorApp(m.wereld.nu)).toMatchObject({ aan: false, stand: 'onbekend', blokken: [expect.objectContaining({ modus: 'deels' })] });
  });

  it('schakelaar uit en grens 2% (zoals bij Tim): dat is vrij, niet een eigen grens; de oorspronkelijke stand wordt bewaard', async () => {
    const m = middag();
    m.stuurder.zetInstelling({ aan: true });
    await m.loop(5 * 60_000); // 11:45–11:50: positieve prijs
    expect(m.verbinding.s.schrijven).toEqual([]);
    expect(m.stuurder.voorApp(m.wereld.nu)).toMatchObject({ stand: 'vrij', oorspronkelijk: { grens_pct: 2, schakelaar: false } });
    expect(m.stuurder.voorApp(m.wereld.nu).fout).toBeUndefined();
    expect(m.bewaard.at(-1).oorspronkelijk).toMatchObject({ grens: 2, schakelaar: false });
    expect(m.logs.some((l) => /grens 2%, grensschakelaar uit/.test(l))).toBe(true);
  });

  it('aan, veel over: begrenzen schrijft eerst de grens, dan de schakelaar aan; vrijgeven alleen de schakelaar uit (de grens blijft)', async () => {
    const m = middag();
    m.stuurder.zetInstelling({ aan: true });
    await m.loop(KW); // 11:45–12:00: positieve prijs
    expect(m.verbinding.s.schrijven).toEqual([]);
    await m.loop(EXPORT_DUUR_MS + 10_000);
    expect(m.verbinding.s.schrijven).toEqual(BEGRENS_20); // 800 W + 300 W marge → 1,1 kW → 20% van 8 kW
    expect(m.stuurder.voorApp(m.wereld.nu)).toMatchObject({ aan: true, stand: 'begrensd', pct: 20, grens_w: 1600, door: 'programmaatje' });
    await m.loop(2 * 60 * 60_000 - EXPORT_DUUR_MS - 10_000 + 60_000);
    expect(m.verbinding.s.schrijven).toEqual([...BEGRENS_20, 'schakelaar 0']);
    expect(m.verbinding.s).toMatchObject({ schakelaar: 0, grens: 20 });
    expect(m.logs.some((l) => /weer vrij \(grensschakelaar uit, volle kracht\).*begrensd sinds 12:0/.test(l))).toBe(true);
  });

  it('staat de grens al goed, dan alleen de schakelaar aan (zuinig)', async () => {
    const m = middag({ verbinding: nepVerbinding({ grens: 20 }) });
    m.stuurder.zetInstelling({ aan: true });
    m.wereld.nu = ZOMER_2027;
    await m.loop(EXPORT_DUUR_MS + 10_000);
    expect(m.verbinding.s.schrijven).toEqual(['schakelaar 1']);
  });

  it('de schakelaar staat aan, niet door het programmaatje: niets schrijven, en dat zeggen', async () => {
    const verbinding = nepVerbinding({ grens: 70, schakelaar: 1 });
    const m = middag({ verbinding, opgeslagen: { ooit: true } });
    m.stuurder.zetInstelling({ aan: true });
    m.wereld.nu = ZOMER_2027;
    await m.loop(10 * 60_000);
    expect(verbinding.s.schrijven).toEqual([]);
    expect(m.stuurder.voorApp(m.wereld.nu)).toMatchObject({ stand: 'eigen', grens_pct: 70, fout: 'eigen' });
    expect(m.logs.some((l) => /grensschakelaar staat aan \(grens 70%\), niet door het programmaatje/.test(l))).toBe(true);
    expect(await m.stuurder.stop(m.wereld.nu)).toBe('niets');
    expect(verbinding.s.schrijven).toEqual([]);
  });

  it('een bestand van 1.5.0 (grens door ons, maar niets over de schakelaar): een aan-staande schakelaar is niet van ons', async () => {
    const verbinding = nepVerbinding({ grens: 30, schakelaar: 1 });
    const m = middag({ verbinding, opgeslagen: { pct: 30, sinds: ZOMER_2027 - 86_400_000, ooit: true } });
    m.wereld.nu = ZOMER_2027 + 3 * 60 * 60_000;
    await m.loop(10_000);
    expect(verbinding.s.schrijven).toEqual([]);
    expect(m.stuurder.voorApp(m.wereld.nu).stand).toBe('eigen');
  });

  it('alles wordt zelf gebruikt (huis en batterij nemen de zon): hij blijft aan', async () => {
    const m = middag();
    m.stuurder.zetInstelling({ aan: true });
    m.wereld.nu = ZOMER_2027;
    m.wereld.zonW = 3000;
    m.wereld.huisW = 1200;
    m.wereld.batterijW = -1900; // de batterij laadt de rest
    await m.loop(30 * 60_000);
    expect(m.verbinding.s.schrijven).toEqual([]);
  });

  it('de wasmachine gaat aan: binnen ongeveer een minuut omhoog (alleen de grens); daarna weer omlaag', async () => {
    const m = middag();
    m.stuurder.zetInstelling({ aan: true });
    m.wereld.nu = ZOMER_2027;
    await m.loop(EXPORT_DUUR_MS + 10_000);
    expect(m.verbinding.effectief()).toBe(20);
    // De eerste drie minuten kijkt hij na of het werkt; dan stuurt hij niet bij.
    await m.loop(CONTROLE_MS);
    expect(m.stuurder.voorApp(m.wereld.nu).controle.uitkomst).toBe('werkt');
    m.wereld.huisW = 2800; // de wasmachine verwarmt
    const begin = m.wereld.nu;
    while (m.verbinding.effectief() === 20 && m.wereld.nu - begin < 5 * 60_000) await m.loop(5000);
    expect(m.wereld.nu - begin).toBeLessThanOrEqual(TEKORT_DUUR_MS + 15_000);
    expect(m.verbinding.effectief()).toBe(40); // 2,8 kW + 0,3 kW → 40% van 8 kW
    m.wereld.huisW = 800; // klaar met verwarmen
    await m.loop(OMLAAG_TUSSEN_MS + EXPORT_DUUR_MS);
    expect(m.verbinding.effectief()).toBe(20);
    expect(m.stuurder.voorApp(m.wereld.nu).aanpassingen).toBe(2);
    expect(m.verbinding.s.schrijven).toEqual([...BEGRENS_20, 'grens 40', 'grens 20']);
  });

  it('afnemen levert ook geld op: helemaal uit, en de wasmachine verandert dat niet', async () => {
    const m = middag({ prijzen: [0.05, ...Array(8).fill(-0.2), 0.05] });
    m.stuurder.zetInstelling({ aan: true });
    m.wereld.nu = ZOMER_2027;
    await m.loop(EXPORT_DUUR_MS + 10_000);
    expect(m.verbinding.s.schrijven).toEqual(['grens 0', 'schakelaar 1']);
    m.wereld.huisW = 2800;
    await m.loop(5 * 60_000);
    expect(m.verbinding.s.schrijven).toEqual(['grens 0', 'schakelaar 1']);
  });

  it('de schrijfrem telt beide registers: hoe het huis ook schommelt, nooit meer dan per uur en per dag mag', async () => {
    const m = middag({ prijzen: [0.05, ...Array(40).fill(-0.05), 0.05] });
    m.stuurder.zetInstelling({ aan: true });
    m.wereld.nu = ZOMER_2027;
    const momenten = [];
    let vorige = 0;
    for (let i = 0; i < 10 * 12 * 12; i += 1) {
      // Elke 3 minuten iets anders aan of uit.
      m.wereld.huisW = Math.floor(i / 36) % 2 ? 3500 : 600;
      await m.loop(5000);
      for (let k = vorige; k < m.verbinding.s.schrijven.length; k += 1) momenten.push({ t: m.wereld.nu, wat: m.verbinding.s.schrijven[k] });
      vorige = m.verbinding.s.schrijven.length;
    }
    // Vrijgeven mag altijd; al het andere houdt zich aan de rem.
    for (const { t } of momenten) {
      const inUur = momenten.filter((x) => x.t <= t && t - x.t < 60 * 60_000);
      expect(inUur.filter((x) => x.wat !== 'schakelaar 0').length).toBeLessThanOrEqual(MAX_PER_UUR);
      expect(inUur.length).toBeLessThanOrEqual(MAX_PER_UUR + 2);
    }
    expect(momenten.length).toBeLessThanOrEqual(MAX_PER_DAG + 2);
    expect(momenten.length).toBeGreaterThan(2);
  });

  it('een normale dag: twee blokken met elk een paar bijstellingen passen ruim binnen de rem', async () => {
    expect(MAX_PER_UUR).toBeGreaterThanOrEqual(6);
    expect(MAX_PER_DAG).toBeGreaterThanOrEqual(2 * (2 + 4 + 1));
    const m = middag();
    m.stuurder.zetInstelling({ aan: true });
    m.wereld.nu = ZOMER_2027;
    await m.loop(EXPORT_DUUR_MS + 10_000);
    for (const huis of [2800, 800, 2800, 800]) {
      m.wereld.huisW = huis;
      await m.loop(OMLAAG_TUSSEN_MS + EXPORT_DUUR_MS);
    }
    expect(m.stuurder.voorApp(m.wereld.nu).fout).toBeUndefined();
    expect(m.stuurder.voorApp(m.wereld.nu).aanpassingen).toBe(4);
  });

  it('teruglezen klopt niet: één keer opnieuw, dan opgeven; de schakelaar bleef uit, dus hij is gewoon vrij', async () => {
    const m = middag();
    m.verbinding.s.negeer = true; // hij bevestigt, maar de grens blijft 2%
    m.stuurder.zetInstelling({ aan: true });
    m.wereld.nu = ZOMER_2027;
    await m.loop(EXPORT_DUUR_MS + 10_000);
    expect(m.verbinding.s.schrijven).toEqual(['grens 20', 'grens 20']);
    expect(m.stuurder.voorApp(m.wereld.nu)).toMatchObject({ fout: 'begrenzen', stand: 'vrij' });
    expect(m.stuurder.voorApp(m.wereld.nu).blokken[0].niet).toBe('mislukt');
    await m.loop(30 * 60_000);
    expect(m.verbinding.s.schrijven).toEqual(['grens 20', 'grens 20']);
  });

  it('de schakelaar gaat niet aan: één keer opnieuw, dan meteen weer uit (bij twijfel vrij)', async () => {
    const m = middag();
    m.verbinding.s.negeerSchakelaar = true;
    m.stuurder.zetInstelling({ aan: true });
    m.wereld.nu = ZOMER_2027;
    await m.loop(EXPORT_DUUR_MS + 10_000);
    expect(m.verbinding.s.schrijven).toEqual(['grens 20', 'schakelaar 1', 'schakelaar 1', 'schakelaar 0']);
    expect(m.stuurder.voorApp(m.wereld.nu).fout).toBe('begrenzen');
  });

  it('schrijven mislukt helemaal: hij probeert vrij te geven, en meldt het; vrijgeven wacht niet op de rem', async () => {
    const m = middag();
    m.stuurder.zetInstelling({ aan: true });
    m.wereld.nu = ZOMER_2027;
    await m.loop(EXPORT_DUUR_MS + 10_000);
    m.verbinding.s.faalSchrijf = true;
    m.stuurder.zetInstelling(null); // eigenaar zet het uit
    await m.loop(10_000);
    expect(m.verbinding.s.schrijven.slice(2)).toEqual(['schakelaar 0', 'schakelaar 0']);
    expect(m.stuurder.voorApp(m.wereld.nu).fout).toBe('vrijgeven');
    m.verbinding.s.faalSchrijf = false;
    await m.loop(6 * 60_000);
    expect(m.verbinding.s.schakelaar).toBe(0);
    expect(m.stuurder.voorApp(m.wereld.nu).fout).toBeUndefined();
  });

  it('opstarten buiten een blok terwijl hij nog door ons begrensd staat: de schakelaar uit', async () => {
    const verbinding = nepVerbinding({ grens: 30, schakelaar: 1 });
    const m = middag({ verbinding, opgeslagen: { pct: 30, schakelaar_door_ons: true, sinds: ZOMER_2027 - 86_400_000, ooit: true } });
    m.wereld.nu = ZOMER_2027 + 3 * 60 * 60_000; // na het blok
    await m.loop(10_000);
    expect(verbinding.s.schrijven).toEqual(['schakelaar 0']);
  });

  it('onze schakelaar, maar iemand zette de grens anders: bij twijfel de schakelaar uit', async () => {
    const verbinding = nepVerbinding({ grens: 70, schakelaar: 1 });
    const m = middag({ verbinding, opgeslagen: { pct: 20, schakelaar_door_ons: true, ooit: true } });
    m.stuurder.zetInstelling({ aan: true });
    m.wereld.nu = ZOMER_2027;
    await m.loop(10_000);
    expect(verbinding.s.schrijven).toEqual(['schakelaar 0']);
    expect(m.stuurder.voorApp(m.wereld.nu).blokken[0].niet).toBe('anders');
  });

  it('opgestart in een blok, begrensd van voor de herstart: wacht op de app, en blijft dan begrensd', async () => {
    const verbinding = nepVerbinding({ grens: 20, schakelaar: 1 });
    const m = middag({ verbinding, opgeslagen: { pct: 20, schakelaar_door_ons: true, sinds: ZOMER_2027, blok_van: ZOMER_2027, ooit: true }, gestart: ZOMER_2027 + 30 * 60_000 });
    m.wereld.nu = ZOMER_2027 + 30 * 60_000;
    await m.loop(WACHT_OP_APP_MS - 10_000);
    expect(verbinding.s.schrijven).toEqual([]);
    m.stuurder.zetInstelling({ aan: true });
    await m.loop(60_000);
    expect(verbinding.s.schrijven).toEqual([]);
    expect(m.stuurder.voorApp(m.wereld.nu).stand).toBe('begrensd');
  });

  it('stoppen: eerst de schakelaar uit; staat hij al vrij, dan niets', async () => {
    const m = middag();
    m.stuurder.zetInstelling({ aan: true });
    m.wereld.nu = ZOMER_2027;
    await m.loop(EXPORT_DUUR_MS + 10_000);
    expect(await m.stuurder.stop(m.wereld.nu)).toBe('vrij');
    expect(m.verbinding.s.schrijven).toEqual([...BEGRENS_20, 'schakelaar 0']);
    expect(m.verbinding.s.schakelaar).toBe(0);
    expect(await m.stuurder.stop(m.wereld.nu)).toBe('niets');
  });

  it('stoppen na een herstart (stand nog onbekend) met onze schakelaar aan: lezen, dan de schakelaar uit', async () => {
    const verbinding = nepVerbinding({ grens: 20, schakelaar: 1 });
    const m = middag({ verbinding, opgeslagen: { pct: 20, schakelaar_door_ons: true, ooit: true } });
    m.wereld.nu = ZOMER_2027;
    m.stuurder.staat.wakker = true;
    expect(await m.stuurder.stop(m.wereld.nu)).toBe('vrij');
    expect(verbinding.s.schrijven).toEqual(['schakelaar 0']);
  });

  it('"Nu weer aan": meteen vrij, en de rest van dit blok niet meer', async () => {
    const m = middag();
    m.stuurder.zetInstelling({ aan: true });
    m.wereld.nu = ZOMER_2027;
    await m.loop(EXPORT_DUUR_MS + 10_000);
    m.stuurder.zetInstelling({ aan: true, vrij_op: new Date(m.wereld.nu).toISOString() });
    await m.loop(10_000);
    expect(m.verbinding.s.schrijven).toEqual([...BEGRENS_20, 'schakelaar 0']);
    await m.loop(60 * 60_000);
    expect(m.verbinding.s.schrijven).toEqual([...BEGRENS_20, 'schakelaar 0']);
    expect(m.stuurder.voorApp(m.wereld.nu)).toMatchObject({ nu_aan: true });
    expect(m.logs.some((l) => /Nu weer aan/.test(l))).toBe(true);
  });

  it('"morgen niet": die dag niet begrenzen', async () => {
    const m = middag();
    m.stuurder.zetInstelling({ aan: true, niet_op: ['2027-06-01'] });
    m.wereld.nu = ZOMER_2027;
    await m.loop(30 * 60_000);
    expect(m.verbinding.s.schrijven).toEqual([]);
    expect(m.stuurder.voorApp(m.wereld.nu).blokken[0].niet).toBe('dag');
  });

  it('slaapt de omvormer: niets vragen, en dat is geen fout', async () => {
    const m = middag();
    m.stuurder.zetInstelling({ aan: true });
    m.wereld.nu = ZOMER_2027;
    m.wereld.stand = 'slaapt';
    await m.loop(10 * 60_000);
    expect(m.verbinding.s.lezen + m.verbinding.s.schrijven.length).toBe(0);
    expect(m.stuurder.voorApp(m.wereld.nu).fout).toBeUndefined();
  });

  it('iemand anders zette de schakelaar uit (de app van GoodWe): niet vechten', async () => {
    const m = middag();
    m.stuurder.zetInstelling({ aan: true });
    m.wereld.nu = ZOMER_2027;
    await m.loop(EXPORT_DUUR_MS + 10_000);
    m.verbinding.s.schakelaar = 0;
    await m.loop(20 * 60_000);
    expect(m.verbinding.s.schrijven).toEqual(BEGRENS_20);
    expect(m.stuurder.voorApp(m.wereld.nu).blokken[0].niet).toBe('anders');
  });

  it('bewaart de rem, wat van ons is en de schakelaar (vóór het aanzetten), zodat een herstart het weet', async () => {
    const m = middag();
    m.stuurder.zetInstelling({ aan: true });
    m.wereld.nu = ZOMER_2027;
    await m.loop(EXPORT_DUUR_MS + 10_000);
    expect(m.bewaard.at(-1)).toMatchObject({ pct: 20, schakelaar_door_ons: true, ooit: true, schrijven: [expect.any(Number), expect.any(Number)] });
    // Het bewaren van "door ons" gebeurde al vóór de schakelaar aan ging.
    expect(m.bewaard.some((b) => b.schakelaar_door_ons === true && b.schrijven.length === 1)).toBe(true);
  });
});

describe('1.6.1: veiliger begrenzen', () => {
  it('kaal −10 ct, afnemen +3 ct, huis 1 kW, zon 4 kW: niet heen en weer tussen 0% en 20% (hooguit een paar schrijfacties)', async () => {
    const m = middag({ prijzen: [0.05, ...Array(12).fill(-0.1), 0.05] });
    m.wereld.huisW = 1000;
    m.wereld.zonW = 4000;
    m.stuurder.zetInstelling({ aan: true });
    m.wereld.nu = ZOMER_2027;
    await m.loop(2.5 * 60 * 60_000);
    expect(m.verbinding.s.schrijven).not.toContain('grens 0');
    expect(m.verbinding.s.schrijven.length).toBeLessThanOrEqual(3);
    expect(m.verbinding.s.schrijven.slice(0, 2)).toEqual(BEGRENS_20);
  });

  it('begrensd: omlaag rekent met wat de zon zou kunnen, niet met wat de grens nog doorlaat', async () => {
    // Afnemen levert geld op en hij staat (na een herstart, of een prijs die omsloeg) op 20%: de som met de
    // ingeperkte 1,6 kW en met de echte 4 kW wijzen allebei naar 0%; wat telt is dat hij de zon van vóór de grens onthoudt.
    const m = middag();
    m.wereld.huisW = 1000;
    m.wereld.zonW = 4000;
    m.stuurder.zetInstelling({ aan: true });
    m.wereld.nu = ZOMER_2027;
    await m.loop(EXPORT_DUUR_MS + 10_000);
    expect(m.verbinding.effectief()).toBe(20);
    expect(m.stuurder.staat.zonVrij).toMatchObject({ w: 4000 });
  });

  it('de schakelaar ging aan, maar teruglezen en vrijgeven mislukken: niet "vrij" denken, maar blijven lezen en vrijgeven', async () => {
    const m = middag();
    const v = m.verbinding;
    const schrijfSchakelaar = v.schrijfSchakelaar;
    v.schrijfSchakelaar = async (a) => {
      await schrijfSchakelaar(a);
      // Na het aanzetten valt de verbinding weg: niets meer te lezen of te schrijven.
      if (a === 1) Object.assign(v.s, { faalLees: true, faalSchrijf: true });
    };
    m.stuurder.zetInstelling({ aan: true });
    m.wereld.nu = ZOMER_2027;
    await m.loop(EXPORT_DUUR_MS + 10_000);
    expect(v.s.schakelaar).toBe(1);
    expect(m.stuurder.staat.bekend).not.toBe('vrij');
    expect(m.stuurder.voorApp(m.wereld.nu).stand).not.toBe('vrij');
    Object.assign(v.s, { faalLees: false, faalSchrijf: false });
    await m.loop(10 * 60_000);
    expect(v.s.schakelaar).toBe(0);
    expect(m.stuurder.voorApp(m.wereld.nu).stand).toBe('vrij');
  });

  it('ook na het einde van het blok, en bij het stoppen: hij geeft vrij wat hij misschien aanzette', async () => {
    const m = middag();
    const v = m.verbinding;
    const schrijfSchakelaar = v.schrijfSchakelaar;
    v.schrijfSchakelaar = async (a) => {
      await schrijfSchakelaar(a);
      if (a === 1) Object.assign(v.s, { faalLees: true, faalSchrijf: true });
    };
    m.stuurder.zetInstelling({ aan: true });
    m.wereld.nu = ZOMER_2027;
    await m.loop(EXPORT_DUUR_MS + 10_000);
    Object.assign(v.s, { faalLees: false, faalSchrijf: false });
    m.stuurder.staat.nietVoor = 0;
    expect(await m.stuurder.stop(m.wereld.nu)).toBe('vrij');
    expect(v.s.schakelaar).toBe(0);
  });

  /** Een schrijfactie die wacht tot de test hem laat gaan (zoals een trage omvormer). */
  const metPoort = (m, soort, waarde) => {
    let laat;
    const poort = new Promise((klaar) => (laat = klaar));
    const v = m.verbinding;
    const echt = v[soort];
    let bezig = false;
    v[soort] = async (x) => {
      if (waarde === undefined || x === waarde) {
        bezig = true;
        await poort;
      }
      return echt(x);
    };
    return { laat: () => laat(), bezig: () => bezig };
  };
  const tikken = async (n = 20) => {
    for (let i = 0; i < n; i += 1) await Promise.resolve();
  };

  it('stoppen terwijl hij de grens schrijft: de schakelaar gaat niet meer aan', async () => {
    const m = middag();
    m.stuurder.zetInstelling({ aan: true });
    m.wereld.nu = ZOMER_2027;
    await m.loop(EXPORT_DUUR_MS);
    const p = metPoort(m, 'schrijfGrens');
    const ronde = m.ronde();
    await tikken();
    expect(p.bezig()).toBe(true);
    const stop = m.stuurder.stop(m.wereld.nu);
    await tikken();
    p.laat();
    await ronde;
    await stop;
    expect(m.verbinding.s.schrijven).toEqual(['grens 20']);
    expect(m.verbinding.s.schakelaar).toBe(0);
    // Na het stoppen schrijft een ronde niets meer.
    m.wereld.nu += 10 * 60_000;
    await m.ronde();
    expect(m.verbinding.s.schrijven).toEqual(['grens 20']);
  });

  it('stoppen terwijl de schakelaar aan gaat: hij wacht op die ronde en zet hem dan uit', async () => {
    const m = middag();
    m.stuurder.zetInstelling({ aan: true });
    m.wereld.nu = ZOMER_2027;
    await m.loop(EXPORT_DUUR_MS);
    const p = metPoort(m, 'schrijfSchakelaar', 1);
    const ronde = m.ronde();
    await tikken();
    expect(p.bezig()).toBe(true);
    const stop = m.stuurder.stop(m.wereld.nu);
    await tikken();
    p.laat();
    await ronde;
    expect(await stop).toBe('vrij');
    expect(m.verbinding.s.schrijven).toEqual([...BEGRENS_20, 'schakelaar 0']);
    expect(m.verbinding.s.schakelaar).toBe(0);
  });

  it('stoppen terwijl een ronde blijft hangen: na even wachten toch de schakelaar uit', async () => {
    const m = middag({ stopWachtMs: 20 });
    m.stuurder.zetInstelling({ aan: true });
    m.wereld.nu = ZOMER_2027;
    await m.loop(EXPORT_DUUR_MS);
    const p = metPoort(m, 'schrijfSchakelaar', 1);
    m.ronde();
    await tikken();
    expect(p.bezig()).toBe(true);
    // De schakelaar-opdracht is al onderweg (hij komt straks toch aan): bij twijfel vrij.
    m.verbinding.s.schakelaar = 1;
    expect(await m.stuurder.stop(m.wereld.nu)).toBe('vrij');
    expect(m.verbinding.s.schakelaar).toBe(0);
  });
});

describe('de zelfcontrole na een begrenzing', () => {
  it('werkt: na ongeveer 3 minuten "nagekeken: werkt" met datum en de getallen', async () => {
    const m = middag();
    m.stuurder.zetInstelling({ aan: true });
    m.wereld.nu = ZOMER_2027;
    await m.loop(EXPORT_DUUR_MS + 10_000);
    expect(m.stuurder.voorApp(m.wereld.nu).controle).toMatchObject({ uitkomst: 'bezig', pct: 20, voor_w: 5000 });
    await m.loop(CONTROLE_MS);
    expect(m.stuurder.voorApp(m.wereld.nu).controle).toMatchObject({ uitkomst: 'werkt', pct: 20, voor_w: 5000, na_w: 1600, via: 'omvormer', op: expect.any(String) });
    expect(m.stuurder.voorApp(m.wereld.nu).stand).toBe('begrensd');
    expect(m.bewaard.at(-1).controle).toMatchObject({ uitkomst: 'werkt' });
    expect(m.logs.some((l) => /nagekeken: begrenzen werkt \(van 5,0 kW naar 1,6 kW bij 20%\)/.test(l))).toBe(true);
  });

  it('werkt niet (hij blijft leveren): meteen de schakelaar uit, "werkt niet op deze omvormer", en niet meer proberen', async () => {
    const m = middag();
    m.verbinding.s.werktNiet = true;
    m.stuurder.zetInstelling({ aan: true });
    m.wereld.nu = ZOMER_2027;
    await m.loop(EXPORT_DUUR_MS + 10_000 + CONTROLE_MS);
    // 1.6.1: één keer opnieuw kijken voordat hij het opgeeft.
    expect(m.verbinding.s.schrijven).toEqual(BEGRENS_20);
    expect(m.stuurder.voorApp(m.wereld.nu).controle).toMatchObject({ uitkomst: 'bezig' });
    expect(m.logs.some((l) => /nog één keer/.test(l))).toBe(true);
    await m.loop(CONTROLE_MS);
    expect(m.verbinding.s.schrijven).toEqual([...BEGRENS_20, 'schakelaar 0']);
    const app = m.stuurder.voorApp(m.wereld.nu);
    expect(app).toMatchObject({ stand: 'vrij', controle: { uitkomst: 'werkt-niet', reden: 'geen-effect', voor_w: 5000, na_w: 5000 } });
    expect(m.bewaard.at(-1).controle).toMatchObject({ uitkomst: 'werkt-niet' });
    expect(m.logs.some((l) => /werkt niet op deze omvormer/.test(l))).toBe(true);
    // Ook in een volgend blok niet meer, en ook niet na een herstart.
    await m.loop(60 * 60_000);
    expect(m.verbinding.s.schrijven).toHaveLength(3);
    const na = middag({ verbinding: m.verbinding, opgeslagen: m.bewaard.at(-1) });
    na.stuurder.zetInstelling({ aan: true });
    na.wereld.nu = ZOMER_2027 + 60 * 60_000;
    await na.loop(10 * 60_000);
    expect(m.verbinding.s.schrijven).toHaveLength(3);
    expect(na.stuurder.voorApp(na.wereld.nu).controle.uitkomst).toBe('werkt-niet');
  });

  it('het tegendeel: veel minder dan bedoeld (de grens telt in 0,1%), ook dan meteen vrij', async () => {
    const m = middag();
    m.verbinding.s.eenheid = 0.1;
    m.wereld.huisW = 3500; // 3,5 kW + 0,3 kW → 50%
    m.stuurder.zetInstelling({ aan: true });
    m.wereld.nu = ZOMER_2027;
    m.wereld.zonW = 7000;
    await m.loop(EXPORT_DUUR_MS + 10_000);
    expect(m.verbinding.s.schrijven).toEqual(['grens 50', 'schakelaar 1']);
    // Het huis vraagt meer dan hij levert: nog binnen de controle mag hij niet eerst ophogen.
    await m.loop(CONTROLE_MS);
    // 1.6.1: eerst nog één keer kijken (het kan een wolk zijn).
    expect(m.verbinding.s.schakelaar).toBe(1);
    await m.loop(CONTROLE_MS);
    expect(m.stuurder.voorApp(m.wereld.nu).controle).toMatchObject({ uitkomst: 'werkt-niet', reden: 'te-veel' });
    expect(m.verbinding.s.schakelaar).toBe(0);
  });

  it('te weinig zon om het te zien: geen oordeel, nog niet nagekeken', async () => {
    const m = middag();
    m.wereld.zonW = 2000;
    m.wereld.huisW = 1200; // 1,2 kW + 0,3 → 20% = 1,6 kW; vooraf 2,0 kW: maar 400 W verschil
    m.stuurder.zetInstelling({ aan: true });
    m.wereld.nu = ZOMER_2027;
    await m.loop(EXPORT_DUUR_MS + 10_000 + CONTROLE_MS);
    expect(m.verbinding.s.schrijven).toEqual(BEGRENS_20);
    expect(m.stuurder.voorApp(m.wereld.nu).controle).toBeUndefined();
    expect(m.logs.some((l) => /te weinig zon om na te kijken/.test(l))).toBe(true);
  });

  it('opnieuw aanzetten in de app (een nieuwere op, of uit en weer aan) wist "werkt niet"', async () => {
    const m = middag({ opgeslagen: { ooit: true, controle: { uitkomst: 'werkt-niet', op: ZOMER_2027 - 60_000, pct: 20, voorW: 5000, naW: 5000, reden: 'geen-effect' } } });
    m.stuurder.zetInstelling({ aan: true, op: new Date(ZOMER_2027 - 120_000).toISOString() });
    expect(m.stuurder.voorApp(ZOMER_2027).controle.uitkomst).toBe('werkt-niet');
    m.stuurder.zetInstelling({ aan: true, op: new Date(ZOMER_2027).toISOString() });
    expect(m.stuurder.voorApp(ZOMER_2027).controle).toBeUndefined();
    const n = middag({ opgeslagen: { ooit: true, controle: { uitkomst: 'werkt-niet', op: ZOMER_2027, reden: 'geen-effect' } } });
    n.stuurder.zetInstelling({ aan: true }); // na een herstart: geen overgang
    expect(n.stuurder.voorApp(ZOMER_2027).controle.uitkomst).toBe('werkt-niet');
    n.stuurder.zetInstelling(null);
    n.stuurder.zetInstelling({ aan: true });
    expect(n.stuurder.voorApp(ZOMER_2027).controle).toBeUndefined();
  });

  it('1.6.1: een wolk tijdens de controle (de andere zonmeter zakt ook): geen "werkt niet"', async () => {
    const m = middag();
    m.wereld.huisW = 3500;
    m.wereld.zonW = 7000;
    m.wereld.andereZonW = 2000; // 3,5 kW − 2 kW andere zon + 0,3 kW → 30% van 8 kW
    m.stuurder.zetInstelling({ aan: true });
    m.wereld.nu = ZOMER_2027;
    await m.loop(EXPORT_DUUR_MS + 10_000);
    expect(m.verbinding.s.schrijven).toEqual(['grens 30', 'schakelaar 1']);
    // Een wolk over alle panelen: de GoodWe zakt naar 0,5 kW (bij 30% = 2,4 kW), de andere zon ook.
    m.wereld.zonW = 500;
    m.wereld.andereZonW = 150;
    await m.loop(2 * CONTROLE_MS + 10_000);
    expect(m.stuurder.voorApp(m.wereld.nu).controle?.uitkomst).not.toBe('werkt-niet');
    expect(m.logs.some((l) => /werkt niet op deze omvormer|veel minder dan bedoeld/.test(l))).toBe(false);
    expect(m.verbinding.s.schrijven).not.toContain('schakelaar 0');
  });

  it('1.6.1: een wolk zonder andere zonmeter: één keer opnieuw kijken, en dan werkt het gewoon', async () => {
    const m = middag();
    m.wereld.huisW = 3500;
    m.wereld.zonW = 7000;
    m.stuurder.zetInstelling({ aan: true });
    m.wereld.nu = ZOMER_2027;
    await m.loop(EXPORT_DUUR_MS + 10_000);
    expect(m.verbinding.s.schrijven).toEqual(['grens 50', 'schakelaar 1']);
    m.wereld.zonW = 500; // de wolk
    await m.loop(CONTROLE_MS);
    expect(m.verbinding.s.schakelaar).toBe(1);
    m.wereld.zonW = 7000; // weer zon
    await m.loop(CONTROLE_MS + 10_000);
    expect(m.stuurder.voorApp(m.wereld.nu).controle).toMatchObject({ uitkomst: 'werkt', pct: 50 });
  });

  it('1.6.1 beoordeel: "levert te weinig" alleen als de zon elders niet ook viel', () => {
    const c = { pct: 50, voorW: 7000, terugVoor: 3000, verwachtW: 4000, andereVoor: 0, wisselend: false };
    const laag = [{ w: 400 }, { w: 380 }, { w: 410 }];
    expect(beoordeel(c, laag, 8000)).toMatchObject({ uitkomst: 'werkt-niet', reden: 'te-veel' });
    // De andere zonmeter zakte net zo hard: het weer.
    const metAndere = { ...c, andereVoor: 2000 };
    expect(beoordeel(metAndere, laag.map((x) => ({ ...x, andere: 150 })), 8000)).toMatchObject({ uitkomst: 'onzeker' });
    expect(beoordeel(metAndere, laag.map((x) => ({ ...x, andere: 1950 })), 8000)).toMatchObject({ uitkomst: 'werkt-niet', reden: 'te-veel' });
    // Even haalde hij de grens wel: dan telt de grens goed, het was een wolk.
    expect(beoordeel(c, [...laag, { w: 3900 }], 8000)).toMatchObject({ uitkomst: 'onzeker' });
    // De zon wisselde vooraf al sterk (wolken): ook geen oordeel.
    expect(beoordeel({ ...c, wisselend: true }, laag, 8000)).toMatchObject({ uitkomst: 'onzeker' });
  });

  it('beoordeel: via het net (met een GoodWe-meter begrenst hij alleen de teruglevering)', () => {
    const c = { pct: 20, voorW: 5000, terugVoor: 4000, verwachtW: 1600 };
    expect(beoordeel(c, [{ w: 4200, terug: 1500 }, { w: 4100, terug: 1400 }, { w: 4100, terug: 1300 }], 8000)).toMatchObject({ uitkomst: 'werkt', via: 'net' });
    expect(beoordeel(c, [{ w: 4900, terug: 3900 }, { w: 5000, terug: 4000 }, { w: 5000, terug: 4000 }], 8000)).toMatchObject({ uitkomst: 'werkt-niet', reden: 'geen-effect' });
    expect(beoordeel(c, [{ w: 1000 }, { w: 1000 }], 8000)).toBeNull();
  });
});
