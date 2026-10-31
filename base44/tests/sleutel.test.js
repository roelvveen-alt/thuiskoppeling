import { describe, expect, it } from 'vitest';
import { maakSleutel, sha256Hex, sleutelVorm } from '../shared/sleutel.js';

describe('sleutel van het programmaatje', () => {
  it('48 tekens hex, elke keer anders', () => {
    const a = maakSleutel();
    expect(sleutelVorm(a)).toBe(true);
    expect(maakSleutel()).not.toBe(a);
    expect(sleutelVorm(a.toUpperCase())).toBe(false);
    expect(sleutelVorm(`${a}0`)).toBe(false);
    expect(sleutelVorm(null)).toBe(false);
  });

  it('SHA-256 als hex', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
