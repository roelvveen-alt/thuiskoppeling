// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/base44Client', () => ({ VOORBEELD: false, APP_ID: 'app-test-123', base44: {}, statusVan: () => null }));

const vraagPeriode = vi.fn();
vi.mock('@/api/huis', async (origineel) => ({ ...(await origineel()), vraagPeriode: (...a) => vraagPeriode(...a), naarInloggen: vi.fn() }));

const { LoketFout } = await import('@/api/huis');
const { default: TabOverzicht, LOKAAL_KEUZE } = await import('./TabOverzicht');
const { default: OverzichtPeriode } = await import('./OverzichtPeriode');
const { tabUit } = await import('./Tabbalk');
const { dagenUit, periodeVan } = await import('@/lib/periode');

const NU = Date.parse('2026-10-30T11:00:00Z');
const WEEK = periodeVan('week', NU);

/** Een dag zoals de server hem geeft. */
const rij = (datum, extra = {}) => ({
  datum,
  zon_kwh: 12.5,
  huis_kwh: 14,
  geladen_kwh: 6,
  ontladen_kwh: 5.4,
  afname_kwh: 6,
  teruglevering_kwh: 4,
  kosten_eur: 1.4,
  opbrengst_eur: 0.9,
  vaste_kosten_eur: -0.21,
  zonnebonus_eur: 0.03,
  compleet: true,
  eigen_verbruik: 0.7,
  zelfvoorzienend: 0.8,
  fasen: [{ fase: 1, gemiddeld_a: 3, piek_a: 12 }],
  kwartieren: 96,
  ...extra,
});

/** Zonder opmaak, met gewone spaties. */
const tekst = (el) =>
  renderToStaticMarkup(el)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|\s/g, ' ')
    .replace(/ +/g, ' ')
    .trim();

beforeEach(() => {
  vraagPeriode.mockReset();
  window.localStorage.clear();
});
afterEach(cleanup);

describe('Overzicht: een periode', () => {
  it('de totalen en een grafiek per dag; sinds wanneer, als de geschiedenis korter is', () => {
    const t = tekst(<OverzichtPeriode periode={WEEK} dagen={dagenUit([rij('2026-10-28'), rij('2026-10-29')])} status="klaar" stand={null} />);
    expect(t).toContain('Deze week');
    expect(t).toMatch(/Bewaard sinds woensdag 28 oktober/);
    expect(t).toMatch(/Geld deze week/i);
    // Betaald 2 × 1,40, verdiend 2 × 0,90, vast 2 × −0,21: netto 0,58 kosten.
    expect(t).toMatch(/Betaald € 2,80/);
    expect(t).toMatch(/Netto kosten € 0,58/);
    expect(t).toMatch(/Zon opgewekt 25,0 kWh/);
    // Uit de kWh die er ook staan (niet het getal van de server): 1 − 8/25 en 1 − 12/28.
    expect(t).toMatch(/Eigen verbruik 68% ?: van 25,0 kWh zon ging 8,0 kWh terug naar het net\./);
    expect(t).toMatch(/Zelfvoorzienend 57% ?: het huis gebruikte 28,0 kWh, en 12,0 kWh kwam uit het net\./);
    expect(t).not.toMatch(/Eigen verbruik 70%|Zelfvoorzienend 80%/);
    expect(t).toMatch(/Netto per dag/);
    expect(t).toMatch(/Als tabel, per dag/);
  });

  it('een oudere server zonder periode: een korte uitleg, geen grafiek', () => {
    const t = tekst(<OverzichtPeriode periode={WEEK} dagen={[]} status="nietBijgewerkt" stand={null} />);
    expect(t).toMatch(/Week, maand, kwartaal en jaar komen zodra de app bijgewerkt is/);
    expect(t).toMatch(/Vandaag werkt al wel/);
    expect(t).not.toMatch(/per dag/);
  });

  it('nog geen dagen: een vriendelijke uitleg, geen lege grafiek; bij een fout zegt hij dat', () => {
    expect(tekst(<OverzichtPeriode periode={WEEK} dagen={[]} status="klaar" stand={null} />)).toMatch(/Nog geen dagen bewaard/);
    expect(tekst(<OverzichtPeriode periode={WEEK} dagen={[]} status="fout" stand={null} />)).toMatch(/konden nu niet geladen worden/);
    expect(tekst(<OverzichtPeriode periode={WEEK} dagen={[]} status="laden" stand={null} />)).toMatch(/Even de dagen ophalen/);
    const oud = tekst(<OverzichtPeriode periode={WEEK} dagen={dagenUit([rij('2026-10-26')])} status="fout" stand={null} />);
    expect(oud).toMatch(/Bijwerken lukte net niet/);
    expect(oud).toMatch(/Zon opgewekt/);
  });

  it('vandaag uit de stand telt mee, ook zonder rij op de server', () => {
    const stand = { vandaag: { datum: '2026-10-30', afname_kwh: 1, teruglevering_kwh: 2, kosten_eur: 0.25, opbrengst_eur: 0.5, vaste_kosten_eur: -0.21, compleet: true } };
    const t = tekst(<OverzichtPeriode periode={WEEK} dagen={dagenUit([rij('2026-10-26')])} status="klaar" stand={stand} />);
    expect(t).toMatch(/Betaald € 1,65/);
  });
});

