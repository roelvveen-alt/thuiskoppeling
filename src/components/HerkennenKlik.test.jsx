// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { standUitRij } from '@/lib/bron';
import Herkennen from './Herkennen';

afterEach(cleanup);

const MOMENT = '2026-10-30T12:00:00.000Z';
const NU = Date.parse('2026-10-30T12:00:05Z');
const RIJ = {
  moment: MOMENT,
  net_w: 100,
  brug: { versie: '0.13.0', gestart: '2026-10-30T06:00:00Z', elke_seconden: 5 },
  herkend: {
    moment: MOMENT,
    nu: [{ id: 'a-2', soort: 'wasmachine', deel: 'verwarmt', w: 2100, zeker: 0.65, fase: 2, sinds: '2026-10-30T11:40:00Z' }],
    recent: [{ id: 'a-4', soort: 'waterkoker', w: 2200, zeker: 0.7, van: '2026-10-30T09:00:00Z', tot: '2026-10-30T09:03:00Z' }],
    onbekend: [{ id: 'g-a-6', letter: 'A', w: 1200, duur_s: 1200, n: 4, dagdeel: 'avond', fase: 1 }],
    basis: { w: 200, altijd_w: 190, warmtepomp: false },
  },
};
const herkend = standUitRij(RIJ).herkend;

describe('aanwijzen in het uitklapblok werkt zoals eerst', () => {
  it('het blok staat dicht; open: Klopt, Dat was … en Dit is het sturen hetzelfde label als eerst', async () => {
    const onLabel = vi.fn(async () => true);
    const { container } = render(<Herkennen herkend={herkend} brugVersie="0.13.0" eigenaar onLabel={onLabel} nu={NU} />);
    const blok = container.querySelector('details');
    expect(blok.open).toBe(false);
    fireEvent.click(within(blok).getByText(/Eerder vandaag en aanwijzen \(1 vraag\)/));
    blok.open = true;

    const nu = within(blok).getByRole('list', { name: 'Nu aan' });
    await act(async () => fireEvent.click(within(nu).getByRole('button', { name: /Klopt/ })));
    expect(onLabel).toHaveBeenLastCalledWith({ id: 'a-2', soort: 'wasmachine', w: 2100, fase: 2, was: 'wasmachine' });
    expect(within(nu).getByText(/Onthouden; het programmaatje leert het binnen een minuut\./)).toBeTruthy();

    // Eerder vandaag: "Dat was …", een soort kiezen en bewaren.
    const eerder = within(blok).getByRole('heading', { name: 'Eerder vandaag' }).parentElement;
    fireEvent.click(within(eerder).getByRole('button', { name: 'Dat was…' }));
    fireEvent.change(within(eerder).getByRole('combobox'), { target: { value: 'oven' } });
    await act(async () => fireEvent.click(within(eerder).getByRole('button', { name: 'Bewaar' })));
    expect(onLabel).toHaveBeenLastCalledWith({ id: 'a-4', soort: 'oven', w: 2200, duur_s: 180, was: 'waterkoker' });

    // Wat is dit?: een eigen naam voor de hele groep.
    const vraag = within(blok).getByRole('heading', { name: 'Wat is dit?' }).parentElement;
    fireEvent.change(within(vraag).getByRole('combobox'), { target: { value: 'anders' } });
    fireEvent.change(within(vraag).getByRole('textbox'), { target: { value: 'Kachel' } });
    await act(async () => fireEvent.click(within(vraag).getByRole('button', { name: 'Dit is het' })));
    expect(onLabel).toHaveBeenLastCalledWith({ id: 'g-a-6', soort: 'anders', naam: 'Kachel', w: 1200, duur_s: 1200, fase: 1, aantal: 4 });
    expect(within(vraag).getByText(/Onthouden voor alle 4 keer/)).toBeTruthy();
    // Beantwoord: geen open vraag meer in het kopje.
    expect(within(blok).getByText('Eerder vandaag en aanwijzen')).toBeTruthy();
  });

  it('lukt bewaren niet, dan staat de melding in het blok', async () => {
    const onLabel = vi.fn(async () => 'Even geen verbinding.');
    const { container } = render(<Herkennen herkend={herkend} brugVersie="0.13.0" eigenaar onLabel={onLabel} nu={NU} />);
    const blok = container.querySelector('details');
    await act(async () => fireEvent.click(within(blok).getAllByRole('button', { name: /Klopt/ })[0]));
    expect(within(blok).getByRole('alert').textContent).toBe('Even geen verbinding.');
  });

  it('een kijker: geen enkele knop of keuzelijst, ook niet in het blok', () => {
    const { container } = render(<Herkennen herkend={herkend} brugVersie="0.13.0" eigenaar={false} onLabel={null} nu={NU} />);
    expect(container.querySelectorAll('button, select, input')).toHaveLength(0);
    expect(screen.getByText('Eerder vandaag', { selector: 'summary' })).toBeTruthy();
  });
});

