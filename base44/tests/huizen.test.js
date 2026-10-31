import { describe, expect, it } from 'vitest';
import { ACTIE_NAMEN, behandelHuis } from '../shared/huizen.js';

import { sha256Hex, SLEUTEL_VORM } from '../shared/sleutel.js';
import { huisBijSleutel, LEZEN_ONTHOUDEN_MS } from '../shared/toegang.js';
import { tabellen } from '../shared/tabellen.js';
import { nepBase44, verzoek, zonderWachten } from './nep.js';

/** Zonder instelling staat het begrenzen van de omvormer uit (1.5.0). */
const STUREN_UIT = { aan: false, niet_op: [], vrij_op: null, netto: 'afnemer', op: null };

const TIM = { id: 'gebruiker-tim', email: 'Tim@Voorbeeld.nl', role: 'admin', full_name: 'Tim' };
const DIRK = { id: 'gebruiker-dirk', email: 'dirk@voorbeeld.nl', role: 'user' };
const BUURMAN = { id: 'gebruiker-buur', email: 'buurman@voorbeeld.nl', role: 'user' };
const VREEMDE = { id: 'gebruiker-vreemd', email: 'vreemd@voorbeeld.nl', role: 'user' };

const HUIS_TIM = {
  id: 'huis-tim01',
  naam: 'Thuis',
  eigenaar_id: TIM.id,
  eigenaar_email: 'tim@voorbeeld.nl',
  leden: [{ email: 'Dirk@Voorbeeld.nl' }],
  brug_sleutel_hash: 'a'.repeat(64),
};
const HUIS_BUUR = {
  id: 'huis-buur01',
  naam: 'Buren',
  eigenaar_id: BUURMAN.id,
  eigenaar_email: 'buurman@voorbeeld.nl',
  leden: [],
  brug_sleutel_hash: 'b'.repeat(64),
};
const METING_TIM = { id: 'meting-tim1', huis_id: HUIS_TIM.id, moment: '2026-10-30T12:00:00.000Z', net_w: -500, created_by: 'service' };
const METING_BUUR = { id: 'meting-buur1', huis_id: HUIS_BUUR.id, moment: '2026-10-30T12:00:00.000Z', net_w: 900 };

function opzet(gebruiker, { rijen, bestanden } = {}) {
  return nepBase44({
    gebruiker,
    rijen: rijen ?? { Huis: [HUIS_TIM, HUIS_BUUR], Meting: [METING_TIM, METING_BUUR], Opstelling: [] },
    bestanden,
  });
}

async function vraag(nep, lichaam, { kop = { Authorization: 'Bearer test' } } = {}) {
  // Een leeg geheugen per verzoek: welk huis van wie is, lekt niet tussen tests (toegang.js).
  const res = await behandelHuis(verzoek(lichaam, { kop }), () => nep.client, { geduld: zonderWachten, geheugen: new Map() });
  return { status: res.status, data: await res.json(), kop: res.headers };
}

const schrijfacties = (nep) => nep.stand.aanroepen.filter((a) => /\.(create|update)$/.test(a));

describe('functie huis: eerst wie er belt', () => {
  it('zonder ingelogde gebruiker: 401 bij elke actie, nog voordat er iets gelezen wordt', async () => {
    for (const lichaam of [...ACTIE_NAMEN.map((actie) => ({ actie, huis_id: HUIS_TIM.id })), { actie: 'bestaatNiet' }, 'geen json']) {
      const nep = opzet(null);
      const uit = await vraag(nep, lichaam);
      expect(uit.status).toBe(401);
      expect(uit.data.code).toBe('inloggen');
      expect(nep.stand.aanroepen).toEqual(['auth.me']);
    }
  });

  it('zonder Authorization-kop: meteen 401, zonder één aanroep naar Base44', async () => {
    const nep = opzet(TIM);
    const uit = await vraag(nep, { actie: 'mijn' }, { kop: {} });
    expect(uit.status).toBe(401);
    expect(uit.data.code).toBe('inloggen');
    expect(nep.stand.aanroepen).toEqual([]);
  });

  it('een uitgeschakeld account: 403, en verder niets', async () => {
    const nep = opzet({ ...DIRK, is_active: false });
    for (const actie of ['mijn', 'stand', 'maak']) {
      const uit = await vraag(nep, { actie, huis_id: HUIS_TIM.id, naam: 'Bij Dirk' });
      expect(uit.status).toBe(403);
      expect(uit.data.code).toBe('uitgeschakeld');
    }
    expect(nep.stand.aanroepen.every((a) => a === 'auth.me')).toBe(true);
  });

  it('een onbekende actie zegt dat de functie hem niet kent (de site zegt dan: nog niet bijgewerkt)', async () => {
    const uit = await vraag(opzet(TIM), { actie: 'namenBewaren' });
    expect(uit).toMatchObject({ status: 400, data: { code: 'onbekendeActie' } });
    const toString = await vraag(opzet(TIM), { actie: 'toString' });
    expect(toString.data.code).toBe('onbekendeActie');
  });
});

