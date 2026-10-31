import { describe, expect, it } from 'vitest';
import { controleerMeting } from '../functions/ontvangMeting/controle.js';

const nu = new Date('2026-10-29T21:00:00Z');

describe('controleerMeting', () => {
  it('een gewone meting', () => {
    const uit = controleerMeting(
      {
        moment: '1999-01-01T00:00:00Z',
        net_w: -312.6,
        zon_w: 1450,
        batterij_w: -900,
        batterij_procent: 63.2,
        apparaten: [{ sleutel: 'hw-3c39e7aabbcc', naam: ' Wasmachine ', soort: 'wasmachine', vermogen_w: 2050 }],
        bron: 'brug 0.1.0',
      },
      nu,
    );
    expect(uit).toEqual({
      ok: true,
      meting: {
        moment: '2026-10-29T21:00:00.000Z',
        net_w: -313,
        net_bron: null,
        net_zendure_w: null,
        zon_w: 1450,
        batterij_w: -900,
        batterij_procent: 63,
        batterij_info: null,
        omvormer: null,
        // Een oude brug stuurt geen meterkast (1.4.0): leeg.
        meterkast: null,
        zonnen: [],
        apparaten: [{ sleutel: 'hw-3c39e7aabbcc', naam: 'Wasmachine', soort: 'wasmachine', vermogen_w: 2050 }],
        // Een oude brug stuurt geen lampen (0.8.0): leeg.
        lampen: null,
        bron: 'brug 0.1.0',
        prijs: null,
        vandaag: null,
        jaar: null,
        fasen: null,
      },
      overgeslagen: [],
    });
  });

  it('prijs en vandaag', () => {
    const uit = controleerMeting(
      {
        prijs: { afname_kwh: 0.2843, teruglevering_kwh: -0.012, van: '2026-10-30T13:00:00+01:00', tot: '2026-10-30T13:15:00+01:00', bron: 'Zonneplan' },
        vandaag: { datum: '2026-10-30', afname_kwh: 8.3, teruglevering_kwh: 0, kosten_eur: 3.49, opbrengst_eur: 0, compleet: true },
      },
      nu,
    );
    expect(uit.meting.prijs).toEqual({
      afname_kwh: 0.2843,
      teruglevering_kwh: -0.012,
      zonnebonus_kwh: 0,
      van: '2026-10-30T13:00:00+01:00',
      tot: '2026-10-30T13:15:00+01:00',
      bron: 'Zonneplan',
    });
    expect(uit.meting.vandaag).toEqual({
      datum: '2026-10-30',
      afname_kwh: 8.3,
      teruglevering_kwh: 0,
      kosten_eur: 3.49,
      opbrengst_eur: 0,
      vaste_kosten_eur: null,
      compleet: true,
    });
  });

  it('vaste kosten van vandaag (ook min) en de Zonnebonus van dit jaar', () => {
    const uit = controleerMeting(
      {
        vandaag: { datum: '2026-10-30', afname_kwh: 8.3, teruglevering_kwh: 0, kosten_eur: 3.49, opbrengst_eur: 0, vaste_kosten_eur: -0.2635 },
        jaar: { jaar: 2026, teruglevering_kwh: 7247.4, plafond_kwh: 7500 },
      },
      nu,
    );
    expect(uit.meting.vandaag.vaste_kosten_eur).toBe(-0.2635);
    expect(uit.meting.jaar).toEqual({ jaar: 2026, teruglevering_kwh: 7247.4, plafond_kwh: 7500 });
  });

  it('de Zendure P1-meter ernaast, afgerond en mag min zijn', () => {
    expect(controleerMeting({ net_w: -312, net_zendure_w: -298.6 }, nu).meting).toMatchObject({ net_w: -312, net_zendure_w: -299 });
  });

  it('van welke meter het net komt: HomeWizard, of de Zendure P1 als reserve', () => {
    expect(controleerMeting({ net_w: -312, net_bron: 'homewizard' }, nu).meting.net_bron).toBe('homewizard');
    expect(controleerMeting({ net_w: -299, net_zendure_w: -299, net_bron: 'zendure-p1' }, nu).meting.net_bron).toBe('zendure-p1');
    // Een oudere brug stuurt het niet mee.
    expect(controleerMeting({ net_w: -312 }, nu).meting.net_bron).toBeNull();
  });

  it('meer zonnebronnen, elk met eigen naam', () => {
    const uit = controleerMeting(
      {
        zon_w: 3800,
        zonnen: [
          { sleutel: 'hw-batterij-zon', naam: 'Zon huis', vermogen_w: 3000 },
          { sleutel: 'hw-dierenverblijf', naam: 'Zon dierenverblijf', vermogen_w: 800.4 },
          { sleutel: 'hw-stil', naam: 'Zon schuur', vermogen_w: null },
        ],
      },
      nu,
    );
    expect(uit.meting.zonnen).toEqual([
      { sleutel: 'hw-batterij-zon', naam: 'Zon huis', vermogen_w: 3000 },
      { sleutel: 'hw-dierenverblijf', naam: 'Zon dierenverblijf', vermogen_w: 800 },
      { sleutel: 'hw-stil', naam: 'Zon schuur', vermogen_w: null },
    ]);
  });

  it('wat er niet is wordt null; procent en zon blijven binnen de grenzen', () => {
    const uit = controleerMeting({ net_w: 100, zon_w: -3, batterij_procent: 104 }, nu);
    expect(uit.ok).toBe(true);
    expect(uit.meting).toMatchObject({ net_w: 100, zon_w: 0, batterij_w: null, batterij_procent: 100, apparaten: [], zonnen: [] });
  });

  it('een onbekende soort wordt stekker; min-vermogen van een apparaat wordt 0', () => {
    const uit = controleerMeting({ apparaten: [{ sleutel: 'a', soort: '<script>', vermogen_w: -4 }] }, nu);
    expect(uit.meting.apparaten).toEqual([{ sleutel: 'a', naam: '', soort: 'stekker', vermogen_w: 0 }]);
  });

  it.each([
    ['geen object', 'kapot'],
    ['een lijst', [1, 2]],
    ['tekst als vermogen', { net_w: '300' }],
    ['tekst bij de Zendure P1', { net_zendure_w: '300' }],
    ['een onbekende bron van het net', { net_w: 300, net_bron: 'zonneplan' }],
    ['een bron als getal', { net_w: 300, net_bron: 1 }],
    ['oneindig', { zon_w: Number.POSITIVE_INFINITY }],
    ['meer dan 100 kW', { net_w: 250_000 }],
    ['apparaten geen lijst', { apparaten: {} }],
    ['te veel apparaten', { apparaten: Array.from({ length: 41 }, (_, i) => ({ sleutel: `a${i}` })) }],
    ['sleutel met rare tekens', { apparaten: [{ sleutel: 'a b' }] }],
    ['dubbele sleutel', { apparaten: [{ sleutel: 'a' }, { sleutel: 'a' }] }],
    ['zelfde sleutel bij zon en apparaat', { zonnen: [{ sleutel: 'a' }], apparaten: [{ sleutel: 'a' }] }],
    ['een vast punt als sleutel', { zonnen: [{ sleutel: 'huis' }] }],
    ['te veel zonnebronnen', { zonnen: Array.from({ length: 11 }, (_, i) => ({ sleutel: `z${i}` })) }],
    ['vandaag zonder datum', { vandaag: { afname_kwh: 1, teruglevering_kwh: 0, kosten_eur: 0, opbrengst_eur: 0 } }],
    ['min kWh vandaag', { vandaag: { datum: '2026-10-30', afname_kwh: -1, teruglevering_kwh: 0, kosten_eur: 0, opbrengst_eur: 0 } }],
    ['vaste kosten als tekst', { vandaag: { datum: '2026-10-30', afname_kwh: 0, teruglevering_kwh: 0, kosten_eur: 0, opbrengst_eur: 0, vaste_kosten_eur: '1' } }],
    ['een jaar zonder getal', { jaar: { jaar: 'dit', teruglevering_kwh: 1, plafond_kwh: 7500 } }],
    ['min teruglevering dit jaar', { jaar: { jaar: 2026, teruglevering_kwh: -1, plafond_kwh: 7500 } }],
  ])('weigert %s', (_, ruw) => {
    const uit = controleerMeting(ruw, nu);
    expect(uit.ok).toBe(false);
    expect(typeof uit.fout).toBe('string');
  });
});

