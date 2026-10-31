/**
 * Programmaatje 1.4.0 (ronde 23): meer uit de apparaten (de meterkast met gas,
 * meer van de omvormer en de batterij, en de kennislijst).
 *
 *   - De nieuwe brug werkt met de functie die nu live staat (een kopie in
 *     oudeFunctie/controle.js): wat die niet kent, valt stil weg, de stand komt aan.
 *   - De nieuwe functie neemt het aan en bewaart het; de stand gaat naar de site
 *     zonder de kennislijst; die ziet alleen de beheerder (overzicht).
 *   - Een oudere brug (1.3.0 bij Tim, 0.6.1 bij Dirk) werkt met de nieuwe functie
 *     en site gewoon door: geen meterkast, geen lege kaart.
 */
import { describe, expect, it } from 'vitest';
import { batterijRegels } from '../../src/lib/batterijGegevens.js';
import { gasVoorPeriode } from '../../src/lib/gasStanden.js';
import { dagenUit } from '../../src/lib/periode.js';
import { standUitRij } from '../../src/lib/bron.js';
import { meterkastRegels } from '../../src/lib/meterkast.js';
import { omvormerRegels } from '../../src/lib/omvormer.js';
import { controleerMeting } from '../functions/ontvangMeting/controle.js';
import { behandelMeting } from '../functions/ontvangMeting/ontvang.js';
import { behandelHuis } from '../shared/huizen.js';
import { sha256Hex } from '../shared/sleutel.js';
import { nepBase44, verzoek, zonderWachten } from './nep.js';
import { controleerMeting as controleerLive } from './oudeFunctie/controle.js';

const SLEUTEL = 'fedcba9876543210'.repeat(3);
const TIM = { id: 'gebruiker-tim', email: 'tim@voorbeeld.nl', role: 'admin' };
const DIRK = { id: 'gebruiker-dirk', email: 'dirk@voorbeeld.nl', role: 'user' };
const NU = new Date('2026-10-31T13:00:00Z');

/** Wat brug 1.4.0 stuurt bij een huis met gasmeter, omvormer en Zendure, met de extra's en de kennislijst. */
const METING_140 = {
  net_w: 412,
  net_bron: 'homewizard',
  zon_w: 1835,
  zonnen: [{ sleutel: 'hw-zon', naam: 'Zon', vermogen_w: 1835 }],
  batterij_w: -640,
  batterij_procent: 57,
  batterij_info: {
    temp_c: 24.5,
    laadgrens_pct: 100,
    ontlaadgrens_pct: 10,
    pakketten: 2,
    storing: false,
    cel_min_v: 3.25,
    cel_max_v: 3.28,
    invoer_limiet_w: 2300,
    uitvoer_limiet_w: 800,
    accus: [
      { nr: 1, temp_c: 23, procent: 41, cel_min_v: 3.26, cel_max_v: 3.28, cycli: 152, verwarmt: true },
      { nr: 2, temp_c: 25.5, procent: 40, cel_min_v: 3.25, cel_max_v: 3.28 },
    ],
  },
  omvormer: { stand: 'normaal', w: 1835, temp_c: 41.3, pf: 0.987, bus_v: 601.2, koelplaat_c: 45, uren: 8451, isolatie_kohm: 85, lekstroom_ma: 12.5 },
  meterkast: {
    tarief: 1,
    meters: [
      { soort: 'gas', stand: 2569.646, eenheid: 'm3', op: '2026-10-31T12:55:00.000Z', vandaag: 1.234 },
      { soort: 'water', stand: 123.456, eenheid: 'm3', vandaag: 0.12 },
    ],
  },
  apparaten: [],
  bron: 'brug 1.4.0+abc1234',
  dag: {
    datum: '2026-10-31',
    van: '2026-10-30T23:00:00.000Z',
    stap_min: 15,
    sinds: '2026-10-30T23:00:05.000Z',
    metingen: [1, 2],
    huis_w: [300, 320],
    net_w: [300, 320],
    kwh: { zon: 0, huis: 0.15, geladen: 0, ontladen: 0 },
    gas_m3: 1.234,
    water_m3: 0.12,
  },
  brug: {
    versie: '1.4.0+abc1234',
    gestart: '2026-10-31T06:00:00.000Z',
    elke_seconden: 5,
    meldingen: [{ soort: 'omvormer', tekst: 'Omvormer, isolatie van de panelen: laag (85 kΩ); laat de installateur de panelen en kabels nakijken', sinds: '2026-10-31T12:50:00.000Z' }],
  },
  kennis: {
    apparaten: [
      { sleutel: 'hw-meterkast', soort: 'HomeWizard P1-meter (v2)', datum: '2026-10-31', velden: ['active_tariff=1', 'total_gas_m3=2569.646', 'unique_id', 'wifi_ssid'] },
      // Een kapotte regel en een naam met een waarde die niet mag (sn), hier nog eens weggefilterd.
      { sleutel: 'zendure', soort: 'SolarFlow 2400 AC', datum: '2026-10-31', velden: ['electricLevel=57', 'sn=12345', 'deviceId=5', 'packData[].maxVol=328', 'wifi naam=Thuis'] },
    ],
  },
};

