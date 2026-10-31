import { tijd } from './opmaak';

/**
 * De spanningswacht (programmaatje 1.5.0, brug/spanning.mjs), aan de kant van de site: de
 * netspanning per fase, waar hij vandaan komt, de hoogste van vandaag, hoe vaak het boven
 * 250 V kwam en hoe vaak de omvormer uitviel bij een hoge spanning (met de lijst voor de
 * netbeheerder). Een omvormer valt uit boven 253 V (10 minuten gemiddeld).
 *
 * Sleutels: L1, L2, L3, en 'zon' (de fase van een eenfase kWh-meter op de zonnepanelen; welke
 * fase dat is, weet het programmaatje niet: de eigenaar kan het kiezen bij Namen, zon_fase).
 * Is de zonmeter driefase (in huis B, programmaatje 1.6.0: net als die van de spa), dan komen
 * L1–L3 van de zonmeter, is er geen 'zon' en geen keuze bij Namen, en vergelijkt het
 * programmaatje per fase met de andere meter (verschil, verschil_met).
 */

/** Vanaf deze spanning in de let-op-kleur. */
export const LET_OP_V = 250;
/** Hier valt een omvormer uit (10 minuten gemiddeld). */
export const GRENS_V = 253;

const ISO = /^\d{4}-\d{2}-\d{2}T[0-9:.+\-Z]{5,30}$/;
const SLEUTEL = /^(L[123]|zon)$/;
const getal = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const ms = (t) => (typeof t === 'string' && ISO.test(t) ? Date.parse(t) : null);
const teller = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);

/** Het blok spanning uit de rij (Meting.spanning), mild; een oudere brug: null. */
export function spanningUit(s) {
  if (!s || typeof s !== 'object' || typeof s.datum !== 'string') return null;
  const lijst = (l, maak) => (Array.isArray(l) ? l.filter((x) => x && SLEUTEL.test(x.sleutel ?? '')).map(maak) : []);
  return {
    datum: s.datum,
    herkomst: lijst(s.herkomst, (x) => ({ sleutel: x.sleutel, bron: typeof x.bron === 'string' ? x.bron : null, naam: typeof x.naam === 'string' && x.naam ? x.naam : null })),
    nu: lijst(s.nu, (x) => ({ sleutel: x.sleutel, v: getal(x.v), gem10: getal(x.gem10) })).filter((x) => x.v !== null),
    hoogste: lijst(s.hoogste, (x) => ({ sleutel: x.sleutel, v: getal(x.v), op: ms(x.op) })).filter((x) => x.v !== null),
    verschil: lijst(s.verschil, (x) => ({ sleutel: x.sleutel, v: getal(x.v), op: ms(x.op) })).filter((x) => x.v !== null),
    verschilMet: typeof s.verschil_met === 'string' && s.verschil_met ? s.verschil_met : null,
    uitvalVandaag: teller(s.uitval_vandaag),
    boven250: teller(s.boven_250_vandaag),
    boven250Uitgevallen: teller(s.boven_250_uitgevallen),
    maand: typeof s.maand === 'string' ? s.maand : null,
    uitvalMaand: teller(s.uitval_maand),
    lijst: lijst(s.lijst, (x) => ({ op: ms(x.op), sleutel: x.sleutel, v: getal(x.v), gem: getal(x.gem), omvormer: x.omvormer === true })).filter((x) => x.op !== null && x.v !== null),
  };
}

/** "250 V" (hele volt; de spanning schommelt, tienden zeggen niets). */
export const voltTekst = (v) => `${Math.round(v)}\u00a0V`;

/** Hoe een meter heet in een zin: "de spa-meter", "de meter Zonnepanelen op het dak". */
function meterNaam(naam) {
  const n = naam.trim();
  if (/meter/i.test(n)) return `de ${n.charAt(0).toLowerCase()}${n.slice(1)}`;
  if (/^[\p{L}-]{1,20}$/u.test(n)) return `de ${n.toLowerCase()}-meter`;
  return `de meter "${n}"`;
}

/** Waar een spanning vandaan komt, in gewone woorden: "gemeten door de spa-meter". */
export function bronTekst(h) {
  if (!h) return null;
  if (h.bron === 'omvormer') return 'gemeten door de omvormer';
  if (h.bron === 'p1') return 'gemeten door de slimme meter';
  if (h.naam) return `gemeten door ${meterNaam(h.naam)}`;
  return h.bron === 'zon' ? 'gemeten door de kWh-meter op de zonnepanelen' : 'gemeten door een kWh-meter';
}

/** Hoe een sleutel heet: "L2", of "de fase van de zonnepanelen" (met de fase erbij als de eigenaar hem koos). */
export const sleutelNaam = (sleutel, zonFase = null) => (sleutel === 'zon' ? `zonnepanelen${zonFase ? ` (L${zonFase})` : ''}` : sleutel);

