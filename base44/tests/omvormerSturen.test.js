import { describe, expect, it } from 'vitest';
import { controleerMeting } from '../functions/ontvangMeting/controle.js';
import { boekGebeurtenissen } from '../functions/ontvangMeting/logboek.js';
import { behandelMeting } from '../functions/ontvangMeting/ontvang.js';
import { metingVoorKijker } from '../shared/afschermen.js';
import { behandelHuis } from '../shared/huizen.js';
import { instellingVan, spanningUit, sturenGebeurtenissen, sturenUit, voorBrug, wijzig } from '../shared/omvormerSturen.js';
import { sha256Hex } from '../shared/sleutel.js';
import { nepBase44, verzoek, volgendeMoment, zonderWachten } from './nep.js';

const SLEUTEL = '0123456789abcdef'.repeat(3);
const TIM = { id: 'gebruiker-tim', email: 'tim@voorbeeld.nl', role: 'user' };
const DIRK = { id: 'gebruiker-dirk', email: 'dirk@voorbeeld.nl', role: 'user' };
const NU = Date.parse('2026-10-31T11:00:00Z');

const huisTim = async (extra = {}) => ({
  id: 'huis-tim01',
  naam: 'Thuis',
  eigenaar_id: TIM.id,
  eigenaar_email: TIM.email,
  leden: [{ email: DIRK.email }],
  brug_sleutel_hash: await sha256Hex(SLEUTEL),
  created_date: '2026-10-01T00:00:00Z',
  ...extra,
});

/** Wat het programmaatje 1.5.0 meldt terwijl het begrensd staat. */
const STUREN = {
  aan: true,
  stand: 'begrensd',
  pct: 20,
  sinds: '2026-10-31T10:00:00.000Z',
  door: 'programmaatje',
  aanpassingen: 0,
  doel_w: 1100,
  blokken: [{ van: '2026-10-31T10:00:00.000Z', tot: '2026-10-31T13:15:00.000Z', laagste: -0.034, modus: 'deels' }],
};

describe('de instelling (Huis.omvormer_sturen)', () => {
  it('zonder: uit; voor de brug niets (dat is voor elke brug uit)', () => {
    expect(instellingVan({})).toMatchObject({ aan: false });
    expect(voorBrug({})).toBeNull();
    expect(voorBrug({ omvormer_sturen: { aan: false, niet_op: ['2026-11-01'] } })).toBeNull();
  });
  it('aan, een dag niet, nu weer aan, netto; voorbije dagen vallen weg', () => {
    let h = { omvormer_sturen: wijzig({}, { aan: true }, NU) };
    h = { omvormer_sturen: wijzig(h, { dag: '2026-11-01', niet: true }, NU) };
    h = { omvormer_sturen: wijzig(h, { nu_aan: true }, NU + 1000) };
    expect(voorBrug(h)).toEqual({ aan: true, niet_op: ['2026-11-01'], vrij_op: '2026-10-31T11:00:01.000Z', op: '2026-10-31T11:00:01.000Z' });
    expect(wijzig(h, { netto: 'terugleveraar' }, NU + 3 * 86_400_000)).toMatchObject({ niet_op: [], netto: 'terugleveraar' });
    for (const fout of [{}, { aan: 'ja' }, { dag: '2026-10-01', niet: true }, { nu_aan: false }, { netto: 'x' }, null]) expect(() => wijzig(h, fout, NU)).toThrow();
  });
  it('1.6.1: een nieuw gekozen dag valt nooit stil weg; voorbije dagen gaan eerst, en past het echt niet, dan een duidelijke fout', () => {
    const dag = (n) => `2026-11-${String(n).padStart(2, '0')}`;
    const vol = { omvormer_sturen: { aan: true, niet_op: Array.from({ length: 14 }, (_, i) => dag(i + 1)) } };
    // Vol met 14 dagen in de toekomst: een 15e (later of eerder) geeft een fout in plaats van "bewaard".
    expect(() => wijzig(vol, { dag: dag(15), niet: true }, NU)).toThrow(/14 dagen/);
    expect(() => wijzig(vol, { dag: '2026-10-31', niet: true }, NU)).toThrow(/14 dagen/);
    // Weghalen kan altijd, en daarna past er weer een bij.
    const minder = { omvormer_sturen: wijzig(vol, { dag: dag(3), niet: false }, NU) };
    expect(wijzig(minder, { dag: dag(20), niet: true }, NU).niet_op).toContain(dag(20));
    // Twee voorbije dagen en twaalf komende: de voorbije gaan weg, de nieuwe blijft.
    const metOude = { omvormer_sturen: { aan: true, niet_op: ['2026-10-28', '2026-10-29', ...Array.from({ length: 12 }, (_, i) => dag(i + 1))] } };
    const na = wijzig(metOude, { dag: dag(20), niet: true }, NU).niet_op;
    expect(na).toContain(dag(20));
    expect(na).not.toContain('2026-10-28');
    expect(na).toHaveLength(13);
    // Wat er staat (instellingVan) houdt bij te veel de nieuwste dagen.
    const te = { omvormer_sturen: { aan: true, niet_op: Array.from({ length: 16 }, (_, i) => dag(i + 1)) } };
    expect(instellingVan(te).niet_op).toEqual(Array.from({ length: 14 }, (_, i) => dag(i + 3)));
  });
});

