import { describe, expect, it } from 'vitest';
import { behandelHuis } from '../shared/huizen.js';
import { sha256Hex } from '../shared/sleutel.js';
import { HOOGSTENS_SCHRIJVEN } from '../functions/ontvangMeting/logboek.js';
import { behandelMeting, MIN_TUSSEN_MS } from '../functions/ontvangMeting/ontvang.js';
import { HOOGSTENS_ONBEKEND, HOOGSTENS_PER_TOKEN, LEZEN_ONTHOUDEN_MS } from '../shared/toegang.js';
import { nepBase44, verzoek, zonderWachten } from './nep.js';

/**
 * De rem van Base44 (~115 aanroepen per 65 s) geldt voor de hele app: alle
 * huizen samen, ook de serverrol en auth.me. Hier de rekensom voor twee huizen
 * (Tim en Dirk), elk met een programmaatje dat elke 5 s stuurt, en drie open
 * schermen: Tim op telefoon en tablet (huis 1, beheerder) en Dirk (huis 2,
 * gewone gebruiker). Een scherm vraagt elke ~5,5 s (5 s na het antwoord).
 * Geteld met de nep van Base44, na een minuut inlopen, over 65 s.
 *
 * Aanname: elke functie draait in één isolate (zo onthoudt hij). Start Base44
 * er meer, dan begint elke nieuwe met een leeg geheugen; dat kost per isolate
 * een paar aanroepen extra, geen veelvoud.
 */

const REM = 115;
const RUIM_ONDER = 0.8 * REM;

const SLEUTEL_1 = '0123456789abcdef'.repeat(3);
const SLEUTEL_2 = 'fedcba9876543210'.repeat(3);
const TIM = { id: 'gebruiker-tim', email: 'tim@voorbeeld.nl', role: 'admin' };
const DIRK = { id: 'gebruiker-dirk', email: 'dirk@voorbeeld.nl', role: 'user' };
const VREEMDE = { id: 'gebruiker-vreemd', email: 'vreemd@voorbeeld.nl', role: 'user' };
const TOKENS = { 'Bearer tim-telefoon': TIM, 'Bearer tim-tablet': TIM, 'Bearer dirk': DIRK, 'Bearer vreemde': VREEMDE };

async function opzet() {
  const nep = nepBase44({
    rijen: {
      Huis: [
        {
          id: 'huis-tim01',
          naam: 'Thuis',
          eigenaar_id: TIM.id,
          eigenaar_email: TIM.email,
          leden: [],
          brug_sleutel_hash: await sha256Hex(SLEUTEL_1),
          // Labels voor het herkennen (0.11.0): die zitten in de Huis-rij bij de sleutel, dus geen aanroep extra.
          herkend_labels: [{ id: 'a-1', soort: 'vriezer', w: 120, op: '2026-10-30T10:00:00.000Z' }],
        },
        { id: 'huis-dirk001', naam: 'Bij Dirk', eigenaar_id: TIM.id, eigenaar_email: TIM.email, leden: [{ email: DIRK.email }], brug_sleutel_hash: await sha256Hex(SLEUTEL_2) },
      ],
      Meting: [],
    },
  });
  // Per verzoek de gebruiker bij het token, en auth.me telt mee zoals bij Base44.
  const maakClient = (req) => ({
    ...nep.client,
    auth: {
      async me() {
        nep.stand.aanroepen.push('auth.me');
        const user = TOKENS[req.headers.get('Authorization')];
        if (!user) throw Object.assign(new Error('Unauthorized'), { status: 401 });
        return { ...user };
      },
    },
  });
  return { nep, maakClient };
}

