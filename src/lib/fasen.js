/**
 * De belasting per fase (L1, L2, L3) in gewone woorden: welke fase nu het
 * zwaarst is, en welke gemiddeld het hoogst en het laagst zit, vandaag en over
 * de afgelopen dagen. Een huis met één fase heeft daar niets aan: dan geen zin.
 */

import { NIETS_W, opsomming } from './nuInWoorden';
import { vermogen } from './opmaak';

export const FASE_KLEUR = { 1: 'var(--fase-1)', 2: 'var(--fase-2)', 3: 'var(--fase-3)' };

/** De fase met de meeste stroom nu, of null (één fase, of geen stroom). */
export function zwaarsteFase(fasen) {
  const met = (fasen ?? []).filter((f) => f.a !== null && f.a !== undefined);
  if (met.length < 2) return null;
  const zwaarst = met.reduce((b, f) => (f.a > b.a ? f : b));
  return zwaarst.a > 0.05 ? zwaarst.fase : null;
}

/**
 * "L2 zit gemiddeld het hoogst, L3 het laagst." uit [{ fase, gemiddeldA }].
 * Liggen ze binnen een tiende ampère van elkaar, dan zijn ze gelijk belast.
 */
export function hoogLaagZin(gemiddelden) {
  const lijst = (gemiddelden ?? []).filter((f) => Number.isFinite(f?.gemiddeldA));
  if (lijst.length < 2) return '';
  const gesorteerd = [...lijst].sort((a, b) => b.gemiddeldA - a.gemiddeldA);
  const hoog = gesorteerd[0];
  const laag = gesorteerd.at(-1);
  if (hoog.gemiddeldA - laag.gemiddeldA < 0.1) return 'De fasen zijn gemiddeld even zwaar belast.';
  return `L${hoog.fase} zit gemiddeld het hoogst, L${laag.fase} het laagst.`;
}

/** Het gemiddelde per fase over de dagen van de week (zonder vandaag). */
export function weekGemiddelden(week) {
  const som = new Map();
  for (const dag of week ?? []) {
    for (const f of dag.fasen ?? []) {
      const s = som.get(f.fase) ?? { som: 0, n: 0, piek: 0 };
      som.set(f.fase, { som: s.som + f.gemiddeldA, n: s.n + 1, piek: Math.max(s.piek, f.piekA ?? 0) });
    }
  }
  return [...som].map(([fase, s]) => ({ fase, gemiddeldA: s.som / s.n, piekA: s.piek, dagen: s.n })).sort((a, b) => a.fase - b.fase);
}

/**
 * Het vermogen op één fase, hier wél met teken, voor in de grafiek van de dag
 * (daar staat geen woord bij). Op Nu staat het zonder teken, met
 * faseRichting erachter ("312 W naar het net"): een teken én woorden is
 * dubbel. −1700 → "−1,7 kW", 412 → "+412 W".
 */
export function faseVermogen(w) {
  if (w == null || !Number.isFinite(w)) return '';
  const r = Math.round(w);
  if (r === 0) return '0\u00a0W';
  return `${r < 0 ? '\u2212' : '+'}${vermogen(r)}`;
}

/** "naar het net" (terugleveren), "uit het net" (afnemen), of niets bij 0 W. */
export function faseRichting(w) {
  const r = Number.isFinite(w) ? Math.round(w) : 0;
  if (r === 0) return '';
  return r < 0 ? 'naar het net' : 'uit het net';
}

/**
 * Lopen de fasen verschillende kanten op, dan zegt één zin dat de meter ze bij
 * elkaar optelt (zoals "-312 W naar het net" naast "+439 W uit het net"):
 * "Op L2 haal je 439 W uit het net, op L1 en L3 lever je terug. De meter telt
 * de drie fasen bij elkaar op: per saldo lever je 49 W terug." Per saldo is
 * wat de meter zelf als totaal geeft (net_w, zoals op de tegel Net), anders
 * de som van de fasen. Gaan ze allemaal dezelfde kant op: geen zin.
 */
export function saldoZin(fasen, net_w) {
  const met = (fasen ?? []).filter((f) => Number.isFinite(f?.w) && Math.round(f.w) !== 0);
  const uit = met.filter((f) => f.w > 0);
  const terug = met.filter((f) => f.w < 0);
  if (uit.length === 0 || terug.length === 0) return '';
  const namen = (lijst) => opsomming(lijst.map((f) => `L${f.fase}`));
  const eerst =
    uit.length === 1 || terug.length > 1
      ? `Op ${namen(uit)} haal je ${uit.length === 1 ? `${vermogen(uit[0].w)} ` : ''}uit het net, op ${namen(terug)} lever je terug.`
      : `Op ${namen(terug)} lever je ${vermogen(terug[0].w)} terug, op ${namen(uit)} haal je uit het net.`;
  const saldo = Number.isFinite(net_w) ? net_w : met.reduce((som, f) => som + f.w, 0);
  const welke = { 2: 'de twee fasen', 3: 'de drie fasen' }[fasen.length] ?? 'de fasen';
  let perSaldo = `per saldo haal je ${vermogen(saldo)} uit het net`;
  if (Math.abs(saldo) < NIETS_W) perSaldo = 'per saldo gaat er bijna niets naar of uit het net';
  else if (saldo < 0) perSaldo = `per saldo lever je ${vermogen(saldo)} terug`;
  return `${eerst} De meter telt ${welke} bij elkaar op: ${perSaldo}.`;
}

