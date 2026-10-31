import dgram from 'node:dgram';
import { schoon } from './web.mjs';

/**
 * Een GoodWe-omvormer van de DT-serie (in huis A de GW8000-DT: driefase, twee
 * paneelrijen) uitlezen via zijn wifi-stekker, rechtstreeks in de eigen wifi.
 * ALLEEN LEZEN: hier staat geen enkel verzoek dat iets in de omvormer
 * verandert (geen Modbus 0x06 of 0x10), alleen 0x03 (registers lezen).
 *
 * Hoe het werkt, uit de Home Assistant-bibliotheek goodwe van Marcel
 * Blijleven (github.com/marcelblijleven/goodwe, commit 66dfcdd, dt.py,
 * protocol.py, modbus.py, sensor.py, const.py):
 *
 *   UDP poort 8899   Modbus-RTU: [0x7F, 0x03, register (2), aantal (2), CRC-16 (laag eerst)]
 *                    antwoord: AA 55 7F 03 <n> <n bytes> CRC; CRC vanaf byte 2
 *   UDP poort 48899  zoeken: "WIFIKIT-214028-READ" als broadcast; antwoord "ip,mac,naam"
 *
 * Wat we lezen: 73 registers vanaf 30100 (zoals de bibliotheek), en daaruit
 * spanning en stroom per paneelrij, spanning en stroom per fase, de
 * netfrequentie, het vermogen, de temperatuur, de werkstand, de foutbits,
 * de beperkingen en de opbrengst vandaag en totaal. Het serienummer (in het
 * blok met apparaatgegevens) gebruiken we alleen om na te gaan dat het nog
 * dezelfde omvormer is: als vingerafdruk (kenmerk.mjs, adressen.json), nooit
 * het nummer zelf, en nooit naar de app. De naam uit het zoekantwoord (vaak met
 * een stuk serienummer) bewaren we niet.
 *
 * 's Nachts is de omvormer uit, en zijn wifi-stekker ook: geen antwoord is
 * dan gewoon "slaapt" (zie goodweVolger).
 */

export const POORT = 8899;
export const ZOEK_POORT = 48899;
/** Het communicatieadres van de DT-serie (dt.py: 0x7F). */
export const ADRES_DT = 0x7f;
const LEES = 0x03;
/** Het blok met de looptijdgegevens (dt.py: _READ_RUNNING_DATA = 0x7594, 0x49). */
export const BLOK_BEGIN = 30100;
export const BLOK_AANTAL = 73;
/** Het blok met de apparaatgegevens (dt.py: _READ_DEVICE_VERSION_INFO = 0x7531, 0x28); alleen het type lezen we eruit. */
export const INFO_BEGIN = 30001;
export const INFO_AANTAL = 40;

/* ---------- Het protocol (pure functies) ---------- */

const CRC_TABEL = (() => {
  const tabel = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let b = 0; b < 8; b++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
    tabel[i] = crc;
  }
  return tabel;
})();

/** CRC-16 zoals Modbus hem rekent (begint op 0xFFFF). */
export function crc16(bytes) {
  let crc = 0xffff;
  for (const b of bytes) crc = (crc >>> 8) ^ CRC_TABEL[(crc ^ b) & 0xff];
  return crc;
}

/** Een leesverzoek: `aantal` registers vanaf `register`. Het enige soort verzoek dat dit programmaatje kent. */
export function leesVerzoek(register, aantal, adres = ADRES_DT) {
  if (!Number.isInteger(register) || register < 0 || register > 0xffff) throw new Error('register klopt niet');
  if (!Number.isInteger(aantal) || aantal < 1 || aantal > 125) throw new Error('aantal klopt niet');
  const data = Buffer.from([adres, LEES, register >> 8, register & 0xff, aantal >> 8, aantal & 0xff]);
  const crc = crc16(data);
  return Buffer.concat([data, Buffer.from([crc & 0xff, crc >> 8])]);
}

/** Modbus-foutcodes in gewone woorden (modbus.py: FAILURE_CODES). */
const WEIGERING = { 1: 'kent deze vraag niet', 2: 'kent dit register niet', 3: 'kent deze waarde niet', 4: 'storing in de omvormer', 6: 'is bezig' };

/**
 * Is dit een volledig, goed antwoord op een leesverzoek van `aantal`
 * registers? 'goed' met de gegevens, 'half' (nog een stuk erbij), of een fout
 * (Error met een uitleg). Een geweigerd verzoek (0x83) heeft code 'GEWEIGERD'.
 */
