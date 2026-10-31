// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/base44Client', () => ({ VOORBEELD: false, APP_ID: 'app-test-123', base44: {}, statusVan: () => null }));

const { default: OverzichtApparaten } = await import('./OverzichtApparaten');
const { default: OverzichtPeriode } = await import('./OverzichtPeriode');
const { default: OverzichtVandaag } = await import('./OverzichtVandaag');
const { dagenUit, periodeVan, stavenVan } = await import('@/lib/periode');
const { dagUit } = await import('@/lib/bron');

const NU = Date.parse('2026-10-30T11:00:00Z');
const WEEK = periodeVan('week', NU);

const rij = (datum, extra = {}) => ({ datum, huis_kwh: 12, afname_kwh: 5, kosten_eur: 1.25, zon_kwh: 3, ...extra });
const SPA = { sleutel: 'hw-spa', naam: 'Spa', kwh: 6.4, keer: 9, gemeten: true };
const WAS = { sleutel: 'h:wasmachine', soort: 'wasmachine', kwh: 1.2, keer: 1, gemeten: false };

const tekst = (el) =>
  renderToStaticMarkup(el)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|\s/g, ' ')
    .replace(/ +/g, ' ')
    .trim();

afterEach(cleanup);

describe('Overzicht › Apparaten', () => {
  it('wat vaker terugkomt en nog geen naam heeft (brug 1.4.0): apart, niet in de Rest; het blad zegt waar je het benoemt', () => {
    const terug = { sleutel: 'h:onbekend:g-b', naam: 'Onbekend apparaat B, zo’n 1,8 kW', kwh: 1.8, keer: 3, gemeten: false };
    const dagen = dagenUit([rij('2026-10-27', { huis_kwh: 14, apparaten_kwh: [SPA, WAS, terug], basis_kwh: 3 })]);
    const t = tekst(<OverzichtApparaten dagen={dagen} wanneer="deze week" brugVersie="1.4.0" />);
    expect(t).toMatch(/Onbekend apparaat B, zo’n 1,8 kW komt vaker terug, nog onbekend ≈ 1,8 kWh/);
    // De Rest is kleiner: 14 − 6,4 − 1,2 − 1,8 − 3.
    expect(t).toMatch(/Rest niet herkend ≈ 1,6 kWh/);
    render(<OverzichtApparaten dagen={dagen} wanneer="deze week" brugVersie="1.4.0" eigenaar />);
    fireEvent.click(screen.getByRole('button', { name: /Onbekend apparaat B/ }));
    expect(within(screen.getByRole('dialog')).getByText(/Zeg het bij Apparaten › Wat gebruikt er nu stroom\?/)).toBeTruthy();
  });

  it('een periode: gemeten zonder ≈, herkend met ≈, basis en rest onderaan, en vorige week erbij', () => {
    const dagen = dagenUit([rij('2026-10-27', { apparaten_kwh: [SPA, WAS], basis_kwh: 3 }), rij('2026-10-28', { apparaten_kwh: [SPA], basis_kwh: 3 })]);
    const vorige = dagenUit([rij('2026-10-20', { apparaten_kwh: [{ ...SPA, kwh: 31 }], basis_kwh: 3 })]);
    const t = tekst(<OverzichtApparaten dagen={dagen} wanneer="deze week" vorigeDagen={vorige} vorigeNaam="vorige week" brugVersie="0.12.0" />);
    expect(t).toMatch(/Spa gemeten 12,8 kWh/);
    expect(t).toMatch(/53% van het huis · 18× aan · ongeveer € 3,20 · vorige week 31,0 kWh/);
    expect(t).toMatch(/Wasmachine herkend ≈ 1,2 kWh/);
    expect(t).toMatch(/Basis altijd aan \/ warmtepomp ≈ 6,0 kWh/);
    expect(t).toMatch(/Rest niet herkend ≈ 4,0 kWh/);
    expect(t.indexOf('Spa')).toBeLessThan(t.indexOf('Wasmachine'));
    expect(t.indexOf('Wasmachine')).toBeLessThan(t.indexOf('Basis'));
    expect(t).toMatch(/Euro’s ongeveer/);
  });

  it('tik op een regel: een blad met de cijfers en per dag een staafje; Escape sluit', () => {
    const dagen = dagenUit([rij('2026-10-27', { apparaten_kwh: [SPA], basis_kwh: 3 }), rij('2026-10-28', { apparaten_kwh: [SPA], basis_kwh: 3 })]);
    const staven = stavenVan(WEEK);
    const grafiekPer = { labels: staven.map((s) => s.kort), namen: staven.map((s) => s.lang), huidig: 4, tabelKop: 'Dag', stapNaam: 'dag', van: 0, stapMs: 1 };
    render(<OverzichtApparaten dagen={dagen} wanneer="deze week" brugVersie="0.12.0" grafiek={{ staven, grafiekPer, per: 'dag' }} />);
    fireEvent.click(screen.getByRole('button', { name: /Spa/ }));
    const blad = screen.getByRole('dialog', { name: 'Spa' });
    expect(within(blad).getByText(/gemeten, dus precies/)).toBeTruthy();
    expect(within(blad).getByText('Per dag')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('een oudere brug (0.6.1 bij Dirk): uitleg dat het na bijwerken komt, voor een kijker zonder opdracht', () => {
    const dagen = dagenUit([rij('2026-10-27'), rij('2026-10-28')]);
    expect(tekst(<OverzichtApparaten dagen={dagen} wanneer="deze week" brugVersie="0.6.1" />)).toMatch(/zodra het programmaatje thuis versie 0\.12\.0 of nieuwer heeft\. Hoe je het bijwerkt, staat op Apparaten\./);
    expect(tekst(<OverzichtApparaten dagen={dagen} wanneer="deze week" brugVersie="0.6.1" eigenaar={false} />)).toMatch(/De eigenaar weet hoe/);
    expect(tekst(<OverzichtApparaten dagen={dagen} wanneer="deze week" brugVersie="0.12.0" />)).toMatch(/Nog geen dagen met apparaten/);
  });

  it('een deel van de dagen met apparaten: dat staat erbij', () => {
    const dagen = dagenUit([rij('2026-10-27'), rij('2026-10-28', { apparaten_kwh: [SPA], basis_kwh: 3 })]);
    expect(tekst(<OverzichtApparaten dagen={dagen} wanneer="deze week" brugVersie="0.12.0" />)).toMatch(/Over 1 dag: van de dagen daarvoor heeft de app nog geen apparaten/);
  });

  it('in de week: de kaart staat erin, en vorige week komt uit dezelfde vraag', () => {
    const dagen = dagenUit([rij('2026-10-21', { apparaten_kwh: [{ ...SPA, kwh: 31 }] }), rij('2026-10-27', { apparaten_kwh: [SPA], basis_kwh: 3 })]);
    const t = tekst(<OverzichtPeriode periode={WEEK} dagen={dagen} status="klaar" stand={{ brug: { versie: '0.12.0' } }} />);
    expect(t).toMatch(/Apparaten/);
    expect(t).toMatch(/vorige week 31,0 kWh/);
    // Vorige week telt niet mee in de totalen van deze week.
    expect(t).toMatch(/Bewaard sinds dinsdag 27 oktober/);
  });

  it('vandaag uit de stand: herkend met de prijs van vandaag; een oudere brug vraagt om bij te werken', () => {
    const dag = (extra) => dagUit({ datum: '2026-10-30', van: '2026-10-29T23:00:00.000Z', stap_min: 15, metingen: [180], huis_w: [400], kwh: { huis: 4 }, ...extra });
    const vandaag = { datum: '2026-10-30', afname_kwh: 2, teruglevering_kwh: 0, kosten_eur: 0.5, opbrengst_eur: 0, compleet: true };
    const nieuw = tekst(<OverzichtVandaag stand={{ dag: dag({ apparaten: [WAS], basis_kwh: 1.5 }), vandaag, brug: { versie: '0.12.0' } }} nu={NU} />);
    expect(nieuw).toMatch(/Wasmachine herkend ≈ 1,2 kWh/);
    expect(nieuw).toMatch(/30% van het huis · 1× aan · ongeveer € 0,30/);
    const oud = tekst(<OverzichtVandaag stand={{ dag: dag({}), vandaag, brug: { versie: '0.6.1' } }} nu={NU} />);
    expect(oud).toMatch(/Apparaten.*versie 0\.12\.0 of nieuwer/);
  });
});
