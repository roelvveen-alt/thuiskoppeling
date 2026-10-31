import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  bewaarInstellingen,
  Gestopt,
  getalUit,
  instellingenUitAntwoorden,
  jaNeeUit,
  keuzeUit,
  leesBestaand,
  maakVraag,
  plaatsUit,
  samenvatting,
  voerUit,
} from './instellen.mjs';
import { controleerInstellingen } from './instellingen.mjs';

// Nep-geheimen, herkenbaar zodat we ze overal kunnen zoeken.
// Een Autorisatiecloudsleutel is base64 van "<adres>.<appKey>".
const CLOUDSLEUTEL = Buffer.from('https://app.zendure.tech/eu.GEHEIMEAPPKEY0123456789').toString('base64');
const CODE = 'C0DEC0DEC0DEC0DEC0DEC0DEC0DEC0DE';
// Zoals de app hem laat zien: 48 tekens hex.
const APPSLEUTEL = '0123456789abcdef'.repeat(3);
const GEHEIMEN = [CLOUDSLEUTEL, CODE, APPSLEUTEL, 'GEHEIMEAPPKEY'];

// Wat zoek.mjs vindt (zoekApparaten), op volgorde van adres.
const P1 = { adres: '192.168.1.20', merk: 'HomeWizard', soort: 'P1 meter', type: 'HWE-P1', serienummer: '3c39e7aabbcc', api: 'v1' };
const ZON_BATTERIJ = { adres: '192.168.1.61', merk: 'HomeWizard', soort: 'kWh meter', type: 'HWE-KWH1', serienummer: '3c39e7aabbc1', api: 'v2' };
const ZON = { adres: '192.168.1.22', merk: 'HomeWizard', soort: 'kWh meter', type: 'HWE-KWH1', serienummer: '3c39e7aabbc2', api: 'v1' };
const ZENDURE_P1 = { adres: '192.168.1.23', merk: 'Zendure', soort: 'P1-meter', serienummer: 'zp1', api: 'lokaal' };
const STEKKER = { adres: '192.168.1.24', merk: 'HomeWizard', soort: 'Energy Socket', type: 'HWE-SKT', serienummer: '3c39e7aabbc4', api: 'v1' };
const WATER = { adres: '192.168.1.25', merk: 'HomeWizard', soort: 'Watermeter', type: 'HWE-WTR', serienummer: '3c39e7aabbc5', api: 'v1' };
const ALLES = [P1, ZON_BATTERIJ, ZON, ZENDURE_P1, STEKKER, WATER];

/** De instelhulp met nep-antwoorden (op volgorde; daarna alleen Enter) en nep-apparaten. */
async function draai({ antwoorden = [], gevonden = ALLES, bestaand = null, ingelogd = false, vermogens = {}, nu = Date.UTC(2026, 9, 30, 12) } = {}) {
  const rest = [...antwoorden];
  const uit = { tekst: [], vragen: [], bewaard: null, codes: [], logins: 0 };
  const resultaat = await voerUit({
    vraag: async (tekst, { geheim = false } = {}) => {
      uit.vragen.push({ tekst, geheim });
      if (uit.vragen.length > 200) throw new Error(`blijft vragen: ${tekst}`);
      return rest.length ? rest.shift() : '';
    },
    zeg: (t) => uit.tekst.push(t),
    zoek: async () => gevonden,
    maakCode: async (adres, { opKnopWachten }) => {
      opKnopWachten();
      uit.codes.push(adres);
      return CODE;
    },
    zonneplanLogin: async () => {
      uit.logins += 1;
    },
    zonneplanIngelogd: () => ingelogd,
    bestaand,
    bewaar: (ruw) => {
      uit.bewaard = structuredClone(ruw);
    },
    leesVermogen: async (g) => vermogens[g.adres] ?? null,
    nu,
  });
  return { ...uit, resultaat, over: rest };
}

