import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bevestiging,
  CMD,
  crc32,
  dpsUit,
  ecbOntsleutel,
  ecbVersleutel,
  hunNonce,
  knipFrames,
  leesTuya,
  maakFrame55,
  maakFrame66,
  meldingUit,
  ontleedFrame55,
  ontleedFrame66,
  pakUit,
  sessieSleutel,
  standUit,
  statusVraag,
  tuyaVoorApp,
  tuyaVolger,
  verpak,
} from './tuya.mjs';

const hex = (h) => Buffer.from(h, 'hex');

/**
 * Echte opnames van een 3.3-apparaat (TuyaAPI/cli issue #23): de sleutel staat
 * er niet bij, dus alleen vorm, retcode en CRC zijn na te rekenen.
 */
const OPNAMES = [
  '000055aa000000010000000a0000002c00000001d3b9b5e2ddf04c73b46561a2c693302215c1a06219267c189a96e0dd4e12a2b75972a4090000aa55',
  '000055aa000000020000000a0000002c00000001d3b9b5e2ddf04c73b46561a2c693302215c1a06219267c189a96e0dd4e12a2b766b9da9c0000aa55',
  '000055aa000000010000000a0000002c00000001e43a9f9fb09424634104f66db124feee8e3bf2aeee7be51f9590b6b57c1fe62e4f61356e0000aa55',
];

/**
 * Gemaakt met tinytuya 1.17.4 zelf (pack_message, _encode_message en de
 * onderhandeling), met vaste nonces, iv ("0123456789ab", tinytuya in debug) en
 * tijd (1700000000). Het script staat in docs/tuya.md. Onze code moet precies
 * dezelfde bytes maken en dezelfde stand lezen.
 */
