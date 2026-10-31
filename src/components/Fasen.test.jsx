import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FasenNu, FasenVandaag } from './Fasen';

/** Zonder opmaak, met gewone spaties: zo leest het ook hardop. */
const tekst = (el) =>
  renderToStaticMarkup(el)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|\s/g, ' ')
    .replace(/ +/g, ' ')
    .trim();
const aantal = (el, wat) => renderToStaticMarkup(el).split(wat).length - 1;

const drie = [
  { fase: 1, w: -1700, a: 7.4, v: 231.3 },
  { fase: 2, w: 2100, a: 9.1, v: 229 },
  { fase: 3, w: 60, a: 0.3, v: 232 },
];

describe('belasting per fase op Nu', () => {
  it('een fase boven de grens: de ampères en een zin in let-op, de piek van vandaag erbij', () => {
    const fasen = [
      { fase: 1, w: 800, a: 3.5, v: 231 },
      { fase: 2, w: 5400, a: 23.7, v: 228 },
      { fase: 3, w: 60, a: 0.3, v: 232 },
    ];
    const dag = { fasen: [{ fase: 1, piekA: 9.2 }, { fase: 2, piekA: 24.4 }] };
    const el = <FasenNu fasen={fasen} dag={dag} />;
    const t = tekst(el);
    expect(t).toContain('L2 trekt nu 23,7 A, dicht bij de 25 A van de zekering.');
    expect(t).toContain('piek vandaag 24,4 A');
    expect(t).toContain('piek vandaag 9,2 A');
    // L2 nu, zijn piek en de zin: drie keer let-op; L1 niet.
    expect(aantal(el, 'text-let-op')).toBe(3);
    // Met een hogere grens en zekering van dit huis: niets in let-op, de balk tot 35 A.
    const ruim = <FasenNu fasen={fasen} grenzen={{ grens: 30, zekering: 35 }} />;
    expect(aantal(ruim, 'text-let-op')).toBe(0);
    expect(tekst(ruim)).toContain('De balk loopt tot 35 A, de zekering.');
  });


  it('drie balken met ampère en het vermogen in woorden (geen teken erbij), en de zwaarste fase', () => {
    const el = <FasenNu fasen={drie} />;
    expect(aantal(el, '<li')).toBe(3);
    const t = tekst(el);
    expect(t).toContain('L1 7,4 A 1,7 kW naar het net 231 V');
    expect(t).toContain('L2 9,1 A 2,1 kW uit het net');
    expect(t).not.toMatch(/[−+]\d/);
    expect(t).toContain('L2 is nu het zwaarst belast (9,1 A).');
    expect(t).toContain('De balk loopt tot 25 A, de gewone hoofdzekering.');
    // Zonder het totaal van de meter: de som van de fasen.
    expect(t).toContain('Op L1 lever je 1,7 kW terug, op L2 en L3 haal je uit het net. De meter telt de drie fasen bij elkaar op: per saldo haal je 460 W uit het net.');
  });

  it('11:02 bij Tim: L2 haalt uit het net, L1 en L3 leveren terug; per saldo wat de meter zegt', () => {
    const fasen = [
      { fase: 1, w: -312, a: 1.3, v: 235 },
      { fase: 2, w: 439, a: 1.9, v: 236 },
      { fase: 3, w: -175, a: 0.7, v: 234 },
    ];
    const t = tekst(<FasenNu fasen={fasen} net={-49} />);
    expect(t).toContain('L1 1,3 A 312 W naar het net 235 V');
    expect(t).toContain('L2 1,9 A 439 W uit het net 236 V');
    expect(t).toContain('L3 0,7 A 175 W naar het net 234 V');
    expect(t).toContain('Op L2 haal je 439 W uit het net, op L1 en L3 lever je terug. De meter telt de drie fasen bij elkaar op: per saldo lever je 49 W terug.');
  });

  it('11:08 bij Tim: per saldo haal je uit het net', () => {
    const fasen = [
      { fase: 1, w: -290, a: 1.2, v: 235 },
      { fase: 2, w: 2241, a: 9.5, v: 235 },
      { fase: 3, w: -151, a: 0.6, v: 236 },
    ];
    expect(tekst(<FasenNu fasen={fasen} net={1800} />)).toContain(
      'Op L2 haal je 2,2 kW uit het net, op L1 en L3 lever je terug. De meter telt de drie fasen bij elkaar op: per saldo haal je 1,8 kW uit het net.',
    );
  });

  it('alle fasen dezelfde kant op: geen zin over optellen', () => {
    const fasen = [
      { fase: 1, w: 312, a: 1.3, v: 235 },
      { fase: 2, w: 439, a: 1.9, v: 236 },
      { fase: 3, w: 0, a: 0, v: 234 },
    ];
    const t = tekst(<FasenNu fasen={fasen} net={751} />);
    expect(t).not.toContain('per saldo');
    expect(t).toContain('L3 0,0 A 0 W 234 V');
  });

  it('één fase: één balk, geen lege, en geen "zwaarst"', () => {
    const el = <FasenNu fasen={[{ fase: 1, w: 300, a: 1.3, v: null }]} />;
    expect(aantal(el, '<li')).toBe(1);
    expect(tekst(el)).toContain('Eén fase: alles loopt over L1.');
    expect(tekst(el)).not.toContain('zwaarst');
  });

  it('zonder fasen (een oudere brug) niets', () => {
    expect(renderToStaticMarkup(<FasenNu fasen={null} />)).toBe('');
  });
});