/** Zoals Tim het heeft: P1, zon en batterij op één meter, panelen op het dierenverblijf, en een stekker. */
const TIM = {
  homewizard: [
    { naam: 'Meterkast', rol: 'net', adres: '192.168.1.20', serienummer: '3c39e7aabbcc' },
    { naam: 'Zon huis', rol: 'zon-en-batterij', adres: '192.168.1.61', serienummer: '3c39e7aabbc1', code: CODE },
    { naam: 'Zon dierenverblijf', rol: 'zon', adres: '192.168.1.22', serienummer: '3c39e7aabbc2' },
    { naam: 'Wasmachine', rol: 'apparaat', adres: '192.168.1.24', serienummer: '3c39e7aabbc4', soort: 'wasmachine' },
  ],
  zendure: { manier: 'cloud', cloudsleutel: CLOUDSLEUTEL },
  zendure_p1: { adres: '192.168.1.23' },
  prijzen: 'zonneplan',
  vaste_kosten: { levering_per_maand: 6.25, netbeheer_per_maand: 40.12, vermindering_energiebelasting_per_maand: 52.41 },
  teruglevering_dit_jaar: { jaar: 2026, kwh: 7247 },
};

describe('wat mensen typen', () => {
  it('ja en nee, Enter is het voorstel', () => {
    expect(jaNeeUit('', true)).toBe(true);
    expect(jaNeeUit(' ', false)).toBe(false);
    expect(jaNeeUit('J', false)).toBe(true);
    expect(jaNeeUit('nee', true)).toBe(false);
    expect(jaNeeUit('misschien', true)).toBe(null);
  });

  it('een keuze uit het lijstje', () => {
    expect(keuzeUit('', 'net')).toBe('net');
    expect(keuzeUit('', null)).toBe(null);
    expect(keuzeUit('2')).toBe('zon-en-batterij');
    expect(keuzeUit('3')).toBe('zon');
    expect(keuzeUit('4')).toBe('apparaat');
    expect(keuzeUit('0', 'net')).toBe(null);
    expect(keuzeUit('5')).toBe(undefined);
    expect(keuzeUit('zon')).toBe(undefined);
  });

  it('getallen met komma of punt; bij kWh is 7.247 zevenduizend', () => {
    expect(getalUit('6,25')).toBe(6.25);
    expect(getalUit('€ 39.66')).toBe(39.66);
    expect(getalUit('7.247', { duizendtallen: true })).toBe(7247);
    expect(getalUit('7.247 kWh', { duizendtallen: true })).toBe(7247);
    expect(getalUit('7247,5', { duizendtallen: true })).toBe(7247.5);
    expect(getalUit('7.5', { duizendtallen: true })).toBe(7.5);
    expect(getalUit('1.234,5')).toBe(null);
    expect(getalUit('veel')).toBe(null);
  });

  it('een plaats zoals Google Maps hem geeft, of met komma’s', () => {
    expect(plaatsUit('52.09123, 5.17456')).toEqual({ breedte: 52.09123, lengte: 5.17456 });
    expect(plaatsUit('52,1 5,18')).toEqual({ breedte: 52.1, lengte: 5.18 });
    expect(plaatsUit('52.1 5.18')).toEqual({ breedte: 52.1, lengte: 5.18 });
    expect(plaatsUit('Utrecht')).toBe(null);
    expect(plaatsUit('95, 5')).toBe(null);
  });
});

describe('instellingenUitAntwoorden', () => {
  const antwoorden = {
    meters: TIM.homewizard,
    zendure: TIM.zendure,
    zendure_p1: TIM.zendure_p1,
    prijzen: 'zonneplan',
    vaste_kosten: TIM.vaste_kosten,
    teruglevering_dit_jaar: TIM.teruglevering_dit_jaar,
    plaats: null,
    app: { adres: null, sleutel: null },
  };

  it('maakt van de antwoorden instellingen die het programmaatje aanneemt', () => {
    const uit = instellingenUitAntwoorden(antwoorden);
    expect(uit.ok).toBe(true);
    expect(uit.ruw).toEqual(TIM);
    expect(uit.zonderApp).toBe(true);
    expect(controleerInstellingen(uit.ruw, { zonderApp: true }).ok).toBe(true);
  });

  it('met adres en sleutel van de app hoort de app erbij', () => {
    const app = { adres: 'https://base44.app/api/apps/abc/functions/ontvangMeting', sleutel: APPSLEUTEL };
    const uit = instellingenUitAntwoorden({ ...antwoorden, app, plaats: { breedte: 52.1, lengte: 5.1 } });
    expect(uit.ok).toBe(true);
    expect(uit.zonderApp).toBe(false);
    expect(uit.ruw.app).toEqual(app);
    expect(uit.ruw.plaats).toEqual({ breedte: 52.1, lengte: 5.1 });
    expect(controleerInstellingen(uit.ruw).ok).toBe(true);
  });

  it('zegt wat er niet klopt', () => {
    const uit = instellingenUitAntwoorden({ ...antwoorden, zendure: null });
    expect(uit.ok).toBe(false);
    expect(uit.fouten.join(' ')).toMatch(/zon-en-batterij/);
  });
});