const T = {
  id: 'bf0123456789abcdefgh',
  sleutel: Buffer.from('0123456789abcdef'),
  onzeNonce: hex('000102030405060708090a0b0c0d0e0f'),
  hunNonce: hex('a0a1a2a3a4a5a6a7a8a9aaabacadaeaf'),
  v33_vraag:
    '000055aa000000010000000a00000078a582c52e5a14f42dc57e6b4371d0f7898f84c1b859b79478a8eff0e87abb16691d6e826df5b2d248589c9b1fe24d857c4d81a1c5a9ed3374f5bbddd8805697471289985ddcc6ad4334e0f2be9c78211b3257c3855eea3abd3a03de1f21fbaf54be23f34440aefb47c4fa7fbe7027af019a3d77ab0000aa55',
  v33_antwoord:
    '000055aa000000010000000a0000005c00000000cf86245f80a43fd581e9f874f8bade17f5a6c29e7d2e67261b300789f277913379644ab9afbda994a9f8a6c9cecdf2b25060aee53dbe19fc1bc26e0943cfa68d090e6def83d4888300bb006ec4d12cd0a96b1abe0000aa55',
  v33_push:
    '000055aa00000007000000080000004b00000000332e33000000000000000000000000f24799fe0fff17cc9f964a40989b0d28fb12a85a3b419a8cb06d33a519966398f191667f04a256520e014fe69c09eb406ff434270000aa55',
  v34_stap1:
    '000055aa000000010000000300000044a07999f0e2bfbe16f99593e984a449b7377222e061a924c591cd9c27ea163ed484a896dcb29647fa6e5c5024c9533704640e90001c9f4d52f8b4480cc12648340000aa55',
  v34_stap2:
    '000055aa00000001000000040000006800000000406871f93a854a151391cc3b39c48b80133d7ef10fca101a5416af7bf5abf5cc204370fd8642db07ea0c5c880c5bce11377222e061a924c591cd9c27ea163ed49b4b6a400767ece976a668d5f3e639cd70091ebcb88fa08237e0b6e237d82ea10000aa55',
  v34_stap3:
    '000055aa0000000200000005000000548a84e385425bec41b9d5ded844af642c166fe3289949db0b923ea515a0d29de1377222e061a924c591cd9c27ea163ed4981aac860a190d1f8178f3af73b1a43ea1091f00ffed7e4677013c0ebfbf8ed40000aa55',
  v34_sessie: 'd8fd43924531ff163d88ed8356caa028',
  v34_vraag: '000055aa0000000300000010000000345f6e32ccaa880d4e9b508e8da122830fe157db3be4466d53097fa54e17f08a72709170bd608632473291d85d84886edb0000aa55',
  v34_antwoord:
    '000055aa00000002000000100000008800000000c6ccd08f60c6fa1bb9c1dfb1923a8d0e6781ee4517c488800e8e00e30cabfdab0c38dbe7f2c64fb286eb546ead91c28c0e218561ed37ef50fcb590d3fb33b59adcf5f020c8235c05b214ffc7bcee0dbf6a1d00e4caa3c82160e598c6277d60b8ef65dc2d7c7384bcb09efef79c5a60d2a94c392711cec2df9ea55999ba3e83310000aa55',
  v35_stap1: '00006699000000000001000000030000002c30313233343536373839616262430ff82a652b8e0b0a7def88d7adfc6000fd18e76537d5e2dcc0a08c7b3fb000009966',
  v35_stap2:
    '0000669900000000000100000004000000506162636465666768696a6b6ce5d27cb5f304fb06fd95129d5e9775a2a6b8424888836f7a1ac873eaa8c87cbcb6199f71bd2f4af03708b98beecfd338a57ee96d69b32b8b79b5e70bc3f3a406939996f800009966',
  v35_stap3:
    '00006699000000000002000000050000003c3031323334353637383961622ff334f77243b081aea6db368f72d8e98ec989831e2e8db6b1a323da8c4641c55e282c2306cf0cfdaa8d6d2265bc3a5e00009966',
  v35_sessie: '5d9f64bdbed49b964886a7ba603b108d',
  v35_vraag: '00006699000000000003000000100000001e3031323334353637383961621add05149c5a2a92f782b833f6298ae6576900009966',
  v35_antwoord:
    '0000669900000000000200000010000000706d6e6f70717273747576777822fc19a09d08d163f5a6ab683ea63e4edfb1ed40f288cc267651bf25d687f43d2e182ad30e1002907036e4caa6b5a0b929d78db02ac86bc9a8714e9c48b97f38493963ea43ab6dda6edb36202894e60bc5748515ca67bd31ad4c3481acde902e4bd0898000009966',
  udp_6667:
    '000055aa00000000000000130000009c00000000d09766676f3369eb10b5e9f132fd802a92e830c6c0e3601a7d3909c39a7fb612482611d8caa5248ac6cea65bdad007dfa41f010dca2abb30c50459a9f88024ffcb5924bb8792fe5eae7c9040e5921a98017f2170860421e6fc66f0a1ade138915fde850cd157270c5f3d1ab5ae90b3005ade4fdaaa79bad2b48194c150e26daebcc651832dd9b60158654b01a12a9a52c74ebd6e0000aa55',
};
const IV = Buffer.from('0123456789ab');
const NU = 1_700_000_000_000;

