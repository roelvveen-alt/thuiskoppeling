import { describe, expect, it } from 'vitest';
import { gekoppeldVoorApp, productNaam, volgFouten } from './gekoppeld.mjs';

const TIM = {
  homewizard: [
    { sleutel: 'hw-zon-dierenverblijf', naam: 'Zon dierenverblijf', rol: 'zon', adres: '192.168.1.61', serienummer: '5c2faf000001' },
    { sleutel: 'hw-zon-batterij', naam: 'zon + batterij', rol: 'zon-en-batterij', adres: '192.168.1.62', serienummer: '5c2faf000002' },
    { sleutel: 'hw-meterkast', naam: 'Meterkast', rol: 'net', adres: '192.168.1.64', serienummer: '5c2faf000003', code: 'C0DEC0DEC0DEC0DEC0DEC0DEC0DEC0DE' },
  ],
  zendure: { manier: 'lokaal', adres: '192.168.1.63' },
  zendure_p1: { adres: '192.168.0.64' },
};

describe('gekoppelde apparaten', () => {
  it('productnamen zoals mensen ze schrijven', () => {
    expect(productNaam('solarFlow2400AC')).toBe('SolarFlow 2400 AC');
    expect(productNaam('SolarFlow 2400 AC')).toBe('SolarFlow 2400 AC');
    expect(productNaam('hyper2000')).toBe('Hyper 2000');
    expect(productNaam(null)).toBe('');
  });

  it('onthoudt sinds wanneer iets niet antwoordt, en vergeet het als het weer lukt', () => {
    const sinds = new Map();
    volgFouten(new Map([['zendure', 'time-out']]), sinds, 1000);
    volgFouten(new Map([['zendure', 'time-out']]), sinds, 6000);
    expect(sinds.get('zendure')).toBe(1000);
    volgFouten(new Map(), sinds, 11000);
    expect(sinds.size).toBe(0);
  });

  it('zoals bij Tim, zonder codes, sleutels of serienummers', () => {
    const fout = Date.UTC(2026, 9, 30, 7, 12);
    const lijst = gekoppeldVoorApp(TIM, {
      sinds: new Map([['zendure-p1', fout]]),
      homewizard: [
        { meter: TIM.homewizard[0], w: 240.4 },
        { meter: TIM.homewizard[1], w: -1262 },
        { meter: TIM.homewizard[2], w: -1929 },
      ],
      zendureStand: { batterij_w: 1700, product: 'solarFlow2400AC' },
      zendureP1: null,
      zendureProduct: null,
    });
    expect(lijst).toEqual([
      { sleutel: 'hw-zon-dierenverblijf', naam: 'Zon dierenverblijf', merk: 'HomeWizard', soort: 'kWh-meter', rol: 'zon', manier: 'v1', adres: '192.168.1.61', ok: true, sinds: null, w: 240 },
      { sleutel: 'hw-zon-batterij', naam: 'zon + batterij', merk: 'HomeWizard', soort: 'kWh-meter', rol: 'zon-en-batterij', manier: 'v1', adres: '192.168.1.62', ok: true, sinds: null, w: -1262 },
      { sleutel: 'hw-meterkast', naam: 'Meterkast', merk: 'HomeWizard', soort: 'P1-meter', rol: 'net', manier: 'v2', adres: '192.168.1.64', ok: true, sinds: null, w: -1929 },
      { sleutel: 'zendure', naam: 'Zendure-batterij', merk: 'Zendure', soort: 'SolarFlow 2400 AC', rol: 'batterij', manier: 'lokaal', adres: '192.168.1.63', ok: true, sinds: null, w: 1700 },
      { sleutel: 'zendure-p1', naam: 'Zendure P1-meter', merk: 'Zendure', soort: 'P1-meter', rol: 'vergelijk', manier: 'lokaal', adres: '192.168.0.64', ok: false, sinds: '2026-10-30T07:12:00.000Z', w: null },
    ]);
    const tekst = JSON.stringify(lijst);
    for (const geheim of ['C0DEC0DE', '5c2faf']) expect(tekst).not.toContain(geheim);
  });

  it('de GoodWe-omvormer: met zijn type, en wat hij nu levert', () => {
    const instellingen = { homewizard: [], goodwe: { adres: '192.168.1.40', bij: 'hw-zon-batterij' } };
    const basis = { homewizard: [], zendureStand: null, zendureP1: null, zendureProduct: null };
    expect(gekoppeldVoorApp(instellingen, { ...basis, sinds: new Map(), omvormer: { stand: 'normaal', w: 3120.4 }, omvormerType: 'GW8K-DT' })).toEqual([
      { sleutel: 'goodwe', naam: 'Omvormer', merk: 'GoodWe', soort: 'GW8K-DT', rol: 'omvormer', manier: 'lokaal', adres: '192.168.1.40', ok: true, sinds: null, w: 3120 },
    ]);
    // Slapen is geen storing: ok, zonder vermogen.
    expect(gekoppeldVoorApp(instellingen, { ...basis, sinds: new Map(), omvormer: { stand: 'slaapt' } })[0]).toMatchObject({ soort: 'omvormer', ok: true, w: null });
    expect(gekoppeldVoorApp(instellingen, { ...basis, sinds: new Map([['goodwe', Date.UTC(2026, 9, 30, 9)]]), omvormer: { stand: 'weg' } })[0]).toMatchObject({ ok: false, w: null });
  });

  it('Zendure via de cloud: geen adres, en zonder gegevens antwoordt hij niet', () => {
    const [zendure] = gekoppeldVoorApp(
      { homewizard: [], zendure: { manier: 'cloud', cloudsleutel: 'GEHEIM' } },
      { sinds: new Map(), homewizard: [], zendureStand: null, zendureP1: null, zendureProduct: 'SolarFlow 2400 AC' },
    );
    expect(zendure).toMatchObject({ soort: 'SolarFlow 2400 AC', manier: 'cloud', adres: null, ok: false, w: null });
    expect(JSON.stringify(zendure)).not.toContain('GEHEIM');
  });
});

