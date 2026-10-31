import { useEffect, useRef } from 'react';
import { veegDicht, veegStap, zetPaginaVast } from './blad';

/**
 * Wat elk onderblad doet (Detail.jsx, het blad van een apparaat op Overzicht):
 * de pagina erachter staat stil, omlaag vegen sluit (src/lib/blad.js), Escape
 * sluit, de focus gaat naar de sluitknop en daarna terug, en wat achter het
 * blad ligt is zolang onbereikbaar (inert), zoals aria-modal belooft.
 *
 * Het blad moet een broertje zijn van wat erachter ligt: in Hoofdscherm, of
 * via een portaal in document.body.
 * @returns {{ blad: import('react').RefObject, sluitKnop: import('react').RefObject }}
 */
export function useBlad(onSluit) {
  const sluitKnop = useRef(null);
  const blad = useRef(null);
  const sluiten = useRef(onSluit);

  useEffect(() => {
    sluiten.current = onSluit;
  });

  // De pagina erachter staat stil zolang het blad open is.
  useEffect(() => zetPaginaVast(), []);

  // Omlaag vegen als het blad bovenaan staat: het gaat mee, en ver of vlot genoeg gaat het dicht (src/lib/blad.js).
  useEffect(() => {
    const el = blad.current;
    if (!el) return undefined;
    let staat = null;
    let weg = null;
    const zet = (px) => el.style.setProperty('--sleep', `${px}px`);
    const start = (e) => {
      staat = e.touches.length === 1 ? veegStap(null, { y: e.touches[0].clientY, t: e.timeStamp }) : null;
    };
    const beweeg = (e) => {
      if (!staat) return;
      staat = veegStap(staat, { y: e.touches[0].clientY, scrollTop: el.scrollTop, t: e.timeStamp });
      if (staat.modus !== 'slepen') return;
      e.preventDefault();
      el.classList.add('slepen');
      zet(staat.dy);
    };
    const einde = (e) => {
      if (!staat) return;
      const dicht = veegDicht(staat, { hoogte: el.offsetHeight, t: e.timeStamp });
      el.classList.remove('slepen');
      staat = null;
      if (!dicht) {
        zet(0);
        return;
      }
      zet(el.offsetHeight);
      const zonderBeweging = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      weg = setTimeout(() => sluiten.current(), zonderBeweging ? 0 : 160);
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', beweeg, { passive: false });
    el.addEventListener('touchend', einde);
    el.addEventListener('touchcancel', einde);
    return () => {
      clearTimeout(weg);
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', beweeg);
      el.removeEventListener('touchend', einde);
      el.removeEventListener('touchcancel', einde);
    };
  }, []);

  useEffect(() => {
    const terugNaar = document.activeElement;
    // Wat achter het blad ligt (kop, tabblad, tabbalk) is zolang onbereikbaar:
    // met Tab blijf je in het blad, zoals aria-modal belooft.
    const achter = [...(blad.current?.parentElement?.children ?? [])].filter(
      (el) => el !== blad.current && !el.classList.contains('blad-achter') && !el.hasAttribute('inert'),
    );
    for (const el of achter) el.setAttribute('inert', '');
    sluitKnop.current?.focus();
    const esc = (e) => e.key === 'Escape' && sluiten.current();
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('keydown', esc);
      for (const el of achter) el.removeAttribute('inert');
      terugNaar?.focus?.();
    };
  }, []);

  return { blad, sluitKnop };
}
