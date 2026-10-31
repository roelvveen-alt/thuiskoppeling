import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { vingerafdrukVan } from '../base44/shared/opAfstand.js';
import { versleutel, vingerafdruk as siteVingerafdruk } from '../src/lib/opAfstand.js';
import { gemeldVoorApp, kortAfdruk, laadOfMaak, leesPubliek, maakSleutelpaar, padNaast, pakOp, vingerafdruk } from './opAfstand.mjs';
import { verstuur } from './versturen.mjs';

const CLOUDSLEUTEL = Buffer.from('https://app.zendure.tech/eu.Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op56').toString('base64');
const INSTELLINGEN = {
  app: { adres: 'https://voorbeeld.base44.app/functions/ontvangMeting', sleutel: '0123456789abcdef'.repeat(3) },
  homewizard: [{ naam: 'Meterkast', rol: 'net', adres: '172.16.0.20' }],
  zendure: { manier: 'lokaal', adres: '172.16.0.30' },
};

const mappen = [];
afterEach(() => {
  for (const m of mappen.splice(0)) fs.rmSync(m, { recursive: true, force: true });
});

function thuis(instellingen = INSTELLINGEN) {
  const map = fs.mkdtempSync(path.join(os.tmpdir(), 'op-afstand-'));
  mappen.push(map);
  const instellingenPad = path.join(map, 'instellingen.json');
  fs.writeFileSync(instellingenPad, JSON.stringify(instellingen), { mode: 0o600 });
  const regels = [];
  const log = (t) => regels.push(t);
  const staat = laadOfMaak(padNaast(instellingenPad), { log });
  return { map, instellingenPad, staat, regels, log, lees: () => JSON.parse(fs.readFileSync(instellingenPad, 'utf8')) };
}

const stuk = async (staat, waarde = CLOUDSLEUTEL, op = '2026-10-30T15:00:00.000Z', publiek = staat.publiek) => ({
  veld: 'zendure.cloudsleutel',
  op,
  ...(await versleutel(publiek, 'zendure.cloudsleutel', waarde)),
});

describe('het sleutelpaar (op-afstand.json)', () => {
  it('de eerste keer gemaakt, alleen voor jou (0600), daarna hetzelfde', () => {
    const { map, staat, regels, log } = thuis();
    const pad = path.join(map, 'op-afstand.json');
    expect(fs.existsSync(pad)).toBe(true);
    if (process.platform !== 'win32') expect(fs.statSync(pad).mode & 0o777).toBe(0o600);
    expect(staat.voor).toMatch(/^[0-9a-f]{32}$/);
    expect(regels).toHaveLength(1);
    const weer = laadOfMaak(pad, { log });
    expect(weer.publiek).toBe(staat.publiek);
    expect(regels).toHaveLength(1);
    // Alleen het publieke deel gaat naar de app.
    expect(staat.publiek).not.toMatch(/PRIVATE/);
  });

  it('kapot of niet bij elkaar horend: een nieuw sleutelpaar, met één regel', () => {
    const { map, staat, log, regels } = thuis();
    const pad = path.join(map, 'op-afstand.json');
    fs.writeFileSync(pad, '{ kapot');
    const nieuw = laadOfMaak(pad, { log });
    expect(nieuw.publiek).not.toBe(staat.publiek);
    expect(regels.at(-1)).toMatch(/klopte niet; ik heb een nieuw sleutelpaar/);
    // Een ander publiek deel bij dit privé-deel: ook niet goed.
    fs.writeFileSync(pad, JSON.stringify({ prive: nieuw.prive, publiek: staat.publiek }));
    expect(laadOfMaak(pad, { log }).publiek).not.toBe(staat.publiek);
  });

  it('lukt het niet (map weg of alleen-lezen), dan null en de rest gaat door', () => {
    const regels = [];
    expect(laadOfMaak('/bestaat/niet/op-afstand.json', { log: (t) => regels.push(t) })).toBeNull();
    expect(regels[0]).toMatch(/de rest werkt gewoon/);
  });
});

