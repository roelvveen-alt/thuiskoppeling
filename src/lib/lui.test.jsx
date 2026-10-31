// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { laadStraks, lui } from './lui.jsx';

afterEach(cleanup);

const Hallo = () => <p>Hallo</p>;

describe('lui: een deel dat pas laadt als het nodig is', () => {
  it('laadt één keer, ook als vooraf en het scherm het allebei vragen', async () => {
    const laad = vi.fn(async () => ({ default: Hallo }));
    const deel = lui(laad);
    await deel.vooraf();
    render(
      <Suspense fallback={null}>
        <deel.Onderdeel />
      </Suspense>,
    );
    expect(await screen.findByText('Hallo')).toBeTruthy();
    expect(laad).toHaveBeenCalledTimes(1);
  });

  it('mislukt het even (geen verbinding), dan nog eens', async () => {
    const laad = vi.fn().mockRejectedValueOnce(new Error('weg')).mockResolvedValue({ default: Hallo });
    const deel = lui(laad, { wachtMs: 1 });
    render(
      <Suspense fallback={null}>
        <deel.Onderdeel />
      </Suspense>,
    );
    expect(await screen.findByText('Hallo')).toBeTruthy();
    expect(laad).toHaveBeenCalledTimes(2);
  });

  it('een mislukt vooraf laden telt niet: de volgende keer opnieuw', async () => {
    const laad = vi.fn().mockRejectedValueOnce(new Error('weg')).mockResolvedValue({ default: Hallo });
    const deel = lui(laad, { pogingen: 1 });
    await expect(deel.vooraf()).rejects.toThrow('weg');
    await expect(deel.vooraf()).resolves.toEqual({ default: Hallo });
  });

  it('lukt het helemaal niet (ook: de app is net bijgewerkt), dan een kaart met Opnieuw laden, geen leeg scherm', async () => {
    const deel = lui(async () => {
      throw new Error('Failed to fetch dynamically imported module');
    }, { wachtMs: 1 });
    render(
      <Suspense fallback={null}>
        <deel.Onderdeel />
      </Suspense>,
    );
    expect(await screen.findByText(/kwam niet binnen/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Opnieuw laden/ })).toBeTruthy();
  });

  it('laadStraks: na het openen alles één voor één; dicht vóór de tijd is niets', async () => {
    vi.useFakeTimers();
    try {
      const a = { vooraf: vi.fn(async () => {}) };
      const b = { vooraf: vi.fn(async () => {}) };
      const stop = laadStraks([a, b], { ms: 100 });
      expect(a.vooraf).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(5000);
      expect(a.vooraf).toHaveBeenCalledTimes(1);
      expect(b.vooraf).toHaveBeenCalledTimes(1);
      stop();
      const c = { vooraf: vi.fn(async () => {}) };
      laadStraks([c], { ms: 100 })();
      await vi.advanceTimersByTimeAsync(5000);
      expect(c.vooraf).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