/** Een vraag aan de functie huis als `gebruiker`, op dezelfde tabellen (de nep kent één gebruiker per client). */
async function huisVraag(basis, gebruiker, lichaam) {
  const nep = nepBase44({ gebruiker, rijen: Object.fromEntries(Object.entries(basis.tabellen).map(([naam, t]) => [naam, t.lijst])) });
  const res = await behandelHuis(verzoek(lichaam, { kop: { Authorization: `Bearer ${gebruiker.id}` } }), () => nep.client, { geduld: zonderWachten, geheugen: new Map(), klok: () => NU });
  return { status: res.status, data: await res.json() };
}

describe('actie omvormerSturen (functie huis)', () => {
  it('alleen de eigenaar; vers gelezen en alleen dat ene veld geschreven', async () => {
    const nep = nepBase44({ gebruiker: TIM, rijen: { Huis: [await huisTim()] } });
    const res = await behandelHuis(verzoek({ actie: 'omvormerSturen', huis_id: 'huis-tim01', aan: true }, { kop: { Authorization: 'Bearer tim' } }), () => nep.client, { geduld: zonderWachten, geheugen: new Map(), klok: () => NU });
    const uit = { status: res.status, data: await res.json() };
    expect(uit.status).toBe(200);
    expect(uit.data.omvormer_sturen).toMatchObject({ aan: true, niet_op: [] });
    const schrijf = nep.stand.aanroepen.filter((a) => /update|create/.test(a));
    expect(schrijf).toEqual(['Huis.update']);
    expect(nep.stand.aanroepen.indexOf('Huis.get')).toBeLessThan(nep.stand.aanroepen.indexOf('Huis.update'));
    expect(nep.tabellen.Huis.lijst[0].omvormer_sturen).toMatchObject({ aan: true });
    const kijker = await huisVraag(nep, DIRK, { actie: 'omvormerSturen', huis_id: 'huis-tim01', aan: false });
    expect(kijker.status).toBe(403);
    // Een kijker ziet de instelling ook niet bij mijn.
    const mijn = await huisVraag(nep, DIRK, { actie: 'mijn' });
    expect(mijn.data.huizen[0]).not.toHaveProperty('omvormer_sturen');
  });
});

async function stuur(nep, lichaam, geheugen) {
  const moment = volgendeMoment(geheugen, new Date(NU));
  const res = await behandelMeting(verzoek(lichaam, { kop: { 'x-brug-sleutel': SLEUTEL } }), () => nep.client, { nu: () => moment, geheugen, geduld: zonderWachten });
  return { status: res.status, data: await res.json() };
}

