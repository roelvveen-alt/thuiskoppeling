import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { maakVerbinding } from './verbinding.js';

/**
 * De eigen verbinding (verbinding.js) naast de echte SDK, tegen dezelfde
 * nepserver: elke vraag (adres, headers, body) en elk antwoord en elke fout
 * (zoals het loket ze leest) moet gelijk zijn. Zo blijft inloggen, uitloggen,
 * het token, 401 → inloggen en de 429-pauze precies zoals met de SDK.
 * De foutvormen vergelijken we zoals het loket ze leest (naarLoketFout).
 */

vi.mock('@/lib/fotoKast', () => ({ wisFotoKast: async () => {} }));
vi.mock('@/api/base44Client', () => ({ base44: null, statusVan: (e) => e?.status ?? e?.response?.status ?? null }));
const { naarLoketFout } = await import('./huis.js');

const APP = 'app-proef-1';
let server;
let adres;
const vragen = [];
/** Wat de server op een pad antwoordt: [status, body, headers]. */
const antwoorden = new Map();

beforeAll(async () => {
  // De SDK schrijft buiten productie elke fout in de console; dat is hier de bedoeling, niet het nieuws.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  server = http.createServer((req, res) => {
    const delen = [];
    req.on('data', (d) => delen.push(d));
    req.on('end', () => {
      const body = Buffer.concat(delen).toString('utf8');
      vragen.push({ methode: req.method, pad: req.url, headers: req.headers, body });
      const [status, uit, headers = {}] = antwoorden.get(req.url) ?? [200, { ok: true }];
      res.writeHead(status, { ...(typeof uit === 'string' ? { 'Content-Type': 'text/html' } : { 'Content-Type': 'application/json' }), ...headers });
      res.end(typeof uit === 'string' ? uit : JSON.stringify(uit));
    });
  });
  await new Promise((klaar) => server.listen(0, '127.0.0.1', klaar));
  adres = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((klaar) => server.close(klaar)));

/** Een nepvenster: adresregel, localStorage en history, genoeg voor de SDK en voor ons. */
function nepVenster(href = 'https://energie.voorbeeld.app/?x=1#boven', opslag = {}) {
  const url = new URL(href);
  const winkel = new Map(Object.entries(opslag));
  const venster = {
    location: {
      get href() {
        return url.href;
      },
      set href(nieuw) {
        venster.naar = nieuw;
      },
      origin: url.origin,
      get search() {
        return url.search;
      },
      get pathname() {
        return url.pathname;
      },
      get hash() {
        return url.hash;
      },
    },
    history: {
      replaceState(_staat, _titel, nieuw) {
        const volgend = new URL(nieuw, url.origin);
        url.search = volgend.search;
        url.hash = volgend.hash;
      },
    },
    localStorage: {
      getItem: (k) => (winkel.has(k) ? winkel.get(k) : null),
      setItem: (k, v) => winkel.set(k, String(v)),
      removeItem: (k) => winkel.delete(k),
    },
    winkel,
    naar: null,
  };
  venster.self = venster;
  venster.top = venster;
  venster.parent = venster;
  return venster;
}

/** De SDK leest het globale window (ook bij het importeren): eerst een venster, dan pas de SDK. */
globalThis.window = nepVenster();
globalThis.document = { title: '' };
const { createClient } = await import('@base44/sdk');

/** Beide verbindingen, elk met een eigen, gelijk nepvenster. */
function beide(href, opslag) {
  globalThis.window = nepVenster(href, opslag);
  const sdk = createClient({ appId: APP, serverUrl: adres, requiresAuth: false, analytics: { enabled: false } });
  const sdkVenster = globalThis.window;
  const eigenVenster = nepVenster(href, opslag);
  const eigen = maakVerbinding({ appId: APP, serverUrl: adres, venster: eigenVenster });
  return { sdk, eigen, sdkVenster, eigenVenster };
}

const VASTE_HEADERS = ['accept', 'authorization', 'content-type', 'x-app-id', 'x-origin-url'];
const kern = (vraag) => ({
  methode: vraag.methode,
  pad: vraag.pad,
  headers: Object.fromEntries(VASTE_HEADERS.map((h) => [h, vraag.headers[h] ?? null])),
  body: vraag.body,
});

/** Doe hetzelfde met beide; geef [sdk, eigen] terug: de vraag die binnenkwam en de uitkomst. */
async function vergelijk(doe, { href, opslag } = {}) {
  const { sdk, eigen } = beide(href, opslag);
  const uit = [];
  for (const client of [sdk, eigen]) {
    vragen.length = 0;
    let uitkomst;
    try {
      uitkomst = { ok: await doe(client) };
    } catch (e) {
      uitkomst = { fout: e };
    }
    uit.push({ vraag: vragen[0] ? kern(vragen[0]) : null, ...uitkomst });
  }
  return uit;
}