export function bekijkAntwoord(buf, aantal) {
  if (!Buffer.isBuffer(buf) || buf.length < 5 || buf[0] !== 0xaa || buf[1] !== 0x55) return { fout: new Error('geen antwoord van een GoodWe') };
  if (buf[3] === (LEES | 0x80)) {
    if (buf.length >= 7 && crc16(buf.subarray(2, 5)) === buf.readUInt16LE(5)) {
      const fout = new Error(`de omvormer ${WEIGERING[buf[4]] ?? `weigert (code ${buf[4]})`}`);
      fout.code = 'GEWEIGERD';
      return { fout };
    }
    return { fout: new Error('onleesbaar antwoord van de omvormer') };
  }
  if (buf[3] !== LEES) return { fout: new Error('onverwacht antwoord van de omvormer') };
  if (buf[4] !== aantal * 2) return { fout: new Error('antwoord met de verkeerde lengte') };
  const lengte = aantal * 2 + 7;
  if (buf.length < lengte) return { half: true };
  if (crc16(buf.subarray(2, lengte - 2)) !== buf.readUInt16LE(lengte - 2)) return { fout: new Error('antwoord kwam beschadigd aan') };
  return { gegevens: buf.subarray(5, lengte - 2) };
}

/* ---------- Van bytes naar getallen ---------- */

/** Lezer voor een blok dat bij `begin` begint; elke waarde die er niet is, wordt null. */
function lezer(gegevens, begin) {
  const plek = (register) => (register - begin) * 2;
  const binnen = (register, bytes) => plek(register) >= 0 && plek(register) + bytes <= gegevens.length;
  return {
    u16: (r) => (binnen(r, 2) ? gegevens.readUInt16BE(plek(r)) : null),
    s16: (r) => (binnen(r, 2) ? gegevens.readInt16BE(plek(r)) : null),
    u32: (r) => (binnen(r, 4) ? gegevens.readUInt32BE(plek(r)) : null),
  };
}

const eenDecimaal = (v) => Math.round(v * 10) / 10;
/** u16 in tienden (spanning, stroom, kWh vandaag); 0xFFFF = er niet. */
const tienden = (v) => (v === null || v === 0xffff ? null : eenDecimaal(v / 10));

/** De werkstand (const.py: WORK_MODES; 3 bestaat bij DT niet). */
export const STANDEN = { 0: 'wacht', 1: 'normaal', 2: 'storing', 4: 'controle' };

/** De bits die op staan in een getal: 0b1010 → [1, 3]. */
export function bitsUit(getal) {
  if (!Number.isInteger(getal) || getal <= 0) return [];
  const uit = [];
  for (let b = 0; b < 32; b++) if (Math.floor(getal / 2 ** b) % 2 === 1) uit.push(b);
  return uit;
}

/**
 * De looptijdgegevens (73 registers vanaf 30100) als getallen, in de eenheden
 * van de app. Wat de omvormer niet heeft (0xFFFF), staat er niet in. Paneelrij
 * 3 en 4 alleen als ze er zijn (de GW8000-DT heeft er twee).
 */
export function omvormerUit(gegevens, begin = BLOK_BEGIN) {
  if (!Buffer.isBuffer(gegevens) || gegevens.length < 2) return null;
  const r = lezer(gegevens, begin);
  const rijen = [];
  for (let i = 0; i < 4; i++) {
    const v = tienden(r.u16(30103 + 2 * i));
    const a = tienden(r.u16(30104 + 2 * i));
    if (v === null) continue;
    rijen.push({ rij: i + 1, v, a: a ?? 0, w: Math.round(v * (a ?? 0)) });
  }
  const fasen = [];
  for (let i = 0; i < 3; i++) {
    const v = tienden(r.u16(30118 + i));
    if (v === null || v === 0) continue;
    const a = tienden(r.u16(30121 + i));
    const hz = r.s16(30124 + i);
    fasen.push({ fase: i + 1, v, ...(a === null ? {} : { a }), ...(hz === null || hz <= 0 ? {} : { hz: hz / 100 }) });
  }
  // 1.4.0: meer uit hetzelfde blok (dt.py: power_factor 30139, temperature_heatsink 30142, h_total 30147, vbus 30163).
  const pf = r.s16(30139);
  const koelplaat = r.s16(30142);
  const uren = r.u32(30147);
  const bus = r.u16(30163);
  const vermogen = r.u32(30127);
  const code = r.u16(30129);
  const fout = r.u32(30130);
  const waarschuwing = r.u16(30132);
  const temp = r.s16(30141);
  const vandaag = r.u16(30144);
  const totaal = r.u32(30145);
  const beperking = r.u32(30165);
  return {
    stand: STANDEN[code] ?? 'onbekend',
    stand_code: code,
    w: vermogen === null || vermogen === 0xffffffff ? null : vermogen,
    rijen,
    fasen,
    temp_c: temp === null || temp === -1 || temp === 32767 ? null : temp / 10,
    vandaag_kwh: tienden(vandaag),
    totaal_kwh: totaal === null || totaal === 0xffffffff ? null : eenDecimaal(totaal / 10),
    storingen: fout === 0xffffffff ? [] : bitsUit(fout),
    waarschuwing: waarschuwing === null || waarschuwing === 0xffff ? 0 : waarschuwing,
    beperkt: beperking === null || beperking === 0xffffffff ? [] : bitsUit(beperking),
    pf: pf === null || pf === -1 || Math.abs(pf) > 1000 ? null : pf / 1000,
    koelplaat_c: koelplaat === null || koelplaat === -1 || koelplaat === 32767 || koelplaat < -400 || koelplaat > 1200 ? null : koelplaat / 10,
    uren: uren === null || uren === 0xffffffff || uren > 1_000_000 ? null : uren,
    bus_v: tienden(bus) === null || tienden(bus) > 1500 ? null : tienden(bus),
    registers: registersUit(gegevens, begin),
  };
}