describe('oppakken wat de app klaarzette', () => {
  it('de cloudsleutel komt als reserve in instellingen.json; één regel, nooit de sleutel zelf', async () => {
    const { instellingenPad, staat, log, regels, lees, map } = thuis();
    regels.length = 0;
    const uit = pakOp([await stuk(staat)], staat, { instellingenPad, log });
    expect(uit.veranderd).toBe(true);
    expect(lees().zendure).toEqual({ manier: 'lokaal', adres: '172.16.0.30', cloudsleutel: CLOUDSLEUTEL });
    expect(lees().homewizard).toEqual(INSTELLINGEN.homewizard);
    if (process.platform !== 'win32') expect(fs.statSync(instellingenPad).mode & 0o777).toBe(0o600);
    expect(regels).toEqual(['Op afstand ingesteld: de Zendure-cloudsleutel (als reserve); ik start opnieuw met de nieuwe instellingen.']);
    expect(regels.join('')).not.toContain(CLOUDSLEUTEL);
    // Wat terug naar de app gaat, ook na een herstart.
    expect(gemeldVoorApp(staat)).toEqual([{ veld: 'zendure.cloudsleutel', op: '2026-10-30T15:00:00.000Z', ok: true }]);
    expect(gemeldVoorApp(laadOfMaak(path.join(map, 'op-afstand.json')))).toEqual(gemeldVoorApp(staat));
    expect(fs.readFileSync(path.join(map, 'op-afstand.json'), 'utf8')).not.toContain(CLOUDSLEUTEL);
  });

  it('een cloudsleutel die niet naar Zendure wijst (0.13.0): niet overgenomen, en dat gaat terug naar de app', async () => {
    const { instellingenPad, staat, log, lees } = thuis();
    const boos = Buffer.from('http://192.168.1.1.Ab12Cd34Ef56Gh78').toString('base64');
    const uit = pakOp([await stuk(staat, boos)], staat, { instellingenPad, log });
    expect(uit.veranderd).toBe(false);
    expect(lees().zendure).toEqual(INSTELLINGEN.zendure);
    expect(gemeldVoorApp(staat)[0]).toMatchObject({ veld: 'zendure.cloudsleutel', ok: false });
  });

  it('hetzelfde stuk nog eens (de functie stuurt het tot de melding er is): niets', async () => {
    const { instellingenPad, staat, log, regels } = thuis();
    const s = await stuk(staat);
    pakOp([s], staat, { instellingenPad, log });
    const tel = regels.length;
    const op = fs.statSync(instellingenPad).mtimeMs;
    expect(pakOp([s], staat, { instellingenPad, log }).veranderd).toBe(false);
    expect(regels).toHaveLength(tel);
    expect(fs.statSync(instellingenPad).mtimeMs).toBe(op);
  });

  it('dezelfde sleutel die er al stond: geen herstart; bij de cloud wordt het de sleutel zelf', async () => {
    const al = thuis({ ...INSTELLINGEN, zendure: { ...INSTELLINGEN.zendure, cloudsleutel: CLOUDSLEUTEL } });
    expect(pakOp([await stuk(al.staat)], al.staat, al).veranderd).toBe(false);
    expect(al.regels.at(-1)).toMatch(/stond er al zo in/);
    const cloud = thuis({ ...INSTELLINGEN, zendure: { manier: 'cloud', cloudsleutel: Buffer.from('https://app.zendure.tech/eu.oud').toString('base64') } });
    expect(pakOp([await stuk(cloud.staat)], cloud.staat, cloud).veranderd).toBe(true);
    expect(cloud.lees().zendure).toEqual({ manier: 'cloud', cloudsleutel: CLOUDSLEUTEL });
    expect(cloud.regels.at(-1)).toBe('Op afstand ingesteld: de Zendure-cloudsleutel; ik start opnieuw met de nieuwe instellingen.');
  });

  it('voor een ander sleutelpaar, geen geldige sleutel, of geen Zendure: niets veranderd, wel gemeld', async () => {
    const een = thuis();
    const ander = thuis();
    const voorAnder = await stuk(een.staat, CLOUDSLEUTEL, '2026-10-30T15:00:00.000Z', ander.staat.publiek);
    expect(pakOp([voorAnder], een.staat, een).veranderd).toBe(false);
    // Met de vingerafdruk van dit paar, maar toch van een ander: gaat ook niet open.
    expect(pakOp([{ ...voorAnder, voor: een.staat.voor, op: '2026-10-30T15:01:00.000Z' }], een.staat, een).veranderd).toBe(false);
    expect(gemeldVoorApp(een.staat)).toEqual([{ veld: 'zendure.cloudsleutel', op: '2026-10-30T15:01:00.000Z', ok: false, fout: 'sleutelpaar' }]);
    expect(pakOp([await stuk(een.staat, 'geen cloudsleutel', '2026-10-30T15:02:00.000Z')], een.staat, een).veranderd).toBe(false);
    expect(gemeldVoorApp(een.staat)[0].fout).toBe('ongeldig');
    expect(een.lees()).toEqual(INSTELLINGEN);

    const zonder = thuis({ app: INSTELLINGEN.app, homewizard: INSTELLINGEN.homewizard });
    expect(pakOp([await stuk(zonder.staat)], zonder.staat, zonder).veranderd).toBe(false);
    expect(gemeldVoorApp(zonder.staat)[0].fout).toBe('geen-zendure');
    expect(zonder.regels.at(-1)).toMatch(/geen Zendure in instellingen\.json/);
  });

  it('onbekende velden en rommel: overgeslagen; zonder sleutelpaar: niets', async () => {
    const { instellingenPad, staat, log, lees } = thuis();
    expect(pakOp([{ veld: 'app.sleutel', op: '2026-10-30T15:00:00.000Z' }, null, 'x'], staat, { instellingenPad, log }).veranderd).toBe(false);
    expect(pakOp('rommel', staat, { instellingenPad, log }).veranderd).toBe(false);
    expect(pakOp([await stuk(staat)], null, { instellingenPad, log }).veranderd).toBe(false);
    expect(lees()).toEqual(INSTELLINGEN);
    expect(gemeldVoorApp(staat)).toEqual([]);
  });
});

