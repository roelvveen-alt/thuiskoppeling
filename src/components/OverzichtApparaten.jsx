import { ChevronRight, Plug, X } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { apparatenStand, apparatenVan, BASIS, isTerugkerend, reeksVan, REST, vorigeVan } from '@/lib/apparatenOverzicht';
import { useBlad } from '@/lib/bladHaak';
import { asGetal, deel, euro, kwhDag } from '@/lib/opmaak';
import { zieApparaten } from './Bijwerken';
import Grafiek from './Grafiek';


/** Een apparaat met een eigen meter: een volle balk. Herkend (een schatting): gestreept. Basis en rest: de kleur van het huis. */
const KLEUR_APPARAAT = 'var(--apparaat)';
const KLEUR_HUIS = 'var(--huis)';
const gestreept = (kleur) => `repeating-linear-gradient(135deg, ${kleur} 0 5px, color-mix(in srgb, ${kleur} 45%, transparent) 5px 8px)`;

// De as met zijn eenheid (weergave-20).
const asKwh = (v) => asGetal(v, 'kWh');

/** "≈ 3,1 kWh" bij een schatting, "6,4 kWh" bij een eigen meter. */
const kwhTekst = (r) => `${r.gemeten ? '' : '≈ '}${kwhDag(r.kwh)}`;

/** De kleine regel onder de balk: aandeel, keer, geld en de vorige periode. */
function onderRegel(r, { vorige, vorigeNaam }) {
  const delen = [];
  if (r.aandeel !== null) delen.push(`${deel(r.aandeel)} van het huis`);
  if (r.keer > 0) delen.push(`${r.keer}× aan`);
  if (r.eur !== null && r.eur >= 0.005) delen.push(`ongeveer ${euro(r.eur)}`);
  if (vorige && vorigeNaam) delen.push(`${vorigeNaam} ${kwhDag(vorige[r.sleutel] ?? 0)}`);
  return delen.join(' · ');
}

/** Eén regel in de lijst: een knop (minstens 44 px) die het blad opent. */
function Regel({ r, sub, kleur, vorige, vorigeNaam, onKies }) {
  const breedte = r.aandeel === null ? 0 : Math.max(r.kwh > 0 ? 2 : 0, Math.round(r.aandeel * 100));
  return (
    <li>
      <button
        type="button"
        className="grid min-h-11 w-full min-w-0 cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1.5 rounded-xl px-2 py-2 text-left text-tekst hover:bg-vlak-hoog"
        onClick={() => onKies(r.sleutel)}
      >
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[14.5px] leading-snug">
          <span className="min-w-0 font-semibold [overflow-wrap:anywhere]">{r.naam}</span>
          <span className="text-[12.5px] text-tekst-zacht">{sub}</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="cijfer text-[14.5px] font-semibold whitespace-nowrap">{kwhTekst(r)}</span>
          <ChevronRight size={16} className="text-tekst-zacht" aria-hidden="true" />
        </span>
        <span className="col-span-2 block h-2 rounded-[4px] bg-[color-mix(in_srgb,var(--lijn)_55%,transparent)]" aria-hidden="true">
          <span
            className="block h-2 rounded-[4px]"
            style={{ width: `${breedte}%`, background: r.gemeten ? kleur : gestreept(kleur) }}
          />
        </span>
        <span className="col-span-2 text-[12.5px] leading-snug text-tekst-zacht">{onderRegel(r, { vorige, vorigeNaam })}</span>
      </button>
    </li>
  );
}

