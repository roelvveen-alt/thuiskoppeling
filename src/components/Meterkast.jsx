import { Clock, Droplet, Flame, Gauge, Thermometer, TrendingUp } from 'lucide-react';
import { createElement } from 'react';
import { hoeveel, meterkastRegels } from '@/lib/meterkast';
import Tegel from './Tegel';

/** Waar het gas vandaan komt (gasVoorPeriode in src/lib/gasStanden.js). */
const BRON = { standen: 'uit je ingevulde meterstanden', beide: 'van de slimme meter, aangevuld met je meterstanden' };

const ICOON = { tarief: Clock, piek: TrendingUp, 'meter-gas': Flame, 'meter-water': Droplet, 'meter-warm_water': Droplet };

/**
 * De meterkast in gewone woorden (src/lib/meterkast.js, programmaatje 1.4.0):
 * het tarief van nu, gas, water en warmte van vandaag met de meterstand, en de
 * maandpiek als de meter die geeft. Zonder meterkast-blok (een oudere brug of
 * functie) niets: geen lege kaart.
 *
 * @param {{ meterkast: object|null, dynamisch?: boolean, kop?: boolean }} props
 *   dynamisch: er is een prijs per kwartier (dan zegt het tarief niets over wat je betaalt);
 *   kop: met een kopje (in het blad van het net)
 */
export function MeterkastRegels({ meterkast, dynamisch = false, kop = false }) {
  const regels = meterkastRegels(meterkast, { dynamisch });
  if (!regels.length) return null;
  return (
    <section className="grid min-w-0 gap-1.5" aria-label="Meterkast">
      {kop && <h3 className="text-[13px] font-semibold tracking-wide text-tekst-zacht uppercase">Meterkast</h3>}
      <ul className="m-0 grid list-none gap-1.5 p-0">
        {regels.map((r) => (
          <li key={r.sleutel} className="grid min-h-11 grid-cols-[auto_minmax(0,1fr)] items-start gap-2.5 py-0.5">
            <span className="mt-0.5 flex" style={{ color: 'var(--net)' }} aria-hidden="true">
              {createElement(ICOON[r.sleutel] ?? Thermometer, { size: 18, strokeWidth: 2.2 })}
            </span>
            <span className="grid min-w-0 gap-0.5">
              <span className="cijfer text-[15px] leading-snug [overflow-wrap:anywhere]">{r.tekst}</span>
              {r.bij && <span className="text-[12.5px] leading-snug text-tekst-zacht [overflow-wrap:anywhere]">{r.bij}</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Op het tabblad Nu: een tegel Meterkast, alleen als er iets te zeggen is. */
export function MeterkastNu({ stand }) {
  if (!meterkastRegels(stand?.meterkast ?? null, { dynamisch: Boolean(stand?.prijs) }).length) return null;
  return (
    <Tegel soort="net" icoon={Gauge} kop="Meterkast">
      <MeterkastRegels meterkast={stand.meterkast} dynamisch={Boolean(stand?.prijs)} />
    </Tegel>
  );
}

/**
 * Gas, water en warmte over een dag of periode (Overzicht, programmaatje 1.4.0).
 * Alleen wat er is: zonder gasmeter geen gas, zonder iets geen tegel. Alleen m³
 * (en GJ): een gasprijs kent de app (nog) niet.
 *
 * @param {{ gas?: number|null, water?: number|null, warmte?: number|null, wanneer: string, bron?: string|null }} props
 *   wanneer: "vandaag", "deze week", …; bron van het gas (gasVoorPeriode): 'meter', 'standen' of 'beide'
 */
export function GasEnWater({ gas = null, water = null, warmte = null, wanneer, bron = null }) {
  const delen = [
    gas === null ? null : { naam: 'Gas', waarde: hoeveel(gas, 'm3') },
    water === null ? null : { naam: 'Water', waarde: hoeveel(water, 'm3') },
    warmte === null ? null : { naam: 'Warmte', waarde: hoeveel(warmte, 'GJ') },
  ].filter(Boolean);
  if (!delen.length) return null;
  const [eerste, ...rest] = delen;
  return (
    <Tegel
      soort="net"
      icoon={gas === null ? Droplet : Flame}
      kop={`${delen.map((d, i) => (i ? d.naam.toLowerCase() : d.naam)).join(' en ')} ${wanneer}`}
      waarde={eerste.waarde}
      zin={[...rest.map((d) => `${d.naam.toLowerCase()} ${d.waarde}`), BRON[bron] ?? (rest.length ? null : 'volgens de slimme meter')].filter(Boolean).join(' · ')}
    />
  );
}
