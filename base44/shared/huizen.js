/**
 * De functie huis (base44/functions/huis/entry.ts): alles wat de site over
 * een omgeving vraagt of verandert. De site leest en schrijft Huis, Meting,
 * Opstelling, Dag en Gebeurtenis nooit zelf.
 *
 *   POST { actie, ... }
 *
 *   mijn                                      wie ben ik, welke omgevingen, mag ik er een maken
 *                                             (beheerder: alle; een gewone gebruiker: zijn ene)
 *   maak { naam }                             een omgeving; geeft de sleutel één keer        beheerder
 *   stand { huis_id }                         de laatste meting                          leden
 *   periode { huis_id, van, tot }             de dagen in dat bereik (tabel Dag)         leden
 *   logboek { huis_id }                       de laatste 50 storingen (tabel Gebeurtenis) leden
 *   overzicht                                 alle huizen met de kern van nu, in één keer  beheerder
 *   opstelling { huis_id }                    indeling, namen, maxima, fasen, link naar de foto  leden
 *   bewaarOpstelling { huis_id, opstelling }  ook de namen, maxima, de grens per fase en de rol van de batterij  eigenaar
 *   uitnodigen, verwijderLid { huis_id, email }  iemand hoort bij één omgeving          eigenaar
 *   nieuweSleutel { huis_id }                 de oude werkt meteen niet meer             eigenaar
 *   hernoem { huis_id, naam }                                                            eigenaar
 *   zetOpAfstand { huis_id, veld, pakket, nieuw_paar? }  een versleuteld geheim voor thuis (opAfstand.js)  eigenaar
 *   wisOpAfstand { huis_id, veld }            dat stuk weer weg van de server               eigenaar
 *   labelHerkend { huis_id, label }           "Klopt" of "Dat was …" voor het herkennen (herkennen.js)  eigenaar
 *   omvormerSturen { huis_id, aan? | dag+niet? | nu_aan? | netto? }  de omvormer begrenzen bij een
 *                                             negatieve prijs: aan/uit, "morgen niet", "Nu weer aan" (omvormerSturen.js)  eigenaar
 *
 * Bij elke actie in deze volgorde: eerst wie er belt (401 zonder ingelogde
 * gebruiker, nog voordat we de vraag lezen), dan of dat account aan staat
 * (403), dan de rechten per huis (toegang.js), en pas daarna de tabellen.
 * "eigenaar" is hier ook de beheerder van de app: die beheert elke omgeving.
 *
 * Schrijven: één schrijver per rij. Huis en Opstelling schrijft alleen de
 * eigenaar, via hier, en de site stuurt zijn wijzigingen na elkaar
 * (src/api/huis.js). Elke schrijfactie leest de rij vers vlak ervoor. Meting,
 * Dag en Gebeurtenis schrijft alleen ontvangMeting; hier worden ze alleen gelezen.
 */
import { metingVoorKijker, zonderAdressen } from './afschermen.js';
import { DAG_VELDEN, dagNummer, HOOGSTENS_DAGEN } from './dagen.js';
import { GasFout, gasStandenUit, gasStandUit, metGasStand, zonderGasStand } from './gas.js';
import { GEDULD_LEZEN, isRem, metGeduld, remAntwoord } from './geduld.js';
import { herkendVoorSite, labelUit, metLabel, uitgesteldVan } from './herkennen.js';
import { LOGBOEK_VOORVOEGSEL, SturenFout, voorSite as sturenVoorSite, wijzig as wijzigSturen } from './omvormerSturen.js';
import { kortAfdruk, metVeld, pakketUit, paarVoorKlaarzetten, vastVan, veldVorm, voorSite as opAfstandVoorSite } from './opAfstand.js';
import { maakSleutel, sha256Hex } from './sleutel.js';
import { tabellen } from './tabellen.js';
import { schoon } from './tekst.js';
import {
  alleenBeheerder,
  alleHuizen,
  eigenHuisUit,
  emailVan,
  Fout,
  HOOGSTENS_EIGEN_HUIZEN,
  HOOGSTENS_LEDEN,
  HOOGSTENS_PER_TOKEN,
  huisVoor,
  inEmmer,
  isBeheerder,
  LEZEN_ONTHOUDEN_MS,
  ledenVan,
  magInDeApp,
  magMaken,
  naOpzoeken,
  onthoud,
  onthoudEigenHuis,
  rolIn,
  uitGeheugen,
  voorOpzoeken,
} from './toegang.js';

const SLEUTEL = /^[a-zA-Z0-9._:-]{1,60}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Zoveel rondjes kan een huis hebben: vier vaste, tien plekken met panelen, veertig apparaten, en ruimte. */
const HOOGSTENS_PUNTEN = 100;

const antwoord = (data, status = 200) => Response.json(data, { status });
const statusVan = (e) => e?.status ?? e?.response?.status ?? null;
const invoerFout = (tekst = 'Deze vraag klopt niet.') => new Fout(400, 'invoer', tekst);

function naamUit(ruw) {
  const naam = typeof ruw === 'string' ? schoon(ruw, 41).replace(/\s+/g, ' ') : '';
  if (!naam || naam.length > 40) throw new Fout(400, 'naam', 'Geef de omgeving een naam van hooguit 40 tekens.');
  return naam;
}

function emailUit(ruw) {
  const email = emailVan(ruw);
  if (!EMAIL.test(email) || email.length > 254) throw new Fout(400, 'email', 'Dat is geen e-mailadres.');
  return email;
}

const sleutelUit = (ruw) => {
  if (typeof ruw !== 'string' || !SLEUTEL.test(ruw)) throw invoerFout();
  return ruw;
};

