import http from 'node:http';
import https from 'node:https';

/**
 * Verbindingen die blijven staan (keep-alive, prestaties-15, sinds 1.3.0): elke 5 s
 * een nieuwe TLS-verbinding naar Base44, en een nieuwe verbinding naar elke meter,
 * kost tijd, stroom (de telefoon) en verkeer. Met een blijvende verbinding gaat het
 * volgende verzoek over dezelfde. Alleen voor wat elke paar seconden terugkomt; de
 * aanroeper kiest hem (`agent`), standaard blijft het elke keer een nieuwe.
 *
 *   APP_VERBINDING      naar de app (ontvangMeting in Base44)
 *   LOKAAL_VERBINDING   gewoon http in de eigen wifi: HomeWizard v1, Zendure lokaal en P1
 *   HomeWizard v2 heeft per meter een eigen (homewizard.mjs: de certificaatcontrole hoort bij die meter)
 *
 * Een verbinding die even niets doet, gaat na VERBINDING_RUST_MS dicht. Een hangende
 * verbinding houdt de ronde niet op: de harde tijdslimiet van vraagJson breekt het
 * verzoek af en gooit de verbinding weg. Zoeken in het netwerk gebruikt ze nooit.
 */
export const VERBINDING_RUST_MS = 20_000;
export const APP_VERBINDING = new https.Agent({ keepAlive: true, maxSockets: 2, timeout: VERBINDING_RUST_MS });
export const LOKAAL_VERBINDING = new http.Agent({ keepAlive: true, maxSockets: 2, timeout: VERBINDING_RUST_MS });

/** Een blijvende verbinding die net dichtging (de andere kant ruimde hem op): één keer opnieuw, met een nieuwe. */
const WEGGEVALLEN = new Set(['ECONNRESET', 'EPIPE', 'ECONNABORTED']);

/**
 * Eén verzoek met JSON heen en terug, met een harde tijdslimiet: binnen `tijd`
 * ms een volledig antwoord, of een fout. Ook als er af en toe een byte
 * binnendruppelt (de timeout van http.request is alleen een stiltelimiet).
 *
 * Met de oude http/https-modules en niet met fetch: alleen zo kan per verzoek
 * een eigen certificaatcontrole mee (HomeWizard API v2 heeft een eigen CA).
 * Zonder `agent` elke keer een nieuwe verbinding (agent: false), zodat die
 * controle ook elke keer gebeurt; met een blijvende verbinding (`agent`, zie
 * boven) gebeurt hij als de verbinding gemaakt wordt, en praat de rest over
 * dezelfde verbinding met hetzelfde apparaat.
 *
 * Viel een hergebruikte verbinding weg voordat er antwoord kwam (de meter of
 * de server had hem net gesloten), dan nog één keer met een nieuwe, binnen
 * dezelfde tijd.
 *
 * @returns {Promise<{ status: number, json: any, tekst: string, nieuw: boolean }>}
 */
export async function vraagJson(adres, opties = {}) {
  const eind = Date.now() + (opties.tijd ?? 4000);
  try {
    return await vraagEens(adres, opties);
  } catch (fout) {
    const rest = eind - Date.now();
    if (!fout?.hergebruikt || !WEGGEVALLEN.has(fout.code) || rest < 250) throw fout;
    return vraagEens(adres, { ...opties, tijd: rest });
  }
}

