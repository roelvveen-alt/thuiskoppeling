import { BatterijIcoon } from './iconen';
import { ArrowUpDown, BatteryMedium, Flame, Gauge, Hourglass, Layers, RefreshCw, Thermometer, TriangleAlert, Wifi, WifiHigh, WifiLow, WifiZero, Zap } from 'lucide-react';
import { createElement } from 'react';
import { zieApparaten } from './Bijwerken';
import { ACCUS_LOS, accusKort, BRUG_MET_BATTERIJ, batterijRegels, ouderDan, rendementRegel, wifiKwaliteit } from '@/lib/batterijGegevens';
import Uitklap from './Uitklap';

const ICOON = {
  storing: TriangleAlert,
  temperatuur: Thermometer,
  elektrisch: Zap,
  grenzen: ArrowUpDown,
  tijd: Hourglass,
  verwarmt: Flame,
  kalibreert: RefreshCw,
  accus: Layers,
  rendement: Gauge,
  cellen: Zap,
  limieten: ArrowUpDown,
};
const WIFI = { goed: Wifi, redelijk: WifiHigh, zwak: WifiLow, slecht: WifiZero };

/**
 * Wat de batterij zelf meldt: temperatuur, spanning, grenzen, hoe lang nog
 * (src/lib/batterijGegevens.js). In het batterijblad met een kopje, op het
 * tabblad Apparaten kleiner (`compact`). Zonder gegevens niets, behalve bij een
 * oudere versie van het programmaatje: dan een zinnetje dat het met 0.5.0 wel kan.
 *
 * @param {{ info: object|null, brugVersie?: string|null, compact?: boolean, opdracht?: boolean, batterijW?: number|null, verwacht?: object|null }} props
 *   opdracht: zeggen waar staat hoe je bijwerkt (de eigenaar), anders dat de eigenaar het weet; batterijW: stand.batterij_w;
 *   verwacht: de batterij uit de verwachting van Voorspelling (useVerwachting in src/lib/verwachting.js)
 */
export default function BatterijGegevens({ info, brugVersie = null, compact = false, opdracht = true, batterijW = null, verwacht = null, procent = null }) {
  const regels = batterijRegels(info, { batterijW, verwacht, procent });
  if (regels.length === 0) {
    if (!ouderDan(brugVersie, BRUG_MET_BATTERIJ)) return null;
    return (
      <p className="m-0 text-[13.5px] leading-relaxed text-tekst-zacht">
        Met versie {BRUG_MET_BATTERIJ} van het programmaatje zie je hier ook de temperatuur van de batterij, de spanning en meer.
        {' '}
        {compact && opdracht ? 'Hoe je het bijwerkt, staat bovenaan bij Het programmaatje thuis.' : zieApparaten(opdracht)}
      </p>
    );
  }
  // Het verwachte rendement nu (laden en weer leveren), bij de temperatuur van de koudste accu.
  regels.push(...rendementRegel(info));
  const maat = compact ? 16 : 18;
  // Veel accu's (tot drie 2400 AC's met elk 6, programmaatje 1.4.0): samen op één regel, elke accu apart in een blok dat dicht staat.
  const accuRegels = regels.filter((r) => r.sleutel.startsWith('accu-'));
  const samen = accuRegels.length > ACCUS_LOS ? accusKort(info.accus) : null;
  const getoond = samen ? regels.filter((r, i) => !r.sleutel.startsWith('accu-') || i === regels.indexOf(accuRegels[0])) : regels;
  const regel = (r, { klein = compact, rand = !compact } = {}) => {
    const icoon = r.sleutel === 'wifi' ? WIFI[wifiKwaliteit(info.wifi_dbm)] : r.sleutel.startsWith('accu-') ? BatterijIcoon : ICOON[r.sleutel];
    const kleur = r.letOp ? 'var(--let-op)' : 'var(--batterij)';
    return (
      <li key={r.sleutel} className={`grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2.5 ${rand ? 'border-b border-lijn py-2' : ''}`}>
        <span className="mt-0.5 flex" style={{ color: kleur }} aria-hidden="true">
          {createElement(icoon, { size: klein ? 16 : maat, strokeWidth: 2.2, ...(icoon === BatterijIcoon ? { procent: r.procent } : {}) })}
        </span>
        <span className="grid min-w-0 gap-0.5">
          <span className={`${klein ? 'text-[13.5px]' : 'text-[15px]'} leading-snug [overflow-wrap:anywhere]`} style={r.letOp ? { color: kleur } : undefined}>
            {r.tekst}
          </span>
          {r.bij && <span className="text-[12.5px] leading-snug text-tekst-zacht [overflow-wrap:anywhere]">{r.bij}</span>}
        </span>
      </li>
    );
  };
  return (
    <div className="grid min-w-0 gap-1.5">
      {!compact && <h3 className="text-[13px] font-semibold tracking-wide text-tekst-zacht uppercase">Wat de batterij zelf meldt</h3>}
      <ul className={`m-0 grid list-none p-0 ${compact ? 'gap-1.5' : ''}`}>
        {getoond.map((r) =>
          samen && r.sleutel.startsWith('accu-') ? (
            <li key="accus-samen" className={`grid min-w-0 gap-0.5 ${compact ? '' : 'border-b border-lijn py-2'}`}>
              <ul className="m-0 grid list-none p-0">{regel({ sleutel: 'accu-samen', ...samen }, { rand: false })}</ul>
              <Uitklap titel={`Elke accu apart (${accuRegels.length})`} tekst="text-[13.5px]">
                <ul className="m-0 grid list-none grid-cols-1 gap-x-4 gap-y-1.5 p-0 pt-1 sm:grid-cols-2" aria-label="Elke accu apart">
                  {accuRegels.map((a) => regel(a, { klein: true, rand: false }))}
                </ul>
              </Uitklap>
            </li>
          ) : (
            regel(r)
          ),
        )}
      </ul>
    </div>
  );
}