/** Een plek op de foto, in procenten. */
const plekUit = (ruw) => {
  if (typeof ruw !== 'number' || !Number.isFinite(ruw) || ruw < 0 || ruw > 100) throw invoerFout();
  return Math.round(ruw * 10) / 10;
};

/** Een eigen naam voor een rondje: zonder rare tekens, spaties samengevoegd, 1 tot 40 tekens. */
const puntNaamUit = (ruw) => {
  const ruwe = typeof ruw === 'string' ? ruw.replace(/\s+/g, ' ').trim() : '';
  // Stuurtekens weigeren we; onzichtbare en omkeertekens gaan er stil uit (base44/shared/tekst.js).
  const naam = schoon(ruwe, 41);
  if (!naam || naam.length > 40 || [...ruwe].some((t) => t.charCodeAt(0) < 32 || t.charCodeAt(0) === 127)) {
    throw new Fout(400, 'naam', 'Een naam is 1 tot 40 tekens.');
  }
  return naam;
};

const lijstUit = (ruw, maak) => {
  if (!Array.isArray(ruw) || ruw.length > HOOGSTENS_PUNTEN) throw invoerFout();
  return ruw.map(maak);
};

/**
 * Het maximale vermogen van een rondje, in watt (Instellingen › Namen): bij
 * panelen wat ze hooguit leveren, bij de batterij hoe hard hij hooguit laadt of
 * levert. Daarmee vult de ring om het rondje op de foto zich.
 */
const MAX_W = { laag: 100, hoog: 100_000 };
const maxUit = (ruw) => {
  if (typeof ruw !== 'number' || !Number.isFinite(ruw) || ruw < MAX_W.laag || ruw > MAX_W.hoog) {
    throw new Fout(400, 'vermogen', 'Een maximaal vermogen is 100 tot 100.000 W.');
  }
  return Math.round(ruw);
};

/**
 * De grens en de zekering per fase (Instellingen › Namen), in ampère: vanaf de
 * grens zegt de app rustig dat een fase zwaar belast is. Null wist hem (dan
 * gelden 20 A en 25 A, src/lib/fasen.js).
 */
const AMPERE = { laag: 1, hoog: 200 };
const ampereUit = (ruw) => {
  if (ruw === null) return null;
  if (typeof ruw !== 'number' || !Number.isFinite(ruw) || ruw < AMPERE.laag || ruw > AMPERE.hoog) {
    throw new Fout(400, 'ampere', 'Een grens of zekering is 1 tot 200 A.');
  }
  return Math.round(ruw * 10) / 10;
};
/** Wat de opstelling over de fasen bewaart; 'opstelling' geeft het terug. */
export const FASE_VELDEN = Object.freeze(['fase_grens_a', 'zekering_a']);

/**
 * De rol van de batterij in het Advies: eigen gebruik of handelen. Alleen
 * voor het advies; de app stuurt de batterij nooit aan. Null wist hem (dan
 * eigen gebruik).
 */
export const BATTERIJ_ROLLEN = Object.freeze(['eigen', 'handelen']);
const batterijRolUit = (ruw) => {
  if (ruw === null) return null;
  if (!BATTERIJ_ROLLEN.includes(ruw)) throw invoerFout();
  return ruw;
};

/**
 * Wat de eigenaar aan de opstelling mag veranderen; de rest valt weg. Alleen
 * de velden die meekomen, zodat een wijziging van de foto de indeling niet
 * overschrijft (en andersom).
 */
function opstellingUit(ruw) {
  if (!ruw || typeof ruw !== 'object' || Array.isArray(ruw)) throw invoerFout();
  const velden = {};
  if (ruw.tekening !== undefined) {
    if (typeof ruw.tekening !== 'string' || !/^[a-z]{1,30}$/.test(ruw.tekening)) throw invoerFout();
    velden.tekening = ruw.tekening;
  }
  if (ruw.punten !== undefined) {
    velden.punten = lijstUit(ruw.punten, (p) => ({ sleutel: sleutelUit(p?.sleutel), x: plekUit(p?.x), y: plekUit(p?.y) }));
  }
  if (ruw.verborgen !== undefined) velden.verborgen = [...new Set(lijstUit(ruw.verborgen, sleutelUit))];
  if (ruw.namen !== undefined) {
    // Per rondje één naam; komt een sleutel twee keer voor, dan telt de laatste.
    const namen = new Map(lijstUit(ruw.namen, (n) => [sleutelUit(n?.sleutel), puntNaamUit(n?.naam)]));
    velden.namen = [...namen].map(([sleutel, naam]) => ({ sleutel, naam }));
  }
  if (ruw.vermogens !== undefined) {
    // Ook hier per rondje één; de laatste telt.
    const vermogens = new Map(lijstUit(ruw.vermogens, (v) => [sleutelUit(v?.sleutel), maxUit(v?.max_w)]));
    velden.vermogens = [...vermogens].map(([sleutel, max_w]) => ({ sleutel, max_w }));
  }
  for (const veld of FASE_VELDEN) if (ruw[veld] !== undefined) velden[veld] = ampereUit(ruw[veld]);
  if (ruw.batterij_rol !== undefined) velden.batterij_rol = batterijRolUit(ruw.batterij_rol);
  // Op welke fase de zonnepanelen zitten (1.5.0, voor het verschil met de spanning van een driefase meter); null wist hem.
  if (ruw.zon_fase !== undefined) {
    if (ruw.zon_fase !== null && ![1, 2, 3].includes(ruw.zon_fase)) throw invoerFout();
    velden.zon_fase = ruw.zon_fase;
  }
  if (ruw.foto_uri !== undefined) {
    if (typeof ruw.foto_uri !== 'string' || ruw.foto_uri.length > 1000 || /\s/.test(ruw.foto_uri)) throw invoerFout();
    velden.foto_uri = ruw.foto_uri;
  }
  if (Object.keys(velden).length === 0) throw invoerFout();
  return velden;
}

