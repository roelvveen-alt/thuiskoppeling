/**
 * Programmaatje 1.4.0: de meterkast (tarief, piek, gas, water, warmte) uit de
 * HomeWizard P1-meter, gas per dag (dag.mjs), en de kennislijst (kennis.mjs).
 * De voorbeelden komen uit api-documentation.homewizard.com (v1 /api/v1/data en
 * v2 /api/measurement, "HWE-P1 (3-phase, with gas and water meter)").
 */
import { describe, expect, it } from 'vitest';
import { dagVoorApp, logMeting, meterkastMetVandaag, metersVandaag } from './dag.mjs';
import { lezingUit, meterkastUit, meterkastZinnen, meterTijd } from './homewizard.mjs';
import { binnenGrens, GROOT_GETAL, HOOGSTENS_KENNIS_TEKENS, isIdentiteit, kennisVolger, veldenVan, veldRegel } from './kennis.mjs';

/** Uit de documentatie van HomeWizard (v1), met de wifinaam en ids zoals daar. */
const V1_MET_GAS = {
  wifi_ssid: 'My Wi-Fi',
  wifi_strength: 100,
  smr_version: 50,
  meter_model: 'ISKRA 2M550T-101',
  unique_id: '00112233445566778899AABBCCDDEEFF',
  active_tariff: 2,
  total_power_import_kwh: 13779.338,
  total_power_export_kwh: 0,
  active_power_w: -543,
  total_gas_m3: 2569.646,
  gas_timestamp: 210606140010,
  gas_unique_id: 'FFEEDDCCBBAA99887766554433221100',
  active_power_average_w: 123.0,
  montly_power_peak_w: 1111.0,
  montly_power_peak_timestamp: 230101080010,
  external: [
    { unique_id: 'FFEEDDCCBBAA99887766554433221100', type: 'gas_meter', timestamp: 210606140010, value: 2569.646, unit: 'm3' },
    { unique_id: 'ABCDEF0123456789ABCDEF0123456789', type: 'water_meter', timestamp: 210606140015, value: 123.456, unit: 'm3' },
  ],
};

/** Hetzelfde in v2: andere namen, tijden als tekst. */
const V2_MET_GAS = {
  unique_id: '00112233445566778899AABBCCDDEEFF',
  tariff: 1,
  power_w: -543,
  average_power_15m_w: 200,
  external: [
    { unique_id: 'FFEE', type: 'gas_meter', timestamp: '2026-10-31T14:05:00', value: 2600.5, unit: 'm3' },
    { unique_id: 'AB12', type: 'heat_meter', timestamp: '2026-10-31T14:00:00', value: 12.345, unit: 'GJ' },
    { unique_id: 'CD34', type: 'iets_nieuws', value: 1, unit: 'm3' },
  ],
};

describe('de tijd van de slimme meter', () => {
  it('v1 als getal JJMMDDuummss en v2 als tekst, in Nederlandse tijd, naar UTC', () => {
    expect(meterTijd(210606140010)).toBe('2021-06-06T12:00:10.000Z');
    expect(meterTijd(261231235959)).toBe('2026-12-31T22:59:59.000Z');
    expect(meterTijd('2026-10-31T14:05:00')).toBe('2026-10-31T13:05:00.000Z');
    // Het dubbele uur bij het terugzetten van de klok: het eerste.
    expect(meterTijd(261025023000)).toBe('2026-10-25T00:30:00.000Z');
    for (const fout of [null, 0, 'gisteren', 211306140010, '2026-10-31 14:05', 1.5]) expect(meterTijd(fout)).toBeNull();
  });
});

