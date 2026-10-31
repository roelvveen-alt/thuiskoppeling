import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import OverzichtVandaag from './OverzichtVandaag';
import TabApparaten, { kaartNaam } from './TabApparaten';

const NU = Date.parse('2026-10-30T10:15:00Z');

describe('opdrachten voor het programmaatje alleen voor de eigenaar', () => {
  it('Apparaten: de eigenaar krijgt de opdracht per toestel (de veilige bijwerken.sh), een kijker een gewone zin', () => {
    const stand = { moment: new Date(NU - 5000).toISOString() };
    const html = renderToStaticMarkup(<TabApparaten stand={stand} nu={NU} />);
    expect(html).toContain('sh ~/thuis-energie/brug/bijwerken.sh');
    expect(html).toContain('Op een Chromebook');
    // Een oude versie zonder brug-info: meteen open; de oude opdracht alleen voor van vóór 0.5.2.
    expect(html).toMatch(/<details[^>]* open/);
    expect(html).toMatch(/vóór 0\.5\.2[^<]*<span[^>]*>cd ~\/thuis-energie &amp;&amp; git pull/);
    // Geen tekst die aan elkaar plakt ("antwoordt.Op").
    expect(html).not.toMatch(/<p[^>]*>[^<]*[a-z]\.[A-Z][^<]*<\/p>/);
    const kijker = renderToStaticMarkup(<TabApparaten stand={stand} nu={NU} eigenaar={false} />);
    expect(kijker).not.toMatch(/git pull|bijwerken\.sh/);
    expect(kijker).toContain('De eigenaar weet hoe');
    // Een nieuwere versie: de uitleg dicht.
    const nieuw = renderToStaticMarkup(<TabApparaten stand={{ ...stand, brug: { versie: '0.12.0' } }} nu={NU} />);
    expect(nieuw).toContain('bijwerken.sh');
    expect(nieuw).not.toMatch(/<details[^>]* open/);
  });
  it('Apparaten: een Zendure die nu via de cloud gaat als reserve', () => {
    const gekoppeld = [{ sleutel: 'zendure', naam: 'Zendure-batterij', merk: 'Zendure', soort: 'SolarFlow 2400 AC', rol: 'batterij', manier: 'cloud-reserve', adres: null, ok: true, sinds: null, w: -800 }];
    const html = renderToStaticMarkup(<TabApparaten stand={{ moment: new Date(NU - 5000).toISOString(), gekoppeld }} nu={NU} />);
    expect(html).toContain('via de cloud (reserve)');
  });
  it('Overzicht › Vandaag zonder dag: geen opdracht, wel waar het staat (alleen voor de eigenaar)', () => {
    expect(renderToStaticMarkup(<OverzichtVandaag stand={{}} nu={NU} />)).toContain('staat op Apparaten');
    expect(renderToStaticMarkup(<OverzichtVandaag stand={{}} nu={NU} />)).not.toContain('git pull');
    expect(renderToStaticMarkup(<OverzichtVandaag stand={{}} nu={NU} eigenaar={false} />)).not.toContain('staat op Apparaten');
  });
});

describe('de apparatenkaarten', () => {
  const gekoppeld = [
    { sleutel: 'hw-zon-batterij', naam: 'zon + batterij', merk: 'HomeWizard', soort: 'kWh-meter', rol: 'zon-en-batterij', manier: 'v1', adres: null, ok: true, sinds: null, w: -500 },
    { sleutel: 'hw-meterkast', naam: 'Meterkast', merk: 'HomeWizard', soort: 'P1-meter', rol: 'net', manier: 'v1', adres: null, ok: true, sinds: null, w: 100 },
  ];
  const punten = [
    { sleutel: 'hw-zon-batterij', soort: 'zon', naam: 'Hoofddak', eigenNaam: 'Hoofddak' },
    { sleutel: 'net', soort: 'net', naam: 'Net', eigenNaam: '' },
  ];
  it('met de eigen naam, en de naam van thuis eronder', () => {
    expect(kaartNaam(gekoppeld[0], punten)).toEqual({ naam: 'Hoofddak', thuis: 'zon + batterij' });
    // Zonder eigen naam blijft de meterkast "Meterkast", niet het woord van de foto.
    expect(kaartNaam(gekoppeld[1], punten)).toEqual({ naam: 'Meterkast', thuis: null });
    expect(kaartNaam(gekoppeld[1], [{ ...punten[1], eigenNaam: 'Slimme meter' }])).toEqual({ naam: 'Slimme meter', thuis: 'Meterkast' });
  });
  it('niet afgekapt en niet uitgerekt: elke kaart zo hoog als wat erin staat', () => {
    const html = renderToStaticMarkup(<TabApparaten stand={{ moment: new Date(NU).toISOString(), gekoppeld }} nu={NU} punten={punten} />);
    expect(html).toContain('heet thuis: zon + batterij · kWh-meter · HomeWizard');
    expect(html).toMatch(/<ul class="[^"]*items-start/);
    expect(html).not.toMatch(/truncate[^"]*">heet thuis/);
  });
});
