/**
 * Op afstand instellen, aan de kant van de server: wie mag klaarzetten en
 * wissen (functie huis), wat de site ervan ziet, en dat ontvangMeting het
 * alleen aan het goede programmaatje teruggeeft, zonder aanroep extra.
 */
import { describe, expect, it } from 'vitest';
import { maakSleutelpaar } from '../../brug/opAfstand.mjs';
import { versleutel } from '../../src/lib/opAfstand.js';
import { kortAfdruk, vastVan } from '../shared/opAfstand.js';
import { behandelMeting } from '../functions/ontvangMeting/ontvang.js';
import { behandelHuis } from '../shared/huizen.js';
import { sha256Hex } from '../shared/sleutel.js';
import { LEZEN_ONTHOUDEN_MS } from '../shared/toegang.js';
import { nepBase44, verzoek, volgendeMoment, zonderWachten } from './nep.js';

const TIM = { id: 'gebruiker-tim', email: 'tim@voorbeeld.nl', role: 'admin' };
const DIRK = { id: 'gebruiker-dirk', email: 'dirk@voorbeeld.nl', role: 'user' };
const EIGENAAR = { id: 'gebruiker-eigen', email: 'eigen@voorbeeld.nl', role: 'user' };
const VREEMDE = { id: 'gebruiker-vreemd', email: 'vreemd@voorbeeld.nl', role: 'user' };
const SLEUTEL = '0123456789abcdef'.repeat(3);
const SLEUTEL_ANDER = 'fedcba9876543210'.repeat(3);
const PAAR = maakSleutelpaar();
const CLOUDSLEUTEL = btoa('https://app.zendure.tech/eu.Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op56');

async function opzet(gebruiker, { op_afstand } = {}) {
  return nepBase44({
    gebruiker,
    rijen: {
      Huis: [
        {
          id: 'huis-dirk001',
          naam: 'Bij Dirk',
          eigenaar_id: EIGENAAR.id,
          eigenaar_email: EIGENAAR.email,
          leden: [{ email: DIRK.email }],
          brug_sleutel_hash: await sha256Hex(SLEUTEL),
          ...(op_afstand ? { op_afstand } : {}),
        },
        { id: 'huis-ander1', naam: 'Ander', eigenaar_id: VREEMDE.id, eigenaar_email: VREEMDE.email, leden: [], brug_sleutel_hash: await sha256Hex(SLEUTEL_ANDER) },
      ],
      Meting: [],
    },
  });
}

async function vraag(nep, lichaam, { klok } = {}) {
  const res = await behandelHuis(verzoek(lichaam, { kop: { Authorization: 'Bearer test' } }), () => nep.client, { geduld: zonderWachten, geheugen: new Map(), klok });
  return { status: res.status, data: await res.json() };
}

async function stuur(nep, lichaam, sleutel = SLEUTEL, { geheugen = new Map(), nu = '2026-10-30T16:00:00Z' } = {}) {
  const req = verzoek(lichaam, { kop: { 'x-brug-sleutel': sleutel } });
  const moment = volgendeMoment(geheugen, nu);
  const res = await behandelMeting(req, () => nep.client, { nu: () => moment, geheugen, dagGeheugen: new Map(), geduld: zonderWachten });
  return { status: res.status, data: await res.json() };
}

const pakket = () => versleutel(PAAR.publiek, 'zendure.cloudsleutel', CLOUDSLEUTEL);
const brugBlok = (extra = {}) => ({ versie: '0.7.0', gestart: '2026-10-30T06:00:00Z', elke_seconden: 5, publiek: PAAR.publiek, ...extra });
const schrijven = (nep) => nep.stand.aanroepen.filter((a) => /\.(create|update)$/.test(a));

