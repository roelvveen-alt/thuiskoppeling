import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  adressenPad,
  bewaarAdressen,
  GEVONDEN_MELDING_MS,
  laadAdressen,
  maakAdressen,
  netVan,
  OMVORMER_ZOEK_NA_MS,
  ZOEK_NA_MS,
  ZOEK_OPNIEUW_MS,
  ZOEK_TUSSEN_MS,
} from './adressen.mjs';
import { maakMissers } from './bewaking.mjs';
import { gekoppeldVoorApp, meldingenVoorApp } from './gekoppeld.mjs';
import { controleerInstellingen } from './instellingen.mjs';
import { kenmerkVan } from './kenmerk.mjs';
import { meetAlles } from './ronde.mjs';

/** 30 oktober 2026, 12:00 Nederlandse tijd. */
const BEGIN = Date.UTC(2026, 9, 30, 11);
const MIN = 60_000;

const nieuweInstellingen = (extra = {}) =>
  controleerInstellingen({
    app: { adres: 'https://voorbeeld.base44.app/functions/ontvangMeting', sleutel: 'a'.repeat(48) },
    homewizard: [
      { naam: 'Meterkast', rol: 'net', adres: '172.16.0.20' },
      { naam: 'Zon', rol: 'zon', adres: '172.16.0.22' },
    ],
    ...extra,
  }).instellingen;

/**
 * Een nep-wifi zoals bij Dirk (172.16.0.x): op elk adres een apparaat (merk, serienummer, watt),
 * of niets. De meters lezen zoals leesHomeWizard met een plek: elk antwoord noemt zijn
 * serienummer (zoals /api bij v1 of het certificaat bij v2). Zoeken kijkt in dezelfde wifi.
 */
function opzet({ wifi, instellingen = nieuweInstellingen(), opgeslagen = {} } = {}) {
  let t = BEGIN;
  const tijd = { nu: () => t, verder: (ms) => (t += ms) };
  const logs = [];
  const log = (tekst) => logs.push(tekst);
  const bewaard = [];
  const zoektochten = [];
  const zoek = async ({ netten, merken }) => {
    zoektochten.push({ netten, merken: [...merken] });
    return Object.entries(wifi)
      .filter(([adres, a]) => a && netten.includes(netVan(adres)) && merken.has(a.merk))
      .map(([adres, a]) => ({ adres, merk: a.merk, kenmerk: kenmerkVan(a.serienummer) }));
  };
  const adressen = maakAdressen({ instellingen, opgeslagen, bewaar: (a) => bewaard.push(structuredClone(a)), log, zoek, klok: tijd.nu });
  const lees = {
    homewizard: async (meter, { plek }) => {
      const a = wifi[meter.adres];
      if (!a || a.merk !== 'HomeWizard') throw Object.assign(new Error('geen antwoord binnen 4 s'), { code: 'ETIMEDOUT' });
      plek?.controleer(a.serienummer);
      return { w: a.w, tellers: null, fasen: null, storingen: null };
    },
    zendureP1: async () => null,
  };
  const geheugen = new Map();
  const problemen = new Map();
  const missers = maakMissers();
  const zendure = { lees: async () => null, stop() {}, product: null };
  /** Eén ronde meten (elke 5 s), en wachten tot een zoektocht klaar is. */
  const ronde = async () => {
    const uit = await meetAlles({ instellingen, zendure, geheugen, problemen, historie: new Map(), missers, versie: '1.3.0', log, nuMs: tijd.nu, lees, adressen });
    tijd.verder(5000);
    await new Promise((klaar) => setImmediate(klaar));
    return uit;
  };
  const rondesTot = async (ms) => {
    const eind = t + ms;
    let uit;
    while (t < eind) uit = await ronde();
    return uit;
  };
  const netW = (uit) => uit.homewizard.find((h) => h.meter.sleutel === 'hw-meterkast').w;
  return { adressen, instellingen, tijd, logs, bewaard, zoektochten, ronde, rondesTot, problemen, netW };
}

const DIRKS_WIFI = () => ({
  '172.16.0.20': { merk: 'HomeWizard', serienummer: 'aabbccddee01', w: 350 },
  '172.16.0.22': { merk: 'HomeWizard', serienummer: 'aabbccddee02', w: -1200 },
});

