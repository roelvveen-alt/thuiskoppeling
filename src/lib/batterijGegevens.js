/**
 * Wat de batterij zelf meldt (Meting.batterij_info, programmaatje 0.5.0 en
 * nieuwer), in gewone woorden: één regel per onderwerp, met wat kleiner een
 * regeltje erbij. Wat er niet is, staat er niet; wat gewoon is (hij verwarmt
 * niet, geen storing), ook niet.
 *
 * Geen grenzen voor de temperatuur: voor de SolarFlow 2400 AC geeft Zendure
 * alleen een bedrijfstemperatuur van de omgeving op (−20 tot 60 °C), geen
 * grenzen voor laden en ontladen of voor de accu's zelf. Wat we niet zeker
 * weten, zeggen we niet. De let-op-kleur komt alleen als de batterij zelf een
 * storing meldt.
 */

import { rendementNu } from './advies';

/** Vaste spatie: getal en eenheid blijven op één regel. */
const SP = '\u00a0';
const MIN = '\u2212';

const notatie = (min, max) => new Intl.NumberFormat('nl-NL', { minimumFractionDigits: min, maximumFractionDigits: max });
const heel = notatie(0, 0);
const eenDecimaal = notatie(1, 1);
const hooguitEen = notatie(0, 1);
const hooguitTwee = notatie(0, 2);
const tweeDecimalen = notatie(2, 2);

/** Met een echt min-teken: "−3". */
const getal = (v, vorm) => vorm.format(v).replace('-', MIN);

/** Op hele graden, zonder "−0". */
const graadGetal = (c) => getal(Math.round(c) === 0 ? 0 : c, heel);

/** 23.6 → "24 °C", −2.6 → "−3 °C". */
export const graden = (c) => `${graadGetal(c)}${SP}°C`;

/**
 * Hoe lang nog: "ongeveer 2 uur 10 min", "ongeveer 5 uur", "ongeveer 45 min",
 * afgerond zoals je het zou zeggen (onder de 10 minuten op de minuut, onder het
 * uur op 5, tot 5 uur op 10 minuten, daarna op hele uren). Vanaf twee dagen:
 * "meer dan twee dagen". Hetzelfde als duurTekst in brug/zendure.mjs.
 */
export function duur(min) {
  if (!(min > 0)) return '';
  if (min >= 48 * 60) return 'meer dan twee dagen';
  if (min < 9.5) return `ongeveer ${Math.max(1, Math.round(min))}${SP}min`;
  if (min < 57.5) return `ongeveer ${Math.round(min / 5) * 5}${SP}min`;
  if (min < 300) {
    const tien = Math.round(min / 10) * 10;
    const rest = tien % 60;
    return rest ? `ongeveer ${Math.floor(tien / 60)}${SP}uur ${rest}${SP}min` : `ongeveer ${tien / 60}${SP}uur`;
  }
  return `ongeveer ${Math.round(min / 60)}${SP}uur`;
}

/** Hoe goed het wifi bij de Zendure is, zoals het meestal wordt ingedeeld: −60 dBm of beter is goed. */
export function wifiKwaliteit(dbm) {
  if (dbm >= -60) return 'goed';
  if (dbm >= -70) return 'redelijk';
  if (dbm >= -80) return 'zwak';
  return 'slecht';
}

/** "0.4.0" ouder dan "0.5.0"? Zonder versie: nee (dan weten we het niet). */
export function ouderDan(versie, dan) {
  const delen = (v) => String(v ?? '').split('.').map((d) => Number.parseInt(d, 10));
  const a = delen(versie);
  const b = delen(dan);
  if (a.some((d) => !Number.isFinite(d))) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const verschil = (a[i] ?? 0) - (b[i] ?? 0);
    if (verschil !== 0) return verschil < 0;
  }
  return false;
}

/** Vanaf deze versie stuurt het programmaatje de batterijgegevens mee. */
export const BRUG_MET_BATTERIJ = '0.5.0';

/**
 * @param {object|null} info  batterij_info zoals batterijInfoUit (bron.js) het teruggeeft
 * @param {{ batterijW?: number|null, verwacht?: { eersteVolTekst: string|null, alVol: boolean, laadtNiet: boolean }|null }} [erbij]
 *   batterijW: stand.batterij_w (laden of leveren nu); verwacht: maakMorgen(...).batterij (src/lib/morgen.js)
 * @returns {Array<{ sleutel: string, tekst: string, bij?: string, letOp?: boolean }>}
 *   sleutel: temperatuur, accu-N (per accu: "Accu 1 · 24 °C · 41%", met de cellen eronder), cellen,
 *   elektrisch, grenzen, limieten, tijd, verwarmt, kalibreert, wifi, accus, storing
 */
