import dgram from 'node:dgram';
import { afterEach, describe, expect, it } from 'vitest';
import { BEPERKINGEN as APP_BEPERKINGEN, GRENZEN as APP_GRENZEN, STORINGEN as APP_STORINGEN } from '../src/lib/omvormer.js';
import { meldingenVoorApp } from './gekoppeld.mjs';
import {
  BEPERKINGEN,
  BLOK_AANTAL,
  BLOK_BEGIN,
  bekijkAntwoord,
  bitsUit,
  crc16,
  goodweVolger,
  GRENZEN,
  isolatieTekst,
  isolatieUit,
  lekstroomUit,
  leesGoodWe,
  leesGoodWeSerie,
  leesGoodWeType,
  leesVerzoek,
  metExtra,
  omvormerMeldingVolger,
  omvormerUit,
  omvormerVoorApp,
  omvormerZinnen,
  registersUit,
  STORINGEN,
  typeUit,
  vraagRegisters,
  zoekAntwoordUit,
  zoekGoodWe,
} from './goodwe.mjs';
import { maakMeting } from './samenvoegen.mjs';
import { kenmerkVan } from './kenmerk.mjs';
import { goodweOp } from './zoek.mjs';

/*
 * Echte antwoorden uit de testbestanden van de Home Assistant-bibliotheek
 * goodwe (github.com/marcelblijleven/goodwe, commit 66dfcdd,
 * tests/sample/dt/*.hex), met de waarden die tests/test_dt.py ervan verwacht.
 */
const GW8K_DT = Buffer.from(
  'aa557f0392150818102b1b0ac3000613f40008ffffffffffffffffffffffffffffffff102910220ff0094409650930000a000a000a1390138c13880000028300010000000000000000000000000000000000000000ffff01c5ffffffffffffffffffffffffffff00200000000000000000ffffffffffffffffffffffffffffffff020018620c6000000000000002d800810000ffff0054f42f',
  'hex',
);
const GW6000_DT = Buffer.from(
  'aa557f039215081f0c03020c88001f0ca90020ffffffffffffffffffffffffffffffffffffffffffff08d008f90906001b001a001b1386138613860000072b0001000000000000ffffffffffffffffffffffff0000ffff019dffffffff003c0002097e0000210300140000ffff0000ffff0000ffff0000ffffffffffffffffffff0000177c0beeffffffff00cf016302f00000000000649f03',
  'hex',
);
/** Het serienummer in dit voorbeeld is al weggepoetst ("00000DTS00000000"). */
const GW8K_INFO = Buffer.from(
  'aa557f0350000000000001303030303044545330303030303030304757384b2d4454202020ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff000003f203f2000802d80031000100001593',
  'hex',
);

/** Een antwoord maken zoals de omvormer het geeft: AA 55, dan adres, 0x03, lengte, gegevens en de CRC. */
function antwoordMet(gegevens, cmd = 0x03) {
  const kern = Buffer.concat([Buffer.from([0x7f, cmd, gegevens.length]), gegevens]);
  const crc = crc16(kern);
  return Buffer.concat([Buffer.from([0xaa, 0x55]), kern, Buffer.from([crc & 0xff, crc >> 8])]);
}