/** Een minuut inlopen, dan 65 s tellen. Geeft het aantal aanroepen per 65 s, per soort. */
async function telMinuut({ inlopen = 60_000, bruggen = 2, schermen = 3, metingVoor = () => ({ net_w: 100, bron: 'brug 0.5.1' }), extra = [], aanval = [], nietNagaan = [] } = {}) {
  const { nep, maakClient } = await opzet();
  const huisGeheugen = new Map();
  const metingGeheugen = new Map();
  const dagGeheugen = new Map();
  const schema = [];
  const BEGIN = Date.parse('2026-10-30T12:00:00Z');
  const INLOPEN = inlopen;
  const EINDE = INLOPEN + 65_000;
  const bruglijst = [
    [SLEUTEL_1, 0],
    [SLEUTEL_2, 1300],
  ].slice(0, bruggen);
  for (const [sleutel, begin] of bruglijst) for (let t = begin; t < EINDE; t += 5000) schema.push({ t, brug: sleutel });
  const schermlijst = [
    ['Bearer tim-telefoon', 'huis-tim01', 0],
    ['Bearer tim-tablet', 'huis-tim01', 2000],
    ['Bearer dirk', 'huis-dirk001', 3500],
  ].slice(0, schermen);
  for (const [token, huis_id, begin] of schermlijst) for (let t = begin; t < EINDE; t += 5500) schema.push({ t, token, huis_id });
  // Wat er verder open staat: { token, actie, huis_id?, begin, elke } (het logboek, het overzicht).
  for (const e of extra) for (let t = e.begin; t < EINDE; t += e.elke) schema.push({ t, token: e.token, huis_id: e.huis_id, actie: e.actie, meer: e.meer });
  // Een aanval (ronde 19): { begin, elke, tot?, stap(t, i) } geeft per keer een verzoek; het antwoord nagaan we niet.
  for (const a of aanval) for (let t = a.begin, i = 0; t < Math.min(EINDE, a.tot ?? EINDE); t += a.elke, i += 1) schema.push({ t, aanval: true, ...a.stap(t, i) });
  schema.sort((a, b) => a.t - b.t);
  const statussen = {};

  let geteld = null;
  for (const stap of schema) {
    if (geteld === null && stap.t >= INLOPEN) geteld = nep.stand.aanroepen.length;
    const ms = BEGIN + stap.t;
    let res;
    if (stap.brug) {
      res = await behandelMeting(verzoek(stap.meting ?? metingVoor(stap.t, stap.brug), { kop: { 'x-brug-sleutel': stap.brug } }), maakClient, {
        nu: () => new Date(ms),
        geheugen: metingGeheugen,
        dagGeheugen,
        geduld: zonderWachten,
      });
    } else {
      const lichaam = stap.actie === 'overzicht' ? { actie: 'overzicht' } : { actie: stap.actie ?? 'stand', huis_id: stap.huis_id, ...stap.meer };
      const kop = stap.token ? { Authorization: stap.token } : {};
      res = await behandelHuis(verzoek(lichaam, { kop }), maakClient, {
        geduld: zonderWachten,
        geheugen: huisGeheugen,
        klok: () => ms,
      });
    }
    if (stap.aanval) {
      if (stap.t >= INLOPEN) statussen[res.status] = (statussen[res.status] ?? 0) + 1;
    } else if (!nietNagaan.includes(stap.brug)) {
      expect(res.status, JSON.stringify({ t: stap.t, brug: stap.brug?.slice(0, 4), token: stap.token })).toBe(200);
    }
  }
  const deel = nep.stand.aanroepen.slice(geteld);
  const perSoort = {};
  for (const a of deel) perSoort[a] = (perSoort[a] ?? 0) + 1;
  return { totaal: deel.length, perSoort, statussen, nep };
}

