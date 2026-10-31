import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudHail,
  CloudLightning,
  CloudMoon,
  CloudMoonRain,
  CloudRain,
  CloudSnow,
  CloudSun,
  CloudSunRain,
  Cloudy,
  Moon,
  Settings,
  Sun,
  Wind,
} from 'lucide-react';
import { useEffect, useMemo } from 'react';
import Grafiek from '@/components/Grafiek';
import { leesLokaal, schrijfLokaal } from '@/lib/lokaal';
import { kwhKort, metBewaard } from '@/lib/morgen';
import { asGetal, vermogen } from '@/lib/opmaak';
import { LOKAAL_MORGEN, useVerwachting } from '@/lib/verwachting';
import { dagZin, graden, weerPerDagdeel } from '@/lib/weerVerwachting';

const UUR_MS = 3_600_000;
const ICONEN = { Cloud, CloudDrizzle, CloudFog, CloudHail, CloudLightning, CloudMoon, CloudMoonRain, CloudRain, CloudSnow, CloudSun, CloudSunRain, Cloudy, Moon, Sun, Wind };
const ZEKER = { laag: 'nog onzeker', redelijk: 'redelijk zeker', goed: 'vrij zeker' };
const klok = (ms) => new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
const uur = (ms) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', hour: '2-digit', hourCycle: 'h23' }).format(new Date(ms))) % 24;
const kwhAs = (v) => v.toLocaleString('nl-NL', { maximumFractionDigits: 1 });

/**
 * Tabblad Voorspelling: het weer van de rest van vandaag en van morgen per
 * dagdeel, en de verwachte zon van morgen per plek met wat dat betekent voor
 * de batterij en het geld (src/lib/morgen.js). Geen eigen vraag aan Base44:
 * de stand (met het weerbericht) en de dagen die Advies toch al ophaalt. Het
 * scherm rekent de verwachting één keer (`verwachting`, useVerwachting in
 * src/lib/verwachting.js), voor Huis › Advies en het batterijblad ook; zonder
 * rekent dit tabblad hem zelf, op precies dezelfde manier.
 *
 * @param {{ stand: object|null, dagen: Array, punten: Array, nu: number, huisId: string|null, eigenaar: boolean,
 *   metVoorbeeld: boolean, onNamen: (() => void)|null, zonderCijfers: React.ReactNode, verwachting?: object|null }} props
 *   dagen: leerDagen uit useAdviesDagen (src/lib/adviesBron.js); onNamen: opent Instellingen › Namen (alleen de eigenaar)
 */
export default function TabVoorspelling({ stand, dagen, punten, nu, huisId, eigenaar, metVoorbeeld, onNamen = null, zonderCijfers = null, verwachting = null }) {
  const minuut = Math.floor(nu / 60_000);
  const zelf = useVerwachting({ stand: verwachting ? null : stand, dagen, punten, nu, huisId, metVoorbeeld });
  const uit = verwachting ?? zelf;
  const morgen = uit?.morgen ?? null;
  const weerBericht = uit?.weer ?? null;
  const weer = useMemo(() => (morgen ? weerPerDagdeel(weerBericht, nu, morgen.plaats) : null), [minuut, weerBericht, morgen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Wat ik voor morgen zeg, op dit toestel bewaard: morgen vergelijk ik het met wat het werd.
  const morgenKwh = morgen?.zon?.kwh ?? null;
  useEffect(() => {
    if (metVoorbeeld || !huisId || morgenKwh === null) return;
    const oud = leesLokaal(LOKAAL_MORGEN);
    const nieuw = metBewaard(oud, huisId, morgen.morgen, morgenKwh);
    if (nieuw !== oud) schrijfLokaal(LOKAAL_MORGEN, nieuw);
  }, [metVoorbeeld, huisId, morgenKwh, morgen?.morgen]);

  if (zonderCijfers) return zonderCijfers;
  if (!morgen) return null;
  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-2 lg:items-start">
      <WeerKaart weer={weer} bericht={weerBericht} metVoorbeeld={metVoorbeeld} />
      <ZonKaart morgen={morgen} eigenaar={eigenaar} onNamen={onNamen} />
    </div>
  );
}

/** Een kop zoals Advies: een icoon in een rondje en een kort woord in hoofdletters, rechts iets kleins. */
function Kop({ id, icoon: Icoon, kleur, titel, rechts }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="grid size-9 flex-none place-items-center rounded-full" style={{ color: kleur, background: `color-mix(in srgb, ${kleur} 14%, transparent)` }} aria-hidden="true">
        <Icoon size={18} strokeWidth={2.2} />
      </span>
      <h2 id={id} className="m-0 min-w-0 truncate text-[13px] font-semibold tracking-wide text-tekst-zacht uppercase">
        {titel}
      </h2>
      {rechts && <span className="ml-auto flex-none text-[12.5px] text-tekst-zacht">{rechts}</span>}
    </div>
  );
}

