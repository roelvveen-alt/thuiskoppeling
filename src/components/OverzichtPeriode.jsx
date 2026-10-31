import { CalendarRange, Sun } from 'lucide-react';
import { useMemo } from 'react';
import { ampere, FASE_KLEUR, hoogLaagZin } from '@/lib/fasen';
import { gasReeks, gasVoorPeriode } from '@/lib/gasStanden';
import { hoeveel } from '@/lib/meterkast';
import { asEuro, asGetal, euro, kwh, kwhDag } from '@/lib/opmaak';
import { dagNaam, metVandaag, reeksenVoor, stavenVan, titelVan, totalenVan } from '@/lib/periode';
import Energie from './Energie';
import Geld from './Geld';
import { GasEnWater } from './Meterkast';
import OverzichtApparaten from './OverzichtApparaten';
import Grafiek from './Grafiek';
import Tegel from './Tegel';
import Uitklap from './Uitklap';

/** Per staaf: een dag (week, maand), een week (kwartaal) of een maand (jaar). */
const PER = { week: 'dag', maand: 'dag', kwartaal: 'week', jaar: 'maand' };
const KOP = { week: 'deze week', maand: 'deze maand', kwartaal: 'dit kwartaal', jaar: 'dit jaar' };

/** kWh over een periode: tot 100 met één decimaal, daarboven heel. */
const kwhPeriode = (v) => (v == null ? '–' : Math.abs(v) >= 100 ? kwh(Math.abs(v)) : kwhDag(v));
const heel = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0, useGrouping: 'always' });
const eenDecimaal = new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: 'always' });

/**
 * Het getal groot, de eenheid kleiner erachter: zo past "9.502 kWh" ook in
 * een smalle tegel op 320 px. Breekt alleen tussen getal en eenheid.
 */
function Kwh({ waarde }) {
  const v = Math.abs(waarde);
  return (
    <span className="[overflow-wrap:normal]">
      {v >= 100 ? heel.format(Math.round(v)) : eenDecimaal.format(v)} <span className="text-[15px] font-semibold">kWh</span>
    </span>
  );
}
// De as met zijn eenheid (weergave-20): '2,5 kWh', '€ 1,50'.
const asKwh = (v) => asGetal(v, 'kWh');
const asBedrag = (v) => asEuro(v);
const asM3 = (v) => asGetal(v, 'm³');
const m3 = (v) => (v == null ? '–' : hoeveel(v, 'm3'));
const asAmpere = (v) => `${v.toLocaleString('nl-NL', { maximumFractionDigits: 1 })}\u00a0A`;

/** Een korte uitleg in een vlak, als er (nog) niets te tonen is. */
function Melding({ children }) {
  return <p className="m-0 rounded-2xl border border-lijn bg-vlak p-3.5 text-[14px] leading-relaxed">{children}</p>;
}

/**
 * Overzicht › Week, Maand, Kwartaal of Jaar: wat de dagen samen kostten,
 * opleverden en aan kWh deden, en per dag (week, maand), per week (kwartaal)
 * of per maand (jaar) in staven. De dagen bewaart de server (tabel Dag);
 * vandaag komt vers uit de stand. Is de geschiedenis korter dan de periode,
 * dan staat erbij sinds wanneer; zonder dagen een uitleg, geen lege grafiek.
 *
 * @param {{ periode: ReturnType<import('@/lib/periode').periodeVan>, dagen: Array, status: string, stand: object|null,
 *   eigenaar?: boolean, namen?: object }} props
 *   dagen: van deze periode, en (TabOverzicht vraagt ze in één keer mee) die van de periode ervoor
 *   status uit usePeriode (src/lib/periodeBron.js)
 */
