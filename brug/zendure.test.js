import { describe, expect, it } from 'vitest';
import { controleerMeting } from '../base44/functions/ontvangMeting/controle.js';
import { controleerMeting as controleerLive } from '../base44/tests/oudeFunctie/controle.js';
import { batterijInfoUit as siteBatterijInfo } from '../src/lib/bron.js';
import { cloudsleutelFout, ZENDURE_DOMEINEN as SITE_DOMEINEN } from '../src/lib/opAfstand.js';
import { HOOGSTENS_TEKENS } from './versturen.mjs';
import {
  accuLijst,
  accuInhoudKwh,
  ACCUS_PER_APPARAAT,
  HOOGSTENS_ACCU_REGELS,
  celVolt,
  cycliUit,
  batterijInfoUit,
  batterijZinnen,
  berichtVan,
  duurTekst,
  graden,
  grenzenUit,
  int16,
  isZendureAdres,
  leesZendureLokaal,
  leesCloudsleutel,
  ondertekening,
  p1Uit,
  RESERVE_LOSLATEN_MS,
  samenInfo,
  serverUit,
  standUitEigenschappen,
  telOp,
  verwerkBericht,
  ZENDURE_DOMEINEN,
  zendureMetReserve,
} from './zendure.mjs';

describe('Zendure P1-meter', () => {
  it('het totaal uit /properties/report; een batterij of iets anders is geen P1-meter', () => {
    expect(p1Uit({ timestamp: 1798000000, deviceId: 'abc123', a_aprt_power: 100, b_aprt_power: 200, c_aprt_power: 300, total_power: -600 })).toBe(-600);
    expect(p1Uit({ sn: 'HOA1', product: 'solarFlow2400AC', properties: { electricLevel: 50 } })).toBeNull();
    expect(p1Uit({ total_power: '600' })).toBeNull();
    expect(p1Uit(null)).toBeNull();
  });
});

describe('eigenschappen', () => {
  it('met eigen panelen en zon: tellen aan de batterijkant; laden is min, leveren is plus', () => {
    expect(
      standUitEigenschappen({ solarInputPower: 820, outputPackPower: 400, packInputPower: 0, outputHomePower: 400, electricLevel: 63 }),
    ).toEqual({ zon_w: 820, batterij_w: -400, batterij_procent: 63, ac_w: 400 });
    expect(standUitEigenschappen({ packInputPower: 300, electricLevel: 40 })).toEqual({
      zon_w: null,
      batterij_w: 300,
      batterij_procent: 40,
      ac_w: null,
    });
  });

  it('SolarFlow 2400 AC (geen eigen panelen): de stopcontactkant is de batterij', () => {
    // Laden uit het huis: 2300 W erin, de batterij krijgt 2200 W (omzetverlies).
    expect(standUitEigenschappen({ gridInputPower: 2300, outputHomePower: 0, outputPackPower: 2200, electricLevel: 41 })).toEqual({
      zon_w: null,
      batterij_w: -2300,
      batterij_procent: 41,
      ac_w: -2300,
    });
    // Leveren aan het huis.
    expect(standUitEigenschappen({ solarInputPower: 0, outputHomePower: 760, packInputPower: 800, electricLevel: 70 })).toMatchObject({
      batterij_w: 760,
      ac_w: 760,
    });
  });

  it('een 2400 AC heeft geen eigen panelen: zijn zon van 0 W telt niet als zonnebron', () => {
    const ac = { solarInputPower: 0, outputHomePower: 1700, packInputPower: 1750, electricLevel: 47 };
    expect(standUitEigenschappen(ac, { product: 'solarFlow2400AC' })).toEqual({ zon_w: null, batterij_w: 1700, batterij_procent: 47, ac_w: 1700 });
    expect(standUitEigenschappen(ac, { product: 'SolarFlow 2400 AC' }).zon_w).toBeNull();
    // Meldt hij toch zon, dan telt die wel; een Zendure met panelen houdt zijn 0 W.
    expect(standUitEigenschappen({ ...ac, solarInputPower: 300 }, { product: 'solarFlow2400AC' }).zon_w).toBe(300);
    expect(standUitEigenschappen(ac, { product: 'Hyper 2000' }).zon_w).toBe(0);
    expect(standUitEigenschappen(ac).zon_w).toBe(0);
  });

  it('zonder batterijgegevens: null, niet 0', () => {
    expect(standUitEigenschappen({ solarInputPower: 10 })).toEqual({ zon_w: 10, batterij_w: null, batterij_procent: null, ac_w: null });
    expect(standUitEigenschappen(undefined)).toEqual({ zon_w: null, batterij_w: null, batterij_procent: null, ac_w: null });
  });

  it('twee apparaten: optellen en de vulling middelen', () => {
    expect(
      telOp([
        { zon_w: 400, batterij_w: -200, batterij_procent: 60, ac_w: 200 },
        { zon_w: null, batterij_w: 100, batterij_procent: 81, ac_w: 100 },
      ]),
    ).toEqual({ zon_w: 400, batterij_w: -100, batterij_procent: 71, ac_w: 300 });
  });
});