describe('de instelhulp', () => {
  it('van nul: alles gevonden, een paar keuzes, de rest Enter', async () => {
    const uit = await draai({
      antwoorden: [
        '', // 1. P1 → meterkast (voorstel)
        '', //    naam Meterkast
        '2', // 2. kWh-meter → zon en batterij samen
        '', //    naam Zon huis
        '', //    alleen v2: nu een code maken? ja
        '3', // 3. kWh-meter → zonnepanelen
        '', //    naam Zon dierenverblijf
        '4', // 5. Energy Socket → een apparaat
        'Wasmachine',
        ` ${CLOUDSLEUTEL} `, // Zendure via de cloud (nodig voor Zon huis)
        '', // Zendure P1-meter vergelijken: ja
        '', // Zonneplan: ja
        '', // nu inloggen: ja
        '', // vaste kosten: ja
        '', //    levering 6,25
        '40,12', //    netbeheer
        '', //    korting 52,41
        '7.247', // teruggeleverd
        '', // plaats: De Bilt (standaard)
        '', // adres app: later
        '', // sleutel app: later
        '', // bewaren: ja
      ],
    });
    expect(uit.over).toEqual([]);
    expect(uit.resultaat.bewaard).toBe(true);
    expect(uit.bewaard).toEqual(TIM);
    expect(uit.codes).toEqual(['192.168.1.61']);
    expect(uit.logins).toBe(1);
    // De watermeter meet geen stroom en komt niet in het lijstje.
    expect(uit.tekst.join('\n')).not.toMatch(/Watermeter/);
    expect(uit.tekst).toContain('Volgende stap: node brug.mjs proef');
  });

  it('zoals bij Dirk: geen meter op zon en batterij samen, de Zendure meldt de batterij zelf', async () => {
    const zendure = { adres: '192.168.1.63', merk: 'Zendure', soort: 'solarFlow2400AC', serienummer: 'z1', api: 'lokaal' };
    const uit = await draai({
      gevonden: [P1, ZON, zendure],
      antwoorden: [
        '', // P1 → meterkast (voorstel)
        '', //    naam Meterkast
        '3', // kWh-meter → alleen zonnepanelen
        'Zon garage',
        '', // Zendure lokaal uitlezen: ja
        '', //    cloudsleutel als reserve: overslaan
        'n', // Zonneplan: nee
        'n', // schatting: nee
      ],
    });
    const scherm = [...uit.tekst, ...uit.vragen.map((v) => v.tekst)].join('\n');
    expect(scherm).toMatch(/Wat meet deze meter\?/);
    expect(scherm).toMatch(/\[2\] zonnepanelen én batterij samen op één meter \(bijvoorbeeld een meter "Batterij \+ Zon"\)/);
    expect(scherm).toMatch(/\[3\] alleen zonnepanelen/);
    expect(scherm).toMatch(/Geen meter op de batterij\? Dat is prima: de Zendure meldt zelf wat hij laadt en levert\./);
    expect(uit.bewaard.homewizard.map((m) => [m.naam, m.rol])).toEqual([
      ['Meterkast', 'net'],
      ['Zon garage', 'zon'],
    ]);
    expect(uit.bewaard.zendure).toEqual({ manier: 'lokaal', adres: '192.168.1.63' });
  });

  it('lokaal gevonden: een cloudsleutel als reserve (Enter = overslaan), geheim, met uitleg', async () => {
    const zendure = { adres: '192.168.1.63', merk: 'Zendure', soort: 'solarFlow2400AC', serienummer: 'z1', api: 'lokaal' };
    const uit = await draai({ gevonden: [P1, zendure], antwoorden: ['', '', '', ` ${CLOUDSLEUTEL} `, 'n', 'n'] });
    const scherm = [...uit.tekst, ...uit.vragen.map((v) => v.tekst)].join('\n');
    expect(scherm).toMatch(/Zendure laat per account maar één cloudverbinding toe/);
    expect(uit.vragen.find((v) => v.tekst.startsWith('Cloudsleutel als reserve'))).toEqual({ tekst: 'Cloudsleutel als reserve [overslaan]: ', geheim: true });
    expect(uit.bewaard.zendure).toEqual({ manier: 'lokaal', adres: '192.168.1.63', cloudsleutel: CLOUDSLEUTEL });
    expect(scherm).toMatch(/Zendure: lokaal, 192\.168\.1\.63, met de cloud als reserve \(sleutel bewaard\)/);
    expect(scherm).not.toContain(CLOUDSLEUTEL);

    // Opnieuw instellen: Enter houdt de bewaarde, - haalt hem weg.
    const bestaand = uit.bewaard;
    const houden = await draai({ bestaand, gevonden: [P1, zendure], antwoorden: ['', '', ''] });
    expect(houden.vragen.map((v) => v.tekst)).toContain('Cloudsleutel als reserve [de bewaarde houden, - = weghalen]: ');
    expect(houden.bewaard.zendure).toEqual(bestaand.zendure);
    const weg = await draai({ bestaand, gevonden: [P1, zendure], antwoorden: ['', '', '', '-'] });
    expect(weg.bewaard.zendure).toEqual({ manier: 'lokaal', adres: '192.168.1.63' });
  });

  it('zoals het eerst bij Dirk stond: elke meter met wat hij nu doet, en een "zon" die stroom gebruikt valt op', async () => {
    const SPA = { adres: '192.168.1.23', merk: 'HomeWizard', soort: 'kWh meter 3-fase', type: 'HWE-KWH3', serienummer: '3c39e7aabbc3', api: 'v1' };
    const uit = await draai({
      gevonden: [P1, ZON, SPA],
      vermogens: { '192.168.1.20': 312, '192.168.1.22': 1372, '192.168.1.23': -121.4 },
      antwoorden: [
        '', // P1 → meterkast
        '', //    naam Meterkast
        '3', // de kWh-meter op .22 → zonnepanelen…
        '', //    "Let op": [1] opnieuw kiezen (Enter)
        '4', //    → een apparaat
        'Spa',
        '3', // de kWh-meter op .23 → zonnepanelen; die levert: klopt
        'Zon',
        'n', // Zendure via de cloud: nee
        'n', // Zonneplan: nee
        'n', // schatting: nee
      ],
    });
    const scherm = [...uit.tekst, ...uit.vragen.map((v) => v.tekst)].join('\n');
    expect(scherm).toMatch(/1\. HomeWizard P1 meter \(192\.168\.1\.20\): gebruikt nu 312 W/);
    expect(scherm).toMatch(/2\. HomeWizard kWh meter \(192\.168\.1\.22\): gebruikt nu 1\.372 W/);
    expect(scherm).toMatch(/3\. HomeWizard kWh meter 3-fase \(192\.168\.1\.23\): levert nu 121 W/);
    expect(scherm).toMatch(/Let op: deze meter gebruikt nu 1\.372 W\. Overdag levert een zonnemeter; dit lijkt verbruik/);
    expect(uit.tekst.filter((t) => t.startsWith('Let op'))).toHaveLength(1);
    expect(uit.bewaard.homewizard.map((m) => [m.naam, m.rol, m.adres, m.opwek])).toEqual([
      ['Meterkast', 'net', '192.168.1.20', undefined],
      ['Spa', 'apparaat', '192.168.1.22', undefined],
      ['Zon', 'zon', '192.168.1.23', 'min'],
    ]);
  });

  it('een omgekeerd aangesloten zonnemeter: één keer kiezen, daarna onthouden; zonder te kunnen nagaan blijft het zoals het was', async () => {
    const vermogens = { '192.168.1.22': 800 };
    const uit = await draai({ gevonden: [ZON], vermogens, antwoorden: ['3', '2', '', 'n', 'n', 'n'] });
    expect(uit.tekst.join('\n')).toMatch(/\[2\] het is de zonnemeter, maar omgekeerd aangesloten: bij opwek geeft hij plus/);
    expect(uit.bewaard.homewizard[0]).toMatchObject({ rol: 'zon', opwek: 'plus' });
    // De tweede keer: hij levert in zijn eigen teken, dus geen vraag meer.
    const weer = await draai({ bestaand: uit.bewaard, gevonden: [ZON], vermogens, antwoorden: ['', '', 'n', 'n', 'n'] });
    expect(weer.tekst.join('\n')).not.toMatch(/Let op/);
    expect(weer.bewaard.homewizard[0].opwek).toBe('plus');
    // 's Nachts (of zonder antwoord) is het niet na te gaan: niets gevraagd, en geen teken erbij.
    const nacht = await draai({ gevonden: [ZON], vermogens, nu: Date.UTC(2026, 9, 30, 22), antwoorden: ['3', '', 'n', 'n', 'n'] });
    expect(nacht.tekst.join('\n')).not.toMatch(/Let op/);
    expect(nacht.bewaard.homewizard[0]).not.toHaveProperty('opwek');
  });

  it('met een meter op zon en batterij samen geen uitleg over een batterij zonder meter', async () => {
    const uit = await draai({ gevonden: [P1, ZON_BATTERIJ], antwoorden: ['', '', '2', '', 'n', ` ${CLOUDSLEUTEL} `, 'n', 'n'] });
    expect(uit.tekst.join('\n')).not.toMatch(/Geen meter op de batterij/);
    expect(uit.bewaard.zendure).toMatchObject({ manier: 'cloud' });
  });

  it('neemt alles over uit de huidige instellingen als je alleen op Enter drukt', async () => {
    const bestaand = {
      app: { adres: 'https://base44.app/api/apps/abc/functions/ontvangMeting', sleutel: APPSLEUTEL },
      elke_seconden: 10,
      homewizard: [
        TIM.homewizard[0],
        TIM.homewizard[1],
        // Staat even uit: blijft staan, op zijn plek.
        { naam: 'Zon schuur', rol: 'zon', adres: '192.168.1.26', piek_w: 3000 },
        TIM.homewizard[2],
        TIM.homewizard[3],
      ],
      zendure: TIM.zendure,
      zendure_p1: TIM.zendure_p1,
      prijzen: 'zonneplan',
      vaste_kosten: TIM.vaste_kosten,
      teruglevering_dit_jaar: TIM.teruglevering_dit_jaar,
      plaats: { breedte: 52.0, lengte: 5.3 },
    };
    const uit = await draai({ bestaand, ingelogd: true });
    expect(uit.resultaat.bewaard).toBe(true);
    expect(uit.bewaard).toEqual(bestaand);
    expect(uit.codes).toEqual([]); // de code was er al
    expect(uit.logins).toBe(0); // al ingelogd: niet opnieuw
    expect(uit.vragen.map((v) => v.tekst)).toContain('Sleutel van de app [de bewaarde houden]: ');
  });

  it('een GoodWe-omvormer: uitlezen, en bij welke panelen hij hoort', async () => {
    const goodwe = { adres: '192.168.1.40', merk: 'GoodWe', soort: 'omvormer GW8K-DT', type: 'GW8K-DT', api: 'lokaal' };
    const uit = await draai({ bestaand: TIM, gevonden: [P1, ZON_BATTERIJ, ZON, ZENDURE_P1, STEKKER, goodwe], ingelogd: true });
    const scherm = [...uit.tekst, ...uit.vragen.map((v) => v.tekst)].join('\n');
    expect(scherm).toMatch(/GoodWe GW8K-DT \(192\.168\.1\.40\): uitlezen \(alleen kijken, er verandert niets aan\)\?/);
    // Zon huis (met de batterij) staat voorop, zoals in de app.
    expect(scherm).toMatch(/\[1\] Zon huis\n {2}\[2\] Zon dierenverblijf/);
    expect(uit.bewaard.goodwe).toEqual({ adres: '192.168.1.40', bij: 'hw-zon-huis' });
    expect(scherm).toMatch(/Omvormer: GoodWe, 192\.168\.1\.40, bij Zon huis \(alleen lezen\)/);
    // Het serienummer of de naam van de wifi-stekker komt nergens in.
    expect(JSON.stringify(uit.bewaard.goodwe)).not.toMatch(/GW8K|Solar/);
  });

  it("de omvormer 's nachts niet gevonden: de bewaarde blijft, met zijn panelen", async () => {
    const bestaand = { ...TIM, goodwe: { adres: '192.168.1.40', bij: 'hw-zon-dierenverblijf' } };
    const uit = await draai({ bestaand, gevonden: [P1, ZON_BATTERIJ, ZON, ZENDURE_P1, STEKKER], ingelogd: true });
    expect(uit.vragen.map((v) => v.tekst)).toContain('GoodWe-omvormer (192.168.1.40, nu niet gevonden): uitlezen (alleen kijken, er verandert niets aan)? (J/n) ');
    expect(uit.vragen.map((v) => v.tekst)).toContain('Keuze [2]: ');
    expect(uit.bewaard.goodwe).toEqual(bestaand.goodwe);
  });

  it('geen omvormer: een zin dat je hem overdag vindt, en geen vraag', async () => {
    const uit = await draai({ bestaand: TIM, gevonden: [P1, ZON_BATTERIJ, ZON, ZENDURE_P1, STEKKER], ingelogd: true });
    expect(uit.tekst.join('\n')).toMatch(/Geen GoodWe-omvormer gevonden\. Heb je er een, zoek dan overdag/);
    expect(uit.bewaard).not.toHaveProperty('goodwe');
  });

  it('herkent een meter met een nieuw adres aan zijn serienummer', async () => {
    const verhuisd = { ...ZON, adres: '192.168.1.32' };
    const uit = await draai({ bestaand: TIM, gevonden: [P1, ZON_BATTERIJ, ZENDURE_P1, STEKKER, verhuisd], ingelogd: true });
    const zon = uit.bewaard.homewizard.find((m) => m.naam === 'Zon dierenverblijf');
    expect(zon.adres).toBe('192.168.1.32');
    expect(uit.bewaard.homewizard.map((m) => m.naam)).toEqual(['Meterkast', 'Zon huis', 'Zon dierenverblijf', 'Wasmachine']);
  });

  it('vraagt opnieuw bij een verkeerd antwoord en laat geen dubbele naam toe', async () => {
    const uit = await draai({
      gevonden: [P1, ZON],
      antwoorden: ['9', '', '', '1', 'meterkast', 'Zon', 'n', 'n', 'n', 'geen-https', '', '', ''],
    });
    const tekst = uit.tekst.join('\n');
    expect(tekst).toMatch(/Typ 1 tot 4/);
    expect(tekst).toMatch(/Die naam heeft al een andere meter/);
    expect(tekst).toMatch(/eindigt op \/functions\/ontvangMeting/);
    expect(uit.bewaard.homewizard.map((m) => [m.naam, m.rol])).toEqual([
      ['Meterkast', 'net'],
      ['Zon', 'net'],
    ]);
    expect(uit.bewaard.zendure).toBeUndefined();
    expect(uit.bewaard.prijzen).toBeUndefined();
  });

  it('kan het netwerk vragen als dit apparaat het niet ziet (Android)', async () => {
    const netwerken = [];
    // netwerk, P1 → meterkast, naam, geen Zendure, geen Zonneplan, geen schatting; de rest Enter
    const rest = ['10.0.0', '', '', 'n', 'n', 'n'];
    const uit = await voerUit({
      vraag: async () => (rest.length ? rest.shift() : ''),
      zeg: () => {},
      zoek: async ({ netwerk }) => {
        netwerken.push(netwerk);
        if (!netwerk) throw new Error('Ik kan niet zien in welk netwerk dit apparaat zit.');
        return [{ ...P1, adres: '10.0.0.5' }];
      },
      bewaar: () => {},
    });
    expect(netwerken).toEqual([undefined, ['10.0.0.']]);
    expect(uit.ruw.homewizard[0]).toMatchObject({ naam: 'Meterkast', adres: '10.0.0.5' });
  });

  it('vindt hij niets, dan zegt hij waar hij zocht en vraagt hij een ander netwerk', async () => {
    // Zo ging het bij Tim: de telefoon zocht in het netwerk van de mobiele data.
    const netwerken = [];
    const tekst = [];
    // ander netwerk, P1 → meterkast, naam, geen Zendure, geen Zonneplan, geen schatting; de rest Enter
    const rest = ['192.168.2', '', '', 'n', 'n', 'n'];
    const uit = await voerUit({
      vraag: async () => (rest.length ? rest.shift() : ''),
      zeg: (t) => tekst.push(t),
      zoek: async ({ netwerk, opNetten }) => {
        netwerken.push(netwerk);
        opNetten(netwerk ? [netwerk].flat() : ['10.45.3.']);
        // Een watermeter alleen telt als niets: die meet geen stroom.
        return netwerk ? [{ ...P1, adres: '192.168.2.20' }] : [WATER];
      },
      bewaar: () => {},
    });
    expect(netwerken).toEqual([undefined, ['192.168.2.']]);
    expect(tekst.join('\n')).toMatch(/Zoeken in 10\.45\.3\.1 tot 10\.45\.3\.254/);
    expect(tekst.join('\n')).toMatch(/Niets gevonden in 10\.45\.3\.1 tot 10\.45\.3\.254/);
    expect(tekst.join('\n')).toMatch(/Zoeken in 192\.168\.2\.1 tot 192\.168\.2\.254/);
    expect(uit.ruw.homewizard[0]).toMatchObject({ naam: 'Meterkast', adres: '192.168.2.20' });
  });

  it('zoekt in meer netwerken tegelijk, zoals bij Tim (HomeWizards in 192.168.1, de rest in 192.168.0)', async () => {
    const netwerken = [];
    const tekst = [];
    // twee netwerken, P1 → meterkast, naam, geen Zendure, geen Zonneplan, geen schatting; de rest Enter
    const rest = ['192.168.1 192.168.0', '', '', 'n', 'n', 'n'];
    const uit = await voerUit({
      vraag: async () => (rest.length ? rest.shift() : ''),
      zeg: (t) => tekst.push(t),
      zoek: async ({ netwerk, opNetten }) => {
        netwerken.push(netwerk);
        opNetten(netwerk ? [netwerk].flat() : ['192.168.0.']);
        return netwerk ? [{ ...P1, adres: '192.168.1.64' }] : [];
      },
      bewaar: () => {},
    });
    expect(netwerken).toEqual([undefined, ['192.168.1.', '192.168.0.']]);
    expect(tekst.join('\n')).toMatch(/Zoeken in 192\.168\.1\.1 tot 192\.168\.1\.254 en 192\.168\.0\.1 tot 192\.168\.0\.254/);
    expect(uit.ruw.homewizard[0]).toMatchObject({ naam: 'Meterkast', adres: '192.168.1.64' });
  });

  it('neemt het adres van de site niet aan als adres voor het programmaatje', async () => {
    const goed = 'https://base44.app/api/apps/abc/functions/ontvangMeting';
    // P1 → meterkast, naam, geen Zendure, geen Zonneplan, geen schatting, dan het adres
    const uit = await draai({
      gevonden: [P1],
      antwoorden: ['', '', 'n', 'n', 'n', 'https://mijn-app-0123abcd.base44.app', goed, APPSLEUTEL],
    });
    const vragen = uit.vragen.map((v) => v.tekst);
    expect(vragen.filter((t) => t.startsWith('Adres van de app'))).toHaveLength(2);
    expect(uit.tekst.join('\n')).toMatch(/eindigt op \/functions\/ontvangMeting/);
    expect(uit.bewaard.app).toEqual({ adres: goed, sleutel: APPSLEUTEL });
  });

  it('bewaart niets als het niet klopt of als je nee zegt', async () => {
    // Enter bij "Welk netwerk dan?": verder zonder.
    const leeg = await draai({ gevonden: [], antwoorden: ['', 'n', 'n', 'n'] });
    expect(leeg.resultaat.bewaard).toBe(false);
    expect(leeg.resultaat.fouten.join(' ')).toMatch(/geen enkele meter/);
    expect(leeg.bewaard).toBe(null);

    // Het een-na-laatste Enter: geen Tuya (sinds 0.8.0 de vraag vlak voor het bewaren).
    const nee = await draai({ gevonden: [P1], antwoorden: ['', '', 'n', 'n', 'n', '', '', '', 'n'] });
    expect(nee.resultaat.bewaard).toBe(false);
    expect(nee.bewaard).toBe(null);
  });
});