/** Wat de site van een huis te zien krijgt. De sleutel (ook niet de hash) nooit; de leden alleen de eigenaar. */
function huisVoorSite(huis, rol) {
  return {
    id: huis.id,
    naam: huis.naam || 'Thuis',
    rol,
    eigenaar_email: emailVan(huis.eigenaar_email),
    // Wat er op afstand klaarstaat: welk veld en wanneer, nooit het versleutelde stuk zelf; en voor welk sleutelpaar (vastgezet).
    ...(rol === 'eigenaar' ? { leden: ledenVan(huis), op_afstand: opAfstandVoorSite(huis), publiek_vast: vastVan(huis), omvormer_sturen: sturenVoorSite(huis) } : {}),
  };
}

/**
 * Velden van Meting die nooit met de stand naar de site gaan: huis_id en storingen_open zijn
 * alleen voor de functies; kennis (programmaatje 1.4.0, wat elk apparaat teruggeeft) alleen
 * voor de beheerder, via overzicht.
 */
export const METING_INTERN = Object.freeze(['huis_id', 'storingen_open', 'kennis']);

/** Wat de site van een Meting krijgt: alles behalve METING_INTERN (base44/tests/entiteiten.test.js houdt het gelijk). */
export const METING_VELDEN = Object.freeze([
  'moment',
  'net_w',
  'net_bron',
  'net_zendure_w',
  'zon_w',
  'zonnen',
  'batterij_w',
  'batterij_procent',
  'batterij_info',
  'omvormer',
  'apparaten',
  'lampen',
  'bron',
  'prijs',
  'vandaag',
  'jaar',
  'fasen',
  'voorspelling',
  'weer',
  'dag',
  'gekoppeld',
  'brug',
  'herkend',
  'meterkast',
  'spanning',
]);

/**
 * De kennislijst uit de rij Meting (controle.js nam hem al na), voor de beheerder:
 * schoon, met alleen tekst die er al in hoorde. Geen lijst: null.
 */
export function kennisVoorBeheerder(k) {
  if (!k || typeof k !== 'object' || !Array.isArray(k.apparaten)) return null;
  const apparaten = k.apparaten
    .filter((a) => a && typeof a.sleutel === 'string' && Array.isArray(a.velden))
    .slice(0, 12)
    .map((a) => ({
      sleutel: a.sleutel,
      soort: typeof a.soort === 'string' ? a.soort : a.sleutel,
      datum: typeof a.datum === 'string' ? a.datum : null,
      velden: a.velden.filter((v) => typeof v === 'string').slice(0, 160),
    }));
  return apparaten.length ? { op: typeof k.op === 'string' ? k.op : null, apparaten } : null;
}

const kies = (rij, velden) => Object.fromEntries(velden.filter((v) => rij[v] !== undefined).map((v) => [v, rij[v]]));

/**
 * De meting voor de site. Een kijker hoeft niet te weten welk apparaat op welk
 * adres in de wifi van de eigenaar hangt, of welk serienummer het heeft: bij
 * gekoppeld gaat het adres eruit, en uit de meldingen van het programmaatje
 * en de namen gaan adressen en serienummers (afschermen.js). Bij herkend
 * (1.4.0): de eigenaar ziet welke vragen hij een week laat rusten, een kijker
 * krijgt geen vragen (herkendVoorSite). Zonder extra aanroep: de Huis-rij is er al.
 */
function metingVoor(rij, rol, huis = null, nu = Date.now()) {
  const meting = kies(rij, METING_VELDEN);
  if (meting.herkend) meting.herkend = herkendVoorSite(meting.herkend, { rol, uitgesteld: rol === 'eigenaar' ? uitgesteldVan(huis, nu) : new Set() });
  return rol === 'eigenaar' ? meting : metingVoorKijker(meting);
}

/**
 * Delen van de meting die groot zijn en maar eens per minuut of kwartier
 * veranderen. 'stand' geeft van elk een kenmerk mee; stuurt de site dat
 * kenmerk terug (heb), dan laat 'stand' dat deel weg en zegt dat in 'bekend'.
 * Een oude site stuurt niets en krijgt alles, zoals vroeger.
 */
export const ZWARE_DELEN = Object.freeze(['dag', 'voorspelling', 'weer', 'gekoppeld', 'herkend']);

async function zonderBekendeDelen(meting, heb) {
  const kenmerken = {};
  const bekend = [];
  for (const deel of ZWARE_DELEN) {
    if (meting[deel] === undefined || meting[deel] === null) continue;
    kenmerken[deel] = (await sha256Hex(JSON.stringify(meting[deel]))).slice(0, 16);
    if (heb && typeof heb === 'object' && heb[deel] === kenmerken[deel]) {
      delete meting[deel];
      bekend.push(deel);
    }
  }
  if (!Object.keys(kenmerken).length) return { meting };
  return bekend.length ? { meting, kenmerken, bekend } : { meting, kenmerken };
}

/** Van en tot van een periode: echte datums ("2026-10-26"), van niet na tot, hooguit HOOGSTENS_DAGEN dagen. */
function bereikUit(van, tot) {
  const begin = dagNummer(van);
  const einde = dagNummer(tot);
  if (begin === null || einde === null || begin > einde || einde - begin + 1 > HOOGSTENS_DAGEN) {
    throw new Fout(400, 'invoer', 'Deze periode klopt niet.');
  }
  return { van, tot };
}

