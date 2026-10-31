/**
 * Oude versies blijven werken (Tim, 30-10-2026): Dirk werkt zijn programmaatje
 * later bij dan Tim. Een meting zoals brug 0.6.1 en 0.6.2 hem sturen (zonder
 * de velden van 0.7.0: geen accu's apart, geen publiek deel, geen zon op/onder)
 * moet door ontvangMeting en 'stand' heen en in de site gewoon te zien zijn.
 */
import { describe, expect, it } from 'vitest';
import { apparatenStand, apparatenVan } from '../../src/lib/apparatenOverzicht.js';
import { batterijRegels } from '../../src/lib/batterijGegevens.js';
import { isDag } from '../../src/lib/dagNacht.js';
import { verdeelStroom } from '../../src/lib/stroom.js';
import { standUitRij } from '../../src/lib/bron.js';
import { omvormerRegels } from '../../src/lib/omvormer.js';
import { behandelMeting } from '../functions/ontvangMeting/ontvang.js';
import { behandelHuis } from '../shared/huizen.js';
import { sha256Hex } from '../shared/sleutel.js';
import { nepBase44, verzoek, zonderWachten } from './nep.js';

const SLEUTEL = 'fedcba9876543210'.repeat(3);
const DIRK = { id: 'gebruiker-dirk', email: 'dirk@voorbeeld.nl', role: 'user' };

/** Wat brug 0.6.2 bij Dirk stuurt (Chromebook, SolarFlow 2400 AC lokaal met drie accu's, geen omvormer), met de extra's van elke minuut. */
const METING_062 = {
  net_w: 412,
  net_bron: 'homewizard',
  zon_w: 0,
  zonnen: [{ sleutel: 'hw-zon', naam: 'Zon', vermogen_w: 0 }],
  batterij_w: 640,
  batterij_procent: 57,
  batterij_info: { temp_c: 24.5, temp_min_c: 22, behuizing_c: 31, spanning_v: 51.8, laadgrens_pct: 100, ontlaadgrens_pct: 10, pakketten: 3, inhoud_kwh: 8.64, storing: false },
  apparaten: [{ sleutel: 'hw-spa', naam: 'Spa', soort: 'stekker', vermogen_w: 1372 }],
  bron: 'brug 0.6.2+5ecccfb',
  fasen: [
    { fase: 1, w: 200, a: 1.2, v: 231 },
    { fase: 2, w: 100, a: 0.6, v: 230 },
    { fase: 3, w: 112, a: 0.7, v: 232 },
  ],
  gekoppeld: [{ sleutel: 'zendure', naam: 'Zendure', merk: 'Zendure', soort: 'SolarFlow 2400 AC', rol: 'batterij', manier: 'cloud-reserve', adres: '172.16.0.30', ok: true, w: 640 }],
  brug: {
    versie: '0.6.2+5ecccfb',
    gestart: '2026-10-30T06:00:00.000Z',
    elke_seconden: 5,
    prijzen: null,
    meldingen: [{ soort: 'apparaat', tekst: 'Zendure antwoordt lokaal niet; via de cloud (reserve).', sinds: '2026-10-30T15:40:00.000Z' }],
  },
};
/** 0.6.1: nog geen cloud als reserve; verder hetzelfde. */
const METING_061 = {
  ...METING_062,
  bron: 'brug 0.6.1',
  gekoppeld: [{ ...METING_062.gekoppeld[0], manier: 'lokaal' }],
  brug: { versie: '0.6.1', gestart: '2026-10-30T06:00:00.000Z', elke_seconden: 5 },
};

async function opzet() {
  return nepBase44({
    gebruiker: DIRK,
    rijen: {
      Huis: [{ id: 'huis-dirk001', naam: 'Bij Dirk', eigenaar_id: 'gebruiker-tim', eigenaar_email: 'tim@voorbeeld.nl', leden: [{ email: DIRK.email }], brug_sleutel_hash: await sha256Hex(SLEUTEL) }],
      Meting: [],
    },
  });
}

