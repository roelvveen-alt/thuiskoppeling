import { describe, expect, it } from 'vitest';
import { DELEN as BRUG_DELEN, SOORTEN as BRUG_SOORTEN, maakHerkenner } from '../../brug/herkennen.mjs';
import { standUitRij } from '../../src/lib/bron.js';
import { SOORTEN as SITE_SOORTEN, vraagZinnen, vragenVan } from '../../src/lib/herkennen.js';
import { controleerMeting } from '../functions/ontvangMeting/controle.js';
import { behandelMeting } from '../functions/ontvangMeting/ontvang.js';
import { VORMEN as BRUG_VORMEN } from '../../brug/herkennen.mjs';
import { DELEN, herkendUit, herkendVoorSite, labelsVoorBrug, labelUit, metLabel, SOORTEN, uitgesteldVan, VORMEN } from '../shared/herkennen.js';
import { behandelHuis } from '../shared/huizen.js';
import { sha256Hex } from '../shared/sleutel.js';
import { nepBase44, verzoek, volgendeMoment, zonderWachten } from './nep.js';

const NU = new Date('2026-10-30T12:00:00Z');
const SLEUTEL = '0123456789abcdef'.repeat(3);
const TIM = { id: 'gebruiker-tim', email: 'tim@voorbeeld.nl', role: 'admin' };
const DIRK = { id: 'gebruiker-dirk', email: 'dirk@voorbeeld.nl', role: 'user' };
const KIJKER = { id: 'gebruiker-kijk', email: 'kijk@voorbeeld.nl', role: 'user' };

/** Wat brug 0.11.0 meestuurt (zoals maakHerkenner().voorApp het geeft). */
const HERKEND = {
  nu: [{ id: 'tnpkjo-1', soort: 'koelkast', w: 110, zeker: 0.45, sinds: '2026-10-30T11:50:00.000Z' }],
  recent: [
    { id: 'tnpn3c-2', soort: 'waterkoker', w: 2200, zeker: 0.7, fase: 2, van: '2026-10-30T11:00:05.000Z', tot: '2026-10-30T11:03:00.000Z' },
    { id: 'tnpn3c-3', w: 1200, zeker: 0.2, onbekend: 'A', van: '2026-10-30T10:00:05.000Z', tot: '2026-10-30T10:20:00.000Z' },
  ],
  onbekend: [{ id: 'g-tnpn3c-3', letter: 'A', w: 1200, duur_s: 1200, n: 4, dagdeel: 'avond', fase: 1 }],
  basis: { w: 450, altijd_w: 400, warmtepomp: true },
  week: { van: '2026-10-26', apparaten: [{ sleutel: 'hw-spa', naam: 'Spa', keer: 12, kwh: 8.4 }, { soort: 'waterkoker', keer: 3, kwh: 0.3, dagdeel: 'ochtend' }] },
};

describe('één lijst soorten', () => {
  it('brug, server en site kennen dezelfde soorten en delen', () => {
    expect([...SOORTEN]).toEqual([...BRUG_SOORTEN]);
    expect([...SITE_SOORTEN]).toEqual([...BRUG_SOORTEN]);
    expect([...DELEN]).toEqual([...BRUG_DELEN]);
    expect([...VORMEN]).toEqual([...BRUG_VORMEN]);
  });
});