/**
 * De dagen van een huis van `van` tot en met `tot`, op datum. Base44 zoekt het
 * bereik ($gte en $lte op datum; nooit $or op id), we bladeren stabiel op id
 * (zoals alleHuizen), en kijken het bereik hier nog eens na. Staat een dag er
 * door een vergissing twee keer, dan telt de oudste rij: die werkt
 * ontvangMeting bij. Hooguit HOOGSTENS_DAGEN dagen, in hooguit drie bladzijden.
 */
async function dagenVan(db, huisId, van, tot, { pagina = 200, max = HOOGSTENS_DAGEN } = {}) {
  const perDatum = new Map();
  const gezien = new Set();
  for (let vanaf = 0; vanaf < max + pagina; vanaf += pagina) {
    const groep = await db.Dag.filter({ huis_id: huisId, datum: { $gte: van, $lte: tot } }, 'id', pagina, vanaf);
    for (const rij of groep) {
      if (!rij?.id || gezien.has(rij.id)) continue;
      gezien.add(rij.id);
      if (rij.huis_id !== huisId || typeof rij.datum !== 'string' || rij.datum < van || rij.datum > tot) continue;
      if (!perDatum.has(rij.datum)) perDatum.set(rij.datum, rij);
    }
    if (groep.length < pagina) break;
  }
  return [...perDatum.values()].sort((a, b) => (a.datum < b.datum ? -1 : 1)).slice(0, max);
}

/** De opstelling van een huis: de oudste rij, bij lezen en schrijven dezelfde. */
async function opstellingVan(db, huisId) {
  const [rij] = await db.Opstelling.filter({ huis_id: huisId }, 'id', 1);
  return rij ?? null;
}

/** Een link naar de foto voor wie mag kijken; zonder link zien ze de tekening. */
async function fotoLinkOfNiets(bestanden, uri) {
  if (!uri) return null;
  try {
    return await bestanden.link(uri);
  } catch (e) {
    if (isRem(e)) throw e;
    console.error('huis: geen link naar de foto', e?.message ?? e);
    return null;
  }
}

/**
 * Een vast kenmerk van de foto: hetzelfde zolang het dezelfde foto is, ook al
 * is de link elke keer anders. Zo haalt de site hem alleen opnieuw als hij
 * veranderde. Uit de hash valt het adres van het bestand niet terug te halen.
 */
async function fotoIdOfNiets(uri) {
  return uri ? (await sha256Hex(`foto:${uri}`)).slice(0, 16) : null;
}

/**
 * Leesvragen die elke paar seconden terugkomen. Alleen hier mag de functie een
 * eerder antwoord van auth.me en de Huis-rij gebruiken (LEZEN_ONTHOUDEN_MS,
 * toegang.js), en geeft hij bij de rem sneller op: de site vraagt het toch zo
 * weer. Al het andere (maak, schrijven, beheren) toetst vers.
 */
const LEESVRAGEN = new Set(['stand', 'periode', 'logboek']);
/**
 * Wie er belt (auth.me per token) mag ook bij 'mijn' en 'opstelling' uit het
 * geheugen komen (prestaties-18, ronde 21): bij het openen van de app (stand,
 * mijn, opstelling) is dat één auth.me in plaats van drie. Ze lezen alleen; de
 * rechten toetsen ze elke keer zelf, op een verse lezing (alle huizen, of de
 * Huis-rij met huisVoor). Schrijven en beheren vragen altijd vers wie er belt.
 */
const WIE_ONTHOUDEN = new Set([...LEESVRAGEN, 'mijn', 'opstelling']);
/** Zoveel gebeurtenissen geeft 'logboek' hooguit: de laatste, op begin. */
export const LOGBOEK_AANTAL = 50;
/**
 * Zo lang delen twee schermen op hetzelfde huis één lezing van de Meting. Korter
 * dan de 5 s van het programmaatje, dus nooit een meting achter.
 */
export const METING_ONTHOUDEN_MS = 3000;

/**
 * De laatste Meting van een huis. Twee schermen op hetzelfde huis (en het
 * logboek) delen één lezing, METING_ONTHOUDEN_MS lang. De rechten toetst de
 * actie zelf, vóór deze vraag; alleen de rij wordt gedeeld.
 */
async function laatsteMeting(db, huisId, geheugen, nu) {
  const sleutel = `meting:${huisId}`;
  let rij = uitGeheugen(geheugen, sleutel, nu);
  if (rij === undefined) {
    [rij = null] = await db.Meting.filter({ huis_id: huisId }, '-updated_date', 1);
    onthoud(geheugen, sleutel, rij, METING_ONTHOUDEN_MS, nu);
  }
  return rij;
}

