import crypto from 'node:crypto';
import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { cloudFout, dpUitSpecificatie, haalTuyaApparaten, padMetQuery, teken } from './tuyaCloud.mjs';

const ID = 'abcdefghijklmnopqrst';
const GEHEIM = '0123456789abcdef0123456789abcdef';
const T = 1_700_000_000_000;

describe('ondertekenen zoals Tuya (tuya-connector-python)', () => {
  // De verwachte waarden zijn uitgerekend met het algoritme van tuya_connector/openapi.py (_calculate_sign).
  it('de token-vraag, zonder access_token', () => {
    expect(teken({ clientId: ID, secret: GEHEIM, t: T, pad: padMetQuery('/v1.0/token', { grant_type: 1 }) })).toBe(
      '1B971E3A683FA9F3B08C23BBE9EC55D06B71272DFCFF35FC9AC88A7C7185AC69',
    );
  });
  it('een vraag met token en een query op alfabet', () => {
    const pad = padMetQuery('/v1.0/iot-01/associated-users/devices', { size: 50, last_row_key: 'ROW9' });
    expect(pad).toBe('/v1.0/iot-01/associated-users/devices?last_row_key=ROW9&size=50');
    expect(teken({ clientId: ID, secret: GEHEIM, t: T, accessToken: 'tok123', pad })).toBe('77739070B2665CD095E25461CF01286EA433952D774B6551969B3D9228CF9200');
  });
});

describe('cloudFout', () => {
  it('bekende codes in gewone woorden', () => {
    expect(cloudFout({ code: 1004, msg: 'sign invalid' }, 200)).toMatch(/Access Secret/);
    expect(cloudFout({ code: 28841105, msg: 'No permissions' }, 200)).toMatch(/Link App Account/);
    expect(cloudFout({ code: 9999, msg: 'iets' }, 200)).toBe('Tuya antwoordde 200 (code 9999: iets)');
  });
});

describe('dpUitSpecificatie', () => {
  it('meetschakelaar: aan/uit en vermogen met schaal', () => {
    const spec = {
      category: 'cz',
      status: [
        { code: 'switch_1', dp_id: 1, type: 'Boolean', values: '{}' },
        { code: 'cur_current', dp_id: 18, type: 'Integer', values: '{"unit":"mA","scale":0}' },
        { code: 'cur_power', dp_id: 19, type: 'Integer', values: '{"unit":"W","min":0,"max":99999,"scale":1,"step":1}' },
      ],
    };
    expect(dpUitSpecificatie(spec)).toEqual({ dp: { vermogen: 19, schaal: 1, aan: 1 }, wat: 'meter' });
  });
  it('lamp: switch_led en bright_value_v2', () => {
    const spec = { category: 'dj', functions: [{ code: 'switch_led', dp_id: 20 }, { code: 'bright_value_v2', dp_id: 22, values: '{"min":10,"max":1000}' }] };
    expect(dpUitSpecificatie(spec)).toEqual({ dp: { aan: 20, helderheid: 22, helderheid_max: 1000, helderheid_min: 10 }, wat: 'lamp' });
  });
  it('alleen een schakelaar, of niets', () => {
    expect(dpUitSpecificatie({ status: [{ code: 'switch_1', dp_id: 1 }] })).toEqual({ dp: { aan: 1 }, wat: 'schakelaar' });
    expect(dpUitSpecificatie(null)).toEqual({ dp: {}, wat: null });
  });
});

/* ---------- Een nep-Tuya-cloud in node:http ---------- */

let server = null;
afterEach(() => server?.close());

/** Rekent de handtekening zelf na (los van teken()), en antwoordt zoals de Tuya OpenAPI. */
function nepCloud({ secret = GEHEIM } = {}) {
  const vragen = [];
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const query = [...url.searchParams.keys()].sort().map((k) => `${k}=${url.searchParams.get(k)}`);
    const pad = query.length ? `${url.pathname}?${query.join('&')}` : url.pathname;
    const token = req.headers.access_token ?? '';
    const leeg = crypto.createHash('sha256').update('').digest('hex');
    const verwacht = crypto.createHmac('sha256', secret).update(`${req.headers.client_id}${token}${req.headers.t}GET\n${leeg}\n\n${pad}`).digest('hex').toUpperCase();
    vragen.push({ methode: req.method, pad, token });
    const stuur = (json) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ t: Date.now(), ...json }));
    };
    if (req.method !== 'GET') return stuur({ success: false, code: 1, msg: 'alleen GET' });
    if (req.headers.sign !== verwacht || req.headers.sign_method !== 'HMAC-SHA256') return stuur({ success: false, code: 1004, msg: 'sign invalid' });
    if (url.pathname === '/v1.0/token') return stuur({ success: true, result: { access_token: 'tok-1', expire_time: 7200, uid: 'eu123' } });
    if (token !== 'tok-1') return stuur({ success: false, code: 1010, msg: 'token invalid' });
    if (url.pathname === '/v1.0/iot-01/associated-users/devices') {
      const tweede = url.searchParams.get('last_row_key') === 'R1';
      return stuur({
        success: true,
        result: tweede
          ? { devices: [{ id: 'bf22222222222222222222', name: 'Spots overstek', local_key: 'bbbbbbbbbbbbbbbb', category: 'dj', ip: '84.1.2.3', online: true }], has_more: false }
          : {
              devices: [
                { id: 'bf11111111111111111111', name: 'Pomp', local_key: 'aaaaaaaaaaaaaaaa', category: 'dlq', product_name: 'DIN-schakelaar', online: true },
                { id: 'kapot!', name: 'raar' },
              ],
              has_more: true,
              last_row_key: 'R1',
            },
      });
    }
    if (url.pathname === '/v1.1/devices/bf11111111111111111111/specifications') {
      return stuur({ success: true, result: { category: 'dlq', status: [{ code: 'switch_1', dp_id: 1 }, { code: 'cur_power', dp_id: 19, values: '{"scale":1}' }] } });
    }
    return stuur({ success: false, code: 1106, msg: 'permission deny' });
  });
  return new Promise((klaar) => server.listen(0, '127.0.0.1', () => klaar({ basis: `http://127.0.0.1:${server.address().port}`, vragen })));
}

describe('haalTuyaApparaten met een nep-cloud', () => {
  it('token, twee bladzijden, de specificatie; alleen GET-vragen', async () => {
    const { basis, vragen } = await nepCloud();
    const lijst = await haalTuyaApparaten({ accessId: ID, secret: GEHEIM, basis });
    expect(lijst).toEqual([
      { id: 'bf11111111111111111111', naam: 'Pomp', local_key: 'aaaaaaaaaaaaaaaa', product: 'DIN-schakelaar', categorie: 'dlq', online: true, sub: false, dp: { aan: 1, vermogen: 19, schaal: 1 }, wat: 'meter' },
      // Geen specificatie (de cloud weigert): de gewone datapunten.
      { id: 'bf22222222222222222222', naam: 'Spots overstek', local_key: 'bbbbbbbbbbbbbbbb', product: '', categorie: 'dj', online: true, sub: false, dp: {}, wat: null },
    ]);
    expect(vragen.every((v) => v.methode === 'GET')).toBe(true);
    expect(vragen.map((v) => v.pad)).toContain('/v1.0/iot-01/associated-users/devices?last_row_key=R1&size=50');
  });

  it('verkeerd geheim: een fout in gewone woorden', async () => {
    const { basis } = await nepCloud({ secret: 'iets anders dan het echte geheim' });
    await expect(haalTuyaApparaten({ accessId: ID, secret: GEHEIM, basis })).rejects.toThrow(/Access Secret/);
  });
});
