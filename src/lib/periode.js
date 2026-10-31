/**
 * Week, maand, kwartaal en jaar op het tabblad Overzicht: welke dagen erbij
 * horen (Nederlandse tijd), hoe ze in staven gaan (per dag, per week of per
 * maand) en wat ze samen zijn. De dagen komen van de server (actie periode,
 * tabel Dag; zie base44/shared/dagen.js); vandaag komt vers uit de stand.
 *
 * Datums zijn tekst ("2026-10-30"), gerekend als kalenderdagen: zo telt een
 * dag waarop de klok verzet wordt gewoon als één dag.
 */
import { apparatenUit } from './apparatenOverzicht';
import { dagOverzicht } from './dagoverzicht';
import { vandaagVan } from './meterkast';
import { datumVan } from './prijsoverzicht';

export const KEUZES = Object.freeze([
  { sleutel: 'vandaag', naam: 'Vandaag' },
  { sleutel: 'week', naam: 'Week' },
  { sleutel: 'maand', naam: 'Maand' },
  { sleutel: 'kwartaal', naam: 'Kwartaal' },
  { sleutel: 'jaar', naam: 'Jaar' },
]);

const DAG_MS = 86_400_000;
const DATUM = /^(\d{4})-(\d{2})-(\d{2})$/;

const WEEKDAGEN = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'];
const MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
const MAAND_KORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

/** Dagen sinds 1 januari 1970 van een echte datum "2026-10-30", of null. */
export function dagNummer(datum) {
  const deel = typeof datum === 'string' ? DATUM.exec(datum) : null;
  if (!deel) return null;
  const [jaar, maand, dag] = [Number(deel[1]), Number(deel[2]), Number(deel[3])];
  const terug = new Date(Date.UTC(jaar, maand - 1, dag));
  if (terug.getUTCFullYear() !== jaar || terug.getUTCMonth() !== maand - 1 || terug.getUTCDate() !== dag) return null;
  return Date.UTC(jaar, maand - 1, dag) / DAG_MS;
}

export const datumVanNummer = (n) => new Date(n * DAG_MS).toISOString().slice(0, 10);

/** 0 = maandag, …, 6 = zondag. */
export const weekdagVan = (n) => (new Date(n * DAG_MS).getUTCDay() + 6) % 7;

/** Het weeknummer zoals op de Nederlandse kalender (ISO: de week met de eerste donderdag is week 1). */
export function weekNummer(n) {
  const donderdag = n - weekdagVan(n) + 3;
  const jaar = new Date(donderdag * DAG_MS).getUTCFullYear();
  return Math.floor((donderdag - Date.UTC(jaar, 0, 1) / DAG_MS) / 7) + 1;
}

const delen = (n) => {
  const d = new Date(n * DAG_MS);
  return { jaar: d.getUTCFullYear(), maand: d.getUTCMonth(), dag: d.getUTCDate() };
};

/** "vrijdag 30 oktober". */
export function dagNaam(datum) {
  const n = dagNummer(datum);
  if (n === null) return '';
  const { maand, dag } = delen(n);
  return `${WEEKDAGEN[weekdagVan(n)]} ${dag} ${MAANDEN[maand]}`;
}

/** "30 okt", of met het jaar erbij: "30 okt 2026". */
export function korteDatum(datum, { metJaar = false } = {}) {
  const n = dagNummer(datum);
  if (n === null) return '';
  const { jaar, maand, dag } = delen(n);
  return `${dag}\u00a0${MAAND_KORT[maand]}${metJaar ? `\u00a0${jaar}` : ''}`;
}

/**
 * De periode waar vandaag (Nederlandse tijd) in valt:
 *   week      maandag t/m zondag
 *   maand     de eerste t/m de laatste van de maand
 *   kwartaal  januari–maart, april–juni, juli–september, oktober–december
 *   jaar      1 januari t/m 31 december
 * Met `vorige` de periode ervoor (vorige week, maand of kwartaal), voor de
 * vergelijking bij Apparaten; bij het jaar null (twee jaar is meer dan de
 * server in één keer geeft).
 * @returns {{ keuze: string, van: string, tot: string, vandaag: string, vorige: { van: string, tot: string, naam: string }|null }}
 */
