import crypto from 'node:crypto';
import dgram from 'node:dgram';
import net from 'node:net';

/**
 * Tuya-apparaten (Smart Life / Tuya Smart) lokaal uitlezen: een
 * meetschakelaar (in huis A de pomp), lampen en schakelaars. ALLEEN LEZEN: we
 * vragen alleen de stand (DP_QUERY). Er gaat nooit een opdracht naar een
 * apparaat; het enige wat we sturen staat in MAG_STUREN.
 *
 * Bronnen (zie ook docs/tuya.md): tinytuya (jasonacox/tinytuya, core/*.py)
 * en TuyAPI (codetheweb/tuyapi, lib/cipher.js). De tests nemen echte
 * opnames en frames die met tinytuya zelf gemaakt zijn (brug/tuya.test.js).
 *
 * Per apparaat: adres (in de wifi), id, local_key (16 tekens, uit de
 * Tuya-cloud; zie tuyaCloud.mjs) en versie:
 *
 *   3.3  55AA-frame met CRC32; de data AES-128-ECB met de local_key
 *   3.4  eerst een sessiesleutel; 55AA-frame met HMAC-SHA256; AES-128-ECB
 *   3.5  eerst een sessiesleutel; 6699-frame met AES-128-GCM
 *
 * Sessiesleutel (3.4 en 3.5): wij sturen een eigen nonce (cmd 3), het
 * apparaat antwoordt met zijn nonce en een HMAC van de onze (cmd 4; klopt die
 * niet, dan is de local_key fout), wij bevestigen met een HMAC van de zijne
 * (cmd 5). Sleutel = onze nonce XOR de zijne, versleuteld met de local_key
 * (3.4: ECB; 3.5: GCM met de eerste 12 bytes van onze nonce als iv).
 */

export const TUYA_POORT = 6668;
export const VERSIES = ['3.3', '3.4', '3.5'];

/** De commando's (tinytuya core/command_types.py). */
export const CMD = Object.freeze({ SESSIE_START: 3, SESSIE_ANTWOORD: 4, SESSIE_KLAAR: 5, STATUS: 8, HARTSLAG: 9, DP_QUERY: 0x0a, DP_QUERY_NEW: 0x10 });

/**
 * Alleen deze gaan ooit van ons naar een apparaat: de sessiesleutel
 * afspreken en de stand vragen. Schakelen (7, CONTROL; 0x0d, CONTROL_NEW) of
 * instellen kan dus niet, ook niet per ongeluk.
 */
export const MAG_STUREN = Object.freeze(new Set([CMD.SESSIE_START, CMD.SESSIE_KLAAR, CMD.DP_QUERY, CMD.DP_QUERY_NEW]));

const VOOR_55 = 0x000055aa;
const NA_55 = 0x0000aa55;
const VOOR_66 = 0x00006699;
const NA_66 = 0x00009966;
/** Groter is geen Tuya-bericht (tinytuya MAX_PAYLOAD_LENGTH is 1440; ruim). */
const HOOGSTENS_BERICHT = 8192;

/* ---------- Rekenen ---------- */

