import { keuzeTab, keuzeToets } from '@/lib/keuzeToets';
import { MOMENTEN } from '@/lib/voorbeeld';

/** Alleen in het voorbeeld: spring naar een moment van de dag om te zien hoe de stroom dan loopt. */
export default function Momenten({ gekozen, onKies }) {
  return (
    <div className="grid gap-2">
      <p className="m-0 text-[13px] font-semibold tracking-wide text-tekst-zacht uppercase" id="momenten-titel">
        Kijk naar een ander moment
      </p>
      <div role="radiogroup" aria-labelledby="momenten-titel" className="flex flex-wrap gap-2" onKeyDown={keuzeToets}>
        {MOMENTEN.map((m, i) => (
          <button
            key={m.sleutel}
            type="button"
            role="radio"
            aria-checked={gekozen === m.sleutel ? 'true' : 'false'}
            tabIndex={keuzeTab(gekozen === m.sleutel, i, MOMENTEN.some((x) => x.sleutel === gekozen))}
            className="keuze"
            onClick={() => onKies(m.sleutel)}
          >
            {m.naam}
          </button>
        ))}
      </div>
    </div>
  );
}
