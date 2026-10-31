import { describe, expect, it } from 'vitest';
import { maakMissers } from './bewaking.mjs';
import { maakHerkenner } from './herkennen.mjs';
import { netStoringVolger } from './homewizard.mjs';
import { controleerInstellingen } from './instellingen.mjs';
import { beginStaat, draaiLus, EXTRA_PAUZE_MS, maakRonde, meetAlles, MINSTENS_WACHT_MS, SLEUTEL_OPNIEUW_MS, SLEUTEL_WEG } from './ronde.mjs';
import { maakVerbruikWacht } from './samenvoegen.mjs';
import { kennisVolger } from './kennis.mjs';
import { spanningWacht } from './spanning.mjs';
import { extraPlanner, HOOGSTENS_TEKENS } from './versturen.mjs';

/** 30 oktober 2026, 12:00 Nederlandse tijd. */
const BEGIN = Date.UTC(2026, 9, 30, 11);

const INSTELLINGEN = controleerInstellingen({
  app: { adres: 'https://voorbeeld.base44.app/functions/ontvangMeting', sleutel: 'a'.repeat(48) },
  elke_seconden: 5,
  homewizard: [
    { naam: 'Meterkast', rol: 'net', adres: '192.168.1.20' },
    { naam: 'Zon', rol: 'zon', adres: '192.168.1.22' },
  ],
}).instellingen;

/**
 * Eén draaiend programmaatje met nep-meters, een nep-app en een nepklok. De klok loopt alleen
 * als de test hem laat lopen: `meetDuur` per meting, en `tijd.verder(ms)` tussen twee rondes.
 */
function opzet({ meters = {}, app = async () => ({ ok: true, status: 200 }), meetDuur = 300, bestandOp = () => 1, probeer = () => ({ ok: true }), p1 = null, kennis = null, extra = {} } = {}) {
  let t = BEGIN;
  const tijd = { nu: () => t, verder: (ms) => (t += ms) };
  const logs = [];
  const log = (tekst) => logs.push(tekst);
  const verstuurd = [];
  const opstart = [];
  const afgesloten = [];
  let bewaard = 0;
  const geheugen = new Map();
  const problemen = new Map();
  const missers = maakMissers();
  const lees = {
    homewizard: async (meter) => {
      const w = meters[meter.adres] ?? { '192.168.1.20': 350, '192.168.1.22': 1200 }[meter.adres];
      if (w instanceof Error) throw w;
      // 1.4.0: de P1-meter met wat hij verder geeft (p1(): { meterkast, kennis }).
      return { w, tellers: null, fasen: null, storingen: null, ...(meter.rol === 'net' && p1 ? p1(t) : {}) };
    },
    zendureP1: async () => null,
  };
  const zendure = { lees: async () => null, stop() {}, product: null };
  const staat = beginStaat({ kosten: { dag: null, jaar: null, logboek: null }, basis: 5000, nu: t, klok: t, instellingenOp: 1 });
  const { ronde } = maakRonde({
    staat,
    instellingen: INSTELLINGEN,
    basis: 5000,
    instellingenPad: '/nep/instellingen.json',
    versie: '1.2.0',
    gestart: new Date(BEGIN).toISOString(),
    herkenner: maakHerkenner(),
    verbruikWacht: maakVerbruikWacht(),
    netStoringen: netStoringVolger(),
    missers,
    problemen,
    sindsFout: new Map(),
    plan: extraPlanner(),
    prijzen: null,
    weer: { tik() {}, blok: () => null },
    opAfstand: null,
    zendure,
    goodwe: null,
    ...(kennis ? { kennis } : {}),
    ...extra,
    log,
    nu: tijd.nu,
    klok: tijd.nu,
    meet: async () => {
      const uit = await meetAlles({ instellingen: INSTELLINGEN, zendure, geheugen, problemen, historie: new Map(), missers, versie: '1.2.0', log, nuMs: tijd.nu, lees });
      tijd.verder(meetDuur);
      return uit;
    },
    verstuur: async (meting) => {
      verstuurd.push(meting);
      return app(meting, verstuurd.length);
    },
    bestandOp,
    probeerInstellingen: probeer,
    houdLogKlein: () => false,
    opslagFout: () => null,
    bewaar: () => (bewaard += 1),
    bewaarHerkennen() {},
    meldOpstart: (stand) => opstart.push(stand),
    pakOp: () => ({ veranderd: false }),
    afsluiten: (code) => afgesloten.push(code),
  });
  return { ronde, staat, tijd, logs, verstuurd, opstart, afgesloten, problemen, bewaard: () => bewaard };
}

