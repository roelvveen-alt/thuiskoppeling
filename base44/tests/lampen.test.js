/**
 * Lampen en schakelaars (programmaatje 0.8.0, Tuya): van de meting van de brug
 * tot de site. En oude versies blijven werken: een meting zonder lampen
 * (0.7.0) gaat zoals altijd, en een onbekend blok van een nieuwere brug valt
 * stil weg (zo laat de functie van nu `lampen` vallen als hij nog ouder is).
 */
import { describe, expect, it } from 'vitest';
import { metTuya } from '../../brug/tuya.mjs';
import { standUitRij } from '../../src/lib/bron.js';
import { spotsAan } from '../../src/lib/lampen.js';
import { controleerMeting } from '../functions/ontvangMeting/controle.js';
import { behandelMeting } from '../functions/ontvangMeting/ontvang.js';
import { behandelHuis } from '../shared/huizen.js';
import { sha256Hex } from '../shared/sleutel.js';
import { nepBase44, verzoek, zonderWachten } from './nep.js';

const NU = new Date('2026-10-30T20:00:00Z');
const SLEUTEL = '0123456789abcdef'.repeat(3);
const TIM = { id: 'gebruiker-tim', email: 'tim@voorbeeld.nl', role: 'admin' };

/** Wat brug 0.7.0 stuurt (zonder Tuya). */
const METING_070 = {
  net_w: 300,
  zon_w: 0,
  zonnen: [{ sleutel: 'hw-zon-huis', naam: 'Zon huis', vermogen_w: 0 }],
  batterij_w: 200,
  batterij_procent: 60,
  apparaten: [{ sleutel: 'hw-was', naam: 'Wasmachine', soort: 'wasmachine', vermogen_w: 3 }],
  bron: 'brug 0.7.0',
};

/** Wat brug 0.8.0 stuurt: dezelfde stand, met de pomp en drie lampen erbij (metTuya). */
const METING_080 = metTuya(structuredClone({ ...METING_070, bron: 'brug 0.8.0' }), [
  { apparaat: { sleutel: 'tuya-pomp', naam: 'Pomp', wat: 'meter', soort: 'pomp' }, stand: { aan: true, w: 412.4, helderheid: null } },
  { apparaat: { sleutel: 'tuya-spots-overstek', naam: 'Spots overstek', wat: 'lamp', spots: true }, stand: { aan: true, w: null, helderheid: 64 } },
  { apparaat: { sleutel: 'tuya-lamp-schuur', naam: 'Lamp schuur', wat: 'schakelaar' }, stand: { aan: false, w: null, helderheid: null } },
  { apparaat: { sleutel: 'tuya-tuin', naam: 'Tuin', wat: 'lamp' }, stand: null },
]);

describe('controleerMeting: lampen, mild', () => {
  it('zoals de brug ze stuurt', () => {
    const { meting } = controleerMeting(METING_080, NU);
    expect(meting.apparaten.map((a) => a.sleutel)).toEqual(['hw-was', 'tuya-pomp']);
    expect(meting.apparaten[1]).toEqual({ sleutel: 'tuya-pomp', naam: 'Pomp', soort: 'pomp', vermogen_w: 412 });
    expect(meting.lampen).toEqual([
      { sleutel: 'tuya-spots-overstek', naam: 'Spots overstek', soort: 'lamp', aan: true, helderheid: 64, rol: 'spots' },
      { sleutel: 'tuya-lamp-schuur', naam: 'Lamp schuur', soort: 'schakelaar', aan: false },
      { sleutel: 'tuya-tuin', naam: 'Tuin', soort: 'lamp', aan: null },
    ]);
  });

  it('wat niet klopt valt weg, de meting komt er altijd door', () => {
    const uit = controleerMeting(
      {
        ...METING_070,
        lampen: [
          null,
          { naam: 'zonder sleutel', aan: true },
          { sleutel: 'hw-was', naam: 'zelfde sleutel als een apparaat', aan: true },
          { sleutel: 'tuya-a', naam: 'A', aan: 'ja', helderheid: 250, rol: 'iets', soort: 'stopcontact' },
          { sleutel: 'tuya-a', naam: 'dubbel', aan: true },
          ...Array.from({ length: 30 }, (_, i) => ({ sleutel: `tuya-${i}`, aan: true })),
        ],
      },
      NU,
    );
    expect(uit.ok).toBe(true);
    expect(uit.meting.lampen[0]).toEqual({ sleutel: 'tuya-a', naam: 'A', soort: 'lamp', aan: null });
    expect(uit.meting.lampen).toHaveLength(20);
    expect(controleerMeting({ ...METING_070, lampen: 'raar' }, NU).meting.lampen).toBeNull();
  });

  it('brug 0.7.0 (zonder lampen): lampen leeg; een onbekend blok valt stil weg', () => {
    expect(controleerMeting(METING_070, NU).meting.lampen).toBeNull();
    const uit = controleerMeting({ ...METING_080, iets_van_later: [{ a: 1 }] }, NU);
    expect(uit.ok).toBe(true);
    expect(uit.meting).not.toHaveProperty('iets_van_later');
  });
});

async function opzet() {
  return nepBase44({
    gebruiker: TIM,
    rijen: {
      Huis: [{ id: 'huis-tim01', naam: 'Thuis', eigenaar_id: TIM.id, eigenaar_email: TIM.email, leden: [], brug_sleutel_hash: await sha256Hex(SLEUTEL) }],
      Meting: [],
    },
  });
}

async function standNa(meting) {
  const nep = await opzet();
  const res = await behandelMeting(verzoek(meting, { kop: { 'x-brug-sleutel': SLEUTEL } }), () => nep.client, {
    nu: () => NU,
    geheugen: new Map(),
    dagGeheugen: new Map(),
    geduld: zonderWachten,
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
  const st = await behandelHuis(verzoek({ actie: 'stand', huis_id: 'huis-tim01' }, { kop: { Authorization: 'Bearer tim' } }), () => nep.client, {
    geduld: zonderWachten,
    geheugen: new Map(),
  });
  expect(st.status).toBe(200);
  return standUitRij((await st.json()).meting);
}

describe('van de brug tot de tekening', () => {
  it('brug 0.8.0: de pomp bij de apparaten, de lampen bij Apparaten, en de spotjes branden', async () => {
    const stand = await standNa(METING_080);
    expect(stand.apparaten.find((a) => a.sleutel === 'tuya-pomp')).toMatchObject({ naam: 'Pomp', soort: 'pomp', vermogen_w: 412 });
    expect(stand.lampen.map((l) => [l.naam, l.aan, l.spots])).toEqual([
      ['Spots overstek', true, true],
      ['Lamp schuur', false, false],
      ['Tuin', null, false],
    ]);
    expect(spotsAan(stand.lampen)).toBe(true);
  });

  it('brug 0.7.0: alles zoals vroeger, geen lampen en geen spotjes', async () => {
    const stand = await standNa(METING_070);
    expect(stand).toMatchObject({ net_w: 300, batterij_w: 200 });
    expect(stand.lampen).toEqual([]);
    expect(spotsAan(stand.lampen)).toBeNull();
  });
});
