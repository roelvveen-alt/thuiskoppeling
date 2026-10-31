import { describe, expect, it } from 'vitest';
import {
  EINDE_SALDERING,
  heeftMorgen,
  isDag,
  jaarVoorApp,
  kaleTeruglevering,
  metReserve,
  naPlafond,
  prijsOp,
  prijsVolger,
  prijsVoorApp,
  TERUGLEVERKOSTEN_PER_KWH,
  voegPrijzenSamen,
  voorspellingVoorApp,
  waardeTeruglevering,
  zonneplanTijdvak,
} from './prijzen.mjs';
import { zonOpEnOnder, zonVoorPlaats } from './zon.mjs';

const nlTijd = (ms) => new Date(ms).toLocaleTimeString('nl-NL', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit' });
const minuten = (tekst) => tekst.split(':').reduce((u, m) => u * 60 + Number(m), 0);

describe('zon op en onder', () => {
  it.each([
    // De Bilt, volgens het KNMI: op en onder in Nederlandse tijd
    ['2026-06-21', '05:20', '22:04'],
    ['2026-12-21', '08:46', '16:29'],
    ['2026-10-30', '07:31', '17:13'],
  ])('de rekenwijze klopt: De Bilt op %s, op %s, onder %s (op twee minuten na)', (datum, op, onder) => {
    const zon = zonOpEnOnder(datum, 52.1, 5.18);
    expect(Math.abs(minuten(nlTijd(zon.op)) - minuten(op))).toBeLessThanOrEqual(2);
    expect(Math.abs(minuten(nlTijd(zon.onder)) - minuten(onder))).toBeLessThanOrEqual(2);
  });

  it('een plaats uit de instellingen; zonder plaats De Bilt', () => {
    expect(zonVoorPlaats(null)('2026-10-30')).toEqual(zonOpEnOnder('2026-10-30'));
    // Den Helder ligt westelijker: de zon komt later op.
    expect(zonVoorPlaats({ breedte: 52.96, lengte: 4.76 })('2026-10-30').op).toBeGreaterThan(zonOpEnOnder('2026-10-30').op);
  });

  it('zonder plek: De Bilt; een plek oostelijker heeft de zon eerder op en eerder onder', () => {
    for (const datum of ['2026-03-20', '2026-09-23']) {
      const oost = zonOpEnOnder(datum, 52.1, 5.86);
      const deBilt = zonOpEnOnder(datum);
      expect(deBilt).toEqual(zonOpEnOnder(datum, 52.1, 5.18));
      // Bij dag en nacht even lang is het alleen de lengtegraad: 0,68° is 2,7 minuten.
      expect((deBilt.op - oost.op) / 60_000).toBeCloseTo(2.7, 0);
      expect((deBilt.onder - oost.onder) / 60_000).toBeCloseTo(2.7, 0);
    }
  });
});

describe('regels van Zonneplan', () => {
  const kwartier = (iso) => ({ van: Date.parse(iso), tot: Date.parse(iso) + 15 * 60_000 });

  it('2026: terugleveren = afnemen (saldering), plus de Zonnebonus overdag', () => {
    const dag = zonneplanTijdvak({ ...kwartier('2026-10-30T11:00:00Z'), alles: 0.3, zonderBelasting: 0.19, isDag: true });
    expect(dag.afname_kwh).toBe(0.3);
    expect(dag.zonnebonus_kwh).toBeCloseTo(0.019, 9);
    expect(dag.teruglevering_kwh).toBeCloseTo(0.319, 9);
    expect(zonneplanTijdvak({ ...kwartier('2026-10-30T20:00:00Z'), alles: 0.3, zonderBelasting: 0.19, isDag: false }).teruglevering_kwh).toBe(0.3);
  });

  it('vanaf 2027 (geen saldering): terugleveren zonder energiebelasting', () => {
    const vak = zonneplanTijdvak({ ...kwartier('2027-01-01T11:00:00Z'), alles: 0.3, zonderBelasting: 0.19, isDag: true });
    expect(vak.teruglevering_kwh).toBeCloseTo(0.209, 9);
    // Het laatste kwartier van 2026 (Nederlandse tijd) valt nog onder saldering.
    expect(zonneplanTijdvak({ ...kwartier('2026-12-31T22:45:00Z'), alles: 0.3, zonderBelasting: 0.19, isDag: false }).teruglevering_kwh).toBe(0.3);
  });

  it('vanaf 2027 volgens de mail van Zonneplan (29-09-2026): marktprijs + Zonnebonus, geen terugleverkosten, geen saldering', () => {
    expect(EINDE_SALDERING).toBe(Date.parse('2027-01-01T00:00:00+01:00'));
    expect(TERUGLEVERKOSTEN_PER_KWH).toBe(0);
    // Overdag, onder het plafond: kale prijs (marktprijs + inkoopvergoeding, met btw) plus 10% Zonnebonus.
    const dag = zonneplanTijdvak({ ...kwartier('2027-06-01T10:00:00Z'), alles: 0.3, zonderBelasting: 0.19, isDag: true });
    for (const nettoAfnemer of [true, false]) expect(waardeTeruglevering(dag, { nettoAfnemer })).toBeCloseTo(0.19 + 0.019, 9);
    expect(kaleTeruglevering(dag)).toBeCloseTo(0.209, 9);
    // Na het plafond (7.500 kWh) en 's nachts: alleen de kale prijs; een negatieve prijs krijgt geen (negatieve) bonus.
    expect(waardeTeruglevering(naPlafond(dag, 7500))).toBeCloseTo(0.19, 9);
    expect(waardeTeruglevering(zonneplanTijdvak({ ...kwartier('2027-06-01T22:00:00Z'), alles: 0.3, zonderBelasting: 0.19, isDag: false }))).toBeCloseTo(0.19, 9);
    expect(waardeTeruglevering(zonneplanTijdvak({ ...kwartier('2027-06-01T10:00:00Z'), alles: 0.03, zonderBelasting: -0.1, isDag: true }))).toBeCloseTo(-0.1, 9);
  });

  it('het plafond: na 7.500 kWh teruglevering dit jaar geen Zonnebonus meer', () => {
    const vak = zonneplanTijdvak({ ...kwartier('2026-10-30T11:00:00Z'), alles: 0.3, zonderBelasting: 0.19, isDag: true });
    expect(naPlafond(vak, 7499)).toBe(vak);
    expect(naPlafond(vak, 7500)).toMatchObject({ zonnebonus_kwh: 0, afname_kwh: 0.3 });
    expect(naPlafond(vak, 7500).teruglevering_kwh).toBeCloseTo(0.3, 9);
    expect(naPlafond(null, 9000)).toBeNull();
  });

  it('de jaarstand voor de app: teruggeleverd dit jaar, afgerond, met het plafond', () => {
    expect(jaarVoorApp({ jaar: 2026, begin_kwh: 12_753, teruglevering_kwh: 7247.04 })).toEqual({ jaar: 2026, teruglevering_kwh: 7247, plafond_kwh: 7500 });
  });

  it('dag of nacht: het midden van het tijdvak telt', () => {
    const zon = () => ({ op: Date.parse('2026-10-12T06:00:00Z'), onder: Date.parse('2026-10-12T16:50:00Z') });
    const vak = (iso) => [Date.parse(iso), Date.parse(iso) + 15 * 60_000];
    expect(isDag(...vak('2026-10-12T05:45:00Z'), zon)).toBe(false);
    expect(isDag(...vak('2026-10-12T05:55:00Z'), zon)).toBe(true);
    expect(isDag(...vak('2026-10-12T16:35:00Z'), zon)).toBe(true);
    expect(isDag(...vak('2026-10-12T16:45:00Z'), zon)).toBe(false);
    // Zonder eigen tijden: De Bilt. Om 09:00 is het dag, om 22:00 nacht.
    expect(isDag(...vak('2026-10-12T07:00:00Z'))).toBe(true);
    expect(isDag(...vak('2026-10-12T20:00:00Z'))).toBe(false);
  });
});

describe('metReserve', () => {
  const vakken = [{ van: 0, tot: 1, afname_kwh: 0.3, teruglevering_kwh: 0.3, zonnebonus_kwh: 0 }];

  it('normaal de hoofdbron; bij een fout de reserve, met "schatting" erbij en één melding', async () => {
    let fout = false;
    const meldingen = [];
    const bron = metReserve(
      {
        naam: 'Zonneplan',
        haal: async () => {
          if (fout) throw new Error('nog niet ingelogd');
          return vakken;
        },
      },
      { naam: 'EnergyZero', haal: async () => vakken },
      { log: (t) => meldingen.push(t) },
    );
    expect((await bron.haal())[0].bron).toBe('Zonneplan');
    fout = true;
    expect((await bron.haal())[0]).toMatchObject({ bron: 'EnergyZero (schatting)', schatting: true });
    await bron.haal();
    fout = false;
    await bron.haal();
    expect(meldingen).toEqual(['Zonneplan: nog niet ingelogd. Tot dan een schatting via EnergyZero.', 'Zonneplan: prijzen weer binnen.']);
  });

  it('lukt de reserve ook niet, dan een fout die allebei noemt', async () => {
    const bron = metReserve(
      { naam: 'Zonneplan', haal: async () => Promise.reject(new Error('storing')) },
      { naam: 'EnergyZero', haal: async () => Promise.reject(new Error('EnergyZero antwoordde 503')) },
    );
    await expect(bron.haal()).rejects.toThrow('ook EnergyZero lukt niet (EnergyZero antwoordde 503)');
  });
});

const KWARTIER = 15 * 60_000;
const begin = Date.UTC(2026, 9, 30, 12, 0);
const vak = (i, afname) => ({ van: begin + i * KWARTIER, tot: begin + (i + 1) * KWARTIER, afname_kwh: afname, teruglevering_kwh: afname / 3 });

describe('prijsOp en prijsVoorApp', () => {
  it('het tijdvak waarin het moment valt; de grens hoort bij het volgende', () => {
    const vakken = [vak(0, 0.2), vak(1, 0.3)];
    expect(prijsOp(vakken, begin + 5 * 60_000).afname_kwh).toBe(0.2);
    expect(prijsOp(vakken, begin + KWARTIER).afname_kwh).toBe(0.3);
    expect(prijsOp(vakken, begin + 2 * KWARTIER)).toBeNull();
  });

  it('voor de app: afgerond, met tijden', () => {
    expect(prijsVoorApp({ ...vak(0, 0.2843219), zonnebonus_kwh: 0.0111 }, 'Zonneplan')).toEqual({
      afname_kwh: 0.28432,
      teruglevering_kwh: 0.09477,
      zonnebonus_kwh: 0.0111,
      van: '2026-10-30T12:00:00.000Z',
      tot: '2026-10-30T12:15:00.000Z',
      bron: 'Zonneplan',
    });
    expect(prijsVoorApp(null, 'x')).toBeNull();
    expect(prijsVoorApp({ ...vak(0, 0.2), bron: 'EnergyZero (schatting)' }, 'Zonneplan').bron).toBe('EnergyZero (schatting)');
  });
});

describe('prijsVolger: één keer per dag, vanaf 13:00 elk kwartier tot morgen er is', () => {
  // 30 oktober 2026 is wintertijd: Nederlandse tijd = UTC + 1.
  const dag = (startIso, prijs, extra = {}) =>
    Array.from({ length: 96 }, (_, i) => ({
      van: Date.parse(startIso) + i * KWARTIER,
      tot: Date.parse(startIso) + (i + 1) * KWARTIER,
      afname_kwh: prijs,
      teruglevering_kwh: prijs,
      ...extra,
    }));
  const VANDAAG = dag('2026-10-29T23:00:00Z', 0.25);
  const MORGEN = dag('2026-10-30T23:00:00Z', 0.3);
  const om = (iso) => Date.parse(iso);
  const even = () => new Promise((klaar) => setTimeout(klaar, 0));

  function volgerMet(antwoorden, start) {
    const stand = { nu: start, keer: 0, meldingen: [] };
    const volger = prijsVolger(
      {
        naam: 'test',
        haal: async () => {
          const antwoord = antwoorden[Math.min(stand.keer, antwoorden.length - 1)];
          stand.keer += 1;
          if (antwoord instanceof Error) throw antwoord;
          return antwoord;
        },
      },
      { klok: () => stand.nu, log: (t) => stand.meldingen.push(t) },
    );
    return { volger, stand };
  }

  it('bij het starten, en daarna pas vanaf 13:00 voor morgen; na middernacht de prijzen van morgen', async () => {
    const { volger, stand } = volgerMet([VANDAAG, [...VANDAAG, ...MORGEN]], om('2026-10-30T09:00:00Z'));
    expect((await volger.nu()).afname_kwh).toBe(0.25);
    stand.nu = om('2026-10-30T11:55:00Z'); // 12:55
    await volger.nu();
    expect(stand.keer).toBe(1);
    stand.nu = om('2026-10-30T12:01:00Z'); // 13:01
    await volger.nu();
    await even();
    expect(stand.keer).toBe(2);
    stand.nu = om('2026-10-30T15:40:00Z');
    await volger.nu();
    stand.nu = om('2026-10-30T23:30:00Z'); // 00:30 de volgende dag
    expect((await volger.nu()).afname_kwh).toBe(0.3);
    expect(stand.keer).toBe(2);
  });

  it('staat morgen er om 13:00 nog niet, dan elk kwartier opnieuw tot hij er is', async () => {
    const { volger, stand } = volgerMet([VANDAAG, VANDAAG, [...VANDAAG, ...MORGEN]], om('2026-10-30T12:05:00Z'));
    await volger.nu();
    const keerOm = async (minuten) => {
      stand.nu = om('2026-10-30T12:05:00Z') + minuten * 60_000;
      await volger.nu();
      await even();
      return stand.keer;
    };
    expect(await keerOm(6)).toBe(2);
    expect(await keerOm(15)).toBe(2);
    expect(await keerOm(22)).toBe(3);
    expect(await keerOm(60)).toBe(3);
    expect(heeftMorgen([...VANDAAG, ...MORGEN], stand.nu)).toBe(true);
    expect(heeftMorgen([...VANDAAG, ...MORGEN.slice(0, 48)], stand.nu)).toBe(false);
  });

  it('bij een storing: na vijf minuten opnieuw als er geen prijs voor nu is, en één melding', async () => {
    const { volger, stand } = volgerMet([new Error('storing'), VANDAAG], om('2026-10-30T09:00:00Z'));
    expect(await volger.nu()).toBeNull();
    stand.nu += 2 * 60_000;
    expect(await volger.nu()).toBeNull();
    expect(stand.keer).toBe(1);
    stand.nu += 4 * 60_000;
    await volger.nu();
    await even();
    expect((await volger.nu()).afname_kwh).toBe(0.25);
    expect(stand.meldingen).toEqual(['test: storing', 'test: prijzen weer binnen.']);
  });

  it('een schatting (Zonneplan antwoordde niet): elk kwartier Zonneplan opnieuw', async () => {
    const SCHATTING = dag('2026-10-29T23:00:00Z', 0.24, { schatting: true });
    const { volger, stand } = volgerMet([SCHATTING, SCHATTING, VANDAAG], om('2026-10-30T09:00:00Z'));
    await volger.nu();
    const keerOm = async (minuten) => {
      stand.nu = om('2026-10-30T09:00:00Z') + minuten * 60_000;
      await volger.nu();
      await even();
      return stand.keer;
    };
    expect(await keerOm(10)).toBe(2);
    expect(await keerOm(20)).toBe(2);
    expect(await keerOm(26)).toBe(3);
    expect(await keerOm(80)).toBe(3);
    expect((await volger.nu()).afname_kwh).toBe(0.25);
  });
});

describe('voorspelling voor de app', () => {
  const KWARTIER = 15 * 60_000;
  const nacht = Date.UTC(2026, 9, 29, 23); // 30 oktober, 00:00 in Nederland
  const vak = (i, afname, bonus = 0) => ({
    van: nacht + i * KWARTIER,
    tot: nacht + (i + 1) * KWARTIER,
    afname_kwh: afname,
    teruglevering_kwh: afname + bonus,
    zonnebonus_kwh: bonus,
    bron: 'Zonneplan',
  });

  it('vanaf middernacht per kwartier, op 4 decimalen, tot het eerste gat', () => {
    const tijdvakken = [vak(-1, 0.3), vak(0, 0.25123456), vak(1, 0.24, 0.02), vak(2, -0.01), vak(4, 0.3)];
    const v = voorspellingVoorApp(tijdvakken, { vanaf: nacht, teruggeleverdDitJaarKwh: 0, bron: 'Zonneplan' });
    expect(v).toEqual({
      van: '2026-10-29T23:00:00.000Z',
      stap_min: 15,
      afname_kwh: [0.2512, 0.24, -0.01],
      teruglevering_kwh: [0.2512, 0.26, -0.01],
      zonnebonus_kwh: [0, 0.02, 0],
      schatting: false,
      bron: 'Zonneplan',
    });
  });

  it('na 7.500 kWh geen Zonnebonus; een schatting zegt dat', () => {
    const tijdvakken = [vak(0, 0.24, 0.02)].map((t) => ({ ...t, schatting: true, bron: 'EnergyZero (schatting)' }));
    const v = voorspellingVoorApp(tijdvakken, { vanaf: nacht, teruggeleverdDitJaarKwh: 7600, bron: 'Zonneplan' });
    expect(v.zonnebonus_kwh).toEqual([0]);
    expect(v.teruglevering_kwh).toEqual([0.24]);
    expect(v.schatting).toBe(true);
    expect(v.bron).toBe('EnergyZero (schatting)');
  });

  it('vandaag en morgen passen ruim in een meting; zonder prijzen niets', () => {
    const twee = Array.from({ length: 192 }, (_, i) => vak(i, 0.2 + (i % 7) * 0.0123, i % 3 ? 0.0234 : 0));
    const v = voorspellingVoorApp(twee, { vanaf: nacht, teruggeleverdDitJaarKwh: 0, bron: 'Zonneplan' });
    expect(v.afname_kwh).toHaveLength(192);
    expect(JSON.stringify(v).length).toBeLessThan(6000);
    expect(voorspellingVoorApp([], { vanaf: nacht, teruggeleverdDitJaarKwh: 0, bron: 'Zonneplan' })).toBeNull();
  });

  it('op 31 december: 1 januari weer met Zonnebonus, ook als het plafond van dit jaar vol is', () => {
    const oud = Date.UTC(2026, 11, 30, 23); // 31 december, 00:00 in Nederland
    const nieuwjaar = Date.UTC(2026, 11, 31, 23); // 1 januari 2027, 00:00
    const kwartieren = 96 + 4;
    const tijdvakken = Array.from({ length: kwartieren }, (_, i) => ({
      van: oud + i * KWARTIER,
      tot: oud + (i + 1) * KWARTIER,
      afname_kwh: 0.3,
      teruglevering_kwh: 0.32,
      zonnebonus_kwh: 0.02,
    }));
    const v = voorspellingVoorApp(tijdvakken, { vanaf: oud, teruggeleverdDitJaarKwh: 7600, bron: 'Zonneplan' });
    expect(v.zonnebonus_kwh.slice(0, 96).every((b) => b === 0)).toBe(true);
    expect(v.zonnebonus_kwh.slice(96)).toEqual([0.02, 0.02, 0.02, 0.02]);
    expect(oud + 96 * KWARTIER).toBe(nieuwjaar);
  });

  it('de volger geeft alle prijzen die hij heeft', async () => {
    const volger = prijsVolger({ naam: 'Zonneplan', haal: async () => [vak(0, 0.2)] }, { klok: () => nacht + 60_000 });
    await volger.nu();
    expect(volger.alle()).toHaveLength(1);
  });
});

describe('prijzen samenvoegen', () => {
  const KWARTIER = 15 * 60_000;
  const nacht = Date.UTC(2026, 9, 29, 23); // 30 oktober, 00:00 in Nederland
  const vak = (i, afname, extra = {}) => ({ van: nacht + i * KWARTIER, tot: nacht + (i + 1) * KWARTIER, afname_kwh: afname, ...extra });
  const reeks = (van, tot, afname, extra) => Array.from({ length: tot - van }, (_, i) => vak(van + i, afname, extra));

  it('begint het nieuwe antwoord bij het huidige uur, dan blijft de ochtend staan; nieuw gaat voor', () => {
    const uit = voegPrijzenSamen(reeks(0, 96, 0.2), reeks(56, 192, 0.3), nacht - 86_400_000);
    expect(uit).toHaveLength(192);
    expect(uit[0].afname_kwh).toBe(0.2);
    expect(uit[56].afname_kwh).toBe(0.3);
    expect(uit.every((t, i) => i === 0 || t.van === uit[i - 1].tot)).toBe(true);
  });

  it('een schatting verdringt geen echte prijs; echte prijzen ruimen oude schattingen op', () => {
    const schatting = { schatting: true };
    const metSchatting = voegPrijzenSamen(reeks(0, 96, 0.2), reeks(0, 192, 0.25, schatting), nacht - 86_400_000);
    expect(metSchatting).toHaveLength(192);
    expect(metSchatting[10].afname_kwh).toBe(0.2);
    expect(metSchatting[100].schatting).toBe(true);
    const weerEcht = voegPrijzenSamen(metSchatting, reeks(0, 96, 0.21), nacht - 86_400_000);
    expect(weerEcht).toHaveLength(96);
    expect(weerEcht.some((t) => t.schatting)).toBe(false);
  });

  it('wat voor middernacht van gisteren eindigt, gaat weg', () => {
    const uit = voegPrijzenSamen(reeks(-200, 0, 0.2), reeks(0, 4, 0.3), nacht - 86_400_000);
    expect(uit[0].van).toBe(nacht - 96 * KWARTIER);
    expect(uit).toHaveLength(96 + 4);
  });

  it('in de volger: een tweede antwoord vanaf 14:00 laat de ochtend staan', async () => {
    const antwoorden = [reeks(0, 96, 0.2), reeks(56, 192, 0.3)];
    let keer = 0;
    let nu = nacht + 9 * 3_600_000;
    const volger = prijsVolger({ naam: 'test', haal: async () => antwoorden[Math.min(keer++, 1)] }, { klok: () => nu });
    await volger.nu();
    nu = nacht + 14 * 3_600_000;
    await volger.nu();
    await new Promise((klaar) => setTimeout(klaar, 0));
    expect(keer).toBe(2);
    expect(volger.alle()).toHaveLength(192);
    expect(volger.alle()[0].afname_kwh).toBe(0.2);
  });
});

describe('heeftMorgen rekent op de datum', () => {
  it('op de zaterdagavond voor de zomertijd is morgen zondag, niet maandag', () => {
    const zaterdag = Date.parse('2027-03-27T22:30:00Z'); // 23:30 in Nederland
    const zondag = Date.parse('2027-03-28T21:00:00Z'); // 23:00 zomertijd op zondag
    expect(heeftMorgen([{ van: zondag, tot: zondag + 15 * 60_000 }], zaterdag)).toBe(true);
  });
});

describe('probleem: wat er mis is met de prijzen, voor de app', () => {
  it('metReserve zegt wat er mis is en sinds wanneer, tot de hoofdbron weer antwoordt', async () => {
    let mis = true;
    const hoofd = {
      naam: 'Zonneplan',
      haal: async () => {
        if (mis) throw new Error('opnieuw inloggen nodig: node brug.mjs zonneplan-login');
        return [];
      },
    };
    const bron = metReserve(hoofd, { naam: 'EnergyZero', haal: async () => [] }, { klok: () => 1000 });
    expect(bron.probleem()).toBeNull();
    await bron.haal();
    expect(bron.probleem()).toEqual({ tekst: 'Zonneplan: opnieuw inloggen nodig: node brug.mjs zonneplan-login. Tot dan een schatting via EnergyZero.', sinds: 1000 });
    mis = false;
    await bron.haal();
    expect(bron.probleem()).toBeNull();
    const volger = prijsVolger(bron, { klok: () => 1000 });
    expect(volger.probleem()).toBeNull();
  });
});

describe('de prijzen houden de meetronde niet op (0.13.0)', () => {
  const dagPrijzen = (prijs) =>
    Array.from({ length: 96 }, (_, i) => ({ van: Date.parse('2026-10-29T23:00:00Z') + i * 900_000, tot: Date.parse('2026-10-29T23:00:00Z') + (i + 1) * 900_000, afname_kwh: prijs, teruglevering_kwh: prijs }));
  it('hangt de bron, dan wacht alleen de eerste ronde even, en daarna nooit meer', async () => {
    let keer = 0;
    let klaar = null;
    let nu = Date.parse('2026-10-30T09:00:00Z');
    const volger = prijsVolger(
      {
        naam: 'hangt',
        haal: () => {
          keer += 1;
          return new Promise((r) => {
            klaar = r;
          });
        },
      },
      { klok: () => nu, eersteWachtMs: 30 },
    );
    const begin = performance.now();
    expect(await volger.nu()).toBeNull();
    expect(performance.now() - begin).toBeGreaterThanOrEqual(25);
    expect(keer).toBe(1);
    // Vijf minuten later hangt hij nog: niet wachten, niet nog eens vragen terwijl hij bezig is.
    nu += 6 * 60_000;
    const tweede = performance.now();
    expect(await volger.nu()).toBeNull();
    expect(performance.now() - tweede).toBeLessThan(20);
    expect(keer).toBe(1);
    // Komt het antwoord alsnog, dan is de prijs er de volgende ronde.
    klaar(dagPrijzen(0.25));
    await new Promise((r) => setTimeout(r, 0));
    expect((await volger.nu()).afname_kwh).toBe(0.25);
  });

  it('antwoordt de bron snel, dan heeft ook de eerste ronde de prijs al', async () => {
    const volger = prijsVolger({ naam: 'snel', haal: async () => dagPrijzen(0.25) }, { klok: () => Date.parse('2026-10-30T09:00:00Z') });
    expect((await volger.nu()).afname_kwh).toBe(0.25);
  });
});