/** Brug 1.3.0 (Tim, nu): alles van daarvoor, zonder de nieuwe velden. */
const METING_130 = (() => {
  const rest = Object.fromEntries(Object.entries(METING_140).filter(([veld]) => !['meterkast', 'kennis'].includes(veld)));
  return {
    ...rest,
    bron: 'brug 1.3.0+0c0ffee',
    batterij_info: { temp_c: 24.5, laadgrens_pct: 100, ontlaadgrens_pct: 10, pakketten: 2, storing: false, accus: [{ nr: 1, temp_c: 23, procent: 41 }] },
    omvormer: { stand: 'normaal', w: 1835, temp_c: 41.3 },
    dag: { ...rest.dag, gas_m3: undefined, water_m3: undefined },
    brug: { ...rest.brug, versie: '1.3.0+0c0ffee', meldingen: [] },
  };
})();

/** Brug 0.6.1 (dirk, nu): zonder accu's apart, zonder meterkast, zonder zon op/onder, zonder meldingen. */
const METING_061 = {
  net_w: 412,
  net_bron: 'homewizard',
  zon_w: 0,
  zonnen: [{ sleutel: 'hw-zon', naam: 'Zon', vermogen_w: 0 }],
  batterij_w: 640,
  batterij_procent: 57,
  batterij_info: { temp_c: 24.5, temp_min_c: 22, behuizing_c: 31, spanning_v: 51.8, laadgrens_pct: 100, ontlaadgrens_pct: 10, pakketten: 3, inhoud_kwh: 8.64, storing: false },
  apparaten: [{ sleutel: 'hw-spa', naam: 'Spa', soort: 'stekker', vermogen_w: 1372 }],
  bron: 'brug 0.6.1',
  gekoppeld: [{ sleutel: 'zendure', naam: 'Zendure', merk: 'Zendure', soort: 'SolarFlow 2400 AC', rol: 'batterij', manier: 'lokaal', adres: '172.16.0.30', ok: true, w: 640 }],
  brug: { versie: '0.6.1', gestart: '2026-10-31T06:00:00.000Z', elke_seconden: 5 },
};

async function opzet(gebruiker = DIRK, rijen = null) {
  return nepBase44({
    gebruiker,
    rijen: rijen ?? {
      Huis: [{ id: 'huis-dirk001', naam: 'Bij Dirk', eigenaar_id: TIM.id, eigenaar_email: TIM.email, leden: [{ email: DIRK.email }], brug_sleutel_hash: await sha256Hex(SLEUTEL) }],
      Meting: [],
    },
  });
}

const stuur = (nep, meting) =>
  behandelMeting(verzoek(meting, { kop: { 'x-brug-sleutel': SLEUTEL } }), () => nep.client, { nu: () => NU, geheugen: new Map(), dagGeheugen: new Map(), geduld: zonderWachten });
const vraag = async (nep, lichaam) => {
  const res = await behandelHuis(verzoek(lichaam, { kop: { Authorization: 'Bearer x' } }), () => nep.client, { geduld: zonderWachten, geheugen: new Map() });
  return { status: res.status, data: await res.json() };
};

describe('brug 1.4.0 met de functie die nu live staat', () => {
  it('neemt de meting aan; wat hij niet kent valt stil weg, niets overgeslagen', () => {
    const uit = controleerLive(JSON.parse(JSON.stringify(METING_140)), NU);
    expect(uit.ok).toBe(true);
    expect(uit.overgeslagen).toEqual([]);
    expect(uit.meting).not.toHaveProperty('meterkast');
    expect(uit.meting).not.toHaveProperty('kennis');
    expect(uit.meting.batterij_info).not.toHaveProperty('cel_min_v');
    expect(uit.meting.batterij_info.accus[0]).toEqual({ nr: 1, temp_c: 23, procent: 41 });
    expect(uit.meting.omvormer).toEqual({ stand: 'normaal', w: 1835, temp_c: 41.3 });
    expect(uit.meting.dag).not.toHaveProperty('gas_m3');
    // De melding over de isolatie komt er wel door (soort omvormer): in de app en het Logboek.
    expect(uit.meting.brug.meldingen[0]).toMatchObject({ soort: 'omvormer' });
  });
});