describe('een meter terugvinden als de router hem een ander adres geeft (programmaatje-15)', () => {
  it('het eerste antwoord leert het kenmerk (geen serienummer), en dat blijft thuis in adressen.json', async () => {
    const o = opzet({ wifi: DIRKS_WIFI() });
    await o.ronde();
    const laatste = o.bewaard.at(-1);
    expect(laatste['hw-meterkast']).toEqual({ instellingen: '172.16.0.20', adres: '172.16.0.20', kenmerk: kenmerkVan('aabbccddee01') });
    expect(JSON.stringify(o.bewaard)).not.toContain('aabbccddee01');
    expect(o.zoektochten).toHaveLength(0);
  });

  it('nieuw adres: na een paar minuten zoeken in hetzelfde netwerk, het nieuwe adres gebruiken en bewaren, en het melden', async () => {
    const wifi = DIRKS_WIFI();
    const o = opzet({ wifi });
    await o.ronde();
    // De router geeft de meterkast een ander adres.
    wifi['172.16.0.31'] = wifi['172.16.0.20'];
    delete wifi['172.16.0.20'];
    await o.rondesTot(ZOEK_NA_MS - 10_000);
    expect(o.zoektochten).toHaveLength(0);
    await o.rondesTot(20_000);
    // Alleen HomeWizard, alleen het netwerk waar hij zat.
    expect(o.zoektochten).toEqual([{ netten: ['172.16.0.'], merken: ['HomeWizard'] }]);
    expect(o.instellingen.homewizard[0].adres).toBe('172.16.0.31');
    expect(o.logs.some((r) => r.includes('Meterkast gevonden op een nieuw adres: 172.16.0.20 → 172.16.0.31'))).toBe(true);
    expect(o.bewaard.at(-1)['hw-meterkast']).toMatchObject({ instellingen: '172.16.0.20', adres: '172.16.0.31', kenmerk: kenmerkVan('aabbccddee01') });
    // De volgende ronde leest hij weer, op het nieuwe adres, en zegt dat hij er weer is.
    const uit = await o.ronde();
    expect(o.netW(uit)).toBe(350);
    expect(o.problemen.has('hw-meterkast')).toBe(false);
    // Een kwartier een melding in de app, zonder adres; daarna niet meer.
    const melding = o.adressen.meldingen(o.tijd.nu());
    expect(melding).toHaveLength(1);
    const app = meldingenVoorApp(o.instellingen, { problemen: new Map(), sinds: new Map(), adressen: melding, nu: o.tijd.nu() });
    expect(app).toEqual([expect.objectContaining({ soort: 'adres', tekst: 'Meterkast: kreeg van de router een ander adres; weer gevonden.' })]);
    expect(JSON.stringify(app)).not.toMatch(/172\.16/);
    expect(o.adressen.meldingen(o.tijd.nu() + GEVONDEN_MELDING_MS)).toEqual([]);
    // De lijst met apparaten in de app (alleen voor de eigenaar) toont het adres van nu.
    expect(gekoppeldVoorApp(o.instellingen, { sinds: new Map(), homewizard: uit.homewizard, zendureStand: null, zendureP1: null, zendureProduct: null })[0].adres).toBe('172.16.0.31');
  });

  it('zelfde adres, ander apparaat: die cijfers tellen niet, en meteen zoeken (niet pas na een paar minuten)', async () => {
    const wifi = DIRKS_WIFI();
    const o = opzet({ wifi });
    await o.ronde();
    // De meterkast krijgt .40; op .20 komt een stekker van de buren-kamer (ook een HomeWizard).
    wifi['172.16.0.40'] = wifi['172.16.0.20'];
    wifi['172.16.0.20'] = { merk: 'HomeWizard', serienummer: 'ffeeddccbb99', w: 2000 };
    const uit = await o.ronde();
    // Niet de 2000 W van de stekker als net: de laatste waarde van de meterkast (even), en het probleem staat genoteerd.
    expect(o.netW(uit)).toBe(350);
    expect(o.zoektochten).toHaveLength(1);
    expect(o.instellingen.homewizard[0].adres).toBe('172.16.0.40');
    expect(o.netW(await o.ronde())).toBe(350);
    expect(o.logs.some((r) => r.includes('Meterkast gevonden op een nieuw adres: 172.16.0.20 → 172.16.0.40'))).toBe(true);
  });

  it('twee meters wisselen van adres: allebei teruggevonden', async () => {
    const wifi = DIRKS_WIFI();
    const o = opzet({ wifi });
    await o.ronde();
    [wifi['172.16.0.20'], wifi['172.16.0.22']] = [wifi['172.16.0.22'], wifi['172.16.0.20']];
    await o.ronde();
    expect(o.instellingen.homewizard.map((m) => m.adres)).toEqual(['172.16.0.22', '172.16.0.20']);
    const uit = await o.ronde();
    expect(o.netW(uit)).toBe(350);
    expect(o.zoektochten).toHaveLength(1);
  });

  it('helemaal weg: rustig blijven zoeken (15 min, 1 uur, dan elke 3 uur), niets veranderen, en weer gewoon als hij terug is', async () => {
    const wifi = DIRKS_WIFI();
    const o = opzet({ wifi });
    await o.ronde();
    const meterkast = wifi['172.16.0.20'];
    delete wifi['172.16.0.20'];
    await o.rondesTot(ZOEK_NA_MS + 10_000);
    expect(o.zoektochten).toHaveLength(1);
    expect(o.logs.at(-1)).toMatch(/Meterkast: niet gevonden in 172\.16\.0\.1 tot 172\.16\.0\.254 .*over 15 minuten opnieuw/);
    await o.rondesTot(ZOEK_OPNIEUW_MS[0] - 20_000);
    expect(o.zoektochten).toHaveLength(1);
    await o.rondesTot(30_000);
    expect(o.zoektochten).toHaveLength(2);
    await o.rondesTot(ZOEK_OPNIEUW_MS[1] + 10_000);
    expect(o.zoektochten).toHaveLength(3);
    expect(o.logs.at(-1)).toMatch(/over 180 minuten opnieuw/);
    expect(o.instellingen.homewizard[0].adres).toBe('172.16.0.20');
    // Terug op zijn oude adres: gewoon weer lezen, en de teller begint opnieuw.
    wifi['172.16.0.20'] = meterkast;
    expect(o.netW(await o.ronde())).toBe(350);
    delete wifi['172.16.0.20'];
    // Weer weg: niet pas over 3 uur, maar na ZOEK_NA_MS (en niet binnen ZOEK_TUSSEN_MS na de vorige zoektocht).
    await o.rondesTot(ZOEK_TUSSEN_MS + 10_000);
    expect(o.zoektochten).toHaveLength(4);
  });

  it('een kort haperende meter (wifi, herstart) laat geen zoektocht los', async () => {
    const wifi = DIRKS_WIFI();
    const o = opzet({ wifi });
    await o.ronde();
    const meterkast = wifi['172.16.0.20'];
    for (let i = 0; i < 20; i++) {
      if (i % 4 === 0) delete wifi['172.16.0.20'];
      else wifi['172.16.0.20'] = meterkast;
      await o.rondesTot(MIN);
    }
    expect(o.zoektochten).toHaveLength(0);
  });

  it('nooit twee zoektochten dicht op elkaar, ook niet voor twee meters', async () => {
    const wifi = DIRKS_WIFI();
    const o = opzet({ wifi });
    await o.ronde();
    delete wifi['172.16.0.20'];
    await o.rondesTot(ZOEK_NA_MS - 30_000);
    delete wifi['172.16.0.22'];
    await o.rondesTot(40_000);
    expect(o.zoektochten).toHaveLength(1);
    // De zon ging later weg: zijn beurt komt eerder dan ZOEK_TUSSEN_MS na de eerste, maar hij wacht.
    await o.rondesTot(ZOEK_TUSSEN_MS - 30_000);
    expect(o.zoektochten).toHaveLength(1);
    await o.rondesTot(30_000);
    expect(o.zoektochten).toHaveLength(2);
  });

  it('zonder kenmerk (nog nooit geantwoord sinds 1.3.0) niet zelf zoeken, wel één keer zeggen wat te doen', async () => {
    const wifi = DIRKS_WIFI();
    delete wifi['172.16.0.20'];
    const o = opzet({ wifi });
    await o.rondesTot(ZOEK_NA_MS + 3 * MIN);
    expect(o.zoektochten).toHaveLength(0);
    expect(o.logs.filter((r) => r.includes('Zoek hem met: node brug.mjs instellen'))).toHaveLength(1);
  });

  it('een serienummer in instellingen.json is het kenmerk: dan ook zonder eerdere lezing terugvinden', async () => {
    const wifi = DIRKS_WIFI();
    wifi['172.16.0.50'] = wifi['172.16.0.20'];
    delete wifi['172.16.0.20'];
    const instellingen = nieuweInstellingen({
      homewizard: [
        { naam: 'Meterkast', rol: 'net', adres: '172.16.0.20', serienummer: 'AABBCCDDEE01' },
        { naam: 'Zon', rol: 'zon', adres: '172.16.0.22' },
      ],
    });
    const o = opzet({ wifi, instellingen });
    await o.rondesTot(ZOEK_NA_MS + 10_000);
    expect(instellingen.homewizard[0].adres).toBe('172.16.0.50');
  });
});

