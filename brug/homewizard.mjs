import fs from 'node:fs';
import https from 'node:https';
import { AnderApparaat } from './kenmerk.mjs';
import { veldenVan } from './kennis.mjs';
import { LOKAAL_VERBINDING, slaap, VERBINDING_RUST_MS, vraagJson } from './web.mjs';

/**
 * HomeWizard-meters uitlezen: P1-meter (meterkast), kWh-meter, Energy Socket.
 * Allemaal via het eigen netwerk; HomeWizard heeft geen officiële koppeling
 * via internet. Bron: github.com/homewizard/api-documentation.
 *
 * Twee versies van hun API:
 *   v1  http://<adres>/api/v1/data        "Lokale API" aanzetten in de HomeWizard-app
 *   v2  https://<adres>/api/measurement   met een code (token) die je maakt door op
 *                                         de knop van het apparaat te drukken
 *                                         (node brug.mjs homewizard-code <adres>)
 * v1 doet het op elk apparaat, maar HomeWizard gaat hem ooit weghalen. v2 kan
 * nu op de P1-meter (vanaf firmware 6.00) en de kWh-meters.
 *
 * Tekens zoals HomeWizard ze geeft: bij de P1-meter is min terugleveren, bij
 * een kWh-meter op de omvormer is opwek min.
 */

const CA = fs.readFileSync(new URL('./homewizard-ca.pem', import.meta.url));

/**
 * TLS voor v2: het certificaat moet door HomeWizard zijn uitgegeven (hun eigen
 * CA, in homewizard-ca.pem) en op naam van een apparaat staan:
 * appliance/<soort>/<serienummer>. De gewone naamcontrole kan niet: we praten
 * met een IP-adres. Is het serienummer bekend, dan moet dat ook kloppen.
 * `gezien` krijgt de naam uit het certificaat (voor het zoeken).
 */
/**
 * Hoe zeker we weten dat de cijfers van deze meter komen, in een gewone zin;
 * null als het goed zit (v2 met code en serienummer). Voor proef en het begin
 * van het logboek.
 */
export function zwakkeControle(meter) {
  if (!meter.code) {
    return `${meter.naam}: zonder code (API v1) gaat het programmaatje alleen via /api na of op ${meter.adres} nog dezelfde meter zit. Veiliger met een code: node brug.mjs homewizard-code ${meter.adres}`;
  }
  if (!meter.serienummer) {
    return `${meter.naam}: zonder serienummer telt elk HomeWizard-certificaat. Zet het erbij met: node brug.mjs instellen`;
  }
  return null;
}

export function tlsVoor(serienummer, gezien) {
  return {
    ca: CA,
    checkServerIdentity: (_naam, certificaat) => {
      const cn = certificaat?.subject?.CN ?? '';
      gezien?.(cn);
      const vorm = /^appliance\/[a-z0-9]+\/[0-9a-f]{12}$/i.test(cn);
      const zelfde = !serienummer || cn.toLowerCase().endsWith(`/${serienummer.toLowerCase()}`);
      return vorm && zelfde ? undefined : new Error(`certificaat hoort niet bij deze HomeWizard (${cn || 'zonder naam'})`);
    },
  };
}

const getal = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Het vermogen in watt uit een antwoord van v1 (/api/v1/data) of v2 (/api/measurement). */
export function vermogenUit(json) {
  return getal(json?.power_w ?? json?.active_power_w);
}

/**
 * De tellerstanden in kWh: alles wat ooit is afgenomen en teruggeleverd (alle
 * tarieven samen). Het verschil tussen twee lezingen is precies wat er in die
 * tussentijd door de meter ging; daarmee rekenen de kosten (prijzen.mjs).
 */
export function tellersUit(json) {
  return {
    afname_kwh: getal(json?.energy_import_kwh ?? json?.total_power_import_kwh),
    teruglevering_kwh: getal(json?.energy_export_kwh ?? json?.total_power_export_kwh),
  };
}

/**
 * Per fase wat de meter ziet: vermogen (met teken, zoals de meter: min =
 * terugleveren op die fase), stroom (zonder teken) en spanning.
 *   v1 (/api/v1/data):     active_power_l1_w, active_current_l1_a, active_voltage_l1_v
 *   v2 (/api/measurement): power_l1_w, current_l1_a, voltage_l1_v
 * Een fase die er niet is (eenfase-aansluiting) laten we weg. Geeft de meter
 * geen stroom maar wel vermogen en spanning, dan rekenen we hem uit.
 */