describe('het protocol (Modbus-RTU over UDP)', () => {
  it('maakt hetzelfde leesverzoek als de bibliotheek', () => {
    // tests/inverter_scan.py: "7F03753100280409" (apparaatgegevens van een DT).
    expect(leesVerzoek(30001, 40).toString('hex')).toBe('7f03753100280409');
    // tests/test_dt.py: lezen van de teruglevergrens, "7f039d900001a195".
    expect(leesVerzoek(40336, 1).toString('hex')).toBe('7f039d900001a195');
    const blok = leesVerzoek(BLOK_BEGIN, BLOK_AANTAL);
    expect(blok.subarray(0, 6).toString('hex')).toBe('7f0375940049');
    expect(blok).toHaveLength(8);
  });

  it('kent alleen lezen: geen verkeerde registers of aantallen', () => {
    expect(() => leesVerzoek(-1, 1)).toThrow();
    expect(() => leesVerzoek(30100, 0)).toThrow();
    expect(() => leesVerzoek(30100, 200)).toThrow();
    expect(leesVerzoek(30100, 1)[1]).toBe(0x03);
  });

  it('neemt de echte antwoorden aan, ook in twee stukken, en weigert beschadigde', () => {
    expect(bekijkAntwoord(GW8K_DT, 73).gegevens).toHaveLength(146);
    expect(bekijkAntwoord(GW8K_DT.subarray(0, 60), 73)).toEqual({ half: true });
    const kapot = Buffer.from(GW8K_DT);
    kapot[40] ^= 0xff;
    expect(bekijkAntwoord(kapot, 73).fout.message).toMatch(/beschadigd/);
    expect(bekijkAntwoord(GW8K_DT, 40).fout.message).toMatch(/lengte/);
    expect(bekijkAntwoord(Buffer.from('hallo'), 73).fout).toBeInstanceOf(Error);
    expect(bekijkAntwoord(null, 73).fout).toBeInstanceOf(Error);
  });

  it('een geweigerd verzoek (0x83) is een antwoord met een reden', () => {
    const kern = Buffer.from([0x7f, 0x83, 0x02]);
    const crc = crc16(kern);
    const geweigerd = Buffer.concat([Buffer.from([0xaa, 0x55]), kern, Buffer.from([crc & 0xff, crc >> 8])]);
    const { fout } = bekijkAntwoord(geweigerd, 73);
    expect(fout.code).toBe('GEWEIGERD');
    expect(fout.message).toBe('de omvormer kent dit register niet');
  });
});

describe('omvormerUit: de getallen uit de echte voorbeelden', () => {
  it('GW8K-DT (dezelfde DT-serie als de GW8000-DT): twee paneelrijen, drie fasen', () => {
    const o = omvormerUit(bekijkAntwoord(GW8K_DT, 73).gegevens);
    expect(o.rijen).toEqual([
      { rij: 1, v: 275.5, a: 0.6, w: 165 },
      { rij: 2, v: 510.8, a: 0.8, w: 409 },
    ]);
    expect(o.fasen).toEqual([
      { fase: 1, v: 237.2, a: 1, hz: 50.08 },
      { fase: 2, v: 240.5, a: 1, hz: 50.04 },
      { fase: 3, v: 235.2, a: 1, hz: 50 },
    ]);
    expect(o).toMatchObject({ stand: 'normaal', stand_code: 1, w: 643, temp_c: 45.3, storingen: [], waarschuwing: 0, beperkt: [] });
    // Deze omvormer meldde geen opbrengst (0xFFFF): dan staat die er niet.
    expect(o.vandaag_kwh).toBeNull();
    expect(o.totaal_kwh).toBeNull();
  });

  it('GW6000-DT: opbrengst vandaag en totaal', () => {
    const o = omvormerUit(bekijkAntwoord(GW6000_DT, 73).gegevens);
    expect(o.rijen.map(({ v, a }) => [v, a])).toEqual([
      [320.8, 3.1],
      [324.1, 3.2],
    ]);
    expect(o.fasen.map((f) => f.v)).toEqual([225.6, 229.7, 231]);
    expect(o.fasen[0]).toMatchObject({ a: 2.7, hz: 49.98 });
    expect(o).toMatchObject({ stand: 'normaal', w: 1835, temp_c: 41.3, vandaag_kwh: 6, totaal_kwh: 13350.2, storingen: [] });
  });

  it('storingen en beperkingen als bits, een onbekende stand als onbekend', () => {
    const g = Buffer.from(bekijkAntwoord(GW6000_DT, 73).gegevens);
    const plek = (r) => (r - BLOK_BEGIN) * 2;
    g.writeUInt16BE(2, plek(30129));
    g.writeUInt32BE((1 << 9) | (1 << 17), plek(30130));
    g.writeUInt32BE(1, plek(30165));
    g.writeInt16BE(-55, plek(30141));
    expect(omvormerUit(g)).toMatchObject({ stand: 'storing', storingen: [9, 17], beperkt: [0], temp_c: -5.5 });
    g.writeUInt16BE(7, plek(30129));
    expect(omvormerUit(g).stand).toBe('onbekend');
    expect(bitsUit(0x80000001)).toEqual([0, 31]);
    expect(bitsUit(0)).toEqual([]);
    expect(omvormerUit(Buffer.alloc(0))).toBeNull();
  });

  it('het type uit de apparaatgegevens, nooit het serienummer', () => {
    const gegevens = bekijkAntwoord(GW8K_INFO, 40).gegevens;
    expect(typeUit(gegevens)).toBe('GW8K-DT');
    expect(typeUit(Buffer.alloc(10))).toBeNull();
    expect(typeUit(Buffer.alloc(40, 0xff))).toBeNull();
  });

  it('het zoekantwoord: alleen het adres', () => {
    expect(zoekAntwoordUit('192.168.1.30,5884E4AABBCC,Solar-WiFi123')).toBe('192.168.1.30');
    expect(zoekAntwoordUit('hallo')).toBeNull();
    expect(zoekAntwoordUit('999.1.1.1,aa,bb')).toBeNull();
  });
});