export function periodeVan(keuze, nu) {
  const vandaag = datumVan(nu);
  const n = dagNummer(vandaag);
  const { jaar, maand } = delen(n);
  const nr = (j, m, d) => Date.UTC(j, m, d) / DAG_MS;
  let begin = n;
  let einde = n;
  let vorige = null;
  if (keuze === 'week') {
    begin = n - weekdagVan(n);
    einde = begin + 6;
    vorige = { van: begin - 7, tot: begin - 1, naam: 'vorige week' };
  } else if (keuze === 'maand') {
    begin = nr(jaar, maand, 1);
    einde = nr(jaar, maand + 1, 0);
    vorige = { van: nr(jaar, maand - 1, 1), tot: begin - 1, naam: 'vorige maand' };
  } else if (keuze === 'kwartaal') {
    const eerste = maand - (maand % 3);
    begin = nr(jaar, eerste, 1);
    einde = nr(jaar, eerste + 3, 0);
    vorige = { van: nr(jaar, eerste - 3, 1), tot: begin - 1, naam: 'vorig kwartaal' };
  } else if (keuze === 'jaar') {
    begin = nr(jaar, 0, 1);
    einde = nr(jaar, 11, 31);
  }
  return {
    keuze,
    van: datumVanNummer(begin),
    tot: datumVanNummer(einde),
    vandaag,
    vorige: vorige && { van: datumVanNummer(vorige.van), tot: datumVanNummer(vorige.tot), naam: vorige.naam },
  };
}

/** De kop bij een periode: "Deze week" en "26 okt – 1 nov". */
export function titelVan(periode) {
  const van = dagNummer(periode.van);
  const tot = dagNummer(periode.tot);
  const a = delen(van);
  const b = delen(tot);
  if (periode.keuze === 'week') return { titel: 'Deze week', bereik: `${korteDatum(periode.van)} – ${korteDatum(periode.tot)}` };
  if (periode.keuze === 'maand') return { titel: 'Deze maand', bereik: `${MAANDEN[a.maand]} ${a.jaar}` };
  if (periode.keuze === 'kwartaal') return { titel: 'Dit kwartaal', bereik: `${MAANDEN[a.maand]} t/m ${MAANDEN[b.maand]} ${b.jaar}` };
  if (periode.keuze === 'jaar') return { titel: 'Dit jaar', bereik: String(a.jaar) };
  return { titel: 'Vandaag', bereik: dagNaam(periode.vandaag) };
}

/**
 * De staven van een periode: per dag (week, maand), per week (kwartaal) of per
 * maand (jaar). Elke staaf { van, tot } valt binnen de periode, met `kort`
 * (onder de as) en `lang` (in de tip en de tabel).
 */
export function stavenVan(periode) {
  const begin = dagNummer(periode.van);
  const einde = dagNummer(periode.tot);
  const staven = [];
  if (periode.keuze === 'kwartaal') {
    for (let n = begin; n <= einde; ) {
      const zondag = Math.min(einde, n - weekdagVan(n) + 6);
      const van = datumVanNummer(n);
      const tot = datumVanNummer(zondag);
      staven.push({ van, tot, kort: String(weekNummer(n)), lang: `week ${weekNummer(n)} · ${n === zondag ? korteDatum(van) : `${korteDatum(van)} – ${korteDatum(tot)}`}` });
      n = zondag + 1;
    }
  } else if (periode.keuze === 'jaar') {
    const { jaar } = delen(begin);
    for (let m = 0; m < 12; m++) {
      staven.push({ van: datumVanNummer(Date.UTC(jaar, m, 1) / DAG_MS), tot: datumVanNummer(Date.UTC(jaar, m + 1, 0) / DAG_MS), kort: MAAND_KORT[m], lang: `${MAANDEN[m]} ${jaar}` });
    }
  } else {
    for (let n = begin; n <= einde; n++) {
      const datum = datumVanNummer(n);
      staven.push({ van: datum, tot: datum, kort: periode.keuze === 'week' ? WEEKDAGEN[weekdagVan(n)].slice(0, 2) : String(delen(n).dag), lang: dagNaam(datum) });
    }
  }
  return staven;
}

const getal = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const fractie = (v) => {
  const g = getal(v);
  return g === null ? null : Math.min(1, Math.max(0, g));
};