describe('geheimen', () => {
  const metAlles = { ...TIM, app: { adres: 'https://base44.app/api/apps/abc/functions/ontvangMeting', sleutel: APPSLEUTEL } };

  it('staan nooit in de samenvatting', () => {
    const tekst = samenvatting(metAlles).join('\n');
    for (const geheim of GEHEIMEN) expect(tekst).not.toContain(geheim);
    expect(tekst).toMatch(/met code/);
    expect(tekst).toMatch(/sleutel bewaard/);
  });

  it('komen nergens op het scherm, en worden geheim gevraagd', async () => {
    for (const bestaand of [null, metAlles]) {
      const uit = await draai({
        bestaand,
        antwoorden: bestaand
          ? []
          : ['', '', '2', '', '', '3', '', '4', '', CLOUDSLEUTEL, '', '', 'n', '', '', '', '', '', '', 'https://x.example/functions/ontvangMeting', APPSLEUTEL],
      });
      expect(uit.resultaat.bewaard).toBe(true);
      const scherm = [...uit.tekst, ...uit.vragen.map((v) => v.tekst)].join('\n');
      for (const geheim of GEHEIMEN) expect(scherm).not.toContain(geheim);
      const geheimGevraagd = uit.vragen.filter((v) => v.geheim).map((v) => v.tekst);
      expect(geheimGevraagd.some((t) => t.startsWith('Autorisatiecloudsleutel'))).toBe(true);
      expect(geheimGevraagd.some((t) => t.startsWith('Sleutel van de app'))).toBe(true);
    }
  });
});

