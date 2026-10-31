import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { standUitRij } from '@/lib/bron';
import { verdeelStroom } from '@/lib/stroom';
import BatterijGegevens from './BatterijGegevens';
import Detail from './Detail';
import TabApparaten from './TabApparaten';

/** Zonder opmaak, met gewone spaties. */
const tekst = (el) =>
  renderToStaticMarkup(el)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|\s/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\u2212/g, '-')
    .replace(/ +/g, ' ')
    .trim();

const INFO = { temp_c: 24.3, temp_min_c: 22.5, behuizing_c: 38.4, spanning_v: 52.1, stroom_a: 44.1, laadgrens_pct: 100, ontlaadgrens_pct: 10, vol_over_min: 99, wifi_dbm: -58, pakketten: 3, inhoud_kwh: 8.64, verwarmt: false, storing: false };
const RIJ = {
  moment: '2026-10-30T01:30:00Z',
  net_w: 2900,
  batterij_w: -2300,
  batterij_procent: 37,
  batterij_info: INFO,
  gekoppeld: [{ sleutel: 'zendure', naam: 'Zendure-batterij', merk: 'Zendure', soort: 'SolarFlow 2400 AC', rol: 'batterij', manier: 'lokaal', adres: '192.168.1.63', ok: true, w: -2300 }],
  brug: { versie: '0.5.0', gestart: '2026-10-30T00:00:00Z', elke_seconden: 5, prijzen: 'Zonneplan' },
};

