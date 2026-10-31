import { datumInNederland, morgenVan } from './kosten.mjs';
import { middernacht } from './dag.mjs';
import { inGewoneWoorden } from './web.mjs';
import { zonOpEnOnder } from './zon.mjs';

/**
 * Stroomprijzen per tijdvak (een kwartier of een uur), alles erin, in euro
 * per kWh:
 *
 *   { van, tot (ms), afname_kwh, teruglevering_kwh, zonnebonus_kwh, bron? }
 *
 * Waar ze vandaan komen staat in de bronnen (zonneplan.mjs, energyzero.mjs).
 * Hier de regels van Zonneplan, en het bijhouden: één keer per dag de prijzen
 * van morgen ophalen, bij een fout de oude houden, en de prijs van dit moment
 * opzoeken.
 */

/**
 * Saldering stopt op 1 januari 2027, 00:00 Nederlandse tijd. Bron: mail van Zonneplan aan klanten
 * (29-09-2026, "Salderen stopt op 1 januari"): vanaf 1-1-2027 voor teruglevering de marktprijs
 * plus de Zonnebonus, geen terugleverkosten; de teruggave van de belasting via saldering valt
 * weg. Voor elk huis bij Zonneplan dezelfde regels.
 */
export const EINDE_SALDERING = Date.UTC(2026, 11, 31, 23, 0);

/**
 * Terugleverkosten per kWh vanaf 2027 (€, met btw): geen. Bron: dezelfde mail van Zonneplan
 * (29-09-2026). Rekent Zonneplan ze later toch, dan hier aanpassen (gaat van de terugleverprijs af).
 */
export const TERUGLEVERKOSTEN_PER_KWH = 0;

/**
 * De regels van Zonneplan voor één tijdvak (bevestigd door Zonneplan, oktober 2026).
 *
 *   afnemen       alles erin: marktprijs + inkoopvergoeding + energiebelasting, met btw
 *   Zonnebonus    10% van de prijs zonder energiebelasting (marktprijs +
 *                 inkoopvergoeding), met 21% btw; alleen tussen zonsopkomst en
 *                 zonsondergang en alleen als dat bedrag boven nul is
 *   terugleveren  t/m 2026 (saldering): evenveel als afnemen, plus de Zonnebonus.
 *                 Vanaf 2027 vallen de belastingen weg: marktprijs plus de
 *                 Zonnebonus, zonder terugleverkosten (TERUGLEVERKOSTEN_PER_KWH = 0;
 *                 mail van Zonneplan, 29-09-2026).
 *
 * Het plafond (de eerste 7.500 kWh teruglevering per jaar): zie naPlafond. Niet
 * meegenomen in de kosten: saldering in 2026 als je over het hele jaar meer
 * teruglevert dan afneemt (wel bij het begrenzen: waardeTeruglevering).
 *
 * @param {{ van: number, tot: number, alles: number, zonderBelasting: number, isDag: boolean }} p
 *   alles: € per kWh alles erin; zonderBelasting: zonder energiebelasting (wel met btw)
 */
export function zonneplanTijdvak({ van, tot, alles, zonderBelasting, isDag }) {
  const zonnebonus = isDag && zonderBelasting > 0 ? 0.1 * zonderBelasting : 0;
  const terug = (van < EINDE_SALDERING ? alles : zonderBelasting - TERUGLEVERKOSTEN_PER_KWH) + zonnebonus;
  // zonder_belasting_kwh (1.5.0): voor de waarde van terugleveren zonder saldering (waardeTeruglevering); blijft thuis.
  return { van, tot, afname_kwh: alles, teruglevering_kwh: terug, zonnebonus_kwh: zonnebonus, zonder_belasting_kwh: zonderBelasting };
}

/**
 * Wat een teruggeleverde kWh in dit tijdvak echt waard is (1.5.0, voor het begrenzen van de
 * omvormer). Met saldering (tot EINDE_SALDERING) en als je over het jaar meer afneemt dan
 * teruglevert, komt de energiebelasting met btw via de saldering terug: dan is het de
 * terugleverprijs van Zonneplan (evenveel als afnemen, plus de Zonnebonus). Lever je over het
 * jaar meer terug dan je afneemt, dan wordt dat deel niet gesaldeerd: alleen de prijs zonder
 * energiebelasting plus de Zonnebonus. Vanaf 2027 is er geen saldering meer: dan staat dat al
 * in teruglevering_kwh (zonneplanTijdvak). Het plafond van de Zonnebonus: eerst naPlafond.
 * Zonder de prijs zonder belasting (een oud tijdvak): de terugleverprijs (voorzichtig: dan
 * begrenst hij eerder niet dan wel).
 */