describe('functie huis: wie wat ziet', () => {
  it('mijn: een gewone gebruiker ziet precies één omgeving (de oudste), leden alleen als eigenaar, nooit de sleutel', async () => {
    const nep = opzet(DIRK, {
      rijen: {
        Huis: [HUIS_TIM, { ...HUIS_BUUR, id: 'huis-dirk001', naam: 'Bij Dirk', eigenaar_id: DIRK.id, eigenaar_email: DIRK.email, leden: [{ email: 'tim@voorbeeld.nl' }] }],
      },
    });
    const uit = await vraag(nep, { actie: 'mijn' });
    expect(uit.status).toBe(200);
    // Dirk staat (van vroeger) ook bij Tim als kijker, maar wisselen mag alleen de beheerder: hij ziet er één.
    expect(uit.data).toEqual({
      gebruiker: { email: 'dirk@voorbeeld.nl', naam: '', beheerder: false },
      magMaken: false,
      huizen: [{ id: 'huis-dirk001', naam: 'Bij Dirk', rol: 'eigenaar', eigenaar_email: 'dirk@voorbeeld.nl', leden: [{ email: 'tim@voorbeeld.nl' }], op_afstand: [], publiek_vast: null, omvormer_sturen: STUREN_UIT }],
    });
    expect(JSON.stringify(uit.data)).not.toMatch(/hash|aaaa/);
    // En die andere kan hij ook niet openen.
    expect((await vraag(nep, { actie: 'stand', huis_id: HUIS_TIM.id })).status).toBe(404);
  });

  it('mijn: de beheerder ziet alle omgevingen, als eigenaar, en mag er een maken', async () => {
    const uit = await vraag(opzet(TIM), { actie: 'mijn' });
    expect(uit.data).toEqual({
      gebruiker: { email: 'tim@voorbeeld.nl', naam: 'Tim', beheerder: true },
      magMaken: true,
      huizen: [
        { id: HUIS_BUUR.id, naam: 'Buren', rol: 'eigenaar', eigenaar_email: 'buurman@voorbeeld.nl', leden: [], op_afstand: [], publiek_vast: null, omvormer_sturen: STUREN_UIT },
        { id: HUIS_TIM.id, naam: 'Thuis', rol: 'eigenaar', eigenaar_email: 'tim@voorbeeld.nl', leden: [{ email: 'dirk@voorbeeld.nl' }], op_afstand: [], publiek_vast: null, omvormer_sturen: STUREN_UIT },
      ],
    });
  });

  it('de beheerder opent en beheert ook een omgeving die een ander maakte', async () => {
    const nep = opzet(TIM);
    expect((await vraag(nep, { actie: 'stand', huis_id: HUIS_BUUR.id })).data).toEqual({ meting: { moment: METING_BUUR.moment, net_w: 900 } });
    expect((await vraag(nep, { actie: 'hernoem', huis_id: HUIS_BUUR.id, naam: 'Bij de buren' })).data.huis).toMatchObject({ naam: 'Bij de buren' });
  });

  it('een vreemde zonder uitnodiging ziet niets en mag niets maken', async () => {
    const nep = opzet(VREEMDE);
    const mijn = await vraag(nep, { actie: 'mijn' });
    expect(mijn.data).toMatchObject({ magMaken: false, huizen: [] });

    const maak = await vraag(nep, { actie: 'maak', naam: 'Van mij' });
    expect(maak).toMatchObject({ status: 403, data: { code: 'alleenBeheerder' } });
    expect(maak.data.error).toMatch(/Alleen de beheerder/);

    for (const actie of ['stand', 'opstelling']) {
      expect((await vraag(nep, { actie, huis_id: HUIS_TIM.id })).status).toBe(404);
    }
    expect(schrijfacties(nep)).toEqual([]);
  });

  it('andermans omgeving: precies hetzelfde antwoord als een omgeving die niet bestaat', async () => {
    const nep = opzet(BUURMAN);
    const vanTim = await vraag(nep, { actie: 'stand', huis_id: HUIS_TIM.id });
    const bestaatNiet = await vraag(nep, { actie: 'stand', huis_id: 'huis-nergens' });
    const geenId = await vraag(nep, { actie: 'stand' });
    expect(vanTim).toMatchObject({ status: 404, data: { code: 'geenHuis' } });
    expect(bestaatNiet.data).toEqual(vanTim.data);
    expect(geenId.data).toEqual(vanTim.data);
    expect(bestaatNiet.status).toBe(404);
    // En de eigen stand gewoon wel, zonder velden die er niet in horen.
    const eigen = await vraag(nep, { actie: 'stand', huis_id: HUIS_BUUR.id });
    expect(eigen.data).toEqual({ meting: { moment: METING_BUUR.moment, net_w: 900 } });
  });

  it('een kijker krijgt de adressen van de apparaten niet, de eigenaar wel', async () => {
    const gekoppeld = [
      { sleutel: 'hw-net', naam: 'Meterkast', merk: 'HomeWizard', rol: 'net', manier: 'v2', ok: true, adres: '192.168.1.20' },
      { sleutel: 'zendure', naam: 'Batterij', merk: 'Zendure', rol: 'batterij', manier: 'cloud', ok: true },
    ];
    const rijen = { Huis: [HUIS_TIM, HUIS_BUUR], Meting: [{ ...METING_TIM, gekoppeld }], Opstelling: [] };
    const kijker = await vraag(opzet(DIRK, { rijen }), { actie: 'stand', huis_id: HUIS_TIM.id });
    expect(kijker.data.meting.gekoppeld).toEqual([{ sleutel: 'hw-net', naam: 'Meterkast', merk: 'HomeWizard', rol: 'net', manier: 'v2', ok: true }, gekoppeld[1]]);
    expect(JSON.stringify(kijker.data)).not.toContain('192.168');
    const eigenaar = await vraag(opzet(TIM, { rijen }), { actie: 'stand', huis_id: HUIS_TIM.id });
    expect(eigenaar.data.meting.gekoppeld).toEqual(gekoppeld);
  });

  it('zware delen alleen als de site een oudere heeft; een oude site krijgt alles', async () => {
    const dag = { datum: '2026-10-30', van: '2026-10-29T23:00:00Z', metingen: [1], huis_w: [300] };
    const voorspelling = { van: '2026-10-29T23:00:00Z', afname_kwh: [0.3], teruglevering_kwh: [0.1], zonnebonus_kwh: [0] };
    const rijen = { Huis: [HUIS_TIM, HUIS_BUUR], Meting: [{ ...METING_TIM, dag, voorspelling }], Opstelling: [] };
    const nep = opzet(TIM, { rijen });
    const eerst = await vraag(nep, { actie: 'stand', huis_id: HUIS_TIM.id });
    expect(eerst.data.meting).toMatchObject({ dag, voorspelling });
    expect(Object.keys(eerst.data.kenmerken)).toEqual(['dag', 'voorspelling']);
    expect(eerst.data.bekend).toBeUndefined();

    // Zelfde dag, oudere voorspelling: alleen de voorspelling komt mee.
    const daarna = await vraag(nep, { actie: 'stand', huis_id: HUIS_TIM.id, heb: { dag: eerst.data.kenmerken.dag, voorspelling: 'oud' } });
    expect(daarna.data.bekend).toEqual(['dag']);
    expect(daarna.data.meting).not.toHaveProperty('dag');
    expect(daarna.data.meting.voorspelling).toEqual(voorspelling);
    expect(daarna.data.kenmerken).toEqual(eerst.data.kenmerken);

    // Onzin in heb: gewoon alles.
    const onzin = await vraag(nep, { actie: 'stand', huis_id: HUIS_TIM.id, heb: 'x' });
    expect(onzin.data.meting).toMatchObject({ dag, voorspelling });
  });

  it('een kijker kijkt mee, maar verandert niets', async () => {
    const nep = opzet(DIRK);
    const stand = await vraag(nep, { actie: 'stand', huis_id: HUIS_TIM.id });
    expect(stand.data.meting).toEqual({ moment: METING_TIM.moment, net_w: -500 });
    expect((await vraag(nep, { actie: 'opstelling', huis_id: HUIS_TIM.id })).data).toMatchObject({ rol: 'kijker' });

    for (const lichaam of [
      { actie: 'bewaarOpstelling', opstelling: { tekening: 'schuur' } },
      { actie: 'uitnodigen', email: 'oma@voorbeeld.nl' },
      { actie: 'verwijderLid', email: 'dirk@voorbeeld.nl' },
      { actie: 'nieuweSleutel' },
      { actie: 'hernoem', naam: 'Van Dirk' },
    ]) {
      const uit = await vraag(nep, { ...lichaam, huis_id: HUIS_TIM.id });
      expect(uit, lichaam.actie).toMatchObject({ status: 403, data: { code: 'alleenEigenaar' } });
    }
    expect(schrijfacties(nep)).toEqual([]);
  });

  it('de stand geeft ook de batterijgegevens mee (brug 0.5.0), en een rij zonder blijft zonder', async () => {
    const batterij_info = { temp_c: 25.5, behuizing_c: 40, laadgrens_pct: 100, verwarmt: false };
    const nep = opzet(DIRK, { rijen: { Huis: [HUIS_TIM], Meting: [{ ...METING_TIM, batterij_w: -2300, batterij_info, iets_anders: 'geheim' }] } });
    const stand = await vraag(nep, { actie: 'stand', huis_id: HUIS_TIM.id });
    expect(stand.data.meting).toEqual({ moment: METING_TIM.moment, net_w: -500, batterij_w: -2300, batterij_info });
    expect((await vraag(opzet(DIRK), { actie: 'stand', huis_id: HUIS_TIM.id })).data.meting).not.toHaveProperty('batterij_info');
  });

  it('de stand geeft ook de omvormer mee (brug 0.6.0), ook aan een kijker; een rij zonder blijft zonder', async () => {
    const omvormer = { stand: 'normaal', bij: 'hw-zon-huis', w: 1835, rijen: [{ v: 320.8, a: 3.1 }], storingen: [9] };
    const nep = opzet(DIRK, { rijen: { Huis: [HUIS_TIM], Meting: [{ ...METING_TIM, omvormer }] } });
    expect((await vraag(nep, { actie: 'stand', huis_id: HUIS_TIM.id })).data.meting.omvormer).toEqual(omvormer);
    expect((await vraag(opzet(DIRK), { actie: 'stand', huis_id: HUIS_TIM.id })).data.meting).not.toHaveProperty('omvormer');
  });

  it('wie uit een omgeving gehaald wordt, ziet hem meteen niet meer', async () => {
    const nep = opzet(TIM);
    const uit = await vraag(nep, { actie: 'verwijderLid', huis_id: HUIS_TIM.id, email: ' DIRK@voorbeeld.nl ' });
    expect(uit.data).toEqual({ leden: [] });

    const dirk = nepBase44({ gebruiker: DIRK, rijen: { Huis: nep.tabellen.Huis.lijst, Meting: [METING_TIM] } });
    expect((await vraag(dirk, { actie: 'stand', huis_id: HUIS_TIM.id })).status).toBe(404);
    expect((await vraag(dirk, { actie: 'mijn' })).data).toMatchObject({ huizen: [], magMaken: false });
  });
});

