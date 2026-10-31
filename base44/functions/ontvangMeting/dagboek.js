/**
 * De rij van vandaag in de tabel Dag (base44/entities/Dag.jsonc): de totalen
 * van één dag van een huis, voor Week, Maand, Kwartaal en Jaar in de app. Los
 * van entry.ts, zodat de tests het zonder Base44 kunnen nalopen
 * (base44/tests/dagboek.test.js).
 *
 * Alles komt uit wat het programmaatje thuis toch al meestuurt (brug 0.4.0):
 *
 *   meting.vandaag      elke keer: afname en teruglevering (tellers van de P1-meter), kosten,
 *                       opbrengst, vaste kosten
 *   meting.dag          elke minuut: kWh van zon, huis, batterij; per kwartier zon, huis, batterij
 *                       en net (en daaruit per uur huis en zon, voor Advies); per fase gemiddelde en piek
 *   meting.dag.kwh.zon_zelf en net_huis (brug 1.2.0): per meting verdeeld, voor eigen verbruik en
 *                       zelfvoorzienend (verbruikUitKwh); een oudere brug: per kwartier (verbruikVan)
 *   meting.voorspelling als hij verandert (en eens per kwartier): de Zonnebonus per kwartier
 *   meting.weer         als het verandert (en eens per kwartier; brug 0.9.0): de zonnestraling per uur,
 *                       opgeteld per uur van de klok (voor Advies: wat de panelen bij zoveel licht leveren)
 *   meting.dag.zonnen   (brug 0.10.0, bij twee of meer plekken met panelen) per plek per kwartier: per uur
 *                       per plek, voor het tabblad Voorspelling
 *   meting.dag.apparaten (brug 0.12.0) per apparaat de kWh en keer van vandaag, en meting.dag.basis_kwh:
 *                       voor Overzicht › Apparaten (al nagekeken in controle.js)
 *   meting.omvormer     elke keer (brug 0.6.0, GoodWe): wat hij vandaag opwekte en zijn teller, als hij wakker is
 *   meting.dag.gas_m3, water_m3, warmte_gj (brug 1.4.0): wat de meters aan de slimme meter die dag telden
 *
 * Schrijven: hooguit één keer per kwartier per huis (de rem van Base44 geldt
 * ook voor de rol van de server), en alleen hier: één schrijver per rij. Per
 * huis onthouden we wanneer en in welke rij, zoals RIJ_VAN_HUIS in ontvang.js.
 * Na een herstart van de functie is dat geheugen leeg: dan eerst de
 * bestaande rij van die dag zoeken, niet een tweede maken.
 *
 * Rond middernacht: begint een nieuwe dag, dan gaat eerst de laatste stand
 * van gisteren nog naar de rij van gisteren, en pas dan begint vandaag.
 */
import { dagNummer, datumInNederland, uurInNederland } from '../../shared/dagen.js';
import { nietGevonden } from '../../shared/tabellen.js';

export const KWARTIER_MS = 15 * 60_000;
/** Lukt schrijven niet, dan zo lang wachten voor de volgende poging (niet bij elke meting). */
export const OPNIEUW_MS = 60_000;
/** Zoveel mag de klok thuis voor- of achterlopen rond middernacht. */
const SPELING_MS = 3_600_000;

const getal = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const rond = (v, n) => Math.round(v * 10 ** n) / 10 ** n;
/** Een getal binnen grenzen, afgerond; anders null. */
const tussen = (v, min, max, n) => {
  const g = getal(v);
  return g === null || g < min || g > max ? null : rond(g, n);
};
const plus = (w) => (Number.isFinite(w) && w > 0 ? w : 0);
/** Hele watts, zoals heleWatt in src/lib/stroom.js (een halve watt weg van nul). */
const heleWatt = (w) => {
  if (typeof w !== 'number' || !Number.isFinite(w)) return null;
  const heel = Math.round(Math.abs(w));
  return w < 0 && heel > 0 ? -heel : heel;
};