/** Het weer van de rest van vandaag en van morgen, per dagdeel. */
function WeerKaart({ weer, bericht, metVoorbeeld }) {
  const opgehaald = bericht?.opgehaald;
  return (
    <section className="grid min-w-0 gap-3 rounded-2xl border border-lijn bg-vlak p-3.5" aria-labelledby="weer-kop">
      <Kop id="weer-kop" icoon={CloudSun} kleur="var(--net)" titel="Het weer" rechts={opgehaald && !metVoorbeeld ? `Open-Meteo, ${klok(opgehaald)}` : null} />
      {!weer ? (
        <p className="m-0 text-[15px] leading-snug">
          Nog geen weerbericht van thuis. Het programmaatje haalt het elk uur bij Open-Meteo (vanaf versie 0.9.0); werk het zo nodig bij.
        </p>
      ) : (
        weer.dagen.map((dag) => (
          <div key={dag.datum} className="grid min-w-0 gap-2">
            <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3">
              <h3 className="m-0 text-[16px] font-semibold">{dag.titel}</h3>
              {dag.tempMin !== null && (
                <span className="text-[14px] text-tekst-zacht tabular-nums">
                  {graden(dag.tempMin).replace('\u00a0°C', '')} tot {graden(dag.tempMax)}
                </span>
              )}
            </div>
            {dagZin(dag, { kaal: true }) && <p className="m-0 text-[13.5px] leading-snug text-tekst-zacht">{dagZin(dag, { kaal: true })}</p>}
            <ul className="m-0 grid list-none gap-1.5 p-0">
              {dag.delen.map((deel) => (
                <Dagdeel key={deel.sleutel} deel={deel} />
              ))}
            </ul>
          </div>
        ))
      )}
      {weer && !weer.uitgebreid && (
        <p className="m-0 rounded-xl bg-vlak-hoog px-3 py-2 text-[13.5px] leading-snug">
          Werk het programmaatje bij naar 0.10.0: dan zie je hier ook regen (kans en mm), onweer, sneeuw, mist en windstoten. Nu alleen zon en wolken.
        </p>
      )}
    </section>
  );
}

/** Eén dagdeel: icoon, naam en woorden, en de temperatuur. */
function Dagdeel({ deel }) {
  const Icoon = ICONEN[deel.icoon] ?? Cloud;
  const kleur = deel.onweer || deel.wind === 'storm' ? 'var(--let-op)' : deel.valt ? 'var(--net)' : deel.wolken <= 1 && deel.dag ? 'var(--zon)' : 'var(--tekst-zacht)';
  const temp =
    deel.tempMin === null ? null : Math.round(deel.tempMin) === Math.round(deel.tempMax) ? graden(deel.tempMax) : `${graden(deel.tempMin).replace('\u00a0°C', '')}–${graden(deel.tempMax)}`;
  return (
    <li className="flex min-h-11 min-w-0 items-center gap-3 rounded-xl bg-vlak-hoog px-3 py-2">
      <Icoon size={26} strokeWidth={2} style={{ color: kleur }} className="flex-none" aria-hidden="true" />
      <div className="grid min-w-0 flex-1">
        <span className="text-[14.5px] leading-snug">
          <span className="font-semibold">{deel.naam}</span> · {deel.tekst}
        </span>
        {deel.details.length > 0 && <span className="text-[13px] leading-snug text-tekst-zacht">{deel.details.join(' · ')}</span>}
      </div>
      {temp && <span className="flex-none text-[14px] tabular-nums">{temp}</span>}
    </li>
  );
}

