/**
 * Het logboek van storingen per huis (tabel Gebeurtenis): wanneer de batterij,
 * de omvormer, een meter of het programmaatje zelf iets meldde, en wanneer dat
 * weer voorbij was. Los van entry.ts, zodat de tests het zonder Base44 kunnen
 * nalopen (base44/tests/logboek.test.js).
 *
 * De rem van Base44 (~115 aanroepen per 65 s, base44/tests/rem.test.js) laat
 * geen schrijfactie per meting toe. Daarom: één create bij het begin en één
 * update bij het einde van een storing, en verder niets. Wat er openstaat,
 * onthoudt ontvangMeting per huis in zijn geheugen en in de rij Meting
 * (storingen_open), die hij toch elke meting schrijft: zo weet hij het na een
 * herstart ook weer, zonder aanroep extra.
 *
 * Wat telt als storing (alles uit wat controle.js al aannam):
 *   batterij   batterij_info.storing is waar (Zendure, programmaatje 0.5.0+)
 *   omvormer   per storingsbit van omvormer.storingen, of de stand 'storing' (0.6.0+); en het
 *              begrenzen bij een negatieve prijs (omvormer.sturen, 1.5.0, sturenGebeurtenissen in
 *              shared/omvormerSturen.js): één regel per blok (de tekst groeit mee, hoe vaak
 *              bijgesteld; bij het einde komt de laatste tekst in de rij), "Nu weer aan", een
 *              mislukte poging. Een kijker ziet die niet (actie logboek)
 *   meter      een gekoppeld apparaat met ok = false (0.4.0+)
 *   melding    een melding van het programmaatje (brug.meldingen, 0.5.2+), behalve
 *              soort 'apparaat': dat is dezelfde als de meter hierboven
 *   stil       geen meting meer: dat ziet de server pas bij de eerste meting na
 *              het gat; is dat gat langer dan GAT_MS, dan komt er achteraf één
 *              gebeurtenis "geen cijfers" met begin en einde tegelijk
 *
 * Wat een meting niet meestuurt (gekoppeld en brug komen eens per minuut,
 * batterij_info en omvormer zijn leeg als het apparaat even niet antwoordt), is
 * onbekend: dan blijft het zoals het was. Pas als iets GEEN_EINDE_MS lang weg
 * is in een meting die het wel meestuurt, is het voorbij: zo wordt een meter
 * die aan en uit flikkert één gebeurtenis, geen honderd. Blijft het onbekend,
 * dan sluit het na ONBEKEND_MS, met als einde de laatste keer dat het speelde.
 *
 * Elke brugversie werkt: een oudere stuurt minder blokken, die zijn dan
 * gewoon onbekend (en een blok dat nooit komt, levert nooit een storing op).
 */
import { isRem } from '../../shared/geduld.js';
import { LOGBOEK_VOORVOEGSEL, sturenGebeurtenissen } from '../../shared/omvormerSturen.js';
import { nietGevonden } from '../../shared/tabellen.js';
import { schoon } from '../../shared/tekst.js';

/** Langer dan dit geen meting: achteraf een gebeurtenis "geen cijfers". */
export const GAT_MS = 10 * 60_000;
/** Zo lang moet een storing weg zijn voordat hij voorbij is (tegen flikkeren). */
export const GEEN_EINDE_MS = 2 * 60_000;
/** Zo lang mag een open storing onbekend blijven (het blok komt niet meer mee). */
export const ONBEKEND_MS = 30 * 60_000;
/** Na een mislukte schrijfactie (de rem, Base44 stuk) zo lang niets aan het logboek. */
export const PAUZE_MS = 60_000;
/** Meer tegelijk open is geen storing meer maar rommel. */
export const HOOGSTENS_OPEN = 20;
/**
 * Hooguit zoveel schrijfacties aan het logboek per meting (ronde 19, B3): een
 * meting met 32 storingsbits kost zo geen 20 creates in één keer. Wat er niet
 * bij past, komt bij de volgende meting vanzelf: een nieuwe storing begint dan
 * (een paar seconden later), een voorbije sluit dan (met hetzelfde einde).
 */
export const HOOGSTENS_SCHRIJVEN = 3;

const SLEUTEL = /^[a-z][a-z0-9._:-]{0,99}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T[0-9:.+\-Z]{5,30}$/;
const SOORTEN = new Set(['batterij', 'omvormer', 'meter', 'melding']);

/** Een onderwerp uit een melding: het stuk voor de eerste dubbele punt, in kleine letters, voor de sleutel. */
const onderwerp = (tekst) =>
  tekst
    .split(':')[0]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'algemeen';