/**
 * Een echte datum, en vandaag in Nederland, of gisteren of morgen als de klok
 * thuis een uur scheef staat rond middernacht. Een oudere of latere dag kan
 * het programmaatje niet sturen: dat is een klok die niet klopt.
 */
export function datumKlopt(datum, nu) {
  if (dagNummer(datum) === null) return false;
  const ms = nu.getTime();
  return [ms - SPELING_MS, ms, ms + SPELING_MS].some((t) => datumInNederland(t) === datum);
}

/** Gemiddeld per kWh; onder de 50 Wh zegt dat niets. Meer dan 20 euro per kWh bestaat niet (zoals in controle.js). */
const gemiddeldePrijs = (eur, kwh) => (kwh >= 0.05 ? tussen(eur / kwh, -20, 20, 5) : null);

/** Het deel uit meting.vandaag: de meterkast en het geld. */
export function vandaagDeel(v) {
  if (!v || typeof v !== 'object' || dagNummer(v.datum) === null) return null;
  const afname = tussen(v.afname_kwh, 0, 2000, 3);
  const terug = tussen(v.teruglevering_kwh, 0, 2000, 3);
  const kosten = tussen(v.kosten_eur, -2000, 2000, 4);
  const opbrengst = tussen(v.opbrengst_eur, -2000, 2000, 4);
  if ([afname, terug, kosten, opbrengst].includes(null)) return null;
  return {
    datum: v.datum,
    velden: {
      afname_kwh: afname,
      teruglevering_kwh: terug,
      kosten_eur: kosten,
      opbrengst_eur: opbrengst,
      vaste_kosten_eur: v.vaste_kosten_eur == null ? null : tussen(v.vaste_kosten_eur, -100, 100, 4),
      afname_prijs_kwh: gemiddeldePrijs(kosten, afname),
      teruglevering_prijs_kwh: gemiddeldePrijs(opbrengst, terug),
      compleet: v.compleet !== false,
    },
  };
}

/**
 * Eén kwartier verdeeld zoals de app (verdeelStroom in src/lib/stroom.js):
 * eerst elke meter op hele watts, en de batterij gaat voor. Laadt hij, dan
 * krijgt hij de zon eerst, dan het huis, de rest gaat naar het net; wat de
 * zon tekortkomt komt uit het net (eerst voor de batterij, dan voor het huis).
 * Levert hij, dan blijft de zon eerst voor het huis en vult de batterij aan.
 * Alleen wat eigen verbruik en zelfvoorzienend nodig hebben, zonder drempels
 * (zoals dagOverzicht in src/lib/dagoverzicht.js met de soorten rekent).
 * base44/tests/dagboek.test.js houdt dit gelijk met de app: verandert de
 * verdeling daar, dan moet hij hier mee.
 */
export function kwartierDelen(zonW, batterijW, netW) {
  const zon = plus(heleWatt(zonW));
  const batterij = heleWatt(batterijW);
  const net = heleWatt(netW);
  const laden = plus(-(batterij ?? 0));
  const ontladen = plus(batterij);
  const afname = plus(net);
  const terug = plus(-(net ?? 0));
  const huisNodig = Math.max(0, zon + ontladen + afname - laden - terug);
  const zonNaarBatterij = Math.min(zon, laden);
  const zonNaarHuis = Math.min(zon - zonNaarBatterij, huisNodig);
  const batterijNaarHuis = Math.min(ontladen, huisNodig - zonNaarHuis);
  const netNaarBatterij = Math.min(afname, laden - zonNaarBatterij);
  const netNaarHuis = Math.min(afname - netNaarBatterij, huisNodig - zonNaarHuis - batterijNaarHuis);
  return { zon, zonZelf: zonNaarHuis + zonNaarBatterij, huis: zonNaarHuis + batterijNaarHuis + netNaarHuis, huisUitNet: netNaarHuis };
}

