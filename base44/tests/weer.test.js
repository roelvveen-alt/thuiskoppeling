/**
 * Het weerbericht (programmaatje 0.9.0, brug/weer.mjs) door ontvangMeting en
 * 'stand': mild nagekeken, de straling per uur in de dag, als zwaar deel met
 * een kenmerk, en een oudere brug zonder weer werkt zoals altijd.
 */
import { describe, expect, it } from 'vitest';
import { WEER_WOORDEN, weerUitOpenMeteo, weerVoorApp } from '../../brug/weer.mjs';
import { WMO } from '../../src/lib/weerBeeld.js';
import { controleerMeting } from '../functions/ontvangMeting/controle.js';
import { boekDag, stralingVan } from '../functions/ontvangMeting/dagboek.js';
import { behandelMeting } from '../functions/ontvangMeting/ontvang.js';
import { weerUit } from '../../src/lib/bron.js';
import { behandelHuis } from '../shared/huizen.js';
import { sha256Hex } from '../shared/sleutel.js';
import { tabellen } from '../shared/tabellen.js';
import { nepBase44, verzoek, zonderWachten } from './nep.js';

const SLEUTEL = '0123456789abcdef'.repeat(3);
const TIM = { id: 'gebruiker-tim', email: 'tim@voorbeeld.nl', role: 'admin' };
/** 30 oktober 2026, 12:00 in Nederland (wintertijd). */
const NU = Date.parse('2026-10-30T11:00:00Z');

/** Een vast antwoord van Open-Meteo voor 30 en 31 oktober (UTC+1): straling van 8:00 tot 17:00, 300 W/m² op het midden. */
function openMeteo() {
  const time = ['2026-10-30', '2026-10-31'].flatMap((d) => Array.from({ length: 24 }, (_, u) => `${d}T${String(u).padStart(2, '0')}:00`));
  const uur = (t) => Number(t.slice(11, 13));
  return {
    utc_offset_seconds: 3600,
    hourly_units: { shortwave_radiation: 'W/m²', cloud_cover: '%', temperature_2m: '°C' },
    hourly: {
      time,
      shortwave_radiation: time.map((t) => (uur(t) >= 9 && uur(t) <= 17 ? 300 - 40 * Math.abs(uur(t) - 13) : 0)),
      cloud_cover: time.map(() => 40),
      temperature_2m: time.map(() => 8.5),
    },
  };
}
const WEER = weerVoorApp(weerUitOpenMeteo(openMeteo()), NU - 10 * 60_000);

describe('het weer in ontvangMeting (controle.js)', () => {
  it('zoals het programmaatje het stuurt, gaat het mee', () => {
    const uit = controleerMeting({ net_w: 100, weer: WEER }, new Date(NU));
    expect(uit.ok).toBe(true);
    expect(uit.meting.weer).toEqual(WEER);
    expect(uit.overgeslagen).toEqual([]);
  });

  it('een oudere brug (0.8.0) stuurt geen weer: dan staat het veld er niet (het vorige bericht blijft in de rij)', () => {
    const uit = controleerMeting({ net_w: 100, bron: 'brug 0.8.0' }, new Date(NU));
    expect(uit.ok).toBe(true);
    expect(uit.meting).not.toHaveProperty('weer');
  });

  it('mild: een reeks die niet klopt valt weg, de rest en de meting blijven', () => {
    const raar = { ...WEER, temp_c: WEER.temp_c.map((t, i) => (i === 3 ? 'koud' : t)), bewolking_pct: WEER.bewolking_pct.slice(0, 10), onbekend: 1 };
    const uit = controleerMeting({ net_w: 100, weer: raar }, new Date(NU));
    expect(uit.ok).toBe(true);
    expect(Object.keys(uit.meting.weer)).toEqual(['van', 'stap_min', 'straling_wm2', 'opgehaald', 'bron']);
    expect(uit.overgeslagen).toEqual([]);
  });

  it('kapot of leeg: geen weer, wel de meting', () => {
    for (const weer of [
      'zon',
      [],
      { ...WEER, stap_min: 15 },
      { ...WEER, van: 'gisteren' },
      { ...WEER, straling_wm2: undefined, bewolking_pct: undefined },
      { ...WEER, straling_wm2: [5000], bewolking_pct: [-1] },
      { ...WEER, straling_wm2: Array(100).fill(1), bewolking_pct: undefined },
    ]) {
      const uit = controleerMeting({ net_w: 100, weer }, new Date(NU));
      expect(uit.ok, JSON.stringify(weer).slice(0, 80)).toBe(true);
      expect(uit.meting).not.toHaveProperty('weer');
      expect(uit.meting.net_w).toBe(100);
    }
  });

  it('afgerond en de bron schoon', () => {
    const uit = controleerMeting({ net_w: 1, weer: { ...WEER, temp_c: WEER.temp_c.map(() => 8.4567), bron: 'open-meteo‮' } }, new Date(NU));
    expect(uit.meting.weer.temp_c[0]).toBe(8.5);
    expect(uit.meting.weer.bron).toBe('open-meteo');
  });
});