describe('cloudsleutel', () => {
  it('base64 van "<adres>.<appKey>", gesplitst bij de laatste punt', () => {
    const sleutel = Buffer.from('https://app.zendure.tech/eu.abc123XYZ').toString('base64');
    expect(leesCloudsleutel(` ${sleutel} `)).toEqual({ adres: 'https://app.zendure.tech/eu', appKey: 'abc123XYZ' });
  });

  it('alleen naar de Zendure-cloud (0.13.0): geen http, geen ander adres, niets in het eigen wifi', () => {
    const b64 = (t) => Buffer.from(t).toString('base64');
    for (const adres of ['http://app.zendure.tech/eu', 'http://192.168.1.1', 'https://192.168.1.1', 'http://aanvaller.example:8080', 'https://evil.example/x', 'https://zendure.tech.evil.example', 'https://evilzendure.tech', 'https://app.zendure.tech:8443/eu', 'https://ik@app.zendure.tech/eu']) {
      expect(() => leesCloudsleutel(b64(`${adres}.abc123`)), adres).toThrow(/wijst niet naar Zendure/);
      expect(cloudsleutelFout(b64(`${adres}.abc123XYZ0`)), adres).toMatch(/wijst niet naar Zendure/);
    }
    for (const adres of ['https://app.zendure.tech/eu', 'https://app.zendure.tech/v2', 'https://zendure.com', 'https://app.zendure.cn/cn', 'https://APP.ZENDURE.TECH:443/eu']) {
      expect(isZendureAdres(adres), adres).toBe(true);
      expect(cloudsleutelFout(b64(`${adres}.abc123XYZ0`)), adres).toBeNull();
    }
    expect(SITE_DOMEINEN).toEqual(ZENDURE_DOMEINEN);
  });

  it('rommel geeft een fout in gewone woorden', () => {
    expect(() => leesCloudsleutel('geen sleutel')).toThrow(/Autorisatiecloudsleutel/);
    expect(() => leesCloudsleutel(Buffer.from('zonderpunt').toString('base64'))).toThrow(/Autorisatiecloudsleutel/);
  });

  it('ondertekening zoals Zendure-HA (zelfde uitkomst als hun Python)', () => {
    expect(ondertekening('testAppKey123', 1700000000, '12345')).toBe('B1BC5D770F3BCCF86519F9DB074ED61353902C34');
  });
});

describe('berichten', () => {
  it('server en poort', () => {
    expect(serverUit('mqtt.voorbeeld.com:1883')).toEqual({ host: 'mqtt.voorbeeld.com', poort: 1883 });
    expect(serverUit('mqtt.voorbeeld.com')).toEqual({ host: 'mqtt.voorbeeld.com', poort: 1883 });
    expect(serverUit('mqtt://mqtt.voorbeeld.com:8883')).toEqual({ host: 'mqtt.voorbeeld.com', poort: 8883 });
  });

  it('onderwerp naar apparaat en soort, met en zonder iot/', () => {
    expect(berichtVan('/pk1/dk1/properties/report')).toEqual({ deviceKey: 'dk1', soort: 'properties/report' });
    expect(berichtVan('iot/pk1/dk1/properties/report')).toEqual({ deviceKey: 'dk1', soort: 'properties/report' });
    expect(berichtVan('iot/pk1')).toBeNull();
  });

  it('nieuwe eigenschappen over de oude; berichten van Home Assistant en rommel tellen niet', () => {
    const oud = { electricLevel: 60, solarInputPower: 300 };
    expect(verwerkBericht(oud, '{"properties":{"solarInputPower":350}}')).toEqual({ electricLevel: 60, solarInputPower: 350 });
    expect(verwerkBericht(oud, '{"isHA":true,"properties":{"solarInputPower":1}}')).toBe(oud);
    expect(verwerkBericht(oud, 'kapot')).toBe(oud);
    expect(verwerkBericht(oud, '{"packData":[]}')).toBe(oud);
  });
});

/**
 * Zo ziet /properties/report van een SolarFlow 2400 AC met twee accu's eruit
 * (de namen en eenheden uit zenSDK; serienummers verzonnen). 's Nachts laden:
 * 2300 W uit het huis, 2210 W in de accu's.
 */
const RAPPORT_2400AC = {
  timestamp: 1798000000,
  messageId: 7,
  sn: 'HOA1NAXXXXXXXXX',
  product: 'solarFlow2400AC',
  properties: {
    heatState: 0,
    packInputPower: 0,
    outputPackPower: 2210,
    outputHomePower: 0,
    gridInputPower: 2300,
    solarInputPower: 0,
    remainOutTime: 59940,
    packState: 1,
    packNum: 2,
    electricLevel: 41,
    socStatus: 0,
    hyperTmp: 3131,
    BatVolt: 5236,
    rssi: -58,
    is_error: 0,
    faultLevel: 0,
    socSet: 1000,
    minSoc: 100,
    inputLimit: 2300,
    outputLimit: 2400,
    acMode: 1,
  },
  packData: [
    { sn: 'FO4NXXXXXXXXXXX', packType: 300, socLevel: 41, state: 1, power: 1105, maxTemp: 2961, totalVol: 5236, batcur: 211, maxVol: 328, minVol: 326, softVersion: 4113, heatState: 0 },
    { sn: 'FO4NYYYYYYYYYYY', packType: 300, socLevel: 40, state: 1, power: 1105, maxTemp: 2986, totalVol: 5234, batcur: 211, maxVol: 328, minVol: 325, softVersion: 4113, heatState: 0 },
  ],
};
const metAccus = (rapport) => ({ ...rapport.properties, packData: rapport.packData });

