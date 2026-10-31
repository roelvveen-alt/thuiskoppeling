import { describe, expect, it } from 'vitest';
import { heleWatt, lijnenVoorTekening, stromenBij, verdeelStroom } from './stroom';

const w = (verdeling, van, naar) => verdeling.stromen.find((s) => s.van === van && s.naar === naar)?.w ?? 0;
/** Alles wat er van of naar één punt gaat, opgeteld (over alle plekken met panelen). */
const totaal = (verdeling, kant, sleutel) => verdeling.stromen.filter((s) => s[kant] === sleutel).reduce((som, s) => som + s.w, 0);

/** Tims echte standen van 30 oktober, met zijn twee zonnemeters. */
const tim = (hoofddak, dierenverblijf, batterij_w, net_w) => ({
  zonnen: [
    { sleutel: 'hw-zon-batterij', naam: 'zon + batterij', vermogen_w: hoofddak },
    { sleutel: 'hw-zon-dierenverblijf', naam: 'Zon dierenverblijf', vermogen_w: dierenverblijf },
  ],
  batterij_w,
  net_w,
});
const HD = 'hw-zon-batterij';
const DV = 'hw-zon-dierenverblijf';

describe('verdeelStroom: de batterij gaat voor', () => {
  it('11:02 bij Tim: de zon laadt eerst de batterij, dan het huis, de rest naar het net', () => {
    const v = verdeelStroom(tim(701, 433, -627, -49));
    expect(v.zon_w).toBe(1134);
    expect(v.huis_w).toBe(458);
    expect(v.soorten).toEqual({ 'zon>batterij': 627, 'zon>huis': 458, 'zon>net': 49, 'batterij>huis': 0, 'batterij>net': 0, 'net>batterij': 0, 'net>huis': 0 });
    // Per plek in hele watts: elke plek telt op tot wat hij levert, elke stroom tot zijn totaal.
    expect([w(v, HD, 'batterij'), w(v, HD, 'huis'), w(v, HD, 'net')]).toEqual([388, 283, 30]);
    expect([w(v, DV, 'batterij'), w(v, DV, 'huis'), w(v, DV, 'net')]).toEqual([239, 175, 19]);
    expect(totaal(v, 'van', HD)).toBe(701);
    expect(totaal(v, 'van', DV)).toBe(433);
    expect(totaal(v, 'naar', 'batterij')).toBe(627);
    expect(totaal(v, 'naar', 'huis')).toBe(458);
    expect(totaal(v, 'naar', 'net')).toBe(49);
  });

  it('Tims voorbeeld: zon 1000 W, de batterij trekt 2300 W, dan komt er 1300 W uit het net (en het huis ook)', () => {
    const v = verdeelStroom(tim(600, 400, -2300, 1750));
    expect(v.huis_w).toBe(450);
    expect(totaal(v, 'naar', 'batterij')).toBe(2300);
    expect(w(v, HD, 'batterij') + w(v, DV, 'batterij')).toBe(1000);
    expect(w(v, 'net', 'batterij')).toBe(1300);
    expect(w(v, 'net', 'huis')).toBe(450);
    expect(v.stromen.some((s) => s.naar === 'huis' && s.van !== 'net')).toBe(false);
  });

  it('11:08 bij Tim: 1078 W zon, de batterij laadt 2418 W, het huis 460 W uit het net', () => {
    const v = verdeelStroom(tim(656, 422, -2418, 1800));
    expect(v.huis_w).toBe(460);
    expect(v.soorten).toMatchObject({ 'zon>batterij': 1078, 'zon>huis': 0, 'net>batterij': 1340, 'net>huis': 460 });
  });

  it('de zon dekt de batterij, het huis maar half: de rest van het huis uit het net', () => {
    const v = verdeelStroom({ zon_w: 2433, batterij_w: -2300, net_w: 387 });
    expect(v.soorten).toMatchObject({ 'zon>batterij': 2300, 'zon>huis': 133, 'net>batterij': 0, 'net>huis': 387 });
    expect(v.huis_w).toBe(520);
  });

  it('levert de batterij, dan blijft de zon eerst voor het huis (08:26 bij Tim: de batterij verkoopt)', () => {
    const v = verdeelStroom(tim(262, 142, 1700, -1675));
    expect(v.huis_w).toBe(429);
    expect(v.soorten).toMatchObject({ 'zon>huis': 404, 'zon>net': 0, 'batterij>huis': 25, 'batterij>net': 1675 });
  });

  it('eerst hele watts, dan rekenen: het huis is overal hetzelfde getal en alles telt op', () => {
    const v = verdeelStroom(tim(700.6, 432.6, -627.4, -48.6));
    expect(v.plekken).toEqual([
      { sleutel: HD, w: 701 },
      { sleutel: DV, w: 433 },
    ]);
    expect([v.zon_w, v.batterij_w, v.net_w, v.huis_w]).toEqual([1134, -627, -49, 458]);
    for (const s of v.stromen) expect(Number.isInteger(s.w)).toBe(true);
    expect(totaal(v, 'naar', 'huis')).toBe(v.huis_w);
  });

  it('afronden zoals vermogen() het laat zien, ook onder nul', () => {
    expect(heleWatt(-647.5)).toBe(-648);
    expect(heleWatt(647.5)).toBe(648);
    expect(heleWatt(-0.4)).toBe(0);
    expect(Object.is(heleWatt(-0.4), -0)).toBe(false);
    expect(heleWatt(null)).toBeNull();
    expect(heleWatt(Number.NaN)).toBeNull();
  });

  it('drie plekken met lastige getallen: per plek en per stroom precies op de watt', () => {
    const v = verdeelStroom({
      zonnen: [
        { sleutel: 'a', vermogen_w: 333 },
        { sleutel: 'b', vermogen_w: 333 },
        { sleutel: 'c', vermogen_w: 334 },
      ],
      batterij_w: -401,
      net_w: -299,
    });
    expect(v.huis_w).toBe(300);
    for (const [plek, wat] of [
      ['a', 333],
      ['b', 333],
      ['c', 334],
    ])
      expect(totaal(v, 'van', plek)).toBe(wat);
    expect(totaal(v, 'naar', 'batterij')).toBe(401);
    expect(totaal(v, 'naar', 'huis')).toBe(300);
    expect(totaal(v, 'naar', 'net')).toBe(299);
  });

  it('binnen ±20 W gaat er niets naar of uit het net: geen stroom naar het net, wel precies in soorten', () => {
    const v = verdeelStroom({ zon_w: 1000, batterij_w: -535, net_w: -15 });
    expect(v.stromen.some((s) => s.naar === 'net' || s.van === 'net')).toBe(false);
    expect(v.soorten['zon>net']).toBe(15);
    expect(v.huis_w).toBe(450);
  });

  it('onder 20 W zon samen is er geen zon: geen zon-stromen, wel precies in soorten', () => {
    const v = verdeelStroom({ zonnen: [{ sleutel: 'a', vermogen_w: 8 }, { sleutel: 'b', vermogen_w: 4 }], batterij_w: 438, net_w: 0 });
    expect(v.huis_w).toBe(450);
    expect(v.stromen).toEqual([{ van: 'batterij', naar: 'huis', w: 438 }]);
    expect(v.soorten['zon>huis']).toBe(12);
  });

  it('een kleine stroom van één plek blijft staan als de stroom samen meetelt', () => {
    const v = verdeelStroom({ zonnen: [{ sleutel: 'a', vermogen_w: 990 }, { sleutel: 'b', vermogen_w: 10 }], batterij_w: -550, net_w: -40 });
    expect(w(v, 'b', 'net')).toBe(0);
    expect(w(v, 'b', 'batterij')).toBe(6);
    expect(totaal(v, 'naar', 'net')).toBe(40);
  });
});

