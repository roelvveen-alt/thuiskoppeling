import { RotateCw } from 'lucide-react';
import { lazy } from 'react';

/**
 * Een deel van de app dat pas laadt als het nodig is (React.lazy), zodat de
 * app sneller opent: Instellingen, de bladen, en de tabbladen Weer, Overzicht
 * en Apparaten. Hoofdscherm laadt ze kort na het openen toch al vooraf
 * (`vooraf`), zodat een tik er meteen is en er niets flikkert.
 *
 * Lukt het laden niet (geen verbinding), dan nog twee keer, na 1 en 2 s.
 * Een mislukte vooraf-poging telt niet: de volgende keer probeert het opnieuw.
 * Lukt het helemaal niet (ook: de app is net bijgewerkt en dit stuk bestaat
 * niet meer), dan een kaart met "Opnieuw laden" in plaats van een leeg scherm.
 *
 * In het voorbeeld (`--mode voorbeeld`, één los HTML-bestand) zit alles in
 * één bestand (vite.config.js): daar is laden meteen klaar.
 *
 * @param {() => Promise<{ default: Function }>} laad  bijvoorbeeld () => import('@/components/Delen')
 * @returns {{ Onderdeel: Function, vooraf: () => Promise<unknown> }}
 */
export function lui(laad, { pogingen = 3, wachtMs = 1000 } = {}) {
  let belofte = null;
  const probeer = async () => {
    for (let poging = 1; ; poging += 1) {
      try {
        return await laad();
      } catch (e) {
        if (poging >= pogingen) throw e;
        await new Promise((klaar) => setTimeout(klaar, wachtMs * poging));
      }
    }
  };
  const vooraf = () => {
    belofte ??= probeer().catch((e) => {
      belofte = null;
      throw e;
    });
    return belofte;
  };
  const Onderdeel = lazy(() => vooraf().catch(() => ({ default: NietGeladen })));
  return { Onderdeel, vooraf };
}

/** Dit stuk van de app kwam niet binnen: zeg dat, met een knop om de pagina opnieuw te laden. */
export function NietGeladen() {
  return (
    <div className="grid gap-3 rounded-xl border border-lijn bg-vlak px-3.5 py-3 text-[14px]" role="status">
      <p className="m-0">Dit deel van de app kwam niet binnen. Misschien is er even geen verbinding, of is de app net bijgewerkt.</p>
      <button type="button" className="knop justify-self-start" onClick={() => window.location.reload()}>
        <RotateCw size={18} aria-hidden="true" /> Opnieuw laden
      </button>
    </div>
  );
}

/** Na het openen, als de browser even niets te doen heeft (of na `ms`): alle delen alvast laden, één voor één. */
export function laadStraks(delen, { ms = 1500 } = {}) {
  let gestopt = false;
  const alles = async () => {
    for (const deel of delen) {
      if (gestopt) return;
      await deel.vooraf().catch(() => {});
    }
  };
  const id = setTimeout(() => {
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(() => alles(), { timeout: 3000 });
    else alles();
  }, ms);
  return () => {
    gestopt = true;
    clearTimeout(id);
  };
}
