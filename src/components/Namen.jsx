import { RotateCcw, Zap } from 'lucide-react';
import { useId, useState } from 'react';
import { grensBij, ZEKERING_A } from '@/lib/fasen';
import { keuzeTab, keuzeToets } from '@/lib/keuzeToets';
import { AMPERE, BATTERIJ_ROLLEN, BATTERIJ_STANDAARD_W, geldigeAmpere, geldigMax, MAX_W, NAAM_MAX } from '@/lib/opstelling';
import { PuntIcoon } from './iconen';

/**
 * Een maximaal vermogen intypen. Het getal gaat pas naar de opstelling als het
 * klopt (100 tot 100.000 W) of leeg is: anders zou halverwege het typen ("80")
 * iets bewaard worden dat de server weigert.
 */
function VermogenRegel({ punt, onVermogen }) {
  const hintId = useId();
  const opgeslagen = punt.eigenMax == null ? '' : String(punt.eigenMax);
  // Tijdens het typen wat er staat; daarna (en als het van buiten verandert) wat bewaard is.
  const [bezig, setBezig] = useState(null);
  const tekst = bezig ?? opgeslagen;

  const schoon = tekst.replace(/[\s.]/g, '');
  const getal = schoon === '' ? null : Number(schoon);
  const klopt = schoon === '' || geldigMax(getal) !== null;
  const standaard = punt.soort === 'batterij' ? String(BATTERIJ_STANDAARD_W) : 'geen ring';

  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
      <PuntIcoon punt={punt} size={18} className="flex-none text-tekst-zacht" />
      <label htmlFor={`${hintId}-veld`} className="truncate text-[14.5px]">
        {punt.naam}
      </label>
      {/* De breedte op de omhulling: .veld zet zelf width: 100%, en dat wint van een utility-klasse. */}
      <span className="flex w-[7rem] flex-none items-center gap-1.5">
        <input
          id={`${hintId}-veld`}
          className="veld text-right"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={tekst}
          placeholder={standaard}
          aria-invalid={klopt ? 'false' : 'true'}
          aria-describedby={klopt ? undefined : hintId}
          onChange={(e) => {
            const nieuw = e.target.value;
            setBezig(nieuw);
            const kaal = nieuw.replace(/[\s.]/g, '');
            if (kaal === '') onVermogen(punt.sleutel, null);
            else if (geldigMax(Number(kaal)) !== null) onVermogen(punt.sleutel, Number(kaal));
          }}
          // Klaar met typen: weer wat bewaard is (een half getal valt zo terug).
          onBlur={() => setBezig(null)}
        />
        <span className="text-[14px] text-tekst-zacht" aria-hidden="true">
          W
        </span>
      </span>
      {!klopt && (
        <p id={hintId} className="col-span-3 m-0 text-[13px] text-let-op">
          Een maximum is {MAX_W.laag} tot {MAX_W.hoog.toLocaleString('nl-NL')} W.
        </p>
      )}
    </li>
  );
}

/**
 * Een grens of zekering per fase intypen, in ampère (1 tot 200, een komma mag).
 * Net als VermogenRegel: pas doorgeven als het klopt of leeg is.
 */
function AmpereRegel({ label, waarde, standaard, onWaarde }) {
  const id = useId();
  const opgeslagen = waarde == null ? '' : String(waarde).replace('.', ',');
  const [bezig, setBezig] = useState(null);
  const tekst = bezig ?? opgeslagen;
  const getalVan = (t) => {
    const kaal = t.replace(/\s/g, '').replace(',', '.');
    return kaal === '' ? null : Number(kaal);
  };
  const klopt = tekst.trim() === '' || geldigeAmpere(getalVan(tekst)) !== null;
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
      <Zap size={18} className="flex-none text-tekst-zacht" aria-hidden="true" />
      <label htmlFor={`${id}-veld`} className="text-[14.5px]">
        {label}
      </label>
      <span className="flex w-[7rem] flex-none items-center gap-1.5">
        <input
          id={`${id}-veld`}
          className="veld text-right"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={tekst}
          placeholder={String(standaard).replace('.', ',')}
          aria-invalid={klopt ? 'false' : 'true'}
          aria-describedby={klopt ? undefined : id}
          onChange={(e) => {
            const nieuw = e.target.value;
            setBezig(nieuw);
            const a = getalVan(nieuw);
            if (a === null) onWaarde(null);
            else if (geldigeAmpere(a) !== null) onWaarde(a);
          }}
          onBlur={() => setBezig(null)}
        />
        <span className="text-[14px] text-tekst-zacht" aria-hidden="true">
          A
        </span>
      </span>
      {!klopt && (
        <p id={id} className="col-span-3 m-0 text-[13px] text-let-op">
          Vul {AMPERE.laag} tot {AMPERE.hoog} A in.
        </p>
      )}
    </li>
  );
}

