/**
 * Wat ontvangMeting doet, los van entry.ts zodat de tests het zonder Base44
 * kunnen nalopen (base44/tests/ontvang.test.js).
 *
 * Er is geen ingelogde gebruiker: het programmaatje thuis bewijst met zijn
 * sleutel bij welk huis het hoort. Base44 kent alleen de SHA-256 van die
 * sleutel (Huis.brug_sleutel_hash, zie toegang.js). Eerst de sleutel, dan pas
 * de rest: zonder bekende sleutel lezen we de meting niet eens.
 *
 * Per huis één rij Meting die steeds wordt overschreven. Dit is de enige
 * schrijver van die rijen, en het programmaatje stuurt één meting tegelijk.
 * Daarna de dag in de tabel Dag (dagboek.js): hooguit één keer per kwartier,
 * voor Week, Maand, Kwartaal en Jaar in de app. En het logboek van storingen
 * (logboek.js, tabel Gebeurtenis): alleen een schrijfactie als een storing
 * begint of voorbij is; wat openstaat gaat mee in de rij Meting
 * (storingen_open), die toch al geschreven wordt.
 */
import { isRem, remAntwoord } from '../../shared/geduld.js';
import { labelsVoorBrug } from '../../shared/herkennen.js';
import { voorBrug } from '../../shared/opAfstand.js';
import { voorBrug as omvormerVoorBrug } from '../../shared/omvormerSturen.js';
import { nietGevonden, tabellen } from '../../shared/tabellen.js';
import { huisBijSleutel } from '../../shared/toegang.js';
import { controleerMeting } from './controle.js';
import { boekDag } from './dagboek.js';
import { boekGebeurtenissen, openUit } from './logboek.js';

/** Ruim genoeg voor 40 apparaten; groter is geen meting. */
const HOOGSTENS_TEKENS = 20_000;

/**
 * Zo kort na de vorige meting van hetzelfde huis weigeren we (429, zonder iets
 * te lezen of te schrijven; ronde 19, B3). Het programmaatje stuurt hooguit
 * elke 3 s (instellingen.mjs: elke_seconden 3 tot 300), meestal elke 5 s. Een
 * programmaatje dat in een lus vastloopt, twee toestellen met dezelfde
 * instellingen of een gekopieerde sleutel kunnen zo per huis hooguit één
 * meting per 2 s laten schrijven, en houden de andere huizen niet tegen. Bij
 * een 429 wacht het programmaatje al langer (brug.mjs, elke versie).
 */
export const MIN_TUSSEN_MS = 2000;

const teSnel = () =>
  Response.json(
    { error: 'Te snel na de vorige meting van dit huis.', code: 'teSnel', retry_after: Math.ceil(MIN_TUSSEN_MS / 1000) },
    { status: 429, headers: { 'Retry-After': String(Math.ceil(MIN_TUSSEN_MS / 1000)) } },
  );

/**
 * Per huis (`staat:<huis>`) de rij Meting die we bijwerken, het moment van de
 * vorige meting en wat er in het logboek openstaat; en (toegang.js,
 * huisBijSleutel) even welk huis bij een sleutel hoort. Zo kost een meting
 * meestal één aanroep (bijwerken) in plaats van drie. Het huis bij de sleutel
 * geldt hooguit LEZEN_ONTHOUDEN_MS; daarna beslist de sleutel weer vers.
 */
const RIJ_VAN_HUIS = new Map();

const antwoord = (data, status = 200) => Response.json(data, { status });

/** De oudste rij Meting van dit huis; de site leest de laatst bijgewerkte, en dat is deze. */
async function rijVan(db, huisId) {
  const [rij] = await db.Meting.filter({ huis_id: huisId }, 'id', 1);
  return rij ?? null;
}

/**
 * Wat we van de vorige meting weten: uit het geheugen, of (na een herstart) uit
 * de rij zelf. Die moesten we dan toch zoeken om hem bij te werken: zo kost het
 * niets extra.
 */
async function vorigeStaat(db, huisId, geheugen) {
  const bekend = geheugen.get(`staat:${huisId}`);
  if (bekend) return bekend;
  const rij = await rijVan(db, huisId);
  return { rijId: rij?.id ?? null, moment: typeof rij?.moment === 'string' ? rij.moment : null, open: openUit(rij?.storingen_open), pauzeTot: 0 };
}

async function bewaar(db, huisId, velden, staat) {
  if (staat.rijId) {
    try {
      await db.Meting.update(staat.rijId, velden);
      return staat.rijId;
    } catch (e) {
      if (!nietGevonden(e)) throw e;
    }
  }
  const rij = await rijVan(db, huisId);
  const klaar = rij ? await db.Meting.update(rij.id, velden) : await db.Meting.create(velden);
  return rij?.id ?? klaar?.id ?? null;
}

