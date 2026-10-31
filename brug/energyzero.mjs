import { datumInNederland, morgenVan } from './kosten.mjs';
import { isDag, zonneplanTijdvak } from './prijzen.mjs';
import { vraagJson } from './web.mjs';
import { zonVoorPlaats } from './zon.mjs';

/**
 * Reserve als Zonneplan even niet lukt, of als je niet wilt inloggen: de kale
 * marktprijs per kwartier (EPEX, via de openbare prijzen van EnergyZero) met
 * de opbouw van Zonneplan eromheen. Klopt op een fractie van een cent na,
 * maar het blijft een schatting: Zonneplan zelf gaat voor.
 *
 *   GET https://public.api.energyzero.nl/public/v1/prices
 *       ?energyType=ENERGY_TYPE_ELECTRICITY&date=DD-MM-YYYY&interval=INTERVAL_QUARTER
 *   → { base: [{ start, end, price: { value: "0.07994" } }], … }   € per kWh zonder btw
 *
 * Bedragen per jaar; bij een nieuw jaar het nieuwe jaar erbij zetten.
 * Ontbreekt het jaar, dan rekenen we met het laatste dat er staat en zegt
 * het programmaatje dat in het logboek en in de app (bedragenOntbreken).
 */
const BTW = 1.21;
const BEDRAGEN = {
  // inkoopvergoeding: Zonneplan, € 0,02 per kWh met btw (contract; die krijg je ook bij teruglevering);
  // energiebelasting: de overheid (2026: € 0,09161, met btw € 0,11085). Allebei € per kWh zonder btw.
  2026: { inkoopvergoeding: 0.02 / BTW, energiebelasting: 0.09161 },
};

/** De bedragen voor een jaar, of die van het laatste jaar ervoor (of het eerste) als dat jaar er nog niet staat. */
export function bedragenVoor(jaar) {
  const jaren = Object.keys(BEDRAGEN).map(Number).sort((a, b) => a - b);
  const gekozen = jaren.filter((j) => j <= jaar).at(-1) ?? jaren[0];
  return { ...BEDRAGEN[gekozen], jaar: gekozen };
}

/** Een gewone zin als de bedragen voor het jaar van `nu` nog niet in dit bestand staan, anders null. */
export function bedragenOntbreken(nu) {
  const jaar = Number(datumInNederland(nu).slice(0, 4));
  const { jaar: gekozen } = bedragenVoor(jaar);
  if (gekozen === jaar) return null;
  return `De bedragen voor ${jaar} (energiebelasting, inkoopvergoeding) staan nog niet in brug/energyzero.mjs; de schatting van EnergyZero rekent met die van ${gekozen} en kan afwijken.`;
}

export function tijdvakkenUitEnergyZero(json, zonVoor) {
  if (!Array.isArray(json?.base)) throw new Error('onverwacht antwoord');
  return json.base.flatMap((p) => {
    const van = Date.parse(p?.start);
    const tot = Date.parse(p?.end);
    const tekst = p?.price?.value;
    const markt = typeof tekst === 'string' && tekst.trim() !== '' ? Number(tekst) : Number.NaN;
    if (!Number.isFinite(van) || !(tot > van) || !Number.isFinite(markt)) return [];
    const { inkoopvergoeding, energiebelasting } = bedragenVoor(Number(datumInNederland(van).slice(0, 4)));
    const zonderBelasting = (markt + inkoopvergoeding) * BTW;
    return [zonneplanTijdvak({ van, tot, alles: zonderBelasting + energiebelasting * BTW, zonderBelasting, isDag: isDag(van, tot, zonVoor) })];
  });
}

/** Vandaag en morgen (morgen staat er pas na een uur of één 's middags; zonder morgen is ook goed). */
export function energyZeroBron({ klok = Date.now, plaats = null } = {}) {
  async function dag(datum) {
    const [j, m, d] = datum.split('-');
    const { status, json } = await vraagJson(
      `https://public.api.energyzero.nl/public/v1/prices?energyType=ENERGY_TYPE_ELECTRICITY&date=${d}-${m}-${j}&interval=INTERVAL_QUARTER`,
      { tijd: 15_000 },
    );
    if (status !== 200) throw new Error(`EnergyZero antwoordde ${status}`);
    return tijdvakkenUitEnergyZero(json, zonVoorPlaats(plaats));
  }
  return {
    naam: 'EnergyZero',
    async haal() {
      const vandaagDatum = datumInNederland(klok());
      const [vandaag, morgen] = await Promise.all([dag(vandaagDatum), dag(morgenVan(vandaagDatum)).catch(() => [])]);
      const perBegin = new Map([...vandaag, ...morgen].map((t) => [t.van, t]));
      return [...perBegin.values()].sort((a, b) => a.van - b.van);
    },
  };
}
