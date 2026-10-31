/**
 * Het logboek van storingen (base44/functions/ontvangMeting/logboek.js en de
 * actie logboek van de functie huis): alleen schrijven bij begin en einde,
 * ook na een herstart, met elke brugversie, en alleen voor wie in dat huis mag.
 */
import { describe, expect, it } from 'vitest';
import { GAT_MS, GEEN_EINDE_MS, HOOGSTENS_SCHRIJVEN, ONBEKEND_MS, openUit, storingenNu, wijzigingen } from '../functions/ontvangMeting/logboek.js';
import { behandelMeting } from '../functions/ontvangMeting/ontvang.js';
import { behandelHuis } from '../shared/huizen.js';
import { sha256Hex } from '../shared/sleutel.js';
import { nepBase44, verzoek, zonderWachten } from './nep.js';

const SLEUTEL = '0123456789abcdef'.repeat(3);
const SLEUTEL_BUUR = 'fedcba9876543210'.repeat(3);
const T0 = Date.parse('2026-10-30T12:00:00Z');
const TIM = { id: 'gebruiker-tim', email: 'tim@voorbeeld.nl', role: 'admin' };
const DIRK = { id: 'gebruiker-dirk', email: 'dirk@voorbeeld.nl', role: 'user' };
const BUURMAN = { id: 'gebruiker-buur', email: 'buurman@voorbeeld.nl', role: 'user' };

/** Zoals brug 0.6.1 hem stuurt: met batterij_info, gekoppeld en brug (zonder meldingen, zonder de velden van 0.7.0). */
const meting061 = ({ storing = false, p1 = true, metBlokken = true } = {}) => ({
  net_w: 412,
  zon_w: 0,
  batterij_w: 640,
  batterij_procent: 57,
  batterij_info: { temp_c: 24.5, storing },
  bron: 'brug 0.6.1',
  ...(metBlokken
    ? {
        gekoppeld: [
          { sleutel: 'hw-p1', naam: 'P1-meter', merk: 'HomeWizard', soort: 'P1-meter', rol: 'net', manier: 'v1', adres: '172.16.0.20', ok: p1 },
          { sleutel: 'zendure', naam: 'Zendure', merk: 'Zendure', soort: 'SolarFlow 2400 AC', rol: 'batterij', manier: 'lokaal', ok: true },
        ],
        brug: { versie: '0.6.1', gestart: '2026-10-30T06:00:00.000Z', elke_seconden: 5 },
      }
    : {}),
});

async function opzet(gebruiker = null) {
  return nepBase44({
    gebruiker,
    rijen: {
      Huis: [
        { id: 'huis-dirk001', naam: 'Bij Dirk', eigenaar_id: TIM.id, eigenaar_email: TIM.email, leden: [{ email: DIRK.email }], brug_sleutel_hash: await sha256Hex(SLEUTEL) },
        { id: 'huis-buur01', naam: 'Buren', eigenaar_id: BUURMAN.id, eigenaar_email: BUURMAN.email, leden: [], brug_sleutel_hash: await sha256Hex(SLEUTEL_BUUR) },
      ],
      Meting: [],
      Gebeurtenis: [],
    },
  });
}

/** Een meting op T0 + ms; het geheugen is dat van één isolate (geef een nieuw voor een herstart). */
async function stuur(nep, lichaam, ms, geheugen, sleutel = SLEUTEL) {
  const res = await behandelMeting(verzoek(lichaam, { kop: { 'x-brug-sleutel': sleutel } }), () => nep.client, {
    nu: () => new Date(T0 + ms),
    geheugen,
    dagGeheugen: new Map(),
    geduld: zonderWachten,
  });
  return { status: res.status, data: await res.json() };
}

const logboekAanroepen = (nep) => nep.stand.aanroepen.filter((a) => a.startsWith('Gebeurtenis.'));

