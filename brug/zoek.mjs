import dgram from 'node:dgram';
import os from 'node:os';
import { INFO_AANTAL, INFO_BEGIN, serieUit, typeUit, vraagRegisters, zoekGoodWe } from './goodwe.mjs';
import { tlsVoor } from './homewizard.mjs';
import { kenmerkVan } from './kenmerk.mjs';
import { schoon, vraagJson } from './web.mjs';
import { p1Uit } from './zendure.mjs';

/**
 * HomeWizard- en Zendure-apparaten en een GoodWe-omvormer in het eigen netwerk zoeken, door elk
 * adres in hetzelfde stukje netwerk (bijvoorbeeld 192.168.1.1 tot .254) even
 * te proberen. Kost zo'n tien tot twintig seconden; er gaat niets naar internet.
 *
 * Wat we proberen, per adres:
 *   https://<adres>/api      een HomeWizard met v2 (het certificaat verraadt soort en serienummer)
 *   http://<adres>/api       een HomeWizard met v1 (ook als de Lokale API uit staat: dan 403)
 *   http://<adres>/properties/report   een Zendure met de lokale koppeling aan, of een Zendure P1-meter
 *   udp://<adres>:8899       een GoodWe-omvormer (DT-serie): één leesvraag om zijn type (goodwe.mjs)
 *
 * Daarnaast één broadcast voor GoodWe-wifi-stekkers (poort 48899). 's Nachts
 * staat een GoodWe uit, met zijn wifi-stekker: die vind je alleen overdag.
 */

/** De /24-netwerken bij deze adressen, zoals "192.168.1." Alleen gewone thuisnetwerken. */
export function netwerkenUit(interfaces) {
  const gevonden = new Set();
  for (const adressen of Object.values(interfaces)) {
    for (const a of adressen ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const delen = a.address.split('.');
      // Een groot bedrijfsnetwerk of een VPN scannen we niet.
      if (delen[0] === '192' || delen[0] === '10' || (delen[0] === '172' && Number(delen[1]) >= 16 && Number(delen[1]) <= 31)) {
        gevonden.add(`${delen.slice(0, 3).join('.')}.`);
      }
    }
  }
  return [...gevonden];
}

/**
 * Het eigen adres zonder het aan het systeem te vragen: een UDP-"verbinding"
 * kiest het adres waarmee dit apparaat naar buiten zou gaan. Er wordt niets
 * verstuurd. Nodig op Android (Termux): daar mag een app de lijst met
 * netwerken vaak niet opvragen.
 */
export function eigenAdres() {
  return new Promise((klaar) => {
    const s = dgram.createSocket('udp4');
    s.on('error', () => {
      s.close();
      klaar(null);
    });
    s.connect(53, '1.1.1.1', () => {
      let adres = null;
      try {
        adres = s.address().address;
      } catch {
        // Geen adres: dan kan de gebruiker het netwerk zelf noemen.
      }
      s.close();
      klaar(adres);
    });
  });
}

/** De netwerken om te doorzoeken: eerst via het systeem, anders via eigenAdres(). */
export async function netwerken() {
  try {
    const lijst = netwerkenUit(os.networkInterfaces());
    if (lijst.length) return lijst;
  } catch {
    // Android: "uv_interface_addresses returned Unknown system error 13".
  }
  const adres = await eigenAdres();
  return adres ? netwerkenUit({ wifi: [{ family: 'IPv4', internal: false, address: adres }] }) : [];
}

const CERT_SOORT = { p1dongle: 'P1-meter', energysocket: 'Energy Socket', energymeter: 'kWh-meter', watermeter: 'Watermeter', battery: 'Plug-In Battery', display: 'Energy Display' };

/**
 * Een GoodWe op dit adres? Eén leesvraag (alleen lezen) naar de apparaatgegevens; daaruit het
 * type ("GW8K-DT") en het kenmerk (de vingerafdruk van het serienummer, om hem terug te vinden;
 * adressen.mjs), nooit het serienummer zelf. Geeft het apparaat of null.
 */