describe('Meting.herkend: mild nagekeken', () => {
  it('wat klopt gaat mee, met het moment van ontvangst', () => {
    const uit = herkendUit(HERKEND, NU);
    expect(uit.moment).toBe('2026-10-30T12:00:00.000Z');
    expect(uit.nu).toEqual(HERKEND.nu);
    expect(uit.recent).toEqual(HERKEND.recent);
    expect(uit.onbekend).toEqual(HERKEND.onbekend);
    expect(uit.basis).toEqual(HERKEND.basis);
    expect(uit.week).toEqual(HERKEND.week);
  });

  it('een regel die niet klopt valt weg, de rest blijft; een onbekende soort wordt "onbekend"', () => {
    const uit = herkendUit(
      {
        ...HERKEND,
        nu: [{ id: 'GROOT', w: 100, zeker: 0.5, sinds: '2026-10-30T11:50:00Z' }, { id: 'a-1', soort: 'raket', w: 100, zeker: 0.5, sinds: '2026-10-30T11:50:00Z', naam: 'x‮y' }, { id: 'a-2', w: 'veel', zeker: 0.5, sinds: '2026-10-30T11:50:00Z' }, null],
        recent: [{ id: 'a-3', w: 100, zeker: 2, van: '2026-10-30T11:50:00Z', tot: '2026-10-30T11:55:00Z' }, { id: 'a-4', w: 100, zeker: 0.4, van: 'gisteren', tot: '2026-10-30T11:55:00Z' }],
        week: { van: 'deze week', apparaten: [] },
        onbekend: [{ id: 'g-1', letter: 'AA', w: 1, duur_s: 1, n: 1 }],
      },
      NU,
    );
    expect(uit.nu).toEqual([{ id: 'a-1', naam: 'xy', w: 100, zeker: 0.5, sinds: '2026-10-30T11:50:00Z' }]);
    expect(uit.recent).toEqual([]);
    expect(uit.onbekend).toEqual([]);
    expect(uit.week).toBeUndefined();
    expect(uit.basis).toEqual(HERKEND.basis);
  });

  it('niets bruikbaars: null (dan gaat het veld niet mee en blijft het vorige staan)', () => {
    expect(herkendUit(null, NU)).toBeNull();
    expect(herkendUit([], NU)).toBeNull();
    expect(herkendUit({ nu: 'nee' }, NU)).toBeNull();
  });

  it('door controleerMeting: herkend en brug.herkent/labels_op gaan mee; een kapot blok houdt de meting niet tegen', () => {
    const brug = { versie: '0.11.0', gestart: '2026-10-30T06:00:00Z', elke_seconden: 5, herkent: true, labels_op: '2026-10-30T10:00:00.000Z' };
    const goed = controleerMeting({ net_w: 100, herkend: HERKEND, brug }, NU);
    expect(goed.ok).toBe(true);
    expect(goed.meting.herkend.nu).toHaveLength(1);
    expect(goed.meting.brug).toMatchObject({ herkent: true, labels_op: '2026-10-30T10:00:00.000Z' });
    const kapot = controleerMeting({ net_w: 100, herkend: 'rommel', brug: { ...brug, herkent: 'ja', labels_op: 12 } }, NU);
    expect(kapot.ok).toBe(true);
    expect('herkend' in kapot.meting).toBe(false);
    expect(kapot.overgeslagen).toEqual([]);
    expect(kapot.meting.brug.herkent).toBeUndefined();
    expect(kapot.meting.brug.labels_op).toBeUndefined();
  });

  it('wat een echte herkenner geeft, komt er ongeschonden door', () => {
    const h = maakHerkenner();
    const begin = Date.parse('2026-10-30T09:00:00Z');
    for (let s = 0; s < 1200; s += 5) h.ronde({ nu: begin + s * 1000, meting: { net_w: 450 + (s >= 300 && s < 480 ? 2200 : 0) } });
    const blok = h.voorApp(begin + 1200_000);
    const uit = herkendUit(blok, NU);
    expect(uit.recent).toEqual(blok.recent);
    expect(uit.basis).toEqual(blok.basis);
    expect(uit.week).toEqual(blok.week);
  });
});

