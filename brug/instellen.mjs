import fs from 'node:fs';
import process from 'node:process';
import readline from 'node:readline';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { controleerInstellingen, sleutelVan } from './instellingen.mjs';
import { datumInNederland } from './kosten.mjs';
import { DUIDELIJK_W, verbruikVan, vermogenInWoorden } from './samenvoegen.mjs';
import { leesTuya, luisterTuya } from './tuya.mjs';
import { haalTuyaApparaten } from './tuyaCloud.mjs';
import { vraagTuya } from './tuyaInstellen.mjs';
import { leesCloudsleutel } from './zendure.mjs';
import { isNacht } from './zon.mjs';
import { bereik, netwerkenUitTekst } from './zoek.mjs';

/**
 * De instelhulp: `node brug.mjs instellen [192.168.1]`. Zoekt de meters in het
 * netwerk en vraagt de rest, met bij elke vraag een voorstel dat je met Enter
 * neemt. Zo hoeft niemand JSON te typen, ook niet op een telefoon (Termux).
 * Staat er al een instellingen.json, dan komt het voorstel daaruit.
 *
 * Alles wat iets vraagt, zoekt of verstuurt komt van buiten (vraag, zoek,
 * maakCode, zonneplanLogin, bewaar), zodat de tests het zonder netwerk en
 * zonder toetsenbord kunnen nalopen. Geheimen (HomeWizard-codes, de
 * Zendure-sleutel, de sleutel van de app) komen nooit op het scherm.
 */

/** Het voorstel voor de vaste kosten: Zonneplan met een gewone netbeheerder, 2026 (pas het aan naar je eigen contract). */
export const VASTE_KOSTEN = { levering_per_maand: 6.25, netbeheer_per_maand: 39.66, vermindering_energiebelasting_per_maand: 52.41 };

/**
 * Wat een HomeWizard-meter meet. [2] alleen als de panelen en de Zendure samen
 * achter één meter zitten (in huis A: "Batterij + Zon"); heeft de batterij geen
 * eigen meter, zoals in huis B, dan is het [3]: de Zendure meldt zelf wat hij doet.
 */
const KEUZES = [
  ['net', 'de meterkast (P1-meter)'],
  ['zon-en-batterij', 'zonnepanelen én batterij samen op één meter (bijvoorbeeld een meter "Batterij + Zon")'],
  ['zon', 'alleen zonnepanelen'],
  ['apparaat', 'één apparaat (bijvoorbeeld de wasmachine of een laadpaal)'],
];
const NAAM_VOOR_ROL = { net: 'Meterkast', 'zon-en-batterij': 'Zon huis', zon: 'Zon dierenverblijf' };
const ROL_KORT = { net: 'meterkast (P1)', 'zon-en-batterij': 'zon en batterij samen', zon: 'zonnepanelen', apparaat: 'apparaat' };

/** Soorten met een eigen plaatje in de app (src/components/iconen.js); de naam van een apparaat kiest er een. */
const SOORTEN = ['wasmachine', 'droger', 'vaatwasser', 'koelkast', 'vriezer', 'laadpaal', 'auto', 'warmtepomp', 'boiler', 'kookplaat', 'oven', 'tv', 'computer', 'lamp', 'verwarming'];

const SERIENUMMER = /^[A-Fa-f0-9]{12}$/;
const CODE = /^[A-Fa-f0-9]{32}$/;
/** Het adres van de functie, niet dat van de site: de site zelf neemt geen metingen aan. */
const APP_ADRES = /^https:\/\/\S+\/functions\/ontvangMeting$/;
/** De sleutel van een omgeving, zoals de app hem laat zien (zie brug/instellingen.mjs). */
const APP_SLEUTEL = /^[a-fA-F0-9]{48}$/;
/** HomeWizard-apparaten die geen stroom meten. */
const GEEN_STROOM = /HWE-WTR|HWE-DSP|watermeter|display/i;
/** Wat nog uit instellingen.voorbeeld.json komt, is geen echte waarde. */
const VOORBEELDTEKST = /PLAK-HIER|JOUW-APP-ID/;
const VOORBEELD = new URL('./instellingen.voorbeeld.json', import.meta.url);

/* ---------- Wat mensen typen ---------- */

/** Ja of nee; Enter is het voorstel. Iets anders: null. */
export function jaNeeUit(tekst, standaard) {
  const t = String(tekst ?? '').trim().toLowerCase();
  if (t === '') return standaard;
  if (['j', 'ja', 'y', 'yes'].includes(t)) return true;
  if (['n', 'nee', 'no'].includes(t)) return false;
  return null;
}

/** Een keuze uit het lijstje: de rol, null (niet gebruiken) of undefined (geen keuze uit het lijstje). */
export function keuzeUit(tekst, standaard = null) {
  const t = String(tekst ?? '').trim().toLowerCase();
  if (t === '') return standaard;
  if (['0', 'n', 'nee', '-'].includes(t)) return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 1 && n <= KEUZES.length ? KEUZES[n - 1][0] : undefined;
}

/**
 * Een getal zoals mensen het typen: "6,25" of "6.25", met of zonder € of kWh.
 * Met duizendtallen is "7.247" 7247, zoals de Zonneplan-app het laat zien.
 */
export function getalUit(tekst, { duizendtallen = false } = {}) {
  let t = String(tekst ?? '')
    .replace(/\s+/g, '')
    .replace(/^€/, '')
    .replace(/(kwh|euro|eur)$/i, '');
  if (duizendtallen && /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, '');
  t = t.replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

/** "52.1, 5.18" (zoals Google Maps het geeft) of "52,1 5,18" → { breedte, lengte }; anders null. */
export function plaatsUit(tekst) {
  const t = String(tekst ?? '').trim();
  const deel =
    t.match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/) ?? t.match(/^(-?\d{1,2}(?:,\d+)?)\s*[;\s]\s*(-?\d{1,3}(?:,\d+)?)$/);
  if (!deel) return null;
  const [breedte, lengte] = [deel[1], deel[2]].map((d) => Number(d.replace(',', '.')));
  return Math.abs(breedte) <= 66 && Math.abs(lengte) <= 180 ? { breedte, lengte } : null;
}

