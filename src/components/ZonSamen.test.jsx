// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { standUitRij } from '@/lib/bron';
import { LEGE_OPSTELLING, puntenVoor, ZON_SAMEN, zetNaam, zonSamen } from '@/lib/opstelling';
import { stromenSamen, verdeelStroom } from '@/lib/stroom';
import Detail from './Detail';
import TabNu from './TabNu';

afterEach(cleanup);

/** Twee plekken met panelen, zoals bij Tim (weergave-18: de Zon-tegel opende alleen de eerste). */
const TIM = {
  zon_w: 1134,
  zonnen: [
    { sleutel: 'hw-zon-batterij', naam: 'zon + batterij', vermogen_w: 701 },
    { sleutel: 'hw-zon-dierenverblijf', naam: 'Zon dierenverblijf', vermogen_w: 433 },
  ],
  batterij_w: -627,
  batterij_procent: 7,
  net_w: -49,
  apparaten: [],
};
const punten = puntenVoor(zetNaam(LEGE_OPSTELLING, 'hw-zon-batterij', 'Hoofddak'), TIM);
const verdeling = verdeelStroom(TIM);
const zin = (el) => el.textContent.replace(/\s/g, ' ');

describe('alle plekken met panelen samen', () => {
  it('zonSamen: één punt "Zon" bij twee of meer plekken, anders niets', () => {
    expect(zonSamen(punten)).toMatchObject({ sleutel: ZON_SAMEN, naam: 'Zon', soort: 'zon', plekken: ['hw-zon-batterij', 'hw-zon-dierenverblijf'] });
    expect(zonSamen(puntenVoor(LEGE_OPSTELLING, { zon_w: 500, net_w: 0 }))).toBeNull();
    expect(zonSamen([])).toBeNull();
  });

  it('stromenSamen: per bestemming opgeteld, wat binnen de groep blijft telt niet', () => {
    const stromen = [
      { van: 'a', naar: 'huis', w: 100 },
      { van: 'b', naar: 'huis', w: 50 },
      { van: 'b', naar: 'net', w: 20 },
      { van: 'a', naar: 'b', w: 7 },
      { van: 'net', naar: 'a', w: 3 },
    ];
    expect(stromenSamen(['a', 'b'], 'samen', stromen)).toEqual({
      erin: [{ van: 'net', naar: 'samen', w: 3 }],
      eruit: [
        { van: 'samen', naar: 'huis', w: 150 },
        { van: 'samen', naar: 'net', w: 20 },
      ],
    });
  });

  it('het blad "Zon": het totaal van de tegel, waar alles heen gaat, en per plek een knop naar zijn eigen blad', () => {
    const onKies = vi.fn();
    render(<Detail punt={zonSamen(punten)} punten={punten} stand={TIM} verdeling={verdeling} onSluit={() => {}} onKies={onKies} />);
    const blad = screen.getByRole('dialog');
    expect(within(blad).getByRole('heading', { level: 2 }).textContent).toBe('Zon');
    expect(zin(blad)).toContain('1,1 kW');
    expect(zin(blad)).toContain('Van de 1,1 kW gaat 627 W naar de batterij, 458 W naar het huis en 49 W naar het net.');
    expect(zin(blad)).toContain('Per plek');
    fireEvent.click(within(blad).getByRole('button', { name: /Zon dierenverblijf\s*433\sW/ }));
    expect(onKies).toHaveBeenCalledWith('hw-zon-dierenverblijf');
    fireEvent.click(within(blad).getByRole('button', { name: /Hoofddak\s*701\sW/ }));
    expect(onKies).toHaveBeenLastCalledWith('hw-zon-batterij');
  });

  it('het blad van één plek blijft over die plek, zonder "Per plek"', () => {
    render(<Detail punt={punten.find((p) => p.sleutel === 'hw-zon-batterij')} punten={punten} stand={TIM} verdeling={verdeling} onSluit={() => {}} onKies={() => {}} />);
    const blad = screen.getByRole('dialog');
    expect(zin(blad)).toContain('Van de 701 W gaat');
    expect(zin(blad)).not.toContain('Per plek');
  });

  it('de Zon-tegel op Nu: bij twee plekken het blad van allebei, bij één plek dat van die plek', () => {
    const onKies = vi.fn();
    const stand = standUitRij({ moment: '2026-10-30T12:00:00Z', ...TIM });
    const { unmount } = render(<TabNu stand={stand} verdeling={verdeelStroom(stand)} punten={puntenVoor(LEGE_OPSTELLING, stand)} onKies={onKies} />);
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(onKies).toHaveBeenCalledWith(ZON_SAMEN);
    unmount();

    const een = standUitRij({ moment: '2026-10-30T12:00:00Z', ...TIM, zon_w: 701, zonnen: [TIM.zonnen[0]] });
    render(<TabNu stand={een} verdeling={verdeelStroom(een)} punten={puntenVoor(LEGE_OPSTELLING, een)} onKies={onKies} />);
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(onKies).toHaveBeenLastCalledWith('hw-zon-batterij');
  });
});
