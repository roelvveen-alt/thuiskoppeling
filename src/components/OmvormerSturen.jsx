import { CircleAlert, CircleCheck, Gauge, Power, RotateCcw } from 'lucide-react';
import { useId, useState } from 'react';
import { keuzeTab, keuzeToets } from '@/lib/keuzeToets';
import { blokkenVanaf, blokNu, blokZin, controleZin, dagNaam, datumVan, foutZin, liveRegel, oorspronkelijkZin, standZin } from '@/lib/omvormerSturen';

/** Mag het programmaatje dit (versie 1.5.0 of nieuwer stuurt `sturen` mee)? */
const kanSturen = (sturen) => Boolean(sturen);

/**
 * "Nu weer aan" is doorgegeven maar het programmaatje heeft het nog niet opgepakt: de
 * functie geeft het hem bij de volgende meting (hooguit een halve minuut later).
 */
const wachtOpNuAan = (instelling, sturen) => Boolean(instelling?.vrijOp) && (!sturen?.vrijOp || sturen.vrijOp < instelling.vrijOp);

/**
 * De stand en het plan van het begrenzen, kort: op Apparaten bij de omvormer en bij de
 * prijzen in Overzicht. Alleen voor de eigenaar (een kijker krijgt `sturen` niet). Met
 * `onNuAan` ook de knop "Nu weer aan" tijdens een blok.
 *
 * Sinds programmaatje 1.6.0 ook de zelfcontrole ("Nagekeken op 1 nov: …", "Werkt niet op deze
 * omvormer, uitgezet") en tijdens een blok een live regel: de grens, wat hij levert (`omvormerW`)
 * en wat er naar het net gaat (`netW`, plus = afnemen).
 *
 * @param {{ sturen: object|null, instelling?: object|null, nu: number, onNuAan?: (() => Promise<string|true>)|null, kop?: boolean, omvormerW?: number|null, netW?: number|null }} props
 */
