import { createHash, randomInt } from 'node:crypto';
import { WEG_NA_KEER } from './bewaking.mjs';
import { veldenVan } from './kennis.mjs';
import { inGewoneWoorden, LOKAAL_VERBINDING, vraagJson } from './web.mjs';

/**
 * De Zendure-batterij uitlezen, op een van twee manieren:
 *
 *   lokaal  http://<adres>/properties/report  (zenSDK). Kan op de nieuwere
 *           modellen: SolarFlow 800 / 800 Plus / 800 Pro, 1600 AC+, 2400 AC /
 *           AC+ / Pro. Aanzetten: in de Zendure-app "HEMS" toevoegen en de app
 *           daarna sluiten. Bron: github.com/Zendure/zenSDK.
 *
 *   cloud   met de Autorisatiecloudsleutel uit de Zendure-app (Profiel ›
 *           Autorisatiecloudsleutel › Ophalen). Werkt ook op de oudere modellen
 *           (Hub 1200/2000, AIO 2400, Hyper 2000, ACE 1500). Zo doet de officiële
 *           Home Assistant-koppeling van Zendure het ook (github.com/Zendure/Zendure-HA,
 *           custom_components/zendure_ha/api.py); dit is hetzelfde, in JavaScript.
 *           Zendure laat per account maar één zo'n verbinding toe: gebruik de
 *           sleutel niet tegelijk in Home Assistant, Homey of een andere app.
 *
 * Eigenschappen (zelfde namen lokaal en in de cloud), allemaal in watt en
 * nooit min; de richting zit in welke van een paar niet nul is:
 *   solarInputPower  wat eigen panelen aan de Zendure leveren (niet bij de 2400 AC)
 *   packInputPower   de batterij levert (ontladen)
 *   outputPackPower  de batterij laadt
 *   outputHomePower  wat de Zendure aan het huis levert (wisselstroom)
 *   gridInputPower   wat de Zendure uit het huis haalt om te laden (wisselstroom)
 *   electricLevel    hoe vol, in procent
 *
 * Meer over de batterij (temperatuur, spanning, grenzen, …): zie batterijInfoUit.
 * Alles alleen lezen; dit programmaatje schrijft nooit iets naar de Zendure.
 */

const getal = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Een Zendure zonder eigen panelen, zoals de SolarFlow 2400 AC ("solarFlow2400AC"
 * lokaal, "SolarFlow 2400 AC" in de cloud). Die meldt solarInputPower toch,
 * altijd 0; dan geen zonnebron in de app (in huis A stond er een rondje
 * "Zon (Zendure)" met 0 W).
 */
export const zonderPanelen = (product) => /2400\s*AC/i.test(String(product ?? ''));

/**
 * Van Zendure-eigenschappen naar wat de app wil weten.
 *
 * Zonder eigen panelen (zoals de SolarFlow 2400 AC, die alleen aan het
 * stopcontact hangt) is alles wat er aan de stopcontactkant in- en uitgaat de
 * batterij. Dat is ook precies wat het huis en een HomeWizard-meter zien: het
 * verlies bij het omzetten zit dan in de batterij, niet in het huis. Met eigen
 * panelen (en zon op dat moment) tellen we aan de batterijkant, zoals de
 * Zendure-app.
 *
 * ac_w is wat de Zendure netto aan het huis geeft (plus) of eruit haalt (min).
 * Daarmee rekent samenvoegen.mjs de zon uit een meter die zon en batterij
 * samen meet.
 */
export function standUitEigenschappen(p, { product } = {}) {
  let zon = getal(p?.solarInputPower);
  // Meldt hij toch zon, dan tellen we die wel: liever een rondje te veel dan zon kwijt.
  if (zonderPanelen(product) && !(zon > 0)) zon = null;
  const ontladen = getal(p?.packInputPower);
  const laden = getal(p?.outputPackPower);
  const naarHuis = getal(p?.outputHomePower);
  const uitHuis = getal(p?.gridInputPower);
  const ac_w = naarHuis === null && uitHuis === null ? null : (naarHuis ?? 0) - (uitHuis ?? 0);

  let batterij_w = null;
  if (ac_w !== null && !(zon > 0)) batterij_w = ac_w;
  else if (ontladen !== null || laden !== null) batterij_w = (ontladen ?? 0) - (laden ?? 0);

  return { zon_w: zon, batterij_w, batterij_procent: getal(p?.electricLevel), ac_w };
}

/** Meer apparaten (bijvoorbeeld twee batterijen): zon en batterij optellen, de vulling middelen. */
export function telOp(standen) {
  const met = (veld) => standen.map((s) => s[veld]).filter((v) => v !== null && v !== undefined);
  const som = (veld) => (met(veld).length ? met(veld).reduce((a, b) => a + b, 0) : null);
  const procenten = met('batterij_procent');
  return {
    zon_w: som('zon_w'),
    batterij_w: som('batterij_w'),
    batterij_procent: procenten.length ? Math.round(procenten.reduce((a, b) => a + b, 0) / procenten.length) : null,
    ac_w: som('ac_w'),
  };
}

/* ---------- Meer over de batterij ---------- */

/**
 * Een SolarFlow 2400 AC neemt tot 6 accu's (AB3000X/L, elk 2,88 kWh); in één huis tot drie
 * 2400 AC's (één per fase), dus tot 18 accu's samen (31-10-2026). Per apparaat lezen we
 * er ruim meer (een packNum boven 6 gewoon tonen, niet omvallen); naar de app gaan er samen
 * hooguit HOOGSTENS_ACCU_REGELS (Meting.batterij_info.accus; ontvangMeting neemt er net zoveel
 * aan, een oudere functie de eerste 8). Zo blijft de meting ruim onder HOOGSTENS_TEKENS
 * (versturen.mjs; zendure.test.js meet het met 3 × 6 accu's met alle velden).
 */
export const HOOGSTENS_ACCUS = 12;
export const ACCUS_PER_APPARAAT = 6;
export const HOOGSTENS_ACCU_REGELS = 18;
/** Een week; langer zegt niets meer. Zendure meldt 59940 (999 uur) als hij het niet weet. */
const HOOGSTENS_MIN = 7 * 24 * 60;

const tussen = (v, min, max) => {
  const g = getal(v);
  return g !== null && g >= min && g <= max ? g : null;
};

/**
 * 16 bits met teken (zenSDK: batcur): 65510 is −26. Ook als Zendure het als 32
 * bits met teken stuurt (Zendure-HA wiki). Iets daarbuiten is geen getal.
 */
export function int16(v) {
  const n = Math.round(v);
  if (n >= -32768 && n <= 65535) return n >= 32768 ? n - 65536 : n;
  if (n >= 0xffff8000 && n <= 0xffffffff) return n - 0x100000000;
  return null;
}