describe('ontvangMeting en het programmaatje', () => {
  it('uit: niets in het antwoord; aan: kort de instelling, zonder aanroep extra', async () => {
    const nep = nepBase44({ rijen: { Huis: [await huisTim()] } });
    const geheugen = new Map();
    expect((await stuur(nep, { net_w: 1 }, geheugen)).data).toEqual({ ok: true });
    const aan = nepBase44({ rijen: { Huis: [await huisTim({ omvormer_sturen: { aan: true, niet_op: ['2026-11-01'] } })] } });
    const g2 = new Map();
    expect((await stuur(aan, { net_w: 1 }, g2)).data).toEqual({ ok: true, omvormer_sturen: { aan: true, niet_op: ['2026-11-01'] } });
    aan.stand.aanroepen.length = 0;
    expect((await stuur(aan, { net_w: 2 }, g2)).data.omvormer_sturen).toEqual({ aan: true, niet_op: ['2026-11-01'] });
    expect(aan.stand.aanroepen).toEqual(['Meting.update']);
  });

  it('een meting van een oudere brug (1.4.0, zonder sturen en spanning) komt gewoon binnen', async () => {
    const nep = nepBase44({ rijen: { Huis: [await huisTim()] } });
    const uit = await stuur(nep, { net_w: 1, omvormer: { stand: 'normaal', w: 3000 }, brug: { versie: '1.4.0', gestart: '2026-10-31T08:00:00Z', elke_seconden: 5 } }, new Map());
    expect(uit.status).toBe(200);
    const rij = nep.tabellen.Meting.lijst[0];
    expect(rij.omvormer).toEqual({ stand: 'normaal', w: 3000 });
    expect(rij).not.toHaveProperty('spanning');
  });

  it('sturen en spanning van 1.5.0 komen in de rij, nagekeken; het begrenzen komt in het Logboek', async () => {
    const nep = nepBase44({ rijen: { Huis: [await huisTim()] } });
    const uit = await stuur(nep, { net_w: 1, omvormer: { stand: 'normaal', w: 1200, sturen: STUREN }, spanning: { datum: '2026-10-31', herkomst: [{ sleutel: 'L1', bron: 'p1' }], nu: [{ sleutel: 'L1', v: 233 }], hoogste: [], lijst: [] } }, new Map());
    expect(uit.status).toBe(200);
    const rij = nep.tabellen.Meting.lijst[0];
    expect(rij.omvormer.sturen).toMatchObject({ stand: 'begrensd', pct: 20, door: 'programmaatje' });
    expect(rij.spanning.nu).toEqual([{ sleutel: 'L1', v: 233 }]);
    expect(nep.tabellen.Gebeurtenis.lijst).toEqual([expect.objectContaining({ sleutel: 'omvormer-sturen:begrensd', soort: 'omvormer', wat: 'Omvormer begrensd door het programmaatje (terugleveren kostte geld), op 20%' })]);
  });
});

