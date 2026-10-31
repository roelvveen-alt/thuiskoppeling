import dgram from 'node:dgram';
import { ADRES_DT, crc16, POORT, vraagRegisters } from './goodwe.mjs';

/**
 * Het ENIGE stuk van het programmaatje dat iets in een apparaat verandert (1.5.0, 1.6.0): de
 * GoodWe-omvormer begrenzen bij een negatieve terugleverprijs, en weer vrijgeven. De
 * eigenaar, 31-10-2026: "ja uitzetten voor stroomprijs; nog beter dat jij dat zelf kan doen", en voor
 * de schakelaar van de grens (1.6.0): "ja dat mag".
 *
 * Wat hier kan, en niets anders (de harde lijst SCHRIJFBAAR, Modbus 0x06, één register):
 *   - GRENS_REGISTER (40336), de teruglevergrens, met 0, 10, 20, … 100 (procent; 0 = helemaal
 *     begrensd, daartussen gedeeltelijk, ongeveer het eigen verbruik)
 *   - SCHAKELAAR_REGISTER (40327), de schakelaar van die grens, met 0 (uit) of 1 (aan)
 * Een ander register of een waarde buiten de lijst geeft een fout voordat er iets verstuurd
 * is. omvormerSturen.test.js loopt alle registers en waarden na en bewijst dat er alleen deze
 * twee met deze waarden uit kunnen, geen ander commando (0x10, start/stop), en dat geen ander
 * bestand van het programmaatje een schrijfverzoek maakt.
 *
 * Hoe het samen werkt (1.6.0, gemeten in huis A op 31-10-2026: grens 2%, schakelaar uit, en
 * de omvormer leverde gewoon 335 W): de grens doet alleen iets als de schakelaar aan staat.
 *   begrenzen   eerst 40336 op de gewenste waarde (teruglezen), dan 40327 = 1 (teruglezen)
 *   bijstellen  alleen 40336 (teruglezen)
 *   vrijgeven   alleen 40327 = 0 (teruglezen); 40336 blijft staan: met de schakelaar uit doet
 *               die niets, precies zoals de installateur hem achterliet
 * Wie is de baas: staat de schakelaar uit, dan is de omvormer vrij, wat 40336 ook zegt. Staat
 * hij aan terwijl het programmaatje hem niet aanzette, dan is hij van iemand anders (de
 * installateur, de app van GoodWe): dan schrijft het programmaatje NIETS en zegt dat. Of de
 * schakelaar van ons is, weet de besturing (omvormerPlan.mjs, omvormer-sturen.json).
 *
 * Waarom deze registers (uit de Home Assistant-bibliotheek goodwe, github.com/marcelblijleven/goodwe,
 * commit 66dfcdd, dt.py; de rest staat in goodwe.mjs):
 *   dt.py, __settings_three_phase:  Integer("grid_export_limit", 40336, "Grid Export Limit", "%")
 *   (sinds 70eb0b0, februari 2022: "Add back the grid_export_limit to DT inverters, with
 *   proper unit (%)"; voor de driefase-DT, zoals de GW8000-DT in huis A; de eenfase gebruikt 40328 in W).
 *   dt.py, 40327 "Grid Export Limit Enabled": de schakelaar van die grens, 0 uit, 1 aan.
 * Andere mogelijkheden in dt.py, bewust NIET gekozen:
 *   40331 "Stop / Power Off" en 40330 "Start": zet de hele omvormer uit; blijft hij uit als het
 *        startcommando niet aankomt, dan levert hij de hele dag niets meer. Te grof.
 * Onzeker (in het rapport en de README): of 40336 in procent telt of in 0,1% (de test van
 * `node brug.mjs omvormer-test` probeert na 0% ook 50%); of hij de teruglevering begrenst (met
 * een GoodWe-meter) of het hele vermogen; of de omvormer de waarden in flashgeheugen bewaart
 * (waarschijnlijk: het zijn instellingen), dus zuinig schrijven (de rem in omvormerPlan.mjs).
 */