export async function goodweOp(adres, { tijd = 900, lees = vraagRegisters } = {}) {
  try {
    const gegevens = await lees(adres, INFO_BEGIN, INFO_AANTAL, { tijd, pogingen: 1 });
    const type = typeUit(gegevens);
    const kenmerk = kenmerkVan(serieUit(gegevens));
    return { adres, merk: 'GoodWe', soort: type ? `omvormer ${type}` : 'omvormer', type: type ?? '', api: 'lokaal', ...(kenmerk ? { kenmerk } : {}) };
  } catch (fout) {
    // Kent hij het blok niet, dan is het toch een GoodWe (die antwoordt met een weigering).
    return fout?.code === 'GEWEIGERD' ? { adres, merk: 'GoodWe', soort: 'omvormer', type: '', api: 'lokaal' } : null;
  }
}

/**
 * Wat er op dit adres zit. `merken`: alleen die merken proberen (terugvinden, adressen.mjs);
 * zonder: alles. Elk gevonden apparaat met een serienummer krijgt ook zijn kenmerk (kenmerk.mjs).
 */
export async function probeer(adres, { merken = null } = {}) {
  const wil = (merk) => !merken || merken.has(merk);
  const gevonden = [];
  // Tegelijk met de rest: zo duurt het zoeken niet langer.
  const goodweBelofte = wil('GoodWe') ? goodweOp(adres) : null;

  let cn = '';
  if (wil('HomeWizard')) try {
    const { json } = await vraagJson(`https://${adres}/api`, { tijd: 900, tls: tlsVoor(undefined, (naam) => (cn = naam)) });
    const [, soort, serienummer] = cn.split('/');
    gevonden.push({
      adres,
      merk: 'HomeWizard',
      soort: json?.product_name ?? CERT_SOORT[soort] ?? soort,
      type: json?.product_type ?? '',
      serienummer,
      api: 'v2',
    });
  } catch {
    // Geen HomeWizard met v2 op dit adres.
  }

  if (wil('HomeWizard')) try {
    const { status, json } = await vraagJson(`http://${adres}/api`, { tijd: 900 });
    if (json?.product_type) {
      const al = gevonden.find((g) => g.merk === 'HomeWizard');
      if (al) al.api = 'v1 en v2';
      else gevonden.push({ adres, merk: 'HomeWizard', soort: json.product_name, type: json.product_type, serienummer: json.serial, api: 'v1' });
    } else if (status === 403 && json?.error?.id === 202 && !gevonden.length) {
      gevonden.push({ adres, merk: 'HomeWizard', soort: '?', type: '', api: 'v1 staat uit' });
    }
  } catch {
    // Niets op dit adres, of geen HomeWizard.
  }

  if (wil('Zendure')) try {
    const { json } = await vraagJson(`http://${adres}/properties/report`, { tijd: 900 });
    if (json?.properties && json?.sn) gevonden.push({ adres, merk: 'Zendure', soort: json.product ?? 'Zendure', serienummer: json.sn, api: 'lokaal' });
    else if (p1Uit(json) !== null) gevonden.push({ adres, merk: 'Zendure', soort: 'P1-meter', serienummer: json.deviceId ?? '', api: 'lokaal' });
  } catch {
    // Geen Zendure met de lokale koppeling aan.
  }

  const gw = await goodweBelofte;
  if (gw) gevonden.push(gw);

  // Wat een apparaat over zichzelf zegt, zonder rare tekens: het wordt geprint en als naam voorgesteld.
  return gevonden.map((g) => {
    const kenmerk = g.kenmerk ?? kenmerkVan(g.serienummer);
    return {
      ...g,
      soort: schoon(String(g.soort ?? ''), 40),
      type: schoon(String(g.type ?? ''), 40),
      serienummer: schoon(String(g.serienummer ?? ''), 40),
      ...(kenmerk ? { kenmerk } : {}),
    };
  });
}

/** "192.168.1" of "192.168.1.0" (zelf opgegeven) → "192.168.1.", anders null. */
export function netwerkUitTekst(tekst) {
  const deel = String(tekst ?? '').match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\.\d{1,3})?$/);
  if (!deel || deel.slice(1).some((d) => Number(d) > 255)) return null;
  return `${deel[1]}.${deel[2]}.${deel[3]}.`;
}