describe('een prijs die niet klopt houdt de stand niet tegen', () => {
  it('een piek van 12 euro kan; 25 euro, tekst of een raar tijdstip: deze keer zonder prijs, de rest wel', () => {
    expect(controleerMeting({ net_w: 300, prijs: { afname_kwh: 12, teruglevering_kwh: 0.1 } }, nu).meting.prijs).toMatchObject({ afname_kwh: 12 });
    for (const prijs of [
      { afname_kwh: 25, teruglevering_kwh: 0.1 },
      { afname_kwh: '0,28', teruglevering_kwh: 0.1 },
      { afname_kwh: 0.28, teruglevering_kwh: 0.1, van: 'morgen' },
    ]) {
      const uit = controleerMeting({ net_w: 300, prijs }, nu);
      expect(uit.ok).toBe(true);
      expect(uit.meting).toMatchObject({ net_w: 300, prijs: null });
      expect(uit.overgeslagen).toEqual([expect.stringMatching(/^prijs: /)]);
    }
  });
});

describe('voorspelling, dag, gekoppeld en brug', () => {
  const kwartieren = (n, f) => Array.from({ length: n }, (_, i) => f(i));
  const voorspelling = {
    van: '2026-10-29T23:00:00.000Z',
    stap_min: 15,
    afname_kwh: kwartieren(192, (i) => 0.2 + (i % 9) * 0.0123),
    teruglevering_kwh: kwartieren(192, (i) => 0.21 + (i % 9) * 0.0123),
    zonnebonus_kwh: kwartieren(192, (i) => (i > 30 && i < 70 ? 0.0234 : 0)),
    schatting: false,
    bron: 'Zonneplan',
  };
  const dag = {
    datum: '2026-10-30',
    van: '2026-10-29T23:00:00.000Z',
    stap_min: 15,
    sinds: '2026-10-30T06:45:00.000Z',
    metingen: kwartieren(96, (i) => (i < 27 ? 0 : 180)),
    zon_w: kwartieren(96, (i) => (i > 30 && i < 70 ? 1200 : 0)),
    huis_w: kwartieren(96, () => 450),
    batterij_w: kwartieren(96, (i) => (i % 2 ? -1700 : 1700)),
    net_w: kwartieren(96, (i) => (i % 3 ? -1929 : 2300)),
    procent: kwartieren(96, (i) => Math.min(100, i)),
    kwh: { zon: 4.2, huis: 9.8, geladen: 3.1, ontladen: 5.5 },
  };
  const gekoppeld = [
    { sleutel: 'hw-meterkast', naam: 'Meterkast', merk: 'HomeWizard', soort: 'P1-meter', rol: 'net', manier: 'v1', adres: '192.168.1.64', ok: true, sinds: null, w: -1929 },
    { sleutel: 'zendure', naam: 'Zendure-batterij', merk: 'Zendure', soort: 'SolarFlow 2400 AC', rol: 'batterij', manier: 'cloud', adres: null, ok: false, sinds: '2026-10-30T07:12:00.000Z', w: null },
  ];
  const brug = { versie: '0.4.0', gestart: '2026-10-30T06:44:10.000Z', elke_seconden: 5, prijzen: 'Zonneplan' };

  it('neemt ze aan, netjes, en alles samen past ruim in één meting', () => {
    const ruw = { net_w: -1929, voorspelling, dag, gekoppeld, brug };
    const uit = controleerMeting(ruw, nu);
    expect(uit.ok).toBe(true);
    expect(uit.meting.voorspelling.afname_kwh).toHaveLength(192);
    expect(uit.meting.dag.metingen).toHaveLength(96);
    expect(uit.meting.gekoppeld[0]).toEqual({ sleutel: 'hw-meterkast', naam: 'Meterkast', merk: 'HomeWizard', soort: 'P1-meter', rol: 'net', manier: 'v1', ok: true, adres: '192.168.1.64', w: -1929 });
    // Bij de cloud geen adres en geen vermogen: dan staan die velden er niet (geen null in Base44).
    expect(uit.meting.gekoppeld[1]).toEqual({ sleutel: 'zendure', naam: 'Zendure-batterij', merk: 'Zendure', soort: 'SolarFlow 2400 AC', rol: 'batterij', manier: 'cloud', ok: false, sinds: '2026-10-30T07:12:00.000Z' });
    expect(uit.meting.brug).toEqual(brug);
    expect(JSON.stringify(ruw).length).toBeLessThan(20_000);
  });

  it('een Zendure lokaal met de cloud als reserve (brug 0.6.2): cloud-reserve mag', () => {
    const reserve = { ...gekoppeld[1], manier: 'cloud-reserve', adres: '192.168.1.63', ok: true, sinds: null, w: -800 };
    const uit = controleerMeting({ net_w: 1, gekoppeld: [reserve] }, nu);
    expect(uit.overgeslagen).toEqual([]);
    expect(uit.meting.gekoppeld[0]).toMatchObject({ manier: 'cloud-reserve', adres: '192.168.1.63', ok: true, w: -800 });
    expect(controleerMeting({ net_w: 1, gekoppeld: [{ ...reserve, manier: 'bluetooth' }] }, nu).overgeslagen).toHaveLength(1);
  });

  it('niet meegestuurd: dan staan ze er niet, zodat Base44 de vorige houdt', () => {
    const uit = controleerMeting({ net_w: 100 }, nu);
    for (const veld of ['voorspelling', 'dag', 'gekoppeld', 'brug']) expect(uit.meting).not.toHaveProperty(veld);
  });

  it('een los blok dat niet klopt gaat eruit, met de reden; de stand van nu komt wel binnen', () => {
    const blok = (extra) => {
      const uit = controleerMeting({ net_w: 1, ...extra }, nu);
      if (!uit.ok || uit.meting.net_w !== 1) return 'afgekeurd';
      const [veld] = Object.keys(extra);
      return !(veld in uit.meting) && uit.overgeslagen.length === 1 && uit.overgeslagen[0].startsWith(`${veld}: `) ? 'weg' : 'erin';
    };
    expect(blok({ voorspelling: { ...voorspelling, stap_min: 60 } })).toBe('weg');
    expect(blok({ voorspelling: { ...voorspelling, teruglevering_kwh: [0.2] } })).toBe('weg');
    expect(blok({ voorspelling: { ...voorspelling, afname_kwh: kwartieren(201, () => 0.2), teruglevering_kwh: kwartieren(201, () => 0.2), zonnebonus_kwh: kwartieren(201, () => 0) } })).toBe('weg');
    expect(blok({ voorspelling: { ...voorspelling, afname_kwh: voorspelling.afname_kwh.map((v, i) => (i === 5 ? 25 : v)) } })).toBe('weg');
    expect(blok({ voorspelling: { ...voorspelling, zonnebonus_kwh: voorspelling.zonnebonus_kwh.map((v, i) => (i === 5 ? -0.1 : v)) } })).toBe('weg');
    expect(blok({ dag: { ...dag, procent: dag.procent.map((v, i) => (i === 3 ? 140 : v)) } })).toBe('weg');
    expect(blok({ dag: { ...dag, zon_w: [1, 2, 3] } })).toBe('weg');
    expect(blok({ dag: { ...dag, huis_w: dag.huis_w.map((v, i) => (i === 3 ? -5 : v)) } })).toBe('weg');
    expect(blok({ dag: { ...dag, kwh: undefined } })).toBe('weg');
    expect(blok({ dag: { ...dag, datum: 'gisteren' } })).toBe('weg');
    expect(blok({ gekoppeld: [{ ...gekoppeld[0], rol: 'baas' }] })).toBe('weg');
    expect(blok({ gekoppeld: [{ ...gekoppeld[0], merk: 'Acme' }] })).toBe('weg');
    expect(blok({ gekoppeld: [{ ...gekoppeld[0], adres: 'http://x/<script>' }] })).toBe('weg');
    expect(blok({ gekoppeld: [gekoppeld[0], gekoppeld[0]] })).toBe('weg');
    expect(blok({ gekoppeld: kwartieren(61, (i) => ({ ...gekoppeld[0], sleutel: `m${i}` })) })).toBe('weg');
    expect(blok({ brug: { ...brug, versie: '<b>' } })).toBe('weg');
    expect(blok({ brug: { ...brug, elke_seconden: 0 } })).toBe('weg');
    // 101 % in de dag: de dag gaat eruit, de rest niet.
    const uit = controleerMeting({ net_w: 5, batterij_procent: 101, dag: { ...dag, procent: dag.procent.map(() => 101) }, brug }, nu);
    expect(uit.ok).toBe(true);
    expect(uit.meting).toMatchObject({ net_w: 5, batterij_procent: 100, brug: expect.any(Object) });
    expect(uit.meting).not.toHaveProperty('dag');
    expect(uit.overgeslagen).toEqual(['dag: dag.procent[0] klopt niet']);
    expect(controleerMeting({ net_w: 5 }, nu).overgeslagen).toEqual([]);
  });

  it('lange namen worden ingekort', () => {
    const uit = controleerMeting({ gekoppeld: [{ ...gekoppeld[0], naam: 'x'.repeat(100), soort: 'y'.repeat(100) }] }, nu);
    expect(uit.meting.gekoppeld[0].naam).toHaveLength(40);
    expect(uit.meting.gekoppeld[0].soort).toHaveLength(40);
  });
});

