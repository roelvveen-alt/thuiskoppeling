import { describe, expect, it } from 'vitest';
import { dagOverzicht, delenVan } from './dagoverzicht';
import { voorbeeldDag } from './voorbeeld';

const NACHT = Date.UTC(2026, 9, 29, 23);
const KWARTIER = 15 * 60_000;

describe('dagoverzicht', () => {
  it('eigen verbruik en zelfvoorzienend uit de kwartieren', () => {
    const o = dagOverzicht(voorbeeldDag(16, NACHT));
    expect(o.eigenVerbruik).toBeGreaterThan(0.5);
    expect(o.eigenVerbruik).toBeLessThanOrEqual(1);
    expect(o.zelfvoorzienend).toBeGreaterThan(0);
    expect(o.zelfvoorzienend).toBeLessThan(1);
    expect(o.vanaf).toBeNull();
    expect(o.laatste).toBe(64);
  });

  it('een dag die later begon zegt vanaf wanneer; zonder zon geen eigen verbruik', () => {
    const dag = {
      van: NACHT,
      stapMs: KWARTIER,
      sinds: NACHT + 33 * KWARTIER,
      metingen: [...Array(33).fill(0), 180, 180],
      zon: [...Array(33).fill(null), 0, 0],
      huis: [...Array(33).fill(null), 400, 500],
      batterij: null,
      net: [...Array(33).fill(null), 400, 500],
      procent: null,
    };
    const o = dagOverzicht(dag);
    expect(o.vanaf).toBe(NACHT + 33 * KWARTIER);
    expect(o.eigenVerbruik).toBeNull();
    expect(o.zelfvoorzienend).toBeCloseTo(0);
    expect(dagOverzicht(null)).toBeNull();
  });
});

describe('delenVan: zelfvoorzienend en eigen verbruik uit de kWh op het scherm', () => {
  it('Dirk om 10:15: bijna alles uit het net is geen 83% zelfvoorzienend', () => {
    const d = delenVan({ zon: 3.4, huis: 6.4, afname: 6.3, terug: 3.5 });
    expect(Math.round(d.zelfvoorzienend * 100)).toBe(2);
    // Meer terug dan de zon gaf (de batterij leverde ook terug): 0%, niet 81%.
    expect(d.eigenVerbruik).toBe(0);
  });
  it('een zonnige dag', () => {
    expect(delenVan({ zon: 20, huis: 10, afname: 2, terug: 12 })).toEqual({ zelfvoorzienend: 0.8, eigenVerbruik: 0.4 });
  });
  it('te weinig, of een getal dat ontbreekt: null', () => {
    expect(delenVan({ zon: 0.01, huis: 0.02, afname: 0, terug: 0 })).toEqual({ zelfvoorzienend: null, eigenVerbruik: null });
    expect(delenVan({ zon: 5, huis: 5 })).toEqual({ zelfvoorzienend: null, eigenVerbruik: null });
    expect(delenVan()).toEqual({ zelfvoorzienend: null, eigenVerbruik: null });
  });
});