describe('naar de app en in gewone woorden', () => {
  const lezing = omvormerUit(bekijkAntwoord(GW6000_DT, 73).gegevens);

  it('een klein blok, zonder type of serienummer', () => {
    const blok = omvormerVoorApp(lezing, { bij: 'hw-zon-huis' });
    expect(blok).toEqual({
      stand: 'normaal',
      bij: 'hw-zon-huis',
      w: 1835,
      rijen: [
        { v: 320.8, a: 3.1 },
        { v: 324.1, a: 3.2 },
      ],
      fasen: [
        { v: 225.6, a: 2.7 },
        { v: 229.7, a: 2.6 },
        { v: 231, a: 2.7 },
      ],
      hz: 49.98,
      temp_c: 41.3,
      // 1.4.0: uit hetzelfde blok (de arbeidsfactor staat hier op 0: dan weg).
      bus_v: 601.2,
      uren: 8451,
      vandaag_kwh: 6,
      totaal_kwh: 13350.2,
    });
    expect(JSON.stringify(blok).length).toBeLessThan(330);
    const vol = omvormerVoorApp({ ...lezing, storingen: Array.from({ length: 32 }, (_, i) => i), beperkt: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], waarschuwing: 65535 }, { bij: 'x'.repeat(60) });
    expect(JSON.stringify(vol).length).toBeLessThan(600);
  });

  it('slapend: alleen de stand en de opbrengst', () => {
    expect(omvormerVoorApp({ vandaag_kwh: 23.4, totaal_kwh: 13350.2 }, { stand: 'slaapt' })).toEqual({ stand: 'slaapt', vandaag_kwh: 23.4, totaal_kwh: 13350.2 });
    expect(omvormerVoorApp(null, { stand: 'weg', bij: 'z' })).toEqual({ stand: 'weg', bij: 'z' });
  });

  it('zinnen voor proef', () => {
    const zinnen = omvormerZinnen(omvormerVoorApp({ ...lezing, storingen: [9], beperkt: [0] }), { type: 'GW8K-DT' });
    expect(zinnen).toEqual([
      'GW8K-DT: levert stroom, 1835 W',
      'storing: geen net (stroomstoring?)',
      'levert minder: te warm',
      'paneelrij 1: 320,8 V, 3,1 A',
      'paneelrij 2: 324,1 V, 3,2 A',
      'net: L1 225,6 V, L2 229,7 V, L3 231 V, 49,98 Hz',
      'temperatuur 41,3 °C',
      'busspanning 601,2 V, 8451 uur in bedrijf',
      'opbrengst vandaag 6 kWh, totaal 13350 kWh',
    ]);
    expect(omvormerZinnen({ stand: 'slaapt', vandaag_kwh: 23.4 })[0]).toMatch(/^slaapt .*vandaag 23,4 kWh$/);
    expect(omvormerZinnen({ stand: 'storing', storingen: [26] })).toContain('storing: storingscode 26');
  });
});

/* ---------- Een nep-omvormer op UDP, op deze computer ---------- */

const open = [];
afterEach(() => {
  for (const s of open.splice(0)) {
    try {
      s.close();
    } catch {
      // Al dicht.
    }
  }
});

/** Een nep-GoodWe op 127.0.0.1: antwoordt met `antwoord(verzoek)` (een Buffer, een lijst stukken, of null = stil). */
async function nepOmvormer(antwoord) {
  const s = dgram.createSocket('udp4');
  open.push(s);
  const verzoeken = [];
  s.on('message', (verzoek, van) => {
    verzoeken.push(Buffer.from(verzoek));
    const uit = antwoord(verzoek, verzoeken.length);
    for (const stuk of [uit ?? []].flat()) s.send(stuk, van.port, van.address);
  });
  await new Promise((klaar) => s.bind(0, '127.0.0.1', klaar));
  return { poort: s.address().port, verzoeken };
}