describe('het bestand', () => {
  const tijdelijkeMap = () => fs.mkdtempSync(path.join(os.tmpdir(), 'instellen-'));

  it('bewaart in één keer, alleen leesbaar voor jezelf', () => {
    const map = tijdelijkeMap();
    const pad = path.join(map, 'instellingen.json');
    fs.writeFileSync(pad, '{"oud": true}\n', { mode: 0o644 });
    fs.writeFileSync(`${pad}.nieuw`, 'half'); // over van een eerdere keer, met stroom eraf
    bewaarInstellingen(pad, TIM);
    expect(JSON.parse(fs.readFileSync(pad, 'utf8'))).toEqual(TIM);
    expect(fs.statSync(pad).mode & 0o777).toBe(0o600);
    expect(fs.existsSync(`${pad}.nieuw`)).toBe(false);
  });

  it('leest de huidige instellingen; het onaangeroerde voorbeeld telt niet', () => {
    const map = tijdelijkeMap();
    const pad = path.join(map, 'instellingen.json');
    expect(leesBestaand(pad)).toBe(null);
    fs.writeFileSync(pad, JSON.stringify(TIM));
    expect(leesBestaand(pad)).toEqual(TIM);
    fs.copyFileSync(new URL('./instellingen.voorbeeld.json', import.meta.url), pad);
    expect(leesBestaand(pad)).toBe(null);
    fs.writeFileSync(pad, '{ kapot');
    expect(() => leesBestaand(pad)).toThrow(/geen geldige JSON/);
  });
});

describe('maakVraag', () => {
  it('raakt vooruit getypte regels niet kwijt en laat geheimen niet zien', async () => {
    const invoer = new PassThrough();
    const uitvoer = new PassThrough();
    let scherm = '';
    uitvoer.on('data', (stuk) => (scherm += stuk));
    const vraag = maakVraag({ invoer, uitvoer });
    invoer.write(`eerste\n${APPSLEUTEL}\n`);
    await new Promise((klaar) => setImmediate(klaar));
    expect(await vraag('Een: ')).toBe('eerste');
    expect(await vraag('Twee: ', { geheim: true })).toBe(APPSLEUTEL);
    invoer.end();
    await expect(vraag('Drie: ')).rejects.toBeInstanceOf(Gestopt);
    vraag.sluit();
    expect(scherm).toContain('Een: eerste');
    expect(scherm).toContain('Twee: ');
    expect(scherm).not.toContain(APPSLEUTEL);
  });
});