describe('versturen: het antwoord van de functie', () => {
  it('een nieuwere functie geeft op_afstand mee; een oudere niet, en dat is ook goed', async () => {
    const met = { veld: 'zendure.cloudsleutel', op: '2026-10-30T15:00:00.000Z' };
    const antwoord = (json) => ({ vraag: async () => ({ status: 200, json }) });
    expect(await verstuur({ adres: 'https://x', sleutel: 'y' }, {}, antwoord({ ok: true, op_afstand: [met, 'rommel'] }))).toEqual({ ok: true, op_afstand: [met] });
    expect(await verstuur({ adres: 'https://x', sleutel: 'y' }, {}, antwoord({ ok: true }))).toEqual({ ok: true });
  });
});

describe('de korte vingerafdruk (0.13.0): proef en de app zeggen hetzelfde', () => {
  it('kortAfdruk: de eerste 16 hex-tekens van de vingerafdruk, in groepjes van vier, net als de site en de server', async () => {
    const { publiek } = maakSleutelpaar();
    const kort = kortAfdruk(publiek);
    expect(kort).toMatch(/^[0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{4}$/);
    const site = await siteVingerafdruk(publiek);
    const server = await vingerafdrukVan(publiek);
    expect(site).toBe(vingerafdruk(publiek));
    expect(server).toBe(vingerafdruk(publiek));
    expect(kort).toBe(site.slice(0, 16).match(/.{4}/g).join(' '));
  });

  it('leesPubliek: alleen lezen (proef maakt geen nieuw paar), en null als het er niet is of niet klopt', () => {
    const map = fs.mkdtempSync(path.join(os.tmpdir(), 'afstand-'));
    const pad = path.join(map, 'op-afstand.json');
    expect(leesPubliek(pad)).toBeNull();
    expect(fs.existsSync(pad)).toBe(false);
    const staat = laadOfMaak(pad);
    expect(leesPubliek(pad)).toBe(staat.publiek);
    fs.writeFileSync(pad, '{"prive":"x","publiek":"y"}');
    expect(leesPubliek(pad)).toBeNull();
    fs.rmSync(map, { recursive: true, force: true });
  });
});