/** Tienden van een kelvin naar °C op één decimaal (zenSDK: (waarde − 2731) / 10); onzin wordt null. */
export function graden(waarde) {
  const v = getal(waarde);
  if (v === null) return null;
  const c = Math.round(v - 2731) / 10;
  return c >= -40 && c <= 90 ? c : null;
}

/**
 * Wat de Zendure verder over zijn batterij meldt, in gewone eenheden, voor de
 * app (Meting.batterij_info). Bronnen: zenSDK (docs/en_properties.md en
 * openapi.yaml), de Home Assistant-koppeling van Zendure (entity.py,
 * device.py) en haar wiki; de 2400 AC staat in de lijst van zenSDK.
 *
 *   temp_c            de warmste accu: packData[].maxTemp, hoogste celtemperatuur, in 0,1 K
 *   temp_min_c        de koelste accu (alleen bij twee of meer)
 *   behuizing_c       hyperTmp: de temperatuur binnenin de Zendure, ook in 0,1 K
 *   spanning_v        BatVolt in 0,01 V (anders het gemiddelde van packData[].totalVol)
 *   stroom_a          packData[].batcur opgeteld: 16 bits met teken, in 0,1 A; zonder teken
 *                     meegestuurd (welk teken laden is, staat nergens; de richting zit in batterij_w)
 *   laadgrens_pct     socSet, in 0,1 % (700–1000 = 70–100 %; een oudere Zendure in procenten)
 *   ontlaadgrens_pct  minSoc, in dezelfde eenheid als socSet (0–50 %)
 *   vol_over_min      bij laden: remainInputTime (minuten), of geschat
 *   leeg_over_min     bij ontladen: remainOutTime (minuten), of geschat
 *   verwarmt          heatState 1, van het apparaat of van een accu
 *   kalibreert        socStatus 1: hij stelt zijn batterijstand opnieuw af
 *   wifi_dbm          rssi, in dBm
 *   pakketten         packNum: hoeveel accu's
 *   inhoud_kwh        samen, afgeleid van het soort accu (zie accuInhoudKwh)
 *   gezondheid_pct    packData[].soh in 0,1 %, de laagste (alleen als hij het meldt)
 *   storing           is_error 1 (faultLevel alleen niet: die staat ook zonder storing boven 0)
 *   storing_niveau    faultLevel: hoe ernstig (geen foutcode)
 *   accus             per accu (hooguit 12 per apparaat, 18 samen): { nr, temp_c, procent }, nr = de plek in packData
 *                     (1, 2, 3, …); temp_c is maxTemp, procent socLevel. Geen serienummer.
 *                     Sinds 1.4.0 ook cel_min_v en cel_max_v (minVol en maxVol, 0,01 V), verwarmt
 *                     (heatState), gezondheid_pct (soh) en cycli (laadcycli, als hij die meldt)
 *   cel_min_v         1.4.0: de laagste celspanning van alle accu's, in V (minVol)
 *   cel_max_v         1.4.0: de hoogste celspanning van alle accu's, in V (maxVol)
 *   invoer_limiet_w   1.4.0: hoeveel hij hooguit uit het stopcontact laadt (inputLimit, ingesteld)
 *   uitvoer_limiet_w  1.4.0: hoeveel hij hooguit aan het huis levert (outputLimit, ingesteld)
 *   omvormer_max_w    1.4.0: het hoogste vermogen van zijn omvormer (inverseMaxPower)
 *
 * Elk getal wordt eerst nagekeken; wat niet aannemelijk is (een andere eenheid,
 * "weet ik niet"), gaat niet mee. Wat de Zendure niet meldt, staat er niet in:
 * een oudere Zendure kent niet alles. Nooit serienummers of andere herkenbare
 * gegevens. Zonder iets: null.
 *
 * @param {object} p  de eigenschappen, met de accu's (packData) erbij
 */
export function batterijInfoUit(p) {
  if (!p || typeof p !== 'object') return null;
  const accus = (Array.isArray(p.packData) ? p.packData : []).filter((a) => a && typeof a === 'object').slice(0, HOOGSTENS_ACCUS);
  const info = {};
  const zet = (veld, waarde) => {
    if (waarde !== null && waarde !== undefined) info[veld] = waarde;
  };

  const temps = accus.map((a) => graden(a.maxTemp)).filter((t) => t !== null);
  if (temps.length) zet('temp_c', Math.max(...temps));
  if (temps.length > 1) zet('temp_min_c', Math.min(...temps));
  zet('behuizing_c', graden(p.hyperTmp));
  zet('accus', accuLijst(accus));

  zet('spanning_v', spanningUit(p, accus));
  const stromen = accus.map((a) => getal(a.batcur)).filter((v) => v !== null).map(int16);
  if (stromen.length && stromen.every((v) => v !== null)) {
    const a = Math.abs(stromen.reduce((som, v) => som + v, 0)) / 10;
    if (a <= 200) zet('stroom_a', Math.round(a * 10) / 10);
  }

  const { laad, ontlaad } = grenzenUit(p);
  zet('laadgrens_pct', laad);
  zet('ontlaadgrens_pct', ontlaad);

  const pakketten = tussen(p.packNum, 1, HOOGSTENS_ACCUS) ?? (accus.length || null);
  zet('pakketten', pakketten === null ? null : Math.round(pakketten));
  // Alleen als elke accu bekend is: een half getal is erger dan geen getal.
  const inhouden = accus.map((a) => accuInhoudKwh(a.sn, a.packType));
  const inhoud = accus.length && accus.length === pakketten && inhouden.every((k) => k !== null) ? Math.round(inhouden.reduce((s, k) => s + k, 0) * 100) / 100 : null;
  zet('inhoud_kwh', inhoud);

  const { vol, leeg } = tijdenUit(p, { laad, ontlaad, inhoud });
  zet('vol_over_min', vol);
  zet('leeg_over_min', leeg);

  const warm = [p.heatState, ...accus.map((a) => a.heatState)].filter((v) => v === 0 || v === 1);
  if (warm.length) zet('verwarmt', warm.includes(1));
  if (p.socStatus === 0 || p.socStatus === 1) zet('kalibreert', p.socStatus === 1);
  const rssi = tussen(p.rssi, -120, -1);
  zet('wifi_dbm', rssi === null ? null : Math.round(rssi));

  // 1.4.0: de celspanningen over alle accu's, en de ingestelde grenzen voor laden en leveren.
  const minnen = accus.map((a) => celVolt(a.minVol)).filter((v) => v !== null);
  const maxen = accus.map((a) => celVolt(a.maxVol)).filter((v) => v !== null);
  if (minnen.length) zet('cel_min_v', Math.min(...minnen));
  if (maxen.length) zet('cel_max_v', Math.max(...maxen));
  const watt = (v) => {
    const w = tussen(v, 0, 10_000);
    return w === null ? null : Math.round(w);
  };
  zet('invoer_limiet_w', watt(p.inputLimit));
  zet('uitvoer_limiet_w', watt(p.outputLimit));
  zet('omvormer_max_w', watt(p.inverseMaxPower) || null);

  const gezond = accus.map((a) => tussen(a.soh, 10, 1000)).filter((v) => v !== null);
  if (gezond.length) zet('gezondheid_pct', Math.round(Math.min(...gezond)) / 10);

  const fout = p.is_error === 0 || p.is_error === 1 ? p.is_error : null;
  const niveau = Number.isInteger(p.faultLevel) && p.faultLevel >= 0 ? p.faultLevel : null;
  // Alleen is_error zegt of er nu een storing is. faultLevel staat bij een
  // SolarFlow 2400 AC ook zonder storing boven 0 (in huis B 2, 30-10-2026, terwijl
  // de Zendure-app niets meldde): dat noemen we alleen als hij echt een storing meldt.
  if (fout !== null) zet('storing', fout === 1);
  if (fout === 1 && niveau > 0 && niveau <= 99) zet('storing_niveau', niveau);

  return Object.keys(info).length ? info : null;
}