/** Het blad van één regel: de cijfers, en bij een periode per dag (week, maand), week (kwartaal) of maand (jaar) een staafje. */
function Blad({ r, sub, kleur, vorige, vorigeNaam, wanneer, grafiek, dagen, eigenaar, onSluit }) {
  const { blad, sluitKnop } = useBlad(onSluit);
  const titelId = useId();
  const reeks = grafiek ? reeksVan(grafiek.staven, dagen, r.sleutel) : null;
  const feiten = [
    ['Gebruikt', kwhTekst(r)],
    r.aandeel !== null && ['Van het huis', deel(r.aandeel)],
    r.keer > 0 && ['Keer aan', `${r.keer}×`],
    r.eur !== null && ['Gekost', `ongeveer ${euro(r.eur)}`],
    vorige && vorigeNaam && [vorigeNaam[0].toUpperCase() + vorigeNaam.slice(1), kwhDag(vorige[r.sleutel] ?? 0)],
  ].filter(Boolean);
  const uitleg =
    r.sleutel === BASIS
      ? 'Wat er altijd loopt (koelkast-rust, kastjes, wifi) en een warmtepomp die langzaam meeloopt: wat overblijft als je de herkende apparaten aftrekt. Een schatting.'
      : r.sleutel === REST
        ? 'Wat het huis gebruikte en het programmaatje niet herkende of apart mat. Een apparaat telt pas mee als het tien minuten uit is.'
        : r.gemeten
          ? 'Met een eigen meter: deze kWh zijn gemeten, dus precies.'
          : isTerugkerend(r.sleutel)
            ? `Dit komt vaker terug, maar het programmaatje weet nog niet wat het is. ${eigenaar ? 'Zeg het bij Apparaten › Wat gebruikt er nu stroom?; dan telt het voortaan onder die naam.' : 'De eigenaar kan aanwijzen wat het is.'} Een schatting.`
            : 'Herkend uit het huisverbruik: een schatting. Klopt de naam niet, wijs het dan aan bij Apparaten › Wat gebruikt er nu stroom?';
  return createPortal(
    <>
      <div className="blad-achter" onClick={onSluit} aria-hidden="true" />
      <div ref={blad} className="blad grid gap-4" role="dialog" aria-modal="true" aria-labelledby={titelId}>
        <div className="mx-auto hidden h-1 w-10 rounded-full bg-lijn pointer-coarse:block" aria-hidden="true" />
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className="grid size-11 flex-none place-items-center rounded-full"
              style={{ color: kleur, background: `color-mix(in srgb, ${kleur} 14%, transparent)` }}
              aria-hidden="true"
            >
              <Plug size={22} strokeWidth={2.2} />
            </span>
            <div className="min-w-0">
              <h2 id={titelId} className="text-[20px] font-bold [overflow-wrap:anywhere]">
                {r.naam}
              </h2>
              <p className="m-0 text-[13.5px] text-tekst-zacht">
                {sub} · {wanneer}
              </p>
            </div>
          </div>
          <button ref={sluitKnop} type="button" className="knop size-11 flex-none px-0" onClick={onSluit} aria-label="Sluiten">
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <dl className="m-0 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1 text-[14.5px]">
          {feiten.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-tekst-zacht">{k}</dt>
              <dd className="cijfer m-0 font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="m-0 text-[13.5px] leading-relaxed text-tekst-zacht">{uitleg}</p>
        {reeks && reeks.some((v) => v !== null) ? (
          <Grafiek
            {...grafiek.grafiekPer}
            titel={`Per ${grafiek.per}`}
            uitleg={r.gemeten ? 'In kWh, gemeten.' : 'In kWh, ongeveer.'}
            reeks={reeks}
            kolom={r.naam}
            kleur={kleur}
            vorm="staaf"
            waarde={kwhDag}
            asWaarde={asKwh}
            hoogte={130}
          />
        ) : (
          !grafiek && <p className="m-0 text-[13.5px] text-tekst-zacht">Per dag zie je dit bij Week of Maand.</p>
        )}
      </div>
    </>,
    document.body,
  );
}

/**
 * Overzicht › Apparaten (Vandaag, Week, Maand, Kwartaal, Jaar): per apparaat
 * de kWh, het deel van het huis, ongeveer de euro's en hoe vaak het aan was;
 * grootste eerst, met een balk voor het deel van het huis. Daaronder de Basis
 * en de Rest. Tik op een regel voor een blad met per dag een staafje. Zonder
 * cijfers (een oudere brug, of nog geen dagen) een korte uitleg.
 *
 * @param {{ dagen: Array, namen?: object, brugVersie?: string|null, eigenaar?: boolean, wanneer: string,
 *   vorigeDagen?: Array|null, vorigeNaam?: string|null, prijs?: number|null,
 *   grafiek?: { staven: Array, grafiekPer: object, per: string }|null }} props
 *   dagen: zoals metVandaag (src/lib/periode.js) ze geeft; vandaag: één dag uit de stand
 *   prijs: wat een kWh uit het net kost als de dag zelf (nog) geen prijs heeft
 */
export default function OverzichtApparaten({ dagen, namen = {}, brugVersie = null, eigenaar = true, wanneer, vorigeDagen = null, vorigeNaam = null, prijs = null, grafiek = null }) {
  const titelId = useId();
  const [gekozen, setGekozen] = useState(null);
  const o = useMemo(() => apparatenVan(dagen, { namen, prijs }), [dagen, namen, prijs]);
  const vorige = useMemo(() => (vorigeDagen ? vorigeVan(vorigeDagen) : null), [vorigeDagen]);
  const stand = apparatenStand(o, brugVersie);

  const kop = (
    <div className="grid gap-0.5">
      <h3 id={titelId} className="text-[16px] font-semibold">
        Apparaten
      </h3>
      {stand === 'kaart' && (
        <p className="m-0 text-[13px] text-tekst-zacht">
          Wat elk apparaat {wanneer} gebruikte. Met ≈ is het herkend uit het huisverbruik (een schatting); zonder heeft het een eigen meter.
        </p>
      )}
    </div>
  );

  if (stand !== 'kaart') {
    if (stand === 'niets') return null;
    return (
      <section className="grid min-w-0 grid-cols-1 gap-2.5" aria-labelledby={titelId}>
        {kop}
        <p className="m-0 rounded-2xl border border-lijn bg-vlak p-3.5 text-[14px] leading-relaxed">
          {stand === 'bijwerken' ? (
            `Per apparaat (de spa, de wasmachine, wat herkend wordt) zie je hier hoeveel het gebruikte en ongeveer kostte, zodra het programmaatje thuis versie 0.12.0 of nieuwer heeft. ${zieApparaten(eigenaar)}`
          ) : wanneer === 'vandaag' ? (
            'Het programmaatje telt mee per apparaat. Zodra er vandaag iets gebruikt is (een apparaat telt als het tien minuten uit is), staat het hier.'
          ) : (
            'Nog geen dagen met apparaten in deze periode. Het programmaatje telt ze sinds versie 0.12.0; vanaf dan vult dit zich dag voor dag.'
          )}
        </p>
      </section>
    );
  }

  const regels = [
    ...o.regels.map((r) => ({ r, sub: r.gemeten ? 'gemeten' : isTerugkerend(r.sleutel) ? 'komt vaker terug, nog onbekend' : 'herkend', kleur: KLEUR_APPARAAT })),
    ...(o.basis ? [{ r: { ...o.basis, sleutel: BASIS, naam: 'Basis', gemeten: false, keer: 0 }, sub: 'altijd aan / warmtepomp', kleur: KLEUR_HUIS }] : []),
    ...(o.rest ? [{ r: { ...o.rest, sleutel: REST, naam: 'Rest', gemeten: false, keer: 0 }, sub: 'niet herkend', kleur: KLEUR_HUIS }] : []),
  ];
  const keuze = regels.find((x) => x.r.sleutel === gekozen) ?? null;
  const deels = o.dagenMet < dagen.filter((d) => d.huis !== null).length;

  return (
    <section className="grid min-w-0 grid-cols-1 gap-2.5" aria-labelledby={titelId}>
      {kop}
      <div className="grid min-w-0 grid-cols-1 gap-1 rounded-2xl border border-lijn bg-vlak p-1.5">
        <ul className="m-0 grid list-none grid-cols-1 gap-0.5 p-0" aria-label={`Apparaten ${wanneer}, meeste kWh eerst`}>
          {regels.map((x) => (
            <Regel key={x.r.sleutel} {...x} vorige={vorige} vorigeNaam={vorigeNaam} onKies={setGekozen} />
          ))}
        </ul>
        <p className="m-0 px-2 pt-1 pb-1.5 text-[12.5px] leading-snug text-tekst-zacht">
          {o.huis !== null && `Het huis samen ${kwhDag(o.huis)}. `}
          {o.metGeld && 'Euro’s ongeveer: met wat een kWh uit het net die dag gemiddeld kostte (de zon of de batterij kan een deel betaald hebben). '}
          {deels && `Over ${o.dagenMet} ${o.dagenMet === 1 ? 'dag' : 'dagen'}: van de dagen daarvoor heeft de app nog geen apparaten.`}
        </p>
      </div>
      {keuze && <Blad {...keuze} vorige={vorige} vorigeNaam={vorigeNaam} wanneer={wanneer} grafiek={grafiek} dagen={dagen} eigenaar={eigenaar} onSluit={() => setGekozen(null)} />}
    </section>
  );
}