describe('functie huis: een omgeving maken', () => {
  it('de beheerder mag: eigenaar zelf ingevuld, de sleutel één keer, alleen de hash bewaard', async () => {
    const nep = opzet(TIM, { rijen: { Huis: [] } });
    const uit = await vraag(nep, { actie: 'maak', naam: '  Thuis   aan zee ' });
    expect(uit.status).toBe(200);
    expect(uit.data.sleutel).toMatch(SLEUTEL_VORM);
    expect(uit.data.huis).toMatchObject({ naam: 'Thuis aan zee', rol: 'eigenaar', eigenaar_email: 'tim@voorbeeld.nl', leden: [] });

    const [rij] = nep.tabellen.Huis.lijst;
    expect(rij).toMatchObject({
      naam: 'Thuis aan zee',
      eigenaar_id: TIM.id,
      eigenaar_email: 'tim@voorbeeld.nl',
      leden: [],
      brug_sleutel_hash: await sha256Hex(uit.data.sleutel),
    });
    expect(JSON.stringify(rij)).not.toContain(uit.data.sleutel);
    // Met die sleutel vindt het programmaatje dit huis terug.
    const db = tabellen(nep.client.asServiceRole.entities);
    expect((await huisBijSleutel(db, uit.data.sleutel))?.id).toBe(rij.id);
  });

  it('wie meekijkt, maakt geen omgeving: dat doet alleen de beheerder (Tim maakt "Bij Dirk")', async () => {
    const nep = opzet(DIRK);
    const uit = await vraag(nep, { actie: 'maak', naam: 'Bij Dirk' });
    expect(uit).toMatchObject({ status: 403, data: { code: 'alleenBeheerder' } });
    expect(schrijfacties(nep)).toEqual([]);
  });

  it('zonder naam niet, en hooguit vijf eigen omgevingen', async () => {
    expect((await vraag(opzet(TIM), { actie: 'maak', naam: '   ' })).data.code).toBe('naam');
    expect((await vraag(opzet(TIM), { actie: 'maak', naam: 'x'.repeat(41) })).data.code).toBe('naam');
    const vijf = Array.from({ length: 5 }, (_, i) => ({ ...HUIS_TIM, id: `huis-tim0${i}`, brug_sleutel_hash: `${i}`.repeat(64) }));
    const uit = await vraag(opzet(TIM, { rijen: { Huis: vijf } }), { actie: 'maak', naam: 'Nog een' });
    expect(uit).toMatchObject({ status: 409, data: { code: 'teVeel' } });
  });
});