export function batterijRegels(info, { batterijW = null, verwacht = null, procent = null } = {}) {
  if (!info) return [];
  const regels = [];
  const zet = (sleutel, tekst, bij, letOp) => regels.push({ sleutel, tekst, ...(bij ? { bij } : {}), ...(letOp ? { letOp: true } : {}) });

  if (info.storing) {
    const niveau = info.storing_niveau ? `niveau ${info.storing_niveau} · ` : '';
    zet('storing', 'De batterij meldt een storing', `${niveau}kijk in de Zendure-app`, true);
  }

  const binnenin = info.behuizing_c === undefined ? null : `binnenin de Zendure ${graden(info.behuizing_c)}`;
  // Per accu (brug 0.7.0): dan staan de temperaturen daar, en hier alleen binnenin de Zendure.
  const isGetal = (v) => typeof v === 'number' && Number.isFinite(v);
  const accus = (info.accus ?? []).filter((a) => isGetal(a?.temp_c) || isGetal(a?.procent));
  const perAccu = accus.some((a) => isGetal(a.temp_c));
  if (perAccu) {
    if (binnenin) zet('temperatuur', `Binnenin de Zendure ${graden(info.behuizing_c)}`);
  } else if (info.temp_c !== undefined) {
    const koel = info.temp_min_c;
    const verschil = koel !== undefined && Math.round(koel) !== Math.round(info.temp_c);
    const tekst = verschil ? `Temperatuur accu's ${graadGetal(koel)}–${graden(info.temp_c)}` : `Temperatuur ${graden(info.temp_c)}`;
    zet('temperatuur', tekst, binnenin);
  } else if (binnenin) {
    zet('temperatuur', `Binnenin de Zendure ${graden(info.behuizing_c)}`);
  }

  const volt = (v) => `${getal(v, tweeDecimalen)}${SP}V`;
  for (const a of accus) {
    const delen = [`Accu ${a.nr}`];
    if (isGetal(a.temp_c)) delen.push(graden(a.temp_c));
    if (isGetal(a.procent)) delen.push(`${Math.round(a.procent)}%`);
    // Programmaatje 1.4.0: de cellen (laagste en hoogste spanning), gezondheid, laadcycli en verwarmen.
    const bij = [
      isGetal(a.cel_min_v) && isGetal(a.cel_max_v) ? `cellen ${getal(a.cel_min_v, tweeDecimalen)}–${volt(a.cel_max_v)}` : null,
      isGetal(a.gezondheid_pct) ? `gezondheid ${getal(a.gezondheid_pct, hooguitEen)}%` : null,
      isGetal(a.cycli) ? `${getal(a.cycli, heel)} laadcycli` : null,
      a.verwarmt ? 'verwarmt zich nu' : null,
    ].filter(Boolean);
    regels.push({ sleutel: `accu-${a.nr}`, tekst: delen.join(' · '), ...(bij.length ? { bij: bij.join(' · ') } : {}), ...(isGetal(a.procent) ? { procent: a.procent } : {}) });
  }
  // Zonder per accu de cellen: dan samen (de laagste en de hoogste cel).
  if (!accus.some((a) => isGetal(a.cel_min_v)) && isGetal(info.cel_min_v) && isGetal(info.cel_max_v)) {
    zet('cellen', `Cellen ${getal(info.cel_min_v, tweeDecimalen)}–${volt(info.cel_max_v)}`, 'de laagste en de hoogste celspanning');
  }

  const stroom = info.stroom_a > 0 ? `${getal(info.stroom_a, eenDecimaal)}${SP}A` : null;
  if (info.spanning_v !== undefined) zet('elektrisch', `Spanning ${getal(info.spanning_v, eenDecimaal)}${SP}V`, stroom ? `stroom ${stroom}` : null);
  else if (stroom) zet('elektrisch', `Stroom ${stroom}`);

  const grenzen = [];
  if (info.laadgrens_pct !== undefined) grenzen.push(`Laadt tot ${Math.round(info.laadgrens_pct)}%`);
  if (info.ontlaadgrens_pct !== undefined) grenzen.push(`${grenzen.length ? 'ontlaadt' : 'Ontlaadt'} tot ${Math.round(info.ontlaadgrens_pct)}%`);
  if (grenzen.length) zet('grenzen', grenzen.join(' · '));

  // Hoeveel hij hooguit laadt en levert (ingesteld in de Zendure-app, programmaatje 1.4.0).
  const watt = (w) => `${Math.round(w).toLocaleString('nl-NL')}${SP}W`;
  const limieten = [];
  if (isGetal(info.invoer_limiet_w)) limieten.push(`Laadt hooguit ${watt(info.invoer_limiet_w)}`);
  if (isGetal(info.uitvoer_limiet_w)) limieten.push(`${limieten.length ? 'levert' : 'Levert'} hooguit ${watt(info.uitvoer_limiet_w)}`);
  if (limieten.length) zet('limieten', limieten.join(' · '), `ingesteld in de Zendure-app${isGetal(info.omvormer_max_w) ? ` · zijn omvormer kan ${watt(info.omvormer_max_w)}` : ''}`);

  // Hoe lang nog: de verwachting van Voorspelling (dezelfde zon als daar en in Advies, weergave-2), en wat de
  // Zendure zelf zegt altijd met het vermogen erbij (zijn getal geldt alleen bij het laden of leveren van nu).
  const w = typeof batterijW === 'number' && Number.isFinite(batterijW) && Math.abs(batterijW) >= 1 ? `${Math.round(Math.abs(batterijW)).toLocaleString('nl-NL')}${SP}W` : null;
  const zelf =
    info.vol_over_min > 0
      ? w ? `bij ${w} laden: vol over ${duur(info.vol_over_min)}` : `vol over ${duur(info.vol_over_min)}`
      : info.leeg_over_min > 0
        ? w ? `bij ${w} leveren: leeg over ${duur(info.leeg_over_min)}` : `leeg over ${duur(info.leeg_over_min)}`
        : null;
  const eigen = eigenSchatting(info, batterijW, procent);
  if (verwacht?.eersteVolTekst && !verwacht.alVol && !verwacht.laadtNiet) {
    zet('tijd', `Verwacht vol ${verwacht.eersteVolTekst}`, `met de zon van tabblad Weer${zelf ? ` · de Zendure zelf, ${zelf}` : ''}`);
  } else if (eigen) {
    // De Zendure is vaak te positief (hij rekent tot 0% en zonder verlies). Onze eigen schatting
    // telt alleen wat er tot de ingestelde grens zit, met het verlies van nu; die van de Zendure staat eronder.
    const tot = eigen.laden ? `vol (${eigen.grens}%)` : `op ${eigen.grens}%`;
    zet('tijd', `${w ? `Bij ${w} ${eigen.laden ? 'laden' : 'leveren'}: ` : ''}${tot} over ${duur(eigen.min)}`, `${eigen.geleerd ? 'geleerd van jouw batterij, tot je ingestelde grens' : 'eigen schatting, tot je ingestelde grens en met verlies'}${zelf ? ` · de Zendure zegt ${zelf.replace(/^bij [^:]+: /, '')}` : ''}`);
  } else if (zelf) {
    zet('tijd', zelf.replace(/^./, (c) => c.toUpperCase()), 'schatting van de Zendure, bij het vermogen van nu');
  }

  if (info.verwarmt) zet('verwarmt', 'Verwarmt zichzelf nu', "bij kou warmt hij zijn accu's op");
  if (info.kalibreert) zet('kalibreert', 'Kalibreert nu zijn batterijstand', 'hij stelt opnieuw vast hoe vol hij is');

  if (info.wifi_dbm !== undefined) zet('wifi', `Wifi-signaal ${wifiKwaliteit(info.wifi_dbm)} (${getal(Math.round(info.wifi_dbm), heel)}${SP}dBm)`);

  const gezond = info.gezondheid_pct === undefined ? null : `gezondheid ${getal(info.gezondheid_pct, hooguitEen)}%`;
  if (info.pakketten > 0) {
    const aantal = info.pakketten === 1 ? '1 accu' : `${Math.round(info.pakketten)} accu's`;
    const inhoud = info.inhoud_kwh > 0 ? ` · samen ${getal(info.inhoud_kwh, hooguitTwee)}${SP}kWh` : '';
    zet('accus', `${aantal}${inhoud}`, gezond);
  } else if (gezond) {
    zet('accus', gezond.replace(/^g/, 'G'));
  }

  return regels;
}