/**
 * Zonder eigen grens zegt de app rustig dat een fase zwaar belast is vanaf dit
 * deel van de zekering (Nu en Nu in woorden): bij 25 A dus 20 A, bij 35 A 28 A,
 * bij 16 A 12,8 A (R19-RK-11). Wie er zo zit, weet het meestal en doet het bewust: alleen tonen,
 * geen alarm. Per huis in te stellen (Instellingen › Namen, Opstelling.fase_grens_a).
 */
export const FASE_GRENS_DEEL = 0.8;
/** De grens bij de gewone zekering (0,8 × 25 A). */
export const FASE_GRENS_A = 20;
/** De gewone hoofdzekering per fase; per huis in te stellen (Opstelling.zekering_a). */
export const ZEKERING_A = 25;

/** De grens die bij een zekering hoort: 80% ervan, op een tiende. */
export const grensBij = (zekering) => Math.round(FASE_GRENS_DEEL * zekering * 10) / 10;

/**
 * De grens en de zekering van dit huis: wat de eigenaar invulde, anders de
 * standaard. Zonder eigen grens volgt de grens de zekering (80% ervan).
 * `eigen`: of de grens zelf ingevuld is.
 */
export function faseGrenzen(opstelling) {
  const goed = (a) => (typeof a === 'number' && Number.isFinite(a) && a > 0 ? a : null);
  const zekering = goed(opstelling?.zekering) ?? ZEKERING_A;
  const eigen = goed(opstelling?.faseGrens);
  return { grens: eigen ?? grensBij(zekering), zekering, eigen: eigen !== null };
}

/** Of deze stroom boven de grens zit (niet op een tiende na: 20,0 A bij een grens van 20 A telt). */
export const zwaar = (a, grenzen = faseGrenzen()) => Number.isFinite(a) && Math.round(a * 10) / 10 >= grenzen.grens;

/**
 * De zin bij een zware fase, of '': de zwaarste fase boven de grens, met de
 * zekering erbij. "L2 trekt nu 23,7 A, dicht bij de 25 A van de zekering."
 * Rustig, ook erboven: "L2 trekt nu 26,1 A, meer dan de 25 A van de zekering."
 * "Dicht bij" alleen binnen 20% van de zekering; een lagere eigen grens:
 * "L1 trekt nu 15,2 A, boven je grens van 15 A."
 */
export function zwareFaseZin(fasen, grenzen = faseGrenzen()) {
  const boven = (fasen ?? []).filter((f) => zwaar(f?.a, grenzen));
  if (!boven.length) return '';
  const f = boven.reduce((b, x) => (x.a > b.a ? x : b));
  const zekering = grensAmpere(grenzen.zekering);
  const ook = boven.length > 1 ? ` (ook ${opsomming(boven.filter((x) => x !== f).map((x) => `L${x.fase}`))} boven ${grensAmpere(grenzen.grens)})` : '';
  const a = Math.round(f.a * 10) / 10;
  const hoe =
    a > grenzen.zekering
      ? `meer dan de ${zekering} van de zekering`
      : a >= grensBij(grenzen.zekering)
        ? `dicht bij de ${zekering} van de zekering`
        : `boven je grens van ${grensAmpere(grenzen.grens)}`;
  return `L${f.fase} trekt nu ${ampere(f.a)}, ${hoe}${ook}.`;
}

/** De schaal van de balken: tot de zekering (standaard 25 A), of verder als een fase daar overheen gaat. */
export function faseSchaal(fasen, zekering = ZEKERING_A) {
  return Math.max(zekering, ...(fasen ?? []).map((f) => (Number.isFinite(f?.a) ? f.a : 0)));
}

const ampNotatie = new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** 7.44 → "7,4 A". */
export function ampere(a) {
  if (a == null || !Number.isFinite(a)) return '–';
  return `${ampNotatie.format(Math.abs(a))}\u00a0A`;
}

/** Een grens of zekering: heel zonder komma (25 → "25 A"), anders op een tiende ("22,5 A"). */
export function grensAmpere(a) {
  return Number.isInteger(a) ? `${a}\u00a0A` : ampere(a);
}

/** 231.27 → "231 V". */
export function volt(v) {
  if (v == null || !Number.isFinite(v)) return '';
  return `${Math.round(v)}\u00a0V`;
}
