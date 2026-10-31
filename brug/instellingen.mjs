import fs from 'node:fs';
import process from 'node:process';
import { controleerTuya } from './tuyaInstellingen.mjs';

/**
 * De instellingen van het programmaatje: brug/instellingen.json (of het pad
 * in BRUG_INSTELLINGEN). Een voorbeeld staat in instellingen.voorbeeld.json.
 * Dit bestand bevat geheimen (de sleutel voor de app, codes, de
 * Zendure-cloudsleutel) en staat daarom in .gitignore.
 */

export const STANDAARD_PAD = new URL('./instellingen.json', import.meta.url);

const ADRES = /^[a-zA-Z0-9.-]{1,253}$/;
const ROLLEN = ['net', 'zon', 'zon-en-batterij', 'apparaat'];
const OPWEK = ['min', 'plus'];

/** De vaste sleutel van een meter uit zijn naam: "Zon huis" → hw-zon-huis. */
export function sleutelVan(naam) {
  const kort = naam
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
  return `hw-${kort || 'meter'}`;
}

/**
 * Nakijken en aanvullen. Geeft alle fouten tegelijk, in gewone woorden.
 * @param {unknown} ruw
 * @param {{ zonderApp?: boolean }} opties  zonderApp: voor proef en zoek is de app niet nodig
 */
