import { describe, expect, it } from 'vitest';
import { leerHuis, leerVerhouding, maakAdvies, STRALING_GOED_WH_M2, weerVoorAdvies } from './advies';
import { weerUit } from './bron';
import { dagenUit } from './periode';

const UUR = 3_600_000;
/** Middernacht van vrijdag 6 november 2026 in Nederland (wintertijd). */
const NACHT = Date.parse('2026-11-05T23:00:00Z');
/** Vrijdag 16:15: het advies loopt tot morgen 16:00, de zin over morgen gaat over heel zaterdag. */
const NU = NACHT + 16.25 * UUR;
/** De panelen van dit huis leveren 5 Wh per Wh/m² (ruwweg 25 m² panelen). */
const VERHOUDING = 5;

const huisUur = (h) => (h < 6 ? 250 : h < 8 ? 700 : h < 17 ? 450 : h < 21 ? 1400 : 600);
const licht = (h, piek) => (h >= 8 && h <= 16 ? Math.round(piek * Math.sin((Math.PI * (h - 7.5)) / 9.5)) : 0);
const WEEK = ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'];

/** Een week met wisselend licht (piek 200 W/m²) en zon die er precies bij past; `straling: false` = van voor 0.9.0. */
const dagen = ({ straling = true } = {}) =>
  dagenUit(
    WEEK.map((datum) => ({
      datum,
      huis_kwh: 14,
      zon_kwh: 6,
      kwartieren: 96,
      huis_uur_wh: Array.from({ length: 24 }, (_, h) => huisUur(h)),
      zon_uur_wh: Array.from({ length: 24 }, (_, h) => licht(h, 200) * VERHOUDING),
      ...(straling ? { straling_uur_wh_m2: Array.from({ length: 24 }, (_, h) => licht(h, 200)) } : {}),
      uur_kwartieren: Array(24).fill(4),
    })),
  );

/** Het weer zoals de site het uit de stand haalt (weerUit): vandaag (grijs) en morgen, per uur vanaf 23:00 gisteren. */
function weer({ morgenPiek, morgenBewolking, temp = 9, opgehaald = NU - 10 * 60_000 }) {
  const ruw = {
    van: new Date(NACHT - UUR).toISOString(),
    stap_min: 60,
    straling_wm2: Array.from({ length: 48 }, (_, i) => licht((i + 23) % 24, i >= 25 ? morgenPiek : 60)),
    bewolking_pct: Array.from({ length: 48 }, (_, i) => (i >= 25 ? morgenBewolking : 95)),
    temp_c: Array.from({ length: 48 }, (_, i) => (typeof temp === 'function' ? temp(i) : temp)),
    opgehaald: new Date(opgehaald).toISOString(),
    bron: 'open-meteo',
  };
  return weerUit(ruw);
}

const ZENDURE = { inhoud_kwh: 5.76, ontlaadgrens_pct: 10, laadgrens_pct: 100, pakketten: 2 };
const stand = (over = {}) => ({ batterij_procent: 20, batterij_info: ZENDURE, voorspelling: null, zon_w: 0, zonnen: [], dag: null, ...over });

describe('het weer uit de stand (bron.js)', () => {
  it('per uur, met de reeksen die er zijn; een reeks van een andere lengte valt weg', () => {
    const w = weer({ morgenPiek: 400, morgenBewolking: 20 });
    expect(w).toMatchObject({ van: NACHT - UUR, stapMs: UUR, bron: 'open-meteo' });
    expect(w.straling).toHaveLength(48);
    expect(weerUit({ van: '2026-11-05T22:00:00Z', stap_min: 60, straling_wm2: [1, 2], bewolking_pct: [1] })).toMatchObject({ straling: [1, 2], bewolking: null });
  });

  it('een oudere meting (geen weer) of onzin: null', () => {
    expect(weerUit(undefined)).toBeNull();
    expect(weerUit({ van: 'x', stap_min: 60, straling_wm2: [1] })).toBeNull();
    expect(weerUit({ van: '2026-11-05T22:00:00Z', stap_min: 15, straling_wm2: [1] })).toBeNull();
    expect(weerUit({ van: '2026-11-05T22:00:00Z', stap_min: 60, temp_c: [1] })).toBeNull();
  });

  it('zelfde regel als Voorspelling: elk uur dat het bericht dekt, telt, ook als het een paar uur oud is', () => {
    expect(weerVoorAdvies(weer({ morgenPiek: 400, morgenBewolking: 20 }))).not.toBeNull();
    const oud = weerVoorAdvies(weer({ morgenPiek: 400, morgenBewolking: 20, opgehaald: NU - 5 * UUR }));
    expect(oud.op(NACHT + 36 * UUR).bewolking).toBe(20);
    expect(oud.op(NACHT + 60 * UUR)).toBeNull();
    expect(weerVoorAdvies(null)).toBeNull();
  });
});