describe('belasting per fase', () => {
  const kwartieren = (n, f) => Array.from({ length: n }, (_, i) => f(i));
  const dag = (extra) => ({
    datum: '2026-10-30',
    van: '2026-10-29T23:00:00.000Z',
    stap_min: 15,
    sinds: '2026-10-29T23:00:00.000Z',
    metingen: kwartieren(96, () => 180),
    huis_w: kwartieren(96, () => 450),
    kwh: { zon: 1, huis: 2, geladen: 0, ontladen: 0 },
    ...extra,
  });
  const faseDag = (fase, a) => ({ fase, a: kwartieren(96, () => a), w: kwartieren(96, () => 230 * a), gemiddeld_a: a, piek_a: a + 3 });

  it('nu, per kwartier en de week: drie fasen of één', () => {
    const uit = controleerMeting(
      {
        fasen: [
          { fase: 1, w: -1700, a: 7.4, v: 231.2 },
          { fase: 2, w: 412, a: 1.9, v: 229.8 },
          { fase: 3, w: 35, a: 0.3 },
        ],
        dag: dag({
          fasen: [faseDag(1, 6.2), faseDag(2, 9.1), faseDag(3, 2.4)],
          week: [{ datum: '2026-10-29', fasen: [{ fase: 1, gemiddeld_a: 5.1, piek_a: 22 }, { fase: 2, gemiddeld_a: 8.7, piek_a: 19.5 }, { fase: 3, gemiddeld_a: 2.2, piek_a: 9 }] }],
        }),
      },
      nu,
    );
    expect(uit.ok).toBe(true);
    expect(uit.meting.fasen[2]).toEqual({ fase: 3, w: 35, a: 0.3 });
    expect(uit.meting.dag.fasen[1]).toMatchObject({ fase: 2, gemiddeld_a: 9.1, piek_a: 12.1 });
    expect(uit.meting.dag.week[0].fasen).toHaveLength(3);
    expect(controleerMeting({ fasen: [{ fase: 1, w: 300, a: 1.3, v: 230 }] }, nu).ok).toBe(true);
    // Zonder fasen (de P1-meter antwoordt even niet) leeg, niet de fasen van een tijd terug.
    expect(controleerMeting({ net_w: null }, nu).meting.fasen).toBeNull();
  });

  it('weigert vreemde fasen, dubbele fasen, te veel en onzin', () => {
    const fout = (extra) => controleerMeting({ net_w: 1, ...extra }, nu).ok;
    expect(fout({ fasen: [{ fase: 4, a: 1 }] })).toBe(false);
    expect(fout({ fasen: [{ fase: 1, a: 1 }, { fase: 1, a: 2 }] })).toBe(false);
    expect(fout({ fasen: [{ fase: 1, a: -1 }] })).toBe(false);
    expect(fout({ fasen: [{ fase: 1, a: 2000 }] })).toBe(false);
    expect(fout({ fasen: [] })).toBe(false);
    // In de dag gaat alleen de dag eruit (zie hierboven: losse blokken).
    const zonderDag = (extra) => controleerMeting({ net_w: 1, ...extra }, nu);
    expect(zonderDag({ dag: dag({ fasen: [{ ...faseDag(1, 5), a: [1, 2] }] }) }).meting).not.toHaveProperty('dag');
    expect(zonderDag({ dag: dag({ week: Array.from({ length: 8 }, () => ({ datum: '2026-10-29', fasen: [{ fase: 1, gemiddeld_a: 1, piek_a: 2 }] })) }) }).overgeslagen).toEqual(['dag: dag.week klopt niet']);
  });

  it('alles samen, met drie fasen per kwartier en een week, past ruim onder 20.000 tekens', () => {
    const ruw = {
      net_w: -1929,
      fasen: [{ fase: 1, w: -1700, a: 7.4, v: 231.2 }, { fase: 2, w: 412, a: 1.9, v: 229.8 }, { fase: 3, w: 35, a: 0.3, v: 230.4 }],
      voorspelling: {
        van: '2026-10-29T23:00:00.000Z',
        stap_min: 15,
        afname_kwh: kwartieren(192, (i) => 0.2123 + (i % 9) * 0.0123),
        teruglevering_kwh: kwartieren(192, (i) => 0.2234 + (i % 9) * 0.0123),
        zonnebonus_kwh: kwartieren(192, (i) => (i > 30 && i < 70 ? 0.0234 : 0)),
        schatting: false,
        bron: 'Zonneplan',
      },
      dag: dag({
        zon_w: kwartieren(96, (i) => 1000 + i * 13),
        batterij_w: kwartieren(96, (i) => (i % 2 ? -1712 : 1698)),
        net_w: kwartieren(96, (i) => (i % 3 ? -1929 : 2311)),
        procent: kwartieren(96, (i) => i % 100),
        fasen: [faseDag(1, 12.3), faseDag(2, 10.7), faseDag(3, 3.1)],
        week: Array.from({ length: 7 }, (_, d) => ({ datum: `2026-10-2${d}`, fasen: [{ fase: 1, gemiddeld_a: 5.12, piek_a: 22.1 }, { fase: 2, gemiddeld_a: 8.73, piek_a: 19.5 }, { fase: 3, gemiddeld_a: 2.21, piek_a: 9.4 }] })),
      }),
      gekoppeld: Array.from({ length: 5 }, (_, i) => ({ sleutel: `m${i}`, naam: 'Meterkast', merk: 'HomeWizard', soort: 'P1-meter', rol: 'net', manier: 'v1', adres: '192.168.1.64', ok: true, sinds: null, w: -1929 })),
      brug: { versie: '0.4.0', gestart: '2026-10-30T06:44:10.000Z', elke_seconden: 5, prijzen: 'Zonneplan' },
      omvormer: {
        stand: 'storing',
        bij: 'hw-zon-huis',
        w: 7999,
        rijen: [{ v: 612.3, a: 11.2 }, { v: 598.1, a: 10.9 }],
        fasen: [{ v: 231.2, a: 11.6 }, { v: 229.8, a: 11.5 }, { v: 230.4, a: 11.6 }],
        hz: 49.98,
        temp_c: 51.3,
        vandaag_kwh: 41.7,
        totaal_kwh: 13350.2,
        storingen: [9, 13, 17, 18],
        waarschuwing: 12,
        beperkt: [0, 1],
      },
    };
    expect(controleerMeting(ruw, nu).ok).toBe(true);
    expect(controleerMeting(ruw, nu).meting.omvormer.storingen).toEqual([9, 13, 17, 18]);
    expect(JSON.stringify(ruw).length).toBeLessThan(16_000);
  });
});

