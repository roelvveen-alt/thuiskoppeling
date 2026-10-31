/**
 * De batterij leren kennen (1.4.0, 31-10-2026: "leer ook van de schatting,
 * nu ben je vaak te positief"): hoeveel kWh er ECHT uit de batterij komt (of in
 * gaat) per procent laadniveau, met alle verlies erbij. Alleen kijken: de
 * energie uit batterij_w per meting (positief = leveren, negatief = laden), tegenover
 * hoe het laadniveau (batterij_procent) verandert.
 *
 * Per stuk in één richting (leveren of laden) tellen we de energie op; is het
 * laadniveau minstens STUK_PCT veranderd, dan is dat één meting: kWh ÷ procent.
 * Die gaat in een glijdend gemiddelde (de eerste paar tellen even zwaar, daarna
 * weegt een nieuwe 1/GLIJDEND). Een stuk begint opnieuw bij een andere richting,
 * een gat in de metingen (langer dan GAT_MS) of een sprong in het laadniveau die
 * niet bij de energie past. Wat niet aannemelijk is (buiten GRENZEN) telt niet.
 *
 * Bewaard op de telefoon in batterij-geleerd.json (zoals herkennen.json), zodat
 * het na een herstart doorleert. De app krijgt het als batterij_info.geleerd
 * ({ kwh_per_pct_leveren, kwh_per_pct_laden, metingen }); een oudere functie laat
 * het stil vallen, en zonder gebruikt de app zijn eigen schatting zoals eerst.
 */

/** Zoveel procent verschil is één meting (kleiner: de afronding op hele procenten weegt te zwaar). */
export const STUK_PCT = 10;
/** Een gat in de metingen: dan opnieuw beginnen (de energie ertussen kennen we niet). */
export const GAT_MS = 2 * 60_000;
/** Onder dit vermogen telt het niet als laden of leveren (stilstand, sluipverbruik). */
export const STIL_W = 20;
/** Na zoveel metingen weegt een nieuwe 1/GLIJDEND in het gemiddelde. */
export const GLIJDEND = 8;
/**
 * Wat kan: van één accu van 0,96 kWh (0,0096 kWh per procent) tot achttien van 2,88 kWh
 * (0,52 kWh per procent), met ruimte voor verlies. Daarbuiten is het een rare lezing.
 */
export const GRENZEN = Object.freeze({ KWH_PER_PCT_MIN: 0.005, KWH_PER_PCT_MAX: 1 });

const getal = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const goed = (v) => getal(v) !== null && v >= GRENZEN.KWH_PER_PCT_MIN && v <= GRENZEN.KWH_PER_PCT_MAX;

/** Een gemiddelde uit het bestand, schoon: { kwh_per_pct, n } of null. */
function gemiddeldeUit(g) {
  if (!g || !goed(g.kwh_per_pct) || !Number.isInteger(g.n) || g.n < 1) return null;
  return { kwh_per_pct: g.kwh_per_pct, n: Math.min(g.n, 100_000) };
}

/**
 * @param {{ staat?: object|null }} [opties]  staat: wat bewaar() eerder gaf (batterij-geleerd.json)
 */
export function maakBatterijLeren({ staat = null } = {}) {
  const geleerd = { leveren: gemiddeldeUit(staat?.leveren), laden: gemiddeldeUit(staat?.laden) };
  /** Het stuk van nu: { richting, begin_pct, kwh, laatst_ms }, of null. */
  let stuk = null;
  /** De vorige meting: { ms, w }. */
  let vorige = null;

  const begin = (richting, pct, nu) => {
    stuk = { richting, begin_pct: pct, kwh: 0, laatst_ms: nu };
  };

  const neemOp = (richting, kwhPerPct) => {
    if (!goed(kwhPerPct)) return false;
    const oud = geleerd[richting];
    const n = (oud?.n ?? 0) + 1;
    const gewicht = 1 / Math.min(n, GLIJDEND);
    const nieuw = oud ? oud.kwh_per_pct + gewicht * (kwhPerPct - oud.kwh_per_pct) : kwhPerPct;
    geleerd[richting] = { kwh_per_pct: Math.round(nieuw * 100_000) / 100_000, n };
    return true;
  };

  return {
    /**
     * Eén meting: batterij_w (positief = leveren) en batterij_procent. Geeft een zin voor
     * brug.log als er een meting bij kwam, anders null.
     */
    ronde({ batterij_w, batterij_procent }, nu) {
      const w = getal(batterij_w);
      const pct = getal(batterij_procent);
      if (w === null || pct === null || pct < 0 || pct > 100) {
        stuk = null;
        vorige = null;
        return null;
      }
      const richting = w >= STIL_W ? 'leveren' : w <= -STIL_W ? 'laden' : null;
      // De energie sinds de vorige meting, met het vermogen van toen (zo telt een meting na een gat niet).
      const dt = vorige ? nu - vorige.ms : null;
      const gat = dt === null || dt <= 0 || dt > GAT_MS;
      const energie = gat ? 0 : (Math.abs(vorige.w) * dt) / 3_600_000 / 1000;
      const vorigeRichting = vorige ? (vorige.w >= STIL_W ? 'leveren' : vorige.w <= -STIL_W ? 'laden' : null) : null;
      vorige = { ms: nu, w };

      if (gat || !stuk) {
        stuk = null;
        if (richting) begin(richting, pct, nu);
        return null;
      }
      // Stilstand tussendoor mag (het stuk loopt door); een andere richting begint opnieuw.
      if (richting && richting !== stuk.richting) {
        begin(richting, pct, nu);
        return null;
      }
      if (vorigeRichting === stuk.richting) stuk.kwh += energie;
      stuk.laatst_ms = nu;
      const verschil = stuk.richting === 'leveren' ? stuk.begin_pct - pct : pct - stuk.begin_pct;
      // Het laadniveau ging de verkeerde kant op (kalibreren, een sprong): opnieuw.
      if (verschil <= -2) {
        if (richting) begin(richting, pct, nu);
        else stuk = null;
        return null;
      }
      if (verschil < STUK_PCT) return null;
      const kwhPerPct = stuk.kwh / verschil;
      const was = stuk.richting;
      const telt = neemOp(was, kwhPerPct);
      begin(was, pct, nu);
      if (!telt) return null;
      const per = geleerd[was].kwh_per_pct;
      return `Batterij geleerd (${was}): ${(kwhPerPct * 1000).toFixed(0)} Wh per procent deze keer, gemiddeld ${(per * 1000).toFixed(0)} Wh (${geleerd[was].n} keer).`;
    },

    /** Voor de app (batterij_info.geleerd), of null als er nog niets geleerd is. */
    voorApp() {
      const { leveren, laden } = geleerd;
      if (!leveren && !laden) return null;
      return {
        ...(leveren ? { kwh_per_pct_leveren: leveren.kwh_per_pct } : {}),
        ...(laden ? { kwh_per_pct_laden: laden.kwh_per_pct } : {}),
        metingen: (leveren?.n ?? 0) + (laden?.n ?? 0),
      };
    },

    /** Wat er bewaard wordt (batterij-geleerd.json): alleen de gemiddelden, niet het lopende stuk. */
    bewaar() {
      return { versie: 1, leveren: geleerd.leveren, laden: geleerd.laden };
    },
  };
}
