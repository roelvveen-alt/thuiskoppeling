import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { standUitRij } from '@/lib/bron';
import Lampen from './Lampen';
import TabApparaten from './TabApparaten';

const RIJ = {
  moment: '2026-10-30T20:00:00Z',
  apparaten: [{ sleutel: 'tuya-pomp', naam: 'Pomp', soort: 'pomp', vermogen_w: 412 }],
  lampen: [
    { sleutel: 'tuya-spots-overstek', naam: 'Spots overstek', soort: 'lamp', aan: true, helderheid: 64, rol: 'spots' },
    { sleutel: 'tuya-lamp-schuur', naam: 'Lamp schuur', soort: 'schakelaar', aan: false },
    { sleutel: 'tuya-tuin', naam: 'Tuin', soort: 'lamp', aan: null },
  ],
};

describe('Lampen bij Apparaten', () => {
  it('aan, uit of weet niet, in woorden; geen knoppen (de app kijkt alleen)', () => {
    const html = renderToStaticMarkup(<Lampen lampen={standUitRij(RIJ).lampen} />);
    expect(html).toContain('Spots overstek');
    expect(html).toContain('aan · 64%');
    expect(html).toContain('spots in het overstek');
    expect(html).toContain('uit');
    expect(html).toContain('weet niet');
    expect(html).not.toMatch(/<button|<input/);
  });

  it('zonder lampen (een oudere versie): niets', () => {
    expect(renderToStaticMarkup(<Lampen lampen={standUitRij({ ...RIJ, lampen: undefined }).lampen} />)).toBe('');
  });

  it('staat op het tabblad Apparaten', () => {
    const html = renderToStaticMarkup(<TabApparaten stand={standUitRij(RIJ)} nu={Date.parse('2026-10-30T20:00:05Z')} />);
    expect(html).toContain('Lampen en schakelaars');
  });
});