describe('na een herstart: adressen.json', () => {
  it('een teruggevonden adres geldt weer, zolang instellingen.json hetzelfde zegt als toen', async () => {
    const opgeslagen = { 'hw-meterkast': { instellingen: '172.16.0.20', adres: '172.16.0.31', kenmerk: kenmerkVan('aabbccddee01'), sinds: '2026-10-29T10:00:00.000Z' } };
    const wifi = DIRKS_WIFI();
    wifi['172.16.0.31'] = wifi['172.16.0.20'];
    delete wifi['172.16.0.20'];
    const o = opzet({ wifi, opgeslagen });
    expect(o.instellingen.homewizard[0].adres).toBe('172.16.0.31');
    expect(o.adressen.verplaatst()).toEqual([{ naam: 'Meterkast', adres: '172.16.0.31', instellingen: '172.16.0.20' }]);
    expect(o.netW(await o.ronde())).toBe(350);
    expect(o.zoektochten).toHaveLength(0);
  });

  it('veranderde iemand het adres in instellingen.json (de instelhulp), dan geldt dat, en leert hij opnieuw', () => {
    const opgeslagen = { 'hw-meterkast': { instellingen: '172.16.0.19', adres: '172.16.0.31', kenmerk: kenmerkVan('aabbccddee01') } };
    const instellingen = nieuweInstellingen();
    const o = opzet({ wifi: DIRKS_WIFI(), opgeslagen, instellingen });
    expect(instellingen.homewizard[0].adres).toBe('172.16.0.20');
    expect(o.adressen.verplaatst()).toEqual([]);
    // Een ander apparaat op dat adres is nu geen "ander": het kenmerk is vergeten en wordt opnieuw geleerd.
    expect(() => o.adressen.plek('hw-meterkast').controleer('112233445566')).not.toThrow();
  });

  it('een serienummer in instellingen.json gaat voor wat er bewaard is', () => {
    const opgeslagen = { 'hw-meterkast': { instellingen: '172.16.0.20', adres: '172.16.0.20', kenmerk: kenmerkVan('112233445566') } };
    const instellingen = nieuweInstellingen({ homewizard: [{ naam: 'Meterkast', rol: 'net', adres: '172.16.0.20', serienummer: 'aabbccddee01' }] });
    const o = opzet({ wifi: DIRKS_WIFI(), opgeslagen, instellingen });
    expect(() => o.adressen.plek('hw-meterkast').controleer('AABBCCDDEE01')).not.toThrow();
    expect(() => o.adressen.plek('hw-meterkast').controleer('112233445566')).toThrow(/ander apparaat \(HomeWizard\); ik zoek Meterkast/);
  });

  it('bewaren en lezen; weg of kapot is leeg; naast instellingen.json', () => {
    const map = fs.mkdtempSync(path.join(os.tmpdir(), 'adressen-'));
    const pad = adressenPad(path.join(map, 'instellingen.json'), {});
    expect(pad).toBe(path.join(map, 'adressen.json'));
    expect(adressenPad('/x/instellingen.json', { BRUG_ADRESSEN: '/y/a.json' })).toBe('/y/a.json');
    expect(laadAdressen(pad)).toEqual({});
    const apparaten = { 'hw-meterkast': { instellingen: '172.16.0.20', adres: '172.16.0.31', kenmerk: 'aaaaaaaaaaaaaaaa' } };
    expect(bewaarAdressen(pad, apparaten)).toBeNull();
    expect(laadAdressen(pad)).toEqual(apparaten);
    expect(fs.statSync(pad).mode & 0o077).toBe(0);
    fs.writeFileSync(pad, '{ kapot');
    expect(laadAdressen(pad)).toEqual({});
    fs.rmSync(map, { recursive: true, force: true });
  });
});