export function controleerInstellingen(ruw, { zonderApp = false } = {}) {
  const fouten = [];
  const i = ruw && typeof ruw === 'object' ? ruw : {};

  const app = i.app ?? {};
  if (!zonderApp) {
    if (typeof app.adres !== 'string' || !/^https:\/\/\S+$/.test(app.adres)) {
      fouten.push('app.adres: het adres van de functie ontvangMeting ontbreekt (begint met https://).');
    }
    if (typeof app.sleutel !== 'string' || !/^[a-fA-F0-9]{48}$/.test(app.sleutel.trim())) {
      fouten.push(
        'app.sleutel: de sleutel uit de app ontbreekt of klopt niet (48 tekens, 0-9 en a-f). Je krijgt hem in de app bij het maken van je omgeving, of in Instellingen › Delen › Nieuwe sleutel.',
      );
    }
  }

  const elke = i.elke_seconden ?? 5;
  if (typeof elke !== 'number' || elke < 3 || elke > 300) fouten.push('elke_seconden: kies een getal van 3 tot 300.');

  const homewizard = [];
  const sleutels = new Set();
  (Array.isArray(i.homewizard) ? i.homewizard : []).forEach((m, n) => {
    const waar = `homewizard[${n}]`;
    if (!m || typeof m !== 'object') return fouten.push(`${waar}: geen meter.`);
    if (typeof m.naam !== 'string' || !m.naam.trim()) fouten.push(`${waar}.naam: geef de meter een naam.`);
    if (!ROLLEN.includes(m.rol)) fouten.push(`${waar}.rol: kies "net", "zon", "zon-en-batterij" of "apparaat".`);
    if (m.piek_w !== undefined && (typeof m.piek_w !== 'number' || m.piek_w < 100 || m.piek_w > 100_000)) {
      fouten.push(`${waar}.piek_w: het meeste dat de panelen kunnen leveren, in watt (100 tot 100000).`);
    }
    // Bij een zonnemeter: welk teken opwek heeft (zonVanMeter in samenvoegen.mjs); weg = nog niet bekend.
    if (m.opwek !== undefined && !OPWEK.includes(m.opwek)) {
      fouten.push(`${waar}.opwek: "min" (gewoon: opwek is min) of "plus" (omgekeerd aangesloten: opwek is plus), of laat het weg.`);
    }
    if (typeof m.adres !== 'string' || !ADRES.test(m.adres)) fouten.push(`${waar}.adres: het IP-adres ontbreekt of klopt niet (bijvoorbeeld 192.168.1.20).`);
    if (m.code !== undefined && !/^[A-Fa-f0-9]{32}$/.test(m.code)) fouten.push(`${waar}.code: een HomeWizard-code is 32 tekens (0-9, A-F).`);
    if (m.serienummer !== undefined && !/^[A-Fa-f0-9]{12}$/.test(m.serienummer)) fouten.push(`${waar}.serienummer: 12 tekens (0-9, a-f).`);
    const naam = typeof m.naam === 'string' ? m.naam.trim() : '';
    const sleutel = typeof m.sleutel === 'string' && /^[a-zA-Z0-9._:-]{1,60}$/.test(m.sleutel) ? m.sleutel : sleutelVan(naam);
    if (sleutels.has(sleutel)) fouten.push(`${waar}: twee meters met dezelfde naam; geef ze elk een eigen naam.`);
    sleutels.add(sleutel);
    homewizard.push({
      naam,
      rol: m.rol,
      adres: m.adres,
      sleutel,
      soort: typeof m.soort === 'string' && /^[a-z]{1,20}$/.test(m.soort) ? m.soort : 'stekker',
      ...(m.code ? { code: m.code.toUpperCase() } : {}),
      ...(m.serienummer ? { serienummer: m.serienummer.toLowerCase() } : {}),
      ...(typeof m.piek_w === 'number' ? { piek_w: m.piek_w } : {}),
      ...(m.rol === 'zon' && OPWEK.includes(m.opwek) ? { opwek: m.opwek } : {}),
    });
  });

  let zendure = null;
  if (i.zendure) {
    const z = i.zendure;
    if (z.manier === 'lokaal') {
      if (typeof z.adres !== 'string' || !ADRES.test(z.adres)) fouten.push('zendure.adres: het IP-adres van de Zendure ontbreekt.');
      // Lokaal met de cloud als reserve (brug 0.6.2): antwoordt hij lokaal niet, dan via de cloud (zendureMetReserve).
      const reserve = z.cloudsleutel;
      if (reserve !== undefined && (typeof reserve !== 'string' || reserve.trim().length < 16)) {
        fouten.push('zendure.cloudsleutel: de Autorisatiecloudsleutel uit de Zendure-app (als reserve), of laat hem weg.');
      }
      zendure = { manier: 'lokaal', adres: z.adres, ...(typeof reserve === 'string' && reserve.trim() ? { cloudsleutel: reserve.trim() } : {}) };
    } else if (z.manier === 'cloud') {
      if (typeof z.cloudsleutel !== 'string' || z.cloudsleutel.trim().length < 16) {
        fouten.push('zendure.cloudsleutel: plak hier de Autorisatiecloudsleutel uit de Zendure-app.');
      }
      zendure = { manier: 'cloud', cloudsleutel: String(z.cloudsleutel ?? '').trim() };
    } else {
      fouten.push('zendure.manier: kies "lokaal" of "cloud".');
    }
  }

  // Een Zendure P1-meter op dezelfde meterkast: alleen om te vergelijken met de HomeWizard P1.
  let zendureP1 = null;
  if (i.zendure_p1 !== undefined) {
    const adres = i.zendure_p1?.adres;
    if (typeof adres !== 'string' || !ADRES.test(adres)) fouten.push('zendure_p1.adres: het IP-adres van de Zendure P1-meter ontbreekt of klopt niet.');
    zendureP1 = { adres };
  }

  // Een GoodWe-omvormer (DT-serie) in de wifi, alleen lezen (goodwe.mjs). `bij`: de sleutel van de
  // zonnebron (meter) waar hij bij hoort, voor het blad in de app; weg = de eerste zonnebron.
  let goodwe = null;
  if (i.goodwe !== undefined) {
    const g = i.goodwe && typeof i.goodwe === 'object' ? i.goodwe : {};
    if (typeof g.adres !== 'string' || !ADRES.test(g.adres)) fouten.push('goodwe.adres: het IP-adres van de omvormer ontbreekt of klopt niet (bijvoorbeeld 192.168.1.30).');
    if (g.bij !== undefined && (typeof g.bij !== 'string' || !/^[a-zA-Z0-9._:-]{1,60}$/.test(g.bij))) {
      fouten.push('goodwe.bij: de sleutel van de zonnepanelen waar de omvormer bij hoort (bijvoorbeeld hw-zon-huis), of laat het weg.');
    }
    goodwe = { adres: g.adres, ...(typeof g.bij === 'string' ? { bij: g.bij } : {}) };
  }

  // Stroomprijzen: van Zonneplan (eerst inloggen), of alleen de schatting via EnergyZero. Weg = geen prijzen.
  const prijzen = i.prijzen ?? null;
  if (prijzen !== null && prijzen !== 'zonneplan' && prijzen !== 'energyzero') fouten.push('prijzen: kies "zonneplan" of "energyzero", of laat het weg.');

  // Vaste kosten per maand, uit je contract (Kiki in de Zonneplan-app weet ze ook). Weg = niet meerekenen.
  let vasteKosten = null;
  if (i.vaste_kosten !== undefined) {
    const v = i.vaste_kosten && typeof i.vaste_kosten === 'object' ? i.vaste_kosten : {};
    const bedrag = (veld, uitleg) => {
      const w = v[veld];
      if (typeof w === 'number' && Number.isFinite(w) && w >= 0 && w <= 500) return w;
      fouten.push(`vaste_kosten.${veld}: ${uitleg}`);
      return 0;
    };
    vasteKosten = {
      levering_per_maand: bedrag('levering_per_maand', 'de vaste leveringskosten per maand in euro (Zonneplan: 6.25).'),
      netbeheer_per_maand: bedrag('netbeheer_per_maand', 'de netbeheerkosten per maand in euro; die staan in je contract in de Zonneplan-app.'),
      vermindering_energiebelasting_per_maand: bedrag(
        'vermindering_energiebelasting_per_maand',
        'de korting op de energiebelasting per maand in euro (2026: 52.41).',
      ),
    };
    if (!prijzen) fouten.push('vaste_kosten: zet ook "prijzen" aan; zonder prijzen rekent het programmaatje geen kosten uit.');
  }

  // Waar het huis staat, voor zon op en onder (Zonnebonus). Weg = De Bilt (het midden van het land).
  let plaats = null;
  if (i.plaats !== undefined) {
    const { breedte, lengte } = i.plaats ?? {};
    if (typeof breedte === 'number' && breedte >= -66 && breedte <= 66 && typeof lengte === 'number' && lengte >= -180 && lengte <= 180) {
      plaats = { breedte, lengte };
    } else {
      fouten.push('plaats: { "breedte": 52.1, "lengte": 5.18 } (graden noord en oost, bijvoorbeeld uit Google Maps), of laat het weg.');
    }
  }

  // Wat je dit jaar al had teruggeleverd voordat het programmaatje draaide (Zonneplan-app); voor het plafond van 7.500 kWh.
  let terugAl = null;
  if (i.teruglevering_dit_jaar !== undefined) {
    const z = i.teruglevering_dit_jaar ?? {};
    if (Number.isInteger(z.jaar) && z.jaar >= 2025 && z.jaar <= 2100 && typeof z.kwh === 'number' && z.kwh >= 0 && z.kwh <= 1_000_000) {
      terugAl = { jaar: z.jaar, kwh: z.kwh };
    } else {
      fouten.push(
        'teruglevering_dit_jaar: bijvoorbeeld { "jaar": 2026, "kwh": 7247 }: wat je dit jaar al teruggeleverd hebt (Zonneplan-app › Inzichten › Jaar).',
      );
    }
  }

  // Tuya-apparaten (tuyaInstellingen.mjs): een meter zoals de pomp, lampen en schakelaars. Alleen lezen.
  const tuya = controleerTuya(i.tuya, fouten, sleutels);

  if (homewizard.length === 0 && !zendure && !goodwe && tuya.length === 0) fouten.push('Er staat nog geen enkele meter in: vul "homewizard" en/of "zendure" in.');
  if (homewizard.some((m) => m.rol === 'zon-en-batterij') && !zendure) {
    fouten.push('Een meter met rol "zon-en-batterij" heeft de Zendure nodig om de zon uit te rekenen: vul "zendure" in.');
  }

  return fouten.length
    ? { ok: false, fouten }
    : {
        ok: true,
        instellingen: {
          app: { adres: app.adres, sleutel: typeof app.sleutel === 'string' ? app.sleutel.trim().toLowerCase() : app.sleutel },
          elke_seconden: elke,
          homewizard,
          zendure,
          zendure_p1: zendureP1,
          goodwe,
          prijzen,
          vaste_kosten: vasteKosten,
          teruglevering_dit_jaar: terugAl,
          plaats,
          tuya,
        },
      };
}

