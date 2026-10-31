import { ChevronRight } from 'lucide-react';
import { createElement } from 'react';
import { BatterijIcoon } from './iconen';

const KLEUR = { zon: 'var(--zon)', batterij: 'var(--batterij)', net: 'var(--net)', huis: 'var(--huis)', apparaat: 'var(--apparaat)', geld: 'var(--goed)' };

/** Een rond plaatje in de kleur van wat het is; de tekst ernaast blijft in de tekstkleur. */
export function Rondje({ soort, icoon, maat = 36, procent }) {
  const kleur = KLEUR[soort] ?? KLEUR.apparaat;
  return (
    <span
      className="grid flex-none place-items-center rounded-full"
      style={{ width: maat, height: maat, color: kleur, background: `color-mix(in srgb, ${kleur} 14%, transparent)` }}
      aria-hidden="true"
    >
      {createElement(icoon, { size: Math.round(maat / 2), strokeWidth: 2.2, ...(icoon === BatterijIcoon ? { procent } : {}) })}
    </span>
  );
}

/**
 * Een tegel: plaatje, kopje, één groot getal en een paar regels uitleg. Met
 * `onKies` is de hele tegel een knop (met een pijltje), anders een vakje.
 * In een smalle tegel (twee naast elkaar op de telefoon) staat het kopje onder
 * het plaatje, zodat het niet afgebroken hoeft te worden (zie .tegel-kop).
 * `rekMee={false}`: op een groot scherm zo hoog als de eigen inhoud, niet zo
 * hoog als de hoogste buur in de rij (weergave-17).
 */
export default function Tegel({ soort, icoon, kop, waarde, zin, children, onKies, breed = false, rekMee = true, procent }) {
  const inhoud = (
    <>
      <span className="tegel-kop">
        {icoon && (
          <span className="tegel-icoon">
            <Rondje soort={soort} icoon={icoon} procent={procent} />
          </span>
        )}
        <span className="tegel-titel line-clamp-2 text-[12px] leading-tight font-semibold tracking-wide text-tekst-zacht uppercase [overflow-wrap:anywhere] [hyphens:auto]">
          {kop}
        </span>
        {onKies && <ChevronRight size={18} className="tegel-pijl text-tekst-zacht" aria-hidden="true" />}
      </span>
      {waarde !== undefined && <span className="cijfer text-[22px] leading-tight font-bold [overflow-wrap:anywhere]">{waarde}</span>}
      {zin && <span className="text-[13.5px] leading-snug text-tekst-zacht">{zin}</span>}
      {children}
    </>
  );
  const vorm = `tegel grid ${rekMee ? 'h-full' : 'h-full lg:h-auto lg:self-start'} w-full min-w-0 grid-cols-1 content-start gap-2 rounded-2xl border border-lijn bg-vlak p-3.5 text-left text-tekst ${breed ? 'col-span-full' : ''}`;
  if (onKies) {
    return (
      <button type="button" onClick={onKies} className={`${vorm} cursor-pointer hover:bg-vlak-hoog`}>
        {inhoud}
      </button>
    );
  }
  return <div className={vorm}>{inhoud}</div>;
}
