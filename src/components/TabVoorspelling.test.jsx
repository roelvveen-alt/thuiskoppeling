import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { standUitRij } from '@/lib/bron';
import { nepWeer } from '@/lib/morgenProef';
import { puntenVoor } from '@/lib/opstelling';
import { TABS, tabUit } from './Tabbalk';
import TabVoorspelling from './TabVoorspelling';

/** Vrijdag 30 oktober 2026, 14:00 in Nederland. */
const NU = Date.parse('2026-10-30T13:00:00Z');

/** Een meting zoals Base44 hem bewaart, met het weer van een programmaatje 0.9.0 (alleen straling, bewolking en temperatuur). */
function rijMetWeer({ oud }) {
  const w = nepWeer({ vandaag: '2026-10-30', opgehaald: NU - 600_000, oud });
  return {
    moment: new Date(NU).toISOString(),
    net_w: 100,
    zon_w: 1500,
    zonnen: [{ sleutel: 'zon', naam: 'Zon', vermogen_w: 1500 }],
    weer: {
      van: new Date(w.van).toISOString(),
      stap_min: 60,
      straling_wm2: w.straling,
      bewolking_pct: w.bewolking,
      temp_c: w.temp.map((t) => Math.round(t * 10) / 10),
      ...(oud ? {} : { weercode: w.code, neerslag_mm: w.neerslag, neerslag_kans_pct: w.kans, windstoten_kmh: w.stoten }),
      opgehaald: new Date(w.opgehaald).toISOString(),
      bron: 'open-meteo',
    },
  };
}

const render = (props) => renderToStaticMarkup(<TabVoorspelling dagen={[]} nu={NU} huisId="huis-dirk001" eigenaar metVoorbeeld={false} onNamen={() => {}} {...props} />);

describe('het tabblad Voorspelling', () => {
  it('tussen Huis en Nu, en onthouden zoals de andere', () => {
    expect(TABS.map((t) => t.sleutel)).toEqual(['huis', 'voorspelling', 'nu', 'overzicht', 'apparaten']);
    expect(tabUit('voorspelling')).toBe('voorspelling');
  });

  it('bij Dirk (één kWh-meter, geen vermogen, programmaatje 0.9.0): het weer zonder regen, de vraag om het vermogen en dat bijwerken meer laat zien', () => {
    const stand = standUitRij(rijMetWeer({ oud: true }));
    const html = render({ stand, punten: puntenVoor({}, stand) });
    expect(html).toContain('Morgen, zaterdag 31 oktober');
    expect(html).toContain('Werk het programmaatje bij naar 0.10.0');
    expect(html).toContain('weet ik pas na een paar uur zon');
    expect(html).toContain('Vermogen invullen');
    expect(html).not.toContain('kWh verwacht');
  });

  it('met het vermogen ingevuld en programmaatje 0.10.0: het getal van morgen, zonder de bijwerk-zin; een kijker krijgt geen knop', () => {
    const stand = standUitRij(rijMetWeer({ oud: false }));
    const punten = puntenVoor({ vermogens: { zon: 2400 } }, stand);
    const html = render({ stand, punten, eigenaar: false, onNamen: null });
    expect(html).toContain('kWh verwacht');
    expect(html).not.toContain('Werk het programmaatje bij');
    expect(html).not.toContain('Vermogen invullen');
    expect(html).toContain('Zon per uur, morgen');
  });

  it('nog geen cijfers: wat het scherm daarvoor geeft', () => {
    expect(render({ stand: null, punten: [], zonderCijfers: <p>laden</p> })).toBe('<p>laden</p>');
  });
});