describe('functie huis: delen en de sleutel (alleen de eigenaar)', () => {
  it('uitnodigen: kleine letters, niet dubbel, niet jezelf, hooguit 20', async () => {
    const nep = opzet(TIM);
    const goed = await vraag(nep, { actie: 'uitnodigen', huis_id: HUIS_TIM.id, email: ' Oma@Voorbeeld.NL ' });
    expect(goed.data.leden).toEqual([{ email: 'dirk@voorbeeld.nl' }, { email: 'oma@voorbeeld.nl' }]);
    expect(nep.tabellen.Huis.lijst[0].leden).toEqual(goed.data.leden);

    expect((await vraag(nep, { actie: 'uitnodigen', huis_id: HUIS_TIM.id, email: 'OMA@voorbeeld.nl' })).data.code).toBe('dubbel');
    expect((await vraag(nep, { actie: 'uitnodigen', huis_id: HUIS_TIM.id, email: 'tim@VOORBEELD.nl' })).data.code).toBe('zelf');
    expect((await vraag(nep, { actie: 'uitnodigen', huis_id: HUIS_TIM.id, email: 'geen adres' })).data.code).toBe('email');

    const vol = Array.from({ length: 20 }, (_, i) => ({ email: `lid${i}@voorbeeld.nl` }));
    const nepVol = opzet(TIM, { rijen: { Huis: [{ ...HUIS_TIM, leden: vol }] } });
    expect((await vraag(nepVol, { actie: 'uitnodigen', huis_id: HUIS_TIM.id, email: 'nr21@voorbeeld.nl' })).data.code).toBe('vol');
  });

  it('uitnodigen: wie al bij een andere omgeving hoort, niet (iemand hoort bij één omgeving)', async () => {
    const nep = opzet(TIM);
    const buurman = await vraag(nep, { actie: 'uitnodigen', huis_id: HUIS_TIM.id, email: 'BUURMAN@voorbeeld.nl' });
    expect(buurman).toMatchObject({ status: 409, data: { code: 'alElders' } });
    expect(buurman.data.error).toMatch(/buurman@voorbeeld\.nl hoort al bij een andere omgeving/);
    const dirk = await vraag(nep, { actie: 'uitnodigen', huis_id: HUIS_BUUR.id, email: 'dirk@voorbeeld.nl' });
    expect(dirk).toMatchObject({ status: 409, data: { code: 'alElders' } });
    expect(schrijfacties(nep)).toEqual([]);
    // Iemand nieuws in andermans omgeving mag de beheerder wel uitnodigen.
    expect((await vraag(nep, { actie: 'uitnodigen', huis_id: HUIS_BUUR.id, email: 'oma@voorbeeld.nl' })).data.leden).toEqual([{ email: 'oma@voorbeeld.nl' }]);
  });

  it('leest vers vlak voor het schrijven: een lid dat intussen is toegevoegd, blijft staan', async () => {
    const nep = opzet(TIM);
    await vraag(nep, { actie: 'uitnodigen', huis_id: HUIS_TIM.id, email: 'oma@voorbeeld.nl' });
    // Ondertussen (ander toestel) nog iemand erbij.
    nep.tabellen.Huis.lijst[0].leden.push({ email: 'tante@voorbeeld.nl' });
    const uit = await vraag(nep, { actie: 'uitnodigen', huis_id: HUIS_TIM.id, email: 'neef@voorbeeld.nl' });
    expect(uit.data.leden.map((l) => l.email)).toEqual(['dirk@voorbeeld.nl', 'oma@voorbeeld.nl', 'tante@voorbeeld.nl', 'neef@voorbeeld.nl']);
  });

  it('nieuweSleutel: de oude werkt meteen niet meer, de nieuwe wel', async () => {
    const oud = 'c'.repeat(48);
    const nep = opzet(TIM, { rijen: { Huis: [{ ...HUIS_TIM, brug_sleutel_hash: await sha256Hex(oud) }] } });
    const db = tabellen(nep.client.asServiceRole.entities);
    expect((await huisBijSleutel(db, oud))?.id).toBe(HUIS_TIM.id);

    const uit = await vraag(nep, { actie: 'nieuweSleutel', huis_id: HUIS_TIM.id });
    expect(uit.data.sleutel).toMatch(SLEUTEL_VORM);
    expect(await huisBijSleutel(db, oud)).toBeNull();
    expect((await huisBijSleutel(db, uit.data.sleutel))?.id).toBe(HUIS_TIM.id);
  });

  it('hernoem: alleen de naam verandert', async () => {
    const nep = opzet(TIM);
    const uit = await vraag(nep, { actie: 'hernoem', huis_id: HUIS_TIM.id, naam: 'Zomerhuis' });
    expect(uit.data.huis).toMatchObject({ id: HUIS_TIM.id, naam: 'Zomerhuis', rol: 'eigenaar' });
    expect(nep.tabellen.Huis.lijst[0]).toMatchObject({ naam: 'Zomerhuis', eigenaar_id: TIM.id, brug_sleutel_hash: HUIS_TIM.brug_sleutel_hash });
  });
});

