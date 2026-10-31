import { describe, expect, it } from 'vitest';
import { apparatenStand, apparatenUit, apparatenVan, BASIS, reeksVan, REST, vorigeVan } from './apparatenOverzicht';
import { dagUit } from './bron';
import { dagenUit, metVandaag, periodeVan, stavenVan } from './periode';

/** Een dag zoals de server hem geeft (actie periode). */
const rij = (datum, extra = {}) => ({ datum, huis_kwh: 12, afname_kwh: 5, kosten_eur: 1.25, ...extra });
const SPA = { sleutel: 'hw-spa', naam: 'Spa', kwh: 6.4, keer: 9, gemeten: true };
const WAS = { sleutel: 'h:wasmachine', soort: 'wasmachine', kwh: 1.2, keer: 1, gemeten: false };

describe('de lijst per dag', () => {
  it('schoon: een rare regel valt weg; geen lijst (een oudere brug) is null', () => {
    expect(apparatenUit(null)).toBeNull();
    expect(apparatenUit(undefined)).toBeNull();
    expect(apparatenUit([SPA, { ...SPA }, { sleutel: 'x y', kwh: 1 }, { sleutel: 'h:raar', kwh: -2 }, { sleutel: 'h:kernreactor', soort: 'kernreactor', kwh: 0.1 }])).toEqual([
      { sleutel: 'hw-spa', soort: null, naam: 'Spa', kwh: 6.4, keer: 9, gemeten: true },
      { sleutel: 'h:kernreactor', soort: null, naam: null, kwh: 0.1, keer: 0, gemeten: false },
    ]);
  });

  it('een dag van de server en de stand van vandaag (bron.js) geven hem allebei mee', () => {
    expect(dagenUit([rij('2026-10-29', { apparaten_kwh: [SPA], basis_kwh: 4.8 })])[0]).toMatchObject({ apparaten: [expect.objectContaining({ sleutel: 'hw-spa' })], basis: 4.8 });
    expect(dagenUit([rij('2026-10-28')])[0]).toMatchObject({ apparaten: null, basis: null });
    const dag = dagUit({ van: '2026-10-29T23:00:00.000Z', stap_min: 15, metingen: [180], huis_w: [400], kwh: { huis: 3 }, apparaten: [WAS], basis_kwh: 1.1 });
    expect(dag.apparaten).toEqual([{ ...WAS, naam: null }]);
    expect(dag.basisKwh).toBe(1.1);
    expect(dagUit({ van: '2026-10-29T23:00:00.000Z', stap_min: 15, metingen: [180], huis_w: [400], kwh: { huis: 3 } }).apparaten).toBeNull();
  });

  it('vandaag komt vers uit de stand; een oudere brug in de stand laat de rij van de server staan', () => {
    const dagen = dagenUit([rij('2026-10-30', { apparaten_kwh: [SPA], basis_kwh: 1 })]);
    const stand = { dag: dagUit({ datum: '2026-10-30', van: '2026-10-29T23:00:00.000Z', stap_min: 15, metingen: [180], huis_w: [400], kwh: { huis: 3 }, apparaten: [{ ...SPA, kwh: 7 }], basis_kwh: 1.5 }) };
    expect(metVandaag(dagen, stand, '2026-10-30')[0]).toMatchObject({ apparaten: [expect.objectContaining({ kwh: 7 })], basis: 1.5 });
    const oud = { dag: dagUit({ datum: '2026-10-30', van: '2026-10-29T23:00:00.000Z', stap_min: 15, metingen: [180], huis_w: [400], kwh: { huis: 3 } }) };
    expect(metVandaag(dagen, oud, '2026-10-30')[0]).toMatchObject({ apparaten: [expect.objectContaining({ kwh: 6.4 })], basis: 1 });
  });
});