/**
 * Eigen verbruik en zelfvoorzienend precies, uit wat het programmaatje per
 * meting (elke 5 s) verdeelde (brug 1.2.0: kwh.zon_zelf en kwh.net_huis, met
 * kwartierDelen-regels): afnemen en terugleveren binnen een kwartier vallen
 * dan niet meer tegen elkaar weg. Null als die getallen er niet zijn (een
 * oudere brug, of de dag liep al voor het bijwerken): dan verbruikVan.
 */
export function verbruikUitKwh(kwh) {
  const g = (v) => tussen(v, 0, 2000, 6);
  const [zon, huis, zonZelf, netHuis] = [g(kwh?.zon), g(kwh?.huis), g(kwh?.zon_zelf), g(kwh?.net_huis)];
  if ([zon, huis, zonZelf, netHuis].includes(null)) return null;
  return {
    // Onder de 0,05 kWh zegt een percentage niets (een nacht, een grijze ochtend), zoals verbruikVan.
    eigen_verbruik: zon >= 0.05 ? rond(Math.min(1, zonZelf / zon), 4) : null,
    zelfvoorzienend: huis >= 0.05 ? rond(Math.min(1, Math.max(0, 1 - netHuis / huis)), 4) : null,
  };
}

/** Eigen verbruik en zelfvoorzienend over de kwartieren van een dag, zoals dagOverzicht in src/lib/dagoverzicht.js. */
export function verbruikVan(metingen, zon, batterij, net) {
  let zonWh = 0;
  let zonZelf = 0;
  let huisWh = 0;
  let huisUitNet = 0;
  metingen.forEach((n, i) => {
    if (!(n > 0)) return;
    const k = kwartierDelen(zon?.[i] ?? null, batterij?.[i] ?? null, net?.[i] ?? null);
    zonWh += k.zon / 4;
    zonZelf += k.zonZelf / 4;
    huisWh += k.huis / 4;
    huisUitNet += k.huisUitNet / 4;
  });
  return {
    // Onder de 50 Wh zegt een percentage niets (een nacht, een grijze ochtend).
    eigen_verbruik: zonWh >= 50 ? rond(Math.min(1, zonZelf / zonWh), 4) : null,
    zelfvoorzienend: huisWh >= 50 ? rond(Math.max(0, 1 - huisUitNet / huisWh), 4) : null,
  };
}

/**
 * Ongeveer zoveel van de opbrengst was Zonnebonus: per kwartier wat er
 * teruggeleverd werd (het gemiddelde vermogen naar het net) maal de
 * Zonnebonus van dat kwartier. Null als de prijzen niet elk kwartier met
 * teruglevering dekken: liever geen getal dan een te laag getal.
 */
export function zonnebonusVan(d, net, voorspelling) {
  if (!net || !voorspelling || voorspelling.stap_min !== 15 || !Array.isArray(voorspelling.zonnebonus_kwh)) return null;
  const vanPrijs = Date.parse(voorspelling.van);
  const vanDag = Date.parse(d.van);
  if (!Number.isFinite(vanPrijs) || !Number.isFinite(vanDag)) return null;
  let eur = 0;
  for (let i = 0; i < net.length; i++) {
    if (!(d.metingen[i] > 0) || !(net[i] < 0)) continue;
    const j = Math.round((vanDag + i * KWARTIER_MS - vanPrijs) / KWARTIER_MS);
    const bonus = j >= 0 ? getal(voorspelling.zonnebonus_kwh[j]) : null;
    if (bonus === null) return null;
    eur += (-net[i] / 1000 / 4) * Math.max(0, bonus);
  }
  return tussen(eur, 0, 2000, 4);
}

