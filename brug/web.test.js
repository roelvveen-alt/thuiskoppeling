import http from 'node:http';
import https from 'node:https';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_VERBINDING, inGewoneWoorden, LOKAAL_VERBINDING, vraagJson } from './web.mjs';

describe('vraagJson: een harde eindtijd, ook als er af en toe iets binnendruppelt', () => {
  let server;
  let adres;
  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      // Elke 100 ms één spatie: de stiltelimiet gaat zo nooit af.
      const tik = setInterval(() => res.write(' '), 100);
      res.on('close', () => clearInterval(tik));
    });
    await new Promise((klaar) => server.listen(0, '127.0.0.1', klaar));
    adres = `http://127.0.0.1:${server.address().port}/`;
  });
  afterAll(() => {
    server.closeAllConnections?.();
    server.close();
  });

  it('breekt af na de tijd, met een fout in gewone woorden', async () => {
    const begin = Date.now();
    const fout = await vraagJson(adres, { tijd: 500 }).catch((f) => f);
    expect(fout).toBeInstanceOf(Error);
    expect(fout.message).toBe('geen antwoord binnen 0.5 s');
    expect(Date.now() - begin).toBeLessThan(2000);
    expect(inGewoneWoorden(fout)).toMatch(/^geen antwoord op tijd .*\(ETIMEDOUT\)$/);
  });
});

describe('blijvende verbindingen (keep-alive, prestaties-15)', () => {
  /** Een server die telt hoeveel verbindingen er komen. `sluitNa`: na zoveel antwoorden per verbinding gooit hij hem dicht zonder antwoord. */
  async function server({ sluitNa = Infinity, traag = false } = {}) {
    const verbindingen = new Set();
    const s = http.createServer((req, res) => {
      req.socket.antwoorden = (req.socket.antwoorden ?? 0) + 1;
      if (req.socket.antwoorden > sluitNa) return req.socket.destroy();
      if (traag) return; // nooit antwoord
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, url: req.url }));
    });
    s.on('connection', (c) => verbindingen.add(c));
    await new Promise((klaar) => s.listen(0, '127.0.0.1', klaar));
    return {
      adres: `http://127.0.0.1:${s.address().port}`,
      verbindingen,
      dicht() {
        s.closeAllConnections?.();
        s.close();
      },
    };
  }

  it('vijf verzoeken na elkaar over één verbinding; zonder agent elke keer een nieuwe (zoals voor 1.3.0)', async () => {
    const met = await server();
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    const uit = [];
    for (let i = 0; i < 5; i++) uit.push(await vraagJson(`${met.adres}/api/v1/data`, { agent }));
    expect(uit.map((u) => u.status)).toEqual([200, 200, 200, 200, 200]);
    expect(uit.map((u) => u.nieuw)).toEqual([true, false, false, false, false]);
    expect(met.verbindingen.size).toBe(1);
    agent.destroy();
    met.dicht();

    const zonder = await server();
    for (let i = 0; i < 3; i++) expect((await vraagJson(`${zonder.adres}/x`)).nieuw).toBe(true);
    expect(zonder.verbindingen.size).toBe(3);
    zonder.dicht();
  });

  it('sloot de andere kant een hergebruikte verbinding net, dan één keer opnieuw met een nieuwe', async () => {
    const met = await server({ sluitNa: 1 });
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    expect((await vraagJson(`${met.adres}/a`, { agent })).status).toBe(200);
    const tweede = await vraagJson(`${met.adres}/b`, { agent });
    expect(tweede).toMatchObject({ status: 200, nieuw: true, json: { url: '/b' } });
    expect(met.verbindingen.size).toBe(2);
    agent.destroy();
    met.dicht();
  });

  it('een hangende verbinding houdt de ronde niet op: ook met keep-alive de harde tijdslimiet, en daarna een nieuwe', async () => {
    const hangt = await server({ traag: true });
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    const begin = Date.now();
    const fout = await vraagJson(`${hangt.adres}/x`, { agent, tijd: 300 }).catch((f) => f);
    expect(fout.code).toBe('ETIMEDOUT');
    expect(Date.now() - begin).toBeLessThan(1500);
    // De weggegooide verbinding wordt niet hergebruikt.
    await vraagJson(`${hangt.adres}/y`, { agent, tijd: 300 }).catch(() => null);
    expect(hangt.verbindingen.size).toBe(2);
    agent.destroy();
    hangt.dicht();
  });

  it('de app en de meters hebben elk een blijvende verbinding; zoeken in het netwerk niet', () => {
    expect(APP_VERBINDING).toBeInstanceOf(https.Agent);
    expect(APP_VERBINDING.keepAlive).toBe(true);
    expect(LOKAAL_VERBINDING.keepAlive).toBe(true);
  });
});

describe('inGewoneWoorden', () => {
  const met = (code, message = 'x') => Object.assign(new Error(message), { code });
  it('vertaalt de kale meldingen van Node en mqtt.js, met de code erachter', () => {
    expect(inGewoneWoorden(met('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.9:80'))).toBe(
      'het apparaat weigert de verbinding (staat de lokale API aan?) (ECONNREFUSED)',
    );
    expect(inGewoneWoorden(met('EHOSTUNREACH'))).toMatch(/^niet te bereiken in de wifi/);
    expect(inGewoneWoorden(met('ENOTFOUND'))).toMatch(/^geen internet/);
    expect(inGewoneWoorden(met('ECONNRESET', 'socket hang up'))).toBe('de verbinding viel weg (ECONNRESET)');
    expect(inGewoneWoorden(new Error('socket hang up'))).toBe('de verbinding viel weg (socket hang up)');
    expect(inGewoneWoorden(met('DEPTH_ZERO_SELF_SIGNED_CERT', 'self-signed certificate'))).toMatch(/^het certificaat klopt niet/);
    expect(inGewoneWoorden(met(5, 'Connection refused: Not authorized'))).toMatch(/^Zendure weigert de inlog/);
    expect(inGewoneWoorden(met('EPERM', 'kill EPERM'))).toBe('dat mag niet van het systeem (EPERM)');
    // Onze eigen meldingen zijn al gewone taal.
    expect(inGewoneWoorden(new Error('HomeWizard antwoordde 500'))).toBe('HomeWizard antwoordde 500');
  });
});

describe('schoon (zelfde regel als de app)', () => {
  it('geeft hetzelfde als base44/shared/tekst.js', async () => {
    const { schoon } = await import('./web.mjs');
    const { schoon: zoalsDeApp } = await import('../base44/shared/tekst.js');
    for (const t of ['P1\u202e meter', 'a\u0000b\u001b[31m', 'een\ttwee\nDrie', 'Cafe\u0301', '😀😀😀', '  x  ', 'x'.repeat(50)]) {
      expect(schoon(t, 40)).toBe(zoalsDeApp(t, 40));
    }
    expect(schoon('HWE-P1\u202e\u200b', 40)).toBe('HWE-P1');
  });
});