/**
 * Per accu de temperatuur en hoe vol hij is (packData[].maxTemp en socLevel),
 * op de volgorde van packData: Accu 1, 2, 3. Een accu zonder een van beide
 * houdt zijn nummer, maar staat er niet in. Niets: null.
 */
export function accuLijst(accus) {
  const lijst = (accus ?? []).slice(0, HOOGSTENS_ACCUS).flatMap((a, i) => {
    const temp = graden(a?.maxTemp);
    const procent = tussen(a?.socLevel, 0, 100);
    if (temp === null && procent === null) return [];
    // 1.4.0: celspanningen, verwarmen, gezondheid en laadcycli, alleen wat hij meldt.
    const celMin = celVolt(a.minVol);
    const celMax = celVolt(a.maxVol);
    const soh = tussen(a.soh, 10, 1000);
    const cycli = cycliUit(a);
    return [
      {
        nr: i + 1,
        ...(temp === null ? {} : { temp_c: temp }),
        ...(procent === null ? {} : { procent: Math.round(procent) }),
        ...(celMin === null ? {} : { cel_min_v: celMin }),
        ...(celMax === null ? {} : { cel_max_v: celMax }),
        // Alleen als hij het nu doet: "verwarmt niet" per accu zegt niets (dat staat al bij de batterij).
        ...(a.heatState === 1 ? { verwarmt: true } : {}),
        ...(soh === null ? {} : { gezondheid_pct: Math.round(soh) / 10 }),
        ...(cycli === null ? {} : { cycli }),
      },
    ];
  });
  return lijst.length ? lijst : null;
}

/**
 * Een celspanning (zenSDK: packData[].minVol en maxVol, in 0,01 V; 330 = 3,30 V). Een die in mV
 * lijkt (3300) ook. Buiten 2 tot 4,5 V (een LiFePO4-cel zit tussen 2,5 en 3,65 V) is het geen celspanning.
 */
export function celVolt(v) {
  const g = getal(v);
  if (g === null) return null;
  const volt = g >= 200 && g <= 450 ? g / 100 : g >= 2000 && g <= 4500 ? g / 1000 : null;
  return volt === null ? null : Math.round(volt * 1000) / 1000;
}

/**
 * Laadcycli van een accu, als de Zendure ze meldt. zenSDK noemt ze niet; de naam is
 * onzeker, daarom een paar kandidaten (de kennislijst laat later zien welke het is).
 */
const CYCLI_NAMEN = ['cycleCount', 'cycle', 'cycles', 'cycleNum', 'cycleTimes'];
export function cycliUit(a) {
  for (const naam of CYCLI_NAMEN) {
    const v = a?.[naam];
    if (Number.isInteger(v) && v >= 0 && v <= 20_000) return v;
  }
  return null;
}

/** Een 48-voltsbatterij: BatVolt in 0,01 V, anders het gemiddelde van de accu's (totalVol, 0,01 V of al in volt). */
function spanningUit(p, accus) {
  const goed = (v) => (v !== null && v >= 30 && v <= 70 ? Math.round(v * 10) / 10 : null);
  const bat = getal(p.BatVolt) === null ? null : int16(p.BatVolt);
  const uitBat = bat === null ? null : goed(bat / 100);
  if (uitBat !== null) return uitBat;
  const volt = accus
    .map((a) => getal(a.totalVol))
    .filter((v) => v !== null)
    .map((v) => (v >= 3000 && v <= 7000 ? v / 100 : v));
  return volt.length ? goed(volt.reduce((s, v) => s + v, 0) / volt.length) : null;
}

/**
 * De laadgrens (socSet) en de ontlaadgrens (minSoc). Een nieuwere Zendure
 * meldt ze in tienden van een procent (700–1000 = 70–100 %, 0–500 = 0–50 %;
 * zo ook de 2400 AC), een oudere in procenten. socSet zegt welke eenheid het
 * is; zonder socSet is een minSoc van 1 tot 50 niet te zeggen.
 */
export function grenzenUit(p) {
  const s = getal(p?.socSet);
  const m = getal(p?.minSoc);
  const deler = s === null ? null : s >= 700 && s <= 1000 ? 10 : s >= 70 && s <= 100 ? 1 : null;
  const laad = deler ? Math.round(s / deler) : null;
  let ontlaad = null;
  const d = deler ?? (m === 0 ? 1 : m > 50 && m <= 500 ? 10 : null);
  if (m !== null && d !== null && m / d >= 0 && m / d <= 50) ontlaad = Math.round(m / d);
  return { laad, ontlaad };
}

/**
 * Hoe vol een accu is, naar het soort: de eerste letter van het serienummer,
 * zoals de Home Assistant-koppeling van Zendure (device.py, get_battery_type).
 * Het serienummer zelf gaat nergens heen. Onbekend: null.
 */
export function accuInhoudKwh(sn, packType) {
  const s = typeof sn === 'string' ? sn : '';
  switch (s[0]) {
    case 'A':
      return s[3] === '3' ? 2.4 : 0.96; // AIO 2400, anders AB1000
    case 'B':
      return packType === 70 ? 8 : 0.96; // ingebouwd in de SolarFlow 4000, anders AB1000S
    case 'C':
      return 1.92; // AB2000
    case 'F':
    case 'G':
      return 2.88; // AB3000X, AB3000L
    case 'J':
      return 2.4; // ingebouwd in de 2400 AC+ en Pro
    default:
      return null;
  }
}

