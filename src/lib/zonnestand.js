/**
 * Waar de zon staat, en hoeveel licht er op schuine panelen valt: de
 * natuurkunde onder de verwachte opbrengst op het tabblad Voorspelling
 * (src/lib/morgen.js). Puur rekenen, zonder Base44.
 *
 * - De zonnestand: de korte formules van NOAA / de Astronomical Almanac, net
 *   als zonOpEnOnder in brug/zon.mjs (op een minuut of twee nauwkeurig; dat
 *   is voor een uur licht ruim genoeg).
 * - Het licht op de panelen: Open-Meteo geeft de straling op de grond
 *   (horizontaal, GHI). Hoeveel daarvan rechtstreeks van de zon komt en
 *   hoeveel uit de hele lucht, schatten we met het model van Erbs (1982) uit
 *   de helderheid (de straling tegenover wat er boven de lucht binnenkomt).
 *   Het directe deel valt onder de hoek met de panelen, het hemellicht naar
 *   rato van hoe schuin ze staan (Liu en Jordan), en een vijfde van het licht
 *   kaatst van de grond. Dat zijn de gewone vakboekformules (Duffie en
 *   Beckman, "Solar Engineering of Thermal Processes").
 *
 * Plaats: het programmaatje stuurt zon op en onder van vandaag mee (brug.zon,
 * sinds 0.7.0), uitgerekend op de plaats van dat huis. Daaruit volgen de
 * lengte (het midden van de dag) en de breedte (hoe lang de dag is), zonder
 * dat de app de plaats zelf hoeft te weten. Rond 21 maart en 23 september is
 * de dag overal even lang: dan, of zonder zon op en onder, De Bilt.
 */

const GRAAD = Math.PI / 180;
const DAG_MS = 86_400_000;
const UUR_MS = 3_600_000;

/** Het midden van het land (De Bilt), net als brug/zon.mjs: de plaats als we niets beters weten. */
export const STANDAARD_PLAATS = Object.freeze({ breedte: 52.1, lengte: 5.18 });
/** Hoe schuin en welke kant op we de panelen zonder meer aannemen: 30° naar het zuiden (een gewoon Nederlands dak). */
export const GEWOON_VLAK = Object.freeze({ helling: 30, richting: 180 });
/** De zonneconstante (W/m²). */
const ZONNECONSTANTE = 1361;
/** Zoveel licht kaatst de grond terug (gras, straat). */
const GROND = 0.2;

/** De zon op moment `ms`: declinatie, tijdsvereffening (minuten) en dag van het jaar. */
function zonBaan(ms) {
  const n = (ms - Date.UTC(2000, 0, 1, 12)) / DAG_MS;
  const gemiddeld = (((280.46 + 0.9856474 * n) % 360) + 360) % 360;
  const anomalie = (357.528 + 0.9856003 * n) * GRAAD;
  const lengteZon = (gemiddeld + 1.915 * Math.sin(anomalie) + 0.02 * Math.sin(2 * anomalie)) * GRAAD;
  const helling = (23.439 - 0.0000004 * n) * GRAAD;
  const declinatie = Math.asin(Math.sin(helling) * Math.sin(lengteZon));
  const klimming = ((Math.atan2(Math.cos(helling) * Math.sin(lengteZon), Math.cos(lengteZon)) / GRAAD) + 360) % 360;
  let vereffening = gemiddeld - klimming;
  if (vereffening > 180) vereffening -= 360;
  if (vereffening < -180) vereffening += 360;
  return { declinatie, vereffening: 4 * vereffening, n };
}

/**
 * De stand van de zon: hoogte boven de horizon en richting (graden vanaf het
 * noorden, met de klok mee: 90 oost, 180 zuid, 270 west).
 *
 * @param {number} ms  moment (UTC)
 * @param {{ breedte: number, lengte: number }} [plaats]
 * @returns {{ hoogte: number, richting: number }}
 */
