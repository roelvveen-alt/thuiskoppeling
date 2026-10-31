import { Euro } from 'lucide-react';
import { euro, euroPerUur, kwh, prijsPerKwh, tijd, zinGeld } from '@/lib/opmaak';
import Tegel from './Tegel';

/**
 * Geld van dit moment, in één kaart (Nu): wat het net nu per uur kost of
 * oplevert, de stroomprijs met terugleveren, en hoe ver de Zonnebonus van
 * dit jaar is. Wat vandaag tot nu kostte, staat bij Overzicht › Vandaag.
 * Zonder prijs en zonder jaarstand niets.
 */
export default function GeldNu({ stand }) {
  const prijs = stand?.prijs ?? null;
  const jaar = stand?.jaar ?? null;
  if (!prijs && !jaar) return null;
  const perUur = euroPerUur(stand?.net_w, prijs);
  const kleur = perUur == null || Math.abs(perUur) < 0.005 ? undefined : perUur > 0 ? 'var(--let-op)' : 'var(--goed)';
  return (
    <Tegel soort="geld" icoon={Euro} kop="Geld">
      {prijs && (
        <>
          <span className="cijfer text-[22px] leading-tight font-bold" style={kleur ? { color: kleur } : undefined}>
            {perUur == null ? '–' : euro(perUur)}
            <span className="font-tekst text-[14px] font-semibold text-tekst-zacht"> per uur</span>
          </span>
          <span className="text-[13.5px] leading-snug text-tekst-zacht">{zinGeld(perUur, { prijs, net: stand?.net_w })}.</span>
          <span className="text-[13.5px] leading-snug text-tekst-zacht">
            Stroom kost nu <span className="cijfer font-semibold text-tekst">{prijsPerKwh(prijs.afname_kwh)}</span> per kWh, terugleveren levert{' '}
            <span className="cijfer font-semibold text-tekst">{prijsPerKwh(prijs.teruglevering_kwh)}</span>
            {prijs.zonnebonus_kwh > 0 ? ` (met ${prijsPerKwh(prijs.zonnebonus_kwh)} Zonnebonus)` : ''}
            {prijs.tot ? `, tot ${tijd(prijs.tot)}` : ''}.
          </span>
        </>
      )}
      {jaar && (
        <span className={`grid gap-1.5 ${prijs ? 'border-t border-lijn pt-2.5' : ''}`}>
          <span className="text-[13.5px] leading-snug">
            Zonnebonus dit jaar: <span className="cijfer font-semibold">{kwh(jaar.teruglevering_kwh)}</span> van {kwh(jaar.plafond_kwh)}
          </span>
          <span className="block h-1.5 overflow-hidden rounded-full bg-vlak-hoog" aria-hidden="true">
            <span
              className="block h-full rounded-full"
              style={{ width: `${Math.min(100, (100 * jaar.teruglevering_kwh) / jaar.plafond_kwh)}%`, background: 'var(--zon)' }}
            />
          </span>
          <span className="text-[13px] text-tekst-zacht">
            {jaar.teruglevering_kwh >= jaar.plafond_kwh
              ? 'Het plafond is bereikt: tot 1 januari geen Zonnebonus.'
              : `Nog ${kwh(jaar.plafond_kwh - jaar.teruglevering_kwh)} tot het plafond.`}
          </span>
        </span>
      )}
    </Tegel>
  );
}
