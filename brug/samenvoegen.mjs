/**
 * Alle losse metingen samen tot één stand voor de app, in de vorm van
 * base44/entities/Meting.jsonc. Wat er thuis niet is, wordt null; de app
 * laat dat rondje dan weg.
 *
 *   rol "net"              de P1-meter in de meterkast: plus afnemen, min terugleveren
 *   rol "zon"              een kWh-meter op de omvormer van panelen
 *   rol "zon-en-batterij"  een kWh-meter op een groep met panelen én de Zendure
 *                          (bijvoorbeeld "Batterij + Zon"); de zon wordt uitgerekend
 *   rol "apparaat"         een Energy Socket of kWh-meter op één apparaat
 *
 * Elke plek met panelen wordt een eigen zonnebron in `zonnen`; zon_w is hun
 * som. Panelen aan de Zendure zelf (niet bij de 2400 AC) tellen ook mee.
 *
 * Zon uit "zon-en-batterij": de meter ziet de groep als geheel. Wat de groep
 * gebruikt (meter_w, plus) = wat de Zendure laadt − wat hij levert − wat de
 * panelen leveren. Dus:
 *
 *     zon = −(Zendure netto naar het huis) − meter_w
 *
 * 's Nachts laden met 2300 W: meter +2300, Zendure −2300 → zon 0.
 * Overdag 3000 W zon en 1000 W laden: meter −2000, Zendure −1000 → zon 3000.
 */

const rond = (w) => (w === null || w === undefined ? null : Math.round(w));

/** De middelste van de laatste drie: één scheve meting (meters die net niet tegelijk meten) valt weg. */
export function mediaanVanDrie(historie, sleutel, w) {
  const rij = [...(historie.get(sleutel) ?? []), w].slice(-3);
  historie.set(sleutel, rij);
  return [...rij].sort((a, b) => a - b)[Math.floor(rij.length / 2)];
}

/**
 * Zon en Zendure uit een meter op zon + Zendure, met die meter als anker: hij
 * is lokaal en een seconde vers, de Zendure komt via de cloud en loopt soms
 * tellen tot minuten achter. Wat de groep levert (−meter_w) is altijd zon plus
 * wat de Zendure netto aan het huis geeft (ac). Dus:
 *
 *   's nachts       zon 0, de Zendure precies −meter_w (wat de cloud ook zegt)
 *   overdag         zon = −ac − meter_w; zou dat onder 0 of boven de piek
 *                   komen, dan zon 0 of de piek en de rest naar de Zendure
 *                   (niet naar het huis)
 *   geen Zendure    gebruikt de groep stroom, dan laadt de Zendure (zon 0);
 *                   levert hij, dan telt het als zon (tot de piek)
 *
 * Geeft { zon, ac, uitMeter }: ac is null als hij niet te weten is; uitMeter
 * zegt of ac uit de meter kwam (en dan niet van de Zendure).
 */
export function groepVerdelen(meter_w, zendureAc, piek, { nacht = false } = {}) {
  const levert = 0 - meter_w; // 0 - 0 is 0, niet -0
  if (nacht) return { zon: 0, ac: levert, uitMeter: true };
  const hoogstens = piek ?? Number.POSITIVE_INFINITY;
  const bekend = zendureAc !== null && zendureAc !== undefined;
  const ruw = bekend ? levert - zendureAc : levert;
  const zon = Math.min(hoogstens, Math.max(0, ruw));
  if (zon === ruw) return { zon, ac: bekend ? zendureAc : null, uitMeter: false };
  return { zon, ac: levert - zon, uitMeter: true };
}

/** Alleen de zon uit groepVerdelen. */
export function zonUitGroep(meter_w, zendureAc, piek, opties) {
  return groepVerdelen(meter_w, zendureAc, piek, opties).zon;
}

/**
 * De opwek van een gewone zonnemeter (rol "zon"), in watt, nooit min. Op een
 * kWh-meter is opwek meestal min, maar sommige zijn omgekeerd aangesloten
 * (opwek plus). Daarom per meter `opwek` in de instellingen:
 *
 *   'min'   opwek is min (gewoon); plus is verbruik en telt niet als zon
 *   'plus'  omgekeerd aangesloten: opwek is plus; min telt niet als zon
 *   weg     nog niet bekend (instellingen van voor 0.6.2): zoals altijd |w|, zodat
 *           een omgekeerd aangesloten meter blijft werken. De instelhulp zet het
 *           teken zodra hij het met de meter overdag kan nagaan (zie instellen.mjs).
 *
 * 's Nachts is er geen zon: wat de omvormer dan gebruikt (standby), is geen opwek.
 */