/**
 * @param {Request} req
 * @param {(req: Request) => any} maakClient  createClientFromRequest, of een nep in de tests
 * @param {{ nu?: () => Date, geheugen?: Map, dagGeheugen?: Map, geduld?: object }} [opties]
 *   dagGeheugen: per huis de lopende dag (dagboek.js); de tests geven een eigen
 */
export async function behandelMeting(req, maakClient, { nu = () => new Date(), geheugen = RIJ_VAN_HUIS, dagGeheugen, geduld } = {}) {
  if (req.method !== 'POST') return antwoord({ error: 'Alleen POST' }, 405);
  try {
    const db = tabellen(maakClient(req).asServiceRole.entities, geduld);
    const huis = await huisBijSleutel(db, req.headers.get('x-brug-sleutel'), { geheugen, nu: nu().getTime() });
    if (!huis) return antwoord({ error: 'Unauthorized' }, 401);
    // De ondergrens per huis, meteen na de sleutel en zonder await ertussen: twee verzoeken tegelijk kunnen er niet allebei door.
    const ontvangen = nu().getTime();
    const laatst = geheugen.get(`laatst:${huis.id}`);
    if (typeof laatst === 'number' && ontvangen >= laatst && ontvangen - laatst < MIN_TUSSEN_MS) return teSnel();
    geheugen.set(`laatst:${huis.id}`, ontvangen);

    const tekst = await req.text();
    if (tekst.length > HOOGSTENS_TEKENS) return antwoord({ error: 'Meting is te groot' }, 413);
    let ruw;
    try {
      ruw = JSON.parse(tekst);
    } catch {
      return antwoord({ error: 'Geen geldige JSON' }, 400);
    }
    const moment = nu();
    const uitslag = controleerMeting(ruw, moment);
    if (!uitslag.ok) return antwoord({ error: uitslag.fout }, 400);

    const vorige = await vorigeStaat(db, huis.id, geheugen);
    // Het logboek eerst (gooit nooit), zodat wat er openstaat met deze meting mee de rij in gaat.
    const logboek = await boekGebeurtenissen(db, huis.id, vorige, uitslag.meting, moment);
    // Meteen onthouden: mislukt het bewaren hieronder, dan begint dezelfde storing (of hetzelfde gat) niet nog eens.
    const verder = { moment: uitslag.meting.moment, open: logboek.open, pauzeTot: logboek.pauzeTot };
    geheugen.set(`staat:${huis.id}`, { ...vorige, ...verder });
    const rijId = await bewaar(db, huis.id, { ...uitslag.meting, huis_id: huis.id, storingen_open: logboek.open }, vorige);
    geheugen.set(`staat:${huis.id}`, { ...verder, rijId });
    try {
      // De meting staat er; een probleem met de dag houdt hem niet tegen.
      await boekDag(db, huis.id, uitslag.meting, moment, dagGeheugen);
    } catch (fout) {
      console.error('ontvangMeting: dag bijhouden mislukt', fout?.message ?? fout);
    }
    // Een overgeslagen blok zegt het programmaatje terug (één regel in zijn logboek).
    // Staat er iets op afstand klaar voor dit programmaatje (opAfstand.js), dan dat ook: het
    // zat al in de Huis-rij bij de sleutel, dus zonder aanroep extra. Een oudere brug negeert het.
    const klaar = await voorBrug(huis, uitslag.meting.brug ?? null);
    // Nieuwere labels uit de app ("Klopt", "Dat was …") voor het herkennen (0.11.0): ook al in de Huis-rij, net zo zonder aanroep extra.
    const labels = labelsVoorBrug(huis, uitslag.meting.brug ?? null);
    // De omvormer begrenzen (1.5.0): alleen als de eigenaar het aanzette; ook uit de Huis-rij, zonder aanroep extra.
    // Elke meting, kort; zonder dit veld (of een oudere functie) staat het voor het programmaatje uit.
    const sturen = omvormerVoorBrug(huis);
    return antwoord({
      ok: true,
      ...(uitslag.overgeslagen?.length ? { overgeslagen: uitslag.overgeslagen } : {}),
      ...(klaar.length ? { op_afstand: klaar } : {}),
      ...(labels.length ? { herkend_labels: labels } : {}),
      ...(sturen ? { omvormer_sturen: sturen } : {}),
    });
  } catch (fout) {
    // Het programmaatje wacht dan langer en probeert het opnieuw.
    if (isRem(fout)) return remAntwoord();
    console.error('ontvangMeting: opslaan mislukt', fout?.message ?? fout);
    return antwoord({ error: 'Opslaan mislukt' }, 500);
  }
}