describe('frames: echte opnames', () => {
  it('3.3: kop, retcode 1 (een fout van het apparaat) en de CRC32 kloppen', () => {
    for (const h of OPNAMES) {
      const { frames, rest } = knipFrames(hex(h));
      expect(frames).toHaveLength(1);
      expect(rest.length).toBeLessThan(4);
      const f = ontleedFrame55(frames[0]);
      expect(f).toMatchObject({ cmd: CMD.DP_QUERY, retcode: 1, klopt: true });
      expect(f.data).toHaveLength(32);
    }
  });

  it('een veranderde byte: de CRC klopt niet meer', () => {
    const kapot = hex(OPNAMES[0]);
    kapot[30] ^= 1;
    expect(ontleedFrame55(kapot).klopt).toBe(false);
  });

  it('crc32 zoals zlib', () => {
    expect(crc32(Buffer.from('123456789')).toString(16)).toBe('cbf43926');
  });

  it('AES-128-ECB: het echte voorbeeld uit TuyAPI (test/cipher.js)', () => {
    const tekst = Buffer.from('zrA8OK3r3JMiUXpXDWauNppY4Am2c8rZ6sb4Yf15MjM8n5ByDx+QWeCZtcrPqddxLrhm906bSKbQAFtT1uCp+zP5AxlqJf5d0Pp2OxyXyjg=', 'base64');
    const sleutel = Buffer.from('bbe88b3f4106d354');
    const json = JSON.parse(ecbOntsleutel(sleutel, tekst).toString());
    expect(json).toEqual({ devId: '002004265ccf7fb1b659', dps: { 1: false, 2: 0 }, t: 1529442366, s: 8 });
    expect(ecbVersleutel(sleutel, Buffer.from(JSON.stringify(json)))).toEqual(tekst);
    expect(dpsUit(tekst, { versie: '3.3', sleutel })).toEqual({ 1: false, 2: 0 });
  });

  it('rommel voor het voorvoegsel valt weg; een half frame wacht op de rest', () => {
    const heel = hex(OPNAMES[0]);
    const { frames, rest } = knipFrames(Buffer.concat([Buffer.from('xyz'), heel, heel.subarray(0, 10)]));
    expect(frames).toHaveLength(1);
    expect(rest).toEqual(heel.subarray(0, 10));
  });
});

describe('3.3, zoals tinytuya', () => {
  it('de statusvraag: dezelfde bytes', () => {
    const { cmd, data } = statusVraag({ versie: '3.3', id: T.id, nu: NU });
    expect(cmd).toBe(CMD.DP_QUERY);
    expect(data.toString()).toBe(`{"gwId":"${T.id}","devId":"${T.id}","uid":"${T.id}","t":"1700000000"}`);
    expect(verpak({ versie: '3.3', seqno: 1, cmd, data, sleutel: T.sleutel }).toString('hex')).toBe(T.v33_vraag);
  });

  it('het antwoord en een melding met "3.3"-kop', () => {
    const a = pakUit(hex(T.v33_antwoord), { versie: '3.3', sleutel: T.sleutel });
    expect(a).toMatchObject({ cmd: CMD.DP_QUERY, retcode: 0, klopt: true });
    expect(dpsUit(a.data, { versie: '3.3', sleutel: T.sleutel })).toEqual({ 1: true, 18: 1234, 19: 2875, 20: 2311 });
    const p = pakUit(hex(T.v33_push), { versie: '3.3', sleutel: T.sleutel });
    expect(dpsUit(p.data, { versie: '3.3', sleutel: T.sleutel })).toEqual({ 1: false });
  });

  it('verkeerde sleutel: een fout in gewone woorden', () => {
    const a = pakUit(hex(T.v33_antwoord), { versie: '3.3', sleutel: T.sleutel });
    expect(() => dpsUit(a.data, { versie: '3.3', sleutel: Buffer.from('fedcba9876543210') })).toThrow(/sleutel/);
  });
});

