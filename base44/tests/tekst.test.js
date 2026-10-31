import { describe, expect, it } from 'vitest';
import { schoon } from '../shared/tekst.js';

describe('schoon', () => {
  it('haalt stuurtekens, onzichtbare en omkeertekens weg; tab en nieuwe regel worden een spatie', () => {
    expect(schoon('a\u0000b\u007fc\u009f', 10)).toBe('abc');
    expect(schoon('\u202eevil\u202c \u2066x\u2069\u200b\u200f\ufeff', 20)).toBe('evil x');
    expect(schoon('een\tTwee\r\ndrie', 20)).toBe('een Twee drie');
    expect(schoon('Cafe\u0301', 10)).toBe('Café');
  });

  it('knipt op hele tekens en geeft een lege tekst als het geen tekst is', () => {
    expect(schoon('😀😀😀', 2)).toBe('😀😀');
    expect(schoon('  ab  ', 1)).toBe('a');
    expect(schoon(null, 10)).toBe('');
    expect(schoon(42, 10)).toBe('');
  });
});
