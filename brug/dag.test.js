import { describe, expect, it } from 'vitest';
import { dagVoorApp, logMeting, middernacht, nieuwLogboek, stromenNu } from './dag.mjs';

const KWARTIER = 15 * 60_000;

describe('middernacht in Nederland', () => {
  it('wintertijd, zomertijd en de dag van de wisseling', () => {
    expect(new Date(middernacht(Date.UTC(2026, 9, 30, 12))).toISOString()).toBe('2026-10-29T23:00:00.000Z');
    expect(new Date(middernacht(Date.UTC(2026, 6, 1, 12))).toISOString()).toBe('2026-06-30T22:00:00.000Z');
    // Zondag 25 oktober 2026 gaat de klok terug: middernacht is nog zomertijd.
    expect(new Date(middernacht(Date.UTC(2026, 9, 25, 20))).toISOString()).toBe('2026-10-24T22:00:00.000Z');
    // Net na middernacht hoort bij de nieuwe dag.
    expect(new Date(middernacht(Date.UTC(2026, 9, 29, 23, 0, 1))).toISOString()).toBe('2026-10-29T23:00:00.000Z');
  });
});

describe('het logboek van vandaag', () => {
  const nacht = Date.UTC(2026, 9, 29, 23); // 30 oktober, 00:00 in Nederland
  const acht = nacht + 8 * 4 * KWARTIER; // 08:00

  it('een meting zonder net telt niet als 0 mee; het huis alleen als het net bekend is', () => {
    // Zon 5 kW, de batterij laadt 1 kW, terug 3,5 kW; de P1 valt de helft van de tijd weg.
    let log = null;
    for (let i = 0; i < 20; i += 1) {
      log = logMeting(log, { zon_w: 5000, batterij_w: -1000, net_w: i % 2 ? null : -3500, batterij_procent: 50 }, acht + i * 5000);
    }
    const dag = dagVoorApp(log);
    expect(dag.net_w[32]).toBe(-3500);
    expect(dag.huis_w[32]).toBe(500);
    expect(dag.zon_w[32]).toBe(5000);
    // kWh van het huis: alleen de stukken met een net (9 van de 19 stappen van 5 s, à 500 W).
    expect(log.kwh.huis).toBeCloseTo((500 * 9 * 5) / 3_600_000, 6);
  });

  it('een kwartier van een oudere versie (één teller voor alles) telt gewoon door', () => {
    const oud = { datum: '2026-10-30', van: nacht, sinds: acht, laatste: null, kwh: { zon: 0, huis: 0, geladen: 0, ontladen: 0 }, fasenDag: {}, week: [] };
    oud.kwartieren = [];
    oud.kwartieren[32] = { n: 2, zon: 2000, huis: 1000, batterij: 0, net: -1000, procent: 100, np: 2, heeft: { zon: true, net: true } };
    const dag = dagVoorApp(logMeting(oud, { zon_w: 1000, batterij_w: 0, net_w: -500, batterij_procent: 50 }, acht + 1000));
    expect(dag.zon_w[32]).toBe(1000);
    expect(dag.huis_w[32]).toBe(500);
  });

  it('een rare lezing (101 %, -1 %, 1 MW, 5000 A) blijft binnen de grenzen van de app', () => {
    let log = logMeting(null, { zon_w: 0, batterij_w: 2e6, net_w: -2e6, batterij_procent: 101, fasen: [{ fase: 1, a: 5000, w: 3e6 }] }, acht);
    log = logMeting(log, { zon_w: 0, batterij_w: 0, net_w: 0, batterij_procent: 101 }, acht + 3_000);
    log = logMeting(log, { zon_w: 0, batterij_w: 0, net_w: 0, batterij_procent: -1 }, acht + KWARTIER);
    const dag = dagVoorApp(log);
    expect(Math.max(...dag.procent)).toBe(100);
    expect(Math.min(...dag.procent)).toBe(0);
    expect(Math.max(...dag.batterij_w)).toBeLessThanOrEqual(100_000);
    expect(Math.min(...dag.net_w)).toBeGreaterThanOrEqual(-100_000);
    expect(Math.max(...dag.fasen[0].a)).toBeLessThanOrEqual(1000);
    expect(Math.max(...dag.fasen[0].w)).toBeLessThanOrEqual(100_000);
  });

  it('per kwartier het gemiddelde; het huis is zon + batterij + net, nooit onder 0', () => {
    let log = logMeting(null, { zon_w: 400, batterij_w: 1700, net_w: -1650, batterij_procent: 47 }, acht);
    log = logMeting(log, { zon_w: 600, batterij_w: 1700, net_w: -1850, batterij_procent: 46 }, acht + 5_000);
    // Meters die even niet kloppen: het huis wordt 0, niet min.
    log = logMeting(log, { zon_w: 0, batterij_w: 0, net_w: -300, batterij_procent: 46 }, acht + KWARTIER);
    const dag = dagVoorApp(log);
    expect(dag.datum).toBe('2026-10-30');
    expect(dag.van).toBe('2026-10-29T23:00:00.000Z');
    expect(dag.stap_min).toBe(15);
    expect(dag.metingen).toHaveLength(34);
    expect(dag.metingen.slice(0, 32).every((n) => n === 0)).toBe(true);
    expect(dag.metingen.slice(32)).toEqual([2, 1]);
    expect(dag.zon_w.slice(32)).toEqual([500, 0]);
    expect(dag.huis_w.slice(32)).toEqual([450, 0]);
    expect(dag.batterij_w.slice(32)).toEqual([1700, 0]);
    expect(dag.net_w.slice(32)).toEqual([-1750, -300]);
    expect(dag.procent.slice(32)).toEqual([47, 46]);
    expect(dag.sinds).toBe(new Date(acht).toISOString());
  });

  it('kWh: vermogen × tijd tussen twee metingen; een gat van meer dan een minuut telt niet', () => {
    let log = logMeting(null, { zon_w: 3600, batterij_w: -1800, net_w: 0 }, acht);
    log = logMeting(log, { zon_w: 3600, batterij_w: -1800, net_w: 0 }, acht + 5_000);
    expect(log.kwh.zon).toBeCloseTo(0.005);
    expect(log.kwh.geladen).toBeCloseTo(0.0025);
    expect(log.kwh.huis).toBeCloseTo(0.0025);
    log = logMeting(log, { zon_w: 3600, batterij_w: 1800, net_w: 0 }, acht + 5_000 + 120_000);
    expect(log.kwh.zon).toBeCloseTo(0.005);
    expect(log.kwh.ontladen).toBe(0);
  });

  it('zonder batterij geen batterijreeks; een batterij die even zwijgt houdt zijn procent vast', () => {
    const zonder = dagVoorApp(logMeting(null, { zon_w: 100, batterij_w: null, net_w: 200 }, acht));
    expect(zonder.batterij_w).toBeUndefined();
    expect(zonder.procent).toBeUndefined();
    let log = logMeting(null, { zon_w: 0, batterij_w: 500, net_w: 0, batterij_procent: 80 }, acht);
    log = logMeting(log, { zon_w: 0, batterij_w: null, net_w: 300, batterij_procent: null }, acht + KWARTIER);
    expect(dagVoorApp(log).procent.slice(32)).toEqual([80, 80]);
  });

  it('een nieuwe dag begint leeg', () => {
    const gisteren = logMeting(null, { zon_w: 100, net_w: 0 }, acht);
    const vandaag = logMeting(gisteren, { zon_w: 0, net_w: 300 }, acht + 86_400_000);
    expect(vandaag.datum).toBe('2026-10-31');
    expect(dagVoorApp(vandaag).metingen.reduce((a, b) => a + b, 0)).toBe(1);
    expect(dagVoorApp(null)).toBeNull();
  });
});