/**
 * Hoe lang nog tot vol (bij laden) of leeg (bij ontladen, tot de ontlaadgrens).
 * Eerst wat de Zendure zelf zegt (remainInputTime, remainOutTime); weet hij het
 * niet, dan geschat zoals de Home Assistant-koppeling (calcRemainingTime):
 * de inhoud × wat er nog bij of af moet, gedeeld door het vermogen aan de accukant.
 */
function tijdenUit(p, { laad, ontlaad, inhoud }) {
  const erin = getal(p.outputPackPower) ?? 0;
  const eruit = getal(p.packInputPower) ?? 0;
  const procent = tussen(p.electricLevel, 0, 100);
  const minuten = (v) => {
    const m = tussen(v, 1, HOOGSTENS_MIN);
    return m === null ? null : Math.round(m);
  };
  const schat = (deel, w) => (inhoud && deel > 0 && w > 0 ? minuten(((deel / 100) * inhoud * 60_000) / w) : null);
  if (erin > 0 && eruit === 0) {
    return { vol: minuten(p.remainInputTime) ?? (laad !== null && procent !== null ? schat(laad - procent, erin) : null), leeg: null };
  }
  if (eruit > 0 && erin === 0) {
    return { vol: null, leeg: minuten(p.remainOutTime) ?? (ontlaad !== null && procent !== null ? schat(procent - ontlaad, eruit) : null) };
  }
  return { vol: null, leeg: null };
}

/**
 * Meer Zendures (via de cloud): wat samen te zeggen is. De temperaturen van de
 * warmste en de koelste, de tijd tot alles vol of leeg is, het zwakste wifi.
 * Spanning en stroom verschillen per apparaat: die niet.
 */
export function samenInfo(lijst) {
  const infos = (lijst ?? []).filter(Boolean);
  if (infos.length <= 1) return infos[0] ?? null;
  const van = (veld) => infos.map((i) => i[veld]).filter((v) => v !== undefined);
  const uit = {};
  const zet = (veld, waarde) => {
    if (waarde !== null && waarde !== undefined && !Number.isNaN(waarde)) uit[veld] = waarde;
  };
  const max = (rij) => (rij.length ? Math.max(...rij) : null);
  const min = (rij) => (rij.length ? Math.min(...rij) : null);
  const gelijk = (rij) => (rij.length === infos.length && rij.every((v) => v === rij[0]) ? rij[0] : null);
  zet('temp_c', max(van('temp_c')));
  const koel = infos.map((i) => i.temp_min_c ?? i.temp_c).filter((v) => v !== undefined);
  if (koel.length > 1) zet('temp_min_c', min(koel));
  zet('behuizing_c', max(van('behuizing_c')));
  zet('laadgrens_pct', gelijk(van('laadgrens_pct')));
  zet('ontlaadgrens_pct', gelijk(van('ontlaadgrens_pct')));
  zet('vol_over_min', max(van('vol_over_min')));
  zet('leeg_over_min', max(van('leeg_over_min')));
  for (const veld of ['verwarmt', 'kalibreert', 'storing']) if (van(veld).length) zet(veld, van(veld).includes(true));
  zet('storing_niveau', max(van('storing_niveau')));
  zet('wifi_dbm', min(van('wifi_dbm')));
  if (van('pakketten').length) zet('pakketten', van('pakketten').reduce((s, v) => s + v, 0));
  const inhoud = van('inhoud_kwh');
  if (inhoud.length === infos.length) zet('inhoud_kwh', Math.round(inhoud.reduce((s, v) => s + v, 0) * 100) / 100);
  zet('gezondheid_pct', min(van('gezondheid_pct')));
  zet('cel_min_v', min(van('cel_min_v')));
  zet('cel_max_v', max(van('cel_max_v')));
  // Grenzen per apparaat: samen opgeteld, alleen als elk apparaat hem meldt.
  for (const veld of ['invoer_limiet_w', 'uitvoer_limiet_w', 'omvormer_max_w']) {
    const rij = van(veld);
    if (rij.length === infos.length) zet(veld, rij.reduce((s, v) => s + v, 0));
  }
  // De accu's van alle Zendures achter elkaar, doorgenummerd: Accu 1–2 van de eerste, 3 van de tweede.
  const accus = [];
  let nr = 0;
  for (const info of infos) {
    const eigen = Array.isArray(info.accus) ? info.accus : [];
    const hoogste = Math.max(info.pakketten ?? 0, ...eigen.map((a) => a.nr));
    for (const a of eigen) if (accus.length < HOOGSTENS_ACCU_REGELS) accus.push({ ...a, nr: nr + a.nr });
    nr += hoogste;
  }
  if (accus.length) zet('accus', accus);
  return Object.keys(uit).length ? uit : null;
}

const komma = (v, decimalen = 1) => v.toFixed(decimalen).replace('.', ',');

/**
 * 130 → "ongeveer 2 uur 10 min", 300 → "ongeveer 5 uur", 45 → "ongeveer 45 min":
 * afgerond zoals je het zou zeggen (onder de 10 minuten op de minuut, onder het
 * uur op 5, tot 5 uur op 10 minuten, daarna op hele uren). Vanaf twee dagen:
 * "meer dan twee dagen".
 */
export function duurTekst(min) {
  if (!(min > 0)) return '';
  if (min >= 48 * 60) return 'meer dan twee dagen';
  if (min < 9.5) return `ongeveer ${Math.max(1, Math.round(min))} min`;
  if (min < 57.5) return `ongeveer ${Math.round(min / 5) * 5} min`;
  if (min < 300) {
    const tien = Math.round(min / 10) * 10;
    const rest = tien % 60;
    return rest ? `ongeveer ${Math.floor(tien / 60)} uur ${rest} min` : `ongeveer ${tien / 60} uur`;
  }
  return `ongeveer ${Math.round(min / 60)} uur`;
}

/** Hoe goed het wifi is, zoals het meestal wordt ingedeeld: −60 dBm of beter is goed. */
export function wifiWoord(dbm) {
  if (dbm >= -60) return 'goed';
  if (dbm >= -70) return 'redelijk';
  if (dbm >= -80) return 'zwak';
  return 'slecht';
}

