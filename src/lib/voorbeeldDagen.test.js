import { describe, expect, it } from 'vitest';
import { dagenUit, totalenVan } from './periode';
import { voorbeeldDagen } from './voorbeeld';

describe('nepdagen voor het voorbeeld', () => {
  const jaar = voorbeeldDagen('2026-01-01', '2026-12-31', '2026-10-30');

  it('elke dag van de periode tot en met gisteren; vandaag komt uit de stand', () => {
    expect(jaar).toHaveLength(302);
    expect(jaar[0].datum).toBe('2026-01-01');
    expect(jaar.at(-1).datum).toBe('2026-10-29');
    expect(voorbeeldDagen('2026-10-30', '2026-11-01', '2026-10-30')).toEqual([]);
    expect(voorbeeldDagen('2026-10-26', '2026-11-01', '2026-10-30').map((d) => d.datum)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29']);
  });

  it('elke keer dezelfde, en de app leest ze zonder iets weg te laten', () => {
    expect(voorbeeldDagen('2026-03-01', '2026-03-31', '2026-10-30')).toEqual(voorbeeldDagen('2026-03-01', '2026-03-31', '2026-10-30'));
    const dagen = dagenUit(jaar);
    expect(dagen).toHaveLength(302);
    for (const d of dagen) {
      for (const veld of ['zon', 'huis', 'geladen', 'ontladen', 'afname', 'terug', 'kosten', 'opbrengst', 'vast', 'bonus', 'eigenVerbruik', 'zelfvoorzienend']) {
        expect(d[veld], `${d.datum} ${veld}`).not.toBeNull();
      }
      expect(d.fasen).toHaveLength(3);
    }
  });

  it('klopt als energie: wat erin gaat, gaat er ook uit', () => {
    for (const d of jaar) {
      const erin = d.zon_kwh + d.ontladen_kwh + d.afname_kwh;
      const eruit = d.huis_kwh + d.geladen_kwh + d.teruglevering_kwh;
      expect(Math.abs(erin - eruit), d.datum).toBeLessThan(0.01);
      expect(d.afname_kwh).toBeGreaterThanOrEqual(0);
      expect(d.teruglevering_kwh).toBeGreaterThanOrEqual(0);
    }
  });

  it('zomer veel zon, winter weinig; een jaar zoals bij 11 kWp', () => {
    const maand = (m) => totalenVan(dagenUit(jaar.filter((d) => d.datum.startsWith(`2026-${m}`)))).zon;
    expect(maand('06')).toBeGreaterThan(3 * maand('01'));
    const heel = totalenVan(dagenUit(voorbeeldDagen('2025-01-01', '2025-12-31', '2026-10-30')));
    expect(heel.zon).toBeGreaterThan(8000);
    expect(heel.zon).toBeLessThan(11000);
    // Zomer verdien je (saldering), winter betaal je.
    expect(totalenVan(dagenUit(jaar.filter((d) => d.datum.startsWith('2026-06')))).netto).toBeLessThan(0);
    expect(totalenVan(dagenUit(jaar.filter((d) => d.datum.startsWith('2026-01')))).netto).toBeGreaterThan(0);
  });

  it('de dagen waarop de klok verzet wordt', () => {
    expect(jaar.find((d) => d.datum === '2026-03-29').kwartieren).toBe(92);
    expect(jaar.find((d) => d.datum === '2026-10-25').kwartieren).toBe(100);
    expect(jaar.find((d) => d.datum === '2026-10-24').kwartieren).toBe(96);
  });
});