describe('wat telt als storing', () => {
  it('per blok; wat de meting niet meestuurt, is onbekend (null)', () => {
    const s = storingenNu({
      batterij_info: { storing: true, storing_niveau: 3 },
      omvormer: { stand: 'normaal', storingen: [13, 17] },
      gekoppeld: [{ sleutel: 'hw-p1', naam: 'P1-meter', ok: false }, { sleutel: 'zendure', ok: true }],
      brug: {
        meldingen: [
          { soort: 'prijzen', tekst: 'Prijzen: geen antwoord van EnergyZero' },
          { soort: 'apparaat', tekst: 'P1-meter: geen antwoord' },
        ],
      },
    });
    expect([...s.batterij.values()]).toEqual([{ sleutel: 'batterij', soort: 'batterij', wat: 'De batterij meldt een storing (niveau 3)' }]);
    expect([...s.omvormer.keys()]).toEqual(['omvormer:13', 'omvormer:17']);
    expect([...s.meter.values()]).toEqual([{ sleutel: 'meter:hw-p1', soort: 'meter', wat: 'P1-meter antwoordt niet' }]);
    // 'apparaat' is dezelfde als de meter: niet dubbel.
    expect([...s.melding.keys()]).toEqual(['melding:prijzen:prijzen']);

    expect(storingenNu({ net_w: 5 })).toEqual({ batterij: null, omvormer: null, meter: null, melding: null });
    expect([...storingenNu({ omvormer: { stand: 'storing' } }).omvormer.keys()]).toEqual(['omvormer:stand']);
    // Een batterij zonder ja/nee over storingen: onbekend, niet "in orde".
    expect(storingenNu({ batterij_info: { temp_c: 20 } }).batterij).toBeNull();
  });

  it('de open storingen uit de rij Meting: rommel valt weg', () => {
    const goed = { id: 'gebeurtenis-1', sleutel: 'batterij', soort: 'batterij', wat: 'x', begin: '2026-10-30T12:00:00.000Z', gezien: '2026-10-30T12:00:00.000Z' };
    expect(openUit([goed, { ...goed, id: '' }, { ...goed, sleutel: 'batterij' }, { ...goed, id: 'b', sleutel: 'stil', soort: 'stil' }, null, 'x'])).toEqual([{ ...goed, weg: null }]);
    expect(openUit(undefined)).toEqual([]);
  });
});

describe('wanneer iets begint en eindigt', () => {
  const op = (ms) => new Date(T0 + ms);
  const iso = (ms) => op(ms).toISOString();
  const open = (extra = {}) => ({ id: 'g1', sleutel: 'meter:hw-p1', soort: 'meter', wat: 'P1-meter antwoordt niet', begin: iso(0), gezien: iso(0), weg: null, ...extra });
  const zonder = { gekoppeld: [{ sleutel: 'hw-p1', ok: true }] };

  it('een nieuwe storing begint; wat al open is, begint niet nog eens', () => {
    const uit = wijzigingen({ open: [], moment: iso(0) }, { gekoppeld: [{ sleutel: 'hw-p1', naam: 'P1-meter', ok: false }] }, op(5000));
    expect(uit.beginnen).toMatchObject([{ sleutel: 'meter:hw-p1', begin: iso(5000) }]);
    const verder = wijzigingen({ open: [open()], moment: iso(5000) }, { gekoppeld: [{ sleutel: 'hw-p1', ok: false }] }, op(10_000));
    expect(verder).toMatchObject({ beginnen: [], voorbij: [], gat: null });
    expect(verder.open[0].gezien).toBe(iso(10_000));
  });

  it('pas voorbij als hij twee minuten weg is; flikkert hij terug, dan loopt hij door', () => {
    const een = wijzigingen({ open: [open()], moment: iso(0) }, zonder, op(60_000));
    expect(een.voorbij).toEqual([]);
    expect(een.open[0].weg).toBe(iso(60_000));
    const terug = wijzigingen({ open: een.open, moment: iso(60_000) }, { gekoppeld: [{ sleutel: 'hw-p1', ok: false }] }, op(90_000));
    expect(terug.open[0].weg).toBeNull();
    const klaar = wijzigingen({ open: een.open, moment: iso(60_000) }, zonder, op(60_000 + GEEN_EINDE_MS));
    // Het einde is het moment dat hij weg was, niet twee minuten later.
    expect(klaar.voorbij).toEqual([{ id: 'g1', eind: iso(60_000) }]);
    expect(klaar.open).toEqual([]);
  });

  it('onbekend (het blok komt niet mee): blijft open, tot een half uur', () => {
    expect(wijzigingen({ open: [open()], moment: iso(0) }, { net_w: 1 }, op(ONBEKEND_MS - 1)).open).toHaveLength(1);
    expect(wijzigingen({ open: [open()], moment: iso(0) }, { net_w: 1 }, op(ONBEKEND_MS)).voorbij).toEqual([{ id: 'g1', eind: iso(0) }]);
  });

  it('een gat van meer dan tien minuten wordt achteraf "geen cijfers"', () => {
    expect(wijzigingen({ open: [], moment: iso(0) }, {}, op(GAT_MS)).gat).toBeNull();
    expect(wijzigingen({ open: [], moment: iso(0) }, {}, op(GAT_MS + 1)).gat).toEqual({ begin: iso(0), eind: iso(GAT_MS + 1) });
    expect(wijzigingen({ open: [], moment: null }, {}, op(0)).gat).toBeNull();
  });
});

