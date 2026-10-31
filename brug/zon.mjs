/**
 * Zonsopkomst en zonsondergang, voor de Zonnebonus van Zonneplan (die geldt
 * "van zonsopkomst tot zonsondergang"). Standaard in het midden van het land
 * (De Bilt); elk huis zet zijn eigen plaats in instellingen.json.
 *
 * Rekenwijze: de korte formules van NOAA / de Astronomical Almanac; nauwkeurig
 * tot op een minuut of twee.
 */

const GRAAD = Math.PI / 180;
const DAG_MS = 86_400_000;

/** Het midden van het land (De Bilt), in graden noord en oost; ook de plaats van het weerbericht (weer.mjs) zonder eigen plaats. */
export const STANDAARD_PLAATS = { breedte: 52.1, lengte: 5.18 };

/**
 * @param {string} datum  'YYYY-MM-DD' (de Nederlandse dag)
 * @returns {{ op: number, onder: number }}  in ms (UTC)
 */
export function zonOpEnOnder(datum, breedte = STANDAARD_PLAATS.breedte, lengte = STANDAARD_PLAATS.lengte) {
  const [j, m, d] = datum.split('-').map(Number);
  const middernacht = Date.UTC(j, m - 1, d);
  const n = (middernacht + DAG_MS / 2 - Date.UTC(2000, 0, 1, 12)) / DAG_MS;

  const gemiddeld = (((280.46 + 0.9856474 * n) % 360) + 360) % 360;
  const anomalie = (357.528 + 0.9856003 * n) * GRAAD;
  const lengteZon = (gemiddeld + 1.915 * Math.sin(anomalie) + 0.02 * Math.sin(2 * anomalie)) * GRAAD;
  const helling = (23.439 - 0.0000004 * n) * GRAAD;
  const declinatie = Math.asin(Math.sin(helling) * Math.sin(lengteZon));
  const klimming = ((Math.atan2(Math.cos(helling) * Math.sin(lengteZon), Math.cos(lengteZon)) / GRAAD) + 360) % 360;

  // Tijdsvereffening in minuten: zo ver loopt de zon voor op de klok.
  let vereffening = gemiddeld - klimming;
  if (vereffening > 180) vereffening -= 360;
  if (vereffening < -180) vereffening += 360;
  const zonMiddag = 720 - 4 * lengte - 4 * vereffening;

  // De bovenrand van de zon op de horizon, met de breking van de lucht erbij.
  const cosUurhoek =
    (Math.sin(-0.833 * GRAAD) - Math.sin(breedte * GRAAD) * Math.sin(declinatie)) / (Math.cos(breedte * GRAAD) * Math.cos(declinatie));
  const uurhoek = Math.acos(Math.min(1, Math.max(-1, cosUurhoek))) / GRAAD;

  return { op: middernacht + (zonMiddag - 4 * uurhoek) * 60_000, onder: middernacht + (zonMiddag + 4 * uurhoek) * 60_000 };
}

/** Zon op en onder voor een plaats uit de instellingen ({ breedte, lengte }); zonder plaats De Bilt. */
export function zonVoorPlaats(plaats) {
  return (datum) => zonOpEnOnder(datum, plaats?.breedte ?? STANDAARD_PLAATS.breedte, plaats?.lengte ?? STANDAARD_PLAATS.lengte);
}

/** Zo ruim rond zonsopkomst en zonsondergang telt het nog niet als nacht. */
export const NACHT_MARGE_MS = 30 * 60_000;

/**
 * Is de zon onder (met een half uur marge aan beide kanten)? Dan kunnen
 * panelen niets leveren. `datum` is de Nederlandse dag van `nu`.
 */
export function isNacht(nu, datum, plaats) {
  const { op, onder } = zonVoorPlaats(plaats)(datum);
  return nu < op - NACHT_MARGE_MS || nu > onder + NACHT_MARGE_MS;
}

/**
 * Zon op en onder van vandaag voor de app (brug.zon, sinds 0.7.0): daarmee
 * schakelt de tekening tussen dag en nacht. Als ISO-tijden; `datum` is de
 * Nederlandse dag van nu.
 */
export function zonVoorApp(datum, plaats) {
  const { op, onder } = zonVoorPlaats(plaats)(datum);
  return { op: new Date(Math.round(op / 1000) * 1000).toISOString(), onder: new Date(Math.round(onder / 1000) * 1000).toISOString() };
}
