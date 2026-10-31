/**
 * Getallen en zinnetjes zoals je ze hardop zou zeggen.
 *
 * Vermogens tonen we altijd zonder min-teken: de richting staat in de lijn op
 * de foto en in de zin eronder ("je levert terug"), niet in een teken dat je
 * moet leren lezen.
 *
 * De grenzen voor "niets" zijn die van Nu in woorden (nuInWoorden.js): onder
 * 5 W geen stroom, onder 20 W geen zon, en binnen ±20 W niets naar of uit het net.
 */
import { NIETS_W, STROOM_W } from './nuInWoorden';

const eenDecimaal = new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Vaste spatie: getal en eenheid blijven op één regel. */
const SP = '\u00a0';

/** 85 → "85 W", 1234 → "1,2 kW", 12500 → "13 kW". */
export function vermogen(w) {
  if (w == null || !Number.isFinite(w)) return '–';
  const watt = Math.round(Math.abs(w));
  if (watt < 1000) return `${watt}${SP}W`;
  if (watt < 9950) return `${eenDecimaal.format(watt / 1000)}${SP}kW`;
  return `${Math.round(watt / 1000)}${SP}kW`;
}

const heel = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0, useGrouping: 'always' });

/** 1830.4 → "1.830 kWh". */
export function kwh(waarde) {
  if (waarde == null || !Number.isFinite(waarde)) return '–';
  return `${heel.format(Math.round(waarde))}${SP}kWh`;
}

const euroNotatie = (decimalen) =>
  new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', minimumFractionDigits: decimalen, maximumFractionDigits: decimalen });
const euro2 = euroNotatie(2);
const euro3 = euroNotatie(3);

/** 3.4912 → "€ 3,49". Zonder min-teken: of het betalen of verdienen is, zegt de zin erbij. */
export function euro(bedrag) {
  if (bedrag == null || !Number.isFinite(bedrag)) return '–';
  return euro2.format(Math.abs(bedrag)).replace(/\s/, SP);
}

/**
 * De regels van een Geld-blok: [label, bedrag], waarbij het label zegt of je
 * betaalde of geld kreeg. euro() laat het teken weg, dus het label moet het
 * zeggen: bij negatieve prijzen kan afnemen geld opleveren (Gekregen) en
 * terugleveren geld kosten (Bijbetaald). Zo tellen de regels op tot netto.
 * Korte labels: op 320 px staan ze met drie naast elkaar.
 */
export function geldRegels({ kosten, opbrengst, vast = null }) {
  const netto = (kosten ?? 0) - (opbrengst ?? 0) + (vast ?? 0);
  return [
    [kosten < 0 ? 'Gekregen' : 'Betaald', kosten],
    [opbrengst < 0 ? 'Bijbetaald' : 'Verdiend', opbrengst],
    ...(vast === null ? [] : [[vast >= 0 ? 'Vaste kosten' : 'Vaste korting', vast]]),
    [netto >= 0 ? 'Netto kosten' : 'Netto winst', netto],
  ];
}

/** Een prijs per kWh op drie decimalen, mét teken (een prijs kan onder nul zakken): "€ 0,284" of "€ −0,012" (een echt minteken, zoals bij de fasen). */
export function prijsPerKwh(prijs) {
  if (prijs == null || !Number.isFinite(prijs)) return '–';
  return euro3.format(prijs).replace(/\s/, SP).replace('-', '\u2212');
}

/**
 * Een getal op de as van een grafiek, altijd met zijn eenheid en een echt
 * minteken (weergave-20): "2,5 kWh", "−1 kWh", "10 A".
 */
export function asGetal(waarde, eenheid, decimalen = 1) {
  if (waarde == null || !Number.isFinite(waarde)) return '';
  return `${waarde.toLocaleString('nl-NL', { maximumFractionDigits: decimalen })}${SP}${eenheid}`.replace('-', '\u2212');
}