/** Een dag zonder cijfers; wat er niet is, blijft null (dan telt het nergens mee). */
const legeDag = (datum) => ({
  datum,
  zon: null,
  huis: null,
  geladen: null,
  ontladen: null,
  afname: null,
  terug: null,
  kosten: null,
  opbrengst: null,
  vast: null,
  bonus: null,
  compleet: true,
  eigenVerbruik: null,
  zelfvoorzienend: null,
  fasen: [],
  kwartieren: null,
  uren: null,
  omvormer: null,
  apparaten: null,
  basis: null,
  // Gas, water en warmte van die dag (programmaatje 1.4.0); zonder meter null.
  gas: null,
  water: null,
  warmte: null,
});

/**
 * Per uur van de klok (sinds november 2026, zie urenVan in
 * base44/functions/ontvangMeting/dagboek.js): { huisWh, zonWh, stralingWh,
 * kwartieren, zonnenWh }, elk 24 getallen (zonnenWh per plek); zonWh null zonder zon per kwartier,
 * stralingWh null zonder weerbericht. Een oudere dag of een
 * rij die niet klopt: null.
 */
function urenUit(r) {
  const rij24 = (v) => (Array.isArray(v) && v.length === 24 && v.every((x) => typeof x === 'number' && Number.isFinite(x) && x >= 0) ? v : null);
  const huisWh = rij24(r.huis_uur_wh);
  const kwartieren = rij24(r.uur_kwartieren);
  if (!huisWh || !kwartieren) return null;
  // De straling per uur uit het weerbericht (Wh/m², brug 0.9.0); een oudere dag: null.
  // Per plek met panelen (brug 0.10.0, bij twee of meer plekken): { [sleutel]: Wh[24] }, anders null.
  const zonnen = {};
  for (const z of Array.isArray(r.zonnen_uur_wh) ? r.zonnen_uur_wh : []) {
    const wh = rij24(z?.uur_wh);
    if (typeof z?.sleutel === 'string' && z.sleutel && wh) zonnen[z.sleutel] = wh;
  }
  return { huisWh, zonWh: rij24(r.zon_uur_wh), stralingWh: rij24(r.straling_uur_wh_m2), kwartieren, zonnenWh: Object.keys(zonnen).length >= 2 ? zonnen : null };
}

/** De dagen uit het antwoord van de server, schoon en op datum; elke datum één keer. */
export function dagenUit(lijst) {
  if (!Array.isArray(lijst)) return [];
  const perDatum = new Map();
  for (const r of lijst) {
    if (!r || dagNummer(r.datum) === null || perDatum.has(r.datum)) continue;
    perDatum.set(r.datum, {
      ...legeDag(r.datum),
      zon: getal(r.zon_kwh),
      huis: getal(r.huis_kwh),
      geladen: getal(r.geladen_kwh),
      ontladen: getal(r.ontladen_kwh),
      afname: getal(r.afname_kwh),
      terug: getal(r.teruglevering_kwh),
      kosten: getal(r.kosten_eur),
      opbrengst: getal(r.opbrengst_eur),
      vast: getal(r.vaste_kosten_eur),
      bonus: getal(r.zonnebonus_eur),
      compleet: r.compleet !== false,
      eigenVerbruik: fractie(r.eigen_verbruik),
      zelfvoorzienend: fractie(r.zelfvoorzienend),
      fasen: (Array.isArray(r.fasen) ? r.fasen : [])
        .filter((f) => [1, 2, 3].includes(f?.fase) && getal(f.gemiddeld_a) !== null)
        .map((f) => ({ fase: f.fase, gemiddeldA: f.gemiddeld_a, piekA: getal(f.piek_a) })),
      kwartieren: getal(r.kwartieren),
      uren: urenUit(r),
      // Wat de omvormer (GoodWe) over die dag zei, en zijn teller (sinds november 2026); anders null.
      omvormer: getal(r.omvormer_kwh) !== null || getal(r.omvormer_totaal_kwh) !== null
        ? { kwh: getal(r.omvormer_kwh), totaal: getal(r.omvormer_totaal_kwh), bij: typeof r.omvormer_bij === 'string' && r.omvormer_bij ? r.omvormer_bij : null }
        : null,
      // Per apparaat en de basis (brug 0.12.0, src/lib/apparatenOverzicht.js); een dag van daarvoor: null.
      apparaten: apparatenUit(r.apparaten_kwh),
      basis: getal(r.basis_kwh),
      gas: getal(r.gas_m3),
      water: getal(r.water_m3),
      warmte: getal(r.warmte_gj),
    });
  }
  return [...perDatum.values()].sort((a, b) => (a.datum < b.datum ? -1 : 1));
}

