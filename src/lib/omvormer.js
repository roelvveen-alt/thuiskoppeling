/**
 * Wat de omvormer zelf meldt (Meting.omvormer, programmaatje 0.6.0 en
 * nieuwer, GoodWe DT-serie, brug/goodwe.mjs), in gewone woorden: één regel per
 * onderwerp, storingen bovenaan. Wat er niet is, staat er niet.
 *
 * De foutbits volgen GoodWe's gewone foutlijst zoals de Home
 * Assistant-bibliotheek goodwe hem kent (const.py, ERROR_CODES); een bit dat
 * daar niet in staat, heet "storingscode N". Dezelfde lijsten als in
 * brug/goodwe.mjs (brug/goodwe.test.js houdt ze gelijk).
 */

/** Vaste spatie: getal en eenheid blijven op één regel. */
const SP = '\u00a0';
const MIN = '\u2212';

const notatie = (min, max) => new Intl.NumberFormat('nl-NL', { minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: 'always' });
const heel = notatie(0, 0);
const eenDecimaal = notatie(1, 1);
const tweeDecimalen = notatie(2, 2);
const getal = (v, vorm) => vorm.format(v).replace('-', MIN);

export const STORINGEN = {
  0: 'controle van de aardlekbeveiliging mislukt',
  1: 'controle van de stroommeting mislukt',
  3: 'gelijkstroommeting klopt niet met zichzelf',
  4: 'aardlekmeting klopt niet met zichzelf',
  6: 'aardlekbeveiliging binnenin kapot',
  7: 'relais kapot',
  8: 'stroommeting binnenin kapot',
  9: 'geen net (stroomstoring?)',
  10: 'lekstroom naar aarde',
  11: 'spanning binnenin te hoog',
  12: 'ventilator binnenin kapot',
  13: 'te warm',
  14: 'een fase van het net ontbreekt',
  15: 'spanning van de panelen te hoog',
  16: 'ventilator buiten kapot',
  17: 'netspanning buiten de grenzen',
  18: 'isolatiefout bij de panelen of kabels',
  19: 'te veel gelijkstroom naar het net',
  20: 'noodstroom overbelast',
  22: 'netfrequentie klopt niet met zichzelf',
  23: 'netspanning klopt niet met zichzelf',
  25: 'controle van het relais mislukt',
  27: 'fasehoek van het net klopt niet',
  28: 'interne communicatie (DSP) mislukt',
  29: 'netfrequentie buiten de grenzen',
  30: 'geheugen binnenin kapot',
  31: 'interne communicatie mislukt',
};

export const BEPERKINGEN = {
  0: 'te warm',
  1: 'vermogen beperkt',
  2: 'blindvermogen ingesteld',
  3: 'netfrequentie hoog',
  4: 'netspanning hoog',
  5: 'teruglevergrens',
  6: 'op afstand beperkt',
  7: 'rustige start',
  8: 'hoogste stroom bereikt',
  9: 'spanning te hoog',
  10: 'afstellen',
};

/**
 * Grenzen voor de isolatie van de panelen en de lekstroom (programmaatje 1.4.0):
 * onder ISOLATIE_LAAG_KOHM of vanaf LEKSTROOM_HOOG_MA is het een melding (die
 * stuurt het programmaatje zelf mee, ook naar het Logboek); daartussen "matig" of
 * "wat hoger". Gelijk aan GRENZEN in brug/goodwe.mjs (brug/goodwe.test.js).
 */
export const GRENZEN = Object.freeze({ ISOLATIE_LAAG_KOHM: 100, ISOLATIE_LET_OP_KOHM: 500, LEKSTROOM_LET_OP_MA: 50, LEKSTROOM_HOOG_MA: 150 });

/** 1250 → "1,3 MΩ", 85 → "85 kΩ". */
export const isolatie = (kohm) => (kohm >= 1000 ? `${getal(kohm / 1000, eenDecimaal)}${SP}MΩ` : `${getal(Math.round(kohm), heel)}${SP}kΩ`);
const hooguitEen = notatie(0, 1);