describe('programmaatje 1.6.0: de schakelaar en de zelfcontrole', () => {
  it('voorBrug geeft `op` mee: nog eens aanzetten na "werkt niet" is zo te zien', () => {
    const h = { omvormer_sturen: wijzig({ omvormer_sturen: { aan: true, op: '2026-10-30T09:00:00.000Z' } }, { aan: true }, NU) };
    expect(voorBrug(h)).toEqual({ aan: true, op: '2026-10-31T11:00:00.000Z' });
  });

  it('controle, grens_w en oorspronkelijk komen nagekeken in de rij; rommel valt weg', () => {
    const s = sturenUit({
      ...STUREN,
      grens_w: 1600,
      controle: { uitkomst: 'werkt', op: '2026-10-31T10:03:00.000Z', pct: 20, voor_w: 5000, na_w: 1580.4, via: 'omvormer', extra: 'x' },
      oorspronkelijk: { grens_pct: 2, schakelaar: false, op: '2026-10-31T09:00:00.000Z' },
    });
    expect(s).toMatchObject({ grens_w: 1600, controle: { uitkomst: 'werkt', pct: 20, voor_w: 5000, na_w: 1580, via: 'omvormer' }, oorspronkelijk: { grens_pct: 2, schakelaar: false } });
    expect(s.controle).not.toHaveProperty('extra');
    const r = sturenUit({ ...STUREN, grens_w: -5, controle: { uitkomst: 'misschien' }, oorspronkelijk: { grens_pct: 'twee', schakelaar: 'uit' } });
    expect(r).not.toHaveProperty('grens_w');
    expect(r).not.toHaveProperty('controle');
    expect(r).not.toHaveProperty('oorspronkelijk');
    // Een meting van 1.5.0 (zonder dit alles) blijft precies zoals hij was.
    expect(Object.keys(sturenUit(STUREN)).sort()).toEqual(['aan', 'aanpassingen', 'blokken', 'doel_w', 'door', 'pct', 'sinds', 'stand']);
  });

  it('werkt niet op deze omvormer: een regel in het Logboek (zolang het zo is), met de getallen', async () => {
    const vrij = { aan: true, stand: 'vrij', blokken: [], controle: { uitkomst: 'werkt-niet', op: '2026-10-31T10:03:00.000Z', pct: 20, voor_w: 3100, na_w: 3050, reden: 'geen-effect' } };
    expect(sturenGebeurtenissen(vrij)).toEqual([
      { sleutel: 'omvormer-sturen:werkt-niet', wat: 'Begrenzen werkt niet op deze omvormer: begrenzen had geen effect (van 3,1 kW naar 3,1 kW bij 20%); het programmaatje gaf hem vrij en stuurt hem niet meer tot je het in de app opnieuw aanzet' },
    ]);
    expect(sturenGebeurtenissen({ ...vrij, controle: { uitkomst: 'werkt', op: '2026-10-31T10:03:00.000Z' } })).toEqual([]);
    const nep = nepBase44({ rijen: { Huis: [await huisTim()] } });
    await stuur(nep, { net_w: 1, omvormer: { stand: 'normaal', w: 3050, sturen: vrij } }, new Map());
    expect(nep.tabellen.Gebeurtenis.lijst).toEqual([expect.objectContaining({ sleutel: 'omvormer-sturen:werkt-niet', soort: 'omvormer' })]);
    // Kijkers zien sturen niet.
    expect(metingVoorKijker(nep.tabellen.Meting.lijst[0]).omvormer).not.toHaveProperty('sturen');
  });
});

describe('mild nakijken', () => {
  it('sturen: rommel valt weg, de meting blijft', () => {
    const uit = controleerMeting({ net_w: 1, omvormer: { stand: 'normaal', sturen: { ...STUREN, pct: 'veel', blokken: [{ van: 'gisteren' }, STUREN.blokken[0]], fout: 'onzin', extra: 'x' } } }, new Date(NU));
    expect(uit.ok).toBe(true);
    expect(uit.meting.omvormer.sturen).not.toHaveProperty('pct');
    expect(uit.meting.omvormer.sturen).not.toHaveProperty('fout');
    expect(uit.meting.omvormer.sturen).not.toHaveProperty('extra');
    expect(uit.meting.omvormer.sturen.blokken).toHaveLength(1);
    expect(sturenUit({ stand: 'raar' })).toBeNull();
  });
  it('spanning: alleen netspanningen en bekende sleutels; namen schoon', () => {
    const s = spanningUit({ datum: '2026-10-31', herkomst: [{ sleutel: 'L1', bron: 'meter', naam: 'Spa<script>' }, { sleutel: 'L9', bron: 'p1' }], nu: [{ sleutel: 'L1', v: 9999 }, { sleutel: 'zon', v: 251.44 }], lijst: [{ op: '2026-10-31T11:00:00Z', sleutel: 'zon', v: 254 }] });
    expect(s.herkomst).toEqual([{ sleutel: 'L1', bron: 'meter', naam: 'Spascript' }]);
    expect(s.nu).toEqual([{ sleutel: 'zon', v: 251.4 }]);
    expect(s.lijst).toHaveLength(1);
    expect(spanningUit({ datum: 'gisteren' })).toBeNull();
    // 1.6.0, twee driefase meters: de naam van de andere meter, schoon; zonder (1.5.0) niets.
    expect(spanningUit({ datum: '2026-10-31', verschil: [{ sleutel: 'L1', v: 4.2 }], verschil_met: 'Spa<b>' })).toMatchObject({ verschil: [{ sleutel: 'L1', v: 4.2 }], verschil_met: 'Spab' });
    expect(spanningUit({ datum: '2026-10-31' })).not.toHaveProperty('verschil_met');
  });
});

