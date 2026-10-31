import dgram from 'node:dgram';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { crc16, leesVerzoek } from './goodwe.mjs';
import { maakStuurder } from './omvormerPlan.mjs';
import * as sturen from './omvormerSturen.mjs';
import { bekijkSchrijfAntwoord, GRENS_REGISTER, leesGrens, leesSchakelaar, magSchrijven, magWaarde, omvormerVerbinding, SCHAKELAAR_REGISTER, SCHRIJFBAAR, schrijfGrens, schrijfSchakelaar, schrijfVerzoek, TOEGESTAAN, VRIJ } from './omvormerSturen.mjs';

const MAP = path.dirname(fileURLToPath(import.meta.url));

/** Een antwoord zoals de omvormer het geeft: AA 55 + kern + CRC (laag eerst) over de kern. */
const antwoord = (kern) => {
  const crc = crc16(Buffer.from(kern));
  return Buffer.concat([Buffer.from([0xaa, 0x55]), Buffer.from(kern), Buffer.from([crc & 0xff, crc >> 8])]);
};
/** Het antwoord op een leesverzoek van één register met deze waarde. */
const leesAntwoord = (waarde) => antwoord([0x7f, 0x03, 2, waarde >> 8, waarde & 0xff]);
/** Het antwoord op een schrijfverzoek: het verzoek terug. */
const schrijfAntwoord = (verzoek) => antwoord([...verzoek.subarray(0, 6)]);