const CRC_TABEL = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC32 zoals zlib (Node 20 heeft zlib.crc32 nog niet overal). */
export function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABEL[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const hmac = (sleutel, data) => crypto.createHmac('sha256', sleutel).update(data).digest();

export function ecbVersleutel(sleutel, data, { opvullen = true } = {}) {
  const c = crypto.createCipheriv('aes-128-ecb', sleutel, null);
  c.setAutoPadding(opvullen);
  return Buffer.concat([c.update(data), c.final()]);
}

/** Ontsleutelen en de opvulling eraf, mild zoals tinytuya (1 tot 16, zonder de bytes zelf na te lopen). */
export function ecbOntsleutel(sleutel, data) {
  if (data.length === 0 || data.length % 16 !== 0) throw new Error('het antwoord is niet te ontsleutelen (lengte)');
  const c = crypto.createDecipheriv('aes-128-ecb', sleutel, null);
  c.setAutoPadding(false);
  const ruw = Buffer.concat([c.update(data), c.final()]);
  const vul = ruw[ruw.length - 1];
  if (vul < 1 || vul > 16) throw new Error('het antwoord is niet te ontsleutelen (verkeerde sleutel?)');
  return ruw.subarray(0, ruw.length - vul);
}

function gcmVersleutel(sleutel, iv, data, aad) {
  const c = crypto.createCipheriv('aes-128-gcm', sleutel, iv);
  if (aad) c.setAAD(aad);
  const tekst = Buffer.concat([c.update(data), c.final()]);
  return { tekst, tag: c.getAuthTag() };
}

/* ---------- Frames ---------- */

/**
 * Een 55AA-frame (3.3 en 3.4) zoals wij het sturen: zonder retcode. Met
 * hmacSleutel (3.4) een HMAC-SHA256 van 32 bytes, anders een CRC32.
 */
export function maakFrame55({ seqno, cmd, data, hmacSleutel = null }) {
  if (!MAG_STUREN.has(cmd)) throw new Error(`commando ${cmd} sturen we nooit (alleen lezen)`);
  const eind = hmacSleutel ? 32 : 4;
  const kop = Buffer.alloc(16);
  kop.writeUInt32BE(VOOR_55, 0);
  kop.writeUInt32BE(seqno >>> 0, 4);
  kop.writeUInt32BE(cmd, 8);
  kop.writeUInt32BE(data.length + eind + 4, 12);
  const romp = Buffer.concat([kop, data]);
  let controle;
  if (hmacSleutel) {
    controle = hmac(hmacSleutel, romp);
  } else {
    controle = Buffer.alloc(4);
    controle.writeUInt32BE(crc32(romp), 0);
  }
  const staart = Buffer.alloc(4);
  staart.writeUInt32BE(NA_55, 0);
  return Buffer.concat([romp, controle, staart]);
}

/** Een 6699-frame (3.5): AES-128-GCM met de 14 bytes kop na het voorvoegsel als AAD. */
export function maakFrame66({ seqno, cmd, data, sleutel, iv = crypto.randomBytes(12) }) {
  if (!MAG_STUREN.has(cmd)) throw new Error(`commando ${cmd} sturen we nooit (alleen lezen)`);
  const kop = Buffer.alloc(18);
  kop.writeUInt32BE(VOOR_66, 0);
  kop.writeUInt16BE(0, 4);
  kop.writeUInt32BE(seqno >>> 0, 6);
  kop.writeUInt32BE(cmd, 10);
  kop.writeUInt32BE(12 + data.length + 16, 14);
  const { tekst, tag } = gcmVersleutel(sleutel, iv, data, kop.subarray(4));
  const staart = Buffer.alloc(4);
  staart.writeUInt32BE(NA_66, 0);
  return Buffer.concat([kop, iv, tekst, tag, staart]);
}

/**
 * Hele frames uit wat er binnenkwam. Rommel vóór een voorvoegsel valt weg
 * (zoals tinytuya). Geeft { frames: Buffer[], rest }; rest wacht op meer.
 */
export function knipFrames(buffer) {
  const frames = [];
  let rest = buffer;
  for (;;) {
    const a = rest.indexOf(Buffer.from([0, 0, 0x55, 0xaa]));
    const b = rest.indexOf(Buffer.from([0, 0, 0x66, 0x99]));
    const begin = a === -1 ? b : b === -1 ? a : Math.min(a, b);
    if (begin === -1) return { frames, rest: rest.subarray(Math.max(0, rest.length - 3)) };
    rest = rest.subarray(begin);
    const is66 = rest.readUInt32BE(0) === VOOR_66;
    const kop = is66 ? 18 : 16;
    if (rest.length < kop) return { frames, rest };
    const lengte = rest.readUInt32BE(is66 ? 14 : 12);
    if (lengte > HOOGSTENS_BERICHT) throw new Error('het apparaat stuurt iets wat geen Tuya-bericht is');
    const totaal = kop + lengte + (is66 ? 4 : 0);
    if (rest.length < totaal) return { frames, rest };
    frames.push(rest.subarray(0, totaal));
    rest = rest.subarray(totaal);
  }
}

/**
 * Een 55AA-frame van een apparaat: met retcode (4 bytes) na de kop. Met
 * hmacSleutel (3.4) een HMAC, anders een CRC32. Geeft { seqno, cmd, retcode, data, klopt }.
 */
export function ontleedFrame55(frame, { hmacSleutel = null } = {}) {
  if (frame.length < 24 || frame.readUInt32BE(0) !== VOOR_55) throw new Error('geen 55AA-bericht');
  const seqno = frame.readUInt32BE(4);
  const cmd = frame.readUInt32BE(8);
  const lengte = frame.readUInt32BE(12);
  const eind = hmacSleutel ? 32 : 4;
  if (frame.length !== 16 + lengte || lengte < 4 + eind + 4) throw new Error('het bericht is te kort');
  const romp = frame.subarray(0, frame.length - eind - 4);
  const controle = frame.subarray(frame.length - eind - 4, frame.length - 4);
  const klopt = hmacSleutel ? crypto.timingSafeEqual(hmac(hmacSleutel, romp), controle) : crc32(romp) === controle.readUInt32BE(0);
  return { seqno, cmd, retcode: frame.readUInt32BE(16), data: frame.subarray(20, frame.length - eind - 4), klopt };
}

/**
 * Een 6699-frame (3.5): ontsleutelen met GCM. De data van een apparaat
 * begint met een retcode; bij een UDP-melding soms niet (retcode: 'raden').
 * Klopt de tag niet (verkeerde sleutel, kapot bericht), dan klopt: false en geen data.
 */
export function ontleedFrame66(frame, sleutel, { retcode = true } = {}) {
  if (frame.length < 18 + 12 + 16 + 4 || frame.readUInt32BE(0) !== VOOR_66) throw new Error('geen 6699-bericht');
  const seqno = frame.readUInt32BE(6);
  const cmd = frame.readUInt32BE(10);
  const iv = frame.subarray(18, 30);
  const tekst = frame.subarray(30, frame.length - 20);
  const tag = frame.subarray(frame.length - 20, frame.length - 4);
  let data;
  try {
    const d = crypto.createDecipheriv('aes-128-gcm', sleutel, iv);
    d.setAAD(frame.subarray(4, 18));
    d.setAuthTag(tag);
    data = Buffer.concat([d.update(tekst), d.final()]);
  } catch {
    return { seqno, cmd, retcode: null, data: Buffer.alloc(0), klopt: false };
  }
  const metCode = retcode === 'raden' ? data[0] !== 0x7b && data[4] === 0x7b : retcode;
  if (metCode && data.length >= 4) return { seqno, cmd, retcode: data.readUInt32BE(0), data: data.subarray(4), klopt: true };
  return { seqno, cmd, retcode: 0, data, klopt: true };
}

/* ---------- Wat er in een bericht staat ---------- */

const VERSIEKOP = 15; // "3.3" + 12 nullen

/** Bekende foutteksten van Tuya-apparaten, in gewone woorden. */
function foutUit(tekst) {
  if (/data unvalid/i.test(tekst)) return 'het apparaat kent deze statusvraag niet (een oud type; nog niet ondersteund)';
  if (/parse data error|data format error/i.test(tekst)) return 'het apparaat begrijpt de vraag niet: klopt de versie (3.3, 3.4 of 3.5)?';
  if (/devid not found|gw id invalid/i.test(tekst)) return 'het apparaat herkent het id niet: klopt het id bij dit adres?';
  return null;
}

/**
 * De datapunten (dps) uit de data van een frame van het apparaat. Bij 3.3 is
 * die versleuteld met de local_key, bij 3.4 met de sessiesleutel, bij 3.5 al
 * ontsleuteld (GCM). Leeg: null (een ontvangstbevestiging zonder stand).
 * Een foutmelding van het apparaat: een fout in gewone woorden.
 */
export function dpsUit(data, { versie, sleutel }) {
  if (!data || data.length === 0) return null;
  let tekst = data;
  if (versie === '3.3') {
    if (tekst.subarray(0, 3).toString('latin1') === '3.3') tekst = tekst.subarray(VERSIEKOP);
    tekst = ecbOntsleutel(sleutel, tekst);
  } else if (versie === '3.4') {
    tekst = ecbOntsleutel(sleutel, tekst);
  }
  if (VERSIES.includes(tekst.subarray(0, 3).toString('latin1'))) tekst = tekst.subarray(VERSIEKOP);
  const woorden = tekst.toString('utf8');
  let json;
  try {
    json = JSON.parse(woorden);
  } catch {
    throw new Error(foutUit(woorden) ?? 'het antwoord is geen geldige stand (verkeerde sleutel of versie?)');
  }
  const dps = json?.dps ?? json?.data?.dps;
  if (!dps || typeof dps !== 'object' || Array.isArray(dps)) return null;
  return dps;
}

/* ---------- De sessiesleutel (3.4 en 3.5) ---------- */

/**
 * Het antwoord van het apparaat op onze nonce (cmd 4): zijn nonce, en een HMAC
 * van de onze die moet kloppen (anders is de local_key fout). Bij 3.4 is de
 * data versleuteld met de local_key, bij 3.5 al ontsleuteld.
 */
export function hunNonce(data, { versie, localKey, nonce }) {
  const inhoud = versie === '3.4' ? ecbOntsleutel(localKey, data) : data;
  if (inhoud.length < 48) throw new Error('het apparaat gaf geen sessiesleutel (verkeerde versie?)');
  const zijne = inhoud.subarray(0, 16);
  if (!crypto.timingSafeEqual(hmac(localKey, nonce), inhoud.subarray(16, 48))) {
    throw new Error('de local_key klopt niet (haal hem opnieuw op met: node brug.mjs instellen)');
  }
  return Buffer.from(zijne);
}

/** De bevestiging (cmd 5): een HMAC van zijn nonce. */
export const bevestiging = (localKey, zijne) => hmac(localKey, zijne);

/** De sessiesleutel: onze nonce XOR de zijne, versleuteld met de local_key. */
export function sessieSleutel({ versie, localKey, nonce, zijne }) {
  const xor = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) xor[i] = nonce[i] ^ zijne[i];
  if (versie === '3.4') return ecbVersleutel(localKey, xor, { opvullen: false });
  return gcmVersleutel(localKey, nonce.subarray(0, 12), xor, null).tekst;
}