const getalTekst = (g) => String(g).replace('.', ',');
const euro = (bedrag) => `€ ${bedrag.toFixed(2).replace('.', ',')}`;

/* ---------- Van antwoorden naar instellingen ---------- */

/**
 * Van de antwoorden naar wat er in instellingen.json komt, nagekeken met
 * dezelfde controle als het programmaatje zelf. Zonder (volledige) app mag
 * het ook: dan werkt proef al, en versturen nog niet.
 *
 * @param {{ meters?: object[], zendure?: object|null, zendure_p1?: object|null, prijzen?: string|null,
 *   vaste_kosten?: object|null, teruglevering_dit_jaar?: object|null, plaats?: object|null,
 *   app?: { adres?: string|null, sleutel?: string|null }|null, elke_seconden?: number }} a
 * @returns {{ ok: true, ruw: object, zonderApp: boolean } | { ok: false, fouten: string[] }}
 */
export function instellingenUitAntwoorden(a) {
  const ruw = {};
  if (a.app?.adres || a.app?.sleutel) {
    ruw.app = { ...(a.app.adres ? { adres: a.app.adres } : {}), ...(a.app.sleutel ? { sleutel: a.app.sleutel } : {}) };
  }
  if (typeof a.elke_seconden === 'number') ruw.elke_seconden = a.elke_seconden;
  ruw.homewizard = (a.meters ?? []).map((m) => ({ ...m, naam: String(m.naam ?? '').trim() }));
  if (a.zendure) ruw.zendure = a.zendure;
  if (a.zendure_p1) ruw.zendure_p1 = a.zendure_p1;
  if (a.goodwe) ruw.goodwe = a.goodwe;
  if (a.prijzen) ruw.prijzen = a.prijzen;
  if (a.vaste_kosten) ruw.vaste_kosten = a.vaste_kosten;
  if (a.teruglevering_dit_jaar) ruw.teruglevering_dit_jaar = a.teruglevering_dit_jaar;
  if (a.plaats) ruw.plaats = a.plaats;
  if (a.tuya?.length) ruw.tuya = a.tuya;
  const zonderApp = !(ruw.app?.adres && ruw.app?.sleutel);
  const uit = controleerInstellingen(ruw, { zonderApp });
  return uit.ok ? { ok: true, ruw, zonderApp } : { ok: false, fouten: uit.fouten };
}

/** Wat er bewaard wordt, in gewone woorden. Van codes en sleutels alleen óf ze er zijn, nooit de inhoud. */
export function samenvatting(ruw) {
  const regels = ['Dit komt erin:'];
  const meters = ruw.homewizard ?? [];
  for (const m of meters) regels.push(`  ${m.naam}: ${ROL_KORT[m.rol] ?? m.rol}, ${m.adres}${m.code ? ', met code' : ''}`);
  if (meters.length === 0) regels.push('  Geen HomeWizard-meters.');
  const z = ruw.zendure;
  const reserve = z?.cloudsleutel ? ', met de cloud als reserve (sleutel bewaard)' : '';
  regels.push(`  Zendure: ${!z ? 'geen' : z.manier === 'lokaal' ? `lokaal, ${z.adres}${reserve}` : 'via de cloud, sleutel bewaard'}`);
  if (ruw.zendure_p1) regels.push(`  Zendure P1-meter: ${ruw.zendure_p1.adres}, om te vergelijken`);
  if (ruw.goodwe) {
    const bij = (ruw.homewizard ?? []).find((m) => (m.sleutel ?? sleutelVan(m.naam)) === ruw.goodwe.bij);
    regels.push(`  Omvormer: GoodWe, ${ruw.goodwe.adres}${bij ? `, bij ${bij.naam}` : ''} (alleen lezen)`);
  }
  regels.push(`  Stroomprijzen: ${{ zonneplan: 'Zonneplan', energyzero: 'schatting (EnergyZero)' }[ruw.prijzen] ?? 'geen'}`);
  const v = ruw.vaste_kosten;
  if (v) {
    regels.push(
      `  Vaste kosten per maand: levering ${euro(v.levering_per_maand)}, netbeheer ${euro(v.netbeheer_per_maand)}, ` +
        `korting energiebelasting ${euro(v.vermindering_energiebelasting_per_maand)}`,
    );
  }
  const t = ruw.teruglevering_dit_jaar;
  if (t) regels.push(`  Al teruggeleverd in ${t.jaar}: ${getalTekst(t.kwh)} kWh`);
  if (ruw.prijzen) regels.push(`  Plaats: ${ruw.plaats ? `${ruw.plaats.breedte}, ${ruw.plaats.lengte}` : 'De Bilt (standaard)'}`);
  // Tuya: wat het is, nooit de local key.
  for (const a of ruw.tuya ?? []) regels.push(`  ${a.naam}: Tuya ${a.versie}, ${{ meter: 'meter', lamp: 'lamp', schakelaar: 'schakelaar' }[a.wat] ?? a.wat}${a.spots ? ' (spots in het overstek)' : ''}, ${a.adres}, local key bewaard`);
  regels.push(`  App: ${ruw.app?.adres ?? 'adres later'}, ${ruw.app?.sleutel ? 'sleutel bewaard' : 'sleutel later'}`);
  return regels;
}

/* ---------- De omvormer ---------- */

/** De sleutel van een meter zoals het programmaatje hem maakt (instellingen.mjs). */
const sleutelVanMeter = (m) => (typeof m.sleutel === 'string' && /^[a-zA-Z0-9._:-]{1,60}$/.test(m.sleutel) ? m.sleutel : sleutelVan(m.naam));

/**
 * Welke panelen bij de omvormer horen, in de volgorde van de app: panelen op
 * een groep met de batterij eerst (samenvoegen.mjs), dan de andere.
 */
export function zonMeters(lijst) {
  return [...lijst.filter((m) => m.rol === 'zon-en-batterij'), ...lijst.filter((m) => m.rol === 'zon')];
}

