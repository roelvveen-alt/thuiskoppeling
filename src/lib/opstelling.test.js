import { describe, expect, it } from 'vitest';
import {
  zetBatterijRol,
  BEGINPLEKKEN,
  beginplekken,
  DIERENVERBLIJF_PLEK,
  KERN_PLEK,
  kiesTekening,
  LEGE_OPSTELLING,
  zetFase,
  naarRij,
  puntenVoor,
  TEKENINGEN,
  uitOpslag,
  verplaats,
  wisselZichtbaar,
  zetNaam,
  zetVermogen,
} from './opstelling';

const stand = {
  zon_w: 100,
  net_w: 50,
  batterij_w: 0,
  apparaten: [
    { sleutel: 'hw-1', naam: 'Wasmachine', soort: 'wasmachine', vermogen_w: 0 },
    { sleutel: 'hw-2', naam: '', vermogen_w: 0 },
  ],
};

describe('puntenVoor', () => {
  it('kern en apparaten, met beginplekken', () => {
    const punten = puntenVoor(LEGE_OPSTELLING, stand);
    expect(punten.map((p) => p.sleutel)).toEqual(['zon', 'huis', 'batterij', 'net', 'hw-1', 'hw-2']);
    expect(punten[0]).toMatchObject({ ...KERN_PLEK.zon, zichtbaar: true });
    expect(punten[4]).toMatchObject({ soort: 'apparaat', icoon: 'wasmachine' });
    expect(punten[5].naam).toBe('Apparaat');
  });

  it('panelen op twee plekken: twee zon-punten, op het huis en op het dierenverblijf', () => {
    const punten = puntenVoor(LEGE_OPSTELLING, {
      zon_w: 3800,
      zonnen: [
        { sleutel: 'hw-batterij-zon', naam: 'Zon huis', vermogen_w: 3000 },
        { sleutel: 'hw-dierenverblijf', naam: '', vermogen_w: 800 },
      ],
      net_w: 0,
    });
    expect(punten.map((p) => [p.sleutel, p.soort, p.naam])).toEqual([
      ['hw-batterij-zon', 'zon', 'Zon huis'],
      ['hw-dierenverblijf', 'zon', 'Zon'],
      ['huis', 'huis', 'Huis'],
      ['net', 'net', 'Net'],
    ]);
    expect(punten[0]).toMatchObject(KERN_PLEK.zon);
    expect(punten[1]).toMatchObject({ x: 69, y: 50 });
  });

  it('wat thuis niet bestaat krijgt geen punt; het huis altijd', () => {
    expect(puntenVoor(LEGE_OPSTELLING, { net_w: 10 }).map((p) => p.sleutel)).toEqual(['huis', 'net']);
    expect(puntenVoor(LEGE_OPSTELLING, null).map((p) => p.sleutel)).toEqual(['huis']);
  });

  it('eigen plek en verborgen', () => {
    let opstelling = verplaats(LEGE_OPSTELLING, 'zon', 20, 10);
    opstelling = wisselZichtbaar(opstelling, 'hw-2');
    const punten = puntenVoor(opstelling, stand);
    expect(punten.find((p) => p.sleutel === 'zon')).toMatchObject({ x: 20, y: 10 });
    expect(punten.find((p) => p.sleutel === 'hw-2').zichtbaar).toBe(false);
  });

  it('elf apparaten passen allemaal op de foto, bij elke tekening', () => {
    const veel = { apparaten: Array.from({ length: 11 }, (_, i) => ({ sleutel: `a${i}` })) };
    for (const { sleutel: tekening } of TEKENINGEN) {
      for (const p of puntenVoor({ ...LEGE_OPSTELLING, tekening }, veel)) {
        expect(p.x, tekening).toBeGreaterThanOrEqual(4);
        expect(p.x, tekening).toBeLessThanOrEqual(96);
        expect(p.y, tekening).toBeGreaterThanOrEqual(4);
        expect(p.y, tekening).toBeLessThanOrEqual(96);
      }
    }
  });
});