/* ---------- Wat wij sturen ---------- */

/** De statusvraag: bij 3.3 cmd 0x0a met de id's en de tijd (zonder spaties), bij 3.4/3.5 cmd 0x10 met {}. */
export function statusVraag({ versie, id, nu = Date.now() }) {
  if (versie === '3.3') {
    const t = String(Math.floor(nu / 1000));
    return { cmd: CMD.DP_QUERY, data: Buffer.from(JSON.stringify({ gwId: id, devId: id, uid: id, t })) };
  }
  return { cmd: CMD.DP_QUERY_NEW, data: Buffer.from('{}') };
}

/**
 * Een bericht van ons in het frame van deze versie, versleuteld met `sleutel`
 * (de local_key, of na de afspraak de sessiesleutel).
 */
export function verpak({ versie, seqno, cmd, data, sleutel, iv }) {
  if (versie === '3.5') return maakFrame66({ seqno, cmd, data, sleutel, iv });
  const versleuteld = ecbVersleutel(sleutel, data);
  return maakFrame55({ seqno, cmd, data: versleuteld, hmacSleutel: versie === '3.4' ? sleutel : null });
}

/** Een frame van het apparaat uitpakken met de sleutel van nu. */
export function pakUit(frame, { versie, sleutel }) {
  if (frame.readUInt32BE(0) === VOOR_66) {
    if (versie !== '3.5') throw new Error('het apparaat praat 3.5: zet de versie op 3.5');
    return ontleedFrame66(frame, sleutel);
  }
  if (versie === '3.5') throw new Error('het apparaat praat geen 3.5: zet de versie op 3.3 of 3.4');
  return ontleedFrame55(frame, { hmacSleutel: versie === '3.4' ? sleutel : null });
}

