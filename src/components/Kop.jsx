import { Check, Settings } from 'lucide-react';
import { useEffect, useState } from 'react';
import { OUD_NA_MS } from '@/lib/bron';
import { geleden, tijd } from '@/lib/opmaak';

/**
 * Eén regel over waar de cijfers vandaan komen en hoe vers ze zijn. `soort`
 * verandert alleen als de toestand verandert (live, oud, rem, …): dat is wat
 * een schermlezer hoort, niet elke tel van "20 s geleden".
 */
function useStatus(status, moment) {
  const [nu, setNu] = useState(() => Date.now());
  useEffect(() => {
    // Elke 5 s is genoeg: "geleden" telt in stappen van 10 s.
    const id = setInterval(() => setNu(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  if (status === 'voorbeeld') return { kleur: 'var(--zon)', tekst: 'Voorbeeld met nepcijfers' };
  if (status === 'leeg') return { kleur: 'var(--let-op)', tekst: 'Nog niets van thuis ontvangen · je ziet het voorbeeld' };
  if (status === 'laden') return { kleur: 'var(--tekst-zacht)', tekst: 'Cijfers ophalen…' };
  if (status === 'fout') return { kleur: 'var(--fout)', tekst: 'De app is even niet bereikbaar · ik probeer het steeds opnieuw' };
  if (status === 'rem') return { kleur: 'var(--let-op)', tekst: 'Het is even druk · zo weer live' };
  if (status === 'nietBijgewerkt') {
    return { kleur: 'var(--let-op)', tekst: 'De app wordt net bijgewerkt · zo weer live' };
  }
  if (status === 'geenHuis') return { kleur: 'var(--fout)', tekst: 'Dit huis is er niet meer, of je kijkt niet meer mee' };
  const ms = moment ? nu - new Date(moment).getTime() : Number.NaN;
  if (!(ms < OUD_NA_MS)) {
    const tekst = `Laatste cijfers van ${tijd(moment)} · draait het programmaatje thuis nog?`;
    return { kleur: 'var(--let-op)', tekst, soort: tekst };
  }
  return { kleur: 'var(--goed)', tekst: `Live · ${geleden(ms)}`, soort: 'Live', live: true };
}

/** Bovenaan: de naam van de omgeving, hoe vers de cijfers zijn, en het tandwiel voor Instellingen. */
export default function Kop({ titel = 'Energie thuis', status, moment, open, onInstellingen }) {
  const regel = useStatus(status, moment);
  return (
    <header className="flex items-start justify-between gap-3 pb-4">
      <div className="grid min-w-0 gap-1">
        <h1 className="text-[27px] leading-[1.05] font-extrabold tracking-[-0.02em] break-words">{titel}</h1>
        <p className="m-0 flex items-center gap-2 text-[13.5px] text-tekst-zacht">
          <span className="size-2 flex-none rounded-full" style={{ background: regel.kleur }} aria-hidden="true" />
          <span className="min-w-0">{regel.tekst}</span>
        </p>
        <span className="sr-only" role="status">
          {regel.soort ?? regel.tekst}
        </span>
      </div>
      <button
        type="button"
        className={`knop flex-none max-[359px]:px-3 ${open ? 'knop-hoofd' : ''}`}
        onClick={onInstellingen}
        aria-expanded={open ? 'true' : 'false'}
      >
        {open ? <Check size={18} aria-hidden="true" /> : <Settings size={18} aria-hidden="true" />}
        {/* Op de smalste telefoons alleen het tandwiel; de naam blijft voor schermlezers. */}
        <span className="max-[359px]:sr-only">{open ? 'Klaar' : 'Instellingen'}</span>
      </button>
    </header>
  );
}