/**
 * Een of meer netwerken, met spaties of komma's ertussen: "192.168.1 192.168.0"
 * → ["192.168.1.", "192.168.0."]. Thuis kunnen dat er twee zijn (in huis A:
 * telefoon en Zendure P1 in 192.168.0, de HomeWizards in 192.168.1). Eén
 * onleesbaar stuk, of niets: null.
 */
export function netwerkenUitTekst(tekst) {
  const delen = String(tekst ?? '')
    .split(/[\s,;]+/)
    .filter(Boolean);
  const netten = delen.map(netwerkUitTekst);
  if (netten.length === 0 || netten.includes(null)) return null;
  return [...new Set(netten)];
}

/** Waar gezocht wordt, voor mensen: "192.168.1.1 tot 192.168.1.254". */
export const bereik = (netten) => (netten.length ? netten.map((net) => `${net}1 tot ${net}254`).join(' en ') : 'je netwerk');

/**
 * Alle apparaten in het eigen netwerk, of in de opgegeven netwerken
 * (bijvoorbeeld "192.168.1." of ["192.168.1.", "192.168.0."], als het apparaat
 * zijn eigen netwerk niet kan zien of de meters in een ander netwerk zitten).
 * `opNetten` hoort vóór het zoeken welke netwerken het worden: zo zie je waar
 * gezocht wordt, ook als het een verkeerd netwerk blijkt (bijvoorbeeld dat van
 * de mobiele data in plaats van de wifi).
 */
export async function zoekApparaten({ tegelijk = 48, netwerk, opNetten, zoekOmvormers = zoekGoodWe, merken = null, probeerAdres = probeer } = {}) {
  const opgegeven = [netwerk ?? []].flat();
  const netten = opgegeven.length ? [...new Set(opgegeven)] : await netwerken();
  if (netten.length === 0) {
    throw new Error('Ik kan niet zien in welk netwerk dit apparaat zit. Noem het zelf, bijvoorbeeld: node brug.mjs zoek 192.168.1');
  }
  opNetten?.(netten);
  const adressen = netten.flatMap((net) => Array.from({ length: 254 }, (_, i) => `${net}${i + 1}`));
  // GoodWe-wifi-stekkers die op de broadcast antwoorden, ook buiten deze netwerken.
  const omvormers = !merken || merken.has('GoodWe') ? zoekOmvormers({ netten }).catch(() => []) : Promise.resolve([]);
  const gevonden = [];
  let volgende = 0;
  await Promise.all(
    Array.from({ length: Math.min(tegelijk, adressen.length) }, async () => {
      while (volgende < adressen.length) {
        const adres = adressen[volgende++];
        gevonden.push(...(await probeerAdres(adres, { merken })));
      }
    }),
  );
  for (const adres of await omvormers) {
    if (gevonden.some((g) => g.adres === adres && g.merk === 'GoodWe')) continue;
    gevonden.push((await goodweOp(adres)) ?? { adres, merk: 'GoodWe', soort: 'omvormer', type: '', api: 'lokaal' });
  }
  const nummer = (a) => a.split('.').map(Number).reduce((t, d) => t * 256 + d, 0);
  return gevonden.sort((a, b) => nummer(a.adres) - nummer(b.adres));
}

/**
 * Terugvinden (adressen.mjs, sinds 1.3.0): rustig zoeken in de netwerken waar de apparaten
 * zaten, alleen naar de merken die we missen, terwijl het programmaatje doormeet. Acht adressen
 * tegelijk (zoek met de hand: 48), zodat de wifi en de meters er weinig van merken; zo'n halve
 * minuut tot een minuut per netwerk. Nooit over de blijvende verbindingen (web.mjs).
 */
export function zoekOpnieuw({ netten, merken, tegelijk = 8, ...rest }) {
  return zoekApparaten({ netwerk: netten, merken, tegelijk, ...rest });
}