describe('meer over de batterij (batterijInfoUit)', () => {
  it('een 2400 AC die laadt: temperaturen, spanning, stroom, grenzen, accu’s en hoe lang nog tot vol', () => {
    expect(batterijInfoUit(metAccus(RAPPORT_2400AC))).toEqual({
      temp_c: 25.5,
      temp_min_c: 23,
      behuizing_c: 40,
      spanning_v: 52.4,
      stroom_a: 42.2,
      laadgrens_pct: 100,
      ontlaadgrens_pct: 10,
      pakketten: 2,
      inhoud_kwh: 5.76,
      // Geen remainInputTime: geschat, 59% van 5,76 kWh met 2210 W.
      vol_over_min: 92,
      verwarmt: false,
      kalibreert: false,
      wifi_dbm: -58,
      storing: false,
      // 1.4.0: celspanningen (minVol en maxVol) en de ingestelde grenzen voor laden en leveren.
      cel_min_v: 3.25,
      cel_max_v: 3.28,
      invoer_limiet_w: 2300,
      uitvoer_limiet_w: 2400,
      accus: [
        { nr: 1, temp_c: 23, procent: 41, cel_min_v: 3.26, cel_max_v: 3.28 },
        { nr: 2, temp_c: 25.5, procent: 40, cel_min_v: 3.25, cel_max_v: 3.28 },
      ],
    });
  });

  it('per accu de temperatuur en hoe vol, op volgorde; drie accu’s zoals bij Tim en Dirk', () => {
    const derde = { ...RAPPORT_2400AC.packData[1], sn: 'FO4NZZZZZZZZZZZ', maxTemp: 2951, socLevel: 39 };
    const info = batterijInfoUit({ ...metAccus(RAPPORT_2400AC), packNum: 3, packData: [...RAPPORT_2400AC.packData, derde] });
    expect(info.accus).toEqual([
      { nr: 1, temp_c: 23, procent: 41, cel_min_v: 3.26, cel_max_v: 3.28 },
      { nr: 2, temp_c: 25.5, procent: 40, cel_min_v: 3.25, cel_max_v: 3.28 },
      { nr: 3, temp_c: 22, procent: 39, cel_min_v: 3.25, cel_max_v: 3.28 },
    ]);
    expect(info.pakketten).toBe(3);
    // Een accu zonder bruikbare temperatuur houdt zijn nummer; zonder alles valt hij weg.
    expect(accuLijst([{ maxTemp: 0, socLevel: 50 }, {}, { maxTemp: 2981 }])).toEqual([{ nr: 1, procent: 50 }, { nr: 3, temp_c: 25 }]);
    expect(accuLijst([{}])).toBeNull();
    // Per apparaat hooguit twaalf (een 2400 AC neemt er 6; meer gewoon tonen, niet omvallen).
    expect(accuLijst(Array.from({ length: 14 }, () => ({ maxTemp: 2961 })))).toHaveLength(12);
  });

  it('nooit een serienummer, ook niet van een accu', () => {
    const tekst = JSON.stringify(batterijInfoUit(metAccus(RAPPORT_2400AC)));
    expect(tekst).not.toMatch(/FO4N|HOA1|sn/);
  });

  it('bij ontladen: eerst wat de Zendure zelf zegt (remainOutTime), anders geschat tot de ontlaadgrens', () => {
    const leveren = { ...RAPPORT_2400AC.properties, outputPackPower: 0, gridInputPower: 0, packInputPower: 800, outputHomePower: 760, electricLevel: 70 };
    const zelf = batterijInfoUit({ ...leveren, remainOutTime: 490, packData: RAPPORT_2400AC.packData });
    expect(zelf).toMatchObject({ leeg_over_min: 490 });
    expect(zelf).not.toHaveProperty('vol_over_min');
    // 59940 (999 uur) betekent "weet ik niet": dan 60% van 5,76 kWh met 800 W.
    expect(batterijInfoUit({ ...leveren, packData: RAPPORT_2400AC.packData }).leeg_over_min).toBe(259);
    // Stil: geen tijd.
    const stil = batterijInfoUit({ ...leveren, packInputPower: 0, packData: RAPPORT_2400AC.packData });
    expect(stil).not.toHaveProperty('leeg_over_min');
    expect(stil).not.toHaveProperty('vol_over_min');
  });

  it('meldt hij zelf hoe lang laden nog duurt (remainInputTime), dan dat', () => {
    expect(batterijInfoUit({ ...metAccus(RAPPORT_2400AC), remainInputTime: 131 }).vol_over_min).toBe(131);
    // Al op de laadgrens: niets meer te laden.
    expect(batterijInfoUit({ ...metAccus(RAPPORT_2400AC), electricLevel: 100 })).not.toHaveProperty('vol_over_min');
  });

  it('een oudere Zendure (Hub 1200 via de cloud): grenzen in procenten, spanning van de accu’s, gezondheid', () => {
    const info = batterijInfoUit({
      electricLevel: 23,
      socSet: 80,
      minSoc: 10,
      packNum: 1,
      heatState: 0,
      outputPackPower: 58,
      packInputPower: 0,
      remainInputTime: 59940,
      packData: [{ sn: 'CO4FXXXXXXXXXXX', socLevel: 23, maxTemp: 2941, totalVol: 4900, soh: 996, heatState: 1 }],
    });
    expect(info).toEqual({
      temp_c: 21,
      spanning_v: 49,
      laadgrens_pct: 80,
      ontlaadgrens_pct: 10,
      pakketten: 1,
      inhoud_kwh: 1.92,
      // 57% van 1,92 kWh met 58 W: ruim 18 uur.
      vol_over_min: 1132,
      // Een accu die zichzelf verwarmt, telt.
      verwarmt: true,
      gezondheid_pct: 99.6,
      accus: [{ nr: 1, temp_c: 21, procent: 23, gezondheid_pct: 99.6, verwarmt: true }],
    });
  });

  it('1.4.0: celspanningen, laadcycli en de limieten; wat niet klopt valt weg', () => {
    const info = batterijInfoUit({
      inputLimit: 1200,
      outputLimit: 800,
      inverseMaxPower: 2400,
      packData: [
        { maxTemp: 2981, socLevel: 50, minVol: 3301, maxVol: 3340, cycleCount: 152 },
        { maxTemp: 2981, socLevel: 51, minVol: 329, maxVol: 333 },
        { maxTemp: 2981, socLevel: 52, minVol: 12, maxVol: 99999, cycle: -1 },
      ],
    });
    expect(info).toMatchObject({ cel_min_v: 3.29, cel_max_v: 3.34, invoer_limiet_w: 1200, uitvoer_limiet_w: 800, omvormer_max_w: 2400 });
    expect(info.accus[0]).toEqual({ nr: 1, temp_c: 25, procent: 50, cel_min_v: 3.301, cel_max_v: 3.34, cycli: 152 });
    expect(info.accus[1]).toEqual({ nr: 2, temp_c: 25, procent: 51, cel_min_v: 3.29, cel_max_v: 3.33 });
    expect(info.accus[2]).toEqual({ nr: 3, temp_c: 25, procent: 52 });
    expect(celVolt(0)).toBeNull();
    expect(cycliUit({ cycleTimes: 3.5 })).toBeNull();
    expect(batterijInfoUit({ inputLimit: -5, outputLimit: 50_000 })).toBeNull();
    expect(batterijZinnen(info)).toContain('laadt hooguit 1200 W uit het stopcontact, levert hooguit 800 W aan het huis');
    expect(batterijZinnen(info)).toContain('accu 1 · 25,0 °C · 50% · cellen 3,30–3,34 V · 152 laadcycli');
  });

  it('wat niet aannemelijk is, gaat niet mee; zonder iets: null', () => {
    expect(
      batterijInfoUit({
        hyperTmp: 0,
        BatVolt: 70000,
        rssi: 0,
        socSet: 5,
        minSoc: 30,
        packNum: 0,
        remainOutTime: 59940,
        packInputPower: 300,
        electricLevel: 140,
        packData: [{ maxTemp: 5000, batcur: 99999999999, totalVol: 512 }],
      }),
    ).toEqual({ pakketten: 1 });
    expect(batterijInfoUit({})).toBeNull();
    expect(batterijInfoUit(undefined)).toBeNull();
    expect(batterijInfoUit({ packData: 'kapot', hyperTmp: '3131' })).toBeNull();
  });

  it('een storing alleen bij is_error 1; faultLevel alleen dan, als niveau (bij Dirk stond hij op 2 zonder storing)', () => {
    expect(batterijInfoUit({ is_error: 1 })).toEqual({ storing: true });
    expect(batterijInfoUit({ is_error: 1, faultLevel: 2 })).toEqual({ storing: true, storing_niveau: 2 });
    expect(batterijInfoUit({ is_error: 0, faultLevel: 2 })).toEqual({ storing: false });
    expect(batterijInfoUit({ faultLevel: 2 })).toBeNull();
    expect(batterijInfoUit({ is_error: 0, faultLevel: 0 })).toEqual({ storing: false });
    expect(batterijInfoUit({ socStatus: 1 })).toEqual({ kalibreert: true });
  });

  it('een onbekende accu: geen inhoud en geen geschatte tijd (een half getal is erger dan geen getal)', () => {
    const vreemd = { ...metAccus(RAPPORT_2400AC), packData: [RAPPORT_2400AC.packData[0], { ...RAPPORT_2400AC.packData[1], sn: 'ZZ9XXXXXXXXXXXX' }] };
    const info = batterijInfoUit(vreemd);
    expect(info).not.toHaveProperty('inhoud_kwh');
    expect(info).not.toHaveProperty('vol_over_min');
    expect(info.pakketten).toBe(2);
    // packNum zegt drie, maar er kwamen er twee: ook dan geen inhoud.
    expect(batterijInfoUit({ ...metAccus(RAPPORT_2400AC), packNum: 3 })).not.toHaveProperty('inhoud_kwh');
  });
});

