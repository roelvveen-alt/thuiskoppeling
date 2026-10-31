import { describe, expect, it, vi } from 'vitest';
import { fotoBron, wisFotoKast } from './fotoKast';

function nepKasten() {
  const kasten = new Map();
  return {
    kasten,
    async open(naam) {
      if (!kasten.has(naam)) kasten.set(naam, new Map());
      const kast = kasten.get(naam);
      return {
        match: async (s) => kast.get(s),
        put: async (s, a) => void kast.set(s, a),
        keys: async () => [...kast.keys()].map((url) => ({ url })),
        delete: async (v) => kast.delete(v.url),
      };
    },
    async delete(naam) {
      return kasten.delete(naam);
    },
  };
}

const antwoord = (tekst) => ({ ok: true, clone: () => antwoord(tekst), blob: async () => tekst });
const maakAdres = (blob) => `blob:${blob}`;

describe('fotoBron: de foto alleen opnieuw halen als het een andere is', () => {
  it('zelfde kenmerk met een nieuwe link: uit de kast, niet opnieuw van internet', async () => {
    const kasten = nepKasten();
    const haal = vi.fn(async () => antwoord('foto1'));
    expect(await fotoBron('abc', 'https://x/f?sig=1', { kasten, haal, maakAdres })).toBe('blob:foto1');
    expect(await fotoBron('abc', 'https://x/f?sig=2', { kasten, haal, maakAdres })).toBe('blob:foto1');
    expect(haal).toHaveBeenCalledTimes(1);
  });

  it('een andere foto: opnieuw halen, en de oude gaat uit de kast', async () => {
    const kasten = nepKasten();
    const haal = vi.fn(async (url) => antwoord(url.includes('nieuw') ? 'foto2' : 'foto1'));
    await fotoBron('abc', 'https://x/oud', { kasten, haal, maakAdres });
    expect(await fotoBron('def', 'https://x/nieuw', { kasten, haal, maakAdres })).toBe('blob:foto2');
    expect([...kasten.kasten.values()][0].size).toBe(1);
  });

  it('een oude server zonder kenmerk, of iets dat misgaat: gewoon de link, zoals vroeger', async () => {
    const kasten = nepKasten();
    expect(await fotoBron(undefined, 'https://x/f', { kasten, haal: vi.fn(), maakAdres })).toBe('https://x/f');
    expect(await fotoBron('abc', 'https://x/f', { kasten, haal: async () => { throw new TypeError('cors'); }, maakAdres })).toBe('https://x/f');
    expect(await fotoBron('abc', 'https://x/f', { kasten, haal: async () => ({ ok: false }), maakAdres })).toBe('https://x/f');
    expect(await fotoBron('abc', 'https://x/f', { kasten: undefined, maakAdres })).toBe('https://x/f');
    expect(await fotoBron('abc', null, { kasten, maakAdres })).toBeNull();
  });

  it('wissen maakt de kast leeg en struikelt niet zonder Cache API', async () => {
    const kasten = nepKasten();
    await fotoBron('abc', 'https://x/f', { kasten, haal: async () => antwoord('f'), maakAdres });
    await wisFotoKast({ kasten });
    expect(kasten.kasten.size).toBe(0);
    await expect(wisFotoKast({ kasten: undefined })).resolves.toBeUndefined();
  });
});
