import { base44, statusVan } from './base44Client';
import { wisFotoKast } from '@/lib/fotoKast';
import { schrijfLokaal } from '@/lib/lokaal';

/**
 * Het loket: alles wat de site aan Base44 vraagt, gaat hierdoor, één vraag
 * tegelijk. Dat werkte in een andere Base44-app ook goed.
 *
 * - Eén tegelijk. Dan komen bewaren en lezen altijd na elkaar bij Base44 aan
 *   (Base44 verliest er een als er twee tegelijk op één rij komen), en blijft
 *   één open scherm ver onder de rem.
 * - Bij de rem (429) pauzeert het hele loket, niet alleen die ene vraag: zo
 *   lang als de server zegt (Retry-After, hooguit 30 s), anders 3, 6 en 12 s.
 *   Daarna geeft de vraag het op en zegt de site dat Base44 even afremt.
 *   Een vraag met `herhalen: false` (de stand, die elke 5 s toch terugkomt)
 *   geeft het meteen op: de pauze geldt dan wel voor de vragen erna.
 * - Niets blijft hangen: zonder antwoord geeft een vraag het na 20 s op, en
 *   het loket gaat door met de volgende.
 * - Een uitrol zet eerst de functies en dan de site live; een Publish is niet
 *   nodig (gemeten 2026-10-30). Is de functie er toch nog niet (404 zonder
 *   onze code) of kent hij een vraag nog niet, dan zegt de site dat de app
 *   net wordt bijgewerkt.
 */

export const WACHT_MS = [3000, 6000, 12000];
const HOOGSTENS_WACHT_MS = 30_000;
const GEEF_OP_MS = 20_000;

const BERICHT = {
  inloggen: 'Log eerst in.',
  nietBijgewerkt: 'De app wordt net bijgewerkt. Probeer het over een minuut opnieuw.',
  rem: 'Het is even druk. Het lukt zo weer.',
  net: 'De app is even niet bereikbaar. Ik probeer het zo opnieuw.',
  fout: 'Er ging iets mis. Probeer het zo nog eens.',
  // De server zegt "omgeving"; in de app heet het overal "huis" (weergave-16).
  geenHuis: 'Dit huis bestaat niet (meer), of je mag er niet in.',
};

/** Een fout van het loket: een vaste soort voor de site, en een zin voor mensen. */
export class LoketFout extends Error {
  constructor(soort, bericht = BERICHT[soort] ?? BERICHT.fout, status = null) {
    super(bericht);
    this.soort = soort;
    this.status = status;
  }
}

/**
 * Wat er mis is. De soort is de `code` van onze functie (base44/shared/huizen.js),
 * of een van: inloggen, nietBijgewerkt, rem, net, fout.
 */
export function naarLoketFout(e) {
  if (e instanceof LoketFout) return e;
  const status = statusVan(e);
  const data = e?.response?.data ?? e?.data ?? null;
  const code = typeof data?.code === 'string' ? data.code : null;
  if (status === 401) return new LoketFout('inloggen', BERICHT.inloggen, status);
  if ((status === 404 && !code) || code === 'onbekendeActie') return new LoketFout('nietBijgewerkt', BERICHT.nietBijgewerkt, status);
  if (status === 429) return new LoketFout('rem', BERICHT.rem, status);
  if (!status) return new LoketFout('net', BERICHT.net, null);
  if (code === 'geenHuis') return new LoketFout(code, BERICHT.geenHuis, status);
  return new LoketFout(code ?? 'fout', typeof data?.error === 'string' ? data.error : BERICHT.fout, status);
}

/** Hoe lang het hele loket stil moet liggen na de rem. */
function pauzeNa(e, poging) {
  const seconden = Number(e?.response?.headers?.['retry-after'] ?? e?.response?.data?.retry_after ?? e?.data?.retry_after);
  const ms = Number.isFinite(seconden) && seconden > 0 ? seconden * 1000 : WACHT_MS[poging];
  return Math.min(ms, HOOGSTENS_WACHT_MS);
}

const slaapEcht = (ms) => new Promise((klaar) => setTimeout(klaar, ms));

function binnen(belofte, ms) {
  let timer;
  const opgegeven = new Promise((_, mis) => {
    timer = setTimeout(() => mis(new LoketFout('net')), ms);
  });
  return Promise.race([belofte, opgegeven]).finally(() => clearTimeout(timer));
}