describe('klaarzetten en wissen (functie huis): alleen de eigenaar en de beheerder', () => {
  it('de eigenaar zet het klaar; terug komt alleen welk veld en wanneer, nooit het stuk', async () => {
    const nep = await opzet(EIGENAAR);
    const p = await pakket();
    const uit = await vraag(nep, { actie: 'zetOpAfstand', huis_id: 'huis-dirk001', veld: 'zendure.cloudsleutel', pakket: p }, { klok: () => Date.parse('2026-10-30T15:00:00Z') });
    expect(uit.status).toBe(200);
    expect(uit.data).toEqual({ op_afstand: [{ veld: 'zendure.cloudsleutel', op: '2026-10-30T15:00:00.000Z', voor: p.voor }], publiek_vast: p.voor });
    const rij = nep.tabellen.Huis.lijst[0];
    expect(rij.op_afstand).toEqual([{ veld: 'zendure.cloudsleutel', op: '2026-10-30T15:00:00.000Z', ...p }]);
    // De eerste keer: dit sleutelpaar staat vast (vertrouwen bij eerste gebruik).
    expect(rij).toMatchObject({ brug_publiek_vast: p.voor, brug_publiek_vast_op: '2026-10-30T15:00:00.000Z' });
    // De site ziet bij 'mijn' hetzelfde: geen sleutel, iv of data.
    const mijn = await vraag(nep, { actie: 'mijn' });
    expect(mijn.data.huizen[0].op_afstand).toEqual(uit.data.op_afstand);
    expect(mijn.data.huizen[0].publiek_vast).toBe(p.voor);
    expect(JSON.stringify(mijn.data)).not.toContain(p.data);
    // Opnieuw klaarzetten vervangt; wissen haalt weg.
    await vraag(nep, { actie: 'zetOpAfstand', huis_id: 'huis-dirk001', veld: 'zendure.cloudsleutel', pakket: await pakket() });
    expect(nep.tabellen.Huis.lijst[0].op_afstand).toHaveLength(1);
    expect((await vraag(nep, { actie: 'wisOpAfstand', huis_id: 'huis-dirk001', veld: 'zendure.cloudsleutel' })).data).toEqual({ op_afstand: [] });
    expect(nep.tabellen.Huis.lijst[0].op_afstand).toEqual([]);
  });

  it('de beheerder mag het ook (hij beheert elke omgeving)', async () => {
    const nep = await opzet(TIM);
    expect((await vraag(nep, { actie: 'zetOpAfstand', huis_id: 'huis-dirk001', veld: 'zendure.cloudsleutel', pakket: await pakket() })).status).toBe(200);
  });

  it('een kijker mag niet (403) en ziet er niets van; een vreemde krijgt 404; niemand ingelogd 401', async () => {
    const p = await pakket();
    for (const [gebruiker, status] of [
      [DIRK, 403],
      [VREEMDE, 404],
      [null, 401],
      [{ ...EIGENAAR, is_active: false }, 403],
    ]) {
      for (const lichaam of [
        { actie: 'zetOpAfstand', huis_id: 'huis-dirk001', veld: 'zendure.cloudsleutel', pakket: p },
        { actie: 'wisOpAfstand', huis_id: 'huis-dirk001', veld: 'zendure.cloudsleutel' },
      ]) {
        const nep = await opzet(gebruiker, { op_afstand: [{ veld: 'zendure.cloudsleutel', op: '2026-10-30T15:00:00.000Z', ...p }] });
        const uit = await vraag(nep, lichaam);
        expect(uit.status, `${gebruiker?.email} ${lichaam.actie}`).toBe(status);
        expect(schrijven(nep)).toEqual([]);
      }
    }
    const nep = await opzet(DIRK, { op_afstand: [{ veld: 'zendure.cloudsleutel', op: '2026-10-30T15:00:00.000Z', ...p }] });
    const mijn = await vraag(nep, { actie: 'mijn' });
    expect(mijn.data.huizen[0]).not.toHaveProperty('op_afstand');
    expect(mijn.data.huizen[0]).not.toHaveProperty('publiek_vast');
    expect(JSON.stringify(mijn.data)).not.toContain(p.voor);
  });

  it('alleen bekende velden en een stuk met de goede vorm', async () => {
    const nep = await opzet(EIGENAAR);
    const p = await pakket();
    for (const [veld, stuk] of [
      ['app.sleutel', p],
      ['zendure.cloudsleutel', { ...p, v: 2 }],
      ['zendure.cloudsleutel', { ...p, voor: 'kort' }],
      ['zendure.cloudsleutel', { ...p, sleutel: 'abc' }],
      ['zendure.cloudsleutel', { ...p, data: 'x'.repeat(5000) }],
      ['zendure.cloudsleutel', CLOUDSLEUTEL],
      ['zendure.cloudsleutel', null],
    ]) {
      const uit = await vraag(nep, { actie: 'zetOpAfstand', huis_id: 'huis-dirk001', veld, pakket: stuk });
      expect(uit.status, JSON.stringify(stuk).slice(0, 40)).toBe(400);
    }
    expect(schrijven(nep)).toEqual([]);
  });
});

