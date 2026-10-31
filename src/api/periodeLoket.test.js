import { describe, expect, it, vi } from 'vitest';

vi.mock('@/api/base44Client', () => ({ base44: null, statusVan: () => null }));

const { LoketFout, maakPeriodeLoket, PERIODE_ELKE_MS } = await import('./huis.js');

function opzet() {
  let nu = Date.parse('2026-10-30T11:00:00Z');
  const vraagFn = vi.fn(async (actie, invoer) => ({ ...invoer, actie, dagen: [] }));
  const vraagPeriode = maakPeriodeLoket({ vraagFn, klok: () => nu });
  return { vraagFn, vraagPeriode, verder: (ms) => (nu += ms) };
}

describe('een periode bij het loket', () => {
  it('hooguit eens per paar minuten dezelfde periode, niet elke 5 seconden', async () => {
    const { vraagFn, vraagPeriode, verder } = opzet();
    expect(await vraagPeriode('huis-tim01', '2026-10-26', '2026-11-01')).toMatchObject({ actie: 'periode', huis_id: 'huis-tim01', van: '2026-10-26', tot: '2026-11-01' });
    for (let i = 0; i < 30; i++) {
      verder(5_000);
      await vraagPeriode('huis-tim01', '2026-10-26', '2026-11-01');
    }
    expect(vraagFn).toHaveBeenCalledTimes(1);
    verder(PERIODE_ELKE_MS);
    await vraagPeriode('huis-tim01', '2026-10-26', '2026-11-01');
    expect(vraagFn).toHaveBeenCalledTimes(2);
  });

  it('een andere periode of een ander huis is een andere vraag; een lopende vraag wordt gedeeld', async () => {
    const { vraagFn, vraagPeriode } = opzet();
    const [a, b] = await Promise.all([vraagPeriode('huis-tim01', '2026-10-01', '2026-10-31'), vraagPeriode('huis-tim01', '2026-10-01', '2026-10-31')]);
    expect(a).toBe(b);
    await vraagPeriode('huis-tim01', '2026-01-01', '2026-12-31');
    await vraagPeriode('huis-dirk001', '2026-01-01', '2026-12-31');
    expect(vraagFn).toHaveBeenCalledTimes(3);
  });

  it('na een fout niet meteen opnieuw, wel na een halve minuut', async () => {
    const { vraagFn, vraagPeriode, verder } = opzet();
    vraagFn.mockRejectedValueOnce(new LoketFout('nietBijgewerkt'));
    await expect(vraagPeriode('huis-tim01', '2026-10-26', '2026-11-01')).rejects.toMatchObject({ soort: 'nietBijgewerkt' });
    verder(5_000);
    await expect(vraagPeriode('huis-tim01', '2026-10-26', '2026-11-01')).rejects.toMatchObject({ soort: 'nietBijgewerkt' });
    expect(vraagFn).toHaveBeenCalledTimes(1);
    verder(30_000);
    expect((await vraagPeriode('huis-tim01', '2026-10-26', '2026-11-01')).dagen).toEqual([]);
    expect(vraagFn).toHaveBeenCalledTimes(2);
  });
});
