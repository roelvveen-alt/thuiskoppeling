// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/base44Client', () => ({
  VOORBEELD: false,
  APP_ID: 'app-test-123',
  base44: {},
  statusVan: (e) => e?.status ?? e?.response?.status ?? null,
}));

const antwoorden = {};
const vraag = vi.fn(async (actie, invoer) => {
  const antwoord = antwoorden[actie];
  if (antwoord instanceof Error) throw antwoord;
  return typeof antwoord === 'function' ? antwoord(invoer) : antwoord;
});
vi.mock('@/api/huis', async (origineel) => ({
  ...(await origineel()),
  vraag: (...a) => vraag(...a),
  naarInloggen: vi.fn(),
  uitloggen: vi.fn(),
  nodigUitBijBase44: vi.fn(async () => ({ ok: false, status: 403, bericht: 'Forbidden' })),
}));

const { LoketFout } = await import('@/api/huis');
const { default: App } = await import('./App');
const { vergeetVroegeStand } = await import('@/lib/vroegeStand');

const TIM = { email: 'tim@voorbeeld.nl', naam: 'Tim', beheerder: true };
const HUIS_TIM = { id: 'huis-tim01', naam: 'Thuis', rol: 'eigenaar', eigenaar_email: 'tim@voorbeeld.nl', leden: [] };

beforeEach(() => {
  for (const sleutel of Object.keys(antwoorden)) delete antwoorden[sleutel];
  Object.assign(antwoorden, {
    stand: { meting: null },
    opstelling: { rol: 'eigenaar', opstelling: null, foto_url: null },
  });
  vraag.mockClear();
  window.localStorage.clear();
  vergeetVroegeStand();
});
afterEach(cleanup);

/** De onderdelen van Instellingen (de rij keuzes onder de kop); geen rij = alleen Account. */
const keuzes = () => {
  const rij = screen.queryByRole('radiogroup', { name: 'Instellingen' });
  return rij ? within(rij).getAllByRole('radio').map((r) => r.textContent.trim()) : [];
};