describe('verdeelStroom', () => {
  it('middag: de zon laadt de batterij, vult het huis en levert de rest terug', () => {
    const v = verdeelStroom({ zon_w: 1450, batterij_w: -900, net_w: -300 });
    expect(w(v, 'zon', 'batterij')).toBe(900);
    expect(w(v, 'zon', 'net')).toBe(300);
    expect(w(v, 'zon', 'huis')).toBe(250);
    expect(v.huis_w).toBe(250);
  });

  it('zoals bij Tim: de zon voor het huis, de batterij verkoopt aan het net', () => {
    // 's Ochtends: dak 439 W en dierenverblijf 240 W, de batterij levert 1,7 kW (35%), 1,9 kW gaat naar buiten.
    const v = verdeelStroom({
      zonnen: [
        { sleutel: 'hw-zon-batterij', vermogen_w: 439 },
        { sleutel: 'hw-dierenverblijf', vermogen_w: 240 },
      ],
      batterij_w: 1700,
      net_w: -1929,
    });
    expect(v.huis_w).toBe(450);
    expect(w(v, 'hw-zon-batterij', 'huis') + w(v, 'hw-dierenverblijf', 'huis')).toBeCloseTo(450);
    expect(w(v, 'hw-zon-batterij', 'net') + w(v, 'hw-dierenverblijf', 'net')).toBeCloseTo(229);
    expect(w(v, 'batterij', 'net')).toBe(1700);
    expect(w(v, 'batterij', 'huis')).toBe(0);
    expect(v.stromen.some((s) => s.naar === 'batterij')).toBe(false);
  });

  it('zon, batterij en net samen voor een druk huis: eerst de zon, dan de batterij, dan het net', () => {
    const v = verdeelStroom({ zon_w: 500, batterij_w: 800, net_w: 200 });
    expect(w(v, 'zon', 'huis')).toBe(500);
    expect(w(v, 'batterij', 'huis')).toBe(800);
    expect(w(v, 'net', 'huis')).toBe(200);
    expect(v.huis_w).toBe(1500);
  });

  it('avond: batterij en net samen voor het huis', () => {
    const v = verdeelStroom({ zon_w: 0, batterij_w: 800, net_w: 1600 });
    expect(w(v, 'batterij', 'huis')).toBe(800);
    expect(w(v, 'net', 'huis')).toBe(1600);
    expect(v.huis_w).toBe(2400);
    expect(v.stromen.some((s) => s.van === 'zon')).toBe(false);
  });

  it("'s nachts laden uit het net (batterij met stekker die dat kan)", () => {
    const v = verdeelStroom({ zon_w: 0, batterij_w: -500, net_w: 700 });
    expect(w(v, 'net', 'batterij')).toBe(500);
    expect(w(v, 'net', 'huis')).toBe(200);
    expect(v.huis_w).toBe(200);
  });

  it('een meter die er niet is doet niet mee', () => {
    const v = verdeelStroom({ zon_w: null, batterij_w: null, net_w: 350 });
    expect(v.stromen).toEqual([{ van: 'net', naar: 'huis', w: 350 }]);
    expect(v.huis_w).toBe(350);
  });

  it('meters die even niet kloppen geven nooit een stroom onder nul', () => {
    // De batterij laadt meer dan zon en net samen leveren: een tel verschil tussen de meters.
    const v = verdeelStroom({ zon_w: 200, batterij_w: -900, net_w: 100 });
    expect(w(v, 'zon', 'batterij')).toBe(200);
    expect(w(v, 'net', 'batterij')).toBe(100);
    expect(v.huis_w).toBe(0);
    expect(v.stromen.every((s) => s.w >= 0)).toBe(true);
  });

  it('apparaten hangen aan het huis; de rest heet overig', () => {
    const v = verdeelStroom({
      zon_w: 0,
      batterij_w: 800,
      net_w: 1600,
      apparaten: [
        { sleutel: 'vaatwasser', vermogen_w: 1950 },
        { sleutel: 'koelkast', vermogen_w: 95 },
        { sleutel: 'wasmachine', vermogen_w: 0 },
      ],
    });
    expect(w(v, 'huis', 'vaatwasser')).toBe(1950);
    expect(w(v, 'huis', 'koelkast')).toBe(95);
    expect(v.stromen.some((s) => s.naar === 'wasmachine')).toBe(false);
    expect(v.overig_w).toBe(355);
  });

  it('meer apparaten dan huis (meters net niet tegelijk) geeft overig 0, niet min', () => {
    const v = verdeelStroom({ net_w: 100, apparaten: [{ sleutel: 'a', vermogen_w: 150 }] });
    expect(v.overig_w).toBe(0);
  });

  it('meetruis onder 5 W krijgt geen lijn', () => {
    const v = verdeelStroom({ zon_w: 0, batterij_w: 0, net_w: 4 });
    expect(v.stromen).toEqual([]);
  });

  it('twee plekken met panelen: elke zon-lijn naar rato van wat die plek levert', () => {
    const v = verdeelStroom({
      zonnen: [
        { sleutel: 'zon-huis', vermogen_w: 3000 },
        { sleutel: 'zon-dier', vermogen_w: 1000 },
        { sleutel: 'zon-stil', vermogen_w: null },
      ],
      batterij_w: -2000,
      net_w: -1500,
    });
    expect(w(v, 'zon-huis', 'batterij')).toBe(1500);
    expect(w(v, 'zon-dier', 'batterij')).toBe(500);
    expect(w(v, 'zon-huis', 'net')).toBe(1125);
    expect(w(v, 'zon-dier', 'net')).toBe(375);
    expect(w(v, 'zon-huis', 'huis')).toBe(375);
    expect(w(v, 'zon-dier', 'huis')).toBe(125);
    expect(v.huis_w).toBe(500);
    expect(v.stromen.some((s) => s.van === 'zon' || s.van === 'zon-stil')).toBe(false);
  });

  it('zonnen bepaalt de zon, ook als zon_w ontbreekt', () => {
    const v = verdeelStroom({ zon_w: null, zonnen: [{ sleutel: 'a', vermogen_w: 400 }], net_w: 0 });
    expect(v.huis_w).toBe(400);
    expect(w(v, 'a', 'huis')).toBe(400);
  });

  it("'s nachts (alle zonnen 0): geen zon-lijnen", () => {
    const v = verdeelStroom({ zonnen: [{ sleutel: 'a', vermogen_w: 0 }], batterij_w: -2300, net_w: 2850 });
    expect(v.stromen).toEqual([
      { van: 'net', naar: 'batterij', w: 2300 },
      { van: 'net', naar: 'huis', w: 550 },
    ]);
  });

  it('geen stand: niets', () => {
    expect(verdeelStroom(null)).toEqual({
      huis_w: 0,
      zon_w: 0,
      batterij_w: null,
      net_w: null,
      plekken: [],
      overig_w: 0,
      soorten: { 'zon>batterij': 0, 'zon>huis': 0, 'zon>net': 0, 'batterij>huis': 0, 'batterij>net': 0, 'net>batterij': 0, 'net>huis': 0 },
      stromen: [],
    });
  });
});

