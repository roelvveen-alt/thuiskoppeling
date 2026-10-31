/**
 * Wat er vandaag gebeurde, uit de kwartieren die het programmaatje bijhoudt
 * (dagUit in bron.js): eigen verbruik en zelfvoorzienend, met dezelfde
 * verdeling als de rest van de app (verdeelStroom: de batterij gaat voor).
 * Sinds brug 1.2.0 verdeelt het programmaatje elke meting zelf (stromenKwh:
 * precies); van een oudere brug per kwartier, en dan vallen afnemen en
 * terugleveren binnen een kwartier tegen elkaar weg. Met de precieze stromen (soorten), niet met de lijst voor op het
 * scherm, waar meetruis uit is gehaald.
 *
 *   eigen verbruik   welk deel van de zonnestroom je zelf gebruikte (huis of batterij)
 *   zelfvoorzienend  welk deel van wat het huis gebruikte níet uit het net kwam
 *
 * Laadt de batterij meer dan de zon geeft, dan komt wat het huis gebruikt uit
 * het net (de zon ging naar de batterij); dat telt dus niet als zelfvoorzienend.
 * Het eigen verbruik hangt daar niet van af: de zon gaat dan naar de batterij
 * in plaats van naar het huis, maar blijft in huis.
 */
import { verdeelStroom } from './stroom';

/**
 * @param {ReturnType<import('./bron').dagUit>} dag
 * @returns {null | { eigenVerbruik: number|null, zelfvoorzienend: number|null, vanaf: number|null, laatste: number }}
 *   vanaf: het moment waarop de geschiedenis begint, als dat later is dan het eerste kwartier
 */
export function dagOverzicht(dag) {
  if (!dag) return null;
  const laatste = dag.metingen.reduce((l, n, i) => (n ? i : l), -1);
  const vanaf = dag.sinds > dag.van + dag.stapMs ? dag.sinds : null;
  // Brug 1.2.0: per meting (elke 5 s) verdeeld, zoals verbruikUitKwh op de server; dan precies.
  const s = dag.stromenKwh;
  if (s) {
    return {
      eigenVerbruik: dag.kwh.zon >= 0.05 ? Math.min(1, s.zonZelf / dag.kwh.zon) : null,
      zelfvoorzienend: dag.kwh.huis >= 0.05 ? Math.min(1, Math.max(0, 1 - s.netHuis / dag.kwh.huis)) : null,
      vanaf,
      laatste,
    };
  }
  const uren = dag.stapMs / 3_600_000;
  let zon = 0;
  let zonZelf = 0;
  let huis = 0;
  let huisUitNet = 0;
  dag.metingen.forEach((n, i) => {
    if (!n) return;
    const v = verdeelStroom({ zon_w: dag.zon?.[i] ?? null, batterij_w: dag.batterij?.[i] ?? null, net_w: dag.net?.[i] ?? null });
    zon += v.zon_w * uren;
    zonZelf += (v.soorten['zon>huis'] + v.soorten['zon>batterij']) * uren;
    huis += v.huis_w * uren;
    huisUitNet += v.soorten['net>huis'] * uren;
  });
  return {
    // Onder de 50 Wh zegt een percentage niets (een nacht, een grijze ochtend).
    eigenVerbruik: zon >= 50 ? Math.min(1, zonZelf / zon) : null,
    zelfvoorzienend: huis >= 50 ? Math.max(0, 1 - huisUitNet / huis) : null,
    vanaf,
    laatste,
  };
}

/**
 * Zelfvoorzienend en eigen verbruik zoals je ze op de meters naziet, uit de
 * kWh die er ook staan (vandaag, of een week, maand, kwartaal, jaar):
 *
 *   zelfvoorzienend  1 − uit het net / wat het huis gebruikte
 *   eigen verbruik   1 − teruggeleverd / wat de zon opwekte
 *
 * Netstroom die eerst in de batterij ging en daarna in huis, telt dus als
 * "uit het net" (weergave-8: "83%" terwijl bijna alles uit het net kwam
 * klopte niet met wat je ziet). Levert de batterij ook terug, dan kan er
 * meer teruggaan dan de zon gaf: dan is het eigen verbruik 0%.
 * Onder de 0,05 kWh zegt een percentage niets: null.
 */
export function delenVan({ zon = null, huis = null, afname = null, terug = null } = {}) {
  const tussen = (v) => Math.min(1, Math.max(0, v));
  return {
    zelfvoorzienend: huis !== null && afname !== null && huis >= 0.05 ? tussen(1 - afname / huis) : null,
    eigenVerbruik: zon !== null && terug !== null && zon >= 0.05 ? tussen(1 - terug / zon) : null,
  };
}