const ACTIES = {
  async mijn({ user, db, geheugen }) {
    const huizen = await alleHuizen(db);
    // De beheerder ziet ze allemaal; een gewone gebruiker precies zijn ene (toegang.js).
    const beheerder = isBeheerder(user);
    const eigen = beheerder ? null : eigenHuisUit(huizen, user);
    if (!beheerder) onthoudEigenHuis(user, eigen?.id ?? null, { geheugen });
    const mijne = (beheerder ? huizen : eigen ? [eigen] : [])
      .map((huis) => huisVoorSite(huis, rolIn(huis, user)))
      .sort((a, b) => a.naam.localeCompare(b.naam, 'nl'));
    return {
      gebruiker: { email: emailVan(user.email), naam: typeof user.full_name === 'string' ? user.full_name : '', beheerder },
      magMaken: magMaken(user),
      huizen: mijne,
    };
  },

  async maak({ invoer, user, db }) {
    const naam = naamUit(invoer.naam);
    if (!magMaken(user)) throw new Fout(403, 'alleenBeheerder', 'Alleen de beheerder van de app maakt omgevingen.');
    const huizen = await alleHuizen(db);
    if (huizen.filter((huis) => huis.eigenaar_id === user.id).length >= HOOGSTENS_EIGEN_HUIZEN) {
      throw new Fout(409, 'teVeel', `Je hebt al ${HOOGSTENS_EIGEN_HUIZEN} omgevingen; meer kan niet.`);
    }
    const sleutel = maakSleutel();
    const huis = await db.Huis.create({
      naam,
      // Zelf invullen: met de rol van de server is het serveraccount de maker, niet deze persoon.
      eigenaar_id: user.id,
      eigenaar_email: emailVan(user.email),
      leden: [],
      brug_sleutel_hash: await sha256Hex(sleutel),
    });
    return { huis: huisVoorSite(huis, 'eigenaar'), sleutel };
  },

  async stand({ invoer, user, db, geheugen, nu }) {
    const { huis, rol } = await huisVoor(db, user, invoer.huis_id, { onthouden: true, geheugen, nu });
    const rij = await laatsteMeting(db, huis.id, geheugen, nu);
    if (!rij) return { meting: null };
    return zonderBekendeDelen(metingVoor(rij, rol, huis, nu), invoer.heb);
  },

  /** De dagen van een week, maand, kwartaal of jaar: wie de stand mag zien, mag ook dit (dezelfde huisVoor). */
  async periode({ invoer, user, db, geheugen, nu }) {
    const { huis } = await huisVoor(db, user, invoer.huis_id, { onthouden: true, geheugen, nu });
    const { van, tot } = bereikUit(invoer.van, invoer.tot);
    const dagen = await dagenVan(db, huis.id, van, tot);
    return { van, tot, dagen: dagen.map((rij) => kies(rij, DAG_VELDEN)) };
  },

  /**
   * Het logboek van storingen (tabel Gebeurtenis, ontvangMeting schrijft het):
   * de laatste LOGBOEK_AANTAL, nieuwste eerst. Wie de stand mag zien, mag ook
   * dit (dezelfde huisVoor). `loopt`: staat nu nog open volgens de laatste
   * meting; zonder einde en niet meer open is het einde onbekend.
   */
  async logboek({ invoer, user, db, geheugen, nu }) {
    const { huis, rol } = await huisVoor(db, user, invoer.huis_id, { onthouden: true, geheugen, nu });
    const rijen = await db.Gebeurtenis.filter({ huis_id: huis.id }, '-begin', LOGBOEK_AANTAL);
    // Een kijker ook hier zonder adressen en serienummers: de tekst komt uit de meldingen van het programmaatje.
    const tekst = (wat) => (rol === 'eigenaar' ? wat : zonderAdressen(wat));
    const meting = await laatsteMeting(db, huis.id, geheugen, nu);
    const open = new Set((Array.isArray(meting?.storingen_open) ? meting.storingen_open : []).map((o) => o?.id));
    return {
      gebeurtenissen: rijen
        .filter((r) => r?.id && r.huis_id === huis.id && typeof r.begin === 'string')
        // Het begrenzen van de omvormer (1.5.0) is voor de eigenaar.
        .filter((r) => rol === 'eigenaar' || !(typeof r.sleutel === 'string' && r.sleutel.startsWith(LOGBOEK_VOORVOEGSEL)))
        .map((r) => ({
          id: r.id,
          sleutel: typeof r.sleutel === 'string' ? r.sleutel : '',
          soort: typeof r.soort === 'string' ? r.soort : '',
          wat: typeof r.wat === 'string' ? tekst(r.wat) : '',
          begin: r.begin,
          eind: typeof r.eind === 'string' && r.eind ? r.eind : null,
          loopt: !r.eind && open.has(r.id),
        })),
    };
  },

  /**
   * Alle omgevingen met de kern van nu, voor de beheerder (Instellingen ›
   * Account): zon, batterij, net, hoe oud de laatste meting is, de brugversie
   * en wat er open staat in het logboek. Eén keer Huis en één keer Meting voor
   * alles samen, niet per huis; de site vraagt het hooguit eens per 30 s, alleen
   * met dat scherm open. Eerst de rechten: een ander leest niets.
   */
  async overzicht({ user, db }) {
    alleenBeheerder(user);
    const huizen = await alleHuizen(db);
    const ids = huizen.map((h) => h.id);
    // Per huis één rij Meting (oude rijen zonder huis doen niet mee); ruim genoeg voor een paar dubbele.
    const rijen = ids.length ? await db.Meting.filter({ huis_id: { $in: ids } }, '-updated_date', Math.min(1000, ids.length * 3 + 10)) : [];
    const perHuis = new Map();
    for (const rij of rijen) if (rij?.huis_id && !perHuis.has(rij.huis_id)) perHuis.set(rij.huis_id, rij);
    const getal = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    return {
      huizen: huizen
        .map((huis) => {
          const rij = perHuis.get(huis.id);
          return {
            id: huis.id,
            naam: huis.naam || 'Thuis',
            eigenaar_email: emailVan(huis.eigenaar_email),
            meting: rij
              ? {
                  moment: typeof rij.moment === 'string' ? rij.moment : null,
                  zon_w: getal(rij.zon_w),
                  batterij_w: getal(rij.batterij_w),
                  batterij_procent: getal(rij.batterij_procent),
                  net_w: getal(rij.net_w),
                  brug_versie: typeof rij.brug?.versie === 'string' ? rij.brug.versie : null,
                  storingen: (Array.isArray(rij.storingen_open) ? rij.storingen_open : [])
                    .filter((o) => o && typeof o.wat === 'string')
                    .map((o) => ({ soort: o.soort, sleutel: o.sleutel, wat: o.wat, begin: o.begin })),
                  // Wat elk apparaat teruggeeft (programmaatje 1.4.0): alleen hier, alleen de beheerder.
                  ...(kennisVoorBeheerder(rij.kennis) ? { kennis: kennisVoorBeheerder(rij.kennis) } : {}),
                }
              : null,
          };
        })
        .sort((a, b) => a.naam.localeCompare(b.naam, 'nl')),
    };
  },

  async opstelling({ invoer, user, db, bestanden, geheugen }) {
    const { huis, rol } = await huisVoor(db, user, invoer.huis_id, { geheugen });
    const rij = await opstellingVan(db, huis.id);
    return {
      rol,
      opstelling: rij ? kies(rij, ['tekening', 'punten', 'verborgen', 'namen', 'vermogens', ...FASE_VELDEN, 'batterij_rol', 'gas_standen', 'zon_fase']) : null,
      foto_url: await fotoLinkOfNiets(bestanden, rij?.foto_uri),
      foto_id: await fotoIdOfNiets(rij?.foto_uri),
    };
  },

  async bewaarOpstelling({ invoer, user, db, bestanden, geheugen }) {
    const { huis } = await huisVoor(db, user, invoer.huis_id, { alleenEigenaar: true, geheugen });
    const velden = opstellingUit(invoer.opstelling);
    // Alleen een foto die de eigenaar zelf kan openen. Anders zou de link die
    // de server maakt (met zijn eigen rol) een andermans bestand openen.
    if (velden.foto_uri && !(await bestanden.vanJou(velden.foto_uri))) {
      throw new Fout(400, 'foto', 'Die foto kan ik niet vinden. Kies hem nog eens.');
    }
    const rij = await opstellingVan(db, huis.id);
    if (rij) await db.Opstelling.update(rij.id, velden);
    else await db.Opstelling.create({ huis_id: huis.id, ...velden });
    return velden.foto_uri === undefined ? { ok: true } : { ok: true, foto_url: await fotoLinkOfNiets(bestanden, velden.foto_uri), foto_id: await fotoIdOfNiets(velden.foto_uri) };
  },

  /**
   * Een gasmeterstand erbij (invoer.stand = { datum, stand }) of eraf (invoer.verwijder = datum),
   * voor een huis waar de P1-meter het gas niet doorgeeft (of als controle). Alleen de eigenaar;
   * de rij Opstelling vers gelezen vlak voor het schrijven, en alleen het veld gas_standen
   * geschreven (base44/shared/gas.js kijkt het na: oplopend, hooguit 400).
   */
  async gasStand({ invoer, user, db, geheugen, nu }) {
    const { huis } = await huisVoor(db, user, invoer.huis_id, { alleenEigenaar: true, geheugen });
    let gas_standen;
    try {
      const rij = await opstellingVan(db, huis.id);
      const oud = gasStandenUit(rij?.gas_standen);
      gas_standen = invoer.verwijder !== undefined ? zonderGasStand(oud, invoer.verwijder) : metGasStand(oud, gasStandUit(invoer.stand, nu));
      if (rij) await db.Opstelling.update(rij.id, { gas_standen });
      else await db.Opstelling.create({ huis_id: huis.id, gas_standen });
    } catch (fout) {
      if (fout instanceof GasFout) throw invoerFout(fout.message);
      throw fout;
    }
    return { gas_standen };
  },

  async uitnodigen({ invoer, user, db, geheugen }) {
    const { huis } = await huisVoor(db, user, invoer.huis_id, { alleenEigenaar: true, geheugen });
    const email = emailUit(invoer.email);
    if (email === emailVan(huis.eigenaar_email) || email === emailVan(user.email)) {
      throw new Fout(400, 'zelf', 'Dat ben je zelf: jij hoort er als eigenaar al bij.');
    }
    const leden = ledenVan(huis);
    if (leden.some((lid) => lid.email === email)) throw new Fout(409, 'dubbel', `${email} kijkt al mee.`);
    // Iemand hoort bij één omgeving (alleen de beheerder ziet ze allemaal).
    const elders = (await alleHuizen(db)).some(
      (ander) => ander.id !== huis.id && (emailVan(ander.eigenaar_email) === email || ledenVan(ander).some((lid) => lid.email === email)),
    );
    if (elders) {
      throw new Fout(409, 'alElders', `${email} hoort al bij een andere omgeving. Iemand kan maar bij één omgeving horen; haal hem daar eerst weg.`);
    }
    if (leden.length >= HOOGSTENS_LEDEN) throw new Fout(409, 'vol', `Er kunnen hooguit ${HOOGSTENS_LEDEN} mensen meekijken.`);
    const nieuw = [...leden, { email }];
    await db.Huis.update(huis.id, { leden: nieuw });
    return { leden: nieuw };
  },

  async verwijderLid({ invoer, user, db, geheugen }) {
    const { huis } = await huisVoor(db, user, invoer.huis_id, { alleenEigenaar: true, geheugen });
    const email = emailUit(invoer.email);
    const leden = ledenVan(huis);
    const nieuw = leden.filter((lid) => lid.email !== email);
    if (nieuw.length !== leden.length) await db.Huis.update(huis.id, { leden: nieuw });
    return { leden: nieuw };
  },

  async nieuweSleutel({ invoer, user, db, geheugen }) {
    const { huis } = await huisVoor(db, user, invoer.huis_id, { alleenEigenaar: true, geheugen });
    const sleutel = maakSleutel();
    await db.Huis.update(huis.id, { brug_sleutel_hash: await sha256Hex(sleutel) });
    return { sleutel };
  },

  /**
   * Een geheim voor het programmaatje thuis klaarzetten, al versleuteld in de
   * browser met het publieke deel van dat programmaatje (opAfstand.js). De
   * server kan het niet lezen en geeft het alleen aan dat programmaatje mee.
   * De eerste keer zet hij het sleutelpaar vast; een ander paar alleen als de
   * eigenaar die vingerafdruk bevestigt (nieuw_paar), anders 409 anderPaar.
   */
  async zetOpAfstand({ invoer, user, db, geheugen, nu }) {
    const { huis } = await huisVoor(db, user, invoer.huis_id, { alleenEigenaar: true, geheugen });
    if (!veldVorm(invoer.veld)) throw invoerFout('Dit kan niet op afstand.');
    const pakket = pakketUit(invoer.pakket);
    if (!pakket) throw invoerFout('Dit versleutelde stuk klopt niet. Laad de app opnieuw en probeer het nog eens.');
    const op = new Date(nu).toISOString();
    const paar = paarVoorKlaarzetten(huis, pakket, invoer.nieuw_paar, op);
    if (!paar.ok) {
      throw new Fout(
        409,
        'anderPaar',
        `Het programmaatje meldt een ander sleutelpaar (${kortAfdruk(pakket.voor)}) dan eerst (${kortAfdruk(paar.vast)}). Laad de app opnieuw, vergelijk de vingerafdruk met node brug.mjs proef op het toestel en bevestig hem.`,
      );
    }
    const op_afstand = metVeld(huis, invoer.veld, pakket, op);
    await db.Huis.update(huis.id, { op_afstand, ...paar.vast });
    return { op_afstand: opAfstandVoorSite({ op_afstand }), publiek_vast: paar.vast.brug_publiek_vast ?? vastVan(huis) };
  },

  async wisOpAfstand({ invoer, user, db, geheugen }) {
    const { huis } = await huisVoor(db, user, invoer.huis_id, { alleenEigenaar: true, geheugen });
    if (!veldVorm(invoer.veld)) throw invoerFout();
    const op_afstand = metVeld(huis, invoer.veld, null);
    await db.Huis.update(huis.id, { op_afstand });
    return { op_afstand: opAfstandVoorSite({ op_afstand }) };
  },

  /**
   * Een label voor het herkennen van apparaten: "Klopt" (soort = wat we zeiden)
   * of "Dat was …" (een andere soort, of een eigen naam), voor één gebeurtenis
   * of een hele groep onbekenden (aantal); of op een vraag "Weet ik niet" of
   * "Later" ({ id, later: true }, 1.4.0: een week niet vragen, het programmaatje
   * merkt er niets van). Alleen de eigenaar; vers gelezen vlak
   * voor het schrijven. Het programmaatje krijgt de labels terug via
   * ontvangMeting (hooguit LEZEN_ONTHOUDEN_MS later). Bedient niets.
   */
  async labelHerkend({ invoer, user, db, geheugen, nu }) {
    const { huis } = await huisVoor(db, user, invoer.huis_id, { alleenEigenaar: true, geheugen });
    const label = labelUit(invoer.label);
    if (!label) throw invoerFout('Dit label klopt niet. Kies een soort, of typ een naam bij "Iets anders".');
    const herkend_labels = metLabel(huis, label, new Date(nu).toISOString());
    await db.Huis.update(huis.id, { herkend_labels });
    return { ok: true, aantal: herkend_labels.length };
  },

  /**
   * De omvormer begrenzen als terugleveren geld kost (programmaatje 1.5.0): aan of uit, een dag
   * niet, "Nu weer aan", of netto afnemer/terugleveraar. Alleen de eigenaar; de Huis-rij vers
   * gelezen vlak voor het schrijven, alleen het veld omvormer_sturen geschreven. Bedient zelf
   * niets: het programmaatje hoort het bij de volgende meting (hooguit LEZEN_ONTHOUDEN_MS later).
   */
  async omvormerSturen({ invoer, user, db, geheugen, nu }) {
    const { huis } = await huisVoor(db, user, invoer.huis_id, { alleenEigenaar: true, geheugen });
    let omvormer_sturen;
    try {
      omvormer_sturen = wijzigSturen(huis, invoer, nu);
    } catch (fout) {
      if (fout instanceof SturenFout) throw invoerFout(fout.message);
      throw fout;
    }
    await db.Huis.update(huis.id, { omvormer_sturen });
    return { omvormer_sturen: sturenVoorSite({ omvormer_sturen }) };
  },

  async hernoem({ invoer, user, db, geheugen }) {
    const { huis } = await huisVoor(db, user, invoer.huis_id, { alleenEigenaar: true, geheugen });
    const naam = naamUit(invoer.naam);
    await db.Huis.update(huis.id, { naam });
    return { huis: huisVoorSite({ ...huis, naam }, 'eigenaar') };
  },
};