/** Rondes zoals draaiLus ze draait: ronde, dan de klok zo ver als er gewacht wordt. */
async function rondes(o, keer) {
  const wachten = [];
  for (let i = 0; i < keer; i++) {
    const wacht = await o.ronde();
    wachten.push(wacht);
    o.tijd.verder(wacht);
  }
  return wachten;
}

describe('één ronde van het programmaatje', () => {
  it('normaal: meten, de stand naar de app, en 5 s min de duur van de ronde wachten', async () => {
    const o = opzet();
    expect(await o.ronde()).toBe(5000 - 300);
    expect(o.verstuurd).toHaveLength(1);
    const [meting] = o.verstuurd;
    expect(meting).toMatchObject({ net_w: 350, zon_w: 1200, bron: 'brug 1.2.0' });
    // De eerste keer gaan de dag, de koppelingen en het brugblok mee.
    expect(meting.dag).toMatchObject({ stap_min: 15, metingen: expect.any(Array) });
    expect(meting.brug).toMatchObject({ versie: '1.2.0', elke_seconden: 5, herkent: true });
    expect(meting.gekoppeld).toBeTruthy();
    expect(JSON.stringify(meting).length).toBeLessThanOrEqual(HOOGSTENS_TEKENS);
    expect(o.logs).toContain('Eerste stand staat in de app.');
    expect(o.opstart).toEqual(['eerste-stand']);
    expect(o.staat).toMatchObject({ verstuurd: 1, wacht: 5000, rondSinds: null, laatsteFout: '' });

    // De volgende ronde: alleen de stand (de extra's gaan eens per minuut), en geen tweede 'eerste stand'.
    o.tijd.verder(4700);
    await o.ronde();
    expect(o.verstuurd[1]).not.toHaveProperty('dag');
    expect(o.verstuurd[1]).not.toHaveProperty('brug');
    expect(o.opstart).toEqual(['eerste-stand']);
    expect(o.staat.logboek.kwh.huis).toBeGreaterThan(0);
  });

  it('een meter die niet antwoordt: eerst even de laatste waarde, na 3 keer één regel in het logboek, de app krijgt de stand gewoon', async () => {
    const meters = {};
    const o = opzet({ meters });
    await rondes(o, 1);
    meters['192.168.1.20'] = Object.assign(new Error('connect EHOSTUNREACH 192.168.1.20:443'), { code: 'EHOSTUNREACH' });
    await rondes(o, 2);
    // Twee keer gemist: nog de laatste waarde, nog niets in het logboek.
    expect(o.verstuurd.at(-1).net_w).toBe(350);
    expect(o.logs.filter((r) => r.startsWith('Meterkast'))).toEqual([]);
    await rondes(o, 3);
    const regels = o.logs.filter((r) => r.startsWith('Meterkast (192.168.1.20)'));
    expect(regels).toHaveLength(1);
    expect(o.problemen.has('hw-meterkast')).toBe(true);
    // Elke ronde ging er toch iets naar de app.
    expect(o.verstuurd).toHaveLength(6);
    // Na een minuut zonder antwoord geen oude waarde meer: geen net.
    await rondes(o, 12);
    expect(o.verstuurd.at(-1).net_w ?? null).toBeNull();
    // Hij is terug: één regel, en de waarde weer.
    delete meters['192.168.1.20'];
    await rondes(o, 1);
    expect(o.logs).toContain('Meterkast (192.168.1.20): antwoordt weer.');
    expect(o.verstuurd.at(-1).net_w).toBe(350);
    expect(o.problemen.has('hw-meterkast')).toBe(false);
  });

  it('de app remt (429): 10, 20, 40 s … tot hooguit 2 minuten, en daarna weer elke 5 s', async () => {
    let remt = true;
    const o = opzet({ app: async () => (remt ? { ok: false, status: 429, fout: 'te veel verzoeken' } : { ok: true, status: 200 }) });
    const wachten = await rondes(o, 6);
    expect(wachten.map((w) => w + 300)).toEqual([10_000, 20_000, 40_000, 80_000, 120_000, 120_000]);
    // Eén regel, niet bij elke ronde.
    expect(o.logs.filter((r) => r.startsWith('Versturen lukt niet'))).toEqual(['Versturen lukt niet: te veel verzoeken (Base44 remt; even 10 s wachten)']);
    remt = false;
    expect(await o.ronde()).toBe(5000 - 300);
    expect(o.logs).toContain('Versturen lukt weer.');
  });

  it('de app hapert (500, of geen antwoord): een milde pauze die oploopt tot 30 s', async () => {
    const o = opzet({ app: async (_, n) => ({ ok: false, status: n % 2 ? 500 : 0, fout: n % 2 ? 'de app gaf 500' : 'geen verbinding' }) });
    const wachten = await rondes(o, 5);
    expect(wachten.map((w) => w + 300)).toEqual([10_000, 20_000, 30_000, 30_000, 30_000]);
    expect(o.staat.verstuurd).toBe(0);
    // Elke andere fout één regel; dezelfde fout op rij niet nog eens.
    expect(o.logs.filter((r) => r.startsWith('Versturen lukt niet'))).toHaveLength(5);
  });

  it('de app kent de sleutel niet (401): blijven meten, 5 minuten niets sturen, dan opnieuw proberen', async () => {
    let weg = true;
    const o = opzet({ app: async () => (weg ? { ok: false, status: 401, fout: 'sleutel onbekend' } : { ok: true, status: 200 }) });
    await o.ronde();
    expect(o.logs.filter((r) => r === SLEUTEL_WEG)).toHaveLength(1);
    expect(o.staat.appNietVoor).toBe(BEGIN + 300 + SLEUTEL_OPNIEUW_MS);
    expect(o.afgesloten).toEqual([]);
    // Vijf minuten lang: wel meten (vandaag loopt door), niets naar de app.
    const voor = o.staat.logboek.laatste;
    o.tijd.verder(5000);
    const wachten = await rondes(o, 50);
    expect(o.verstuurd).toHaveLength(1);
    expect(wachten.every((w) => w === 5000 - 300)).toBe(true);
    expect(o.staat.logboek.laatste).toBeGreaterThan(voor);
    expect(o.staat.rondSinds).toBeNull();
    // Daarna weer proberen; nog steeds weg: niet nog een regel.
    await rondes(o, 15);
    expect(o.verstuurd).toHaveLength(2);
    expect(o.logs.filter((r) => r === SLEUTEL_WEG)).toHaveLength(1);
    // Een nieuwe sleutel: weer elke ronde.
    weg = false;
    o.tijd.verder(SLEUTEL_OPNIEUW_MS);
    await rondes(o, 2);
    expect(o.verstuurd).toHaveLength(4);
    expect(o.logs).toContain('Versturen lukt weer.');
  });

  it('weigert de app een blok, dan een kwartier alleen de stand', async () => {
    const o = opzet({ app: async (_, n) => (n === 1 ? { ok: true, status: 200, geweigerd: 'dag: dag.procent klopt niet' } : { ok: true, status: 200 }) });
    await o.ronde();
    expect(o.staat.extraNietVoor).toBe(BEGIN + 300 + EXTRA_PAUZE_MS);
    await rondes(o, 20);
    expect(o.verstuurd.slice(1).every((m) => !m.dag && !m.brug && !m.gekoppeld)).toBe(true);
    o.tijd.verder(EXTRA_PAUZE_MS);
    await o.ronde();
    expect(o.verstuurd.at(-1).dag).toBeTruthy();
  });

  it('een ronde die langer duurt dan 5 s: daarna nog 1 s wachten, niet meteen weer', async () => {
    const o = opzet({ meetDuur: 7000 });
    expect(await o.ronde()).toBe(MINSTENS_WACHT_MS);
    // En bij de rem telt de duur van de ronde mee in de pauze.
    const r = opzet({ meetDuur: 7000, app: async () => ({ ok: false, status: 429, fout: 'te veel verzoeken' }) });
    expect(await r.ronde()).toBe(10_000 - 7000);
  });

  it('springt de klok van de telefoon terug, dan niets meten en 5 s wachten', async () => {
    const o = opzet();
    await o.ronde();
    o.tijd.verder(-10 * 60_000);
    expect(await o.ronde()).toBe(5000);
    expect(o.verstuurd).toHaveLength(1);
    expect(o.logs.some((r) => r.startsWith('De klok van de telefoon sprong terug'))).toBe(true);
  });

  it('verandert instellingen.json en klopt hij, dan netjes opnieuw starten; klopt hij niet, dan door met de oude', async () => {
    let op = 1;
    const goed = opzet({ bestandOp: () => op });
    op = 2;
    expect(await goed.ronde()).toBeNull();
    expect(goed.afgesloten).toEqual([0]);
    expect(goed.verstuurd).toHaveLength(0);

    const fout = opzet({ bestandOp: () => 3, probeer: () => ({ ok: false, fouten: ['elke_seconden: kies een getal van 3 tot 300.'] }) });
    expect(await fout.ronde()).toBe(5000 - 300);
    expect(fout.afgesloten).toEqual([]);
    expect(fout.logs).toContain('instellingen.json is veranderd maar klopt nog niet (elke_seconden: kies een getal van 3 tot 300.); ik ga door met de oude.');
  });

  it('elke minuut de stand bewaren (vandaag.json)', async () => {
    const o = opzet();
    await rondes(o, 12);
    expect(o.bewaard()).toBe(0);
    await rondes(o, 2);
    expect(o.bewaard()).toBe(1);
  });
});