/**
 * Zoveel accu's staan er los onder elkaar; meer (tot drie SolarFlow 2400 AC's met
 * elk 6, programmaatje 1.4.0) komen samen op één regel, met elke accu apart in
 * een blok dat dicht staat (BatterijGegevens.jsx).
 */
export const ACCUS_LOS = 4;

/**
 * Veel accu's op één regel: "18 accu's: 37–41% · 21–25 °C", met eronder de
 * laagste en hoogste cel en wat er bijzonder is (een die zich verwarmt), en
 * het gemiddelde procent voor het batterij-icoon. Geen accu's: null.
 *
 * @param {Array<{ nr: number, temp_c?: number|null, procent?: number|null, cel_min_v?: number, cel_max_v?: number, verwarmt?: boolean }>} accus
 */
export function accusKort(accus) {
  const isGetal = (v) => typeof v === 'number' && Number.isFinite(v);
  const lijst = (accus ?? []).filter((a) => isGetal(a?.temp_c) || isGetal(a?.procent));
  if (!lijst.length) return null;
  const van = (veld) => lijst.map((a) => a[veld]).filter(isGetal);
  const bereik = (rij, maak) => {
    if (!rij.length) return null;
    const laag = Math.min(...rij);
    const hoog = Math.max(...rij);
    return maak(laag, hoog);
  };
  const procenten = van('procent').map(Math.round);
  const pct = bereik(procenten, (l, h) => (l === h ? `${l}%` : `${l}–${h}%`));
  const temp = bereik(van('temp_c'), (l, h) => (Math.round(l) === Math.round(h) ? graden(h) : `${graadGetal(l)}–${graden(h)}`));
  const cellen = bereik([...van('cel_min_v'), ...van('cel_max_v')], (l, h) => `cellen ${getal(l, tweeDecimalen)}–${getal(h, tweeDecimalen)}${SP}V`);
  const warm = lijst.filter((a) => a.verwarmt).length;
  const bij = [cellen, warm ? `${warm === 1 ? '1 accu verwarmt' : `${warm} accu's verwarmen`} zich nu` : null].filter(Boolean).join(' · ');
  return {
    tekst: `${lijst.length} accu's: ${[pct, temp].filter(Boolean).join(' · ')}`,
    ...(bij ? { bij } : {}),
    ...(procenten.length ? { procent: procenten.reduce((a, b) => a + b, 0) / procenten.length } : {}),
  };
}

/**
 * Hoe lang nog tot de grens (laadgrens bij laden, ontlaadgrens bij leveren), bij het vermogen van nu: alleen
 * wat er tussen de stand en die grens zit, met het verlies van één kant (de wortel van het rendement heen en
 * terug). Zonder stand, inhoud, grens of vermogen: null. Onder 1 minuut of boven 2 dagen: null (dan zegt het
 * niets).
 *
 * Heeft het programmaatje van deze batterij geleerd hoeveel kWh er echt per procent uit (of in) gaat
 * (batterij_info.geleerd, brug 1.4.0, met alle verlies erin), dan rekenen we daarmee: `geleerd: true`.
 * Zonder: de inhoud en het verlies van nu, zoals eerst.
 * @returns {{ min: number, laden: boolean, grens: number, geleerd: boolean } | null}
 */
export function eigenSchatting(info, batterijW, procent) {
  if (!info || typeof procent !== 'number' || !Number.isFinite(procent)) return null;
  if (typeof batterijW !== 'number' || !Number.isFinite(batterijW) || Math.abs(batterijW) < 20) return null;
  const laden = batterijW < 0;
  const perPct = laden ? info.geleerd?.kwh_per_pct_laden : info.geleerd?.kwh_per_pct_leveren;
  const geleerd = typeof perPct === 'number' && Number.isFinite(perPct) && perPct > 0;
  if (!geleerd && !(info.inhoud_kwh > 0)) return null;
  const grens = laden ? (info.laadgrens_pct ?? 100) : (info.ontlaadgrens_pct ?? null);
  if (typeof grens !== 'number') return null;
  const deel = laden ? grens - procent : procent - grens;
  if (!(deel > 0)) return null;
  const kw = Math.abs(batterijW) / 1000;
  let uren;
  if (geleerd) {
    uren = (deel * perPct) / kw;
  } else {
    const eenKant = Math.sqrt(rendementNu(info).rendement);
    const kwh = (deel / 100) * info.inhoud_kwh;
    uren = laden ? kwh / (eenKant * kw) : (kwh * eenKant) / kw;
  }
  const min = Math.round(uren * 60);
  return min >= 1 && min <= 48 * 60 ? { min, laden, grens: Math.round(grens), geleerd } : null;
}

/**
 * Het verwachte rendement nu, heen en terug (laden en weer leveren), met de
 * koudste accu als maat (rendementNu in src/lib/advies.js): "Verwacht
 * rendement nu: 94%" met "laden en weer leveren · koudste accu 27 °C".
 * Zonder temperatuur een vaste schatting, en dat erbij. Zonder gegevens: niets.
 */
export function rendementRegel(info) {
  if (!info) return [];
  const r = rendementNu(info);
  const pct = Math.round(r.rendement * 100);
  if (r.geschat) return [{ sleutel: 'rendement', tekst: `Verwacht rendement ongeveer ${pct}%`, bij: "laden en weer leveren · een vaste schatting: de accu's melden geen temperatuur" }];
  const kou = r.laadtNiet ? ' · onder 0 °C laadt hij niet, hij verwarmt zich eerst' : '';
  return [{ sleutel: 'rendement', tekst: `Verwacht rendement nu: ${pct}%`, bij: `laden en weer leveren · koudste accu ${graden(r.temp)}${kou}` }];
}
