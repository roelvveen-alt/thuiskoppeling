import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { luisterOnderbreken, samenTest } from './omvormerTest.mjs';

/**
 * Een nep-omvormer zoals bij Tim (31-10-2026): grens 2%, schakelaar uit. Levert wat de zon geeft,
 * en met de schakelaar aan hooguit de grens (procent van 8 kW; `eenheid` 0,1 = de grens telt in 0,1%).
 */
function nep({ grens = 2, schakelaar = 0, negeer = false, zon = 3000, stil = false, eenheid = 1, werktNiet = false } = {}) {
  const s = { grens, schakelaar, schrijven: [] };
  const geenAntwoord = async () => {
    throw new Error('geen antwoord');
  };
  return {
    s,
    verbinding: {
      leesGrens: stil ? geenAntwoord : async () => s.grens,
      leesSchakelaar: stil ? geenAntwoord : async () => s.schakelaar !== 0,
      async schrijfGrens(p) {
        s.schrijven.push(`grens ${p}`);
        if (!negeer) s.grens = p;
      },
      async schrijfSchakelaar(a) {
        s.schrijven.push(`schakelaar ${a}`);
        s.schakelaar = a;
      },
    },
    leesVermogen: async () => (stil ? null : s.schakelaar && !werktNiet ? Math.min(zon, (8000 * s.grens * eenheid) / 100) : zon),
  };
}

async function test(n, extra = {}) {
  const regels = [];
  const bewaard = { door: [], oorspronkelijk: [], nagekeken: [] };
  let gewacht = 0;
  const uitkomst = await samenTest({
    verbinding: n.verbinding,
    leesVermogen: n.leesVermogen,
    vraagStart: async () => true,
    wacht: async (ms) => {
      gewacht += ms;
    },
    uit: (t) => regels.push(t),
    schakelaarDoorOns: (aan) => bewaard.door.push(aan),
    oorspronkelijk: (o) => bewaard.oorspronkelijk.push(o),
    nagekeken: (c) => bewaard.nagekeken.push(c),
    nominaal: 8000,
    ...extra,
    onderbroken: extra.onderbroken ? () => extra.onderbroken(gewacht) : () => false,
  });
  return { uitkomst, regels, tekst: regels.join('\n'), gewacht, bewaard };
}

