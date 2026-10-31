/**
 * Lampen en schakelaars zonder meter (programmaatje 0.8.0, Tuya): alleen of
 * ze aan zijn. De app kijkt alleen; schakelen kan nergens.
 */

const HOOGSTENS = 20;

/**
 * De lampen uit een rij Meting (base44/entities/Meting.jsonc), mild: wat niet
 * klopt valt weg. Een oudere meting heeft ze niet: een lege lijst.
 * @returns {Array<{ sleutel: string, naam: string, soort: 'lamp'|'schakelaar', aan: boolean|null, helderheid: number|null, spots: boolean }>}
 */
export function lampenUit(lijst) {
  if (!Array.isArray(lijst)) return [];
  return lijst
    .filter((l) => l && typeof l === 'object' && typeof l.sleutel === 'string' && l.sleutel)
    .slice(0, HOOGSTENS)
    .map((l) => ({
      sleutel: l.sleutel,
      naam: typeof l.naam === 'string' ? l.naam : '',
      soort: l.soort === 'schakelaar' ? 'schakelaar' : 'lamp',
      aan: typeof l.aan === 'boolean' ? l.aan : null,
      helderheid: Number.isFinite(l.helderheid) && l.helderheid >= 1 && l.helderheid <= 100 ? Math.round(l.helderheid) : null,
      spots: l.rol === 'spots',
    }));
}

/**
 * Branden de spotjes in het overstek (de tekening)? De lampen met rol
 * 'spots' beslissen: één aan is genoeg. Is er geen enkele met die rol, dan
 * branden ze als er een lamp aan is. Geen lampen: null (dan geen spotjes,
 * zoals vroeger).
 */
export function spotsAan(lampen) {
  if (!Array.isArray(lampen) || lampen.length === 0) return null;
  const spots = lampen.filter((l) => l.spots);
  return (spots.length ? spots : lampen).some((l) => l.aan === true);
}

/** "aan", "aan · 64%", "uit", of "weet niet" (geen antwoord). */
export function lampTekst(lamp) {
  if (lamp.aan === null) return 'weet niet';
  if (!lamp.aan) return 'uit';
  return lamp.helderheid ? `aan · ${lamp.helderheid}%` : 'aan';
}