export const ACTIE_NAMEN = Object.freeze(Object.keys(ACTIES));

/** Bestanden: een link voor wie mag kijken (rol van de server), en of de eigenaar de foto zelf kan openen. */
function bestandenVan(base44, geduld) {
  const link = async (client, uri, seconden) =>
    (await metGeduld(() => client.integrations.Core.CreateFileSignedUrl({ file_uri: uri, expires_in: seconden }), geduld))?.signed_url || null;
  return {
    link: (uri) => link(base44.asServiceRole, uri, 3600),
    async vanJou(uri) {
      try {
        return Boolean(await link(base44, uri, 60));
      } catch (e) {
        // Geweigerd of onbekend: niet van jou. Iets anders (Base44 stuk, de rem) is geen antwoord.
        if ([400, 403, 404].includes(statusVan(e))) return false;
        throw e;
      }
    },
  };
}

/** Per isolate: welke omgeving van wie is, de Huis-rijen, auth.me per token en de laatste Meting (toegang.js). */
const GEHEUGEN = new Map();

/**
 * Wie belt er: { user } of een kant-en-klaar antwoord (429, 503). Hooguit
 * HOOGSTENS_PER_TOKEN keer per token per venster (toegang.js), daarboven 429
 * zonder auth.me.
 */
async function wieBelt(base44, geduld, { geheugen, tokenHash, nu }) {
  if (!inEmmer(geheugen, `emmer-me:${tokenHash}`, HOOGSTENS_PER_TOKEN, nu)) return { antwoord: remAntwoord() };
  try {
    return { user: await metGeduld(() => base44.auth.me(), geduld) };
  } catch (e) {
    if (isRem(e)) return { antwoord: remAntwoord() };
    const status = statusVan(e);
    if (status === null || status >= 500) {
      console.error('huis: wie belt er?', e?.message ?? e);
      return { antwoord: antwoord({ error: 'Base44 is even niet bereikbaar. Probeer het zo nog eens.', code: 'fout' }, 503) };
    }
    return { user: null };
  }
}