describe('de lus', () => {
  it('nooit twee rondes tegelijk, ook niet als een ronde langer duurt dan het wachten', async () => {
    let bezig = 0;
    let hoogste = 0;
    const volgorde = [];
    let n = 0;
    const ronde = async () => {
      bezig += 1;
      hoogste = Math.max(hoogste, bezig);
      volgorde.push(`begin ${n}`);
      // Een trage ronde: een paar echte beurten van de event loop, met timers ertussen.
      await new Promise((klaar) => setTimeout(klaar, 5));
      await Promise.resolve();
      volgorde.push(`eind ${n}`);
      n += 1;
      bezig -= 1;
      return MINSTENS_WACHT_MS;
    };
    const geslapen = [];
    await draaiLus({ ronde, slaap: async (ms) => geslapen.push(ms), door: () => n < 5 });
    expect(hoogste).toBe(1);
    expect(volgorde).toEqual(['begin 0', 'eind 0', 'begin 1', 'eind 1', 'begin 2', 'eind 2', 'begin 3', 'eind 3', 'begin 4', 'eind 4']);
    expect(geslapen).toEqual([1000, 1000, 1000, 1000, 1000]);
  });

  it('met echte rondes: na elkaar, en wachten pas als de ronde klaar is', async () => {
    const o = opzet({ meetDuur: 6000 });
    const gebeurd = [];
    let rondesKlaar = 0;
    const ronde = async () => {
      gebeurd.push('ronde');
      const wacht = await o.ronde();
      rondesKlaar += 1;
      return wacht;
    };
    await draaiLus({
      ronde,
      slaap: async (ms) => {
        gebeurd.push(`wacht ${ms}`);
        o.tijd.verder(ms);
      },
      door: () => rondesKlaar < 3,
    });
    expect(gebeurd).toEqual(['ronde', 'wacht 1000', 'ronde', 'wacht 1000', 'ronde', 'wacht 1000']);
    expect(o.verstuurd).toHaveLength(3);
  });

  it('geeft een ronde null (opnieuw starten), dan stopt de lus', async () => {
    let keer = 0;
    await draaiLus({ ronde: async () => (++keer === 2 ? null : 5000), slaap: async () => {} });
    expect(keer).toBe(2);
  });
});

