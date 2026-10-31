import { CircleCheck, Clock, FingerprintPattern, KeyRound, LockKeyhole, ShieldCheck, Trash2, TriangleAlert } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { ouderDan } from '@/lib/batterijGegevens';
import { tijd, versieKort } from '@/lib/opmaak';
import { BRUG_MET_OP_AFSTAND, cloudsleutelFout, FOUT_TEKST, kortAfdruk, paarVan, publiekVorm, staatVan, VELDEN, versleutel, vingerafdruk } from '@/lib/opAfstand';
import { zieApparaten } from './Bijwerken';

const VELD = 'zendure.cloudsleutel';

const dag = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'long' });
/** "30 oktober om 16:05". */
export const opTekst = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${dag.format(d)} om ${tijd(d)}`;
};

/** De zin onder "ingesteld op …", met een icoon en of het aandacht vraagt. */
function staatZin(staat) {
  switch (staat.soort) {
    case 'overgenomen':
      return { icoon: CircleCheck, tekst: 'Het programmaatje heeft hem overgenomen.' };
    case 'mislukt':
      return { icoon: TriangleAlert, letOp: true, tekst: FOUT_TEKST[staat.fout] ?? 'Het programmaatje kon hem niet overnemen. Vul hem opnieuw in.' };
    case 'anderPaar':
      // Niet meteen "vul hem opnieuw in": dat nieuwe paar kan ook van iemand anders zijn (ronde 19). Eerst vergelijken, hieronder.
      return { icoon: TriangleAlert, letOp: true, tekst: 'Het programmaatje meldt nu een ander sleutelpaar en kan deze niet openen. Kijk hieronder eerst of dat klopt.' };
    default:
      return { icoon: Clock, tekst: 'Het programmaatje haalt hem binnen een paar minuten op en start dan vanzelf opnieuw.' };
  }
}

/**
 * Instellingen › Op afstand, alleen voor de eigenaar (en de beheerder): de
 * Zendure-cloudsleutel voor het programmaatje thuis invullen zonder erheen te
 * gaan. De browser versleutelt hem met het publieke deel van dat programmaatje
 * (src/lib/opAfstand.js); de server bewaart alleen het versleutelde stuk.
 * Daarna staat hier alleen nog wanneer hij is ingesteld, nooit de sleutel.
 * De functie toetst de rechten ook zelf (zetOpAfstand, wisOpAfstand).
 *
 * Het publieke deel komt via de server; daarom de korte vingerafdruk erbij,
 * om te vergelijken met wat het programmaatje laat zien (node brug.mjs proef).
 * Meldt zich een ander paar dan het vertrouwde (huis.publiek_vast), dan eerst
 * een waarschuwing en een bevestiging; pas daarna kan hij weer klaarzetten
 * (de server weigert het anders ook, ronde 19).
 *
 * @param {{ voorbeeld?: boolean, huis: object|null, brug: object|null, onZet: Function, onWis: Function }} props
 *   brug: stand.brug (bron.js, brugUit); onZet(veld, pakket, nieuwPaar) en onWis(veld) geven een belofte;
 *   nieuwPaar: de bevestigde vingerafdruk van een nieuw paar, of null
 */
export default function OpAfstand({ voorbeeld = false, huis, brug, onZet, onWis }) {
  const veldId = useId();
  const uitlegId = useId();
  const [waarde, setWaarde] = useState('');
  const [bezig, setBezig] = useState(false);
  const [melding, setMelding] = useState(null);
  const [wissen, setWissen] = useState(false);
  // De vingerafdruk van een nieuw paar die de eigenaar bevestigde ("Klopt, dit is mijn programmaatje").
  const [bevestigd, setBevestigd] = useState(null);
  const publiek = publiekVorm(brug?.publiek) ? brug.publiek : null;
  // De vingerafdruk van het publieke deel (asynchroon, Web Crypto), bij welk publiek deel hij hoort.
  const [afdruk, setAfdruk] = useState({ publiek: null, voor: null });
  const voor = publiek && afdruk.publiek === publiek ? afdruk.voor : null;

  useEffect(() => {
    let weg = false;
    if (publiek) vingerafdruk(publiek).then((v) => !weg && setAfdruk({ publiek, voor: v }), () => {});
    return () => {
      weg = true;
    };
  }, [publiek]);

  if (voorbeeld) {
    return (
      <p className="m-0 max-w-[60ch] text-[14.5px] text-tekst-zacht">
        In de echte app vul je hier de Zendure-cloudsleutel voor het programmaatje thuis in, zonder erheen te gaan. Hij gaat
        versleuteld naar het programmaatje; de app laat hem daarna niet meer zien.
      </p>
    );
  }

  const klaar = (huis?.op_afstand ?? []).find((s) => s.veld === VELD);
  const staat = staatVan(klaar, brug, voor);
  const zin = klaar ? staatZin(staat) : null;
  const vast = typeof huis?.publiek_vast === 'string' ? huis.publiek_vast : null;
  const paar = paarVan(voor, vast);
  const eerstBevestigen = paar === 'ander' && bevestigd !== voor;

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

  const zet = (e) => {
    e.preventDefault();
    const fout = cloudsleutelFout(waarde);
    if (fout) {
      setMelding({ fout: true, tekst: fout });
      return;
    }
    doe(async () => {
      const pakket = await versleutel(publiek, VELD, waarde.trim());
      await onZet(VELD, pakket, paar === 'ander' && bevestigd === pakket.voor ? pakket.voor : null);
      // Weg uit het scherm en uit het geheugen van dit onderdeel: hij staat alleen nog versleuteld klaar.
      setWaarde('');
      setMelding({ fout: false, tekst: 'Versleuteld klaargezet voor het programmaatje.' });
    });
  };

  const oud = !publiek;
  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <h3 className="text-[15px] font-semibold">Op afstand instellen</h3>
        <p id={uitlegId} className="m-0 max-w-[60ch] text-[14px] text-tekst-zacht">
          De {VELDEN[VELD]} uit de Zendure-app (Profiel › Autorisatiecloudsleutel › Ophalen) voor het programmaatje van dit
          huis, als reserve als de Zendure lokaal niet antwoordt. Je browser versleutelt hem voor dat programmaatje: de
          server kan hem niet lezen, en hier zie je hem daarna niet meer. Gebruik die sleutel nergens anders (Home Assistant,
          Homey): Zendure laat er maar één verbinding mee toe.
        </p>
      </div>

      {klaar && (
        <div className="grid gap-2 rounded-xl border border-lijn bg-vlak px-3.5 py-2.5">
          <p className="m-0 flex items-center gap-2 text-[14.5px]">
            <LockKeyhole size={18} aria-hidden="true" className="flex-none text-tekst-zacht" />
            <span className="min-w-0">Ingesteld op {opTekst(klaar.op)}</span>
          </p>
          <p className="m-0 flex items-start gap-2 text-[14px]" role="status" style={zin.letOp ? { color: 'var(--let-op)' } : undefined}>
            <zin.icoon size={18} aria-hidden="true" className="mt-0.5 flex-none" />
            <span className="min-w-0">{zin.tekst}</span>
          </p>
          {wissen ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[14px] text-tekst-zacht">Van de server halen? Wat het programmaatje al heeft, blijft daar.</span>
              <button
                type="button"
                className="knop knop-hoofd"
                disabled={bezig}
                onClick={() =>
                  doe(async () => {
                    await onWis(VELD);
                    setWissen(false);
                    setMelding({ fout: false, tekst: 'Gewist van de server.' });
                  })
                }
              >
                <Trash2 size={18} aria-hidden="true" /> Ja, wissen
              </button>
              <button type="button" className="knop" onClick={() => setWissen(false)}>
                Annuleren
              </button>
            </div>
          ) : (
            <button type="button" className="knop justify-self-start" disabled={bezig} onClick={() => setWissen(true)}>
              <Trash2 size={18} aria-hidden="true" /> Wissen
            </button>
          )}
        </div>
      )}

      {!oud && voor && (eerstBevestigen ? (
        <div className="grid gap-2 rounded-xl border border-lijn bg-vlak px-3.5 py-2.5" role="alert">
          <p className="m-0 flex items-start gap-2 text-[14.5px] font-semibold text-let-op">
            <TriangleAlert size={18} aria-hidden="true" className="mt-0.5 flex-none" />
            <span className="min-w-0">Er meldt zich een ander sleutelpaar dan eerst</span>
          </p>
          <p className="m-0 max-w-[60ch] text-[14px]">
            Eerst: <span className="code text-[13px]">{kortAfdruk(vast)}</span>. Nu: <span className="code text-[13px]">{kortAfdruk(voor)}</span>.
            Is het programmaatje opnieuw geïnstalleerd? Kijk op het toestel bij{' '}
            <span className="code text-[13px] [overflow-wrap:anywhere]">node brug.mjs proef</span> welke vingerafdruk daar staat.
          </p>
          <p className="m-0 max-w-[60ch] text-[14px] text-tekst-zacht">
            Staat daar een andere, bevestig dan niet: dan gebruikt iemand anders de sleutel van het programmaatje. Maak bij Delen een
            nieuwe sleutel en zet die in het programmaatje.
          </p>
          <button type="button" className="knop justify-self-start" onClick={() => setBevestigd(voor)}>
            <ShieldCheck size={18} aria-hidden="true" /> Klopt, dit is mijn programmaatje
          </button>
        </div>
      ) : (
        <p className="m-0 flex max-w-[60ch] items-start gap-2 text-[14px] text-tekst-zacht">
          <FingerprintPattern size={18} aria-hidden="true" className="mt-0.5 flex-none" />
          <span className="min-w-0">
            Vingerafdruk van het programmaatje: <span className="code text-[13px] text-tekst">{kortAfdruk(voor)}</span>. Het programmaatje laat
            dezelfde zien bij <span className="code text-[13px] [overflow-wrap:anywhere]">node brug.mjs proef</span>
            {paar === 'eerste' ? '; vergelijk ze één keer, daarna onthoudt de app dit programmaatje.' : '.'}
          </span>
        </p>
      ))}

      {oud ? (
        <p className="m-0 max-w-[60ch] rounded-xl border border-lijn bg-vlak px-3.5 py-2.5 text-[14px]" role="status">
          {brug
            ? `Werk het programmaatje eerst bij naar ${BRUG_MET_OP_AFSTAND} of nieuwer${brug.versie && ouderDan(brug.versie, BRUG_MET_OP_AFSTAND) ? ` (nu ${versieKort(brug.versie)})` : ''}; daarna kan het hier. `
            : 'Er is nog geen meting van het programmaatje binnen. Zodra het draait (versie 0.7.0 of nieuwer), kan het hier. '}
          {zieApparaten(true)}
        </p>
      ) : eerstBevestigen ? null : (
        <form className="grid gap-2" onSubmit={zet}>
          <label htmlFor={veldId} className="text-[14px] font-semibold">
            {klaar ? `Nieuwe ${VELDEN[VELD]}` : VELDEN[VELD]}
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id={veldId}
              type="password"
              className="veld min-w-0 flex-[1_1_200px]"
              placeholder="plakken"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              aria-describedby={uitlegId}
              value={waarde}
              onChange={(e) => setWaarde(e.target.value)}
            />
            <button type="submit" className="knop knop-hoofd" disabled={bezig || !waarde.trim()}>
              <KeyRound size={18} aria-hidden="true" /> Versleuteld klaarzetten
            </button>
          </div>
        </form>
      )}

      {melding && (
        <p
          className={`m-0 rounded-xl border border-lijn bg-vlak px-3.5 py-2.5 text-[14px] ${melding.fout ? 'text-fout' : ''}`}
          role={melding.fout ? 'alert' : 'status'}
        >
          {melding.tekst}
        </p>
      )}
    </div>
  );
}
