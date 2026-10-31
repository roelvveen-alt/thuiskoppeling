import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { maakPrive } from './instellingen.mjs';
import { isDag, zonneplanTijdvak } from './prijzen.mjs';
import { vraagJson } from './web.mjs';
import { zonVoorPlaats } from './zon.mjs';

/**
 * De stroomprijzen van Zonneplan, zoals de Zonneplan-app ze ziet. Er is geen
 * officiële koppeling; dit doet hetzelfde als de Home Assistant-koppelingen
 * (github.com/fsaris/home-assistant-zonneplan-one en pyzonneplan).
 *
 * Inloggen gaat één keer, met `node brug.mjs zonneplan-login`: je e-mailadres,
 * dan mailt Zonneplan een code van 6 cijfers en die tik je in. Daarna houdt
 * het programmaatje de sessie zelf vers, in brug/zonneplan-sessie.json (staat
 * in .gitignore; behandel het als een wachtwoord). Elke verversing geeft een
 * nieuwe sessiesleutel; die bewaren we meteen.
 *
 * Prijzen per kwartier, bedragen in 1/10.000.000 euro per kWh:
 *   price_tax_included  alles erin (marktprijs, inkoopvergoeding, energiebelasting, btw)
 *   price_tax_excluded  hetzelfde zonder de energiebelasting (wél met btw)
 * Wat terugleveren oplevert en de Zonnebonus: zie zonneplanTijdvak in prijzen.mjs.
 */

export const ZONNEPLAN = 'https://app-api.zonneplan.nl/';
const GELD = 1e-7;
const KOP = {
  'content-type': 'application/json;charset=utf-8',
  // Zonder deze twee weigert Zonneplan (zo stuurt de app ze ook mee).
  'x-app-version': '6.23.0',
  'x-app-environment': 'production',
};
const PRIJZEN = 'consumer-prices/charts/electricity-quarter-hourly';

