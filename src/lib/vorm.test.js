import { describe, expect, it } from 'vitest';
import { BEGINPLEKKEN } from './opstelling';
import { boog, boogLangs, dikteVoor, duurVoor, route, ROUTE_BOCHT_PX, STIP_AFSTAND, stipBanen, vrijeRuimte } from './vorm';

describe('boog', () => {
  it('begint en eindigt bij de rand van de rondjes', () => {
    expect(boog({ x: 0, y: 0 }, { x: 100, y: 0 })).toBe('M24 0 Q47 7.4 70 0');
  });

  it('terug buigt naar de andere kant', () => {
    expect(boog({ x: 100, y: 0 }, { x: 0, y: 0 })).toBe('M76 0 Q53 -7.4 30 0');
  });

  it('te dicht op elkaar: geen lijn', () => {
    expect(boog({ x: 0, y: 0 }, { x: 60, y: 0 })).toBeNull();
    expect(boog({ x: 5, y: 5 }, { x: 5, y: 5 })).toBeNull();
  });
});

describe('boogLangs: om de andere rondjes heen', () => {
  it('zonder iets in de weg de gewone boog', () => {
    expect(boogLangs({ x: 0, y: 0 }, { x: 100, y: 0 })).toBe(boog({ x: 0, y: 0 }, { x: 100, y: 0 }));
  });

  it('staat er een rondje aan de gewone kant, dan de andere kant', () => {
    const d = boogLangs({ x: 0, y: 0 }, { x: 200, y: 0 }, {}, [{ x: 100, y: 30, straal: 28 }]);
    expect(d).toBe(boog({ x: 0, y: 0 }, { x: 200, y: 0 }, { kant: -1 }));
  });

  // De foto is staand 4:5; op een telefoon 288–358 px breed, op een groot scherm 540.
  const plek = (p, w) => ({ x: (p.x / 100) * w, y: (p.y / 100) * w * 1.25 });
  for (const [tekening, plekken] of Object.entries(BEGINPLEKKEN)) {
    it(`huis ↔ net loopt niet door de batterij (${tekening}, beginplekken)`, () => {
      for (const w of [288, 328, 358, 398, 540]) {
        const maat = w < 440 ? 44 : 48;
        const batterij = { ...plek(plekken.batterij, w), straal: maat / 2 + 6 };
        const opties = { straalA: maat / 2, straalB: maat / 2 };
        for (const [a, b] of [[plekken.huis, plekken.net], [plekken.net, plekken.huis]]) {
          const d = boogLangs(plek(a, w), plek(b, w), opties, [batterij]);
          expect(vrijeRuimte(d, [batterij]), `${tekening} ${w}px`).toBeGreaterThan(0);
        }
      }
    });
  }
});

describe('route: langs vaste punten, zoals een kabel langs de gevel', () => {
  const a = { x: 300, y: 100 };
  const knik = { x: 100, y: 100 };
  const b = { x: 100, y: 300 };

  it('recht naar het knikpunt, een ronde hoek, recht naar b; begint en eindigt bij de rand van de rondjes', () => {
    expect(route(a, [knik], b)).toBe(`M276 100 L${100 + ROUTE_BOCHT_PX} 100 Q100 100 100 ${100 + ROUTE_BOCHT_PX} L100 270`);
    expect(route(a, [knik], b, { straalA: 22, straalB: 22 })).toBe('M278 100 L112 100 Q100 100 100 112 L100 272');
  });

  it('meer knikpunten: elke hoek rond', () => {
    const d = route({ x: 0, y: 0 }, [{ x: 100, y: 0 }, { x: 100, y: 100 }], { x: 200, y: 100 });
    expect(d.match(/Q/g)).toHaveLength(2);
    expect(d.startsWith('M24 0 L88 0 Q100 0 100 12 L100 88 Q100 100 112 100 L170 100')).toBe(true);
  });

  it('een korte hoek wordt hooguit half zo rond als de stukken ernaast lang zijn', () => {
    // Eerste stuk 20 px (van de rand op 10 tot de knik op 30): de hoek hooguit 10.
    expect(route({ x: 0, y: 0 }, [{ x: 30, y: 0 }], { x: 30, y: 40 }, { straalA: 10, straalB: 4 })).toBe('M10 0 L20 0 Q30 0 30 10 L30 30');
    expect(route({ x: 0, y: 0 }, [{ x: 26, y: 0 }], { x: 26, y: 40 }, { straalA: 10, straalB: 4 })).toBe('M10 0 L18 0 Q26 0 26 8 L26 30');
  });

  it('door een ander rondje, of geen ruimte voor het eerste of laatste stuk: null (dan een gewone boog)', () => {
    expect(route(a, [knik], b, {}, [{ x: 200, y: 100, straal: 28 }])).toBeNull();
    expect(route(a, [knik], b, {}, [{ x: 200, y: 160, straal: 28 }])).not.toBeNull();
    expect(route(a, [{ x: 290, y: 100 }], b)).toBeNull();
    expect(route(a, [{ x: 100, y: 280 }], b)).toBeNull();
    expect(route(a, [], b)).toBeNull();
    expect(route(a, null, b)).toBeNull();
  });

  it('vrijeRuimte ziet een rondje midden op een lang recht stuk', () => {
    const d = route({ x: 0, y: 0 }, [{ x: 600, y: 0 }], { x: 600, y: 200 });
    // Met 12 stappen op 576 px zou hij er tot 24 px naast kunnen kijken (en "vrij" zeggen).
    expect(vrijeRuimte(d, [{ x: 311, y: 0, straal: 20 }])).toBeLessThan(-16);
    expect(vrijeRuimte(d, [{ x: 311, y: 50, straal: 20 }])).toBeCloseTo(30, 0);
  });

  it('de stipjes volgen de route: elke 18 px, ook om de hoek, en lopen tot het eind', () => {
    const d = route(a, [knik], b);
    const banen = stipBanen(d);
    const begin = banen.map((baan) => baan[0]);
    expect(begin[0]).toEqual({ offset: 0, x: 276, y: 100, zicht: 1 });
    // Eerst over het rechte stuk naar links, dan de hoek om, dan omlaag.
    expect(begin.slice(0, 5).every((p) => p.y === 100)).toBe(true);
    expect(begin.slice(-3).every((p) => p.x === 100)).toBe(true);
    // Gelijkmatig langs de lijn: 18 px, om de hoek een iets kortere koorde.
    const tussen = begin.slice(1).map((p, i) => Math.hypot(p.x - begin[i].x, p.y - begin[i].y));
    for (const t of tussen) {
      expect(t).toBeGreaterThan(15.5);
      expect(t).toBeLessThan(18.2);
    }
    const laatste = banen.at(-1);
    expect(laatste.find((f) => f.zicht === 0)).toMatchObject({ x: 100, y: 270 });
    for (const baan of banen) expect(baan.every((f, i) => i === 0 || f.offset >= baan[i - 1].offset)).toBe(true);
  });
});