/** De batterijgegevens in gewone woorden, voor `node brug.mjs proef`. */
export function batterijZinnen(info) {
  if (!info) return ['geen extra gegevens van de batterij (temperatuur e.d.)'];
  const regels = [];
  const graad = (c) => `${komma(c)} °C`;
  const temp = [];
  if (info.temp_c !== undefined) {
    temp.push(info.temp_min_c !== undefined ? `accu's ${komma(info.temp_min_c)} tot ${graad(info.temp_c)}` : `accu ${graad(info.temp_c)}`);
  }
  if (info.behuizing_c !== undefined) temp.push(`binnenin de Zendure ${graad(info.behuizing_c)}`);
  if (temp.length) regels.push(`temperatuur: ${temp.join(', ')}`);
  for (const a of info.accus ?? []) {
    const delen = [`accu ${a.nr}`];
    if (a.temp_c !== undefined) delen.push(graad(a.temp_c));
    if (a.procent !== undefined) delen.push(`${a.procent}%`);
    if (a.cel_min_v !== undefined && a.cel_max_v !== undefined) delen.push(`cellen ${komma(a.cel_min_v, 2)}–${komma(a.cel_max_v, 2)} V`);
    if (a.gezondheid_pct !== undefined) delen.push(`gezondheid ${komma(a.gezondheid_pct)}%`);
    if (a.cycli !== undefined) delen.push(`${a.cycli} laadcycli`);
    if (a.verwarmt) delen.push('verwarmt');
    regels.push(delen.join(' · '));
  }
  if (info.cel_min_v !== undefined && info.cel_max_v !== undefined) regels.push(`celspanning ${komma(info.cel_min_v, 2)} tot ${komma(info.cel_max_v, 2)} V`);
  const limieten = [];
  if (info.invoer_limiet_w !== undefined) limieten.push(`laadt hooguit ${info.invoer_limiet_w} W uit het stopcontact`);
  if (info.uitvoer_limiet_w !== undefined) limieten.push(`levert hooguit ${info.uitvoer_limiet_w} W aan het huis`);
  if (limieten.length) regels.push(limieten.join(', '));
  const elektrisch = [];
  if (info.spanning_v !== undefined) elektrisch.push(`spanning ${komma(info.spanning_v)} V`);
  if (info.stroom_a !== undefined) elektrisch.push(`stroom ${komma(info.stroom_a)} A`);
  if (elektrisch.length) regels.push(elektrisch.join(', '));
  const grenzen = [];
  if (info.laadgrens_pct !== undefined) grenzen.push(`laadt tot ${info.laadgrens_pct}%`);
  if (info.ontlaadgrens_pct !== undefined) grenzen.push(`ontlaadt tot ${info.ontlaadgrens_pct}%`);
  if (grenzen.length) regels.push(grenzen.join(', '));
  if (info.vol_over_min !== undefined) regels.push(`vol over ${duurTekst(info.vol_over_min)}`);
  if (info.leeg_over_min !== undefined) regels.push(`leeg over ${duurTekst(info.leeg_over_min)}`);
  if (info.verwarmt !== undefined) regels.push(info.verwarmt ? 'verwarmt zichzelf nu' : 'verwarmt zichzelf niet');
  if (info.kalibreert) regels.push('kalibreert nu zijn batterijstand');
  if (info.wifi_dbm !== undefined) regels.push(`wifi-signaal ${wifiWoord(info.wifi_dbm)} (${info.wifi_dbm} dBm)`);
  const accus = [];
  if (info.pakketten !== undefined) accus.push(info.pakketten === 1 ? '1 accu' : `${info.pakketten} accu's`);
  if (info.inhoud_kwh !== undefined) accus.push(`samen ${komma(info.inhoud_kwh, 2)} kWh`);
  if (info.gezondheid_pct !== undefined) accus.push(`gezondheid ${komma(info.gezondheid_pct)}%`);
  if (accus.length) regels.push(accus.join(', '));
  if (info.storing !== undefined) {
    regels.push(info.storing ? `meldt een storing${info.storing_niveau ? ` (niveau ${info.storing_niveau})` : ''}` : 'geen storing');
  }
  return regels;
}

/**
 * De Zendure lokaal lezen, over een blijvende verbinding (web.mjs). `plek` (adressen.mjs, 1.3.0):
 * elk antwoord noemt zijn serienummer (sn); is het een andere Zendure, dan AnderApparaat en
 * zoekt het programmaatje de goede. Het serienummer gaat niet mee in de stand.
 */
export async function leesZendureLokaal(adres, { plek = null } = {}) {
  const { status, json } = await vraagJson(`http://${adres}/properties/report`, { tijd: 3000, agent: LOKAAL_VERBINDING });
  if (status !== 200 || !json?.properties) {
    throw new Error(`Zendure antwoordde ${status}; staat de lokale koppeling aan (HEMS toevoegen in de Zendure-app)?`);
  }
  if (typeof json.sn === 'string') plek?.controleer(json.sn);
  // Met de productnaam erbij, voor de lijst met gekoppelde apparaten in de app. De accu's
  // (packData) staan naast de eigenschappen; voor batterijInfoUit doen we ze erbij.
  return {
    ...standUitEigenschappen(json.properties, { product: json.product }),
    product: typeof json.product === 'string' ? json.product : null,
    info: batterijInfoUit({ ...json.properties, packData: json.packData }),
    // De kennislijst van één keer per dag (veldenVan in kennis.mjs), pas als hij gevraagd wordt; een
    // functie, dus het antwoord zelf (met het serienummer) komt nooit in JSON terecht.
    kennis: () => veldenVan(json),
  };
}

/* ---------- Zendure P1-meter ---------- */

/**
 * De Zendure P1-meter (een los kastje op de slimme meter) antwoordt lokaal op
 * hetzelfde adres als de batterij, maar met iets anders:
 *
 *   { timestamp, deviceId, total_power, a_aprt_power, b_aprt_power, c_aprt_power }
 *
 * total_power in watt. Aangenomen: plus = afnemen, min = terugleveren, net als
 * de HomeWizard P1; `node brug.mjs proef` zet ze naast elkaar om dat na te kijken.
 * Geeft het vermogen, of null als het geen P1-meter is.
 */
export function p1Uit(json) {
  const w = json?.total_power;
  return typeof w === 'number' && Number.isFinite(w) ? w : null;
}

/** Het vermogen van de Zendure P1-meter. `plek`: zoals bij leesZendureLokaal, op zijn deviceId. */
export async function leesZendureP1(adres, { plek = null } = {}) {
  const { status, json } = await vraagJson(`http://${adres}/properties/report`, { tijd: 3000, agent: LOKAAL_VERBINDING });
  const w = p1Uit(json);
  if (status !== 200 || w === null) throw new Error(`antwoordde ${status} zonder vermogen; klopt het adres?`);
  if (typeof json.deviceId === 'string') plek?.controleer(json.deviceId);
  return w;
}