const eerste = (t) => t.charAt(0).toUpperCase() + t.slice(1);
export const storingTekst = (bit) => STORINGEN[bit] ?? `storingscode ${bit}`;
export const beperkingTekst = (bit) => BEPERKINGEN[bit] ?? `beperking ${bit}`;

/** De stand in woorden, en of hij aandacht vraagt. */
const STAND = {
  normaal: { tekst: 'Levert stroom' },
  wacht: { tekst: 'Wacht', bij: 'te weinig zon, of hij start op' },
  storing: { tekst: 'Storing', bij: 'kijk in de SEMS-app van GoodWe', letOp: true },
  controle: { tekst: 'Controleert zichzelf', bij: 'dat doet hij bij het opstarten' },
  slaapt: { tekst: 'Slaapt', bij: "geen zon: de omvormer en zijn wifi-stekker zijn uit" },
  weg: { tekst: 'Geen antwoord', bij: 'staat hij aan, en is het wifi goed?', letOp: true },
  onbekend: { tekst: 'Stand onbekend' },
};

/** Onder 1 V heeft een paneelrij geen spanning: niets aangesloten, of donker. */
export const RIJ_LEEG_V = 1;

const volt = (v) => `${getal(v, eenDecimaal)}${SP}V`;
const ampere = (a) => `${getal(a, eenDecimaal)}${SP}A`;

/**
 * @param {object|null} o  omvormer zoals omvormerUit (bron.js) het teruggeeft
 * @returns {Array<{ sleutel: string, tekst: string, bij?: string, letOp?: boolean }>}
 *   sleutel: temperatuur (bovenaan, `groot`), storing-N, stand, beperkt, isolatie, lekstroom (1.4.0),
 *   rij-N (alleen met spanning), net, elektrisch (1.4.0), opbrengst
 */
