import { ChevronRight, X } from 'lucide-react';
import { useLayoutEffect } from 'react';
import { bladPlek } from '@/lib/blad';
import { useBlad } from '@/lib/bladHaak';
import { omvormerHoortBij } from '@/lib/omvormer';
import { richting, vermogen, zinBatterij, zinNet, zinVergelijk } from '@/lib/opmaak';
import { lijnenVoorTekening, stromenBij, stromenSamen } from '@/lib/stroom';
import { doorDeMeterkast, regels, zinStromen } from '@/lib/stromenZin';
import BatterijGegevens from './BatterijGegevens';
import { kaartje } from './HuisBeeld';
import { MeterkastRegels } from './Meterkast';
import { PuntIcoon } from './iconen';
import Omvormer from './Omvormer';
import Stromen from './Stromen';
import { bronTekst, faseSpanning, LET_OP_V, voltTekst } from '@/lib/spanning';

const KLEUR = { zon: 'var(--zon)', batterij: 'var(--batterij)', net: 'var(--net)', huis: 'var(--huis)', apparaat: 'var(--apparaat)' };

/**
 * De zin bovenaan het blad, naast de zin over wie levert aan wie
 * (`samengevat`), zonder die te herhalen. Nu in woorden staat niet in het blad
 * (dat staat al op Huis onder de tekening), en hoe vol de batterij is staat al
 * in de titel ("Batterij 53%"): zo past een blad op het scherm.
 */
function zinVoor(punt, stand, verdeling, waarde, samengevat) {
  switch (punt.soort) {
    case 'zon':
    case 'huis':
      return '';
    case 'batterij':
      return samengevat ? '' : `${zinBatterij(stand?.batterij_w)}.`;
    case 'net':
      return samengevat ? '' : zinNet(stand?.net_w);
    default: {
      if (!((waarde ?? 0) >= 5)) return 'Staat uit of gebruikt bijna niets.';
      const deel = verdeling.huis_w > 0 ? Math.min(100, Math.round((100 * waarde) / verdeling.huis_w)) : 0;
      return `Gebruikt nu ${vermogen(waarde)}: ${deel}% van wat je huis gebruikt.`;
    }
  }
}