describe('per plek met panelen (0.10.0)', () => {
  const nacht = Date.UTC(2026, 9, 29, 23);
  const twaalf = nacht + 12 * 4 * KWARTIER;
  const zonnen = (dak, verblijf) => [
    { sleutel: 'hw-zon-huis', naam: 'Hoofddak', vermogen_w: dak },
    { sleutel: 'hw-zon-verblijf', naam: 'Dierenverblijf', vermogen_w: verblijf },
  ];

  it('twee plekken: per plek het gemiddelde per kwartier, naast de zon', () => {
    let log = null;
    log = logMeting(log, { zon_w: 4000, net_w: -3000, zonnen: zonnen(3000, 1000) }, twaalf);
    log = logMeting(log, { zon_w: 5000, net_w: -4000, zonnen: zonnen(3800, 1200) }, twaalf + 5000);
    // Een plek die even niet antwoordt, telt in dat kwartier niet als 0 mee.
    log = logMeting(log, { zon_w: 3600, net_w: -2600, zonnen: [{ sleutel: 'hw-zon-huis', vermogen_w: 3600 }] }, twaalf + 10_000);
    const dag = dagVoorApp(log);
    expect(dag.zonnen).toEqual([
      { sleutel: 'hw-zon-huis', w: expect.any(Array) },
      { sleutel: 'hw-zon-verblijf', w: expect.any(Array) },
    ]);
    expect(dag.zonnen[0].w).toHaveLength(dag.metingen.length);
    expect(dag.zonnen[0].w[48]).toBe(3467);
    expect(dag.zonnen[1].w[48]).toBe(1100);
    expect(dag.zonnen[1].w[0]).toBe(0);
  });

  it('één plek (of geen): niet apart, dat is gewoon de zon; een oud logboek zonder plekken telt door', () => {
    let log = logMeting(null, { zon_w: 900, net_w: 0, zonnen: [{ sleutel: 'zon', vermogen_w: 900 }] }, twaalf);
    expect(dagVoorApp(log)).not.toHaveProperty('zonnen');
    log = logMeting(null, { zon_w: 900, net_w: 0 }, twaalf);
    expect(dagVoorApp(log)).not.toHaveProperty('zonnen');
    // Een vreemde sleutel of geen getal: niet mee.
    log = logMeting(null, { zon_w: 900, net_w: 0, zonnen: [{ sleutel: 'a b\n', vermogen_w: 9 }, { sleutel: 'x', vermogen_w: 'veel' }, { sleutel: 'y', vermogen_w: 900 }] }, twaalf);
    expect(Object.keys(log.kwartieren[48].z)).toEqual(['y']);
  });
});

