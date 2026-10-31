import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BatterijIcoon, PuntIcoon } from '@/components/iconen';
import { ringTekst, ringVoor, streepjesVoor } from './ringen';

/** vermogen() zet een vaste spatie tussen getal en eenheid. */
const gewoon = (tekst) => tekst.replace(/\s/g, ' ');

describe('vier streepjes', () => {
  it('0, 25, 50, 75 en 100% precies; daartussen het dichtstbij', () => {
    const uit = [0, 12, 13, 17, 25, 37, 38, 50, 62, 63, 75, 87, 88, 100].map(streepjesVoor);
    expect(uit).toEqual([0, 0, 1, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4]);
    expect(streepjesVoor(-3)).toBe(0);
    expect(streepjesVoor(120)).toBe(4);
    expect(streepjesVoor(null)).toBe(null);
    expect(streepjesVoor(Number.NaN)).toBe(null);
  });

  it('het icoon tekent zoveel streepjes als het percentage zegt, en geen vage lege (bij 10% is hij echt leeg)', () => {
    const html = (procent) => renderToStaticMarkup(createElement(BatterijIcoon, { procent }));
    // Elk streepje is een gevuld rechthoekje (fill="currentColor"); de buitenkant heeft geen vulling.
    const vol = (tekst) => (tekst.match(/fill="currentColor"/g) ?? []).length;
    expect(vol(html(17))).toBe(1);
    expect(vol(html(63))).toBe(3);
    expect(vol(html(100))).toBe(4);
    expect(vol(html(0))).toBe(0);
    expect(vol(html(10))).toBe(0);
    expect(html(63)).toContain('data-streepjes="3"');
    // Zonder percentage (een lijst bij Instellingen): een gewone halfvolle batterij.
    expect(vol(html(undefined))).toBe(2);
    // Via PuntIcoon gaat het percentage alleen naar de batterij.
    expect(renderToStaticMarkup(createElement(PuntIcoon, { punt: { soort: 'batterij' }, procent: 88 }))).toContain('data-streepjes="4"');
    expect(renderToStaticMarkup(createElement(PuntIcoon, { punt: { soort: 'zon' }, procent: 88 }))).not.toContain('procent');
  });
});

describe('de ring om een rondje', () => {
  const batterij = { soort: 'batterij', max_w: 2400 };

  it('batterij: hoe hard hij laadt of levert, tegen zijn maximum', () => {
    expect(ringVoor(batterij, 1700)).toEqual({ deel: 1700 / 2400, soort: 'leveren' });
    expect(ringVoor(batterij, -1200)).toEqual({ deel: 0.5, soort: 'laden' });
    expect(ringVoor(batterij, 3000)).toEqual({ deel: 1, soort: 'leveren' });
    expect(ringVoor(batterij, 2)).toEqual({ deel: 0, soort: 'stil' });
    expect(ringVoor(batterij, null)).toEqual({ deel: 0, soort: 'stil' });
    expect(ringVoor({ ...batterij, max_w: 3600 }, -1800)).toEqual({ deel: 0.5, soort: 'laden' });
  });

  it('zon: wat de panelen leveren tegen hun maximum; zonder maximum geen ring', () => {
    expect(ringVoor({ soort: 'zon', max_w: 8000 }, 976)).toEqual({ deel: 976 / 8000, soort: 'zon' });
    expect(ringVoor({ soort: 'zon', max_w: 3000 }, 3400)).toEqual({ deel: 1, soort: 'zon' });
    expect(ringVoor({ soort: 'zon', max_w: 3000 }, 0)).toEqual({ deel: 0, soort: 'zon' });
    expect(ringVoor({ soort: 'zon', max_w: null }, 976)).toBe(null);
    expect(ringVoor({ soort: 'zon' }, 976)).toBe(null);
    expect(ringVoor({ soort: 'net', max_w: 5000 }, 976)).toBe(null);
  });

  it('in woorden, voor wie de foto niet ziet', () => {
    expect(gewoon(ringTekst(ringVoor(batterij, 1200), 2400))).toBe('levert op 50% van 2,4 kW');
    expect(gewoon(ringTekst(ringVoor(batterij, -600), 2400))).toBe('laadt op 25% van 2,4 kW');
    expect(ringTekst(ringVoor(batterij, 0), 2400)).toBe('staat stil');
    expect(gewoon(ringTekst(ringVoor({ soort: 'zon', max_w: 8000 }, 976), 8000))).toBe('12% van 8,0 kW');
    expect(ringTekst(null, 8000)).toBe('');
  });
});
