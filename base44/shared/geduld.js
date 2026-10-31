/**
 * Nog eens proberen als Base44 afremt.
 *
 * De rem ("Rate limit exceeded", ~115 aanroepen per 65 s) geldt ook voor wat
 * een functie met de servicerol doet, en ook voor auth.me. Zo doet Field
 * Operations het (base44/shared/geduld.ts daar, live gemeten): een functie die
 * de app bedient wacht kort (~0,4 en ~1,2 s, elk ±30%) en geeft het daarna op
 * met een 429 en Retry-After. Dan pauzeert de site al haar aanroepen tegelijk
 * (src/api/huis.js), en dat helpt de rem meer dan elk verzoek dat apart blijft
 * proberen.
 *
 * Alleen bij de rem: een andere fout komt bij herhalen precies zo terug.
 */

export const GEDULD_KORT = [400, 1200];
/** Voor een leesvraag die elke paar seconden terugkomt (stand): één korte herhaling, meer helpt de rem niet. */
export const GEDULD_LEZEN = [400];
export const SPREIDING = 0.3;
/** Zo lang laat de server de app wachten als Base44 zelf niets zegt. */
export const REM_WACHT_SECONDEN = 3;

export const isRem = (e) =>
  e?.response?.status === 429 || e?.status === 429 || /rate limit|too many requests/i.test(String(e?.response?.data?.error || e?.message || ''));

/** Een wachttijd met spreiding, zodat wat tegelijk geremd werd niet ook tegelijk terugkomt. */
export const gespreid = (ms, toeval = Math.random) => Math.max(0, Math.round(ms * (1 - SPREIDING + 2 * SPREIDING * toeval())));

const slaap = (ms) => new Promise((klaar) => setTimeout(klaar, ms));

/** Doe `werk`; bij de rem even wachten en opnieuw, hooguit zo vaak als er wachttijden zijn. */
export async function metGeduld(werk, { wachten = GEDULD_KORT, wacht = slaap, toeval = Math.random } = {}) {
  for (let poging = 0; ; poging += 1) {
    try {
      return await werk();
    } catch (e) {
      if (!isRem(e) || poging >= wachten.length) throw e;
      await wacht(gespreid(wachten[poging], toeval));
    }
  }
}

/** Het antwoord bij een rem die niet overging: 429, en hoe lang de app moet wachten. */
export function remAntwoord() {
  return Response.json(
    { error: 'Base44 remt even af. Probeer het zo opnieuw.', code: 'rem', retry_after: REM_WACHT_SECONDEN },
    { status: 429, headers: { 'Retry-After': String(REM_WACHT_SECONDEN) } },
  );
}
