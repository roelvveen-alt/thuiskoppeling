/**
 * "Komt van" en "gaat naar" in gewone woorden. Per regel wie, hoeveel en welk
 * deel van het geheel, en bovenaan één zin, zoals "Je huis draait nu
 * helemaal op de zon." of "Naar het net gaat 1,9 kW: 229 W van de zon en
 * 1,7 kW van de batterij." ("De komt van is niet duidelijk.")
 *
 * Alle plekken met panelen samen heten in de zin "de zon"; in de regels
 * eronder staat elke plek apart. In de zin staat alles in dezelfde volgorde en
 * met dezelfde woorden als in Nu in woorden (nuInWoorden.js): de zon, de
 * batterij, het huis, het net.
 */
import { opsomming } from './nuInWoorden';
import { vermogen } from './opmaak';

export { opsomming };

const VAN = { zon: 'van de zon', batterij: 'van de batterij', net: 'uit het net', huis: 'uit het huis' };
const VOOR = { huis: 'voor het huis', batterij: 'voor de batterij', net: 'voor het net' };
const AAN = { huis: 'aan het huis', batterij: 'aan de batterij', net: 'aan het net' };
const VOLGORDE = ['zon', 'batterij', 'huis', 'net'];

/**
 * De regels onder "Komt van" of "Gaat naar": per ander punt het vermogen en
 * het aandeel (0 tot 1) van alles samen, grootste eerst.
 *
 * @param {Array<{ van: string, naar: string, w: number }>} stromen  erin of eruit (stromenBij)
 * @param {'erin'|'eruit'} kant
 * @param {(sleutel: string) => object|undefined} puntVan  het punt bij een sleutel (naam, soort)
 */
export function regels(stromen, kant, puntVan) {
  const totaal = stromen.reduce((som, s) => som + s.w, 0);
  return stromen
    .map((s) => {
      const ander = kant === 'erin' ? s.van : s.naar;
      const punt = puntVan(ander);
      return { sleutel: `${s.van}>${s.naar}`, punt: punt ?? { sleutel: ander, soort: 'apparaat' }, naam: punt?.naam ?? ander, w: s.w, aandeel: totaal > 0 ? s.w / totaal : 0 };
    })
    .sort((a, b) => b.w - a.w);
}

/** Per soort samengeteld (alle zonneplekken samen), in de vaste volgorde: zon, batterij, huis, net. */
function perSoort(rijen) {
  const som = new Map();
  for (const r of rijen) som.set(r.punt.soort, (som.get(r.punt.soort) ?? 0) + r.w);
  const plek = (soort) => (VOLGORDE.includes(soort) ? VOLGORDE.indexOf(soort) : VOLGORDE.length);
  return [...som].map(([soort, w]) => ({ soort, w })).sort((a, b) => plek(a.soort) - plek(b.soort));
}

const procentVan = (w, totaal) => `${Math.round((100 * w) / totaal)}%`;

/**
 * Wat er door de meterkast heen gaat, voor het huisblad: de lijnen van de
 * tekening (lijnenVoorTekening) die vanuit het huis naar de batterij of het
 * net lopen. Zo staat de batterij er ook in als hij laadt, en niet alleen als
 * hij het huis van stroom voorziet ("mis de batterij in deze menu"). De
 * zin over het geheel is Nu in woorden, die er op het huisblad boven staat.
 *
 * @param {Array<{ van: string, naar: string, w: number }>} lijnen  lijnenVoorTekening(stand)
 * @param {(sleutel: string) => object|undefined} puntVan
 * @returns {ReturnType<typeof regels>}
 */
export function doorDeMeterkast(lijnen, puntVan) {
  const door = lijnen.filter((l) => l.van === 'huis' && (l.naar === 'batterij' || l.naar === 'net'));
  return regels(door, 'eruit', puntVan);
}

/**
 * De zin bovenaan een blad.
 * @param {{ soort: string, naam?: string }} punt  het punt van het blad
 * @param {ReturnType<typeof regels>} erin
 * @param {ReturnType<typeof regels>} eruit
 */
export function zinStromen(punt, erin, eruit) {
  const binnen = perSoort(erin);
  const buiten = perSoort(eruit);
  const som = (lijst) => lijst.reduce((t, d) => t + d.w, 0);

  switch (punt.soort) {
    case 'huis': {
      const totaal = som(binnen);
      if (totaal <= 0) return '';
      if (binnen.length === 1) {
        const enige = binnen[0].soort;
        if (enige === 'net') return 'Je huis haalt nu alles uit het net.';
        return `Je huis draait nu helemaal op ${enige === 'zon' ? 'de zon' : 'de batterij'}.`;
      }
      return `Je huis haalt nu ${opsomming(binnen.map((d) => `${procentVan(d.w, totaal)} ${VAN[d.soort] ?? ''}`.trim()))}.`;
    }
    case 'net': {
      if (binnen.length) {
        const totaal = som(binnen);
        if (binnen.length === 1) return `Naar het net gaat ${vermogen(totaal)}, allemaal ${VAN[binnen[0].soort]}.`;
        return `Naar het net gaat ${vermogen(totaal)}: ${opsomming(binnen.map((d) => `${vermogen(d.w)} ${VAN[d.soort]}`))}.`;
      }
      if (buiten.length) {
        const totaal = som(buiten);
        if (buiten.length === 1) return `Uit het net komt ${vermogen(totaal)}, allemaal ${VOOR[buiten[0].soort] ?? 'voor het huis'}.`;
        return `Uit het net komt ${vermogen(totaal)}: ${opsomming(buiten.map((d) => `${vermogen(d.w)} ${VOOR[d.soort] ?? ''}`.trim()))}.`;
      }
      return '';
    }
    case 'batterij': {
      if (binnen.length) {
        const totaal = som(binnen);
        if (binnen.length === 1) return `De batterij laadt met ${vermogen(totaal)}, allemaal ${VAN[binnen[0].soort]}.`;
        return `De batterij laadt met ${vermogen(totaal)}: ${opsomming(binnen.map((d) => `${vermogen(d.w)} ${VAN[d.soort]}`))}.`;
      }
      if (buiten.length) {
        const totaal = som(buiten);
        if (buiten.length === 1) return `De batterij levert ${vermogen(totaal)}, alles ${AAN[buiten[0].soort] ?? ''}.`.replace(' .', '.');
        return `De batterij levert ${vermogen(totaal)}: ${opsomming(buiten.map((d) => `${vermogen(d.w)} ${AAN[d.soort] ?? ''}`.trim()))}.`;
      }
      return '';
    }
    case 'zon': {
      const totaal = som(buiten);
      if (totaal <= 0) return '';
      const naar = { huis: 'naar het huis', batterij: 'naar de batterij', net: 'naar het net' };
      if (buiten.length === 1) return `Alles gaat ${naar[buiten[0].soort]}.`;
      return `Van de ${vermogen(totaal)} gaat ${opsomming(buiten.map((d) => `${vermogen(d.w)} ${naar[d.soort]}`))}.`;
    }
    default:
      return '';
  }
}