describe('de meterkast uit de P1-meter (meterkastUit)', () => {
  it('v1: tarief, kwartiergemiddelde, maandpiek en gas en water uit external, zonder ids of wifinaam', () => {
    const uit = meterkastUit(V1_MET_GAS);
    expect(uit).toEqual({
      tarief: 2,
      gemiddeld_w: 123,
      maandpiek_w: 1111,
      maandpiek_op: '2023-01-01T07:00:10.000Z',
      meters: [
        { soort: 'gas', stand: 2569.646, eenheid: 'm3', op: '2021-06-06T12:00:10.000Z' },
        { soort: 'water', stand: 123.456, eenheid: 'm3', op: '2021-06-06T12:00:15.000Z' },
      ],
    });
    expect(JSON.stringify(uit)).not.toMatch(/FFEE|0011|ABCDEF|Wi-Fi|ISKRA/);
  });

  it('v1 zonder external: total_gas_m3 als gasmeter', () => {
    const { external, ...zonder } = V1_MET_GAS;
    expect(external).toHaveLength(2);
    expect(meterkastUit(zonder).meters).toEqual([{ soort: 'gas', stand: 2569.646, eenheid: 'm3', op: '2021-06-06T12:00:10.000Z' }]);
  });

  it('v2: tariff en average_power_15m_w; warmte in GJ; een onbekende soort valt weg', () => {
    expect(meterkastUit(V2_MET_GAS)).toEqual({
      tarief: 1,
      gemiddeld_w: 200,
      meters: [
        { soort: 'gas', stand: 2600.5, eenheid: 'm3', op: '2026-10-31T13:05:00.000Z' },
        { soort: 'warmte', stand: 12.345, eenheid: 'GJ', op: '2026-10-31T13:00:00.000Z' },
      ],
    });
  });

  it('een kWh-meter of rare waarden: niets', () => {
    expect(meterkastUit({ active_power_w: 12, total_power_import_kwh: 3 })).toBeNull();
    expect(meterkastUit({ active_tariff: 9, total_gas_m3: -1, external: [{ type: 'gas_meter', value: 'veel', unit: 'm3' }] })).toBeNull();
    expect(meterkastUit(null)).toBeNull();
  });

  it('elke lezing geeft de meterkast en een kennislijst (als functie: het antwoord zelf gaat nooit in JSON)', () => {
    const lezing = lezingUit(V1_MET_GAS);
    expect(lezing.meterkast.tarief).toBe(2);
    expect(JSON.stringify(lezing)).not.toMatch(/0011|Wi-Fi/);
    expect(lezing.kennis()).toContain('active_tariff=2');
  });

  it('in gewone woorden voor proef', () => {
    expect(meterkastZinnen(meterkastMetVandaag(meterkastUit(V1_MET_GAS), { meters: { gas: { begin: 2568.4, laatst: 2569.646 } } }))).toEqual([
      'de slimme meter telt nu op normaal tarief',
      'gemiddeld dit kwartier 123 W',
      'hoogste kwartier deze maand 1.111 W',
      'gasmeter: stand 2.569,646 m³ (14:00), vandaag 1,246 m³',
      'watermeter: stand 123,456 m³ (14:00)',
    ]);
    expect(meterkastZinnen(null)).toEqual([]);
  });
});

describe('gas, water en warmte per dag (dag.mjs)', () => {
  const OCHTEND = Date.UTC(2026, 9, 31, 7); // 08:00 in Nederland
  const meting = (gas, water = null) => ({
    net_w: 100,
    meterkast: { meters: [{ soort: 'gas', stand: gas, eenheid: 'm3' }, ...(water === null ? [] : [{ soort: 'water', stand: water, eenheid: 'm3' }])] },
  });

  it('wat er sinds de eerste stand van vandaag bij kwam; morgen begint bij de laatste stand van vandaag', () => {
    let l = logMeting(null, meting(2569.0, 100), OCHTEND);
    l = logMeting(l, meting(2569.5, 100.12), OCHTEND + 5000);
    l = logMeting(l, meting(2570.25, 100.2), OCHTEND + 10_000);
    expect(dagVoorApp(l)).toMatchObject({ gas_m3: 1.25, water_m3: 0.2 });
    // Na middernacht: het begin is de laatste stand van gisteren, dus niets verloren.
    const morgen = Date.UTC(2026, 10, 1, 0);
    l = logMeting(l, meting(2570.4), morgen);
    expect(l.datum).toBe('2026-11-01');
    expect(metersVandaag(l.meters)).toEqual({ gas_m3: 0.15, water_m3: 0 });
  });

  it('een sprong terug of te ver vooruit (een nieuwe meter) telt niet, wat er al was blijft', () => {
    let l = logMeting(null, meting(2569.0), OCHTEND);
    l = logMeting(l, meting(2570.0), OCHTEND + 5000);
    l = logMeting(l, meting(12.0), OCHTEND + 10_000);
    l = logMeting(l, meting(12.5), OCHTEND + 15_000);
    l = logMeting(l, meting(912.5), OCHTEND + 20_000);
    expect(dagVoorApp(l).gas_m3).toBe(1.5);
  });

  it('zonder gasmeter (zoals nu) niets: geen gas_m3 in de dag', () => {
    const l = logMeting(null, { net_w: 100 }, OCHTEND);
    expect(dagVoorApp(l)).not.toHaveProperty('gas_m3');
    expect(meterkastMetVandaag(null, l)).toBeNull();
    // Een vandaag.json van een oudere versie (zonder meters) werkt gewoon door.
    const oud = { ...logMeting(null, { net_w: 1 }, OCHTEND) };
    delete oud.meters;
    expect(dagVoorApp(logMeting(oud, meting(5), OCHTEND + 5000))).toMatchObject({ gas_m3: 0 });
  });

  it('een andere eenheid dan verwacht telt niet mee per dag (wel als stand)', () => {
    const l = logMeting(null, { net_w: 1, meterkast: { meters: [{ soort: 'warmte', stand: 3, eenheid: 'kWh' }] } }, OCHTEND);
    expect(dagVoorApp(l)).not.toHaveProperty('warmte_gj');
  });
});