describe('ontvangMeting schrijft het logboek alleen bij begin en einde', () => {
  it('brug 0.6.1: een meter die uitvalt is één create, de metingen ertussen niets, het einde één update', async () => {
    const nep = await opzet();
    const geheugen = new Map();
    expect(await stuur(nep, meting061(), 0, geheugen)).toEqual({ status: 200, data: { ok: true } });
    expect(logboekAanroepen(nep)).toEqual([]);

    expect((await stuur(nep, meting061({ p1: false }), 5000, geheugen)).status).toBe(200);
    expect(logboekAanroepen(nep)).toEqual(['Gebeurtenis.create']);
    expect(nep.tabellen.Gebeurtenis.lijst).toMatchObject([{ huis_id: 'huis-dirk001', sleutel: 'meter:hw-p1', soort: 'meter', wat: 'P1-meter antwoordt niet', begin: new Date(T0 + 5000).toISOString() }]);
    expect(nep.tabellen.Gebeurtenis.lijst[0]).not.toHaveProperty('eind');
    // Wat open is, staat mee in de rij Meting; de site krijgt dat niet (METING_INTERN).
    expect(nep.tabellen.Meting.lijst[0].storingen_open).toMatchObject([{ sleutel: 'meter:hw-p1', id: nep.tabellen.Gebeurtenis.lijst[0].id }]);

    // Een minuut lang: tussendoor zonder gekoppeld (dat komt eens per minuut), steeds niets aan het logboek.
    for (let t = 10_000; t <= 60_000; t += 5000) await stuur(nep, meting061({ p1: false, metBlokken: t % 60_000 === 0 }), t, geheugen);
    expect(logboekAanroepen(nep)).toEqual(['Gebeurtenis.create']);

    // Weer goed, en dat blijft het: na twee minuten één update met het einde.
    for (let t = 65_000; t <= 65_000 + GEEN_EINDE_MS; t += 5000) await stuur(nep, meting061(), t, geheugen);
    expect(logboekAanroepen(nep)).toEqual(['Gebeurtenis.create', 'Gebeurtenis.update']);
    expect(nep.tabellen.Gebeurtenis.lijst[0].eind).toBe(new Date(T0 + 65_000).toISOString());
    expect(nep.tabellen.Meting.lijst[0].storingen_open).toEqual([]);
  });

  it('na een herstart (leeg geheugen): weet uit de rij Meting wat open is, geen tweede create, en geen aanroep extra', async () => {
    const nep = await opzet();
    await stuur(nep, meting061({ storing: true }), 0, new Map());
    expect(logboekAanroepen(nep)).toEqual(['Gebeurtenis.create']);
    nep.stand.aanroepen.length = 0;
    await stuur(nep, meting061({ storing: true }), 5000, new Map());
    // Huis bij de sleutel, de rij Meting zoeken (die was toch nodig), bijwerken. Niets aan het logboek.
    expect(nep.stand.aanroepen).toEqual(['Huis.filter', 'Meting.filter', 'Meting.update']);
  });

  it('het programmaatje was stil: bij de eerste meting na het gat één gebeurtenis "geen cijfers"', async () => {
    const nep = await opzet();
    const geheugen = new Map();
    await stuur(nep, meting061(), 0, geheugen);
    await stuur(nep, meting061(), 5000, geheugen);
    expect(logboekAanroepen(nep)).toEqual([]);
    // 25 minuten later, en de functie is intussen herstart.
    await stuur(nep, meting061(), 5000 + 25 * 60_000, new Map());
    expect(nep.tabellen.Gebeurtenis.lijst).toMatchObject([
      { soort: 'stil', sleutel: 'stil', wat: 'Geen cijfers van het programmaatje', begin: new Date(T0 + 5000).toISOString(), eind: new Date(T0 + 5000 + 25 * 60_000).toISOString() },
    ]);
  });

  it('bij de rem: de meting komt binnen, het logboek rust een minuut en probeert het daarna nog eens', async () => {
    const nep = await opzet();
    const geheugen = new Map();
    await stuur(nep, meting061(), 0, geheugen);
    // De create wordt drie keer geweigerd (de functie probeert het met geduld nog twee keer).
    const create = nep.tabellen.Gebeurtenis.create;
    let weiger = 3;
    nep.tabellen.Gebeurtenis.create = async (velden) => {
      if (weiger > 0) {
        weiger -= 1;
        nep.stand.aanroepen.push('Gebeurtenis.create');
        throw Object.assign(new Error('Rate limit exceeded'), { status: 429 });
      }
      return create(velden);
    };
    expect((await stuur(nep, meting061({ storing: true }), 5000, geheugen)).status).toBe(200);
    expect(nep.tabellen.Gebeurtenis.lijst).toEqual([]);
    const na = logboekAanroepen(nep).length;
    await stuur(nep, meting061({ storing: true }), 30_000, geheugen);
    expect(logboekAanroepen(nep).length).toBe(na);
    await stuur(nep, meting061({ storing: true }), 70_000, geheugen);
    expect(nep.tabellen.Gebeurtenis.lijst).toMatchObject([{ sleutel: 'batterij' }]);
  });
});