describe('omrekenen', () => {
  it('tienden van een kelvin naar °C', () => {
    expect(graden(3131)).toBe(40);
    expect(graden(2961)).toBe(23);
    expect(graden(2731)).toBe(0);
    expect(graden(2581)).toBe(-15);
    expect(graden(0)).toBeNull();
    expect(graden(4000)).toBeNull();
    expect(graden(null)).toBeNull();
  });

  it('16 bits met teken, ook als 32 bits', () => {
    expect(int16(211)).toBe(211);
    expect(int16(65510)).toBe(-26);
    expect(int16(-26)).toBe(-26);
    expect(int16(4294967270)).toBe(-26);
    expect(int16(70000)).toBeNull();
  });

  it('grenzen: tienden van een procent (2400 AC) of procenten (ouder); socSet zegt welke', () => {
    expect(grenzenUit({ socSet: 1000, minSoc: 100 })).toEqual({ laad: 100, ontlaad: 10 });
    expect(grenzenUit({ socSet: 900, minSoc: 50 })).toEqual({ laad: 90, ontlaad: 5 });
    expect(grenzenUit({ socSet: 80, minSoc: 10 })).toEqual({ laad: 80, ontlaad: 10 });
    expect(grenzenUit({ minSoc: 200 })).toEqual({ laad: null, ontlaad: 20 });
    // Zonder socSet is 30 niet te zeggen: 3% of 30%?
    expect(grenzenUit({ minSoc: 30 })).toEqual({ laad: null, ontlaad: null });
    expect(grenzenUit({ socSet: 1000, minSoc: 900 })).toEqual({ laad: 100, ontlaad: null });
    expect(grenzenUit({ socSet: 40 })).toEqual({ laad: null, ontlaad: null });
  });

  it('inhoud per soort accu, zoals de Home Assistant-koppeling van Zendure', () => {
    expect(accuInhoudKwh('FO4NXXXX')).toBe(2.88);
    expect(accuInhoudKwh('CO4EXXXX')).toBe(1.92);
    expect(accuInhoudKwh('JO4AXXXX')).toBe(2.4);
    expect(accuInhoudKwh('BO4XXXXX', 70)).toBe(8);
    expect(accuInhoudKwh('BO4XXXXX')).toBe(0.96);
    expect(accuInhoudKwh('XYZ')).toBeNull();
    expect(accuInhoudKwh(undefined)).toBeNull();
  });
});

