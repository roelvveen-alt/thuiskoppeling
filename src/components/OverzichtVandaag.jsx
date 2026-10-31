import { Euro, TriangleAlert } from 'lucide-react';
import { useId } from 'react';
import { dagOverzicht } from '@/lib/dagoverzicht';
import { vandaagVan } from '@/lib/meterkast';
import { asEuro, euro, prijsPerKwh, procent, tijd, vanTot, vermogen } from '@/lib/opmaak';
import { zonnebonusVan } from '@/lib/periode';
import { datumVan, prijsOverzicht } from '@/lib/prijsoverzicht';
import { zieApparaten } from './Bijwerken';
import { FasenVandaag } from './Fasen';
import Geld from './Geld';
import OverzichtApparaten from './OverzichtApparaten';
import Energie from './Energie';
import { GasEnWater } from './Meterkast';
import Grafiek from './Grafiek';
import { SturenKaart } from './OmvormerSturen';
import Uitklap from './Uitklap';
import Tegel from './Tegel';

/** Hoeveel kwartieren deze dag heeft (92 of 100 bij de wisseling van zomer- naar wintertijd). */
function kwartierenIn(dag) {
  const morgen = new Date(dag.van);
  morgen.setDate(morgen.getDate() + 1);
  return Math.round((morgen.getTime() - dag.van) / dag.stapMs);
}

/** As-labels met eenheid en een echt minteken: "3 kW", "500 W", "−1,5 kW". */
const kortVermogen = (w) =>
  (Math.abs(w) >= 1000 ? `${(w / 1000).toLocaleString('nl-NL', { maximumFractionDigits: 1 })}\u00a0kW` : `${Math.round(w)}\u00a0W`).replace('-', '\u2212');
const prijsKort = (v) => asEuro(v, 2);

/** Waar staat hoe je bijwerkt (Apparaten), alleen voor de eigenaar; een kijker krijgt een gewone zin. */
const bijwerken = (eigenaar, kijker = zieApparaten(false)) => (eigenaar ? zieApparaten(true) : kijker);