export function waardeTeruglevering(tijdvak, { nettoAfnemer = true } = {}) {
  if (!tijdvak) return null;
  if (tijdvak.van < EINDE_SALDERING && !nettoAfnemer && Number.isFinite(tijdvak.zonder_belasting_kwh)) {
    return tijdvak.zonder_belasting_kwh + (tijdvak.zonnebonus_kwh ?? 0);
  }
  return tijdvak.teruglevering_kwh;
}

/** De kale terugleverprijs (zonder saldering): wat terugleveren vanaf 2027 waard is. null zonder gegevens. */
export function kaleTeruglevering(tijdvak) {
  if (!tijdvak) return null;
  if (tijdvak.van >= EINDE_SALDERING) return tijdvak.teruglevering_kwh;
  return Number.isFinite(tijdvak.zonder_belasting_kwh) ? tijdvak.zonder_belasting_kwh + (tijdvak.zonnebonus_kwh ?? 0) : null;
}

/** "De zonnebonus geldt voor de eerste 7.500 kWh die je per kalenderjaar teruglevert" (contract). */
export const ZONNEBONUS_PLAFOND_KWH = 7500;

/** Al 7.500 kWh teruggeleverd dit jaar, dan geen Zonnebonus meer tot 1 januari. */
export function naPlafond(tijdvak, teruggeleverdDitJaarKwh) {
  if (!tijdvak || !(tijdvak.zonnebonus_kwh > 0) || !(teruggeleverdDitJaarKwh >= ZONNEBONUS_PLAFOND_KWH)) return tijdvak;
  return { ...tijdvak, teruglevering_kwh: tijdvak.teruglevering_kwh - tijdvak.zonnebonus_kwh, zonnebonus_kwh: 0 };
}

/** Wat de app laat zien: dit jaar teruggeleverd, tegenover het plafond (jaar uit volgJaar in kosten.mjs). */
export function jaarVoorApp(jaar) {
  return { jaar: jaar.jaar, teruglevering_kwh: Math.round(jaar.teruglevering_kwh * 10) / 10, plafond_kwh: ZONNEBONUS_PLAFOND_KWH };
}

/** Valt het midden van het tijdvak tussen zonsopkomst en zonsondergang (standaard in De Bilt, zie zon.mjs)? */
export function isDag(van, tot, zonVoor = zonOpEnOnder) {
  const midden = (van + tot) / 2;
  const { op, onder } = zonVoor(datumInNederland(midden));
  return op <= midden && midden < onder;
}

/** Het tijdvak waarin `nu` valt, of null. */
export function prijsOp(tijdvakken, nu) {
  return tijdvakken.find((t) => t.van <= nu && nu < t.tot) ?? null;
}

/** De prijs van dit moment in de vorm van de app (zie base44/entities/Meting.jsonc). */
export function prijsVoorApp(tijdvak, bron) {
  if (!tijdvak) return null;
  const r = (v) => Math.round(v * 100_000) / 100_000;
  return {
    afname_kwh: r(tijdvak.afname_kwh),
    teruglevering_kwh: r(tijdvak.teruglevering_kwh),
    zonnebonus_kwh: r(tijdvak.zonnebonus_kwh ?? 0),
    van: new Date(tijdvak.van).toISOString(),
    tot: new Date(tijdvak.tot).toISOString(),
    bron: tijdvak.bron ?? bron,
  };
}

const KWARTIER_MS = 15 * 60_000;
/** Vandaag en morgen, ook op een dag van 25 uur. */
const HOOGSTENS_KWARTIEREN = 200;

/**
 * De prijzen van vandaag (vanaf middernacht) en, als ze er al zijn, morgen,
 * per kwartier, voor de grafiek in de app. Dezelfde bedragen als de prijs van
 * nu: alles erin, met de Zonnebonus zolang het plafond niet bereikt is
 * (naPlafond). Compact: één begin en drie rijen getallen op 4 decimalen.
 * Aaneengesloten: bij het eerste ontbrekende kwartier houdt het op, dus er
 * staat nooit een gat (of null) in.
 *
 * @param {Array<object>} tijdvakken  van prijsVolger.alle()
 * @param {{ vanaf: number, teruggeleverdDitJaarKwh: number|null, bron: string }} o  vanaf: middernacht van vandaag (ms)
 */