describe('brug 1.4.0 met de nieuwe functie en site', () => {
  it("ontvangMeting bewaart alles; 'stand' geeft de meterkast maar niet de kennislijst; de site toont het in woorden", async () => {
    const nep = await opzet();
    const res = await stuur(nep, METING_140);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const rij = nep.tabellen.Meting.lijst[0];
    expect(rij.kennis.apparaten[1].velden).toEqual(['electricLevel=57', 'sn', 'deviceId', 'packData[].maxVol=328']);
    expect(rij.kennis.op).toBe(NU.toISOString());
    // De dag krijgt het gas en het water (eerste schrijfactie van de dag meteen).
    expect(nep.tabellen.Dag.lijst[0]).toMatchObject({ gas_m3: 1.234, water_m3: 0.12 });
    // De melding van de omvormer staat in het Logboek: één create.
    expect(nep.tabellen.Gebeurtenis.lijst.map((g) => g.wat)).toEqual([METING_140.brug.meldingen[0].tekst]);

    const st = await vraag(nep, { actie: 'stand', huis_id: 'huis-dirk001' });
    expect(st.status).toBe(200);
    expect(st.data.meting).not.toHaveProperty('kennis');
    expect(JSON.stringify(st.data)).not.toMatch(/electricLevel|wifi_ssid/);
    const stand = standUitRij(st.data.meting);
    expect(meterkastRegels(stand.meterkast, { dynamisch: true }).map((r) => r.tekst.replace(/\u00a0/g, ' '))).toEqual(['Gas vandaag 1,23 m³', 'Water vandaag 0,12 m³']);
    expect(stand.dag.gasM3).toBe(1.234);
    const omvormer = omvormerRegels(stand.omvormer);
    expect(omvormer.find((r) => r.sleutel === 'isolatie')).toMatchObject({ letOp: true });
    const batterij = batterijRegels(stand.batterij_info).map((r) => [r.tekst, r.bij ?? ''].join(' | ').replace(/\u00a0/g, ' '));
    expect(batterij).toContain('Accu 1 · 23 °C · 41% | cellen 3,26–3,28 V · 152 laadcycli · verwarmt zich nu');
    expect(batterij).toContain('Laadt hooguit 2.300 W · levert hooguit 800 W | ingesteld in de Zendure-app');
  });

  it('de kennislijst alleen voor de beheerder (overzicht); een gewone gebruiker of kijker krijgt 403', async () => {
    const nep = await opzet();
    await stuur(nep, METING_140);
    const rijen = { Huis: nep.tabellen.Huis.lijst, Meting: nep.tabellen.Meting.lijst };
    const dirk = await vraag(await opzet(DIRK, rijen), { actie: 'overzicht' });
    expect(dirk.status).toBe(403);
    expect(JSON.stringify(dirk.data)).not.toMatch(/electricLevel/);
    const tim = await vraag(await opzet(TIM, rijen), { actie: 'overzicht' });
    expect(tim.status).toBe(200);
    expect(tim.data.huizen[0].meting.kennis).toEqual({
      op: NU.toISOString(),
      apparaten: [
        { sleutel: 'hw-meterkast', soort: 'HomeWizard P1-meter (v2)', datum: '2026-10-31', velden: ['active_tariff=1', 'total_gas_m3=2569.646', 'unique_id', 'wifi_ssid'] },
        { sleutel: 'zendure', soort: 'SolarFlow 2400 AC', datum: '2026-10-31', velden: ['electricLevel=57', 'sn', 'deviceId', 'packData[].maxVol=328'] },
      ],
    });
  });

  it('een meting zonder kennislijst laat de vorige staan (die komt maar eens per dag)', async () => {
    const nep = await opzet();
    await stuur(nep, METING_140);
    const zonder = Object.fromEntries(Object.entries(METING_140).filter(([veld]) => veld !== 'kennis'));
    const res = await behandelMeting(verzoek(zonder, { kop: { 'x-brug-sleutel': SLEUTEL } }), () => nep.client, {
      nu: () => new Date(NU.getTime() + 5000),
      geheugen: new Map(),
      dagGeheugen: new Map(),
      geduld: zonderWachten,
    });
    expect(res.status).toBe(200);
    expect(nep.tabellen.Meting.lijst[0].kennis.apparaten).toHaveLength(2);
  });
});