export function fasenUit(json) {
  const uit = [];
  for (const fase of [1, 2, 3]) {
    const w = getal(json?.[`power_l${fase}_w`] ?? json?.[`active_power_l${fase}_w`]);
    let a = getal(json?.[`current_l${fase}_a`] ?? json?.[`active_current_l${fase}_a`]);
    const v = getal(json?.[`voltage_l${fase}_v`] ?? json?.[`active_voltage_l${fase}_v`]);
    if (w === null && a === null) continue;
    if (a === null && w !== null && v > 50) a = Math.abs(w) / v;
    uit.push({ fase, w, a: a === null ? null : Math.abs(a), v });
  }
  return uit;
}

/**
 * De spanning per fase (1.5.0, voor de spanningswacht in spanning.mjs), ook van een kWh-meter:
 *   eenfase   v1 active_voltage_v, v2 voltage_v               → [{ fase: 1, v }]
 *   driefase  v1 active_voltage_l1_v…, v2 voltage_l1_v…       → [{ fase, v }]
 * Alleen wat op een netspanning lijkt (150–300 V); niets: een lege lijst.
 */
export function spanningUit(json) {
  const goed = (v) => (v !== null && v > 150 && v < 300 ? Math.round(v * 10) / 10 : null);
  const uit = [];
  for (const fase of [1, 2, 3]) {
    const v = goed(getal(json?.[`voltage_l${fase}_v`] ?? json?.[`active_voltage_l${fase}_v`]));
    if (v !== null) uit.push({ fase, v });
  }
  if (uit.length) return uit;
  const een = goed(getal(json?.voltage_v ?? json?.active_voltage_v));
  return een === null ? [] : [{ fase: 1, v: een }];
}

/**
 * Wat er van één antwoord (v1 of v2) gebruikt wordt. `meterkast` (1.4.0): tarief, gas en
 * meer (meterkastUit); `kennis`: maakt pas als het gevraagd wordt de lijst met veldnamen
 * van één keer per dag (veldenVan in kennis.mjs, die haalt er alles uit wat iemand herkent).
 * Een functie, dus het antwoord zelf (met unique_id en wifinaam) komt nooit in JSON terecht.
 */
export function lezingUit(json) {
  return { w: vermogenUit(json), tellers: tellersUit(json), fasen: fasenUit(json), spanning: spanningUit(json), storingen: storingenUit(json), meterkast: meterkastUit(json), kennis: () => veldenVan(json) };
}

/* ---------- De meterkast: tarief, piek, gas, water en warmte (1.4.0) ---------- */

/**
 * De soorten meters die aan de slimme meter kunnen hangen (external[].type, zie
 * api-documentation.homewizard.com: gas_meter, heat_meter, warm_water_meter,
 * water_meter, inlet_heat_meter), met de naam in de app. Een nieuwe soort laten we weg.
 */
export const METER_SOORTEN = Object.freeze({ gas_meter: 'gas', water_meter: 'water', heat_meter: 'warmte', warm_water_meter: 'warm_water', inlet_heat_meter: 'warmte_in' });
/** De eenheden die we kennen (external[].unit); "m3" en "GJ" staan in de documentatie. */
export const METER_EENHEDEN = Object.freeze({ m3: 'm3', 'm³': 'm3', gj: 'GJ', kwh: 'kWh', mwh: 'MWh' });

const UUR_NL = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Amsterdam',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});
const alsNl = (ms) => UUR_NL.format(new Date(ms)).replace(', ', 'T');

/**
 * Een tijd van de slimme meter (Nederlandse tijd, zonder zone) als ISO in UTC:
 *   v1  getal JJMMDDuummss   210606140010 → 2021-06-06 14:00:10
 *   v2  tekst "2024-06-28T14:12:34"
 * Bij het uur dat dubbel is (de klok gaat terug) het eerste. Wat niet klopt: null.
 */