describe('de rem: twee huizen samen', () => {
  it('twee programmaatjes (elk 5 s) en drie open schermen blijven ruim onder de rem', async () => {
    const { totaal, perSoort } = await telMinuut();
    // Vóór ronde 5 was dit 160 per 65 s (139% van de rem): elke meting Huis.filter +
    // Meting.update, elke stand auth.me + Huis.get + Meting.filter. Nu, per 65 s:
    expect(perSoort, JSON.stringify(perSoort)).toEqual({
      'Meting.update': 26, // 2 bruggen x 13
      'Huis.filter': 6, // het huis bij de sleutel, eens per 30 s per brug
      'Meting.filter': 24, // Tims telefoon en tablet delen een lezing (3 s), Dirk leest apart
      'auth.me': 6, // eens per 30 s per token (3 tokens)
      'Huis.get': 4, // eens per 30 s per huis
      'Huis.list': 2, // dirks ene omgeving, eens per minuut
    });
    expect(totaal).toBe(68);
    expect(totaal).toBeLessThanOrEqual(RUIM_ONDER);
  });

  it('één programmaatje kost per 65 s 16 aanroepen (was 26), één scherm van Tim 16 (was 36)', async () => {
    expect((await telMinuut({ bruggen: 1, schermen: 0 })).totaal).toBe(16);
    expect((await telMinuut({ bruggen: 0, schermen: 1 })).totaal).toBe(16);
  });

  it('een storing die begint en weer voorbij is: één create en één update, niet per meting (logboek.js)', async () => {
    // Tims batterij meldde bij de eerste meting een storing, daarna niet meer: twee minuten later is die voorbij,
    // net aan het begin van de getelde 65 s. Bij Dirk valt daarin de P1-meter een halve minuut uit (0.6.1).
    const metingVoor = (t, sleutel) =>
      sleutel === SLEUTEL_2
        ? { net_w: 100, bron: 'brug 0.6.1', gekoppeld: [{ sleutel: 'hw-p1', naam: 'P1', merk: 'HomeWizard', soort: 'P1-meter', rol: 'net', manier: 'v1', ok: !(t >= 130_000 && t < 160_000) }] }
        : { net_w: 100, bron: 'brug 0.7.0', batterij_info: { storing: t < 5000 } };
    const { totaal, perSoort } = await telMinuut({ inlopen: 125_000, metingVoor });
    expect(perSoort['Gebeurtenis.create']).toBe(1);
    expect(perSoort['Gebeurtenis.update']).toBe(1);
    // Zonder storingen in hetzelfde stuk tijd: precies twee minder.
    expect(totaal).toBe((await telMinuut({ inlopen: 125_000 })).totaal + 2);
    expect(totaal).toBeLessThanOrEqual(RUIM_ONDER);
  });

  it('herkennen (0.11.0): het blok in elke meting en de labels terug kosten geen aanroep extra', async () => {
    const herkend = { nu: [{ id: 'a-2', soort: 'koelkast', w: 110, zeker: 0.5, sinds: '2026-10-30T11:50:00Z' }], basis: { w: 450, warmtepomp: true } };
    const brug = { versie: '0.11.0', gestart: '2026-10-30T06:00:00Z', elke_seconden: 5, herkent: true };
    const metingVoor = (t) => ({ net_w: 100, bron: 'brug 0.11.0', herkend, ...(t % 60_000 < 5000 ? { brug } : {}) });
    const { totaal } = await telMinuut({ metingVoor });
    expect(totaal).toBe(68);
  });

  it('Tim op Apparaten (het logboek, eens per 2 minuten): hooguit een paar aanroepen erbij', async () => {
    const extra = [{ token: 'Bearer tim-telefoon', actie: 'logboek', huis_id: 'huis-tim01', begin: 61_000, elke: 120_000 }];
    const { totaal, perSoort } = await telMinuut({ extra });
    expect(perSoort['Gebeurtenis.filter']).toBe(1);
    expect(totaal).toBe(69);
    expect(totaal).toBeLessThanOrEqual(RUIM_ONDER);
  });

  it('Tim met het overzicht van alle huizen open (eens per 30 s) en het logboek: nog steeds ruim onder de rem', async () => {
    const extra = [
      { token: 'Bearer tim-tablet', actie: 'overzicht', begin: 60_500, elke: 30_000 },
      { token: 'Bearer tim-telefoon', actie: 'logboek', huis_id: 'huis-tim01', begin: 61_000, elke: 120_000 },
    ];
    const { totaal, perSoort } = await telMinuut({ extra });
    // Per overzicht: auth.me (vers: alleen de beheerder), Huis.list en Meting.filter, voor alle huizen samen.
    expect(perSoort['Huis.list']).toBe(2 + 3);
    // 68 + logboek 1 + overzicht 3 x 3 = 78 per 65 s (grens 92).
    expect(totaal).toBe(78);
    expect(totaal).toBeLessThanOrEqual(RUIM_ONDER);
  });

  it('Advies op het tabblad Huis en Voorspelling (drie schermen, de dagen eens per half uur): drie aanroepen erbij', async () => {
    // src/lib/adviesBron.js: 'periode' voor zes weken tot en met gisteren, ADVIES_DAGEN_ELKE_MS = 30 minuten. Huis en
    // Voorspelling delen die ene vraag (dezelfde sleutel in useHerhaald): wisselen tussen de twee kost niets extra.
    const meer = { van: '2026-09-18', tot: '2026-10-29' };
    const extra = [
      { token: 'Bearer tim-telefoon', actie: 'periode', huis_id: 'huis-tim01', begin: 61_000, elke: 1_800_000, meer },
      { token: 'Bearer tim-tablet', actie: 'periode', huis_id: 'huis-tim01', begin: 63_000, elke: 1_800_000, meer },
      { token: 'Bearer dirk', actie: 'periode', huis_id: 'huis-dirk001', begin: 64_500, elke: 1_800_000, meer },
    ];
    const { totaal, perSoort } = await telMinuut({ extra });
    // Elk scherm één Dag.filter; auth.me en het huis zijn onthouden (leesvraag, zoals de stand).
    expect(perSoort['Dag.filter']).toBe(3);
    expect(totaal).toBe(68 + 3);
    expect(totaal).toBeLessThanOrEqual(RUIM_ONDER);
  });

  it('het weer (programmaatje 0.9.0) kost geen aanroep extra, ook niet als het elke meting meegaat', async () => {
    // brug/weer.mjs stuurt het hooguit eens per uur nieuw en eens per kwartier opnieuw, in de meting die toch al gaat.
    // Hier het ergste geval: elke 5 s, met een dag erbij zodat ontvangMeting ook de straling in Dag bijhoudt.
    const straling = Array.from({ length: 48 }, (_, i) => (i % 24 >= 8 && i % 24 <= 16 ? 200 : 0));
    const weer = { van: '2026-10-29T22:00:00.000Z', stap_min: 60, straling_wm2: straling, bewolking_pct: Array(48).fill(50), temp_c: Array(48).fill(9), bron: 'open-meteo' };
    const dag = { datum: '2026-10-30', van: '2026-10-29T23:00:00.000Z', stap_min: 15, sinds: '2026-10-29T23:00:00.000Z', metingen: [180], huis_w: [400], kwh: { zon: 0, huis: 0.1, geladen: 0, ontladen: 0 } };
    const metWeer = await telMinuut({ metingVoor: () => ({ net_w: 100, bron: 'brug 0.9.0', dag, weer }) });
    const zonderWeer = await telMinuut({ metingVoor: () => ({ net_w: 100, bron: 'brug 0.8.0', dag }) });
    expect(metWeer.perSoort).toEqual(zonderWeer.perSoort);
    expect(metWeer.totaal).toBeLessThanOrEqual(RUIM_ONDER);
  });

  it('de app openen (stand van het vorige huis, mijn, opstelling) kost één auth.me, niet drie (prestaties-18)', async () => {
    const { nep, maakClient } = await opzet();
    const geheugen = new Map();
    const BEGIN = Date.parse('2026-10-30T12:00:00Z');
    const vraag = async (lichaam, token, ms) =>
      behandelHuis(verzoek(lichaam, { kop: { Authorization: token } }), maakClient, { geduld: zonderWachten, geheugen, klok: () => BEGIN + ms });
    for (const [token, huis_id] of [
      ['Bearer tim-telefoon', 'huis-tim01'],
      ['Bearer dirk', 'huis-dirk001'],
    ]) {
      const voor = nep.stand.aanroepen.length;
      expect((await vraag({ actie: 'stand', huis_id }, token, 0)).status).toBe(200);
      expect((await vraag({ actie: 'mijn' }, token, 300)).status).toBe(200);
      expect((await vraag({ actie: 'opstelling', huis_id }, token, 600)).status).toBe(200);
      expect(nep.stand.aanroepen.slice(voor).filter((a) => a === 'auth.me')).toHaveLength(1);
    }
    // Ook als 'mijn' eerst komt (de eerste keer, nog geen vorig huis): één auth.me.
    const voor = nep.stand.aanroepen.length;
    await vraag({ actie: 'mijn' }, 'Bearer tim-tablet', 0);
    await vraag({ actie: 'stand', huis_id: 'huis-tim01' }, 'Bearer tim-tablet', 200);
    await vraag({ actie: 'opstelling', huis_id: 'huis-tim01' }, 'Bearer tim-tablet', 400);
    expect(nep.stand.aanroepen.slice(voor).filter((a) => a === 'auth.me')).toHaveLength(1);
    // Schrijven en beheren vragen wel vers wie er belt, ook met een onthouden token.
    const voorSchrijven = nep.stand.aanroepen.length;
    await vraag({ actie: 'bewaarOpstelling', huis_id: 'huis-tim01', opstelling: { tekening: 'schuur' } }, 'Bearer tim-tablet', 800);
    expect(nep.stand.aanroepen.slice(voorSchrijven)).toContain('auth.me');
  });

  it('wat de functie huis onthoudt, is hooguit een minuut oud (de rechten: toegang.js)', () => {
    expect(LEZEN_ONTHOUDEN_MS).toBeLessThanOrEqual(60_000);
  });
});