/**
 * Instellingen › Namen (alleen de eigenaar): elk rondje een eigen naam in de
 * app. Die staat overal: op de foto, in de kaarten, in het detailblad en bij
 * de zon per plek. Leeg = de naam van thuis (instellingen.json van het
 * programmaatje), of Zon, Huis, Batterij, Net.
 *
 * Daaronder het maximale vermogen van de panelen en de batterij: daarmee
 * vult de ring om hun rondje op de foto zich (src/lib/ringen.js). En de
 * grens en zekering per fase (`fase`, `onFase`): vanaf de grens zegt Nu rustig
 * dat een fase zwaar belast is (src/lib/fasen.js). En met een batterij wat
 * hij doet, voor het Advies op Huis (`batterijRol`, `onBatterijRol`): eigen
 * gebruik (standaard) of handelen. Die keuze stond eerst op de kaart Advies;
 * daar is hij weg, zodat de kaart eenvoudig blijft.
 */
export default function Namen({ punten, onNaam, onVermogen, fase = null, onFase, voorbeeld, batterijRol = 'eigen', onBatterijRol = null, zonFase = null }) {
  const maxKop = useId();
  const zonFaseKop = useId();
  const faseKop = useId();
  const rolKop = useId();
  const metBatterij = punten.some((p) => p.soort === 'batterij');
  const metMax = punten.filter((p) => p.soort === 'zon' || p.soort === 'batterij');
  return (
    <div className="grid gap-4">
      <p className="m-0 max-w-[60ch] text-[14.5px] text-tekst-zacht">
        Geef een rondje een eigen naam; die zie je dan overal in de app. Laat je het leeg, dan heet het zoals thuis het
        noemt (in grijs).
      </p>
      <ul className="m-0 grid list-none gap-2 p-0">
        {punten.map((punt) => (
          <li key={punt.sleutel} className="flex items-center gap-2">
            <PuntIcoon punt={punt} size={18} className="flex-none text-tekst-zacht" />
            <input
              className="veld flex-1"
              value={punt.eigenNaam}
              placeholder={punt.bronNaam}
              maxLength={NAAM_MAX}
              aria-label={`Naam voor ${punt.bronNaam}`}
              onChange={(e) => onNaam(punt.sleutel, e.target.value)}
            />
            {punt.eigenNaam ? (
              <button
                type="button"
                className="knop size-11 flex-none px-0"
                aria-label={`${punt.bronNaam}: weer de naam van thuis`}
                onClick={() => onNaam(punt.sleutel, '')}
              >
                <RotateCcw size={18} aria-hidden="true" />
              </button>
            ) : (
              <span className="size-11 flex-none" aria-hidden="true" />
            )}
          </li>
        ))}
      </ul>

      {onVermogen && metMax.length > 0 && (
        <section className="grid gap-3 border-t border-lijn pt-4" aria-labelledby={maxKop}>
          <h3 id={maxKop} className="m-0 text-[16px] font-semibold">
            Maximaal vermogen
          </h3>
          <p className="m-0 max-w-[60ch] text-[14.5px] text-tekst-zacht">
            Om het rondje op de foto loopt een ring die meegroeit: bij panelen met wat ze nu leveren, bij de batterij met
            hoe hard hij laadt (groen) of levert (oranje). Vul hier het maximum in. Leeg: bij panelen geen ring, bij de
            batterij {BATTERIJ_STANDAARD_W.toLocaleString('nl-NL')} W, zoals een SolarFlow 2400 AC.
          </p>
          <ul className="m-0 grid list-none gap-2 p-0">
            {metMax.map((punt) => (
              <VermogenRegel key={punt.sleutel} punt={punt} onVermogen={onVermogen} />
            ))}
          </ul>
        </section>
      )}

      {onFase && fase && (
        <section className="grid gap-3 border-t border-lijn pt-4" aria-labelledby={faseKop}>
          <h3 id={faseKop} className="m-0 text-[16px] font-semibold">
            Fasen en zekering
          </h3>
          <p className="m-0 max-w-[60ch] text-[14.5px] text-tekst-zacht">
            Trekt een fase meer dan de grens, dan zegt Nu dat rustig (geen alarm), met de zekering erbij. Leeg: de grens is 80%
            {` van de zekering, en de zekering ${ZEKERING_A} A (de gewone hoofdzekering).`}
            {fase.metFasen ? '' : ' Je meter geeft (nog) geen stroom per fase door; dan doet dit niets.'}
          </p>
          <ul className="m-0 grid list-none gap-2 p-0">
            <AmpereRegel label="Grens per fase" waarde={fase.faseGrens} standaard={grensBij(fase.zekering ?? ZEKERING_A)} onWaarde={(a) => onFase('faseGrens', a)} />
            <AmpereRegel label="Hoofdzekering" waarde={fase.zekering} standaard={ZEKERING_A} onWaarde={(a) => onFase('zekering', a)} />
          </ul>
        </section>
      )}

      {onBatterijRol && metBatterij && (
        <section className="grid gap-3 border-t border-lijn pt-4" aria-labelledby={rolKop}>
          <h3 id={rolKop} className="m-0 text-[16px] font-semibold">
            Batterij in het advies
          </h3>
          <p className="m-0 max-w-[60ch] text-[14.5px] text-tekst-zacht">
            Waar het advies op Huis mee rekent. De app stuurt de batterij niet; dat doet de Zendure-app (of ZENKI) zelf.
          </p>
          <div role="radiogroup" aria-labelledby={rolKop} className="segmenten max-w-sm" onKeyDown={keuzeToets}>
            {BATTERIJ_ROLLEN.map((r, i) => (
              <button
                key={r.sleutel}
                type="button"
                role="radio"
                aria-checked={batterijRol === r.sleutel ? 'true' : 'false'}
                tabIndex={keuzeTab(batterijRol === r.sleutel, i)}
                className="keuze"
                onClick={() => onBatterijRol(r.sleutel)}
              >
                {r.naam}
              </button>
            ))}
          </div>
          <p className="m-0 max-w-[60ch] text-[13.5px] leading-snug text-tekst-zacht">
            {batterijRol === 'handelen'
              ? 'Laden als stroom goedkoop is, ook uit het net, en terugleveren als hij duur is. Het advies rekent er alleen mee als het na het verlies echt iets oplevert.'
              : "Zo veel mogelijk eigen zon opslaan en 's avonds zelf gebruiken."}
          </p>
        </section>
      )}

      {zonFase && (
        <section className="grid gap-3 border-t border-lijn pt-4" aria-labelledby={zonFaseKop}>
          <h3 id={zonFaseKop} className="m-0 text-[16px] font-semibold">
            Fase van de zonnepanelen
          </h3>
          <p className="m-0 max-w-[60ch] text-[14.5px] text-tekst-zacht">
            De kWh-meter op de zonnepanelen meet één fase. Weet je welke? Dan zet Apparaten › Netspanning zijn spanning naast die van
            dezelfde fase van de andere meter, met het verschil (iets over de kabel tussen de omvormer en de meterkast).
          </p>
          <div role="radiogroup" aria-labelledby={zonFaseKop} className="segmenten max-w-sm" onKeyDown={keuzeToets}>
            {[null, 1, 2, 3].map((f, i) => (
              <button
                key={String(f)}
                type="button"
                role="radio"
                aria-checked={zonFase.fase === f ? 'true' : 'false'}
                tabIndex={keuzeTab(zonFase.fase === f, i)}
                className="keuze"
                onClick={() => zonFase.onFase(f)}
              >
                {f === null ? 'Weet ik niet' : `L${f}`}
              </button>
            ))}
          </div>
        </section>
      )}

      <p className="m-0 text-[13px] text-tekst-zacht">
        {voorbeeld ? 'In dit voorbeeld blijven de namen op dit toestel.' : 'Iedereen die meekijkt, ziet dezelfde namen.'}
      </p>
    </div>
  );
}
