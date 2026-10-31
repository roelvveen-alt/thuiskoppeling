import crypto from 'node:crypto';
import { vraagJson } from './web.mjs';

/**
 * Eén keer, in de instelhulp: de local keys van je Tuya-apparaten ophalen
 * bij de Tuya-cloud, met de Access ID en het Access Secret van een eigen
 * cloudproject op iot.tuya.com (gekoppeld aan je Smart Life-account).
 * Daarna praat het programmaatje alleen nog lokaal (tuya.mjs). Het Access
 * Secret wordt nergens bewaard; de instelhulp vraagt het een volgende keer
 * opnieuw. Alleen lezen: we vragen alleen lijsten op.
 *
 * Ondertekenen zoals Tuya het beschrijft (developer.tuya.com, "Sign
 * requests"; zo ook tuya-connector-python en tinytuya Cloud.py):
 *
 *   sign = HEX(HMAC-SHA256(secret, client_id + access_token + t + stringToSign)), hoofdletters
 *   stringToSign = METHODE \n SHA256(body) \n (geen extra koppen) \n pad?gesorteerde-query
 *
 * Vragen:
 *   GET /v1.0/token?grant_type=1                          een token (zonder access_token getekend)
 *   GET /v1.0/iot-01/associated-users/devices?size=50     de apparaten van de gekoppelde app-accounts,
 *                                                         met local_key (bladeren met last_row_key)
 *   GET /v1.1/devices/{id}/specifications                 welke datapunten (dp_id) en schaal
 */

/** De datacentra (tinytuya Cloud.py). In Nederland meestal Central Europe. */
export const TUYA_REGIOS = Object.freeze({
  eu: 'https://openapi.tuyaeu.com',
  weu: 'https://openapi-weaz.tuyaeu.com',
  us: 'https://openapi.tuyaus.com',
  cn: 'https://openapi.tuyacn.com',
  in: 'https://openapi.tuyain.com',
});

const sha256 = (tekst) => crypto.createHash('sha256').update(tekst, 'utf8').digest('hex');

/** Het pad met de query op alfabet, zoals hij getekend wordt (en verstuurd). */
export function padMetQuery(pad, query = {}) {
  const sleutels = Object.keys(query).filter((k) => query[k] !== undefined && query[k] !== null).sort();
  return sleutels.length ? `${pad}?${sleutels.map((k) => `${k}=${query[k]}`).join('&')}` : pad;
}

/** De handtekening van één vraag. */
export function teken({ clientId, secret, t, accessToken = '', methode = 'GET', pad, body = '' }) {
  const stringToSign = `${methode}\n${sha256(body)}\n\n${pad}`;
  return crypto
    .createHmac('sha256', secret)
    .update(`${clientId}${accessToken}${t}${stringToSign}`, 'utf8')
    .digest('hex')
    .toUpperCase();
}

/** Wat Tuya terugzegt, in gewone woorden (de bekendste codes). */
export function cloudFout(json, status) {
  const code = json?.code;
  const msg = typeof json?.msg === 'string' ? json.msg : '';
  if (code === 1004 || /sign invalid/i.test(msg)) return 'Tuya weigert de handtekening: klopt het Access Secret?';
  if (code === 1005 || code === 2009 || /clientId is invalid/i.test(msg)) return 'Tuya kent deze Access ID niet: klopt hij, en het datacentrum (Central Europe)?';
  if (code === 1010 || code === 1011) return 'het token van Tuya is verlopen; probeer het opnieuw';
  if (code === 1106 || code === 28841105 || /permission/i.test(msg)) {
    return 'het cloudproject mag dit niet: koppel je app-account (Devices › Link App Account) en zet de API "IoT Core" aan (Service API)';
  }
  if (code === 1100 || code === 1013) return 'de klok van dit apparaat loopt te veel uit de pas met Tuya; zet de tijd goed';
  return `Tuya antwoordde ${status}${code ? ` (code ${code}${msg ? `: ${msg}` : ''})` : ''}`;
}

/**
 * Een verbinding met de Tuya-cloud: één token, dan getekende GET-vragen.
 * @param {{ accessId: string, secret: string, regio?: string, basis?: string, vraag?: Function, klok?: () => number }} o
 */