export function zonVanMeter(w, opwek, { nacht = false } = {}) {
  if (w === null || w === undefined) return null;
  if (nacht) return 0;
  if (opwek === 'min') return Math.max(0, 0 - w);
  if (opwek === 'plus') return Math.max(0, w);
  return Math.abs(w);
}

/** Vanaf zoveel watt telt het als duidelijk verbruik (of opwek) bij een zonnemeter; standby van een omvormer is een paar watt. */
export const DUIDELIJK_W = 50;
/** Zoveel lezingen op rij duidelijk verbruik, en een zonnemeter wordt gemeld. */
export const VERBRUIK_NA_KEER = 3;

/** Wat een zonnemeter verbruikt in zijn eigen teken: plus = verbruik (weg telt als 'min', het gewone). */
export const verbruikVan = (w, opwek) => (opwek === 'plus' ? 0 - w : w);

/**
 * De zonnemeters die nu, overdag, duidelijk verbruik meten, zoals in huis B: daar
 * stonden de meter op de spa en die op de panelen verwisseld, en de "zon"
 * gebruikte +1.372 W. Met een bekend teken (`opwek`) is dat genoeg: een
 * zonnemeter gebruikt overdag hooguit een paar watt. Zonder bekend teken kan
 * het ook een omgekeerd aangesloten meter zijn die levert; dan alleen als iets
 * anders laat zien dat er wat niet klopt: een andere zonnebron levert, een
 * "apparaat" levert stroom (de echte zonnemeter?), of de omvormer levert.
 *
 * @param {{ homewizard: Array<{ meter, w }>, meting: object, nacht?: boolean, omvormerW?: number|null }} o
 * @returns {Array<{ sleutel: string, naam: string, w: number }>}  w: wat de meter meet (met zijn teken)
 */
export function zonmetersMetVerbruik({ homewizard, meting, nacht = false, omvormerW = null }) {
  if (nacht) return [];
  const uit = [];
  for (const { meter, w } of homewizard) {
    if (meter.rol !== 'zon' || w === null || w === undefined || verbruikVan(w, meter.opwek) < DUIDELIJK_W) continue;
    const bewijs =
      meter.opwek !== undefined ||
      (meting?.zonnen ?? []).some((z) => z.sleutel !== meter.sleutel && (z.vermogen_w ?? 0) >= DUIDELIJK_W) ||
      homewizard.some((h) => h.meter.rol === 'apparaat' && h.w !== null && h.w !== undefined && h.w <= -DUIDELIJK_W) ||
      (omvormerW ?? 0) >= DUIDELIJK_W;
    if (bewijs) uit.push({ sleutel: meter.sleutel, naam: meter.naam, w: Math.round(w) });
  }
  return uit;
}

/** Hele watts met een punt bij de duizendtallen, zonder teken: "1.372 W". */
export const wattTekst = (w) => `${String(Math.abs(Math.round(w))).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} W`;

/** Zo, met altijd een teken: "+1.372 W", "−121 W". */
export const wattMetTeken = (w) => `${Math.round(w) < 0 ? '−' : '+'}${wattTekst(w)}`;

/** Wat een meter nu doet, in woorden (plus = gebruikt, min = levert): "levert nu 121 W", "gebruikt nu 1.372 W". */
export function vermogenInWoorden(w) {
  if (Math.abs(w) < 5) return `meet nu bijna niets (${Math.round(w)} W)`;
  return w < 0 ? `levert nu ${wattTekst(w)}` : `gebruikt nu ${wattTekst(w)}`;
}

/** De melding (brug.log, Apparaten in de app en proef), hooguit 160 tekens. */
export function verbruikTekst({ naam, w }) {
  return `De meter '${naam}' meet verbruik (${wattMetTeken(w)}), geen opwek: staat hij goed in de instelhulp?`;
}