describe('aanpassen', () => {
  it('verplaatsen blijft binnen de foto en rondt af', () => {
    const o = verplaats(LEGE_OPSTELLING, 'net', 120.04, -3);
    expect(o.punten.net).toEqual({ x: 96, y: 4 });
    expect(verplaats(o, 'zon', 33.333, 66.666).punten.zon).toEqual({ x: 33.3, y: 66.7 });
  });

  it('zichtbaar wisselt heen en terug', () => {
    const verborgen = wisselZichtbaar(LEGE_OPSTELLING, 'net');
    expect(verborgen.verborgen).toEqual(['net']);
    expect(wisselZichtbaar(verborgen, 'net').verborgen).toEqual([]);
  });

  it('beginplekken laat zichtbaarheid staan', () => {
    const o = wisselZichtbaar(verplaats(LEGE_OPSTELLING, 'zon', 1, 1), 'net');
    expect(beginplekken(o)).toEqual({ tekening: 'dierenverblijf', punten: {}, verborgen: ['net'], namen: {}, vermogens: {}, faseGrens: null, zekering: null, batterijRol: 'eigen', gasStanden: [], zonFase: null });
  });

  it('LEGE_OPSTELLING blijft leeg', () => {
    verplaats(LEGE_OPSTELLING, 'zon', 1, 1);
    expect(LEGE_OPSTELLING).toEqual({ tekening: 'dierenverblijf', punten: {}, verborgen: [], namen: {}, vermogens: {}, faseGrens: null, zekering: null, batterijRol: 'eigen', gasStanden: [], zonFase: null });
  });
});

