import { describe, expect, it } from 'vitest';
import { isNacht, zonOpEnOnder, zonVoorApp } from './zon.mjs';

describe('isNacht', () => {
  it("om twee uur 's nachts wel, om twaalf uur 's middags niet, met een half uur marge", () => {
    expect(isNacht(Date.UTC(2026, 9, 30, 1, 0), '2026-10-30')).toBe(true);
    expect(isNacht(Date.UTC(2026, 9, 30, 11, 0), '2026-10-30')).toBe(false);
    // Zonsondergang in De Bilt eind oktober rond 16:25 UTC: tot 16:50 nog geen nacht.
    expect(isNacht(Date.UTC(2026, 9, 30, 16, 30), '2026-10-30')).toBe(false);
    expect(isNacht(Date.UTC(2026, 9, 30, 17, 30), '2026-10-30')).toBe(true);
  });
});

describe('zon op en onder voor de app (brug.zon, 0.7.0)', () => {
  it('van vandaag, als ISO-tijden op de seconde; met de plaats uit de instellingen', () => {
    const uit = zonVoorApp('2026-10-30');
    const { op, onder } = zonOpEnOnder('2026-10-30');
    expect(Math.abs(Date.parse(uit.op) - op)).toBeLessThanOrEqual(500);
    expect(Math.abs(Date.parse(uit.onder) - onder)).toBeLessThanOrEqual(500);
    // Eind oktober in De Bilt: rond 07:25 op en 17:20 onder (Nederlandse wintertijd = UTC+1).
    expect(uit.op).toMatch(/^2026-10-30T06:[0-5]\d:\d{2}\.000Z$/);
    expect(uit.onder).toMatch(/^2026-10-30T16:[0-5]\d:\d{2}\.000Z$/);
    // Verder naar het noorden: in de winter later op en eerder onder.
    const noord = zonVoorApp('2026-12-21', { breedte: 60, lengte: 5.18 });
    const hier = zonVoorApp('2026-12-21');
    expect(noord.op > hier.op && noord.onder < hier.onder).toBe(true);
  });
});