describe('meer Zendures samen (cloud)', () => {
  it('de warmste en de koelste, het zwakste wifi, alles tot vol; spanning en stroom niet', () => {
    const samen = samenInfo([
      { temp_c: 25.5, temp_min_c: 23, behuizing_c: 40, spanning_v: 52.4, stroom_a: 42.2, laadgrens_pct: 100, ontlaadgrens_pct: 10, vol_over_min: 92, verwarmt: false, wifi_dbm: -58, pakketten: 2, inhoud_kwh: 5.76, storing: false },
      { temp_c: 19, behuizing_c: 31, spanning_v: 51.1, laadgrens_pct: 100, ontlaadgrens_pct: 20, vol_over_min: 140, verwarmt: true, wifi_dbm: -71, pakketten: 1, storing: true, storing_niveau: 1 },
    ]);
    expect(samen).toEqual({
      temp_c: 25.5,
      temp_min_c: 19,
      behuizing_c: 40,
      laadgrens_pct: 100,
      vol_over_min: 140,
      verwarmt: true,
      storing: true,
      storing_niveau: 1,
      wifi_dbm: -71,
      pakketten: 3,
    });
    expect(samenInfo([{ temp_c: 20 }, null])).toEqual({ temp_c: 20 });
    // De accu's van twee Zendures achter elkaar, doorgenummerd.
    expect(
      samenInfo([
        { pakketten: 2, accus: [{ nr: 1, temp_c: 23 }, { nr: 2, temp_c: 25 }] },
        { pakketten: 1, accus: [{ nr: 1, temp_c: 19, procent: 80 }] },
      ]).accus,
    ).toEqual([{ nr: 1, temp_c: 23 }, { nr: 2, temp_c: 25 }, { nr: 3, temp_c: 19, procent: 80 }]);
    expect(samenInfo([null, null])).toBeNull();
    expect(samenInfo([])).toBeNull();
  });
});

describe('in gewone woorden (proef)', () => {
  it('hoe lang nog, afgerond zoals je het zegt', () => {
    expect(duurTekst(7)).toBe('ongeveer 7 min');
    expect(duurTekst(47)).toBe('ongeveer 45 min');
    expect(duurTekst(58)).toBe('ongeveer 1 uur');
    expect(duurTekst(92)).toBe('ongeveer 1 uur 30 min');
    expect(duurTekst(130)).toBe('ongeveer 2 uur 10 min');
    expect(duurTekst(299)).toBe('ongeveer 5 uur');
    expect(duurTekst(490)).toBe('ongeveer 8 uur');
    expect(duurTekst(3000)).toBe('meer dan twee dagen');
    expect(duurTekst(0)).toBe('');
  });

  it('de regels voor de 2400 AC', () => {
    expect(batterijZinnen(batterijInfoUit(metAccus(RAPPORT_2400AC)))).toEqual([
      "temperatuur: accu's 23,0 tot 25,5 °C, binnenin de Zendure 40,0 °C",
      'accu 1 · 23,0 °C · 41% · cellen 3,26–3,28 V',
      'accu 2 · 25,5 °C · 40% · cellen 3,25–3,28 V',
      'celspanning 3,25 tot 3,28 V',
      'laadt hooguit 2300 W uit het stopcontact, levert hooguit 2400 W aan het huis',
      'spanning 52,4 V, stroom 42,2 A',
      'laadt tot 100%, ontlaadt tot 10%',
      'vol over ongeveer 1 uur 30 min',
      'verwarmt zichzelf niet',
      'wifi-signaal goed (-58 dBm)',
      "2 accu's, samen 5,76 kWh",
      'geen storing',
    ]);
    expect(batterijZinnen({ storing: true, storing_niveau: 2, temp_c: 4 })).toEqual(['temperatuur: accu 4,0 °C', 'meldt een storing (niveau 2)']);
    expect(batterijZinnen(null)).toEqual(['geen extra gegevens van de batterij (temperatuur e.d.)']);
  });
});