describe('tekening', () => {
  const tweeZonnen = { zonnen: [{ sleutel: 'z1', naam: 'Zon huis' }, { sleutel: 'z2', naam: 'Zon 2' }], zon_w: 10 };
  const tweedeZon = (tekening) => puntenVoor({ ...LEGE_OPSTELLING, tekening }, tweeZonnen).find((p) => p.sleutel === 'z2');

  it('vier keuzes; de eerste (met dierenverblijf) is de standaard', () => {
    expect(TEKENINGEN.map((t) => t.sleutel)).toEqual(['dierenverblijf', 'schuur', 'huis', 'garage']);
    expect(TEKENINGEN.find((t) => t.sleutel === 'garage').naam).toBe('Vrijstaand met garage en carport');
    expect(LEGE_OPSTELLING.tekening).toBe('dierenverblijf');
    // Zo neemt de server een tekening aan (base44/shared/huizen.js): een nieuwe keuze vraagt daar niets.
    for (const { sleutel } of TEKENINGEN) expect(sleutel).toMatch(/^[a-z]{1,30}$/);
    expect(Object.keys(BEGINPLEKKEN).sort()).toEqual(TEKENINGEN.map((t) => t.sleutel).sort());
  });

  it('bij Tims tekening blijven de rondjes waar ze altijd stonden', () => {
    expect(KERN_PLEK).toEqual({ zon: { x: 40, y: 38 }, huis: { x: 40, y: 62 }, batterij: { x: 64, y: 80 }, net: { x: 88, y: 86 } });
    expect(BEGINPLEKKEN.dierenverblijf.zon).toEqual([KERN_PLEK.zon, DIERENVERBLIJF_PLEK, { x: 16, y: 26 }, { x: 64, y: 22 }]);
  });

  it('de tweede zonnebron staat op het dierenverblijf, op de schuur, of (zonder bijgebouw met panelen) in de lucht', () => {
    expect(tweedeZon('dierenverblijf')).toMatchObject({ x: 69, y: 50 });
    expect(tweedeZon('schuur')).toMatchObject({ x: 84, y: 59 });
    expect(tweedeZon('huis')).toMatchObject({ x: 16, y: 26 });
    expect(tweedeZon('garage')).toMatchObject({ x: 16, y: 26 });
    expect(tweedeZon('onbekend')).toMatchObject({ x: 69, y: 50 });
  });

  describe('de kabel van het dierenverblijf loopt om het huis heen naar de meterkast (Tim, 31-10-2026)', () => {
    const route = { naar: 'huis', langs: [{ x: 49, y: 50 }] };

    it('op de beginplekken: het dierenverblijf heeft een route langs de goot naar het huis', () => {
      expect(DIERENVERBLIJF_PLEK).toEqual({ x: 69, y: 50, route });
      expect(tweedeZon('dierenverblijf')).toMatchObject({ x: 69, y: 50, route });
      // Langs de goot: de witte rand onder het dak (y 60,6–64 van 125 = 48,5–51,2%), van het dierenverblijf tot boven de meterkast.
      for (const p of [DIERENVERBLIJF_PLEK, ...route.langs]) {
        expect(p.y * 1.25).toBeGreaterThan(60.6);
        expect(p.y * 1.25).toBeLessThan(64);
      }
      expect(route.langs.at(-1).x).toBeGreaterThan(KERN_PLEK.huis.x);
      expect(route.langs.at(-1).x).toBeLessThan(DIERENVERBLIJF_PLEK.x);
    });

    it('andere tekeningen en de andere punten hebben geen route', () => {
      for (const tekening of ['schuur', 'huis']) {
        for (const p of puntenVoor({ ...LEGE_OPSTELLING, tekening }, { ...tweeZonnen, batterij_w: 0, net_w: 0 })) expect(p, `${tekening} ${p.sleutel}`).not.toHaveProperty('route');
      }
      // Bij Dirk (garage) heeft alleen de eerste zon (de panelen op de achterkant) een route, over het dak naar de meterkast.
      for (const p of puntenVoor({ ...LEGE_OPSTELLING, tekening: 'garage' }, { ...tweeZonnen, batterij_w: 0, net_w: 0 })) {
        if (p.sleutel !== 'z1') expect(p, `garage ${p.sleutel}`).not.toHaveProperty('route');
        else expect(p.route.naar).toBe('huis');
      }
      for (const p of puntenVoor(LEGE_OPSTELLING, { ...tweeZonnen, batterij_w: 0, net_w: 0 })) {
        if (p.sleutel !== 'z2') expect(p, p.sleutel).not.toHaveProperty('route');
      }
    });

    it('een opgeslagen plek blijft werken: wie het dierenverblijf of het huis verplaatst, krijgt de gewone lijn', () => {
      const verplaatst = puntenVoor(verplaats(LEGE_OPSTELLING, 'z2', 84, 57), tweeZonnen).find((p) => p.sleutel === 'z2');
      expect(verplaatst).toMatchObject({ x: 84, y: 57 });
      expect(verplaatst).not.toHaveProperty('route');
      const huisWeg = puntenVoor(verplaats(LEGE_OPSTELLING, 'huis', 30, 70), tweeZonnen);
      expect(huisWeg.find((p) => p.sleutel === 'huis')).toMatchObject({ x: 30, y: 70 });
      expect(huisWeg.find((p) => p.sleutel === 'z2')).toMatchObject({ x: 69, y: 50 });
      expect(huisWeg.find((p) => p.sleutel === 'z2')).not.toHaveProperty('route');
      // Een ander punt verplaatsen of verbergen laat de route staan (verborgen: dan is er toch geen lijn).
      expect(puntenVoor(verplaats(LEGE_OPSTELLING, 'z1', 30, 30), tweeZonnen).find((p) => p.sleutel === 'z2')).toMatchObject({ route });
      // Zo uit Base44 (lijst) en terug naar de beginplekken: weer de route.
      const opgeslagen = uitOpslag(naarRij(verplaats(LEGE_OPSTELLING, 'z2', 84, 57)));
      expect(puntenVoor(opgeslagen, tweeZonnen).find((p) => p.sleutel === 'z2')).not.toHaveProperty('route');
      expect(puntenVoor(beginplekken(opgeslagen), tweeZonnen).find((p) => p.sleutel === 'z2')).toMatchObject({ x: 69, y: 50, route });
    });

    it('de route komt niet in de opslag: alleen de plekken die de eigenaar zelf koos', () => {
      expect(naarRij(LEGE_OPSTELLING).punten).toEqual([]);
      expect(JSON.stringify(naarRij(verplaats(LEGE_OPSTELLING, 'z2', 84, 57)))).not.toContain('route');
    });
  });

  it('vrijstaand met garage: de zon boven het huis (de panelen liggen achter), het huis bij de voordeur, de batterij in de garage', () => {
    const punten = puntenVoor({ ...LEGE_OPSTELLING, tekening: 'garage' }, { zon_w: 900, batterij_w: -400, net_w: 20 });
    const op = (sleutel) => punten.find((p) => p.sleutel === sleutel);
    expect(op('zon')).toMatchObject({ x: 44, y: 13, route: { naar: 'huis', aanloop: { x: 63, y: 36 } } });
    expect(op('huis')).toMatchObject({ x: 52, y: 64 });
    expect(op('batterij')).toMatchObject({ x: 14, y: 77 });
    expect(op('net')).toMatchObject({ x: 88, y: 86 });
    // Een eigen plek blijft gewoon staan.
    const eigen = puntenVoor(verplaats({ ...LEGE_OPSTELLING, tekening: 'garage' }, 'batterij', 30, 80), { batterij_w: 0 });
    expect(eigen.find((p) => p.sleutel === 'batterij')).toMatchObject({ x: 30, y: 80 });
  });

  it('bij elke tekening liggen de vaste rondjes niet over elkaar, ook niet op de smalste telefoon', () => {
    // De foto is op 320 px zo'n 288 × 360 px; een rondje is daar 44 px.
    const afstand = (a, b) => Math.hypot(((a.x - b.x) / 100) * 288, ((a.y - b.y) / 100) * 360);
    for (const [tekening, plek] of Object.entries(BEGINPLEKKEN)) {
      const vast = [plek.zon[0], plek.zon[1], plek.huis, plek.batterij, plek.net];
      vast.forEach((a, i) =>
        vast.slice(i + 1).forEach((b) => expect(afstand(a, b), `${tekening}: ${JSON.stringify(a)} en ${JSON.stringify(b)}`).toBeGreaterThanOrEqual(44)),
      );
    }
  });

  it('een andere tekening: rondjes naar de beginplek, verborgen blijft verborgen', () => {
    const o = wisselZichtbaar(verplaats(LEGE_OPSTELLING, 'zon', 1, 1), 'net');
    expect(kiesTekening(o, 'huis')).toEqual({ tekening: 'huis', punten: {}, verborgen: ['net'], namen: {}, vermogens: {}, faseGrens: null, zekering: null, batterijRol: 'eigen', gasStanden: [], zonFase: null });
    expect(kiesTekening(o, 'dierenverblijf')).toBe(o);
    expect(kiesTekening(o, 'kasteel').tekening).toBe('dierenverblijf');
    expect(kiesTekening(o, 'garage')).toEqual({ tekening: 'garage', punten: {}, verborgen: ['net'], namen: {}, vermogens: {}, faseGrens: null, zekering: null, batterijRol: 'eigen', gasStanden: [], zonFase: null });
    expect(uitOpslag(naarRij(kiesTekening(o, 'garage'))).tekening).toBe('garage');
  });
});