describe('functie huis: de indeling', () => {
  it('één rij per huis, en alleen de velden die meekomen', async () => {
    const nep = opzet(TIM);
    const punten = [{ sleutel: 'zon', x: 40.04, y: 38 }];
    expect((await vraag(nep, { actie: 'bewaarOpstelling', huis_id: HUIS_TIM.id, opstelling: { tekening: 'schuur', punten } })).data).toEqual({ ok: true });
    await vraag(nep, { actie: 'bewaarOpstelling', huis_id: HUIS_TIM.id, opstelling: { verborgen: ['net', 'net'], onzin: 1 } });
    expect(nep.tabellen.Opstelling.lijst).toEqual([
      expect.objectContaining({ huis_id: HUIS_TIM.id, tekening: 'schuur', punten: [{ sleutel: 'zon', x: 40, y: 38 }], verborgen: ['net'] }),
    ]);
    expect(nep.tabellen.Opstelling.lijst[0]).not.toHaveProperty('onzin');

    const dirk = nepBase44({ gebruiker: DIRK, rijen: { Huis: [HUIS_TIM], Opstelling: nep.tabellen.Opstelling.lijst } });
    expect((await vraag(dirk, { actie: 'opstelling', huis_id: HUIS_TIM.id })).data).toEqual({
      rol: 'kijker',
      opstelling: { tekening: 'schuur', punten: [{ sleutel: 'zon', x: 40, y: 38 }], verborgen: ['net'] },
      foto_url: null,
      foto_id: null,
    });
  });

  it('namen: per rondje één, schoon, en kijkers zien ze', async () => {
    const nep = opzet(TIM);
    const namen = [
      { sleutel: 'net', naam: '  Meter\tkast ' },
      { sleutel: 'hw-wasmachine', naam: 'Was' },
      { sleutel: 'hw-wasmachine', naam: 'Wasmachine boven' },
    ];
    expect((await vraag(nep, { actie: 'bewaarOpstelling', huis_id: HUIS_TIM.id, opstelling: { namen } })).status).toBe(200);
    expect(nep.tabellen.Opstelling.lijst[0].namen).toEqual([
      { sleutel: 'net', naam: 'Meter kast' },
      { sleutel: 'hw-wasmachine', naam: 'Wasmachine boven' },
    ]);

    const dirk = nepBase44({ gebruiker: DIRK, rijen: { Huis: [HUIS_TIM], Opstelling: nep.tabellen.Opstelling.lijst } });
    expect((await vraag(dirk, { actie: 'opstelling', huis_id: HUIS_TIM.id })).data.opstelling.namen).toEqual(nep.tabellen.Opstelling.lijst[0].namen);
    const zelf = await vraag(dirk, { actie: 'bewaarOpstelling', huis_id: HUIS_TIM.id, opstelling: { namen: [{ sleutel: 'net', naam: 'Van Dirk' }] } });
    expect(zelf).toMatchObject({ status: 403, data: { code: 'alleenEigenaar' } });

    for (const fout of [[{ sleutel: 'net', naam: '' }], [{ sleutel: 'net', naam: 'x'.repeat(41) }], [{ sleutel: 'net', naam: 'a\u0000b' }], [{ sleutel: 'met spatie', naam: 'x' }], 'net']) {
      expect((await vraag(nep, { actie: 'bewaarOpstelling', huis_id: HUIS_TIM.id, opstelling: { namen: fout } })).status, JSON.stringify(fout)).toBe(400);
    }
  });

  it('maximaal vermogen per rondje: afgerond, per rondje één, kijkers zien het, alleen de eigenaar bewaart', async () => {
    const nep = opzet(TIM);
    const vermogens = [
      { sleutel: 'hw-zon-batterij', max_w: 8000.4 },
      { sleutel: 'hw-zon-dierenverblijf', max_w: 2500 },
      { sleutel: 'hw-zon-dierenverblijf', max_w: 3000 },
      { sleutel: 'batterij', max_w: 2400 },
    ];
    expect((await vraag(nep, { actie: 'bewaarOpstelling', huis_id: HUIS_TIM.id, opstelling: { vermogens } })).status).toBe(200);
    expect(nep.tabellen.Opstelling.lijst[0].vermogens).toEqual([
      { sleutel: 'hw-zon-batterij', max_w: 8000 },
      { sleutel: 'hw-zon-dierenverblijf', max_w: 3000 },
      { sleutel: 'batterij', max_w: 2400 },
    ]);
    // Leeg mag: dan weer zonder maxima.
    expect((await vraag(nep, { actie: 'bewaarOpstelling', huis_id: HUIS_TIM.id, opstelling: { vermogens: [] } })).status).toBe(200);
    await vraag(nep, { actie: 'bewaarOpstelling', huis_id: HUIS_TIM.id, opstelling: { vermogens: [{ sleutel: 'batterij', max_w: 2400 }] } });

    const dirk = nepBase44({ gebruiker: DIRK, rijen: { Huis: [HUIS_TIM], Opstelling: nep.tabellen.Opstelling.lijst } });
    expect((await vraag(dirk, { actie: 'opstelling', huis_id: HUIS_TIM.id })).data.opstelling.vermogens).toEqual([{ sleutel: 'batterij', max_w: 2400 }]);
    const zelf = await vraag(dirk, { actie: 'bewaarOpstelling', huis_id: HUIS_TIM.id, opstelling: { vermogens: [{ sleutel: 'batterij', max_w: 5000 }] } });
    expect(zelf).toMatchObject({ status: 403, data: { code: 'alleenEigenaar' } });

    for (const fout of [
      [{ sleutel: 'batterij', max_w: 50 }],
      [{ sleutel: 'batterij', max_w: 100_001 }],
      [{ sleutel: 'batterij', max_w: '2400' }],
      [{ sleutel: 'batterij', max_w: Number.NaN }],
      [{ sleutel: 'met spatie', max_w: 2400 }],
      'batterij',
    ]) {
      const uit = await vraag(nep, { actie: 'bewaarOpstelling', huis_id: HUIS_TIM.id, opstelling: { vermogens: fout } });
      expect(uit.status, JSON.stringify(fout)).toBe(400);
    }
    expect(nep.tabellen.Opstelling.lijst[0].vermogens).toEqual([{ sleutel: 'batterij', max_w: 2400 }]);
  });

  it('grens en zekering per fase: afgerond, null wist, kijkers zien het, alleen de eigenaar bewaart', async () => {
    const nep = opzet(TIM);
    const bewaar = (opstelling, wie = nep) => vraag(wie, { actie: 'bewaarOpstelling', huis_id: HUIS_TIM.id, opstelling });
    expect((await bewaar({ fase_grens_a: 21.04, zekering_a: 25 })).status).toBe(200);
    expect(nep.tabellen.Opstelling.lijst[0]).toMatchObject({ fase_grens_a: 21, zekering_a: 25 });
    // Alleen de grens: de zekering blijft staan.
    await bewaar({ fase_grens_a: 22 });
    expect(nep.tabellen.Opstelling.lijst[0]).toMatchObject({ fase_grens_a: 22, zekering_a: 25 });
    for (const fout of [0, 201, '20', true, {}]) expect((await bewaar({ zekering_a: fout })).status, String(fout)).toBe(400);
    expect(nep.tabellen.Opstelling.lijst[0].zekering_a).toBe(25);
    await bewaar({ fase_grens_a: null });
    expect(nep.tabellen.Opstelling.lijst[0].fase_grens_a).toBeNull();

    const dirk = nepBase44({ gebruiker: DIRK, rijen: { Huis: [HUIS_TIM], Opstelling: nep.tabellen.Opstelling.lijst } });
    expect((await vraag(dirk, { actie: 'opstelling', huis_id: HUIS_TIM.id })).data.opstelling).toMatchObject({ fase_grens_a: null, zekering_a: 25 });
    expect(await bewaar({ zekering_a: 35 }, dirk)).toMatchObject({ status: 403, data: { code: 'alleenEigenaar' } });
  });

  it('de rol van de batterij (Advies): eigen of handelen, null wist, kijkers zien hem, alleen de eigenaar kiest', async () => {
    const nep = opzet(TIM);
    const bewaar = (opstelling, wie = nep) => vraag(wie, { actie: 'bewaarOpstelling', huis_id: HUIS_TIM.id, opstelling });
    expect((await bewaar({ batterij_rol: 'handelen' })).status).toBe(200);
    expect(nep.tabellen.Opstelling.lijst[0].batterij_rol).toBe('handelen');
    for (const fout of ['zelf', '', 'HANDELEN', 1, true, {}]) expect((await bewaar({ batterij_rol: fout })).status, String(fout)).toBe(400);
    expect(nep.tabellen.Opstelling.lijst[0].batterij_rol).toBe('handelen');
    // Een site van vóór de rol stuurt hem niet mee: dan blijft hij staan.
    await bewaar({ fase_grens_a: 22 });
    expect(nep.tabellen.Opstelling.lijst[0].batterij_rol).toBe('handelen');

    const dirk = nepBase44({ gebruiker: DIRK, rijen: { Huis: [HUIS_TIM], Opstelling: nep.tabellen.Opstelling.lijst } });
    expect((await vraag(dirk, { actie: 'opstelling', huis_id: HUIS_TIM.id })).data.opstelling).toMatchObject({ batterij_rol: 'handelen' });
    expect(await bewaar({ batterij_rol: 'eigen' }, dirk)).toMatchObject({ status: 403, data: { code: 'alleenEigenaar' } });
    await bewaar({ batterij_rol: null });
    expect(nep.tabellen.Opstelling.lijst[0].batterij_rol).toBeNull();
  });

  it('weigert rommel', async () => {
    const nep = opzet(TIM);
    for (const opstelling of [null, {}, { tekening: 'Schuur!' }, { punten: [{ sleutel: 'zon', x: 140, y: 3 }] }, { verborgen: ['met spatie'] }, { foto_uri: 'a b' }]) {
      const uit = await vraag(nep, { actie: 'bewaarOpstelling', huis_id: HUIS_TIM.id, opstelling });
      expect(uit.status, JSON.stringify(opstelling)).toBe(400);
    }
    expect(schrijfacties(nep)).toEqual([]);
  });

  it('een foto alleen als de eigenaar hem zelf kan openen; kijkers krijgen dan een link', async () => {
    const bestanden = { 'privé/huis-tim.jpg': TIM.id, 'privé/huis-buur.jpg': BUURMAN.id };
    const nep = opzet(TIM, { bestanden });
    const vreemd = await vraag(nep, { actie: 'bewaarOpstelling', huis_id: HUIS_TIM.id, opstelling: { foto_uri: 'privé/huis-buur.jpg' } });
    expect(vreemd).toMatchObject({ status: 400, data: { code: 'foto' } });

    const eigen = await vraag(nep, { actie: 'bewaarOpstelling', huis_id: HUIS_TIM.id, opstelling: { foto_uri: 'privé/huis-tim.jpg' } });
    expect(eigen.data).toEqual({ ok: true, foto_url: 'https://bestanden.test/privé/huis-tim.jpg?getekend', foto_id: expect.stringMatching(/^[0-9a-f]{16}$/) });

    const dirk = nepBase44({ gebruiker: DIRK, rijen: { Huis: [HUIS_TIM], Opstelling: nep.tabellen.Opstelling.lijst }, bestanden });
    const gezien = await vraag(dirk, { actie: 'opstelling', huis_id: HUIS_TIM.id });
    expect(gezien.data.foto_url).toBe('https://bestanden.test/privé/huis-tim.jpg?getekend');
    expect(JSON.stringify(gezien.data)).not.toContain('"foto_uri"');
    // Een vast kenmerk: bij elke vraag hetzelfde (de link verandert wel), zonder het adres van het bestand.
    expect(gezien.data.foto_id).toBe(eigen.data.foto_id);
    expect(gezien.data.foto_id).not.toContain('huis-tim');
  });
});