describe('lezen over UDP (nep-omvormer)', () => {
  it('leest de looptijdgegevens met één leesverzoek', async () => {
    const nep = await nepOmvormer(() => GW6000_DT);
    const o = await leesGoodWe('127.0.0.1', { poort: nep.poort, tijd: 500 });
    expect(o).toMatchObject({ stand: 'normaal', w: 1835, vandaag_kwh: 6 });
    expect(nep.verzoeken.map((v) => v.toString('hex'))).toEqual([leesVerzoek(30100, 73).toString('hex')]);
    // Alleen lezen: het tweede byte is altijd 0x03.
    expect(nep.verzoeken.every((v) => v[1] === 0x03)).toBe(true);
  });

  it('een antwoord in twee stukken', async () => {
    const nep = await nepOmvormer(() => [GW8K_DT.subarray(0, 50), GW8K_DT.subarray(50)]);
    expect((await leesGoodWe('127.0.0.1', { poort: nep.poort, tijd: 500 })).w).toBe(643);
  });

  it('eerst rommel, dan een goed antwoord op de tweede poging', async () => {
    const nep = await nepOmvormer((_v, keer) => (keer === 1 ? Buffer.from('rommel') : GW8K_DT));
    expect((await leesGoodWe('127.0.0.1', { poort: nep.poort, tijd: 200, pogingen: 2 })).w).toBe(643);
    expect(nep.verzoeken).toHaveLength(2);
  });

  it('geen antwoord: na de harde eindtijd een fout (ETIMEDOUT), en de socket is dicht', async () => {
    const nep = await nepOmvormer(() => null);
    const begin = Date.now();
    const fout = await leesGoodWe('127.0.0.1', { poort: nep.poort, tijd: 150, pogingen: 2 }).catch((f) => f);
    expect(fout.code).toBe('ETIMEDOUT');
    expect(Date.now() - begin).toBeLessThan(1000);
    expect(nep.verzoeken).toHaveLength(2);
  });

  it('een weigering komt meteen terug', async () => {
    const nep = await nepOmvormer(() => {
      const kern = Buffer.from([0x7f, 0x83, 0x02]);
      const crc = crc16(kern);
      return Buffer.concat([Buffer.from([0xaa, 0x55]), kern, Buffer.from([crc & 0xff, crc >> 8])]);
    });
    const fout = await vraagRegisters('127.0.0.1', 30100, 73, { poort: nep.poort, tijd: 1000 }).catch((f) => f);
    expect(fout.code).toBe('GEWEIGERD');
  });

  it('het type; zonder antwoord null', async () => {
    const nep = await nepOmvormer(() => GW8K_INFO);
    expect(await leesGoodWeType('127.0.0.1', { poort: nep.poort, tijd: 300 })).toBe('GW8K-DT');
    const stil = await nepOmvormer(() => null);
    expect(await leesGoodWeType('127.0.0.1', { poort: stil.poort, tijd: 50, pogingen: 1 })).toBeNull();
  });

  it('zoek.mjs herkent een GoodWe aan één leesvraag, met zijn type en kenmerk, zonder serienummer', async () => {
    const nep = await nepOmvormer(() => GW8K_INFO);
    const lees = (adres, register, aantal, opties) => vraagRegisters(adres, register, aantal, { ...opties, poort: nep.poort });
    const gw = await goodweOp('127.0.0.1', { lees });
    // Het kenmerk (1.3.0, adressen.mjs) is een vingerafdruk van het serienummer: zo vindt het programmaatje hem terug.
    expect(gw).toEqual({ adres: '127.0.0.1', merk: 'GoodWe', soort: 'omvormer GW8K-DT', type: 'GW8K-DT', api: 'lokaal', kenmerk: kenmerkVan('00000DTS00000000') });
    expect(JSON.stringify(gw)).not.toContain('00000DTS');
    expect(await leesGoodWeSerie('127.0.0.1', { poort: nep.poort, tijd: 300 })).toBe('00000DTS00000000');
    const stil = await nepOmvormer(() => null);
    expect(await goodweOp('127.0.0.1', { tijd: 50, lees: (a, r, n, o) => vraagRegisters(a, r, n, { ...o, poort: stil.poort }) })).toBeNull();
  });

  it('zoeken: antwoordt op WIFIKIT-214028-READ met ip,mac,naam', async () => {
    const nep = await nepOmvormer((v) => (v.toString() === 'WIFIKIT-214028-READ' ? Buffer.from('192.168.1.30,5884E4AABBCC,Solar-WiFi123') : null));
    const gevonden = await zoekGoodWe({ doelen: ['127.0.0.1'], poort: nep.poort, tijd: 300 });
    expect(gevonden).toEqual(['192.168.1.30']);
    expect(nep.verzoeken[0].toString()).toBe('WIFIKIT-214028-READ');
  });

  it('elk antwoord moet goed zijn: een gemaakt antwoord met andere getallen', async () => {
    const g = Buffer.alloc(146, 0xff);
    g.writeUInt16BE(1, (30129 - BLOK_BEGIN) * 2);
    g.writeUInt32BE(0, (30130 - BLOK_BEGIN) * 2);
    g.writeUInt16BE(2345, (30103 - BLOK_BEGIN) * 2);
    g.writeUInt16BE(12, (30104 - BLOK_BEGIN) * 2);
    const nep = await nepOmvormer(() => antwoordMet(g));
    const o = await leesGoodWe('127.0.0.1', { poort: nep.poort, tijd: 300 });
    expect(o.rijen).toEqual([{ rij: 1, v: 234.5, a: 1.2, w: 281 }]);
    expect(o.fasen).toEqual([]);
    // 0xFFFF is "er niet": geen temperatuur, geen opbrengst.
    expect(o).toMatchObject({ temp_c: null, vandaag_kwh: null, totaal_kwh: null, w: null });
  });
});