/** Het register met het fabrikantnummer (dt.py: 30171 Manufacture ID); dat gaat nergens heen, ook niet in de kennis. */
const NIET_IN_KENNIS = new Set([30171]);

/**
 * Elk register uit het blok dat iets zegt (niet 0xFFFF), als { nummer: waarde }: alleen voor de
 * lijst met wat de omvormer kan geven (kennis.mjs, één keer per dag), zodat later te zien is wat
 * de registers zonder naam (30140, 30143, 30150–30161, 30166–30170) doen. Geen serienummer: dat
 * staat in een ander blok (30001), dat hier nooit in komt.
 */
export function registersUit(gegevens, begin = BLOK_BEGIN) {
  const uit = {};
  for (let i = 0; i + 1 < gegevens.length && i < 250; i += 2) {
    const nr = begin + i / 2;
    const v = gegevens.readUInt16BE(i);
    if (v !== 0xffff && !NIET_IN_KENNIS.has(nr)) uit[nr] = v;
  }
  return uit;
}

/* ---------- Extra registers buiten het blok (1.4.0) ---------- */

/**
 * Twee registers die de bibliotheek wel noemt maar (nog) niet leest, elk apart
 * gevraagd en ALLEEN LEZEN. Onzeker (de eigenaar ziet het in de kennislijst terug):
 *   30173  "ISO test value" (dt.py, als opmerking): de isolatieweerstand van de panelen
 *          naar aarde; aangenomen in kΩ (0 en 0xFFFF = niet gemeten)
 *   30210  "leakage_current" (dt.py, CurrentSmA): de lekstroom naar aarde, met teken, in
 *          tienden; we nemen het als mA zoals de bibliotheek. Ligt net na het meterblok
 *          (30195, 15 registers), dus ook onbevestigd.
 * Weigert de omvormer een register (Modbus-fout), dan vragen we dat niet meer tot het
 * programmaatje opnieuw start.
 */
export const EXTRA_REGISTERS = Object.freeze({ isolatie: 30173, lekstroom: 30210 });

/** Isolatie in kΩ uit het ruwe register, of null. */
export const isolatieUit = (v) => (Number.isInteger(v) && v > 0 && v < 0xffff ? v : null);
/** Lekstroom in mA (zonder teken) uit het ruwe register (16 bits met teken, tienden), of null. */
export function lekstroomUit(v) {
  if (!Number.isInteger(v) || v < 0 || v > 0xffff || v === 0xffff || v === 0x7fff || v === 0x8000) return null;
  const metTeken = v >= 0x8000 ? v - 0x10000 : v;
  const ma = Math.abs(metTeken) / 10;
  return ma <= 3000 ? Math.round(ma * 10) / 10 : null;
}

/** Zo vaak de extra registers (de isolatie verandert hooguit eens per dag, bij het opstarten). */
export const EXTRA_ELKE_MS = 60_000;

/**
 * Om een lezer heen: na een gelukte lezing hooguit eens per `elke` ms de extra
 * registers erbij, daartussen de laatste waarden. Een extra die niet lukt houdt
 * de gewone lezing nooit tegen.
 */
export function metExtra(lees, { vraag = vraagRegisters, elke = EXTRA_ELKE_MS, klok = Date.now } = {}) {
  const geweigerd = new Set();
  let laatst = -Infinity;
  let extra = {};
  return async (adres) => {
    const lezing = await lees(adres);
    const nu = klok();
    if (nu - laatst >= elke && lezing && lezing.stand !== 'onbekend') {
      laatst = nu;
      const vers = {};
      for (const [naam, register] of Object.entries(EXTRA_REGISTERS)) {
        if (geweigerd.has(register)) continue;
        try {
          const g = await vraag(adres, register, 1, { tijd: 1200, pogingen: 1 });
          const ruw = g.length >= 2 ? g.readUInt16BE(0) : null;
          vers[naam === 'isolatie' ? 'isolatie_kohm' : 'lekstroom_ma'] = naam === 'isolatie' ? isolatieUit(ruw) : lekstroomUit(ruw);
          vers[`r${register}`] = ruw;
        } catch (fout) {
          if (fout?.code === 'GEWEIGERD') geweigerd.add(register);
        }
      }
      extra = vers;
    }
    if (!lezing) return lezing;
    const { r30173, r30210, ...waarden } = extra;
    const registers = { ...(lezing.registers ?? {}), ...(r30173 === undefined ? {} : { 30173: r30173 }), ...(r30210 === undefined ? {} : { 30210: r30210 }) };
    return { ...lezing, ...Object.fromEntries(Object.entries(waarden).filter(([, v]) => v !== null && v !== undefined)), registers };
  };
}