describe('per fase', () => {
  const nacht = Date.UTC(2026, 9, 29, 23);
  const acht = nacht + 8 * 4 * KWARTIER;
  const fasen = (a1, a2, a3) => [
    { fase: 1, w: -230 * a1, a: a1 },
    { fase: 2, w: 230 * a2, a: a2 },
    { fase: 3, w: 230 * a3, a: a3 },
  ];

  it('per kwartier de gemiddelde stroom en het vermogen, en over de dag gemiddelde en piek', () => {
    let log = logMeting(null, { net_w: 0, fasen: fasen(7, 2, 1) }, acht);
    log = logMeting(log, { net_w: 0, fasen: fasen(9, 4, 1) }, acht + 5_000);
    const dag = dagVoorApp(log);
    expect(dag.fasen.map((f) => f.fase)).toEqual([1, 2, 3]);
    expect(dag.fasen[0].a.slice(32)).toEqual([8]);
    expect(dag.fasen[0].w.slice(32)).toEqual([-1840]);
    expect(dag.fasen[1]).toMatchObject({ gemiddeld_a: 3, piek_a: 4 });
    expect(dag.fasen[0].a.slice(0, 32).every((a) => a === 0)).toBe(true);
  });

  it('eenfase: één fase; zonder fasen geen fasen', () => {
    const een = dagVoorApp(logMeting(null, { net_w: 0, fasen: [{ fase: 1, w: 300, a: 1.3 }] }, acht));
    expect(een.fasen).toHaveLength(1);
    expect(dagVoorApp(logMeting(null, { net_w: 0 }, acht)).fasen).toBeUndefined();
  });

  it('een nieuwe dag bewaart de daggemiddelden in de week, hooguit 7 dagen', () => {
    let log = null;
    for (let d = 0; d < 9; d++) log = logMeting(log, { net_w: 0, fasen: fasen(5 + d, 2, 1) }, acht + d * 86_400_000);
    const dag = dagVoorApp(log);
    expect(dag.week).toHaveLength(7);
    expect(dag.week.at(-1)).toEqual({ datum: '2026-11-06', fasen: [{ fase: 1, gemiddeld_a: 12, piek_a: 12 }, { fase: 2, gemiddeld_a: 2, piek_a: 2 }, { fase: 3, gemiddeld_a: 1, piek_a: 1 }] });
    expect(dag.datum).toBe('2026-11-07');
  });
});

describe('het huis: dezelfde som in het programmaatje, de site en de server', () => {
  // zon, batterij (plus = levert), net (plus = afnemen) → huis
  const GEVALLEN = [
    [1078, -2418, 1800, 460],
    [0, 0, 350, 350],
    [2500, 0, -1900, 600],
    [0, 800, -200, 600],
    [1200, 300, 0, 1500],
    [0, -1500, 1400, 0], // een achterlopende Zendure: even onder 0 wordt 0
    [-5, 0, 120, 120], // de zonmeter trekt zelf een beetje: geen min-zon
    [100.4, -50.6, 20.4, 69],
  ];

  it('per meting gelijk aan verdeelStroom (site) en kwartierDelen (server)', async () => {
    const { verdeelStroom } = await import('../src/lib/stroom.js');
    const { kwartierDelen } = await import('../base44/functions/ontvangMeting/dagboek.js');
    const nu = middernacht(Date.UTC(2026, 9, 30, 12)) + 60_000;
    for (const [zon, batterij, net, huis] of GEVALLEN) {
      const uitDag = dagVoorApp(logMeting(null, { zon_w: zon, batterij_w: batterij, net_w: net }, nu)).huis_w[0];
      const site = verdeelStroom({ zon_w: zon, batterij_w: batterij, net_w: net }).huis_w;
      const server = kwartierDelen(zon, batterij, net).huis;
      expect([uitDag, site, server], `zon ${zon}, batterij ${batterij}, net ${net}`).toEqual([huis, huis, huis]);
    }
  });
});

