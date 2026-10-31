import { LogOut, Plus, RotateCw } from 'lucide-react';
import { useId } from 'react';
import { uitloggen } from '@/api/huis';
import NaamFormulier from './NaamFormulier';

/** Een los scherm (welkom, de sleutel, iets mis) met de naam van de app erboven. */
export function Pagina({ children }) {
  return (
    <div className="schil">
      <header className="pb-4">
        <h1 className="text-[27px] leading-[1.05] font-extrabold tracking-[-0.02em]">Energie thuis</h1>
      </header>
      <main className="grid max-w-[560px] gap-4">{children}</main>
    </div>
  );
}

export function Kaart({ titel, children }) {
  const id = useId();
  return (
    <section className="grid gap-4 rounded-2xl border border-lijn bg-vlak p-4" aria-labelledby={id}>
      <h2 id={id} className="text-[21px] font-bold">
        {titel}
      </h2>
      {children}
    </section>
  );
}

export function Wachten({ tekst }) {
  return (
    <Pagina>
      <p className="m-0 text-tekst-zacht" role="status">
        {tekst}
      </p>
    </Pagina>
  );
}

const UitlogKnop = () => (
  <button type="button" className="knop" onClick={uitloggen}>
    <LogOut size={18} aria-hidden="true" /> Uitloggen
  </button>
);

/** Iets is mis: zeg wat, en wat je kunt doen. */
export function Probleem({ titel, tekst, onOpnieuw, metUitloggen = false }) {
  return (
    <Pagina>
      <Kaart titel={titel}>
        <p className="m-0 text-[15px]" role="alert">
          {tekst}
        </p>
        <div className="flex flex-wrap gap-2">
          {onOpnieuw && (
            <button type="button" className="knop knop-hoofd" onClick={onOpnieuw}>
              <RotateCw size={18} aria-hidden="true" /> Opnieuw proberen
            </button>
          )}
          {metUitloggen && <UitlogKnop />}
        </div>
      </Kaart>
    </Pagina>
  );
}

/**
 * Ingelogd, maar niemand heeft je uitgenodigd. De registratie van Base44 is
 * niet dicht te zetten; zo iemand ziet niets en kan niets maken (dat beslist
 * de functie, base44/shared/toegang.js).
 */
export function NietUitgenodigd({ email, onOpnieuw }) {
  return (
    <Pagina>
      <Kaart titel="Nog geen toegang">
        <p className="m-0 text-[15px]">
          Je bent ingelogd als <strong className="break-all">{email || 'onbekend'}</strong>, maar je hoort nog bij geen
          enkel huis. Vraag degene die je uitnodigde om je toe te voegen (in de app: Instellingen › Delen), met
          precies dit e-mailadres. Daarna zie je het hier vanzelf.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="knop knop-hoofd" onClick={onOpnieuw}>
            <RotateCw size={18} aria-hidden="true" /> Opnieuw kijken
          </button>
          <UitlogKnop />
        </div>
      </Kaart>
    </Pagina>
  );
}

/** De eerste keer (alleen de beheerder komt hier): een omgeving maken. Daarna komt de sleutel (Sleutel.jsx). */
export function Welkom({ email, onMaak }) {
  return (
    <Pagina>
      <Kaart titel="Welkom">
        <p className="m-0 text-[15px]">
          Maak je huis aan. Daar komen de cijfers van je huis in, van je eigen programmaatje thuis. Alleen jij ziet
          ze, en wie jij uitnodigt om mee te kijken.
        </p>
        <NaamFormulier
          label="Naam van je huis"
          plaatshouder="Bijvoorbeeld Thuis of Vakantiehuis"
          begin="Thuis"
          knop="Huis maken"
          Icoon={Plus}
          onBewaar={onMaak}
        />
        <p className="m-0 text-[13.5px] text-tekst-zacht">
          Ingelogd als <span className="break-all">{email}</span>.
        </p>
      </Kaart>
    </Pagina>
  );
}
