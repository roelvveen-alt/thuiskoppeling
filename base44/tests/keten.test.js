/**
 * De hele keten met de echte buren in plaats van ieders eigen voorbeeld:
 * brug (maakMeting, logboek van een dag) → ontvangMeting (controle en opslaan,
 * met de nep-Base44) → huis 'stand' → standUitRij in de site. Hernoemt iemand
 * een veld aan één kant (huis_w in dag.mjs, een veld in METING_VELDEN), dan
 * wordt dit rood in plaats van een lege grafiek live.
 */
import { describe, expect, it } from 'vitest';
import { dagVoorApp, logMeting, middernacht } from '../../brug/dag.mjs';
import { maakMeting } from '../../brug/samenvoegen.mjs';
import { standUitRij } from '../../src/lib/bron.js';
import { behandelMeting } from '../functions/ontvangMeting/ontvang.js';
import { behandelHuis } from '../shared/huizen.js';
import { sha256Hex } from '../shared/sleutel.js';
import { nepBase44, verzoek, zonderWachten } from './nep.js';

const SLEUTEL = '0123456789abcdef'.repeat(3);
const TIM = { id: 'gebruiker-tim', email: 'tim@voorbeeld.nl', role: 'admin' };
const meter = (rol, naam = rol) => ({ rol, naam, sleutel: `hw-${naam}`, soort: 'stekker' });

describe('keten: brug → ontvangMeting → stand → site', () => {
  it('een volle dag van het programmaatje komt met dezelfde getallen in de site aan', async () => {
    const eind = Date.parse('2026-10-30T22:50:00Z'); // 23:50 in Nederland
    const begin = middernacht(eind);
    let logboek = null;
    let meting = null;
    for (let t = begin; t <= eind; t += 60_000) {
      const uur = new Date(t).getUTCHours();
      const zon = uur >= 7 && uur < 16 ? 1200 : 0;
      meting = maakMeting({
        homewizard: [
          { meter: meter('net'), w: 300 - zon },
          { meter: meter('zon', 'dak'), w: -zon },
        ],
        zendure: { zon_w: null, batterij_w: 0, batterij_procent: 50, ac_w: 0 },
        versie: 'keten',
      });
      logboek = logMeting(logboek, meting, t);
    }
    meting.moment = new Date(eind).toISOString();
    meting.dag = dagVoorApp(logboek);

    const nep = nepBase44({
      gebruiker: TIM,
      rijen: {
        Huis: [{ id: 'huis-tim01', naam: 'Thuis', eigenaar_id: TIM.id, eigenaar_email: TIM.email, leden: [], brug_sleutel_hash: await sha256Hex(SLEUTEL) }],
        Meting: [],
        Opstelling: [],
        Dag: [],
      },
    });
    const ontvangen = await behandelMeting(verzoek(meting, { kop: { 'x-brug-sleutel': SLEUTEL } }), () => nep.client, {
      nu: () => new Date(eind),
      geheugen: new Map(),
      dagGeheugen: new Map(),
      geduld: zonderWachten,
    });
    expect(ontvangen.status, JSON.stringify(await ontvangen.clone().json())).toBe(200);

    const antwoord = await behandelHuis(verzoek({ actie: 'stand', huis_id: 'huis-tim01' }, { kop: { Authorization: 'Bearer test' } }), () => nep.client, {
      geduld: zonderWachten,
      geheugen: new Map(),
    });
    expect(antwoord.status).toBe(200);
    const stand = standUitRij((await antwoord.json()).meting);

    expect(stand.net_w).toBe(meting.net_w);
    expect(stand.zon_w).toBe(meting.zon_w);
    expect(stand.batterij_procent).toBe(meting.batterij_procent);
    expect(stand.dag, 'de dag komt niet aan in de site').not.toBeNull();
    const kwartieren = meting.dag.metingen.length;
    expect(kwartieren).toBeGreaterThanOrEqual(92);
    expect(stand.dag.metingen).toEqual(meting.dag.metingen);
    expect(stand.dag.huis).toEqual(meting.dag.huis_w.map((v, i) => (meting.dag.metingen[i] > 0 ? v : null)));
    expect(stand.dag.zon.some((v) => v > 1000)).toBe(true);
    // En de dag staat in de tabel Dag (voor Week, Maand, Kwartaal en Jaar).
    expect(nep.tabellen.Dag.lijst.length).toBe(1);
    expect(meting.dag.kwh.zon).toBeCloseTo(10.8, 0);
    expect(nep.tabellen.Dag.lijst[0].zon_kwh).toBe(meting.dag.kwh.zon);
    expect(nep.tabellen.Dag.lijst[0].huis_kwh).toBe(meting.dag.kwh.huis);
  });
});
