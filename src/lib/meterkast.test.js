import { describe, expect, it } from 'vitest';
import { hoeveel, meterkastRegels, meterkastUit, vandaagVan } from './meterkast';

const gewoon = (regels) => regels.map((r) => [r.tekst, r.bij ?? ''].join(' | ').replace(/\u00a0/g, ' '));

describe('de meterkast in gewone woorden (programmaatje 1.4.0)', () => {
  it('tarief, gas en water van vandaag met de meterstand, en de maandpiek', () => {
    const m = meterkastUit({
      tarief: 2,
      gemiddeld_w: 812,
      maandpiek_w: 4321,
      maandpiek_op: '2026-10-12T17:15:00.000Z',
      meters: [
        { soort: 'gas', stand: 2569.646, eenheid: 'm3', vandaag: 1.234 },
        { soort: 'water', stand: 123.456, eenheid: 'm3' },
        { soort: 'olie', stand: 1, eenheid: 'l' },
      ],
    });
    const regels = gewoon(meterkastRegels(m));
    expect(regels[0]).toBe('Nu normaal tarief | zo telt de slimme meter');
    expect(regels[1]).toBe('Gas vandaag 1,23 m³ | meterstand 2.569,646 m³');
    expect(regels[2]).toBe('Water: meterstand 123,456 m³ | ');
    expect(regels[3]).toMatch(/^Hoogste kwartier deze maand 4\.321 W \| 12 oktober.* · dit kwartier gemiddeld 812 W$/);
    expect(vandaagVan(m, 'gas')).toBe(1.234);
    expect(vandaagVan(m, 'water')).toBeNull();
    // Met een dynamisch contract zegt dal of normaal niets (Tim): dan geen regel.
    expect(meterkastRegels(meterkastUit({ tarief: 1 }), { dynamisch: true })).toEqual([]);
  });

  it('zonder meterkast (een oudere brug of functie) niets; rommel valt weg', () => {
    expect(meterkastUit(null)).toBeNull();
    expect(meterkastUit({ tarief: 9, meters: 'x' })).toBeNull();
    expect(meterkastRegels(null)).toEqual([]);
    expect(hoeveel(2569.646, 'm3', { stand: true }).replace(/\u00a0/g, ' ')).toBe('2.569,646 m³');
    expect(hoeveel(1.2, 'GJ').replace(/\u00a0/g, ' ')).toBe('1,20 GJ');
  });
});