describe('leren wat de panelen bij zoveel licht leveren', () => {
  it('zon-Wh ÷ straling-Wh/m² over de uren met genoeg licht; een week is genoeg', () => {
    const uit = leerVerhouding(dagen().map((d) => d.uren));
    expect(uit.verhouding).toBeCloseTo(VERHOUDING, 5);
    expect(uit.gewicht).toBe(1);
  });

  it('voorzichtige start: met weinig licht telt het weerbericht naar rato, zonder licht niet', () => {
    const een = leerVerhouding([dagen()[0].uren]);
    expect(een.verhouding).toBeCloseTo(VERHOUDING, 5);
    expect(een.gewicht).toBeGreaterThan(0.2);
    expect(een.gewicht).toBeLessThan(1);
    expect(een.gewicht).toBeCloseTo(dagen()[0].uren.stralingWh.filter((s) => s >= 50).reduce((a, b) => a + b, 0) / STRALING_GOED_WH_M2, 5);
    expect(leerVerhouding(dagen({ straling: false }).map((d) => d.uren))).toEqual({ verhouding: null, gewicht: 0 });
    expect(leerVerhouding([])).toEqual({ verhouding: null, gewicht: 0 });
  });

  it('vandaag telt mee: de uren die voorbij zijn, met de straling uit het weerbericht', () => {
    const dag = { van: NACHT, stapMs: 15 * 60_000, metingen: Array(96).fill(180), huis: Array(96).fill(400), zon: Array.from({ length: 96 }, (_, i) => licht(Math.floor(i / 4), 60) * VERHOUDING) };
    const g = leerHuis({ dagen: [], dag, nu: NU, weer: weer({ morgenPiek: 400, morgenBewolking: 20 }) });
    expect(g.verhouding).toBeCloseTo(VERHOUDING, 5);
    expect(g.weerGewicht).toBeGreaterThan(0);
  });
});

describe('Advies met het weer', () => {
  it('de zon per uur volgt het weerbericht met de geleerde verhouding', () => {
    const a = maakAdvies({ stand: stand({ weer: weer({ morgenPiek: 500, morgenBewolking: 10 }) }), dagen: dagen(), nu: NU });
    const middag = a.uren.find((u) => u.morgen && u.uur === 12);
    expect(middag.zonW).toBe(Math.round(VERHOUDING * licht(12, 500)));
    expect(a.toelichting).toContain('De zon komt uit het weerbericht (Open-Meteo), met wat je panelen bij zoveel licht leveren.');
  });

  it('morgen bewolkt, zonnig of wisselend: één korte weerregel, met de wolken zoals Voorspelling ze telt, zonder kWh en zonder batterij', () => {
    const regel = (morgenPiek, morgenBewolking) =>
      maakAdvies({ stand: stand({ weer: weer({ morgenPiek, morgenBewolking }) }), dagen: dagen(), nu: NU }).regels.find((r) => r.soort === 'weer');
    expect(regel(40, 90)).toEqual({ soort: 'weer', kop: 'Het weer', tekst: 'Morgen veel wolken, weinig zon.', icoon: 'wolk' });
    expect(regel(600, 15)).toEqual({ soort: 'weer', kop: 'Het weer', tekst: 'Morgen veel zon.', icoon: 'zon' });
    expect(regel(300, 60).tekst).toBe('Morgen zon en wolken.');
    expect(regel(400, 30).tekst).toBe('Morgen veel zon, een paar wolken.');
  });

  it('hooguit drie regels, en nergens de batterij (ook niet bij kou of een volle batterij)', () => {
    const temp = (i) => (i >= 20 && i <= 34 ? -3 : 2);
    for (const over of [{}, { batterij_procent: 100 }, { batterij_info: { ...ZENDURE, accus: [{ nr: 1, temp_c: 3 }] }, weer: weer({ morgenPiek: 300, morgenBewolking: 50, temp }) }]) {
      const a = maakAdvies({ stand: stand({ weer: weer({ morgenPiek: 600, morgenBewolking: 15 }), ...over }), dagen: dagen(), nu: NU });
      expect(a.regels.length).toBeLessThanOrEqual(3);
      expect([...a.zinnen, ...a.toelichting].join(' ')).not.toMatch(/batterij|accu|ZENKI/i);
    }
  });

  it('zonder weerbericht (een oudere brug): geen weerregel, de zon van de laatste dagen', () => {
    const zonder = maakAdvies({ stand: stand(), dagen: dagen(), nu: NU });
    expect(zonder.regels.some((r) => r.soort === 'weer')).toBe(false);
    expect(zonder.toelichting).toContain('Het weer zit er nog niet in: de zon is geschat op de laatste dagen.');
    expect(maakAdvies({ stand: stand({ weer: null }), dagen: dagen(), nu: NU }).zinnen).toEqual(zonder.zinnen);
  });

  it('vóór 6:00 gaat de weerregel over vandaag', () => {
    const vroeg = NACHT + 4 * UUR;
    const w = weer({ morgenPiek: 40, morgenBewolking: 90, opgehaald: vroeg - 600_000 });
    const a = maakAdvies({ stand: stand({ weer: w }), dagen: dagen(), nu: vroeg });
    expect(a.zinnen).toContain('Vandaag veel wolken, weinig zon.');
  });
});