/** @param {{ titel: string, rijen: Array<{ sleutel: string, naam: string, waarde: string, bij?: string }> }} props */
function Lijst({ titel, rijen }) {
  if (rijen.length === 0) return null;
  return (
    <div className="grid gap-1.5">
      <h3 className="text-[13px] font-semibold tracking-wide text-tekst-zacht uppercase">{titel}</h3>
      <ul className="m-0 grid list-none gap-1 p-0">
        {rijen.map((r) => (
          <li key={r.sleutel} className="flex items-baseline justify-between gap-3 border-b border-lijn py-1.5">
            <span className="min-w-0 truncate">{r.naam}</span>
            <span className="whitespace-nowrap">
              <span className="cijfer font-semibold">{r.waarde}</span>
              {r.bij && <span className="text-[13.5px] text-tekst-zacht">{` ${r.bij}`}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Een Zendure P1-meter op dezelfde meterkast: naast de HomeWizard, om te zien of ze hetzelfde meten. */
/**
 * De netspanning per fase nu ("voltage ook op huis en net"), uit de P1 of anders uit de
 * spanningswacht (de omvormer of een driefase kWh-meter, zoals bij Belasting per fase). Vanaf
 * LET_OP_V in de let-op-kleur. Geen spanning bekend: niets.
 */
function SpanningNu({ stand }) {
  const fasen = (stand?.fasen ?? []).length ? stand.fasen : [1, 2, 3].map((fase) => ({ fase, v: null }));
  const rijen = fasen
    .map((f) => (f.v != null ? { fase: f.fase, v: f.v, herkomst: { bron: 'p1' } } : (() => { const x = faseSpanning(stand?.spanning, f.fase); return x ? { fase: f.fase, ...x } : null; })()))
    .filter(Boolean);
  if (!rijen.length) return null;
  const bronnen = [...new Set(rijen.map((r) => bronTekst(r.herkomst)).filter(Boolean))];
  return (
    <section className="grid min-w-0 gap-1.5" aria-label="Spanning">
      <h3 className="text-[13px] font-semibold tracking-wide text-tekst-zacht uppercase">Spanning nu</h3>
      <p className="m-0 flex flex-wrap gap-x-4 gap-y-1 text-[15px]">
        {rijen.map((r) => (
          <span key={r.fase} className={r.v >= LET_OP_V ? 'text-let-op' : undefined}>
            L{r.fase} <span className="cijfer font-semibold">{voltTekst(r.v)}</span>
          </span>
        ))}
      </p>
      {bronnen.length > 0 && <span className="text-[12.5px] leading-snug text-tekst-zacht">{bronnen.join('; ').replace(/^./, (c) => c.toUpperCase())}.</span>}
    </section>
  );
}

function TweeMeters({ stand }) {
  // Valt de HomeWizard weg, dan is net_w die van de Zendure: twee keer hetzelfde getal zegt dan niets.
  if (stand?.net_bron === 'zendure-p1') {
    return (
      <p className="m-0 text-[13.5px]" style={{ color: 'var(--let-op)' }}>
        De HomeWizard P1 antwoordt nu niet. Het net en de kosten komen even van de Zendure P1.
      </p>
    );
  }
  const hw = stand?.net_w ?? null;
  const zendure = stand?.net_zendure_w ?? null;
  if (hw === null || zendure === null) return null;
  return (
    <>
      <Lijst
        titel="Twee meters in de meterkast"
        rijen={[
          { sleutel: 'homewizard', naam: 'HomeWizard P1', waarde: vermogen(hw), bij: richting(hw) },
          { sleutel: 'zendure', naam: 'Zendure P1', waarde: vermogen(zendure), bij: richting(zendure) },
        ]}
      />
      <p className="m-0 -mt-2 text-[13.5px] text-tekst-zacht">{zinVergelijk(hw, zendure)}</p>
    </>
  );
}

/**
 * In het blad van alle plekken met panelen samen: elke plek met wat hij nu
 * levert. Een tik opent het blad van die plek (met zijn omvormer); zonder
 * `onKies` alleen de regels.
 */
function Plekken({ plekken, stand, verdeling, onKies }) {
  return (
    <div className="grid gap-1">
      <h3 className="text-[13px] font-semibold tracking-wide text-tekst-zacht uppercase">Per plek</h3>
      <ul className="m-0 grid list-none p-0">
        {plekken.map((p) => {
          const inhoud = (
            <>
              <span
                className="grid size-8 place-items-center rounded-full"
                style={{ color: KLEUR.zon, background: `color-mix(in srgb, ${KLEUR.zon} 14%, transparent)` }}
                aria-hidden="true"
              >
                <PuntIcoon punt={p} procent={stand?.batterij_procent ?? undefined} size={16} strokeWidth={2.2} />
              </span>
              <span className="min-w-0 truncate text-[14.5px]">{p.naam}</span>
              <span className="cijfer text-[15px] font-semibold whitespace-nowrap">{vermogen(kaartje(p, stand, verdeling).waarde)}</span>
              {onKies && <ChevronRight size={18} className="text-tekst-zacht" aria-hidden="true" />}
            </>
          );
          const vorm = `grid min-h-11 w-full items-center gap-3 py-1.5 text-left text-tekst ${onKies ? 'grid-cols-[auto_minmax(0,1fr)_auto_auto]' : 'grid-cols-[auto_minmax(0,1fr)_auto]'}`;
          return (
            <li key={p.sleutel} className="border-b border-lijn">
              {onKies ? (
                <button type="button" className={`${vorm} cursor-pointer rounded-lg hover:bg-vlak-hoog`} onClick={() => onKies(p.sleutel)}>
                  {inhoud}
                </button>
              ) : (
                <span className={vorm}>{inhoud}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Onderblad met wat er bij één punt binnenkomt en weggaat. Een punt met
 * `plekken` (zonSamen in src/lib/opstelling.js) is alle plekken met panelen
 * samen: wat ze samen leveren en waar het heen gaat, en per plek een regel die
 * met `onKies` het blad van die plek opent.
 */
/**
 * Op een groot scherm het blad zo neerzetten dat het aangetikte rondje op de
 * foto te zien blijft (bladPlek in src/lib/blad.js). Vóór het tekenen, zonder
 * extra render: alleen een data-attribuut en de hoogste hoogte op het blad.
 */
function useNietOverHetRondje(blad, punt) {
  const sleutels = (punt.plekken ?? [punt.sleutel]).join('|');
  useLayoutEffect(() => {
    const el = blad.current;
    if (!el || typeof window === 'undefined') return;
    const rechthoeken = sleutels
      .split('|')
      .map((s) => document.querySelector(`.huisbeeld .punt[data-sleutel="${window.CSS?.escape ? window.CSS.escape(s) : s}"]`)?.getBoundingClientRect())
      .filter((r) => r && r.height > 0);
    const rondje = rechthoeken.length ? { top: Math.min(...rechthoeken.map((r) => r.top)), bottom: Math.max(...rechthoeken.map((r) => r.bottom)) } : null;
    const { plek, max } = bladPlek({ breed: window.innerWidth, hoog: window.innerHeight, rondje });
    el.setAttribute('data-plek', plek);
    if (max === null) el.style.removeProperty('--blad-max');
    else el.style.setProperty('--blad-max', `${max}px`);
  }, [blad, sleutels]);
}

export default function Detail({ punt, punten, stand, verdeling, onSluit, onKies = null, verwachtVol = null, eigenaar = true }) {
  const { blad, sluitKnop } = useBlad(onSluit);
  useNietOverHetRondje(blad, punt);

  const { naam, waarde } = kaartje(punt, stand, verdeling);
  const kleur = KLEUR[punt.soort] ?? KLEUR.apparaat;
  const plekken = punt.plekken ? punten.filter((p) => punt.plekken.includes(p.sleutel)) : null;
  const { erin, eruit } = plekken ? stromenSamen(punt.plekken, punt.sleutel, verdeling.stromen) : stromenBij(punt.sleutel, verdeling.stromen);
  const puntVan = (sleutel) => punten.find((p) => p.sleutel === sleutel);
  const binnen = regels(erin, 'erin', puntVan);
  const buiten = regels(eruit, 'eruit', puntVan);
  const samengevat = zinStromen(punt, binnen, buiten);
  const bovenaan = zinVoor(punt, stand, verdeling, waarde, samengevat);
  const losseApparaten = (stand?.apparaten ?? []).length > 0;
  // Bij het huis ook wat er door de meterkast naar de batterij en het net gaat, zoals op de tekening.
  const door = punt.soort === 'huis' ? doorDeMeterkast(lijnenVoorTekening(stand), puntVan) : [];

  return (
    <>
      <div className="blad-achter" onClick={onSluit} aria-hidden="true" />
      <div ref={blad} className="blad grid gap-4" role="dialog" aria-modal="true" aria-labelledby="blad-titel">
        <div className="mx-auto hidden h-1 w-10 rounded-full bg-lijn pointer-coarse:block" aria-hidden="true" />
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className="grid size-11 flex-none place-items-center rounded-full"
              style={{ color: kleur, background: `color-mix(in srgb, ${kleur} 14%, transparent)` }}
              aria-hidden="true"
            >
              <PuntIcoon punt={punt} procent={stand?.batterij_procent ?? undefined} size={22} strokeWidth={2.2} />
            </span>
            <div className="min-w-0">
              <h2 id="blad-titel" className="truncate text-[20px] font-bold">
                {naam}
              </h2>
              <p className="cijfer m-0 text-[22px] leading-tight font-bold">{vermogen(waarde)}</p>
            </div>
          </div>
          <button ref={sluitKnop} type="button" className="knop size-11 flex-none px-0" onClick={onSluit} aria-label="Sluiten">
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        {bovenaan && <p className="m-0 text-[15px]">{bovenaan}</p>}
        {samengevat && <p className="m-0 text-[15px] font-semibold">{samengevat}</p>}
        <Stromen titel="Komt van" rijen={binnen} />
        <Stromen titel="Gaat naar" rijen={buiten} />
        {plekken && <Plekken plekken={plekken} stand={stand} verdeling={verdeling} onKies={onKies} />}
        {omvormerHoortBij(stand?.omvormer, punt, punten) && <Omvormer omvormer={stand.omvormer} />}
        <Stromen titel="Door de meterkast naar" rijen={door} deel={false} />
        {(punt.soort === 'net' || punt.soort === 'huis') && <SpanningNu stand={stand} />}
        {punt.soort === 'net' && <TweeMeters stand={stand} />}
        {punt.soort === 'net' && <MeterkastRegels meterkast={stand?.meterkast ?? null} dynamisch={Boolean(stand?.prijs)} kop />}
        {punt.soort === 'batterij' && <BatterijGegevens info={stand?.batterij_info ?? null} brugVersie={stand?.brug?.versie ?? null} batterijW={stand?.batterij_w ?? null} procent={stand?.batterij_procent ?? null} verwacht={verwachtVol} opdracht={eigenaar} />}
        {punt.soort === 'huis' && losseApparaten && verdeling.overig_w >= 5 && (
          <p className="m-0 text-[13.5px] text-tekst-zacht">
            Waarvan niet apart gemeten:{' '}
            <span className="cijfer font-semibold text-tekst">{vermogen(verdeling.overig_w)}</span>
          </p>
        )}
      </div>
    </>
  );
}