describe('labels', () => {
  it('labelUit: soort uit de lijst; "anders" alleen met een naam; wat niet klopt: null', () => {
    expect(labelUit({ id: 'a-1', soort: 'vriezer', w: 120, duur_s: 1500, was: 'koelkast', fase: 2 })).toEqual({ id: 'a-1', soort: 'vriezer', w: 120, fase: 2, duur_s: 1500, was: 'koelkast' });
    expect(labelUit({ id: 'g-a-1', soort: 'anders', naam: 'Kachel', w: 1200, aantal: 4 })).toMatchObject({ naam: 'Kachel', aantal: 4 });
    expect(labelUit({ id: 'a-1', soort: 'anders', w: 120 })).toBeNull();
    expect(labelUit({ id: 'a-1', soort: 'raket', w: 120 })).toBeNull();
    expect(labelUit({ id: 'A 1', soort: 'oven', w: 120 })).toBeNull();
    expect(labelUit({ id: 'a-1', soort: 'oven' })).toBeNull();
    expect(labelUit(null)).toBeNull();
  });

  it('metLabel: hetzelfde id vervangt, hooguit 100, de oudste eruit', () => {
    let huis = { herkend_labels: [] };
    for (let i = 0; i < 105; i += 1) {
      huis = { herkend_labels: metLabel(huis, { id: `a-${i}`, soort: 'oven', w: 2000 }, new Date(Date.parse('2026-10-30T00:00:00Z') + i * 60_000).toISOString()) };
    }
    expect(huis.herkend_labels).toHaveLength(100);
    expect(huis.herkend_labels[0].id).toBe('a-5');
    huis = { herkend_labels: metLabel(huis, { id: 'a-50', soort: 'airfryer', w: 1500 }, '2026-10-31T00:00:00.000Z') };
    expect(huis.herkend_labels.filter((l) => l.id === 'a-50')).toEqual([{ id: 'a-50', soort: 'airfryer', w: 1500, op: '2026-10-31T00:00:00.000Z' }]);
  });

  it('labelsVoorBrug: alleen een brug die labels kent, en alleen als er een nieuwere is', () => {
    const huis = { herkend_labels: [{ id: 'a-1', soort: 'oven', w: 2000, op: '2026-10-30T10:00:00.000Z' }] };
    expect(labelsVoorBrug(huis, { herkent: true })).toHaveLength(1);
    expect(labelsVoorBrug(huis, { herkent: true, labels_op: '2026-10-30T09:00:00.000Z' })).toHaveLength(1);
    expect(labelsVoorBrug(huis, { herkent: true, labels_op: '2026-10-30T10:00:00.000Z' })).toEqual([]);
    expect(labelsVoorBrug(huis, { versie: '0.10.0' })).toEqual([]);
    expect(labelsVoorBrug(huis, null)).toEqual([]);
    expect(labelsVoorBrug({}, { herkent: true })).toEqual([]);
  });
});

async function huisOpzet() {
  return {
    Huis: [
      { id: 'huis-tim01', naam: 'Thuis', eigenaar_id: TIM.id, eigenaar_email: TIM.email, leden: [{ email: KIJKER.email }], brug_sleutel_hash: await sha256Hex(SLEUTEL) },
      { id: 'huis-dirk001', naam: 'Bij Dirk', eigenaar_id: DIRK.id, eigenaar_email: DIRK.email, leden: [], brug_sleutel_hash: 'b'.repeat(64) },
    ],
    Meting: [],
  };
}

async function vraagHuis(nep, lichaam, token = 'Bearer test') {
  const res = await behandelHuis(verzoek(lichaam, { kop: token ? { Authorization: token } : {} }), () => nep.client, { geduld: zonderWachten, geheugen: new Map(), klok: () => NU.getTime() });
  return { status: res.status, data: await res.json() };
}