describe('opslag', () => {
  it('rommel wordt de lege opstelling', () => {
    expect(uitOpslag(null)).toEqual(LEGE_OPSTELLING);
    expect(uitOpslag('kapot')).toEqual(LEGE_OPSTELLING);
    expect(
      uitOpslag({
        tekening: 'kasteel',
        punten: { zon: { x: 'a', y: 1 }, net: { x: 10, y: 20 } },
        verborgen: ['net', 3, ''],
        namen: [{ sleutel: 'net', naam: '  Meterkast ' }, { sleutel: 'zon', naam: '   ' }, { naam: 'zonder sleutel' }, null],
      }),
    ).toEqual({
      tekening: 'dierenverblijf',
      punten: { net: { x: 10, y: 20 } },
      verborgen: ['net'],
      namen: { net: 'Meterkast' },
      vermogens: {},
      faseGrens: null,
      zekering: null,
      batterijRol: 'eigen',
      gasStanden: [],
      zonFase: null,
    });
    expect(uitOpslag({ namen: 'kapot' }).namen).toEqual({});
    expect(uitOpslag({ namen: { huis: 'x'.repeat(50) } }).namen.huis).toHaveLength(40);
  });

  it('heen en terug via de vorm van Base44', () => {
    const o = wisselZichtbaar(verplaats(kiesTekening(LEGE_OPSTELLING, 'schuur'), 'zon', 25, 30), 'net');
    const rij = naarRij(o);
    expect(rij).toEqual({ tekening: 'schuur', punten: [{ sleutel: 'zon', x: 25, y: 30 }], verborgen: ['net'], namen: [], vermogens: [], fase_grens_a: null, zekering_a: null, batterij_rol: 'eigen', zon_fase: null });
    expect(uitOpslag(rij)).toEqual(o);

    const metNaam = zetNaam(o, 'net', 'Meterkast ');
    expect(naarRij(metNaam).namen).toEqual([{ sleutel: 'net', naam: 'Meterkast' }]);
    expect(uitOpslag(naarRij(metNaam)).namen).toEqual({ net: 'Meterkast' });
  });
});

