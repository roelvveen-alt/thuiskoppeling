import { describe, expect, it } from 'vitest';
import { gasPerDagUitStanden, gasReeks, gasStandenUit, gasVoorPeriode } from './gasStanden';

describe('gasmeterstanden (Instellingen › Gas, ronde 23)', () => {
  it('schoon en op datum; per datum de laatste; wat niet klopt valt weg', () => {
    expect(gasStandenUit([{ datum: '2026-10-31', stand: 2520 }, { datum: '2026-10-21', stand: 2500 }, { datum: '2026-02-30', stand: 1 }, { datum: '2026-10-22', stand: -1 }, null, 'x'])).toEqual([
      { datum: '2026-10-21', stand: 2500 },
      { datum: '2026-10-31', stand: 2520 },
    ]);
    expect(gasStandenUit('kapot')).toEqual([]);
  });

  it('het verschil eerlijk verdeeld over de dagen ertussen; een stand die terugloopt telt niet', () => {
    const perDag = gasPerDagUitStanden([
      { datum: '2026-10-21', stand: 2500 },
      { datum: '2026-10-26', stand: 2510 },
      { datum: '2026-10-28', stand: 2505 },
      { datum: '2026-10-31', stand: 2520 },
    ]);
    expect(perDag.get('2026-10-21')).toBe(2);
    expect(perDag.get('2026-10-25')).toBe(2);
    expect(perDag.has('2026-10-26')).toBe(false);
    expect(perDag.get('2026-10-28')).toBe(5);
    expect(perDag.has('2026-10-31')).toBe(false);
  });

  it('per periode: de slimme meter gaat voor, de standen vullen aan; zonder gas null', () => {
    const standen = [
      { datum: '2026-10-20', stand: 2500 },
      { datum: '2026-10-30', stand: 2520 },
    ];
    const week = { van: '2026-10-26', tot: '2026-11-01' };
    expect(gasVoorPeriode([], standen, week)).toMatchObject({ totaal: 8, bron: 'standen' });
    const metMeter = gasVoorPeriode([{ datum: '2026-10-27', gas: 0.5 }], standen, week);
    expect(metMeter.bron).toBe('beide');
    expect(metMeter.totaal).toBeCloseTo(6.5, 6);
    expect(gasVoorPeriode([{ datum: '2026-10-31', gas: 1.1 }], [], week)).toMatchObject({ totaal: 1.1, bron: 'meter' });
    expect(gasVoorPeriode([{ datum: '2026-10-31', gas: null }], [], week)).toBeNull();
    // Per staaf (hier per dag): de som, of null zonder gas.
    const staven = [
      { van: '2026-10-26', tot: '2026-10-26' },
      { van: '2026-10-31', tot: '2026-10-31' },
    ];
    expect(gasReeks(staven, gasVoorPeriode([], standen, week))).toEqual([2, null]);
  });
});
