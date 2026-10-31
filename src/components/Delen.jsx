import { KeyRound, Trash2, UserPlus } from 'lucide-react';
import { useId, useState } from 'react';

/** Wat er na het uitnodigen nog moet, in gewone woorden. */
export function uitnodigingZin({ email, base44 }, beheerder) {
  if (base44?.ok) return `Uitnodiging verstuurd: ${email} krijgt een mail om in te loggen, en ziet dan dit huis.`;
  if (base44?.status === 409 || /already|exist|bestaat/i.test(base44?.bericht ?? '')) {
    return `${email} heeft al een account voor de app en ziet dit huis na het inloggen.`;
  }
  if (beheerder) {
    return `${email} mag meekijken, maar Base44 stuurde geen uitnodiging${base44?.bericht ? ` (${base44.bericht})` : ''}. Nodig ${email} zelf uit in Base44, bij Users.`;
  }
  return `${email} mag meekijken, maar kan nog niet inloggen: alleen de beheerder van de app kan iemand toegang geven. Vraag de beheerder om ${email} toegang te geven.`;
}

/**
 * Delen, alleen voor de eigenaar: wie er meekijkt, iemand uitnodigen of weghalen,
 * en een nieuwe sleutel voor het programmaatje. De functie toetst dat ook zelf.
 */
export default function Delen({ voorbeeld, huis, beheerder, onUitnodigen, onVerwijder, onNieuweSleutel }) {
  const emailId = useId();
  const [email, setEmail] = useState('');
  const [bezig, setBezig] = useState(false);
  const [melding, setMelding] = useState(null);
  const [zeker, setZeker] = useState(false);
  /** Het adres waarvoor "Weghalen?" open staat. */
  const [weghalen, setWeghalen] = useState(null);

  if (voorbeeld) {
    return (
      <p className="m-0 max-w-[60ch] text-[14.5px] text-tekst-zacht">
        In de echte app nodig je hier mensen uit om mee te kijken (alleen kijken), haal je ze weer weg, en maak je een
        nieuwe sleutel voor het programmaatje thuis.
      </p>
    );
  }

  const leden = huis?.leden ?? [];

  const doe = async (werk) => {
    if (bezig) return;
    setBezig(true);
    setMelding(null);
    try {
      await werk();
    } catch (f) {
      setMelding({ fout: true, tekst: f?.message || 'Dat lukte niet. Probeer het nog eens.' });
    } finally {
      setBezig(false);
    }
  };

  const nodigUit = (e) => {
    e.preventDefault();
    doe(async () => {
      const uit = await onUitnodigen(email.trim());
      setEmail('');
      setMelding({ fout: false, tekst: uitnodigingZin(uit, beheerder) });
    });
  };

  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        <h3 className="text-[15px] font-semibold">Wie kijkt er mee</h3>
        <p className="m-0 max-w-[60ch] text-[14px] text-tekst-zacht">
          Wie je uitnodigt, kan alleen kijken: niet indelen, geen namen geven, niet delen en de sleutel niet zien.
        </p>
        {leden.length === 0 ? (
          <p className="m-0 text-[14.5px]">Nog niemand.</p>
        ) : (
          <ul className="m-0 grid list-none gap-1.5 p-0">
            {leden.map((lid) => (
              <li key={lid.email} className="grid gap-2 rounded-xl border border-lijn bg-vlak py-1.5 pr-1.5 pl-3">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 text-[14.5px] break-all">{lid.email}</span>
                  {weghalen !== lid.email && (
                    <button
                      type="button"
                      className="knop size-11 flex-none px-0"
                      aria-label={`${lid.email} niet meer laten meekijken`}
                      disabled={bezig}
                      onClick={() => setWeghalen(lid.email)}
                    >
                      <Trash2 size={18} aria-hidden="true" />
                    </button>
                  )}
                </div>
                {/* Eerst vragen, net als bij de sleutel: terugzetten kan alleen door opnieuw uit te nodigen. */}
                {weghalen === lid.email && (
                  <div className="flex flex-wrap items-center gap-2 pb-1">
                    <span className="text-[14px] text-tekst-zacht">Niet meer laten meekijken?</span>
                    <button
                      type="button"
                      className="knop knop-hoofd"
                      disabled={bezig}
                      onClick={() =>
                        doe(async () => {
                          await onVerwijder(lid.email);
                          setWeghalen(null);
                          setMelding({ fout: false, tekst: `${lid.email} kijkt niet meer mee.` });
                        })
                      }
                    >
                      <Trash2 size={18} aria-hidden="true" /> Ja, weghalen
                    </button>
                    <button type="button" className="knop" onClick={() => setWeghalen(null)}>
                      Annuleren
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <form className="grid gap-2" onSubmit={nodigUit}>
        <label htmlFor={emailId} className="text-[14px] font-semibold">
          Iemand uitnodigen
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id={emailId}
            type="email"
            className="veld flex-[1_1_200px]"
            placeholder="naam@voorbeeld.nl"
            autoComplete="off"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button type="submit" className="knop knop-hoofd" disabled={bezig || !email.trim()}>
            <UserPlus size={18} aria-hidden="true" /> Uitnodigen
          </button>
        </div>
      </form>

      {melding && (
        <p
          className={`m-0 rounded-xl border border-lijn bg-vlak px-3.5 py-2.5 text-[14px] ${melding.fout ? 'text-fout' : ''}`}
          role={melding.fout ? 'alert' : 'status'}
        >
          {melding.tekst}
        </p>
      )}

      <div className="grid gap-2 border-t border-lijn pt-4">
        <h3 className="text-[15px] font-semibold">Sleutel voor het programmaatje</h3>
        <p className="m-0 max-w-[60ch] text-[14px] text-tekst-zacht">
          Kwijt, of in verkeerde handen? Maak een nieuwe. De oude werkt dan meteen niet meer; zet de nieuwe thuis erin met
          de instelhulp (node brug.mjs instellen, en plakken) en start het programmaatje opnieuw.
        </p>
        {zeker ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="knop knop-hoofd" disabled={bezig} onClick={() => doe(onNieuweSleutel)}>
              <KeyRound size={18} aria-hidden="true" /> Ja, nieuwe sleutel
            </button>
            <button type="button" className="knop" onClick={() => setZeker(false)}>
              Annuleren
            </button>
          </div>
        ) : (
          <button type="button" className="knop justify-self-start" onClick={() => setZeker(true)}>
            <KeyRound size={18} aria-hidden="true" /> Nieuwe sleutel maken
          </button>
        )}
      </div>
    </div>
  );
}
