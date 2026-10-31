import { describe, expect, it } from 'vitest';
import { keuzeTab, keuzeToets } from './keuzeToets';

/** Drie nep-keuzes; elk onthoudt of hij focus kreeg en aangeklikt werd. */
function rij() {
  const log = [];
  const keuzes = ['a', 'b', 'c'].map((naam) => ({
    naam,
    disabled: false,
    getAttribute: (k) => (k === 'role' ? 'radio' : null),
    focus: () => log.push(`focus ${naam}`),
    click: () => log.push(`klik ${naam}`),
  }));
  const groep = { querySelectorAll: () => keuzes };
  const druk = (i, key) => {
    let tegen = false;
    keuzeToets({ key, target: keuzes[i], currentTarget: groep, preventDefault: () => (tegen = true) });
    return tegen;
  };
  return { log, druk };
}

describe('keuzeToets', () => {
  it('pijltjes gaan rond en kiezen meteen', () => {
    const { log, druk } = rij();
    expect(druk(2, 'ArrowRight')).toBe(true);
    druk(0, 'ArrowLeft');
    druk(1, 'Home');
    druk(0, 'End');
    expect(log).toEqual(['focus a', 'klik a', 'focus c', 'klik c', 'focus a', 'klik a', 'focus c', 'klik c']);
  });
  it('andere toetsen laat hij met rust', () => {
    const { log, druk } = rij();
    expect(druk(0, 'Enter')).toBe(false);
    expect(log).toEqual([]);
  });
});

describe('keuzeTab', () => {
  it('de gekozen keuze, of de eerste als er niets gekozen is', () => {
    expect(keuzeTab(true, 2)).toBe(0);
    expect(keuzeTab(false, 0)).toBe(-1);
    expect(keuzeTab(false, 0, false)).toBe(0);
    expect(keuzeTab(false, 1, false)).toBe(-1);
  });
});