export function meterTijd(waarde) {
  let delen = null;
  if (typeof waarde === 'number' && Number.isInteger(waarde) && waarde > 0) {
    const t = String(waarde).padStart(12, '0');
    if (t.length === 12) delen = [`20${t.slice(0, 2)}`, t.slice(2, 4), t.slice(4, 6), t.slice(6, 8), t.slice(8, 10), t.slice(10, 12)];
  } else if (typeof waarde === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(waarde.trim());
    if (m) delen = m.slice(1);
  }
  if (!delen) return null;
  const [j, mo, d, u, mi, se] = delen.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || u > 23 || mi > 59 || se > 59) return null;
  const lokaal = `${delen[0]}-${delen[1]}-${delen[2]}T${delen[3]}:${delen[4]}:${delen[5]}`;
  // Nederland is UTC+1 (winter) of UTC+2 (zomer): het eerste dat terugrekent naar dezelfde klok.
  for (const uren of [2, 1]) {
    const ms = Date.UTC(j, mo - 1, d, u - uren, mi, se);
    if (alsNl(ms) === lokaal) return new Date(ms).toISOString();
  }
  return null;
}

const standGetal = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 100_000_000 ? Math.round(v * 1000) / 1000 : null);

/**
 * Wat de P1-meter verder over de meterkast weet (1.4.0), of null als er niets is
 * (een kWh-meter, of een meter zonder deze velden):
 *   tarief        het tarief van nu (v1 active_tariff, v2 tariff): in Nederland 1 = dal, 2 = normaal
 *   gemiddeld_w   het gemiddelde van het lopende kwartier (v1 active_power_average_w, v2 average_power_15m_w)
 *   maandpiek_w   de hoogste kwartiergemiddelde van deze maand, en maandpiek_op wanneer
 *                 (v1 montly_power_peak_w, met die spelfout; v2 monthly_power_peak_w); vooral in België
 *   meters        wat er aan de slimme meter hangt: [{ soort, stand, eenheid, op }]; uit external[],
 *                 en anders total_gas_m3 met gas_timestamp (v1, de eerste gasmeter)
 * Nooit unique_id, unique_gas_id of de wifinaam: die gaan nergens heen.
 */
export function meterkastUit(json) {
  if (!json || typeof json !== 'object') return null;
  const uit = {};
  const tarief = json.active_tariff ?? json.tariff;
  if (Number.isInteger(tarief) && tarief >= 1 && tarief <= 4) uit.tarief = tarief;
  const gemiddeld = getal(json.active_power_average_w ?? json.average_power_15m_w);
  if (gemiddeld !== null && Math.abs(gemiddeld) <= 100_000) uit.gemiddeld_w = Math.round(gemiddeld);
  const piek = getal(json.monthly_power_peak_w ?? json.montly_power_peak_w);
  if (piek !== null && piek >= 0 && piek <= 100_000) {
    uit.maandpiek_w = Math.round(piek);
    const op = meterTijd(json.monthly_power_peak_timestamp ?? json.montly_power_peak_timestamp);
    if (op) uit.maandpiek_op = op;
  }
  const meters = [];
  const gezien = new Set();
  for (const e of Array.isArray(json.external) ? json.external.slice(0, 10) : []) {
    const soort = METER_SOORTEN[e?.type];
    const eenheid = METER_EENHEDEN[String(e?.unit ?? '').toLowerCase()];
    const stand = standGetal(e?.value);
    if (!soort || !eenheid || stand === null || gezien.has(soort)) continue;
    gezien.add(soort);
    const op = meterTijd(e.timestamp);
    meters.push({ soort, stand, eenheid, ...(op ? { op } : {}) });
  }
  const gas = standGetal(json.total_gas_m3);
  if (!gezien.has('gas') && gas !== null) {
    const op = meterTijd(json.gas_timestamp);
    meters.unshift({ soort: 'gas', stand: gas, eenheid: 'm3', ...(op ? { op } : {}) });
  }
  if (meters.length) uit.meters = meters;
  return Object.keys(uit).length ? uit : null;
}

/** Het tarief in woorden, zoals in Nederland: 1 is dal (laag), 2 normaal (hoog). In België is het andersom. */
export const TARIEF_WOORD = Object.freeze({ 1: 'daltarief', 2: 'normaal tarief', 3: 'tarief 3', 4: 'tarief 4' });
const METER_NAAM = { gas: 'gasmeter', water: 'watermeter', warmte: 'warmtemeter', warm_water: 'warmwatermeter', warmte_in: 'warmtemeter (inlaat)' };
const EENHEID = { m3: 'm³', GJ: 'GJ', kWh: 'kWh', MWh: 'MWh' };