describe('het weer per uur sinds 0.10.0 (weercode, neerslag, kans, windstoten)', () => {
  const uren = WEER.straling_wm2.length;
  const NIEUW = { ...WEER, weercode: Array(uren).fill(61), neerslag_mm: Array(uren).fill(0.44), neerslag_kans_pct: Array(uren).fill(70), windstoten_kmh: Array(uren).fill(52.4) };

  it('gaat mee, afgerond; een vreemde reeks (een halve weercode, te kort) valt weg, de rest blijft', () => {
    const uit = controleerMeting({ net_w: 1, weer: NIEUW }, new Date(NU)).meting.weer;
    expect(uit.weercode[0]).toBe(61);
    expect(uit.neerslag_mm[0]).toBe(0.4);
    expect(uit.neerslag_kans_pct[0]).toBe(70);
    expect(uit.windstoten_kmh[0]).toBe(52);
    const raar = controleerMeting({ net_w: 1, weer: { ...NIEUW, weercode: NIEUW.weercode.map((c, i) => (i === 4 ? 61.5 : c)), neerslag_kans_pct: [1, 2] } }, new Date(NU));
    expect(raar.ok).toBe(true);
    expect(raar.meting.weer).not.toHaveProperty('weercode');
    expect(raar.meting.weer).not.toHaveProperty('neerslag_kans_pct');
    expect(raar.meting.weer.neerslag_mm).toHaveLength(uren);
  });

  it('keten: door ontvangMeting en stand komt het in de site aan; een oudere brug (0.9.0) zonder: de site heeft dan null', () => {
    const site = weerUit(controleerMeting({ net_w: 1, weer: NIEUW }, new Date(NU)).meting.weer);
    expect(site.code[0]).toBe(61);
    expect(site.neerslag[0]).toBe(0.4);
    expect(site.kans[0]).toBe(70);
    expect(site.stoten[0]).toBe(52);
    const oud = weerUit(controleerMeting({ net_w: 1, bron: 'brug 0.9.0', weer: WEER }, new Date(NU)).meting.weer);
    expect(oud).toMatchObject({ code: null, neerslag: null, kans: null, stoten: null });
    expect(oud.straling).toHaveLength(uren);
  });
});

describe('het weer van nu (voor de tekening)', () => {
  const nu = { code: 95, neerslag_mm: 2.4, wind_kmh: 48, windstoten_kmh: 83, bewolking_pct: 100 };

  it('gaat mee zoals het programmaatje het stuurt; mild: wat niet klopt valt weg', () => {
    expect(controleerMeting({ net_w: 1, weer: { ...WEER, nu } }, new Date(NU)).meting.weer.nu).toEqual(nu);
    const raar = { code: 950, neerslag_mm: -1, wind_kmh: 48.4, windstoten_kmh: 'hard', bewolking_pct: 100 };
    expect(controleerMeting({ net_w: 1, weer: { ...WEER, nu: raar } }, new Date(NU)).meting.weer.nu).toEqual({ wind_kmh: 48, bewolking_pct: 100 });
    expect(controleerMeting({ net_w: 1, weer: { ...WEER, nu: 'regen' } }, new Date(NU)).meting.weer).not.toHaveProperty('nu');
    expect(controleerMeting({ net_w: 1, weer: { ...WEER, nu: {} } }, new Date(NU)).meting.weer).not.toHaveProperty('nu');
  });

  it('het programmaatje en de site zeggen bij elke weercode hetzelfde', () => {
    expect(Object.keys(WEER_WOORDEN)).toEqual(Object.keys(WMO));
    for (const code of Object.keys(WMO)) expect(WEER_WOORDEN[code], code).toBe(WMO[code].tekst);
  });
});

describe('de straling per uur in de dag (dagboek.js)', () => {
  it('per uur van de klok in Wh/m², alleen de uren van die dag', () => {
    const uit = stralingVan(WEER, '2026-10-30').straling_uur_wh_m2;
    expect(uit).toHaveLength(24);
    // 12:00–13:00 lokaal: de waarde die Open-Meteo bij 13:00 zet (300).
    expect(uit[12]).toBe(300);
    expect(uit[8]).toBe(140);
    expect(uit[3]).toBe(0);
    expect(uit.reduce((a, b) => a + b, 0)).toBe(1900);
    expect(stralingVan(WEER, '2026-10-31').straling_uur_wh_m2[12]).toBe(300);
  });

  it('een dag die het bericht niet dekt, of geen straling: niets', () => {
    expect(stralingVan(WEER, '2026-11-01')).toBeNull();
    expect(stralingVan({ ...WEER, straling_wm2: undefined }, '2026-10-30')).toBeNull();
    expect(stralingVan(null, '2026-10-30')).toBeNull();
  });

  it('de dag krijgt de straling ook als het weer niet in elke meting zit, en zonder één aanroep extra', async () => {
    const dag = {
      datum: '2026-10-30',
      van: '2026-10-29T23:00:00.000Z',
      stap_min: 15,
      sinds: '2026-10-29T23:00:00.000Z',
      metingen: Array(48).fill(180),
      huis_w: Array(48).fill(400),
      zon_w: Array(48).fill(0),
      kwh: { zon: 0, huis: 4.8, geladen: 0, ontladen: 0 },
    };
    const tel = async (metWeer) => {
      const nep = nepBase44({ rijen: { Dag: [] } });
      const db = tabellen(nep.client.asServiceRole.entities, zonderWachten);
      const geheugen = new Map();
      for (let s = 0; s <= 3600; s += 5) {
        const ruw = { net_w: 100, dag, ...(metWeer && s === 0 ? { weer: WEER } : {}) };
        const meting = controleerMeting(ruw, new Date(NU + s * 1000)).meting;
        await boekDag(db, 'huis-tim01', meting, new Date(NU + s * 1000), geheugen);
      }
      return { aanroepen: nep.stand.aanroepen.length, rij: nep.tabellen.Dag.lijst[0] };
    };
    const met = await tel(true);
    const zonder = await tel(false);
    expect(met.aanroepen).toBe(zonder.aanroepen);
    expect(met.rij.straling_uur_wh_m2[12]).toBe(300);
    expect(zonder.rij).not.toHaveProperty('straling_uur_wh_m2');
  });
});

