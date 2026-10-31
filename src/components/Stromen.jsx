import { vermogen } from '@/lib/opmaak';
import { PuntIcoon } from './iconen';

const KLEUR = { zon: 'var(--zon)', batterij: 'var(--batterij)', net: 'var(--net)', huis: 'var(--huis)', apparaat: 'var(--apparaat)' };

/**
 * "Komt van" of "Gaat naar": per regel het plaatje, de naam, het vermogen en
 * welk deel van het geheel, met een dun balkje (regels uit stromenZin.js).
 * De tekst blijft in de tekstkleur; het balkje en het plaatje dragen de kleur.
 * Het deel (balkje en %) alleen bij twee of meer regels: "100%" naast één
 * regel zegt niets, en leest als "krijgt alles". `deel={false}` laat het weg
 * waar de basis niet duidelijk is (door de meterkast).
 */
export default function Stromen({ titel, rijen, deel = true }) {
  if (rijen.length === 0) return null;
  const metDeel = deel && rijen.length > 1;
  return (
    <div className="grid gap-1">
      <h3 className="text-[13px] font-semibold tracking-wide text-tekst-zacht uppercase">{titel}</h3>
      <ul className="m-0 grid list-none p-0">
        {rijen.map((r) => {
          const kleur = KLEUR[r.punt.soort] ?? KLEUR.apparaat;
          const procent = Math.round(r.aandeel * 100);
          return (
            <li key={r.sleutel} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-lijn py-2">
              <span
                className="grid size-8 place-items-center rounded-full"
                style={{ color: kleur, background: `color-mix(in srgb, ${kleur} 14%, transparent)` }}
                aria-hidden="true"
              >
                <PuntIcoon punt={r.punt} size={16} strokeWidth={2.2} />
              </span>
              <span className="grid min-w-0 gap-1.5">
                <span className="truncate text-[14.5px]">{r.naam}</span>
                {metDeel && (
                  <span className="block h-1 overflow-hidden rounded-full bg-vlak-hoog" aria-hidden="true">
                    <span className="block h-full rounded-full" style={{ width: `${Math.max(2, procent)}%`, background: kleur }} />
                  </span>
                )}
              </span>
              <span className="text-right whitespace-nowrap">
                <span className="cijfer block text-[15px] font-semibold">{vermogen(r.w)}</span>
                {metDeel && <span className="block text-[12.5px] text-tekst-zacht">{procent}%</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
