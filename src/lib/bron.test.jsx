// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/base44Client', () => ({ VOORBEELD: false, APP_ID: 'app-test', base44: {}, statusVan: () => null }));

const vraag = vi.fn();
vi.mock('@/api/huis', async (origineel) => ({
  ...(await origineel()),
  vraag: (...a) => vraag(...a),
  naarInloggen: vi.fn(),
}));

const { LoketFout } = await import('@/api/huis');
const { RUSTIG_ELKE_MS, useStand, wachtNaLezing, wachtNaRem } = await import('./bron');

const NU = Date.parse('2026-10-30T12:00:00Z');
const meting = (msGeleden = 0, elke = 5) => ({
  meting: { moment: new Date(Date.now() - msGeleden).toISOString(), net_w: 100, brug: { elke_seconden: elke } },
});
const standen = () => vraag.mock.calls.filter(([actie]) => actie === 'stand').length;
const verder = async (ms) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  vi.useFakeTimers({ now: NU });
  vraag.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('wachtNaLezing', () => {
  const stand = (msGeleden, elke) => ({ moment: new Date(NU - msGeleden).toISOString(), brug: { elkeSeconden: elke } });
  it('volgt het programmaatje, nooit vaker dan elke 5 s', () => {
    expect(wachtNaLezing(stand(2000, 5), { nu: NU })).toBe(5000);
    expect(wachtNaLezing(stand(2000, 10), { nu: NU })).toBe(10_000);
    expect(wachtNaLezing(stand(2000, 2), { nu: NU })).toBe(5000);
    expect(wachtNaLezing(stand(2000, null), { nu: NU })).toBe(5000);
  });
  it('rustig als er niets nieuws komt, nog nooit iets kwam, of op een tabblad zonder live cijfers', () => {
    expect(wachtNaLezing(stand(120_000, 5), { nu: NU })).toBe(RUSTIG_ELKE_MS);
    expect(wachtNaLezing(null, { nu: NU })).toBe(RUSTIG_ELKE_MS);
    expect(wachtNaLezing(stand(2000, 5), { nu: NU, snel: false })).toBe(RUSTIG_ELKE_MS);
  });
});

describe('wachtNaRem', () => {
  it('na de rem minstens 15 s plus tot 5 s toeval, oplopend tot een minuut', () => {
    expect(wachtNaRem(5000, 0)).toBe(15_000);
    expect(wachtNaRem(5000, 1)).toBe(20_000);
    expect(wachtNaRem(20_000, 0.5)).toBe(42_500);
    expect(wachtNaRem(60_000, 1)).toBe(60_000);
  });
});

describe('useStand', () => {
  it('na "nietBijgewerkt" (een uitrol) blijft hij rustig proberen, en is binnen een minuut weer live', async () => {
    vraag.mockRejectedValueOnce(new LoketFout('nietBijgewerkt'));
    vraag.mockImplementation(async () => meting());
    const { result } = renderHook(() => useStand('huis-1', 'wassen', 'gewoon'));
    await verder(0);
    expect(result.current.status).toBe('nietBijgewerkt');
    expect(standen()).toBe(1);
    await verder(14_000);
    expect(standen()).toBe(1);
    await verder(1_000);
    expect(standen()).toBe(2);
    expect(result.current.status).toBe('live');
  });

  it('dezelfde meting nog eens: dezelfde stand (het scherm hoeft niets opnieuw te rekenen)', async () => {
    const vast = meting();
    vraag.mockImplementation(async () => vast);
    const { result } = renderHook(() => useStand('huis-1', 'wassen', 'gewoon'));
    await verder(0);
    const eerste = result.current.stand;
    expect(eerste).not.toBeNull();
    await verder(5_000);
    expect(standen()).toBe(2);
    expect(result.current.stand).toBe(eerste);
  });

  it('bij "geenHuis" stopt hij wel', async () => {
    vraag.mockRejectedValue(new LoketFout('geenHuis'));
    const { result } = renderHook(() => useStand('huis-1', 'wassen', 'gewoon'));
    await verder(0);
    expect(result.current.status).toBe('geenHuis');
    await verder(5 * 60_000);
    expect(standen()).toBe(1);
  });

  it('staat het programmaatje stil, dan eens per 30 s; op een rustig tabblad ook; terug op Huis meteen', async () => {
    vraag.mockImplementation(async () => meting(5 * 60_000));
    const { rerender } = renderHook(({ snel }) => useStand('huis-1', 'wassen', 'gewoon', { snel }), {
      initialProps: { snel: true },
    });
    await verder(0);
    await verder(29_000);
    expect(standen()).toBe(1);
    await verder(1_000);
    expect(standen()).toBe(2);

    vraag.mockImplementation(async () => meting(0));
    await verder(30_000);
    expect(standen()).toBe(3);
    await verder(5_000);
    expect(standen()).toBe(4);

    rerender({ snel: false });
    await verder(5_000);
    expect(standen()).toBe(5);
    await verder(10_000);
    expect(standen()).toBe(5);
    rerender({ snel: true });
    await verder(0);
    expect(standen()).toBe(6);
  });
});

describe('brugUit: meldingen van het programmaatje', () => {
  it('met meldingen (0.5.2) en zonder (oudere brug): altijd een lijst', async () => {
    const { brugUit } = await import('./bron');
    const basis = { versie: '0.5.2+abc1234', gestart: '2026-10-30T06:44:10.000Z', elke_seconden: 5 };
    const uit = brugUit({ ...basis, meldingen: [{ soort: 'prijzen', tekst: 'Zonneplan: opnieuw inloggen', sinds: '2026-10-29T07:12:00.000Z' }, { soort: 'x' }] });
    expect(uit.meldingen).toEqual([{ soort: 'prijzen', tekst: 'Zonneplan: opnieuw inloggen', sinds: Date.parse('2026-10-29T07:12:00.000Z') }]);
    expect(brugUit(basis).meldingen).toEqual([]);
  });
});