/**
 * Wat er in deze meting mis is, per blok: een Map sleutel → { sleutel, soort, wat },
 * of null als de meting dat blok niet meestuurt (onbekend).
 * @param {object} meting  zoals controleerMeting hem goedkeurde
 */
export function storingenNu(meting) {
  const blok = () => new Map();
  const zet = (map, sleutel, soort, wat) => map.set(sleutel, { sleutel, soort, wat: schoon(wat, 160) || soort });

  let batterij = null;
  if (meting?.batterij_info && typeof meting.batterij_info.storing === 'boolean') {
    batterij = blok();
    if (meting.batterij_info.storing) {
      const niveau = meting.batterij_info.storing_niveau;
      zet(batterij, 'batterij', 'batterij', `De batterij meldt een storing${niveau ? ` (niveau ${niveau})` : ''}`);
    }
  }

  let omvormer = null;
  if (meting?.omvormer && typeof meting.omvormer.stand === 'string') {
    omvormer = blok();
    for (const bit of meting.omvormer.storingen ?? []) zet(omvormer, `omvormer:${bit}`, 'omvormer', `Omvormer: storingscode ${bit}`);
    if (!omvormer.size && meting.omvormer.stand === 'storing') zet(omvormer, 'omvormer:stand', 'omvormer', 'Omvormer staat op storing');
    for (const g of sturenGebeurtenissen(meting.omvormer.sturen)) zet(omvormer, g.sleutel, 'omvormer', g.wat);
  }

  let meter = null;
  if (Array.isArray(meting?.gekoppeld)) {
    meter = blok();
    for (const a of meting.gekoppeld) {
      if (a?.ok === false && typeof a.sleutel === 'string') zet(meter, `meter:${a.sleutel}`, 'meter', `${a.naam || a.soort || a.sleutel} antwoordt niet`);
    }
  }

  let melding = null;
  if (meting?.brug && typeof meting.brug === 'object') {
    melding = blok();
    for (const m of meting.brug.meldingen ?? []) {
      if (!m?.tekst || m.soort === 'apparaat') continue;
      const sleutel = `melding:${m.soort}:${onderwerp(m.tekst)}`.slice(0, 100);
      if (!melding.has(sleutel)) zet(melding, sleutel, 'melding', m.tekst);
    }
  }

  return { batterij, omvormer, meter, melding };
}

/** De open storingen uit de rij Meting (storingen_open), schoon: wat niet klopt, valt weg. */
export function openUit(lijst) {
  if (!Array.isArray(lijst)) return [];
  const gezien = new Set();
  const uit = [];
  for (const o of lijst) {
    if (!o || typeof o !== 'object' || typeof o.id !== 'string' || !o.id || !SLEUTEL.test(o.sleutel ?? '') || gezien.has(o.sleutel)) continue;
    if (!SOORTEN.has(o.soort) || !ISO.test(o.begin ?? '') || !ISO.test(o.gezien ?? '')) continue;
    gezien.add(o.sleutel);
    uit.push({
      id: o.id,
      sleutel: o.sleutel,
      soort: o.soort,
      wat: typeof o.wat === 'string' ? o.wat.slice(0, 160) : o.soort,
      begin: o.begin,
      gezien: o.gezien,
      weg: typeof o.weg === 'string' && ISO.test(o.weg) ? o.weg : null,
    });
    if (uit.length >= HOOGSTENS_OPEN) break;
  }
  return uit;
}

/**
 * Wat er verandert, zonder te schrijven: welke storingen beginnen, welke
 * voorbij zijn, en wat er daarna openstaat (nog zonder id voor de nieuwe).
 *
 * @param {{ open: object[], moment: string|null }} vorige  wat openstond, en de vorige meting
 * @param {object} meting  deze meting
 * @param {Date} nu  het moment van deze meting
 * @returns {{ beginnen: object[], voorbij: { id, eind, wat? }[], open: object[], gat: { begin, eind }|null }}
 */