/**
 * Aanvallen op de gedeelde rem (ronde 19, B2 tot B4): wat een vreemde, een
 * ingelogde vreemde of iemand met een gekopieerde brugsleutel de rem hooguit
 * kost. Telkens bovenop de gewone 68 per 65 s, en de eigen bruggen en schermen
 * krijgen intussen gewoon antwoord (telMinuut gaat dat na).
 */
describe('de rem: aanvallen', () => {
  const hex = (i) => i.toString(16).padStart(48, '0');

  it('een vreemde zonder account: elke 0,5 s een verzonnen brugsleutel en een onzin-token kost samen hooguit 2 x 10 aanroepen', async () => {
    const aanval = [
      // Steeds een andere sleutel van de goede vorm (48 hex), en steeds een ander token.
      { begin: 100, elke: 500, stap: (t, i) => ({ brug: hex(i + 1), meting: { net_w: 1 } }) },
      { begin: 300, elke: 500, stap: (t, i) => ({ token: `Bearer onzin-${i}`, huis_id: 'huis-tim01' }) },
    ];
    const { totaal, perSoort, statussen } = await telMinuut({ aanval });
    // Per venster hooguit HOOGSTENS_ONBEKEND mislukte opzoekingen per soort; de rest is 401 of 429 zonder aanroep.
    expect(perSoort['Huis.filter']).toBeLessThanOrEqual(6 + HOOGSTENS_ONBEKEND);
    expect(perSoort['auth.me']).toBeLessThanOrEqual(6 + HOOGSTENS_ONBEKEND);
    expect(statussen[200]).toBeUndefined();
    expect(totaal).toBeLessThanOrEqual(68 + 2 * HOOGSTENS_ONBEKEND);
    expect(totaal).toBeLessThanOrEqual(RUIM_ONDER);
  });

  it('dezelfde verzonnen sleutel of hetzelfde onzin-token steeds opnieuw: één aanroep per minuut', async () => {
    const aanval = [
      { begin: 100, elke: 200, stap: () => ({ brug: hex(7), meting: { net_w: 1 } }) },
      { begin: 300, elke: 200, stap: () => ({ token: 'Bearer onzin', huis_id: 'huis-tim01' }) },
      // Zonder token: nooit een aanroep.
      { begin: 400, elke: 200, stap: () => ({ huis_id: 'huis-tim01' }) },
    ];
    const { totaal, statussen } = await telMinuut({ aanval });
    // Eens per ONBEKEND_ONTHOUDEN_MS (60 s) één Huis.filter en één auth.me: in 65 s hooguit twee van elk.
    expect(totaal).toBeLessThanOrEqual(68 + 4);
    expect(statussen[401]).toBe(3 * 325);
  });

  it('een ingelogde vreemde (account zonder omgeving) met verzonnen huis-ids: geen Huis.get, en hooguit HOOGSTENS_PER_TOKEN keer auth.me', async () => {
    const aanval = [
      // Leesvragen (stand) met steeds een ander id: auth.me onthouden, zijn ene omgeving (geen) ook.
      { begin: 100, elke: 500, stap: (t, i) => ({ token: 'Bearer vreemde', huis_id: `huis-${String(i).padStart(6, '0')}` }) },
      // De opstelling van een huis dat niet het zijne is: auth.me onthouden (ronde 21), zijn ene omgeving (geen) ook: 404.
      { begin: 300, elke: 500, stap: () => ({ token: 'Bearer vreemde', actie: 'opstelling', huis_id: 'huis-tim01' }) },
    ];
    const { totaal, perSoort, statussen } = await telMinuut({ aanval });
    expect(perSoort['Huis.get']).toBe(4); // alleen die van Tim en Dirk, zoals zonder aanval
    expect(statussen[200]).toBeUndefined();
    expect(statussen[404]).toBeGreaterThan(0);
    // Zijn ene omgeving (geen) eens per minuut: Huis.list 2 (dirk) + hooguit 2.
    expect(perSoort['Huis.list']).toBeLessThanOrEqual(4);
    expect(totaal).toBeLessThanOrEqual(68 + HOOGSTENS_PER_TOKEN + 2);
    expect(totaal).toBeLessThanOrEqual(RUIM_ONDER);
  });

  it('een gekopieerde brugsleutel: 10 metingen in 1 s zijn één schrijfactie', async () => {
    // Alleen die ene seconde, tussen twee metingen van dirks eigen programmaatje in (61,3 s en 66,3 s); de rest loopt zoals altijd.
    const aanval = [{ begin: 63_500, elke: 100, tot: 64_500, stap: () => ({ brug: SLEUTEL_2, meting: { net_w: 5 } }) }];
    const zonder = await telMinuut();
    const { perSoort, statussen } = await telMinuut({ aanval });
    expect(perSoort['Meting.update']).toBe(zonder.perSoort['Meting.update'] + 1);
    expect(statussen).toEqual({ 200: 1, 429: 9 });
  });

  it('een gekopieerde brugsleutel die elke 0,2 s stuurt, met 32 storingsbits om de minuut: dat huis schrijft hooguit eens per 2 s, en alles samen blijft onder de rem', async () => {
    const storing = { stand: 'storing', storingen: Array.from({ length: 32 }, (_, i) => i) };
    const aanval = [
      {
        begin: 50,
        elke: 200,
        stap: (t) => ({ brug: SLEUTEL_2, meting: { net_w: 5, omvormer: Math.floor(t / 60_000) % 2 ? { stand: 'normaal' } : storing } }),
      },
    ];
    const { totaal, perSoort } = await telMinuut({ aanval, nietNagaan: [SLEUTEL_2] });
    // Tims programmaatje (13) + hooguit één meting per MIN_TUSSEN_MS voor het aangevallen huis.
    expect(perSoort['Meting.update']).toBeLessThanOrEqual(13 + Math.ceil(65_000 / MIN_TUSSEN_MS));
    // Het logboek: hooguit HOOGSTENS_SCHRIJVEN per meting, en hooguit 20 open (HOOGSTENS_OPEN).
    expect((perSoort['Gebeurtenis.create'] ?? 0) + (perSoort['Gebeurtenis.update'] ?? 0)).toBeLessThanOrEqual(40);
    expect(totaal).toBeLessThanOrEqual(REM);
  });

  it('één meting met 32 storingsbits: hooguit HOOGSTENS_SCHRIJVEN creates, de rest bij de volgende metingen', async () => {
    const storing = { stand: 'storing', storingen: Array.from({ length: 32 }, (_, i) => i) };
    const metingVoor = (t, sleutel) => (sleutel === SLEUTEL_2 && t >= 60_000 ? { net_w: 5, omvormer: storing } : { net_w: 100 });
    const { perSoort, nep } = await telMinuut({ metingVoor });
    // In 65 s 13 metingen van Dirk: per meting hooguit 3, tot er 20 openstaan.
    expect(perSoort['Gebeurtenis.create']).toBe(20);
    const eerste = nep.tabellen.Gebeurtenis.lijst.filter((r) => r.begin === nep.tabellen.Gebeurtenis.lijst[0].begin);
    expect(eerste).toHaveLength(HOOGSTENS_SCHRIJVEN);
  });
});