describe('node brug.mjs omvormer-test', () => {
  it('schakelaar uit en grens 2% (zoals bij Tim): gewoon doorgaan; 0% met aftellen, dan schakelaar uit; te weinig zon voor 50%', async () => {
    const n = nep({ zon: 1500 });
    const { uitkomst, regels, tekst, gewacht, bewaard } = await test(n);
    expect(uitkomst).toBe('klaar');
    expect(n.s.schrijven).toEqual(['grens 0', 'schakelaar 1', 'schakelaar 0']);
    expect(n.s.grens).toBe(0);
    expect(tekst).toMatch(/de teruglevergrens staat op 2%, de grensschakelaar staat uit/);
    expect(tekst).toMatch(/De schakelaar staat uit, dus de omvormer is vrij, wat de grens \(2%\) ook zegt/);
    expect(regels).toContain('  grens 0% · nog 1:55 · levert 0 W');
    expect(regels).toContain('  grens 0% · nog 0:00 · levert 0 W');
    expect(tekst).toMatch(/Het vermogen ging van 1\.500 W naar 0 W: de begrenzing werkt\./);
    expect(tekst).toMatch(/De 50%-proef heb ik overgeslagen: daarvoor moet hij vooraf meer dan 2\.000 W leveren\. Dat kan later/);
    expect(tekst).toMatch(/Vrijgeven lukte: de schakelaar staat weer uit/);
    expect(gewacht).toBeGreaterThanOrEqual(120_000);
    expect(bewaard.door).toEqual([true, false]);
    expect(bewaard.oorspronkelijk).toEqual([{ grens: 2, schakelaar: false }]);
    expect(bewaard.nagekeken).toEqual([expect.objectContaining({ uitkomst: 'werkt', pct: 0, voorW: 1500, naW: 0 })]);
  });

  it('genoeg zon: na 0% kort 50%, en de grens telt in procent', async () => {
    const n = nep({ zon: 6000 });
    const { tekst, regels, bewaard } = await test(n);
    expect(n.s.schrijven).toEqual(['grens 0', 'schakelaar 1', 'grens 50', 'schakelaar 0']);
    expect(regels).toContain('  grens 50% · nog 0:00 · levert 4.000 W');
    expect(tekst).toMatch(/Bij 50% leverde hij ~4\.000 W .*de grens telt in procent, gedeeltelijk begrenzen klopt/);
    expect(tekst).toMatch(/De grens blijft op 50% staan; met de schakelaar uit doet die niets/);
    expect(bewaard.nagekeken).toHaveLength(1);
  });

  it('genoeg zon, maar de grens telt in 0,1%: bij 50% bijna niets, dat zegt hij (en "werkt niet" voor de besturing)', async () => {
    const n = nep({ zon: 6000, eenheid: 0.1 });
    const { tekst, bewaard } = await test(n);
    expect(tekst).toMatch(/Bij 50% leverde hij bijna net zo weinig als bij 0% \(~400 W\): de grens telt hier waarschijnlijk in 0,1%/);
    expect(bewaard.nagekeken.at(-1)).toMatchObject({ uitkomst: 'werkt-niet', reden: 'te-veel', pct: 50 });
  });

  it('het vermogen blijft gelijk: "deze omvormer begrenst zo niet", geen 50%-proef', async () => {
    const n = nep({ zon: 6000, werktNiet: true });
    const { tekst, bewaard } = await test(n);
    expect(n.s.schrijven).toEqual(['grens 0', 'schakelaar 1', 'schakelaar 0']);
    expect(tekst).toMatch(/Het vermogen bleef ~6\.000 W: deze omvormer begrenst zo niet \(of er was te weinig zon om het te zien\); zet de schakelaar in de app niet aan\./);
    expect(bewaard.nagekeken).toEqual([expect.objectContaining({ uitkomst: 'werkt-niet', reden: 'geen-effect' })]);
  });

  it('te weinig zon (onder 300 W): zegt het vooraf, en na afloop "liever op een zonnig moment opnieuw"; geen oordeel', async () => {
    const n = nep({ zon: 150 });
    const { tekst, bewaard } = await test(n);
    expect(tekst).toMatch(/Let op: hij levert nu 150 W; met zo weinig zon is het effect moeilijk te zien/);
    expect(tekst).toMatch(/te weinig zon om het goed te zien\. Doe de test liever op een zonnig moment opnieuw\./);
    expect(bewaard.nagekeken).toEqual([]);
  });

  it('Ctrl+C tijdens het aftellen: meteen de schakelaar uit, geen 50%', async () => {
    const n = nep({ zon: 6000 });
    const { uitkomst, regels, gewacht } = await test(n, { onderbroken: (ms) => ms >= 30_000 });
    expect(uitkomst).toBe('klaar');
    expect(n.s.schrijven).toEqual(['grens 0', 'schakelaar 1', 'schakelaar 0']);
    expect(regels).toContain('Ctrl+C: ik zet de schakelaar meteen uit.');
    expect(gewacht).toBeLessThan(60_000);
  });

  it('de grens neemt hij niet aan: één keer opnieuw, dan stoppen; de schakelaar bleef uit', async () => {
    const n = nep({ negeer: true });
    const { uitkomst, tekst } = await test(n);
    expect(uitkomst).toBe('begrenzen-mislukt');
    expect(n.s.schrijven).toEqual(['grens 0', 'grens 0']);
    expect(tekst).toMatch(/De grens nam hij niet aan/);
  });

  it('niet begonnen (geen Enter) of geen antwoord: niets geschreven', async () => {
    const a = nep();
    expect((await test(a, { vraagStart: async () => false })).uitkomst).toBe('niet-begonnen');
    const b = nep({ stil: true });
    expect((await test(b)).uitkomst).toBe('geen-antwoord');
    expect([...a.s.schrijven, ...b.s.schrijven]).toEqual([]);
  });

  it('de schakelaar staat aan, niet door het programmaatje: niets doen en dat zeggen', async () => {
    const n = nep({ grens: 70, schakelaar: 1 });
    const { uitkomst, tekst } = await test(n);
    expect(uitkomst).toBe('eigen');
    expect(n.s.schrijven).toEqual([]);
    expect(tekst).toMatch(/De grensschakelaar staat aan, maar niet door het programmaatje/);
  });

  it('de schakelaar staat nog aan van het programmaatje: eerst uit', async () => {
    const n = nep({ grens: 20, schakelaar: 1 });
    const { uitkomst, bewaard } = await test(n, { vanOns: () => true });
    expect(uitkomst).toBe('was-begrensd');
    expect(n.s.schrijven).toEqual(['schakelaar 0']);
    expect(bewaard.door).toEqual([false]);
  });

  it('1.6.1: SIGTERM en SIGHUP (ssh weg, systemctl, kill) werken als Ctrl+C: meteen de schakelaar uit', () => {
    for (const signaal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      const proces = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
      const weg = [];
      const onderbroken = luisterOnderbreken({ proces, bezig: () => true, weg: (code) => weg.push(code) });
      expect(onderbroken()).toBe(false);
      proces.emit(signaal, signaal);
      expect(onderbroken()).toBe(true);
      expect(weg).toEqual([]);
      // Nog een keer: dan toch meteen weg.
      proces.emit(signaal, signaal);
      expect(weg).toEqual([130]);
    }
  });

  it('1.6.1: na SIGHUP (het scherm is weg) houdt een schrijffout naar het scherm het vrijgeven niet tegen', () => {
    const proces = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
    luisterOnderbreken({ proces, bezig: () => true, weg: () => {} });
    proces.emit('SIGHUP', 'SIGHUP');
    expect(() => proces.stdout.emit('error', Object.assign(new Error('EIO'), { code: 'EIO' }))).not.toThrow();
    expect(() => proces.stderr.emit('error', Object.assign(new Error('EIO'), { code: 'EIO' }))).not.toThrow();
  });

  it('1.6.1: een stopsignaal voordat er iets geschreven is: meteen weg; na Enter maar vóór het begrenzen: niet beginnen', async () => {
    const proces = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
    const weg = [];
    luisterOnderbreken({ proces, bezig: () => false, weg: (code) => weg.push(code) });
    proces.emit('SIGTERM', 'SIGTERM');
    expect(weg).toEqual([130]);
    const n = nep({ zon: 3000 });
    const { uitkomst } = await test(n, { onderbroken: () => true });
    expect(uitkomst).toBe('niet-begonnen');
    expect(n.s.schrijven).toEqual([]);
  });
});