describe('Zendure lokaal met de cloud als reserve', () => {
  const instellingen = { homewizard: [], zendure: { manier: 'lokaal', adres: '192.168.1.63', cloudsleutel: 'GEHEIM' } };
  const basis = { sinds: new Map(), homewizard: [], zendureP1: null, zendureProduct: null };

  it('lokaal zoals altijd; via de cloud zolang hij lokaal niet antwoordt, zonder sleutel', () => {
    const [lokaal] = gekoppeldVoorApp(instellingen, { ...basis, zendureStand: { batterij_w: -800, product: 'solarFlow2400AC', bron: 'lokaal' } });
    expect(lokaal).toMatchObject({ manier: 'lokaal', adres: '192.168.1.63', ok: true, w: -800 });
    const [reserve] = gekoppeldVoorApp(instellingen, { ...basis, zendureStand: { batterij_w: -790, bron: 'cloud-reserve' } });
    expect(reserve).toMatchObject({ manier: 'cloud-reserve', ok: true, w: -790 });
    expect(JSON.stringify([lokaal, reserve])).not.toContain('GEHEIM');
  });

  it('een melding zolang de stand van de cloud komt', async () => {
    const { meldingenVoorApp } = await import('./gekoppeld.mjs');
    const nu = Date.parse('2026-10-30T12:00:00Z');
    const uit = meldingenVoorApp(instellingen, { problemen: new Map(), sinds: new Map(), zendureReserve: nu - 60_000, nu });
    expect(uit).toEqual([
      { soort: 'reserve', tekst: 'Zendure-batterij: antwoordt lokaal niet; de stand komt nu via de Zendure-cloud (reserve).', sinds: new Date(nu - 60_000).toISOString() },
    ]);
    expect(meldingenVoorApp(instellingen, { problemen: new Map(), sinds: new Map(), zendureReserve: null, nu })).toEqual([]);
  });

  it('een zonnemeter die verbruik meet', async () => {
    const { meldingenVoorApp } = await import('./gekoppeld.mjs');
    const nu = Date.parse('2026-10-30T12:00:00Z');
    const tekst = "De meter 'Zon' meet verbruik (+1.372 W), geen opwek: staat hij goed in de instelhulp?";
    expect(meldingenVoorApp(instellingen, { problemen: new Map(), sinds: new Map(), zonVerbruik: [{ tekst, sinds: nu }], nu })).toEqual([
      { soort: 'meter', tekst, sinds: new Date(nu).toISOString() },
    ]);
  });
});

describe('meldingenVoorApp', () => {
  it('opslag, prijzen, apparaten (zonder adres) en bedragen, met sinds; hooguit 8 en 160 tekens', async () => {
    const { meldingenVoorApp } = await import('./gekoppeld.mjs');
    const instellingen = { homewizard: [{ sleutel: 'hw-p1', naam: 'Meterkast' }] };
    const nu = Date.parse('2026-10-30T12:00:00Z');
    const uit = meldingenVoorApp(instellingen, {
      problemen: new Map([
        ['hw-p1', 'connect EHOSTUNREACH 192.168.1.64:443'],
        ['zendure', 'geen bericht'],
      ]),
      sinds: new Map([['hw-p1', nu - 60_000]]),
      prijzen: { tekst: 'Zonneplan: opnieuw inloggen nodig: node brug.mjs zonneplan-login.', sinds: nu - 3_600_000 },
      opslag: { tekst: 'Kon vandaag.json niet bewaren (ENOSPC)', sinds: nu },
      bedragen: 'De bedragen voor 2027 staan er nog niet.',
      nu,
    });
    expect(uit.map((m) => m.soort)).toEqual(['opslag', 'prijzen', 'apparaat', 'apparaat', 'bedragen']);
    expect(uit[2]).toEqual({ soort: 'apparaat', tekst: 'Meterkast: connect EHOSTUNREACH het adres', sinds: new Date(nu - 60_000).toISOString() });
    expect(uit[3].tekst).toBe('Zendure-batterij: geen bericht');
    expect(uit[4]).not.toHaveProperty('sinds');
    const veel = meldingenVoorApp(instellingen, { problemen: new Map(Array.from({ length: 12 }, (_, i) => [`m${i}`, 'x'.repeat(300)])), sinds: new Map(), nu });
    expect(veel).toHaveLength(8);
    expect(veel[0].tekst.length).toBe(160);
    expect(meldingenVoorApp(instellingen, { problemen: new Map(), sinds: new Map(), nu })).toEqual([]);
  });
});

describe('meldingen: storingen op het net (0.13.0)', () => {
  it('soort net, met sinds; een oudere functie neemt elke soort aan', async () => {
    const { meldingenVoorApp } = await import('./gekoppeld.mjs');
    const nu = Date.parse('2026-10-30T20:14:00Z');
    const uit = meldingenVoorApp({ homewizard: [] }, { problemen: new Map(), sinds: new Map(), net: [{ tekst: 'Meterkast: spanningsdip op L2 gemeten (21:14)', sinds: nu }], nu });
    expect(uit).toEqual([{ soort: 'net', tekst: 'Meterkast: spanningsdip op L2 gemeten (21:14)', sinds: '2026-10-30T20:14:00.000Z' }]);
    expect(uit[0].soort).toMatch(/^[a-z-]{1,20}$/);
  });
});