describe('1.4.0: de meterkast en de kennislijst in de ronde', () => {
  it('gas van vandaag bij de stand (elke meting), in de dag (elke minuut), en de veldnamen één keer per dag', async () => {
    let gas = 1000;
    const p1 = () => {
      gas += 0.01;
      return {
        meterkast: { tarief: 1, meters: [{ soort: 'gas', stand: Math.round(gas * 1000) / 1000, eenheid: 'm3' }] },
        kennis: () => ['active_power_w=350', 'active_tariff=1', 'total_gas_m3=1000', 'unique_id', 'wifi_ssid'],
      };
    };
    const o = opzet({ p1, kennis: kennisVolger() });
    await rondes(o, 3);
    const [eerste, , derde] = o.verstuurd;
    expect(eerste.meterkast).toEqual({ tarief: 1, meters: [{ soort: 'gas', stand: 1000.01, eenheid: 'm3', vandaag: 0 }] });
    expect(derde.meterkast.meters[0]).toMatchObject({ stand: 1000.03, vandaag: 0.02 });
    expect(eerste.dag).toMatchObject({ gas_m3: 0 });
    // De kennislijst één keer, en niet opnieuw dezelfde dag.
    expect(eerste.kennis).toEqual({ apparaten: [{ sleutel: 'hw-meterkast', soort: 'HomeWizard P1-meter (v1)', datum: '2026-10-30', velden: expect.arrayContaining(['active_tariff=1', 'wifi_ssid']) }] });
    expect(o.verstuurd.slice(1).some((m) => m.kennis)).toBe(false);
    // De volgende dag weer.
    o.tijd.verder(24 * 3_600_000);
    await rondes(o, 1);
    expect(o.verstuurd.at(-1).kennis.apparaten[0].datum).toBe('2026-10-31');
    expect(JSON.stringify(o.verstuurd)).not.toMatch(/Thuis-wifi|00112233/);
  });

  it('weigert de app de meting niet (een oudere functie laat het stil vallen), dan telt de kennislijst als verstuurd', async () => {
    const o = opzet({ p1: () => ({ kennis: () => ['a=1'] }), kennis: kennisVolger() });
    await rondes(o, 2);
    expect(o.verstuurd[0].kennis).toBeTruthy();
    expect(o.verstuurd[1].kennis).toBeUndefined();
    expect(o.verstuurd[0]).not.toHaveProperty('meterkast');
  });

  it('mislukt het versturen, dan gaat de kennislijst de volgende keer mee', async () => {
    const o = opzet({ p1: () => ({ kennis: () => ['a=1'] }), kennis: kennisVolger(), app: async (_m, n) => (n === 1 ? { ok: false, status: 0, fout: 'geen internet' } : { ok: true, status: 200 }) });
    await rondes(o, 2);
    expect(o.verstuurd[0].kennis).toBeTruthy();
    expect(o.verstuurd[1].kennis).toBeTruthy();
  });
});