/* ---------- Eén apparaat uitlezen ---------- */

/** Zo lang mag een lezing hooguit duren, verbinden en afspreken inbegrepen. */
export const TUYA_TIJD_MS = 5000;

/**
 * Eén keer de stand van één apparaat: verbinden, bij 3.4/3.5 de sessiesleutel
 * afspreken, DP_QUERY, het antwoord lezen en de verbinding weer dicht. Altijd
 * binnen `tijd` ms klaar (een antwoord of een fout). Geeft de dps.
 *
 * @param {{ adres: string, id: string, local_key: string, versie: string }} apparaat
 */
export function leesTuya(apparaat, { tijd = TUYA_TIJD_MS, poort = TUYA_POORT, verbind = net.connect, nonce = crypto.randomBytes(16), nu = Date.now } = {}) {
  const { versie, id } = apparaat;
  const localKey = Buffer.from(apparaat.local_key, 'latin1');
  return new Promise((klaarMet, misMet) => {
    let sleutel = localKey;
    let seqno = 1;
    let binnen = Buffer.alloc(0);
    let fase = versie === '3.3' ? 'vraag' : 'sessie';
    let klaar = false;
    const socket = verbind({ host: apparaat.adres, port: poort });
    const stop = (fout, dps) => {
      if (klaar) return;
      klaar = true;
      clearTimeout(klok);
      socket.removeAllListeners('data');
      socket.destroy();
      if (fout) misMet(fout);
      else klaarMet(dps);
    };
    const klok = setTimeout(() => {
      const fout = new Error(`geen antwoord binnen ${tijd / 1000} s`);
      fout.code = 'ETIMEDOUT';
      stop(fout);
    }, tijd);
    const stuur = (cmd, data) => {
      socket.write(verpak({ versie, seqno, cmd, data, sleutel }));
      seqno += 1;
    };
    const vraag = () => {
      const { cmd, data } = statusVraag({ versie, id, nu: nu() });
      stuur(cmd, data);
    };
    socket.setNoDelay?.(true);
    socket.on('connect', () => {
      if (fase === 'sessie') stuur(CMD.SESSIE_START, nonce);
      else vraag();
    });
    socket.on('error', (fout) => stop(fout));
    socket.on('close', () => stop(Object.assign(new Error('de verbinding viel weg (een ander programma met dit apparaat verbonden?)'), { code: 'ECONNRESET' })));
    socket.on('data', (stuk) => {
      try {
        binnen = Buffer.concat([binnen, stuk]);
        if (binnen.length > 4 * HOOGSTENS_BERICHT) throw new Error('het apparaat stuurt te veel');
        const { frames, rest } = knipFrames(binnen);
        binnen = rest;
        for (const frame of frames) {
          const bericht = pakUit(frame, { versie, sleutel });
          if (!bericht.klopt) {
            throw new Error(fase === 'sessie' ? 'de local_key klopt niet (haal hem opnieuw op met: node brug.mjs instellen)' : 'het antwoord klopt niet (verkeerde sleutel?)');
          }
          if (fase === 'sessie') {
            if (bericht.cmd !== CMD.SESSIE_ANTWOORD) continue;
            const zijne = hunNonce(bericht.data, { versie, localKey, nonce });
            stuur(CMD.SESSIE_KLAAR, bevestiging(localKey, zijne));
            sleutel = sessieSleutel({ versie, localKey, nonce, zijne });
            fase = 'vraag';
            vraag();
            continue;
          }
          if (![CMD.DP_QUERY, CMD.DP_QUERY_NEW, CMD.STATUS].includes(bericht.cmd)) continue;
          const dps = dpsUit(bericht.data, { versie, sleutel });
          if (dps) return stop(null, dps);
        }
      } catch (fout) {
        stop(fout);
      }
    });
  });
}