export function voorspellingVoorApp(tijdvakken, { vanaf, teruggeleverdDitJaarKwh, bron }) {
  const op = new Map(tijdvakken.filter((t) => t.tot - t.van === KWARTIER_MS).map((t) => [t.van, t]));
  const eerste = [...op.keys()].filter((van) => van >= vanaf).sort((a, b) => a - b)[0];
  if (eerste === undefined) return null;
  // Het plafond hoort bij het kalenderjaar van het tijdvak: op 31 december telt 1 januari weer vanaf 0 kWh.
  const jaarVan = (ms) => datumInNederland(ms).slice(0, 4);
  const ditJaar = jaarVan(vanaf);
  const r = (v) => Math.round(v * 10_000) / 10_000;
  const uit = { afname_kwh: [], teruglevering_kwh: [], zonnebonus_kwh: [] };
  let schatting = false;
  let naam = bron;
  for (let van = eerste; op.has(van) && uit.afname_kwh.length < HOOGSTENS_KWARTIEREN; van += KWARTIER_MS) {
    const t = naPlafond(op.get(van), jaarVan(van) === ditJaar ? teruggeleverdDitJaarKwh : 0);
    uit.afname_kwh.push(r(t.afname_kwh));
    uit.teruglevering_kwh.push(r(t.teruglevering_kwh));
    uit.zonnebonus_kwh.push(r(t.zonnebonus_kwh ?? 0));
    schatting ||= t.schatting === true;
    naam = t.bron ?? naam;
  }
  return { van: new Date(eerste).toISOString(), stap_min: 15, ...uit, schatting, bron: naam };
}

/**
 * Eerst de hoofdbron; lukt die niet, dan de reserve. Elk tijdvak krijgt de
 * naam van waar het vandaan kwam, zodat de app een schatting zo kan noemen.
 */
export function metReserve(hoofd, reserve, { log = () => {}, klok = Date.now } = {}) {
  let laatsteFout = '';
  let foutSinds = null;
  return {
    naam: hoofd.naam,
    /** Wat er mis is met de hoofdbron, voor de app ({ tekst, sinds }), of null. */
    probleem: () => (laatsteFout ? { tekst: `${hoofd.naam}: ${laatsteFout}. Tot dan een schatting via ${reserve.naam}.`, sinds: foutSinds } : null),
    async haal() {
      try {
        const tijdvakken = await hoofd.haal();
        if (laatsteFout) log(`${hoofd.naam}: prijzen weer binnen.`);
        laatsteFout = '';
        foutSinds = null;
        return tijdvakken.map((t) => ({ ...t, bron: hoofd.naam }));
      } catch (fout) {
        const tekst = inGewoneWoorden(fout);
        if (tekst !== laatsteFout) log(`${hoofd.naam}: ${tekst}. Tot dan een schatting via ${reserve.naam}.`);
        laatsteFout = tekst;
        foutSinds ??= klok();
        let tijdvakken;
        try {
          tijdvakken = await reserve.haal();
        } catch (reserveFout) {
          throw new Error(`ook ${reserve.naam} lukt niet (${inGewoneWoorden(reserveFout)})`, { cause: reserveFout });
        }
        return tijdvakken.map((t) => ({ ...t, bron: `${reserve.naam} (schatting)`, schatting: true }));
      }
    },
  };
}

/** Vanaf dit uur kunnen de prijzen van morgen er staan (de veiling voor morgen is rond 13:00). */
const MORGEN_VANAF_UUR = 13;
const OPNIEUW_MS = 15 * 60_000;
const ONTBREEKT_OPNIEUW_MS = 5 * 60_000;
/** Zo lang wacht de allereerste meetronde hooguit op de prijzen; daarna nooit meer. */
const EERSTE_WACHT_MS = 5000;


const uurNotatie = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', hour: '2-digit', hourCycle: 'h23' });
const uurInNederland = (ms) => Number(uurNotatie.format(new Date(ms)));

/** Staan de prijzen van morgen erin, tot in de avond? */
export function heeftMorgen(tijdvakken, nu) {
  const morgen = morgenVan(datumInNederland(nu));
  return tijdvakken.some((t) => datumInNederland(t.van) === morgen && uurInNederland(t.van) >= 23);
}

