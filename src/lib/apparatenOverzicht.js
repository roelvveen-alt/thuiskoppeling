/**
 * Overzicht › Apparaten: per apparaat hoeveel kWh, welk deel van het huis,
 * wat het ongeveer kostte en hoe vaak het aan was, over vandaag of een
 * periode. De cijfers komen van het programmaatje (brug 0.12.0,
 * brug/herkennen.mjs dagVoorApp): per dag per apparaat de kWh en het aantal
 * keer, en de basis. Vandaag uit de stand (meting.dag.apparaten), eerdere
 * dagen uit de tabel Dag (apparaten_kwh, basis_kwh; actie periode).
 *
 * Twee soorten:
 *   gemeten  een eigen meter (de spa in huis B): precies
 *   herkend  geraden uit het huisverbruik: een schatting (≈); ook wat vaker
 *            terugkomt en nog geen naam heeft (isTerugkerend, brug 1.4.0)
 * plus de Basis (altijd aan, een warmtepomp die meeloopt) en de Rest: wat het
 * huis gebruikte en niet herkend of apart gemeten is.
 *
 * Euro's: ongeveer, kWh maal wat een kWh uit het net die dag gemiddeld kostte
 * (kosten / afname). Een dag met (bijna) niets afgenomen neemt de gemiddelde
 * prijs van de hele periode. De zon of de batterij kan een deel betaald
 * hebben, dus het is een schatting.
 */
import { ouderDan } from './batterijGegevens';
import { SOORT_NAAM, SOORTEN } from './herkennen';

/** Vanaf deze versie stuurt het programmaatje de apparaten per dag. */
export const BRUG_MET_APPARATEN = '0.12.0';

const getal = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const SLEUTEL = /^[a-zA-Z0-9._:-]{1,60}$/;

/**
 * De lijst per apparaat van één dag (Dag.apparaten_kwh, of meting.dag.apparaten), schoon:
 * [{ sleutel, soort, naam, kwh, keer, gemeten }]. Geen lijst (een oudere brug): null.
 */
export function apparatenUit(lijst) {
  if (!Array.isArray(lijst)) return null;
  const gezien = new Set();
  const uit = [];
  for (const a of lijst) {
    if (!a || typeof a.sleutel !== 'string' || !SLEUTEL.test(a.sleutel) || gezien.has(a.sleutel)) continue;
    const kwh = getal(a.kwh);
    if (kwh === null || kwh < 0) continue;
    gezien.add(a.sleutel);
    uit.push({
      sleutel: a.sleutel,
      soort: SOORTEN.includes(a.soort) ? a.soort : null,
      naam: typeof a.naam === 'string' && a.naam ? a.naam : null,
      kwh,
      keer: Number.isInteger(a.keer) && a.keer >= 0 ? a.keer : 0,
      gemeten: a.gemeten === true,
    });
  }
  return uit;
}

/** Wat een kWh uit het net die dag gemiddeld kostte, of null bij (bijna) niets afgenomen. */
const prijsVan = (dag) => (getal(dag.kosten) !== null && getal(dag.afname) !== null && dag.afname >= 0.05 ? dag.kosten / dag.afname : null);

/** Hoe een apparaat heet: de eigen naam uit de app (Instellingen › Namen), dan die van de meter of het label, dan de soort. */
export function naamVan(a, namen = {}) {
  return (namen && namen[a.sleutel]) || a.naam || (a.soort ? SOORT_NAAM[a.soort] : null) || a.sleutel;
}

/**
 * Alles over een rij dagen (zoals dagenUit en metVandaag in src/lib/periode.js ze geven).
 * Alleen de dagen met apparaten tellen mee, ook voor het huis: anders zou het
 * aandeel te laag lijken op dagen van voor het bijwerken.
 *
 * @param {Array<{ datum: string, huis: number|null, kosten: number|null, afname: number|null, apparaten: Array|null, basis: number|null }>} dagen
 * @param {{ namen?: object, prijs?: number|null }} [opties]
 *   prijs: wat een kWh uit het net kost als de dagen zelf geen prijs hebben (vandaag: de prijs van nu)
 * @returns {{ dagenMet: number, dagen: number, eerste: string|null, huis: number|null,
 *   regels: Array<{ sleutel, naam, soort, gemeten, kwh, keer, eur, aandeel }>,
 *   basis: { kwh, eur, aandeel }|null, rest: { kwh, eur, aandeel }|null, metGeld: boolean }}
 */