/**
 * Een GoodWe-omvormer (gevonden, of uit de huidige instellingen) uitlezen,
 * en bij welke panelen hij hoort. Geeft { adres, bij? } of null.
 */
async function vraagOmvormer({ gevonden, oud, lijst, zeg, jaNee, herhaal }) {
  zeg('\nOmvormer');
  const oudG = oud?.goodwe && typeof oud.goodwe === 'object' && typeof oud.goodwe.adres === 'string' ? oud.goodwe : null;
  const omvormers = gevonden.filter((g) => g.merk === 'GoodWe').map((g) => ({ adres: g.adres, naam: g.type ? `GoodWe ${g.type}` : 'GoodWe-omvormer', gevonden: true }));
  if (oudG && !omvormers.some((o) => o.adres === oudG.adres)) omvormers.push({ adres: oudG.adres, naam: 'GoodWe-omvormer', gevonden: false });
  if (omvormers.length === 0) {
    zeg("Geen GoodWe-omvormer gevonden. Heb je er een, zoek dan overdag: 's nachts staat hij uit, en zijn wifi-stekker ook.");
    return null;
  }
  let goodwe = null;
  for (const o of omvormers) {
    if (await jaNee(`${o.naam} (${o.adres}${o.gevonden ? '' : ', nu niet gevonden'}): uitlezen (alleen kijken, er verandert niets aan)?`, true)) {
      goodwe = { adres: o.adres };
      break;
    }
  }
  if (!goodwe) return null;
  const zon = zonMeters(lijst);
  if (zon.length === 1) {
    goodwe.bij = sleutelVanMeter(zon[0]);
    zeg(`Hij hoort bij ${zon[0].naam}.`);
  } else if (zon.length > 1) {
    const oudeIndex = zon.findIndex((m) => sleutelVanMeter(m) === oudG?.bij);
    const voorstel = oudeIndex === -1 ? 1 : oudeIndex + 1;
    zeg('Bij welke panelen hoort deze omvormer?');
    zon.forEach((m, i) => zeg(`  [${i + 1}] ${m.naam}`));
    const keuze = await herhaal(`Keuze [${voorstel}]: `, (t) => {
      if (!t.trim()) return voorstel;
      const n = Number(t.trim());
      return Number.isInteger(n) && n >= 1 && n <= zon.length ? n : opnieuw(`Typ 1 tot ${zon.length}, of alleen Enter.`);
    });
    goodwe.bij = sleutelVanMeter(zon[keuze - 1]);
  }
  return goodwe;
}

/* ---------- Het bestand ---------- */

/** De huidige instellingen als voorstel. Geen bestand, of nog het onaangeroerde voorbeeld: null. */
export function leesBestaand(pad) {
  let tekst;
  try {
    tekst = fs.readFileSync(pad, 'utf8');
  } catch (fout) {
    if (fout.code === 'ENOENT') return null;
    throw fout;
  }
  let ruw;
  try {
    ruw = JSON.parse(tekst);
  } catch {
    throw new Error('instellingen.json is geen geldige JSON. Zet hem opzij (mv instellingen.json instellingen.oud.json) en start opnieuw.');
  }
  if (!ruw || typeof ruw !== 'object' || Array.isArray(ruw)) return null;
  try {
    if (JSON.stringify(ruw) === JSON.stringify(JSON.parse(fs.readFileSync(VOORBEELD, 'utf8')))) return null;
  } catch {
    // Geen voorbeeld om mee te vergelijken: dan is dit gewoon het voorstel.
  }
  return ruw;
}