/**
 * De prijzen die er al waren samen met wat er net binnenkwam. Begint het
 * nieuwe antwoord pas bij het huidige uur, dan blijft de ochtend staan (voor
 * de voorspelling vanaf middernacht). Een echte prijs gaat voor een schatting:
 * kwam er echt binnen, dan gaan de oude schattingen weg; kwamen er alleen
 * schattingen, dan blijven de echte prijzen die er al waren. Wat vóór `grens`
 * eindigt (middernacht van gisteren) gaat weg.
 */
export function voegPrijzenSamen(oud, nieuw, grens) {
  const overlapt = (t, lijst) => lijst.some((n) => n.van < t.tot && t.van < n.tot);
  const vers = (t) => t.tot > grens;
  const echtNieuw = nieuw.filter((t) => !t.schatting);
  const echt = [...echtNieuw, ...oud.filter((t) => !t.schatting && vers(t) && !overlapt(t, echtNieuw))];
  const schattingNieuw = nieuw.filter((t) => t.schatting && !overlapt(t, echt));
  const schatting = echtNieuw.length
    ? []
    : [...schattingNieuw, ...oud.filter((t) => t.schatting && vers(t) && !overlapt(t, echt) && !overlapt(t, schattingNieuw))];
  return [...echt, ...schatting].sort((a, b) => a.van - b.van);
}

/**
 * Houdt de prijzen bij uit een bron met `haal()` → tijdvakken. Bij een
 * dynamisch contract liggen de prijzen per kwartier de dag ervoor vast. Dus:
 * één keer bij het starten, en elke dag vanaf 13:00 elk kwartier tot de
 * prijzen van morgen er zijn. Zijn het schattingen omdat Zonneplan niet
 * antwoordde, dan elk kwartier Zonneplan opnieuw. Ontbreekt de prijs van nu,
 * dan elke vijf minuten.
 */
export function prijsVolger(bron, { log = () => {}, klok = Date.now, eersteWachtMs = EERSTE_WACHT_MS } = {}) {
  let tijdvakken = [];
  let nietVoor = 0;
  let bezig = null;
  let eerste = true;
  let laatsteFout = '';
  let foutSinds = null;

  async function ververs() {
    try {
      const nieuw = await bron.haal();
      if (nieuw.length) tijdvakken = voegPrijzenSamen(tijdvakken, nieuw, middernacht(klok()) - 86_400_000);
      if (laatsteFout) log(`${bron.naam}: prijzen weer binnen.`);
      laatsteFout = '';
      foutSinds = null;
    } catch (fout) {
      const tekst = inGewoneWoorden(fout);
      if (tekst !== laatsteFout) log(`${bron.naam}: ${tekst}`);
      laatsteFout = tekst;
      foutSinds ??= klok();
    }
  }

  return {
    naam: bron.naam,
    /** Wat er mis is met de prijzen, voor de app ({ tekst, sinds }), of null. */
    probleem: () => (laatsteFout ? { tekst: `Prijzen: ${laatsteFout}`, sinds: foutSinds } : (bron.probleem?.() ?? null)),
    /**
     * De prijs van nu. Alleen de allereerste keer wachten we even op de bron (hooguit
     * eersteWachtMs); daarna nooit meer in de meetronde (0.13.0). Hangt Zonneplan of EnergyZero
     * (internet half), dan gaat de stand gewoon zonder prijs door; die komt als hij er is.
     */
    async nu() {
      const nu = klok();
      const ontbreekt = !prijsOp(tijdvakken, nu);
      const morgenNodig = uurInNederland(nu) >= MORGEN_VANAF_UUR && !heeftMorgen(tijdvakken, nu);
      const schatting = tijdvakken.some((t) => t.schatting);
      if (!bezig && nu >= nietVoor && (ontbreekt || morgenNodig || schatting)) {
        nietVoor = nu + (ontbreekt ? ONTBREEKT_OPNIEUW_MS : OPNIEUW_MS);
        bezig = ververs().finally(() => {
          bezig = null;
        });
      }
      if (bezig && eerste && tijdvakken.length === 0) {
        let wekker;
        const genoeg = new Promise((klaar) => {
          wekker = setTimeout(klaar, eersteWachtMs);
          wekker.unref?.();
        });
        await Promise.race([bezig, genoeg]);
        clearTimeout(wekker);
      }
      eerste = false;
      return prijsOp(tijdvakken, klok());
    },
    /** Alle prijzen die er nu zijn (vandaag en misschien morgen), voor de voorspelling in de app. */
    alle: () => tijdvakken,
  };
}