export function tuyaCloud({ accessId, secret, regio = 'eu', basis = TUYA_REGIOS[regio] ?? TUYA_REGIOS.eu, vraag = vraagJson, klok = Date.now }) {
  let token = '';
  const haal = async (pad, query = {}) => {
    const volledig = padMetQuery(pad, query);
    const t = String(klok());
    const kop = {
      client_id: accessId,
      sign: teken({ clientId: accessId, secret, t, accessToken: token, pad: volledig }),
      t,
      sign_method: 'HMAC-SHA256',
      ...(token ? { access_token: token } : {}),
    };
    const { status, json } = await vraag(`${basis}${volledig}`, { kop, tijd: 10_000 });
    if (status !== 200 || json?.success !== true) throw new Error(cloudFout(json, status));
    return json.result;
  };
  return {
    async verbind() {
      token = '';
      const result = await haal('/v1.0/token', { grant_type: 1 });
      if (typeof result?.access_token !== 'string' || !result.access_token) throw new Error('Tuya gaf geen token');
      token = result.access_token;
    },
    haal,
  };
}

/** Hooguit zoveel bladzijden van 50 apparaten. */
const HOOGSTENS_BLADZIJDEN = 10;

const tekstOf = (v, max = 80) => (typeof v === 'string' ? v.slice(0, max) : '');

/**
 * Welke datapunten een apparaat heeft, uit de cloudspecificatie: het nummer
 * en de schaal van vermogen (cur_power), aan/uit (switch_1, switch,
 * switch_led) en helderheid (bright_value_v2, bright_value).
 * Geeft { dp, wat } (wat: 'meter', 'lamp', 'schakelaar' of null als we het niet weten).
 */
export function dpUitSpecificatie(spec) {
  const lijst = [...(Array.isArray(spec?.status) ? spec.status : []), ...(Array.isArray(spec?.functions) ? spec.functions : [])];
  const zoek = (...codes) => {
    for (const code of codes) {
      const gevonden = lijst.find((s) => s?.code === code && Number.isInteger(s?.dp_id));
      if (gevonden) return gevonden;
    }
    return null;
  };
  const waarden = (s) => {
    try {
      return typeof s?.values === 'string' ? JSON.parse(s.values) : (s?.values ?? {});
    } catch {
      return {};
    }
  };
  const dp = {};
  const vermogen = zoek('cur_power');
  if (vermogen) {
    dp.vermogen = vermogen.dp_id;
    const schaal = waarden(vermogen).scale;
    dp.schaal = Number.isInteger(schaal) && schaal >= 0 && schaal <= 4 ? schaal : 1;
  }
  const aan = zoek('switch_1', 'switch', 'switch_led');
  if (aan) dp.aan = aan.dp_id;
  const helder = zoek('bright_value_v2', 'bright_value');
  if (helder) {
    dp.helderheid = helder.dp_id;
    const w = waarden(helder);
    if (Number.isFinite(w.max) && w.max > 0) dp.helderheid_max = w.max;
    if (Number.isFinite(w.min) && w.min >= 0) dp.helderheid_min = w.min;
  }
  const wat = dp.vermogen !== undefined ? 'meter' : dp.helderheid !== undefined || spec?.category === 'dj' ? 'lamp' : dp.aan !== undefined ? 'schakelaar' : null;
  return { dp, wat };
}

/**
 * Alle apparaten van de gekoppelde app-accounts, met naam, id, local_key en
 * wat we van de datapunten weten. Gooit een fout in gewone woorden.
 * ip uit de cloud is het adres van je internetaansluiting, niet dat in de wifi; dat zoeken we lokaal.
 */
export async function haalTuyaApparaten(o) {
  const cloud = tuyaCloud(o);
  await cloud.verbind();
  const ruw = [];
  let rij = null;
  for (let n = 0; n < HOOGSTENS_BLADZIJDEN; n++) {
    const result = await cloud.haal('/v1.0/iot-01/associated-users/devices', { size: 50, ...(rij ? { last_row_key: rij } : {}) });
    ruw.push(...(Array.isArray(result?.devices) ? result.devices : []));
    if (!result?.has_more || typeof result.last_row_key !== 'string' || !result.last_row_key) break;
    rij = result.last_row_key;
  }
  const apparaten = [];
  for (const a of ruw) {
    if (!a || typeof a.id !== 'string' || !/^[a-zA-Z0-9]{10,40}$/.test(a.id)) continue;
    let dp = {};
    let wat = null;
    try {
      ({ dp, wat } = dpUitSpecificatie(await cloud.haal(`/v1.1/devices/${a.id}/specifications`)));
    } catch {
      // Zonder specificatie: de gewone datapunten (dpVoor in tuya.mjs).
    }
    apparaten.push({
      id: a.id,
      naam: tekstOf(a.name, 40) || tekstOf(a.product_name, 40) || a.id,
      local_key: typeof a.local_key === 'string' && a.local_key.length === 16 ? a.local_key : null,
      product: tekstOf(a.product_name, 60),
      categorie: tekstOf(a.category, 10),
      online: a.online === true,
      // Een sub-apparaat (Zigbee/Bluetooth achter een gateway) praat niet zelf in de wifi.
      sub: a.sub === true,
      dp,
      wat,
    });
  }
  return apparaten;
}
