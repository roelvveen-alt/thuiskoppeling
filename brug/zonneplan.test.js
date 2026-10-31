import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accountUit, bewaarSessie, geefInlogcode, laadSessie, pkce, tijdvakkenUitZonneplan, vraagInlogcode, zonneplanBron } from './zonneplan.mjs';

const prijs = (start, eind, alles, zonder) => ({
  start_date: start,
  end_date: eind,
  price_tax_included: { amount: alles },
  price_tax_excluded: { amount: zonder },
  sustainability_score: { permille: 500 },
});

// Echte bedragen uit een antwoord van Zonneplan (oktober 2026, pyzonneplan).
const PRIJZEN = {
  data: {
    chart: {
      range: { start_date: '2026-10-12T09:00:00+02:00', end_date: '2026-10-14T23:59:59+02:00' },
      series: {
        prices: [
          prijs('2026-10-12T07:15:00+00:00', '2026-10-12T07:30:00+00:00', 4113028, 3004547),
          prijs('2026-10-12T07:00:00+00:00', '2026-10-12T07:15:00+00:00', 4508988, 3400507),
          prijs('2026-10-12T20:00:00+00:00', '2026-10-12T20:15:00+00:00', 2500000, 1391519),
          prijs('2026-10-12T12:00:00+00:00', '2026-10-12T12:15:00+00:00', 1000000, -108481),
          { start_date: 'kapot' },
        ],
      },
    },
  },
};

const ACCOUNT = {
  data: {
    address_groups: [
      {
        connections: [
          { uuid: 'gas-1', contracts: [{ type: 'gas', start_date: '2025-12-31T23:00:00.000000Z', end_date: null }] },
          { uuid: 'oud-1', contracts: [{ type: 'electricity', start_date: '2024-01-01T00:00:00.000000Z', end_date: '2025-01-01T00:00:00.000000Z' }] },
          { uuid: 'stroom-1', contracts: [{ type: 'electricity', start_date: '2025-12-31T23:00:00.000000Z', end_date: null }] },
        ],
        address: { sunrise: '2026-10-12T06:00:00.000000Z', sunset: '2026-10-12T16:50:00.000000Z' },
      },
    ],
  },
};

describe('Zonneplan: van antwoord naar prijzen', () => {
  it('overdag: terugleveren = afnemen + Zonnebonus (10% van de prijs zonder energiebelasting)', () => {
    const vakken = tijdvakkenUitZonneplan(PRIJZEN);
    expect(vakken).toHaveLength(4);
    expect(vakken[0].van).toBe(Date.parse('2026-10-12T07:00:00Z'));
    expect(vakken[0].afname_kwh).toBeCloseTo(0.4508988, 9);
    expect(vakken[0].zonnebonus_kwh).toBeCloseTo(0.03400507, 9);
    expect(vakken[0].teruglevering_kwh).toBeCloseTo(0.48490387, 9);
  });

  it("'s avonds geen Zonnebonus; onder nul ook niet", () => {
    const vakken = tijdvakkenUitZonneplan(PRIJZEN);
    const avond = vakken.find((v) => v.van === Date.parse('2026-10-12T20:00:00Z'));
    expect(avond).toMatchObject({ zonnebonus_kwh: 0, teruglevering_kwh: avond.afname_kwh });
    const negatief = vakken.find((v) => v.van === Date.parse('2026-10-12T12:00:00Z'));
    expect(negatief.zonnebonus_kwh).toBe(0);
    expect(negatief.teruglevering_kwh).toBeCloseTo(0.1, 9);
  });

  it('een raar antwoord is een fout', () => {
    expect(() => tijdvakkenUitZonneplan({ data: {} })).toThrow('onverwacht antwoord');
  });

  it('de stroomaansluiting met een lopend contract', () => {
    const nu = Date.parse('2026-10-12T10:00:00Z');
    expect(accountUit(ACCOUNT, nu)).toEqual({ aansluiting: 'stroom-1' });
    expect(accountUit({ data: { address_groups: [] } }, nu)).toEqual({ aansluiting: null });
  });

  it('PKCE: Zonneplan krijgt alleen de vingerafdruk van het geheim', () => {
    const { verifier, challenge } = pkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{128}$/);
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
  });
});