describe('meer over de batterij (batterij_info, programmaatje 0.5.0)', () => {
  const info = {
    temp_c: 25.5,
    temp_min_c: 23,
    behuizing_c: 40,
    spanning_v: 52.4,
    stroom_a: 42.2,
    laadgrens_pct: 100,
    ontlaadgrens_pct: 10,
    pakketten: 2,
    inhoud_kwh: 5.76,
    vol_over_min: 92,
    verwarmt: false,
    kalibreert: false,
    wifi_dbm: -58,
    storing: false,
  };

  it('neemt het over zoals het programmaatje het stuurt', () => {
    expect(controleerMeting({ batterij_w: -2300, batterij_info: info }, nu).meting.batterij_info).toEqual(info);
    expect(controleerMeting({ batterij_info: { storing: true, storing_niveau: 2, leeg_over_min: 490, gezondheid_pct: 99.6 } }, nu).meting.batterij_info).toEqual({
      storing: true,
      storing_niveau: 2,
      leeg_over_min: 490,
      gezondheid_pct: 99.6,
    });
  });

  it('een oudere versie stuurt het niet: dan leeg, net als batterij_w nooit van een tijd terug', () => {
    expect(controleerMeting({ batterij_w: 300 }, nu).meting.batterij_info).toBeNull();
    expect(controleerMeting({ batterij_info: null }, nu).meting.batterij_info).toBeNull();
  });

  it('alleen bekende velden, echte getallen binnen de grenzen en echte ja/nee; de rest van de meting gaat gewoon door', () => {
    const uit = controleerMeting(
      {
        net_w: 120,
        batterij_info: {
          ...info,
          temp_c: 400,
          spanning_v: '52,4',
          stroom_a: Number.NaN,
          wifi_dbm: 12,
          verwarmt: 'ja',
          storing: 1,
          sn: 'FO4NXXXXXXXXXXX',
          serienummer: 'HOA1',
          foutcode: '<script>',
          vol_over_min: 50_000,
          gezondheid_pct: 140,
          spanning_extra: { diep: true },
        },
      },
      nu,
    );
    expect(uit.ok).toBe(true);
    expect(uit.meting.net_w).toBe(120);
    expect(uit.meting.batterij_info).toEqual({
      temp_min_c: 23,
      behuizing_c: 40,
      laadgrens_pct: 100,
      ontlaadgrens_pct: 10,
      pakketten: 2,
      inhoud_kwh: 5.76,
      kalibreert: false,
    });
  });

  it('netjes afgerond; geen object, of niets bruikbaars: null', () => {
    expect(controleerMeting({ batterij_info: { temp_c: 25.4567, spanning_v: 52.3612, inhoud_kwh: 5.7612, leeg_over_min: 490.4, wifi_dbm: -57.6 } }, nu).meting.batterij_info).toEqual({
      temp_c: 25.5,
      spanning_v: 52.4,
      inhoud_kwh: 5.76,
      leeg_over_min: 490,
      wifi_dbm: -58,
    });
    for (const rommel of ['heet', 42, [info], { onbekend: 1 }, {}]) {
      const uit = controleerMeting({ net_w: 1, batterij_info: rommel }, nu);
      expect(uit.ok, JSON.stringify(rommel)).toBe(true);
      expect(uit.meting.batterij_info).toBeNull();
    }
  });

  it('per accu (programmaatje 0.7.0): nummer, temperatuur en procent; mild, hooguit acht', () => {
    const accus = [
      { nr: 1, temp_c: 23.04, procent: 41 },
      { nr: 2, temp_c: 25.5 },
      { nr: 3, procent: 39.6 },
    ];
    expect(controleerMeting({ batterij_info: { temp_c: 25.5, accus } }, nu).meting.batterij_info).toEqual({
      temp_c: 25.5,
      accus: [{ nr: 1, temp_c: 23, procent: 41 }, { nr: 2, temp_c: 25.5 }, { nr: 3, procent: 40 }],
    });
    // Wat niet klopt valt weg, de rest blijft; een dubbel nummer telt één keer.
    const rommel = [{ nr: 0, temp_c: 20 }, { nr: 1.5, temp_c: 20 }, { nr: 2, temp_c: 500 }, { nr: 3, temp_c: 21, sn: 'FO4N' }, { nr: 3, temp_c: 22 }, 'accu', null];
    expect(controleerMeting({ batterij_info: { accus: rommel } }, nu).meting.batterij_info).toEqual({ accus: [{ nr: 3, temp_c: 21 }] });
    expect(controleerMeting({ batterij_info: { accus: 'drie' } }, nu).meting.batterij_info).toBeNull();
    // Sinds 1.4.0 hooguit 18 (drie SolarFlow 2400 AC's met elk 6 accu's).
    const veel = Array.from({ length: 24 }, (_, i) => ({ nr: i + 1, temp_c: 20 }));
    expect(controleerMeting({ batterij_info: { accus: veel } }, nu).meting.batterij_info.accus).toHaveLength(18);
  });

  it('op zijn grootst nog geen 600 tekens: de volle meting hierboven (onder 16.000) blijft ruim onder de 20.000', () => {
    const vol = Object.fromEntries(Object.keys(info).map((k) => [k, typeof info[k] === 'boolean' ? true : -123.45]));
    expect(JSON.stringify({ batterij_info: { ...vol, storing_niveau: 999, gezondheid_pct: 99.6 } }).length).toBeLessThan(600);
  });
});