describe('een meting van de vorige brugversies', () => {
  for (const [versie, meting] of [
    ['0.6.2', METING_062],
    ['0.6.1', METING_061],
  ]) {
    it(`brug ${versie}: ontvangMeting neemt hem aan, 'stand' geeft hem, de site laat hem zien`, async () => {
      const nep = await opzet();
      const res = await behandelMeting(verzoek(meting, { kop: { 'x-brug-sleutel': SLEUTEL } }), () => nep.client, {
        nu: () => new Date('2026-10-30T16:00:00Z'),
        geheugen: new Map(),
        dagGeheugen: new Map(),
        geduld: zonderWachten,
      });
      // Zoals een oudere brug het verwacht: ok, en niets wat hij niet kent.
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });

      const st = await behandelHuis(verzoek({ actie: 'stand', huis_id: 'huis-dirk001' }, { kop: { Authorization: 'Bearer dirk' } }), () => nep.client, {
        geduld: zonderWachten,
        geheugen: new Map(),
      });
      expect(st.status).toBe(200);
      const { meting: rij } = await st.json();
      const stand = standUitRij(rij);
      expect(stand).toMatchObject({ net_w: 412, batterij_w: 640, batterij_procent: 57 });
      expect(stand.brug).toMatchObject({ versie: meting.brug.versie, publiek: null, opAfstand: [], zon: null });
      // Geen zon op en onder: de tekening schakelt dag en nacht zoals vroeger, op het licht.
      expect(isDag(stand, verdeelStroom(stand))).toBe(false);
      // Geen accu's apart: dan de warmste en de koelste, zoals vroeger.
      const regels = batterijRegels(stand.batterij_info).map((r) => r.tekst.replace(/\u00a0/g, ' '));
      expect(regels[0]).toBe("Temperatuur accu's 22–25 °C");
      expect(regels).toContain("3 accu's · samen 8,64 kWh");
      expect(stand.batterij_info).not.toHaveProperty('accus');
      expect(omvormerRegels(stand.omvormer)).toEqual([]);
      // Een kijker ziet het adres in de wifi niet.
      expect(rij.gekoppeld[0]).not.toHaveProperty('adres');
      // Geen herkennen (0.11.0): geen blok, en de kaart vraagt om bij te werken (Herkennen.jsx).
      expect(stand.herkend).toBeNull();
      // Geen apparaten per dag (0.12.0): Overzicht › Apparaten legt uit dat het na bijwerken komt.
      expect(apparatenStand(apparatenVan([{ datum: '2026-10-30', huis: 12, apparaten: stand.dag?.apparaten ?? null }]), stand.brug.versie)).toBe('bijwerken');
    });
  }
});

describe('brug 0.13.0 naast 0.12.0 (ronde 19): de functie en site van nu nemen allebei aan', () => {
  const metVersie = (versie, meldingen) => ({
    ...METING_062,
    bron: `brug ${versie}`,
    brug: { ...METING_062.brug, versie, herkent: true, meldingen },
  });
  for (const [versie, meldingen] of [
    ['0.12.0+13cf1a5', [{ soort: 'apparaat', tekst: 'Spa: geen antwoord', sinds: '2026-10-30T15:40:00.000Z' }]],
    ['0.13.0+abc1234', [{ soort: 'net', tekst: 'Meterkast: spanningsdip op L2 gemeten (16:58)', sinds: '2026-10-30T15:58:00.000Z' }]],
  ]) {
    it(`brug ${versie}: aangenomen, en de meldingen (ook de nieuwe soort net) staan bij Apparaten`, async () => {
      const nep = await opzet();
      const res = await behandelMeting(verzoek(metVersie(versie, meldingen), { kop: { 'x-brug-sleutel': SLEUTEL } }), () => nep.client, {
        nu: () => new Date('2026-10-30T16:00:00Z'),
        geheugen: new Map(),
        dagGeheugen: new Map(),
        geduld: zonderWachten,
      });
      expect(res.status).toBe(200);
      expect((await res.json()).ok).toBe(true);
      const st = await behandelHuis(verzoek({ actie: 'stand', huis_id: 'huis-dirk001' }, { kop: { Authorization: 'Bearer dirk' } }), () => nep.client, {
        geduld: zonderWachten,
        geheugen: new Map(),
      });
      const stand = standUitRij((await st.json()).meting);
      expect(stand.brug.versie).toBe(versie);
      expect(stand.brug.meldingen.map((m) => [m.soort, m.tekst])).toEqual(meldingen.map((m) => [m.soort, m.tekst]));
    });
  }
});