export function zonnestand(ms, plaats = STANDAARD_PLAATS) {
  const { declinatie, vereffening } = zonBaan(ms);
  const d = new Date(ms);
  const minuten = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
  const zonnetijd = minuten + 4 * plaats.lengte + vereffening;
  const uurhoek = (zonnetijd / 4 - 180) * GRAAD;
  const breedte = plaats.breedte * GRAAD;
  const sinHoogte = Math.sin(breedte) * Math.sin(declinatie) + Math.cos(breedte) * Math.cos(declinatie) * Math.cos(uurhoek);
  const hoogte = Math.asin(Math.max(-1, Math.min(1, sinHoogte))) / GRAAD;
  const richting = ((Math.atan2(Math.sin(uurhoek), Math.cos(uurhoek) * Math.sin(breedte) - Math.tan(declinatie) * Math.cos(breedte)) / GRAAD + 180) % 360 + 360) % 360;
  return { hoogte, richting };
}

/** Wat er boven de lucht op een horizontaal vlak binnenkomt (W/m²) bij deze zonshoogte, op deze dag. */
export function bovenDeLucht(ms, hoogte) {
  if (!(hoogte > 0)) return 0;
  const { n } = zonBaan(ms);
  const dagVanJaar = ((n % 365.25) + 365.25) % 365.25;
  return ZONNECONSTANTE * (1 + 0.033 * Math.cos((2 * Math.PI * dagVanJaar) / 365.25)) * Math.sin(hoogte * GRAAD);
}

/**
 * Welk deel van het licht op de grond uit de hele lucht komt (niet direct van
 * de zon), bij helderheid kt (0 tot 1): het model van Erbs, Klein en Duffie (1982).
 */
export function hemelDeel(kt) {
  if (kt <= 0.22) return 1 - 0.09 * kt;
  if (kt <= 0.8) return 0.9511 - 0.1604 * kt + 4.388 * kt ** 2 - 16.638 * kt ** 3 + 12.336 * kt ** 4;
  return 0.165;
}

/** Zoveel momenten per uur rekenen we de zon door (elke 10 minuten). */
const PER_UUR = 6;
/** Zo laag (graden) telt het directe licht niet meer: de hoek wordt dan te gevoelig (en er staat altijd wel iets voor). */
const DIRECT_VANAF = 3;
/** Hooguit zoveel keer meer direct licht op het schuine vlak dan op de grond (bij een lage zon recht op de panelen). */
const HOOGSTENS_SCHUIN = 6;

/**
 * Het licht op de panelen in het uur dat begint op `begin`, bij `straling`
 * W/m² gemiddeld op de grond dat uur (Open-Meteo shortwave_radiation).
 *
 * @param {number} begin  begin van het uur (ms)
 * @param {number} straling  W/m², gemiddeld over dat uur
 * @param {{ breedte: number, lengte: number }} [plaats]
 * @param {{ helling: number, richting: number }} [vlak]
 * @returns {{ schuin: number, hoogte: number, richting: number, boven: number, kt: number|null }}
 *   schuin: W/m² op de panelen (gemiddeld over het uur); hoogte en richting: waar de zon gemiddeld
 *   stond (gewogen naar het licht); boven: W/m² boven de lucht; kt: de helderheid (of null zonder zon)
 */