/** De teruglevergrens in procent (dt.py, driefase-DT). */
export const GRENS_REGISTER = 40336;
/** De schakelaar van die grens (dt.py 40327, "Grid Export Limit Enabled"; 1 = aan, 0 = uit). */
export const SCHAKELAAR_REGISTER = 40327;
/** De grens die "volle kracht" betekent; vrijgeven gaat sinds 1.6.0 met de schakelaar (UIT). */
export const VRIJ = 100;
/** De enige waarden voor de grens (procent), in stappen van 10. */
export const TOEGESTAAN = Object.freeze([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
/** De schakelaar: uit (de omvormer is vrij) of aan (de grens telt). */
export const UIT = 0;
export const AAN = 1;
/** De enige twee schrijfacties, en de waarden per register. Verder niets. */
export const SCHRIJFBAAR = Object.freeze({
  [GRENS_REGISTER]: TOEGESTAAN,
  [SCHAKELAAR_REGISTER]: Object.freeze([UIT, AAN]),
});
const SCHRIJF = 0x06;

/** Mag deze waarde in de grens (een heel getal uit TOEGESTAAN)? */
export const magWaarde = (procent) => typeof procent === 'number' && Number.isInteger(procent) && TOEGESTAAN.includes(procent);

/** Mag dit register met deze waarde (alleen uit SCHRIJFBAAR)? */
export function magSchrijven(register, waarde) {
  if (register !== GRENS_REGISTER && register !== SCHAKELAAR_REGISTER) return false;
  return typeof waarde === 'number' && Number.isInteger(waarde) && SCHRIJFBAAR[register].includes(waarde);
}

/** Een schrijfverzoek voor een register en waarde uit SCHRIJFBAAR. Iets anders: een fout, er komt niets uit. */
export function schrijfVerzoek(register, waarde) {
  if (!magSchrijven(register, waarde)) throw new Error('alleen de grens (40336: 0, 10, … 100) of de schakelaar (40327: 0 of 1)');
  const data = Buffer.from([ADRES_DT, SCHRIJF, register >> 8, register & 0xff, waarde >> 8, waarde & 0xff]);
  const crc = crc16(data);
  return Buffer.concat([data, Buffer.from([crc & 0xff, crc >> 8])]);
}

const WEIGERING = { 1: 'kent deze opdracht niet', 2: 'kent dit register niet', 3: 'neemt deze waarde niet aan', 4: 'storing in de omvormer', 6: 'is bezig' };

/**
 * Het antwoord op een schrijfverzoek (modbus.py, validate_modbus_rtu_response): de omvormer
 * stuurt het verzoek terug, AA 55 7F 06 <register> <waarde> CRC (10 bytes, CRC vanaf byte 2).
 * Geeft { ok: true }, { half: true } of { fout } (code 'GEWEIGERD' bij een Modbus-weigering).
 */
export function bekijkSchrijfAntwoord(buf, register, waarde) {
  if (!Buffer.isBuffer(buf) || buf.length < 5 || buf[0] !== 0xaa || buf[1] !== 0x55) return { fout: new Error('geen antwoord van een GoodWe') };
  if (buf[3] === (SCHRIJF | 0x80)) {
    if (buf.length >= 7 && crc16(buf.subarray(2, 5)) === buf.readUInt16LE(5)) {
      const fout = new Error(`de omvormer ${WEIGERING[buf[4]] ?? `weigert (code ${buf[4]})`}`);
      fout.code = 'GEWEIGERD';
      return { fout };
    }
    return buf.length < 7 ? { half: true } : { fout: new Error('onleesbaar antwoord van de omvormer') };
  }
  if (buf[3] !== SCHRIJF) return { fout: new Error('onverwacht antwoord van de omvormer') };
  if (buf.length < 10) return { half: true };
  if (crc16(buf.subarray(2, 8)) !== buf.readUInt16LE(8)) return { fout: new Error('antwoord kwam beschadigd aan') };
  if (buf.readUInt16BE(4) !== register || buf.readUInt16BE(6) !== waarde) return { fout: new Error('de omvormer bevestigt iets anders') };
  return { ok: true };
}

/**
 * Eén schrijfverzoek over UDP, één keer verstuurd (opnieuw proberen beslist de besturing,
 * omvormerPlan.mjs, na teruglezen). Klaar als de omvormer het bevestigt; anders na `tijd` ms
 * een fout met code ETIMEDOUT. Elke keer een eigen socket, die altijd weer dicht gaat.
 * Niet uitgevoerd: alleen schrijfGrens en schrijfSchakelaar hieronder gebruiken het.
 */
function schrijfRegister(adres, register, waarde, { poort = POORT, tijd = 2000, maakSocket = () => dgram.createSocket('udp4') } = {}) {
  let verzoek;
  try {
    verzoek = schrijfVerzoek(register, waarde);
  } catch (fout) {
    return Promise.reject(fout);
  }
  return new Promise((klaar, mis) => {
    const s = maakSocket();
    let stukken = Buffer.alloc(0);
    let af = false;
    const einde = (fout) => {
      if (af) return;
      af = true;
      clearTimeout(klok);
      try {
        s.close();
      } catch {
        // Al dicht.
      }
      if (fout) mis(fout);
      else klaar();
    };
    const klok = setTimeout(() => {
      const fout = new Error(`geen antwoord binnen ${tijd / 1000} s`);
      fout.code = 'ETIMEDOUT';
      einde(fout);
    }, tijd);
    s.on('error', (fout) => einde(fout));
    s.on('message', (bericht, van) => {
      if (van.address !== adres) return;
      stukken = stukken.length ? Buffer.concat([stukken, bericht]) : bericht;
      if (stukken.length > 256) stukken = bericht;
      const uit = bekijkSchrijfAntwoord(stukken, register, waarde);
      if (uit.half) return;
      if (uit.ok) return einde(null);
      if (uit.fout.code === 'GEWEIGERD') return einde(uit.fout);
      stukken = Buffer.alloc(0);
      return undefined;
    });
    s.send(verzoek, poort, adres, (fout) => fout && einde(fout));
  });
}

/** De grens zetten (40336): alleen 0, 10, … 100. */
export const schrijfGrens = (adres, procent, opties) => schrijfRegister(adres, GRENS_REGISTER, procent, opties);

/** De schakelaar zetten (40327): alleen 0 (uit, vrij) of 1 (aan, de grens telt). */
export const schrijfSchakelaar = (adres, stand, opties) => schrijfRegister(adres, SCHAKELAAR_REGISTER, stand, opties);

/** De grens lezen (alleen lezen, 0x03): de waarde in procent. Gooit bij geen antwoord (ETIMEDOUT) of een weigering. */
export async function leesGrens(adres, { vraag = vraagRegisters, ...opties } = {}) {
  const g = await vraag(adres, GRENS_REGISTER, 1, { tijd: 1500, pogingen: 2, ...opties });
  if (!Buffer.isBuffer(g) || g.length < 2) throw new Error('onleesbaar antwoord van de omvormer');
  return g.readUInt16BE(0);
}

/**
 * De schakelaar van de grens lezen (alleen lezen): true (aan; alles behalve 0) of false (uit).
 * Gooit bij geen antwoord, net als leesGrens.
 */
export async function leesSchakelaar(adres, { vraag = vraagRegisters, ...opties } = {}) {
  const g = await vraag(adres, SCHAKELAAR_REGISTER, 1, { tijd: 1500, pogingen: 2, ...opties });
  if (!Buffer.isBuffer(g) || g.length < 2) throw new Error('onleesbaar antwoord van de omvormer');
  return g.readUInt16BE(0) !== 0;
}

/**
 * Het geheel voor de besturing (omvormerPlan.mjs) en de samen-test (omvormerTest.mjs): lezen
 * en schrijven op één adres (of een functie die het adres van nu geeft).
 */
export function omvormerVerbinding(adres, opties = {}) {
  const nu = () => (typeof adres === 'function' ? adres() : adres);
  return {
    leesGrens: () => leesGrens(nu(), opties),
    leesSchakelaar: () => leesSchakelaar(nu(), opties),
    schrijfGrens: (procent) => schrijfGrens(nu(), procent, opties),
    schrijfSchakelaar: (stand) => schrijfSchakelaar(nu(), stand, opties),
  };
}
