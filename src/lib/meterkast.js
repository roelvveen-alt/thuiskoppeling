/**
 * De meterkast in gewone woorden (Meting.meterkast, programmaatje 1.4.0, uit de
 * HomeWizard P1-meter; brug/homewizard.mjs, meterkastUit): het tarief van nu,
 * de meters die aan de slimme meter hangen (gas, water, warmte) met wat ze
 * vandaag telden, en de hoogste kwartierpiek van de maand als de meter die geeft.
 *
 * Wat er niet is, staat er niet: zonder gasmeter geen regel over gas, en zonder
 * meterkast-blok (een oudere brug of functie) helemaal niets (geen lege kaart).
 * Een gasprijs hebben we niet: alleen m³.
 */
import { tijd } from './opmaak';

const SP = ' ';
const getal = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const ISO = /^\d{4}-\d{2}-\d{2}T[0-9:.+\-Z]{5,30}$/;

/** Het tarief zoals de Nederlandse slimme meter het telt: 1 = dal (laag), 2 = normaal (hoog). */
export const TARIEF = Object.freeze({ 1: 'daltarief', 2: 'normaal tarief', 3: 'tarief 3', 4: 'tarief 4' });
/** De soorten meters (brug/homewizard.mjs, METER_SOORTEN), met hun naam in de app. */
export const METER_NAAM = Object.freeze({ gas: 'Gas', water: 'Water', warmte: 'Warmte', warm_water: 'Warm water', warmte_in: 'Warmte (inlaat)' });
const EENHEID = Object.freeze({ m3: 'm³', GJ: 'GJ', kWh: 'kWh', MWh: 'MWh' });

/** Het blok uit de rij, schoon; zonder iets bruikbaars null. */
export function meterkastUit(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  const uit = {};
  if (Number.isInteger(m.tarief) && TARIEF[m.tarief]) uit.tarief = m.tarief;
  if (getal(m.gemiddeld_w) !== null) uit.gemiddeld_w = m.gemiddeld_w;
  if (getal(m.maandpiek_w) !== null) {
    uit.maandpiek_w = m.maandpiek_w;
    if (typeof m.maandpiek_op === 'string' && ISO.test(m.maandpiek_op)) uit.maandpiek_op = m.maandpiek_op;
  }
  const meters = (Array.isArray(m.meters) ? m.meters : [])
    .filter((x) => x && METER_NAAM[x.soort] && EENHEID[x.eenheid] && getal(x.stand) !== null)
    .slice(0, 5)
    .map((x) => ({
      soort: x.soort,
      stand: x.stand,
      eenheid: x.eenheid,
      op: typeof x.op === 'string' && ISO.test(x.op) ? x.op : null,
      vandaag: getal(x.vandaag),
    }));
  if (meters.length) uit.meters = meters;
  return Object.keys(uit).length ? uit : null;
}

const notatie = (min, max) => new Intl.NumberFormat('nl-NL', { minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: 'always' });
const tweeDecimalen = notatie(2, 2);
const drieDecimalen = notatie(0, 3);
const heel = notatie(0, 0);

/** 1.234 → "1,23 m³", 2569.646 → "2.569,646 m³" (een stand met alles wat de meter geeft). */
export const hoeveel = (v, eenheid, { stand = false } = {}) => `${(stand ? drieDecimalen : tweeDecimalen).format(v)}${SP}${EENHEID[eenheid] ?? eenheid}`;

/**
 * @param {object|null} m  meterkast zoals meterkastUit hem geeft
 * @param {{ dynamisch?: boolean }} [opties]  dynamisch: er is een prijs per kwartier (stand.prijs)
 * @returns {Array<{ sleutel: string, tekst: string, bij?: string }>}
 *   sleutel: tarief, meter-<soort> (gas, water, warmte, …), piek
 */
export function meterkastRegels(m, { dynamisch = false } = {}) {
  if (!m) return [];
  const regels = [];
  const zet = (sleutel, tekst, bij) => regels.push({ sleutel, tekst, ...(bij ? { bij } : {}) });
  // Met een dynamisch contract (een prijs per kwartier) zegt dal of normaal niets over wat je betaalt: dan weg.
  if (m.tarief && !dynamisch) {
    zet('tarief', `Nu ${TARIEF[m.tarief]}`, 'zo telt de slimme meter');
  }
  for (const meter of m.meters ?? []) {
    const naam = METER_NAAM[meter.soort];
    const stand = `meterstand ${hoeveel(meter.stand, meter.eenheid, { stand: true })}${meter.op ? ` · ${tijd(meter.op)}` : ''}`;
    if (meter.vandaag !== null && meter.vandaag !== undefined) zet(`meter-${meter.soort}`, `${naam} vandaag ${hoeveel(meter.vandaag, meter.eenheid)}`, stand);
    else zet(`meter-${meter.soort}`, `${naam}: ${stand}`);
  }
  if (m.maandpiek_w !== undefined) {
    const nu = m.gemiddeld_w !== undefined ? `dit kwartier gemiddeld ${heel.format(Math.round(m.gemiddeld_w))}${SP}W` : null;
    const wanneer = m.maandpiek_op ? new Date(m.maandpiek_op).toLocaleString('nl-NL', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : null;
    zet('piek', `Hoogste kwartier deze maand ${heel.format(Math.round(m.maandpiek_w))}${SP}W`, [wanneer, nu].filter(Boolean).join(' · '));
  }
  return regels;
}

/** Hoeveel van een soort vandaag (bijvoorbeeld gas, in m³), of null. */
export function vandaagVan(m, soort) {
  return m?.meters?.find((x) => x.soort === soort)?.vandaag ?? null;
}
