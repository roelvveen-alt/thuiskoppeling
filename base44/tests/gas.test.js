/**
 * Gasmeterstanden zelf invullen (Instellingen › Gas, ronde 23): de regels
 * (base44/shared/gas.js) en de actie gasStand van de functie huis: alleen de
 * eigenaar, vers gelezen vlak voor het schrijven, alleen het veld gas_standen.
 */
import { describe, expect, it } from 'vitest';
import { GasFout, gasStandenUit, gasStandUit, HOOGSTENS_GAS_STANDEN, metGasStand, zonderGasStand } from '../shared/gas.js';
import { behandelHuis } from '../shared/huizen.js';
import { nepBase44, verzoek, zonderWachten } from './nep.js';

const NU = Date.parse('2026-10-31T12:00:00Z');
const TIM = { id: 'gebruiker-tim', email: 'tim@voorbeeld.nl', role: 'admin' };
const DIRK = { id: 'gebruiker-dirk', email: 'dirk@voorbeeld.nl', role: 'user' };
const BUUR = { id: 'gebruiker-buur', email: 'buur@voorbeeld.nl', role: 'user' };
const HUIS = { id: 'huis-dirk001', naam: 'Bij Dirk', eigenaar_id: DIRK.id, eigenaar_email: DIRK.email, leden: [{ email: BUUR.email }], brug_sleutel_hash: 'a'.repeat(64) };

describe('de regels (gas.js)', () => {
  it('een stand: echte datum, niet later dan vandaag, een getal van 0 of meer', () => {
    expect(gasStandUit({ datum: '2026-10-31', stand: 2569.6461 }, NU)).toEqual({ datum: '2026-10-31', stand: 2569.646 });
    for (const fout of [null, { datum: '2026-02-30', stand: 1 }, { datum: '2026-11-02', stand: 1 }, { datum: '2026-10-01', stand: -1 }, { datum: '2026-10-01', stand: '12' }]) {
      expect(() => gasStandUit(fout, NU)).toThrow(GasFout);
    }
  });

  it('oplopend: niet lager dan een eerdere stand, niet hoger dan een latere; dezelfde datum vervangt', () => {
    let lijst = metGasStand([], { datum: '2026-10-01', stand: 2500 });
    lijst = metGasStand(lijst, { datum: '2026-10-31', stand: 2569.6 });
    lijst = metGasStand(lijst, { datum: '2026-10-15', stand: 2530 });
    expect(lijst.map((s) => s.datum)).toEqual(['2026-10-01', '2026-10-15', '2026-10-31']);
    expect(() => metGasStand(lijst, { datum: '2026-10-20', stand: 2520 })).toThrow(/lager dan die van 2026-10-15/);
    expect(() => metGasStand(lijst, { datum: '2026-10-20', stand: 2600 })).toThrow(/hoger dan die van 2026-10-31/);
    expect(metGasStand(lijst, { datum: '2026-10-15', stand: 2540 }).find((s) => s.datum === '2026-10-15').stand).toBe(2540);
    expect(zonderGasStand(lijst, '2026-10-15')).toHaveLength(2);
  });

  it('hooguit 400; wat niet klopt in de rij valt weg', () => {
    const veel = Array.from({ length: 450 }, (_, i) => ({ datum: new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10), stand: i }));
    const lijst = gasStandenUit(veel);
    expect(lijst).toHaveLength(HOOGSTENS_GAS_STANDEN);
    expect(lijst[0].stand).toBe(50);
    expect(gasStandenUit([{ datum: 'gisteren', stand: 1 }, { datum: '2026-10-01', stand: -3 }, null, 'x'])).toEqual([]);
  });
});

describe('de actie gasStand', () => {
  async function opzet(gebruiker, opstelling = []) {
    return nepBase44({ gebruiker, rijen: { Huis: [HUIS], Meting: [], Opstelling: opstelling } });
  }
  const vraag = async (nep, lichaam) => {
    const res = await behandelHuis(verzoek(lichaam, { kop: { Authorization: 'Bearer x' } }), () => nep.client, { geduld: zonderWachten, geheugen: new Map(), klok: () => NU });
    return { status: res.status, data: await res.json() };
  };

  it('de eigenaar vult in: vers gelezen, alleen gas_standen geschreven; de rest van de opstelling blijft', async () => {
    const nep = await opzet(DIRK, [{ id: 'opst-1', huis_id: HUIS.id, tekening: 'schuur', namen: [{ sleutel: 'net', naam: 'Meterkast' }] }]);
    const uit = await vraag(nep, { actie: 'gasStand', huis_id: HUIS.id, stand: { datum: '2026-10-30', stand: 2569.6 } });
    expect(uit).toEqual({ status: 200, data: { gas_standen: [{ datum: '2026-10-30', stand: 2569.6 }] } });
    expect(nep.tabellen.Opstelling.lijst[0]).toMatchObject({ tekening: 'schuur', namen: [{ sleutel: 'net', naam: 'Meterkast' }], gas_standen: [{ datum: '2026-10-30', stand: 2569.6 }] });
    expect(nep.stand.aanroepen.filter((a) => a.startsWith('Opstelling.'))).toEqual(['Opstelling.filter', 'Opstelling.update']);
    // Lager dan de vorige: een uitleg, niets geschreven.
    const fout = await vraag(nep, { actie: 'gasStand', huis_id: HUIS.id, stand: { datum: '2026-10-31', stand: 2000 } });
    expect(fout.status).toBe(400);
    expect(fout.data.error).toMatch(/Een gasmeter telt alleen op/);
    // Weghalen.
    expect((await vraag(nep, { actie: 'gasStand', huis_id: HUIS.id, verwijder: '2026-10-30' })).data).toEqual({ gas_standen: [] });
    // En 'opstelling' geeft ze terug.
    await vraag(nep, { actie: 'gasStand', huis_id: HUIS.id, stand: { datum: '2026-10-29', stand: 2560 } });
    expect((await vraag(nep, { actie: 'opstelling', huis_id: HUIS.id })).data.opstelling.gas_standen).toEqual([{ datum: '2026-10-29', stand: 2560 }]);
  });

  it('zonder opstelling: een nieuwe rij voor dit huis', async () => {
    const nep = await opzet(DIRK);
    expect((await vraag(nep, { actie: 'gasStand', huis_id: HUIS.id, stand: { datum: '2026-10-30', stand: 1 } })).status).toBe(200);
    expect(nep.tabellen.Opstelling.lijst).toEqual([expect.objectContaining({ huis_id: HUIS.id, gas_standen: [{ datum: '2026-10-30', stand: 1 }] })]);
  });

  it('een kijker of vreemde schrijft niets; de beheerder wel (die heeft de rechten van de eigenaar)', async () => {
    const kijker = await opzet(BUUR);
    expect((await vraag(kijker, { actie: 'gasStand', huis_id: HUIS.id, stand: { datum: '2026-10-30', stand: 1 } })).status).toBe(403);
    expect(kijker.tabellen.Opstelling.lijst).toEqual([]);
    const zonder = nepBase44({ gebruiker: null, rijen: { Huis: [HUIS], Opstelling: [] } });
    expect((await vraag(zonder, { actie: 'gasStand', huis_id: HUIS.id, stand: { datum: '2026-10-30', stand: 1 } })).status).toBe(401);
    const tim = await opzet(TIM);
    expect((await vraag(tim, { actie: 'gasStand', huis_id: HUIS.id, stand: { datum: '2026-10-30', stand: 1 } })).status).toBe(200);
  });
});