describe('wie aan wie, per meting (1.2.0, rekenregels-7)', () => {
  const MIDDAG = middernacht(Date.UTC(2026, 9, 30, 12)) + 12 * 3_600_000;

  it('stromenNu verdeelt elke meting zoals verdeelStroom (site) en kwartierDelen (server)', async () => {
    const { verdeelStroom } = await import('../src/lib/stroom.js');
    const { kwartierDelen } = await import('../base44/functions/ontvangMeting/dagboek.js');
    let a = 20261030;
    const r = () => {
      a = (a * 1103515245 + 12345) % 2 ** 31;
      return a / 2 ** 31;
    };
    const gevallen = [
      [1078, -2418, 1800],
      [2500, 0, -1900],
      [0, 800, -200],
      [0, -1500, 1400],
      [-5, 0, 120],
      [100.4, -50.6, 20.4],
      [null, -800, 900],
      [700, null, -200],
      [-0.5, 0.5, -0.5],
    ];
    for (let i = 0; i < 500; i++) gevallen.push([r() < 0.2 ? 0 : r() * 5000, (r() - 0.5) * 4800, (r() - 0.5) * 8000]);
    for (const [zon, batterij, net] of gevallen) {
      const v = verdeelStroom({ zon_w: zon, batterij_w: batterij, net_w: net }).soorten;
      const server = kwartierDelen(zon, batterij, net);
      const brug = stromenNu(zon, batterij, net);
      const waar = `zon ${zon}, batterij ${batterij}, net ${net}`;
      expect(brug, waar).toEqual({ zonZelf: v['zon>huis'] + v['zon>batterij'], netHuis: v['net>huis'] });
      expect(brug, waar).toEqual({ zonZelf: server.zonZelf, netHuis: server.huisUitNet });
    }
  });

  it('afnemen en terugleveren binnen een kwartier vallen niet meer tegen elkaar weg', () => {
    // Een kwartier: 7,5 minuut de waterkoker (net +2000 W), 7,5 minuut zon die teruggaat (net −2000 W).
    // Gemiddeld over het kwartier: net 0, huis 1000 W, zon 1000 W: "alles van de zon".
    let logboek = null;
    for (let s = 0; s <= 900; s += 5) {
      const eerst = s < 450;
      logboek = logMeting(logboek, { zon_w: eerst ? 0 : 2400, batterij_w: 0, net_w: eerst ? 2000 : -2000 }, MIDDAG + s * 1000);
    }
    const dag = dagVoorApp(logboek);
    // Per meting: het net leverde de helft van de tijd 2 kW aan het huis, 0,25 kWh; de zon ging maar voor 400 W in huis.
    expect(dag.kwh.net_huis).toBeCloseTo(0.25, 2);
    expect(dag.kwh.zon_zelf).toBeCloseTo(0.05, 2);
    expect(dag.kwh.huis).toBeCloseTo(0.3, 2);
    expect(dag.kwh.zon).toBeCloseTo(0.3, 2);
  });

  it('een dag die al liep onder een oudere versie (vandaag.json zonder de tellers) stuurt ze niet; de volgende dag wel', () => {
    const oud = { ...nieuwLogboek(MIDDAG), kwh: { zon: 1, huis: 2, geladen: 0, ontladen: 0 } };
    let logboek = logMeting(oud, { zon_w: 1000, batterij_w: 0, net_w: 200 }, MIDDAG);
    logboek = logMeting(logboek, { zon_w: 1000, batterij_w: 0, net_w: 200 }, MIDDAG + 5000);
    expect(dagVoorApp(logboek).kwh).toEqual({ zon: expect.any(Number), huis: expect.any(Number), geladen: 0, ontladen: 0 });
    expect(Number.isNaN(dagVoorApp(logboek).kwh.zon)).toBe(false);
    const morgen = logMeting(logboek, { zon_w: 0, batterij_w: 0, net_w: 200 }, MIDDAG + 24 * 3_600_000);
    expect(dagVoorApp(morgen).kwh).toMatchObject({ zon_zelf: 0, net_huis: 0 });
  });

  it('zonder net geen stromen (het huis is dan niet te weten); na een gat van meer dan een minuut telt niets', () => {
    let logboek = logMeting(null, { zon_w: 1000, batterij_w: 0, net_w: null }, MIDDAG);
    logboek = logMeting(logboek, { zon_w: 1000, batterij_w: 0, net_w: null }, MIDDAG + 5000);
    expect(dagVoorApp(logboek).kwh).toMatchObject({ zon_zelf: 0, net_huis: 0 });
    logboek = logMeting(logboek, { zon_w: 1000, batterij_w: 0, net_w: 500 }, MIDDAG + 5 * 60_000);
    expect(dagVoorApp(logboek).kwh).toMatchObject({ zon_zelf: 0, net_huis: 0 });
  });
});