describe('wie wat te zien krijgt', () => {
  it('een vreemde zonder uitnodiging: geen omgeving en niets om te maken', async () => {
    antwoorden.mijn = { gebruiker: { email: 'vreemd@voorbeeld.nl' }, magMaken: false, huizen: [] };
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Nog geen toegang' })).toBeTruthy();
    expect(screen.getByText(/Vraag degene die je uitnodigde/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Huis maken/ })).toBeNull();
  });

  it('de eerste keer: een huis maken, de sleutel één keer zien, dan het huis', async () => {
    antwoorden.mijn = { gebruiker: TIM, magMaken: true, huizen: [] };
    antwoorden.maak = ({ naam }) => ({ huis: { ...HUIS_TIM, naam }, sleutel: 'ab'.repeat(24) });
    render(<App />);
    const veld = await screen.findByLabelText('Naam van je huis');
    fireEvent.change(veld, { target: { value: 'Zomerhuis' } });
    fireEvent.click(screen.getByRole('button', { name: /Huis maken/ }));

    expect(await screen.findByText('ab'.repeat(24))).toBeTruthy();
    expect(screen.getByText(/Je ziet hem maar één keer/)).toBeTruthy();
    expect(screen.getByText(/apps\/app-test-123\/functions\/ontvangMeting/)).toBeTruthy();
    expect(vraag).toHaveBeenCalledWith('maak', { naam: 'Zomerhuis' });

    fireEvent.click(screen.getByRole('button', { name: /Ik heb hem bewaard/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Zomerhuis' })).toBeTruthy();
    expect(screen.queryByText('ab'.repeat(24))).toBeNull();
  });

  it('de eigenaar: Indelen, Account, Delen en Op afstand (Omvormer alleen met cijfers van een omvormer)', async () => {
    antwoorden.mijn = { gebruiker: TIM, magMaken: true, huizen: [HUIS_TIM] };
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Instellingen' }));
    // Laadt Indelen nog (de eerste keer, src/lib/lui.jsx), dan blijft Huis zo lang staan: daarom wachten.
    await waitFor(() => expect(keuzes()).toEqual(['Indelen', 'Namen', 'Gas', 'Account', 'Delen', 'Op afstand']));
    fireEvent.click(screen.getByRole('radio', { name: 'Delen' }));
    // De onderdelen van Instellingen laden pas als ze nodig zijn (src/lib/lui.jsx): daarom find.
    expect(await screen.findByRole('button', { name: /Nieuwe sleutel maken/ })).toBeTruthy();
    // Een stand zonder publiek deel (een oudere brug, of nog niets binnen): eerst bijwerken.
    fireEvent.click(screen.getByRole('radio', { name: 'Op afstand' }));
    expect(await screen.findByText(/Op afstand instellen/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Versleuteld klaarzetten/ })).toBeNull();
  });

  it('de eigenaar geeft een rondje een eigen naam: overal te zien, en bewaard', async () => {
    antwoorden.mijn = { gebruiker: TIM, magMaken: true, huizen: [HUIS_TIM] };
    antwoorden.bewaarOpstelling = { ok: true };
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Instellingen' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Namen' }));
    const net = await screen.findByLabelText('Naam voor Net');
    expect(net.getAttribute('placeholder')).toBe('Net');
    fireEvent.change(net, { target: { value: 'Meterkast' } });
    // Op de foto meteen.
    expect(screen.getByRole('button', { name: /^Meterkast: / })).toBeTruthy();
    await waitFor(
      () => expect(vraag).toHaveBeenCalledWith('bewaarOpstelling', expect.objectContaining({ opstelling: expect.objectContaining({ namen: [{ sleutel: 'net', naam: 'Meterkast' }] }) })),
      { timeout: 2000 },
    );
    // Klaar (de kop en onderaan doen hetzelfde): dan de kaarten, ook met de nieuwe naam.
    fireEvent.click(screen.getAllByRole('button', { name: 'Klaar' })[0]);
    expect(screen.getAllByText('Meterkast').length).toBeGreaterThan(0);
    expect(screen.queryByText('Net')).toBeNull();
  });

  it('een kijker: alleen Account, met bij wie hij meekijkt', async () => {
    antwoorden.mijn = {
      gebruiker: { email: 'dirk@voorbeeld.nl', beheerder: false },
      magMaken: true,
      huizen: [{ id: 'huis-tim01', naam: 'Thuis', rol: 'kijker', eigenaar_email: 'tim@voorbeeld.nl' }],
    };
    antwoorden.opstelling = { rol: 'kijker', opstelling: { namen: [{ sleutel: 'batterij', naam: 'Zendure' }] }, foto_url: null };
    render(<App />);
    // De namen van de eigenaar ziet een kijker ook.
    expect((await screen.findAllByText(/^Zendure\b/)).length).toBeGreaterThan(0);
    fireEvent.click(await screen.findByRole('button', { name: 'Instellingen' }));
    expect(keuzes()).toEqual([]);
    expect(await screen.findByText('dirk@voorbeeld.nl')).toBeTruthy();
    expect(screen.queryByText(/Sleep de rondjes/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Nieuwe sleutel/ })).toBeNull();
    expect(screen.getByText('dirk@voorbeeld.nl')).toBeTruthy();
    expect(screen.getByText('Je kijkt mee bij tim@voorbeeld.nl')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /andere naam/ })).toBeNull();
    // Een omgeving maken of wisselen doet alleen de beheerder, ook als een oudere functie "magMaken" stuurt.
    expect(screen.queryByRole('button', { name: /Maken/ })).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: /Kies een huis/i })).toBeNull();
  });

  it('een gewone gebruiker met (van vroeger) twee omgevingen: hij ziet er één, zonder wisselen', async () => {
    antwoorden.mijn = {
      gebruiker: { email: 'dirk@voorbeeld.nl', beheerder: false },
      magMaken: false,
      huizen: [
        { id: 'huis-dirk001', naam: 'Bij Dirk', rol: 'kijker', eigenaar_email: 'tim@voorbeeld.nl' },
        { id: 'huis-tim01', naam: 'Thuis', rol: 'kijker', eigenaar_email: 'tim@voorbeeld.nl' },
      ],
    };
    antwoorden.opstelling = { rol: 'kijker', opstelling: null, foto_url: null };
    // Ook als dit toestel nog "Thuis" onthield.
    window.localStorage.setItem('thuis-energie.omgeving.v1', JSON.stringify('huis-tim01'));
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Bij Dirk' })).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Instellingen' }));
    expect(screen.getByRole('heading', { name: 'Je huis' })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: /Thuis/ })).toBeNull();
    expect(screen.queryByText('Thuis')).toBeNull();
    expect(vraag).not.toHaveBeenCalledWith('stand', { huis_id: 'huis-tim01' });
    // Het overzicht van alle huizen vraagt de site voor hem niet eens (de server weigert het ook).
    expect(vraag).not.toHaveBeenCalledWith('overzicht');
  });

  it('de beheerder wisselt tussen omgevingen en maakt er nieuwe', async () => {
    const bijDirk = { id: 'huis-dirk001', naam: 'Bij Dirk', rol: 'eigenaar', eigenaar_email: 'tim@voorbeeld.nl', leden: [] };
    antwoorden.mijn = { gebruiker: TIM, magMaken: true, huizen: [bijDirk, HUIS_TIM] };
    // Het overzicht van alle huizen (alleen de beheerder): de kern van nu onder elk huis.
    antwoorden.overzicht = {
      huizen: [
        { id: 'huis-dirk001', naam: 'Bij Dirk', meting: { moment: new Date().toISOString(), zon_w: null, batterij_w: 640, batterij_procent: 40, net_w: 412, brug_versie: '0.6.1', storingen: [] } },
        { id: 'huis-tim01', naam: 'Thuis', meting: null },
      ],
    };
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Bij Dirk' })).toBeTruthy();
    expect(vraag).not.toHaveBeenCalledWith('overzicht');
    fireEvent.click(await screen.findByRole('button', { name: 'Instellingen' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Account' }));
    const keuze = screen.getByRole('radiogroup', { name: 'Alle huizen' });
    expect(await within(keuze).findByText(/Batterij 40%/)).toBeTruthy();
    expect(within(keuze).getByText('Nog geen cijfers van thuis')).toBeTruthy();
    expect(vraag.mock.calls.filter(([actie]) => actie === 'overzicht')).toHaveLength(1);
    // Tik = naar die omgeving: de instellingen gaan dicht.
    fireEvent.click(within(keuze).getByRole('radio', { name: /Thuis/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Thuis' })).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Instellingen' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Account' }));
    expect(screen.getByRole('heading', { name: 'Nieuw huis maken' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Maken/ })).toBeTruthy();
  });

  it('uitnodigen als eigenaar die geen beheerder is: zegt dat de beheerder het in Base44 moet doen', async () => {
    antwoorden.mijn = { gebruiker: { email: 'dirk@voorbeeld.nl', beheerder: false }, magMaken: true, huizen: [{ ...HUIS_TIM, eigenaar_email: 'dirk@voorbeeld.nl' }] };
    antwoorden.uitnodigen = ({ email }) => ({ leden: [{ email: email.toLowerCase() }] });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Instellingen' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Delen' }));
    fireEvent.change(await screen.findByLabelText('Iemand uitnodigen'), { target: { value: 'Oma@Voorbeeld.nl' } });
    fireEvent.click(screen.getByRole('button', { name: /Uitnodigen/ }));
    // Er is ook een stille statusregel in de kop; het gaat om de melding.
    await waitFor(
      () => expect(screen.getAllByRole('status').some((m) => /Vraag de beheerder om oma@voorbeeld.nl toegang te geven/.test(m.textContent))).toBe(true),
      { timeout: 2000 },
    );
    expect(within(screen.getByRole('list')).getByText('oma@voorbeeld.nl')).toBeTruthy();
  });

  it('oude cijfers: de foto zegt van wanneer ze zijn, zonder geldbordje', async () => {
    antwoorden.mijn = { gebruiker: TIM, magMaken: true, huizen: [HUIS_TIM] };
    const moment = new Date(Date.now() - 10 * 60_000).toISOString();
    antwoorden.stand = { meting: { moment, net_w: 300, prijs: { afname_kwh: 0.25, teruglevering_kwh: 0.1 } } };
    render(<App />);
    expect(await screen.findByText(/^Stand van \d\d:\d\d$/)).toBeTruthy();
    expect(screen.getByText('Geen live cijfers')).toBeTruthy();
    expect(screen.queryByText('Je betaalt nu')).toBeNull();
  });

  it('nog geen cijfers (Base44 antwoordt niet): één kaart, geen "0 W" of "Geen … gekoppeld"', async () => {
    antwoorden.mijn = { gebruiker: TIM, magMaken: true, huizen: [HUIS_TIM] };
    antwoorden.stand = new Error('netwerk');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Nog geen cijfers' })).toBeTruthy();
    expect(screen.queryByText(/Je huis gebruikt nu 0/)).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /Nu/ }));
    expect(await screen.findByRole('tabpanel')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Nog geen cijfers' })).toBeTruthy();
    expect(screen.queryByText(/Geen (batterij|meter|panelen) gekoppeld/)).toBeNull();
  });

  it('een blad open: de pagina erachter is onbereikbaar, dicht weer gewoon', async () => {
    antwoorden.mijn = { gebruiker: TIM, magMaken: true, huizen: [HUIS_TIM] };
    render(<App />);
    const kop = (await screen.findByRole('heading', { level: 1, name: 'Thuis' })).closest('header');
    fireEvent.click(screen.getAllByRole('button', { name: /^Huis/ })[0]);
    const dialoog = await screen.findByRole('dialog');
    expect(kop.hasAttribute('inert')).toBe(true);
    expect(dialoog.hasAttribute('inert')).toBe(false);
    fireEvent.click(within(dialoog).getByRole('button', { name: 'Sluiten' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(kop.hasAttribute('inert')).toBe(false);
  });

  it('functie nog niet bijgewerkt: zegt dat duidelijk, en blijft niet hangen', async () => {
    antwoorden.mijn = new LoketFout('nietBijgewerkt');
    render(<App />);
    expect(await screen.findByText(/Probeer het over een minuut opnieuw/)).toBeTruthy();
    antwoorden.mijn = { gebruiker: TIM, magMaken: true, huizen: [HUIS_TIM] };
    fireEvent.click(screen.getByRole('button', { name: /Opnieuw proberen/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Thuis' })).toBeTruthy();
  });
});

describe('de eerste cijfers bij het openen (prestaties-18)', () => {
  const acties = () => vraag.mock.calls.map(([actie, invoer]) => (invoer?.huis_id ? `${actie}:${invoer.huis_id}` : actie));

  it('de eerste keer: eerst wie je bent, dan de stand; en dit toestel onthoudt het huis', async () => {
    antwoorden.mijn = { gebruiker: TIM, magMaken: true, huizen: [HUIS_TIM] };
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Thuis' })).toBeTruthy();
    await waitFor(() => expect(acties()).toContain('opstelling:huis-tim01'));
    expect(acties().slice(0, 3)).toEqual(['mijn', 'stand:huis-tim01', 'opstelling:huis-tim01']);
    expect(JSON.parse(window.localStorage.getItem('thuis-energie.laatste-huis.v1'))).toBe('huis-tim01');
  });

  it('daarna: de stand van dat huis meteen, vóór "mijn", en geen tweede stand voor het scherm', async () => {
    window.localStorage.setItem('thuis-energie.laatste-huis.v1', JSON.stringify('huis-tim01'));
    antwoorden.mijn = { gebruiker: TIM, magMaken: true, huizen: [HUIS_TIM] };
    antwoorden.stand = { meting: { moment: new Date().toISOString(), net_w: 300, zon_w: 0 } };
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Thuis' })).toBeTruthy();
    await waitFor(() => expect(acties()).toContain('opstelling:huis-tim01'));
    expect(acties().slice(0, 3)).toEqual(['stand:huis-tim01', 'mijn', 'opstelling:huis-tim01']);
    // De cijfers staan er meteen, zonder "Nog geen cijfers".
    expect(screen.queryByRole('heading', { name: 'Nog geen cijfers' })).toBeNull();
    expect(acties().filter((a) => a.startsWith('stand'))).toHaveLength(1);
  });

  it('een ander huis dan de vorige keer: dat antwoord vervalt, de stand van het goede huis komt', async () => {
    window.localStorage.setItem('thuis-energie.laatste-huis.v1', JSON.stringify('huis-ander1'));
    antwoorden.mijn = { gebruiker: TIM, magMaken: true, huizen: [HUIS_TIM] };
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Thuis' })).toBeTruthy();
    await waitFor(() => expect(acties()).toContain('stand:huis-tim01'));
    expect(acties()[0]).toBe('stand:huis-ander1');
    expect(JSON.parse(window.localStorage.getItem('thuis-energie.laatste-huis.v1'))).toBe('huis-tim01');
  });

  it('het vroege antwoord is een fout (geen toegang meer): het scherm gaat daar net zo mee om als altijd', async () => {
    window.localStorage.setItem('thuis-energie.laatste-huis.v1', JSON.stringify('huis-tim01'));
    antwoorden.mijn = { gebruiker: TIM, magMaken: true, huizen: [HUIS_TIM] };
    antwoorden.stand = new Error('netwerk');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Nog geen cijfers' })).toBeTruthy();
  });
});
