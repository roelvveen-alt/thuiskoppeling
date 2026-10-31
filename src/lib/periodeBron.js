import { useEffect, useMemo, useState } from 'react';
import { naarInloggen, PERIODE_ELKE_MS, vraagPeriode } from '@/api/huis';
import { dagenUit } from './periode';
import { voorbeeldDagen } from './voorbeeld';

/**
 * De dagen van een periode voor het tabblad Overzicht, via het loket
 * (vraagPeriode in src/api/huis.js: hooguit eens per paar minuten). Alleen
 * zolang dit tabblad met een periode open staat (`actief`) en het scherm
 * zichtbaar is; dan elke PERIODE_ELKE_MS opnieuw, want vandaag verandert.
 *
 * @param {{ huisId: string|null, periode: { van: string, tot: string, vandaag: string }|null,
 *   actief: boolean, metVoorbeeld: boolean }} opties
 *   metVoorbeeld: het voorbeeld, of nog niets van thuis ontvangen; dan nepdagen
 * @returns {{ dagen: ReturnType<typeof dagenUit>, status: string }}  status is een van:
 *   voorbeeld       nepdagen
 *   laden           de eerste keer
 *   klaar           de dagen van de server (kan leeg zijn)
 *   nietBijgewerkt  de functie kent deze vraag nog niet (een oudere versie live)
 *   fout            even niet; wat er al was blijft staan
 */
export function usePeriode({ huisId, periode, actief, metVoorbeeld }) {
  const [uit, setUit] = useState({ sleutel: null, dagen: [], status: 'laden' });
  const van = periode?.van ?? null;
  const tot = periode?.tot ?? null;
  const vandaag = periode?.vandaag ?? null;
  const sleutel = van && huisId ? `${huisId}|${van}|${tot}` : null;

  useEffect(() => {
    if (!actief || metVoorbeeld || !sleutel) return undefined;
    let gestopt = false;
    let bezig = false;
    let timer;
    const lees = async () => {
      clearTimeout(timer);
      // Komt het scherm terug terwijl er nog een vraag loopt: die plant de volgende zelf.
      if (gestopt || bezig || document.visibilityState === 'hidden') return;
      bezig = true;
      try {
        const antwoord = await vraagPeriode(huisId, van, tot);
        if (gestopt) return;
        setUit({ sleutel, dagen: dagenUit(antwoord?.dagen), status: 'klaar' });
      } catch (fout) {
        if (gestopt) return;
        if (fout?.soort === 'inloggen') {
          naarInloggen();
          return;
        }
        // Wat er van deze periode al was, blijft staan; de tekst zegt wat er mis is.
        setUit((oud) => ({ sleutel, dagen: oud.sleutel === sleutel ? oud.dagen : [], status: fout?.soort === 'nietBijgewerkt' ? 'nietBijgewerkt' : 'fout' }));
      } finally {
        bezig = false;
      }
      if (!gestopt) timer = setTimeout(lees, PERIODE_ELKE_MS);
    };
    const terug = () => {
      if (document.visibilityState === 'visible') lees();
    };
    lees();
    document.addEventListener('visibilitychange', terug);
    return () => {
      gestopt = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', terug);
    };
  }, [actief, metVoorbeeld, sleutel, huisId, van, tot]);

  const voorbeeld = useMemo(() => (metVoorbeeld && van ? dagenUit(voorbeeldDagen(van, tot, vandaag)) : null), [metVoorbeeld, van, tot, vandaag]);
  if (voorbeeld) return { dagen: voorbeeld, status: 'voorbeeld' };
  if (uit.sleutel !== sleutel) return { dagen: [], status: 'laden' };
  return uit;
}