describe('actie labelHerkend: alleen de eigenaar', () => {
  const label = { id: 'tnpn3c-3', soort: 'anders', naam: 'Kachel', w: 1200, duur_s: 1200, aantal: 4 };

  it('de eigenaar labelt: één schrijfactie op Huis, vers gelezen', async () => {
    const nep = nepBase44({ gebruiker: DIRK, rijen: await huisOpzet() });
    const uit = await vraagHuis(nep, { actie: 'labelHerkend', huis_id: 'huis-dirk001', label });
    expect(uit).toEqual({ status: 200, data: { ok: true, aantal: 1 } });
    expect(nep.tabellen.Huis.lijst.find((h) => h.id === 'huis-dirk001').herkend_labels).toEqual([{ ...label, op: NU.toISOString() }]);
    expect(nep.stand.aanroepen.filter((a) => a.endsWith('.update'))).toEqual(['Huis.update']);
  });

  it('zonder gebruiker 401, een kijker 403, andermans huis 404, een rare vraag 400; niets geschreven', async () => {
    const rijen = await huisOpzet();
    expect((await vraagHuis(nepBase44({ gebruiker: null, rijen }), { actie: 'labelHerkend', huis_id: 'huis-tim01', label }, null)).status).toBe(401);
    expect((await vraagHuis(nepBase44({ gebruiker: KIJKER, rijen }), { actie: 'labelHerkend', huis_id: 'huis-tim01', label })).status).toBe(403);
    expect((await vraagHuis(nepBase44({ gebruiker: DIRK, rijen }), { actie: 'labelHerkend', huis_id: 'huis-tim01', label })).status).toBe(404);
    const rare = nepBase44({ gebruiker: DIRK, rijen });
    expect((await vraagHuis(rare, { actie: 'labelHerkend', huis_id: 'huis-dirk001', label: { ...label, naam: '' } })).status).toBe(400);
    expect(rare.stand.aanroepen.filter((a) => a.endsWith('.update'))).toEqual([]);
  });

  it('de beheerder mag elk huis labelen', async () => {
    const nep = nepBase44({ gebruiker: TIM, rijen: await huisOpzet() });
    expect((await vraagHuis(nep, { actie: 'labelHerkend', huis_id: 'huis-dirk001', label })).status).toBe(200);
  });
});

describe('ontvangMeting en stand met herkend', () => {
  it('de labels gaan terug naar het programmaatje dat ze kent, zonder aanroep extra; een oudere brug krijgt niets', async () => {
    const rijen = await huisOpzet();
    rijen.Huis[0].herkend_labels = [{ id: 'a-1', soort: 'vriezer', w: 120, op: '2026-10-30T10:00:00.000Z' }];
    const nep = nepBase44({ rijen });
    const geheugen = new Map();
    const stuur = async (lichaam) => {
      const moment = volgendeMoment(geheugen, NU);
      const res = await behandelMeting(verzoek(lichaam, { kop: { 'x-brug-sleutel': SLEUTEL } }), () => nep.client, { nu: () => moment, geheugen, geduld: zonderWachten });
      return res.json();
    };
    const brug = { versie: '0.11.0', gestart: '2026-10-30T06:00:00Z', elke_seconden: 5, herkent: true };
    expect((await stuur({ net_w: 100, herkend: HERKEND, brug })).herkend_labels).toEqual([{ id: 'a-1', soort: 'vriezer', w: 120, op: '2026-10-30T10:00:00.000Z' }]);
    nep.stand.aanroepen.length = 0;
    expect(await stuur({ net_w: 100, brug: { ...brug, labels_op: '2026-10-30T10:00:00.000Z' } })).toEqual({ ok: true });
    expect(nep.stand.aanroepen).toEqual(['Meting.update']);
    expect(await stuur({ net_w: 100, brug: { versie: '0.10.0', gestart: '2026-10-30T06:00:00Z', elke_seconden: 5 } })).toEqual({ ok: true });
    // Zonder herkend in een latere meting blijft het blok staan (Base44 voegt samen), met zijn eigen moment.
    expect(nep.tabellen.Meting.lijst[0].herkend.moment).toBe(NU.toISOString());
  });

  it('stand geeft herkend als zwaar deel met kenmerk; de site maakt er een stand van', async () => {
    const rijen = await huisOpzet();
    rijen.Meting = [{ id: 'meting-1', huis_id: 'huis-tim01', moment: NU.toISOString(), net_w: 100, herkend: herkendUit(HERKEND, NU) }];
    const nep = nepBase44({ gebruiker: TIM, rijen });
    const eerst = await vraagHuis(nep, { actie: 'stand', huis_id: 'huis-tim01' });
    expect(eerst.data.kenmerken.herkend).toMatch(/^[0-9a-f]{16}$/);
    expect(eerst.data.meting.herkend.basis.w).toBe(450);
    const daarna = await vraagHuis(nep, { actie: 'stand', huis_id: 'huis-tim01', heb: { herkend: eerst.data.kenmerken.herkend } });
    expect(daarna.data.meting.herkend).toBeUndefined();
    expect(daarna.data.bekend).toEqual(['herkend']);
    const stand = standUitRij(eerst.data.meting);
    expect(stand.herkend.nu[0]).toMatchObject({ soort: 'koelkast', w: 110 });
  });
});