describe('BatterijGegevens', () => {
  it('in het blad: een kopje en alles in gewone woorden', () => {
    const t = tekst(<BatterijGegevens info={INFO} brugVersie="0.5.0" />);
    expect(t).toMatch(/Wat de batterij zelf meldt/);
    expect(t).toMatch(/Temperatuur accu's 23–24 °C binnenin de Zendure 38 °C/);
    expect(t).toMatch(/Spanning 52,1 V stroom 44,1 A/);
    expect(t).toMatch(/Laadt tot 100% · ontlaadt tot 10%/);
    expect(t).toMatch(/Vol over ongeveer 1 uur 40 min/);
    expect(t).toMatch(/Wifi-signaal goed \(-58 dBm\)/);
    expect(t).toMatch(/3 accu's · samen 8,64 kWh/);
    expect(t).not.toMatch(/storing|Verwarmt/);
  });

  it('per accu een regel met een eigen icoon (brug 0.7.0)', () => {
    const accus = [1, 2, 3].map((nr) => ({ nr, temp_c: 22 + nr, procent: 40 - nr }));
    const html = renderToStaticMarkup(<BatterijGegevens info={{ ...INFO, accus }} brugVersie="0.7.0" />);
    const t = tekst(<BatterijGegevens info={{ ...INFO, accus }} brugVersie="0.7.0" />);
    expect(t).toMatch(/Binnenin de Zendure 38 °C Accu 1 · 23 °C · 39% Accu 2 · 24 °C · 38% Accu 3 · 25 °C · 37%/);
    expect(t).not.toMatch(/Temperatuur accu's/);
    // Hetzelfde batterij-icoon als in de rest van de app, met de streepjes naar hoe vol die accu is.
    expect(html.match(/data-streepjes="\d"/g)).toHaveLength(3);
    const vol = renderToStaticMarkup(<BatterijGegevens info={{ ...INFO, accus: [{ nr: 1, procent: 95 }] }} brugVersie="0.7.0" />);
    expect(vol).toContain('data-streepjes="4"');
  });

  it('een storing in de let-op-kleur, de rest in de kleur van de batterij', () => {
    const html = renderToStaticMarkup(<BatterijGegevens info={{ storing: true, temp_c: 20 }} />);
    expect(html).toMatch(/color:var\(--let-op\)[^<]*>[^<]*<svg/);
    expect(tekst(<BatterijGegevens info={{ storing: true }} />)).toMatch(/De batterij meldt een storing kijk in de Zendure-app/);
  });

  it('zonder gegevens: niets, of bij een oudere brug een zinnetje (op Apparaten met hoe je bijwerkt)', () => {
    expect(renderToStaticMarkup(<BatterijGegevens info={null} brugVersie="0.5.0" />)).toBe('');
    expect(renderToStaticMarkup(<BatterijGegevens info={null} />)).toBe('');
    expect(tekst(<BatterijGegevens info={null} brugVersie="0.4.0" />)).toMatch(/Met versie 0\.5\.0 van het programmaatje zie je hier ook de temperatuur/);
    expect(tekst(<BatterijGegevens info={null} brugVersie="0.4.0" compact />)).toContain('bovenaan bij Het programmaatje thuis');
    expect(tekst(<BatterijGegevens info={null} brugVersie="0.4.0" />)).toContain('Hoe je het bijwerkt, staat op Apparaten.');
    expect(tekst(<BatterijGegevens info={null} brugVersie="0.4.0" opdracht={false} />)).toContain('De eigenaar weet hoe');
    expect(tekst(<BatterijGegevens info={null} brugVersie="0.4.0" compact />)).not.toContain('git pull');
  });
});

describe('waar het staat', () => {
  it('in het blad van de batterij, en niet in dat van het net', () => {
    const stand = standUitRij(RIJ);
    const verdeling = verdeelStroom(stand);
    const punten = [
      { sleutel: 'batterij', soort: 'batterij', naam: 'Batterij' },
      { sleutel: 'net', soort: 'net', naam: 'Net' },
      { sleutel: 'huis', soort: 'huis', naam: 'Huis' },
    ];
    const blad = (punt) => tekst(<Detail punt={punt} punten={punten} stand={stand} verdeling={verdeling} onSluit={() => {}} />);
    expect(blad(punten[0])).toMatch(/Wat de batterij zelf meldt.*Temperatuur accu's 23–24 °C/);
    expect(blad(punten[1])).not.toMatch(/Wat de batterij zelf meldt/);
  });

  it('bij de Zendure op het tabblad Apparaten; een stand zonder batterij_info kan ook', () => {
    expect(tekst(<TabApparaten stand={standUitRij(RIJ)} nu={Date.parse(RIJ.moment)} />)).toMatch(/SolarFlow 2400 AC.*antwoordt Temperatuur accu's 23–24 °C/);
    const oud = standUitRij({ ...RIJ, batterij_info: undefined, brug: { ...RIJ.brug, versie: '0.4.0' } });
    const t = tekst(<TabApparaten stand={oud} nu={Date.parse(RIJ.moment)} />);
    expect(t).toMatch(/Met versie 0\.5\.0 van het programmaatje/);
    expect(t).not.toMatch(/Temperatuur/);
    expect(renderToStaticMarkup(<TabApparaten stand={standUitRij({ ...RIJ, batterij_info: undefined })} nu={0} />)).not.toMatch(/border-t border-lijn pt-2[^>]*>[^<]/);
  });
});

describe("veel accu's (programmaatje 1.4.0: tot drie 2400 AC's met elk 6)", () => {
  const accus = Array.from({ length: 18 }, (_, i) => ({ nr: i + 1, temp_c: 21 + (i % 5), procent: 37 + (i % 5), cel_min_v: 3.25, cel_max_v: 3.29, cycli: 150 + i, ...(i === 4 ? { verwarmt: true } : {}) }));

  it("samen op één regel, met elke accu apart in een blok dat dicht staat", () => {
    const html = renderToStaticMarkup(<BatterijGegevens info={{ ...INFO, pakketten: 18, inhoud_kwh: 51.84, accus }} brugVersie="1.4.0" />);
    const t = tekst(<BatterijGegevens info={{ ...INFO, pakketten: 18, inhoud_kwh: 51.84, accus }} brugVersie="1.4.0" />);
    expect(t).toMatch(/18 accu's: 37–41% · 21–25 °C cellen 3,25–3,29 V · 1 accu verwarmt zich nu/);
    expect(t).toMatch(/Elke accu apart \(18\)/);
    expect(t).toMatch(/Accu 18 · 23 °C · 39% cellen 3,25–3,29 V · 167 laadcycli/);
    expect(t).toMatch(/18 accu's · samen 51,84 kWh/);
    expect(html).toContain('<details');
    // Eén icoon voor de samenvatting en één per accu, elk met streepjes.
    expect(html.match(/data-streepjes="\d"/g)).toHaveLength(19);
    // Op een smal scherm één kolom, vanaf sm twee; lange tekst breekt af.
    expect(html).toContain('grid-cols-1');
    expect(html).toContain('sm:grid-cols-2');
  });

  it("tot vier accu's los onder elkaar, zoals altijd; ook op Apparaten (compact)", () => {
    const vier = accus.slice(0, 4);
    const t = tekst(<BatterijGegevens info={{ ...INFO, accus: vier }} brugVersie="1.4.0" compact />);
    expect(t).not.toMatch(/Elke accu apart/);
    expect(t).toMatch(/Accu 1 · 21 °C · 37% cellen 3,25–3,29 V · 150 laadcycli Accu 2/);
    const vijf = tekst(<BatterijGegevens info={{ ...INFO, accus: accus.slice(0, 5) }} brugVersie="1.4.0" compact />);
    expect(vijf).toMatch(/5 accu's: 37–41%.*Elke accu apart \(5\)/);
  });
});