for (const versie of ['3.4', '3.5']) {
  const v = versie === '3.4' ? 'v34' : 'v35';
  describe(`${versie}, zoals tinytuya`, () => {
    it('de afspraak over de sessiesleutel: dezelfde bytes en dezelfde sleutel', () => {
      expect(verpak({ versie, seqno: 1, cmd: CMD.SESSIE_START, data: T.onzeNonce, sleutel: T.sleutel, iv: IV }).toString('hex')).toBe(T[`${v}_stap1`]);
      const antwoord = pakUit(hex(T[`${v}_stap2`]), { versie, sleutel: T.sleutel });
      expect(antwoord).toMatchObject({ cmd: CMD.SESSIE_ANTWOORD, retcode: 0, klopt: true });
      const zijne = hunNonce(antwoord.data, { versie, localKey: T.sleutel, nonce: T.onzeNonce });
      expect(zijne).toEqual(T.hunNonce);
      const b = bevestiging(T.sleutel, zijne);
      expect(verpak({ versie, seqno: 2, cmd: CMD.SESSIE_KLAAR, data: b, sleutel: T.sleutel, iv: IV }).toString('hex')).toBe(T[`${v}_stap3`]);
      const sessie = sessieSleutel({ versie, localKey: T.sleutel, nonce: T.onzeNonce, zijne });
      expect(sessie.toString('hex')).toBe(T[`${v}_sessie`]);
    });

    it('de statusvraag (cmd 0x10 met {}) en het antwoord met de sessiesleutel', () => {
      const sessie = hex(T[`${v}_sessie`]);
      const { cmd, data } = statusVraag({ versie, id: T.id, nu: NU });
      expect(cmd).toBe(CMD.DP_QUERY_NEW);
      expect(data.toString()).toBe('{}');
      expect(verpak({ versie, seqno: 3, cmd, data, sleutel: sessie, iv: IV }).toString('hex')).toBe(T[`${v}_vraag`]);
      const a = pakUit(hex(T[`${v}_antwoord`]), { versie, sleutel: sessie });
      expect(a.klopt).toBe(true);
      expect(dpsUit(a.data, { versie, sleutel: sessie })).toEqual({ 20: true, 22: 640 });
    });

    it('verkeerde local_key: duidelijk gezegd', () => {
      const fout = Buffer.from('fedcba9876543210');
      if (versie === '3.4') {
        const a = pakUit(hex(T.v34_stap2), { versie, sleutel: fout });
        expect(a.klopt).toBe(false);
        expect(() => hunNonce(a.data, { versie, localKey: fout, nonce: T.onzeNonce })).toThrow();
      } else {
        expect(ontleedFrame66(hex(T.v35_stap2), fout).klopt).toBe(false);
      }
      const goed = pakUit(hex(T[`${v}_stap2`]), { versie, sleutel: T.sleutel });
      expect(() => hunNonce(goed.data, { versie, localKey: T.sleutel, nonce: Buffer.alloc(16) })).toThrow(/local_key klopt niet/);
    });
  });
}

describe('alleen lezen', () => {
  it('schakelen (CONTROL 7, CONTROL_NEW 0x0d) en andere opdrachten kunnen we niet eens maken', () => {
    for (const cmd of [7, 0x0d, 0x11, 0x12, 1, 6]) {
      expect(() => maakFrame55({ seqno: 1, cmd, data: Buffer.alloc(16) })).toThrow(/alleen lezen/);
      expect(() => maakFrame66({ seqno: 1, cmd, data: Buffer.alloc(16), sleutel: T.sleutel })).toThrow(/alleen lezen/);
    }
  });

  it('een verkeerde versie zegt welke het wel is', () => {
    expect(() => pakUit(hex(T.v35_stap2), { versie: '3.3', sleutel: T.sleutel })).toThrow(/3\.5/);
    expect(() => pakUit(hex(T.v34_stap2), { versie: '3.5', sleutel: T.sleutel })).toThrow(/geen 3\.5/);
  });

  it('foutteksten van een apparaat in gewone woorden', () => {
    const data = ecbVersleutel(T.sleutel, Buffer.from('json obj data unvalid'));
    expect(() => dpsUit(data, { versie: '3.3', sleutel: T.sleutel })).toThrow(/oud type/);
    expect(dpsUit(Buffer.alloc(0), { versie: '3.3', sleutel: T.sleutel })).toBeNull();
  });
});

describe('UDP-melding (alleen luisteren)', () => {
  it('3.3 op poort 6667, zoals tinytuya decrypt_udp', () => {
    expect(meldingUit(hex(T.udp_6667))).toEqual({ id: T.id, adres: '192.168.1.44', versie: '3.3' });
  });
  it('rommel: null', () => {
    expect(meldingUit(Buffer.from('hallo'))).toBeNull();
    expect(meldingUit(Buffer.alloc(0))).toBeNull();
  });
});