/** Een nep-Zonneplan, met dezelfde rare kantjes als het echte (403 bij succes, kale 400 bij een verlopen sessie). */
function nepZonneplan() {
  const staat = { challenge: '', sleutels: new Map(), verversingen: new Map([['r1', ['a2', 'r2']], ['r2', ['a3', 'r3']]]), prijzen401: 0, koppen: [] };
  const server = http.createServer((verzoek, antwoord) => {
    let tekst = '';
    verzoek.on('data', (stuk) => (tekst += stuk));
    verzoek.on('end', () => {
      staat.koppen.push(verzoek.headers);
      const lichaam = tekst ? JSON.parse(tekst) : {};
      const stuur = (status, json) => {
        antwoord.writeHead(status, { 'content-type': 'application/json' });
        antwoord.end(JSON.stringify(json));
      };
      if (verzoek.headers['x-app-version'] === undefined || verzoek.headers['x-app-environment'] !== 'production') return stuur(400, {});
      const sleutel = (verzoek.headers.authorization ?? '').replace('Bearer ', '');
      if (verzoek.url === '/oauth/authorize-challenge') {
        if (lichaam.email && lichaam.code_challenge_method === 'S256') {
          staat.challenge = lichaam.code_challenge;
          return stuur(403, { otp_required: true, auth_session: 'sessie-1' });
        }
        if (lichaam.auth_session === 'sessie-1' && lichaam.otp === '123456') return stuur(200, { authorization_code: 'code-1' });
        return stuur(400, { message: 'invalid' });
      }
      if (verzoek.url === '/oauth/token') {
        if (lichaam.grant_type === 'authorization_code' && lichaam.code === 'code-1') {
          const klopt = createHash('sha256').update(lichaam.code_verifier).digest('base64url') === staat.challenge;
          return klopt ? stuur(200, { access_token: 'a1', refresh_token: 'r1', expires_in: 3600, token_type: 'Bearer' }) : stuur(400, {});
        }
        const nieuw = lichaam.grant_type === 'refresh_token' && staat.verversingen.get(lichaam.refresh_token);
        if (!nieuw) return stuur(400, {});
        staat.verversingen.delete(lichaam.refresh_token);
        return stuur(200, { access_token: nieuw[0], refresh_token: nieuw[1], expires_in: 3600 });
      }
      if (!['a1', 'a2', 'a3'].includes(sleutel)) return stuur(401, {});
      if (verzoek.url === '/user-accounts/me') return stuur(200, ACCOUNT);
      if (verzoek.url === '/api/connections/stroom-1/consumer-prices/charts/electricity-quarter-hourly') {
        if (staat.prijzen401 > 0) {
          staat.prijzen401 -= 1;
          return stuur(401, {});
        }
        return stuur(200, PRIJZEN);
      }
      return stuur(404, {});
    });
  });
  return { server, staat };
}

describe('Zonneplan: inloggen en verversen (tegen een nep-Zonneplan)', () => {
  const { server, staat } = nepZonneplan();
  let basis;
  const map = fs.mkdtempSync(path.join(os.tmpdir(), 'zonneplan-'));
  const pad = path.join(map, 'zonneplan-sessie.json');

  beforeAll(async () => {
    await new Promise((klaar) => server.listen(0, '127.0.0.1', klaar));
    basis = `http://127.0.0.1:${server.address().port}/`;
  });
  afterAll(() => {
    server.close();
    fs.rmSync(map, { recursive: true, force: true });
  });

  it('code aanvragen, een foute code, de goede code; daarna prijzen en verversen', async () => {
    let nu = Date.parse('2026-10-12T07:05:00Z');
    const uitdaging = await vraagInlogcode('iemand@example.com', { basis });
    expect(uitdaging.auth_session).toBe('sessie-1');
    await expect(geefInlogcode(uitdaging, '000000', { basis, nu })).rejects.toThrow('keurde de code af');

    const sessie = await geefInlogcode(uitdaging, '123456', { basis, nu });
    expect(sessie).toEqual({ access_token: 'a1', refresh_token: 'r1', verloopt: nu + 3_600_000 });
    bewaarSessie(pad, sessie);
    expect(fs.statSync(pad).mode & 0o777).toBe(0o600);

    const bron = zonneplanBron({ pad, basis, klok: () => nu });
    const vakken = await bron.haal();
    expect(vakken[0]).toMatchObject({ van: Date.parse('2026-10-12T07:00:00Z') });
    expect(vakken[0].zonnebonus_kwh).toBeGreaterThan(0);
    expect(staat.koppen.every((k) => k['x-app-version'] && k['x-app-environment'] === 'production')).toBe(true);

    // Vlak voor het verlopen: eerst verversen, en de nieuwe sleutels meteen bewaren.
    nu += 3_550_000;
    await bron.haal();
    expect(laadSessie(pad)).toMatchObject({ access_token: 'a2', refresh_token: 'r2' });

    // Weigert Zonneplan de sleutel toch (401), dan meteen verversen en nog één keer (0.13.0).
    staat.prijzen401 = 1;
    expect((await bron.haal()).length).toBeGreaterThan(0);
    expect(laadSessie(pad)).toMatchObject({ access_token: 'a3', refresh_token: 'r3' });

    // Kan ook dat niet meer (kale 400), dan moet er opnieuw worden ingelogd; dat zegt hij meteen.
    staat.prijzen401 = 1;
    await expect(bron.haal()).rejects.toThrow('opnieuw inloggen nodig: node brug.mjs zonneplan-login');
  });

  it('zonder sessie: zeggen hoe je inlogt', async () => {
    await expect(zonneplanBron({ pad: path.join(map, 'bestaat-niet.json'), basis }).haal()).rejects.toThrow('nog niet ingelogd');
  });
});
