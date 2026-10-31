import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VERSIE, versieMetCommit } from './versie.mjs';

describe('versie van het programmaatje', () => {
  it('package.json en package-lock.json zeggen hetzelfde als versie.mjs', () => {
    const pakket = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
    const slot = JSON.parse(fs.readFileSync(new URL('./package-lock.json', import.meta.url), 'utf8'));
    expect(pakket.version).toBe(VERSIE);
    expect(slot.version).toBe(VERSIE);
    expect(slot.packages[''].version).toBe(VERSIE);
  });

  it('met de commit erbij; zonder git alleen het nummer (past in brug.versie van de app)', () => {
    expect(versieMetCommit({ voer: () => 'abc1234\n' })).toBe(`${VERSIE}+abc1234`);
    expect(versieMetCommit({ voer: () => 'fatal: not a git repository' })).toBe(VERSIE);
    expect(
      versieMetCommit({
        voer: () => {
          throw new Error('geen git');
        },
      }),
    ).toBe(VERSIE);
    expect(`${VERSIE}+abc1234`).toMatch(/^[0-9A-Za-z.+-]{1,20}$/);
  });
});