/**
 * Een JSON-bestand met geheimen lezen. Node zet bij kapotte JSON een stukje
 * van de inhoud in de foutmelding (en dat komt in brug.log); hier staat in de
 * melding alleen waar het misgaat, nooit wat er staat.
 */
export function leesJsonBestand(tekst, naam = 'instellingen.json') {
  try {
    return JSON.parse(tekst);
  } catch (fout) {
    const bericht = String(fout?.message ?? '');
    let plek = /\(line (\d+) column (\d+)\)/.exec(bericht);
    if (!plek) {
      const positie = /at position (\d+)/.exec(bericht);
      if (positie) {
        const voor = String(tekst).slice(0, Number(positie[1]));
        const regels = voor.split('\n');
        plek = [null, regels.length, regels.at(-1).length + 1];
      }
    }
    // Bewust zonder cause: de oorspronkelijke fout bevat een stukje van de geheimen.
    // eslint-disable-next-line preserve-caught-error
    throw new Error(`${naam} is geen geldige JSON${plek ? ` (regel ${plek[1]}, kolom ${plek[2]})` : ''}.`);
  }
}

/**
 * Bestanden met geheimen zijn alleen voor jou (0600). Met de hand gekopieerd
 * of van vroeger kan dat anders zijn: dan zetten we het recht, met een regel
 * in het logboek. Op Windows bestaat dit niet. Geeft true als er iets veranderde.
 */