/* ---------- Van datapunten naar wat de app wil ---------- */

/**
 * Welke datapunten wat zijn. Gewoon (tinytuya OutletDevice/BulbDevice):
 *   meter       1 aan/uit, 19 vermogen (× 0,1 W: schaal 1)
 *   lamp        20 aan/uit en 22 helderheid (10–1000); een oudere lamp 1 en 3 (25–255)
 *   schakelaar  1 aan/uit
 * De instelhulp neemt de echte nummers en schaal uit de Tuya-cloud over (dp in de instellingen).
 */
export function dpVoor(apparaat, dps = {}) {
  const eigen = apparaat.dp ?? {};
  if (apparaat.wat === 'meter') return { aan: 1, vermogen: 19, schaal: 1, ...eigen };
  if (apparaat.wat === 'lamp') {
    const oud = dps['20'] === undefined && dps['1'] !== undefined;
    return oud ? { aan: 1, helderheid: 3, helderheid_min: 25, helderheid_max: 255, ...eigen } : { aan: 20, helderheid: 22, helderheid_min: 10, helderheid_max: 1000, ...eigen };
  }
  return { aan: dps['1'] === undefined && dps['20'] !== undefined ? 20 : 1, ...eigen };
}

const getal = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Uit de dps: { aan, w, helderheid }. w in watt (alleen bij een meter),
 * helderheid 1–100 % (alleen bij een lamp die aan is). Wat er niet is: null.
 */
