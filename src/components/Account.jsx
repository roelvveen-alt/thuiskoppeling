import { CircleAlert, Check, House, LogOut, Pencil, Plus } from 'lucide-react';
import { useId, useState } from 'react';
import { uitloggen } from '@/api/huis';
import { kernRegels } from '@/lib/alleHuizen';
import { keuzeTab, keuzeToets } from '@/lib/keuzeToets';
import { sindsWanneer } from '@/lib/opmaak';
import NaamFormulier from './NaamFormulier';
import Uitklap from './Uitklap';

/** Van wie een omgeving is, in gewone woorden. De beheerder beheert ook omgevingen van een ander. */
function vanWie(h, gebruiker) {
  if (h.rol !== 'eigenaar') return `Je kijkt mee bij ${h.eigenaar_email}`;
  const eigen = !h.eigenaar_email || h.eigenaar_email === String(gebruiker?.email ?? '').toLowerCase();
  return eigen ? 'Van jou' : `Van ${h.eigenaar_email}; jij beheert hem`;
}

/**
 * Naam en van wie, met het huisje ervoor. Met `kern` (de beheerder, uit het
 * overzicht van alle huizen) ook de cijfers van nu, hoe oud ze zijn en een
 * open storing; wat aandacht vraagt in let-op.
 */
function Omschrijving({ h, gebruiker, kern = null }) {
  return (
    <>
      <House size={18} className="flex-none self-start mt-0.5 text-tekst-zacht" aria-hidden="true" />
      <span className="grid min-w-0 flex-1">
        <span className="truncate text-[14.5px] font-semibold">{h.naam}</span>
        <span className="truncate text-[13px] text-tekst-zacht">{vanWie(h, gebruiker)}</span>
        {kern?.kern && <span className="cijfer text-[13px] [overflow-wrap:anywhere]">{kern.kern}</span>}
        {kern && <span className={`text-[13px] [overflow-wrap:anywhere] ${kern.staat.letOp ? 'text-let-op' : 'text-tekst-zacht'}`}>{kern.staat.tekst}</span>}
        {kern?.storing && (
          <span className="flex min-w-0 items-start gap-1 text-[13px] text-let-op">
            <CircleAlert size={14} className="mt-0.5 flex-none" aria-hidden="true" />
            <span className="min-w-0 [overflow-wrap:anywhere]">{kern.storing}</span>
          </span>
        )}
      </span>
    </>
  );
}

/**
 * Wat de apparaten van dit huis kunnen geven (programmaatje 1.4.0): per apparaat
 * de veldnamen die het teruggeeft, eens per dag gemeten. Alleen de beheerder ziet
 * dit (de server geeft het alleen in het overzicht van alle huizen). Dicht, want lang.
 */
function Kennis({ kennis, nu }) {
  return (
    <Uitklap titel="Wat de apparaten kunnen geven" className="px-2 pb-1" tekst="text-[13.5px]">
      <div className="grid gap-3 pt-1">
        <p className="m-0 text-[13px] text-tekst-zacht">
          Alle velden die elk apparaat teruggeeft, één keer per dag gemeten{kennis.op ? ` (laatst ${sindsWanneer(kennis.op, nu)})` : ''}. Met een getal erbij als dat niets
          over wie of waar zegt; serienummers, adressen, wifinamen en sleutels zitten er nooit in. Zo is te zien wat de app nog meer zou kunnen tonen.
        </p>
        {kennis.apparaten.map((a) => (
          <div key={a.sleutel} className="grid min-w-0 gap-1">
            <h4 className="text-[13.5px] font-semibold [overflow-wrap:anywhere]">
              {a.soort} <span className="font-normal text-tekst-zacht">· {a.velden.length} velden{a.datum ? ` · ${a.datum}` : ''}</span>
            </h4>
            <p className="code m-0 text-[12px] leading-relaxed text-tekst-zacht [overflow-wrap:anywhere]">{a.velden.join(' · ')}</p>
          </div>
        ))}
      </div>
    </Uitklap>
  );
}

/**
 * Met welk account je bent ingelogd, uitloggen, en de omgevingen. Alleen de
 * beheerder van de app kiest tussen omgevingen (dit toestel onthoudt de keuze)
 * en maakt er nieuwe; een gewone gebruiker ziet zijn ene huis. De functie huis
 * houdt dat ook zo als iemand de knoppen toch zou vinden (toegang.js).
 */
/** De versie van de app (package.json, via vite.config). */
export const VERSIE = import.meta.env.VITE_APP_VERSIE ?? '';

/**
 * `overzicht` (alleen de beheerder, useAlleHuizen): per huis de kern van nu,
 * eens per 30 s vers. `onOpen`: naar die omgeving (kiezen en de instellingen
 * dicht); zonder alleen kiezen.
 */