describe('namen', () => {
  it('een eigen naam gaat voor de naam van thuis; leeg is weer die van thuis', () => {
    const metNamen = zetNaam(zetNaam(LEGE_OPSTELLING, 'hw-1', 'Wasmachine boven'), 'net', 'Meterkast');
    const punten = puntenVoor(metNamen, stand);
    expect(punten.find((p) => p.sleutel === 'hw-1')).toMatchObject({ naam: 'Wasmachine boven', bronNaam: 'Wasmachine', eigenNaam: 'Wasmachine boven' });
    expect(punten.find((p) => p.sleutel === 'net')).toMatchObject({ naam: 'Meterkast', bronNaam: 'Net' });
    expect(punten.find((p) => p.sleutel === 'huis')).toMatchObject({ naam: 'Huis', bronNaam: 'Huis', eigenNaam: '' });

    const leeg = zetNaam(metNamen, 'net', '');
    expect(leeg.namen).toEqual({ 'hw-1': 'Wasmachine boven' });
    expect(puntenVoor(leeg, stand).find((p) => p.sleutel === 'net').naam).toBe('Net');
  });

  it('tijdens het typen blijven spaties staan, maar de naam zelf is zonder; hooguit 40 tekens', () => {
    const typend = zetNaam(LEGE_OPSTELLING, 'zon', 'Zon ');
    expect(typend.namen.zon).toBe('Zon ');
    expect(puntenVoor(typend, stand).find((p) => p.sleutel === 'zon')).toMatchObject({ naam: 'Zon', eigenNaam: 'Zon ' });
    expect(zetNaam(LEGE_OPSTELLING, 'zon', '   ').namen).toEqual({});
    expect(zetNaam(LEGE_OPSTELLING, 'zon', 'x'.repeat(60)).namen.zon).toHaveLength(40);
    expect(LEGE_OPSTELLING.namen).toEqual({});
  });
});