/** Per fase het daggemiddelde en de piek, of null. */
function fasenVan(lijst) {
  if (!Array.isArray(lijst)) return null;
  const gezien = new Set();
  const fasen = [];
  for (const f of lijst) {
    if (!f || ![1, 2, 3].includes(f.fase) || gezien.has(f.fase)) continue;
    const gemiddeld = tussen(f.gemiddeld_a, 0, 1000, 2);
    const piek = tussen(f.piek_a, 0, 1000, 1);
    if (gemiddeld === null || piek === null) continue;
    gezien.add(f.fase);
    fasen.push({ fase: f.fase, gemiddeld_a: gemiddeld, piek_a: piek });
  }
  return fasen.length ? fasen.sort((a, b) => a.fase - b.fase) : null;
}

/**
 * Per uur van de klok (0 tot 23, Nederlandse tijd) wat het huis gebruikte en
 * de panelen leverden, in Wh, en in hoeveel kwartieren er gemeten is. Daarmee
 * leert de app het gewone verbruik per uur (Advies, src/lib/advies.js). Op de
 * dag dat de klok een uur terug gaat, telt het dubbele uur twee keer zoveel
 * kwartieren; het gemiddelde per kwartier klopt dan nog steeds. Null zonder
 * huis per kwartier.
 */
export function urenVan(d, metingen, huis, zon) {
  const van = Date.parse(d.van);
  if (!huis || !Number.isFinite(van)) return null;
  const huisWh = Array(24).fill(0);
  const zonWh = Array(24).fill(0);
  const kwartieren = Array(24).fill(0);
  // Per plek met panelen (brug 0.10.0): alleen rijen die even lang zijn als de metingen.
  const plekken = (Array.isArray(d.zonnen) ? d.zonnen : [])
    .filter((z) => typeof z?.sleutel === 'string' && Array.isArray(z.w) && z.w.length === metingen.length && z.w.every((w) => getal(w) !== null))
    .slice(0, 6)
    .map((z) => ({ sleutel: z.sleutel, w: z.w, wh: Array(24).fill(0) }));
  metingen.forEach((n, i) => {
    if (!(n > 0)) return;
    const uur = uurInNederland(van + i * KWARTIER_MS);
    huisWh[uur] += Math.max(0, huis[i]) / 4;
    if (zon) zonWh[uur] += Math.max(0, zon[i]) / 4;
    for (const p of plekken) p.wh[uur] += Math.max(0, p.w[i]) / 4;
    kwartieren[uur] += 1;
  });
  return {
    huis_uur_wh: huisWh.map(Math.round),
    ...(zon ? { zon_uur_wh: zonWh.map(Math.round) } : {}),
    ...(plekken.length >= 2 ? { zonnen_uur_wh: plekken.map((p) => ({ sleutel: p.sleutel, uur_wh: p.wh.map(Math.round) })) } : {}),
    uur_kwartieren: kwartieren,
  };
}

/** Wakker: dan is wat de omvormer over vandaag zegt van vandaag (slaapt hij net na middernacht, dan nog van gisteren). */
const OMVORMER_WAKKER = new Set(['normaal', 'wacht', 'storing', 'controle']);

/**
 * Wat de omvormer (GoodWe, brug 0.6.0) over deze dag zegt: hoeveel hij
 * opwekte en zijn teller sinds hij er hangt, en bij welke zonnebron hij hoort.
 * Alleen als hij wakker is; de laatste stand van de dag blijft staan. Null zonder.
 */
export function omvormerVan(o) {
  if (!o || typeof o !== 'object' || !OMVORMER_WAKKER.has(o.stand)) return null;
  const kwh = tussen(o.vandaag_kwh, 0, 2000, 2);
  const totaal = tussen(o.totaal_kwh, 0, 100_000_000, 1);
  if (kwh === null && totaal === null) return null;
  return {
    ...(kwh === null ? {} : { omvormer_kwh: kwh }),
    ...(totaal === null ? {} : { omvormer_totaal_kwh: totaal }),
    ...(typeof o.bij === 'string' && o.bij.length <= 60 ? { omvormer_bij: o.bij } : {}),
  };
}