describe('functie huis: als Base44 zelf hapert', () => {
  it('een foto nakijken die mislukt door Base44 is een fout, geen "niet van jou"', async () => {
    const nep = opzet(TIM, { bestanden: { 'privé/huis-tim.jpg': TIM.id } });
    nep.client.integrations.Core.CreateFileSignedUrl = async () => {
      throw Object.assign(new Error('stuk'), { status: 502 });
    };
    const uit = await vraag(nep, { actie: 'bewaarOpstelling', huis_id: HUIS_TIM.id, opstelling: { foto_uri: 'privé/huis-tim.jpg' } });
    expect(uit).toMatchObject({ status: 500, data: { code: 'fout' } });
    expect(schrijfacties(nep)).toEqual([]);
  });
});

describe('functie huis: de rem van Base44', () => {
  it('twee keer opnieuw proberen, dan 429 met Retry-After', async () => {
    const nep = opzet(TIM);
    nep.stand.rem = 2;
    expect((await vraag(nep, { actie: 'mijn' })).status).toBe(200);

    const geremd = opzet(TIM);
    geremd.stand.rem = 3;
    const uit = await vraag(geremd, { actie: 'mijn' });
    expect(uit.status).toBe(429);
    expect(uit.data.code).toBe('rem');
    expect(uit.kop.get('Retry-After')).toBe('3');
  });

  it('ook halverwege een actie', async () => {
    const nep = opzet(TIM);
    const echteGet = nep.tabellen.Huis.get;
    nep.tabellen.Huis.get = async () => {
      throw Object.assign(new Error('Rate limit exceeded'), { status: 429 });
    };
    const uit = await vraag(nep, { actie: 'stand', huis_id: HUIS_TIM.id });
    expect(uit.status).toBe(429);
    nep.tabellen.Huis.get = echteGet;
  });
});

