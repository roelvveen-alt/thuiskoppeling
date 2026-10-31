import { Lightbulb, LightbulbOff, ToggleLeft, ToggleRight } from 'lucide-react';
import { lampTekst } from '@/lib/lampen';
import { Rondje } from './Tegel';

/**
 * Lampen en schakelaars zonder meter (programmaatje 0.8.0, Tuya), bij
 * Apparaten: alleen of ze aan of uit zijn. Kijken, nooit schakelen: er zit
 * dus ook geen knop in. Zonder lampen niets (een oudere versie, of geen Tuya).
 */
export default function Lampen({ lampen }) {
  if (!lampen?.length) return null;
  return (
    <section className="grid min-w-0 grid-cols-1 gap-2 rounded-2xl border border-lijn bg-vlak p-3.5" aria-label="Lampen en schakelaars">
      <span className="flex items-center gap-2.5">
        <Rondje soort="zon" icoon={Lightbulb} />
        <span className="text-[12.5px] font-semibold tracking-wide text-tekst-zacht uppercase">Lampen en schakelaars</span>
      </span>
      <ul className="m-0 grid list-none grid-cols-1 gap-1.5 p-0">
        {lampen.map((l) => {
          const Icoon = l.soort === 'schakelaar' ? (l.aan ? ToggleRight : ToggleLeft) : l.aan ? Lightbulb : LightbulbOff;
          return (
            <li key={l.sleutel} className="grid min-h-11 min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 text-[14.5px]">
              <Icoon size={18} aria-hidden="true" style={{ color: l.aan ? 'var(--zon)' : 'var(--tekst-zacht)' }} />
              <span className="min-w-0 truncate">
                {l.naam || (l.soort === 'schakelaar' ? 'Schakelaar' : 'Lamp')}
                {l.spots && <span className="text-tekst-zacht"> · spots in het overstek</span>}
              </span>
              <span className="text-right font-semibold" style={l.aan === null ? { color: 'var(--let-op)' } : undefined}>
                {lampTekst(l)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