function vraag(basis, pad, { methode = 'GET', lichaam, token } = {}) {
  return vraagJson(`${basis}${pad}`, {
    methode,
    lichaam,
    kop: { ...KOP, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    tijd: 15_000,
  });
}

/** Een PKCE-paar: het geheim blijft hier, Zonneplan krijgt alleen de vingerafdruk. */
export function pkce() {
  const verifier = randomBytes(96).toString('base64url').slice(0, 128);
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/** Stap 1: Zonneplan mailt een code. Een 403 met otp_required is hier "gelukt". */
export async function vraagInlogcode(email, { basis = ZONNEPLAN } = {}) {
  const { verifier, challenge } = pkce();
  const { status, json } = await vraag(basis, 'oauth/authorize-challenge', {
    methode: 'POST',
    lichaam: { response_type: 'code', email, code_challenge: challenge, code_challenge_method: 'S256', source_name: 'Thuis-energie (brug)' },
  });
  if (!json?.otp_required || typeof json.auth_session !== 'string') {
    throw new Error(`Zonneplan stuurde geen code (antwoord ${status}). Klopt het e-mailadres?`);
  }
  return { auth_session: json.auth_session, verifier };
}

async function haalSessie(basis, grant, nu) {
  const { status, json } = await vraag(basis, 'oauth/token', { methode: 'POST', lichaam: grant });
  if (status !== 200 || typeof json?.access_token !== 'string' || typeof json?.refresh_token !== 'string') {
    // Zonneplan geeft een kale 400 als de sessie niet meer geldt.
    const fout = new Error(status === 400 || status === 401 ? 'opnieuw inloggen nodig: node brug.mjs zonneplan-login' : `inloggen gaf antwoord ${status}`);
    fout.opnieuwInloggen = status === 400 || status === 401;
    throw fout;
  }
  const seconden = Number(json.expires_in);
  return { access_token: json.access_token, refresh_token: json.refresh_token, verloopt: nu + (seconden > 0 ? seconden : 3600) * 1000 };
}

/** Stap 2: de code uit de mail inwisselen voor een sessie. Een foute code kan maar één keer: daarna opnieuw beginnen. */
export async function geefInlogcode(uitdaging, code, { basis = ZONNEPLAN, nu = Date.now() } = {}) {
  const { json } = await vraag(basis, 'oauth/authorize-challenge', { methode: 'POST', lichaam: { auth_session: uitdaging.auth_session, otp: code } });
  if (typeof json?.authorization_code !== 'string') throw new Error('Zonneplan keurde de code af. Start opnieuw; gebruik de code uit de nieuwste mail.');
  return haalSessie(basis, { grant_type: 'authorization_code', code: json.authorization_code, code_verifier: uitdaging.verifier }, nu);
}

export function laadSessie(pad, { log } = {}) {
  try {
    const s = JSON.parse(fs.readFileSync(pad, 'utf8'));
    maakPrive(pad, { naam: 'zonneplan-sessie.json', ...(log ? { log } : {}) });
    return typeof s?.access_token === 'string' && typeof s?.refresh_token === 'string' ? s : null;
  } catch {
    return null;
  }
}

/** Eerst naar een tijdelijk bestand en dan hernoemen: een halve sessie (stroom eraf) bestaat dan niet. */
export function bewaarSessie(pad, sessie) {
  const tijdelijk = `${pad instanceof URL ? fileURLToPath(pad) : pad}.nieuw`;
  // Eerst weg: een achtergebleven .nieuw zou zijn oude (ruimere) rechten houden.
  fs.rmSync(tijdelijk, { force: true });
  fs.writeFileSync(tijdelijk, `${JSON.stringify(sessie)}\n`, { mode: 0o600, flag: 'wx' });
  fs.renameSync(tijdelijk, pad);
}

/** Je stroomaansluiting, voor de prijzen van jouw contract (uit user-accounts/me). */
export function accountUit(json, nu) {
  const groepen = Array.isArray(json?.data?.address_groups) ? json.data.address_groups : [];
  for (const groep of groepen) {
    for (const aansluiting of groep?.connections ?? []) {
      const stroom = (aansluiting?.contracts ?? []).some(
        (c) => c?.type === 'electricity' && (!c.start_date || Date.parse(c.start_date) <= nu) && (!c.end_date || Date.parse(c.end_date) > nu),
      );
      if (stroom && typeof aansluiting.uuid === 'string') return { aansluiting: aansluiting.uuid };
    }
  }
  return { aansluiting: null };
}

/** Van het antwoord van Zonneplan naar tijdvakken (zie prijzen.mjs). zonVoor: zon op en onder per dag. */
export function tijdvakkenUitZonneplan(json, zonVoor) {
  const punten = json?.data?.chart?.series?.prices;
  if (!Array.isArray(punten)) throw new Error('onverwacht antwoord op de prijzen');
  return punten
    .flatMap((p) => {
      const van = Date.parse(p?.start_date);
      const tot = Date.parse(p?.end_date);
      const alles = p?.price_tax_included?.amount;
      const zonder = p?.price_tax_excluded?.amount;
      if (!Number.isFinite(van) || !(tot > van) || !Number.isFinite(alles) || !Number.isFinite(zonder)) return [];
      return [zonneplanTijdvak({ van, tot, alles: alles * GELD, zonderBelasting: zonder * GELD, isDag: isDag(van, tot, zonVoor) })];
    })
    .sort((a, b) => a.van - b.van);
}

/**
 * De bron voor prijsVolger (prijzen.mjs), die er één keer per dag om vraagt.
 * De eerste keer ook je account (voor je aansluiting). De sessie wordt
 * ververst als hij (bijna) verlopen is.
 */
export function zonneplanBron({ pad, basis = ZONNEPLAN, klok = Date.now, plaats = null }) {
  let sessie = laadSessie(pad);
  let account = null;

  async function sleutel() {
    if (!sessie) sessie = laadSessie(pad);
    if (!sessie) throw new Error('nog niet ingelogd (node brug.mjs zonneplan-login)');
    if (klok() > sessie.verloopt - 60_000) {
      try {
        sessie = await haalSessie(basis, { grant_type: 'refresh_token', refresh_token: sessie.refresh_token }, klok());
      } catch (fout) {
        // Misschien is er intussen opnieuw ingelogd: lees het bestand de volgende keer opnieuw.
        if (fout.opnieuwInloggen) sessie = null;
        throw fout;
      }
      bewaarSessie(pad, sessie);
    }
    return sessie.access_token;
  }

  async function vraagMet(pad) {
    let { status, json } = await vraag(basis, pad, { token: await sleutel() });
    if (status === 401) {
      // De sleutel is eerder verlopen dan gezegd: meteen verversen en nog één keer (0.13.0; voorheen pas
      // bij de volgende poging, een kwartier later). Kan verversen niet meer, dan zegt sleutel() dat
      // er opnieuw ingelogd moet worden; dat komt als melding in de app.
      sessie = { ...sessie, verloopt: 0 };
      ({ status, json } = await vraag(basis, pad, { token: await sleutel() }));
      if (status === 401) {
        sessie = { ...sessie, verloopt: 0 };
        throw new Error('sessie verlopen; ik ververs hem en probeer het zo opnieuw');
      }
    }
    if (status !== 200) throw new Error(`Zonneplan antwoordde ${status}`);
    return json;
  }


  return {
    naam: 'Zonneplan',
    async haal() {
      if (!account) account = accountUit(await vraagMet('user-accounts/me'), klok());
      const prijzen = await vraagMet(account.aansluiting ? `api/connections/${account.aansluiting}/${PRIJZEN}` : `api/${PRIJZEN}`);
      return tijdvakkenUitZonneplan(prijzen, zonVoorPlaats(plaats));
    },
  };
}
