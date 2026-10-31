import { describe, expect, it } from 'vitest';
import { bladPlek, veegDicht, veegStap, zetPaginaVast } from './blad';

/** Een veeg van begin tot eind, met de y-posities van de vinger. */
function veeg(ys, { scrollTop = 0, stapMs = 16 } = {}) {
  let staat = null;
  ys.forEach((y, i) => {
    staat = veegStap(staat, { y, scrollTop, t: i * stapMs });
  });
  return staat;
}

describe('het blad wegvegen', () => {
  it('omlaag vegen als het blad bovenaan staat: het gaat mee, en ver genoeg gaat het dicht', () => {
    const staat = veeg([300, 310, 360, 460]);
    expect(staat.modus).toBe('slepen');
    expect(staat.dy).toBe(160);
    expect(veegDicht(staat, { hoogte: 600, t: 3 * 16 })).toBe(true);
  });

  it('een klein stukje en langzaam: terug naar boven', () => {
    const staat = veeg([300, 310, 330, 340], { stapMs: 200 });
    expect(staat.modus).toBe('slepen');
    expect(veegDicht(staat, { hoogte: 600, t: 600 })).toBe(false);
  });

  it('kort maar vlot: ook dicht', () => {
    const staat = veeg([300, 320, 345], { stapMs: 20 });
    expect(veegDicht(staat, { hoogte: 600, t: 40 })).toBe(true);
  });

  it('omhoog vegen, of het blad is naar beneden gescrold: gewoon scrollen, niet dicht', () => {
    expect(veeg([300, 290, 200]).modus).toBe('scrollen');
    const gescrold = veeg([300, 320, 500], { scrollTop: 80 });
    expect(gescrold.modus).toBe('scrollen');
    expect(veegDicht(gescrold, { hoogte: 600, t: 32 })).toBe(false);
  });

  it('een tikje (minder dan een paar pixels) doet niets', () => {
    const staat = veeg([300, 302, 303]);
    expect(staat.modus).toBe('wacht');
    expect(veegDicht(staat, { hoogte: 600, t: 32 })).toBe(false);
  });

  it('een laag blad gaat al dicht bij een kwart van zijn hoogte', () => {
    expect(veegDicht(veeg([300, 310, 360], { stapMs: 300 }), { hoogte: 200, t: 600 })).toBe(true);
  });
});

describe('de pagina erachter staat stil', () => {
  it('vastzetten en terugzetten, met de plek waar je was', () => {
    const stijl = { position: '', top: '', left: '', right: '', overflow: '' };
    const gescrold = [];
    const win = { scrollY: 420, scrollTo: (x, y) => gescrold.push([x, y]) };
    const terug = zetPaginaVast({ body: { style: stijl } }, win);
    expect(stijl).toEqual({ position: 'fixed', top: '-420px', left: '0', right: '0', overflow: 'hidden' });
    terug();
    expect(stijl).toEqual({ position: '', top: '', left: '', right: '', overflow: '' });
    expect(gescrold).toEqual([[0, 420]]);
  });
});

describe('bladPlek: het blad dekt het aangetikte rondje niet af (weergave-17)', () => {
  const rondje = (top) => ({ top, bottom: top + 48 });
  it('telefoon: gewoon onderaan, zoals de CSS het doet', () => {
    expect(bladPlek({ breed: 390, hoog: 844, rondje: rondje(700) })).toEqual({ plek: 'onder', max: null });
  });
  it('vanaf 1024 px rechts naast de foto', () => {
    expect(bladPlek({ breed: 1280, hoog: 800, rondje: rondje(600) })).toEqual({ plek: 'naast', max: null });
  });
  it('tablet: rondje onderin, blad bovenaan en niet tot over het rondje', () => {
    const p = bladPlek({ breed: 820, hoog: 1180, rondje: rondje(900) });
    expect(p.plek).toBe('boven');
    expect(24 + p.max).toBeLessThanOrEqual(900);
  });
  it('tablet: rondje bovenin, blad onderaan en niet tot over het rondje', () => {
    const p = bladPlek({ breed: 820, hoog: 1180, rondje: rondje(300) });
    expect(p.plek).toBe('onder');
    expect(1180 - 24 - p.max).toBeGreaterThanOrEqual(348);
  });
  it('nooit hoger dan 80% van het scherm, nooit lager dan 240 px; zonder rondje (een tegel op Nu) gewoon onderaan', () => {
    expect(bladPlek({ breed: 820, hoog: 1180, rondje: rondje(1100) }).max).toBe(Math.round(1180 * 0.8));
    expect(bladPlek({ breed: 900, hoog: 500, rondje: rondje(260) }).max).toBe(240);
    expect(bladPlek({ breed: 820, hoog: 1180, rondje: null })).toEqual({ plek: 'onder', max: null });
  });
});
