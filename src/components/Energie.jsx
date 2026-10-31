import { Zap } from 'lucide-react';
import { delenVan } from '@/lib/dagoverzicht';
import { deel, kwhDag } from '@/lib/opmaak';
import Tegel from './Tegel';

const KLEUR = { zon: 'var(--zon)', huis: 'var(--huis)', batterij: 'var(--batterij)', net: 'var(--net)' };

/**
 * De kWh van vandaag of een periode in één kaart, in de volgorde van de keten
 * (zon, batterij, huis, net), met zelfvoorzienend en eigen verbruik eronder in
 * een gewone zin, uit dezelfde getallen (delenVan). Een getal dat er niet is,
 * staat er niet. `kwhTekst`: hoe een getal eruitziet (vandaag 1 decimaal).
 */
export default function Energie({ kop = 'Energie', zon = null, huis = null, geladen = null, ontladen = null, afname = null, terug = null, kwhTekst = kwhDag }) {
  const rijen = [
    ['zon', 'Zon opgewekt', zon],
    ['batterij', 'Batterij geladen', geladen],
    ['batterij', 'Batterij ontladen', ontladen],
    ['huis', 'Huis verbruikt', huis],
    ['net', 'Uit het net', afname],
    ['net', 'Terug\u00adgeleverd', terug],
  ].filter(([, , v]) => v !== null && v !== undefined);
  if (rijen.length === 0) return null;
  const { zelfvoorzienend, eigenVerbruik } = delenVan({ zon, huis, afname, terug });
  return (
    <Tegel soort="huis" icoon={Zap} kop={kop} breed>
      <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {rijen.map(([soort, label, v]) => (
          <div key={label} className="grid min-w-0 gap-0.5">
            <dt className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-tekst-zacht">
              <span className="size-2 flex-none rounded-full" style={{ background: KLEUR[soort] }} aria-hidden="true" />
              <span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>
            </dt>
            <dd className="cijfer m-0 text-[17px] font-bold">{kwhTekst(v)}</dd>
          </div>
        ))}
      </dl>
      {(zelfvoorzienend !== null || eigenVerbruik !== null) && (
        <div className="grid gap-1 border-t border-lijn pt-2.5 text-[13.5px] leading-snug">
          {zelfvoorzienend !== null && (
            <p className="m-0">
              <span className="font-semibold">Zelfvoorzienend {deel(zelfvoorzienend)}</span>
              <span className="text-tekst-zacht">
                {afname > huis && geladen > 0
                  ? `: het huis gebruikte ${kwhTekst(huis)}. Er kwam ${kwhTekst(afname)} uit het net, ook om de batterij te laden (${kwhTekst(geladen)}); stroom die via de batterij uit het net kwam, telt als net.`
                  : `: het huis gebruikte ${kwhTekst(huis)}, en ${kwhTekst(afname)} kwam uit het net.`}
              </span>
            </p>
          )}
          {eigenVerbruik !== null && (
            <p className="m-0">
              <span className="font-semibold">Eigen verbruik {deel(eigenVerbruik)}</span>
              <span className="text-tekst-zacht">
                {terug > zon
                  ? `: er ging meer terug naar het net (${kwhTekst(terug)}) dan de zon opwekte (${kwhTekst(zon)}); de batterij leverde ook terug.`
                  : `: van ${kwhTekst(zon)} zon ging ${kwhTekst(terug)} terug naar het net.`}
              </span>
            </p>
          )}
        </div>
      )}
    </Tegel>
  );
}
