import { Euro, House, Sun, UtilityPole, Zap } from 'lucide-react';
import { createElement, useId } from 'react';
import { faseGrenzen, zwareFaseZin } from '@/lib/fasen';
import { nuInWoorden } from '@/lib/nuInWoorden';
import { plekNaam } from '@/lib/opmaak';
import { BatterijIcoon } from './iconen';

const ICOON = { zon: Sun, batterij: BatterijIcoon, huis: House, net: UtilityPole, prijs: Euro, fase: Zap };
const KLEUR = { zon: 'var(--zon)', batterij: 'var(--batterij)', huis: 'var(--huis)', net: 'var(--net)', prijs: 'var(--net)', fase: 'var(--let-op)' };

/**
 * Nu in woorden (src/lib/nuInWoorden.js): de keten van dit moment, per zin
 * een klein plaatje in de kleur van waar de zin over gaat, en daaronder
 * hooguit twee zinnen erbij in zachtere letters. Zonder zinnen niets, dus
 * nooit een lege kaart.
 *
 * `kaart` = met rand en achtergrond (Huis en Nu); zonder voor in een blad.
 * `kop` = het niveau van de titel: h3 onder een andere titel (Nu, een blad).
 * `grenzen` = de grens en zekering per fase van dit huis (faseGrenzen); zonder de standaard.
 * Een zware fase staat er rustig in de kleur let-op bij (geen alarm).
 */
export default function NuInWoorden({ stand, verdeling, punten = [], grenzen = faseGrenzen(), kaart = true, kop = 'h2', className = '' }) {
  const titel = useId();
  // De naam van een plek met panelen zoals overal in de app: een eigen naam, anders die van thuis, zonder "Zon" ervoor.
  const naamVan = (sleutel) => plekNaam(punten.find((p) => p.sleutel === sleutel)?.naam || stand?.zonnen?.find((z) => z.sleutel === sleutel)?.naam);
  const { keten, erbij } = nuInWoorden(stand, verdeling, { naamVan, zwareFase: zwareFaseZin(stand?.fasen, grenzen) });
  if (keten.length === 0 && erbij.length === 0) return null;

  const regel = (zin, i, zacht) => (
    <li key={`${zin.soort}-${i}`} className="grid grid-cols-[18px_minmax(0,1fr)] items-start gap-2.5">
      <span className="mt-[2px] grid h-[18px] place-items-center" style={{ color: KLEUR[zin.soort] }} aria-hidden="true">
        {createElement(ICOON[zin.soort], { size: 17, strokeWidth: 2.2, ...(zin.soort === 'batterij' ? { procent: stand?.batterij_procent ?? undefined } : {}) })}
      </span>
      <span className={zin.soort === 'fase' ? 'text-[14px] leading-snug text-let-op' : zacht ? 'text-[14px] leading-snug text-tekst-zacht' : 'text-[15px] leading-snug'}>{zin.tekst}</span>
    </li>
  );

  return (
    <section
      className={`${kaart ? 'grid min-w-0 gap-2.5 rounded-2xl border border-lijn bg-vlak p-3.5' : 'grid min-w-0 gap-2'} ${className}`.trim()}
      aria-labelledby={titel}
    >
      {createElement(kop, { id: titel, className: 'text-[13px] font-semibold tracking-wide text-tekst-zacht uppercase' }, 'Nu in woorden')}
      <ul className="m-0 grid list-none gap-2 p-0">{keten.map((zin, i) => regel(zin, i, false))}</ul>
      {erbij.length > 0 && <ul className="m-0 grid list-none gap-1.5 border-t border-lijn p-0 pt-2.5">{erbij.map((zin, i) => regel(zin, i, true))}</ul>}
    </section>
  );
}