describe('per apparaat over een periode', () => {
  it('bij Dirk: alleen de spa met een eigen meter, plus basis en rest; aandeel en kosten met de prijs van die dag', () => {
    const dagen = dagenUit([
      rij('2026-10-28', { apparaten_kwh: [SPA], basis_kwh: 4 }),
      rij('2026-10-29', { apparaten_kwh: [{ ...SPA, kwh: 5.6, keer: 7 }], basis_kwh: 4, kosten_eur: 2.5 }),
    ]);
    const o = apparatenVan(dagen);
    expect(o.dagenMet).toBe(2);
    expect(o.huis).toBe(24);
    expect(o.regels).toHaveLength(1);
    const spa = o.regels[0];
    expect(spa).toMatchObject({ sleutel: 'hw-spa', naam: 'Spa', gemeten: true, kwh: 12, keer: 16 });
    expect(spa.aandeel).toBeCloseTo(0.5);
    // 6,4 kWh à € 0,25 en 5,6 kWh à € 0,50.
    expect(spa.eur).toBeCloseTo(1.6 + 2.8);
    expect(o.basis.kwh).toBe(8);
    expect(o.rest.kwh).toBeCloseTo(4);
    expect(o.basis.aandeel + o.rest.aandeel + spa.aandeel).toBeCloseTo(1);
  });

  it('bij Tim: herkende apparaten, grootste eerst, met de eigen naam uit de app voor een meter', () => {
    const dagen = dagenUit([
      rij('2026-10-29', {
        apparaten_kwh: [
          { sleutel: 'h:koelkast', soort: 'koelkast', kwh: 1, keer: 30 },
          WAS,
          { sleutel: 'h:anders:kachel', soort: 'anders', naam: 'Kachel', kwh: 2.5, keer: 2 },
          { sleutel: 'hw-stekker', naam: 'Stekker', kwh: 0.3, keer: 1, gemeten: true },
        ],
        basis_kwh: 6,
      }),
    ]);
    const o = apparatenVan(dagen, { namen: { 'hw-stekker': 'Aquarium' } });
    expect(o.regels.map((r) => [r.naam, r.gemeten])).toEqual([
      ['Kachel', false],
      ['Wasmachine', false],
      ['Koelkast', false],
      ['Aquarium', true],
    ]);
    expect(o.rest.kwh).toBeCloseTo(12 - 1 - 1.2 - 2.5 - 0.3 - 6);
  });

  it('kosten: een dag zonder prijs (bijna niets afgenomen) krijgt de gemiddelde prijs van de periode; zonder enige prijs de prijs van nu, of niets', () => {
    const dagen = dagenUit([
      rij('2026-10-28', { apparaten_kwh: [WAS], afname_kwh: 4, kosten_eur: 1 }),
      rij('2026-10-29', { apparaten_kwh: [WAS], afname_kwh: 0.01, kosten_eur: 0 }),
    ]);
    expect(apparatenVan(dagen).regels[0].eur).toBeCloseTo(1.2 * 0.25 * 2);
    const zonder = dagenUit([rij('2026-10-29', { apparaten_kwh: [WAS], afname_kwh: 0, kosten_eur: 0 })]);
    expect(apparatenVan(zonder).regels[0].eur).toBeNull();
    expect(apparatenVan(zonder).metGeld).toBe(false);
    expect(apparatenVan(zonder, { prijs: 0.3 }).regels[0].eur).toBeCloseTo(0.36);
  });

  it('dagen van voor het bijwerken tellen niet mee, ook niet voor het huis', () => {
    const dagen = dagenUit([rij('2026-10-27'), rij('2026-10-28'), rij('2026-10-29', { apparaten_kwh: [SPA], basis_kwh: 2 })]);
    const o = apparatenVan(dagen);
    expect(o).toMatchObject({ dagenMet: 1, dagen: 3, eerste: '2026-10-29', huis: 12 });
    expect(o.regels[0].aandeel).toBeCloseTo(6.4 / 12);
  });

  it('per staaf (per dag in een week): null zonder cijfers, 0 als het apparaat er niet was; ook basis en rest', () => {
    const week = periodeVan('week', Date.parse('2026-10-30T11:00:00Z'));
    const staven = stavenVan(week);
    const dagen = dagenUit([
      rij('2026-10-26'),
      rij('2026-10-27', { apparaten_kwh: [SPA], basis_kwh: 4 }),
      rij('2026-10-28', { apparaten_kwh: [WAS], basis_kwh: 4 }),
    ]);
    expect(reeksVan(staven, dagen, 'hw-spa')).toEqual([null, 6.4, 0, null, null, null, null]);
    expect(reeksVan(staven, dagen, BASIS).slice(0, 3)).toEqual([null, 4, 4]);
    expect(reeksVan(staven, dagen, REST)[1]).toBeCloseTo(12 - 6.4 - 4);
  });

  it('vergelijken met vorige week: per apparaat de kWh; zonder dagen met apparaten niets', () => {
    expect(vorigeVan(dagenUit([rij('2026-10-20', { apparaten_kwh: [{ ...SPA, kwh: 31 }], basis_kwh: 4 })]))).toMatchObject({ 'hw-spa': 31, basis: 4 });
    expect(vorigeVan(dagenUit([rij('2026-10-20')]))).toBeNull();
    expect(vorigeVan([])).toBeNull();
  });

  it('wat de kaart doet: een oudere brug vraagt om bij te werken, een nieuwe wacht; met cijfers de kaart', () => {
    const leeg = apparatenVan(dagenUit([rij('2026-10-29')]));
    expect(apparatenStand(leeg, '0.6.1')).toBe('bijwerken');
    expect(apparatenStand(leeg, '0.11.0+abc1234')).toBe('bijwerken');
    expect(apparatenStand(leeg, '0.12.0')).toBe('wachten');
    expect(apparatenStand(leeg, null)).toBe('niets');
    expect(apparatenStand(apparatenVan(dagenUit([rij('2026-10-29', { apparaten_kwh: [SPA] })])), '0.6.1')).toBe('kaart');
  });
});

describe('Rest: kWh, euro en staven tellen op dezelfde manier (R19-RK-10)', () => {
  it('bij Dirk: een dag met te veel geschat en een gewone dag', () => {
    const dagen = [
      { datum: '2026-10-28', huis: 6, kosten: 1.5, afname: 6, apparaten: [{ sleutel: 'hw-spa', naam: 'Spa', gemeten: true, kwh: 2.5, keer: 1 }], basis: 4.5 },
      { datum: '2026-10-29', huis: 10, kosten: 2.5, afname: 10, apparaten: [{ sleutel: 'hw-spa', naam: 'Spa', gemeten: true, kwh: 1, keer: 1 }], basis: 4.5 },
    ];
    const o = apparatenVan(dagen);
    const staven = [{ van: '2026-10-28', tot: '2026-10-28' }, { van: '2026-10-29', tot: '2026-10-29' }];
    const reeks = reeksVan(staven, dagen, REST);
    expect(reeks).toEqual([0, 4.5]);
    expect(o.rest.kwh).toBeCloseTo(reeks[0] + reeks[1], 6);
    expect(o.rest.eur).toBeCloseTo(4.5 * 0.25, 6);
  });
});