/**
 * Eén verzoek aan de functie huis.
 * @param {Request} req
 * @param {(req: Request) => any} maakClient  createClientFromRequest, of een nep in de tests
 * @param {{ geduld?: object, geheugen?: Map, klok?: () => number }} [opties]  geheugen: wat de functie onthoudt (toegang.js); de tests geven een lege
 */
export async function behandelHuis(req, maakClient, { geduld, geheugen = GEHEUGEN, klok = Date.now } = {}) {
  if (req.method !== 'POST') return antwoord({ error: 'Alleen POST' }, 405);
  // Zonder token kan het alleen 401 worden: dan ook geen aanroep naar Base44 (de rem geldt per app).
  const token = req.headers.get('Authorization');
  if (!token) return antwoord({ error: 'Log eerst in.', code: 'inloggen' }, 401);

  const nu = klok();
  let base44;
  try {
    base44 = maakClient(req);
  } catch (e) {
    console.error('huis: wie belt er?', e?.message ?? e);
    return antwoord({ error: 'Base44 is even niet bereikbaar. Probeer het zo nog eens.', code: 'fout' }, 503);
  }
  // Een bekend token (van een eerdere leesvraag, mijn of opstelling) hoeft niet elke 5 s langs auth.me.
  const tokenHash = await sha256Hex(token);
  const meSleutel = `me:${tokenHash}`;
  let user = uitGeheugen(geheugen, meSleutel, nu) ?? null;
  const onthouden = Boolean(user);
  if (!onthouden) {
    // Een token dat net niets opleverde: meteen 401. Te veel onbekende tokens achter elkaar: 429. Allebei zonder auth.me (toegang.js).
    const poort = voorOpzoeken(geheugen, 'token', tokenHash, nu);
    if (poort === 'onbekend') return antwoord({ error: 'Log eerst in.', code: 'inloggen' }, 401);
    if (poort === 'vol') return remAntwoord();
    const wie = await wieBelt(base44, geduld, { geheugen, tokenHash, nu });
    if (wie.antwoord) return wie.antwoord;
    user = wie.user;
    naOpzoeken(geheugen, 'token', tokenHash, Boolean(user?.id), nu);
  }
  if (!user?.id) return antwoord({ error: 'Log eerst in.', code: 'inloggen' }, 401);
  if (!magInDeApp(user)) {
    return antwoord({ error: 'Dit account staat uit. Vraag de beheerder van de app.', code: 'uitgeschakeld' }, 403);
  }

  let invoer;
  try {
    invoer = await req.json();
  } catch {
    invoer = null;
  }
  if (!invoer || typeof invoer !== 'object' || Array.isArray(invoer)) return antwoord({ error: 'Deze vraag klopt niet.', code: 'invoer' }, 400);
  if (typeof invoer.actie !== 'string' || !Object.hasOwn(ACTIES, invoer.actie)) {
    return antwoord({ error: 'Deze vraag kent de functie (nog) niet.', code: 'onbekendeActie' }, 400);
  }

  const lezen = LEESVRAGEN.has(invoer.actie);
  const wieOnthouden = WIE_ONTHOUDEN.has(invoer.actie);
  if (onthouden && !wieOnthouden) {
    // Alleen wat leest (WIE_ONTHOUDEN) mag voor wie er belt op het geheugen leunen; al het andere vraagt het vers.
    const wie = await wieBelt(base44, geduld, { geheugen, tokenHash, nu });
    if (wie.antwoord) return wie.antwoord;
    user = wie.user;
    if (!user?.id) {
      // Het token geldt niet meer: ook de leesvragen niet langer op het geheugen laten leunen.
      geheugen.delete(meSleutel);
      naOpzoeken(geheugen, 'token', tokenHash, false, nu);
      return antwoord({ error: 'Log eerst in.', code: 'inloggen' }, 401);
    }
    if (!magInDeApp(user)) {
      return antwoord({ error: 'Dit account staat uit. Vraag de beheerder van de app.', code: 'uitgeschakeld' }, 403);
    }
  }
  if (wieOnthouden && !onthouden) onthoud(geheugen, meSleutel, user, LEZEN_ONTHOUDEN_MS, nu);

  try {
    // Een leesvraag geeft bij de rem sneller op: de site vraagt hem zo toch weer.
    const metRem = lezen ? { ...geduld, wachten: GEDULD_LEZEN } : geduld;
    const db = tabellen(base44.asServiceRole.entities, metRem);
    return antwoord(await ACTIES[invoer.actie]({ invoer, user, db, bestanden: bestandenVan(base44, geduld), geheugen, nu }));
  } catch (e) {
    if (e instanceof Fout) return antwoord({ error: e.message, code: e.code }, e.status);
    if (isRem(e)) return remAntwoord();
    console.error(`huis/${invoer.actie}: mislukt`, e?.message ?? e);
    return antwoord({ error: 'Er ging iets mis bij Base44. Probeer het zo nog eens.', code: 'fout' }, 500);
  }
}