describe('de accu’s via de cloud', () => {
  it('packData naast de eigenschappen: per accu samengevoegd, ook als een bericht alleen accu’s heeft', () => {
    let s = verwerkBericht({}, JSON.stringify({ properties: { electricLevel: 41 }, packData: [{ sn: 'FA', maxTemp: 2961 }, { sn: 'FB', maxTemp: 2986 }] }));
    s = verwerkBericht(s, JSON.stringify({ packData: [{ sn: 'FB', maxTemp: 3001 }] }));
    expect(s).toEqual({ electricLevel: 41, packData: [{ sn: 'FA', maxTemp: 2961 }, { sn: 'FB', maxTemp: 3001 }] });
    // Een accu zonder serienummer kan niet bij de goede: die telt niet.
    expect(verwerkBericht(s, JSON.stringify({ packData: [{ maxTemp: 1 }] }))).toBe(s);
    expect(batterijInfoUit(s)).toMatchObject({ temp_c: 27, temp_min_c: 23, pakketten: 2 });
  });
});

describe('cloudFout: een weigering is iets anders dan een cloud die even plat is', () => {
  it('goed, geweigerd, of even niet bereikbaar', async () => {
    const { cloudFout } = await import('./zendure.mjs');
    expect(cloudFout(200, { code: 200, success: true })).toBeNull();
    expect(cloudFout(200, { code: 401, success: false, msg: 'appKey ongeldig' })).toBe('Zendure weigert de cloudsleutel: appKey ongeldig');
    expect(cloudFout(403, null)).toBe('Zendure weigert de cloudsleutel (antwoord 403)');
    expect(cloudFout(503, null)).toMatch(/^de Zendure-cloud is even niet bereikbaar \(antwoord 503\)/);
    expect(cloudFout(200, null)).toMatch(/even niet bereikbaar/);
  });
});

describe('houdZendureCloud: de Zendure-cloud laat het programmaatje nooit stoppen', () => {
  const maakVolger = (over = {}) => ({ namen: ['2400 AC'], stand: () => null, laatste: () => 0, geweigerd: () => false, stop() {}, ...over });

  it('geen internet bij het starten: geen fout, wel later opnieuw (1, 2, 5 … min)', async () => {
    const { houdZendureCloud } = await import('./zendure.mjs');
    let nu = 0;
    let keer = 0;
    const regels = [];
    const cloud = houdZendureCloud('x', {
      log: (t) => regels.push(t),
      klok: () => nu,
      verbind: async () => {
        keer += 1;
        if (keer < 3) throw Object.assign(new Error('getaddrinfo ENOTFOUND app.zendure.tech'), { code: 'ENOTFOUND' });
        return maakVolger({ stand: () => ({ batterij_w: 100 }) });
      },
    });
    await cloud.start();
    expect(keer).toBe(1);
    expect(regels[0]).toMatch(/geen internet.*over 1 min opnieuw/);
    await expect(cloud.lees()).rejects.toThrow('nog niet verbonden');
    expect(keer).toBe(1);
    nu = 61_000;
    await expect(cloud.lees()).rejects.toThrow();
    await Promise.resolve();
    expect(keer).toBe(2);
    // Dezelfde fout: geen tweede regel.
    expect(regels).toHaveLength(1);
    nu = 61_000 + 121_000;
    await expect(cloud.lees()).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(keer).toBe(3);
    expect(await cloud.lees()).toEqual({ batterij_w: 100 });
    expect(cloud.namen).toEqual(['2400 AC']);
    expect(regels.at(-1)).toBe('Zendure: inloggen lukt weer.');
  });

  it('minuten niets gehoord, of een geweigerde inlog: opnieuw inloggen', async () => {
    const { houdZendureCloud } = await import('./zendure.mjs');
    let nu = 0;
    let keer = 0;
    let geweigerd = false;
    const cloud = houdZendureCloud('x', {
      klok: () => nu,
      verbind: async () => {
        keer += 1;
        return maakVolger({ geweigerd: () => geweigerd });
      },
    });
    await cloud.start();
    nu = 4 * 60_000;
    await expect(cloud.lees()).rejects.toThrow('geen verse stand');
    expect(keer).toBe(1);
    nu = 6 * 60_000;
    await expect(cloud.lees()).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(keer).toBe(2);
    geweigerd = true;
    nu += 1000;
    await expect(cloud.lees()).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    // Geweigerd: niet meteen, maar na een minuut opnieuw (anders elke 5 s een inlog).
    expect(keer).toBe(2);
    nu += 61_000;
    await expect(cloud.lees()).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(keer).toBe(3);
  });
});