/** Eerst naar een tijdelijk bestand en dan hernoemen, alleen leesbaar voor jezelf: er staan geheimen in. */
export function bewaarInstellingen(pad, ruw) {
  const doel = pad instanceof URL ? fileURLToPath(pad) : pad;
  const tijdelijk = `${doel}.nieuw`;
  fs.rmSync(tijdelijk, { force: true });
  fs.writeFileSync(tijdelijk, `${JSON.stringify(ruw, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  fs.renameSync(tijdelijk, doel);
}

/* ---------- Vragen in de terminal ---------- */

/** Gestopt (Ctrl+C, of de invoer is op) voordat alles gevraagd was. */
export class Gestopt extends Error {
  constructor() {
    super('Gestopt; er is niets bewaard.');
  }
}

/**
 * vraag(tekst, { geheim }) → wat er getypt is. Regels die al binnen zijn
 * voordat de vraag komt (vooruit getypt, geplakt of uit een bestand) raken
 * niet kwijt. Bij geheim komt wat je typt of plakt niet op het scherm.
 * Sluiten met vraag.sluit().
 */
export function maakVraag({ invoer = process.stdin, uitvoer = process.stdout } = {}) {
  // Typ je in een terminal, dan echoot readline zelf (en dus niet bij geheim), ook als de uitvoer naar een bestand gaat.
  const terminal = Boolean(invoer.isTTY);
  let stil = false;
  const scherm = new Writable({
    write(stuk, _codering, klaar) {
      if (!stil) uitvoer.write(stuk);
      klaar();
    },
  });
  Object.defineProperty(scherm, 'columns', { get: () => uitvoer.columns });
  const rl = readline.createInterface({ input: invoer, output: scherm, terminal, historySize: 0 });
  const binnen = [];
  const wachtend = [];
  let dicht = false;
  rl.on('line', (regel) => (wachtend.length ? wachtend.shift().klaar(regel) : binnen.push(regel)));
  rl.on('close', () => {
    dicht = true;
    for (const w of wachtend.splice(0)) w.mis(new Gestopt());
  });
  // Ctrl+C: meteen stoppen, ook als er net gezocht wordt. Er wordt pas aan het eind bewaard.
  rl.on('SIGINT', () => {
    uitvoer.write('\nGestopt; er is niets bewaard.\n');
    process.exit(130);
  });

  const vraag = async (tekst, { geheim = false } = {}) => {
    if (dicht && binnen.length === 0) throw new Gestopt();
    if (dicht) {
      uitvoer.write(tekst);
    } else {
      rl.setPrompt(tekst);
      rl.prompt();
    }
    stil = geheim;
    try {
      const regel = binnen.length ? binnen.shift() : await new Promise((klaar, mis) => wachtend.push({ klaar, mis }));
      // Zonder terminal (antwoorden uit een bestand) zie je anders niet wat er gekozen is.
      if (!terminal) uitvoer.write(geheim ? '\n' : `${regel}\n`);
      else if (geheim) uitvoer.write('\n');
      return regel;
    } finally {
      stil = false;
    }
  };
  vraag.sluit = () => rl.close();
  return vraag;
}

/* ---------- De vragen ---------- */

class Opnieuw extends Error {}
const opnieuw = (uitleg) => {
  throw new Opnieuw(uitleg);
};

/** Vragen tot het antwoord klopt; lees() geeft de waarde of roept opnieuw(uitleg). */
function vragenMet(vraag, zeg) {
  const herhaal = async (tekst, lees, opties) => {
    for (;;) {
      try {
        return lees(await vraag(tekst, opties));
      } catch (fout) {
        if (!(fout instanceof Opnieuw)) throw fout;
        zeg(fout.message);
      }
    }
  };
  return {
    herhaal,
    jaNee: (tekst, standaard) =>
      herhaal(`${tekst} (${standaard ? 'J/n' : 'j/N'}) `, (t) => jaNeeUit(t, standaard) ?? opnieuw('Typ j of n, of alleen Enter.')),
    getal: (tekst, standaard, { min, max, duizendtallen = false, zonder = '' }) =>
      herhaal(`${tekst} [${standaard === null ? zonder : getalTekst(standaard)}]: `, (t) => {
        if (!t.trim()) return standaard;
        const g = getalUit(t, { duizendtallen });
        return g !== null && g >= min && g <= max ? g : opnieuw(`Typ een getal van ${getalTekst(min)} tot ${getalTekst(max)}, of alleen Enter.`);
      }),
    naam: (standaard, bezet) =>
      herhaal(`Naam [${standaard}]: `, (t) => {
        const naam = t.trim() || standaard;
        if (naam.length > 40) opnieuw('Hooguit 40 tekens.');
        if (bezet.has(sleutelVan(naam))) opnieuw('Die naam heeft al een andere meter; kies een andere.');
        return naam;
      }),
  };
}

const apparaatNaam = (g) => `${g.merk}${g.soort && g.soort !== '?' && g.soort !== g.merk ? ` ${g.soort}` : ''}`;
const isP1 = (g) => /HWE-P1/i.test(g.type ?? '') || /\bP1\b/i.test(g.soort ?? '');
const standaardNaam = (rol, g) => NAAM_VOOR_ROL[rol] ?? (g?.soort && g.soort !== '?' ? g.soort : 'Apparaat');
const serienummerVan = (s) => (typeof s === 'string' && SERIENUMMER.test(s) ? s.toLowerCase() : null);

/** Een naam die nog vrij is: "Zon huis", anders "Zon huis 2", enzovoort. */
function vrijeNaam(naam, bezet) {
  for (let n = 1; ; n++) {
    const kandidaat = n === 1 ? naam : `${naam} ${n}`;
    if (!bezet.has(sleutelVan(kandidaat))) return kandidaat;
  }
}

/** "Wasmachine boven" → wasmachine, "Wasdroger" → droger; anders null. */
function soortUitNaam(naam) {
  const woorden = String(naam ?? '').toLowerCase().split(/[^a-z]+/).filter(Boolean);
  return SOORTEN.find((s) => woorden.some((w) => w === s || (s.length > 3 && w.endsWith(s)))) ?? null;
}

/** Welke meter uit de huidige instellingen dit apparaat is: op serienummer, anders op adres. -1 = een nieuwe. */
function bijBestaand(g, oudeMeters, gebruikt) {
  const eigen = serienummerVan(g.serienummer);
  const vrij = (i) => !gebruikt.has(i);
  const opNummer = eigen ? oudeMeters.findIndex((m, i) => vrij(i) && serienummerVan(m.serienummer) === eigen) : -1;
  if (opNummer !== -1) return opNummer;
  return oudeMeters.findIndex((m, i) => {
    const ander = serienummerVan(m.serienummer);
    return vrij(i) && m.adres === g.adres && !(eigen && ander && ander !== eigen);
  });
}

const echteTekst = (s) => typeof s === 'string' && s.trim() !== '' && !VOORBEELDTEKST.test(s);

function geldigeCloudsleutel(s) {
  if (!echteTekst(s) || s.trim().length < 16) return null;
  try {
    leesCloudsleutel(s);
    return s.trim();
  } catch {
    return null;
  }
}

/** Wat een meter nu meet, of null (geen antwoord, of v2 zonder code); de instelhulp loopt altijd door. */
async function vermogenVan(leesVermogen, g, code) {
  if (g.api === 'v2' && !code) return null;
  try {
    const w = await leesVermogen(g, code);
    return typeof w === 'number' && Number.isFinite(w) ? w : null;
  } catch {
    return null;
  }
}

const OPWEK = ['min', 'plus'];
const OPNIEUW_KIEZEN = Symbol('opnieuw kiezen');

/**
 * Het teken van een zonnemeter (`opwek`, zie zonVanMeter in samenvoegen.mjs).
 * Alleen overdag en bij een duidelijk vermogen (DUIDELIJK_W) is dat na te gaan:
 *
 *   levert hij (in zijn teken)   dan klopt het: het teken blijft, of wordt 'min' (gewoon)
 *   gebruikt hij                 "Let op", en kiezen: toch iets anders (opnieuw kiezen),
 *                                omgekeerd aangesloten (het andere teken), of zo laten
 *   niet na te gaan              ('s nachts, bijna niets, geen antwoord) zoals het was;
 *                                weg blijft weg (dan telt hij zoals altijd, zie zonVanMeter)
 *
 * Bewust niet "het teken dat hij nu geeft is opwek": de spa in huis B gaf overdag
 * ook een flink getal, maar plus. Daarom beslist de mens, met de cijfers erbij.
 */
async function kiesOpwek({ w, dag, opwek, zeg, herhaal }) {
  if (w === null || !dag || Math.abs(w) < DUIDELIJK_W) return opwek;
  if (verbruikVan(w, opwek) <= -DUIDELIJK_W) return opwek ?? 'min';
  const ander = w > 0 ? 'plus' : 'min';
  zeg(`Let op: deze meter ${vermogenInWoorden(w)}. Overdag levert een zonnemeter${opwek === 'plus' ? ' (deze staat als omgekeerd aangesloten)' : ''}; dit lijkt verbruik, zoals van een apparaat.`);
  zeg('  [1] toch iets anders: opnieuw kiezen');
  zeg(`  [2] het is de zonnemeter, maar ${ander === 'plus' ? 'omgekeerd aangesloten: bij opwek geeft hij plus' : 'gewoon aangesloten: bij opwek geeft hij min'}`);
  zeg('  [3] het is de zonnemeter, laat hem zo (wat hij gebruikt telt niet als zon)');
  return herhaal('Keuze [1]: ', (t) => {
    const k = t.trim() || '1';
    if (k === '1') return OPNIEUW_KIEZEN;
    if (k === '2') return ander;
    if (k === '3') return opwek ?? 'min';
    return opnieuw('Typ 1, 2 of 3, of alleen Enter.');
  });
}

/** Apparaten die stroom meten (en de omvormer): geen watermeter of display. */
const meetStroom = (g) => g.merk === 'Zendure' || g.merk === 'GoodWe' || (g.merk === 'HomeWizard' && !GEEN_STROOM.test(`${g.type ?? ''} ${g.soort ?? ''}`));

/**
 * Zoeken, en laten zien waar. Ziet dit apparaat zijn eigen netwerk niet
 * (Android), of vindt hij er niets, dan vragen welk netwerk het wel is; ook
 * meer tegelijk. In huis A vond hij eerst niets en ging hij stil verder: zijn
 * HomeWizards zitten in een ander netwerk dan de telefoon.
 */
async function zoekInNetwerk({ zoek, netwerk, zeg, herhaal }) {
  let net = netwerk;
  for (;;) {
    let waar = [net ?? []].flat();
    let lijst = null;
    try {
      const opNetten = (netten) => {
        waar = netten;
        zeg(`\nZoeken in ${bereik(netten)}… (zo'n twintig seconden)`);
      };
      lijst = (await zoek({ netwerk: net, opNetten })).filter(meetStroom);
    } catch {
      zeg('Ik kan niet zien in welk netwerk dit apparaat zit.');
    }
    if (lijst?.length) return lijst;
    if (lijst) zeg(`Niets gevonden in ${bereik(waar)}. Staat dit apparaat op dezelfde wifi als de meters?`);
    net = await herhaal(
      'Welk netwerk dan? De eerste drie getallen van het IP-adres van dit apparaat of van een meter, bijvoorbeeld 192.168.1, of meer: 192.168.1 192.168.0 [verder zonder]: ',
      (t) => (t.trim() ? (netwerkenUitTekst(t) ?? opnieuw('Bijvoorbeeld 192.168.1, of 192.168.1 192.168.0, of alleen Enter.')) : null),
    );
    if (!net) return [];
  }
}