/* ---------- Cloud ---------- */

/** Dezelfde vaste sleutel als de officiële Home Assistant-koppeling (const.py, CONF_HAKEY). */
const HA_SLEUTEL = 'C*dafwArEOXK';

/** De cloudsleutel is base64 van "<adres>.<appKey>", gesplitst bij de laatste punt. */
export function leesCloudsleutel(sleutel) {
  const tekst = Buffer.from(String(sleutel ?? '').trim(), 'base64').toString('utf8');
  const punt = tekst.lastIndexOf('.');
  const adres = tekst.slice(0, punt);
  const appKey = tekst.slice(punt + 1);
  if (punt < 1 || !/^https?:\/\/[^\s/]+/.test(adres) || !/^\S+$/.test(appKey)) {
    throw new Error('Dit lijkt geen Autorisatiecloudsleutel uit de Zendure-app. Kopieer hem opnieuw (Profiel › Autorisatiecloudsleutel › Ophalen).');
  }
  if (!isZendureAdres(adres)) {
    throw new Error('Deze cloudsleutel wijst niet naar Zendure (alleen https en een adres van zendure.tech, zendure.com of zendure.cn). Kopieer hem opnieuw uit de Zendure-app.');
  }
  return { adres, appKey };
}

/** De domeinen van de Zendure-cloud; src/lib/opAfstand.js heeft dezelfde lijst (zendure.test.js houdt ze gelijk). */
export const ZENDURE_DOMEINEN = Object.freeze(['zendure.tech', 'zendure.com', 'zendure.cn']);

/**
 * Wijst dit adres naar de Zendure-cloud (0.13.0)? Alleen https, poort 443, geen inlog in het
 * adres, en een host op een van de Zendure-domeinen. Zo kan een cloudsleutel (ook een die op
 * afstand is klaargezet) het programmaatje niet naar een server naar keuze sturen, of naar iets
 * in het eigen wifi.
 */
