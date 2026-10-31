import { describe, expect, it } from 'vitest';
import { NU_HOUDBAAR_MS, WMO, weerBeeld, weerIcoon, weerZin } from './weerBeeld';

const NU = Date.parse('2026-10-30T19:00:00Z');
/** Het weer zoals weerUit (src/lib/bron.js) het geeft, met alleen `nu`. */
const weer = (nu, opgehaald = NU - 10 * 60_000) => ({ van: NU - 20 * 3_600_000, stapMs: 3_600_000, straling: [0], bewolking: [0], temp: null, nu, opgehaald, bron: 'open-meteo' });
const beeld = (code, meer = {}) => weerBeeld(weer({ code, neerslag: null, wind: 10, stoten: 20, bewolking: null, ...meer }), NU);

describe('de WMO-weercode naar wat er getekend wordt', () => {
  it('helder tot bewolkt: van geen wolken tot een dichte lucht', () => {
    expect([0, 1, 2, 3].map((c) => beeld(c).wolken)).toEqual([0, 1, 2, 3]);
    expect(beeld(0)).toMatchObject({ tekst: 'onbewolkt', valt: null, onweer: false, mist: false, wind: null });
  });

  it('mist, motregen, regen, sneeuw, hagel en onweer', () => {
    expect(beeld(45)).toMatchObject({ mist: true, wolken: 3, valt: null });
    expect(beeld(48).tekst).toBe('mist met rijp');
    expect(beeld(51)).toMatchObject({ valt: 'motregen', zwaar: false });
    expect(beeld(55)).toMatchObject({ valt: 'motregen', zwaar: true });
    expect(beeld(61)).toMatchObject({ valt: 'regen', zwaar: false, wolken: 3 });
    expect(beeld(65)).toMatchObject({ valt: 'regen', zwaar: true });
    expect(beeld(66).tekst).toBe('lichte ijzel');
    expect(beeld(73)).toMatchObject({ valt: 'sneeuw' });
    expect(beeld(77)).toMatchObject({ valt: 'sneeuw', tekst: 'korrelsneeuw' });
    expect(beeld(80)).toMatchObject({ valt: 'regen', wolken: 2 });
    expect(beeld(82)).toMatchObject({ valt: 'regen', wolken: 3, zwaar: true });
    expect(beeld(86)).toMatchObject({ valt: 'sneeuw', zwaar: true });
    expect(beeld(95)).toMatchObject({ onweer: true, valt: 'regen' });
    expect(beeld(96)).toMatchObject({ onweer: true, valt: 'hagel', zwaar: false });
    expect(beeld(99)).toMatchObject({ onweer: true, valt: 'hagel', zwaar: true });
  });

  it('elke code die Open-Meteo kent, heeft woorden en een icoon', () => {
    for (const code of Object.keys(WMO).map(Number)) {
      const b = beeld(code);
      expect(b.tekst.length, String(code)).toBeGreaterThan(2);
      expect(weerIcoon(b, true)).toMatch(/^[A-Z]\w+$/);
    }
  });

  it('wind: vanaf 39 km/h of stoten vanaf 60 stevig, vanaf 62 of stoten vanaf 90 storm', () => {
    expect(beeld(2, { wind: 38, stoten: 59 }).wind).toBeNull();
    expect(beeld(2, { wind: 39, stoten: 45 }).wind).toBe('stevig');
    expect(beeld(2, { wind: 30, stoten: 60 }).wind).toBe('stevig');
    expect(beeld(2, { wind: 62, stoten: 70 }).wind).toBe('storm');
    expect(beeld(3, { wind: 50, stoten: 95 }).wind).toBe('storm');
    expect(weerZin(beeld(3, { wind: 70 }))).toBe('Weer nu: bewolkt, storm');
    expect(weerIcoon(beeld(2, { wind: 45 }), true)).toBe('Wind');
  });

  it('neerslag zonder regencode (een bui die net begint): regen of motregen; veel neerslag is zwaar', () => {
    expect(beeld(2, { neerslag: 0.2 })).toMatchObject({ valt: 'motregen', wolken: 2 });
    expect(beeld(1, { neerslag: 1.2 })).toMatchObject({ valt: 'regen', wolken: 2 });
    expect(beeld(63, { neerslag: 5 }).zwaar).toBe(true);
    expect(beeld(45, { neerslag: 0.3 }).valt).toBeNull();
  });

  it('zonder code de bewolking; zonder beide, zonder weer of te oud: null (de tekening zoals altijd)', () => {
    expect(weerBeeld(weer({ code: null, bewolking: 90 }), NU)).toMatchObject({ code: null, wolken: 3, tekst: 'bewolkt' });
    expect(weerBeeld(weer({ code: 42, bewolking: 10 }), NU)).toMatchObject({ code: null, wolken: 0 });
    expect(weerBeeld(weer({ code: null, bewolking: null }), NU)).toBeNull();
    expect(weerBeeld(weer(null), NU)).toBeNull();
    expect(weerBeeld(null, NU)).toBeNull();
    expect(weerBeeld(weer({ code: 61 }, NU - NU_HOUDBAAR_MS - 1), NU)).toBeNull();
    expect(weerBeeld(weer({ code: 61 }, null), NU)).toBeNull();
  });

  it('het icoon bij een eigen foto, dag en nacht', () => {
    expect(weerIcoon(beeld(0), true)).toBe('Sun');
    expect(weerIcoon(beeld(0), false)).toBe('Moon');
    expect(weerIcoon(beeld(2), false)).toBe('CloudMoon');
    expect(weerIcoon(beeld(3), true)).toBe('Cloudy');
    expect(weerIcoon(beeld(45), true)).toBe('CloudFog');
    expect(weerIcoon(beeld(53), true)).toBe('CloudDrizzle');
    expect(weerIcoon(beeld(63), true)).toBe('CloudRain');
    expect(weerIcoon(beeld(80), true)).toBe('CloudSunRain');
    expect(weerIcoon(beeld(75), true)).toBe('CloudSnow');
    expect(weerIcoon(beeld(96), true)).toBe('CloudLightning');
    expect(weerIcoon(null, true)).toBeNull();
  });
});
