/**
 * Gasmeterstanden die de eigenaar zelf invult (Instellingen › Gas; opgeslagen
 * op de Opstelling, actie gasStand, base44/shared/gas.js): voor een huis waar de
 * P1-meter het gas niet doorgeeft, of als controle.
 *
 * Gas per dag uit de standen: het verschil tussen twee standen, eerlijk verdeeld
 * over de dagen ertussen (van de dag van de eerste tot de dag vóór de tweede).
 * Geeft de slimme meter het gas wel door (Dag.gas_m3), dan gaat dat voor: per
 * dag de meter, en alleen voor een dag zonder meter de standen.
 */
const DATUM = /^\d{4}-\d{2}-\d{2}$/;
const DAG_MS = 86_400_000;

/** Dagen sinds 1 januari 1970 van een echte datum, of null (zoals dagNummer in periode.js; hier los, zonder kringverwijzing). */
function dagNummer(datum) {
  const deel = typeof datum === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(datum) : null;
  if (!deel) return null;
  const [j, m, d] = [Number(deel[1]), Number(deel[2]), Number(deel[3])];
  const t = new Date(Date.UTC(j, m - 1, d));
  return t.getUTCFullYear() === j && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? t.getTime() / DAG_MS : null;
}
const datumVanNummer = (n) => new Date(n * DAG_MS).toISOString().slice(0, 10);
const getal = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** De standen schoon en op datum: [{ datum, stand }]; per datum de laatste. Zelfde regels als de server (zonder de oplopend-toets). */
export function gasStandenUit(lijst) {
  if (!Array.isArray(lijst)) return [];
  const perDatum = new Map();
  for (const s of lijst) {
    if (!s || typeof s.datum !== 'string' || !DATUM.test(s.datum) || dagNummer(s.datum) === null) continue;
    const stand = getal(s.stand);
    if (stand === null || stand < 0) continue;
    perDatum.set(s.datum, { datum: s.datum, stand });
  }
  return [...perDatum.values()].sort((a, b) => (a.datum < b.datum ? -1 : 1));
}

/**
 * Gas per dag (m³) uit de standen: Map datum → m³. Een stand die lager is dan de
 * vorige (dat laat de server niet toe, maar een oude rij kan het hebben) telt niet.
 */
export function gasPerDagUitStanden(standen) {
  const lijst = gasStandenUit(standen);
  const uit = new Map();
  for (let i = 1; i < lijst.length; i++) {
    const a = lijst[i - 1];
    const b = lijst[i];
    const dagen = dagNummer(b.datum) - dagNummer(a.datum);
    const verschil = b.stand - a.stand;
    if (!(dagen > 0) || verschil < 0) continue;
    for (let n = dagNummer(a.datum); n < dagNummer(b.datum); n++) uit.set(datumVanNummer(n), verschil / dagen);
  }
  return uit;
}

/**
 * Het gas over een periode: per dag de slimme meter (dag.gas) als die er is, anders
 * de ingevulde standen. Ook dagen zonder rij op de server tellen (de standen gaan
 * verder terug dan de app). Geeft { totaal, bron, perDatum } met bron 'meter',
 * 'standen' of 'beide'; zonder gas null.
 *
 * @param {Array<{ datum: string, gas?: number|null }>} dagen  zoals dagenUit en metVandaag (periode.js)
 * @param {Array} standen  opstelling.gasStanden
 * @param {{ van: string, tot: string }} bereik
 */
export function gasVoorPeriode(dagen, standen, { van, tot }) {
  const meter = new Map((dagen ?? []).filter((d) => getal(d.gas) !== null).map((d) => [d.datum, d.gas]));
  const uitStanden = gasPerDagUitStanden(standen);
  const perDatum = new Map();
  let vanMeter = false;
  let vanStanden = false;
  for (let n = dagNummer(van); n <= dagNummer(tot); n++) {
    const datum = datumVanNummer(n);
    if (meter.has(datum)) {
      perDatum.set(datum, meter.get(datum));
      vanMeter = true;
    } else if (uitStanden.has(datum)) {
      perDatum.set(datum, uitStanden.get(datum));
      vanStanden = true;
    }
  }
  if (!perDatum.size) return null;
  const totaal = [...perDatum.values()].reduce((s, v) => s + v, 0);
  return { totaal, bron: vanMeter && vanStanden ? 'beide' : vanMeter ? 'meter' : 'standen', perDatum };
}

/** Per staaf (src/lib/periode.js, stavenVan) de som van het gas, of null zonder gas in die staaf. */
export function gasReeks(staven, gas) {
  return staven.map((s) => {
    let som = null;
    for (const [datum, m3] of gas?.perDatum ?? []) if (datum >= s.van && datum <= s.tot) som = (som ?? 0) + m3;
    return som;
  });
}