describe('zendureMetReserve: lokaal, met de cloud als reserve', () => {
  const STAND = { batterij_w: -800, batterij_procent: 60, zon_w: null, ac_w: -800 };
  const maak = ({ lokaal, cloudStand = () => ({ batterij_w: -790 }) } = {}) => {
    const regels = [];
    const cloud = { gemaakt: 0, gestart: 0, gestopt: 0 };
    let nu = 0;
    const z = zendureMetReserve('192.168.1.63', 'SLEUTEL', {
      log: (t) => regels.push(t),
      klok: () => nu,
      leesLokaal: async () => lokaal(),
      maakCloud: (sleutel) => {
        expect(sleutel).toBe('SLEUTEL');
        cloud.gemaakt += 1;
        return {
          start: async () => {
            cloud.gestart += 1;
          },
          lees: async () => {
            const stand = cloudStand();
            if (!stand) throw new Error('geen verse stand van de Zendure-cloud');
            return stand;
          },
          stop: () => {
            cloud.gestopt += 1;
          },
          namen: ['SolarFlow 2400 AC'],
        };
      },
    });
    return { z, regels, cloud, zet: (ms) => (nu = ms) };
  };

  it('antwoordt hij lokaal, dan geen cloud', async () => {
    const { z, regels, cloud } = maak({ lokaal: () => STAND });
    for (let i = 0; i < 5; i++) expect(await z.lees()).toEqual({ ...STAND, bron: 'lokaal' });
    expect(cloud.gemaakt).toBe(0);
    expect(regels).toEqual([]);
  });

  it('3 keer op rij geen antwoord: de cloud, met één regel; terug zodra hij lokaal antwoordt', async () => {
    let weg = true;
    const { z, regels, cloud, zet } = maak({
      lokaal: () => {
        if (weg) throw new Error('connect EHOSTUNREACH 192.168.1.63:80');
        return STAND;
      },
    });
    await expect(z.lees()).rejects.toThrow('EHOSTUNREACH');
    expect(cloud.gemaakt).toBe(0);
    // De tweede misser: de cloud alvast verbinden, maar nog niet gebruiken.
    await expect(z.lees()).rejects.toThrow('EHOSTUNREACH');
    expect(cloud).toMatchObject({ gemaakt: 1, gestart: 1 });
    expect(await z.lees()).toEqual({ batterij_w: -790, bron: 'cloud-reserve' });
    expect(await z.lees()).toEqual({ batterij_w: -790, bron: 'cloud-reserve' });
    expect(z.opReserve).toBe(true);
    expect(regels).toHaveLength(1);
    expect(regels[0]).toMatch(/^Zendure antwoordt lokaal niet \(.*\); ik gebruik de Zendure-cloud als reserve\.$/);
    expect(regels.join(' ')).not.toContain('SLEUTEL');
    weg = false;
    zet(60_000);
    expect(await z.lees()).toEqual({ ...STAND, bron: 'lokaal' });
    expect(z.opReserve).toBe(false);
    expect(regels).toHaveLength(2);
    expect(regels[1]).toMatch(/weer lokaal/);
    // De cloud blijft nog even (geen gefladder bij haperende wifi), en gaat na 10 minuten goed dicht.
    expect(cloud.gestopt).toBe(0);
    zet(60_000 + RESERVE_LOSLATEN_MS);
    await z.lees();
    expect(cloud.gestopt).toBe(1);
    expect(cloud.gemaakt).toBe(1);
  });

  it('weer even weg binnen die 10 minuten: dezelfde cloudverbinding, niet opnieuw inloggen', async () => {
    let weg = true;
    const { z, cloud, zet } = maak({
      lokaal: () => {
        if (weg) throw new Error('geen antwoord');
        return STAND;
      },
    });
    for (let i = 0; i < 3; i++) await z.lees().catch(() => {});
    weg = false;
    await z.lees();
    zet(5 * 60_000);
    weg = true;
    for (let i = 0; i < 3; i++) await z.lees().catch(() => {});
    expect(z.opReserve).toBe(true);
    expect(cloud.gemaakt).toBe(1);
  });

  it('ook de cloud geen verse stand (hooguit 3 minuten oud): de fout van lokaal', async () => {
    const { z } = maak({
      lokaal: () => {
        throw new Error('Zendure antwoordde 500');
      },
      cloudStand: () => null,
    });
    for (let i = 0; i < 4; i++) await expect(z.lees()).rejects.toThrow('Zendure antwoordde 500');
    expect(z.opReserve).toBe(false);
  });

  it('stop() sluit de cloudverbinding', async () => {
    const { z, cloud } = maak({
      lokaal: () => {
        throw new Error('weg');
      },
    });
    for (let i = 0; i < 3; i++) await z.lees().catch(() => {});
    z.stop();
    expect(cloud.gestopt).toBe(1);
  });
});

describe('lokaal: is het nog dezelfde Zendure? (adressen.mjs, 1.3.0)', () => {
  it('elk antwoord noemt zijn serienummer: de eerste keer leren, een andere Zendure of P1-meter telt niet; het nummer gaat niet mee', async () => {
    const http = await import('node:http');
    const { maakAdressen } = await import('./adressen.mjs');
    let sn = 'EEA1ABCDEF123456';
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ sn, product: 'solarFlow2400AC', properties: { electricLevel: 55, packInputPower: 0, outputPackPower: 300 } }));
    });
    await new Promise((klaar) => server.listen(0, '127.0.0.1', klaar));
    const adres = `127.0.0.1:${server.address().port}`;
    const instellingen = { homewizard: [], zendure: { manier: 'lokaal', adres } };
    const plek = maakAdressen({ instellingen }).plek('zendure');
    try {
      const stand = await leesZendureLokaal(adres, { plek });
      expect(stand.batterij_procent).toBe(55);
      expect(JSON.stringify(stand)).not.toContain('EEA1');
      await leesZendureLokaal(adres, { plek });
      sn = 'EEA1999999999999';
      await expect(leesZendureLokaal(adres, { plek })).rejects.toMatchObject({ code: 'ANDER_APPARAAT' });
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  it('met de cloud als reserve: lokaal altijd op het adres van nu', async () => {
    const gelezen = [];
    let adres = '192.168.0.50';
    const reserve = zendureMetReserve(() => adres, 'sleutel', {
      leesLokaal: async (a) => {
        gelezen.push(a);
        return { batterij_w: 0 };
      },
      maakCloud: () => ({ start() {}, stop() {}, lees: async () => null, namen: [] }),
    });
    await reserve.lees();
    adres = '192.168.0.61';
    await reserve.lees();
    expect(gelezen).toEqual(['192.168.0.50', '192.168.0.61']);
  });
});

