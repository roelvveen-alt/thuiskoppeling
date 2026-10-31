/**
 * Een nep-Base44 voor de tests van de functies: tabellen in het geheugen,
 * een ingelogde gebruiker (of niet), de rem op afroep, en bestanden die
 * alleen hun uploader zelf kan openen.
 */

const fout = (status, bericht = `status ${status}`) => Object.assign(new Error(bericht), { status });

const kopie = (rij) => structuredClone(rij);

function sorteer(rijen, sortering) {
  if (!sortering) return rijen;
  const veld = sortering.replace(/^-/, '');
  const richting = sortering.startsWith('-') ? -1 : 1;
  return [...rijen].sort((a, b) => richting * (a[veld] < b[veld] ? -1 : a[veld] > b[veld] ? 1 : 0));
}

const vergelijkbaar = (w) => w !== undefined && w !== null;

/**
 * Zoals Base44 filtert (MongoDB-stijl): een gewone waarde is gelijk, een lijst
 * is "een van", en $eq, $ne, $gt, $gte, $lt, $lte en $in. Iets anders kent de
 * nep niet: dan liever een fout in de test dan een stil verkeerd antwoord.
 */
function pastVeld(waarde, voorwaarde) {
  if (Array.isArray(voorwaarde)) return voorwaarde.includes(waarde);
  if (!voorwaarde || typeof voorwaarde !== 'object') return waarde === voorwaarde;
  return Object.entries(voorwaarde).every(([op, v]) => {
    if (op === '$eq') return waarde === v;
    if (op === '$ne') return waarde !== v;
    if (op === '$gt') return vergelijkbaar(waarde) && waarde > v;
    if (op === '$gte') return vergelijkbaar(waarde) && waarde >= v;
    if (op === '$lt') return vergelijkbaar(waarde) && waarde < v;
    if (op === '$lte') return vergelijkbaar(waarde) && waarde <= v;
    if (op === '$in') return v.includes(waarde);
    throw new Error(`De nep-Base44 kent ${op} niet.`);
  });
}

const past = (rij, waar) => Object.entries(waar ?? {}).every(([veld, voorwaarde]) => pastVeld(rij[veld], voorwaarde));

/**
 * @param {{ gebruiker?: object|null, rijen?: Record<string, object[]>, bestanden?: Record<string, string> }} opties
 *   bestanden: file_uri → id van wie hem uploadde
 */
export function nepBase44({ gebruiker = null, rijen = {}, bestanden = {} } = {}) {
  let teller = 0;
  const stand = { rem: 0, aanroepen: [] };
  const tik = () => String(++teller).padStart(4, '0');
  const roep = (wat) => {
    stand.aanroepen.push(wat);
    if (stand.rem > 0) {
      stand.rem -= 1;
      throw fout(429, 'Rate limit exceeded');
    }
  };

  const maakTabel = (naam) => {
    const lijst = (rijen[naam] ?? []).map(kopie);
    return {
      lijst,
      async get(id) {
        roep(`${naam}.get`);
        const rij = lijst.find((r) => r.id === id);
        if (!rij) throw fout(404, 'Not found');
        return kopie(rij);
      },
      async list(sortering, aantal = 50, vanaf = 0) {
        roep(`${naam}.list`);
        return sorteer(lijst, sortering).slice(vanaf, vanaf + aantal).map(kopie);
      },
      async filter(waar, sortering, aantal = 50, vanaf = 0) {
        roep(`${naam}.filter`);
        return sorteer(lijst.filter((r) => past(r, waar)), sortering).slice(vanaf, vanaf + aantal).map(kopie);
      },
      async create(velden) {
        roep(`${naam}.create`);
        const nu = tik();
        const rij = { id: `${naam.toLowerCase()}-${nu}`, created_date: nu, updated_date: nu, ...kopie(velden) };
        lijst.push(rij);
        return kopie(rij);
      },
      async update(id, velden) {
        roep(`${naam}.update`);
        const rij = lijst.find((r) => r.id === id);
        if (!rij) throw fout(404, 'Not found');
        Object.assign(rij, kopie(velden), { updated_date: tik() });
        return kopie(rij);
      },
    };
  };

  const tabellen = {
    Huis: maakTabel('Huis'),
    Meting: maakTabel('Meting'),
    Opstelling: maakTabel('Opstelling'),
    Dag: maakTabel('Dag'),
    Gebeurtenis: maakTabel('Gebeurtenis'),
  };
  const link = (uri) => ({ signed_url: `https://bestanden.test/${uri}?getekend` });

  const client = {
    auth: {
      async me() {
        roep('auth.me');
        if (!gebruiker) throw fout(401, 'Unauthorized');
        return kopie(gebruiker);
      },
    },
    integrations: {
      Core: {
        // Als de gebruiker zelf: alleen een bestand dat hij zelf uploadde.
        async CreateFileSignedUrl({ file_uri }) {
          roep('bestand.alsGebruiker');
          if (!gebruiker || bestanden[file_uri] !== gebruiker.id) throw fout(403, 'Forbidden');
          return link(file_uri);
        },
      },
    },
    asServiceRole: {
      entities: tabellen,
      integrations: {
        Core: {
          async CreateFileSignedUrl({ file_uri }) {
            roep('bestand.alsServer');
            if (!(file_uri in bestanden)) throw fout(404, 'Not found');
            return link(file_uri);
          },
        },
      },
    },
  };

  return { client, tabellen, stand };
}

/** Een verzoek zoals de site of het programmaatje het stuurt. */
export function verzoek(lichaam, { methode = 'POST', kop = {} } = {}) {
  return new Request('https://app.test/functie', {
    method: methode,
    headers: { 'content-type': 'application/json', ...kop },
    body: methode === 'POST' ? (typeof lichaam === 'string' ? lichaam : JSON.stringify(lichaam)) : undefined,
  });
}

/** Niet echt wachten bij de rem. */
export const zonderWachten = { wacht: async () => {} };

/**
 * Het moment van de volgende meting van één programmaatje (één geheugen): elke
 * keer 5 s later, zoals het programmaatje stuurt. ontvangMeting weigert een
 * meting van hetzelfde huis binnen MIN_TUSSEN_MS (ontvang.js).
 */
const KLOKKEN = new WeakMap();
export function volgendeMoment(geheugen, basis) {
  const keer = KLOKKEN.get(geheugen) ?? 0;
  KLOKKEN.set(geheugen, keer + 1);
  return new Date(new Date(basis).getTime() + keer * 5000);
}
