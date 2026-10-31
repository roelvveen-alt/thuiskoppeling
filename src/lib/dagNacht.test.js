import { describe, expect, it } from 'vitest';
import { standUitRij } from './bron';
import { isDag } from './dagNacht';
import { verdeelStroom } from './stroom';
import { voorbeeldStand } from './voorbeeld';

const ZON = { op: '2026-10-30T06:21:00.000Z', onder: '2026-10-30T16:13:00.000Z' };
const rij = (moment, extra = {}) => ({ moment, zon_w: 0, net_w: 300, brug: { versie: '0.7.0', gestart: '2026-10-30T05:00:00.000Z', elke_seconden: 5, zon: ZON }, ...extra });
const dag = (r) => {
  const stand = standUitRij(r);
  return isDag(stand, verdeelStroom(stand));
};

describe('dag of nacht in de tekening', () => {
  it('met zon op en onder van het programmaatje (0.7.0): daarop, ook als de zon (nog) niets levert', () => {
    expect(dag(rij('2026-10-30T06:00:00.000Z'))).toBe(false);
    expect(dag(rij('2026-10-30T06:30:00.000Z'))).toBe(true);
    expect(dag(rij('2026-10-30T16:00:00.000Z'))).toBe(true);
    expect(dag(rij('2026-10-30T16:20:00.000Z'))).toBe(false);
    // Na zonsondergang nog wat licht op de panelen: toch nacht.
    expect(dag(rij('2026-10-30T16:30:00.000Z', { zon_w: 40 }))).toBe(false);
  });

  it('zonder brug.zon (een oudere brug of functie): zoals vroeger, op het licht', () => {
    const oud = (zon_w) => dag({ moment: '2026-10-30T12:00:00.000Z', zon_w, net_w: 300, brug: { versie: '0.6.2', gestart: '2026-10-30T05:00:00.000Z', elke_seconden: 5 } });
    expect(oud(0)).toBe(false);
    expect(oud(800)).toBe(true);
    expect(dag({ moment: '2026-10-30T12:00:00.000Z', zon_w: 800 })).toBe(true);
    // Rommel of tijden van een andere dag: ook dan op het licht.
    expect(dag(rij('2026-10-30T12:00:00.000Z', { brug: { versie: '0.7.0', zon: { op: 'gisteren', onder: ZON.onder } } }))).toBe(false);
    expect(dag(rij('2026-11-02T12:00:00.000Z', { zon_w: 900 }))).toBe(true);
    expect(dag(rij('2026-11-02T12:00:00.000Z'))).toBe(false);
  });

  it('het voorbeeld: een vaste opkomst (07:30) en ondergang (18:30)', () => {
    const begin = new Date(2026, 9, 30).getTime();
    const op = (uur) => {
      const stand = voorbeeldStand(uur, 0, 'dierenverblijf', begin);
      return isDag(stand, verdeelStroom(stand));
    };
    expect([op(7), op(8), op(18), op(19)]).toEqual([false, true, true, false]);
  });
});
