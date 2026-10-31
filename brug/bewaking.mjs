import fs from 'node:fs';

/**
 * Kleine hulpjes om het programmaatje weken achter elkaar te laten draaien:
 * een logboek met datum dat zichzelf klein houdt, een meter die pas na een
 * paar gemiste lezingen "weg" is, en een klok die eerst moet kloppen.
 */

const TIJD = new Intl.DateTimeFormat('nl-NL', {
  timeZone: 'Europe/Amsterdam',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** '30-10 10:37:29', altijd in Nederlandse tijd (net als de rest van het programmaatje), wat de telefoon ook zegt. */
export function tijdstempel(ms) {
  const d = Object.fromEntries(TIJD.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return `${d.day}-${d.month} ${d.hour}:${d.minute}:${d.second}`;
}

/** Boven 1 MB gaat het logboek opzij (brug.log.1), ook terwijl het programmaatje draait. */
export const LOG_HOOGSTENS = 1_000_000;

/**
 * Houdt het logboek klein. start.sh schrijft met >> (O_APPEND) naar brug.log;
 * is dat een gewoon bestand boven de grens, dan gaat een kopie naar brug.log.1
 * en begint brug.log weer leeg (node schrijft daarna gewoon vooraan verder).
 * Geen bestand (een terminal, systemd): niets. Geeft true als het opzij ging.
 */
export function houdLogKlein({ fd = 1, hoogstens = LOG_HOOGSTENS, pad = null } = {}) {
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size <= hoogstens) return false;
    const bestand = pad ?? fs.readlinkSync(`/proc/self/fd/${fd}`);
    fs.copyFileSync(bestand, `${bestand}.1`);
    fs.ftruncateSync(fd, 0);
    return true;
  } catch {
    return false;
  }
}

/** Na zoveel gemiste lezingen op rij telt een apparaat als weg (in het logboek en in de app). */
export const WEG_NA_KEER = 3;

/**
 * Houdt per apparaat bij hoe vaak het op rij niet antwoordde. Eén gemiste
 * lezing bij zwak wifi geeft zo geen regel in het logboek en laat de app
 * niet heen en weer springen; eens per uur een samenvatting.
 */
export function maakMissers({ drempel = WEG_NA_KEER } = {}) {
  const opRij = new Map();
  const ditUur = new Map();
  return {
    /** Weer een gemiste lezing; geeft true als hij vanaf nu als weg telt. */
    mis(sleutel) {
      const keer = (opRij.get(sleutel) ?? 0) + 1;
      opRij.set(sleutel, keer);
      ditUur.set(sleutel, (ditUur.get(sleutel) ?? 0) + 1);
      return keer >= drempel;
    },
    /** Weer een goede lezing; geeft true als hij weg was. */
    goed(sleutel) {
      const was = (opRij.get(sleutel) ?? 0) >= drempel;
      opRij.delete(sleutel);
      return was;
    },
    /** Per apparaat hoe vaak het het afgelopen uur niet antwoordde (vanaf de drempel), en weer van voren af aan. */
    samenvatting() {
      const uit = [...ditUur.entries()].filter(([, keer]) => keer >= drempel);
      ditUur.clear();
      return uit;
    },
  };
}

/** De dag waarop deze versie gemaakt is: een klok daarvoor klopt zeker niet. */
export const BOUWDATUM = Date.UTC(2026, 9, 30);
/** Hooguit zo lang wachten op een klok die na de laatste bewaarde stand ligt (die kan zelf fout zijn geweest). */
export const KLOK_WACHT_HOOGSTENS_MS = 60 * 60_000;

/**
 * Klopt de klok van de telefoon? Niet vóór de bouwdatum, en niet (veel) vóór
 * het moment waarop vandaag.json het laatst bewaard is. Na een lege accu
 * start een telefoon soms in 1970 of een dag terug, tot hij internet heeft.
 */
export function klokKlopt(nu, bewaardOp, { bouw = BOUWDATUM } = {}) {
  if (!Number.isFinite(nu) || nu < bouw) return false;
  return !Number.isFinite(bewaardOp) || nu >= bewaardOp - 60_000;
}

/**
 * Springt de klok tijdens het draaien terug? Geeft { terug, hoogste }: zolang
 * hij duidelijk vóór het hoogste moment staat, telt er niets (de dag en het
 * jaar blijven zoals ze waren). Na `geduld` ms geloven we de nieuwe tijd toch.
 */
export function volgKlok(staat, nu, { speling = 2 * 60_000, geduld = KLOK_WACHT_HOOGSTENS_MS } = {}) {
  const hoogste = staat?.hoogste ?? nu;
  if (nu >= hoogste - speling) return { terug: false, hoogste: Math.max(hoogste, nu), sinds: null };
  const sinds = staat?.sinds ?? nu;
  if (nu - sinds >= geduld || sinds - nu > geduld) return { terug: false, hoogste: nu, sinds: null };
  return { terug: true, hoogste, sinds };
}

/** Wanneer het bestand het laatst veranderde (ms), of null. */
export function gewijzigdOp(pad) {
  try {
    return fs.statSync(pad).mtimeMs;
  } catch {
    return null;
  }
}