const TOKEN = { base44_access_token: 'tok-123' };

describe('functions.invoke zoals de SDK', () => {
  it('dezelfde vraag (adres, headers, body) en hetzelfde antwoord', async () => {
    antwoorden.set(`/api/apps/${APP}/functions/huis`, [200, { meting: { moment: '2026-10-30T12:00:00Z', net_w: 120 } }]);
    const [sdk, eigen] = await vergelijk((c) => c.functions.invoke('huis', { actie: 'stand', huis_id: 'h1' }), { opslag: TOKEN });
    expect(eigen.vraag).toEqual(sdk.vraag);
    expect(sdk.vraag.headers.authorization).toBe('Bearer tok-123');
    expect(eigen.ok.data).toEqual(sdk.ok.data);
    expect(eigen.ok.status).toBe(sdk.ok.status);
  });

  it('zonder token ook zonder Authorization (de functie zegt dan 401 zonder Base44-aanroep)', async () => {
    antwoorden.set(`/api/apps/${APP}/functions/huis`, [401, { error: 'Log eerst in.', code: 'inloggen' }]);
    const [sdk, eigen] = await vergelijk((c) => c.functions.invoke('huis', { actie: 'mijn' }));
    expect(eigen.vraag.headers.authorization).toBeNull();
    expect(sdk.vraag.headers.authorization).toBeNull();
    expect(naarLoketFout(eigen.fout)).toMatchObject({ soort: 'inloggen', status: 401 });
    expect(naarLoketFout(sdk.fout)).toMatchObject({ soort: 'inloggen', status: 401 });
  });

  it('elke fout leest het loket hetzelfde: rem met Retry-After, bijwerken, geenHuis, kapot', async () => {
    const gevallen = [
      [429, { error: 'Even druk', retry_after: 7 }, { 'Retry-After': '7' }],
      [404, '<html>Not found</html>'],
      [404, { detail: 'Function not found' }],
      [400, { error: 'Deze vraag kent de functie (nog) niet.', code: 'onbekendeActie' }],
      [404, { error: 'Bestaat niet.', code: 'geenHuis' }],
      [403, { error: 'Dit account staat uit.', code: 'uitgeschakeld' }],
      [500, { error: 'Er ging iets mis bij Base44.', code: 'fout' }],
    ];
    for (const [status, body, headers] of gevallen) {
      antwoorden.set(`/api/apps/${APP}/functions/huis`, [status, body, headers]);
      const [sdk, eigen] = await vergelijk((c) => c.functions.invoke('huis', { actie: 'stand' }), { opslag: TOKEN });
      const [a, b] = [naarLoketFout(sdk.fout), naarLoketFout(eigen.fout)];
      expect({ soort: b.soort, message: b.message, status: b.status }).toEqual({ soort: a.soort, message: a.message, status: a.status });
      expect(eigen.fout.response.data).toEqual(sdk.fout.response.data);
      expect(eigen.fout.response.headers['retry-after']).toBe(sdk.fout.response.headers['retry-after']);
    }
  });

  it('geen verbinding: geen status, dus "net" (en het loket probeert het later)', async () => {
    const dicht = http.createServer();
    await new Promise((klaar) => dicht.listen(0, '127.0.0.1', klaar));
    const poort = dicht.address().port;
    await new Promise((klaar) => dicht.close(klaar));
    globalThis.window = nepVenster();
    const sdk = createClient({ appId: APP, serverUrl: `http://127.0.0.1:${poort}`, analytics: { enabled: false } });
    const eigen = maakVerbinding({ appId: APP, serverUrl: `http://127.0.0.1:${poort}`, venster: nepVenster() });
    for (const client of [sdk, eigen]) {
      const fout = await client.functions.invoke('huis', { actie: 'stand' }).catch((e) => e);
      expect(naarLoketFout(fout).soort).toBe('net');
    }
  });
});

