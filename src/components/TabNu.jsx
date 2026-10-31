import { ArrowDownUp, House, Plug, Sun, UtilityPole } from 'lucide-react';
import { plekNaam, procent, vermogen, HUIS_ONBEKEND, huisOnbekend } from '@/lib/opmaak';
import { ZON_SAMEN } from '@/lib/opstelling';
import { FasenNu } from './Fasen';
import GeldNu from './GeldNu';
import { MeterkastNu } from './Meterkast';
import { werkwoord } from './HuisBeeld';
import { BatterijIcoon, PuntIcoon } from './iconen';
import Tegel from './Tegel';

const KLEUR = { zon: 'var(--zon)', batterij: 'var(--batterij)', net: 'var(--net)', huis: 'var(--huis)' };
const NAAM = { zon: 'Zon', batterij: 'Batterij', net: 'Net', huis: 'Huis' };

/**
 * Eén regel onder het grote getal: wat het nu doet, met dezelfde woorden en
 * drempels als de tekening (werkwoord in HuisBeeld). Wie aan wie levert staat
 * eronder in één kaart, en in zinnen op Huis: hier niet nog eens.
 */
export function staatNu(soort, w) {
  if (w == null) return { zon: 'Geen panelen gekoppeld', batterij: 'Geen batterij gekoppeld', net: 'Geen meter gekoppeld', huis: HUIS_ONBEKEND }[soort];
  const ww = werkwoord(soort, w)?.kort;
  switch (soort) {
    case 'zon':
      return ww ? 'Levert nu' : 'Levert nu niets';
    case 'batterij':
      return ww === 'laadt' ? 'Laadt nu' : ww === 'levert' ? 'Levert nu' : 'Laadt niet en levert niets';
    case 'net':
      return ww === 'neemt af' ? 'Je neemt nu af' : ww === 'terug' ? 'Je levert nu terug' : 'Er gaat bijna niets in of uit';
    default:
      return 'Gebruikt nu';
  }
}

/** Wie levert aan wie, samengeteld per soort (alle zonneplekken samen "Zon"), grootste eerst. */
function wieAanWie(stromen, soortVan) {
  const som = new Map();
  for (const s of stromen) {
    const van = soortVan(s.van);
    const naar = soortVan(s.naar);
    if (!NAAM[van] || !NAAM[naar]) continue;
    const sleutel = `${van}>${naar}`;
    som.set(sleutel, { van, naar, w: (som.get(sleutel)?.w ?? 0) + s.w });
  }
  return [...som.values()].sort((a, b) => b.w - a.w);
}

/**
 * Tabblad Nu: de cijfers van dit moment. Vier tegels in de volgorde van de
 * keten (zon, batterij, huis, net), wie aan wie levert, de apparaten, de
 * fasen en het geld. Nu in woorden staat op Huis. Een tik op een tegel opent
 * het blad met details, waar dat er is; de Zon-tegel bij meer plekken met
 * panelen het blad van alle plekken samen (ZON_SAMEN), met elke plek erin.
 * `grenzen`: de grens en zekering per fase van dit huis (faseGrenzen); zonder de standaard.
 */