describe('1.5.0: de omvormer bij een negatieve prijs, en de spanningswacht', () => {
  it('de instelling uit het antwoord van de app gaat naar de besturing; zonder (een oudere functie) null = uit', async () => {
    const ingesteld = [];
    const rondes2 = [];
    const stuurder = { ronde: async (r) => rondes2.push(r), voorApp: () => ({ aan: false, stand: 'onbekend', blokken: [] }), zetInstelling: (x) => ingesteld.push(x), staat: { bekend: 'onbekend' } };
    const o = opzet({ app: async (_m, keer) => (keer === 1 ? { ok: true, status: 200, omvormer_sturen: { aan: true } } : { ok: true, status: 200 }), extra: { stuurder } });
    await rondes(o, 2);
    expect(ingesteld).toEqual([{ aan: true }, null]);
    expect(rondes2).toHaveLength(2);
    expect(rondes2[0]).toMatchObject({ omvormerStand: null, meting: { netW: 350, zonW: 1200 }, nominaal: null });
  });

  it('een fout in de besturing houdt de meting niet tegen', async () => {
    const stuurder = { ronde: async () => { throw new Error('kapot'); }, voorApp: () => ({}), zetInstelling() {}, staat: {} };
    const o = opzet({ extra: { stuurder } });
    await rondes(o, 1);
    expect(o.verstuurd).toHaveLength(1);
    expect(o.logs.some((l) => /Omvormer sturen: kapot/.test(l))).toBe(true);
  });

  it('de spanningswacht: de spanning van de P1 per fase, eens per minuut als blok spanning', async () => {
    const o = opzet({ p1: () => ({ fasen: [{ fase: 1, w: 300, a: 1.3, v: 249.6 }], spanning: [{ fase: 1, v: 249.6 }] }), extra: { spanning: spanningWacht() } });
    await rondes(o, 2);
    expect(o.verstuurd[0].spanning).toMatchObject({ herkomst: [{ sleutel: 'L1', bron: 'p1' }], nu: [{ sleutel: 'L1', v: 249.6 }], hoogste: [expect.objectContaining({ sleutel: 'L1', v: 249.6 })] });
    expect(o.verstuurd[1]).not.toHaveProperty('spanning');
  });
});