/**
 * Per uur van de klok (0 tot 23, Nederlandse tijd) de zonnestraling van deze
 * dag volgens het weerbericht (meting.weer, plek i = het uur vanaf van + i
 * uur), in Wh per m²: W/m² gemiddeld over een uur is Wh/m². Het dubbele uur
 * als de klok terug gaat telt twee keer. Null zonder straling, of als het
 * bericht minder dan 20 uur van deze dag dekt.
 */
export function stralingVan(weer, datum) {
  const van = typeof weer?.van === 'string' ? Date.parse(weer.van) : Number.NaN;
  const rij = weer?.straling_wm2;
  if (!Number.isFinite(van) || weer.stap_min !== 60 || !Array.isArray(rij)) return null;
  const som = Array(24).fill(0);
  let gedekt = 0;
  rij.forEach((w, i) => {
    const t = van + i * 3_600_000;
    if (datumInNederland(t) !== datum || !(getal(w) !== null && w >= 0 && w <= 1500)) return;
    som[uurInNederland(t)] += w;
    gedekt += 1;
  });
  return gedekt >= 20 ? { straling_uur_wh_m2: som.map(Math.round) } : null;
}

/** Het deel uit meting.dag (elke minuut): de kWh, eigen verbruik, zelfvoorzienend, de fasen en, met de prijzen, de Zonnebonus. */
export function dagDeel(d, voorspelling = null) {
  if (!d || typeof d !== 'object' || dagNummer(d.datum) === null || d.stap_min !== 15) return null;
  const metingen = Array.isArray(d.metingen) && d.metingen.length && d.metingen.length <= 100 && d.metingen.every((n) => getal(n) !== null && n >= 0) ? d.metingen : null;
  if (!metingen) return null;
  const kwh = ['zon', 'huis', 'geladen', 'ontladen'].map((soort) => tussen(d.kwh?.[soort], 0, 2000, 3));
  if (kwh.includes(null)) return null;
  const reeks = (veld) =>
    Array.isArray(d[veld]) && d[veld].length === metingen.length && d[veld].every((w) => getal(w) !== null && Math.abs(w) <= 100_000) ? d[veld] : null;
  const net = reeks('net_w');
  const fasen = fasenVan(d.fasen);
  const sinds = typeof d.sinds === 'string' && Number.isFinite(Date.parse(d.sinds)) ? new Date(Date.parse(d.sinds)).toISOString() : null;
  const bonus = zonnebonusVan(d, net, voorspelling);
  const uren = urenVan(d, metingen, reeks('huis_w'), reeks('zon_w'));
  return {
    datum: d.datum,
    velden: {
      zon_kwh: kwh[0],
      huis_kwh: kwh[1],
      geladen_kwh: kwh[2],
      ontladen_kwh: kwh[3],
      // Precies uit de stromen per meting (brug 1.2.0), anders zoals eerst per kwartier.
      ...(verbruikUitKwh(d.kwh) ?? verbruikVan(metingen, reeks('zon_w'), reeks('batterij_w'), net)),
      kwartieren: metingen.filter((n) => n > 0).length,
      ...(fasen ? { fasen } : {}),
      ...(uren ?? {}),
      ...(sinds ? { sinds } : {}),
      ...(bonus === null ? {} : { zonnebonus_eur: bonus }),
      // Een oudere brug stuurt ze niet: dan blijft het veld leeg (en wat er al stond, staat er nog).
      ...(Array.isArray(d.apparaten) ? { apparaten_kwh: d.apparaten } : {}),
      ...(typeof d.basis_kwh === 'number' && Number.isFinite(d.basis_kwh) ? { basis_kwh: d.basis_kwh } : {}),
      // Gas, water en warmte van die dag (brug 1.4.0, al nagekeken in controle.js); zonder meter blijven ze leeg.
      ...Object.fromEntries(['gas_m3', 'water_m3', 'warmte_gj'].map((v) => [v, tussen(d[v], 0, 1000, 3)]).filter(([, w]) => w !== null)),
    },
  };
}