describe('functie huis: wat hij onthoudt voor de stand (de rem)', () => {
  const T0 = Date.parse('2026-10-30T12:00:00Z');
  const opKlok = (nep, geheugen, ms, lichaam, kop = { Authorization: 'Bearer dirk' }) =>
    behandelHuis(verzoek(lichaam, { kop }), () => nep.client, { geduld: zonderWachten, geheugen, klok: () => ms }).then(async (res) => ({
      status: res.status,
      data: await res.json(),
    }));

  it('een tweede stand binnen LEZEN_ONTHOUDEN_MS kost alleen de Meting; na 3 s weer vers', async () => {
    const nep = opzet({ ...DIRK });
    const geheugen = new Map();
    const stand = { actie: 'stand', huis_id: HUIS_TIM.id };
    expect((await opKlok(nep, geheugen, T0, stand)).status).toBe(200);
    nep.stand.aanroepen.length = 0;
    expect((await opKlok(nep, geheugen, T0 + 1000, stand)).status).toBe(200);
    expect(nep.stand.aanroepen).toEqual([]);
    expect((await opKlok(nep, geheugen, T0 + 5500, stand)).status).toBe(200);
    expect(nep.stand.aanroepen).toEqual(['Meting.filter']);
  });

  it('een kijker die eruit gehaald wordt, leest nog hooguit LEZEN_ONTHOUDEN_MS (30 s, onder een minuut)', async () => {
    expect(LEZEN_ONTHOUDEN_MS).toBe(30_000);
    const nep = opzet({ ...DIRK });
    const geheugen = new Map();
    const stand = { actie: 'stand', huis_id: HUIS_TIM.id };
    expect((await opKlok(nep, geheugen, T0, stand)).status).toBe(200);
    // Tim haalt Dirk eruit, in een andere isolate (dit geheugen weet het niet).
    nep.tabellen.Huis.lijst[0].leden = [];
    expect((await opKlok(nep, geheugen, T0 + LEZEN_ONTHOUDEN_MS - 1, stand)).status).toBe(200);
    expect((await opKlok(nep, geheugen, T0 + LEZEN_ONTHOUDEN_MS, stand)).status).toBe(404);
  });

  it('haalt de eigenaar iemand eruit in dezelfde isolate, dan leest de volgende stand meteen vers', async () => {
    const nep = opzet({ ...TIM });
    const geheugen = new Map();
    expect((await opKlok(nep, geheugen, T0, { actie: 'stand', huis_id: HUIS_TIM.id }, { Authorization: 'Bearer tim' })).status).toBe(200);
    expect((await opKlok(nep, geheugen, T0 + 1000, { actie: 'verwijderLid', huis_id: HUIS_TIM.id, email: DIRK.email }, { Authorization: 'Bearer tim' })).status).toBe(200);
    expect(geheugen.has(`huis:${HUIS_TIM.id}`)).toBe(false);
  });

  it('een account dat op inactief gaat: lezen (stand, mijn, opstelling) hooguit LEZEN_ONTHOUDEN_MS, schrijven en beheren meteen 403', async () => {
    const dirk = { ...DIRK };
    const nep = opzet(dirk);
    const geheugen = new Map();
    const stand = { actie: 'stand', huis_id: HUIS_TIM.id };
    expect((await opKlok(nep, geheugen, T0, stand)).status).toBe(200);
    dirk.is_active = false;
    // Schrijven en beheren: altijd vers auth.me, ook met een bekend token.
    for (const actie of ['bewaarOpstelling', 'overzicht', 'maak']) {
      expect((await opKlok(nep, geheugen, T0 + 1000, { actie, huis_id: HUIS_TIM.id, opstelling: { tekening: 'schuur' }, naam: 'x' })).data.code, actie).toBe('uitgeschakeld');
    }
    // mijn en opstelling lezen alleen (ronde 21, prestaties-18): wie er belt mag uit het geheugen, net als bij de stand.
    for (const actie of ['mijn', 'opstelling']) {
      expect((await opKlok(nep, geheugen, T0 + 2000, { actie, huis_id: HUIS_TIM.id })).status, actie).toBe(200);
    }
    expect((await opKlok(nep, geheugen, T0 + LEZEN_ONTHOUDEN_MS - 1, stand)).status).toBe(200);
    expect((await opKlok(nep, geheugen, T0 + LEZEN_ONTHOUDEN_MS, stand)).data.code).toBe('uitgeschakeld');
    for (const actie of ['mijn', 'opstelling']) {
      expect((await opKlok(nep, geheugen, T0 + LEZEN_ONTHOUDEN_MS + 1, { actie, huis_id: HUIS_TIM.id })).data.code, actie).toBe('uitgeschakeld');
    }
  });

  it('een ander token krijgt nooit de gebruiker van een bekend token, en zonder token blijft het 401', async () => {
    const nep = opzet({ ...DIRK });
    const geheugen = new Map();
    const stand = { actie: 'stand', huis_id: HUIS_TIM.id };
    expect((await opKlok(nep, geheugen, T0, stand)).status).toBe(200);
    nep.stand.aanroepen.length = 0;
    expect((await opKlok(nep, geheugen, T0 + 1000, stand, { Authorization: 'Bearer iemand-anders' })).status).toBe(200);
    expect(nep.stand.aanroepen).toEqual(['auth.me']);
    expect((await opKlok(nep, geheugen, T0 + 1000, stand, {})).status).toBe(401);
  });

  it('bij de rem geeft een stand het na één korte herhaling op', async () => {
    const nep = opzet({ ...DIRK });
    const geheugen = new Map();
    expect((await opKlok(nep, geheugen, T0, { actie: 'stand', huis_id: HUIS_TIM.id })).status).toBe(200);
    nep.stand.rem = 10;
    nep.stand.aanroepen.length = 0;
    expect((await opKlok(nep, geheugen, T0 + 5500, { actie: 'stand', huis_id: HUIS_TIM.id })).status).toBe(429);
    expect(nep.stand.aanroepen).toEqual(['Meting.filter', 'Meting.filter']);
  });
});