describe('snelheid en dikte', () => {
  it('meer vermogen loopt sneller, binnen grenzen', () => {
    expect(duurVoor(300)).toBe(1.6);
    expect(duurVoor(3000)).toBe(0.51);
    expect(duurVoor(0)).toBe(4);
    expect(duurVoor(100000)).toBe(0.35);
  });

  it('meer vermogen is een dikkere lijn, tot een maximum', () => {
    expect(dikteVoor(0)).toBe(1.5);
    expect(dikteVoor(2500)).toBe(5);
    expect(dikteVoor(10000)).toBe(5);
  });
});

describe('stipBanen: stipjes die op de grafische kaart lopen (prestaties-9)', () => {
  const d = 'M0 0 Q50 0 100 0';

  it('elke 18 px een stipje vanaf het begin, en elk schuift precies één afstand op', () => {
    const banen = stipBanen(d);
    expect(banen).toHaveLength(6); // 0, 18, 36, 54, 72, 90
    expect(banen.map((b) => b[0].x)).toEqual([0, 18, 36, 54, 72, 90]);
    for (const baan of banen.slice(0, 5)) {
      expect(baan.at(-1).x - baan[0].x).toBeCloseTo(STIP_AFSTAND, 0);
      expect(baan.every((f) => f.zicht === 1)).toBe(true);
    }
  });

  it('het einde van de ene ronde is het begin van de volgende: geen sprong', () => {
    const banen = stipBanen(d);
    for (let k = 0; k < 4; k++) expect(banen[k].at(-1).x).toBeCloseTo(banen[k + 1][0].x, 0);
  });

  it('het laatste stipje loopt tot het eind van het pad en is daarna weg', () => {
    const laatste = stipBanen(d).at(-1);
    const eind = laatste.find((f) => f.zicht === 0);
    expect(eind.x).toBe(100);
    expect(laatste.filter((f) => f.zicht === 1).at(-1)).toMatchObject({ x: 100, offset: expect.closeTo(10 / 18, 2) });
    expect(laatste.at(-1).offset).toBe(1);
    // Oplopende offsets: dat eist een animatie.
    expect(laatste.every((f, i) => i === 0 || f.offset >= laatste[i - 1].offset)).toBe(true);
  });

  it('volgt de bocht, en is gelijkmatig langs de lijn (niet langs t)', () => {
    const banen = stipBanen(boog({ x: 0, y: 0 }, { x: 200, y: 0 }));
    expect(banen.some((b) => b[0].y > 1)).toBe(true);
    const tussen = banen.slice(1).map((b, i) => Math.hypot(b[0].x - banen[i][0].x, b[0].y - banen[i][0].y));
    for (const t of tussen) expect(t).toBeGreaterThan(16.5);
  });

  it('niets bruikbaars: geen stipjes', () => {
    expect(stipBanen(null)).toEqual([]);
    expect(stipBanen('M0 0 Q0 0 0 0')).toEqual([]);
  });
});