describe('uploaden en uitnodigen zoals de SDK', () => {
  it('een foto: zelfde adres, een formulier met het bestand, en alleen de file_uri terug', async () => {
    antwoorden.set(`/api/apps/${APP}/integration-endpoints/Core/UploadPrivateFile`, [200, { file_uri: 'privé://huis.jpg' }]);
    const bestand = () => new File([new Uint8Array([1, 2, 3])], 'huis.jpg', { type: 'image/jpeg' });
    const [sdk, eigen] = await vergelijk((c) => c.integrations.Core.UploadPrivateFile({ file: bestand() }), { opslag: TOKEN });
    expect(eigen.ok).toEqual(sdk.ok);
    expect(eigen.ok.file_uri).toBe('privé://huis.jpg');
    for (const { vraag } of [sdk, eigen]) {
      expect(vraag.pad).toBe(`/api/apps/${APP}/integration-endpoints/Core/UploadPrivateFile`);
      expect(vraag.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
      expect(vraag.headers.authorization).toBe('Bearer tok-123');
      expect(vraag.body).toMatch(/name="file"; filename="huis.jpg"/);
    }
  });

  it('een foto die niet lukt: dezelfde status en zin', async () => {
    antwoorden.set(`/api/apps/${APP}/integration-endpoints/Core/UploadPrivateFile`, [413, { message: 'Te groot' }]);
    const [sdk, eigen] = await vergelijk((c) => c.integrations.Core.UploadPrivateFile({ file: new File(['x'], 'a.jpg') }), { opslag: TOKEN });
    expect({ status: eigen.fout.status, message: eigen.fout.message }).toEqual({ status: sdk.fout.status, message: sdk.fout.message });
  });

  it('uitnodigen: zelfde vraag; geweigerd geeft dezelfde status en zin (die toont Delen)', async () => {
    const pad = `/api/apps/${APP}/runtime/users/invite-user`;
    antwoorden.set(pad, [200, { ok: true }]);
    const [sdk, eigen] = await vergelijk((c) => c.users.inviteUser('oma@voorbeeld.nl', 'user'), { opslag: TOKEN });
    expect(eigen.vraag).toEqual(sdk.vraag);
    expect(eigen.ok).toEqual(sdk.ok);
    for (const body of [{ detail: 'Only admins can invite' }, { error: { message: 'Forbidden', code: 'x' } }]) {
      antwoorden.set(pad, [403, body]);
      const [s, e] = await vergelijk((c) => c.users.inviteUser('oma@voorbeeld.nl', 'user'), { opslag: TOKEN });
      expect({ status: e.fout.status, message: e.fout.message }).toEqual({ status: s.fout.status, message: s.fout.message });
    }
  });
});

describe('het token, inloggen en uitloggen zoals de SDK', () => {
  it('na het inloggen: het token uit de adresregel bewaard, de adresregel schoon, en mee in elke vraag', async () => {
    const href = 'https://energie.voorbeeld.app/thuis?access_token=nieuw-9&x=1#boven';
    const { sdk, eigen, sdkVenster, eigenVenster } = beide(href, { base44_access_token: 'oud-1' });
    expect(eigenVenster.location.href).toBe(sdkVenster.location.href);
    expect(eigenVenster.location.href).toBe('https://energie.voorbeeld.app/thuis?x=1#boven');
    expect(Object.fromEntries(eigenVenster.winkel)).toEqual(Object.fromEntries(sdkVenster.winkel));
    expect(eigenVenster.winkel.get('base44_access_token')).toBe('nieuw-9');
    expect(eigen.auth.heeftToken()).toBe(true);
    antwoorden.set(`/api/apps/${APP}/functions/huis`, [200, {}]);
    const kop = [];
    for (const client of [sdk, eigen]) {
      vragen.length = 0;
      await client.functions.invoke('huis', { actie: 'mijn' });
      kop.push(vragen[0].headers.authorization);
    }
    expect(kop).toEqual(['Bearer nieuw-9', 'Bearer nieuw-9']);
  });

  it('naar het inloggen: hetzelfde adres', () => {
    const { sdk, eigen, sdkVenster, eigenVenster } = beide('https://energie.voorbeeld.app/?x=1');
    sdk.auth.redirectToLogin(sdkVenster.location.href);
    eigen.auth.redirectToLogin(eigenVenster.location.href);
    expect(eigenVenster.naar).toBe(sdkVenster.naar);
    expect(eigenVenster.naar).toBe('/login?from_url=https%3A%2F%2Fenergie.voorbeeld.app%2F%3Fx%3D1');
  });

  it('uitloggen: beide tokens weg, en hetzelfde adres', () => {
    const opslag = { base44_access_token: 'tok-123', token: 'tok-123', ander: 'blijft' };
    const { sdk, eigen, sdkVenster, eigenVenster } = beide('https://energie.voorbeeld.app/', opslag);
    sdk.auth.logout('https://energie.voorbeeld.app/');
    eigen.auth.logout('https://energie.voorbeeld.app/');
    expect(eigenVenster.naar).toBe(sdkVenster.naar);
    expect(Object.fromEntries(eigenVenster.winkel)).toEqual(Object.fromEntries(sdkVenster.winkel));
    expect(Object.fromEntries(eigenVenster.winkel)).toEqual({ ander: 'blijft' });
    expect(eigen.auth.heeftToken()).toBe(false);
  });
});