describe('functie huis: goedkoop nee zeggen (ronde 19, B2 en B4)', () => {
  const opKlokMet = async (nep, geheugen, kop, lichaam, klok = Date.parse('2026-10-30T12:00:00Z')) => {
    const res = await behandelHuis(verzoek(lichaam, { kop }), () => nep.client, { geduld: zonderWachten, geheugen, klok: () => klok });
    return res.status;
  };

  it('een token dat niets oplevert: één auth.me, daarna een minuut lang meteen 401; een ander token werkt meteen', async () => {
    const nep = opzet(null);
    const geheugen = new Map();
    for (let i = 0; i < 5; i += 1) expect(await opKlokMet(nep, geheugen, { Authorization: 'Bearer verlopen' }, { actie: 'mijn' })).toBe(401);
    expect(nep.stand.aanroepen).toEqual(['auth.me']);
    // Daarna logt hij opnieuw in: een nieuw token, dat wel werkt.
    const goed = opzet(TIM);
    goed.stand.aanroepen.length = 0;
    expect(await opKlokMet(goed, geheugen, { Authorization: 'Bearer nieuw' }, { actie: 'mijn' })).toBe(200);
  });

  it('te veel onbekende tokens: 429 zonder auth.me, maar een token dat al goed was komt er gewoon door', async () => {
    const geheugen = new Map();
    const goed = opzet(DIRK);
    expect(await opKlokMet(goed, geheugen, { Authorization: 'Bearer dirk' }, { actie: 'stand', huis_id: HUIS_TIM.id })).toBe(200);
    const nep = opzet(null);
    const statussen = [];
    for (let i = 0; i < 15; i += 1) statussen.push(await opKlokMet(nep, geheugen, { Authorization: `Bearer onzin-${i}` }, { actie: 'mijn' }));
    expect(statussen).toEqual([...Array(10).fill(401), ...Array(5).fill(429)]);
    expect(nep.stand.aanroepen.filter((a) => a === 'auth.me')).toHaveLength(10);
    // Dirk, 40 s later (zijn auth.me is niet meer onthouden): langs de emmer, want dat token was goed.
    expect(await opKlokMet(goed, geheugen, { Authorization: 'Bearer dirk' }, { actie: 'stand', huis_id: HUIS_TIM.id }, Date.parse('2026-10-30T12:00:40Z'))).toBe(200);
  });

  it('een gewone gebruiker met een id dat niet het zijne is: 404 zonder Huis.get', async () => {
    const nep = opzet(VREEMDE);
    const geheugen = new Map();
    for (const id of ['huis-tim01', 'huis-buur01', 'huis-bestaatniet']) {
      expect(await opKlokMet(nep, geheugen, { Authorization: 'Bearer vreemd' }, { actie: 'stand', huis_id: id })).toBe(404);
    }
    expect(nep.stand.aanroepen).toEqual(['auth.me', 'Huis.list']);
    // Dirk in zijn eigen omgeving: wel de rij (en de rechten worden getoetst).
    const vanDirk = opzet(DIRK);
    expect(await opKlokMet(vanDirk, new Map(), { Authorization: 'Bearer dirk' }, { actie: 'stand', huis_id: HUIS_TIM.id })).toBe(200);
    expect(await opKlokMet(vanDirk, new Map(), { Authorization: 'Bearer dirk' }, { actie: 'stand', huis_id: HUIS_BUUR.id })).toBe(404);
    expect(vanDirk.stand.aanroepen.filter((a) => a === 'Huis.get')).toEqual(['Huis.get']);
  });
});

