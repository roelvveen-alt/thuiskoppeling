import { Check, ChevronRight, CircleCheck, CircleHelp, Clock, Lightbulb, ScanSearch } from 'lucide-react';
import { useId, useState } from 'react';
import {
  basisKort,
  BEANTWOORD_MS,
  kaartStand,
  KEUZE_VAN,
  KEUZES,
  kennisRegels,
  kennisZin,
  labelVoor,
  labelVoorGroep,
  laterLabel,
  leesUitgesteld,
  nachtZin,
  nuRegel,
  onbekendZin,
  regelNaam,
  SOORT_NAAM,
  uitklapTitel,
  vraagZinnen,
  vragenVan,
  zekerWoord,
  zetUitgesteld,
} from '@/lib/herkennen';
import { vanTot, vermogen } from '@/lib/opmaak';
import { Rondje } from './Tegel';
import { zieApparaten } from './Bijwerken';
import Uitklap from './Uitklap';

/**
 * "Dat was …" en "Wat is het?": een keuzelijst (KEUZES: de soorten, en
 * Verlichting als "Iets anders" met die naam), en bij "Iets anders" een eigen
 * naam. Eén vraag tegelijk naar de functie (het loket zet ze na elkaar).
 */
function Keuze({ voorstel = '', onKies, onAnnuleer, knop = 'Bewaar', vraag = 'Wat was het?', leeg = 'Kies wat het was…' }) {
  const id = useId();
  const [waarde, setWaarde] = useState(KEUZE_VAN[voorstel] ? voorstel : '');
  const [naam, setNaam] = useState('');
  const keuze = KEUZE_VAN[waarde] ?? null;
  const zelf = waarde === 'anders';
  const klaar = keuze && (!zelf || naam.trim());
  return (
    <form
      className="flex min-w-0 flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (klaar) onKies({ soort: keuze.soort, naam: zelf ? naam.trim() : (keuze.naam ?? null) });
      }}
    >
      <label htmlFor={`${id}-soort`} className="sr-only">
        {vraag}
      </label>
      <select id={`${id}-soort`} className="veld min-w-0 flex-[1_1_160px]" value={waarde} onChange={(e) => setWaarde(e.target.value)}>
        <option value="">{leeg}</option>
        {KEUZES.map((k) => (
          <option key={k.waarde} value={k.waarde}>
            {k.tekst}
          </option>
        ))}
      </select>
      {zelf && (
        <>
          <label htmlFor={`${id}-naam`} className="sr-only">
            Eigen naam
          </label>
          <input id={`${id}-naam`} className="veld min-w-0 flex-[1_1_160px]" placeholder="Bijvoorbeeld: aquariumpomp" maxLength={40} value={naam} onChange={(e) => setNaam(e.target.value)} />
        </>
      )}
      <button type="submit" className="knop knop-hoofd" disabled={!klaar}>
        {knop}
      </button>
      {onAnnuleer && (
        <button type="button" className="knop" onClick={onAnnuleer}>
          Annuleren
        </button>
      )}
    </form>
  );
}

/** Eén regel met "Klopt" en "Dat was …" (alleen voor de eigenaar). */
function Regel({ regel, tijdTekst, onLabel, gedaan }) {
  const [open, setOpen] = useState(false);
  const woord = zekerWoord(regel.zeker, regel.bevestigd);
  return (
    <li className="grid min-w-0 grid-cols-1 gap-1.5 border-t border-lijn pt-2 first:border-t-0 first:pt-0">
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="min-w-0 [overflow-wrap:anywhere]">
          <span className="font-semibold">{regelNaam(regel)}</span> <span className="cijfer">({vermogen(regel.w)})</span>
          {woord && !regel.bevestigd && <span className="text-tekst-zacht"> · {woord}</span>}
        </span>
        {tijdTekst && <span className="cijfer text-[13px] text-tekst-zacht">{tijdTekst}</span>}
      </div>
      {regel.bevestigd || gedaan ? (
        <span className="inline-flex items-center gap-1.5 text-[13px] text-tekst-zacht">
          <CircleCheck size={16} style={{ color: 'var(--goed)' }} aria-hidden="true" />
          {gedaan ? 'Onthouden; het programmaatje leert het binnen een minuut.' : 'Zo aangewezen'}
        </span>
      ) : (
        onLabel &&
        (open ? (
          <Keuze
            voorstel={regel.soort ?? ''}
            onAnnuleer={() => setOpen(false)}
            onKies={async (keuze) => {
              if (await onLabel(labelVoor(regel, keuze))) setOpen(false);
            }}
          />
        ) : (
          <div className="flex flex-wrap gap-2">
            {regel.soort && woord && (
              <button type="button" className="knop" onClick={() => onLabel(labelVoor(regel, { soort: regel.soort, naam: regel.naam }))}>
                <Check size={18} aria-hidden="true" /> Klopt
              </button>
            )}
            <button type="button" className="knop" onClick={() => setOpen(true)}>
              Dat was…
            </button>
          </div>
        ))
      )}
    </li>
  );
}

