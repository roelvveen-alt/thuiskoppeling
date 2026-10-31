/**
 * Alleen tonen als "vandaag" of "nu" wat ook echt van vandaag en nu is
 * (rekenregels-14). Staat het programmaatje stil, dan blijft de laatste rij
 * in Base44 staan: zonder dit zou "Geld vandaag" de hele volgende dag de
 * cijfers van gisteren tonen, "Stroomprijs nu" een verlopen kwartier en op
 * 1 januari het plafond van vorig jaar. De kop zegt dan al "Stand van …".
 *
 * - vandaag en dag: alleen als hun datum vandaag is (Nederlandse tijd); zonder
 *   datum (een oud programmaatje) blijven ze, zoals vroeger.
 * - prijs: verlopen (tot ≤ nu)? Dan het kwartier van nu uit de voorspelling,
 *   die vooruit kijkt; staat dat er niet in, geen prijs.
 * - jaar: alleen als het jaar van nu is (zonder jaartal blijft hij).
 *
 * Verandert er niets, dan precies hetzelfde object terug (grafieken tekenen
 * dan niet opnieuw).
 */
import { datumVan } from './prijsoverzicht';

function prijsVan(prijs, voorspelling, nu) {
  if (!prijs?.tot) return prijs;
  const tot = Date.parse(prijs.tot);
  if (!Number.isFinite(tot) || tot > nu) return prijs;
  const v = voorspelling;
  const i = v ? Math.floor((nu - v.van) / v.stapMs) : -1;
  if (!v || i < 0 || i >= v.afname.length) return null;
  const van = v.van + i * v.stapMs;
  return {
    afname_kwh: v.afname[i],
    teruglevering_kwh: v.terug[i],
    zonnebonus_kwh: v.bonus[i] ?? 0,
    van: new Date(van).toISOString(),
    tot: new Date(van + v.stapMs).toISOString(),
    bron: v.bron || prijs.bron,
  };
}

export function vanNu(stand, nu) {
  if (!stand || !Number.isFinite(nu)) return stand;
  const vandaag = datumVan(nu);
  const vanVandaag = (x) => x && (x.datum == null || x.datum === vandaag);
  const uit = {
    vandaag: stand.vandaag && !vanVandaag(stand.vandaag) ? null : stand.vandaag,
    dag: stand.dag && !vanVandaag(stand.dag) ? null : stand.dag,
    jaar: stand.jaar?.jaar != null && String(stand.jaar.jaar) !== vandaag.slice(0, 4) ? null : stand.jaar,
    prijs: prijsVan(stand.prijs, stand.voorspelling, nu),
  };
  return Object.keys(uit).every((k) => uit[k] === stand[k]) ? stand : { ...stand, ...uit };
}