function vraagEens(adres, { methode = 'GET', kop = {}, lichaam, tijd = 4000, tls = {}, agent = false } = {}) {
  return new Promise((klaarMet, misMet) => {
    let klok = null;
    let antwoordBegon = false;
    const klaar = (uit) => {
      clearTimeout(klok);
      klaarMet(uit);
    };
    const mis = (fout) => {
      clearTimeout(klok);
      // Over een hergebruikte verbinding, en nog geen antwoord: dan mag vraagJson het nog eens proberen.
      if (fout && typeof fout === 'object' && verzoek.reusedSocket && !antwoordBegon) fout.hergebruikt = true;
      misMet(fout);
    };
    const url = new URL(adres);
    const module = url.protocol === 'https:' ? https : http;
    const data = lichaam === undefined ? undefined : JSON.stringify(lichaam);
    const verzoek = module.request(
      url,
      {
        method: methode,
        headers: {
          accept: 'application/json',
          ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}),
          ...kop,
        },
        timeout: tijd,
        agent,
        ...tls,
      },
      (antwoord) => {
        antwoordBegon = true;
        let tekst = '';
        antwoord.setEncoding('utf8');
        antwoord.on('data', (stuk) => {
          tekst += stuk;
          if (tekst.length > 1_000_000) verzoek.destroy(new Error('Antwoord is te groot'));
        });
        antwoord.on('end', () => {
          let json = null;
          try {
            json = tekst ? JSON.parse(tekst) : null;
          } catch {
            // Geen JSON: de aanroeper kijkt naar status en tekst.
          }
          // nieuw: over een nieuwe verbinding (niet hergebruikt); dan kan er een ander apparaat achter zitten.
          klaar({ status: antwoord.statusCode ?? 0, json, tekst, nieuw: !verzoek.reusedSocket });
        });
        antwoord.on('error', mis);
      },
    );
    const teLaat = () => {
      const fout = new Error(`geen antwoord binnen ${tijd / 1000} s`);
      fout.code = 'ETIMEDOUT';
      verzoek.destroy(fout);
    };
    verzoek.on('timeout', teLaat);
    klok = setTimeout(teLaat, tijd);
    verzoek.on('error', mis);
    if (data) verzoek.write(data);
    verzoek.end();
  });
}

/** Wat een foutcode van Node of mqtt.js in gewone woorden betekent. */
const WOORDEN = {
  ECONNREFUSED: 'het apparaat weigert de verbinding (staat de lokale API aan?)',
  EHOSTUNREACH: 'niet te bereiken in de wifi (uit, of een ander adres?)',
  ENETUNREACH: 'niet te bereiken in de wifi (uit, of een ander adres?)',
  EHOSTDOWN: 'niet te bereiken in de wifi (uit, of een ander adres?)',
  ETIMEDOUT: 'geen antwoord op tijd (uit, zwak wifi, of een ander adres?)',
  ENOTFOUND: 'geen internet (de naam is niet te vinden)',
  EAI_AGAIN: 'geen internet (de naam is niet te vinden)',
  ECONNRESET: 'de verbinding viel weg',
  EPIPE: 'de verbinding viel weg',
  EPERM: 'dat mag niet van het systeem',
  EACCES: 'dat mag niet van het systeem',
  ENOSPC: 'de opslag is vol',
};
const CERTIFICAAT = /CERT|SELF_SIGNED|ERR_TLS|UNABLE_TO_VERIFY|HOSTNAME_MISMATCH|ALTNAME/;

/**
 * Een fout in gewone woorden, met de oorspronkelijke code tussen haakjes
 * erachter (voor wie het verder uitzoekt). Een fout zonder bekende code
 * blijft zoals hij is; onze eigen meldingen zijn al gewone taal.
 */
export function inGewoneWoorden(fout) {
  const code = typeof fout?.code === 'string' ? fout.code : typeof fout?.code === 'number' ? String(fout.code) : '';
  const bericht = String(fout?.message ?? fout ?? '');
  if (WOORDEN[code]) return `${WOORDEN[code]} (${code})`;
  if (CERTIFICAAT.test(code)) return `het certificaat klopt niet: zit er een ander apparaat op dit adres? (${code})`;
  if (/socket hang up/i.test(bericht)) return `de verbinding viel weg (${code || 'socket hang up'})`;
  if (/Bad username or password|Not authorized|Connection refused: (Bad|Not)/i.test(bericht)) {
    return `Zendure weigert de inlog; ik log opnieuw in (${bericht})`;
  }
  return bericht;
}

export const slaap = (ms) => new Promise((klaar) => setTimeout(klaar, ms));

// eslint-disable-next-line no-control-regex -- juist deze tekens moeten eruit
const ONZICHTBAAR = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

/**
 * Tekst van een apparaat in de wifi zonder stuurtekens, onzichtbare tekens en
 * omkeertekens, vóór het printen of als naam voorstellen. Dezelfde regel als
 * de app (base44/shared/tekst.js; web.test.js houdt ze gelijk).
 */
export function schoon(waarde, max) {
  if (typeof waarde !== 'string') return '';
  const tekst = waarde
    .normalize('NFC')
    .replace(/[\t\n\r]/g, ' ')
    .replace(ONZICHTBAAR, '')
    .replace(/ {2,}/g, ' ')
    .trim();
  return Array.from(tekst).slice(0, max).join('').trim();
}