/**
 * Houdt bij welke zonnemeters verbruik meten. Pas na VERBRUIK_NA_KEER lezingen
 * op rij gemeld (een wolk of één scheve meting telt niet); daarna blijft de
 * melding staan tot de meter weer duidelijk opwek meet (bij een spa die aan en
 * uit slaat zou hij anders heen en weer springen). Na de instelhulp start het
 * programmaatje opnieuw en begint het van voren af aan.
 *
 * ronde() geeft { nieuw, gemeld }: nieuw = vanaf nu gemeld (één regel in het logboek),
 * gemeld = alle die nu gemeld staan, met sinds (ms).
 */
export function maakVerbruikWacht({ drempel = VERBRUIK_NA_KEER } = {}) {
  const staat = new Map();
  return {
    ronde({ homewizard, meting, nacht = false, omvormerW = null, nu = Date.now() }) {
      const verdachten = zonmetersMetVerbruik({ homewizard, meting, nacht, omvormerW });
      const nieuw = [];
      for (const { meter, w } of homewizard) {
        if (meter.rol !== 'zon') continue;
        const verdacht = verdachten.find((v) => v.sleutel === meter.sleutel);
        const s = staat.get(meter.sleutel) ?? { keer: 0, sinds: null, w: null };
        if (verdacht) {
          s.keer += 1;
          s.w = verdacht.w;
          if (s.keer >= drempel && s.sinds === null) {
            s.sinds = nu;
            nieuw.push({ sleutel: meter.sleutel, naam: meter.naam, w: s.w, sinds: nu });
          }
        } else if (s.sinds === null) {
          s.keer = 0;
        } else if (!nacht && w !== null && w !== undefined && verbruikVan(w, meter.opwek) <= -DUIDELIJK_W) {
          // Weer duidelijk opwek: dan klopt hij toch.
          s.keer = 0;
          s.sinds = null;
        }
        staat.set(meter.sleutel, s);
      }
      const gemeld = homewizard.flatMap(({ meter }) => {
        const s = meter.rol === 'zon' ? staat.get(meter.sleutel) : null;
        return s && s.sinds !== null ? [{ sleutel: meter.sleutel, naam: meter.naam, w: s.w, sinds: s.sinds }] : [];
      });
      return { nieuw, gemeld };
    },
  };
}

/**
 * @param {{ homewizard: Array<{ meter: object, w: number|null }>,
 *           zendure: { zon_w, batterij_w, batterij_procent, ac_w, info? } | null,
 *           zendureP1?: number|null,
 *           versie: string,
 *           historie?: Map, nacht?: boolean }} invoer   historie: voor het gladstrijken van uitgerekende zon;
 *   nacht: de zon is onder (zie isNacht in zon.mjs): geen zon, en de Zendure komt van de groepsmeter
 *   zendureP1: wat een Zendure P1-meter op dezelfde meterkast meet. Om te
 *   vergelijken, en als reserve: net_w komt van de HomeWizard P1, maar
 *   antwoordt die niet (of is er geen), dan van de Zendure P1. net_bron zegt
 *   welke ('homewizard', 'zendure-p1', of null zonder meter op het net).
 *   fasen: per fase van de P1-meter { fase, w, a, v } (fasenUit in homewizard.mjs).
 *   zendure.info: meer over de batterij (batterijInfoUit in zendure.mjs); gaat mee als
 *   batterij_info, elke keer, net als batterij_w. Zonder: niet meegestuurd, en dan
 *   maakt ontvangMeting het leeg (nooit van een tijd terug).
 *   omvormer: het blok van de GoodWe (omvormerVoorApp in goodwe.mjs); zo ook elke keer.
 *   meterkast: van de P1-meter (meterkastUit in homewizard.mjs, 1.4.0); zo ook elke keer.
 */