/** Een bedrag op de as: "€ 0,25", "€ −1" (zoals prijsPerKwh, met teken). `decimalen` vast, of null: een heel bedrag zonder, anders twee. */
export function asEuro(waarde, decimalen = null) {
  if (waarde == null || !Number.isFinite(waarde)) return '';
  const notatie = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', minimumFractionDigits: decimalen ?? (Number.isInteger(waarde) ? 0 : 2), maximumFractionDigits: decimalen ?? 2 });
  return notatie.format(waarde).replace(/\s/, SP).replace('-', '\u2212');
}

/**
 * Wat het net je nu kost of oplevert, in euro per uur. Plus = je betaalt,
 * min = je verdient. Bij afnemen geldt de afnameprijs, bij terugleveren de
 * terugleverprijs; allebei kunnen ze onder nul zakken.
 */
export function euroPerUur(net_w, prijs) {
  if (net_w == null || !Number.isFinite(net_w) || !prijs) return null;
  const kw = Math.abs(net_w) / 1000;
  return net_w >= 0 ? kw * prijs.afname_kwh : -kw * prijs.teruglevering_kwh;
}

/**
 * `prijs` en `net` (de meting) maken het verschil als er geen bedrag is: geen
 * prijs, of wel een prijs maar geen antwoord van de meter in de meterkast.
 */
export function zinGeld(perUur, { prijs, net } = {}) {
  if (perUur == null && prijs && net == null) return 'De meter in de meterkast antwoordt niet (zie Apparaten)';
  if (perUur == null) return 'Nog geen stroomprijs bekend';
  if (Math.abs(perUur) < 0.005) return 'Je betaalt en verdient nu bijna niets';
  return perUur > 0 ? `Je betaalt nu ${euro(perUur)} per uur` : `Je verdient nu ${euro(perUur)} per uur`;
}

export function procent(p) {
  if (p == null || !Number.isFinite(p)) return '–';
  return `${Math.round(Math.min(100, Math.max(0, p)))}%`;
}

export function zinZon(zon_w) {
  if (zon_w == null) return 'Geen panelen gekoppeld';
  if (zon_w < STROOM_W) return 'De panelen leveren nu niets';
  if (zon_w < NIETS_W) return 'De panelen leveren nu bijna niets';
  return `De panelen leveren ${vermogen(zon_w)}`;
}

export function zinNet(net_w) {
  if (net_w == null) return 'Geen meter gekoppeld';
  if (Math.abs(net_w) < NIETS_W) return 'Er gaat bijna niets naar of uit het net';
  if (net_w > 0) return `Je neemt ${vermogen(net_w)} af van het net`;
  return `Je levert ${vermogen(net_w)} terug aan het net`;
}

export function zinBatterij(batterij_w) {
  if (batterij_w == null) return 'Geen batterij gekoppeld';
  if (Math.abs(batterij_w) < STROOM_W) return 'De batterij laadt niet en levert niets';
  if (batterij_w < 0) return `De batterij laadt met ${vermogen(batterij_w)}`;
  return `De batterij levert ${vermogen(batterij_w)}`;
}

/** Zonder de netmeter is het huisverbruik niet te weten: er kan ook stroom van of naar het net gaan. */
export const HUIS_ONBEKEND = 'Zonder de meter in de meterkast weet ik niet wat het huis gebruikt';

/** Is er een meting, maar zonder net? Dan zetten we het huis op "–". */
export const huisOnbekend = (stand) => Boolean(stand) && stand.net_w == null;

export function zinHuis(huis_w) {
  return `Je huis gebruikt nu ${vermogen(huis_w)}`;
}

/** Welke kant het op gaat bij de meterkast: "afnemen", "terugleveren", of niets binnen ±20 W. */
export function richting(net_w) {
  if (net_w == null || !Number.isFinite(net_w) || Math.abs(net_w) < NIETS_W) return '';
  return net_w > 0 ? 'afnemen' : 'terugleveren';
}

