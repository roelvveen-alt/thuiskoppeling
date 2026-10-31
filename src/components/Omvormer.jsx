import { Activity, Cable, Gauge, Moon, ShieldAlert, ShieldCheck, SolarPanel, Sun, Thermometer, TriangleAlert, UtilityPole, Zap } from 'lucide-react';
import { createElement } from 'react';
import { omvormerRegels } from '@/lib/omvormer';

/** Het icoon bij een regel uit omvormerRegels; de sleutel van een storing of paneelrij heeft een nummer erachter. */
function icoonVoor(sleutel, stand, letOp = false) {
  if (sleutel === 'isolatie') return letOp ? ShieldAlert : ShieldCheck;
  if (sleutel.startsWith('storing-') || sleutel === 'waarschuwing') return TriangleAlert;
  if (sleutel.startsWith('rij-')) return SolarPanel;
  if (sleutel === 'stand') return stand === 'slaapt' ? Moon : stand === 'storing' || stand === 'weg' ? TriangleAlert : Activity;
  return { beperkt: Gauge, net: UtilityPole, temperatuur: Thermometer, opbrengst: Sun, lekstroom: Zap, elektrisch: Cable }[sleutel] ?? Activity;
}

/**
 * Wat de omvormer zelf meldt (src/lib/omvormer.js): de temperatuur bovenaan en
 * groot, dan storingen in de let-op-kleur, de stand, de spanning per paneelrij
 * (alleen rijen met spanning) en per fase, en de opbrengst van vandaag. In het blad van de zon met een
 * kopje, op het tabblad Apparaten kleiner (`compact`). Zonder gegevens niets.
 *
 * @param {{ omvormer: object|null, compact?: boolean }} props  omvormer zoals omvormerUit (bron.js) het geeft
 */
export default function Omvormer({ omvormer, compact = false }) {
  const regels = omvormerRegels(omvormer);
  if (regels.length === 0) return null;
  const maat = compact ? 16 : 18;
  return (
    <section className="grid min-w-0 gap-1.5" aria-label="Wat de omvormer zelf meldt">
      {!compact && <h3 className="text-[13px] font-semibold tracking-wide text-tekst-zacht uppercase">Omvormer</h3>}
      <ul className={`m-0 grid list-none p-0 ${compact ? 'gap-1.5' : ''}`}>
        {regels.map((r) => {
          const kleur = r.letOp ? 'var(--let-op)' : 'var(--zon)';
          if (r.groot) {
            return (
              <li key={r.sleutel} className={`flex min-w-0 items-center gap-2.5 ${compact ? 'pb-0.5' : 'border-b border-lijn py-2.5'}`}>
                <span className="flex" style={{ color: kleur }} aria-hidden="true">
                  {createElement(icoonVoor(r.sleutel, omvormer.stand), { size: compact ? 22 : 26, strokeWidth: 2.2 })}
                </span>
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                  <span className={`font-semibold tabular-nums ${compact ? 'text-[20px]' : 'text-[26px]'} leading-tight`}>{r.tekst}</span>
                  {r.bij && <span className="text-[12.5px] leading-snug text-tekst-zacht">{r.bij}</span>}
                </span>
              </li>
            );
          }
          return (
            <li key={r.sleutel} className={`grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2.5 ${compact ? '' : 'border-b border-lijn py-2'}`}>
              <span className="mt-0.5 flex" style={{ color: kleur }} aria-hidden="true">
                {createElement(icoonVoor(r.sleutel, omvormer.stand, r.letOp), { size: maat, strokeWidth: 2.2 })}
              </span>
              <span className="grid min-w-0 gap-0.5">
                <span
                  className={`[overflow-wrap:anywhere] ${compact ? 'text-[13.5px] leading-snug' : 'text-[15px] leading-snug'}`}
                  style={r.letOp ? { color: kleur } : undefined}
                >
                  {r.tekst}
                </span>
                {r.bij && <span className="text-[12.5px] leading-snug text-tekst-zacht">{r.bij}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
