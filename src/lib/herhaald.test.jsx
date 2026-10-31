// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/base44Client', () => ({ VOORBEELD: false, APP_ID: 'app-test', base44: {}, statusVan: () => null }));
vi.mock('@/api/huis', async (origineel) => ({ ...(await origineel()), naarInloggen: vi.fn() }));

const { LoketFout } = await import('@/api/huis');
const { useHerhaald } = await import('./herhaald');

const NU = Date.parse('2026-10-30T12:00:00Z');
const verder = async (ms) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => vi.useFakeTimers({ now: NU }));
afterEach(() => vi.useRealTimers());

describe('useHerhaald (logboek, alle huizen)', () => {
  it('meteen bij openen, dan elke elkeMs; dicht = niets meer', async () => {
    const werk = vi.fn(async () => ({ n: werk.mock.calls.length }));
    const { result, rerender } = renderHook((p) => useHerhaald({ werk, sleutel: 'a1', elkeMs: 30_000, ...p }), { initialProps: { actief: true } });
    await verder(0);
    expect(werk).toHaveBeenCalledTimes(1);
    expect(result.current).toMatchObject({ status: 'klaar', data: { n: 1 } });
    await verder(29_000);
    expect(werk).toHaveBeenCalledTimes(1);
    await verder(1000);
    expect(werk).toHaveBeenCalledTimes(2);
    rerender({ actief: false });
    await verder(120_000);
    expect(werk).toHaveBeenCalledTimes(2);
  });

  it('dicht en weer open binnen elkeMs: wat er was meteen, geen vraag extra', async () => {
    const werk = vi.fn(async () => 'antwoord');
    const eerste = renderHook(() => useHerhaald({ werk, sleutel: 'a2', actief: true, elkeMs: 30_000 }));
    await verder(0);
    eerste.unmount();
    await verder(10_000);
    const tweede = renderHook(() => useHerhaald({ werk, sleutel: 'a2', actief: true, elkeMs: 30_000 }));
    await verder(0);
    expect(tweede.result.current).toMatchObject({ status: 'klaar', data: 'antwoord' });
    expect(werk).toHaveBeenCalledTimes(1);
    await verder(20_000);
    expect(werk).toHaveBeenCalledTimes(2);
    tweede.unmount();
  });

  it('een geweigerde of onbekende vraag zegt dat, zonder harder te gaan', async () => {
    const werk = vi.fn(async () => {
      throw new LoketFout('alleenBeheerder', 'nee', 403);
    });
    const { result, unmount } = renderHook(() => useHerhaald({ werk, sleutel: 'a3', actief: true, elkeMs: 30_000 }));
    await verder(0);
    expect(result.current.status).toBe('geweigerd');
    await verder(29_000);
    expect(werk).toHaveBeenCalledTimes(1);
    unmount();
  });
});