export function maakMeting({ homewizard = [], zendure = null, zendureP1 = null, fasen = null, omvormer = null, meterkast = null, versie, historie, nacht = false }) {
  let net = null;
  // De Zendure uit de groepsmeter (groepVerdelen), alleen als er precies één zo'n groep is.
  const groepen = homewizard.filter(({ meter }) => meter.rol === 'zon-en-batterij').length;
  let batterijUitMeter = null;
  // De app zet de eerste zonnebron op het dak van het huis, de tweede op het
  // dierenverblijf of de schuur (src/lib/opstelling.js). Panelen op een groep
  // met de batterij horen bij het huis, dus die eerst, wat de volgorde in de
  // instellingen ook is (in huis A stond het dierenverblijf eerst).
  const zonMetBatterij = [];
  const zonnen = [];
  const apparaten = [];

  for (const { meter, w } of homewizard) {
    if (meter.rol === 'net') {
      if (w !== null) net = (net ?? 0) + w;
    } else if (meter.rol === 'zon') {
      zonnen.push({ sleutel: meter.sleutel, naam: meter.naam, vermogen_w: zonVanMeter(w, meter.opwek, { nacht }) });
    } else if (meter.rol === 'zon-en-batterij') {
      let zon = null;
      if (w !== null) {
        const deel = groepVerdelen(w, zendure?.ac_w ?? null, meter.piek_w, { nacht });
        // Gladstrijken alleen als zon en Zendure allebei gemeten zijn (twee meters die net niet tegelijk meten).
        const glad = historie ? mediaanVanDrie(historie, meter.sleutel, deel.zon) : deel.zon;
        zon = deel.uitMeter ? deel.zon : glad;
        // Zendure netto naar het huis min zijn eigen panelen = de batterij (plus = levert).
        if (deel.uitMeter && groepen === 1) batterijUitMeter = deel.ac - (nacht ? 0 : (zendure?.zon_w ?? 0));
      }
      zonMetBatterij.push({ sleutel: meter.sleutel, naam: meter.naam, vermogen_w: zon });
    } else {
      apparaten.push({ sleutel: meter.sleutel, naam: meter.naam, soort: meter.soort, vermogen_w: w === null ? null : Math.max(0, rond(w)) });
    }
  }

  zonnen.unshift(...zonMetBatterij);
  if (zendure?.zon_w !== null && zendure?.zon_w !== undefined) {
    zonnen.push({ sleutel: 'zendure-zon', naam: 'Zon (Zendure)', vermogen_w: zendure.zon_w });
  }

  // De HomeWizard P1 weg (of geen): dan het net van de Zendure P1, die op dezelfde meterkast zit.
  const metZendureP1 = Number.isFinite(zendureP1);
  const netBron = net !== null ? 'homewizard' : metZendureP1 ? 'zendure-p1' : null;
  if (net === null && metZendureP1) net = zendureP1;

  const bekend = zonnen.filter((z) => z.vermogen_w !== null);
  return {
    net_w: rond(net),
    net_bron: netBron,
    net_zendure_w: rond(zendureP1),
    zon_w: bekend.length ? rond(bekend.reduce((som, z) => som + z.vermogen_w, 0)) : null,
    zonnen: zonnen.map((z) => ({ ...z, vermogen_w: rond(z.vermogen_w) })),
    batterij_w: rond(batterijUitMeter ?? zendure?.batterij_w ?? null),
    batterij_procent: rond(zendure?.batterij_procent ?? null),
    ...(zendure?.info ? { batterij_info: zendure.info } : {}),
    apparaten,
    bron: `brug ${versie}`,
    // Per fase: watt heel, ampère en volt op één decimaal; wat ontbreekt gaat niet mee.
    ...(fasen?.length ? { fasen: fasen.map(faseVoorApp) } : {}),
    // De omvormer (goodwe.mjs, omvormerVoorApp): elke keer als hij er is, net als batterij_info.
    ...(omvormer ? { omvormer } : {}),
    // De meterkast (1.4.0, meterkastUit in homewizard.mjs): tarief, piek, gas en water; elke keer als de P1-meter het geeft.
    ...(meterkast ? { meterkast } : {}),
  };
}

const eenDecimaal = (v) => Math.round(v * 10) / 10;

function faseVoorApp({ fase, w, a, v }) {
  return {
    fase,
    ...(w === null || w === undefined ? {} : { w: Math.round(w) }),
    ...(a === null || a === undefined ? {} : { a: eenDecimaal(a) }),
    ...(v === null || v === undefined ? {} : { v: eenDecimaal(v) }),
  };
}

/**
 * Een meter die één keer niet antwoordt, houdt even zijn laatste waarde;
 * anders knippert hij in de app. Na `houdbaar` ms telt hij als weg.
 */
export function metGeheugen(geheugen, sleutel, w, nu, houdbaar = 60_000) {
  if (w !== null && w !== undefined) {
    geheugen.set(sleutel, { w, moment: nu });
    return w;
  }
  const oud = geheugen.get(sleutel);
  return oud && nu - oud.moment < houdbaar ? oud.w : null;
}