describe('de omvormer (omvormer, programmaatje 0.6.0)', () => {
  const blok = {
    stand: 'normaal',
    bij: 'hw-zon-huis',
    w: 1835,
    rijen: [{ v: 320.8, a: 3.1 }, { v: 324.1, a: 3.2 }],
    fasen: [{ v: 225.6, a: 2.7 }, { v: 229.7, a: 2.6 }, { v: 231, a: 2.7 }],
    hz: 49.98,
    temp_c: 41.3,
    vandaag_kwh: 6,
    totaal_kwh: 13350.2,
  };

  it('neemt het over zoals het programmaatje het stuurt; slapen ook', () => {
    expect(controleerMeting({ zon_w: 1835, omvormer: blok }, nu).meting.omvormer).toEqual(blok);
    expect(controleerMeting({ omvormer: { stand: 'slaapt', vandaag_kwh: 23.4, totaal_kwh: 13372 } }, nu).meting.omvormer).toEqual({ stand: 'slaapt', vandaag_kwh: 23.4, totaal_kwh: 13372 });
    expect(controleerMeting({ omvormer: { stand: 'storing', storingen: [17, 9, 9], beperkt: [0] } }, nu).meting.omvormer).toEqual({ stand: 'storing', storingen: [9, 17], beperkt: [0] });
  });

  it('een oudere versie of geen omvormer: leeg', () => {
    expect(controleerMeting({ net_w: 1 }, nu).meting.omvormer).toBeNull();
    expect(controleerMeting({ omvormer: null }, nu).meting.omvormer).toBeNull();
  });

  it('mild: wat niet klopt valt weg, de meting gaat door', () => {
    const uit = controleerMeting(
      {
        net_w: 120,
        omvormer: {
          ...blok,
          w: -5,
          hz: 500,
          temp_c: '41',
          totaal_kwh: Number.NaN,
          rijen: [{ v: 320.8, a: 3.1 }, { v: 9999, a: 1 }],
          fasen: [{ v: 225.6, a: 'veel' }],
          storingen: [9, 40, -1, 'x'],
          beperkt: 'te warm',
          bij: 'zon huis!',
          serienummer: '5010KDTA000X',
          type: 'GW8K-DT',
        },
      },
      nu,
    );
    expect(uit.ok).toBe(true);
    expect(uit.meting.net_w).toBe(120);
    expect(uit.meting.omvormer).toEqual({ stand: 'normaal', vandaag_kwh: 6, fasen: [{ v: 225.6 }], storingen: [9] });
    for (const rommel of ['aan', 42, [blok], { w: 100 }, { stand: 'kapot' }]) {
      const r = controleerMeting({ net_w: 1, omvormer: rommel }, nu);
      expect(r.ok, JSON.stringify(rommel)).toBe(true);
      expect(r.meting.omvormer).toBeNull();
    }
    expect(controleerMeting({ omvormer: { ...blok, rijen: Array.from({ length: 5 }, () => ({ v: 1, a: 1 })) } }, nu).meting.omvormer).not.toHaveProperty('rijen');
  });

  it('op zijn grootst nog geen 600 tekens', () => {
    const vol = { ...blok, stand: 'controle', bij: 'x'.repeat(60), rijen: Array.from({ length: 4 }, () => ({ v: 1234.5, a: 99.9 })), totaal_kwh: 99_999_999.9, waarschuwing: 65_535, storingen: Array.from({ length: 32 }, (_, i) => i), beperkt: Array.from({ length: 11 }, (_, i) => i) };
    const uit = controleerMeting({ omvormer: vol }, nu).meting.omvormer;
    expect(JSON.stringify(uit).length).toBeLessThan(600);
  });

  it('bij gekoppeld mag de GoodWe als omvormer', () => {
    const goodwe = { sleutel: 'goodwe', naam: 'Omvormer', merk: 'GoodWe', soort: 'GW8K-DT', rol: 'omvormer', manier: 'lokaal', adres: '192.168.1.40', ok: true, sinds: null, w: 1835 };
    const uit = controleerMeting({ gekoppeld: [goodwe] }, nu);
    expect(uit.overgeslagen).toEqual([]);
    expect(uit.meting.gekoppeld[0]).toMatchObject({ merk: 'GoodWe', rol: 'omvormer', manier: 'lokaal', w: 1835 });
  });
});

