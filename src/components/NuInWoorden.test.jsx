import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LEGE_OPSTELLING, puntenVoor, zetNaam } from '@/lib/opstelling';
import { verdeelStroom } from '@/lib/stroom';
import NuInWoorden from './NuInWoorden';

/** Zonder opmaak, met gewone spaties. */
const tekst = (html) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|\s/g, ' ')
    .replace(/ +/g, ' ')
    .trim();

/** Tims stand van 11:02, met de namen zoals ze van thuis komen. */
const TIM = {
  zon_w: 1134,
  zonnen: [
    { sleutel: 'hw-zon-batterij', naam: 'zon + batterij', vermogen_w: 701 },
    { sleutel: 'hw-zon-dierenverblijf', naam: 'Zon dierenverblijf', vermogen_w: 433 },
  ],
  batterij_w: -627,
  batterij_procent: 7,
  net_w: -49,
};

const toon = (stand, punten = puntenVoor(zetNaam(LEGE_OPSTELLING, 'hw-zon-batterij', 'Hoofddak'), stand), extra = {}) =>
  renderToStaticMarkup(<NuInWoorden stand={stand} verdeling={verdeelStroom(stand)} punten={punten} {...extra} />);

describe('de kaart Nu in woorden', () => {
  it('de keten met per zin een plaatje in de kleur van zijn soort, en daaronder wat erbij hoort', () => {
    const html = toon(TIM);
    expect(tekst(html)).toBe(
      'Nu in woorden De zon levert 1.134 W (Hoofddak 701 W + Dierenverblijf 433 W). Daarvan laadt 627 W de batterij en gebruikt je huis 458 W. De rest, 49 W, gaat naar het net. De batterij is bijna leeg (7%).',
    );
    expect(html.split('<li').length - 1).toBe(4);
    expect(html.indexOf('var(--zon)')).toBeLessThan(html.indexOf('var(--batterij)'));
    expect(html.indexOf('var(--batterij)')).toBeLessThan(html.indexOf('var(--net)'));
    // Lucide-plaatjes, verborgen voor de schermlezer: de zin zegt het al.
    expect(html).toContain('lucide-sun');
    expect(html).toMatch(/aria-hidden="true"/);
    expect(html).toContain('rounded-2xl');
  });

  it('in een blad zonder rand', () => {
    expect(toon(TIM, undefined, { kaart: false })).not.toContain('rounded-2xl');
  });

  it('niets te zeggen: geen lege kaart', () => {
    expect(toon({ zon_w: null, zonnen: [], batterij_w: null, net_w: null }, [])).toBe('');
    expect(renderToStaticMarkup(<NuInWoorden stand={null} verdeling={verdeelStroom(null)} />)).toBe('');
  });

  it('zonder eigen naam: de naam van thuis zonder "Zon" ervoor', () => {
    expect(tekst(toon(TIM, puntenVoor(LEGE_OPSTELLING, TIM)))).toContain('(Zon + batterij 701 W + Dierenverblijf 433 W)');
  });

  it('een fase boven de grens: rustig erbij, in let-op, met de grenzen van het huis', () => {
    const stand = { ...TIM, fasen: [{ fase: 1, a: 2 }, { fase: 2, a: 23.7 }] };
    const html = toon(stand);
    expect(tekst(html)).toContain('L2 trekt nu 23,7 A, dicht bij de 25 A van de zekering.');
    expect(html).toContain('text-let-op');
    expect(toon(stand, undefined, { grenzen: { grens: 30, zekering: 35 } })).not.toContain('text-let-op');
  });
});