/** Een loket. De site heeft er één (hieronder); de tests maken hun eigen. */
export function maakLoket({ slaap = slaapEcht } = {}) {
  let pauzeTot = 0;
  let rij = Promise.resolve();
  return function aanHetLoket(werk, { tijd = GEEF_OP_MS, herhalen = true } = {}) {
    const beurt = rij.then(async () => {
      for (let poging = 0; ; poging += 1) {
        const wacht = pauzeTot - Date.now();
        if (wacht > 0) await slaap(wacht);
        try {
          return await binnen(Promise.resolve().then(werk), tijd);
        } catch (e) {
          const fout = naarLoketFout(e);
          if (fout.soort !== 'rem') throw fout;
          pauzeTot = Date.now() + pauzeNa(e, poging);
          if (!herhalen || poging >= WACHT_MS.length) throw fout;
        }
      }
    });
    rij = beurt.catch(() => {});
    return beurt;
  };
}

const aanHetLoket = maakLoket();

/**
 * Een actie van de functie huis (zie base44/shared/huizen.js).
 * @param {{ herhalen?: boolean }} [opties]  herhalen: false voor een vraag die toch zo terugkomt (stand)
 */
export function vraag(actie, invoer = {}, { herhalen = true } = {}) {
  return aanHetLoket(
    async () => {
      const res = await base44.functions.invoke('huis', { actie, ...invoer });
      return res?.data ?? res;
    },
    { herhalen },
  );
}

/** Zo vaak hooguit dezelfde periode (actie periode): de dagen veranderen hooguit eens per kwartier. */
export const PERIODE_ELKE_MS = 3 * 60_000;
/** Een mislukte periode mag eerder opnieuw. */
const PERIODE_FOUT_MS = 30_000;

/**
 * De dagen van een periode (Week, Maand, Kwartaal, Jaar op het tabblad
 * Overzicht), hooguit eens per PERIODE_ELKE_MS per huis en bereik. Wie binnen
 * die tijd nog eens vraagt (terug naar het tabblad, een andere keuze en weer
 * terug), krijgt hetzelfde antwoord, of de vraag die al loopt. Niet elke 5 s
 * zoals de stand: wie vraagt, is het tabblad Overzicht met die keuze
 * (src/lib/periodeBron.js). Een fout blijft korter staan.
 */
export function maakPeriodeLoket({ vraagFn = vraag, klok = Date.now } = {}) {
  const geheugen = new Map();
  return function vraagPeriode(huisId, van, tot) {
    const nu = klok();
    for (const [sleutel, plek] of geheugen) if (nu >= plek.tot) geheugen.delete(sleutel);
    const sleutel = `${huisId}|${van}|${tot}`;
    const bekend = geheugen.get(sleutel);
    if (bekend) return bekend.belofte;
    const belofte = Promise.resolve().then(() => vraagFn('periode', { huis_id: huisId, van, tot }));
    const plek = { belofte, tot: nu + PERIODE_ELKE_MS };
    geheugen.set(sleutel, plek);
    belofte.catch(() => {
      plek.tot = Math.min(plek.tot, klok() + PERIODE_FOUT_MS);
    });
    return belofte;
  };
}

export const vraagPeriode = maakPeriodeLoket();

/** Een foto privé bij Base44 zetten; geeft de file_uri. */
export function upload(bestand) {
  return aanHetLoket(async () => (await base44.integrations.Core.UploadPrivateFile({ file: bestand })).file_uri, { tijd: 60_000 });
}

/**
 * Iemand bij Base44 uitnodigen voor de app. Mag niet elke gebruiker (meestal
 * alleen de beheerder); dat is geen fout, dan zegt de site wie het moet doen.
 * @returns {Promise<{ ok: boolean, status?: number|null, bericht?: string }>}
 */
export function nodigUitBijBase44(email) {
  return aanHetLoket(async () => {
    try {
      await base44.users.inviteUser(email, 'user');
      return { ok: true };
    } catch (e) {
      if (statusVan(e) === 429) throw e;
      return { ok: false, status: statusVan(e), bericht: String(e?.message ?? '') };
    }
  });
}

/** Naar de inlogpagina van Base44, en daarna terug hierheen. */
export function naarInloggen() {
  base44.auth.redirectToLogin(window.location.href);
}

/** Welk huis dit toestel het laatst opende: daarvan vraagt het bij het openen meteen de stand (src/lib/vroegeStand.js). */
export const LOKAAL_LAATSTE_HUIS = 'thuis-energie.laatste-huis.v1';

/**
 * Uitloggen: eerst de foto van het huis van dit toestel af (die staat in de
 * kast van de browser), en vergeten welk huis het laatst open was.
 */
export async function uitloggen() {
  await wisFotoKast();
  schrijfLokaal(LOKAAL_LAATSTE_HUIS, null);
  base44.auth.logout(window.location.origin + window.location.pathname);
}
