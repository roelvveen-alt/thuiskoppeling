import { describe, expect, it } from 'vitest';
import { asRuimte, bandLabels, bandRijen, mooieAs, tabelPerUur, vrijeHoogte } from './Grafiek';

describe('de as', () => {
  it('ronde streepjes, met 0 erin', () => {
    expect(mooieAs(0, 2650)).toEqual({ min: 0, max: 3000, streepjes: [0, 1000, 2000, 3000] });
    expect(mooieAs(-2300, 1700).streepjes).toEqual([-3000, -2000, -1000, 0, 1000, 2000]);
    expect(mooieAs(0.05, 0.36)).toMatchObject({ min: 0, max: 0.4 });
    // Een reeks die precies op een streepje begint, krijgt er geen extra onder.
    expect(mooieAs(-0.2, 0.6).min).toBeCloseTo(-0.2);
  });
});

describe('de tabel per uur', () => {
  it('per uur het gemiddelde van de kwartieren die er zijn, per lijn een kolom', () => {
    const rijen = tabelPerUur(
      [
        { reeks: [1, 3, null, null, null, null, null, null, 8] },
        { reeks: [2, 2, 2, 2] },
      ],
      0,
      15 * 60_000,
    );
    expect(rijen).toEqual([
      { i: 0, ms: 0, v: [2, 2] },
      { i: 8, ms: 2 * 3_600_000, v: [8, null] },
    ]);
  });
});

describe('labels van banden', () => {
  it('die elkaar raken om en om een regel lager, de rest bovenaan', () => {
    const x = (i) => i * 4;
    const banden = [
      { eerste: 60, label: 'terug' },
      { eerste: 10, label: 'laden' },
      { eerste: 66, label: 'laden' },
      { eerste: 90, label: 'terug' },
    ];
    expect(bandRijen(banden, x)).toEqual([0, 0, 1, 0]);
  });
});

describe('labels van banden die niet passen', () => {
  const x = (i) => 46 + i * 3;
  it('alleen in het vlak als het past, anders alleen in de legenda', () => {
    const uit = bandLabels([{ eerste: 0, laatste: 1, label: 'laadde' }, { eerste: 10, laatste: 30, label: 'laden' }], x, 3);
    expect(uit[0]).toBeNull();
    expect(uit[1]).toEqual({ x: 46 + 30 + 3, rij: 0 });
  });
});

describe('weergave-20: een as met eenheid, en geen label over de lijn', () => {
  it('de ruimte links groeit mee met het langste label', () => {
    expect(asRuimte(['0', '10', '20'])).toBe(46);
    expect(asRuimte(['0 kWh', '12,5 kWh'])).toBeGreaterThanOrEqual(8 * 6 + 10);
    expect(asRuimte([])).toBe(46);
  });

  it('vrijeHoogte: de eerste plek die niets raakt, anders null', () => {
    // Label met basislijn b beslaat b-10 tot b+3.
    expect(vrijeHoogte([21, 130], [])).toBe(21);
    expect(vrijeHoogte([21, 130], [[15, 19]])).toBe(130);
    expect(vrijeHoogte([21, 130], [[15, 19], [125, 128]])).toBeNull();
    expect(vrijeHoogte([21, 130], [[30, 40]])).toBe(21);
  });
});
