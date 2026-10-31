import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { entryBestanden, SDK_IN_FUNCTIE, verouderdUit } from '../../scripts/nieuwste.mjs';

const pakket = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

describe('versies', () => {
  it('elke entry.ts gebruikt dezelfde @base44/sdk als de site (package.json)', () => {
    const bestanden = entryBestanden();
    expect(bestanden.length).toBeGreaterThan(0);
    for (const f of bestanden) {
      const versies = [...fs.readFileSync(f, 'utf8').matchAll(SDK_IN_FUNCTIE)].map((m) => m[1]);
      expect(versies.length, f).toBeGreaterThan(0);
      for (const v of versies) expect(v, f).toBe(pakket.dependencies['@base44/sdk']);
    }
  });

  it('nieuwste.mjs: geen antwoord van het register is geen "alles is de nieuwste"', () => {
    expect(verouderdUit({ status: 1, stdout: '{"error":{"code":"ECONNREFUSED"}}' })).toBeNull();
    expect(verouderdUit({ status: null, stdout: '', error: new Error('ETIMEDOUT') })).toBeNull();
    expect(verouderdUit({ status: 254, stdout: '' })).toBeNull();
    expect(verouderdUit({ status: 0, stdout: 'geen json' })).toBeNull();
    expect(verouderdUit({ status: 0, stdout: '' })).toEqual([]);
    expect(verouderdUit({ status: 1, stdout: '{"vite":{"current":"8.0.0","wanted":"8.0.0","latest":"8.1.0"}}' })).toEqual([
      ['vite', { current: '8.0.0', wanted: '8.0.0', latest: '8.1.0' }],
    ]);
  });
});
