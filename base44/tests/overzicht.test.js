/**
 * Het overzicht van alle huizen (actie overzicht van de functie huis): alleen
 * voor de beheerder, in één keer voor alle huizen, met wat er open staat in
 * het logboek. Een gewone gebruiker of kijker krijgt niets, ook geen aantal.
 */
import { describe, expect, it } from 'vitest';
import { behandelMeting } from '../functions/ontvangMeting/ontvang.js';
import { behandelHuis } from '../shared/huizen.js';
import { sha256Hex } from '../shared/sleutel.js';
import { nepBase44, verzoek, zonderWachten } from './nep.js';

const SLEUTEL_DIRK = 'fedcba9876543210'.repeat(3);
const TIM = { id: 'gebruiker-tim', email: 'tim@voorbeeld.nl', role: 'admin' };
const DIRK = { id: 'gebruiker-dirk', email: 'dirk@voorbeeld.nl', role: 'user' };
const BUURMAN = { id: 'gebruiker-buur', email: 'buurman@voorbeeld.nl', role: 'user' };
const T0 = Date.parse('2026-10-30T18:02:00Z');

async function opzet(gebruiker) {
  const nep = nepBase44({
    gebruiker,
    rijen: {
      Huis: [
        { id: 'huis-tim01', naam: 'Thuis', eigenaar_id: TIM.id, eigenaar_email: TIM.email, leden: [], brug_sleutel_hash: 'a'.repeat(64) },
        { id: 'huis-dirk001', naam: 'Bij Dirk', eigenaar_id: TIM.id, eigenaar_email: TIM.email, leden: [{ email: DIRK.email }], brug_sleutel_hash: await sha256Hex(SLEUTEL_DIRK) },
        { id: 'huis-buur01', naam: 'Buren', eigenaar_id: BUURMAN.id, eigenaar_email: BUURMAN.email, leden: [], brug_sleutel_hash: 'b'.repeat(64) },
      ],
      Meting: [
        { id: 'meting-oud', net_w: 1 },
        { id: 'meting-tim1', huis_id: 'huis-tim01', moment: new Date(T0).toISOString(), zon_w: 1134, batterij_w: -627, batterij_procent: 57, net_w: -49, brug: { versie: '0.7.0' } },
      ],
      Gebeurtenis: [],
    },
  });
  // Dirk stuurt met brug 0.6.1, en zijn P1-meter antwoordt niet: dat staat open in het logboek.
  const meting = {
    net_w: 412,
    batterij_w: 640,
    batterij_procent: 40,
    bron: 'brug 0.6.1',
    gekoppeld: [{ sleutel: 'hw-p1', naam: 'P1-meter', merk: 'HomeWizard', soort: 'P1-meter', rol: 'net', manier: 'v1', ok: false }],
    brug: { versie: '0.6.1', gestart: '2026-10-30T06:00:00.000Z', elke_seconden: 5 },
  };
  const res = await behandelMeting(verzoek(meting, { kop: { 'x-brug-sleutel': SLEUTEL_DIRK } }), () => nep.client, {
    nu: () => new Date(T0 - 60_000),
    geheugen: new Map(),
    dagGeheugen: new Map(),
    geduld: zonderWachten,
  });
  expect(res.status).toBe(200);
  nep.stand.aanroepen.length = 0;
  return nep;
}

async function vraag(nep) {
  const res = await behandelHuis(verzoek({ actie: 'overzicht' }, { kop: { Authorization: 'Bearer test' } }), () => nep.client, {
    geduld: zonderWachten,
    geheugen: new Map(),
    klok: () => T0,
  });
  return { status: res.status, data: await res.json() };
}

describe('het overzicht van alle huizen', () => {
  it('de beheerder: elk huis met de kern van nu, de brugversie en wat er open staat; in drie aanroepen samen', async () => {
    const nep = await opzet(TIM);
    const uit = await vraag(nep);
    expect(uit.status).toBe(200);
    expect(uit.data.huizen).toEqual([
      {
        id: 'huis-dirk001',
        naam: 'Bij Dirk',
        eigenaar_email: TIM.email,
        meting: {
          moment: new Date(T0 - 60_000).toISOString(),
          zon_w: null,
          batterij_w: 640,
          batterij_procent: 40,
          net_w: 412,
          brug_versie: '0.6.1',
          storingen: [{ soort: 'meter', sleutel: 'meter:hw-p1', wat: 'P1-meter antwoordt niet', begin: new Date(T0 - 60_000).toISOString() }],
        },
      },
      { id: 'huis-buur01', naam: 'Buren', eigenaar_email: BUURMAN.email, meting: null },
      {
        id: 'huis-tim01',
        naam: 'Thuis',
        eigenaar_email: TIM.email,
        meting: { moment: new Date(T0).toISOString(), zon_w: 1134, batterij_w: -627, batterij_procent: 57, net_w: -49, brug_versie: '0.7.0', storingen: [] },
      },
    ]);
    // Geen sleutel (ook geen hash) en geen leden in het overzicht.
    expect(JSON.stringify(uit.data)).not.toMatch(/brug_sleutel_hash|leden|aaaa/);
    expect(nep.stand.aanroepen).toEqual(['auth.me', 'Huis.list', 'Meting.filter']);
  });

  it('een kijker, een eigenaar van een eigen huis en een account dat uit staat: geweigerd, zonder iets te lezen', async () => {
    for (const [wie, status] of [
      [DIRK, 403],
      [BUURMAN, 403],
      [{ ...TIM, is_active: false }, 403],
      [{ ...TIM, role: 'user' }, 403],
      [null, 401],
    ]) {
      const nep = await opzet(wie);
      const uit = await vraag(nep);
      expect(uit.status, JSON.stringify(wie)).toBe(status);
      expect(uit.data).not.toHaveProperty('huizen');
      expect(nep.stand.aanroepen, JSON.stringify(wie)).toEqual(['auth.me']);
    }
  });
});
