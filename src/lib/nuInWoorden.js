/**
 * Nu in woorden: wat er nú gebeurt, als één doorlopend verhaal dat je kunt
 * narekenen. De wens: "Zeggen laad accu op met zon. Huis 0 of stroom van de
 * batterij als er geen zon is die dingen."
 *
 * De keten gaat altijd in dezelfde volgorde: de zon (met de plekken), de
 * batterij, het huis, en dan wat er naar het net gaat of eruit komt. In hele
 * watts met een punt voor de duizendtallen, zodat de delen zichtbaar optellen:
 *
 *   De zon levert 1.134 W (Hoofddak 701 W + Dierenverblijf 433 W). Daarvan
 *   laadt 627 W de batterij en gebruikt je huis 458 W. De rest, 49 W, gaat
 *   naar het net.
 *
 * Wie aan wie levert (met de batterij voorop) rekent verdeelStroom in
 * stroom.js uit; hier komen alleen de woorden. Daarna hooguit twee korte
 * zinnen erbij: of de batterij vol of bijna leeg is (of dat de meters even
 * niet gelijk lopen), en of stroom nu duur of goedkoop is tegenover de rest
 * van vandaag. Trekt een fase meer dan de grens (src/lib/fasen.js), dan
 * staat dat er als eerste bij.
 *
 * De drempels staan hier; de tegels, de bladen en de tekening gebruiken
 * dezelfde, zodat nergens "niets" staat waar elders 15 W loopt. Binnen ±20 W
 * gaat er niets naar of uit het net: dat is meetruis, de batterij regelt
 * steeds naar nul. Dan noemt de keten de meters zelf (de zon, de batterij, het
 * huis), zoals de tegels, en zegt hij dat er niets naar of uit het net gaat.
 *
 * Geen imports: opmaak.js en stroom.js halen hun drempels hier.
 */

/** Onder 5 W is het geen stroom maar meetruis: geen lijn, geen regel, geen woord. */
export const STROOM_W = 5;
/** Binnen ±20 W gaat er niets naar of uit het net, en onder 20 W is er geen zon ("net 0 is niks naar het net"). */
export const NIETS_W = 20;
/** Tot en met dit percentage is de batterij bijna leeg. */
export const BIJNA_LEEG_PROCENT = 10;
/** Vanaf dit percentage is de batterij vol. */
export const VOL_PROCENT = 99;

const SP = ' ';
const heel = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0, useGrouping: 'always' });
const prijsNotatie = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', minimumFractionDigits: 3, maximumFractionDigits: 3 });
const dagNotatie = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' });

/** 1134 → "1.134 W": hele watts met een punt voor de duizendtallen, om na te rekenen. Zonder teken. */
export function watt(w) {
  return `${heel.format(Math.round(Math.abs(Number.isFinite(w) ? w : 0)))}${SP}W`;
}

/** "a", "a en b", "a, b en c". */
export function opsomming(delen) {
  if (delen.length <= 1) return delen[0] ?? '';
  return `${delen.slice(0, -1).join(', ')} en ${delen.at(-1)}`;
}

const metHoofdletter = (tekst) => (tekst ? tekst[0].toLocaleUpperCase('nl-NL') + tekst.slice(1) : tekst);
const prijs = (p) => prijsNotatie.format(p).replace(/\s/, SP);

const NIETS = 'Er gaat niets naar het net en je haalt er niets uit.';

/**
 * Of stroom nu duur of goedkoop is tegenover de rest van vandaag: duurder (of
 * goedkoper) dan driekwart van de kwartieren van vandaag. Anders, of zonder
 * prijzen van vandaag, niets.
 */
export function duurOfGoedkoop(stand) {
  const nu = Number.isFinite(stand?.klok) ? stand.klok : Date.parse(stand?.moment ?? '');
  const p = stand?.prijs?.afname_kwh;
  const v = stand?.voorspelling;
  if (!Number.isFinite(nu) || !Number.isFinite(p) || !Array.isArray(v?.afname) || !Number.isFinite(v?.van)) return '';
  const vandaag = dagNotatie.format(new Date(nu));
  const prijzen = v.afname.filter((_, i) => dagNotatie.format(new Date(v.van + i * v.stapMs)) === vandaag);
  // Minder dan zes uur aan prijzen: te weinig om iets over de dag te zeggen.
  if (prijzen.length < 24) return '';
  const goedkoper = prijzen.filter((q) => q < p).length / prijzen.length;
  const duurder = prijzen.filter((q) => q > p).length / prijzen.length;
  if (goedkoper >= 0.75) return `Stroom is nu duur: ${prijs(p)} per kWh, duurder dan driekwart van de dag.`;
  if (duurder >= 0.75) return `Stroom is nu goedkoop: ${prijs(p)} per kWh, goedkoper dan driekwart van de dag.`;
  return '';
}

