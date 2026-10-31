import { useCallback, useEffect, useState } from 'react';
import { VOORBEELD } from '@/api/base44Client';
import { naarInloggen, nodigUitBijBase44, vraag } from '@/api/huis';
import { leesLokaal, schrijfLokaal } from './lokaal';
import { vraagVroegeStand } from './vroegeStand';

/**
 * Wie je bent en in welke omgevingen (huizen) je mag. De beheerder van de app
 * ziet ze allemaal en kiest; welke hij het laatst koos, onthoudt dit toestel.
 * Een gewone gebruiker hoort bij precies één omgeving.
 *
 * Wat je mag, beslist de functie huis (base44/shared/toegang.js). De site
 * laat alleen zien wat erbij past: een kijker krijgt de knoppen voor indelen
 * en delen niet, maar zou hij ze toch indrukken, dan weigert de functie.
 *
 * status: laden, klaar, inloggen (op weg naar de inlogpagina), uitgeschakeld,
 * nietBijgewerkt (de functie is nog niet gepubliceerd) of fout.
 */

const LOKAAL_OMGEVING = 'thuis-energie.omgeving.v1';

export function useOmgevingen() {
  const [staat, setStaat] = useState({ status: 'laden', gebruiker: null, huizen: [], magMaken: false, melding: null });
  const [gekozenId, setGekozenId] = useState(() => (VOORBEELD ? null : leesLokaal(LOKAAL_OMGEVING)));

  const laad = useCallback(async () => {
    if (VOORBEELD) return;
    // Eén keer per pagina, en vóór 'mijn' in de rij van het loket: de stand van het huis van de vorige keer (prestaties-18).
    vraagVroegeStand();
    try {
      const uit = await vraag('mijn');
      setStaat({
        status: 'klaar',
        gebruiker: uit?.gebruiker ?? null,
        huizen: Array.isArray(uit?.huizen) ? uit.huizen : [],
        magMaken: Boolean(uit?.magMaken),
        melding: null,
      });
    } catch (fout) {
      if (fout.soort === 'inloggen') {
        naarInloggen();
        setStaat((oud) => ({ ...oud, status: 'inloggen' }));
        return;
      }
      const status = ['nietBijgewerkt', 'uitgeschakeld'].includes(fout.soort) ? fout.soort : 'fout';
      setStaat((oud) => ({ ...oud, status, melding: fout.message }));
    }
  }, []);

  useEffect(() => {
    laad();
  }, [laad]);

  // Even tijdens een uitrol: na een halve minuut vanzelf opnieuw (de knop Opnieuw blijft).
  // Op `staat` zelf: lukt het weer niet, dan is dat een nieuwe staat en dus een nieuwe poging.
  useEffect(() => {
    if (staat.status !== 'nietBijgewerkt') return undefined;
    const id = setTimeout(laad, 30_000);
    return () => clearTimeout(id);
  }, [staat, laad]);

  const kies = useCallback((id) => {
    setGekozenId(id);
    schrijfLokaal(LOKAAL_OMGEVING, id);
  }, []);

  const zetLeden = useCallback((huisId, leden) => {
    setStaat((oud) => ({ ...oud, huizen: oud.huizen.map((h) => (h.id === huisId ? { ...h, leden } : h)) }));
  }, []);

  /**
   * Een omgeving maken (alleen de beheerder). Geeft { huis, sleutel }; de sleutel zie je maar
   * één keer. Pas als je hem bewaard hebt, gaat de app naar die omgeving
   * (neemOp), zodat het scherm met de sleutel niet eerst wegflitst.
   */
  const maak = useCallback((naam) => vraag('maak', { naam }), []);

  const neemOp = useCallback(
    (huis) => {
      setStaat((oud) => ({
        ...oud,
        magMaken: true,
        huizen: oud.huizen.some((h) => h.id === huis.id) ? oud.huizen : [huis, ...oud.huizen],
      }));
      kies(huis.id);
    },
    [kies],
  );

  const hernoem = useCallback(
    async (huisId, naam) => {
      await vraag('hernoem', { huis_id: huisId, naam });
      await laad();
    },
    [laad],
  );

  /**
   * Eerst in de omgeving zetten (de functie), dan bij Base44 uitnodigen voor
   * de app zelf. Dat laatste mag niet iedereen; de uitkomst zegt wat er nog moet.
   */
  const uitnodigen = useCallback(
    async (huisId, email) => {
      const uit = await vraag('uitnodigen', { huis_id: huisId, email });
      zetLeden(huisId, uit.leden);
      const toegevoegd = uit.leden.at(-1)?.email ?? email;
      return { email: toegevoegd, base44: await nodigUitBijBase44(toegevoegd) };
    },
    [zetLeden],
  );

  const verwijderLid = useCallback(
    async (huisId, email) => {
      const uit = await vraag('verwijderLid', { huis_id: huisId, email });
      zetLeden(huisId, uit.leden);
    },
    [zetLeden],
  );

  const nieuweSleutel = useCallback(async (huisId) => (await vraag('nieuweSleutel', { huis_id: huisId })).sleutel, []);

  /**
   * Wat er op afstand klaarstaat (alleen welk veld en wanneer), na zetten of wissen; en het vastgezette
   * sleutelpaar als de functie dat meestuurt (een oudere niet: dan blijft het zoals het was).
   */
  const zetKlaar = useCallback((huisId, lijst, vast) => {
    setStaat((oud) => ({
      ...oud,
      huizen: oud.huizen.map((h) =>
        h.id === huisId ? { ...h, op_afstand: Array.isArray(lijst) ? lijst : [], ...(typeof vast === 'string' ? { publiek_vast: vast } : {}) } : h,
      ),
    }));
  }, []);

  /**
   * Een al in de browser versleuteld stuk klaarzetten voor het programmaatje (src/lib/opAfstand.js).
   * nieuwPaar: de vingerafdruk van een nieuw sleutelpaar dat de eigenaar net bevestigde (ronde 19).
   */
  const zetOpAfstand = useCallback(
    async (huisId, veld, pakket, nieuwPaar = null) => {
      const uit = await vraag('zetOpAfstand', { huis_id: huisId, veld, pakket, ...(nieuwPaar ? { nieuw_paar: nieuwPaar } : {}) });
      zetKlaar(huisId, uit.op_afstand, uit.publiek_vast);
    },
    [zetKlaar],
  );

  const wisOpAfstand = useCallback(
    async (huisId, veld) => zetKlaar(huisId, (await vraag('wisOpAfstand', { huis_id: huisId, veld })).op_afstand),
    [zetKlaar],
  );

  /**
   * De omvormer begrenzen als terugleveren geld kost (programmaatje 1.5.0): aan of uit, een dag niet,
   * "Nu weer aan", of over het jaar afnemer of terugleveraar. De functie geeft de nieuwe instelling terug.
   */
  const omvormerSturen = useCallback(async (huisId, wijziging) => {
    const uit = await vraag('omvormerSturen', { huis_id: huisId, ...wijziging });
    setStaat((oud) => ({ ...oud, huizen: oud.huizen.map((h) => (h.id === huisId ? { ...h, omvormer_sturen: uit.omvormer_sturen } : h)) }));
  }, []);

  // Wisselen en omgevingen maken doet alleen de beheerder (toegang.js); een
  // gewone gebruiker heeft er één. Ook als een oudere functie er meer of
  // "magMaken" stuurt, laat de site hem alleen die ene zien.
  const beheerder = Boolean(staat.gebruiker?.beheerder);
  const huizen = beheerder ? staat.huizen : staat.huizen.slice(0, 1);
  const huis = huizen.find((h) => h.id === gekozenId) ?? huizen[0] ?? null;

  return {
    ...staat,
    huizen,
    huis,
    magMaken: staat.magMaken && beheerder,
    magWisselen: beheerder && huizen.length > 1,
    kies,
    laad,
    maak,
    neemOp,
    hernoem,
    uitnodigen,
    verwijderLid,
    nieuweSleutel,
    zetOpAfstand,
    wisOpAfstand,
    omvormerSturen,
  };
}