/** De meterkast in gewone woorden, voor `node brug.mjs proef`. Niets: een lege lijst. */
export function meterkastZinnen(m) {
  if (!m) return [];
  const regels = [];
  const getalNl = (v, d = 3) => v.toLocaleString('nl-NL', { maximumFractionDigits: d });
  if (m.tarief) regels.push(`de slimme meter telt nu op ${TARIEF_WOORD[m.tarief]}`);
  if (m.gemiddeld_w !== undefined) regels.push(`gemiddeld dit kwartier ${getalNl(m.gemiddeld_w, 0)} W`);
  if (m.maandpiek_w !== undefined) regels.push(`hoogste kwartier deze maand ${getalNl(m.maandpiek_w, 0)} W`);
  for (const meter of m.meters ?? []) {
    const tijd = meter.op ? ` (${UUR_MIN.format(new Date(meter.op))})` : '';
    const vandaag = meter.vandaag !== undefined ? `, vandaag ${getalNl(meter.vandaag)} ${EENHEID[meter.eenheid]}` : '';
    regels.push(`${METER_NAAM[meter.soort] ?? meter.soort}: stand ${getalNl(meter.stand)} ${EENHEID[meter.eenheid] ?? meter.eenheid}${tijd}${vandaag}`);
  }
  return regels;
}

/**
 * Per meter één blijvende verbinding voor v2 (prestaties-15, 1.3.0): de TLS-controle (CA en
 * serienummer) gebeurt als de verbinding gemaakt wordt; daarna praat hij over dezelfde
 * verbinding met dezelfde meter. Per adres en serienummer een eigen, zodat een verbinding nooit
 * bij een andere controle hergebruikt wordt.
 */
const V2_VERBINDINGEN = new Map();
function v2Verbinding(meter) {
  const sleutel = `${meter.adres}|${meter.serienummer ?? ''}`;
  let agent = V2_VERBINDINGEN.get(sleutel);
  if (!agent) {
    // Adressen veranderen zelden; groeit de lijst toch, dan opnieuw beginnen.
    if (V2_VERBINDINGEN.size >= 20) vergeetV2();
    agent = new https.Agent({ keepAlive: true, maxSockets: 1, timeout: VERBINDING_RUST_MS });
    V2_VERBINDINGEN.set(sleutel, agent);
  }
  return agent;
}
function vergeetV2(meter) {
  for (const [sleutel, agent] of V2_VERBINDINGEN) {
    if (meter && !sleutel.startsWith(`${meter.adres}|`)) continue;
    agent.destroy();
    V2_VERBINDINGEN.delete(sleutel);
  }
}

/**
 * Leest één meter. v2 als er een code is, anders v1. Geeft { w, tellers, fasen }
 * of gooit een fout in gewone woorden.
 *
 * `plek` (adressen.mjs, sinds 1.3.0): wat we van deze meter weten. Bij v2 zegt het
 * certificaat van elke nieuwe verbinding welke meter het is; bij v1 /api (zelfdeMeterV1).
 * Is het een andere, dan AnderApparaat en zoekt het programmaatje de goede.
 */
export async function leesHomeWizard(meter, { plek = null } = {}) {
  if (meter.code) {
    let cn = '';
    const { status, json } = await vraagJson(`https://${meter.adres}/api/measurement`, {
      kop: { authorization: `Bearer ${meter.code}`, 'x-api-version': '2' },
      tls: tlsVoor(meter.serienummer, (naam) => (cn = naam)),
      agent: v2Verbinding(meter),
    });
    if (cn && plek) {
      try {
        plek.controleer(cn.split('/')[2]);
      } catch (fout) {
        // Niet over deze verbinding blijven praten: de volgende keer weer een nieuwe, met controle.
        vergeetV2(meter);
        throw fout;
      }
    }
    if (status === 401) throw new Error(`de code klopt niet meer; maak een nieuwe met: node brug.mjs homewizard-code ${meter.adres}`);
    if (status !== 200) throw new Error(`HomeWizard antwoordde ${status}`);
    return lezingUit(json);
  }
  try {
    const { status, json, nieuw } = await vraagJson(`http://${meter.adres}/api/v1/data`, { agent: LOKAAL_VERBINDING });
    if (status === 403) {
      throw new Error('de Lokale API staat uit; maak een code met: node brug.mjs homewizard-code (dan hoeft die niet aan)');
    }
    if (status !== 200) throw new Error(`HomeWizard antwoordde ${status}`);
    // Na de cijfers, over dezelfde verbinding: is dit nog dezelfde meter? Klopt het niet, dan tellen ze niet.
    await zelfdeMeterV1(meter, { plek, nieuw });
    return lezingUit(json);
  } catch (fout) {
    // Na een misser opnieuw nagaan (een ander apparaat blijft onthouden tot het volgende uur of een ander adres).
    if (fout?.code !== 'ANDER_APPARAAT') serienummerGezien.delete(meter.sleutel);
    throw fout;
  }
}

