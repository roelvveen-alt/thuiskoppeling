import { describe, expect, it } from 'vitest';
import { vanNu } from './vanNu';

// 31 oktober 2026, 09:00 in Nederland (wintertijd: UTC+1).
const NU = Date.parse('2026-10-31T08:00:00Z');
const KWARTIER = 15 * 60_000;
const voorspelling = {
  van: Date.parse('2026-10-30T23:00:00Z'), // middernacht in Nederland
  stapMs: KWARTIER,
  afname: Array.from({ length: 192 }, (_, i) => i / 100),
  terug: Array.from({ length: 192 }, (_, i) => i / 200),
  bonus: Array.from({ length: 192 }, () => 0),
  bron: 'energyzero',
};
const stand = (extra) => ({
  moment: '2026-10-30T21:00:00Z',
  vandaag: { datum: '2026-10-30', kosten_eur: 1.2 },
  dag: { datum: '2026-10-30', van: Date.parse('2026-10-29T23:00:00Z') },
  jaar: { jaar: 2026, teruglevering_kwh: 10, plafond_kwh: 7500 },
  prijs: { afname_kwh: 0.3, teruglevering_kwh: 0.1, zonnebonus_kwh: 0, van: '2026-10-30T21:00:00Z', tot: '2026-10-30T21:15:00Z', bron: 'x' },
  voorspelling,
  ...extra,
});

describe('vanNu: gisteren staat er niet als vandaag', () => {
  it('stand van vandaag en een prijs die nog geldt: hetzelfde object', () => {
    const s = stand({ vandaag: { datum: '2026-10-31' }, dag: { datum: '2026-10-31' }, prijs: { afname_kwh: 0.3, tot: '2026-10-31T08:15:00Z' } });
    expect(vanNu(s, NU)).toBe(s);
  });

  it('vandaag en dag van gisteren: weg (geen "Geld vandaag" van gisteren)', () => {
    const uit = vanNu(stand(), NU);
    expect(uit.vandaag).toBeNull();
    expect(uit.dag).toBeNull();
    expect(uit.moment).toBe('2026-10-30T21:00:00Z');
  });

  it('net na middernacht in Nederland is het al de nieuwe dag', () => {
    expect(vanNu(stand(), Date.parse('2026-10-30T23:30:00Z')).vandaag).toBeNull();
    expect(vanNu(stand(), Date.parse('2026-10-30T22:30:00Z')).vandaag).not.toBeNull();
  });

  it('een verlopen prijs: het kwartier van nu uit de voorspelling', () => {
    const uit = vanNu(stand(), NU);
    // 09:00 is het 36e kwartier na middernacht.
    expect(uit.prijs).toEqual({ afname_kwh: 0.36, teruglevering_kwh: 0.18, zonnebonus_kwh: 0, van: '2026-10-31T08:00:00.000Z', tot: '2026-10-31T08:15:00.000Z', bron: 'energyzero' });
  });

  it('een verlopen prijs zonder voorspelling voor nu: geen prijs', () => {
    expect(vanNu(stand({ voorspelling: null }), NU).prijs).toBeNull();
    expect(vanNu(stand(), Date.parse('2026-11-03T08:00:00Z')).prijs).toBeNull();
  });

  it('op 1 januari geen plafond van vorig jaar', () => {
    const s = stand({ jaar: { jaar: 2026, teruglevering_kwh: 7500, plafond_kwh: 7500 } });
    expect(vanNu(s, Date.parse('2027-01-01T08:00:00Z')).jaar).toBeNull();
    expect(vanNu(s, NU).jaar).toBe(s.jaar);
  });

  it('een oud programmaatje zonder datum of jaartal: alles blijft zoals vroeger', () => {
    const s = stand({ vandaag: { kosten_eur: 1 }, dag: { van: 0 }, jaar: { teruglevering_kwh: 1, plafond_kwh: 2 }, prijs: { afname_kwh: 0.3 } });
    expect(vanNu(s, NU)).toBe(s);
    expect(vanNu(null, NU)).toBeNull();
  });
});
