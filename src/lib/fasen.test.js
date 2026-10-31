import { describe, expect, it } from 'vitest';
import { ampere, FASE_GRENS_A, faseGrenzen, faseRichting, faseSchaal, faseVermogen, hoogLaagZin, saldoZin, volt, weekGemiddelden, zwaarsteFase, zwareFaseZin, ZEKERING_A } from './fasen';

describe('belasting per fase', () => {
  it('de zwaarste fase nu; bij één fase niets', () => {
    expect(zwaarsteFase([{ fase: 1, a: 7.4 }, { fase: 2, a: 9.1 }, { fase: 3, a: 0.3 }])).toBe(2);
    expect(zwaarsteFase([{ fase: 1, a: 7.4 }])).toBeNull();
    expect(zwaarsteFase([{ fase: 1, a: 0 }, { fase: 2, a: 0 }])).toBeNull();
  });

  it('hoog en laag in gewone woorden', () => {
    expect(hoogLaagZin([{ fase: 1, gemiddeldA: 6.2 }, { fase: 2, gemiddeldA: 9.1 }, { fase: 3, gemiddeldA: 2.4 }])).toBe('L2 zit gemiddeld het hoogst, L3 het laagst.');
    expect(hoogLaagZin([{ fase: 1, gemiddeldA: 3 }, { fase: 2, gemiddeldA: 3.05 }])).toBe('De fasen zijn gemiddeld even zwaar belast.');
    expect(hoogLaagZin([{ fase: 1, gemiddeldA: 3 }])).toBe('');
  });

  it('het gemiddelde over de week', () => {
    const week = [
      { datum: '2026-10-28', fasen: [{ fase: 1, gemiddeldA: 4, piekA: 20 }, { fase: 2, gemiddeldA: 8, piekA: 15 }] },
      { datum: '2026-10-29', fasen: [{ fase: 1, gemiddeldA: 6, piekA: 22 }, { fase: 2, gemiddeldA: 10, piekA: 12 }] },
    ];
    expect(weekGemiddelden(week)).toEqual([
      { fase: 1, gemiddeldA: 5, piekA: 22, dagen: 2 },
      { fase: 2, gemiddeldA: 9, piekA: 15, dagen: 2 },
    ]);
    expect(ampere(7.44).replace(/\s/g, ' ')).toBe('7,4 A');
  });

  it('het vermogen per fase met teken en in woorden, de schaal en de spanning', () => {
    const kaal = (t) => t.replace(/\s/g, ' ');
    expect(kaal(faseVermogen(-1700.4))).toBe('−1,7 kW');
    expect(kaal(faseVermogen(412))).toBe('+412 W');
    expect(kaal(faseVermogen(0.3))).toBe('0 W');
    expect(faseVermogen(null)).toBe('');
    expect(faseRichting(-1700)).toBe('naar het net');
    expect(faseRichting(412)).toBe('uit het net');
    expect(faseRichting(0.3)).toBe('');
    expect(faseRichting(null)).toBe('');
    expect(faseSchaal([{ a: 7 }, { a: 12 }])).toBe(25);
    expect(faseSchaal([{ a: 31.5 }, { a: null }])).toBe(31.5);
    expect(kaal(volt(231.27))).toBe('231 V');
    expect(volt(null)).toBe('');
  });

  it('de meter telt de fasen op: per saldo', () => {
    const kaal = (t) => t.replace(/\s/g, ' ');
    const tim = [
      { fase: 1, w: -312 },
      { fase: 2, w: 439 },
      { fase: 3, w: -175 },
    ];
    expect(kaal(saldoZin(tim, -49))).toBe(
      'Op L2 haal je 439 W uit het net, op L1 en L3 lever je terug. De meter telt de drie fasen bij elkaar op: per saldo lever je 49 W terug.',
    );
    // Zonder totaal van de meter: de som van de fasen.
    expect(kaal(saldoZin(tim, null))).toMatch(/per saldo lever je 48 W terug\.$/);
    // Eén fase terug, twee uit het net.
    expect(kaal(saldoZin([{ fase: 1, w: -1700 }, { fase: 2, w: 2100 }, { fase: 3, w: 60 }], 460))).toBe(
      'Op L1 lever je 1,7 kW terug, op L2 en L3 haal je uit het net. De meter telt de drie fasen bij elkaar op: per saldo haal je 460 W uit het net.',
    );
    // Twee fasen, en per saldo binnen ±20 W.
    expect(kaal(saldoZin([{ fase: 1, w: -230 }, { fase: 2, w: 240 }], 10))).toBe(
      'Op L2 haal je 240 W uit het net, op L1 lever je terug. De meter telt de twee fasen bij elkaar op: per saldo gaat er bijna niets naar of uit het net.',
    );
    expect(saldoZin([{ fase: 1, w: 300 }, { fase: 2, w: 0.2 }], 300)).toBe('');
    expect(saldoZin(null, 0)).toBe('');
  });

  it('een zware fase: rustig, met de zekering erbij; per huis in te stellen', () => {
    expect([FASE_GRENS_A, ZEKERING_A]).toEqual([20, 25]);
    expect(faseGrenzen(null)).toEqual({ grens: 20, zekering: 25, eigen: false });
    expect(faseGrenzen({ faseGrens: 30, zekering: 35 })).toEqual({ grens: 30, zekering: 35, eigen: true });
    const fasen = [{ fase: 1, a: 21 }, { fase: 2, a: 23.71 }, { fase: 3, a: 2 }];
    const gewoon = (t) => t.replace(/\u00a0/g, ' ');
    expect(gewoon(zwareFaseZin(fasen))).toBe('L2 trekt nu 23,7 A, dicht bij de 25 A van de zekering (ook L1 boven 20 A).');
    expect(gewoon(zwareFaseZin([{ fase: 2, a: 26.1 }]))).toBe('L2 trekt nu 26,1 A, meer dan de 25 A van de zekering.');
    // Precies op de grens telt; net eronder niet.
    expect(zwareFaseZin([{ fase: 1, a: 19.96 }])).not.toBe('');
    expect(zwareFaseZin([{ fase: 1, a: 19.9 }])).toBe('');
    expect(zwareFaseZin(fasen, faseGrenzen({ faseGrens: 25, zekering: 35 }))).toBe('');
    expect(zwareFaseZin(null)).toBe('');
    expect(zwareFaseZin([{ fase: 1, a: null }])).toBe('');
    // Zonder eigen grens volgt de grens de zekering: 80% ervan (R19-RK-11).
    expect(faseGrenzen({ zekering: 35 })).toEqual({ grens: 28, zekering: 35, eigen: false });
    expect(faseGrenzen({ zekering: 16 })).toEqual({ grens: 12.8, zekering: 16, eigen: false });
    expect(zwareFaseZin([{ fase: 1, a: 20.4 }], faseGrenzen({ zekering: 35 }))).toBe('');
    expect(gewoon(zwareFaseZin([{ fase: 1, a: 18.5 }], faseGrenzen({ zekering: 16 })))).toBe('L1 trekt nu 18,5 A, meer dan de 16 A van de zekering.');
    expect(gewoon(zwareFaseZin([{ fase: 1, a: 13.5 }], faseGrenzen({ zekering: 16 })))).toBe('L1 trekt nu 13,5 A, dicht bij de 16 A van de zekering.');
    // Een eigen grens ver onder de zekering: "boven je grens", niet "dicht bij de zekering".
    expect(gewoon(zwareFaseZin([{ fase: 1, a: 15.2 }], faseGrenzen({ faseGrens: 15, zekering: 35 })))).toBe('L1 trekt nu 15,2 A, boven je grens van 15 A.');
    // De balk loopt tot de zekering van dit huis.
    expect(faseSchaal([{ fase: 1, a: 3 }], 35)).toBe(35);
    expect(faseSchaal([{ fase: 1, a: 3 }])).toBe(25);
  });
});