describe('lijnenVoorTekening', () => {
  it('zoals bij Tim: alles via het huis (de slimme meter), nooit rechtstreeks naar het net', () => {
    const lijnen = lijnenVoorTekening({
      zonnen: [
        { sleutel: 'hw-zon-batterij', vermogen_w: 439 },
        { sleutel: 'hw-dierenverblijf', vermogen_w: 240 },
      ],
      batterij_w: 1700,
      net_w: -1929,
    });
    expect(lijnen).toEqual([
      { van: 'hw-zon-batterij', naar: 'huis', w: 439 },
      { van: 'hw-dierenverblijf', naar: 'huis', w: 240 },
      { van: 'batterij', naar: 'huis', w: 1700 },
      { van: 'huis', naar: 'net', w: 1929 },
    ]);
  });

  it("'s nachts laden uit het net: net → huis → batterij, en de stekkers vanuit het huis", () => {
    const lijnen = lijnenVoorTekening({ zon_w: 0, batterij_w: -2300, net_w: 2850, apparaten: [{ sleutel: 'koelkast', vermogen_w: 90 }] });
    expect(lijnen).toEqual([
      { van: 'huis', naar: 'batterij', w: 2300 },
      { van: 'net', naar: 'huis', w: 2850 },
      { van: 'huis', naar: 'koelkast', w: 90 },
    ]);
  });

  it('zonder zonnen per plek één zon; meetruis en ontbrekende meters geven geen lijn', () => {
    expect(lijnenVoorTekening({ zon_w: 1200, batterij_w: null, net_w: 3 })).toEqual([{ van: 'zon', naar: 'huis', w: 1200 }]);
    expect(lijnenVoorTekening(null)).toEqual([]);
  });

  it('dezelfde grenzen als de zinnen: binnen ±20 W geen lijn naar het net, onder 20 W zon geen zon-lijn', () => {
    expect(lijnenVoorTekening({ zon_w: 1000, batterij_w: -535, net_w: -15 })).toEqual([
      { van: 'zon', naar: 'huis', w: 1000 },
      { van: 'huis', naar: 'batterij', w: 535 },
    ]);
    expect(lijnenVoorTekening({ zonnen: [{ sleutel: 'a', vermogen_w: 8 }, { sleutel: 'b', vermogen_w: 7 }], batterij_w: 438, net_w: 0 })).toEqual([
      { van: 'batterij', naar: 'huis', w: 438 },
    ]);
    expect(lijnenVoorTekening({ zon_w: 1000, batterij_w: -550, net_w: -20.4 })).toContainEqual({ van: 'huis', naar: 'net', w: 20 });
  });
});

describe('stromenBij', () => {
  it('splitst naar erin en eruit', () => {
    const { stromen } = verdeelStroom({ zon_w: 1450, batterij_w: -900, net_w: -300 });
    const bij = stromenBij('zon', stromen);
    expect(bij.erin).toEqual([]);
    expect(bij.eruit.map((s) => s.naar).sort()).toEqual(['batterij', 'huis', 'net']);
    expect(stromenBij('batterij', stromen).erin).toEqual([{ van: 'zon', naar: 'batterij', w: 900 }]);
  });
});