describe('datapunten', () => {
  it('meter: 19 is vermogen × 0,1 W; uit zonder vermogen is 0 W', () => {
    const pomp = { wat: 'meter' };
    expect(standUit(pomp, { 1: true, 18: 1234, 19: 2875, 20: 2311 })).toEqual({ aan: true, w: 287.5, helderheid: null });
    expect(standUit(pomp, { 1: false })).toEqual({ aan: false, w: 0, helderheid: null });
    expect(standUit({ wat: 'meter', dp: { aan: 1, vermogen: 19, schaal: 0 } }, { 1: true, 19: 40 }).w).toBe(40);
  });
  it('lamp: 20 en 22 (10–1000), of een oudere met 1 en 3 (25–255); uit zonder helderheid', () => {
    expect(standUit({ wat: 'lamp' }, { 20: true, 22: 640 })).toEqual({ aan: true, w: null, helderheid: 64 });
    expect(standUit({ wat: 'lamp' }, { 20: false, 22: 640 })).toEqual({ aan: false, w: null, helderheid: null });
    expect(standUit({ wat: 'lamp' }, { 1: true, 3: 255 }).helderheid).toBe(100);
    expect(standUit({ wat: 'schakelaar' }, { 1: true })).toEqual({ aan: true, w: null, helderheid: null });
    expect(standUit({ wat: 'schakelaar' }, {})).toEqual({ aan: null, w: null, helderheid: null });
  });
  it('voor de app: meters bij apparaten, lampen en schakelaars apart', () => {
    const uit = tuyaVoorApp([
      { apparaat: { sleutel: 'tuya-pomp', naam: 'Pomp', wat: 'meter', soort: 'pomp' }, stand: { aan: true, w: 287.5 } },
      { apparaat: { sleutel: 'tuya-spots', naam: 'Spots', wat: 'lamp', spots: true }, stand: { aan: true, helderheid: 64 } },
      { apparaat: { sleutel: 'tuya-lamp', naam: 'Lamp', wat: 'schakelaar' }, stand: null },
    ]);
    expect(uit).toEqual({
      apparaten: [{ sleutel: 'tuya-pomp', naam: 'Pomp', soort: 'pomp', vermogen_w: 288 }],
      lampen: [
        { sleutel: 'tuya-spots', naam: 'Spots', soort: 'lamp', aan: true, helderheid: 64, rol: 'spots' },
        { sleutel: 'tuya-lamp', naam: 'Lamp', soort: 'schakelaar', aan: null },
      ],
    });
  });
});

describe('tuyaVolger: hooguit eens per 20 s per apparaat', () => {
  it('tussendoor de laatste stand; een misser houdt hem tot hij te oud is', async () => {
    let klok = 0;
    let keer = 0;
    let fout = null;
    const lees = async () => {
      keer += 1;
      if (fout) throw fout;
      return { 1: true, 19: 500 };
    };
    const volger = tuyaVolger([{ sleutel: 'tuya-pomp', wat: 'meter' }], { lees, klok: () => klok });
    expect((await volger.ronde())[0]).toMatchObject({ stand: { w: 50 }, gelezen: true, fout: null });
    klok = 5000;
    expect((await volger.ronde())[0]).toMatchObject({ stand: { w: 50 }, gelezen: false });
    expect(keer).toBe(1);
    fout = new Error('weg');
    klok = 20_000;
    expect((await volger.ronde())[0]).toMatchObject({ stand: { w: 50 }, gelezen: true, fout });
    klok = 100_000;
    expect((await volger.ronde())[0]).toMatchObject({ stand: null, fout });
    expect(keer).toBe(3);
  });
});

/* ---------- Een nep-Tuya-apparaat in node:net ---------- */

let servers = [];
afterEach(() => {
  for (const s of servers) s.close();
  servers = [];
});

/**
 * Een nep-apparaat dat de berichten van tinytuya afspeelt: het kijkt of wat
 * binnenkomt precies is wat tinytuya zou sturen (3.3, 3.4) of ontsleutelt het
 * (3.5, onze iv is willekeurig), en antwoordt met de opgenomen frames.
 */
