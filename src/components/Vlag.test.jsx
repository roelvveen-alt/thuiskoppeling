// @vitest-environment happy-dom
import fs from 'node:fs';
import path from 'node:path';
import { render } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { weerBeeld } from '@/lib/weerBeeld';
import HuisTekening, { LUSSEN, VLAG_KOLOMMEN, VLAG_RIJEN, vlagGolf, vlagStand } from './HuisTekening';

const NU = Date.parse('2026-10-30T12:00:00Z');
const weer = (wind, stoten = wind) => weerBeeld({ nu: { code: 2, neerslag: 0, wind, stoten, bewolking: null }, opgehaald: NU }, NU);
const garage = (w, dag = true) => renderToStaticMarkup(<HuisTekening soort="garage" dag={dag} weer={w} />);
const doc = (html) => new DOMParser().parseFromString(html, 'image/svg+xml');

describe('de vlag volgt de wind', () => {
  it('vier standen: slap, wapperen, stevig, storm', () => {
    expect(vlagStand(null)).toBe('slap');
    expect(vlagStand(weer(5, 8))).toBe('slap');
    expect(vlagStand(weer(11, 15))).toBe('slap');
    expect(vlagStand(weer(12, 20))).toBe('wapper');
    expect(vlagStand(weer(38, 50))).toBe('wapper');
    expect(vlagStand(weer(39, 50))).toBe('stevig');
    // Harde windstoten tellen als stevig, zoals bij de molen.
    expect(vlagStand(weer(30, 65))).toBe('stevig');
    expect(vlagStand(weer(62, 70))).toBe('storm');
    expect(vlagStand(weer(40, 95))).toBe('storm');
  });

  it('wapperen gaat sneller naarmate het harder waait; slap beweegt niet; storm trilt alleen aan het uiteinde', () => {
    expect(vlagGolf('slap')).toBeNull();
    const zacht = vlagGolf('wapper', 12);
    const harder = vlagGolf('wapper', 30);
    expect(zacht.duur).toBe(2200);
    expect(harder.duur).toBeLessThan(zacht.duur);
    expect(vlagGolf('wapper', 39).duur).toBe(1200);
    expect(vlagGolf('stevig').duur).toBeLessThan(vlagGolf('wapper', 39).duur);
    expect(vlagGolf('storm').stroken).toEqual([VLAG_KOLOMMEN - 2, VLAG_KOLOMMEN - 1]);
    expect(vlagGolf('storm').hoog).toBeLessThan(vlagGolf('stevig').hoog);
  });

  it('op de tekening: de stand op de vlag, en alleen de bewegende stroken een lus', () => {
    const lussen = (html) => doc(html).querySelectorAll('.vlag-strook[data-lus="golf"]').length;
    expect(garage(null)).toContain('data-vlag="slap"');
    expect(lussen(garage(null))).toBe(0);
    expect(garage(weer(25))).toContain('class="vlag-doek" data-stand="wapper"');
    expect(lussen(garage(weer(25)))).toBe(VLAG_KOLOMMEN);
    expect(lussen(garage(weer(45)))).toBe(VLAG_KOLOMMEN);
    expect(garage(weer(70))).toContain('data-vlag="storm"');
    expect(lussen(garage(weer(70)))).toBe(2);
  });

  it('de stand staat in de CSS als vaste vorm (dus ook bij minder beweging); storm is strak horizontaal', () => {
    const css = fs.readFileSync(path.resolve(import.meta.dirname, '../index.css'), 'utf8');
    for (const stand of ['slap', 'wapper', 'stevig']) expect(css).toMatch(new RegExp(`\\.vlag-doek\\[data-stand="${stand}"\\] \\{\\s*transform: skewY`));
    expect(css).not.toMatch(/\.vlag-doek\[data-stand="storm"\]/);
    expect(css).not.toMatch(/@keyframes (golf|vallen|twinkel)/);
  });
});

