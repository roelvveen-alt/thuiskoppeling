import { describe, expect, it } from 'vitest';
import { behandelMeting } from '../functions/ontvangMeting/ontvang.js';
import { sha256Hex } from '../shared/sleutel.js';
import { LEZEN_ONTHOUDEN_MS } from '../shared/toegang.js';
import { nepBase44, verzoek, volgendeMoment, zonderWachten } from './nep.js';

const SLEUTEL_TIM = '0123456789abcdef'.repeat(3);
const SLEUTEL_DIRK = 'fedcba9876543210'.repeat(3);
const nu = () => new Date('2026-10-30T12:00:00Z');

async function opzet() {
  return nepBase44({
    rijen: {
      Huis: [
        { id: 'huis-tim01', naam: 'Thuis', eigenaar_id: 'gebruiker-tim', brug_sleutel_hash: await sha256Hex(SLEUTEL_TIM) },
        { id: 'huis-dirk001', naam: 'Bij Dirk', eigenaar_id: 'gebruiker-dirk', brug_sleutel_hash: await sha256Hex(SLEUTEL_DIRK) },
      ],
      // De rij van voor de omgevingen, zonder huis: die raakt niemand meer.
      Meting: [{ id: 'meting-oud', net_w: 1 }],
    },
  });
}

async function stuur(nep, lichaam, sleutel, { geheugen = new Map(), methode } = {}) {
  const req = verzoek(lichaam, { methode, kop: sleutel === undefined ? {} : { 'x-brug-sleutel': sleutel } });
  const moment = volgendeMoment(geheugen, nu());
  const res = await behandelMeting(req, () => nep.client, { nu: () => moment, geheugen, geduld: zonderWachten });
  return { status: res.status, data: await res.json() };
}