export function maakPrive(pad, { log = (t) => console.log(t), naam = 'instellingen.json', platform = process.platform } = {}) {
  if (platform === 'win32') return false;
  try {
    if ((fs.statSync(pad).mode & 0o077) === 0) return false;
    fs.chmodSync(pad, 0o600);
    log(`${naam} was leesbaar voor anderen op deze computer; nu alleen voor jou.`);
    return true;
  } catch {
    return false;
  }
}

/** Lees en controleer het bestand; bij een fout een duidelijke melding en stoppen. */
export function laadInstellingen(opties) {
  const pad = process.env.BRUG_INSTELLINGEN || STANDAARD_PAD;
  let tekst;
  try {
    tekst = fs.readFileSync(pad, 'utf8');
  } catch {
    console.error(`Geen instellingen gevonden (${pad}).\nMaak ze met: node brug.mjs instellen`);
    process.exit(1);
  }
  maakPrive(pad);
  let ruw;
  try {
    ruw = leesJsonBestand(tekst);
  } catch (fout) {
    console.error(fout.message);
    process.exit(1);
  }
  const uit = controleerInstellingen(ruw, opties);
  if (!uit.ok) {
    console.error(`instellingen.json klopt nog niet:\n  - ${uit.fouten.join('\n  - ')}`);
    process.exit(1);
  }
  return uit.instellingen;
}

/**
 * Zoals laadInstellingen, maar zonder te stoppen: voor een programmaatje dat
 * al draait en ziet dat instellingen.json veranderde. Geeft { ok, fouten }.
 */
export function probeerInstellingen(pad = process.env.BRUG_INSTELLINGEN || STANDAARD_PAD, opties) {
  try {
    const uit = controleerInstellingen(leesJsonBestand(fs.readFileSync(pad, 'utf8')), opties);
    return uit.ok ? { ok: true, fouten: [] } : { ok: false, fouten: uit.fouten };
  } catch (fout) {
    return { ok: false, fouten: [fout.code === 'ENOENT' ? 'instellingen.json is weg' : fout.message] };
  }
}