/**
 * Ongeveer zoveel Zonnebonus vandaag: per kwartier wat er naar het net ging
 * maal de Zonnebonus van dat kwartier, zoals de server het voor elke dag doet
 * (base44/functions/ontvangMeting/dagboek.js). Null zonder prijzen die elk
 * kwartier met teruglevering dekken.
 */
export function zonnebonusVan(dag, voorspelling) {
  if (!dag?.net || !voorspelling) return null;
  let eur = 0;
  for (let i = 0; i < dag.net.length; i++) {
    const w = dag.net[i];
    if (!(dag.metingen[i] > 0) || w === null || !(w < 0)) continue;
    const j = Math.round((dag.van + i * dag.stapMs - voorspelling.van) / voorspelling.stapMs);
    const bonus = j >= 0 ? getal(voorspelling.bonus[j]) : null;
    if (bonus === null) return null;
    eur += (-w / 1000) * (dag.stapMs / 3_600_000) * Math.max(0, bonus);
  }
  return eur;
}

/**
 * Vandaag vers uit de stand (die is hooguit 5 seconden oud) in plaats van de
 * rij van de server (hooguit een kwartier): dan zeggen Week en Vandaag
 * hetzelfde. Een stand van een andere dag telt niet; een stand zonder datum
 * (het voorbeeld) hoort bij vandaag.
 */
export function metVandaag(dagen, stand, vandaag) {
  const vanVandaag = (datum) => datum === vandaag || datum == null;
  const v = stand?.vandaag && vanVandaag(stand.vandaag.datum) ? stand.vandaag : null;
  const d = stand?.dag && vanVandaag(stand.dag.datum) ? stand.dag : null;
  const metMeters = stand?.meterkast?.meters?.some((m) => m.vandaag !== null && m.vandaag !== undefined);
  if (!v && !d && !metMeters) return dagen;
  const oud = dagen.find((x) => x.datum === vandaag) ?? legeDag(vandaag);
  const overzicht = d ? dagOverzicht(d) : null;
  const bonus = d ? zonnebonusVan(d, stand?.voorspelling ?? null) : null;
  // Gas, water en warmte (1.4.0): het verst van de meterkast (elke meting), anders van de dag (elke minuut).
  const meters = {};
  for (const [veld, soort, uitDag] of [
    ['gas', 'gas', 'gasM3'],
    ['water', 'water', 'waterM3'],
    ['warmte', 'warmte', 'warmteGj'],
  ]) {
    const vers = vanVandaag(stand?.dag?.datum ?? null) ? (vandaagVan(stand?.meterkast, soort) ?? d?.[uitDag] ?? null) : null;
    if (vers !== null) meters[veld] = vers;
  }
  const nieuw = {
    ...oud,
    ...(v ? { afname: v.afname_kwh, terug: v.teruglevering_kwh, kosten: v.kosten_eur, opbrengst: v.opbrengst_eur, vast: v.vaste_kosten_eur, compleet: v.compleet } : {}),
    ...(d
      ? {
          zon: d.kwh.zon,
          huis: d.kwh.huis,
          geladen: d.kwh.geladen,
          ontladen: d.kwh.ontladen,
          eigenVerbruik: overzicht.eigenVerbruik,
          zelfvoorzienend: overzicht.zelfvoorzienend,
          fasen: (d.fasen ?? []).filter((f) => getal(f.gemiddeldA) !== null).map((f) => ({ fase: f.fase, gemiddeldA: f.gemiddeldA, piekA: f.piekA })),
          kwartieren: d.metingen.filter((n) => n > 0).length,
          // Per apparaat vers uit de stand (brug 0.12.0); zonder (een oudere brug) blijft wat de server had.
          ...(d.apparaten ? { apparaten: d.apparaten, basis: d.basisKwh ?? null } : {}),
        }
      : {}),
    ...(bonus === null ? {} : { bonus }),
    ...meters,
  };
  return [...dagen.filter((x) => x.datum !== vandaag), nieuw].sort((a, b) => (a.datum < b.datum ? -1 : 1));
}

const metWaarde = (dagen, veld) => dagen.filter((d) => d[veld] !== null && d[veld] !== undefined);
const somVan = (dagen, veld) => {
  const met = metWaarde(dagen, veld);
  return met.length ? met.reduce((t, d) => t + d[veld], 0) : null;
};
/** Een gewogen gemiddelde van een deel (eigen verbruik naar de zon, zelfvoorzienend naar het huis). */
const gewogen = (dagen, veld, gewicht) => {
  const met = dagen.filter((d) => d[veld] !== null && d[gewicht] > 0);
  const totaal = met.reduce((t, d) => t + d[gewicht], 0);
  return totaal > 0 ? met.reduce((t, d) => t + d[veld] * d[gewicht], 0) / totaal : null;
};