describe('ontvangMeting geeft het terug aan het goede programmaatje', () => {
  async function klaar() {
    const p = await pakket();
    const nep = await opzet(null, { op_afstand: [{ veld: 'zendure.cloudsleutel', op: '2026-10-30T15:00:00.000Z', ...p }] });
    return { nep, p };
  }

  it('met de sleutel van dit huis en zijn publieke deel: het stuk; heeft hij het al, dan niet meer', async () => {
    const { nep, p } = await klaar();
    const geheugen = new Map();
    const uit = await stuur(nep, { net_w: 1, brug: brugBlok() }, SLEUTEL, { geheugen });
    expect(uit.data).toEqual({ ok: true, op_afstand: [{ veld: 'zendure.cloudsleutel', op: '2026-10-30T15:00:00.000Z', ...p }] });
    // Gemeld als opgepakt (ook als het mislukte): niet nog eens.
    const gemeld = await stuur(nep, { net_w: 1, brug: brugBlok({ op_afstand: [{ veld: 'zendure.cloudsleutel', op: '2026-10-30T15:00:00.000Z', ok: false, fout: 'geen-zendure' }] }) }, SLEUTEL, { geheugen });
    expect(gemeld.data).toEqual({ ok: true });
    // Een oudere melding (een eerder stuk): wel.
    const ouder = await stuur(nep, { net_w: 1, brug: brugBlok({ op_afstand: [{ veld: 'zendure.cloudsleutel', op: '2026-10-29T10:00:00.000Z', ok: true }] }) }, SLEUTEL, { geheugen });
    expect(ouder.data.op_afstand).toHaveLength(1);
    // De melding staat in de Meting, voor de site.
    expect(nep.tabellen.Meting.lijst[0].brug.op_afstand).toEqual([{ veld: 'zendure.cloudsleutel', op: '2026-10-29T10:00:00.000Z', ok: true }]);
  });

  it('niet zonder brugblok, niet zonder of met een ander publiek deel (oudere brug, nieuw sleutelpaar), niet aan een ander huis', async () => {
    const { nep } = await klaar();
    expect((await stuur(nep, { net_w: 1 })).data).toEqual({ ok: true });
    expect((await stuur(nep, { net_w: 1, brug: { versie: '0.6.2', gestart: '2026-10-30T06:00:00Z', elke_seconden: 5 } })).data).toEqual({ ok: true });
    expect((await stuur(nep, { net_w: 1, brug: brugBlok({ publiek: maakSleutelpaar().publiek }) })).data).toEqual({ ok: true });
    expect((await stuur(nep, { net_w: 1, brug: brugBlok() }, SLEUTEL_ANDER)).data).toEqual({ ok: true });
    expect((await stuur(nep, { net_w: 1, brug: brugBlok() }, 'a'.repeat(48))).status).toBe(401);
  });

  it('kost geen aanroep extra: met of zonder klaargezet stuk één update per meting', async () => {
    for (const metStuk of [false, true]) {
      const p = await pakket();
      const nep = await opzet(null, metStuk ? { op_afstand: [{ veld: 'zendure.cloudsleutel', op: '2026-10-30T15:00:00.000Z', ...p }] } : {});
      const geheugen = new Map();
      await stuur(nep, { net_w: 1, brug: brugBlok() }, SLEUTEL, { geheugen });
      nep.stand.aanroepen.length = 0;
      const uit = await stuur(nep, { net_w: 2, brug: brugBlok() }, SLEUTEL, { geheugen, nu: '2026-10-30T16:00:05Z' });
      expect(Boolean(uit.data.op_afstand)).toBe(metStuk);
      expect(nep.stand.aanroepen.filter((a) => !a.startsWith('Dag.'))).toEqual(['Meting.update']);
    }
  });

  it('na klaarzetten ziet ontvangMeting het hooguit LEZEN_ONTHOUDEN_MS later', async () => {
    const nep = await opzet(null);
    const geheugen = new Map();
    const begin = Date.parse('2026-10-30T16:00:00Z');
    await stuur(nep, { net_w: 1, brug: brugBlok() }, SLEUTEL, { geheugen, nu: new Date(begin).toISOString() });
    const p = await pakket();
    nep.tabellen.Huis.lijst[0].op_afstand = [{ veld: 'zendure.cloudsleutel', op: '2026-10-30T16:00:01.000Z', ...p }];
    expect((await stuur(nep, { net_w: 1, brug: brugBlok() }, SLEUTEL, { geheugen, nu: new Date(begin + 5000).toISOString() })).data.op_afstand).toBeUndefined();
    const later = await stuur(nep, { net_w: 1, brug: brugBlok() }, SLEUTEL, { geheugen, nu: new Date(begin + LEZEN_ONTHOUDEN_MS + 1000).toISOString() });
    expect(later.data.op_afstand).toHaveLength(1);
  });

  it('wat het programmaatje meldt, mild: rommel valt weg, de meting komt binnen', async () => {
    const nep = await opzet(null);
    const uit = await stuur(nep, { net_w: 1, brug: brugBlok({ publiek: 'kort', op_afstand: [{ veld: 'app.sleutel', op: '2026-10-30T15:00:00Z', ok: true }, 'x', { veld: 'zendure.cloudsleutel', op: 'gisteren' }] }) });
    expect(uit.status).toBe(200);
    expect(nep.tabellen.Meting.lijst[0].brug).toEqual({ versie: '0.7.0', gestart: '2026-10-30T06:00:00Z', elke_seconden: 5, op_afstand: [] });
  });

  it('zon op en onder (0.7.0) gaat mee; rommel valt weg, de rest van het brugblok niet', async () => {
    const zon = { op: '2026-10-30T06:21:00.000Z', onder: '2026-10-30T16:13:00.000Z' };
    const nep = await opzet(null);
    await stuur(nep, { net_w: 1, brug: brugBlok({ zon }) });
    expect(nep.tabellen.Meting.lijst[0].brug.zon).toEqual(zon);
    for (const rommel of [{ op: zon.onder, onder: zon.op }, { op: 'morgen', onder: zon.onder }, { op: '2026-10-28T06:00:00Z', onder: zon.onder }, 'dag', [zon]]) {
      const n = await opzet(null);
      expect((await stuur(n, { net_w: 1, brug: brugBlok({ zon: rommel }) })).status).toBe(200);
      expect(n.tabellen.Meting.lijst[0].brug).not.toHaveProperty('zon');
      expect(n.tabellen.Meting.lijst[0].brug.versie).toBe('0.7.0');
    }
  });
});