/** Zo vaak kijken we bij v1 sowieso of op het adres nog dezelfde meter zit (en bij elke nieuwe verbinding). */
export const SERIENUMMER_ELKE_MS = 10 * 60_000;
const serienummerGezien = new Map();

/**
 * Bij v1 is er geen certificaat dat het serienummer bewaakt (v2 wel, zie
 * tlsVoor). Deelt de router de adressen anders uit, dan kan er op het oude
 * adres een andere HomeWizard zitten, en zou die stilletjes meetellen
 * (bijvoorbeeld een stekker als zonnepanelen). Daarom /api lezen en het
 * serienummer vergelijken: bij het starten, bij elke nieuwe verbinding
 * (`nieuw`), na een misser, bij een ander adres en elke SERIENUMMER_ELKE_MS.
 * Lukt dat lezen niet, dan niet tegenhouden (dat merkt de gewone lezing zelf
 * wel). Met `plek` (adressen.mjs) vergelijkt die, en leert hij het kenmerk als
 * het nog niet bekend is; anders het serienummer uit de instellingen.
 */
export async function zelfdeMeterV1(meter, { plek = null, nieuw = false, nu = Date.now(), gezien = serienummerGezien, vraag = vraagJson } = {}) {
  if (!meter.serienummer && !plek) return;
  const vorig = gezien.get(meter.sleutel);
  if (vorig && vorig.adres === meter.adres && !(nieuw && !vorig.ander) && nu - vorig.moment < SERIENUMMER_ELKE_MS) {
    if (vorig.ander) throw new AnderApparaat(vorig.ander);
    return;
  }
  let serial = null;
  try {
    const { status, json } = await vraag(`http://${meter.adres}/api`, { tijd: 3000, agent: LOKAAL_VERBINDING });
    if (status === 200 && typeof json?.serial === 'string') serial = json.serial.toLowerCase();
  } catch {
    // Geen antwoord: de gewone lezing zegt dat zelf.
  }
  if (serial === null) return;
  let ander = null;
  if (plek) {
    try {
      plek.controleer(serial);
    } catch (fout) {
      ander = fout.message;
    }
  } else if (serial !== meter.serienummer.toLowerCase()) {
    // Zonder serienummer in de melding: die gaat ook naar de app.
    ander = 'op dit adres zit nu een andere HomeWizard; zoek de meter opnieuw met: node brug.mjs instellen';
  }
  gezien.set(meter.sleutel, { adres: meter.adres, moment: nu, ander });
  if (ander) throw new AnderApparaat(ander);
}

/**
 * Een code (token) voor v2 maken. HomeWizard geeft hem pas als je op de knop
 * van het apparaat drukt (bij een kWh-meter 1 tot 3 seconden); tot die tijd
 * vragen we elke 2 seconden opnieuw, hooguit `wacht` milliseconden lang.
 * Dezelfde naam opnieuw gebruiken maakt de oude code ongeldig.
 */
export async function maakCode(adres, { naam = 'local/thuis-energie', wacht = 90_000, opKnopWachten } = {}) {
  const eind = Date.now() + wacht;
  let gemeld = false;
  while (Date.now() < eind) {
    const { status, json } = await vraagJson(`https://${adres}/api/user`, {
      methode: 'POST',
      kop: { 'x-api-version': '2' },
      lichaam: { name: naam },
      tls: tlsVoor(),
    });
    if (status === 200 && typeof json?.token === 'string') return json.token;
    if (status === 403 && json?.error === 'user:creation-not-enabled') {
      if (!gemeld) opKnopWachten?.();
      gemeld = true;
      await slaap(2000);
      continue;
    }
    throw new Error(`HomeWizard antwoordde ${status}${json?.error ? ` (${json.error})` : ''}`);
  }
  throw new Error('Er is niet op tijd op de knop gedrukt. Probeer het nog eens.');
}

