import { NIETS_W } from './nuInWoorden';

/** Zo ver mag het moment van de stand van het midden van die dag liggen; verder is het een andere dag. */
const ZELFDE_DAG_MS = 18 * 3_600_000;

/**
 * Dag of nacht in de tekening. Met zon op en onder van het programmaatje
 * (brug.zon, sinds 0.7.0): dag van zonsopkomst tot zonsondergang ("op
 * zonsopkomst en -ondergang"). Zonder (een oudere brug, of tijden van een
 * andere dag): zoals vroeger, op het licht: dag als de zon iets levert.
 *
 * @param {object|null} stand  zoals standUitRij (bron.js) of het voorbeeld hem geeft
 * @param {{ zon_w?: number }} verdeling  verdeelStroom(stand)
 * @param {number} [nu]  het moment; standaard dat van de stand (het voorbeeld heeft zijn eigen klok)
 */
export function isDag(stand, verdeling, nu = stand?.klok ?? (stand?.moment ? Date.parse(stand.moment) : Date.now())) {
  const zon = stand?.brug?.zon;
  if (zon && Number.isFinite(zon.op) && Number.isFinite(zon.onder) && Number.isFinite(nu) && Math.abs(nu - (zon.op + zon.onder) / 2) < ZELFDE_DAG_MS) {
    return nu >= zon.op && nu < zon.onder;
  }
  return (verdeling?.zon_w ?? 0) >= NIETS_W;
}