/**
 * Ronde 19, B1: het publieke deel komt via de server (in de meting). Een
 * tweede brug met dezelfde brugsleutel (of wie de rij Meting schrijft) meldt
 * een eigen paar; zonder vastzetten zou de browser daarvoor versleutelen.
 */
describe('vertrouwen bij eerste gebruik: het sleutelpaar staat vast', () => {
  const DIEF = maakSleutelpaar();
  const voorDief = () => versleutel(DIEF.publiek, 'zendure.cloudsleutel', CLOUDSLEUTEL);

  it('een stuk voor een ander paar: 409 anderPaar, er wordt niets geschreven; met de bevestiging van precies dat paar wel', async () => {
    const nep = await opzet(EIGENAAR);
    const echt = await pakket();
    expect((await vraag(nep, { actie: 'zetOpAfstand', huis_id: 'huis-dirk001', veld: 'zendure.cloudsleutel', pakket: echt })).status).toBe(200);
    const vals = await voorDief();
    nep.stand.aanroepen.length = 0;
    const uit = await vraag(nep, { actie: 'zetOpAfstand', huis_id: 'huis-dirk001', veld: 'zendure.cloudsleutel', pakket: vals });
    expect(uit.status).toBe(409);
    expect(uit.data.code).toBe('anderPaar');
    expect(uit.data.error).toContain(kortAfdruk(vals.voor));
    expect(uit.data.error).toContain(kortAfdruk(echt.voor));
    expect(schrijven(nep)).toEqual([]);
    // Een bevestiging voor een ander paar dan in het stuk telt niet (ook geen true).
    for (const nieuw_paar of [true, echt.voor, 'a'.repeat(32)]) {
      expect((await vraag(nep, { actie: 'zetOpAfstand', huis_id: 'huis-dirk001', veld: 'zendure.cloudsleutel', pakket: vals, nieuw_paar })).status).toBe(409);
    }
    expect(nep.tabellen.Huis.lijst[0].op_afstand[0].voor).toBe(echt.voor);
    // De eigenaar vergeleek de vingerafdruk met het toestel en bevestigt dit paar (het programmaatje is opnieuw geïnstalleerd).
    const goed = await vraag(nep, { actie: 'zetOpAfstand', huis_id: 'huis-dirk001', veld: 'zendure.cloudsleutel', pakket: vals, nieuw_paar: vals.voor }, { klok: () => Date.parse('2026-10-30T17:00:00Z') });
    expect(goed.status).toBe(200);
    expect(goed.data.publiek_vast).toBe(vals.voor);
    expect(nep.tabellen.Huis.lijst[0]).toMatchObject({ brug_publiek_vast: vals.voor, brug_publiek_vast_op: '2026-10-30T17:00:00.000Z' });
    // Wissen laat het vertrouwde paar staan.
    await vraag(nep, { actie: 'wisOpAfstand', huis_id: 'huis-dirk001', veld: 'zendure.cloudsleutel' });
    expect(nep.tabellen.Huis.lijst[0].brug_publiek_vast).toBe(vals.voor);
  });

  it('een rij van vóór ronde 19 (wel een stuk, geen vastgezet paar): het paar van dat stuk telt, en wordt bij de volgende keer vastgezet', async () => {
    const echt = await pakket();
    const nep = await opzet(EIGENAAR, { op_afstand: [{ veld: 'zendure.cloudsleutel', op: '2026-10-30T15:00:00.000Z', ...echt }] });
    expect(vastVan(nep.tabellen.Huis.lijst[0])).toBe(echt.voor);
    expect((await vraag(nep, { actie: 'mijn' })).data.huizen[0].publiek_vast).toBe(echt.voor);
    expect((await vraag(nep, { actie: 'zetOpAfstand', huis_id: 'huis-dirk001', veld: 'zendure.cloudsleutel', pakket: await voorDief() })).status).toBe(409);
    expect((await vraag(nep, { actie: 'zetOpAfstand', huis_id: 'huis-dirk001', veld: 'zendure.cloudsleutel', pakket: await pakket() })).status).toBe(200);
    expect(nep.tabellen.Huis.lijst[0].brug_publiek_vast).toBe(echt.voor);
  });

  it('de aanval nagespeeld: de dief meldt zijn paar met de brugsleutel; de site ziet een ander paar, de server zet niets voor hem klaar en geeft hem niets', async () => {
    const echt = await pakket();
    const nep = await opzet(EIGENAAR, { op_afstand: [{ veld: 'zendure.cloudsleutel', op: '2026-10-30T15:00:00.000Z', ...echt }] });
    nep.tabellen.Huis.lijst[0].brug_publiek_vast = echt.voor;
    const geheugen = new Map();
    // De dief stuurt met dezelfde brugsleutel een brugblok met zijn eigen publieke deel.
    const dief = await stuur(nep, { net_w: 1, brug: brugBlok({ publiek: DIEF.publiek }) }, SLEUTEL, { geheugen });
    expect(dief.data).toEqual({ ok: true });
    // Zelfs als er (buiten de functie om) een stuk voor zijn paar in Huis kwam: niet voor hem, want dat paar staat niet vast.
    const vals = await voorDief();
    nep.tabellen.Huis.lijst[0].op_afstand = [{ veld: 'zendure.cloudsleutel', op: '2026-10-30T16:30:00.000Z', ...vals }];
    const later = await stuur(nep, { net_w: 1, brug: brugBlok({ publiek: DIEF.publiek }) }, SLEUTEL, { geheugen: new Map(), nu: '2026-10-30T16:31:00Z' });
    expect(later.data.op_afstand).toBeUndefined();
  });

  it('een oude brug (0.6.2, zonder publiek deel) en een brug van 0.7.0 met het vertrouwde paar: zoals altijd', async () => {
    const echt = await pakket();
    const nep = await opzet(null, { op_afstand: [{ veld: 'zendure.cloudsleutel', op: '2026-10-30T15:00:00.000Z', ...echt }] });
    nep.tabellen.Huis.lijst[0].brug_publiek_vast = echt.voor;
    expect((await stuur(nep, { net_w: 1, brug: { versie: '0.6.2', gestart: '2026-10-30T06:00:00Z', elke_seconden: 5 } })).data).toEqual({ ok: true });
    expect((await stuur(nep, { net_w: 1, brug: brugBlok() })).data.op_afstand).toHaveLength(1);
  });

  it('de korte vingerafdruk: vier groepjes van vier, hetzelfde als het programmaatje laat zien', () => {
    expect(kortAfdruk('0123456789abcdef0123456789abcdef')).toBe('0123 4567 89ab cdef');
    expect(kortAfdruk('kort')).toBeNull();
  });
});

