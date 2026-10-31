import { useMemo } from 'react';
import { vraagPeriode } from '@/api/huis';
import { HUIS_DAGEN } from './advies';
import { LEER_DAGEN } from './morgen';
import { useHerhaald } from './herhaald';
import { dagenUit, dagNummer, datumVanNummer } from './periode';
import { datumVan } from './prijsoverzicht';
import { voorbeeldDagen } from './voorbeeld';

/**
 * Zo vaak vraagt Advies de dagen opnieuw: de dagen tot en met gisteren
 * veranderen niet meer (vandaag komt uit de stand), dus eens per half uur is
 * ruim. Zie de rem (base44/tests/rem.test.js).
 */
export const ADVIES_DAGEN_ELKE_MS = 30 * 60_000;

/** Zoveel dagen vraagt de site op: genoeg voor Advies (HUIS_DAGEN) en voor de zon van Voorspelling (LEER_DAGEN). */
export const BEREIK_DAGEN = Math.max(HUIS_DAGEN, LEER_DAGEN);

/**
 * Van en tot voor Advies en Voorspelling: de laatste BEREIK_DAGEN dagen, tot
 * en met gisteren, in één vraag (dezelfde vraag voor beide tabbladen).
 */
export function adviesBereik(nu) {
  const vandaag = datumVan(nu);
  const n = dagNummer(vandaag);
  return { van: datumVanNummer(n - BEREIK_DAGEN), tot: datumVanNummer(n - 1), vandaag };
}

/**
 * De dagen waar Advies en Voorspelling van leren, via het loket ('periode',
 * dezelfde rechten als de stand): alleen met het tabblad Huis of Voorspelling
 * open (`actief`) en het scherm zichtbaar, hooguit eens per
 * ADVIES_DAGEN_ELKE_MS; beide tabbladen delen die ene vraag (dezelfde sleutel
 * in useHerhaald). In het voorbeeld nepdagen. Lukt het niet (een oudere
 * functie, of even niet): geen dagen, en het advies zegt dat het nog leert.
 *
 * @returns {{ dagen: ReturnType<typeof dagenUit>, leerDagen: ReturnType<typeof dagenUit>, status: string }}
 *   dagen: de laatste HUIS_DAGEN (Advies, zoals altijd); leerDagen: alle BEREIK_DAGEN (Voorspelling)
 */
export function useAdviesDagen({ huisId, actief, metVoorbeeld, nu }) {
  const { van, tot, vandaag } = adviesBereik(nu);
  const sleutel = huisId && !metVoorbeeld ? `advies|${huisId}|${van}|${tot}` : null;
  const uit = useHerhaald({ werk: () => vraagPeriode(huisId, van, tot), sleutel, actief: actief && !metVoorbeeld, elkeMs: ADVIES_DAGEN_ELKE_MS });
  const voorbeeld = useMemo(() => (metVoorbeeld ? dagenUit(voorbeeldDagen(van, tot, vandaag)) : null), [metVoorbeeld, van, tot, vandaag]);
  const leerDagen = useMemo(() => dagenUit(uit.data?.dagen), [uit.data]);
  const vanAdvies = datumVanNummer(dagNummer(vandaag) - HUIS_DAGEN);
  const dagen = useMemo(() => leerDagen.filter((d) => d.datum >= vanAdvies), [leerDagen, vanAdvies]);
  const voorbeeldAdvies = useMemo(() => voorbeeld?.filter((d) => d.datum >= vanAdvies) ?? null, [voorbeeld, vanAdvies]);
  if (voorbeeld) return { dagen: voorbeeldAdvies, leerDagen: voorbeeld, status: 'voorbeeld' };
  return { dagen, leerDagen, status: uit.status };
}