/* ---------- Grenzen voor meldingen (1.4.0) ---------- */

/**
 * Isolatie van de panelen: onder ISOLATIE_LAAG_KOHM een melding (en een regel in het
 * Logboek); tussen die en ISOLATIE_LET_OP_KOHM "matig" (alleen in de app). Lekstroom: vanaf
 * LEKSTROOM_HOOG_MA een melding, vanaf LEKSTROOM_LET_OP_MA "wat hoger". Ruim gekozen
 * (een omvormer schakelt bij een lekstroom van 300 mA af, en meldt isolatie onder ongeveer
 * 33 tot 100 kΩ zelf als fout 18); dezelfde grenzen als src/lib/omvormer.js (goodwe.test.js
 * houdt ze gelijk).
 */
export const GRENZEN = Object.freeze({ ISOLATIE_LAAG_KOHM: 100, ISOLATIE_LET_OP_KOHM: 500, LEKSTROOM_LET_OP_MA: 50, LEKSTROOM_HOOG_MA: 150 });
/** Zo lang moet het buiten de grens blijven voordat het een melding wordt (twee extra lezingen). */
export const MELDING_NA_MS = 2 * 60_000;
/** Zo lang moet het weer goed zijn voordat de melding weg is. */
export const MELDING_WEG_NA_MS = 5 * 60_000;

const kommaGetal = (g, d = 1) => g.toFixed(d).replace('.', ',');
/** 1250 → "1,3 MΩ", 85 → "85 kΩ". */
export const isolatieTekst = (kohm) => (kohm >= 1000 ? `${kommaGetal(kohm / 1000)} MΩ` : `${Math.round(kohm)} kΩ`);

/**
 * Houdt de isolatie en de lekstroom bij en zegt wanneer het een melding is
 * (soort 'omvormer' in brug.meldingen, zie meldingenVoorApp in gekoppeld.mjs; de
 * app zet die ook in het Logboek: één regel bij het begin, één bij het einde).
 * `ronde(blok, nu)` geeft de nieuwe zinnen voor brug.log; `meldingen()` wat er nu
 * openstaat, { tekst, sinds }. Alleen als de omvormer wakker is telt het: slaapt hij,
 * dan blijft het zoals het was.
 */
export function omvormerMeldingVolger({ naNa = MELDING_NA_MS, wegNa = MELDING_WEG_NA_MS } = {}) {
  const staat = { isolatie: { slecht: null, goed: null, open: null }, lekstroom: { slecht: null, goed: null, open: null } };
  const tekst = {
    isolatie: (v) => `Omvormer, isolatie van de panelen: laag (${isolatieTekst(v)}); laat de installateur de panelen en kabels nakijken`,
    lekstroom: (v) => `Omvormer, lekstroom: hoog (${v.toLocaleString('nl-NL', { maximumFractionDigits: 1 })} mA); laat de installateur de panelen en kabels nakijken`,
  };
  return {
    ronde(blok, nu) {
      if (!blok || !['normaal', 'wacht', 'controle', 'storing'].includes(blok.stand)) return [];
      const nieuw = [];
      const waarden = { isolatie: blok.isolatie_kohm, lekstroom: blok.lekstroom_ma };
      for (const soort of ['isolatie', 'lekstroom']) {
        const v = waarden[soort];
        if (typeof v !== 'number') continue;
        const slecht = soort === 'isolatie' ? v < GRENZEN.ISOLATIE_LAAG_KOHM : v >= GRENZEN.LEKSTROOM_HOOG_MA;
        const s = staat[soort];
        if (slecht) {
          s.goed = null;
          s.slecht ??= nu;
          if (!s.open && nu - s.slecht >= naNa) {
            s.open = { tekst: tekst[soort](v), sinds: s.slecht };
            nieuw.push(s.open.tekst);
          } else if (s.open) s.open = { ...s.open, tekst: tekst[soort](v) };
        } else {
          s.slecht = null;
          s.goed ??= nu;
          if (s.open && nu - s.goed >= wegNa) {
            nieuw.push(`${soort === 'isolatie' ? 'Omvormer, isolatie van de panelen' : 'Omvormer, lekstroom'}: weer goed.`);
            s.open = null;
          }
        }
      }
      return nieuw;
    },
    meldingen() {
      return Object.values(staat)
        .map((s) => s.open)
        .filter(Boolean);
    },
  };
}