describe('een oudere brug met de nieuwe functie en site', () => {
  it('brug 1.3.0: aangenomen; geen meterkast, dus geen kaart; de batterij en omvormer zoals eerst', async () => {
    const nep = await opzet();
    const res = await stuur(nep, JSON.parse(JSON.stringify(METING_130)));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const st = await vraag(nep, { actie: 'stand', huis_id: 'huis-dirk001' });
    const stand = standUitRij(st.data.meting);
    expect(stand.meterkast).toBeNull();
    expect(meterkastRegels(stand.meterkast)).toEqual([]);
    expect(stand.dag.gasM3).toBeNull();
    expect(nep.tabellen.Dag.lijst[0]).not.toHaveProperty('gas_m3');
    expect(omvormerRegels(stand.omvormer).map((r) => r.sleutel)).toEqual(['temperatuur', 'stand']);
    expect(nep.tabellen.Meting.lijst[0]).not.toHaveProperty('kennis');
  });

  it('brug 0.6.1 (dirk, nu): aangenomen; geen meterkast en geen gas van de meter, wel het gas uit zelf ingevulde standen', async () => {
    const nep = await opzet(TIM);
    const res = await stuur(nep, JSON.parse(JSON.stringify(METING_061)));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const rij = nep.tabellen.Meting.lijst[0];
    expect(rij).not.toHaveProperty('kennis');
    expect(rij.meterkast).toBeNull();
    const st = await vraag(nep, { actie: 'stand', huis_id: 'huis-dirk001' });
    expect(st.status).toBe(200);
    const stand = standUitRij(st.data.meting);
    expect(stand.meterkast).toBeNull();
    expect(stand.batterij_info.accus ?? []).toEqual([]);
    expect(batterijRegels(stand.batterij_info).map((r) => r.sleutel)).not.toContain('cellen');
    // Dirk vult zelf twee standen in (Instellingen › Gas, de eigenaar; hier de beheerder): Overzicht rekent er het gas uit.
    const een = await vraag(nep, { actie: 'gasStand', huis_id: 'huis-dirk001', stand: { datum: '2026-10-21', stand: 2500 } });
    expect(een.status).toBe(200);
    const twee = await vraag(nep, { actie: 'gasStand', huis_id: 'huis-dirk001', stand: { datum: '2026-10-31', stand: 2520 } });
    expect(twee.data.gas_standen).toHaveLength(2);
    const dagen = dagenUit(nep.tabellen.Dag.lijst);
    expect(dagen.every((d) => d.gas === null)).toBe(true);
    const week = gasVoorPeriode(dagen, twee.data.gas_standen, { van: '2026-10-26', tot: '2026-11-01' });
    expect(week).toMatchObject({ bron: 'standen' });
    // 26 t/m 30 oktober: vijf dagen van 2 m³ (20 m³ over tien dagen); de 31e heeft nog geen volgende stand.
    expect(week.totaal).toBeCloseTo(10, 6);
  });

  it('controleerMeting: een rare meterkast of kennislijst valt weg, de meting niet', () => {
    const uit = controleerMeting(
      {
        net_w: 1,
        meterkast: { tarief: 7, meters: [{ soort: 'olie', stand: 5, eenheid: 'l' }, { soort: 'gas', stand: -1, eenheid: 'm3' }, 'x'] },
        kennis: { apparaten: [{ sleutel: 'x y', velden: ['a'] }, { sleutel: 'ok', velden: [12, 'naam met spatie', 'a=1e5'] }] },
        dag: { ...METING_140.dag, gas_m3: -3, water_m3: 'veel' },
        omvormer: { stand: 'normaal', isolatie_kohm: -5, lekstroom_ma: 99999, pf: 3 },
      },
      NU,
    );
    expect(uit.ok).toBe(true);
    expect(uit.meting.meterkast).toBeNull();
    expect(uit.meting).not.toHaveProperty('kennis');
    expect(uit.meting.dag).not.toHaveProperty('gas_m3');
    expect(uit.meting.dag).not.toHaveProperty('water_m3');
    expect(uit.meting.omvormer).toEqual({ stand: 'normaal' });
  });
});
