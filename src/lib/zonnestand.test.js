import { describe, expect, it } from 'vitest';
import { zonOpEnOnder } from '../../brug/zon.mjs';
import { bovenDeLucht, hemelDeel, lichtOpPanelen, plaatsUitZon, STANDAARD_PLAATS, zonnestand } from './zonnestand';

describe('de stand van de zon', () => {
  it('op de middag van de langste en de kortste dag in De Bilt: 90 − 52,1 ± 23,4 graden, recht in het zuiden', () => {
    const zomer = zonnestand(Date.parse('2026-06-21T11:40:00Z'));
    expect(zomer.hoogte).toBeCloseTo(90 - 52.1 + 23.44, 0);
    expect(zomer.richting).toBeCloseTo(180, -1);
    const winter = zonnestand(Date.parse('2026-12-21T11:38:00Z'));
    expect(winter.hoogte).toBeCloseTo(90 - 52.1 - 23.44, 0);
  });

  it("'s ochtends in het oosten, 's middags in het westen, 's nachts onder de horizon", () => {
    expect(zonnestand(Date.parse('2026-06-21T05:00:00Z')).richting).toBeLessThan(90);
    expect(zonnestand(Date.parse('2026-06-21T17:00:00Z')).richting).toBeGreaterThan(260);
    expect(zonnestand(Date.parse('2026-06-21T23:00:00Z')).hoogte).toBeLessThan(0);
    expect(bovenDeLucht(Date.parse('2026-06-21T23:00:00Z'), -10)).toBe(0);
  });

  it('zon op en onder (brug/zon.mjs) vallen op een hoogte van ongeveer −0,8 graden', () => {
    const { op, onder } = zonOpEnOnder('2026-10-30');
    expect(zonnestand(op).hoogte).toBeCloseTo(-0.83, 0);
    expect(zonnestand(onder).hoogte).toBeCloseTo(-0.83, 0);
  });
});

describe('licht op schuine panelen', () => {
  it('een heldere winterdag: op een dak op het zuiden veel meer dan op de grond; grijs: ongeveer hetzelfde', () => {
    const middag = Date.parse('2026-12-21T11:00:00Z');
    const helder = lichtOpPanelen(middag, 250);
    expect(helder.kt).toBeGreaterThan(0.6);
    expect(helder.schuin / 250).toBeGreaterThan(1.8);
    const grijs = lichtOpPanelen(middag, 60);
    expect(grijs.schuin / 60).toBeGreaterThan(0.9);
    expect(grijs.schuin / 60).toBeLessThan(1.05);
  });

  it('een dak op het noorden krijgt bij een heldere lucht minder dan de grond; zonder licht nul', () => {
    const middag = Date.parse('2026-06-21T11:00:00Z');
    expect(lichtOpPanelen(middag, 800, STANDAARD_PLAATS, { helling: 30, richting: 0 }).schuin).toBeLessThan(800);
    expect(lichtOpPanelen(middag, 0).schuin).toBe(0);
  });

  it('het hemellicht volgens Erbs: grijs bijna alles, helder een zesde', () => {
    expect(hemelDeel(0.1)).toBeCloseTo(0.991, 2);
    expect(hemelDeel(0.5)).toBeCloseTo(0.67, 1);
    expect(hemelDeel(0.9)).toBe(0.165);
  });
});

describe('de plaats uit zon op en onder', () => {
  it('Groningen, Maastricht en De Bilt vanuit de tijden, behalve rond de equinox (dan de breedte van De Bilt)', () => {
    for (const [breedte, lengte] of [
      [53.22, 6.57],
      [50.85, 5.69],
      [52.1, 5.18],
    ]) {
      for (const datum of ['2026-06-21', '2026-12-21', '2026-10-30']) {
        const plaats = plaatsUitZon(zonOpEnOnder(datum, breedte, lengte));
        expect(plaats.geschat).toBe(false);
        expect(plaats.breedte).toBeCloseTo(breedte, 0);
        expect(plaats.lengte).toBeCloseTo(lengte, 1);
      }
    }
    expect(plaatsUitZon(zonOpEnOnder('2026-03-20', 53.22, 6.57)).breedte).toBe(STANDAARD_PLAATS.breedte);
  });

  it('zonder tijden (een brug van voor 0.7.0), of tijden die niet kloppen: De Bilt', () => {
    expect(plaatsUitZon(null)).toEqual({ ...STANDAARD_PLAATS, geschat: true });
    expect(plaatsUitZon({ op: 5, onder: 3 })).toMatchObject({ geschat: true });
    expect(plaatsUitZon({ op: Date.parse('2026-10-30T00:00:00Z'), onder: Date.parse('2026-10-30T01:00:00Z') })).toMatchObject({ geschat: true });
  });
});