describe('alleen twee schrijfacties: de grens (40336) en de schakelaar (40327), met een harde lijst', () => {
  it('de harde lijsten: grens 0, 10, … 100; schakelaar 0 of 1; verder niets', () => {
    expect(TOEGESTAAN).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(Object.isFrozen(TOEGESTAAN)).toBe(true);
    expect(VRIJ).toBe(100);
    expect(GRENS_REGISTER).toBe(40336);
    expect(SCHAKELAAR_REGISTER).toBe(40327);
    expect(Object.isFrozen(SCHRIJFBAAR)).toBe(true);
    expect(Object.isFrozen(SCHRIJFBAAR[SCHAKELAAR_REGISTER])).toBe(true);
    expect(Object.keys(SCHRIJFBAAR).map(Number).sort()).toEqual([40327, 40336]);
    expect(SCHRIJFBAAR[SCHAKELAAR_REGISTER]).toEqual([0, 1]);
  });

  it('elk register (0–65535): alleen deze twee met deze waarden geven een verzoek, al het andere een fout', { timeout: 30_000 }, () => {
    const goed = [];
    let fouten = 0;
    const gooit = (r, w) => {
      try {
        schrijfVerzoek(r, w);
        return false;
      } catch {
        return true;
      }
    };
    for (let r = 0; r <= 0xffff; r += 1) {
      if (r === GRENS_REGISTER || r === SCHAKELAAR_REGISTER) {
        for (let w = 0; w <= 0xffff; w += 1) {
          if (magSchrijven(r, w)) goed.push([r, w]);
          // Wat niet mag, moet een fout geven; wat mag, niet.
          if (gooit(r, w) === magSchrijven(r, w)) fouten += 1;
        }
      } else {
        // Andere registers: met de waarden die bij de twee wél mogen, en de randen; allemaal een fout.
        for (const w of [0, 1, 2, 10, 50, 100, 101, 0xffff]) if (magSchrijven(r, w) || !gooit(r, w)) fouten += 1;
      }
    }
    expect(fouten).toBe(0);
    expect(goed).toEqual([[SCHAKELAAR_REGISTER, 0], [SCHAKELAAR_REGISTER, 1], ...TOEGESTAAN.map((w) => [GRENS_REGISTER, w])]);
    // Een steekproef van andere registers geeft echt een fout voordat er iets is (40330/40331 = start/stop).
    for (const r of [0, 30100, 40326, 40328, 40330, 40331, 40335, 40337, 45000, 0xffff]) {
      for (const w of [0, 1, 100]) expect(() => schrijfVerzoek(r, w)).toThrow();
    }
  });

  it('elk verzoek dat eruit kan komen: 0x06 op 40336 of 40327, met een waarde uit de lijst, en een goede CRC', () => {
    const alle = [...TOEGESTAAN.map((w) => schrijfVerzoek(GRENS_REGISTER, w)), schrijfVerzoek(SCHAKELAAR_REGISTER, 0), schrijfVerzoek(SCHAKELAAR_REGISTER, 1)];
    expect(alle).toHaveLength(13);
    for (const v of alle) {
      expect(v).toHaveLength(8);
      expect([...v.subarray(0, 2)]).toEqual([0x7f, 0x06]);
      expect([[0x9d, 0x90], [0x9d, 0x87]]).toContainEqual([...v.subarray(2, 4)]);
      expect(v.readUInt16LE(6)).toBe(crc16(v.subarray(0, 6)));
    }
    expect(schrijfVerzoek(SCHAKELAAR_REGISTER, 1).toString('hex').slice(0, 12)).toBe('7f069d870001');
  });

  it('rare waarden (negatief, kommagetal, tekst, true/false, een lijst) en rare registers geven een fout', () => {
    for (const raar of [-10, 5, 10.5, 101, '100', null, undefined, NaN, Infinity, [100], { procent: 100 }, 'vrij', 'begrensd', true, false]) {
      expect(() => schrijfVerzoek(GRENS_REGISTER, raar)).toThrow();
      expect(() => schrijfVerzoek(SCHAKELAAR_REGISTER, raar === true || raar === false ? raar : raar)).toThrow();
    }
    for (const raar of ['40336', 40336.5, null, undefined, [40336], -40336]) expect(() => schrijfVerzoek(raar, 0)).toThrow();
    expect(magWaarde(50)).toBe(true);
    expect(magWaarde(55)).toBe(false);
  });

  it('alleen schrijfGrens en schrijfSchakelaar schrijven; er is geen uitgevoerde functie die een vrij register over UDP schrijft', () => {
    const functies = Object.keys(sturen).filter((k) => typeof sturen[k] === 'function').sort();
    expect(functies).toEqual(['bekijkSchrijfAntwoord', 'leesGrens', 'leesSchakelaar', 'magSchrijven', 'magWaarde', 'omvormerVerbinding', 'schrijfGrens', 'schrijfSchakelaar', 'schrijfVerzoek']);
    expect(Object.keys(omvormerVerbinding('127.0.0.1')).sort()).toEqual(['leesGrens', 'leesSchakelaar', 'schrijfGrens', 'schrijfSchakelaar']);
  });

  it('geen ander bestand van het programmaatje maakt een schrijfverzoek of rekent een Modbus-CRC', () => {
    const bestanden = fs.readdirSync(MAP).filter((f) => f.endsWith('.mjs'));
    for (const f of bestanden) {
      const tekst = fs.readFileSync(path.join(MAP, f), 'utf8');
      if (f === 'omvormerSturen.mjs') continue;
      if (f === 'goodwe.mjs') continue;
      // Alleen omvormerSturen.mjs maakt schrijfverzoeken (0x06) en rekent er een CRC voor.
      expect(tekst, f).not.toMatch(/schrijfVerzoek|schrijfRegister|schrijfGrens\(adres|schrijfSchakelaar\(adres|\b0x06\b|\b0x86\b/);
      expect(tekst, f).not.toMatch(/\bcrc16\(/);
    }
    // goodwe.mjs noemt 0x06 alleen in de uitleg; zijn enige verzoek is lezen (0x03).
    const goodwe = fs.readFileSync(path.join(MAP, 'goodwe.mjs'), 'utf8');
    expect(goodwe.match(/0x06/g)).toHaveLength(1);
    expect(goodwe).toMatch(/const LEES = 0x03;/);
    for (const [r, n] of [[30100, 73], [40336, 1], [40327, 1]]) expect(leesVerzoek(r, n)[1]).toBe(0x03);
    // De schrijvers over UDP worden alleen via omvormerVerbinding gebruikt (de besturing en de samen-test).
    const gebruikers = bestanden.filter((f) => /\bschrijf(Grens|Schakelaar)\b/.test(fs.readFileSync(path.join(MAP, f), 'utf8'))).sort();
    expect(gebruikers).toEqual(['omvormerPlan.mjs', 'omvormerSturen.mjs', 'omvormerTest.mjs']);
    for (const f of ['omvormerPlan.mjs', 'omvormerTest.mjs']) expect(fs.readFileSync(path.join(MAP, f), 'utf8'), f).not.toMatch(/import[^;]*\bschrijf(Grens|Schakelaar)\b[^;]*from/);
  });
});

describe('het antwoord op een schrijfverzoek', () => {
  it('goed: het verzoek terug', () => {
    expect(bekijkSchrijfAntwoord(schrijfAntwoord(schrijfVerzoek(GRENS_REGISTER, 0)), GRENS_REGISTER, 0)).toEqual({ ok: true });
    expect(bekijkSchrijfAntwoord(schrijfAntwoord(schrijfVerzoek(SCHAKELAAR_REGISTER, 1)), SCHAKELAAR_REGISTER, 1)).toEqual({ ok: true });
  });
  it('een andere waarde of een ander register terug: fout', () => {
    expect(bekijkSchrijfAntwoord(schrijfAntwoord(schrijfVerzoek(GRENS_REGISTER, 100)), GRENS_REGISTER, 0).fout).toBeTruthy();
    expect(bekijkSchrijfAntwoord(antwoord([0x7f, 0x06, 0x9d, 0x8b, 0, 0]), GRENS_REGISTER, 0).fout).toBeTruthy();
    // De schakelaar bevestigd waar de grens gevraagd was: fout.
    expect(bekijkSchrijfAntwoord(schrijfAntwoord(schrijfVerzoek(SCHAKELAAR_REGISTER, 0)), GRENS_REGISTER, 0).fout).toBeTruthy();
  });
  it('een weigering (0x86) heeft code GEWEIGERD; een half antwoord wacht', () => {
    expect(bekijkSchrijfAntwoord(antwoord([0x7f, 0x86, 0x02]), GRENS_REGISTER, 0).fout.code).toBe('GEWEIGERD');
    expect(bekijkSchrijfAntwoord(schrijfAntwoord(schrijfVerzoek(GRENS_REGISTER, 0)).subarray(0, 7), GRENS_REGISTER, 0)).toEqual({ half: true });
  });
  it('beschadigd: fout', () => {
    const b = Buffer.from(schrijfAntwoord(schrijfVerzoek(GRENS_REGISTER, 0)));
    b[9] ^= 0xff;
    expect(bekijkSchrijfAntwoord(b, GRENS_REGISTER, 0).fout.message).toMatch(/beschadigd/);
  });
});

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

/**
 * Een nep-GoodWe over UDP op 127.0.0.1 met de registers 40336 (grens) en 40327 (schakelaar).
 * Antwoordt op lezen en schrijven zoals de echte; `stil` = geen antwoord ('s nachts), `negeer` =
 * bevestigt wel, maar onthoudt het niet. Zoals bij Tim (31-10-2026): grens 2%, schakelaar uit.
 */
async function nepOmvormer({ grens = 2, schakelaar = 0, stil = false, negeer = false } = {}) {
  const s = dgram.createSocket('udp4');
  open.push(s);
  const staat = { grens, schakelaar, stil, negeer, verzoeken: [] };
  s.on('message', (v, van) => {
    staat.verzoeken.push(Buffer.from(v));
    if (staat.stil) return;
    const register = v.readUInt16BE(2);
    if (v[1] === 0x03) {
      const waarde = register === GRENS_REGISTER ? staat.grens : register === SCHAKELAAR_REGISTER ? staat.schakelaar : 0;
      s.send(leesAntwoord(waarde), van.port, van.address);
    } else if (v[1] === 0x06) {
      if (!staat.negeer) {
        if (register === GRENS_REGISTER) staat.grens = v.readUInt16BE(4);
        if (register === SCHAKELAAR_REGISTER) staat.schakelaar = v.readUInt16BE(4);
      }
      s.send(schrijfAntwoord(v), van.port, van.address);
    }
  });
  await new Promise((klaar) => s.bind(0, '127.0.0.1', klaar));
  return { poort: s.address().port, staat };
}

/** Elk verzoek dat de nep kreeg: lezen, of 0x06 op een van de twee registers met een toegestane waarde. */
const alleenToegestaan = (verzoeken) => {
  for (const v of verzoeken) {
    expect([0x03, 0x06]).toContain(v[1]);
    if (v[1] === 0x06) expect(magSchrijven(v.readUInt16BE(2), v.readUInt16BE(4))).toBe(true);
  }
};

describe('over UDP (nep-omvormer)', () => {
  it('schrijven, en teruglezen geeft de nieuwe waarde (grens en schakelaar)', async () => {
    const nep = await nepOmvormer();
    expect(await leesSchakelaar('127.0.0.1', { poort: nep.poort, tijd: 300 })).toBe(false);
    expect(await leesGrens('127.0.0.1', { poort: nep.poort, tijd: 300 })).toBe(2);
    await schrijfGrens('127.0.0.1', 30, { poort: nep.poort, tijd: 500 });
    expect(await leesGrens('127.0.0.1', { poort: nep.poort, tijd: 300 })).toBe(30);
    await schrijfSchakelaar('127.0.0.1', 1, { poort: nep.poort, tijd: 500 });
    expect(await leesSchakelaar('127.0.0.1', { poort: nep.poort, tijd: 300 })).toBe(true);
    expect(nep.staat.verzoeken[2].toString('hex')).toBe(schrijfVerzoek(GRENS_REGISTER, 30).toString('hex'));
  });

  it('geen antwoord: na de eindtijd ETIMEDOUT (ook bij lezen), en een waarde buiten de lijst gaat er nooit uit', async () => {
    const nep = await nepOmvormer({ stil: true });
    expect((await schrijfGrens('127.0.0.1', 0, { poort: nep.poort, tijd: 150 }).catch((f) => f)).code).toBe('ETIMEDOUT');
    await expect(schrijfGrens('127.0.0.1', 55, { poort: nep.poort, tijd: 150 })).rejects.toThrow();
    await expect(schrijfSchakelaar('127.0.0.1', 2, { poort: nep.poort, tijd: 150 })).rejects.toThrow();
    await expect(schrijfSchakelaar('127.0.0.1', true, { poort: nep.poort, tijd: 150 })).rejects.toThrow();
    expect(nep.staat.verzoeken).toHaveLength(1);
    await expect(leesSchakelaar('127.0.0.1', { poort: nep.poort, tijd: 100, pogingen: 1 })).rejects.toThrow();
  });

  it('een hele begrenzing met de echte verbinding: grens dan schakelaar aan; vrijgeven alleen de schakelaar uit; niets anders', async () => {
    const nep = await nepOmvormer();
    const verbinding = omvormerVerbinding('127.0.0.1', { poort: nep.poort, tijd: 400 });
    const stuurder = maakStuurder({ verbinding, gestart: 0 });
    const begin = Date.parse('2027-06-01T10:00:00Z');
    const kw = (i, zonder) => ({ van: begin + i * 900_000, tot: begin + (i + 1) * 900_000, afname_kwh: zonder + 0.13, teruglevering_kwh: zonder, zonnebonus_kwh: 0, zonder_belasting_kwh: zonder });
    const tijdvakken = [kw(0, 0.05), kw(1, -0.1), kw(2, -0.1), kw(3, 0.05)];
    stuurder.zetInstelling({ aan: true });
    let nu = begin + 900_000;
    for (let i = 0; i < 40; i += 1, nu += 5000) {
      // Zolang de schakelaar uit staat levert hij 4 kW; daarna wat de grens toelaat.
      const w = nep.staat.schakelaar ? Math.min(4000, 80 * nep.staat.grens) : 4000;
      await stuurder.ronde({ nu, tijdvakken, omvormerStand: 'normaal', meting: { netW: 1000 - w, zonW: w, batterijW: 0, omvormerW: w }, nominaal: 8000 });
    }
    expect(nep.staat.schakelaar).toBe(1);
    expect(nep.staat.grens).toBeLessThan(100);
    const schrijf = () => nep.staat.verzoeken.filter((v) => v[1] === 0x06).map((v) => [v.readUInt16BE(2), v.readUInt16BE(4)]);
    // Eerst de grens, dan de schakelaar aan; daarna alleen nog de grens bijstellen.
    const [eerste, tweede, ...rest] = schrijf();
    expect(eerste[0]).toBe(GRENS_REGISTER);
    expect(tweede).toEqual([SCHAKELAAR_REGISTER, 1]);
    for (const [r] of rest) expect(r).toBe(GRENS_REGISTER);
    const grensNu = nep.staat.grens;
    nu = begin + 3 * 900_000 + 1000;
    await stuurder.ronde({ nu, tijdvakken, omvormerStand: 'normaal', meting: { netW: 0, zonW: 1000, batterijW: 0, omvormerW: 1000 }, nominaal: 8000 });
    expect(nep.staat.schakelaar).toBe(0);
    expect(nep.staat.grens).toBe(grensNu);
    expect(schrijf().at(-1)).toEqual([SCHAKELAAR_REGISTER, 0]);
    alleenToegestaan(nep.staat.verzoeken);
  });
});