describe('brug 1.2.0 naast 1.1.1 en 0.6.1 (ronde 20): eigen verbruik en zelfvoorzienend per meting', () => {
  // Een dag tot 17:00, met de dag zoals elke minuut meegestuurd; overdag per kwartier gemiddeld net 0.
  const kwartieren = 68;
  const metDag = (versie, kwhExtra) => ({
    ...METING_062,
    bron: `brug ${versie}`,
    brug: { ...METING_062.brug, versie },
    dag: {
      datum: '2026-10-30',
      van: '2026-10-29T23:00:00.000Z',
      stap_min: 15,
      sinds: '2026-10-29T23:00:00.000Z',
      metingen: Array(kwartieren).fill(180),
      huis_w: Array(kwartieren).fill(600),
      zon_w: Array.from({ length: kwartieren }, (_, i) => (i >= 36 ? 900 : 0)),
      batterij_w: Array(kwartieren).fill(0),
      net_w: Array.from({ length: kwartieren }, (_, i) => (i >= 36 ? -300 : 600)),
      kwh: { zon: 7.2, huis: 10.2, geladen: 0, ontladen: 0, ...kwhExtra },
    },
  });

  for (const [versie, kwhExtra, verwacht] of [
    ['0.6.1', {}, { eigen_verbruik: 0.6667, zelfvoorzienend: 0.4706 }],
    ['1.1.1+049da96', {}, { eigen_verbruik: 0.6667, zelfvoorzienend: 0.4706 }],
    ['1.2.0+abc1234', { zon_zelf: 4.1, net_huis: 6.3 }, { eigen_verbruik: 0.5694, zelfvoorzienend: 0.3824 }],
  ]) {
    it(`brug ${versie}: aangenomen, en de rij van vandaag ${kwhExtra.zon_zelf ? 'precies uit de stromen per meting' : 'per kwartier, zoals eerst'}`, async () => {
      const nep = await opzet();
      const res = await behandelMeting(verzoek(metDag(versie, kwhExtra), { kop: { 'x-brug-sleutel': SLEUTEL } }), () => nep.client, {
        nu: () => new Date('2026-10-30T16:00:00Z'),
        geheugen: new Map(),
        dagGeheugen: new Map(),
        geduld: zonderWachten,
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(nep.tabellen.Dag.lijst).toHaveLength(1);
      expect(nep.tabellen.Dag.lijst[0]).toMatchObject({ zon_kwh: 7.2, huis_kwh: 10.2, ...verwacht });
      // De site: de stand komt binnen zoals altijd; Energie op het scherm rekent met de kWh van de kaart (delenVan).
      const st = await behandelHuis(verzoek({ actie: 'stand', huis_id: 'huis-dirk001' }, { kop: { Authorization: 'Bearer dirk' } }), () => nep.client, {
        geduld: zonderWachten,
        geheugen: new Map(),
      });
      const stand = standUitRij((await st.json()).meting);
      expect(stand.dag.kwh).toMatchObject({ zon: 7.2, huis: 10.2 });
      expect(stand.dag.stromenKwh).toEqual(kwhExtra.zon_zelf ? { zonZelf: 4.1, netHuis: 6.3 } : null);
    });
  }
});

describe('brug 1.3.0 naast 1.2.0 en 0.6.1 (ronde 21): een meter op een nieuw adres teruggevonden', () => {
  // 1.3.0 stuurt niets nieuws mee, alleen een melding van een nieuwe soort ('adres') en het adres van nu in gekoppeld.
  const metVersie = (versie, meldingen, adres) => ({
    ...METING_062,
    bron: `brug ${versie}`,
    gekoppeld: [{ ...METING_062.gekoppeld[0], adres }],
    brug: { ...METING_062.brug, versie, meldingen },
  });
  for (const [versie, meldingen, adres] of [
    ['0.6.1', [], '172.16.0.30'],
    ['1.2.0+fc11d7d', [{ soort: 'apparaat', tekst: 'Zendure-batterij: niet te bereiken in de wifi (uit, of een ander adres?) (EHOSTUNREACH)', sinds: '2026-10-30T15:40:00.000Z' }], '172.16.0.30'],
    ['1.3.0+abc1234', [{ soort: 'adres', tekst: 'Zendure-batterij: kreeg van de router een ander adres; weer gevonden.', sinds: '2026-10-30T15:58:00.000Z' }], '172.16.0.41'],
  ]) {
    it(`brug ${versie}: aangenomen; de melding staat bij Apparaten en in het logboek, en een kijker ziet geen adres`, async () => {
      const nep = await opzet();
      const res = await behandelMeting(verzoek(metVersie(versie, meldingen, adres), { kop: { 'x-brug-sleutel': SLEUTEL } }), () => nep.client, {
        nu: () => new Date('2026-10-30T16:00:00Z'),
        geheugen: new Map(),
        dagGeheugen: new Map(),
        geduld: zonderWachten,
      });
      expect(res.status).toBe(200);
      expect((await res.json()).ok).toBe(true);
      const st = await behandelHuis(verzoek({ actie: 'stand', huis_id: 'huis-dirk001' }, { kop: { Authorization: 'Bearer dirk' } }), () => nep.client, {
        geduld: zonderWachten,
        geheugen: new Map(),
      });
      const stand = standUitRij((await st.json()).meting);
      expect(stand.brug.meldingen.map((m) => [m.soort, m.tekst])).toEqual(meldingen.map((m) => [m.soort, m.tekst]));
      // Dirk is kijker: geen adressen, ook niet het nieuwe.
      expect(JSON.stringify(stand)).not.toMatch(/172\.16\./);
      const logboek = nep.tabellen.Gebeurtenis.lijst.map((r) => r.wat);
      if (versie.startsWith('1.3.0')) expect(logboek).toContain('Zendure-batterij: kreeg van de router een ander adres; weer gevonden.');
    });
  }
});