export default function Account({ voorbeeld, gebruiker, huizen = [], huisId, magMaken, onKies, onOpen, onHernoem, onMaak, overzicht = null, nu = 0 }) {
  const kopId = useId();
  const [hernoemen, setHernoemen] = useState(null);
  const beheerder = Boolean(gebruiker?.beheerder);
  const magWisselen = beheerder && huizen.length > 1;
  const metKern = beheerder && overzicht && overzicht.status !== 'uit';
  const kernVan = (id) => (metKern && overzicht.perHuis.has(id) ? kernRegels(overzicht.perHuis.get(id), nu) : null);

  if (voorbeeld) {
    return (
      <p className="m-0 max-w-[60ch] text-[14.5px] text-tekst-zacht">
        In de echte app log je in met je e-mailadres. Hier zie je dan met welk account, en log je uit. De beheerder van
        de app kiest hier tussen de huizen en maakt er nieuwe; wie meekijkt, ziet alleen zijn eigen huis.
      </p>
    );
  }

  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        <h3 className="text-[15px] font-semibold">Ingelogd als</h3>
        <p className="m-0 text-[15px] break-all">{gebruiker?.email}</p>
        <button type="button" className="knop justify-self-start" onClick={uitloggen}>
          <LogOut size={18} aria-hidden="true" /> Uitloggen
        </button>
      </div>

      <div className="grid gap-2">
        <h3 id={kopId} className="text-[15px] font-semibold">
          {metKern ? 'Alle huizen' : magWisselen ? 'Kies een huis' : 'Je huis'}
        </h3>
        {metKern && (
          <p className="m-0 text-[13px] text-tekst-zacht">
            {overzicht.status === 'laden'
              ? 'De cijfers van alle huizen worden geladen.'
              : overzicht.status === 'klaar'
                ? 'De cijfers van nu, elke 30 seconden bijgewerkt. Tik op een huis om erheen te gaan.'
                : overzicht.status === 'nietBijgewerkt'
                  ? 'De cijfers van alle huizen komen er zo bij: de app wordt net bijgewerkt.'
                  : 'De cijfers van alle huizen lukken even niet.'}
          </p>
        )}
        <div role={magWisselen ? 'radiogroup' : undefined} aria-labelledby={magWisselen ? kopId : undefined} className="grid gap-1.5" onKeyDown={magWisselen ? keuzeToets : undefined}>
          {huizen.map((h, i) => {
            const gekozen = h.id === huisId;
            return (
              <div key={h.id} className="grid gap-2 rounded-xl border border-lijn bg-vlak p-1.5">
                <div className="flex items-center gap-1.5">
                  {magWisselen ? (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={gekozen ? 'true' : 'false'}
                      tabIndex={keuzeTab(gekozen, i, huizen.some((x) => x.id === huisId))}
                      onClick={() => (onOpen ?? onKies)(h.id)}
                      className="flex min-h-[48px] min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-left text-tekst hover:bg-vlak-hoog"
                    >
                      <Omschrijving h={h} gebruiker={gebruiker} kern={kernVan(h.id)} />
                      {gekozen && <Check size={18} className="flex-none" aria-hidden="true" />}
                    </button>
                  ) : (
                    <div className="flex min-h-[48px] min-w-0 flex-1 items-center gap-3 px-2 py-1.5">
                      <Omschrijving h={h} gebruiker={gebruiker} kern={kernVan(h.id)} />
                    </div>
                  )}
                  {h.rol === 'eigenaar' && hernoemen !== h.id && (
                    <button
                      type="button"
                      className="knop size-11 flex-none px-0"
                      aria-label={`${h.naam}: andere naam`}
                      onClick={() => setHernoemen(h.id)}
                    >
                      <Pencil size={18} aria-hidden="true" />
                    </button>
                  )}
                </div>
                {metKern && overzicht.perHuis.get(h.id)?.kennis && <Kennis kennis={overzicht.perHuis.get(h.id).kennis} nu={nu} />}
                {hernoemen === h.id && (
                  <div className="px-1.5 pb-1.5">
                    <NaamFormulier
                      label="Nieuwe naam"
                      begin={h.naam}
                      knop="Bewaren"
                      Icoon={Check}
                      onBewaar={async (naam) => {
                        await onHernoem(h.id, naam);
                        setHernoemen(null);
                      }}
                      onAnnuleer={() => setHernoemen(null)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {magMaken && (
        <div className="grid gap-2 border-t border-lijn pt-4">
          <h3 className="text-[15px] font-semibold">Nieuw huis maken</h3>
          <p className="m-0 text-[14px] text-tekst-zacht">
            Voor een huis met een eigen programmaatje, bijvoorbeeld een tweede huis. Je krijgt er een eigen sleutel bij. Alleen
            jij als beheerder maakt huizen en wisselt ertussen; wie je uitnodigt, ziet alleen zijn eigen huis.
          </p>
          <NaamFormulier label="Naam" plaatshouder="Bijvoorbeeld Vakantiehuis" knop="Maken" Icoon={Plus} onBewaar={onMaak} />
        </div>
      )}
      <p className="m-0 border-t border-lijn pt-3 text-[13px] text-tekst-zacht">Energie thuis versie {VERSIE}</p>
    </div>
  );
}