export function wijzigingen(vorige, meting, nu) {
  const nuIso = nu.toISOString();
  const ms = nu.getTime();
  const blokken = storingenNu(meting);
  const voorbij = [];
  const open = [];
  for (const o of vorige.open ?? []) {
    const blok = blokken[o.soort];
    // Het begrenzen (1.5.0): de tekst groeit mee met het blok; bij het einde komt de laatste in de rij.
    const groeit = o.sleutel.startsWith(LOGBOEK_VOORVOEGSEL);
    if (blok?.has(o.sleutel)) {
      open.push({ ...o, gezien: nuIso, weg: null, ...(groeit ? { wat: blok.get(o.sleutel).wat } : {}) });
    } else if (blok) {
      const weg = o.weg ?? nuIso;
      if (ms - Date.parse(weg) >= GEEN_EINDE_MS) voorbij.push({ id: o.id, eind: weg, ...(groeit ? { wat: o.wat } : {}) });
      else open.push({ ...o, weg });
    } else if (ms - Date.parse(o.gezien) >= ONBEKEND_MS) {
      voorbij.push({ id: o.id, eind: o.gezien });
    } else {
      open.push(o);
    }
  }
  const al = new Set((vorige.open ?? []).map((o) => o.sleutel));
  const beginnen = [];
  for (const blok of Object.values(blokken)) {
    for (const s of blok?.values() ?? []) {
      if (al.has(s.sleutel) || open.length + beginnen.length >= HOOGSTENS_OPEN) continue;
      beginnen.push({ ...s, begin: nuIso, gezien: nuIso, weg: null });
    }
  }
  const vorigeMs = vorige.moment ? Date.parse(vorige.moment) : Number.NaN;
  const gat = Number.isFinite(vorigeMs) && ms - vorigeMs > GAT_MS ? { begin: vorige.moment, eind: nuIso } : null;
  return { beginnen, voorbij, open, gat };
}

/**
 * Het logboek bijwerken: hooguit één create per storing die begint (en één
 * voor een gat) en één update per storing die voorbij is, samen hooguit
 * HOOGSTENS_SCHRIJVEN per meting. Gooit nooit: een
 * mislukte schrijfactie houdt de meting niet tegen, en daarna rust het logboek
 * PAUZE_MS (bij de rem zou elke 5 s opnieuw proberen hem alleen voller maken).
 *
 * @param {object} db  tabellen() met Gebeurtenis
 * @param {string} huisId
 * @param {{ open: object[], moment: string|null, pauzeTot?: number }} vorige
 * @param {object} meting
 * @param {Date} nu
 * @returns {Promise<{ open: object[], pauzeTot: number }>}  wat er nu openstaat (met ids)
 */
export async function boekGebeurtenissen(db, huisId, vorige, meting, nu) {
  const ms = nu.getTime();
  if ((vorige.pauzeTot ?? 0) > ms) return { open: vorige.open ?? [], pauzeTot: vorige.pauzeTot };
  const { beginnen, voorbij, open, gat } = wijzigingen(vorige, meting, nu);
  const nogOpen = [...open];
  let mislukt = false;
  let geschreven = 0;
  // Een rij die er niet (meer) is, hoeft niet dicht; een create die "niet gevonden" geeft
  // (de tabel is er nog niet), is wel mislukt: anders zou elke meting het opnieuw proberen.
  const probeer = async (werk, { wegIsKlaar = false } = {}) => {
    if (mislukt || geschreven >= HOOGSTENS_SCHRIJVEN) return false;
    geschreven += 1;
    try {
      await werk();
      return true;
    } catch (fout) {
      if (wegIsKlaar && nietGevonden(fout)) return true;
      mislukt = true;
      if (!isRem(fout)) console.error('ontvangMeting: logboek bijwerken mislukt', fout?.message ?? fout);
      return false;
    }
  };

  // Het gat eerst: dat is er maar één keer (het moment van de vorige meting wordt zo overschreven).
  if (gat) {
    await probeer(() =>
      db.Gebeurtenis.create({ huis_id: huisId, sleutel: 'stil', soort: 'stil', wat: 'Geen cijfers van het programmaatje', begin: gat.begin, eind: gat.eind }),
    );
  }
  for (const v of voorbij) {
    // Lukt het niet (of niet meer bij deze meting), dan blijft hij open en sluit hij later alsnog, met hetzelfde einde.
    const klaar = await probeer(() => db.Gebeurtenis.update(v.id, { eind: v.eind, ...(v.wat ? { wat: v.wat } : {}) }), { wegIsKlaar: true });
    if (!klaar) {
      const was = (vorige.open ?? []).find((o) => o.id === v.id);
      if (was) nogOpen.push({ ...was, weg: was.weg ?? v.eind });
    }
  }
  for (const b of beginnen) {
    let rij = null;
    const klaar = await probeer(async () => {
      rij = await db.Gebeurtenis.create({ huis_id: huisId, sleutel: b.sleutel, soort: b.soort, wat: b.wat, begin: b.begin });
    });
    if (klaar && rij?.id) nogOpen.push({ id: rij.id, ...b });
  }
  return { open: nogOpen, pauzeTot: mislukt ? ms + PAUZE_MS : 0 };
}