export default function TabNu({ stand, verdeling, punten, onKies, grenzen }) {
  const puntVan = (sleutel) => punten.find((p) => p.sleutel === sleutel);
  // Ook zonder punt (een plek die nog niet op de foto staat) weten we wat een zon-plek is.
  const soortVan = (sleutel) =>
    puntVan(sleutel)?.soort ?? (sleutel === 'zon' || stand?.zonnen?.some((z) => z.sleutel === sleutel) ? 'zon' : NAAM[sleutel] ? sleutel : null);
  const zonnen = (stand?.zonnen ?? []).filter((z) => z?.sleutel);
  const eersteZon = zonnen[0]?.sleutel ?? 'zon';
  // De eigen namen uit Instellingen › Namen (die belooft "overal in de app"); meer zonneplekken samen heten Zon.
  const naamVan = (soort) =>
    (soort === 'zon' ? (zonnen.length > 1 ? null : puntVan(eersteZon)?.naam) : puntVan(soort)?.naam) || NAAM[soort];
  const stromen = wieAanWie(verdeling.stromen, soortVan);
  const grootste = Math.max(1, ...stromen.map((s) => s.w));
  const zonW = stand?.zon_w == null && !zonnen.length ? null : verdeling.zon_w;
  const apparaten = (stand?.apparaten ?? [])
    .map((a) => ({ ...a, punt: puntVan(a.sleutel) }))
    .sort((a, b) => (b.vermogen_w ?? 0) - (a.vermogen_w ?? 0));
  const huisW = Math.max(verdeling.huis_w, 1);

  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-2.5 lg:grid-cols-2" id="tabblad" role="tabpanel" aria-labelledby="tab-nu">
      <h2 className="col-span-full text-[22px] font-bold">Nu</h2>
      {/* Op een groot scherm vier naast elkaar, elk zo hoog als zijn inhoud: niet uitgerekt tot de hoogste (weergave-17). */}
      <div className="col-span-full grid grid-cols-2 gap-2.5 lg:grid-cols-4 lg:items-start">
        <Tegel rekMee={false} soort="zon" icoon={Sun} kop={naamVan('zon')} waarde={vermogen(zonW)} onKies={() => onKies(zonnen.length > 1 ? ZON_SAMEN : eersteZon)}>
          {zonnen.length > 1 ? (
            // Past de plek met zijn getal niet naast elkaar (320 px), dan schuift het getal naar de volgende regel.
            <ul className="m-0 grid min-w-0 list-none gap-0.5 p-0 text-[13px] text-tekst-zacht">
              {zonnen.map((z) => (
                <li key={z.sleutel} className="flex min-w-0 flex-wrap justify-between gap-x-2">
                  <span className="min-w-0 [overflow-wrap:anywhere]">{plekNaam(puntVan(z.sleutel)?.naam ?? z.naam)}</span>
                  <span className="cijfer ml-auto whitespace-nowrap">{vermogen(z.vermogen_w)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-[13.5px] text-tekst-zacht">{staatNu('zon', zonW)}</span>
          )}
        </Tegel>
        <Tegel
          rekMee={false}
          soort="batterij"
          icoon={BatterijIcoon}
          procent={stand?.batterij_procent ?? undefined}
          kop={naamVan('batterij')}
          waarde={vermogen(stand?.batterij_w)}
          zin={staatNu('batterij', stand?.batterij_w ?? null)}
          onKies={stand?.batterij_w == null ? undefined : () => onKies('batterij')}
        >
          {stand?.batterij_procent != null && (
            <span className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
              <span className="block h-1.5 overflow-hidden rounded-full bg-vlak-hoog" aria-hidden="true">
                <span className="block h-full rounded-full" style={{ width: `${Math.round(stand.batterij_procent)}%`, background: 'var(--batterij)' }} />
              </span>
              <span className="cijfer text-[13px] font-semibold">
                {procent(stand.batterij_procent)}
                <span className="sr-only"> vol</span>
              </span>
            </span>
          )}
        </Tegel>
        {huisOnbekend(stand) ? (
          <Tegel rekMee={false} soort="huis" icoon={House} kop={naamVan('huis')} waarde="–" zin={HUIS_ONBEKEND} onKies={() => onKies('huis')} />
        ) : (
          <Tegel rekMee={false} soort="huis" icoon={House} kop={naamVan('huis')} waarde={vermogen(verdeling.huis_w)} zin={staatNu('huis', verdeling.huis_w)} onKies={() => onKies('huis')} />
        )}
        <Tegel
          rekMee={false}
          soort="net"
          icoon={UtilityPole}
          kop={naamVan('net')}
          waarde={vermogen(stand?.net_w)}
          zin={staatNu('net', stand?.net_w ?? null)}
          onKies={stand?.net_w == null ? undefined : () => onKies('net')}
        >
          {stand?.net_bron === 'zendure-p1' ? (
            <span className="text-[12.5px]" style={{ color: 'var(--let-op)' }}>
              HomeWizard P1 antwoordt niet · cijfers van de Zendure P1
            </span>
          ) : (
            stand?.net_w != null &&
            stand?.net_zendure_w != null && (
              <span className="text-[12.5px] text-tekst-zacht">
                HomeWizard <span className="cijfer">{vermogen(stand.net_w)}</span> · Zendure <span className="cijfer">{vermogen(stand.net_zendure_w)}</span>
              </span>
            )
          )}
        </Tegel>
      </div>

      <Tegel soort="huis" icoon={ArrowDownUp} kop="Wie levert aan wie" breed>
        {stromen.length === 0 ? (
          <span className="text-[13.5px] text-tekst-zacht">Er stroomt nu bijna niets.</span>
        ) : (
          // Op een groot scherm in twee kolommen: anders staat het getal 1.000 px van de naam.
          <ul className="m-0 grid list-none gap-1 gap-x-8 p-0 lg:grid-cols-2">
            {stromen.map((s) => (
              <li key={`${s.van}>${s.naar}`} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-1">
                <span
                  className="grid size-8 place-items-center rounded-full"
                  style={{ color: KLEUR[s.van], background: `color-mix(in srgb, ${KLEUR[s.van]} 14%, transparent)` }}
                  aria-hidden="true"
                >
                  <PuntIcoon punt={{ soort: s.van }} size={16} strokeWidth={2.2} />
                </span>
                <span className="grid min-w-0 gap-1.5">
                  <span className="truncate text-[14.5px]">
                    {naamVan(s.van)} <span aria-hidden="true">→</span>
                    <span className="sr-only"> naar </span> {naamVan(s.naar)}
                  </span>
                  <span className="block h-1 overflow-hidden rounded-full bg-vlak-hoog" aria-hidden="true">
                    <span className="block h-full rounded-full" style={{ width: `${Math.max(2, (100 * s.w) / grootste)}%`, background: KLEUR[s.van] }} />
                  </span>
                </span>
                <span className="cijfer text-[15px] font-semibold whitespace-nowrap">{vermogen(s.w)}</span>
              </li>
            ))}
          </ul>
        )}
      </Tegel>

      {apparaten.length > 0 && (
        <Tegel soort="apparaat" icoon={Plug} kop="Apparaten" breed>
          <ul className="m-0 grid list-none gap-1 gap-x-8 p-0 lg:grid-cols-2">
            {apparaten.map((a) => (
              <li key={a.sleutel}>
                <button
                  type="button"
                  onClick={() => onKies(a.sleutel)}
                  className="grid min-h-11 w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-xl px-1 py-1.5 text-left text-tekst hover:bg-vlak-hoog"
                >
                  <span className="truncate text-[14.5px]">
                    {a.punt?.naam || a.naam || 'Apparaat'}
                    {a.punt && !a.punt.zichtbaar && <span className="text-tekst-zacht"> · niet op de foto</span>}
                  </span>
                  <span className="cijfer text-[15px] font-semibold whitespace-nowrap">{vermogen(a.vermogen_w)}</span>
                  <span className="col-span-2 block h-1 overflow-hidden rounded-full bg-vlak-hoog" aria-hidden="true">
                    <span className="block h-full rounded-full" style={{ width: `${Math.round(Math.min(1, (a.vermogen_w ?? 0) / huisW) * 100)}%`, background: 'var(--apparaat)' }} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <span className="text-[13px] text-tekst-zacht">
            Niet apart gemeten (lampen, router, tv en de rest): <span className="cijfer font-semibold text-tekst">{vermogen(verdeling.overig_w)}</span>
          </span>
        </Tegel>
      )}

      {/* In een eigen vak: zo wordt de kleinste niet zo hoog als zijn buur (1280 px). */}
      <div className="min-w-0 empty:hidden">
        <FasenNu fasen={stand?.fasen} net={stand?.net_w} grenzen={grenzen} dag={stand?.dag} spanning={stand?.spanning ?? null} />
      </div>
      <div className="min-w-0 empty:hidden">
        <GeldNu stand={stand} />
      </div>
      {/* Tarief, gas en water (programmaatje 1.4.0); zonder niets, ook geen leeg vak. */}
      <div className="min-w-0 empty:hidden">
        <MeterkastNu stand={stand} />
      </div>
    </div>
  );
}