export function SturenKaart({ sturen, instelling = null, nu, onNuAan = null, kop = true, omvormerW = null, netW = null }) {
  const kopId = useId();
  const [bezig, setBezig] = useState(false);
  const [melding, setMelding] = useState(null);
  if (!sturen) return null;
  const blokken = blokkenVanaf(sturen, nu).slice(0, 3);
  const aan = instelling ? instelling.aan : sturen.aan;
  if (!aan && !blokken.length && sturen.stand !== 'begrensd') return null;
  const stand = standZin(sturen);
  const fout = foutZin(sturen);
  const live = liveRegel(sturen, { omvormerW, netW });
  const controle = controleZin(sturen);
  const werktNiet = sturen.controle?.uitkomst === 'werkt-niet';
  const lopend = blokNu(sturen, nu);
  const knop = onNuAan && sturen.stand === 'begrensd' && sturen.door === 'programmaatje';
  const nuAan = async () => {
    setBezig(true);
    const uit = await onNuAan();
    setBezig(false);
    setMelding(uit === true ? 'Doorgegeven: het programmaatje geeft hem binnen een minuut vrij.' : uit);
  };
  return (
    <section className="grid min-w-0 gap-1.5" aria-labelledby={kop ? kopId : undefined} aria-label={kop ? undefined : 'Begrenzen bij een negatieve prijs'}>
      {kop && (
        <h3 id={kopId} className="flex items-center gap-2 text-[13px] font-semibold tracking-wide text-tekst-zacht uppercase">
          <Gauge size={16} aria-hidden="true" /> Begrenzen bij negatieve prijs
        </h3>
      )}
      {!aan ? (
        <p className="m-0 text-[13.5px] leading-snug text-tekst-zacht">
          {blokken[0] ? `${blokZin(blokken[0], nu, { verbruikW: sturen.verbruikW })} ` : ''}Begrenzen staat uit (Instellingen › Omvormer).
        </p>
      ) : (
        <>
          {stand && <p className="m-0 text-[14px] leading-snug">{stand}</p>}
          {live && <p className="m-0 text-[13.5px] leading-snug tabular-nums">{live}</p>}
          {controle && <ControleRegel zin={controle} werktNiet={werktNiet} werkt={sturen.controle?.uitkomst === 'werkt'} />}
          {fout && (
            <p className="m-0 flex items-start gap-1.5 text-[13.5px] leading-snug text-let-op">
              <CircleAlert size={16} className="mt-0.5 flex-none" aria-hidden="true" /> {fout}
            </p>
          )}
          {blokken.length > 0 ? (
            <ul className="m-0 grid list-none gap-1 p-0 text-[13.5px] leading-snug">
              {blokken.map((b) => (
                <li key={b.van} className={b === lopend ? 'font-semibold' : undefined}>
                  {blokZin(b, nu, { verbruikW: sturen.verbruikW })}
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-[13.5px] text-tekst-zacht">Geen negatieve prijs in de prijzen die er nu zijn (die van morgen komen rond 13:00).</p>
          )}
        </>
      )}
      {knop && (
        <button type="button" className="knop justify-self-start" disabled={bezig || wachtOpNuAan(instelling, sturen)} onClick={nuAan}>
          <Power size={18} aria-hidden="true" /> Nu weer aan
        </button>
      )}
      {(melding || (knop && wachtOpNuAan(instelling, sturen))) && (
        <p className="m-0 text-[13px] text-tekst-zacht" role="status">
          {melding ?? 'Doorgegeven: het programmaatje geeft hem binnen een minuut vrij.'}
        </p>
      )}
    </section>
  );
}

/** De zelfcontrole in één regel: oranje als het niet werkt, met een vinkje als het werkt. */
function ControleRegel({ zin, werktNiet, werkt }) {
  if (werktNiet) {
    return (
      <p className="m-0 flex items-start gap-1.5 text-[13.5px] leading-snug text-let-op">
        <CircleAlert size={16} className="mt-0.5 flex-none" aria-hidden="true" /> {zin}
      </p>
    );
  }
  return (
    <p className="m-0 flex items-start gap-1.5 text-[13.5px] leading-snug text-tekst-zacht">
      {werkt && <CircleCheck size={16} className="mt-0.5 flex-none" aria-hidden="true" />} {zin}
    </p>
  );
}

const NETTO = Object.freeze([
  { sleutel: 'afnemer', naam: 'Ik neem meer af' },
  { sleutel: 'terugleveraar', naam: 'Ik lever meer terug' },
]);

/**
 * Instellingen › Omvormer (alleen de eigenaar, alleen met een GoodWe): de schakelaar
 * "Omvormer begrenzen als terugleveren geld kost" (standaard uit), per dag "niet", over het
 * jaar afnemer of terugleveraar, en tijdens een blok "Nu weer aan". De app bedient niets: het
 * programmaatje thuis hoort de instelling bij de volgende meting en beslist zelf. De functie
 * toetst de rechten ook (actie omvormerSturen).
 *
 * Zette het programmaatje het uit omdat begrenzen hier niet werkt (zelfcontrole, 1.6.0), dan
 * "Opnieuw proberen": dat zet het nog eens aan (de functie zet dan `op`), en het programmaatje
 * kijkt bij de volgende begrenzing opnieuw na.
 *
 * @param {{ voorbeeld?: boolean, instelling: object, sturen: object|null, nu: number, onWijzig: (w: object) => Promise<string|true>, omvormerW?: number|null, netW?: number|null }} props
 *   instelling: instellingUit (src/lib/omvormerSturen.js); onWijzig geeft true of een zin waarom niet
 */
export default function OmvormerSturen({ voorbeeld = false, instelling, sturen, nu, onWijzig, omvormerW = null, netW = null }) {
  const nettoKop = useId();
  const [bezig, setBezig] = useState(false);
  const [melding, setMelding] = useState(null);
  const wijzig = async (w) => {
    setBezig(true);
    const uit = await onWijzig(w);
    setBezig(false);
    setMelding(uit === true ? null : uit);
    return uit;
  };
  const blokken = blokkenVanaf(sturen, nu).filter((b) => b.modus !== 'loont-niet');
  const dagen = [...new Set(blokken.map((b) => datumVan(b.van)))].slice(0, 3);
  return (
    <div className="grid max-w-[640px] gap-4">
      <p className="m-0 max-w-[60ch] text-[14.5px] leading-relaxed">
        Kost terugleveren geld (een negatieve prijs, en vanaf 2027 zonder saldering vaker), dan kan het programmaatje thuis de
        GoodWe-omvormer zelf begrenzen tot ongeveer wat je huis en batterij gebruiken, en hem daarna weer vrijgeven. Gebruik je
        alles zelf, dan blijft hij aan. Bij twijfel of een fout geeft het programmaatje hem vrij.
      </p>
      <button
        type="button"
        role="switch"
        aria-checked={instelling.aan ? 'true' : 'false'}
        disabled={bezig}
        onClick={() => wijzig({ aan: !instelling.aan })}
        className="flex min-h-[48px] w-full cursor-pointer items-center gap-3 rounded-xl border border-lijn bg-vlak px-3 text-left text-tekst hover:bg-vlak-hoog"
      >
        <Gauge size={18} className="flex-none text-tekst-zacht" aria-hidden="true" />
        <span className="min-w-0 flex-1 text-[14.5px] font-semibold">Omvormer begrenzen als terugleveren geld kost</span>
        <span className="schakelaar" aria-hidden="true" />
      </button>
      {melding && (
        <p className="m-0 text-[14px] text-let-op" role="alert">
          {melding}
        </p>
      )}
      {!voorbeeld && !kanSturen(sturen) && (
        <p className="m-0 max-w-[60ch] text-[14px] text-tekst-zacht">
          Het programmaatje thuis kan dit vanaf versie 1.5.0. Tot het bijgewerkt is, gebeurt er niets (ook niet als het hier aan staat).
        </p>
      )}

      {instelling.aan && sturen && (
        <SturenKaart sturen={sturen} instelling={instelling} nu={nu} onNuAan={() => wijzig({ nu_aan: true })} kop={false} omvormerW={omvormerW} netW={netW} />
      )}
      {instelling.aan && sturen?.controle?.uitkomst === 'werkt-niet' && (
        <button type="button" className="knop justify-self-start" disabled={bezig} onClick={() => wijzig({ aan: true })}>
          <RotateCcw size={18} aria-hidden="true" /> Opnieuw proberen
        </button>
      )}
      {oorspronkelijkZin(sturen) && <p className="m-0 max-w-[60ch] text-[13px] text-tekst-zacht">{oorspronkelijkZin(sturen)}</p>}

      {instelling.aan && dagen.length > 0 && (
        <ul className="m-0 grid list-none gap-1.5 p-0">
          {dagen.map((d) => {
            const niet = instelling.nietOp.includes(d);
            const naam = dagNaam(Date.parse(`${d}T12:00:00`), nu);
            return (
              <li key={d}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={niet ? 'true' : 'false'}
                  disabled={bezig}
                  onClick={() => wijzig({ dag: d, niet: !niet })}
                  className="flex min-h-[48px] w-full cursor-pointer items-center gap-3 rounded-xl border border-lijn bg-vlak px-3 text-left text-tekst hover:bg-vlak-hoog"
                >
                  <span className="min-w-0 flex-1 text-[14.5px]">{naam.charAt(0).toUpperCase() + naam.slice(1)} niet begrenzen</span>
                  <span className="schakelaar" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <section className="grid gap-2 border-t border-lijn pt-4" aria-labelledby={nettoKop}>
        <h3 id={nettoKop} className="m-0 text-[16px] font-semibold">
          Over het hele jaar
        </h3>
        <p className="m-0 max-w-[60ch] text-[14px] text-tekst-zacht">
          Tot en met 2026 telt de saldering: neem je over het jaar meer af dan je teruglevert, dan krijg je de energiebelasting terug en
          loont begrenzen pas bij een heel lage prijs. Lever je meer terug, dan telt voor dat deel alleen de kale prijs.
        </p>
        <div role="radiogroup" aria-labelledby={nettoKop} className="segmenten max-w-md" onKeyDown={keuzeToets}>
          {NETTO.map((n, i) => (
            <button
              key={n.sleutel}
              type="button"
              role="radio"
              aria-checked={instelling.netto === n.sleutel ? 'true' : 'false'}
              tabIndex={keuzeTab(instelling.netto === n.sleutel, i)}
              disabled={bezig}
              className="keuze"
              onClick={() => wijzig({ netto: n.sleutel })}
            >
              {n.naam}
            </button>
          ))}
        </div>
      </section>

      <section className="grid gap-1.5 border-t border-lijn pt-4">
        <h3 className="m-0 text-[16px] font-semibold">Samen testen</h3>
        <p className="m-0 max-w-[60ch] text-[14px] leading-relaxed text-tekst-zacht">
          Hoeft niet: na elke begrenzing kijkt het programmaatje zelf of het werkt (hierboven). Wil je het zien: stop het programmaatje en
          typ <code className="code">node brug.mjs omvormer-test</code>. Het begrenst hem 2 minuten naar 0% (met aftellen), bij veel zon
          kort 50%, zet de schakelaar van de grens weer uit en zegt in gewone woorden wat er gebeurde. Ctrl+C zet hem meteen weer vrij.
        </p>
      </section>
    </div>
  );
}