/**
 * Het serienummer uit de apparaatgegevens (dt.py: response[6:22]), alleen om er een kenmerk van te
 * maken (kenmerk.mjs): of het nog dezelfde omvormer is. Nooit bewaren, printen of versturen.
 */
export function serieUit(gegevens) {
  if (!Buffer.isBuffer(gegevens) || gegevens.length < 22) return null;
  const tekst = gegevens.subarray(6, 22).toString('latin1').replace(/[^\x21-\x7e]/g, '');
  return /^[A-Za-z0-9]{6,16}$/.test(tekst) ? tekst : null;
}

/** Het type uit de apparaatgegevens (dt.py: response[22:32]), bijvoorbeeld "GW8K-DT". */
export function typeUit(gegevens) {
  if (!Buffer.isBuffer(gegevens) || gegevens.length < 32) return null;
  const tekst = schoon(gegevens.subarray(22, 32).toString('latin1').replace(/[^\x20-\x7e]/g, ''), 20);
  return /^[A-Za-z0-9][A-Za-z0-9 .\-/]*$/.test(tekst) ? tekst : null;
}

/** "192.168.1.30,5884E4AABBCC,Solar-WiFi123" → "192.168.1.30"; anders null. De rest bewaren we niet. */
export function zoekAntwoordUit(tekst) {
  const deel = String(tekst ?? '').trim().split(',');
  const adres = deel[0]?.trim() ?? '';
  return deel.length >= 2 && /^(\d{1,3})(\.\d{1,3}){3}$/.test(adres) && adres.split('.').every((d) => Number(d) <= 255) ? adres : null;
}

/* ---------- Foutbits en beperkingen in gewone woorden ---------- */

/**
 * De foutbits (const.py: ERROR_CODES, GoodWe's gewone foutlijst). De
 * bibliotheek koppelt die lijst aan de ET-serie; bij de DT-serie leest hij
 * het foutregister alleen als getal. Dezelfde lijst als in de app
 * (src/lib/omvormer.js; goodwe.test.js houdt ze gelijk).
 */
export const STORINGEN = {
  0: 'controle van de aardlekbeveiliging mislukt',
  1: 'controle van de stroommeting mislukt',
  3: 'gelijkstroommeting klopt niet met zichzelf',
  4: 'aardlekmeting klopt niet met zichzelf',
  6: 'aardlekbeveiliging binnenin kapot',
  7: 'relais kapot',
  8: 'stroommeting binnenin kapot',
  9: 'geen net (stroomstoring?)',
  10: 'lekstroom naar aarde',
  11: 'spanning binnenin te hoog',
  12: 'ventilator binnenin kapot',
  13: 'te warm',
  14: 'een fase van het net ontbreekt',
  15: 'spanning van de panelen te hoog',
  16: 'ventilator buiten kapot',
  17: 'netspanning buiten de grenzen',
  18: 'isolatiefout bij de panelen of kabels',
  19: 'te veel gelijkstroom naar het net',
  20: 'noodstroom overbelast',
  22: 'netfrequentie klopt niet met zichzelf',
  23: 'netspanning klopt niet met zichzelf',
  25: 'controle van het relais mislukt',
  27: 'fasehoek van het net klopt niet',
  28: 'interne communicatie (DSP) mislukt',
  29: 'netfrequentie buiten de grenzen',
  30: 'geheugen binnenin kapot',
  31: 'interne communicatie mislukt',
};

/** Waarom hij minder levert (const.py: DERATING_MODE_CODES). Ook gelijk met src/lib/omvormer.js. */
export const BEPERKINGEN = {
  0: 'te warm',
  1: 'vermogen beperkt',
  2: 'blindvermogen ingesteld',
  3: 'netfrequentie hoog',
  4: 'netspanning hoog',
  5: 'teruglevergrens',
  6: 'op afstand beperkt',
  7: 'rustige start',
  8: 'hoogste stroom bereikt',
  9: 'spanning te hoog',
  10: 'afstellen',
};

export const storingTekst = (bit) => STORINGEN[bit] ?? `storingscode ${bit}`;
export const beperkingTekst = (bit) => BEPERKINGEN[bit] ?? `beperking ${bit}`;

/* ---------- Naar de app ---------- */

const STAND_VOOR_APP = new Set(['normaal', 'wacht', 'storing', 'controle', 'onbekend', 'slaapt', 'weg']);

/**
 * Het blok `omvormer` in de meting: klein, met de getallen op één decimaal
 * (frequentie op twee). `bij`: de sleutel van de zonnebron waar deze
 * omvormer bij hoort (voor het blad in de app). Geen type, geen serienummer.
 */