/**
 * Eén vraag bovenaan de kaart (brug 1.4.0): "Er komt iets terug van zo'n
 * 1,8 kW … Wat is het?", met de keuzelijst, en "Weet ik niet" en "Later" (dan
 * een week niet). Alleen voor de eigenaar.
 */
function Vraag({ groep, nu, onAntwoord, onLater }) {
  const titelId = useId();
  const zinnen = vraagZinnen(groep, nu);
  return (
    <li className="grid min-w-0 grid-cols-1 gap-2 rounded-xl border border-lijn bg-vlak-hoog p-3" aria-labelledby={titelId}>
      <p id={titelId} className="m-0 flex min-w-0 items-start gap-2 text-[15px] leading-snug font-semibold">
        <CircleHelp size={18} className="mt-0.5 shrink-0" style={{ color: 'var(--apparaat)' }} aria-hidden="true" />
        <span className="min-w-0 [overflow-wrap:anywhere]">{zinnen[0]}</span>
      </p>
      {zinnen.length > 1 && (
        <p className="m-0 min-w-0 text-[14px] leading-snug text-tekst-zacht [overflow-wrap:anywhere]">{zinnen.slice(1).join(' ')}</p>
      )}
      <p className="m-0 text-[15px] font-semibold">
        Wat is het?
        {groep.vermoeden && <span className="font-normal text-tekst-zacht"> Misschien een {SOORT_NAAM[groep.vermoeden].toLowerCase()}.</span>}
      </p>
      <Keuze voorstel={groep.vermoeden ?? ''} knop="Dit is het" vraag="Wat is het?" leeg="Kies wat het is…" onKies={(keuze) => onAntwoord(labelVoorGroep(groep, keuze))} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="knop" onClick={() => onLater(groep)}>
          Weet ik niet
        </button>
        <button type="button" className="knop" onClick={() => onLater(groep)}>
          <Clock size={18} aria-hidden="true" /> Later
        </button>
      </div>
    </li>
  );
}

/**
 * Kaart op Apparaten: "Wat gebruikt er nu stroom?" Wat het programmaatje thuis
 * raadt uit het huisverbruik (brug/herkennen.mjs). Kort, voor iedereen: één
 * hoofdregel (wat staat er nu aan, of niets apart) en wat altijd aan staat.
 * Met brug 1.4.0 daarboven wat het programmaatje kent ("Ik ken nu 4
 * apparaten van je; 1 vraag staat open") en voor de eigenaar hooguit twee
 * vragen over wat terugkomt (vragenVan); "Weet ik niet" of "Later" laat zo'n
 * vraag een week rusten (op de server, en meteen op dit toestel).
 * De rest staat in een blok dat dicht staat: eerder vandaag, terugkerende
 * onbekenden ("Wat is dit?") en, voor de eigenaar, het aanwijzen ("Klopt",
 * "Dat was …"); daarvan leert het programmaatje. Een kijker ziet geen knoppen
 * en geen vragen.
 * De week per apparaat staat op één plek: Overzicht › Week (`onWeek`).
 * Een oudere brug: de vraag om bij te werken. Alleen kijken, nooit bedienen.
 *
 * @param {{ herkend: object|null, brugVersie: string|null, eigenaar: boolean,
 *           onLabel?: (label: object) => Promise<boolean>, onWeek?: () => void, nu: number }} props
 */
