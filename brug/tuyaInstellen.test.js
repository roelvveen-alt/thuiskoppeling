import { describe, expect, it } from 'vitest';
import { instellingenUitAntwoorden, samenvatting, voerUit } from './instellen.mjs';
import { vraagTuya } from './tuyaInstellen.mjs';

const GEHEIM = 'S3CR3TS3CR3TS3CR3TS3CR3TS3CR3T00';
const ACCESS_ID = 'abcdefghijklmnopqrst';

const CLOUD = [
  { id: 'bf11111111111111111111', naam: 'Pomp', local_key: 'aaaaaaaaaaaaaaaa', product: 'DIN-schakelaar', categorie: 'dlq', online: true, sub: false, dp: { aan: 1, vermogen: 19, schaal: 1 }, wat: 'meter' },
  { id: 'bf22222222222222222222', naam: 'Spots overstek', local_key: 'bbbbbbbbbbbbbbbb', product: 'Lamp', categorie: 'dj', online: true, sub: false, dp: {}, wat: 'lamp' },
  { id: 'bf33333333333333333333', naam: 'Lamp schuur', local_key: 'cccccccccccccccc', product: 'Schakelaar', categorie: 'kg', online: false, sub: false, dp: { aan: 1 }, wat: 'schakelaar' },
  { id: 'bf44444444444444444444', naam: 'Deurbel', local_key: 'dddddddddddddddd', product: 'Zigbee', categorie: 'wxkg', online: true, sub: true, dp: {}, wat: null },
];

class Opnieuw extends Error {}

/** Zoals vragenMet in instellen.mjs: vragen tot het antwoord klopt. */
function nep(antwoorden) {
  const rest = [...antwoorden];
  const uit = { tekst: [], vragen: [] };
  const vraag = async (tekst, { geheim = false } = {}) => {
    uit.vragen.push({ tekst, geheim });
    if (uit.vragen.length > 100) throw new Error(`blijft vragen: ${tekst}`);
    return rest.length ? rest.shift() : '';
  };
  const zeg = (t) => uit.tekst.push(t);
  const herhaal = async (tekst, lees, opties) => {
    for (;;) {
      try {
        return lees(await vraag(tekst, opties));
      } catch (fout) {
        if (!(fout instanceof Opnieuw)) throw fout;
        zeg(fout.message);
      }
    }
  };
  const jaNee = (tekst, standaard) =>
    herhaal(tekst, (t) => {
      const k = t.trim().toLowerCase();
      if (!k) return standaard;
      if (['j', 'ja'].includes(k)) return true;
      if (['n', 'nee'].includes(k)) return false;
      throw new Opnieuw('j of n');
    });
  const opnieuw = (u) => {
    throw new Opnieuw(u);
  };
  return { uit, zeg, herhaal, jaNee, opnieuw };
}

const gelezen = [];
const lees = async (a) => {
  gelezen.push(a.id);
  if (a.wat === 'meter') return { 1: true, 19: 4120 };
  if (a.id === 'bf33333333333333333333') throw new Error('geen antwoord binnen 5 s');
  return { 20: true, 22: 1000 };
};