describe('maximaal vermogen', () => {
  const zonEnBatterij = {
    zonnen: [
      { sleutel: 'hw-zon-batterij', naam: 'Hoofddak', vermogen_w: 976 },
      { sleutel: 'hw-zon-dierenverblijf', naam: 'Dierenverblijf', vermogen_w: 568 },
    ],
    batterij_w: 1700,
    net_w: -2800,
  };

  it('zon en batterij krijgen een maximum; de batterij standaard 2400 W, de zon pas als je het invult', () => {
    const punten = puntenVoor(zetVermogen(LEGE_OPSTELLING, 'hw-zon-batterij', 8000), zonEnBatterij);
    const op = (sleutel) => punten.find((p) => p.sleutel === sleutel);
    expect(op('hw-zon-batterij')).toMatchObject({ eigenMax: 8000, max_w: 8000 });
    expect(op('hw-zon-dierenverblijf')).toMatchObject({ eigenMax: null, max_w: null });
    expect(op('batterij')).toMatchObject({ eigenMax: null, max_w: 2400 });
    expect(op('huis')).not.toHaveProperty('max_w');
    expect(op('net')).not.toHaveProperty('max_w');
  });

  it('alleen een bruikbaar getal blijft staan; leeg haalt het weg', () => {
    const o = zetVermogen(zetVermogen(LEGE_OPSTELLING, 'batterij', 3600.4), 'hw-zon-dierenverblijf', 3000);
    expect(o.vermogens).toEqual({ batterij: 3600, 'hw-zon-dierenverblijf': 3000 });
    for (const fout of [80, 100_001, Number.NaN, '3000', null, undefined]) {
      expect(zetVermogen(o, 'batterij', fout).vermogens, String(fout)).toEqual({ 'hw-zon-dierenverblijf': 3000 });
    }
    expect(LEGE_OPSTELLING.vermogens).toEqual({});
  });

  it('heen en terug via Base44, en rommel valt weg', () => {
    const o = zetVermogen(zetVermogen(LEGE_OPSTELLING, 'hw-zon-batterij', 8000), 'batterij', 2400);
    const rij = naarRij(o);
    expect(rij.vermogens).toEqual([
      { sleutel: 'hw-zon-batterij', max_w: 8000 },
      { sleutel: 'batterij', max_w: 2400 },
    ]);
    expect(uitOpslag(rij).vermogens).toEqual(o.vermogens);
    const rommel = [{ sleutel: 'batterij', max_w: 50 }, { sleutel: '', max_w: 3000 }, { max_w: 3000 }, null, { sleutel: 'zon', max_w: 3000 }];
    expect(uitOpslag({ vermogens: rommel }).vermogens).toEqual({ zon: 3000 });
    expect(uitOpslag({ vermogens: 'kapot' }).vermogens).toEqual({});
    // Zoals dit toestel hem bewaart (een object), ook goed.
    expect(uitOpslag({ vermogens: { batterij: 2400 } }).vermogens).toEqual({ batterij: 2400 });
  });

  it('de rol van de batterij: heen en terug via Base44, rommel en leeg zijn eigen gebruik', () => {
    const o = zetBatterijRol(LEGE_OPSTELLING, 'handelen');
    expect(o.batterijRol).toBe('handelen');
    expect(naarRij(o).batterij_rol).toBe('handelen');
    expect(uitOpslag(naarRij(o)).batterijRol).toBe('handelen');
    for (const fout of ['zelf', null, undefined, 3]) expect(zetBatterijRol(o, fout).batterijRol, String(fout)).toBe('eigen');
    // Een rij van vóór de rol: eigen gebruik.
    expect(uitOpslag({ tekening: 'huis' }).batterijRol).toBe('eigen');
  });

  it('grens en zekering per fase: heen en terug via Base44, rommel en leeg zijn de standaard', () => {
    const o = zetFase(zetFase(LEGE_OPSTELLING, 'faseGrens', 21.04), 'zekering', 35);
    expect(o).toMatchObject({ faseGrens: 21, zekering: 35 });
    const rij = naarRij(o);
    expect(rij).toMatchObject({ fase_grens_a: 21, zekering_a: 35 });
    expect(uitOpslag(rij)).toMatchObject({ faseGrens: 21, zekering: 35 });
    for (const fout of [0, 201, '20', Number.NaN, null]) expect(zetFase(o, 'zekering', fout).zekering, String(fout)).toBeNull();
    expect(zetFase(o, 'onzin', 3)).toBe(o);
    expect(uitOpslag({ fase_grens_a: 'twintig', zekering_a: 500 })).toMatchObject({ faseGrens: null, zekering: null, batterijRol: 'eigen', gasStanden: [], zonFase: null });
    expect(LEGE_OPSTELLING.faseGrens).toBeNull();
  });
});

describe('de fase van de zonnemeter (1.5.0)', () => {
  it('1, 2 of 3; iets anders is niet bekend; heen en terug als zon_fase', async () => {
    const { zetZonFase } = await import('./opstelling');
    expect(zetZonFase(LEGE_OPSTELLING, 2).zonFase).toBe(2);
    expect(zetZonFase(LEGE_OPSTELLING, 4).zonFase).toBeNull();
    expect(naarRij(zetZonFase(LEGE_OPSTELLING, 3)).zon_fase).toBe(3);
    expect(uitOpslag({ zon_fase: 1 }).zonFase).toBe(1);
  });
});