export default function Herkennen({ herkend, brugVersie, eigenaar, onLabel = null, onWeek = null, nu }) {
  const [gedaan, setGedaan] = useState(() => new Set());
  const [melding, setMelding] = useState(null);
  const [uitgesteld, setUitgesteld] = useState(() => leesUitgesteld(nu));
  const [bedankt, setBedankt] = useState(null);
  const stand = kaartStand(herkend, brugVersie);
  if (stand === 'niets') return null;

  const label = eigenaar && onLabel
    ? async (l) => {
        setMelding(null);
        const uit = await onLabel(l);
        if (uit === true) {
          setGedaan((oud) => new Set([...oud, l.id]));
          return true;
        }
        setMelding(typeof uit === 'string' ? uit : 'Bewaren lukte niet. Probeer het zo nog eens.');
        return false;
      }
    : null;

  const kop = (
    <span className="flex items-center gap-2.5">
      <Rondje soort="apparaat" icoon={ScanSearch} />
      <span className="text-[12.5px] font-semibold tracking-wide text-tekst-zacht uppercase">Wat gebruikt er nu stroom?</span>
    </span>
  );

  if (stand !== 'kaart') {
    return (
      <section className="grid min-w-0 grid-cols-1 gap-2 rounded-2xl border border-lijn bg-vlak p-3.5" aria-label="Wat gebruikt er nu stroom?">
        {kop}
        <p className="m-0 text-[14px] leading-relaxed">
          {stand === 'geduld'
            ? 'Het programmaatje kijkt mee. Over een paar minuten staat hier welk apparaat er stroom gebruikt.'
            : eigenaar
              ? 'Het programmaatje kan herkennen welk apparaat stroom gebruikt (koelkast, wasmachine, strijkijzer…) vanaf versie 0.11.0. Hoe je het bijwerkt, staat bovenaan bij Het programmaatje thuis.'
              : `Het programmaatje thuis kan herkennen welk apparaat stroom gebruikt als het bijgewerkt is. ${zieApparaten(false)}`}
        </p>
      </section>
    );
  }

  const vandaag = new Date(nu).setHours(0, 0, 0, 0);
  const eerder = herkend.recent.filter((r) => r.tot >= vandaag);
  const aan = nuRegel(herkend.nu);
  const basis = basisKort(herkend.basis);
  const nacht = nachtZin(herkend.basis);
  const nuAanwijzen = label !== null && herkend.nu.length > 0;
  // Bovenaan (brug 1.4.0): hooguit twee vragen, alleen voor de eigenaar; wat net beantwoord is, verdwijnt meteen.
  const vragen = label ? vragenVan(herkend, { uitgesteld }).filter((c) => !gedaan.has(c.id)) : [];
  const gevraagd = new Set(vragen.map((c) => c.id));
  // In het blok eronder: de andere terugkerende (een oudere brug: allemaal, zoals vroeger).
  const overig = herkend.onbekend.filter((c) => !gevraagd.has(c.id));
  const kennis = kennisZin(herkend.kennis, vragen.length);
  const kent = kennisRegels(herkend.kennis);
  const meer = nuAanwijzen || overig.length > 0 || eerder.length > 0 || nacht !== null || kent.length > 0;
  const titel = uitklapTitel({
    eigenaar: label !== null,
    nu: herkend.nu.length,
    eerder: eerder.length,
    onbekend: overig.length,
    vragen: label ? overig.filter((c) => !gedaan.has(c.id) && !c.later && !uitgesteld[c.id]).length : 0,
  });
  const later = async (c) => {
    setUitgesteld(zetUitgesteld(c.id, nu));
    setBedankt('Goed, ik vraag het over een week nog eens.');
    // Lukt het op de server niet (een oudere functie kent "later" nog niet): dit toestel onthoudt het toch.
    try {
      if (onLabel) await onLabel(laterLabel(c));
    } catch {
      // Niets aan te doen; dit toestel weet het.
    }
  };
  const antwoord = async (l) => {
    if (!(await label(l))) return;
    setUitgesteld(zetUitgesteld(l.id, nu, BEANTWOORD_MS));
    setBedankt('Dank je! Onthouden; het programmaatje noemt het binnen een minuut zo.');
  };

  return (
    <section className="grid min-w-0 grid-cols-1 gap-2 rounded-2xl border border-lijn bg-vlak p-3.5" aria-label="Wat gebruikt er nu stroom?">
      {kop}
      {kennis && (
        <p className="m-0 flex min-w-0 items-start gap-1.5 text-[14px] text-tekst-zacht">
          <Lightbulb size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0">{kennis}</span>
        </p>
      )}

      {bedankt && (
        <p className="m-0 inline-flex min-w-0 items-start gap-1.5 text-[14px] text-tekst-zacht" role="status">
          <CircleCheck size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--goed)' }} aria-hidden="true" />
          <span className="min-w-0">{bedankt}</span>
        </p>
      )}

      {vragen.length > 0 && (
        <div className="grid min-w-0 grid-cols-1 gap-2">
          {melding && (
            <p className="m-0 text-[14px]" role="alert" style={{ color: 'var(--let-op)' }}>
              {melding}
            </p>
          )}
          <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 text-tekst" aria-label="Vragen van het programmaatje">
            {vragen.map((c) => (
              <Vraag key={c.id} groep={c} nu={nu} onAntwoord={antwoord} onLater={later} />
            ))}
          </ul>
          <p className="m-0 text-[13px] leading-snug text-tekst-zacht">Zo leert het programmaatje jouw apparaten kennen. Het vraagt niet vaker dan nodig.</p>
        </div>
      )}

      <div className="grid min-w-0 grid-cols-1 gap-1 leading-relaxed">
        {herkend.oud ? (
          <p className="m-0 text-[15px] text-tekst-zacht">Het programmaatje stuurde een paar minuten niets over de apparaten.</p>
        ) : aan ? (
          <p className="m-0 min-w-0 text-[15.5px] [overflow-wrap:anywhere]">
            <span className="font-semibold">Nu aan:</span> {aan}
          </p>
        ) : (
          <p className="m-0 text-[15.5px]">Nu staat er niets apart aan.</p>
        )}
        {basis && <p className="m-0 text-[14px] text-tekst-zacht">{basis}</p>}
      </div>

      {meer && (
        <Uitklap titel={titel}>
          <div className="grid min-w-0 grid-cols-1 gap-3 pt-1 pb-1">
            {label && (nuAanwijzen || eerder.length > 0) && (
              <p className="m-0 text-[13px] leading-snug text-tekst-zacht">Klopt het? Wijs het aan: zo leert het programmaatje jouw apparaten kennen.</p>
            )}

            {melding && !vragen.length && (
              <p className="m-0 text-[14px]" role="alert" style={{ color: 'var(--let-op)' }}>
                {melding}
              </p>
            )}

            {kent.length > 0 && (
              <div className="grid min-w-0 grid-cols-1 gap-1.5 text-tekst">
                <h3 className="m-0 text-[15px] font-semibold">Wat ik al ken</h3>
                <ul className="m-0 grid list-none grid-cols-1 gap-1 p-0 text-[14px]">
                  {kent.map((k) => (
                    <li key={k.sleutel} className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                      <span className="font-semibold [overflow-wrap:anywhere]">{k.naam}</span>
                      <span className="text-tekst-zacht">
                        {k.woord} · {k.uitleg}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {nuAanwijzen && (
              <div className="grid min-w-0 grid-cols-1 gap-2">
                <h3 className="m-0 text-[15px] font-semibold text-tekst">Nu</h3>
                <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 text-tekst" aria-label="Nu aan">
                  {herkend.nu.map((r) => (
                    <Regel key={r.id} regel={r} tijdTekst={null} onLabel={label} gedaan={gedaan.has(r.id)} />
                  ))}
                </ul>
              </div>
            )}

            {overig.length > 0 && (
              <div className="grid min-w-0 grid-cols-1 gap-2 text-tekst">
                <h3 className="m-0 text-[15px] font-semibold">{vragen.length ? 'Komt ook vaker terug' : 'Wat is dit?'}</h3>
                <ul className="m-0 grid list-none grid-cols-1 gap-2.5 p-0">
                  {overig.map((c) => (
                    <li key={c.id} className="grid min-w-0 grid-cols-1 gap-1.5">
                      <span className="flex min-w-0 items-start gap-2 text-[14px] leading-snug">
                        <CircleHelp size={16} className="mt-0.5 shrink-0 text-tekst-zacht" aria-hidden="true" />
                        <span className="min-w-0 [overflow-wrap:anywhere]">
                          {onbekendZin(c)}
                          {c.vermoeden && <span className="text-tekst-zacht"> · misschien een {SOORT_NAAM[c.vermoeden].toLowerCase()}</span>}
                        </span>
                      </span>
                      {gedaan.has(c.id) ? (
                        <span className="inline-flex items-center gap-1.5 text-[13px] text-tekst-zacht">
                          <CircleCheck size={16} style={{ color: 'var(--goed)' }} aria-hidden="true" />
                          Onthouden voor alle {c.n} keer; het programmaatje leert het binnen een minuut.
                        </span>
                      ) : (
                        label && <Keuze voorstel={c.vermoeden ?? ''} knop="Dit is het" vraag="Wat is het?" leeg="Kies wat het is…" onKies={(keuze) => antwoord(labelVoorGroep(c, keuze))} />
                      )}
                    </li>
                  ))}
                </ul>
                {!label && <p className="m-0 text-[13px] text-tekst-zacht">De eigenaar kan aanwijzen wat het is.</p>}
              </div>
            )}

            {eerder.length > 0 && (
              <div className="grid min-w-0 grid-cols-1 gap-2 text-tekst">
                <h3 className="m-0 text-[15px] font-semibold">Eerder vandaag</h3>
                <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0">
                  {eerder.map((r) => (
                    <Regel key={r.id} regel={r} tijdTekst={vanTot(r.van, r.tot)} onLabel={label} gedaan={gedaan.has(r.id)} />
                  ))}
                </ul>
              </div>
            )}

            {nacht && <p className="m-0 text-[13px] text-tekst-zacht">Wat altijd aan staat, is {nacht}.</p>}
          </div>
        </Uitklap>
      )}

      {onWeek && (
        <button type="button" className="knop knop-breed" onClick={onWeek}>
          <span className="min-w-0 leading-snug">Per week of maand: Overzicht › Week</span>
          <ChevronRight size={18} className="flex-none text-tekst-zacht" aria-hidden="true" />
        </button>
      )}
    </section>
  );
}