/** Een terugkerende groep zoals brug 1.4.0 hem stuurt: met de handtekening voor de vraag. */
const VRAAG = {
  id: 'g-tnq1aa-4',
  letter: 'B',
  w: 1800,
  duur_s: 2400,
  n: 3,
  vorm: 'piek',
  tijden: ['2026-10-30T06:10:00.000Z', '2026-10-30T11:30:00.000Z', '2026-10-30T17:05:00.000Z'],
  vandaag: 3,
  per_dag: 2.5,
  vermoeden: 'wasmachine',
};
const KENNIS = { apparaten: [{ soort: 'anders', naam: 'Kachel', zeker: 0.99, aangewezen: 4 }, { soort: 'koelkast', zeker: 0.7 }, { soort: 'warmtepomp', zeker: 0.6, basis: true }] };

describe('vragen (1.4.0): de handtekening, kennis, en "Weet ik niet" of "Later"', () => {
  it('herkendUit: vorm, tijden, vandaag en per dag bij een groep, en kennis; wat niet klopt valt weg', () => {
    const uit = herkendUit({ ...HERKEND, onbekend: [...HERKEND.onbekend, VRAAG], kennis: KENNIS }, NU);
    expect(uit.onbekend[1]).toEqual(VRAAG);
    expect(uit.kennis).toEqual(KENNIS);
    const raar = herkendUit(
      {
        ...HERKEND,
        onbekend: [{ ...VRAAG, vorm: 'zigzag', tijden: ['gisteren', '2026-10-30T06:10:00Z', 5], vandaag: -1, per_dag: 'vaak', later: true }],
        kennis: { apparaten: [{ soort: 'raket', zeker: 0.5 }, { soort: 'oven', zeker: 3 }, { soort: 'oven', zeker: 0.5, naam: 'Oven‮ boven', aangewezen: 0 }] },
      },
      NU,
    );
    // Het programmaatje zet nooit zelf "later": dat doet alleen de stand.
    expect(raar.onbekend).toEqual([{ id: VRAAG.id, letter: 'B', w: 1800, duur_s: 2400, n: 3, vermoeden: 'wasmachine', tijden: ['2026-10-30T06:10:00Z'] }]);
    expect(raar.kennis).toEqual({ apparaten: [{ soort: 'oven', naam: 'Oven boven', zeker: 0.5 }] });
    expect(herkendUit({ ...HERKEND, kennis: 'veel' }, NU).kennis).toBeUndefined();
  });

  it('wat brug 1.4.0 geeft (een groep met handtekening, en kennis), komt er ongeschonden door', () => {
    const h = maakHerkenner();
    const begin = Date.parse('2026-10-30T06:00:00Z');
    for (let s = 0; s < 6 * 3600; s += 5) {
      const f = (s - 600) % 3300;
      const koelkast = s >= 600 && f < 1200 ? (f < 5 ? 400 : 110) : 0;
      h.ronde({ nu: begin + s * 1000, meting: { net_w: 200 + koelkast } });
    }
    const blok = h.voorApp(begin + 6 * 3600_000);
    expect(blok.onbekend[0].tijden).toHaveLength(4);
    const uit = herkendUit(blok, NU);
    expect(uit.onbekend).toEqual(blok.onbekend);
    expect(uit.kennis).toEqual(blok.kennis);
  });

  it('labelUit: { id, later: true } is genoeg (alleen het id); labelsVoorBrug geeft het nooit aan het programmaatje', () => {
    expect(labelUit({ id: VRAAG.id, later: true, soort: 'raket', w: 'x' })).toEqual({ id: VRAAG.id, later: true });
    expect(labelUit({ id: 'A B', later: true })).toBeNull();
    const huis = {
      herkend_labels: [
        { id: 'a-1', soort: 'oven', w: 2000, op: '2026-10-30T10:00:00.000Z' },
        { id: VRAAG.id, later: true, op: '2026-10-30T11:00:00.000Z' },
      ],
    };
    expect(labelsVoorBrug(huis, { herkent: true })).toEqual([{ id: 'a-1', soort: 'oven', w: 2000, op: '2026-10-30T10:00:00.000Z' }]);
    // Een brug die het nieuwste echte label al heeft, krijgt niets (ook al is "later" nieuwer).
    expect(labelsVoorBrug(huis, { herkent: true, labels_op: '2026-10-30T10:00:00.000Z' })).toEqual([]);
    // Een week later vraagt de app weer.
    expect([...uitgesteldVan(huis, Date.parse('2026-11-06T10:59:00Z'))]).toEqual([VRAAG.id]);
    expect([...uitgesteldVan(huis, Date.parse('2026-11-06T11:01:00Z'))]).toEqual([]);
    // Toch nog benoemd: het label vervangt "later".
    const benoemd = { herkend_labels: metLabel(huis, { id: VRAAG.id, soort: 'droger', w: 1800 }, '2026-10-30T12:00:00.000Z') };
    expect([...uitgesteldVan(benoemd, NU.getTime())]).toEqual([]);
  });

  it('herkendVoorSite: de eigenaar ziet "later", een kijker geen tijden; het blok zelf blijft heel', () => {
    const herkend = herkendUit({ ...HERKEND, onbekend: [VRAAG], kennis: KENNIS }, NU);
    const kopie = JSON.parse(JSON.stringify(herkend));
    const eigenaar = herkendVoorSite(herkend, { rol: 'eigenaar', uitgesteld: new Set([VRAAG.id]) });
    expect(eigenaar.onbekend[0]).toEqual({ ...VRAAG, later: true });
    const kijker = herkendVoorSite(herkend, { rol: 'kijker', uitgesteld: new Set([VRAAG.id]) });
    expect(kijker.onbekend[0].tijden).toBeUndefined();
    expect(kijker.onbekend[0].later).toBeUndefined();
    expect(kijker.kennis).toEqual(KENNIS);
    expect(herkend).toEqual(kopie);
    expect(herkendVoorSite(null, { rol: 'eigenaar' })).toBeNull();
  });

  it('de hele weg: "Later" via labelHerkend, dan zegt de stand het bij die groep; een kijker krijgt geen vragen', async () => {
    const rijen = await huisOpzet();
    rijen.Meting = [{ id: 'meting-1', huis_id: 'huis-tim01', moment: NU.toISOString(), net_w: 100, herkend: herkendUit({ ...HERKEND, onbekend: [VRAAG], kennis: KENNIS }, NU) }];
    const nep = nepBase44({ gebruiker: TIM, rijen });
    const voor = await vraagHuis(nep, { actie: 'stand', huis_id: 'huis-tim01' });
    expect(voor.data.meting.herkend.onbekend[0].later).toBeUndefined();
    expect(await vraagHuis(nep, { actie: 'labelHerkend', huis_id: 'huis-tim01', label: { id: VRAAG.id, later: true } })).toEqual({ status: 200, data: { ok: true, aantal: 1 } });
    expect(nep.tabellen.Huis.lijst.find((h) => h.id === 'huis-tim01').herkend_labels).toEqual([{ id: VRAAG.id, later: true, op: NU.toISOString() }]);
    const na = await vraagHuis(nep, { actie: 'stand', huis_id: 'huis-tim01', heb: { herkend: voor.data.kenmerken.herkend } });
    // Anders dan eerst: de site krijgt het blok opnieuw, nu met "later".
    expect(na.data.meting.herkend.onbekend[0]).toEqual({ ...VRAAG, later: true });
    expect(standUitRij(na.data.meting).herkend.onbekend[0].later).toBe(true);
    const kijk = await vraagHuis(nepBase44({ gebruiker: KIJKER, rijen: nep.tabellen ? { Huis: nep.tabellen.Huis.lijst, Meting: nep.tabellen.Meting.lijst } : rijen }), { actie: 'stand', huis_id: 'huis-tim01' });
    expect(kijk.status).toBe(200);
    expect(kijk.data.meting.herkend.onbekend[0].tijden).toBeUndefined();
    expect(kijk.data.meting.herkend.onbekend[0].later).toBeUndefined();
    // Een kijker kan ook geen "later" zetten.
    expect((await vraagHuis(nepBase44({ gebruiker: KIJKER, rijen }), { actie: 'labelHerkend', huis_id: 'huis-tim01', label: { id: VRAAG.id, later: true } })).status).toBe(403);
  });
});