/** Wat een batterij zegt die niet laadt en niet levert. */
function rustZin(procent) {
  if (procent !== null && procent >= VOL_PROCENT) return `De batterij is vol (${procent}%) en laadt niet.`;
  if (procent !== null && procent <= BIJNA_LEEG_PROCENT) return `De batterij is bijna leeg (${procent}%) en levert niets.`;
  return 'De batterij laadt niet en levert niets.';
}

/**
 * @typedef {{ soort: 'zon'|'batterij'|'huis'|'net'|'prijs'|'fase', tekst: string }} Zin
 *
 * @param {object|null} stand  zoals standUitRij (bron.js) of voorbeeldStand hem geeft
 * @param {ReturnType<import('./stroom').verdeelStroom>|null} verdeling  van dezelfde stand
 * @param {{ naamVan?: (sleutel: string) => string|undefined, zwareFase?: string }} [opties]
 *   naamVan: de naam van een plek met panelen (eigen naam uit de app); anders die van thuis
 *   zwareFase: de zin bij een fase boven de grens (zwareFaseZin in fasen.js), of ''; gaat voor in erbij
 * @returns {{ keten: Zin[], erbij: Zin[] }}  keten in vaste volgorde (zon, batterij, huis, net), erbij hooguit twee
 */
export function nuInWoorden(stand, verdeling, { naamVan, zwareFase = '' } = {}) {
  const leeg = { keten: [], erbij: [] };
  if (!stand || !verdeling) return leeg;
  const panelen = stand.zon_w != null || (Array.isArray(stand.zonnen) && stand.zonnen.length > 0);
  const bat = verdeling.batterij_w ?? null;
  const net = verdeling.net_w ?? null;
  if (!panelen && bat === null && net === null) return leeg;

  const Z = panelen ? verdeling.zon_w : 0;
  const H = verdeling.huis_w;
  const zon = Z >= NIETS_W;
  const L = bat !== null && -bat >= STROOM_W ? -bat : 0;
  const O = bat !== null && bat >= STROOM_W ? bat : 0;
  const rust = bat !== null && !L && !O;
  const netNiets = net !== null && Math.abs(net) < NIETS_W;
  // Zonder netmeter, of binnen ±20 W: geen stroom naar of uit het net in de woorden.
  const zonderNet = net === null || netNiets;
  const A = zonderNet ? 0 : Math.max(0, net);
  const T = zonderNet ? 0 : Math.max(0, -net);
  const procent = Number.isFinite(stand.batterij_procent) ? Math.round(Math.min(100, Math.max(0, stand.batterij_procent))) : null;

  /** Een stroom in de woorden: niets onder 5 W, geen zon onder 20 W, en het net alleen buiten ±20 W. */
  const stroom = (sleutel) => {
    const w = verdeling.soorten?.[sleutel] ?? 0;
    if (w < STROOM_W) return 0;
    if (!zon && sleutel.startsWith('zon>')) return 0;
    if (zonderNet && sleutel.includes('net')) return 0;
    return w;
  };
  const zb = stroom('zon>batterij');
  const zh = stroom('zon>huis');
  const zn = stroom('zon>net');
  const bh = stroom('batterij>huis');
  const bn = stroom('batterij>net');
  const nb = stroom('net>batterij');
  const nh = stroom('net>huis');

  const keten = [];
  const zeg = (soort, tekst) => keten.push({ soort, tekst });

  // De zon, met de plekken als het er meer zijn.
  if (panelen) {
    const naam = (sleutel) => metHoofdletter(naamVan?.(sleutel) || stand.zonnen?.find((z) => z.sleutel === sleutel)?.naam || 'Zon');
    const plekken = verdeling.plekken ?? [];
    const per = plekken.length > 1 ? ` (${plekken.map((p) => `${naam(p.sleutel)} ${watt(p.w)}`).join(' + ')})` : '';
    zeg('zon', zon ? `De zon levert ${watt(Z)}${per}.` : 'Er is geen zon.');
  }

  if (L) {
    // De batterij laadt: hij krijgt de zon eerst.
    if (zonderNet) {
      // De zon dekt de batterij en het huis (op meetruis na): de meters zelf.
      if (zon) zeg('batterij', H >= STROOM_W ? `Daarvan laadt ${watt(L)} de batterij en gebruikt je huis ${watt(H)}.` : 'Die gaat helemaal naar de batterij.');
      else zeg('batterij', `De batterij laadt met ${watt(L)}.`);
    } else {
      if (zb && !zh && !zn) zeg('zon', 'Die gaat helemaal naar de batterij.');
      else if (zb && zh && !nh) zeg('batterij', `Daarvan laadt ${watt(zb)} de batterij en gebruikt je huis ${watt(zh)}.`);
      else if (zb && zh) zeg('batterij', `Daarvan laadt ${watt(zb)} de batterij; de rest, ${watt(zh)}, gaat naar je huis.`);
      else if (zb) zeg('batterij', `Daarvan laadt ${watt(zb)} de batterij.`);
      if (nb) zeg('batterij', zb ? `De batterij laadt met ${watt(L)}: ${watt(zb)} van de zon en ${watt(nb)} uit het net.` : `De batterij laadt met ${watt(L)} uit het net.`);
      else if (!zb) zeg('batterij', `De batterij laadt met ${watt(L)}.`);
      if (nh) {
        if (zh) zeg('huis', `Je huis gebruikt ${watt(H)}: ${watt(zh)} van de zon en ${watt(nh)} uit het net.`);
        else zeg('huis', nb ? `Je huis gebruikt ${watt(H)}, ook uit het net.` : `Je huis haalt ${watt(H)} uit het net.`);
      }
      if (T) zeg('net', `De rest, ${watt(T)}, gaat naar het net.`);
      else if (A && nb && nh) zeg('net', `Uit het net komt dus ${watt(A)}.`);
    }
  } else if (O) {
    // De batterij levert: de zon eerst naar het huis, de batterij vult aan, de rest naar het net.
    // Gaat er ook iets van de batterij naar het net, dan eerst wat hij levert.
    if (bn) zeg('batterij', `De batterij levert ${watt(O)}.`);
    const delen = [zh && `${watt(zh)} van de zon`, bh && `${watt(bh)} van de batterij`, nh && `${watt(nh)} uit het net`].filter(Boolean);
    if (delen.length > 1) zeg('huis', `Je huis gebruikt ${watt(H)}: ${opsomming(delen)}.`);
    else if (zonderNet && bh) zeg('huis', `Je huis draait op de batterij (${watt(H)}).`);
    else if (zonderNet && zh) zeg('huis', `Je huis draait op de zon (${watt(H)}).`);
    else if (zh) zeg('huis', `Je huis gebruikt ${watt(H)}, allemaal van de zon.`);
    else if (bh) zeg('huis', `Je huis gebruikt ${watt(H)}, allemaal van de batterij.`);
    else if (nh) zeg('huis', `Je huis haalt ${watt(H)} uit het net.`);
    if (T) zeg('net', `De rest, ${watt(T)}, gaat naar het net${zn && bn ? `: ${watt(zn)} van de zon en ${watt(bn)} van de batterij` : ''}.`);
  } else {
    // De batterij doet niets, of er is geen batterij.
    if (rust) zeg('batterij', rustZin(procent));
    if (zonderNet) {
      if (zon) zeg('huis', `Je huis draait op de zon (${watt(H)}).`);
      else if (H >= NIETS_W) zeg('huis', `Je huis gebruikt ${watt(H)}.`);
    } else if (T && zh) {
      // Na de zin over de batterij zou "daarvan" niet meer over de zon gaan.
      zeg('huis', rust ? `Je huis gebruikt ${watt(H)}, allemaal van de zon.` : `Daarvan gebruikt je huis ${watt(H)}.`);
      zeg('net', `De rest, ${watt(T)}, gaat naar het net.`);
    } else if (T) {
      zeg('net', `Naar het net gaat ${watt(T)}.`);
    } else if (A) {
      zeg('huis', zh ? `Je huis gebruikt ${watt(H)}: ${watt(zh)} van de zon en ${watt(nh)} uit het net.` : `Je huis haalt ${watt(H)} uit het net.`);
    }
  }

  // Binnen ±20 W: niets naar of uit het net. Draait het huis zonder zon op de batterij, dan zegt dat genoeg.
  if (netNiets && !(O && !zon)) zeg('net', NIETS);

  const erbij = [];
  // Een fase boven de grens eerst: dat is het enige hier dat de eigenaar zelf in de hand heeft (rustig, geen alarm).
  if (zwareFase) erbij.push({ soort: 'fase', tekst: zwareFase });
  // Het huis zou onder nul uitkomen: de meters meten niet op precies hetzelfde moment.
  if (Z + (bat ?? 0) + (net ?? 0) <= -NIETS_W) erbij.push({ soort: 'net', tekst: 'De meters meten niet precies tegelijk, dus nu tellen de getallen even niet op.' });
  if (procent !== null && !rust && bat !== null) {
    if (procent <= BIJNA_LEEG_PROCENT) erbij.push({ soort: 'batterij', tekst: `De batterij is bijna leeg (${procent}%).` });
    else if (procent >= VOL_PROCENT && !L) erbij.push({ soort: 'batterij', tekst: `De batterij is vol (${procent}%).` });
  }
  const prijsZin = duurOfGoedkoop(stand);
  if (prijsZin) erbij.push({ soort: 'prijs', tekst: prijsZin });

  return { keten, erbij: erbij.slice(0, 2) };
}

/** De keten als één stuk tekst (voor tests en voorlezen). */
export function alsTekst({ keten, erbij }) {
  return [...keten, ...erbij].map((z) => z.tekst).join(' ');
}