export function omvormerVoorApp(lezing, { bij = null, stand = null } = {}) {
  const s = stand ?? lezing?.stand ?? 'onbekend';
  const uit = { stand: STAND_VOOR_APP.has(s) ? s : 'onbekend', ...(bij ? { bij } : {}) };
  if (!lezing) return uit;
  const zet = (veld, waarde) => {
    if (waarde !== null && waarde !== undefined) uit[veld] = waarde;
  };
  if (stand === null) {
    zet('w', lezing.w);
    if (lezing.rijen?.length) uit.rijen = lezing.rijen.map(({ v, a }) => ({ v, a }));
    if (lezing.fasen?.length) uit.fasen = lezing.fasen.map(({ v, a }) => ({ v, ...(a === undefined ? {} : { a }) }));
    const hz = lezing.fasen?.find((f) => f.hz !== undefined)?.hz;
    zet('hz', hz === undefined ? null : Math.round(hz * 100) / 100);
    zet('temp_c', lezing.temp_c);
    if (lezing.storingen?.length) uit.storingen = lezing.storingen;
    if (lezing.waarschuwing) uit.waarschuwing = lezing.waarschuwing;
    if (lezing.beperkt?.length) uit.beperkt = lezing.beperkt;
    // 1.4.0: voor storingen. De arbeidsfactor alleen als hij echt levert (anders zegt hij niets).
    if (typeof lezing.pf === 'number' && lezing.pf !== 0 && (lezing.w ?? 0) >= 50) uit.pf = Math.round(lezing.pf * 1000) / 1000;
    zet('bus_v', lezing.bus_v);
    zet('koelplaat_c', lezing.koelplaat_c);
    zet('uren', lezing.uren);
    zet('isolatie_kohm', lezing.isolatie_kohm);
    zet('lekstroom_ma', lezing.lekstroom_ma);
  }
  // Ook als hij slaapt: wat hij vandaag en in totaal leverde (de laatste lezing van vandaag).
  zet('vandaag_kwh', lezing.vandaag_kwh);
  zet('totaal_kwh', lezing.totaal_kwh);
  return uit;
}

const komma = (g, d = 1) => (Number.isInteger(g) && d === 1 ? String(g) : g.toFixed(d)).replace('.', ',');

/** In gewone woorden, voor `node brug.mjs proef`. */
export function omvormerZinnen(blok, { type = null } = {}) {
  if (!blok) return ['geen gegevens'];
  if (blok.stand === 'slaapt') {
    return [`slaapt (geen zon, de omvormer en zijn wifi-stekker zijn uit)${blok.vandaag_kwh !== undefined ? `; vandaag ${komma(blok.vandaag_kwh)} kWh` : ''}`];
  }
  if (blok.stand === 'weg') return ['geen antwoord (uit, zwak wifi, of een ander adres?)'];
  const regels = [];
  const stand = { normaal: 'levert stroom', wacht: 'wacht (te weinig zon, of start op)', storing: 'STORING', controle: 'controleert zichzelf', onbekend: 'stand onbekend' }[blok.stand];
  regels.push(`${type ? `${type}: ` : ''}${stand}${blok.w !== undefined ? `, ${blok.w} W` : ''}`);
  for (const bit of blok.storingen ?? []) regels.push(`storing: ${storingTekst(bit)}`);
  if (blok.waarschuwing) regels.push(`waarschuwing (code ${blok.waarschuwing})`);
  if (blok.beperkt?.length) regels.push(`levert minder: ${blok.beperkt.map(beperkingTekst).join(', ')}`);
  (blok.rijen ?? []).forEach((r, i) => regels.push(`paneelrij ${i + 1}: ${komma(r.v)} V, ${komma(r.a)} A`));
  if (blok.fasen?.length) regels.push(`net: ${blok.fasen.map((f, i) => `L${i + 1} ${komma(f.v)} V`).join(', ')}${blok.hz !== undefined ? `, ${komma(blok.hz, 2)} Hz` : ''}`);
  if (blok.temp_c !== undefined) regels.push(`temperatuur ${komma(blok.temp_c)} °C${blok.koelplaat_c !== undefined ? `, koelplaat ${komma(blok.koelplaat_c)} °C` : ''}`);
  if (blok.isolatie_kohm !== undefined) regels.push(`isolatie van de panelen ${isolatieTekst(blok.isolatie_kohm)} (onder ${GRENZEN.ISOLATIE_LAAG_KOHM} kΩ een melding)`);
  if (blok.lekstroom_ma !== undefined) regels.push(`lekstroom ${komma(blok.lekstroom_ma)} mA (vanaf ${GRENZEN.LEKSTROOM_HOOG_MA} mA een melding)`);
  const elektrisch = [];
  if (blok.pf !== undefined) elektrisch.push(`arbeidsfactor ${blok.pf.toFixed(2).replace('.', ',')}`);
  if (blok.bus_v !== undefined) elektrisch.push(`busspanning ${komma(blok.bus_v)} V`);
  if (blok.uren !== undefined) elektrisch.push(`${blok.uren} uur in bedrijf`);
  if (elektrisch.length) regels.push(elektrisch.join(', '));
  const opbrengst = [];
  if (blok.vandaag_kwh !== undefined) opbrengst.push(`vandaag ${komma(blok.vandaag_kwh)} kWh`);
  if (blok.totaal_kwh !== undefined) opbrengst.push(`totaal ${komma(Math.round(blok.totaal_kwh))} kWh`);
  if (opbrengst.length) regels.push(`opbrengst ${opbrengst.join(', ')}`);
  return regels;
}