describe('de kennislijst (kennis.mjs)', () => {
  it('alleen namen, en een getal alleen als het niets herkenbaars is', () => {
    const velden = veldenVan({ ...V1_MET_GAS, sn: 'FO4N123', deviceId: 123, mac: 'aa:bb', ip: '192.168.1.2', token: 'geheim', properties: { packData: [{ sn: 'X', maxVol: 340 }] } });
    expect(velden).toEqual(
      expect.arrayContaining(['active_tariff=2', 'total_gas_m3=2569.646', 'wifi_ssid', 'unique_id', 'external[].unique_id', 'external[].value=2569.646', 'sn', 'deviceId', 'properties.packData[].maxVol=340', 'gas_timestamp']),
    );
    const tekst = velden.join(' ');
    expect(tekst).not.toMatch(/My Wi-Fi|0011|FFEE|FO4N|aa:bb|192\.168|geheim|ISKRA/);
    expect(velden.every((v) => !v.includes('=') || !isIdentiteit(v.split('=')[0]))).toBe(true);
  });

  it('wat herkenbaar is (ook verstopt in een naam), en grote getallen (tijd, id), zonder waarde', () => {
    for (const naam of ['sn', 'serialNumber', 'deviceKey', 'productKey', 'wifiSsid', 'mac', 'ipAddr', 'unique_gas_id', 'appKey', 'host', 'email']) expect(isIdentiteit(naam)).toBe(true);
    for (const naam of ['electricLevel', 'active_power_w', 'socSet', 'maxVol', 'r30140']) expect(isIdentiteit(naam)).toBe(false);
    expect(veldRegel('timestamp', GROOT_GETAL + 1)).toBe('timestamp');
    expect(veldRegel('deviceId', 5)).toBe('deviceId');
    expect(veldRegel('x y', 5)).toBeNull();
  });

  it('per apparaat hooguit eens per dag een nieuwe lijst; het blok alleen als er iets nieuws is', () => {
    const k = kennisVolger();
    const ochtend = Date.UTC(2026, 9, 31, 7);
    let keer = 0;
    k.zie('hw-meterkast', 'HomeWizard P1-meter (v1)', () => (keer += 1) && ['a=1'], ochtend);
    k.zie('hw-meterkast', 'HomeWizard P1-meter (v1)', () => (keer += 1) && ['a=2'], ochtend + 60_000);
    expect(keer).toBe(1);
    expect(k.blok()).toEqual({ apparaten: [{ sleutel: 'hw-meterkast', soort: 'HomeWizard P1-meter (v1)', datum: '2026-10-31', velden: ['a=1'] }] });
    k.verstuurd();
    expect(k.blok()).toBeNull();
    // De omvormer wordt later wakker: dan alles samen nog eens (de app bewaart de laatste set).
    k.zie('goodwe', 'GoodWe GW8K-DT', () => ['r30140=9850'], ochtend + 3_600_000);
    expect(k.blok().apparaten.map((a) => a.sleutel)).toEqual(['hw-meterkast', 'goodwe']);
    // Een lege lijst of een fout: niets.
    k.zie('zendure', 'Zendure', () => [], ochtend);
    k.zie('tuya', 'Tuya', () => {
      throw new Error('kapot');
    }, ochtend);
    expect(k.blok().apparaten).toHaveLength(2);
  });

  it('nooit groter dan HOOGSTENS_KENNIS_TEKENS: van het apparaat met de meeste velden gaan de laatste eraf', () => {
    const k = kennisVolger();
    const ochtend = Date.UTC(2026, 9, 31, 7);
    const veel = (voor, n) => Array.from({ length: n }, (_, i) => `${voor}.een_heel_lange_veldnaam_nummer_${String(i).padStart(3, '0')}=123456.789`);
    for (let i = 0; i < 4; i++) k.zie(`apparaat-${i}`, 'Iets', () => veel(`a${i}`, i === 0 ? 160 : 20), ochtend);
    const blok = k.blok();
    expect(JSON.stringify(blok).length).toBeLessThanOrEqual(HOOGSTENS_KENNIS_TEKENS);
    expect(blok.apparaten).toHaveLength(4);
    // Het grote apparaat leverde in, de kleine niet.
    expect(blok.apparaten[0].velden.length).toBeLessThan(160);
    expect(blok.apparaten[1].velden).toHaveLength(20);
    // Wat de volger onthoudt blijft heel (de volgende dag opnieuw).
    expect(binnenGrens({ apparaten: [{ velden: ['a'] }] }, 1).apparaten[0].velden).toEqual(['a']);
  });
});