export function apparatenVan(dagen, { namen = {}, prijs = null } = {}) {
  const met = dagen.filter((d) => Array.isArray(d.apparaten));
  // De gemiddelde prijs over de dagen met een prijs: voor een dag zonder (alles uit zon en batterij).
  const afname = met.reduce((t, d) => t + (prijsVan(d) === null ? 0 : d.afname), 0);
  const kosten = met.reduce((t, d) => t + (prijsVan(d) === null ? 0 : d.kosten), 0);
  const gemiddeld = afname >= 0.05 ? kosten / afname : getal(prijs);
  const perSleutel = new Map();
  let huis = null;
  let basis = null;
  let basisEur = 0;
  // Rest per dag, nooit onder nul (zoals de staven in reeksVan), en dan opgeteld: zo passen kWh, € en staven bij elkaar (R19-RK-10).
  let restKwh = null;
  let restEur = 0;
  let metGeld = false;
  for (const d of met) {
    const p = prijsVan(d) ?? gemiddeld;
    if (p !== null) metGeld = true;
    let somDag = 0;
    for (const a of d.apparaten) {
      const r = perSleutel.get(a.sleutel) ?? { sleutel: a.sleutel, soort: a.soort, naam: a.naam, gemeten: a.gemeten, kwh: 0, keer: 0, eur: 0 };
      r.kwh += a.kwh;
      r.keer += a.keer;
      r.eur += p === null ? 0 : a.kwh * p;
      // De nieuwste dag zegt hoe het heet en of het een eigen meter heeft.
      Object.assign(r, { soort: a.soort ?? r.soort, naam: a.naam ?? r.naam, gemeten: a.gemeten });
      perSleutel.set(a.sleutel, r);
      somDag += a.kwh;
    }
    const b = getal(d.basis);
    if (b !== null) {
      basis = (basis ?? 0) + b;
      basisEur += p === null ? 0 : b * p;
    }
    if (getal(d.huis) !== null) {
      huis = (huis ?? 0) + d.huis;
      const rest = Math.max(0, d.huis - somDag - (b ?? 0));
      restKwh = (restKwh ?? 0) + rest;
      restEur += p === null ? 0 : rest * p;
    }
  }
  const aandeel = (kwh) => (huis > 0 ? Math.min(1, kwh / huis) : null);
  const geld = (eur) => (metGeld ? eur : null);
  const regels = [...perSleutel.values()]
    .filter((r) => r.kwh >= 0.005 || r.keer > 0)
    .map((r) => ({ ...r, naam: naamVan(r, namen), eur: geld(r.eur), aandeel: aandeel(r.kwh) }))
    .sort((a, b) => b.kwh - a.kwh || a.naam.localeCompare(b.naam, 'nl'));
  return {
    dagenMet: met.length,
    dagen: dagen.length,
    eerste: met[0]?.datum ?? null,
    huis,
    regels,
    basis: basis === null ? null : { kwh: basis, eur: geld(basisEur), aandeel: aandeel(basis) },
    rest: restKwh === null || restKwh < 0.005 ? null : { kwh: restKwh, eur: geld(restEur), aandeel: aandeel(restKwh) },
    metGeld,
  };
}

/**
 * Iets dat vaker terugkomt maar nog geen naam heeft (brug 1.4.0): sleutel 'h:onbekend:<groep>', naam
 * "Onbekend apparaat A, zo'n 1,8 kW". Het staat apart, niet in de Rest; krijgt het een naam, dan
 * telt het vanaf dan onder die naam.
 */
export const isTerugkerend = (sleutel) => typeof sleutel === 'string' && sleutel.startsWith('h:onbekend:');

/** De sleutels van Basis en Rest in de lijst (geen apparaat heeft ze: die van een herkend apparaat begint met 'h:'). */
export const BASIS = 'basis';
export const REST = 'rest';

/**
 * Per staaf (een dag, week of maand; stavenVan in src/lib/periode.js) de kWh
 * van één apparaat, of van Basis of Rest. Null als er in die staaf geen enkele
 * dag met apparaten is (nog niet, of van voor het bijwerken); 0 als het
 * apparaat er die dagen niet bij was.
 */
export function reeksVan(staven, dagen, sleutel) {
  return staven.map((s) => {
    const groep = dagen.filter((d) => d.datum >= s.van && d.datum <= s.tot && Array.isArray(d.apparaten));
    if (!groep.length) return null;
    return groep.reduce((t, d) => {
      if (sleutel === BASIS) return t + (getal(d.basis) ?? 0);
      if (sleutel === REST) {
        if (getal(d.huis) === null) return t;
        return t + Math.max(0, d.huis - d.apparaten.reduce((s2, a) => s2 + a.kwh, 0) - (getal(d.basis) ?? 0));
      }
      return t + (d.apparaten.find((a) => a.sleutel === sleutel)?.kwh ?? 0);
    }, 0);
  });
}

/**
 * De vergelijking met de periode ervoor, per sleutel: { [sleutel]: kWh }, met
 * BASIS en REST erbij. Null als de vorige periode geen enkele dag met
 * apparaten heeft (dan zeggen we niets, in plaats van "vorige week 0").
 */
export function vorigeVan(dagen) {
  const o = apparatenVan(dagen);
  if (!o.dagenMet) return null;
  const uit = Object.fromEntries(o.regels.map((r) => [r.sleutel, r.kwh]));
  if (o.basis) uit[BASIS] = o.basis.kwh;
  uit[REST] = o.rest?.kwh ?? 0;
  return uit;
}

/**
 * Wat de kaart moet laten zien:
 *   kaart      er zijn apparaten
 *   bijwerken  het programmaatje is ouder dan 0.12.0
 *   wachten    het programmaatje is nieuw genoeg, maar er is (in deze periode) nog niets geteld
 *   niets      er is geen programmaatje bekend (dan zegt de rest van het scherm het al)
 */
export function apparatenStand(overzicht, brugVersie) {
  if (overzicht.dagenMet > 0 && (overzicht.regels.length || overzicht.basis || overzicht.rest)) return 'kaart';
  if (!brugVersie) return overzicht.dagenMet > 0 ? 'wachten' : 'niets';
  return ouderDan(brugVersie, BRUG_MET_APPARATEN) ? 'bijwerken' : 'wachten';
}
