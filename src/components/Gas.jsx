import { Flame, Plus, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { hoeveel, vandaagVan } from '@/lib/meterkast';
import { korteDatum } from '@/lib/periode';
import { datumVan } from '@/lib/prijsoverzicht';

/**
 * Wat iemand als meterstand typt, als getal: "2569,646", "2.569,646" en "2569.646"
 * worden 2569.646; "2.569" (een punt voor precies drie cijfers, zonder komma) is
 * 2569. Iets anders: null.
 */
export function standUit(tekst) {
  const kaal = String(tekst ?? '').replace(/\s/g, '');
  const getal = kaal.includes(',') ? kaal.replace(/\./g, '').replace(',', '.') : /^\d{1,3}(\.\d{3})+$/.test(kaal) ? kaal.replace(/\./g, '') : kaal;
  return /^\d{1,9}(\.\d{1,3})?$/.test(getal) ? Number(getal) : null;
}

/**
 * Instellingen › Gas (ronde 23: "Gasverbruik (meterstand) invullen bij
 * Instellingen"): zelf gasmeterstanden invullen, voor een huis waar de slimme
 * meter het gas niet doorgeeft. Overzicht rekent er het gas per dag uit
 * (src/lib/gasStanden.js). Geeft de P1-meter het gas wel door, dan gaat dat voor
 * en zijn de standen hier alleen om te vergelijken. Alleen de eigenaar ziet dit
 * (Instellingen › Gas staat niet bij een kijker); de server toetst het ook.
 *
 * @param {{ standen: Array<{ datum: string, stand: number }>, meterkast: object|null, nu: number,
 *   onStand: (verzoek: object) => Promise<{ ok?: boolean, fout?: string }> }} props
 */
export default function Gas({ standen = [], meterkast = null, nu, onStand }) {
  const id = useId();
  const vandaag = datumVan(nu);
  const [datum, setDatum] = useState(vandaag);
  const [tekst, setTekst] = useState('');
  const [bezig, setBezig] = useState(false);
  const [melding, setMelding] = useState(null);
  const stand = standUit(tekst);
  const meterGas = meterkast?.meters?.find((m) => m.soort === 'gas') ?? null;

  const bewaar = async (verzoek) => {
    setBezig(true);
    setMelding(null);
    const uit = await onStand(verzoek);
    setBezig(false);
    if (uit?.fout) setMelding({ tekst: uit.fout, letOp: true });
    return uit;
  };

  return (
    <div className="grid max-w-[60ch] gap-4">
      <div className="grid gap-2">
        <h3 className="flex items-center gap-2 text-[15px] font-semibold">
          <Flame size={18} style={{ color: 'var(--net)' }} aria-hidden="true" /> Gasmeterstanden
        </h3>
        {meterGas ? (
          <p className="m-0 text-[14px] text-tekst-zacht">
            De slimme meter geeft het gas al door (stand nu <span className="cijfer">{hoeveel(meterGas.stand, 'm3', { stand: true })}</span>
            {vandaagVan(meterkast, 'gas') !== null ? <>, vandaag <span className="cijfer">{hoeveel(vandaagVan(meterkast, 'gas'), 'm3')}</span></> : null}). Wat je hier
            invult, is alleen om te vergelijken: Overzicht gebruikt de meter.
          </p>
        ) : (
          <p className="m-0 text-[14px] text-tekst-zacht">
            Geeft de slimme meter het gas niet door? Vul dan af en toe de stand van de gasmeter in. Overzicht verdeelt wat er tussen twee standen
            bij kwam eerlijk over de dagen ertussen. Een prijs voor gas kent de app nog niet: alleen m³.
          </p>
        )}
      </div>

      <form
        className="grid gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (stand === null || bezig) return;
          const uit = await bewaar({ stand: { datum, stand } });
          if (uit?.ok) {
            setTekst('');
            setMelding({ tekst: `Bewaard: ${korteDatum(datum)}, ${hoeveel(stand, 'm3', { stand: true })}.`, letOp: false });
          }
        }}
      >
        <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-[minmax(0,9rem)_minmax(0,1fr)]">
          <label className="grid gap-1 text-[13.5px] text-tekst-zacht" htmlFor={`${id}-datum`}>
            Datum
            <input id={`${id}-datum`} className="veld" type="date" max={vandaag} value={datum} required onChange={(e) => setDatum(e.target.value || vandaag)} />
          </label>
          <label className="grid gap-1 text-[13.5px] text-tekst-zacht" htmlFor={`${id}-stand`}>
            Meterstand in m³
            <input
              id={`${id}-stand`}
              className="veld"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="bijvoorbeeld 2569,646"
              value={tekst}
              aria-invalid={tekst.trim() !== '' && stand === null ? 'true' : 'false'}
              onChange={(e) => setTekst(e.target.value)}
            />
          </label>
        </div>
        {tekst.trim() !== '' && stand === null && <p className="m-0 text-[13px] text-let-op">Typ de stand als getal, bijvoorbeeld 2569,646.</p>}
        <button type="submit" className="knop justify-self-start" disabled={stand === null || bezig}>
          <Plus size={18} aria-hidden="true" /> Stand bewaren
        </button>
        {melding && (
          <p className={`m-0 text-[13.5px] ${melding.letOp ? 'text-let-op' : 'text-tekst-zacht'}`} role="status">
            {melding.tekst}
          </p>
        )}
      </form>

      {standen.length > 0 && (
        <div className="grid gap-1.5">
          <h3 className="text-[13px] font-semibold tracking-wide text-tekst-zacht uppercase">Ingevuld</h3>
          <ul className="m-0 grid list-none p-0">
            {[...standen].reverse().map((s, i, lijst) => {
              const vorige = lijst[i + 1];
              const erbij = vorige ? s.stand - vorige.stand : null;
              return (
                <li key={s.datum} className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-lijn py-1">
                  <span className="grid min-w-0">
                    <span className="cijfer text-[15px]">
                      {korteDatum(s.datum, { metJaar: true })} · {hoeveel(s.stand, 'm3', { stand: true })}
                    </span>
                    {erbij !== null && <span className="cijfer text-[12.5px] text-tekst-zacht">{hoeveel(erbij, 'm3')} sinds {korteDatum(vorige.datum)}</span>}
                  </span>
                  <button type="button" className="knop size-11 flex-none px-0" aria-label={`Stand van ${korteDatum(s.datum)} weghalen`} disabled={bezig} onClick={() => bewaar({ verwijder: s.datum })}>
                    <Trash2 size={18} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
