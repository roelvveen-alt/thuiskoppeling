import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LEGE_OPSTELLING, puntenVoor, zetNaam } from '@/lib/opstelling';
import { verdeelStroom } from '@/lib/stroom';
import HuisWoorden from './HuisWoorden';

/** vermogen() zet een vaste spatie tussen getal en eenheid. */
const gewoon = (tekst) => tekst.replace(/\s/g, ' ');

describe('het tabblad Huis naast de tekening', () => {
  const tim = {
    zon_w: 1134,
    zonnen: [
      { sleutel: 'hw-zon-batterij', naam: 'zon + batterij', vermogen_w: 701 },
      { sleutel: 'hw-zon-dierenverblijf', naam: 'Zon dierenverblijf', vermogen_w: 433 },
    ],
    batterij_w: -627,
    batterij_procent: 7,
    net_w: -49,
    prijs: { afname_kwh: 0.25, teruglevering_kwh: 0.1 },
    apparaten: [{ sleutel: 'hw-spa', naam: 'Spa', vermogen_w: 300 }],
  };
  const punten = puntenVoor(zetNaam(LEGE_OPSTELLING, 'hw-zon-batterij', 'Hoofddak'), tim);
  const html = renderToStaticMarkup(<HuisWoorden stand={tim} verdeling={verdeelStroom(tim)} punten={punten} onNu={() => {}} />);
  const t = gewoon(html.replace(/<[^>]+>/g, ' ')).replace(/ +/g, ' ');

  it('alleen Nu in woorden en een knop naar Nu: geen tegels, geen geld, geen apparaten (die staan op Nu)', () => {
    expect(t).toContain('Nu in woorden');
    expect(t).toContain('Daarvan laadt 627 W de batterij en gebruikt je huis 458 W.');
    expect(t).toContain('Alle cijfers van nu');
    expect(t).not.toContain('Zon 1,1 kW');
    expect(t).not.toMatch(/per uur|Stroomprijs|Spa/);
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*class="knop/);
  });
});