describe("het weer door ontvangMeting en 'stand'", () => {
  async function opzet() {
    const nep = nepBase44({
      gebruiker: TIM,
      rijen: {
        Huis: [{ id: 'huis-tim01', naam: 'Thuis', eigenaar_id: TIM.id, eigenaar_email: TIM.email, leden: [], brug_sleutel_hash: await sha256Hex(SLEUTEL) }],
        Meting: [],
        Opstelling: [],
        Dag: [],
      },
    });
    const opties = { geheugen: new Map(), dagGeheugen: new Map(), geduld: zonderWachten };
    const stuur = (meting, ms) => behandelMeting(verzoek(meting, { kop: { 'x-brug-sleutel': SLEUTEL } }), () => nep.client, { ...opties, nu: () => new Date(ms) });
    const huisGeheugen = new Map();
    const stand = async (heb, ms) =>
      (
        await behandelHuis(verzoek({ actie: 'stand', huis_id: 'huis-tim01', ...(heb ? { heb } : {}) }, { kop: { Authorization: 'Bearer test' } }), () => nep.client, {
          geduld: zonderWachten,
          geheugen: huisGeheugen,
          klok: () => ms,
        })
      ).json();
    return { nep, stuur, stand };
  }

  it('het weer staat in de rij en blijft staan als de volgende meting het niet meestuurt', async () => {
    const { nep, stuur } = await opzet();
    expect((await stuur({ net_w: 100, weer: WEER }, NU)).status).toBe(200);
    expect((await stuur({ net_w: 120 }, NU + 5000)).status).toBe(200);
    expect(nep.tabellen.Meting.lijst[0]).toMatchObject({ net_w: 120, weer: WEER });
  });

  it("'stand' geeft het weer met een kenmerk; heeft de site het al, dan niet nog eens", async () => {
    const { stuur, stand } = await opzet();
    await stuur({ net_w: 100, weer: WEER }, NU);
    const eerst = await stand(null, NU + 1000);
    expect(eerst.meting.weer).toEqual(WEER);
    expect(eerst.kenmerken.weer).toMatch(/^[0-9a-f]{16}$/);
    const daarna = await stand({ weer: eerst.kenmerken.weer }, NU + 40_000);
    expect(daarna.meting).not.toHaveProperty('weer');
    expect(daarna.bekend).toEqual(['weer']);
  });

  it('keten: wat het programmaatje stuurt, komt met dezelfde getallen in de site aan (weerUit)', async () => {
    const { stuur, stand } = await opzet();
    await stuur({ net_w: 100, weer: { ...WEER, nu: { code: 61, neerslag_mm: 0.4, wind_kmh: 22, windstoten_kmh: 41, bewolking_pct: 100 } } }, NU);
    const site = weerUit((await stand(null, NU + 1000)).meting.weer);
    expect(site.nu).toEqual({ code: 61, neerslag: 0.4, wind: 22, stoten: 41, bewolking: 100 });
    expect(site).toMatchObject({ van: Date.parse(WEER.van), stapMs: 3_600_000, straling: WEER.straling_wm2, bewolking: WEER.bewolking_pct, temp: WEER.temp_c, bron: 'open-meteo' });
    expect(site.opgehaald).toBe(Date.parse(WEER.opgehaald));
  });

  it('een oudere brug zonder weer: de stand zoals altijd, zonder weer en zonder kenmerk ervoor', async () => {
    const { stuur, stand } = await opzet();
    expect((await stuur({ net_w: 100, bron: 'brug 0.8.0' }, NU)).status).toBe(200);
    const uit = await stand(null, NU + 1000);
    expect(uit.meting.net_w).toBe(100);
    expect(uit.meting).not.toHaveProperty('weer');
    expect(uit.kenmerken?.weer).toBeUndefined();
  });
});