describe('de actie logboek: zelfde rechten als stand', () => {
  async function metLogboek(gebruiker) {
    const nep = await opzet(gebruiker);
    const geheugen = new Map();
    await stuur(nep, meting061({ p1: false }), 0, geheugen);
    await stuur(nep, meting061({ storing: true }), 5000, geheugen, SLEUTEL_BUUR);
    return nep;
  }
  const vraag = async (nep, huis_id) => {
    const res = await behandelHuis(verzoek({ actie: 'logboek', huis_id }, { kop: { Authorization: 'Bearer test' } }), () => nep.client, {
      geduld: zonderWachten,
      geheugen: new Map(),
      klok: () => T0 + 10_000,
    });
    return { status: res.status, data: await res.json() };
  };

  it('een kijker ziet het logboek van zijn huis, met wat nu nog loopt', async () => {
    const uit = await vraag(await metLogboek(DIRK), 'huis-dirk001');
    expect(uit.status).toBe(200);
    expect(uit.data.gebeurtenissen).toEqual([
      { id: expect.any(String), sleutel: 'meter:hw-p1', soort: 'meter', wat: 'P1-meter antwoordt niet', begin: new Date(T0).toISOString(), eind: null, loopt: true },
    ]);
  });

  it('andermans logboek: dezelfde 404 als een huis dat niet bestaat; de beheerder ziet elk', async () => {
    const nep = await metLogboek(DIRK);
    expect(await vraag(nep, 'huis-buur01')).toMatchObject({ status: 404, data: { code: 'geenHuis' } });
    expect(await vraag(nep, 'huis-bestaatniet')).toMatchObject({ status: 404, data: { code: 'geenHuis' } });
    const buurman = await vraag(await metLogboek(BUURMAN), 'huis-dirk001');
    expect(buurman).toMatchObject({ status: 404, data: { code: 'geenHuis' } });
    const tim = await vraag(await metLogboek(TIM), 'huis-buur01');
    expect(tim.data.gebeurtenissen).toMatchObject([{ sleutel: 'batterij', loopt: true }]);
  });

  it('zonder gebruiker 401, met een account dat uit staat 403', async () => {
    expect((await vraag(await metLogboek(null), 'huis-dirk001')).status).toBe(401);
    expect((await vraag(await metLogboek({ ...DIRK, is_active: false }), 'huis-dirk001')).status).toBe(403);
  });
});

describe('hooguit HOOGSTENS_SCHRIJVEN per meting (ronde 19, B3)', () => {
  it('acht storingsbits tegelijk: drie per meting, de rest bij de volgende; sluiten net zo, met hetzelfde einde', async () => {
    const nep = await opzet();
    const geheugen = new Map();
    const bits = [1, 2, 3, 4, 5, 6, 7, 8];
    const metOmvormer = (storingen) => ({ ...meting061(), omvormer: { stand: storingen.length ? 'storing' : 'normaal', storingen } });
    const tel = () => logboekAanroepen(nep).length;
    expect(HOOGSTENS_SCHRIJVEN).toBe(3);
    await stuur(nep, metOmvormer(bits), 0, geheugen);
    expect(tel()).toBe(3);
    await stuur(nep, metOmvormer(bits), 5000, geheugen);
    await stuur(nep, metOmvormer(bits), 10_000, geheugen);
    expect(tel()).toBe(8);
    // Alles open, één keer per bit; de laatste begonnen tien seconden later.
    const rijen = nep.tabellen.Gebeurtenis.lijst;
    expect(rijen.map((r) => r.sleutel).sort()).toEqual(bits.map((b) => `omvormer:${b}`).sort());
    expect(new Set(rijen.map((r) => r.begin)).size).toBe(3);

    // Voorbij: na GEEN_EINDE_MS sluiten ze, drie per meting, allemaal met hetzelfde einde (de eerste meting zonder).
    await stuur(nep, metOmvormer([]), 20_000, geheugen);
    for (let ms = 20_000 + GEEN_EINDE_MS; ms <= 20_000 + GEEN_EINDE_MS + 15_000; ms += 5000) await stuur(nep, metOmvormer([]), ms, geheugen);
    expect(tel()).toBe(16);
    expect(rijen.every((r) => r.eind === new Date(T0 + 20_000).toISOString())).toBe(true);
    expect(nep.tabellen.Meting.lijst[0].storingen_open).toEqual([]);
  });
});