describe('meldingen van het programmaatje en tekst zonder rare tekens', () => {
  const nu = new Date('2026-10-30T12:00:00Z');
  const brug = { versie: '0.5.2+abc1234', gestart: '2026-10-30T06:44:10.000Z', elke_seconden: 5 };

  it('meldingen gaan mee in brug; een melding die niet klopt valt weg, de rest blijft', () => {
    const meldingen = [
      { soort: 'prijzen', tekst: 'Zonneplan: opnieuw inloggen nodig: node brug.mjs zonneplan-login.', sinds: '2026-10-29T07:12:00.000Z' },
      { soort: 'apparaat', tekst: 'Meterkast: geen antwoord' },
      { soort: 'BAAS', tekst: 'mag niet' },
      { soort: 'opslag', tekst: '   ' },
      { soort: 'opslag', tekst: 'x'.repeat(300), sinds: 'gisteren' },
      'kapot',
    ];
    const uit = controleerMeting({ net_w: 1, brug: { ...brug, meldingen } }, nu);
    expect(uit.meting.brug.versie).toBe('0.5.2+abc1234');
    expect(uit.meting.brug.meldingen).toEqual([
      meldingen[0],
      { soort: 'apparaat', tekst: 'Meterkast: geen antwoord' },
      { soort: 'opslag', tekst: 'x'.repeat(160) },
    ]);
    expect(controleerMeting({ net_w: 1, brug: { ...brug, meldingen: [] } }, nu).meting.brug.meldingen).toEqual([]);
    expect(controleerMeting({ net_w: 1, brug }, nu).meting.brug).not.toHaveProperty('meldingen');
  });

  it('stuurtekens, onzichtbare tekens en omkeertekens gaan eruit, ook in namen en bronnen', () => {
    const raar = 'Zon\u202e dak\u0007\u200b\nnoord\u2066';
    const uit = controleerMeting(
      {
        net_w: 1,
        bron: 'brug\u0000 0.5.2',
        zonnen: [{ sleutel: 'zon', naam: raar, vermogen_w: 10 }].map((z) => ({ ...z, sleutel: 'dak' })),
        brug: { ...brug, prijzen: 'Zonneplan\u202d', meldingen: [{ soort: 'apparaat', tekst: 'Meter\u001b[31m: weg' }] },
      },
      nu,
    );
    expect(uit.meting.bron).toBe('brug 0.5.2');
    expect(uit.meting.zonnen[0].naam).toBe('Zon dak noord');
    expect(uit.meting.brug.prijzen).toBe('Zonneplan');
    expect(uit.meting.brug.meldingen[0].tekst).toBe('Meter[31m: weg');
  });
});