/**
 * Per huis wat we van de lopende dag weten: welke dag, welke rij, wanneer
 * geschreven, de laatste cijfers, en de laatste prijzen (voor de Zonnebonus).
 * Alleen cijfers en een rij-id, geen recht: welk huis beslist elke keer de sleutel.
 */
const DAG_VAN_HUIS = new Map();

const nieuweStaat = (datum, voorspelling, weer = null) => ({ datum, id: null, geschreven: 0, probeerNa: 0, velden: {}, veranderd: false, voorspelling, weer });

async function schrijf(db, huisId, st, ms) {
  const velden = { ...st.velden, huis_id: huisId, datum: st.datum, bijgewerkt: new Date(ms).toISOString() };
  try {
    let klaar = false;
    if (st.id) {
      try {
        await db.Dag.update(st.id, velden);
        klaar = true;
      } catch (e) {
        if (!nietGevonden(e)) throw e;
        st.id = null;
      }
    }
    if (!klaar) {
      // De oudste rij van dit huis op deze dag; die lees en schrijf ik altijd.
      const [rij] = await db.Dag.filter({ huis_id: huisId, datum: st.datum }, 'id', 1);
      const uit = rij ? await db.Dag.update(rij.id, velden) : await db.Dag.create(velden);
      st.id = rij?.id ?? uit?.id ?? null;
    }
    st.geschreven = ms;
    st.probeerNa = 0;
    st.veranderd = false;
  } catch (e) {
    // De meting zelf staat er al. De dag over een minuut opnieuw, niet bij elke meting.
    st.probeerNa = ms + OPNIEUW_MS;
    console.error('ontvangMeting: dag bewaren mislukt', e?.message ?? e);
  }
}

/**
 * Wat een (goedgekeurde) meting aan de dag van dit huis verandert, en zo nodig
 * de rij bijwerken. Gooit nooit: een probleem met de dag houdt de meting niet tegen.
 *
 * @param {ReturnType<import('../../shared/tabellen.js').tabellen>} db
 * @param {string} huisId
 * @param {object} meting  uit controleerMeting
 * @param {Date} nu
 * @param {Map} [geheugen]
 */
export async function boekDag(db, huisId, meting, nu, geheugen = DAG_VAN_HUIS) {
  const ms = nu.getTime();
  let st = geheugen.get(huisId) ?? nieuweStaat(null, null);
  geheugen.set(huisId, st);
  const delen = [vandaagDeel(meting.vandaag), dagDeel(meting.dag, meting.voorspelling ?? st.voorspelling)].filter(
    (deel) => deel && datumKlopt(deel.datum, nu),
  );
  if (meting.voorspelling) st.voorspelling = meting.voorspelling;
  // Het weer komt niet elke keer mee: het laatste onthouden (zoals de voorspelling).
  if (meting.weer) st.weer = meting.weer;
  if (!delen.length) return;
  const datum = delen
    .map((deel) => deel.datum)
    .sort()
    .at(-1);
  // Een oudere dag na een nieuwere (dat kan alleen rond middernacht): die is al voorbij.
  if (st.datum && datum < st.datum) return;
  if (st.datum !== datum) {
    // De laatste stand van gisteren hoort bij gisteren.
    if (st.datum && st.veranderd) await schrijf(db, huisId, st, ms);
    st = nieuweStaat(datum, st.voorspelling, st.weer);
    geheugen.set(huisId, st);
  }
  for (const deel of delen) if (deel.datum === datum) Object.assign(st.velden, deel.velden);
  const omvormer = omvormerVan(meting.omvormer);
  if (omvormer) Object.assign(st.velden, omvormer);
  const straling = stralingVan(st.weer, datum);
  if (straling) Object.assign(st.velden, straling);
  st.veranderd = true;
  if (ms - st.geschreven >= KWARTIER_MS && ms >= st.probeerNa) await schrijf(db, huisId, st, ms);
}