describe('goodweVolger: niet te vaak vragen, en slapen is geen fout', () => {
  const lezing = omvormerUit(bekijkAntwoord(GW6000_DT, 73).gegevens);

  it('hooguit eens per 15 s; daartussen de laatste lezing', async () => {
    let t = 0;
    let keer = 0;
    const v = goodweVolger({ adres: 'x', bij: 'hw-zon-huis' }, { lees: async () => (keer++, lezing), klok: () => t });
    expect((await v.ronde({ datum: '2026-10-30' })).gelezen).toBe(true);
    t = 5000;
    const tweede = await v.ronde({ datum: '2026-10-30' });
    expect(tweede.gelezen).toBe(false);
    expect(tweede.blok.w).toBe(1835);
    t = 15_000;
    expect((await v.ronde({ datum: '2026-10-30' })).gelezen).toBe(true);
    expect(keer).toBe(2);
  });

  it("'s nachts geen antwoord: slaapt, met de opbrengst van vandaag, en geen fout", async () => {
    let t = 0;
    let aan = true;
    const v = goodweVolger({ adres: 'x' }, { lees: async () => {
      if (!aan) throw Object.assign(new Error('stil'), { code: 'ETIMEDOUT' });
      return lezing;
    }, klok: () => t });
    await v.ronde({ datum: '2026-10-30' });
    aan = false;
    t = 120_000;
    const nacht = await v.ronde({ nacht: true, datum: '2026-10-30' });
    expect(nacht.fout).toBeNull();
    expect(nacht.blok).toEqual({ stand: 'slaapt', vandaag_kwh: 6, totaal_kwh: 13350.2 });
    // De volgende dag: de opbrengst van gisteren hoort er niet meer bij, het totaal wel.
    t = 240_000;
    expect((await v.ronde({ nacht: true, datum: '2026-10-31' })).blok).toEqual({ stand: 'slaapt', totaal_kwh: 13350.2 });
  });

  it('overdag even geen antwoord: eerst de laatste lezing, daarna weg met een fout', async () => {
    let t = 0;
    let aan = true;
    const v = goodweVolger({ adres: 'x' }, { lees: async () => {
      if (!aan) throw new Error('stil');
      return lezing;
    }, klok: () => t });
    await v.ronde({ datum: 'd' });
    aan = false;
    t = 20_000;
    expect(await v.ronde({ datum: 'd' })).toMatchObject({ fout: null, blok: { stand: 'normaal', w: 1835 } });
    t = 80_000;
    const weg = await v.ronde({ datum: 'd' });
    expect(weg.fout.message).toBe('stil');
    expect(weg.blok).toEqual({ stand: 'weg' });
  });

  it("'s nachts, als hij slaapt, maar eens per 5 minuten vragen (elke vraag zonder antwoord kost 3 s); bij zonsopkomst weer elke 15 s", async () => {
    let t = 0;
    let keer = 0;
    let aan = false;
    const v = goodweVolger({ adres: 'x' }, { lees: async () => {
      keer += 1;
      if (!aan) throw Object.assign(new Error('stil'), { code: 'ETIMEDOUT' });
      return lezing;
    }, klok: () => t });
    for (; t < 30 * 60_000; t += 5000) await v.ronde({ nacht: true, datum: '2026-10-30' });
    expect(keer).toBe(6);
    // Nacht voorbij: elke 15 s, en is hij wakker, dan de lezing.
    aan = true;
    keer = 0;
    for (const stap of [0, 5000, 10_000, 15_000]) {
      t = 30 * 60_000 + stap;
      await v.ronde({ nacht: false, datum: '2026-10-30' });
    }
    expect(keer).toBe(2);
    expect((await v.ronde({ nacht: false, datum: '2026-10-30' })).blok.stand).toBe('normaal');
  });

  it('ging hij al slapen (wacht, of bijna geen zon), dan ook overdag slaapt', async () => {
    let t = 0;
    let aan = true;
    const v = goodweVolger({ adres: 'x' }, { lees: async () => {
      if (!aan) throw new Error('stil');
      return { ...lezing, stand: 'wacht', w: 12 };
    }, klok: () => t });
    await v.ronde({ datum: 'd' });
    aan = false;
    t = 90_000;
    expect(await v.ronde({ datum: 'd' })).toMatchObject({ fout: null, blok: { stand: 'slaapt' } });
  });
});

