import { useMemo, useRef, useState } from 'react';
import { leesLokaal, schrijfLokaal } from '@/lib/lokaal';
import { LOKAAL_KEUZE } from '@/lib/overzichtKeuze';
import { KEUZES, periodeVan } from '@/lib/periode';
import { usePeriode } from '@/lib/periodeBron';
import { datumVan } from '@/lib/prijsoverzicht';
import OverzichtPeriode from './OverzichtPeriode';
import OverzichtVandaag from './OverzichtVandaag';

export { LOKAAL_KEUZE };

/** Welke periode als laatste gekozen was, op dit toestel (alleen gemak). */
export function bewaardeKeuze() {
  const bewaard = leesLokaal(LOKAAL_KEUZE);
  return KEUZES.some((k) => k.sleutel === bewaard) ? bewaard : 'vandaag';
}

/**
 * De keuze bovenaan: Vandaag · Week · Maand · Kwartaal · Jaar. Eén rij
 * segmenten die ook op 320 px past; de gekozen in de keuze-stijl van de app
 * (.keuze[aria-checked]). Met de pijltjes naar links en rechts kies je de
 * volgende, zoals bij de tabbladen.
 */
function Keuze({ gekozen, onKies }) {
  const knoppen = useRef([]);
  const toets = (e, i) => {
    const n = KEUZES.length;
    const naar = { ArrowRight: (i + 1) % n, ArrowLeft: (i + n - 1) % n, Home: 0, End: n - 1 }[e.key];
    if (naar === undefined) return;
    e.preventDefault();
    onKies(KEUZES[naar].sleutel);
    knoppen.current[naar]?.focus();
  };
  return (
    <div role="radiogroup" aria-label="Periode" className="segmenten">
      {KEUZES.map((k, i) => (
        <button
          key={k.sleutel}
          ref={(el) => {
            knoppen.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={gekozen === k.sleutel ? 'true' : 'false'}
          tabIndex={gekozen === k.sleutel ? 0 : -1}
          className="keuze"
          onClick={() => onKies(k.sleutel)}
          onKeyDown={(e) => toets(e, i)}
        >
          {k.naam}
        </button>
      ))}
    </div>
  );
}

/**
 * Tabblad Overzicht: wat eerst Vandaag en Prijzen waren (Vandaag), en de
 * week, maand, kwartaal en het jaar uit de dagen die de server bewaart. De
 * dagen worden alleen opgehaald als hier een periode open staat, en hooguit
 * eens per paar minuten (src/api/huis.js, vraagPeriode).
 *
 * @param {{ stand: object|null, nu: number, huisId: string|null, metVoorbeeld: boolean }} props
 *   metVoorbeeld: het voorbeeld, of nog niets van thuis ontvangen; dan nepdagen
 *   zonderCijfers: nog geen meting binnen; dan staat dit bij Vandaag in plaats van de kaarten
 */
export default function TabOverzicht({ stand, nu, huisId, metVoorbeeld, zonderCijfers = null, eigenaar = true, namen = {}, gasStanden = [], instellingSturen = null }) {
  const [keuze, setKeuze] = useState(bewaardeKeuze);
  const kies = (sleutel) => {
    setKeuze(sleutel);
    schrijfLokaal(LOKAAL_KEUZE, sleutel);
  };
  const vandaag = datumVan(nu);
  // De periode hangt alleen van de dag af, niet van elke tik van de klok.
  const periode = useMemo(() => (keuze === 'vandaag' ? null : periodeVan(keuze, Date.parse(`${vandaag}T12:00:00Z`))), [keuze, vandaag]);
  // In één vraag ook de periode ervoor (vorige week, maand, kwartaal): voor de vergelijking bij Apparaten, zonder aanroep extra.
  const vraagPeriode = useMemo(() => (periode?.vorige ? { ...periode, van: periode.vorige.van } : periode), [periode]);
  const { dagen, status } = usePeriode({ huisId, periode: vraagPeriode, actief: periode !== null, metVoorbeeld });

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4" id="tabblad" role="tabpanel" aria-labelledby="tab-overzicht">
      <Keuze gekozen={keuze} onKies={kies} />
      {periode ? (
        <OverzichtPeriode periode={periode} dagen={dagen} status={status} stand={stand} eigenaar={eigenaar} namen={namen} gasStanden={gasStanden} />
      ) : (
        (zonderCijfers ?? <OverzichtVandaag stand={stand} nu={nu} eigenaar={eigenaar} namen={namen} instellingSturen={instellingSturen} />)
      )}
    </div>
  );
}