/**
 * De hele instelhulp. Geeft { bewaard: true, ruw } als alles bewaard is,
 * anders { bewaard: false } (met fouten als het niet klopte).
 *
 * @param {object} o
 * @param {(tekst: string, opties?: { geheim?: boolean }) => Promise<string>} o.vraag
 * @param {(tekst: string) => void} [o.zeg]
 * @param {(o: { netwerk?: string|string[], opNetten?: (netten: string[]) => void }) => Promise<object[]>} o.zoek    zoekApparaten uit zoek.mjs
 * @param {string|string[]} [o.netwerk]                              bijvoorbeeld "192.168.1." of ["192.168.1.", "192.168.0."]
 * @param {(adres: string, o: { opKnopWachten: () => void }) => Promise<string>} o.maakCode
 * @param {() => Promise<void>} o.zonneplanLogin                     vraagt e-mailadres en inlogcode
 * @param {() => boolean} [o.zonneplanIngelogd]
 * @param {object|null} [o.bestaand]                                 de huidige instellingen (het voorstel)
 * @param {(ruw: object) => void} o.bewaar
 * @param {string} [o.waar]                                          het bestand, voor in de tekst
 * @param {number} [o.nu]
 * @param {(g: object, code: string|null) => Promise<number|null>} [o.leesVermogen]  wat een HomeWizard nu meet (plus = gebruikt)
 * @param {{ haal?, luister?, lees? }} [o.tuya]                       Tuya-cloud, luisteren in de wifi en één keer uitlezen (tuyaInstellen.mjs)
 */