describe('in de meting', () => {
  it('maakMeting neemt het blok over; zonder omvormer geen veld', () => {
    const blok = { stand: 'slaapt', vandaag_kwh: 23.4 };
    expect(maakMeting({ versie: '0.6.0', omvormer: blok }).omvormer).toEqual(blok);
    expect(maakMeting({ versie: '0.6.0' })).not.toHaveProperty('omvormer');
  });
});

describe('dezelfde woorden als de app', () => {
  it('foutbits en beperkingen zijn gelijk aan src/lib/omvormer.js', () => {
    expect(STORINGEN).toEqual(APP_STORINGEN);
    expect(BEPERKINGEN).toEqual(APP_BEPERKINGEN);
  });
});

describe('1.4.0: meer uit de omvormer, alleen lezen', () => {
  const gegevens = bekijkAntwoord(GW6000_DT, 73).gegevens;

  it('uit hetzelfde blok: busspanning, uren in bedrijf; de arbeidsfactor alleen als hij iets zegt', () => {
    const lezing = omvormerUit(gegevens);
    expect(lezing).toMatchObject({ bus_v: 601.2, uren: 8451 });
    // De registers zonder naam voor de kennislijst, nooit het fabrikantnummer (30171).
    expect(lezing.registers[30139]).toBe(0);
    expect(lezing.registers).not.toHaveProperty('30171');
    expect(Object.keys(registersUit(gegevens)).length).toBeLessThanOrEqual(73);
    // Een arbeidsfactor van 0,987 bij 1.835 W gaat mee; bij 20 W niet.
    expect(omvormerVoorApp({ ...lezing, pf: 0.987 }).pf).toBe(0.987);
    expect(omvormerVoorApp({ ...lezing, pf: 0.987, w: 20 })).not.toHaveProperty('pf');
  });

  it('isolatie (30173, aangenomen kΩ) en lekstroom (30210, tienden mA, met teken): wat niet kan is null', () => {
    expect(isolatieUit(1250)).toBe(1250);
    for (const v of [0, 0xffff, -1, 2.5, null]) expect(isolatieUit(v)).toBeNull();
    expect(lekstroomUit(125)).toBe(12.5);
    expect(lekstroomUit(0xffff - 49)).toBe(5);
    for (const v of [0xffff, 0x7fff, 0x8000, 0x8001, 70000, null]) expect(lekstroomUit(v)).toBeNull();
    expect(isolatieTekst(1250)).toBe('1,3 MΩ');
    expect(isolatieTekst(85)).toBe('85 kΩ');
  });

  it('metExtra: eens per minuut de twee registers, apart gevraagd; een geweigerd register niet meer; de gewone lezing gaat altijd door', async () => {
    let t = 0;
    const gevraagd = [];
    const vraag = async (_adres, register, aantal) => {
      gevraagd.push([register, aantal]);
      if (register === 30210) {
        const fout = new Error('de omvormer kent dit register niet');
        fout.code = 'GEWEIGERD';
        throw fout;
      }
      return Buffer.from([0x04, 0xe2]);
    };
    const lees = metExtra(async () => ({ stand: 'normaal', w: 1000, registers: { 30139: 990 } }), { vraag, klok: () => t });
    const eerste = await lees('192.168.1.30');
    expect(eerste).toMatchObject({ isolatie_kohm: 1250, registers: { 30139: 990, 30173: 1250 } });
    expect(eerste).not.toHaveProperty('lekstroom_ma');
    expect(gevraagd).toEqual([
      [30173, 1],
      [30210, 1],
    ]);
    t += 30_000;
    expect((await lees('192.168.1.30')).isolatie_kohm).toBe(1250);
    expect(gevraagd).toHaveLength(2);
    t += 30_000;
    await lees('192.168.1.30');
    expect(gevraagd.map(([r]) => r)).toEqual([30173, 30210, 30173]);
    // Geen antwoord op een extra: de gewone lezing blijft, zonder die waarde.
    const stil = metExtra(async () => ({ stand: 'normaal', w: 1 }), {
      vraag: async () => {
        throw Object.assign(new Error('geen antwoord'), { code: 'ETIMEDOUT' });
      },
    });
    expect(await stil('x')).toEqual({ stand: 'normaal', w: 1, registers: {} });
  });

  it("meldingen: pas na twee minuten buiten de grens, weg na vijf minuten goed; 's nachts blijft het zoals het was", () => {
    const v = omvormerMeldingVolger();
    const t0 = Date.UTC(2026, 9, 31, 9);
    expect(v.ronde({ stand: 'normaal', isolatie_kohm: 80, lekstroom_ma: 20 }, t0)).toEqual([]);
    expect(v.meldingen()).toEqual([]);
    const zinnen = v.ronde({ stand: 'normaal', isolatie_kohm: 75, lekstroom_ma: 20 }, t0 + 2 * 60_000);
    expect(zinnen).toEqual(['Omvormer, isolatie van de panelen: laag (75 kΩ); laat de installateur de panelen en kabels nakijken']);
    expect(v.meldingen()).toEqual([{ tekst: zinnen[0], sinds: t0 }]);
    // Slaapt hij: niets verandert.
    expect(v.ronde({ stand: 'slaapt' }, t0 + 60 * 60_000)).toEqual([]);
    expect(v.meldingen()).toHaveLength(1);
    // Weer goed: pas na vijf minuten weg.
    v.ronde({ stand: 'normaal', isolatie_kohm: 900 }, t0 + 61 * 60_000);
    expect(v.meldingen()).toHaveLength(1);
    expect(v.ronde({ stand: 'normaal', isolatie_kohm: 900 }, t0 + 66 * 60_000)).toEqual(['Omvormer, isolatie van de panelen: weer goed.']);
    expect(v.meldingen()).toEqual([]);
    // Lekstroom hoog, twee minuten lang.
    v.ronde({ stand: 'normaal', lekstroom_ma: GRENZEN.LEKSTROOM_HOOG_MA }, t0);
    v.ronde({ stand: 'normaal', lekstroom_ma: 180 }, t0 + 2 * 60_000);
    // Als melding naar de app (soort omvormer): de app zet hem ook in het Logboek.
    const meldingen = meldingenVoorApp({ homewizard: [] }, { problemen: new Map(), sinds: new Map(), omvormer: v.meldingen(), nu: t0 });
    expect(meldingen).toEqual([{ soort: 'omvormer', tekst: 'Omvormer, lekstroom: hoog (180 mA); laat de installateur de panelen en kabels nakijken', sinds: new Date(t0).toISOString() }]);
  });

  it('de grenzen zijn gelijk aan src/lib/omvormer.js', () => {
    expect(GRENZEN).toEqual(APP_GRENZEN);
  });
});
