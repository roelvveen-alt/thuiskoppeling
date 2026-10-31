import { Check } from 'lucide-react';
import { useId } from 'react';
import { keuzeTab, keuzeToets } from '@/lib/keuzeToets';

/** Wat de eigenaar (en het voorbeeld) onder Instellingen ziet. */
export const DELEN_EIGENAAR = Object.freeze([
  { sleutel: 'indelen', naam: 'Indelen' },
  { sleutel: 'namen', naam: 'Namen' },
  // Gasmeterstanden zelf invullen (ronde 23); een kijker ziet dit niet.
  { sleutel: 'gas', naam: 'Gas' },
  { sleutel: 'account', naam: 'Account' },
  { sleutel: 'delen', naam: 'Delen' },
  { sleutel: 'afstand', naam: 'Op afstand' },
  // De omvormer begrenzen bij een negatieve prijs (1.5.0); alleen met een omvormer (Hoofdscherm laat hem anders weg).
  { sleutel: 'omvormer', naam: 'Omvormer' },
]);

/** Een kijker verandert niets aan andermans huis: alleen zijn eigen account en welke omgeving hij ziet. */
export const DELEN_KIJKER = Object.freeze([{ sleutel: 'account', naam: 'Account' }]);

/** De instellingen, achter het tandwiel in de kop: een rij keuzes, en daaronder dat onderdeel. */
export default function Instellingen({ delen, deel, onDeel, onKlaar, children }) {
  const kopId = useId();
  return (
    <section className="grid gap-5" aria-labelledby={kopId}>
      <div className="grid gap-3">
        <h2 id={kopId} className="text-[19px] font-bold">
          Instellingen
        </h2>
        {delen.length > 1 && (
          <div role="radiogroup" aria-labelledby={kopId} className="flex flex-wrap gap-2" onKeyDown={keuzeToets}>
            {delen.map((d, i) => (
              <button
                key={d.sleutel}
                type="button"
                role="radio"
                aria-checked={deel === d.sleutel ? 'true' : 'false'}
                tabIndex={keuzeTab(deel === d.sleutel, i, delen.some((x) => x.sleutel === deel))}
                className="keuze"
                onClick={() => onDeel(d.sleutel)}
              >
                {d.naam}
              </button>
            ))}
          </div>
        )}
      </div>
      {children}
      <button type="button" className="knop knop-hoofd justify-self-start" onClick={onKlaar}>
        <Check size={18} aria-hidden="true" /> Klaar
      </button>
    </section>
  );
}
