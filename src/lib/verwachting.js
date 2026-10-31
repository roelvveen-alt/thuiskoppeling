import { useMemo } from 'react';
import { leesLokaal } from './lokaal';
import { bronnenUit, maakMorgen } from './morgen';
import { voorbeeldMorgen } from './voorbeeldMorgen';

const UUR_MS = 3_600_000;
/** Per huis de voorspelde kWh van morgen, op dit toestel (src/lib/morgen.js metBewaard): voor "hoe kwam gisteren uit" en de band. */
export const LOKAAL_MORGEN = 'thuis-energie.morgen.v1';

/**
 * Eén verwachting voor de zon en de batterij, voor het hele scherm (R19-RK-01,
 * weergave-1 en -2): het tabblad Voorspelling, Advies op Huis en "verwacht vol"
 * op het batterijblad rekenen alle drie met deze ene uitkomst van maakMorgen
 * (src/lib/morgen.js): dezelfde zon per uur, hetzelfde weerbericht, dezelfde
 * leerdagen. In het voorbeeld het nepweerbericht en de nepdagen van
 * voorbeeldMorgen, ook voor Advies.
 *
 * @param {{ stand: object|null, dagen: Array, punten: Array, nu: number, metVoorbeeld: boolean, bewaard?: Record<string, number>|null }} o
 * @returns {null | { morgen: ReturnType<typeof maakMorgen>, weer: object|null, dagen: Array }}
 */
export function verwachtingVoor({ stand, dagen, punten, nu, metVoorbeeld, bewaard = null, voorbeeld = null }) {
  if (!stand) return null;
  const nep = metVoorbeeld ? (voorbeeld ?? voorbeeldMorgen(nu, bronnenUit(punten))) : null;
  const weer = nep ? nep.weer : (stand.weer ?? null);
  const leerDagen = nep ? nep.dagen : dagen;
  return { morgen: maakMorgen({ stand: { ...stand, weer }, dagen: leerDagen, punten, nu, bewaard: nep ? null : bewaard }), weer, dagen: leerDagen };
}

/**
 * De verwachting in een scherm: opnieuw rekenen hooguit eens per minuut (de
 * stand komt elke 5 tot 30 s), of bij ander weer, andere dagen, andere prijzen
 * of een ander vermogen. Geen vraag aan Base44: alles komt uit de stand en de
 * dagen die useAdviesDagen (src/lib/adviesBron.js) toch al ophaalt.
 */
export function useVerwachting({ stand, dagen, punten, nu, huisId, metVoorbeeld }) {
  const minuut = Math.floor(nu / 60_000);
  const uurNu = Math.floor(nu / UUR_MS);
  const bronnenSleutel = JSON.stringify(bronnenUit(punten));
  const voorbeeld = useMemo(() => (metVoorbeeld ? voorbeeldMorgen(nu, bronnenUit(punten)) : null), [metVoorbeeld, uurNu, bronnenSleutel]); // eslint-disable-line react-hooks/exhaustive-deps
  const metStand = Boolean(stand);
  const weer = stand?.weer;
  const prijzen = stand?.voorspelling;
  const procent = stand?.batterij_procent;
  return useMemo(() => {
    if (!stand) return null;
    const bewaard = !metVoorbeeld && huisId ? (leesLokaal(LOKAAL_MORGEN)?.[huisId] ?? null) : null;
    return verwachtingVoor({ stand, dagen, punten, nu, metVoorbeeld, bewaard, voorbeeld });
  }, [minuut, metStand, weer, dagen, prijzen, procent, bronnenSleutel, huisId, metVoorbeeld, voorbeeld]); // eslint-disable-line react-hooks/exhaustive-deps
}