/** "Hoogste spanning vandaag: L1 247 V · L2 254 V · L3 249 V", met per stuk of het boven LET_OP_V was. */
export function hoogsteDelen(s, zonFase = null) {
  return (s?.hoogste ?? []).map((h) => ({ sleutel: h.sleutel, tekst: `${sleutelNaam(h.sleutel, zonFase)} ${voltTekst(h.v)}`, letOp: h.v >= LET_OP_V, op: h.op }));
}

/** "Vandaag 3 keer boven 250 V, niet uitgevallen." of null als het vandaag niet gebeurde. */
export function dichtbijZin(s) {
  if (!s) return null;
  if (!s.boven250 && !s.uitvalVandaag) return `Vandaag niet boven ${LET_OP_V}\u00a0V.`;
  const keer = (n) => (n === 1 ? '1 keer' : `${n} keer`);
  const uit = s.boven250Uitgevallen ? `waarvan ${keer(s.boven250Uitgevallen)} uitgevallen` : 'niet uitgevallen';
  const zin = s.boven250 ? `Vandaag ${keer(s.boven250)} boven ${LET_OP_V}\u00a0V, ${uit}.` : '';
  const extra = s.uitvalVandaag > s.boven250Uitgevallen ? ` De omvormer viel vandaag ${keer(s.uitvalVandaag)} uit bij een hoge spanning.` : '';
  return `${zin}${extra}`.trim();
}

/**
 * Is de zonmeter eenfase (dan meet hij één fase, 'zon', en kan de eigenaar bij Namen kiezen welke)?
 * Een driefase zonmeter geeft L1–L3 (alleen voltage_v/active_voltage_v = eenfase; dat weet het
 * programmaatje, en dan stuurt het 'zon').
 */
export const zonmeterEenfase = (s) => Boolean(s?.herkomst?.some((h) => h.sleutel === 'zon'));

/**
 * Het verschil tussen de zonnemeter en de andere meter:
 *   eenfase zonmeter, met de fase gekozen bij Namen: "Zonnemeter 251 V, spa-meter 248 V op L1: 3 V
 *     verschil." Zonder keuze: null (niet raden).
 *   driefase zonmeter (1.6.0): per fase het grootste verschil van vandaag: "Verschil zonnemeter en
 *     spa-meter per fase, vandaag het grootst: L1 6 V · L2 2 V · L3 1 V."
 */
export function verschilZin(s, zonFase) {
  if (!s) return null;
  if (!zonmeterEenfase(s)) {
    const vanZon = s.herkomst.some((h) => /^L[123]$/.test(h.sleutel) && h.bron === 'zon');
    if (!vanZon || !s.verschil.length) return null;
    const met = s.verschilMet ? meterNaam(s.verschilMet).replace(/^de /, '') : 'andere meter';
    return `Verschil zonnemeter en ${met} per fase, vandaag het grootst: ${s.verschil.map((x) => `${x.sleutel} ${Math.abs(Math.round(x.v))}\u00a0V`).join(' · ')}. Een paar volt zegt iets over de kabel tussen de omvormer en de meterkast.`;
  }
  if (!zonFase) return null;
  const zon = s.nu.find((x) => x.sleutel === 'zon');
  const fase = s.nu.find((x) => x.sleutel === `L${zonFase}`);
  const h = s.herkomst.find((x) => x.sleutel === `L${zonFase}`);
  if (!zon || !fase || !h || h.bron === 'zon') return null;
  const grootste = s.verschil.find((x) => x.sleutel === `L${zonFase}`);
  const bij = h.naam ? meterNaam(h.naam).replace(/^de /, '') : h.bron === 'p1' ? 'slimme meter' : 'meter';
  const nu = Math.round(zon.v - fase.v);
  return `Zonnemeter ${voltTekst(zon.v)}, ${bij} ${voltTekst(fase.v)} op L${zonFase}: ${Math.abs(nu)}\u00a0V verschil${grootste ? `; vandaag hooguit ${Math.abs(Math.round(grootste.v))}\u00a0V` : ''}. Een paar volt zegt iets over de kabel tussen de omvormer en de meterkast.`;
}

/** Eén regel van de lijst voor de netbeheerder: "31-07-2026 13:42 · zonnepanelen 254 V (10 min gemiddeld 252 V)". */
export function lijstRegel(x, zonFase = null) {
  const d = new Intl.DateTimeFormat('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(x.op));
  return `${d} ${tijd(x.op)} · ${sleutelNaam(x.sleutel, zonFase)} ${voltTekst(x.v)}${x.gem !== null ? ` (10 min gemiddeld ${voltTekst(x.gem)})` : ''}${x.omvormer ? ' · de omvormer meldde zelf een netspanningsfout' : ''}`;
}

/** De spanning van een fase voor Belasting per fase: { v, bron } uit het blok, als de P1 hem niet geeft. */
export function faseSpanning(s, fase) {
  const nu = s?.nu?.find((x) => x.sleutel === `L${fase}`);
  return nu ? { v: nu.v, herkomst: s.herkomst.find((x) => x.sleutel === `L${fase}`) ?? null } : null;
}