/** De zon van morgen: het getal, per plek, per uur, en wat het betekent. */
function ZonKaart({ morgen, eigenaar, onNamen }) {
  const { zon } = morgen;
  if (!morgen.metPanelen) {
    return (
      <section className="grid min-w-0 gap-3 rounded-2xl border border-lijn bg-vlak p-3.5" aria-labelledby="zon-kop">
        <Kop id="zon-kop" icoon={Sun} kleur="var(--zon)" titel="Zon morgen" />
        <p className="m-0 text-[15px] leading-snug">Er zijn geen zonnepanelen gekoppeld, dus hier is geen opbrengst te voorspellen. Het weer staat hiernaast.</p>
      </section>
    );
  }
  // De uren met zon (en een uur ervoor en erna) in de grafiek.
  const uren = morgen.morgenUren;
  const eerste = Math.max(0, uren.findIndex((u) => (u.zonW ?? 0) >= 20) - 1);
  const laatsteMetZon = uren.length - 1 - [...uren].reverse().findIndex((u) => (u.zonW ?? 0) >= 20);
  const stuk = zon ? uren.slice(eerste, Math.min(uren.length, laatsteMetZon + 2)) : [];
  const zinnen = zon ? morgen.zinnen.slice(1) : morgen.zinnen;
  return (
    <section className="grid min-w-0 gap-3 rounded-2xl border border-lijn bg-vlak p-3.5" aria-labelledby="zon-kop">
      <Kop id="zon-kop" icoon={Sun} kleur="var(--zon)" titel="Zon morgen" rechts={zon ? ZEKER[morgen.zekerheid] : null} />
      {zon && (
        <div className="grid gap-0.5">
          <p className="m-0 flex flex-wrap items-baseline gap-x-2">
            <span className="text-[34px] leading-none font-semibold tabular-nums" style={{ fontFamily: 'var(--font-cijfer)' }}>
              {kwhKort(zon.kwh).replace('\u00a0kWh', '')}
            </span>
            <span className="text-[16px] text-tekst-zacht">kWh verwacht</span>
          </p>
          <p className="m-0 text-[13.5px] text-tekst-zacht">
            Tussen {kwhKort(zon.laag).replace('\u00a0kWh', '')} en {kwhKort(zon.hoog)}
          </p>
        </div>
      )}
      {zon && zon.perBron.length > 1 && (
        <ul className="m-0 grid list-none gap-1.5 p-0">
          {zon.perBron.map((b) => (
            <li key={b.sleutel} className="flex min-h-11 min-w-0 items-center gap-3 rounded-xl bg-vlak-hoog px-3 py-2">
              <Sun size={20} strokeWidth={2.1} style={{ color: 'var(--zon)' }} className="flex-none" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-[14.5px]">{b.naam}</span>
              <span className="flex-none text-right text-[14px] tabular-nums">
                {kwhKort(b.kwh)}
                <span className="block text-[12.5px] text-tekst-zacht">{b.geschat ? 'vermogen geschat' : `tot ${vermogen(b.piekW)}`}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {zinnen.length > 0 && (
        <ul className="m-0 grid list-none gap-2 p-0 text-[15px] leading-snug">
          {zinnen.map((zin) => (
            <li key={zin} className="flex gap-2">
              <span className="mt-[0.55em] inline-block size-1.5 flex-none rounded-full bg-tekst-zacht" aria-hidden="true" />
              <span>{zin}</span>
            </li>
          ))}
        </ul>
      )}
      {stuk.length > 1 && (
        <Grafiek
          titel="Zon per uur, morgen"
          uitleg="Hoeveel kWh alle panelen samen per uur ongeveer leveren, uit het weerbericht en wat de app van je panelen leerde."
          reeks={stuk.map((u) => Math.round((u.zonW ?? 0) / 10) / 100)}
          van={stuk[0].begin}
          stapMs={UUR_MS}
          kleur="var(--zon)"
          vorm="staaf"
          waarde={(v) => `${kwhAs(v)}\u00a0kWh`}
          asWaarde={(v) => asGetal(v, 'kWh')}
          hoogte={150}
          labels={stuk.map((u) => String(uur(u.begin)).padStart(2, '0'))}
          namen={stuk.map((u) => `${String(uur(u.begin)).padStart(2, '0')}:00–${String(uur(u.begin + UUR_MS)).padStart(2, '0')}:00`)}
          meer={(i) => (stuk[i].perBron && zon.perBron.length > 1 ? zon.perBron.map((b) => `${b.naam} ongeveer ${vermogen(stuk[i].perBron[b.sleutel])}`) : [])}
          tabelKop="Uur"
          kolom="Zon"
          stapNaam="uur"
        />
      )}
      <div className="grid gap-1 text-[13px] leading-relaxed text-tekst-zacht">
        {morgen.toelichting.map((t) => (
          <p key={t} className="m-0">
            {t}
          </p>
        ))}
      </div>
      {morgen.vraagVermogen.length > 0 &&
        (eigenaar && onNamen ? (
          <button type="button" className="knop justify-self-start" onClick={onNamen}>
            <Settings size={18} strokeWidth={2.1} aria-hidden="true" />
            Vermogen invullen
          </button>
        ) : (
          <p className="m-0 text-[13px] text-tekst-zacht">Vraag de eigenaar van dit huis om het vermogen in te vullen.</p>
        ))}
    </section>
  );
}