/**
 * Wat de P1-meter telt aan storingen op het net (0.13.0; v1 en v2 gebruiken dezelfde namen):
 * stroomonderbrekingen (any_power_fail_count), lange (long_power_fail_count, langer dan 3 minuten),
 * en per fase spanningsdips (voltage_sag_lN_count) en -pieken (voltage_swell_lN_count). Tellers
 * van de slimme meter zelf: ze lopen alleen op. Null als de meter ze niet geeft (een kWh-meter).
 */
export function storingenUit(json) {
  const fasen = (soort) => [1, 2, 3].map((f) => getal(json?.[`voltage_${soort}_l${f}_count`]));
  const uit = { uitval: getal(json?.any_power_fail_count), lang: getal(json?.long_power_fail_count), dip: fasen('sag'), piek: fasen('swell') };
  return uit.uitval === null && uit.lang === null && [...uit.dip, ...uit.piek].every((v) => v === null) ? null : uit;
}

/** Zo lang staat een gemeten storing op het net als melding in de app (en dus één keer in het logboek). */
export const NET_STORING_MELDING_MS = 15 * 60_000;
const UUR_MIN = new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit' });

/**
 * Houdt de storingstellers van de P1-meter bij (0.13.0). Loopt een teller op ten opzichte van
 * de vorige lezing, dan is er net iets gebeurd: een regel in het logboek en een kwartier een
 * melding in de app ("Meterkast: spanningsdip op L2 gemeten (21:14)"); die komt via de
 * meldingen ook in het Logboek op Apparaten. Alleen kijken: de eerste lezing is het beginpunt,
 * en zakt een teller (een nieuwe meter), dan begint hij daar opnieuw.
 */
export function netStoringVolger({ duur = NET_STORING_MELDING_MS } = {}) {
  let vorig = null;
  let open = [];
  const erbij = (oud, nieuw) => (oud !== null && nieuw !== null && nieuw > oud ? nieuw - oud : 0);
  return {
    /** Een lezing van de P1-meter: geeft de nieuwe zinnen (voor het logboek). */
    ronde(storingen, nu, naam = 'Meterkast') {
      if (!storingen) return [];
      const nieuw = [];
      if (vorig) {
        const keer = (n) => (n > 1 ? ` (${n} keer)` : '');
        const lang = erbij(vorig.lang, storingen.lang);
        const kort = Math.max(0, erbij(vorig.uitval, storingen.uitval) - lang);
        if (lang) nieuw.push(`lange stroomonderbreking${keer(lang)}`);
        if (kort) nieuw.push(`korte stroomonderbreking${keer(kort)}`);
        for (const [soort, woord] of [['dip', 'spanningsdip'], ['piek', 'spanningspiek']]) {
          storingen[soort].forEach((v, i) => {
            const n = erbij(vorig[soort][i], v);
            if (n) nieuw.push(`${woord} op L${i + 1}${keer(n)}`);
          });
        }
      }
      // Per teller het nieuwe beginpunt; een teller die even ontbreekt, houdt zijn oude waarde.
      const houd = (oud, v) => (v === null ? oud : v);
      vorig = vorig
        ? { uitval: houd(vorig.uitval, storingen.uitval), lang: houd(vorig.lang, storingen.lang), dip: storingen.dip.map((v, i) => houd(vorig.dip[i], v)), piek: storingen.piek.map((v, i) => houd(vorig.piek[i], v)) }
        : storingen;
      const zinnen = nieuw.map((wat) => `${naam}: ${wat} gemeten (${UUR_MIN.format(nu)})`);
      for (const tekst of zinnen) open.push({ tekst, sinds: nu });
      return zinnen;
    },
    /** Wat er nu als melding meegaat: { tekst, sinds } van het laatste kwartier, nieuwste eerst, hooguit drie. */
    meldingen(nu) {
      open = open.filter((m) => nu - m.sinds < duur);
      return [...open].reverse().slice(0, 3);
    },
  };
}