describe('ontvangMeting', () => {
  it('zonder of met een onbekende sleutel: 401, en de meting wordt niet gelezen', async () => {
    const nep = await opzet();
    for (const sleutel of [undefined, '', 'kort', SLEUTEL_TIM.toUpperCase(), 'a'.repeat(48)]) {
      const uit = await stuur(nep, { net_w: 5 }, sleutel);
      expect(uit.status, String(sleutel)).toBe(401);
    }
    expect(nep.tabellen.Meting.lijst).toEqual([{ id: 'meting-oud', net_w: 1 }]);
    // Een sleutel die niet eens de goede vorm heeft, kost Base44 niets.
    expect(nep.stand.aanroepen).toEqual(['Huis.filter']);
  });

  it('met de sleutel van een huis: de stand van dát huis, steeds in dezelfde rij', async () => {
    const nep = await opzet();
    const geheugen = new Map();
    expect((await stuur(nep, { net_w: -312.6, bron: 'brug 0.2.0' }, SLEUTEL_TIM, { geheugen })).data).toEqual({ ok: true });
    expect((await stuur(nep, { net_w: 800 }, SLEUTEL_DIRK, { geheugen })).status).toBe(200);
    nep.stand.aanroepen.length = 0;
    expect((await stuur(nep, { net_w: 100 }, SLEUTEL_TIM, { geheugen })).status).toBe(200);
    // De tweede keer: het huis bij de sleutel en de rij staan in het geheugen. Eén aanroep.
    expect(nep.stand.aanroepen).toEqual(['Meting.update']);

    const rijen = nep.tabellen.Meting.lijst;
    expect(rijen).toHaveLength(3);
    expect(rijen.find((r) => r.huis_id === 'huis-tim01')).toMatchObject({ net_w: 100, moment: '2026-10-30T12:00:10.000Z' });
    expect(rijen.find((r) => r.huis_id === 'huis-dirk001')).toMatchObject({ net_w: 800 });
    expect(rijen[0]).toEqual({ id: 'meting-oud', net_w: 1 });
  });

  it('na "Nieuwe sleutel" werkt de oude nog hooguit LEZEN_ONTHOUDEN_MS (30 s), de nieuwe meteen', async () => {
    const nep = await opzet();
    const geheugen = new Map();
    const t0 = Date.parse('2026-10-30T12:00:00Z');
    const stuurOp = async (ms, sleutel) =>
      (await behandelMeting(verzoek({ net_w: 1 }, { kop: { 'x-brug-sleutel': sleutel } }), () => nep.client, { nu: () => new Date(ms), geheugen, geduld: zonderWachten })).status;
    expect(await stuurOp(t0, SLEUTEL_TIM)).toBe(200);
    // De eigenaar vraagt een nieuwe sleutel (functie huis, een andere isolate: dit geheugen weet het niet).
    const NIEUW = '00112233445566778899aabb'.repeat(2);
    nep.tabellen.Huis.lijst[0].brug_sleutel_hash = await sha256Hex(NIEUW);
    expect(await stuurOp(t0 + 5000, NIEUW)).toBe(200);
    expect(await stuurOp(t0 + LEZEN_ONTHOUDEN_MS - 1, SLEUTEL_TIM)).toBe(200);
    expect(await stuurOp(t0 + LEZEN_ONTHOUDEN_MS, SLEUTEL_TIM)).toBe(401);
    expect(LEZEN_ONTHOUDEN_MS).toBeLessThanOrEqual(60_000);
  });

  it('de batterijgegevens komen in de rij, nagekeken; stuurt hij ze niet meer, dan worden ze leeg', async () => {
    const nep = await opzet();
    const geheugen = new Map();
    await stuur(nep, { batterij_w: -2300, batterij_info: { temp_c: 25.5, wifi_dbm: -58, sn: 'FO4NXXXXXXXXXXX' } }, SLEUTEL_TIM, { geheugen });
    const rij = () => nep.tabellen.Meting.lijst.find((r) => r.huis_id === 'huis-tim01');
    expect(rij().batterij_info).toEqual({ temp_c: 25.5, wifi_dbm: -58 });
    // Een oudere versie, of de Zendure antwoordt even niet: niet de temperatuur van een tijd terug.
    await stuur(nep, { batterij_w: null }, SLEUTEL_TIM, { geheugen });
    expect(rij().batterij_info).toBeNull();
  });

  it('de omvormer komt in de rij, nagekeken; stuurt hij hem niet meer, dan wordt hij leeg', async () => {
    const nep = await opzet();
    const geheugen = new Map();
    await stuur(nep, { zon_w: 1835, omvormer: { stand: 'normaal', w: 1835, temp_c: 41.3, serienummer: '5010KDTA000X' } }, SLEUTEL_TIM, { geheugen });
    const rij = () => nep.tabellen.Meting.lijst.find((r) => r.huis_id === 'huis-tim01');
    expect(rij().omvormer).toEqual({ stand: 'normaal', w: 1835, temp_c: 41.3 });
    await stuur(nep, { zon_w: 0 }, SLEUTEL_TIM, { geheugen });
    expect(rij().omvormer).toBeNull();
  });

  it('een los blok dat niet klopt (brug): de stand komt wel binnen, en het antwoord zegt wat eruit ging', async () => {
    const nep = await opzet();
    const uit = await stuur(nep, { net_w: 42, brug: { versie: '<b>', gestart: '2026-10-30T11:00:00.000Z', elke_seconden: 3 } }, SLEUTEL_TIM);
    expect(uit).toEqual({ status: 200, data: { ok: true, overgeslagen: ['brug: brug.versie klopt niet'] } });
    const rij = nep.tabellen.Meting.lijst.find((r) => r.huis_id === 'huis-tim01');
    expect(rij).toMatchObject({ net_w: 42 });
    expect(rij).not.toHaveProperty('brug');
    expect(rij).not.toHaveProperty('overgeslagen');
  });

  it('na een herstart (leeg geheugen) vindt hij de rij van het huis terug', async () => {
    const nep = await opzet();
    await stuur(nep, { net_w: 1 }, SLEUTEL_TIM);
    await stuur(nep, { net_w: 2 }, SLEUTEL_TIM);
    expect(nep.tabellen.Meting.lijst.filter((r) => r.huis_id === 'huis-tim01')).toEqual([expect.objectContaining({ net_w: 2 })]);
  });

  it('is de rij weg, dan maakt hij een nieuwe', async () => {
    const nep = await opzet();
    const geheugen = new Map();
    await stuur(nep, { net_w: 1 }, SLEUTEL_TIM, { geheugen });
    nep.tabellen.Meting.lijst.splice(1);
    expect((await stuur(nep, { net_w: 3 }, SLEUTEL_TIM, { geheugen })).status).toBe(200);
    expect(nep.tabellen.Meting.lijst.at(-1)).toMatchObject({ huis_id: 'huis-tim01', net_w: 3 });
  });

  it('weigert wat geen meting is', async () => {
    const nep = await opzet();
    expect((await stuur(nep, 'geen json', SLEUTEL_TIM)).status).toBe(400);
    expect((await stuur(nep, { net_w: 'veel' }, SLEUTEL_TIM)).status).toBe(400);
    expect((await stuur(nep, { bron: 'x'.repeat(20_001) }, SLEUTEL_TIM)).status).toBe(413);
    expect((await stuur(nep, null, SLEUTEL_TIM, { methode: 'GET' })).status).toBe(405);
    expect(nep.tabellen.Meting.lijst).toHaveLength(1);
  });

  it('bij de rem: 429, zodat het programmaatje langer wacht', async () => {
    const nep = await opzet();
    nep.stand.rem = 3;
    const uit = await stuur(nep, { net_w: 1 }, SLEUTEL_TIM);
    expect(uit).toMatchObject({ status: 429, data: { code: 'rem' } });
  });
});