describe('kijkers', () => {
  it('zien sturen niet in de stand', () => {
    const k = metingVoorKijker({ omvormer: { stand: 'normaal', w: 5, sturen: STUREN } });
    expect(k.omvormer).toEqual({ stand: 'normaal', w: 5 });
  });

  it('zien de regels over het begrenzen niet in het Logboek; de eigenaar wel', async () => {
    const nep = nepBase44({
      gebruiker: TIM,
      rijen: {
        Huis: [await huisTim()],
        Gebeurtenis: [
          { id: 'g1', huis_id: 'huis-tim01', sleutel: 'omvormer-sturen:begrensd', soort: 'omvormer', wat: 'Omvormer begrensd', begin: '2026-10-31T10:00:00Z' },
          { id: 'g2', huis_id: 'huis-tim01', sleutel: 'meter:p1', soort: 'meter', wat: 'P1 antwoordt niet', begin: '2026-10-31T09:00:00Z' },
        ],
      },
    });
    expect((await huisVraag(nep, TIM, { actie: 'logboek', huis_id: 'huis-tim01' })).data.gebeurtenissen).toHaveLength(2);
    expect((await huisVraag(nep, DIRK, { actie: 'logboek', huis_id: 'huis-tim01' })).data.gebeurtenissen.map((g) => g.id)).toEqual(['g2']);
  });
});

describe('het Logboek: één regel per blok, de tekst groeit mee', () => {
  it('begin, bijgesteld (geen schrijfactie), einde met de samenvatting', async () => {
    const nep = nepBase44({ rijen: { Gebeurtenis: [] } });
    const db = nep.client.asServiceRole.entities;
    const meting = (sturen) => ({ omvormer: { stand: 'normaal', sturen } });
    let vorige = { open: [], moment: null };
    const stap = async (sturen, ms) => {
      const uit = await boekGebeurtenissen(db, 'huis-tim01', vorige, meting(sturen), new Date(NU + ms));
      vorige = { open: uit.open, moment: new Date(NU + ms).toISOString() };
    };
    await stap(STUREN, 0);
    await stap({ ...STUREN, pct: 40, aanpassingen: 1 }, 60_000);
    await stap({ ...STUREN, pct: 20, aanpassingen: 2 }, 120_000);
    await stap({ ...STUREN, stand: 'vrij', door: undefined }, 180_000);
    await stap({ ...STUREN, stand: 'vrij', door: undefined }, 400_000);
    const rijen = nep.tabellen.Gebeurtenis.lijst;
    expect(rijen).toHaveLength(1);
    expect(rijen[0]).toMatchObject({ eind: new Date(NU + 180_000).toISOString(), wat: 'Omvormer begrensd door het programmaatje (terugleveren kostte geld), op 20%, 2 keer bijgesteld aan het verbruik' });
    const schrijf = nep.stand.aanroepen.filter((a) => a.startsWith('Gebeurtenis.'));
    expect(schrijf).toEqual(['Gebeurtenis.create', 'Gebeurtenis.update']);
  });
});