describe('de vlag', () => {
  it('4 rijen van 6 blokjes, effen, in de verhouding 2:3', () => {
    const svg = doc(garage(weer(25)));
    const stroken = [...svg.querySelectorAll('.vlag-strook')];
    expect(stroken).toHaveLength(VLAG_KOLOMMEN);
    const blokken = stroken.map((s) => [...s.querySelectorAll('rect')]);
    for (const kolom of blokken) expect(kolom).toHaveLength(VLAG_RIJEN);
    // Kolom 0 is die bij de mast (rechts, x vlak links van 0); rij 0 bovenaan.
    expect(Number(blokken[0][0].getAttribute('x'))).toBeGreaterThan(Number(blokken[1][0].getAttribute('x')));
    expect(new Set(blokken.flat().map((b) => b.getAttribute('fill'))).size).toBe(1);
    const breed = VLAG_KOLOMMEN * Number(blokken[0][0].getAttribute('height').slice(0, 3));
    const hoog = VLAG_RIJEN * Number(blokken[0][0].getAttribute('height').slice(0, 3));
    expect(breed / hoog).toBe(1.5);
  });

  it("de kleuren komen uit de kleursets (overdag fel, 's nachts gedempt)", () => {
    const kleuren = (dag) => [...new Set([...doc(garage(weer(25), dag)).querySelectorAll('.vlag-strook rect')].map((r) => r.getAttribute('fill')))];
    expect(kleuren(true)).toEqual(['#d9433a']);
    expect(kleuren(false)).toEqual(['#6e2b27']);
  });

  it('een slanke mast met een knop erop', () => {
    const svg = doc(garage(null));
    const mast = svg.querySelector('[data-vlag] > rect');
    expect(Number(mast.getAttribute('width'))).toBeLessThan(0.7);
    expect(Number(mast.getAttribute('y'))).toBeLessThan(44);
    expect(svg.querySelector('[data-vlag] > circle')).not.toBeNull();
  });
});

describe('de lussen lopen met Web Animations, en staan stil als het moet', () => {
  afterEach(() => vi.restoreAllMocks());
  const nep = () => {
    const animaties = [];
    vi.spyOn(Element.prototype, 'animate').mockImplementation(function animate(frames, opties) {
      const a = { el: this, frames, opties, cancel: vi.fn() };
      animaties.push(a);
      return a;
    });
    return animaties;
  };
  // happy-dom kent Element.animate niet altijd: dan eerst een lege.
  if (!Element.prototype.animate) Element.prototype.animate = () => ({ cancel() {} });

  it('wapperen: elke strook een golf, iets later naarmate hij verder van de mast is', () => {
    const animaties = nep();
    render(<HuisTekening soort="garage" dag weer={weer(25)} />);
    const golven = animaties.filter((a) => a.el.classList.contains('vlag-strook'));
    expect(golven).toHaveLength(VLAG_KOLOMMEN);
    expect(golven[0].opties).toMatchObject({ iterations: Infinity, direction: 'alternate' });
    expect(golven[1].opties.delay).toBeLessThan(golven[0].opties.delay);
    expect(golven[0].frames.every((f) => Object.keys(f).every((k) => ['transform'].includes(k)))).toBe(true);
  });

  it('stil (uit beeld, blad erover, minder beweging): geen enkele animatie; weer los: weer aan', () => {
    const animaties = nep();
    const { rerender } = render(<HuisTekening soort="garage" dag weer={weer(25)} stil />);
    expect(animaties).toHaveLength(0);
    rerender(<HuisTekening soort="garage" dag weer={weer(25)} stil={false} />);
    expect(animaties.length).toBeGreaterThan(0);
    rerender(<HuisTekening soort="garage" dag weer={weer(25)} stil />);
    expect(animaties.every((a) => a.cancel.mock.calls.length === 1)).toBe(true);
  });

  it('harde wind: de bomen wiegen en de hagen buigen mee; zonder wind staan ze stil', () => {
    const animaties = nep();
    const storm = weerBeeld({ nu: { code: 3, neerslag: 0, wind: 70, stoten: 90 }, opgehaald: NU }, NU);
    const { rerender } = render(<HuisTekening soort="huis" dag weer={storm} />);
    const wieg = animaties.filter((a) => a.el.classList.contains('boom-wieg'));
    const buig = animaties.filter((a) => a.el.classList.contains('haag-wieg'));
    expect(wieg.length).toBeGreaterThan(0);
    expect(buig.length).toBeGreaterThan(0);
    expect(wieg[0].frames[1].transform).toBe('rotate(4deg)');
    expect(animaties.filter((a) => a.el.getAttribute('data-lus') === 'waai').length).toBeGreaterThan(0);
    animaties.length = 0;
    rerender(<HuisTekening soort="huis" dag weer={weer(5)} />);
    expect(animaties.filter((a) => a.el.classList.contains('boom-wieg') || a.el.classList.contains('haag-wieg'))).toHaveLength(0);
  });

  it('regen en sterren ook als lus, alleen met transform en opacity', () => {
    const nacht = (w) => renderToStaticMarkup(<HuisTekening soort="huis" dag={false} weer={w} />);
    const regen = weerBeeld({ nu: { code: 63, neerslag: 2, wind: 10, stoten: 15 }, opgehaald: NU }, NU);
    expect(nacht(regen)).toMatch(/class="neerslag"[^>]*data-lus="vallen" data-lus-duur="900"/);
    expect(nacht(null)).toMatch(/class="ster" data-lus="twinkel"/);
    for (const lus of Object.values(LUSSEN)) {
      const el = { dataset: { opzij: '-5', golf: '0.3' } };
      for (const f of lus(el).frames) for (const k of Object.keys(f)) expect(['transform', 'opacity', 'offset']).toContain(k);
    }
  });
});