/**
 * Twee P1-meters op dezelfde meterkast horen hetzelfde te meten. Een klein
 * verschil is gewoon: ze meten niet op precies hetzelfde moment.
 */
export function zinVergelijk(a, b) {
  if (a == null || b == null) return '';
  const verschil = Math.abs(a - b);
  if (verschil < STROOM_W) return 'Ze meten hetzelfde.';
  if (verschil <= Math.max(50, 0.05 * Math.max(Math.abs(a), Math.abs(b)))) return `Ze meten bijna hetzelfde: ${vermogen(verschil)} verschil.`;
  return `Ze verschillen ${vermogen(verschil)}. Even kan dat, want ze meten niet op precies hetzelfde moment. Blijft het zo, dan klopt er iets niet.`;
}

/** Hoe lang geleden, in gewone woorden. */
export function geleden(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const s = Math.round(ms / 1000);
  if (s < 15) return 'zojuist';
  // In stappen van 10 s: een teller die elke seconde verspringt, leest niemand.
  if (s < 60) return `${Math.max(20, Math.round(s / 10) * 10)}${SP}s geleden`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min}${SP}min geleden`;
  const uur = Math.round(min / 60);
  return uur === 1 ? '1 uur geleden' : `${uur} uur geleden`;
}

const kloktijd = new Intl.DateTimeFormat('nl-NL', { hour: '2-digit', minute: '2-digit' });

export function tijd(datum) {
  const d = datum instanceof Date ? datum : new Date(datum);
  return Number.isNaN(d.getTime()) ? '' : kloktijd.format(d);
}

/**
 * Wanneer iets begon, met de dag erbij als het niet vandaag was: "08:12",
 * "gisteren 08:12" of "28-10 08:12". "Sinds 08:12" kan anders ook eergisteren zijn.
 */
export function sindsWanneer(datum, nu) {
  const d = datum instanceof Date ? datum : new Date(datum);
  if (Number.isNaN(d.getTime())) return '';
  const n = new Date(nu);
  const begin = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dagen = Math.round((begin(n) - begin(d)) / 86_400_000);
  if (dagen === 0) return tijd(d);
  if (dagen === 1) return `gisteren ${tijd(d)}`;
  const twee = (v) => String(v).padStart(2, '0');
  return `${twee(d.getDate())}-${twee(d.getMonth() + 1)} ${tijd(d)}`;
}

/**
 * De naam van een plek met panelen zonder het woord "Zon" ervoor, voor in een
 * lijstje onder "Zon": "Zon dierenverblijf" → "Dierenverblijf". Alleen als er
 * een woord volgt: "zon + batterij" (zo heet de meter in huis A) blijft heel. Met een
 * hoofdletter, zoals in Nu in woorden ("Hoofddak 701 W + Dierenverblijf 433 W").
 */
export function plekNaam(naam) {
  const kort = String(naam ?? '').replace(/^Zon\s+(?=\p{L})/iu, '').trim() || 'Zon';
  return kort[0].toLocaleUpperCase('nl-NL') + kort.slice(1);
}

/** "0.13.0+f694722" → "0.13.0": alleen het versienummer, zonder het commit-stukje. */
export function versieKort(versie) {
  return String(versie ?? '').split('+')[0].trim();
}

const kwhNotatie = new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: 'always' });

/** 4.236 → "4,2 kWh": de energie van één dag. */
export function kwhDag(waarde) {
  if (waarde == null || !Number.isFinite(waarde)) return '–';
  return `${kwhNotatie.format(Math.abs(waarde))}${SP}kWh`;
}

/** 0.624 → "62%". */
export function deel(fractie) {
  if (fractie == null || !Number.isFinite(fractie)) return '–';
  return `${Math.round(Math.min(1, Math.max(0, fractie)) * 100)}%`;
}

/** Van en tot als kloktijden: "13:00–15:00". */
export function vanTot(van, tot) {
  return `${tijd(van)}–${tijd(tot)}`;
}
