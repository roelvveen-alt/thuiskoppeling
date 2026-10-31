import { describe, expect, it } from 'vitest';
import { nepWeer } from './morgenProef';
import { dagZin, weerPerDagdeel } from './weerVerwachting';
import { STANDAARD_PLAATS } from './zonnestand';

/** Vrijdag 30 oktober 2026, 14:00 in Nederland; plek i in het bericht is het uur vanaf 23:00 gisteren + i. */
const NU = Date.parse('2026-10-30T13:00:00Z');
const VANDAAG = '2026-10-30';
/** Plek in het bericht van morgen om `uur`:00 (lokaal). */
const morgen = (uur) => 25 + uur;

describe('het weer per dagdeel', () => {
  it('de rest van vandaag (vanaf het uur van nu) en heel morgen, met min en max', () => {
    const w = weerPerDagdeel(nepWeer({ vandaag: VANDAAG, opgehaald: NU }), NU, STANDAARD_PLAATS);
    expect(w.uitgebreid).toBe(true);
    expect(w.dagen.map((d) => d.naam)).toEqual(['Vandaag', 'Morgen']);
    // Vandaag om 14:00: middag (14–18, vier uur) en avond; de nacht en ochtend zijn voorbij.
    expect(w.dagen[0].delen.map((d) => d.sleutel)).toEqual(['middag', 'avond']);
    // Morgen: het bericht loopt tot 23:00, de avond heeft vijf uur (genoeg).
    expect(w.dagen[1].delen.map((d) => d.sleutel)).toEqual(['nacht', 'ochtend', 'middag', 'avond']);
    expect(w.dagen[1].titel).toBe('Morgen, zaterdag 31 oktober');
    expect(w.dagen[1].tempMin).toBeLessThan(w.dagen[1].tempMax);
    expect(w.dagen[1].droog).toBe(true);
    // Overdag zon (licht), 's nachts de maan.
    expect(w.dagen[1].delen[2]).toMatchObject({ dag: true, icoon: 'CloudSun', tekst: 'zon en wat wolken' });
    expect(w.dagen[1].delen[0]).toMatchObject({ dag: false, icoon: 'CloudMoon' });
    expect(dagZin(w.dagen[1])).toMatch(/^Morgen: \d+ tot \d+.°C, droog\.$/);
    expect(dagZin(w.dagen[1], { kaal: true })).toBe('Droog.');
  });

  it('regen met kans en mm, onweer, windstoten, sneeuw en mist', () => {
    const code = (i) => (i >= morgen(13) && i < morgen(16) ? 95 : i >= morgen(7) && i < morgen(10) ? 63 : i < morgen(4) && i >= morgen(0) ? 45 : 3);
    const weer = nepWeer({
      vandaag: VANDAAG,
      opgehaald: NU,
      code,
      neerslag: (i) => (code(i) === 63 ? 1.24 : code(i) === 95 ? 4 : 0),
      kans: (i) => (code(i) === 63 ? 80 : code(i) === 95 ? 65 : 10),
      stoten: (i) => (i >= morgen(19) && i <= morgen(21) ? 95 : 30),
      bewolking: () => 95,
    });
    const [, m] = weerPerDagdeel(weer, NU, STANDAARD_PLAATS).dagen;
    const [nacht, ochtend, middag, avond] = m.delen;
    expect(nacht).toMatchObject({ tekst: 'mist', icoon: 'CloudFog', mist: true });
    expect(ochtend).toMatchObject({ tekst: 'regen', icoon: 'CloudRain', valt: 'regen', kans: 80 });
    expect(ochtend.details).toEqual(['80% kans', '3,7\u00a0mm']);
    expect(middag).toMatchObject({ tekst: 'onweer', icoon: 'CloudLightning', onweer: true });
    expect(avond).toMatchObject({ wind: 'storm', icoon: 'Wind' });
    expect(avond.details).toEqual(['zware windstoten tot 95 km/h']);
    expect(dagZin(m)).toMatch(/15,7.mm regen, zware windstoten tot 95 km\/h \(avond\), kans op onweer \(middag\)\.$/);

    const sneeuw = weerPerDagdeel(nepWeer({ vandaag: VANDAAG, opgehaald: NU, code: () => 73, neerslag: () => 0.5, bewolking: () => 100 }), NU, STANDAARD_PLAATS);
    expect(sneeuw.dagen[1].delen[1]).toMatchObject({ tekst: 'sneeuw', icoon: 'CloudSnow' });
  });

  it('een bui die alleen in de mm zit (de code zegt bewolkt): toch nat', () => {
    const weer = nepWeer({ vandaag: VANDAAG, opgehaald: NU, code: () => 2, neerslag: (i) => (i === morgen(14) ? 1.5 : 0), kans: () => 40, bewolking: () => 60 });
    const middag = weerPerDagdeel(weer, NU, STANDAARD_PLAATS).dagen[1].delen[2];
    expect(middag).toMatchObject({ tekst: 'buien', valt: 'regen', icoon: 'CloudSunRain' });
    expect(middag.details).toEqual(['40% kans', '1,5\u00a0mm']);
  });

  it('een oudere brug (0.9.0): alleen zon en wolken uit de bewolking, niet uitgebreid', () => {
    const w = weerPerDagdeel(nepWeer({ vandaag: VANDAAG, opgehaald: NU, oud: true, helder: () => 0.9 }), NU, STANDAARD_PLAATS);
    expect(w.uitgebreid).toBe(false);
    expect(w.dagen[1].delen[2]).toMatchObject({ tekst: 'zonnig', icoon: 'Sun', kans: null, mm: null });
    expect(w.dagen[1].droog).toBeNull();
    expect(dagZin(w.dagen[1])).toMatch(/^Morgen: \d+ tot \d+.°C\.$/);
  });

  it('zonder weer niets', () => {
    expect(weerPerDagdeel(null, NU, STANDAARD_PLAATS)).toBeNull();
    expect(weerPerDagdeel({ van: NU, stapMs: 3_600_000, straling: null, bewolking: null }, NU, STANDAARD_PLAATS)).toBeNull();
  });
});
