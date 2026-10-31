import { ChevronRight, Gauge } from 'lucide-react';
import NuInWoorden from './NuInWoorden';

/**
 * Tabblad Huis naast de tekening: Nu in woorden, en één knop naar Nu voor
 * alle cijfers. Huis is het plaatje en de eenvoud; de tegels, wie aan wie
 * levert, de apparaten, de fasen en het geld staan op Nu.
 */
export default function HuisWoorden({ stand, verdeling, punten, grenzen, onNu = null }) {
  return (
    <section className="grid min-w-0 gap-2.5" aria-label="Nu">
      <NuInWoorden stand={stand} verdeling={verdeling} punten={punten} grenzen={grenzen} />
      {onNu && (
        <button type="button" className="knop knop-breed" onClick={onNu}>
          <span className="flex items-center gap-2">
            <Gauge size={18} aria-hidden="true" />
            Alle cijfers van nu
          </span>
          <ChevronRight size={18} className="text-tekst-zacht" aria-hidden="true" />
        </button>
      )}
    </section>
  );
}