export function standUit(apparaat, dps) {
  const dp = dpVoor(apparaat, dps);
  const aan = typeof dps?.[String(dp.aan)] === 'boolean' ? dps[String(dp.aan)] : null;
  let w = null;
  if (dp.vermogen !== undefined) {
    const ruw = getal(dps?.[String(dp.vermogen)]);
    if (ruw !== null && ruw >= 0) w = ruw / 10 ** (dp.schaal ?? 0);
    else if (aan === false) w = 0;
  }
  let helderheid = null;
  if (dp.helderheid !== undefined && aan !== false) {
    const ruw = getal(dps?.[String(dp.helderheid)]);
    const max = dp.helderheid_max ?? 1000;
    if (ruw !== null && max > 0) helderheid = Math.min(100, Math.max(1, Math.round((ruw / max) * 100)));
  }
  return { aan, w, helderheid };
}

/* ---------- Bijhouden: hooguit eens per 20 s per apparaat ---------- */

/** Zo vaak vragen we elk apparaat (de opdracht: hooguit eens per 15–30 s). */
export const TUYA_ELKE_MS = 20_000;
/** Zo lang telt een lezing nog als hij daarna niet lukt; daarna "weet niet". */
export const TUYA_HOUDBAAR_MS = 90_000;

/**
 * Houdt de Tuya-apparaten bij. ronde() vraagt alleen de apparaten die aan de
 * beurt zijn (allemaal tegelijk, elk met een harde eindtijd) en geeft per
 * apparaat de laatste stand, met `fout` als de lezing van deze ronde misging.
 * Geeft [{ apparaat, stand: { aan, w, helderheid } | null, fout: Error|null, gelezen }].
 */
export function tuyaVolger(apparaten, { lees = leesTuya, elke = TUYA_ELKE_MS, houdbaar = TUYA_HOUDBAAR_MS, klok = Date.now } = {}) {
  const staat = new Map(apparaten.map((a) => [a.sleutel, { gevraagd: -Infinity, stand: null, moment: -Infinity }]));
  return {
    async ronde() {
      const nu = klok();
      return Promise.all(
        apparaten.map(async (apparaat) => {
          const s = staat.get(apparaat.sleutel);
          const vers = () => (nu - s.moment < houdbaar ? s.stand : null);
          if (nu - s.gevraagd < elke) return { apparaat, stand: vers(), fout: null, gelezen: false };
          s.gevraagd = nu;
          try {
            s.stand = standUit(apparaat, await lees(apparaat));
            s.moment = nu;
            return { apparaat, stand: s.stand, fout: null, gelezen: true };
          } catch (fout) {
            return { apparaat, stand: vers(), fout, gelezen: true };
          }
        }),
      );
    },
  };
}

/** Hooguit zoveel lampen en schakelaars gaan mee (base44/functions/ontvangMeting/controle.js). */
export const HOOGSTENS_LAMPEN = 20;

/**
 * Voor de meting: meters als gewoon apparaat (vermogen_w, zoals een
 * HomeWizard-stekker), lampen en schakelaars als `lampen`.
 */
export function tuyaVoorApp(lezingen) {
  const apparaten = [];
  const lampen = [];
  for (const { apparaat, stand } of lezingen) {
    if (apparaat.wat === 'meter') {
      apparaten.push({ sleutel: apparaat.sleutel, naam: apparaat.naam, soort: apparaat.soort ?? 'stekker', vermogen_w: stand?.w === null || stand?.w === undefined ? null : Math.max(0, Math.round(stand.w)) });
    } else if (lampen.length < HOOGSTENS_LAMPEN) {
      lampen.push({
        sleutel: apparaat.sleutel,
        naam: apparaat.naam,
        soort: apparaat.wat === 'lamp' ? 'lamp' : 'schakelaar',
        aan: stand?.aan ?? null,
        ...(stand?.helderheid ? { helderheid: stand.helderheid } : {}),
        ...(apparaat.spots ? { rol: 'spots' } : {}),
      });
    }
  }
  return { apparaten, lampen };
}

