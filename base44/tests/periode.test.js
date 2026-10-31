import { describe, expect, it } from 'vitest';
import { DAG_VELDEN } from '../shared/dagen.js';
import { behandelHuis } from '../shared/huizen.js';
import { nepBase44, verzoek, zonderWachten } from './nep.js';

const TIM = { id: 'gebruiker-tim', email: 'tim@voorbeeld.nl', role: 'admin' };
const DIRK = { id: 'gebruiker-dirk', email: 'dirk@voorbeeld.nl', role: 'user' };
const BUURMAN = { id: 'gebruiker-buur', email: 'buurman@voorbeeld.nl', role: 'user' };
const VREEMDE = { id: 'gebruiker-vreemd', email: 'vreemd@voorbeeld.nl', role: 'user' };

const HUIS_TIM = { id: 'huis-tim01', naam: 'Thuis', eigenaar_id: TIM.id, eigenaar_email: TIM.email, leden: [{ email: DIRK.email }], brug_sleutel_hash: 'a'.repeat(64) };
const HUIS_BUUR = { id: 'huis-buur01', naam: 'Buren', eigenaar_id: BUURMAN.id, eigenaar_email: BUURMAN.email, leden: [], brug_sleutel_hash: 'b'.repeat(64) };

/** "2026-10-01" plus n dagen. */
const datumNa = (begin, n) => new Date(Date.parse(`${begin}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Een rij zoals ontvangMeting hem schrijft, met wat Base44 er zelf bij zet. */
const dagRij = (huisId, datum, nr, extra = {}) => ({
  id: `dag-${huisId}-${String(nr).padStart(4, '0')}`,
  created_date: '2026-10-30T10:00:00.000Z',
  created_by: 'service',
  huis_id: huisId,
  datum,
  zon_kwh: 10 + (nr % 5),
  huis_kwh: 11,
  afname_kwh: 4,
  teruglevering_kwh: 6,
  kosten_eur: 1,
  opbrengst_eur: 1.5,
  vaste_kosten_eur: -0.21,
  zonnebonus_eur: 0.04,
  afname_prijs_kwh: 0.25,
  teruglevering_prijs_kwh: 0.25,
  compleet: true,
  eigen_verbruik: 0.7,
  zelfvoorzienend: 0.6,
  fasen: [{ fase: 1, gemiddeld_a: 2.1, piek_a: 12 }],
  kwartieren: 96,
  sinds: `${datum}T00:00:04.000Z`,
  bijgewerkt: `${datum}T22:45:00.000Z`,
  ...extra,
});

/** Oktober bij Tim (de rijen staan door elkaar, zoals in Base44), en een paar dagen bij de buren. */
const OKTOBER = Array.from({ length: 30 }, (_, i) => dagRij(HUIS_TIM.id, datumNa('2026-10-01', i), 30 - i));
const BUREN = Array.from({ length: 10 }, (_, i) => dagRij(HUIS_BUUR.id, datumNa('2026-10-21', i), 100 + i, { zon_kwh: 99 }));

function opzet(gebruiker, { huizen = [HUIS_TIM, HUIS_BUUR], dagen = [...OKTOBER, ...BUREN] } = {}) {
  return nepBase44({ gebruiker, rijen: { Huis: huizen, Dag: dagen } });
}

async function vraag(nep, lichaam) {
  const res = await behandelHuis(verzoek({ actie: 'periode', ...lichaam }, { kop: { Authorization: 'Bearer test' } }), () => nep.client, { geduld: zonderWachten, geheugen: new Map() });
  return { status: res.status, data: await res.json() };
}

const WEEK = { van: '2026-10-26', tot: '2026-11-01' };

describe('functie huis: de dagen van een periode', () => {
  it('de dagen van die week, op datum, met alleen wat de site nodig heeft', async () => {
    const uit = await vraag(opzet(TIM), { huis_id: HUIS_TIM.id, ...WEEK });
    expect(uit.status).toBe(200);
    expect(uit.data.van).toBe(WEEK.van);
    expect(uit.data.tot).toBe(WEEK.tot);
    expect(uit.data.dagen.map((d) => d.datum)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']);
    for (const dag of uit.data.dagen) {
      expect(Object.keys(dag).every((veld) => DAG_VELDEN.includes(veld))).toBe(true);
      expect(dag).not.toHaveProperty('huis_id');
      expect(dag).not.toHaveProperty('id');
      expect(dag).not.toHaveProperty('created_by');
    }
    // Nooit iets van de buren, ook niet op dezelfde dagen.
    expect(uit.data.dagen.some((d) => d.zon_kwh === 99)).toBe(false);
  });

  it('de apparaten per dag (brug 0.12.0) komen mee; een dag van een oudere brug zonder', async () => {
    const met = dagRij(HUIS_TIM.id, '2026-10-31', 999, { apparaten_kwh: [{ sleutel: 'hw-spa', naam: 'Spa', kwh: 6.4, keer: 9, gemeten: true }], basis_kwh: 4.8 });
    const uit = await vraag(opzet(TIM, { dagen: [...OKTOBER, met] }), { huis_id: HUIS_TIM.id, ...WEEK });
    const dag = uit.data.dagen.find((d) => d.datum === '2026-10-31');
    expect(dag.apparaten_kwh).toEqual(met.apparaten_kwh);
    expect(dag.basis_kwh).toBe(4.8);
    expect(uit.data.dagen.find((d) => d.datum === '2026-10-30')).not.toHaveProperty('apparaten_kwh');
  });

  it('een kijker ziet de dagen van zijn ene omgeving, net als de stand', async () => {
    const uit = await vraag(opzet(DIRK), { huis_id: HUIS_TIM.id, ...WEEK });
    expect(uit.status).toBe(200);
    expect(uit.data.dagen).toHaveLength(5);
  });

  it('andermans omgeving: precies hetzelfde antwoord als een omgeving die niet bestaat', async () => {
    const vanTim = await vraag(opzet(BUURMAN), { huis_id: HUIS_TIM.id, ...WEEK });
    const bestaatNiet = await vraag(opzet(BUURMAN), { huis_id: 'huis-nergens', ...WEEK });
    const geenId = await vraag(opzet(BUURMAN), WEEK);
    expect(vanTim).toMatchObject({ status: 404, data: { code: 'geenHuis' } });
    expect(bestaatNiet).toEqual(vanTim);
    expect(geenId).toEqual(vanTim);
    // Ook met een rare periode: eerst wie je bent en waar je mag, dan pas de vraag.
    expect(await vraag(opzet(BUURMAN), { huis_id: HUIS_TIM.id, van: 'gisteren', tot: 'x' })).toEqual(vanTim);
    expect(await vraag(opzet(VREEMDE), { huis_id: HUIS_TIM.id, ...WEEK })).toEqual(vanTim);
  });

  it('een gewone gebruiker kan geen ander huis opvragen, ook niet als hij daar (van vroeger) nog bij staat', async () => {
    // Dirk heeft een eigen omgeving die ouder is; bij Tim staat hij nog als kijker.
    const eigen = { ...HUIS_BUUR, id: 'huis-dirk000', naam: 'Bij Dirk', eigenaar_id: DIRK.id, eigenaar_email: DIRK.email };
    const nep = opzet(DIRK, { huizen: [HUIS_TIM, eigen], dagen: [...OKTOBER, dagRij(eigen.id, '2026-10-30', 1, { zon_kwh: 3 })] });
    const bijTim = await vraag(nep, { huis_id: HUIS_TIM.id, ...WEEK });
    expect(bijTim).toMatchObject({ status: 404, data: { code: 'geenHuis' } });
    const thuis = await vraag(nep, { huis_id: eigen.id, ...WEEK });
    expect(thuis.data.dagen).toEqual([expect.objectContaining({ datum: '2026-10-30', zon_kwh: 3 })]);
  });

  it('de beheerder ziet ook de dagen van een omgeving die een ander maakte', async () => {
    const uit = await vraag(opzet(TIM), { huis_id: HUIS_BUUR.id, ...WEEK });
    expect(uit.data.dagen.map((d) => d.zon_kwh)).toEqual([99, 99, 99, 99, 99]);
  });

  it('weigert een periode die niet klopt', async () => {
    const nep = opzet(TIM);
    for (const [van, tot] of [
      [undefined, undefined],
      ['2026-10-32', '2026-11-01'],
      ['26-10-2026', '2026-11-01'],
      ['2026-11-01', '2026-10-26'],
      ['2025-01-01', '2026-02-05'], // 401 dagen
      ['2019-12-31', '2020-01-01'],
      [20261026, 20261101],
      ['2026-10-26T00:00:00Z', '2026-11-01'],
    ]) {
      const uit = await vraag(nep, { huis_id: HUIS_TIM.id, van, tot });
      expect(uit, `${van} – ${tot}`).toMatchObject({ status: 400, data: { code: 'invoer' } });
    }
    expect(nep.stand.aanroepen.filter((a) => a.startsWith('Dag.'))).toEqual([]);
    // Een heel jaar (en een schrikkeljaar) mag wel.
    expect((await vraag(nep, { huis_id: HUIS_TIM.id, van: '2028-01-01', tot: '2028-12-31' })).status).toBe(200);
  });

  it('een jaar: stabiel gebladerd op id, elke dag één keer, nooit meer dan 400', async () => {
    const jaar = Array.from({ length: 366 }, (_, i) => dagRij(HUIS_TIM.id, datumNa('2028-01-01', i), i + 1));
    // Een dag die er door een vergissing twee keer staat: de oudste rij telt (die schrijft ontvangMeting).
    const dubbel = dagRij(HUIS_TIM.id, '2028-03-01', 9999, { zon_kwh: -1 });
    const nep = opzet(TIM, { dagen: [...jaar, dubbel] });
    const uit = await vraag(nep, { huis_id: HUIS_TIM.id, van: '2028-01-01', tot: '2028-12-31' });
    expect(uit.data.dagen).toHaveLength(366);
    expect(uit.data.dagen[0].datum).toBe('2028-01-01');
    expect(uit.data.dagen.at(-1).datum).toBe('2028-12-31');
    expect(uit.data.dagen.find((d) => d.datum === '2028-03-01').zon_kwh).not.toBe(-1);
    expect(nep.stand.aanroepen.filter((a) => a === 'Dag.filter')).toHaveLength(2);
  });

  it('zonder dagen (een nieuw huis, of een oudere functie die niets bewaarde): een lege lijst', async () => {
    const uit = await vraag(opzet(TIM, { dagen: [] }), { huis_id: HUIS_TIM.id, ...WEEK });
    expect(uit).toEqual({ status: 200, data: { ...WEEK, dagen: [] } });
  });

  it('bij de rem: 429, zoals de andere acties', async () => {
    const nep = opzet(TIM);
    nep.tabellen.Dag.filter = async () => {
      throw Object.assign(new Error('Rate limit exceeded'), { status: 429 });
    };
    const uit = await vraag(nep, { huis_id: HUIS_TIM.id, ...WEEK });
    expect(uit).toMatchObject({ status: 429, data: { code: 'rem' } });
  });
});