describe('Overzicht: het tabblad', () => {
  it('Vandaag vraagt niets aan de server; een periode wel, één keer, met de goede dagen', async () => {
    vraagPeriode.mockResolvedValue({ dagen: [rij('2026-10-27'), rij('2026-10-28')] });
    render(<TabOverzicht stand={null} nu={NU} huisId="huis-tim01" metVoorbeeld={false} />);
    expect(screen.getByRole('heading', { name: 'Vandaag' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Vandaag' }).getAttribute('aria-checked')).toBe('true');
    expect(vraagPeriode).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('radio', { name: 'Week' }));
    expect(await screen.findByRole('heading', { name: 'Deze week' })).toBeTruthy();
    expect(await screen.findByText(/Bewaard sinds dinsdag 27 oktober/)).toBeTruthy();
    expect(vraagPeriode).toHaveBeenCalledTimes(1);
    // In dezelfde vraag ook vorige week (voor de vergelijking bij Apparaten): geen aanroep extra.
    expect(vraagPeriode).toHaveBeenCalledWith('huis-tim01', '2026-10-19', '2026-11-01');
    // Onthouden op dit toestel.
    expect(JSON.parse(window.localStorage.getItem(LOKAAL_KEUZE))).toBe('week');
  });

  it('met de pijltjes naar de volgende keuze', async () => {
    vraagPeriode.mockResolvedValue({ dagen: [] });
    render(<TabOverzicht stand={null} nu={NU} huisId="huis-tim01" metVoorbeeld={false} />);
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Vandaag' }), { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: 'Week' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Week' }), { key: 'End' });
    expect(screen.getByRole('radio', { name: 'Jaar' }).getAttribute('aria-checked')).toBe('true');
    expect(await screen.findByRole('heading', { name: 'Dit jaar' })).toBeTruthy();
    expect(vraagPeriode).toHaveBeenLastCalledWith('huis-tim01', '2026-01-01', '2026-12-31');
  });

  it('een oudere server: bij Week een uitleg, en Vandaag werkt gewoon', async () => {
    vraagPeriode.mockRejectedValue(new LoketFout('nietBijgewerkt'));
    window.localStorage.setItem(LOKAAL_KEUZE, JSON.stringify('maand'));
    render(<TabOverzicht stand={null} nu={NU} huisId="huis-tim01" metVoorbeeld={false} />);
    expect(await screen.findByText(/komen zodra de app bijgewerkt is/)).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Vandaag' }));
    expect(screen.getByRole('heading', { name: 'Geld en energie' })).toBeTruthy();
  });

  it('het voorbeeld: nepdagen, zonder de server', () => {
    window.localStorage.setItem(LOKAAL_KEUZE, JSON.stringify('kwartaal'));
    render(<TabOverzicht stand={null} nu={NU} huisId={null} metVoorbeeld />);
    expect(screen.getByRole('heading', { name: 'Dit kwartaal' })).toBeTruthy();
    expect(screen.getByText(/Netto per week/)).toBeTruthy();
    expect(screen.queryByText(/Bewaard sinds/)).toBeNull();
    expect(vraagPeriode).not.toHaveBeenCalled();
  });
});

describe('wat een toestel nog onthield', () => {
  it('Vandaag en Prijzen zitten nu in Overzicht', () => {
    expect(tabUit('vandaag')).toBe('overzicht');
    expect(tabUit('prijzen')).toBe('overzicht');
    expect(tabUit('nu')).toBe('nu');
    expect(tabUit('apparaten')).toBe('apparaten');
    expect(tabUit('iets')).toBe('huis');
    expect(tabUit(null)).toBe('huis');
  });
});