export function omvormerRegels(omvormer) {
  if (!omvormer) return [];
  // Zoals omvormerUit (bron.js) het geeft; het voorbeeld laat lege velden weg.
  const o = {
    rijen: [],
    fasen: [],
    hz: null,
    temp_c: null,
    vandaag_kwh: null,
    totaal_kwh: null,
    storingen: [],
    waarschuwing: 0,
    beperkt: [],
    pf: null,
    bus_v: null,
    koelplaat_c: null,
    uren: null,
    isolatie_kohm: null,
    lekstroom_ma: null,
    ...omvormer,
  };
  const regels = [];
  const zet = (sleutel, tekst, bij, letOp, groot) =>
    regels.push({ sleutel, tekst, ...(bij ? { bij } : {}), ...(letOp ? { letOp: true } : {}), ...(groot ? { groot: true } : {}) });

  // De temperatuur bovenaan, groot: die wil je als eerste zien.
  const graad = (c) => `${getal(Math.round(c) === 0 ? 0 : Math.round(c), heel)}${SP}°C`;
  const koelplaat = o.koelplaat_c === null ? '' : ` · koelplaat ${graad(o.koelplaat_c)}`;
  if (o.temp_c !== null) zet('temperatuur', graad(o.temp_c), `binnenin de omvormer${koelplaat}`, false, true);

  // Dan de storingen, elk op een eigen regel.
  for (const bit of o.storingen) zet(`storing-${bit}`, eerste(storingTekst(bit)), `foutcode ${bit} van de omvormer`, true);

  const stand = STAND[o.stand] ?? STAND.onbekend;
  // Staat de storing hierboven al uitgelegd, dan de stand zonder tweede oranje regel.
  const uitgelegd = o.stand === 'storing' && o.storingen.length > 0;
  zet('stand', stand.tekst, uitgelegd ? null : stand.bij, stand.letOp && !uitgelegd);
  if (o.waarschuwing) zet('waarschuwing', `Waarschuwing ${o.waarschuwing}`, 'kijk in de SEMS-app van GoodWe', true);
  if (o.beperkt.length) zet('beperkt', `Levert minder: ${o.beperkt.map(beperkingTekst).join(', ')}`);

  // Voor storingen (programmaatje 1.4.0): de isolatie van de panelen naar aarde en de lekstroom.
  if (o.isolatie_kohm !== null) {
    if (o.isolatie_kohm < GRENZEN.ISOLATIE_LAAG_KOHM) {
      zet('isolatie', `Isolatie van de panelen: laag (${isolatie(o.isolatie_kohm)})`, 'laat de installateur de panelen en kabels nakijken', true);
    } else if (o.isolatie_kohm < GRENZEN.ISOLATIE_LET_OP_KOHM) {
      zet('isolatie', `Isolatie van de panelen: matig (${isolatie(o.isolatie_kohm)})`, `nog boven de grens van ${isolatie(GRENZEN.ISOLATIE_LAAG_KOHM)}; na regen is hij vaak lager`);
    } else {
      zet('isolatie', `Isolatie van de panelen: goed (${isolatie(o.isolatie_kohm)})`, 'gemeten bij het opstarten');
    }
  }
  if (o.lekstroom_ma !== null) {
    const ma = `${getal(o.lekstroom_ma, hooguitEen)}${SP}mA`;
    if (o.lekstroom_ma >= GRENZEN.LEKSTROOM_HOOG_MA) zet('lekstroom', `Lekstroom naar aarde: hoog (${ma})`, 'laat de installateur de panelen en kabels nakijken', true);
    else if (o.lekstroom_ma >= GRENZEN.LEKSTROOM_LET_OP_MA) zet('lekstroom', `Lekstroom naar aarde: wat hoger (${ma})`, `een melding komt vanaf ${GRENZEN.LEKSTROOM_HOOG_MA}${SP}mA`);
    else zet('lekstroom', `Lekstroom naar aarde: laag (${ma})`, 'zo hoort het');
  }

  // Een rij zonder spanning naast een rij met spanning is een ingang zonder panelen (de GW8000-DT in huis A
  // gebruikt er één): die niet. Alles zonder spanning ('s nachts, of hij slaapt net): geen rijen, de stand zegt genoeg.
  const metSpanning = (r) => r.v >= RIJ_LEEG_V;
  o.rijen.forEach((r, i) => {
    if (metSpanning(r)) zet(`rij-${i + 1}`, `Paneelrij ${i + 1}: ${volt(r.v)}`, r.a === null ? null : `stroom ${ampere(r.a)}`);
  });

  if (o.fasen.length) {
    const spanning = o.fasen.map((f) => getal(f.v, eenDecimaal)).join(' · ');
    zet('net', `Net ${spanning}${SP}V`, o.hz === null ? null : `${o.fasen.length > 1 ? 'L1 tot L3, ' : ''}${getal(o.hz, tweeDecimalen)}${SP}Hz`);
  } else if (o.hz !== null) {
    zet('net', `Net ${getal(o.hz, tweeDecimalen)}${SP}Hz`);
  }

  // De arbeidsfactor (1 is ideaal) en de spanning binnenin (busspanning), voor als er iets mis is.
  const bus = o.bus_v === null ? null : `busspanning ${getal(Math.round(o.bus_v), heel)}${SP}V`;
  if (o.pf !== null) zet('elektrisch', `Arbeidsfactor ${getal(Math.abs(o.pf), tweeDecimalen)}`, bus);
  else if (bus) zet('elektrisch', eerste(bus));

  const uren = o.uren === null ? null : `${getal(o.uren, heel)}${SP}uur in bedrijf`;
  const totaal = [o.totaal_kwh === null ? null : `totaal ${getal(Math.round(o.totaal_kwh), heel)}${SP}kWh`, uren].filter(Boolean).join(' · ') || null;
  if (o.vandaag_kwh !== null) zet('opbrengst', `Vandaag ${getal(o.vandaag_kwh, eenDecimaal)}${SP}kWh`, totaal);
  else if (totaal) zet('opbrengst', eerste(totaal));

  return regels;
}

/**
 * Bij welk zon-punt het blok Omvormer hoort: het punt met de sleutel `bij`,
 * en anders (geen bij, of die zonnebron is er niet) het eerste zon-punt.
 */
export function omvormerHoortBij(omvormer, punt, punten) {
  if (!omvormer || punt?.soort !== 'zon') return false;
  const zon = (punten ?? []).filter((p) => p.soort === 'zon');
  if (omvormer.bij && zon.some((p) => p.sleutel === omvormer.bij)) return punt.sleutel === omvormer.bij;
  return zon[0]?.sleutel === punt.sleutel;
}