export default function OverzichtPeriode({ periode, dagen: alleDagen, status, stand, eigenaar = true, namen = {}, gasStanden = [] }) {
  const { titel, bereik } = titelVan(periode);
  const per = PER[periode.keuze];
  // De server kent de periode niet (een oudere versie): dan alleen Vandaag, met uitleg.
  const metDagen = status === 'klaar' || status === 'voorbeeld' || (status === 'fout' && alleDagen.length > 0);
  // De dagen van de periode ervoor zijn alleen voor de vergelijking bij Apparaten.
  const vanServer = useMemo(() => alleDagen.filter((d) => d.datum >= periode.van && d.datum <= periode.tot), [alleDagen, periode.van, periode.tot]);
  const vorigeDagen = useMemo(
    () => (periode.vorige && metDagen ? alleDagen.filter((d) => d.datum >= periode.vorige.van && d.datum <= periode.vorige.tot) : null),
    [alleDagen, periode.vorige, metDagen],
  );
  const dagen = useMemo(() => (metDagen ? metVandaag(vanServer, stand, periode.vandaag) : []), [metDagen, vanServer, stand, periode.vandaag]);
  const staven = useMemo(() => stavenVan(periode), [periode]);
  const t = totalenVan(dagen);
  const r = reeksenVoor(staven, dagen);
  const sinds = t.eerste && t.eerste > periode.van ? t.eerste : null;
  // Gas (ronde 23): per dag de slimme meter, en anders de zelf ingevulde meterstanden (src/lib/gasStanden.js).
  const gas = useMemo(() => gasVoorPeriode(dagen, gasStanden, periode), [dagen, gasStanden, periode]);

  const kop = (
    <div className="grid gap-0.5">
      <h2 className="text-[22px] font-bold">{titel}</h2>
      <p className="m-0 text-[13.5px] text-tekst-zacht">{bereik}</p>
    </div>
  );

  if (status === 'nietBijgewerkt') {
    return (
      <div className="grid min-w-0 grid-cols-1 gap-3">
        {kop}
        <Melding>
          Week, maand, kwartaal en jaar komen zodra de app bijgewerkt is: de server kent deze vraag nog niet. Vandaag werkt al wel.
        </Melding>
      </div>
    );
  }
  if (status === 'laden') {
    return (
      <div className="grid min-w-0 grid-cols-1 gap-3" aria-busy="true">
        {kop}
        <p className="m-0 text-[14px] text-tekst-zacht">Even de dagen ophalen…</p>
      </div>
    );
  }
  if (!dagen.length) {
    return (
      <div className="grid min-w-0 grid-cols-1 gap-3">
        {kop}
        <Melding>
          {status === 'fout'
            ? 'De dagen konden nu niet geladen worden. Over een paar minuten probeer ik het opnieuw; Vandaag werkt intussen gewoon.'
            : 'Nog geen dagen bewaard. Zodra het programmaatje thuis cijfers stuurt, bewaart de app elke dag de totalen; dan vult deze periode zich vanzelf.'}
        </Melding>
      </div>
    );
  }

  const grafiekPer = {
    labels: staven.map((s) => s.kort),
    namen: staven.map((s) => (s.van === periode.vandaag && s.tot === periode.vandaag ? `${s.lang} (tot nu)` : s.lang)),
    huidig: staven.findIndex((s) => s.van <= periode.vandaag && periode.vandaag <= s.tot),
    tabelKop: per === 'dag' ? 'Dag' : per === 'week' ? 'Week' : 'Maand',
    stapNaam: per,
    van: 0,
    stapMs: 1,
  };
  const tegen = (reeks) => reeks.map((v) => (v === null ? null : -v));
  const jaar = periode.keuze === 'jaar' ? (stand?.jaar ?? null) : null;

  return (
    <div className="grid min-w-0 grid-cols-1 gap-5">
      <div className="grid gap-1">
        {kop}
        {sinds && <p className="m-0 text-[13.5px] text-tekst-zacht">Bewaard sinds {dagNaam(sinds)}: van daarvoor heeft de app nog geen dagen.</p>}
        {status === 'fout' && <p className="m-0 text-[13.5px] text-tekst-zacht">Bijwerken lukte net niet; dit zijn de dagen van daarnet.</p>}
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {t.kosten !== null && (
          <Geld
            kop={`Geld ${KOP[periode.keuze]}`}
            kosten={t.kosten}
            opbrengst={t.opbrengst}
            vast={t.vast}
            compleet={t.compleet}
            zonderVast={t.zonderVast}
            afnamePrijs={t.afnamePrijs}
            terugPrijs={t.terugPrijs}
            wanneer={KOP[periode.keuze]}
          />
        )}
        {t.bonus !== null && (
          <Tegel soort="zon" icoon={Sun} kop="Zonnebonus" waarde={euro(t.bonus)} zin="ongeveer; zit al in verdiend" />
        )}
        {jaar && (
          <Tegel
            soort="zon"
            icoon={CalendarRange}
            kop="Plafond Zonnebonus"
            waarde={<Kwh waarde={jaar.teruglevering_kwh} />}
            zin={`dit jaar teruggeleverd volgens de meter; de Zonnebonus geldt tot ${kwh(jaar.plafond_kwh)}`}
          />
        )}
      </div>

      <Energie kop={`Energie ${KOP[periode.keuze]}`} zon={t.zon} huis={t.huis} geladen={t.geladen} ontladen={t.ontladen} afname={t.afname} terug={t.terug} kwhTekst={kwhPeriode} />

      {/* Gas en water (programmaatje 1.4.0): alleen als er een gasmeter of watermeter aan de slimme meter hangt. */}
      {(gas !== null || t.water !== null || t.warmte !== null) && (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <GasEnWater gas={gas?.totaal ?? null} water={t.water} warmte={t.warmte} wanneer={KOP[periode.keuze]} bron={gas?.bron ?? null} />
        </div>
      )}

      <OverzichtApparaten
        dagen={dagen}
        namen={namen}
        brugVersie={stand?.brug?.versie ?? null}
        eigenaar={eigenaar}
        wanneer={KOP[periode.keuze]}
        vorigeDagen={vorigeDagen}
        vorigeNaam={periode.vorige?.naam ?? null}
        grafiek={{ staven, grafiekPer, per }}
      />

      {/* De grafieken per dag, week of maand in een blok dat dicht staat: de totalen erboven zeggen het meeste al. */}
      <Uitklap titel={`Per ${per} in grafieken: geld, zon, huis, net, batterij en fasen`}>
        <div className="grid grid-cols-1 gap-2.5 pt-1 lg:grid-cols-2">
          {r.netto.some((v) => v !== null) && (
            <Grafiek
              {...grafiekPer}
              titel={`Netto per ${per}`}
              uitleg="In euro, met de vaste kosten. Boven de nul kostte het geld, onder de nul leverde het op."
              reeks={r.netto}
              kolom="Netto"
              kleur="var(--net)"
              vorm="staaf"
              waarde={(v) => `${euro(v)} ${v >= 0 ? 'kosten' : 'winst'}`}
              asWaarde={asBedrag}
              meer={(i) => [`betaald ${euro(r.kosten[i])}`, `verdiend ${euro(r.opbrengst[i])}`]}
            />
          )}
          {r.zon.some((v) => v !== null) && (
            <Grafiek {...grafiekPer} titel={`Zon per ${per}`} uitleg="Wat de panelen samen opwekten, in kWh." reeks={r.zon} kolom="Zon" kleur="var(--zon)" vorm="staaf" waarde={kwhPeriode} asWaarde={asKwh} />
          )}
          {r.huis.some((v) => v !== null) && (
            <Grafiek {...grafiekPer} titel={`Huis per ${per}`} uitleg="Wat het huis gebruikte, in kWh." reeks={r.huis} kolom="Huis" kleur="var(--huis)" vorm="staaf" waarde={kwhPeriode} asWaarde={asKwh} />
          )}
          {(r.afname.some((v) => v !== null) || r.terug.some((v) => v !== null)) && (
            <Grafiek
              {...grafiekPer}
              titel={`Net per ${per}`}
              uitleg="In kWh. Boven de nul afgenomen, onder de nul teruggeleverd."
              reeksen={[
                { naam: 'Afgenomen', reeks: r.afname, kleur: 'var(--net)' },
                { naam: 'Teruggeleverd', reeks: tegen(r.terug), kleur: 'var(--net)' },
              ]}
              legenda={false}
              vorm="staaf"
              waarde={(v) => kwhPeriode(Math.abs(v))}
              asWaarde={asKwh}
            />
          )}
          {(r.ontladen.some((v) => v !== null) || r.geladen.some((v) => v !== null)) && (
            <Grafiek
              {...grafiekPer}
              titel={`Batterij per ${per}`}
              uitleg="In kWh. Boven de nul gaf hij stroom, onder de nul laadde hij."
              reeksen={[
                { naam: 'Ontladen', reeks: r.ontladen, kleur: 'var(--batterij)' },
                { naam: 'Geladen', reeks: tegen(r.geladen), kleur: 'var(--batterij)' },
              ]}
              legenda={false}
              vorm="staaf"
              waarde={(v) => kwhPeriode(Math.abs(v))}
              asWaarde={asKwh}
            />
          )}
          {gas && (
            <Grafiek
              {...grafiekPer}
              titel={`Gas per ${per}`}
              uitleg={gas.bron === 'meter' ? 'Wat de gasmeter telde, in m³.' : 'In m³; uit je ingevulde meterstanden, verdeeld over de dagen ertussen.'}
              reeks={gasReeks(staven, gas)}
              kolom="Gas"
              kleur="var(--net)"
              vorm="staaf"
              waarde={m3}
              asWaarde={asM3}
            />
          )}
          {r.water.some((v) => v !== null) && (
            <Grafiek {...grafiekPer} titel={`Water per ${per}`} uitleg="Wat de watermeter telde, in m³." reeks={r.water} kolom="Water" kleur="var(--net)" vorm="staaf" waarde={m3} asWaarde={asM3} />
          )}
          {r.fasen.length > 0 && (
            <Grafiek
              {...grafiekPer}
              titel={r.fasen.length > 1 ? 'Belasting per fase' : `Belasting op L${r.fasen[0].fase}`}
              uitleg={`De gemiddelde stroom per fase, per ${per}. ${hoogLaagZin(t.fasen)}`.trim()}
              reeksen={r.fasen.map((f) => ({ naam: `L${f.fase}`, reeks: f.reeks, kleur: FASE_KLEUR[f.fase] }))}
              vorm="lijn"
              waarde={ampere}
              asWaarde={asAmpere}
            />
          )}
        </div>
      </Uitklap>
    </div>
  );
}
