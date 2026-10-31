import { schoon } from './web.mjs';
import { dpVoor, standUit, VERSIES } from './tuya.mjs';
import { LOCAL_KEY, tuyaSleutelVan, TUYA_WAT } from './tuyaInstellingen.mjs';

/**
 * Het Tuya-deel van de instelhulp (instellen.mjs roept dit aan). Alleen als
 * je dat wilt: met de Access ID en het Access Secret van je cloudproject op
 * iot.tuya.com haalt hij één keer de lijst op (naam, id, local_key), luistert
 * hij even in de wifi waar elk apparaat zit en welke versie het praat, en
 * vraagt hij per apparaat wat het is. Het Access Secret wordt niet bewaard;
 * een volgende keer vraagt hij het opnieuw. Alles alleen lezen.
 *
 * Wat van buiten komt (haal, luister, lees) is in te vullen, zodat de tests
 * het zonder Tuya en zonder wifi kunnen nalopen.
 */

const KEUZES = [
  ['meter', 'meet stroom (zoals de pomp): gaat mee als apparaat met vermogen'],
  ['lamp', 'een lamp: aan of uit (en hoe fel)'],
  ['schakelaar', 'een schakelaar zonder meter: aan of uit'],
];
const REGIOS = [
  ['eu', 'Central Europe'],
  ['weu', 'Western Europe'],
];
const ADRES = /^\d{1,3}(\.\d{1,3}){3}$/;

/** De Tuya-apparaten uit de huidige instellingen die nog kloppen (het voorstel). */
function bruikbaar(lijst) {
  return (Array.isArray(lijst) ? lijst : []).filter(
    (a) => a && typeof a === 'object' && typeof a.id === 'string' && typeof a.local_key === 'string' && LOCAL_KEY.test(a.local_key) && TUYA_WAT.includes(a.wat),
  );
}

/** "aan · 412 W", "uit", of waarom niet. */
function standTekst(stand) {
  const aan = stand.aan === null ? 'aan/uit onbekend' : stand.aan ? 'aan' : 'uit';
  return [aan, stand.w !== null ? `${Math.round(stand.w)} W` : null, stand.helderheid ? `${stand.helderheid}%` : null].filter(Boolean).join(' · ');
}

/**
 * @param {{ oud: object|null, zeg: Function, herhaal: Function, jaNee: Function, opnieuw: Function,
 *           haal: (o: { accessId, secret, regio }) => Promise<object[]>, luister: () => Promise<object[]>,
 *           lees: (apparaat: object) => Promise<object> }} o
 * @returns {Promise<object[]>}  wat er in "tuya" komt (leeg = geen)
 */