/* ---------- Het netwerk ---------- */

/**
 * Eén leesverzoek over UDP, met een harde eindtijd: binnen `tijd` ms per
 * poging een goed antwoord, anders nog eens (hooguit `pogingen` keer), anders
 * een fout met code ETIMEDOUT. Een antwoord in twee stukken wordt aan elkaar
 * gezet. Elke keer een eigen socket, die altijd weer dicht gaat.
 */
export function vraagRegisters(adres, register, aantal, { poort = POORT, tijd = 1500, pogingen = 2, maakSocket = () => dgram.createSocket('udp4') } = {}) {
  const verzoek = leesVerzoek(register, aantal);
  return new Promise((klaar, mis) => {
    const s = maakSocket();
    let stukken = Buffer.alloc(0);
    let poging = 0;
    let klok = null;
    let af = false;
    const einde = (fout, gegevens) => {
      if (af) return;
      af = true;
      clearTimeout(klok);
      try {
        s.close();
      } catch {
        // Al dicht.
      }
      if (fout) mis(fout);
      else klaar(gegevens);
    };
    const stuur = () => {
      poging += 1;
      stukken = Buffer.alloc(0);
      s.send(verzoek, poort, adres, (fout) => fout && einde(fout));
      klok = setTimeout(() => {
        if (poging < pogingen) return stuur();
        const fout = new Error(`geen antwoord binnen ${(tijd * pogingen) / 1000} s`);
        fout.code = 'ETIMEDOUT';
        return einde(fout);
      }, tijd);
    };
    s.on('error', (fout) => einde(fout));
    s.on('message', (bericht, van) => {
      if (van.address !== adres) return;
      stukken = stukken.length ? Buffer.concat([stukken, bericht]) : bericht;
      if (stukken.length > 1024) stukken = bericht;
      const uit = bekijkAntwoord(stukken, aantal);
      if (uit.half) return;
      if (uit.gegevens) return einde(null, Buffer.from(uit.gegevens));
      // Een geweigerd verzoek is een echt antwoord; rommel: wachten op een volgende poging.
      if (uit.fout.code === 'GEWEIGERD') return einde(uit.fout);
      stukken = Buffer.alloc(0);
      return undefined;
    });
    stuur();
  });
}

/** Eén keer de looptijdgegevens. Gooit bij geen antwoord (code ETIMEDOUT) of een fout. */
export async function leesGoodWe(adres, opties) {
  return omvormerUit(await vraagRegisters(adres, BLOK_BEGIN, BLOK_AANTAL, opties));
}

/** Het type van de omvormer ("GW8K-DT"), of null. */
export async function leesGoodWeType(adres, opties) {
  try {
    return typeUit(await vraagRegisters(adres, INFO_BEGIN, INFO_AANTAL, opties));
  } catch {
    return null;
  }
}

/** Het serienummer (alleen voor het kenmerk, zie serieUit), of null als hij niet (goed) antwoordt. */
export async function leesGoodWeSerie(adres, opties) {
  try {
    return serieUit(await vraagRegisters(adres, INFO_BEGIN, INFO_AANTAL, opties));
  } catch {
    return null;
  }
}

/**
 * GoodWe-wifi-stekkers in de wifi zoeken: "WIFIKIT-214028-READ" als
 * broadcast naar poort 48899, en `tijd` ms luisteren. Geeft de adressen
 * (zonder mac en naam: daar zit vaak een stuk serienummer in).
 * `netten`: ook naar het broadcastadres van elk netwerk ("192.168.1." → .255).
 */
