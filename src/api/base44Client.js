import { maakVerbinding } from './verbinding';

/**
 * De verbinding met Base44.
 *
 * Zonder app-id (los bekeken, of `vite build --mode voorbeeld`) is er geen
 * Base44 en draait alles op nepcijfers: VOORBEELD. De Base44-build zet de
 * app-id zelf in VITE_BASE44_APP_ID.
 */
/** De id van de app bij Base44, of null in het voorbeeld. */
export const APP_ID = import.meta.env.VITE_BASE44_APP_ID || null;

export const VOORBEELD = import.meta.env.MODE === 'voorbeeld' || !APP_ID;

// Niet de hele SDK (@base44/sdk, ~135 KB), alleen wat de site gebruikt, en
// zoals de SDK het doet (src/api/verbinding.js, prestaties-12). Ook zonder de
// bezoekstatistiek van de SDK: die telde mee voor de rem van Base44.
export const base44 = VOORBEELD ? null : maakVerbinding({ appId: APP_ID });

/** De HTTP-status van een fout uit de SDK, of null. */
export function statusVan(fout) {
  return fout?.status ?? fout?.response?.status ?? null;
}
