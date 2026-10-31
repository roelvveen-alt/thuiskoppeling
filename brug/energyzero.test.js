import { describe, expect, it, vi } from 'vitest';
import { bedragenOntbreken, bedragenVoor, energyZeroBron, tijdvakkenUitEnergyZero } from './energyzero.mjs';
import { waardeTeruglevering } from './prijzen.mjs';

const vak = (start, end, value) => ({ start, end, price: { value } });

describe('EnergyZero als schatting met de opbouw van Zonneplan', () => {
  it('kale marktprijs + inkoopvergoeding + energiebelasting, met btw; overdag de Zonnebonus', () => {
    // 12:00 Nederlandse tijd: dag. Markt € 0,07994 zonder btw.
    const [middag] = tijdvakkenUitEnergyZero({ base: [vak('2026-10-30T11:00:00Z', '2026-10-30T11:15:00Z', '0.07994')] });
    const zonder = 0.07994 * 1.21 + 0.02; // de inkoopvergoeding is € 0,02 met btw (contract Zonneplan)
    expect(middag.afname_kwh).toBeCloseTo(zonder + 0.1108481, 9);
    expect(middag.zonnebonus_kwh).toBeCloseTo(0.1 * zonder, 9);
    expect(middag.teruglevering_kwh).toBeCloseTo(middag.afname_kwh + 0.1 * zonder, 9);
  });

  it('contract Zonneplan: terugleveren = EPEX + € 0,02 (met btw); vanaf 2027 kost het pas geld als EPEX (met btw) onder −€ 0,02 komt', () => {
    expect(bedragenVoor(2026).inkoopvergoeding * 1.21).toBeCloseTo(0.02, 12);
    // EPEX met btw −1,999 ct: met de € 0,02 erbij nog net boven nul, dus geen (negatieve) Zonnebonus maar ook geen kosten.
    const markt = (ct) => String(ct / 100 / 1.21);
    const [net, onder] = tijdvakkenUitEnergyZero({
      base: [vak('2027-06-01T10:00:00Z', '2027-06-01T10:15:00Z', markt(-1.999)), vak('2027-06-01T10:15:00Z', '2027-06-01T10:30:00Z', markt(-2.001))],
    });
    expect(waardeTeruglevering(net)).toBeGreaterThan(0);
    expect(waardeTeruglevering(onder)).toBeLessThan(0);
    expect(onder.zonnebonus_kwh).toBe(0);
    expect(waardeTeruglevering(onder)).toBeCloseTo(-0.00001, 9);
  });

  it("'s nachts geen Zonnebonus; lege en kapotte regels vallen weg", () => {
    const vakken = tijdvakkenUitEnergyZero(
      {
        base: [
          vak('2026-10-30T01:00:00Z', '2026-10-30T01:15:00Z', '0.05'),
          vak('2026-10-30T01:15:00Z', '2026-10-30T01:30:00Z', ''),
          vak('kapot', '2026-10-30T01:45:00Z', '0.05'),
        ],
      },
    );
    expect(vakken).toHaveLength(1);
    expect(vakken[0].zonnebonus_kwh).toBe(0);
  });

  it('een raar antwoord is een fout', () => {
    expect(() => tijdvakkenUitEnergyZero({ error: 'x' })).toThrow('onverwacht antwoord');
  });
});

describe('bedragen per jaar', () => {
  it('een jaar dat er nog niet staat: het laatste ervoor, en een gewone zin', () => {
    expect(bedragenVoor(2026).energiebelasting).toBe(0.09161);
    expect(bedragenVoor(2027).jaar).toBe(2026);
    expect(bedragenOntbreken(Date.parse('2026-10-30T12:00:00Z'))).toBeNull();
    expect(bedragenOntbreken(Date.parse('2027-01-01T12:00:00Z'))).toMatch(/2027.*brug\/energyzero\.mjs.*2026/);
  });
});

describe('energyZeroBron vraagt vandaag en morgen op de datum', () => {
  it('op de zaterdagavond voor de zomertijd: zaterdag en zondag (niet maandag)', async () => {
    const gevraagd = [];
    const { default: https } = await import('node:https');
    const nep = vi.spyOn(https, 'request').mockImplementation((url) => {
      gevraagd.push(String(url));
      throw new Error('geen net in de test');
    });
    try {
      await energyZeroBron({ klok: () => Date.parse('2027-03-27T22:30:00Z') })
        .haal()
        .catch(() => null);
    } finally {
      nep.mockRestore();
    }
    expect(gevraagd.some((u) => u.includes('date=27-03-2027'))).toBe(true);
    expect(gevraagd.some((u) => u.includes('date=28-03-2027'))).toBe(true);
  });
});
