import { describe, expect, it } from 'vitest';
import { gespreid, isRem, metGeduld, remAntwoord } from '../shared/geduld.js';

const rem = () => Object.assign(new Error('Rate limit exceeded'), { status: 429 });

describe('metGeduld', () => {
  it('bij de rem twee keer opnieuw, met ~0,4 en ~1,2 s ertussen', async () => {
    const gewacht = [];
    let keer = 0;
    const uit = await metGeduld(
      async () => {
        keer += 1;
        if (keer < 3) throw rem();
        return 'gelukt';
      },
      { wacht: async (ms) => gewacht.push(ms), toeval: () => 0.5 },
    );
    expect(uit).toBe('gelukt');
    expect(gewacht).toEqual([400, 1200]);
  });

  it('daarna geeft hij het op, en een andere fout herhaalt hij niet', async () => {
    let keer = 0;
    const altijdRem = () => {
      keer += 1;
      throw rem();
    };
    await expect(metGeduld(altijdRem, { wacht: async () => {} })).rejects.toMatchObject({ status: 429 });
    expect(keer).toBe(3);

    keer = 0;
    const kapot = () => {
      keer += 1;
      throw Object.assign(new Error('stuk'), { status: 500 });
    };
    await expect(metGeduld(kapot, { wacht: async () => {} })).rejects.toThrow('stuk');
    expect(keer).toBe(1);
  });

  it('herkent de rem op status en op tekst; spreidt ±30%', () => {
    expect(isRem(rem())).toBe(true);
    expect(isRem({ response: { status: 429 } })).toBe(true);
    expect(isRem(new Error('Too Many Requests'))).toBe(true);
    expect(isRem(new Error('Not found'))).toBe(false);
    expect(gespreid(1000, () => 0)).toBe(700);
    expect(gespreid(1000, () => 1)).toBe(1300);
  });

  it('het antwoord aan de app: 429 met Retry-After', async () => {
    const res = remAntwoord();
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('3');
    expect(await res.json()).toMatchObject({ code: 'rem', retry_after: 3 });
  });
});