describe('belasting per fase op Vandaag', () => {
  const reeks = (a) => [a, a + 1, null];
  const dag = {
    van: Date.UTC(2026, 9, 29, 23),
    stapMs: 15 * 60_000,
    fasen: [
      { fase: 1, a: reeks(6), w: reeks(-1400), gemiddeldA: 6.2, piekA: 18.3 },
      { fase: 2, a: reeks(9), w: reeks(2000), gemiddeldA: 9.1, piekA: 22 },
      { fase: 3, a: reeks(2), w: reeks(400), gemiddeldA: 2.4, piekA: 7.5 },
    ],
    week: [
      { datum: '2026-10-28', fasen: [{ fase: 1, gemiddeldA: 5, piekA: 20 }, { fase: 2, gemiddeldA: 4, piekA: 15 }, { fase: 3, gemiddeldA: 6, piekA: 9 }] },
      { datum: '2026-10-29', fasen: [{ fase: 1, gemiddeldA: 7, piekA: 21 }, { fase: 2, gemiddeldA: 4, piekA: 14 }, { fase: 3, gemiddeldA: 6, piekA: 8 }] },
    ],
  };

  it('gemiddelde en piek per fase, en hoog en laag over vandaag en de dagen ervoor', () => {
    const t = tekst(<FasenVandaag dag={dag} slots={96} nu={dag.van + 3_600_000} />);
    expect(t).toContain('Fase Gemiddeld Piek Week');
    expect(t).toContain('L2 9,1 A 22,0 A 4,0 A');
    expect(t).toContain('Vandaag: L2 zit gemiddeld het hoogst, L3 het laagst.');
    expect(t).toContain('De 2 dagen ervoor: L1 zit gemiddeld het hoogst, L2 het laagst.');
    expect(t).toContain('Week is het gemiddelde over 2 eerdere dagen.');
  });

  it('zonder dagen ervoor nog geen weekkolom, wel wat er morgen bijkomt', () => {
    const t = tekst(<FasenVandaag dag={{ ...dag, week: [] }} slots={96} nu={dag.van} />);
    expect(t).not.toContain('Week');
    expect(t).toContain('Vanaf morgen staat hier ook');
  });

  it('één fase: geen zin over hoog en laag', () => {
    const t = tekst(<FasenVandaag dag={{ ...dag, fasen: dag.fasen.slice(0, 1), week: [] }} slots={96} nu={dag.van} />);
    expect(t).toContain('Belasting op L1');
    expect(t).toContain('Eén fase: alles loopt over L1.');
    expect(t).not.toContain('het hoogst');
  });

  it('zonder fasen niets', () => {
    expect(renderToStaticMarkup(<FasenVandaag dag={{ ...dag, fasen: null }} slots={96} nu={0} />)).toBe('');
  });
});