describe('de keten (1.4.0): programmaatje → ontvangMeting → stand → de vraag op het scherm', () => {
  it('drie keer dezelfde waterkoker: de eigenaar krijgt één vraag met de tijden; een oudere brug zonder kennis: geen vraag', async () => {
    const h = maakHerkenner();
    const begin = Date.parse('2026-10-30T05:00:00Z');
    const keren = [2 * 3600, 6 * 3600, 6.5 * 3600];
    for (let s = 0; s < 7 * 3600; s += 5) {
      const aan = keren.some((k) => s >= k && s < k + 180);
      h.ronde({ nu: begin + s * 1000, meting: { net_w: 450 + (aan ? 2200 : 0) } });
    }
    const blok = h.voorApp(begin + 7 * 3600_000);
    expect(blok.onbekend).toHaveLength(1);
    const rijen = await huisOpzet();
    const nep = nepBase44({ gebruiker: TIM, rijen });
    const geheugen = new Map();
    const stuur = async (lichaam) => {
      const moment = volgendeMoment(geheugen, NU);
      const res = await behandelMeting(verzoek(lichaam, { kop: { 'x-brug-sleutel': SLEUTEL } }), () => nep.client, { nu: () => moment, geheugen, geduld: zonderWachten });
      return res.json();
    };
    expect((await stuur({ net_w: 450, herkend: blok })).ok).toBe(true);
    const stand = standUitRij((await vraagHuis(nep, { actie: 'stand', huis_id: 'huis-tim01' })).data.meting);
    const vragen = vragenVan(stand.herkend);
    expect(vragen).toHaveLength(1);
    expect(vragen[0]).toMatchObject({ vermoeden: 'waterkoker', vorm: 'vlak', vandaag: 3 });
    expect(vragen[0].tijden).toEqual(keren.map((k) => begin + k * 1000));
    expect(vraagZinnen(vragen[0], NU)[1]).toBe('Vandaag 3 keer: om 07:00, 11:00 en 11:30.');
    // Zoals brug 1.3.0 het stuurde (zonder kennis en handtekening): de app vraagt niets bovenaan.
    const { kennis, ...oud } = blok;
    expect(kennis).toBeDefined();
    expect((await stuur({ net_w: 450, herkend: { ...oud, onbekend: oud.onbekend.map(({ id, letter, w, duur_s, n }) => ({ id, letter, w, duur_s, n })) } })).ok).toBe(true);
    const oudeStand = standUitRij((await vraagHuis(nep, { actie: 'stand', huis_id: 'huis-tim01' })).data.meting);
    expect(oudeStand.herkend.onbekend).toHaveLength(1);
    expect(vragenVan(oudeStand.herkend)).toEqual([]);
  });
});
