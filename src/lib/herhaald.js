import { useEffect, useState } from 'react';
import { naarInloggen } from '@/api/huis';

/** Per sleutel wanneer het laatst gevraagd is en wat er kwam, voor heel deze pagina. */
const LAATST = new Map();

/**
 * Een vraag aan de functie huis die af en toe terugkomt (het logboek, het
 * overzicht van alle huizen): alleen zolang `actief` (dat scherm staat open)
 * en het scherm zichtbaar is; meteen bij openen, dan elke `elkeMs`. Komt het
 * scherm terug uit de achtergrond, dan meteen, maar nooit vaker dan `elkeMs`
 * (zie de rem, base44/tests/rem.test.js). Wat er al was, blijft staan als het
 * even niet lukt.
 *
 * @param {{ werk: () => Promise<any>, sleutel: string|null, actief: boolean, elkeMs: number }} opties
 *   sleutel: wat er gevraagd wordt (bijvoorbeeld het huis); een andere sleutel begint opnieuw
 * @returns {{ data: any, status: 'laden'|'klaar'|'fout'|'nietBijgewerkt'|'geweigerd', sleutel: string|null }}
 */
export function useHerhaald({ werk, sleutel, actief, elkeMs }) {
  const [uit, setUit] = useState(() => {
    const bekend = sleutel ? LAATST.get(sleutel) : null;
    return bekend?.data !== undefined ? { sleutel, data: bekend.data, status: 'klaar' } : { sleutel: null, data: null, status: 'laden' };
  });

  useEffect(() => {
    if (!actief || !sleutel) return undefined;
    let gestopt = false;
    let bezig = false;
    let timer;
    const lees = async () => {
      clearTimeout(timer);
      if (gestopt || bezig || document.visibilityState === 'hidden') return;
      // Ook na dicht en weer open (een ander tabblad en terug): niet vaker dan elkeMs.
      const bekend = LAATST.get(sleutel);
      const wacht = (bekend?.ms ?? 0) + elkeMs - Date.now();
      if (wacht > 0) {
        if (bekend.data !== undefined) setUit((oud) => (oud.sleutel === sleutel && oud.data === bekend.data ? oud : { sleutel, data: bekend.data, status: 'klaar' }));
        timer = setTimeout(lees, wacht);
        return;
      }
      bezig = true;
      LAATST.set(sleutel, { ms: Date.now(), data: bekend?.data });
      try {
        const data = await werk();
        // Ook als het scherm intussen dicht ging: dan staat het er bij de volgende keer openen meteen.
        LAATST.set(sleutel, { ms: LAATST.get(sleutel)?.ms ?? Date.now(), data });
        if (gestopt) return;
        setUit({ sleutel, data, status: 'klaar' });
      } catch (fout) {
        if (gestopt) return;
        if (fout?.soort === 'inloggen') {
          naarInloggen();
          return;
        }
        const status = fout?.soort === 'nietBijgewerkt' ? 'nietBijgewerkt' : ['geenHuis', 'alleenBeheerder', 'uitgeschakeld'].includes(fout?.soort) ? 'geweigerd' : 'fout';
        setUit((oud) => ({ sleutel, data: oud.sleutel === sleutel ? oud.data : null, status }));
      } finally {
        bezig = false;
      }
      if (!gestopt) timer = setTimeout(lees, elkeMs);
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
    // werk hoort bij de sleutel; een nieuwe functie per render begint niet opnieuw.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actief, sleutel, elkeMs]);

  if (uit.sleutel !== sleutel) return { sleutel, data: null, status: 'laden' };
  return uit;
}
