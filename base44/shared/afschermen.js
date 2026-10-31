/**
 * Wat een kijker niet hoeft te zien: in welk adres in de wifi van de eigenaar
 * een apparaat hangt, en serienummers (ronde 19, B6). Bij gekoppeld gaat het
 * adres er al helemaal uit (huizen.js, metingVoor); dit haalt ze ook uit de
 * vrije teksten die het programmaatje meestuurt (brug.meldingen, de namen van
 * gekoppelde apparaten) en uit het logboek (Gebeurtenis.wat, dat uit die
 * meldingen komt). Het programmaatje haalt zelf alleen IPv4 weg
 * (brug/gekoppeld.mjs); een oudere versie misschien niet eens dat.
 *
 * Liever een keer te veel "het adres" dan een adres te veel: een kijker heeft
 * aan de opdracht in een melding toch niets (die is voor de eigenaar).
 */

/** Wat in een melding een bestand of opdracht is, geen hostnaam: "node brug.mjs", "instellingen.json". */
const BESTANDEN = new Set(['mjs', 'js', 'cjs', 'json', 'jsonc', 'sh', 'md', 'log', 'txt', 'csv', 'ts', 'html', 'yaml', 'yml']);

const ADRES = 'het adres';
const SERIENUMMER = 'het serienummer';

/** MAC-adres (bij HomeWizard is dat ook het serienummer): aa:bb:cc:dd:ee:ff of met streepjes. */
const MAC = /(?<![0-9a-z])[0-9a-f]{2}(?:([:-])[0-9a-f]{2})(?:\1[0-9a-f]{2}){4}(?![0-9a-z])/gi;
/** IPv4, eventueel met poort. */
const IPV4 = /(?<![0-9.])\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?(?![0-9])/g;
/** Kandidaat voor IPv6 (eventueel tussen haken, met zone en poort); welke echt een adres is, beslist ipv6. */
const IPV6 = /(?<![0-9a-z:])\[?[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}(?:%[0-9a-z]+)?\]?(?::\d{1,5})?(?![0-9a-z:])/gi;
/** Een naam met punten (p1meter-3c39e7.fritz.box, homewizard.local, router.lan). */
const HOSTNAAM = /(?<![0-9a-z@-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z][a-z0-9-]{0,22}[a-z0-9])(?![0-9a-z-])\.?/gi;
/** Een HomeWizard-naam in het netwerk zonder punt: p1meter-3c39e7, energysocket-0a1b2c. */
const APPARAATNAAM = /(?<![0-9a-z-])[a-z][a-z0-9]*-(?=[0-9a-f]*\d)[0-9a-f]{6}(?![0-9a-z-])/gi;
/** 12 tekens hex met cijfers en letters (HomeWizard-serienummer). */
const HEX_12 = /(?<![0-9a-z])(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{12,16}(?![0-9a-z])/gi;
/** Een lang nummer met minstens 4 cijfers en 2 letters (Zendure, GoodWe, Tuya): FO4NXXXX1234, 5010KDTA000X. */
const NUMMER = /(?<![0-9a-z])(?=(?:[a-z]*\d){4})(?=(?:\d*[a-z]){2})[a-z0-9]{10,32}(?![0-9a-z])/gi;

/** Is dit stuk met dubbele punten een IPv6-adres (en geen tijd zoals 12:30:45)? */
function ipv6(stuk) {
  const kern = stuk.replace(/^\[/, '').replace(/\](?::\d+)?$/, '').replace(/%[0-9a-z]+$/i, '');
  if (!/[0-9a-f]/i.test(kern)) return false;
  return kern.includes('::') || kern.split(':').length >= 4;
}

/**
 * Een tekst zonder adressen (IPv4, IPv6, hostnamen, MAC) en serienummers.
 * Niet-tekst komt ongewijzigd terug.
 */
export function zonderAdressen(tekst) {
  if (typeof tekst !== 'string' || !tekst) return tekst;
  return tekst
    .replace(MAC, SERIENUMMER)
    .replace(IPV4, ADRES)
    .replace(IPV6, (stuk) => (ipv6(stuk) ? ADRES : stuk))
    .replace(HOSTNAAM, (stuk, laatste) => (BESTANDEN.has(laatste.toLowerCase()) ? stuk : ADRES + (stuk.endsWith('.') ? '.' : '')))
    .replace(APPARAATNAAM, ADRES)
    .replace(HEX_12, SERIENUMMER)
    .replace(NUMMER, SERIENUMMER);
}

/**
 * De meting zoals een kijker hem krijgt: gekoppeld zonder adres en met schone
 * namen, brug.meldingen zonder adressen en serienummers. Verandert `meting`
 * niet (die kan uit het geheugen komen, gedeeld met de eigenaar).
 */
export function metingVoorKijker(meting) {
  const uit = { ...meting };
  if (Array.isArray(meting.gekoppeld)) {
    uit.gekoppeld = meting.gekoppeld.map((apparaat) => {
      if (!apparaat || typeof apparaat !== 'object') return apparaat;
      const rest = Object.fromEntries(Object.entries(apparaat).filter(([veld]) => veld !== 'adres'));
      return { ...rest, ...(typeof rest.naam === 'string' ? { naam: zonderAdressen(rest.naam) } : {}), ...(typeof rest.soort === 'string' ? { soort: zonderAdressen(rest.soort) } : {}) };
    });
  }
  if (meting.brug && typeof meting.brug === 'object' && Array.isArray(meting.brug.meldingen)) {
    uit.brug = {
      ...meting.brug,
      meldingen: meting.brug.meldingen.map((m) => (m && typeof m === 'object' && typeof m.tekst === 'string' ? { ...m, tekst: zonderAdressen(m.tekst) } : m)),
    };
  }
  // De spanningswacht (1.5.0): de namen van de meters net zo schoon als bij gekoppeld.
  if (meting.spanning && typeof meting.spanning === 'object' && Array.isArray(meting.spanning.herkomst)) {
    uit.spanning = {
      ...meting.spanning,
      herkomst: meting.spanning.herkomst.map((h) => (h && typeof h.naam === 'string' ? { ...h, naam: zonderAdressen(h.naam) } : h)),
      // 1.6.0: de naam van de meter waarmee de zonmeter vergeleken is, net zo schoon.
      ...(typeof meting.spanning.verschil_met === 'string' ? { verschil_met: zonderAdressen(meting.spanning.verschil_met) } : {}),
    };
  }
  // Het begrenzen van de omvormer (1.5.0) is voor de eigenaar: een kijker ziet er niets van.
  if (meting.omvormer && typeof meting.omvormer === 'object' && 'sturen' in meting.omvormer) {
    uit.omvormer = Object.fromEntries(Object.entries(meting.omvormer).filter(([veld]) => veld !== 'sturen'));
  }
  return uit;
}