export async function vraagTuya({ oud, zeg, herhaal, jaNee, opnieuw, haal, luister, lees }) {
  const oudeLijst = bruikbaar(oud?.tuya);
  zeg('\nTuya (Smart Life)');
  if (oudeLijst.length) zeg(`Er staan ${oudeLijst.length} Tuya-apparaten in: ${oudeLijst.map((a) => a.naam).join(', ')}.`);
  const vraagTekst = oudeLijst.length
    ? 'De lijst opnieuw ophalen bij de Tuya-cloud (een nieuw apparaat, of opnieuw gekoppeld)?'
    : 'Tuya-apparaten (Smart Life, Tuya Smart) koppelen? Alleen kijken: er wordt nooit iets geschakeld.';
  if (!(await jaNee(vraagTekst, false))) return oudeLijst;

  zeg('Daarvoor is een eigen cloudproject op iot.tuya.com nodig, gekoppeld aan je Smart Life-app (zie docs/tuya.md).');
  zeg('Op iot.tuya.com › Cloud › Development › je project › Overview staan de Access ID en het Access Secret.');
  zeg('Het Access Secret wordt niet bewaard: alleen nu, om de lijst op te halen. Je ziet het niet terwijl je plakt; dat hoort zo.');
  const accessId = await herhaal('Access ID (Client ID): ', (t) => {
    const id = t.trim();
    if (!id) return null;
    return /^[a-zA-Z0-9]{10,64}$/.test(id) ? id : opnieuw('De Access ID is zo’n twintig letters en cijfers; of alleen Enter om over te slaan.');
  });
  if (!accessId) return oudeLijst;
  const secret = await herhaal(
    'Access Secret (Client Secret): ',
    (t) => {
      const s = t.trim();
      if (!s) return null;
      return /^[a-zA-Z0-9]{16,64}$/.test(s) ? s : opnieuw('Het Access Secret is zo’n 32 letters en cijfers; of alleen Enter om over te slaan.');
    },
    { geheim: true },
  );
  if (!secret) return oudeLijst;
  zeg('Welk datacentrum (staat bij je project)?');
  REGIOS.forEach(([, naam], i) => zeg(`  [${i + 1}] ${naam}`));
  const regio = await herhaal('Keuze [1]: ', (t) => {
    const n = Number(t.trim() || '1');
    return Number.isInteger(n) && n >= 1 && n <= REGIOS.length ? REGIOS[n - 1][0] : opnieuw(`Typ 1 tot ${REGIOS.length}, of alleen Enter.`);
  });

  zeg('Ophalen bij Tuya…');
  let cloud;
  try {
    cloud = await haal({ accessId, secret, regio });
  } catch (fout) {
    zeg(`Dat lukte niet: ${fout.message}`);
    zeg(oudeLijst.length ? 'De Tuya-apparaten blijven zoals ze waren.' : 'Dan zonder Tuya; probeer het later opnieuw met: node brug.mjs instellen');
    return oudeLijst;
  }
  if (!cloud.length) {
    zeg('Tuya geeft geen apparaten. Is je Smart Life-account gekoppeld (Devices › Link App Account)?');
    return oudeLijst;
  }
  zeg('Even luisteren in de wifi waar ze zitten… (zo’n tien seconden)');
  let gehoord = [];
  try {
    gehoord = await luister();
  } catch {
    // Luisteren lukte niet: dan vragen we het adres.
  }

  const uit = [];
  const bezet = new Set();
  for (const c of cloud) {
    const naamCloud = schoon(c.naam, 40) || c.id;
    zeg(`\n${naamCloud}${c.product ? ` (${schoon(c.product, 40)})` : ''}${c.online ? '' : ', nu offline'}`);
    if (c.sub) {
      zeg('Dit apparaat zit achter een gateway (Zigbee of Bluetooth) en praat niet zelf in de wifi; dat kan (nog) niet.');
      continue;
    }
    if (!c.local_key) {
      zeg('Tuya gaf hier geen local key bij; overslaan.');
      continue;
    }
    const oudA = oudeLijst.find((a) => a.id === c.id) ?? null;
    const voorstel = oudA?.wat ?? c.wat ?? null;
    zeg('Wat is het?');
    KEUZES.forEach(([, tekst], i) => zeg(`  [${i + 1}] ${tekst}`));
    zeg(voorstel ? '  [0] niet gebruiken' : '  [Enter] niet gebruiken');
    const nummer = KEUZES.findIndex(([wat]) => wat === voorstel) + 1;
    const wat = await herhaal(`Keuze${voorstel ? ` [${nummer}]` : ''}: `, (t) => {
      const k = t.trim();
      if (!k) return voorstel;
      if (['0', 'n', 'nee', '-'].includes(k.toLowerCase())) return null;
      const n = Number(k);
      return Number.isInteger(n) && n >= 1 && n <= KEUZES.length ? KEUZES[n - 1][0] : opnieuw(`Typ 1 tot ${KEUZES.length}${voorstel ? ', of 0 voor niet gebruiken' : ', of alleen Enter'}.`);
    });
    if (!wat) continue;

    const naamVoorstel = oudA?.naam ?? naamCloud;
    const naam = await herhaal(`Naam [${naamVoorstel}]: `, (t) => {
      const n = t.trim() || naamVoorstel;
      if (n.length > 40) opnieuw('Hooguit 40 tekens.');
      if (bezet.has(tuyaSleutelVan(n))) opnieuw('Die naam heeft al een ander apparaat; kies een andere.');
      return n;
    });
    bezet.add(tuyaSleutelVan(naam));

    const hier = gehoord.find((g) => g.id === c.id) ?? null;
    let adres = hier?.adres ?? null;
    if (adres) zeg(`Gevonden in de wifi: ${adres}${hier.versie ? `, versie ${hier.versie}` : ''}.`);
    else {
      const bekend = oudA?.adres ?? null;
      zeg('Niet gehoord in de wifi. Het adres staat in je router, of in de Smart Life-app bij het apparaat › … › Apparaatinformatie (IP).');
      adres = await herhaal(`IP-adres in de wifi${bekend ? ` [${bekend}]` : ''}: `, (t) => {
        const a = t.trim() || bekend;
        return a && ADRES.test(a) ? a : opnieuw('Bijvoorbeeld 192.168.1.50.');
      });
    }
    let versie = hier?.versie ?? null;
    if (!versie) {
      const v = oudA?.versie ?? '3.3';
      versie = await herhaal(`Tuya-versie (3.3, 3.4 of 3.5; staat niet in de app: probeer 3.3, dan 3.4, dan 3.5) [${v}]: `, (t) => {
        const k = t.trim().replace(',', '.') || v;
        return VERSIES.includes(k) ? k : opnieuw('Typ 3.3, 3.4 of 3.5.');
      });
    }

    const apparaat = {
      naam,
      id: c.id,
      local_key: c.local_key,
      adres,
      versie,
      wat,
      ...(wat === 'meter' ? { soort: /pomp/i.test(naam) ? 'pomp' : /lamp|licht|spot/i.test(naam) ? 'lamp' : 'stekker' } : {}),
      ...(c.dp && Object.keys(c.dp).length ? { dp: c.dp } : oudA?.dp ? { dp: oudA.dp } : {}),
      ...(typeof oudA?.sleutel === 'string' && oudA.naam === naam ? { sleutel: oudA.sleutel } : {}),
    };
    if (wat !== 'meter') {
      const zijn = await jaNee('Zijn dit de spotjes in het overstek (dan branden die op de tekening in de app)?', oudA?.spots ?? /spot|overstek/i.test(naam));
      if (zijn) apparaat.spots = true;
    }

    // Eén keer uitlezen, zodat je ziet of het klopt.
    try {
      const dps = await lees({ ...apparaat, sleutel: tuyaSleutelVan(naam) });
      zeg(`Nu: ${standTekst(standUit(apparaat, dps))}.`);
      if (wat === 'meter' && dps[String(dpVoor(apparaat, dps).vermogen)] === undefined) {
        zeg('Let op: dit apparaat meldt geen vermogen op de gewone plek; dan staat er "–" in de app.');
      }
    } catch (fout) {
      zeg(`Uitlezen lukte nog niet: ${fout.message}. Het wordt wel bewaard; node brug.mjs proef laat het later zien.`);
    }
    uit.push(apparaat);
  }

  // Wat er al stond maar nu niet in de cloud zit: misschien even weg.
  for (const a of oudeLijst) {
    if (cloud.some((c) => c.id === a.id) || bezet.has(tuyaSleutelVan(a.naam))) continue;
    if (await jaNee(`Niet meer in de cloud: ${a.naam}. Toch bewaren?`, true)) {
      bezet.add(tuyaSleutelVan(a.naam));
      uit.push(a);
    }
  }
  return uit;
}