export function lichtOpPanelen(begin, straling, plaats = STANDAARD_PLAATS, vlak = GEWOON_VLAK) {
  const momenten = Array.from({ length: PER_UUR }, (_, k) => {
    const t = begin + ((k + 0.5) / PER_UUR) * UUR_MS;
    const stand = zonnestand(t, plaats);
    return { ...stand, boven: bovenDeLucht(t, stand.hoogte) };
  });
  const boven = momenten.reduce((a, m) => a + m.boven, 0) / PER_UUR;
  const gewicht = momenten.reduce((a, m) => a + m.boven, 0);
  const hoogte = gewicht > 0 ? momenten.reduce((a, m) => a + m.hoogte * m.boven, 0) / gewicht : Math.max(...momenten.map((m) => m.hoogte));
  const richting = gewicht > 0 ? momenten.reduce((a, m) => a + m.richting * m.boven, 0) / gewicht : momenten[PER_UUR / 2].richting;
  const ghi = Math.max(0, Number.isFinite(straling) ? straling : 0);
  if (ghi <= 0) return { schuin: 0, hoogte, richting, boven, kt: null };
  const beta = vlak.helling * GRAAD;
  const hemelFactor = (1 + Math.cos(beta)) / 2;
  const grondFactor = (GROND * (1 - Math.cos(beta))) / 2;
  // Licht zonder zon boven de horizon (schemer, of een bericht dat net scheef valt): alles hemellicht.
  if (boven < 5) return { schuin: ghi * (hemelFactor + grondFactor), hoogte, richting, boven, kt: null };
  const kt = Math.min(1, ghi / boven);
  const hemel = hemelDeel(kt) * ghi;
  const direct = ghi - hemel;
  // Het directe licht verdeeld over het uur naar hoe hoog de zon stond, en per moment onder de hoek met de panelen.
  let schuinDirect = 0;
  for (const m of momenten) {
    if (m.boven <= 0) continue;
    const opGrond = (direct * m.boven) / boven / PER_UUR;
    if (m.hoogte < DIRECT_VANAF) {
      schuinDirect += opGrond;
      continue;
    }
    const h = m.hoogte * GRAAD;
    const cosHoek = Math.sin(h) * Math.cos(beta) + Math.cos(h) * Math.sin(beta) * Math.cos((m.richting - vlak.richting) * GRAAD);
    schuinDirect += opGrond * Math.min(HOOGSTENS_SCHUIN, Math.max(0, cosHoek) / Math.sin(h));
  }
  return { schuin: schuinDirect + hemel * hemelFactor + ghi * grondFactor, hoogte, richting, boven, kt };
}

/** De halve daglengte als uurhoek (graden) op deze breedte en declinatie, met de breking van de lucht. */
function halveDag(breedte, declinatie) {
  const cos = (Math.sin(-0.833 * GRAAD) - Math.sin(breedte * GRAAD) * Math.sin(declinatie)) / (Math.cos(breedte * GRAAD) * Math.cos(declinatie));
  return Math.acos(Math.min(1, Math.max(-1, cos))) / GRAAD;
}

/** Binnen deze grenzen zoeken we de breedte en lengte (Nederland, België en wat ruimte eromheen). */
const BREEDTE = [49, 55];
const LENGTE = [2, 8];

/**
 * De plaats van het huis uit zon op en onder van vandaag (stand.brug.zon, in
 * ms), of De Bilt. Het midden van de dag geeft de lengte; hoe lang de dag
 * is, geeft de breedte, behalve rond de equinox (dan is de dag overal even
 * lang en houden we de breedte van De Bilt).
 *
 * @param {{ op: number, onder: number }|null|undefined} zon
 * @returns {{ breedte: number, lengte: number, geschat: boolean }}  geschat: zonder zon op en onder (De Bilt)
 */
export function plaatsUitZon(zon) {
  if (!zon || !Number.isFinite(zon.op) || !Number.isFinite(zon.onder) || !(zon.onder > zon.op) || zon.onder - zon.op > DAG_MS) {
    return { ...STANDAARD_PLAATS, geschat: true };
  }
  const midden = (zon.op + zon.onder) / 2;
  const { declinatie, vereffening } = zonBaan(midden);
  const d = new Date(midden);
  const minuten = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
  let lengte = (720 - vereffening - minuten) / 4;
  if (lengte < -180) lengte += 360;
  if (lengte < LENGTE[0] || lengte > LENGTE[1]) return { ...STANDAARD_PLAATS, geschat: true };
  let breedte = STANDAARD_PLAATS.breedte;
  if (Math.abs(declinatie / GRAAD) >= 4) {
    const gemeten = (zon.onder - zon.op) / 60_000 / 8;
    let beste = Infinity;
    for (let b = BREEDTE[0]; b <= BREEDTE[1] + 1e-9; b += 0.02) {
      const verschil = Math.abs(halveDag(b, declinatie) - gemeten);
      if (verschil < beste) {
        beste = verschil;
        breedte = b;
      }
    }
    // Past geen enkele breedte (de tijden kloppen niet bij elkaar): De Bilt.
    if (beste > 1) breedte = STANDAARD_PLAATS.breedte;
  }
  return { breedte: Math.round(breedte * 100) / 100, lengte: Math.round(lengte * 100) / 100, geschat: false };
}
