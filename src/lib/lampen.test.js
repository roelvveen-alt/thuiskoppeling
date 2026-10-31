import { describe, expect, it } from 'vitest';
import { lampenUit, lampTekst, spotsAan } from './lampen';

describe('lampenUit', () => {
  it('mild: rommel valt weg, een oudere meting geeft een lege lijst', () => {
    expect(lampenUit(undefined)).toEqual([]);
    expect(lampenUit([null, { naam: 'zonder sleutel' }, { sleutel: 'tuya-spots', naam: 'Spots', aan: true, helderheid: 64, rol: 'spots' }, { sleutel: 'tuya-x', aan: 'ja', soort: 'raar' }])).toEqual([
      { sleutel: 'tuya-spots', naam: 'Spots', soort: 'lamp', aan: true, helderheid: 64, spots: true },
      { sleutel: 'tuya-x', naam: '', soort: 'lamp', aan: null, helderheid: null, spots: false },
    ]);
  });
});

describe('spotsAan', () => {
  const lamp = (aan, spots = false) => ({ sleutel: `l${Math.random()}`, aan, spots });
  it('de lampen met rol spots beslissen', () => {
    expect(spotsAan([lamp(false, true), lamp(true)])).toBe(false);
    expect(spotsAan([lamp(true, true), lamp(false, true)])).toBe(true);
    expect(spotsAan([lamp(null, true)])).toBe(false);
  });
  it('zonder spots: een lamp aan; zonder lampen: null', () => {
    expect(spotsAan([lamp(false), lamp(true)])).toBe(true);
    expect(spotsAan([lamp(false)])).toBe(false);
    expect(spotsAan([])).toBeNull();
    expect(spotsAan(undefined)).toBeNull();
  });
});

describe('lampTekst', () => {
  it('in woorden', () => {
    expect(lampTekst({ aan: true, helderheid: 64 })).toBe('aan · 64%');
    expect(lampTekst({ aan: true, helderheid: null })).toBe('aan');
    expect(lampTekst({ aan: false })).toBe('uit');
    expect(lampTekst({ aan: null })).toBe('weet niet');
  });
});
