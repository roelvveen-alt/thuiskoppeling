import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@/api/base44Client', () => ({
  base44: { functions: { invoke: (...a) => invoke(...a) } },
  statusVan: (e) => e?.status ?? e?.response?.status ?? null,
}));

const { LoketFout, maakLoket, naarLoketFout, vraag } = await import('./huis.js');

/** Een fout zoals de SDK hem geeft bij functions.invoke (axios). */
const antwoordFout = (status, data, headers = {}) => Object.assign(new Error(`status ${status}`), { response: { status, data, headers } });

describe('naarLoketFout', () => {
  it('geeft elke fout een vaste soort en een zin', () => {
    expect(naarLoketFout(antwoordFout(401, { code: 'inloggen' })).soort).toBe('inloggen');
    expect(naarLoketFout(antwoordFout(429, {})).soort).toBe('rem');
    expect(naarLoketFout(new Error('Network Error')).soort).toBe('net');
    const weg = naarLoketFout(antwoordFout(404, { code: 'geenHuis', error: 'Deze omgeving bestaat niet (meer).' }));
    // De server zegt "omgeving"; de app zegt overal "huis".
    expect(weg).toMatchObject({ soort: 'geenHuis', message: 'Dit huis bestaat niet (meer), of je mag er niet in.', status: 404 });
    expect(naarLoketFout(antwoordFout(403, { code: 'alleenEigenaar', error: 'Alleen de eigenaar.' }))).toMatchObject({
      soort: 'alleenEigenaar',
      message: 'Alleen de eigenaar.',
    });
    expect(naarLoketFout(antwoordFout(500, { error: { message: 'kapot' } }))).toMatchObject({ soort: 'fout', message: expect.stringMatching(/Er ging iets mis/) });
  });

  it('een functie die er nog niet is, of een vraag die hij niet kent: de app wordt net bijgewerkt', () => {
    for (const fout of [antwoordFout(404, { detail: 'Function not found' }), antwoordFout(404, ''), antwoordFout(400, { code: 'onbekendeActie' })]) {
      const uit = naarLoketFout(fout);
      expect(uit.soort).toBe('nietBijgewerkt');
      expect(uit.message).toMatch(/De app wordt net bijgewerkt\. Probeer het over een minuut opnieuw/);
    }
  });
});

describe('het loket', () => {
  let gewacht;
  let loket;
  beforeEach(() => {
    gewacht = [];
    // Alleen de klok is nep: wachten zet hem vooruit, zonder echt te wachten.
    vi.useFakeTimers({ toFake: ['Date'] });
    loket = maakLoket({
      slaap: async (ms) => {
        gewacht.push(ms);
        vi.setSystemTime(Date.now() + ms);
      },
    });
  });
  afterEach(() => vi.useRealTimers());

  it('één vraag tegelijk, in volgorde', async () => {
    const log = [];
    let laatEerste;
    const eerste = loket(async () => {
      log.push('eerste begint');
      await new Promise((klaar) => {
        laatEerste = klaar;
      });
      log.push('eerste klaar');
      return 1;
    });
    const tweede = loket(async () => {
      log.push('tweede begint');
      return 2;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(log).toEqual(['eerste begint']);
    laatEerste();
    expect(await Promise.all([eerste, tweede])).toEqual([1, 2]);
    expect(log).toEqual(['eerste begint', 'eerste klaar', 'tweede begint']);
  });

  it('bij de rem pauzeert het hele loket: 3 en 6 s, of wat de server zegt (hooguit 30 s)', async () => {
    let keer = 0;
    const geremd = loket(async () => {
      keer += 1;
      if (keer === 1) throw antwoordFout(429, {});
      if (keer === 2) throw antwoordFout(429, {});
      return 'gelukt';
    });
    const daarna = loket(async () => 'ook');
    expect(await geremd).toBe('gelukt');
    expect(await daarna).toBe('ook');
    expect(gewacht).toEqual([3000, 6000]);

    gewacht.length = 0;
    keer = 0;
    await loket(async () => {
      keer += 1;
      if (keer === 1) throw antwoordFout(429, { retry_after: 600 }, { 'retry-after': '600' });
      return 'ok';
    });
    expect(gewacht).toEqual([30_000]);
  });

  it('na drie pauzes geeft hij het op, en het loket blijft werken', async () => {
    await expect(loket(async () => Promise.reject(antwoordFout(429, {})))).rejects.toMatchObject({ soort: 'rem' });
    expect(gewacht).toEqual([3000, 6000, 12000]);
    expect(await loket(async () => 'weer')).toBe('weer');
  });

  it('met herhalen: false geeft een vraag bij de rem meteen op; de pauze geldt voor de volgende', async () => {
    let keer = 0;
    const rem = async () => {
      keer += 1;
      return Promise.reject(antwoordFout(429, { retry_after: 3 }));
    };
    await expect(loket(rem, { herhalen: false })).rejects.toMatchObject({ soort: 'rem' });
    expect(keer).toBe(1);
    expect(gewacht).toEqual([]);
    expect(await loket(async () => 'daarna')).toBe('daarna');
    expect(gewacht).toEqual([3000]);
  });

  it('niets blijft hangen: zonder antwoord geeft een vraag het op, de volgende gaat door', async () => {
    const hangt = loket(() => new Promise(() => {}), { tijd: 20 });
    const volgende = loket(async () => 'door');
    await expect(hangt).rejects.toBeInstanceOf(LoketFout);
    await expect(hangt).rejects.toMatchObject({ soort: 'net' });
    expect(await volgende).toBe('door');
  });
});

describe('vraag', () => {
  it('stuurt de actie naar de functie huis en geeft het antwoord', async () => {
    invoke.mockResolvedValueOnce({ status: 200, data: { meting: null } });
    expect(await vraag('stand', { huis_id: 'huis-1' })).toEqual({ meting: null });
    expect(invoke).toHaveBeenCalledWith('huis', { actie: 'stand', huis_id: 'huis-1' });
  });
});