describe('vraagTuya', () => {
  it('ophalen, luisteren en per apparaat kiezen; het Access Secret geheim en niet bewaard', async () => {
    const { uit, ...hulp } = nep([
      'j', // koppelen
      ACCESS_ID,
      GEHEIM,
      '', // Central Europe
      '', // Pomp: meter (voorstel)
      '', // naam Pomp
      '', // Spots: lamp (voorstel)
      '', // naam
      '', // spots? ja (uit de naam)
      '3', // Lamp schuur: schakelaar
      '', // naam
      '192.168.1.52', // niet gehoord: adres
      '3.5', // versie
      'n', // geen spots
    ]);
    let gevraagd = null;
    const lijst = await vraagTuya({
      oud: null,
      ...hulp,
      haal: async (o) => {
        gevraagd = o;
        return CLOUD;
      },
      luister: async () => [
        { id: 'bf11111111111111111111', adres: '192.168.1.50', versie: '3.4' },
        { id: 'bf22222222222222222222', adres: '192.168.1.51', versie: '3.3' },
      ],
      lees,
    });
    expect(gevraagd).toEqual({ accessId: ACCESS_ID, secret: GEHEIM, regio: 'eu' });
    expect(lijst).toEqual([
      { naam: 'Pomp', id: 'bf11111111111111111111', local_key: 'aaaaaaaaaaaaaaaa', adres: '192.168.1.50', versie: '3.4', wat: 'meter', soort: 'pomp', dp: { aan: 1, vermogen: 19, schaal: 1 } },
      { naam: 'Spots overstek', id: 'bf22222222222222222222', local_key: 'bbbbbbbbbbbbbbbb', adres: '192.168.1.51', versie: '3.3', wat: 'lamp', spots: true },
      { naam: 'Lamp schuur', id: 'bf33333333333333333333', local_key: 'cccccccccccccccc', adres: '192.168.1.52', versie: '3.5', wat: 'schakelaar', dp: { aan: 1 } },
    ]);
    const tekst = uit.tekst.join('\n');
    expect(tekst).toMatch(/Nu: aan · 412 W/);
    expect(tekst).toMatch(/Nu: aan · 100%/);
    expect(tekst).toMatch(/Uitlezen lukte nog niet: geen antwoord/);
    expect(tekst).toMatch(/achter een gateway/);
    expect(tekst).not.toContain(GEHEIM);
    expect(tekst).not.toContain('aaaaaaaaaaaaaaaa');
    expect(uit.vragen.find((v) => v.tekst.startsWith('Access Secret')).geheim).toBe(true);
    expect(JSON.stringify(lijst)).not.toContain(GEHEIM);
    expect(JSON.stringify(lijst)).not.toContain(ACCESS_ID);
  });

  it('Enter: geen Tuya; met een bestaande lijst blijft die zoals hij was', async () => {
    const leeg = nep([]);
    expect(await vraagTuya({ oud: null, ...leeg, haal: async () => CLOUD, luister: async () => [], lees })).toEqual([]);
    const bestaand = [{ naam: 'Pomp', id: 'bf11111111111111111111', local_key: 'aaaaaaaaaaaaaaaa', adres: '192.168.1.50', versie: '3.4', wat: 'meter' }];
    const houd = nep([]);
    expect(await vraagTuya({ oud: { tuya: bestaand }, ...houd, haal: async () => CLOUD, luister: async () => [], lees })).toEqual(bestaand);
  });

  it('de cloud weigert: dat zegt hij, en de oude lijst blijft', async () => {
    const bestaand = [{ naam: 'Pomp', id: 'bf11111111111111111111', local_key: 'aaaaaaaaaaaaaaaa', adres: '192.168.1.50', versie: '3.4', wat: 'meter' }];
    const { uit, ...hulp } = nep(['j', ACCESS_ID, GEHEIM, '2']);
    let regio = null;
    const lijst = await vraagTuya({
      oud: { tuya: bestaand },
      ...hulp,
      haal: async (o) => {
        regio = o.regio;
        throw new Error('Tuya weigert de handtekening: klopt het Access Secret?');
      },
      luister: async () => [],
      lees,
    });
    expect(regio).toBe('weu');
    expect(lijst).toEqual(bestaand);
    expect(uit.tekst.join('\n')).toMatch(/Dat lukte niet: Tuya weigert/);
  });
});

describe('in de hele instelhulp', () => {
  it('Tuya komt in instellingen.json, de samenvatting noemt geen local key', async () => {
    let bewaard = null;
    const antwoorden = [
      '', // netwerk: verder zonder
      'n', // Zendure via de cloud
      'n', // Zonneplan
      'n', // EnergyZero
      '', // app-adres later
      '', // sleutel later
      'j', // Tuya
      ACCESS_ID,
      GEHEIM,
      '',
      '', // Pomp: meter
      '', // naam
    ];
    const tekst = [];
    const uit = await voerUit({
      vraag: async () => (antwoorden.length ? antwoorden.shift() : ''),
      zeg: (t) => tekst.push(t),
      zoek: async () => [],
      maakCode: async () => null,
      zonneplanLogin: async () => {},
      bewaar: (ruw) => {
        bewaard = ruw;
      },
      tuya: { haal: async () => CLOUD.slice(0, 1), luister: async () => [{ id: CLOUD[0].id, adres: '192.168.1.50', versie: '3.4' }], lees },
    });
    expect(uit.bewaard).toBe(true);
    expect(bewaard.tuya).toEqual([expect.objectContaining({ naam: 'Pomp', local_key: 'aaaaaaaaaaaaaaaa', versie: '3.4', wat: 'meter' })]);
    expect(tekst.join('\n')).toMatch(/Pomp: Tuya 3\.4, meter, 192\.168\.1\.50, local key bewaard/);
    expect(tekst.join('\n')).not.toContain('aaaaaaaaaaaaaaaa');
    expect(tekst.join('\n')).not.toContain(GEHEIM);
  });

  it('samenvatting en antwoorden zonder Tuya: zoals vroeger', () => {
    const r = instellingenUitAntwoorden({ meters: [{ naam: 'Meterkast', rol: 'net', adres: '192.168.1.20' }], tuya: [] });
    expect(r.ok).toBe(true);
    expect(r.ruw.tuya).toBeUndefined();
    expect(samenvatting(r.ruw).join('\n')).not.toMatch(/Tuya/);
  });
});