export function zoekGoodWe({ netten = [], tijd = 2500, poort = ZOEK_POORT, doelen, maakSocket = () => dgram.createSocket({ type: 'udp4', reuseAddr: true }) } = {}) {
  const naar = doelen ?? ['255.255.255.255', ...netten.map((n) => `${n}255`)];
  return new Promise((klaar) => {
    const gevonden = new Set();
    let s;
    try {
      s = maakSocket();
    } catch {
      klaar([]);
      return;
    }
    const einde = () => {
      try {
        s.close();
      } catch {
        // Al dicht.
      }
      klaar([...gevonden]);
    };
    s.on('error', einde);
    s.on('message', (bericht) => {
      const adres = zoekAntwoordUit(bericht.toString('latin1'));
      if (adres) gevonden.add(adres);
    });
    s.bind(0, () => {
      try {
        s.setBroadcast(true);
      } catch {
        // Geen broadcast (Android?): dan alleen wat er per netwerk lukt.
      }
      for (const doel of naar) s.send(Buffer.from('WIFIKIT-214028-READ'), poort, doel, () => {});
      setTimeout(einde, tijd);
    });
  });
}

/* ---------- Bijhouden, voor het programmaatje ---------- */

/** De omvormer niet vaker vragen dan dit: de wifi-stekker is klein (elke 5 s zou kunnen, maar hoeft niet). */
export const GOODWE_ELKE_MS = 15_000;
/** Zo lang geldt een lezing nog als er net geen antwoord kwam. */
export const GOODWE_HOUDBAAR_MS = 60_000;
/**
 * 's Nachts, als hij slaapt (geen antwoord), zo vaak kijken (0.13.0): elke vraag zonder antwoord
 * kost 3 s wachten (twee keer 1,5 s) en houdt de meetronde zo lang op. Bij zonsopkomst (nacht
 * voorbij) weer elke 15 s, zodat hij snel gezien wordt als hij wakker wordt.
 */
export const GOODWE_NACHT_MS = 5 * 60_000;

/**
 * Houdt de omvormer bij: hooguit eens per `elke` ms vragen, daartussen de
 * laatste lezing. Geeft per ronde { blok, gelezen, fout } (en na een gelukte lezing `registers`):
 *   blok     wat er naar de app gaat (omvormerVoorApp), of null als er nog nooit iets was
 *   gelezen  true als er deze ronde echt gevraagd is
 *   fout     als er overdag geen antwoord kwam (dan "weg"); 's nachts, of als hij
 *            net ging slapen (wacht, of bijna geen zon), is geen antwoord "slaapt" en geen fout
 *
 * De opbrengst van vandaag blijft bij het slapen staan, tot de datum verandert.
 */
export function goodweVolger(
  instelling,
  { lees = (adres) => leesGoodWe(adres), elke = GOODWE_ELKE_MS, nachtElke = GOODWE_NACHT_MS, houdbaar = GOODWE_HOUDBAAR_MS, klok = Date.now } = {},
) {
  let laatste = null; // { lezing, moment, datum }
  let gevraagd = -Infinity;
  let blok = null;
  let fout = null;
  // Slaapt hij (geen antwoord, 's nachts of na het wachten), en van welke dag is het blok?
  let slaapt = false;
  let blokDatum = null;
  return {
    async ronde({ nacht = false, datum = null } = {}) {
      const nu = klok();
      if (nu - gevraagd < (slaapt && nacht ? nachtElke : elke)) {
        // Een nieuwe dag terwijl hij slaapt: de opbrengst van gisteren hoort er niet meer bij.
        if (slaapt && laatste && datum !== blokDatum) {
          blok = omvormerVoorApp({ totaal_kwh: laatste.lezing.totaal_kwh }, { bij: instelling.bij, stand: 'slaapt' });
          blokDatum = datum;
        }
        return { blok, gelezen: false, fout };
      }
      gevraagd = nu;
      blokDatum = datum;
      slaapt = false;
      try {
        const lezing = await lees(instelling.adres);
        laatste = { lezing, moment: nu, datum };
        fout = null;
        blok = omvormerVoorApp(lezing, { bij: instelling.bij });
        // De registers van deze lezing (1.4.0), alleen voor de kennislijst van één keer per dag (kennis.mjs).
        return { blok, gelezen: true, fout, registers: lezing?.registers ?? null };
      } catch (f) {
        const vers = laatste && nu - laatste.moment < houdbaar;
        const vandaag = laatste && laatste.datum === datum ? laatste.lezing : null;
        const ging = laatste && (laatste.lezing.stand === 'wacht' || (laatste.lezing.w ?? 0) < 100);
        if (vers && !nacht) {
          // Eén keer geen antwoord: de laatste lezing nog even.
          fout = null;
        } else if (nacht || ging) {
          fout = null;
          slaapt = true;

          blok = omvormerVoorApp(vandaag ? { vandaag_kwh: vandaag.vandaag_kwh, totaal_kwh: vandaag.totaal_kwh } : laatste ? { totaal_kwh: laatste.lezing.totaal_kwh } : null, { bij: instelling.bij, stand: 'slaapt' });
        } else {
          fout = f;
          blok = omvormerVoorApp(null, { bij: instelling.bij, stand: 'weg' });
        }
      }
      return { blok, gelezen: true, fout };
    },
  };
}
