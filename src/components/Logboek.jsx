import { CircleAlert, CircleCheck, Cpu, Gauge, NotebookText, SolarPanel, WifiOff } from 'lucide-react';
import { createElement } from 'react';
import { hoeLang, wanneer, watTekst } from '@/lib/logboek';
import { Rondje } from './Tegel';
import { BatterijIcoon } from './iconen';

const ICOON = { batterij: BatterijIcoon, omvormer: SolarPanel, meter: Gauge, melding: Cpu, stil: WifiOff };

const STATUS = {
  laden: 'Het logboek wordt geladen.',
  nietBijgewerkt: 'Het logboek komt er zo bij: de app wordt net bijgewerkt.',
  geweigerd: 'Het logboek is er niet voor jou.',
  fout: 'Het logboek lukt even niet. Ik probeer het zo opnieuw.',
};

/**
 * De kaart Logboek op Apparaten: per storing wanneer het begon, wat het was en
 * hoe lang het duurde (src/lib/logboek.js). Wat nog loopt, staat in let-op;
 * wat voorbij is, met een vinkje. Rustig: dit is een lijst, geen alarm.
 *
 * @param {{ gebeurtenissen: object[], status: string, nu: number }} props  uit useLogboek
 */
export default function Logboek({ gebeurtenissen, status, nu }) {
  const leeg = gebeurtenissen.length === 0;
  return (
    <section className="grid min-w-0 grid-cols-1 gap-2 rounded-2xl border border-lijn bg-vlak p-3.5" aria-labelledby="logboek-kop">
      <span className="flex items-center gap-2.5">
        <Rondje soort="apparaat" icoon={NotebookText} />
        <h3 id="logboek-kop" className="text-[12.5px] font-semibold tracking-wide text-tekst-zacht uppercase">
          Logboek
        </h3>
      </span>
      {leeg ? (
        <p className="m-0 text-[14px] leading-relaxed text-tekst-zacht">
          {STATUS[status] ?? 'Nog geen storingen. Meldt de batterij, de omvormer, een meter of het programmaatje iets, dan zie je hier wanneer en hoe lang.'}
        </p>
      ) : (
        <ul className="m-0 grid list-none grid-cols-1 gap-0 p-0">
          {gebeurtenissen.map((g) => {
            const loopt = g.eind === null && g.loopt;
            return (
              <li key={g.id} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 border-t border-lijn py-2 first:border-t-0">
                <span className="mt-0.5 text-tekst-zacht" aria-hidden="true">
                  {createElement(ICOON[g.soort] ?? CircleAlert, { size: 18 })}
                </span>
                <span className="grid min-w-0 gap-0.5">
                  <span className="text-[14.5px] leading-snug [overflow-wrap:anywhere]">{watTekst(g)}</span>
                  <span className="flex flex-wrap items-center gap-x-2 text-[13px] text-tekst-zacht">
                    <span className="cijfer">{wanneer(g, nu)}</span>
                    <span aria-hidden="true">·</span>
                    <span className={`inline-flex items-center gap-1${loopt ? ' text-let-op' : ''}`}>
                      {loopt && <CircleAlert size={14} aria-hidden="true" />}
                      {g.eind !== null && <CircleCheck size={14} style={{ color: 'var(--goed)' }} aria-hidden="true" />}
                      {hoeLang(g, nu)}
                    </span>
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {!leeg && status !== 'klaar' && STATUS[status] && <p className="m-0 text-[13px] text-tekst-zacht">{STATUS[status]}</p>}
    </section>
  );
}