/**
 * De Tuya-lezingen erbij in een meting (maakMeting in samenvoegen.mjs): de
 * meters achter de andere apparaten, de lampen als eigen blok. Zonder lampen
 * geen blok, zoals een oudere versie. Een oudere functie in Base44 kent
 * `lampen` niet en laat het stil weg (controleerMeting neemt alleen wat hij kent).
 */
export function metTuya(meting, lezingen) {
  if (!lezingen?.length) return meting;
  const { apparaten, lampen } = tuyaVoorApp(lezingen);
  const bezet = new Set([...(meting.zonnen ?? []), ...(meting.apparaten ?? [])].map((a) => a.sleutel));
  meting.apparaten = [...(meting.apparaten ?? []), ...apparaten.filter((a) => !bezet.has(a.sleutel))];
  if (lampen.length) meting.lampen = lampen;
  return meting;
}

/* ---------- Zoeken in de wifi (alleen luisteren) ---------- */

/** De sleutel van de UDP-meldingen: MD5("yGAdlopoPVldABfn") (tinytuya core/udp_helper.py). */
export const UDP_SLEUTEL = crypto.createHash('md5').update('yGAdlopoPVldABfn').digest();

/**
 * Een melding van een Tuya-apparaat op UDP 6666 (3.1, platte JSON) of 6667
 * (3.3 en nieuwer, versleuteld). Geeft { id, adres, versie } of null.
 */
export function meldingUit(bericht) {
  try {
    let tekst;
    if (bericht.length >= 4 && bericht.readUInt32BE(0) === VOOR_66) {
      tekst = ontleedFrame66(bericht, UDP_SLEUTEL, { retcode: 'raden' }).data.toString('utf8').replace(/\0+$/, '');
    } else if (bericht.length >= 4 && bericht.readUInt32BE(0) === VOOR_55) {
      const { data } = ontleedFrame55(bericht);
      tekst = data[0] === 0x7b ? data.toString('utf8') : ecbOntsleutel(UDP_SLEUTEL, data).toString('utf8');
    } else {
      tekst = ecbOntsleutel(UDP_SLEUTEL, bericht).toString('utf8');
    }
    const j = JSON.parse(tekst);
    const id = typeof j.gwId === 'string' && /^[a-zA-Z0-9]{10,40}$/.test(j.gwId) ? j.gwId : null;
    const adres = typeof j.ip === 'string' && net.isIPv4(j.ip) ? j.ip : null;
    const versie = VERSIES.includes(String(j.version)) ? String(j.version) : null;
    return id && adres ? { id, adres, versie } : null;
  } catch {
    return null;
  }
}

/**
 * Een paar seconden luisteren naar wat Tuya-apparaten zelf in de wifi roepen
 * (elke paar seconden, poort 6666 en 6667). Wij sturen niets. Geeft per id
 * { id, adres, versie }. Lukt luisteren niet (poort bezet, geen recht), dan leeg.
 */
export async function luisterTuya({ ms = 8000, poorten = [6666, 6667], maak = () => dgram.createSocket({ type: 'udp4', reuseAddr: true }) } = {}) {
  const gevonden = new Map();
  const sockets = [];
  await Promise.all(
    poorten.map(
      (poort) =>
        new Promise((klaar) => {
          let s;
          try {
            s = maak();
          } catch {
            return klaar();
          }
          s.on('error', () => klaar());
          s.on('message', (bericht) => {
            const m = meldingUit(bericht);
            if (m) gevonden.set(m.id, m);
          });
          try {
            s.bind(poort, () => klaar());
          } catch {
            klaar();
          }
          sockets.push(s);
        }),
    ),
  );
  await new Promise((klaar) => setTimeout(klaar, ms));
  for (const s of sockets) {
    try {
      s.close();
    } catch {
      // al dicht
    }
  }
  return [...gevonden.values()];
}