export function isZendureAdres(adres) {
  let url;
  try {
    url = new URL(adres);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return ZENDURE_DOMEINEN.some((d) => host === d || host.endsWith(`.${d}`));
}


/** SHA-1 (hoofdletters) over vaste sleutel + appKey, nonce, timestamp (op naam gesorteerd) + vaste sleutel. */
export function ondertekening(appKey, tijdstip, nonce) {
  const tekst = `${HA_SLEUTEL}appKey${appKey}nonce${nonce}timestamp${tijdstip}${HA_SLEUTEL}`;
  return createHash('sha1').update(tekst, 'utf8').digest('hex').toUpperCase();
}

/**
 * Wat er mis is met het antwoord van deviceList, in gewone woorden, of null.
 * Een weigering (401/403, of een antwoord dat zegt dat het niet mag) is iets
 * anders dan een cloud die even plat is (5xx): dan hoeft er geen nieuwe sleutel.
 */
export function cloudFout(status, json) {
  if (status === 200 && json?.code === 200 && json?.success) return null;
  if ((status >= 400 && status < 500) || (status === 200 && json && typeof json === 'object')) {
    return `Zendure weigert de cloudsleutel${json?.msg ? `: ${json.msg}` : ` (antwoord ${status})`}`;
  }
  return `de Zendure-cloud is even niet bereikbaar (antwoord ${status}); ik probeer het zo opnieuw`;
}

/** Bij Zendure de apparaten en de inlog voor hun berichtenserver (MQTT) ophalen. */
export async function haalCloudApparaten(cloudsleutel) {
  const { adres, appKey } = leesCloudsleutel(cloudsleutel);
  const tijdstip = Math.floor(Date.now() / 1000);
  const nonce = String(10000 + randomInt(90000));
  const { status, json } = await vraagJson(`${adres}/api/ha/deviceList`, {
    methode: 'POST',
    kop: { timestamp: String(tijdstip), nonce, clientid: 'zenHa', sign: ondertekening(appKey, tijdstip, nonce) },
    lichaam: { appKey },
    tijd: 10_000,
  });
  const fout = cloudFout(status, json);
  if (fout) throw new Error(fout);
  const { mqtt, deviceList } = json.data ?? {};
  if (!mqtt?.url || !mqtt?.clientId || !Array.isArray(deviceList) || deviceList.length === 0) {
    throw new Error('Zendure gaf geen apparaten terug voor deze sleutel');
  }
  return { mqtt, apparaten: deviceList.filter((a) => a?.productKey && a?.deviceKey) };
}

/** "host:poort" → { host, poort }; zonder poort 1883 (zoals Zendure-HA). */
export function serverUit(url) {
  const deel = String(url).replace(/^mqtts?:\/\//, '');
  const dubbelepunt = deel.lastIndexOf(':');
  if (dubbelepunt < 0) return { host: deel, poort: 1883 };
  return { host: deel.slice(0, dubbelepunt), poort: Number(deel.slice(dubbelepunt + 1)) || 1883 };
}

/** Bij welk apparaat hoort een bericht, en is het een stand? Onderwerpen: "/pk/dk/properties/report" of "iot/pk/dk/…". */
export function berichtVan(onderwerp) {
  const delen = String(onderwerp).split('/');
  if (delen.length < 5) return null;
  return { deviceKey: delen[2], soort: delen.slice(3).join('/') };
}

/**
 * Nieuwe eigenschappen over de oude heen; Zendure stuurt vaak alleen wat
 * veranderd is. De accu's (packData, naast de eigenschappen) komen onder
 * `packData`, per accu samengevoegd op het serienummer. Dat serienummer is
 * alleen hier, om ze uit elkaar te houden; het gaat nergens heen.
 */
export function verwerkBericht(oud, tekst) {
  let json;
  try {
    json = JSON.parse(tekst);
  } catch {
    return oud;
  }
  if (!json || typeof json !== 'object' || json.isHA) return oud;
  const eigenschappen = json.properties && typeof json.properties === 'object' && !Array.isArray(json.properties) ? json.properties : null;
  const accus = Array.isArray(json.packData) ? json.packData.filter((a) => a && typeof a === 'object' && typeof a.sn === 'string' && a.sn) : [];
  if (!eigenschappen && accus.length === 0) return oud;
  const uit = { ...oud, ...eigenschappen };
  if (accus.length) {
    const lijst = Array.isArray(oud?.packData) ? [...oud.packData] : [];
    for (const accu of accus) {
      const plek = lijst.findIndex((a) => a.sn === accu.sn);
      if (plek >= 0) lijst[plek] = { ...lijst[plek], ...accu };
      else if (lijst.length < HOOGSTENS_ACCUS) lijst.push(accu);
    }
    uit.packData = lijst;
  }
  return uit;
}

/**
 * Hoe lang een stand uit de cloud mag meetellen zonder nieuw bericht. Na 60 s
 * stilte vragen we al om alles; komt er dan nog niets, dan is hij weg (en
 * geen batterij die op een oud getal blijft staan).
 */
export const VERS_GENOEG_MS = 3 * 60_000;
/** Na zoveel stilte vragen we zelf om alles. */
const VRAAG_NA_MS = 60_000;

/**
 * Verbinding met de berichtenserver van Zendure, en de laatste stand per
 * apparaat bijhouden. MQTT 3.1 over gewone TCP, de client-id en inlog die
 * Zendure meegeeft, net als Zendure-HA.
 */
export async function volgZendureCloud(cloudsleutel, { log = () => {} } = {}) {
  let connect;
  try {
    ({ connect } = await import('mqtt'));
  } catch {
    throw new Error('Voor Zendure via de cloud is het pakket "mqtt" nodig: draai één keer "npm install" in de map brug.');
  }
  const { mqtt, apparaten } = await haalCloudApparaten(cloudsleutel);
  const { host, poort } = serverUit(mqtt.url);
  const staat = new Map(
    apparaten.map((a) => [a.deviceKey, { eigenschappen: {}, ontvangen: 0, gevraagd: 0, product: a.productModel || a.deviceName || '' }]),
  );
  let berichtnummer = 0;

  const client = connect({
    host,
    port: poort,
    protocol: 'mqtt',
    protocolId: 'MQIsdp',
    protocolVersion: 3,
    clientId: mqtt.clientId,
    username: mqtt.username,
    password: mqtt.password,
    clean: false,
    keepalive: 60,
    reconnectPeriod: 15_000,
    connectTimeout: 15_000,
  });

  const vraagAlles = (a) => {
    staat.get(a.deviceKey).gevraagd = Date.now();
    client.publish(
      `iot/${a.productKey}/${a.deviceKey}/properties/read`,
      JSON.stringify({ properties: ['getAll'], messageId: ++berichtnummer, deviceId: a.deviceKey, timestamp: Math.floor(Date.now() / 1000) }),
    );
  };

  // Eén regel als de verbinding wegvalt en één als hij er weer is, niet bij elke poging.
  let eerder = false;
  let weg = false;
  let geweigerd = false;
  let laatsteFout = '';
  client.on('connect', () => {
    if (!eerder) log(`Verbonden met Zendure (${apparaten.map((a) => a.deviceName || a.productModel || a.deviceKey).join(', ')})`);
    else if (weg) log('Zendure: weer verbonden.');
    eerder = true;
    weg = false;
    laatsteFout = '';
    for (const a of apparaten) {
      client.subscribe([`/${a.productKey}/${a.deviceKey}/#`, `iot/${a.productKey}/${a.deviceKey}/#`]);
      vraagAlles(a);
    }
  });
  client.on('message', (onderwerp, inhoud) => {
    const van = berichtVan(onderwerp);
    const s = van && staat.get(van.deviceKey);
    if (!s || van.soort !== 'properties/report') return;
    s.eigenschappen = verwerkBericht(s.eigenschappen, inhoud.toString('utf8'));
    s.ontvangen = Date.now();
  });
  // Zelf gestopt (afsluiten, of de reserve is niet meer nodig): dan is "weg" geen nieuws.
  let gestopt = false;
  client.on('close', () => {
    if (eerder && !weg && !gestopt) log('Zendure: de verbinding met de berichtenserver is weg; ik probeer het opnieuw.');
    weg = true;
  });
  client.on('error', (fout) => {
    // Geweigerde inlog (connack 4 of 5): mqtt.js probeert het dan niet meer; wij loggen opnieuw in (startZendure).
    if (fout?.code === 4 || fout?.code === 5 || /Bad username or password|Not authorized/i.test(fout?.message ?? '')) geweigerd = true;
    const tekst = inGewoneWoorden(fout);
    if (tekst !== laatsteFout) log(`Zendure: ${tekst}`);
    laatsteFout = tekst;
  });

  const nastuur = setInterval(() => {
    if (!client.connected) return;
    for (const a of apparaten) {
      const s = staat.get(a.deviceKey);
      if (Date.now() - s.ontvangen > VRAAG_NA_MS && Date.now() - s.gevraagd > VRAAG_NA_MS) vraagAlles(a);
    }
  }, 15_000);

  return {
    namen: apparaten.map((a) => a.deviceName || a.productModel || a.deviceKey),
    /** Wanneer het laatste bericht kwam (ms), of 0. */
    laatste: () => Math.max(0, ...[...staat.values()].map((s) => s.ontvangen)),
    /** Weigerde de berichtenserver de inlog? Dan opnieuw inloggen bij Zendure (nieuwe gegevens). */
    geweigerd: () => geweigerd,
    stand() {
      const vers = [...staat.values()].filter((s) => Date.now() - s.ontvangen < VERS_GENOEG_MS);
      if (!vers.length) return null;
      return {
        ...telOp(vers.map((s) => standUitEigenschappen(s.eigenschappen, { product: s.product }))),
        info: samenInfo(vers.map((s) => batterijInfoUit(s.eigenschappen))),
        // De eigenschappen van de eerste, alleen voor de kennislijst (kennis.mjs), als functie (zie leesZendureLokaal).
        kennis: () => veldenVan({ properties: vers[0].eigenschappen }),
      };
    },
    stop() {
      gestopt = true;
      clearInterval(nastuur);
      client.end(true);
    },
  };
}

/** Wachttijd na een mislukte inlog bij Zendure: oplopend, daarna elk kwartier. */
export const OPNIEUW_NA_MS = [60_000, 2 * 60_000, 5 * 60_000, 15 * 60_000];
/** Zo lang geen enkel bericht (ook niet na erom vragen), en we loggen opnieuw in; elke keer op rij wat langer. */
export const STIL_OPNIEUW_MS = [5 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000];

const uitRij = (rij, i) => rij[Math.min(i, rij.length - 1)];

/**
 * De Zendure-cloud volgen zonder ooit het programmaatje te laten stoppen.
 * Lukt de inlog niet (geen internet na een stroomstoring, de cloud even plat,
 * een geweigerde sleutel), dan op de achtergrond opnieuw (1, 2, 5, 15 min),
 * terwijl de meters, de prijzen en het versturen gewoon doorlopen. Komt er
 * minuten niets, of weigert de berichtenserver de inlog, dan opnieuw inloggen.
 *
 * lees() geeft de stand, of gooit een fout in gewone woorden (dan telt de
 * Zendure in de app als "geen antwoord").
 */
export function houdZendureCloud(cloudsleutel, { log = () => {}, verbind = volgZendureCloud, klok = Date.now } = {}) {
  let volger = null;
  let sinds = 0;
  let pogingen = 0;
  let stil = 0;
  let nietVoor = 0;
  let bezig = null;
  let gestopt = false;
  let laatsteFout = '';
  let namen = [];

  const wachtNaFout = () => {
    const wacht = uitRij(OPNIEUW_NA_MS, pogingen);
    pogingen += 1;
    nietVoor = klok() + wacht;
    return wacht;
  };

  const probeer = () => {
    if (bezig || gestopt) return bezig ?? Promise.resolve();
    bezig = (async () => {
      try {
        const nieuw = await verbind(cloudsleutel, { log });
        if (gestopt) {
          nieuw.stop();
          return;
        }
        volger = nieuw;
        sinds = klok();
        namen = nieuw.namen ?? [];
        if (laatsteFout) log('Zendure: inloggen lukt weer.');
        laatsteFout = '';
      } catch (fout) {
        const wacht = wachtNaFout();
        const tekst = inGewoneWoorden(fout);
        if (tekst !== laatsteFout) log(`Zendure: ${tekst}. Ik blijf meten en probeer het over ${wacht / 60_000} min opnieuw.`);
        laatsteFout = tekst;
      } finally {
        bezig = null;
      }
    })();
    return bezig;
  };

  return {
    /** De eerste inlog; gooit nooit. */
    start: () => probeer(),
    async lees() {
      const nu = klok();
      if (!volger) {
        if (nu >= nietVoor) probeer();
        throw new Error('nog niet verbonden met de Zendure-cloud');
      }
      const stand = volger.stand();
      if (stand) {
        pogingen = 0;
        stil = 0;
        return stand;
      }
      const laatste = Math.max(volger.laatste(), sinds);
      const geweigerd = volger.geweigerd();
      if (geweigerd || nu - laatste > uitRij(STIL_OPNIEUW_MS, stil)) {
        if (geweigerd) {
          log('Zendure: de berichtenserver weigert de inlog; ik log opnieuw in bij Zendure.');
          wachtNaFout();
        } else {
          log(`Zendure: al ${Math.round((nu - laatste) / 60_000)} minuten niets gehoord; ik log opnieuw in.`);
          stil += 1;
          nietVoor = 0;
        }
        volger.stop();
        volger = null;
        if (klok() >= nietVoor) probeer();
      }
      throw new Error('geen verse stand van de Zendure-cloud');
    },
    stop() {
      gestopt = true;
      volger?.stop();
    },
    get namen() {
      return namen;
    },
  };
}

/* ---------- Lokaal, met de cloud als reserve ---------- */

/** Zo lang moet de Zendure lokaal weer goed antwoorden voordat de reserveverbinding met de cloud dichtgaat. */
export const RESERVE_LOSLATEN_MS = 10 * 60_000;

/**
 * De Zendure lokaal lezen, met de cloud als reserve (instellingen: lokaal mét
 * cloudsleutel). Zolang hij lokaal antwoordt, is er geen cloudverbinding.
 *
 *   1e misser      nog niets (één gemiste lezing bij zwak wifi is gewoon)
 *   2e misser      de cloudverbinding opzetten, zodat hij er bij de volgende is
 *   3e misser      (WEG_NA_KEER, dezelfde drempel als de meters) en verder: de stand
 *                  uit de cloud, hooguit 3 minuten oud (VERS_GENOEG_MS); één logregel
 *   weer lokaal    meteen weer lokaal, één logregel; de cloudverbinding gaat pas dicht
 *                  als hij RESERVE_LOSLATEN_MS lang lokaal goed bleef (geen gefladder
 *                  van in- en uitloggen bij een haperende wifi)
 *
 * Waarom pas als het nodig is, en niet steeds op de achtergrond: Zendure laat
 * per account maar één cloudverbinding toe, en als het lokaal werkt is er geen
 * reden om die bezet te houden (of om berichten van internet te halen).
 *
 * lees() geeft de stand met `bron`: 'lokaal' of 'cloud-reserve'. Lukt ook de
 * cloud niet, dan de fout van lokaal (die zegt waar het om begon).
 */
export function zendureMetReserve(
  adres,
  cloudsleutel,
  { log = () => {}, leesLokaal = leesZendureLokaal, maakCloud = null, klok = Date.now, drempel = WEG_NA_KEER, loslatenNa = RESERVE_LOSLATEN_MS } = {},
) {
  // De cloud logt zijn eigen fouten (verkeerde sleutel, geen internet), maar niet het verbinden:
  // dat zegt de regel bij het overschakelen al.
  const cloudLog = (tekst) => {
    if (!/^Verbonden met Zendure/.test(tekst)) log(tekst.replace(/^Zendure:/, 'Zendure-cloud (reserve):'));
  };
  const nieuweCloud = maakCloud ?? ((sleutel) => houdZendureCloud(sleutel, { log: cloudLog }));
  let missers = 0;
  let cloud = null;
  let opReserve = false;
  let lokaalGoedSinds = null;
  // Het adres van nu: kreeg de Zendure een ander adres en vond het programmaatje hem terug (adressen.mjs), dan dat.
  const adresNu = typeof adres === 'function' ? adres : () => adres;

  return {
    async lees() {
      let fout;
      try {
        const stand = await leesLokaal(adresNu());
        missers = 0;
        if (opReserve) log('Zendure antwoordt weer lokaal; ik lees hem weer rechtstreeks, niet meer via de cloud.');
        opReserve = false;
        lokaalGoedSinds ??= klok();
        if (cloud && klok() - lokaalGoedSinds >= loslatenNa) {
          cloud.stop();
          cloud = null;
        }
        return { ...stand, bron: 'lokaal' };
      } catch (f) {
        fout = f;
      }
      missers += 1;
      lokaalGoedSinds = null;
      if (missers >= drempel - 1 && !cloud) {
        cloud = nieuweCloud(cloudsleutel);
        cloud.start();
      }
      if (missers < drempel) throw fout;
      let stand;
      try {
        stand = await cloud.lees();
      } catch {
        throw fout;
      }
      if (!opReserve) log(`Zendure antwoordt lokaal niet (${inGewoneWoorden(fout)}); ik gebruik de Zendure-cloud als reserve.`);
      opReserve = true;
      return { ...stand, bron: 'cloud-reserve' };
    },
    /** Komt de stand nu uit de cloud? */
    get opReserve() {
      return opReserve;
    },
    /** De namen uit de cloud, als die er (al) is. */
    get namen() {
      return cloud?.namen ?? [];
    },
    stop() {
      cloud?.stop();
      cloud = null;
    },
  };
}