function nepApparaat(versie, { zwijg = false, sluit = false } = {}) {
  const gezien = [];
  const server = net.createServer((sock) => {
    let binnen = Buffer.alloc(0);
    let sleutel = T.sleutel;
    sock.on('data', (stuk) => {
      binnen = Buffer.concat([binnen, stuk]);
      const { frames, rest } = knipFrames(binnen);
      binnen = rest;
      for (const f of frames) {
        if (zwijg) continue;
        if (sluit) return sock.destroy();
        const cmd = f.readUInt32BE(versie === '3.5' ? 10 : 8);
        gezien.push(cmd);
        if (versie === '3.5') {
          const b = ontleedFrame66(f, sleutel, { retcode: false });
          if (!b.klopt) return sock.destroy();
          if (cmd === CMD.SESSIE_START) sock.write(hex(T.v35_stap2));
          if (cmd === CMD.SESSIE_KLAAR) sleutel = hex(T.v35_sessie);
          if (cmd === CMD.DP_QUERY_NEW) sock.write(hex(T.v35_antwoord));
          continue;
        }
        const h = f.toString('hex');
        if (versie === '3.3' && h === T.v33_vraag) sock.write(hex(T.v33_antwoord));
        else if (versie === '3.4' && h === T.v34_stap1) sock.write(hex(T.v34_stap2));
        else if (versie === '3.4' && h === T.v34_stap3) continue;
        else if (versie === '3.4' && h === T.v34_vraag) sock.write(hex(T.v34_antwoord));
        else sock.destroy();
      }
    });
  });
  servers.push(server);
  return new Promise((klaar) => server.listen(0, '127.0.0.1', () => klaar({ poort: server.address().port, gezien })));
}

const apparaat = (versie) => ({ adres: '127.0.0.1', id: T.id, local_key: '0123456789abcdef', versie });

describe('leesTuya met een nep-apparaat', () => {
  for (const versie of ['3.3', '3.4', '3.5']) {
    it(`${versie}: verbinden, (sessiesleutel,) statusvraag, stand`, async () => {
      const { poort, gezien } = await nepApparaat(versie);
      const dps = await leesTuya(apparaat(versie), { poort, nonce: T.onzeNonce, nu: () => NU });
      expect(dps).toEqual(versie === '3.3' ? { 1: true, 18: 1234, 19: 2875, 20: 2311 } : { 20: true, 22: 640 });
      expect(gezien.every((cmd) => [CMD.SESSIE_START, CMD.SESSIE_KLAAR, CMD.DP_QUERY, CMD.DP_QUERY_NEW].includes(cmd))).toBe(true);
    });
  }

  it('zegt het apparaat niets: binnen de eindtijd een fout', async () => {
    const { poort } = await nepApparaat('3.3', { zwijg: true });
    const begin = Date.now();
    await expect(leesTuya(apparaat('3.3'), { poort, tijd: 300, nu: () => NU })).rejects.toThrow(/geen antwoord/);
    expect(Date.now() - begin).toBeLessThan(2000);
  });

  it('sluit het apparaat de verbinding: een fout, geen hangen', async () => {
    const { poort } = await nepApparaat('3.4', { sluit: true });
    await expect(leesTuya(apparaat('3.4'), { poort, tijd: 2000, nonce: T.onzeNonce })).rejects.toThrow(/verbinding viel weg/);
  });

  it('verkeerde local_key bij 3.4: dat zegt hij', async () => {
    const { poort } = await nepApparaat('3.4');
    await expect(leesTuya({ ...apparaat('3.4'), local_key: 'fedcba9876543210' }, { poort, tijd: 2000, nonce: T.onzeNonce })).rejects.toThrow();
  });

  it('niemand op het adres: een fout', async () => {
    const { poort } = await nepApparaat('3.3');
    servers.pop().close();
    await expect(leesTuya(apparaat('3.3'), { poort, tijd: 1000 })).rejects.toThrow();
  });
});