/** Een stuk van het tabblad met een kopje erboven. */
function Stuk({ titel, uitleg, children }) {
  const id = useId();
  return (
    <section className="grid min-w-0 grid-cols-1 gap-2.5" aria-labelledby={id}>
      <div className="grid gap-0.5">
        <h3 id={id} className="text-[16px] font-semibold">
          {titel}
        </h3>
        {uitleg && <p className="m-0 text-[13px] text-tekst-zacht">{uitleg}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * Overzicht › Vandaag: wat eerst de tabbladen Vandaag en Prijzen waren, in
 * één, kort gehouden: het geld en de kWh van vandaag tot nu (elk één kaart),
 * de apparaten, de prijzen van vandaag en morgen in één kaart met de grafiek,
 * en per kwartier wat de zon, het huis, de batterij, het net en de fasen
 * deden, in een blok dat dicht staat tot je erop tikt.
 */
export default function OverzichtVandaag({ stand, nu, eigenaar = true, namen = {}, instellingSturen = null }) {
  const vandaag = stand?.vandaag ?? null;
  const ruweDag = stand?.dag ?? null;
  // Een dag van gisteren (het programmaatje stond stil) is niet vandaag.
  const dag = ruweDag && nu >= ruweDag.van && nu < ruweDag.van + 25 * 3_600_000 ? ruweDag : null;
  const overzicht = dagOverzicht(dag);
  const slots = dag ? kwartierenIn(dag) : 96;
  const voorspelling = stand?.voorspelling ?? null;
  const o = prijsOverzicht(voorspelling, nu);
  const prijs = stand?.prijs ?? null;
  const bonusVandaag = dag ? zonnebonusVan(dag, voorspelling) : null;
  const vandaagDatum = datumVan(nu);
  const dagNaam = (ms) => (datumVan(ms) === vandaagDatum ? 'vandaag' : 'morgen');

  const grafiek = (titel, reeks, kleur, extra = {}) =>
    reeks && (
      <Grafiek
        titel={titel}
        reeks={reeks}
        van={dag.van}
        stapMs={dag.stapMs}
        slots={slots}
        kleur={kleur}
        nu={nu}
        waarde={vermogen}
        asWaarde={kortVermogen}
        {...extra}
      />
    );

  const gemiddeld = (eur, kwh) => (kwh >= 0.05 ? eur / kwh : null);

  return (
    <div className="grid min-w-0 grid-cols-1 gap-5">
      <div className="grid gap-0.5">
        <h2 className="text-[22px] font-bold">Vandaag</h2>
        {overzicht?.vanaf && (
          <p className="m-0 text-[13.5px] text-tekst-zacht">Geschiedenis vanaf {tijd(overzicht.vanaf)}: toen begon het programmaatje vandaag te tellen.</p>
        )}
      </div>

      <Stuk titel="Geld en energie" uitleg="Van middernacht tot nu.">
        {vandaag || dag ? (
          <div className="grid grid-cols-1 gap-2.5">
            {vandaag && (
              <Geld
                kop="Geld vandaag"
                kosten={vandaag.kosten_eur}
                opbrengst={vandaag.opbrengst_eur}
                vast={vandaag.vaste_kosten_eur}
                compleet={vandaag.compleet}
                afnamePrijs={gemiddeld(vandaag.kosten_eur, vandaag.afname_kwh)}
                terugPrijs={gemiddeld(vandaag.opbrengst_eur, vandaag.teruglevering_kwh)}
              />
            )}
            <Energie
              kop="Energie vandaag"
              zon={dag?.kwh.zon ?? null}
              huis={dag?.kwh.huis ?? null}
              geladen={dag?.kwh.geladen ?? null}
              ontladen={dag?.kwh.ontladen ?? null}
              afname={vandaag?.afname_kwh ?? null}
              terug={vandaag?.teruglevering_kwh ?? null}
            />
            {/* Gas en water van vandaag (programmaatje 1.4.0): alleen met een gasmeter (of watermeter) aan de slimme meter. */}
            <GasEnWater
              gas={vandaagVan(stand?.meterkast, 'gas') ?? dag?.gasM3 ?? null}
              water={vandaagVan(stand?.meterkast, 'water') ?? dag?.waterM3 ?? null}
              warmte={vandaagVan(stand?.meterkast, 'warmte') ?? dag?.warmteGj ?? null}
              wanneer="vandaag"
            />
          </div>
        ) : (
          <p className="m-0 rounded-2xl border border-lijn bg-vlak p-3.5 text-[14px] leading-relaxed">
            Er is vandaag nog niets van thuis binnengekomen. Draait het programmaatje?{' '}
            {bijwerken(eigenaar, 'De eigenaar kan het nakijken.')}
          </p>
        )}
      </Stuk>

      {dag && (
        <OverzichtApparaten
          dagen={[
            {
              datum: vandaagDatum,
              huis: dag.kwh.huis,
              kosten: vandaag?.kosten_eur ?? null,
              afname: vandaag?.afname_kwh ?? null,
              apparaten: dag.apparaten ?? null,
              basis: dag.basisKwh ?? null,
            },
          ]}
          namen={namen}
          brugVersie={stand?.brug?.versie ?? null}
          eigenaar={eigenaar}
          wanneer="vandaag"
          prijs={prijs?.afname_kwh ?? null}
        />
      )}

      <Stuk titel="Prijzen" uitleg={o ? `Per kwartier, alles erin (btw, energiebelasting, opslag). Bron: ${o.bron || 'Zonneplan'}.` : undefined}>
        {o ? (
          <>
            {o.schatting && (
              <p className="m-0 flex items-start gap-2 rounded-2xl border border-lijn bg-vlak p-3.5 text-[14px]" role="status">
                <TriangleAlert size={18} className="mt-0.5 flex-none" style={{ color: 'var(--let-op)' }} aria-hidden="true" />
                Dit is een schatting: Zonneplan antwoordde niet, dus dit is de marktprijs met de opbouw van Zonneplan. Het
                programmaatje probeert het elk kwartier opnieuw.
              </p>
            )}
            <PrijsGrafiek o={o} nu={nu} dagNaam={dagNaam} dag={dag} />
            <PrijsKaart o={o} dagNaam={dagNaam} bonusVandaag={bonusVandaag} />
            {/* Het begrenzen van de omvormer bij een negatieve prijs (1.5.0): alleen de eigenaar krijgt het. */}
            {eigenaar && stand?.omvormer?.sturen && (
              <div className="rounded-2xl border border-lijn bg-vlak p-3.5">
                <SturenKaart sturen={stand.omvormer.sturen} instelling={instellingSturen} nu={nu} omvormerW={stand.omvormer.w ?? null} netW={stand.net_w ?? null} />
              </div>
            )}
          </>
        ) : (
          <>
            {prijs && (
              <Tegel
                soort="net"
                icoon={Euro}
                kop="Prijs nu"
                waarde={prijsPerKwh(prijs.afname_kwh)}
                zin={`Terugleveren ${prijsPerKwh(prijs.teruglevering_kwh)}${prijs.bron ? ` · ${prijs.bron}` : ''}`}
              />
            )}
            <p className="m-0 rounded-2xl border border-lijn bg-vlak p-3.5 text-[14px] leading-relaxed">
              {prijs
                ? 'De prijzen van vandaag en morgen per kwartier komen hier zodra de nieuwe versie van het programmaatje draait. '
                : eigenaar
                  ? 'Er zijn nog geen stroomprijzen. Kies in de instelhulp van het programmaatje Zonneplan (node brug.mjs instellen). Of werk het programmaatje bij. '
                  : 'Er zijn nog geen stroomprijzen. '}
              {bijwerken(eigenaar, prijs ? undefined : 'De eigenaar kan ze aanzetten in het programmaatje thuis.')}
            </p>
          </>
        )}
      </Stuk>

      <Stuk titel="Per kwartier">
        {dag ? (
          <Uitklap titel="Zon, huis, batterij, net en de fasen per kwartier">
            <div className="grid grid-cols-1 gap-2.5 pt-1 lg:grid-cols-2">
              {grafiek('Zon', dag.zon, 'var(--zon)', { uitleg: 'Wat de panelen samen leverden, per kwartier.' })}
              {grafiek('Huis', dag.huis, 'var(--huis)', { uitleg: 'Wat het huis gebruikte, per kwartier.' })}
              {grafiek('Batterij', dag.batterij, 'var(--batterij)', { uitleg: 'Boven de nul levert hij, onder de nul laadt hij.' })}
              {grafiek('Net', dag.net, 'var(--net)', { uitleg: 'Boven de nul neem je af, onder de nul lever je terug.' })}
              {grafiek('Batterij vol', dag.procent, 'var(--batterij)', {
                vorm: 'lijn',
                domein: [0, 100],
                waarde: procent,
                asWaarde: (v) => `${Math.round(v)}%`,
                uitleg: 'Hoe vol de batterij was.',
              })}
              <FasenVandaag dag={dag} slots={slots} nu={nu} />
            </div>
          </Uitklap>
        ) : (
          <p className="m-0 rounded-2xl border border-lijn bg-vlak p-3.5 text-[14px] leading-relaxed">
            De grafieken van vandaag (zon, huis, batterij, net en de fasen per kwartier) komen zodra de nieuwe versie van het programmaatje
            draait. {bijwerken(eigenaar)} Vanaf dan vult de dag zich kwartier voor kwartier.
          </p>
        )}
      </Stuk>
    </div>
  );
}

/** Vanaf zoveel watt laden telt een kwartier als "de batterij laadde". */
export const LAAD_VLAK_W = 200;

/**
 * Waar de batterij vandaag echt laadde, als groene vlakken in de prijsgrafiek:
 * aaneengesloten kwartieren met minstens LAAD_VLAK_W laden (batterij_w min).
 * Zo zie je naast de prijs wanneer de Zendure (bijvoorbeeld ZENKI) ging laden.
 */
export function laadVlakken(dag, van, stapMs, aantal) {
  if (!dag || !Array.isArray(dag.batterij) || !(stapMs > 0)) return [];
  const laadt = new Array(aantal).fill(false);
  dag.batterij.forEach((w, i) => {
    if (!dag.metingen?.[i] || !(w <= -LAAD_VLAK_W)) return;
    const j = Math.round((dag.van + i * dag.stapMs - van) / stapMs);
    if (j >= 0 && j < aantal) laadt[j] = true;
  });
  const vlakken = [];
  laadt.forEach((ja, j) => {
    if (!ja) return;
    const laatste = vlakken.at(-1);
    // Een gat van hooguit een half uur hoort er nog bij: anders staan er twee "laadde" vlak naast elkaar.
    if (laatste && laatste.laatste >= j - 3) laatste.laatste = j;
    else vlakken.push({ eerste: j, laatste: j, label: 'laadde', uitleg: 'toen laadde je batterij', kleur: 'var(--batterij)' });
  });
  return vlakken;
}

/** De stroomprijs per kwartier van vandaag en morgen, met de beste twee uur om te laden en terug te leveren. */
function PrijsGrafiek({ o, nu, dagNaam, dag }) {
  const { kwartieren } = o;
  const stapMs = kwartieren[0].tot - kwartieren[0].van;
  const banden = [
    o.laden && { eerste: o.laden.eerste, laatste: o.laden.laatste, label: 'laden', uitleg: 'laden: de goedkoopste twee uur', kleur: 'var(--net)' },
    o.terugleveren && { eerste: o.terugleveren.eerste, laatste: o.terugleveren.laatste, label: 'terug', uitleg: 'terugleveren: de duurste twee uur', kleur: 'var(--zon)' },
    ...laadVlakken(dag, kwartieren[0].van, stapMs, kwartieren.length),
  ].filter(Boolean);
  return (
    <Grafiek
      titel="Stroomprijs per kwartier"
      uitleg="Wat een kWh uit het net kost, per kwartier."
      reeks={kwartieren.map((k) => k.afname)}
      van={kwartieren[0].van}
      stapMs={stapMs}
      kleur="var(--net)"
      vorm="trap"
      nu={nu}
      verledenDimmen
      banden={banden}
      strook={o.bonus.map((b) => ({ eerste: b.eerste, laatste: b.eerste + Math.round((b.tot - b.van) / stapMs) - 1 }))}
      strookLabel="Zonnebonus (overdag)"
      strookKleur="var(--zon)"
      waarde={prijsPerKwh}
      asWaarde={prijsKort}
      meer={(i) => [`terugleveren ${prijsPerKwh(kwartieren[i].terug)}`, ...(kwartieren[i].bonus > 0 ? [`waarvan Zonnebonus ${prijsPerKwh(kwartieren[i].bonus)}`] : [])]}
      hoogte={210}
      uurStap={12}
      dagNamen={dagNaam}
    />
  );
}

/**
 * Wat je aan de prijzen hebt, in één kaart: wanneer laden en terugleveren het
 * meest oplevert, vandaag en morgen gemiddeld van–tot, de Zonnebonus, en
 * "onder nul" alleen als het gebeurt. Het goedkoopste en duurste kwartier
 * vallen in de beste twee uur en staan in de grafiek; de prijs van nu staat op Nu.
 */
function PrijsKaart({ o, dagNaam, bonusVandaag }) {
  const vandaag = o.dagen.find((d) => d.naam === 'vandaag');
  const morgen = o.dagen.find((d) => d.naam === 'morgen');
  const vanTotPrijs = (d) => `van ${prijsPerKwh(d.laagste.afname)} tot ${prijsPerKwh(d.hoogste.afname)}`;
  const rijen = [
    o.laden && ['Laden', `${dagNaam(o.laden.van)} ${vanTot(o.laden.van, o.laden.tot)}`, `gemiddeld ${prijsPerKwh(o.laden.gemiddeld)}: de goedkoopste twee uur`],
    o.terugleveren && ['Terugleveren', `${dagNaam(o.terugleveren.van)} ${vanTot(o.terugleveren.van, o.terugleveren.tot)}`, `gemiddeld ${prijsPerKwh(o.terugleveren.gemiddeld)}: de duurste twee uur`],
    vandaag && ['Vandaag', `gemiddeld ${prijsPerKwh(vandaag.gemiddeld)}`, vanTotPrijs(vandaag)],
    ['Morgen', morgen ? `gemiddeld ${prijsPerKwh(morgen.gemiddeld)}` : 'nog niet bekend', morgen ? vanTotPrijs(morgen) : 'komen rond 13:00'],
    [
      'Zonnebonus',
      o.bonus.length ? o.bonus.map((b) => vanTot(b.van, b.tot)).join(', ') : 'vandaag niet',
      o.bonus.length
        ? `terugleveren levert dan 10% extra${bonusVandaag !== null && bonusVandaag >= 0.005 ? `; vandaag tot nu zo'n ${euro(bonusVandaag)}` : ''}`
        : 'donker, of het plafond is bereikt',
    ],
  ].filter(Boolean);
  return (
    <Tegel soort="net" icoon={Euro} kop="Prijzen" breed>
      <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-[14px] lg:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
        {rijen.map(([label, waarde, uitleg]) => (
          <div key={label} className="contents">
            <dt className="text-tekst-zacht">{label}</dt>
            <dd className="m-0 min-w-0">
              <span className="cijfer font-semibold">{waarde}</span>
              <span className="block text-[13px] leading-snug text-tekst-zacht">{uitleg}</span>
            </dd>
          </div>
        ))}
      </dl>
      {o.negatief.length > 0 && (
        <p className="m-0 border-t border-lijn pt-2.5 text-[13.5px] leading-snug">
          Onder nul: {o.negatief.map((b) => `${dagNaam(b.van)} ${vanTot(b.van, b.tot)}`).join(', ')}. Dan krijg je geld om stroom af te nemen (laagste{' '}
          {prijsPerKwh(Math.min(...o.negatief.map((b) => b.laagste)))}).
        </p>
      )}
    </Tegel>
  );
}