export async function voerUit({
  vraag,
  zeg = console.log,
  zoek,
  netwerk,
  maakCode,
  zonneplanLogin,
  zonneplanIngelogd = () => false,
  bestaand = null,
  bewaar,
  waar = 'instellingen.json',
  nu = Date.now(),
  leesVermogen = async () => null,
  tuya: { haal = haalTuyaApparaten, luister = () => luisterTuya(), lees = (a) => leesTuya(a) } = {},
}) {
  const oud = bestaand && typeof bestaand === 'object' && !Array.isArray(bestaand) ? bestaand : null;
  const { herhaal, jaNee, getal, naam: vraagNaam } = vragenMet(vraag, zeg);

  zeg('Instellen. Tussen [haken] staat wat je krijgt als je alleen op Enter drukt.');
  if (oud) zeg(`Het voorstel komt uit je huidige ${waar}.`);

  /* 1. Zoeken */
  const gevonden = await zoekInNetwerk({ zoek, netwerk, zeg, herhaal });
  if (gevonden.length === 0) {
    zeg('Verder zonder meters uit het netwerk.');
  } else {
    zeg('Gevonden:');
    gevonden.forEach((g, n) => zeg(`  ${n + 1}. ${apparaatNaam(g)} (${g.adres}${g.merk === 'HomeWizard' ? `, ${g.api}` : ''})`));
  }

  /* 2. HomeWizard: per meter wat het is en hoe hij heet */
  // Overdag kan de instelhulp bij een zonnemeter nagaan of het teken klopt (kiesOpwek).
  const dag = !isNacht(nu, datumInNederland(nu), oud?.plaats);
  const oudeMeters = (Array.isArray(oud?.homewizard) ? oud.homewizard : []).filter((m) => m && typeof m === 'object');
  const gebruikt = new Set();
  const bezet = new Set();
  const meters = [];
  for (const [n, g] of gevonden.entries()) {
    if (g.merk !== 'HomeWizard') continue;
    const oudeIndex = bijBestaand(g, oudeMeters, gebruikt);
    const oudM = oudeIndex === -1 ? null : oudeMeters[oudeIndex];
    if (oudM) gebruikt.add(oudeIndex);
    const voorstel = oudM
      ? (KEUZES.find(([rol]) => rol === oudM.rol)?.[0] ?? null)
      : isP1(g) && !meters.some((m) => m.meter.rol === 'net')
        ? 'net'
        : null;
    const nummer = KEUZES.findIndex(([rol]) => rol === voorstel) + 1;

    // Wat hij nu meet, met het teken in woorden: zo zie je welke meter wat is (in huis B stonden er twee verwisseld).
    const w = await vermogenVan(leesVermogen, g, typeof oudM?.code === 'string' && CODE.test(oudM.code) ? oudM.code : null);
    zeg(`\n${n + 1}. ${apparaatNaam(g)} (${g.adres})${w === null ? '' : `: ${vermogenInWoorden(w)}`}`);
    let rol;
    let opwek;
    for (;;) {
      zeg('Wat meet deze meter?');
      KEUZES.forEach(([, tekst], i) => zeg(`  [${i + 1}] ${tekst}`));
      zeg(voorstel ? '  [0] niet gebruiken' : '  [Enter] niet gebruiken');
      rol = await herhaal(`Keuze${voorstel ? ` [${nummer}]` : ''}: `, (t) => {
        const keuze = keuzeUit(t, voorstel);
        return keuze === undefined ? opnieuw(`Typ 1 tot ${KEUZES.length}${voorstel ? ', of 0 voor niet gebruiken' : ', of alleen Enter'}.`) : keuze;
      });
      if (rol !== 'zon') break;
      opwek = await kiesOpwek({ w, dag, opwek: oudM?.rol === 'zon' && OPWEK.includes(oudM.opwek) ? oudM.opwek : undefined, zeg, herhaal });
      if (opwek !== OPNIEUW_KIEZEN) break;
    }
    if (!rol) continue;

    const naam = await vraagNaam(
      vrijeNaam(oudM?.rol === rol && echteTekst(oudM.naam) ? oudM.naam.trim() : standaardNaam(rol, g), bezet),
      bezet,
    );
    bezet.add(sleutelVan(naam));

    let code = typeof oudM?.code === 'string' && CODE.test(oudM.code) ? oudM.code : null;
    if (!code && g.api === 'v2') {
      zeg('Deze meter kent alleen de nieuwe manier van HomeWizard (API v2); daarvoor is een code nodig.');
      if (await jaNee('Nu een code maken? Je drukt dan zo op het knopje van de meter.', true)) {
        zeg('Code aanvragen…');
        try {
          code = await maakCode(g.adres, {
            opKnopWachten: () => zeg(`Druk nu op het knopje van ${naam} (bij een kWh-meter 1 tot 3 seconden ingedrukt houden).`),
          });
          zeg('Gelukt; de code wordt bewaard.');
        } catch (fout) {
          zeg(`Geen code: ${fout.message}`);
        }
      }
      if (!code) zeg('Dat kan later nog met: node brug.mjs homewizard-code');
    } else if (!code && g.api === 'v1 staat uit') {
      zeg('Bij deze meter staat de Lokale API uit. Zet hem aan in de HomeWizard-app (bij de meter), of maak later een code: node brug.mjs homewizard-code');
    }

    const serienummer = serienummerVan(g.serienummer) ?? serienummerVan(oudM?.serienummer);
    const soort = rol === 'apparaat' ? (soortUitNaam(naam) ?? (typeof oudM?.soort === 'string' ? oudM.soort : null)) : null;
    meters.push({
      volgorde: oudM ? oudeIndex : oudeMeters.length + n,
      meter: {
        naam,
        rol,
        adres: g.adres,
        ...(serienummer ? { serienummer } : {}),
        ...(code ? { code } : {}),
        ...(soort ? { soort } : {}),
        ...(oudM?.rol === rol && typeof oudM.piek_w === 'number' ? { piek_w: oudM.piek_w } : {}),
        ...(rol === 'zon' && opwek ? { opwek } : {}),
        ...(typeof oudM?.sleutel === 'string' ? { sleutel: oudM.sleutel } : {}),
      },
    });
  }

  // Meters uit de huidige instellingen die nu niet antwoordden: misschien even uit.
  for (const [i, m] of oudeMeters.entries()) {
    if (gebruikt.has(i) || !KEUZES.some(([rol]) => rol === m.rol) || typeof m.adres !== 'string') continue;
    const oudeNaam = echteTekst(m.naam) ? m.naam.trim() : standaardNaam(m.rol);
    zeg('');
    if (!(await jaNee(`Niet gevonden: ${oudeNaam} (${m.adres}). Toch bewaren?`, true))) continue;
    const naam = bezet.has(sleutelVan(oudeNaam)) ? await vraagNaam(vrijeNaam(oudeNaam, bezet), bezet) : oudeNaam;
    bezet.add(sleutelVan(naam));
    meters.push({ volgorde: i, meter: { ...m, naam } });
  }
  const lijst = meters.sort((a, b) => a.volgorde - b.volgorde).map((m) => m.meter);

  /* 3. Zendure */
  zeg('\nZendure');
  const oudZ = oud?.zendure && typeof oud.zendure === 'object' ? oud.zendure : null;
  let zendure = null;
  const batterijen = gevonden
    .filter((g) => g.merk === 'Zendure' && g.soort !== 'P1-meter')
    .map((g) => ({ adres: g.adres, naam: apparaatNaam(g), gevonden: true }));
  if (oudZ?.manier === 'lokaal' && typeof oudZ.adres === 'string' && !batterijen.some((b) => b.adres === oudZ.adres)) {
    batterijen.push({ adres: oudZ.adres, naam: 'Zendure', gevonden: false });
  }
  for (const b of batterijen) {
    if (await jaNee(`${b.naam} (${b.adres}${b.gevonden ? '' : ', nu niet gevonden'}): lokaal uitlezen?`, true)) {
      zendure = { manier: 'lokaal', adres: b.adres };
      break;
    }
  }
  if (zendure) {
    // Lokaal gevonden: de cloud als reserve erbij (zendureMetReserve in zendure.mjs)? Enter = overslaan, of de bewaarde houden.
    const bewaard = geldigeCloudsleutel(oudZ?.cloudsleutel);
    zeg('Een cloudsleutel als reserve: antwoordt de Zendure lokaal een paar keer op rij niet, dan leest het programmaatje hem via de Zendure-cloud, tot hij lokaal weer antwoordt.');
    zeg('Zendure laat per account maar één cloudverbinding toe: gebruik deze sleutel dan niet ook in Home Assistant, Homey of een andere app.');
    zeg('De sleutel staat in de Zendure-app: Profiel › Autorisatiecloudsleutel › Ophalen. Je ziet hem niet terwijl je plakt; dat hoort zo.');
    const reserve = await herhaal(
      `Cloudsleutel als reserve [${bewaard ? 'de bewaarde houden, - = weghalen' : 'overslaan'}]: `,
      (t) => {
        const sleutel = t.replace(/\s+/g, '');
        if (!sleutel) return bewaard;
        if (sleutel === '-') return null;
        try {
          leesCloudsleutel(sleutel);
        } catch (fout) {
          opnieuw(fout.message);
        }
        return sleutel;
      },
      { geheim: true },
    );
    if (reserve) zendure.cloudsleutel = reserve;
  }
  if (!zendure) {
    const bewaard = oudZ?.manier === 'cloud' ? geldigeCloudsleutel(oudZ.cloudsleutel) : null;
    const nodig = lijst.find((m) => m.rol === 'zon-en-batterij');
    if (nodig) zeg(`Voor ${nodig.naam} (zon en batterij samen) is de Zendure nodig.`);
    if (nodig || (await jaNee('Zendure-batterij via de cloud koppelen?', Boolean(bewaard) || !oud))) {
      zeg('De Autorisatiecloudsleutel staat in de Zendure-app: Profiel › Autorisatiecloudsleutel › Ophalen.');
      zeg('Kopieer hem en plak hem hier. Je ziet hem niet terwijl je plakt; dat hoort zo.');
      zendure = await herhaal(
        `Autorisatiecloudsleutel${bewaard ? ' [de bewaarde houden]' : ''}: `,
        (t) => {
          const sleutel = t.replace(/\s+/g, '');
          if (!sleutel) {
            if (bewaard) return { manier: 'cloud', cloudsleutel: bewaard };
            if (nodig) opnieuw(`Zonder sleutel kan ik bij ${nodig.naam} de zon niet uitrekenen. Plak de sleutel, of stop met Ctrl+C.`);
            return null;
          }
          try {
            leesCloudsleutel(sleutel);
          } catch (fout) {
            opnieuw(fout.message);
          }
          return { manier: 'cloud', cloudsleutel: sleutel };
        },
        { geheim: true },
      );
      if (!zendure) zeg('Dan zonder Zendure.');
    }
  }
  if (zendure && !lijst.some((m) => m.rol === 'zon-en-batterij')) {
    zeg('Geen meter op de batterij? Dat is prima: de Zendure meldt zelf wat hij laadt en levert.');
  }

  // Een Zendure P1-meter op dezelfde meterkast: alleen om te vergelijken met de HomeWizard P1.
  let zendureP1 = null;
  if (lijst.some((m) => m.rol === 'net')) {
    const p1s = gevonden.filter((g) => g.merk === 'Zendure' && g.soort === 'P1-meter').map((g) => ({ adres: g.adres, gevonden: true }));
    const oudP1 = typeof oud?.zendure_p1?.adres === 'string' ? oud.zendure_p1.adres : null;
    if (oudP1 && !p1s.some((p) => p.adres === oudP1)) p1s.push({ adres: oudP1, gevonden: false });
    for (const p of p1s) {
      if (await jaNee(`Zendure P1-meter (${p.adres}${p.gevonden ? '' : ', nu niet gevonden'}). Vergelijken met de HomeWizard P1?`, true)) {
        zendureP1 = { adres: p.adres };
        break;
      }
    }
  }

  /* 3b. De omvormer van de zonnepanelen (GoodWe DT-serie, alleen lezen) */
  const goodwe = await vraagOmvormer({ gevonden, oud, lijst, zeg, jaNee, herhaal });

  /* 4. Stroomprijzen */
  zeg('\nStroomprijzen');
  const oudPrijzen = oud?.prijzen ?? null;
  let prijzen = null;
  if (await jaNee('Stroomprijzen van Zonneplan?', oud ? oudPrijzen === 'zonneplan' : true)) {
    prijzen = 'zonneplan';
    const ingelogd = zonneplanIngelogd();
    const later = 'Inloggen kan later met: node brug.mjs zonneplan-login. Tot dan rekent het programmaatje met een schatting.';
    if (await jaNee(ingelogd ? 'Je bent al ingelogd bij Zonneplan. Opnieuw inloggen?' : 'Nu inloggen bij Zonneplan?', !ingelogd)) {
      try {
        await zonneplanLogin();
      } catch (fout) {
        if (fout instanceof Gestopt) throw fout;
        zeg(`Inloggen lukte niet: ${fout.message}`);
        zeg(later);
      }
    } else if (!ingelogd) {
      zeg(later);
    }
  } else if (await jaNee('Dan alleen een schatting van de stroomprijs (EnergyZero, zonder inloggen)?', oudPrijzen === 'energyzero')) {
    prijzen = 'energyzero';
  }

  /* 5. Vaste kosten, wat al teruggeleverd is, en waar het huis staat */
  let vasteKosten = null;
  let terug = null;
  let plaats = null;
  if (prijzen) {
    const oudV = oud?.vaste_kosten && typeof oud.vaste_kosten === 'object' ? oud.vaste_kosten : null;
    if (await jaNee('Vaste kosten meerekenen (levering, netbeheer en de korting op de energiebelasting)?', oud ? Boolean(oudV) : true)) {
      const voorstel = (veld) => (typeof oudV?.[veld] === 'number' && oudV[veld] >= 0 && oudV[veld] <= 500 ? oudV[veld] : VASTE_KOSTEN[veld]);
      const grenzen = { min: 0, max: 500 };
      vasteKosten = {
        levering_per_maand: await getal('Levering per maand, in euro', voorstel('levering_per_maand'), grenzen),
        netbeheer_per_maand: await getal('Netbeheer per maand, in euro (staat in je contract)', voorstel('netbeheer_per_maand'), grenzen),
        vermindering_energiebelasting_per_maand: await getal(
          'Korting energiebelasting per maand, in euro',
          voorstel('vermindering_energiebelasting_per_maand'),
          grenzen,
        ),
      };
    }

    if (prijzen === 'zonneplan') {
      const jaar = Number(datumInNederland(nu).slice(0, 4));
      const oudT = oud?.teruglevering_dit_jaar;
      const voorstel = oudT?.jaar === jaar && typeof oudT.kwh === 'number' && oudT.kwh >= 0 && oudT.kwh <= 1_000_000 ? oudT.kwh : null;
      zeg(`Wat heb je in ${jaar} al teruggeleverd? Zonneplan-app › Inzichten › Jaar. Alleen voor het plafond van de Zonnebonus.`);
      const kwh = await getal('Teruggeleverd, in kWh', voorstel, { min: 0, max: 1_000_000, duizendtallen: true, zonder: 'overslaan' });
      if (kwh !== null) terug = { jaar, kwh };
    }

    const p = oud?.plaats;
    const oudPlaats = typeof p?.breedte === 'number' && typeof p?.lengte === 'number' ? plaatsUit(`${p.breedte}, ${p.lengte}`) : null;
    zeg('Waar staat het huis? Voor zon op en zon onder. In Google Maps: houd je vinger op je huis, dan staan de getallen bovenin.');
    plaats = await herhaal(`Plaats [${oudPlaats ? `${oudPlaats.breedte}, ${oudPlaats.lengte}` : 'De Bilt (standaard)'}]: `, (t) => {
      const tekst = t.trim();
      if (!tekst) return oudPlaats;
      if (/^(de bilt|standaard)$/i.test(tekst)) return null;
      return plaatsUit(tekst) ?? opnieuw('Typ twee getallen, zoals 52.1, 5.18 (eerst noord, dan oost), of alleen Enter.');
    });
  }

  /* 6. De app */
  zeg('\nDe app');
  zeg('Adres en sleutel van de app; Enter = later. De app laat ze zien als je je omgeving maakt; kwijt: Instellingen › Delen › Nieuwe sleutel.');
  const oudApp = oud?.app && typeof oud.app === 'object' ? oud.app : {};
  const oudAdres = echteTekst(oudApp.adres) && APP_ADRES.test(oudApp.adres) ? oudApp.adres : null;
  const oudSleutel = echteTekst(oudApp.sleutel) && APP_SLEUTEL.test(oudApp.sleutel.trim()) ? oudApp.sleutel : null;
  const adres = await herhaal(`Adres van de app [${oudAdres ?? 'later'}]: `, (t) => {
    const a = t.trim();
    if (!a) return oudAdres;
    return APP_ADRES.test(a)
      ? a
      : opnieuw('Dat is niet het adres voor het programmaatje. Dat eindigt op /functions/ontvangMeting en staat in de app bij de sleutel. Of druk alleen op Enter.');
  });
  const sleutel = await herhaal(
    `Sleutel van de app [${oudSleutel ? 'de bewaarde houden' : 'later'}]: `,
    (t) => {
      const s = t.trim();
      if (!s) return oudSleutel;
      return APP_SLEUTEL.test(s) ? s.toLowerCase() : opnieuw('De sleutel uit de app is 48 tekens (0-9 en a-f); of druk alleen op Enter.');
    },
    { geheim: true },
  );
  if (Boolean(adres) !== Boolean(sleutel)) zeg('Voor versturen zijn ze allebei nodig; tot dan werkt node brug.mjs proef wel.');

  /* 6b. Tuya (Smart Life): alleen als je wilt; de local keys uit de Tuya-cloud (tuyaInstellen.mjs) */
  const tuya = await vraagTuya({ oud, zeg, herhaal, jaNee, opnieuw, haal, luister, lees });

  /* 7. Nakijken, laten zien en bewaren */
  const uit = instellingenUitAntwoorden({
    app: { adres, sleutel },
    elke_seconden: typeof oud?.elke_seconden === 'number' && oud.elke_seconden >= 3 && oud.elke_seconden <= 300 ? oud.elke_seconden : undefined,
    meters: lijst,
    zendure,
    zendure_p1: zendureP1,
    goodwe,
    prijzen,
    vaste_kosten: vasteKosten,
    teruglevering_dit_jaar: terug,
    plaats,
    tuya,
  });
  zeg('');
  if (!uit.ok) {
    zeg('Zo klopt het nog niet:');
    for (const fout of uit.fouten) zeg(`  - ${fout}`);
    zeg('Er is niets bewaard. Probeer het opnieuw: node brug.mjs instellen');
    return { bewaard: false, fouten: uit.fouten };
  }
  for (const regel of samenvatting(uit.ruw)) zeg(regel);
  if (!(await jaNee(`Bewaren in ${waar}?`, true))) {
    zeg('Niets bewaard.');
    return { bewaard: false };
  }
  bewaar(uit.ruw);
  zeg(`Bewaard in ${waar}.`);
  zeg('Volgende stap: node brug.mjs proef');
  return { bewaard: true, ruw: uit.ruw };
}
