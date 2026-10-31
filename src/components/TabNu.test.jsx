import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { standUitRij } from '@/lib/bron';
import { LEGE_OPSTELLING, puntenVoor } from '@/lib/opstelling';
import { verdeelStroom } from '@/lib/stroom';
import TabNu, { staatNu } from './TabNu';

/** Zonder opmaak, met gewone spaties. */
const tekst = (el) =>
  renderToStaticMarkup(el)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|\s/g, ' ')
    .replace(/ +/g, ' ')
    .trim();

const toon = (rij, metPunten = false) => {
  const stand = standUitRij(rij);
  const punten = metPunten ? puntenVoor(LEGE_OPSTELLING, stand) : [];
  return tekst(<TabNu stand={stand} verdeling={verdeelStroom(stand)} punten={punten} onKies={() => {}} />);
};

describe('Nu: de cijfers, in de volgorde van de keten, zonder alles drie keer te zeggen', () => {
  it('11:02 bij Tim: de tegels zon, batterij, huis, net, en wie aan wie levert met dezelfde getallen', () => {
    const t = toon({
      moment: '2026-10-30T10:02:00Z',
      zon_w: 1134,
      zonnen: [
        { sleutel: 'hw-zon-batterij', naam: 'Hoofddak', vermogen_w: 701 },
        { sleutel: 'hw-zon-dierenverblijf', naam: 'Dierenverblijf', vermogen_w: 433 },
      ],
      batterij_w: -627,
      batterij_procent: 7,
      net_w: -49,
      fasen: [
        { fase: 1, w: -312, a: 1.3, v: 235 },
        { fase: 2, w: 439, a: 1.9, v: 236 },
        { fase: 3, w: -175, a: 0.7, v: 234 },
      ],
    }, true);
    // Nu in woorden staat op Huis, niet hier nog eens.
    expect(t).not.toContain('Nu in woorden');
    expect(t).toMatch(/Zon 1,1 kW .*Batterij 627 W Laadt nu 7% .*Huis 458 W Gebruikt nu .*Net 49 W Je levert nu terug/);
    // De kop van het net zonder "· terugleveren": dat staat er al onder.
    expect(t).not.toMatch(/Net · /);
    expect(t).toMatch(/Zon → naar Batterij 627 W.*Zon → naar Huis 458 W.*Zon → naar Net 49 W/);
    expect(t).toContain('per saldo lever je 49 W terug.');
  });

  it('binnen ±20 W zegt geen tegel dat er stroom naar het net gaat', () => {
    const t = toon({ moment: '2026-10-30T10:02:00Z', zon_w: 1000, batterij_w: -535, net_w: -15 }, true);
    expect(t).toContain('Er gaat bijna niets in of uit');
    expect(t).not.toMatch(/Je levert nu terug|→ naar Net/);
  });

  it('één kaart Geld: per uur, de prijs nu en de Zonnebonus samen', () => {
    const t = toon({ moment: '2026-10-30T10:02:00Z', net_w: 2000, prijs: { afname_kwh: 0.25, teruglevering_kwh: 0.1, zonnebonus_kwh: 0.02 }, jaar: { teruglevering_kwh: 1000, plafond_kwh: 7500 } });
    expect(t).toMatch(/Geld € 0,50 per uur Je betaalt nu € 0,50 per uur\. Stroom kost nu € 0,250 per kWh/);
    expect(t).toContain('Zonnebonus dit jaar: 1.000 kWh van 7.500 kWh');
    expect(t).not.toMatch(/Geld nu|Stroomprijs nu|ZONNEBONUS DIT JAAR/);
  });

  it('de apparaten met hun eigen meter staan hier (niet meer op Huis)', () => {
    const t = toon({ moment: '2026-10-30T10:02:00Z', net_w: 600, apparaten: [{ sleutel: 'hw-spa', naam: 'Spa', vermogen_w: 300 }] });
    expect(t).toMatch(/Apparaten Spa 300 W Niet apart gemeten/);
  });
});

describe('staatNu', () => {
  it('dezelfde drempels als de tekening', () => {
    expect(staatNu('zon', 3)).toBe('Levert nu niets');
    expect(staatNu('batterij', 4)).toBe('Laadt niet en levert niets');
    expect(staatNu('batterij', 400)).toBe('Levert nu');
    expect(staatNu('net', 19)).toBe('Er gaat bijna niets in of uit');
    expect(staatNu('net', 21)).toBe('Je neemt nu af');
    expect(staatNu('net', null)).toBe('Geen meter gekoppeld');
  });
});

describe('het net op Nu, met de Zendure P1 als reserve', () => {
  it('beide meters: ze staan naast elkaar', () => {
    const t = toon({ moment: '2026-10-30T09:00:00Z', net_w: -1900, net_bron: 'homewizard', net_zendure_w: -1890 });
    expect(t).toMatch(/HomeWizard 1,9 kW · Zendure 1,9 kW/);
    expect(t).not.toMatch(/antwoordt niet/);
  });

  it('HomeWizard weg: zegt dat de cijfers van de Zendure P1 komen, zonder twee keer hetzelfde getal', () => {
    const t = toon({ moment: '2026-10-30T09:00:00Z', net_w: -1890, net_bron: 'zendure-p1', net_zendure_w: -1890 });
    expect(t).toMatch(/HomeWizard P1 antwoordt niet · cijfers van de Zendure P1/);
    expect(t).not.toMatch(/HomeWizard 1,9 kW · Zendure/);
  });

  it('wie aan wie levert, ook als een plek met panelen (nog) geen punt heeft', () => {
    const t = toon({ moment: '2026-10-30T10:02:00Z', zonnen: [{ sleutel: 'z', naam: 'Zon', vermogen_w: 1134 }], batterij_w: -627, net_w: -49 });
    expect(t).toMatch(/Zon → naar Batterij 627 W/);
  });

  it('een onbekende bron uit een vreemd antwoord telt niet', () => {
    expect(standUitRij({ net_bron: 'iets' }).net_bron).toBe(null);
    expect(standUitRij({}).net_bron).toBe(null);
  });
});

describe('eigen namen uit Namen', () => {
  it('heet het net Meterkast, dan ook op Nu en bij wie aan wie levert', () => {
    const stand = standUitRij({ moment: '2026-10-30T10:02:00Z', zon_w: 0, batterij_w: 0, net_w: 600 });
    const punten = puntenVoor({ ...LEGE_OPSTELLING, namen: { net: 'Meterkast' } }, stand);
    const t = tekst(<TabNu stand={stand} verdeling={verdeelStroom(stand)} punten={punten} onKies={() => {}} />);
    expect(t).toContain('Meterkast → naar Huis 600 W');
    expect(t).not.toMatch(/\bNet → /);
  });
});

describe('groot scherm: de vier tegels niet uitgerekt (weergave-17)', () => {
  it('zon, batterij, huis en net zijn op een groot scherm zo hoog als hun inhoud; de brede kaarten niet', () => {
    const stand = standUitRij({ moment: '2026-10-30T10:02:00Z', zon_w: 2000, batterij_w: -300, batterij_procent: 50, net_w: 100 });
    const html = renderToStaticMarkup(<TabNu stand={stand} verdeling={verdeelStroom(stand)} punten={[]} onKies={() => {}} />);
    const tegels = html.match(/<(button|div)[^>]*class="tegel [^"]*"/g);
    const vier = tegels.slice(0, 4);
    for (const t of vier) expect(t).toContain('lg:self-start');
    expect(tegels.at(-1)).not.toContain('lg:self-start');
    expect(html).toContain('lg:grid-cols-4 lg:items-start');
  });
});