describe('vragen bovenaan (brug 1.4.0)', () => {
  const metVragen = standUitRij({
    ...RIJ,
    brug: { ...RIJ.brug, versie: '1.4.0' },
    herkend: {
      ...RIJ.herkend,
      onbekend: [
        { id: 'g-b', letter: 'B', w: 1800, duur_s: 2400, n: 5, vorm: 'piek', tijden: ['2026-10-30T06:10:00Z', '2026-10-30T11:30:00Z'], vandaag: 2 },
        { id: 'g-a-6', letter: 'A', w: 1200, duur_s: 1200, n: 4, dagdeel: 'avond', fase: 1, vermoeden: 'oven' },
      ],
      kennis: { apparaten: [{ soort: 'waterkoker', zeker: 0.95, aangewezen: 3 }] },
    },
  }).herkend;
  // Wat dit toestel onthoudt (ook van de tests hierboven) eerst weg.
  beforeEach(() => window.localStorage.clear());

  it('antwoorden: het label voor de hele groep, de vraag verdwijnt, en een bedankje', async () => {
    const onLabel = vi.fn(async () => true);
    render(<Herkennen herkend={metVragen} brugVersie="1.4.0" eigenaar onLabel={onLabel} nu={NU} />);
    const lijst = screen.getByRole('list', { name: 'Vragen van het programmaatje' });
    const eerste = within(lijst).getAllByRole('listitem')[0];
    fireEvent.change(within(eerste).getByRole('combobox', { name: 'Wat is het?' }), { target: { value: 'verlichting' } });
    await act(async () => fireEvent.click(within(eerste).getByRole('button', { name: 'Dit is het' })));
    expect(onLabel).toHaveBeenLastCalledWith({ id: 'g-b', soort: 'anders', naam: 'Verlichting', w: 1800, duur_s: 2400, vorm: 'piek', aantal: 5 });
    expect(screen.getByRole('status').textContent).toMatch(/Dank je! Onthouden/);
    expect(within(screen.getByRole('list', { name: 'Vragen van het programmaatje' })).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('Ik ken nu 1 apparaat van je; 1 vraag staat open.')).toBeTruthy();
  });

  it('"Later" (of "Weet ik niet"): naar de server, en dit toestel vraagt het een week niet meer, ook als de server het niet kent', async () => {
    const onLabel = vi.fn(async () => 'Dit label klopt niet.');
    const { unmount } = render(<Herkennen herkend={metVragen} brugVersie="1.4.0" eigenaar onLabel={onLabel} nu={NU} />);
    const lijst = screen.getByRole('list', { name: 'Vragen van het programmaatje' });
    await act(async () => fireEvent.click(within(within(lijst).getAllByRole('listitem')[1]).getByRole('button', { name: 'Weet ik niet' })));
    expect(onLabel).toHaveBeenLastCalledWith({ id: 'g-a-6', later: true });
    expect(screen.getByRole('status').textContent).toBe('Goed, ik vraag het over een week nog eens.');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Later' })));
    expect(onLabel).toHaveBeenLastCalledWith({ id: 'g-b', later: true });
    expect(screen.queryByRole('list', { name: 'Vragen van het programmaatje' })).toBeNull();
    unmount();
    // Opnieuw open (dezelfde dag): geen vragen; over acht dagen weer wel.
    const { unmount: weg } = render(<Herkennen herkend={metVragen} brugVersie="1.4.0" eigenaar onLabel={onLabel} nu={NU + 86_400_000} />);
    expect(screen.queryByRole('list', { name: 'Vragen van het programmaatje' })).toBeNull();
    weg();
    render(<Herkennen herkend={metVragen} brugVersie="1.4.0" eigenaar onLabel={onLabel} nu={NU + 8 * 86_400_000} />);
    expect(within(screen.getByRole('list', { name: 'Vragen van het programmaatje' })).getAllByRole('listitem')).toHaveLength(2);
  });

  it('een kijker: geen vragen, geen knoppen', () => {
    const { container } = render(<Herkennen herkend={metVragen} brugVersie="1.4.0" eigenaar={false} onLabel={null} nu={NU} />);
    expect(screen.queryByRole('list', { name: 'Vragen van het programmaatje' })).toBeNull();
    expect(container.querySelectorAll('button, select, input')).toHaveLength(0);
  });
});