describe("1.4.0: tot 6 accu's per 2400 AC, tot drie 2400 AC's in één huis (18 accu's)", () => {
  /** Een 2400 AC met `n` accu's AB3000X (serienummer F…, 2,88 kWh), met alles wat een accu kan melden. */
  const vol = (n, { fase = 1, packNum = n } = {}) =>
    batterijInfoUit({
      ...RAPPORT_2400AC.properties,
      packNum,
      packData: Array.from({ length: n }, (_, i) => ({
        ...RAPPORT_2400AC.packData[0],
        sn: `FO4N${fase}${String(i).padStart(10, '0')}`,
        socLevel: 40 + i,
        maxTemp: 2961 + 10 * i,
        minVol: 325 + (i % 2),
        maxVol: 329,
        soh: 996 - i,
        cycleCount: 150 + i,
        heatState: i === 0 ? 1 : 0,
      })),
    });

  it('per 2400 AC zes accu\'s volledig, met de inhoud 6 × 2,88 kWh', () => {
    const info = vol(ACCUS_PER_APPARAAT);
    expect(info.pakketten).toBe(6);
    expect(info.inhoud_kwh).toBe(17.28);
    expect(info.accus.map((a) => a.nr)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(info.accus[0]).toEqual({ nr: 1, temp_c: 23, procent: 40, cel_min_v: 3.25, cel_max_v: 3.29, verwarmt: true, gezondheid_pct: 99.6, cycli: 150 });
  });

  it("drie samen: 18 accu's doorgenummerd, 51,84 kWh; de meting blijft ruim onder de grens", () => {
    const samen = samenInfo([vol(6, { fase: 1 }), vol(6, { fase: 2 }), vol(6, { fase: 3 })]);
    expect(HOOGSTENS_ACCU_REGELS).toBe(18);
    expect(samen.pakketten).toBe(18);
    expect(samen.inhoud_kwh).toBe(51.84);
    expect(samen.accus.map((a) => a.nr)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
    // Geen serienummer in wat er naar de app gaat.
    expect(JSON.stringify(samen)).not.toMatch(/FO4N/);
    // De stand met dit alles: zo'n 2.500 tekens voor de batterij; de grootste stand die we kennen (4.310 met 8 accu's) wordt zo'n 6.500.
    const lengte = JSON.stringify(samen).length;
    expect(lengte).toBeLessThan(3500);
    expect(4310 + lengte).toBeLessThan(HOOGSTENS_TEKENS / 2);

    // De nieuwe functie neemt ze alle 18 aan, met alles erbij; de site leest ze alle 18.
    const meting = { net_w: 100, batterij_w: -600, batterij_procent: 45, batterij_info: samen };
    const nieuw = controleerMeting(JSON.parse(JSON.stringify(meting)), new Date('2026-10-31T12:00:00Z'));
    expect(nieuw.ok).toBe(true);
    expect(nieuw.meting.batterij_info.accus).toHaveLength(18);
    expect(nieuw.meting.batterij_info.accus[17]).toMatchObject({ nr: 18, cel_min_v: 3.26, cycli: 155 });
    expect(nieuw.meting.batterij_info).toMatchObject({ pakketten: 18, inhoud_kwh: 51.84 });
    expect(siteBatterijInfo(nieuw.meting.batterij_info).accus).toHaveLength(18);
    // De functie die nu live staat: de eerste 8 accu's, de meting komt gewoon aan.
    const live = controleerLive(JSON.parse(JSON.stringify(meting)), new Date('2026-10-31T12:00:00Z'));
    expect(live.ok).toBe(true);
    expect(live.meting.batterij_info.accus).toHaveLength(8);
    expect(live.meting.batterij_info.pakketten).toBe(18);
  });

  it('een packNum boven 6 (of meer accu\'s dan verwacht): gewoon tonen, niet omvallen', () => {
    const acht = vol(8);
    expect(acht.pakketten).toBe(8);
    expect(acht.accus).toHaveLength(8);
    expect(acht.inhoud_kwh).toBe(23.04);
    // Drie van acht: samen hooguit 18 naar de app, de rest valt stil weg; de nummers lopen door.
    const samen = samenInfo([vol(8, { fase: 1 }), vol(8, { fase: 2 }), vol(8, { fase: 3 })]);
    expect(samen.accus).toHaveLength(18);
    expect(samen.accus.at(-1).nr).toBe(18);
    expect(samen.pakketten).toBe(24);
    const uit = controleerMeting({ net_w: 1, batterij_info: samen }, new Date('2026-10-31T12:00:00Z'));
    expect(uit.meting.batterij_info).toMatchObject({ pakketten: 24 });
    expect(uit.meting.batterij_info.accus).toHaveLength(18);
    // Een oudere brug met 3 accu's: zoals altijd.
    const oud = controleerMeting({ net_w: 1, batterij_info: { pakketten: 3, accus: [1, 2, 3].map((nr) => ({ nr, temp_c: 20, procent: 50 })) } }, new Date('2026-10-31T12:00:00Z'));
    expect(oud.meting.batterij_info.accus).toEqual([1, 2, 3].map((nr) => ({ nr, temp_c: 20, procent: 50 })));
  });
});
