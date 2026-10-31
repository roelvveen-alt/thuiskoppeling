import { useState } from 'react';
import { VOORBEELD } from '@/api/base44Client';
import Hoofdscherm from '@/components/Hoofdscherm';
import { NietUitgenodigd, Pagina, Probleem, Wachten, Welkom } from '@/components/Pagina';
import Sleutel from '@/components/Sleutel';
import { useOmgevingen } from '@/lib/omgevingen';

/**
 * Live: eerst wie je bent en welke omgevingen je hebt (de functie huis), dan
 * het scherm van de gekozen omgeving. Zonder app-id (het voorbeeld) meteen
 * het scherm, met alles op dit toestel.
 */
function Live() {
  const omgevingen = useOmgevingen();
  // Een sleutel die je één keer te zien krijgt: na het maken van een omgeving, of een nieuwe.
  const [sleutel, setSleutel] = useState(null);
  const { status, huis, gebruiker, magMaken, laad, melding } = omgevingen;

  if (status === 'laden') return <Wachten tekst="Even kijken wie je bent…" />;
  if (status === 'inloggen') return <Wachten tekst="Op naar het inloggen…" />;
  if (status === 'nietBijgewerkt') {
    return <Probleem titel="Nog niet bijgewerkt" tekst={melding} onOpnieuw={laad} />;
  }
  if (status === 'uitgeschakeld') return <Probleem titel="Geen toegang" tekst={melding} metUitloggen />;
  if (status === 'fout') return <Probleem titel="Even niet bereikbaar" tekst={melding} onOpnieuw={laad} />;

  if (sleutel) {
    return (
      <Pagina>
        <Sleutel
          sleutel={sleutel.sleutel}
          vervangen={sleutel.vervangen}
          onKlaar={() => {
            if (sleutel.huis) omgevingen.neemOp(sleutel.huis);
            setSleutel(null);
          }}
        />
      </Pagina>
    );
  }

  if (!huis) {
    if (!magMaken) return <NietUitgenodigd email={gebruiker?.email} onOpnieuw={laad} />;
    return (
      <Welkom
        email={gebruiker?.email}
        onMaak={async (naam) => {
          const uit = await omgevingen.maak(naam);
          setSleutel({ sleutel: uit.sleutel, huis: uit.huis });
        }}
      />
    );
  }

  // Een andere omgeving is een nieuw scherm: niets van de vorige blijft hangen.
  return <Hoofdscherm key={huis.id} omgevingen={omgevingen} onSleutel={setSleutel} />;
}

export default function App() {
  return VOORBEELD ? <Hoofdscherm /> : <Live />;
}
