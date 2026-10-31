/**
 * Wat er in de prijzen van vandaag en morgen staat, voor Overzicht › Vandaag:
 * de prijs van nu, de goedkoopste en duurste kwartieren, de beste twee uur om
 * te laden en om terug te leveren, gemiddelden per dag, negatieve prijzen en
 * de uren met Zonnebonus. De prijzen zelf komen van het programmaatje thuis
 * (voorspellingUit in bron.js); hier wordt alleen gerekend.
 */

const dagNotatie = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' });

/** "2026-10-30" voor een moment, in Nederlandse tijd. */
export const datumVan = (ms) => dagNotatie.format(new Date(ms));

/** De kwartieren als rij: { i, van, tot, afname, terug, bonus }. */
export function kwartierenVan(v) {
  return v.afname.map((afname, i) => ({ i, van: v.van + i * v.stapMs, tot: v.van + (i + 1) * v.stapMs, afname, terug: v.terug[i], bonus: v.bonus[i] }));
}

/**
 * Het blok van `lengte` kwartieren achter elkaar met het laagste (of hoogste)
 * gemiddelde, dat nog niet voorbij is.
 */
export function besteBlok(kwartieren, { veld, hoogste = false, lengte = 8, vanaf }) {
  let beste = null;
  for (let s = 0; s + lengte <= kwartieren.length; s++) {
    if (kwartieren[s].tot <= vanaf) continue;
    const blok = kwartieren.slice(s, s + lengte);
    const gemiddeld = blok.reduce((t, k) => t + k[veld], 0) / lengte;
    if (!beste || (hoogste ? gemiddeld > beste.gemiddeld : gemiddeld < beste.gemiddeld)) {
      beste = { van: blok[0].van, tot: blok.at(-1).tot, gemiddeld, eerste: s, laatste: s + lengte - 1 };
    }
  }
  return beste;
}

/** Kwartieren die op elkaar aansluiten samen als één blok van–tot. */
export function blokken(kwartieren) {
  const uit = [];
  for (const k of kwartieren) {
    const vorig = uit.at(-1);
    if (vorig && vorig.tot === k.van) {
      vorig.tot = k.tot;
      vorig.laagste = Math.min(vorig.laagste, k.afname);
    } else {
      uit.push({ van: k.van, tot: k.tot, laagste: k.afname, eerste: k.i });
    }
  }
  return uit;
}

const laagste = (lijst, veld) => lijst.reduce((b, k) => (!b || k[veld] < b[veld] ? k : b), null);
const hoogste = (lijst, veld) => lijst.reduce((b, k) => (!b || k[veld] > b[veld] ? k : b), null);

/**
 * @param {ReturnType<import('./bron').voorspellingUit>} v
 * @param {number} nu  ms
 */
export function prijsOverzicht(v, nu) {
  if (!v) return null;
  const kwartieren = kwartierenVan(v);
  const vandaag = datumVan(nu);
  // Op de datumtekst, niet nu + 24 uur: een dag is niet altijd 24 uur (zomer- en wintertijd).
  const [j, m, d] = vandaag.split('-').map(Number);
  const morgen = new Date(Date.UTC(j, m - 1, d + 1)).toISOString().slice(0, 10);
  // Prijzen die niet over vandaag of later gaan (een oude voorspelling) tonen we niet.
  if (!kwartieren.some((k) => k.tot > nu)) return null;

  const dagen = [];
  for (const k of kwartieren) {
    const datum = datumVan(k.van);
    if (datum !== vandaag && datum !== morgen) continue;
    let dag = dagen.find((d) => d.datum === datum);
    if (!dag) dagen.push((dag = { datum, naam: datum === vandaag ? 'vandaag' : 'morgen', kwartieren: [] }));
    dag.kwartieren.push(k);
  }
  for (const dag of dagen) {
    dag.gemiddeld = dag.kwartieren.reduce((t, k) => t + k.afname, 0) / dag.kwartieren.length;
    dag.laagste = laagste(dag.kwartieren, 'afname');
    dag.hoogste = hoogste(dag.kwartieren, 'afname');
  }

  const komend = kwartieren.filter((k) => k.tot > nu);
  return {
    kwartieren,
    nu: kwartieren.find((k) => k.van <= nu && nu < k.tot) ?? null,
    dagen,
    morgen: dagen.some((d) => d.naam === 'morgen'),
    goedkoopst: laagste(komend, 'afname'),
    duurst: hoogste(komend, 'afname'),
    laden: besteBlok(kwartieren, { veld: 'afname', vanaf: nu }),
    terugleveren: besteBlok(kwartieren, { veld: 'terug', hoogste: true, vanaf: nu }),
    negatief: blokken(komend.filter((k) => k.afname < 0)),
    bonus: blokken(kwartieren.filter((k) => k.bonus > 0 && datumVan(k.van) === vandaag)),
    schatting: v.schatting,
    bron: v.bron,
  };
}
