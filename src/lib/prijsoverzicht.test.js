import { describe, expect, it } from 'vitest';
import { voorbeeldVoorspelling } from './voorbeeld';
import { besteBlok, blokken, datumVan, prijsOverzicht } from './prijsoverzicht';

const NACHT = Date.UTC(2026, 9, 29, 23); // vrijdag 30 oktober, 00:00 in Nederland
const KWARTIER = 15 * 60_000;

describe('prijsoverzicht', () => {
  const v = voorbeeldVoorspelling(NACHT);

  it('vandaag en morgen, met de prijs van nu', () => {
    const nu = NACHT + 10.3 * 3_600_000; // 10:18
    const o = prijsOverzicht(v, nu);
    expect(o.dagen.map((d) => d.naam)).toEqual(['vandaag', 'morgen']);
    expect(o.morgen).toBe(true);
    expect(o.nu.van).toBe(NACHT + 41 * KWARTIER);
    expect(o.dagen[0].laagste.afname).toBeLessThanOrEqual(o.dagen[0].gemiddeld);
  });

  it('beste twee uur om te laden en terug te leveren, nooit in het verleden', () => {
    const nu = NACHT + 10.3 * 3_600_000;
    const o = prijsOverzicht(v, nu);
    expect(o.laden.tot - o.laden.van).toBe(2 * 3_600_000);
    expect(o.laden.tot).toBeGreaterThan(nu);
    expect(o.terugleveren.gemiddeld).toBeGreaterThan(o.laden.gemiddeld);
    // Morgen rond één uur zakt de prijs onder nul (zie MARKT_MORGEN in het voorbeeld).
    expect(o.negatief.length).toBeGreaterThan(0);
    expect(datumVan(o.negatief[0].van)).toBe('2026-10-31');
    expect(o.negatief[0].laagste).toBeLessThan(0);
    // Zonnebonus alleen overdag.
    expect(o.bonus.length).toBe(1);
  });

  it('zonder morgen, en een oude voorspelling tonen we niet', () => {
    const alleenVandaag = { ...v, afname: v.afname.slice(0, 96), terug: v.terug.slice(0, 96), bonus: v.bonus.slice(0, 96) };
    expect(prijsOverzicht(alleenVandaag, NACHT + 9 * 3_600_000).morgen).toBe(false);
    expect(prijsOverzicht(alleenVandaag, NACHT + 30 * 3_600_000)).toBeNull();
    expect(prijsOverzicht(null, NACHT)).toBeNull();
  });

  it('besteBlok en blokken', () => {
    const k = [0.3, 0.1, 0.1, 0.4, -0.1, -0.2, 0.2].map((afname, i) => ({ i, van: i * KWARTIER, tot: (i + 1) * KWARTIER, afname, terug: afname, bonus: 0 }));
    expect(besteBlok(k, { veld: 'afname', lengte: 2, vanaf: 0 })).toMatchObject({ eerste: 4, laatste: 5 });
    expect(besteBlok(k, { veld: 'terug', hoogste: true, lengte: 2, vanaf: 0 })).toMatchObject({ eerste: 2, laatste: 3 });
    expect(blokken(k.filter((q) => q.afname < 0))).toEqual([{ van: 4 * KWARTIER, tot: 6 * KWARTIER, laagste: -0.2, eerste: 4 }]);
  });
});

describe('morgen op de datum, niet nu + 24 uur', () => {
  it('op de zaterdagavond voor de zomertijd is morgen zondag', () => {
    const zaterdag = Date.parse('2027-03-27T22:30:00Z'); // 23:30 in Nederland
    const van = Date.parse('2027-03-27T21:00:00Z'); // zaterdag 22:00
    const lengte = 12; // tot zondag 01:00 (zomertijd)
    const rij = Array.from({ length: lengte }, (_, i) => 0.2 + i / 100);
    const o = prijsOverzicht({ van, stapMs: KWARTIER, afname: rij, terug: rij, bonus: rij.map(() => 0) }, zaterdag);
    expect(o.dagen.map((d) => d.datum)).toEqual(['2027-03-27', '2027-03-28']);
    expect(o.morgen).toBe(true);
  });
});