describe('de omvormer (GoodWe) slaapt s nachts', () => {
  it('s nachts telt geen antwoord niet mee; overdag pas na een uur zoeken', () => {
    const instellingen = nieuweInstellingen({ goodwe: { adres: '192.168.1.30' } });
    let t = BEGIN;
    const zoektochten = [];
    const adressen = maakAdressen({ instellingen, zoek: async (o) => (zoektochten.push(o), []), klok: () => t });
    adressen.plek('goodwe').controleer('00000DTS00000000');
    // De hele nacht geen antwoord: niets.
    for (let i = 0; i < 12 * 12; i++, t += 5 * MIN) {
      adressen.gelezen('goodwe', { ok: false, nu: t, rust: true });
      adressen.tik(t);
    }
    expect(zoektochten).toHaveLength(0);
    // Overdag geen antwoord: na OMVORMER_ZOEK_NA_MS wel.
    const dag = t;
    for (; t < dag + OMVORMER_ZOEK_NA_MS + MIN; t += 15_000) {
      adressen.gelezen('goodwe', { ok: false, nu: t });
      adressen.tik(t);
      if (t < dag + OMVORMER_ZOEK_NA_MS - 15_000) expect(zoektochten).toHaveLength(0);
    }
    expect(zoektochten).toHaveLength(1);
    expect([...zoektochten[0].merken]).toEqual(['GoodWe']);
    expect(zoektochten[0].netten).toEqual(['192.168.1.']);
  });

  it('netVan: alleen gewone IP-adressen', () => {
    expect(netVan('192.168.1.20')).toBe('192.168.1.');
    expect(netVan('meter.local')).toBeNull();
    expect(netVan('300.1.1.1')).toBeNull();
  });
});