/** Per fase het gemiddelde van de daggemiddelden en de hoogste piek. */
function fasenVan(dagen) {
  const som = new Map();
  for (const dag of dagen) {
    for (const f of dag.fasen ?? []) {
      const s = som.get(f.fase) ?? { som: 0, n: 0, piek: null };
      som.set(f.fase, { som: s.som + f.gemiddeldA, n: s.n + 1, piek: f.piekA === null ? s.piek : Math.max(s.piek ?? 0, f.piekA) });
    }
  }
  return [...som].map(([fase, s]) => ({ fase, gemiddeldA: s.som / s.n, piekA: s.piek, dagen: s.n })).sort((a, b) => a.fase - b.fase);
}

/**
 * Wat de dagen samen zijn. Een getal dat geen enkele dag had, is null (dan
 * tonen we het niet); netto = betaald − verdiend + vaste kosten.
 */
export function totalenVan(dagen) {
  const kosten = somVan(dagen, 'kosten');
  const opbrengst = somVan(dagen, 'opbrengst');
  const vast = somVan(dagen, 'vast');
  const afname = somVan(dagen, 'afname');
  const terug = somVan(dagen, 'terug');
  const metGeld = metWaarde(dagen, 'kosten');
  return {
    dagen: dagen.length,
    eerste: dagen[0]?.datum ?? null,
    zon: somVan(dagen, 'zon'),
    huis: somVan(dagen, 'huis'),
    geladen: somVan(dagen, 'geladen'),
    ontladen: somVan(dagen, 'ontladen'),
    afname,
    terug,
    kosten,
    opbrengst,
    vast,
    bonus: somVan(dagen, 'bonus'),
    netto: kosten === null && opbrengst === null ? null : (kosten ?? 0) - (opbrengst ?? 0) + (vast ?? 0),
    afnamePrijs: afname !== null && afname >= 0.05 && kosten !== null ? kosten / afname : null,
    terugPrijs: terug !== null && terug >= 0.05 && opbrengst !== null ? opbrengst / terug : null,
    eigenVerbruik: gewogen(dagen, 'eigenVerbruik', 'zon'),
    zelfvoorzienend: gewogen(dagen, 'zelfvoorzienend', 'huis'),
    compleet: metGeld.every((d) => d.compleet),
    // Dagen met geld maar zonder vaste kosten: dan is het netto zonder die dagen gerekend.
    zonderVast: metGeld.filter((d) => d.vast === null).length,
    fasen: fasenVan(dagen),
    gas: somVan(dagen, 'gas'),
    water: somVan(dagen, 'water'),
    warmte: somVan(dagen, 'warmte'),
  };
}

/**
 * Per staaf de som van de dagen erin, voor de grafieken; null als er in die
 * staaf geen enkele dag is (een dag die nog moet komen, of van voor de
 * geschiedenis). Fasen: het gemiddelde van de daggemiddelden.
 */
export function reeksenVoor(staven, dagen) {
  const per = staven.map((s) => dagen.filter((d) => d.datum >= s.van && d.datum <= s.tot));
  const reeks = (veld) => per.map((groep) => somVan(groep, veld));
  const netto = per.map((groep) => (metWaarde(groep, 'kosten').length ? totalenVan(groep).netto : null));
  const fasen = [1, 2, 3]
    .map((fase) => ({
      fase,
      reeks: per.map((groep) => {
        const lijst = groep.flatMap((d) => d.fasen.filter((f) => f.fase === fase));
        return lijst.length ? lijst.reduce((t, f) => t + f.gemiddeldA, 0) / lijst.length : null;
      }),
    }))
    .filter((f) => f.reeks.some((v) => v !== null));
  return {
    dagen: per.map((groep) => groep.length),
    zon: reeks('zon'),
    huis: reeks('huis'),
    geladen: reeks('geladen'),
    ontladen: reeks('ontladen'),
    afname: reeks('afname'),
    terug: reeks('terug'),
    kosten: reeks('kosten'),
    opbrengst: reeks('opbrengst'),
    netto,
    fasen,
    gas: reeks('gas'),
    water: reeks('water'),
  };
}
