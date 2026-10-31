import { CloudOff, Hourglass } from 'lucide-react';

/** Wanneer er (nog) geen cijfers zijn: dan geen tegels met "0 W" of "Geen … gekoppeld", maar dit. */
export const ZONDER_CIJFERS = Object.freeze(['laden', 'fout', 'rem', 'nietBijgewerkt']);

const TEKST = {
  laden: { kop: 'Cijfers ophalen…', zin: 'Een paar tellen geduld.' },
  fout: { kop: 'Nog geen cijfers', zin: 'De app antwoordt even niet. Ik probeer het steeds opnieuw.' },
  rem: { kop: 'Nog geen cijfers', zin: 'Het is even druk. Ik probeer het zo opnieuw.' },
  nietBijgewerkt: { kop: 'Nog geen cijfers', zin: 'De app wordt net bijgewerkt. Ik probeer het zo opnieuw.' },
};

/**
 * Eén kaart in plaats van de tegels, zolang er nog geen enkele meting binnen
 * is. `tab`: staat hij alleen op een tabblad, dan is hij zelf het tabpaneel.
 */
export default function GeenCijfers({ status, tab = null }) {
  const { kop, zin } = TEKST[status] ?? TEKST.laden;
  const Icoon = status === 'laden' ? Hourglass : CloudOff;
  return (
    <section
      className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 rounded-2xl border border-lijn bg-vlak p-4"
      aria-busy={status === 'laden' ? 'true' : undefined}
      {...(tab ? { id: 'tabblad', role: 'tabpanel', 'aria-labelledby': `tab-${tab}` } : {})}
    >
      <Icoon size={22} className="mt-0.5 text-tekst-zacht" aria-hidden="true" />
      <div className="grid gap-1">
        <h2 className="text-[17px] font-bold">{kop}</h2>
        <p className="m-0 text-[14.5px] text-tekst-zacht">{zin}</p>
      </div>
    </section>
  );
}
