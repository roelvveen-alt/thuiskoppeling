import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bewaarStand, dagVoorApp, datumInNederland, laadStand, telBij, vastPerDag, volgJaar } from './kosten.mjs';

// 30 oktober 2026, 10:00 Nederlandse tijd (wintertijd sinds 25 oktober: UTC+1).
const tien = Date.UTC(2026, 9, 30, 9, 0, 0);
const prijs = { afname_kwh: 0.3, teruglevering_kwh: 0.1 };
const tel = (afname, terug) => ({ afname_kwh: afname, teruglevering_kwh: terug });

describe('datumInNederland', () => {
  it('middernacht in Nederland, niet in UTC', () => {
    expect(datumInNederland(Date.UTC(2026, 9, 30, 22, 59))).toBe('2026-10-30');
    expect(datumInNederland(Date.UTC(2026, 9, 30, 23, 1))).toBe('2026-10-31');
    // Zomertijd: UTC+2.
    expect(datumInNederland(Date.UTC(2026, 6, 1, 21, 59))).toBe('2026-07-01');
    expect(datumInNederland(Date.UTC(2026, 6, 1, 22, 1))).toBe('2026-07-02');
  });
});

describe('telBij', () => {
  it('telt wat er bij komt, met de prijs van dat moment', () => {
    let stand = telBij(null, tel(1000, 50), prijs, tien);
    expect(stand.dag).toMatchObject({ afname_kwh: 0, kosten_eur: 0 });
    stand = telBij(stand, tel(1000.5, 50), prijs, tien + 10_000);
    stand = telBij(stand, tel(1000.5, 51), { afname_kwh: 0.25, teruglevering_kwh: 0.05 }, tien + 20_000);
    expect(stand.dag.afname_kwh).toBeCloseTo(0.5, 9);
    expect(stand.dag.teruglevering_kwh).toBeCloseTo(1, 9);
    expect(stand.dag.kosten_eur).toBeCloseTo(0.15, 9);
    expect(stand.dag.opbrengst_eur).toBeCloseTo(0.05, 9);
  });

  it('na middernacht begint een nieuwe dag', () => {
    let stand = telBij(null, tel(1000, 0), prijs, Date.UTC(2026, 9, 30, 22, 59, 50));
    stand = telBij(stand, tel(1001, 0), prijs, Date.UTC(2026, 9, 30, 22, 59, 55));
    expect(stand.dag).toMatchObject({ datum: '2026-10-30', afname_kwh: 1 });
    stand = telBij(stand, tel(1002, 0), prijs, Date.UTC(2026, 9, 30, 23, 0, 5));
    expect(stand.dag).toMatchObject({ datum: '2026-10-31', afname_kwh: 1 });
  });

  it('zonder prijs: kWh wel, euro niet, en de dag heet onvolledig', () => {
    let stand = telBij(null, tel(1000, 0), null, tien);
    stand = telBij(stand, tel(1000.2, 0), null, tien + 10_000);
    expect(stand.dag.kosten_eur).toBe(0);
    expect(dagVoorApp(stand.dag).compleet).toBe(false);
  });

  it('een vervangen of teruggezette meter telt niet mee; na drie lezingen op rij telt de nieuwe', () => {
    let stand = telBij(null, tel(1000, 0), prijs, tien);
    stand = telBij(stand, tel(3, 0), prijs, tien + 10_000);
    stand = telBij(stand, tel(3.1, 0), prijs, tien + 20_000);
    stand = telBij(stand, tel(3.2, 0), prijs, tien + 30_000);
    expect(stand.dag.afname_kwh).toBe(0);
    stand = telBij(stand, tel(3.3, 0), prijs, tien + 40_000);
    expect(stand.dag.afname_kwh).toBeCloseTo(0.1, 9);
  });

  it('één hapering van de meter (0): de stap erna telt gewoon', () => {
    let stand = telBij(null, tel(1000, 50), prijs, tien);
    stand = telBij(stand, tel(0, 0), prijs, tien + 3_000);
    expect(stand.vorige).toMatchObject({ afname_kwh: 1000, teruglevering_kwh: 50 });
    stand = telBij(stand, tel(1000.01, 50.02), prijs, tien + 6_000);
    expect(stand.dag.afname_kwh).toBeCloseTo(0.01, 9);
    expect(stand.dag.teruglevering_kwh).toBeCloseTo(0.02, 9);
    expect(stand.vreemd).toBeUndefined();
  });

  it('zonder tellers verandert er niets', () => {
    const stand = telBij(null, tel(1000, 0), prijs, tien);
    expect(telBij(stand, null, prijs, tien + 10_000)).toEqual(stand);
  });
});

describe('reserve: de Zendure P1 telt als de HomeWizard niet antwoordt', () => {
  const kwh = (w, ms) => (w * ms) / 3_600_000_000;

  it('telt met vermogen × tijd, en daarna van de HomeWizard alleen wat de reserve nog niet telde', () => {
    let stand = telBij(null, tel(1000, 50), prijs, tien);
    // Eerste meting zonder HomeWizard: nog niets te tellen, wel het begin van de reserve.
    stand = telBij(stand, null, prijs, tien + 5_000, { reserveW: -2000 });
    expect(stand.dag.teruglevering_kwh).toBe(0);
    stand = telBij(stand, null, prijs, tien + 35_000, { reserveW: -2000 });
    stand = telBij(stand, null, prijs, tien + 65_000, { reserveW: 600 });
    expect(stand.dag.teruglevering_kwh).toBeCloseTo(kwh(2000, 30_000), 9);
    expect(stand.dag.afname_kwh).toBeCloseTo(kwh(600, 30_000), 9);
    expect(stand.dag.opbrengst_eur).toBeCloseTo(kwh(2000, 30_000) * 0.1, 9);
    expect(stand.dag.kosten_eur).toBeCloseTo(kwh(600, 30_000) * 0.3, 9);
    expect(stand.vorige).toMatchObject(tel(1000, 50));

    // De HomeWizard is terug: zijn tellers zeggen wat er echt over het hele gat ging.
    stand = telBij(stand, tel(1000.006, 50.025), prijs, tien + 70_000);
    expect(stand.dag.teruglevering_kwh).toBeCloseTo(0.025, 9);
    expect(stand.dag.afname_kwh).toBeCloseTo(0.006, 9);
    expect(stand.reserve).toBeNull();
    expect(stand.vorige).toMatchObject(tel(1000.006, 50.025));
    // En daarna gewoon verder met de tellers.
    stand = telBij(stand, tel(1000.006, 50.035), prijs, tien + 75_000);
    expect(stand.dag.teruglevering_kwh).toBeCloseTo(0.035, 9);
  });

  it('een korte hapering (één gemiste meting) telt gewoon helemaal mee', () => {
    let stand = telBij(null, tel(1000, 50), prijs, tien);
    stand = telBij(stand, null, prijs, tien + 5_000, { reserveW: -2000 });
    stand = telBij(stand, tel(1000, 50.01), prijs, tien + 10_000);
    expect(stand.dag.teruglevering_kwh).toBeCloseTo(0.01, 9);
  });

  it('valt ook de Zendure P1 een tijd weg, dan telt dat stuk niet (geen gok over een lang gat)', () => {
    let stand = telBij(null, tel(1000, 50), prijs, tien);
    stand = telBij(stand, null, prijs, tien + 5_000, { reserveW: -2000 });
    stand = telBij(stand, null, prijs, tien + 10_000, { reserveW: null });
    stand = telBij(stand, null, prijs, tien + 5 * 60_000, { reserveW: -2000 });
    expect(stand.dag.teruglevering_kwh).toBe(0);
    stand = telBij(stand, null, prijs, tien + 5 * 60_000 + 10_000, { reserveW: -1800 });
    expect(stand.dag.teruglevering_kwh).toBeCloseTo(kwh(1800, 10_000), 9);
  });

  it('zonder Zendure P1 verandert er niets, zoals vroeger', () => {
    const stand = telBij(null, tel(1000, 0), prijs, tien);
    expect(telBij(stand, null, prijs, tien + 10_000, { reserveW: null })).toEqual(stand);
  });

  it('het plafond telt tijdens het gat tijdelijk mee; daarna beslist de teller', () => {
    const al = { jaar: 2026, kwh: 7247 };
    let stand = { ...telBij(null, tel(1000, 20_000), prijs, tien), jaar: volgJaar(null, tel(1000, 20_000), tien, al) };
    for (const t of [5_000, 65_000]) {
      stand = { ...stand, jaar: volgJaar(stand.jaar, null, tien + t, al) };
      stand = telBij(stand, null, prijs, tien + t, { reserveW: -3600 });
    }
    expect(stand.jaar.teruglevering_kwh).toBeCloseTo(7247.06, 9);
    stand = { ...stand, jaar: volgJaar(stand.jaar, tel(1000, 20_000.07), tien + 70_000, al) };
    expect(stand.jaar.teruglevering_kwh).toBeCloseTo(7247.07, 9);
  });

  it('wat de reserve in een lopend gat al telde, overleeft een herstart en middernacht', () => {
    const pad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kosten-')), 'vandaag.json');
    let stand = telBij(null, tel(1000, 50), prijs, Date.UTC(2026, 9, 30, 22, 59, 0));
    stand = telBij(stand, null, prijs, Date.UTC(2026, 9, 30, 22, 59, 20), { reserveW: -3600 });
    stand = telBij(stand, null, prijs, Date.UTC(2026, 9, 30, 22, 59, 50), { reserveW: -3600 });
    bewaarStand(pad, stand);
    const morgen = laadStand(pad, Date.UTC(2026, 9, 30, 23, 0, 10));
    expect(morgen.reserve).toEqual(stand.reserve);
    // Terug na middernacht: de 0,03 kWh van gisteren telt niet nog eens.
    const verder = telBij(morgen, tel(1000, 50.05), prijs, Date.UTC(2026, 9, 30, 23, 0, 15));
    expect(verder.dag).toMatchObject({ datum: '2026-10-31' });
    expect(verder.dag.teruglevering_kwh).toBeCloseTo(0.02, 9);
  });
});

describe('teruglevering dit jaar (voor het plafond van de Zonnebonus)', () => {
  const al = { jaar: 2026, kwh: 7247 };

  it('de eerste keer: wat er al was (Zonneplan-app); daarna wat de meter erbij telt, ook na een gat', () => {
    let jaar = volgJaar(null, tel(1000, 20_000), tien, al);
    expect(jaar).toMatchObject({ jaar: 2026, begin_kwh: 20_000 - 7247, teruglevering_kwh: 7247 });
    jaar = volgJaar(jaar, tel(1000, 20_100), tien + 3 * 86_400_000, al); // drie dagen uit geweest
    expect(jaar.teruglevering_kwh).toBe(7347);
    expect(volgJaar(jaar, null, tien + 4 * 86_400_000, al)).toBe(jaar);
  });

  it('op 1 januari weer vanaf nul; "al" geldt alleen voor zijn eigen jaar', () => {
    const oud = volgJaar(null, tel(1000, 20_000), tien, al);
    const nieuwjaar = Date.UTC(2026, 11, 31, 23, 0, 5); // 1 januari 2027, 00:00:05
    expect(volgJaar(oud, tel(1000, 20_300), nieuwjaar, al)).toMatchObject({ jaar: 2027, begin_kwh: 20_300, teruglevering_kwh: 0 });
  });

  it('een nieuwe meter (de teller begint opnieuw): na een paar lezingen op rij verder vanaf wat er al was', () => {
    let jaar = volgJaar(null, tel(1000, 20_000), tien, al);
    jaar = volgJaar(jaar, tel(0, 3), tien + 60_000, al);
    expect(jaar.teruglevering_kwh).toBe(7247);
    jaar = volgJaar(jaar, tel(0, 4), tien + 90_000, al);
    expect(jaar.teruglevering_kwh).toBe(7247); // nog niet zeker: twee lezingen, een halve minuut
    jaar = volgJaar(jaar, tel(0, 5), tien + 120_000, al);
    expect(jaar.teruglevering_kwh).toBe(7249); // drie op rij over een minuut: wat hij sinds de wissel telde, telt mee
    jaar = volgJaar(jaar, tel(0, 6), tien + 130_000, al);
    expect(jaar.teruglevering_kwh).toBe(7250);
  });

  it('één keer 0 of een te lage stand van de meter: overslaan, daarna gewoon verder', () => {
    let jaar = volgJaar(null, tel(1000, 20_000), tien, al);
    jaar = volgJaar(jaar, tel(0, 0), tien + 3_000, al);
    expect(jaar.teruglevering_kwh).toBe(7247);
    jaar = volgJaar(jaar, tel(1000, 20_000.5), tien + 6_000, al);
    expect(jaar.teruglevering_kwh).toBeCloseTo(7247.5, 9);
    jaar = volgJaar(jaar, tel(1000, 19_000), tien + 9_000, al);
    jaar = volgJaar(jaar, tel(1000, 20_000.6), tien + 12_000, al);
    expect(jaar.teruglevering_kwh).toBeCloseTo(7247.6, 9);
    expect(jaar.lager).toBeNull();
  });

  it('een onmogelijk hoge stand slaan we over, maar een gat van een week kan', () => {
    let jaar = volgJaar(null, tel(1000, 20_000), tien, al);
    jaar = volgJaar(jaar, tel(1000, 99_999), tien + 3_000, al);
    expect(jaar.teruglevering_kwh).toBe(7247);
    const week = tien + 7 * 86_400_000;
    jaar = volgJaar(jaar, tel(1000, 20_300), week, al);
    expect(jaar.teruglevering_kwh).toBe(7547);
  });

  it('een stand van voor deze versie (zonder teller_kwh) telt gewoon door', () => {
    const oud = { jaar: 2026, begin_kwh: 12_753, teruglevering_kwh: 7247 };
    expect(volgJaar(oud, tel(1000, 20_010), tien, al).teruglevering_kwh).toBe(7257);
    expect(volgJaar(oud, tel(0, 0), tien, al).teruglevering_kwh).toBe(7247);
  });

  it('zonder tellers en zonder eerdere stand: wat er al was, nog zonder begin', () => {
    expect(volgJaar(null, null, tien, al)).toEqual({ jaar: 2026, begin_kwh: null, teruglevering_kwh: 7247 });
    expect(volgJaar(null, null, tien)).toEqual({ jaar: 2026, begin_kwh: null, teruglevering_kwh: 0 });
  });
});

describe('bewaren', () => {
  it('heen en terug; een andere dag begint opnieuw maar onthoudt de tellers', () => {
    const pad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kosten-')), 'vandaag.json');
    const begin = { ...telBij(null, tel(1000, 0), prijs, tien), jaar: volgJaar(null, tel(1000, 0), tien) };
    const stand = telBij(begin, tel(1001, 0), prijs, tien + 10_000);
    bewaarStand(pad, stand);
    expect(laadStand(pad, tien + 60_000)).toEqual({ ...stand, logboek: null, bewaard_op: null });
    expect(laadStand(pad, tien + 86_400_000)).toEqual({ dag: null, vorige: stand.vorige, jaar: stand.jaar, logboek: null, reserve: null, bewaard_op: null });
    expect(laadStand(`${pad}.weg`, tien)).toEqual({ dag: null, vorige: null, jaar: null, logboek: null, reserve: null, bewaard_op: null });
    // Wanneer het bewaard is, komt ook na een nieuwe dag mee (voor de klokcontrole bij het starten).
    bewaarStand(pad, { ...stand, bewaard_op: tien + 20_000 });
    expect(laadStand(pad, tien + 86_400_000).bewaard_op).toBe(tien + 20_000);
    bewaarStand(pad, stand);
    // Het logboek per kwartier (dag.mjs) gaat altijd mee, ook zonder prijzen (dan is dag null);
    // een nieuwe dag begint logMeting zelf, met de week van de fasen.
    const logboek = { datum: datumInNederland(tien), kwartieren: [] };
    bewaarStand(pad, { dag: null, vorige: null, jaar: null, logboek });
    expect(laadStand(pad, tien + 60_000).logboek).toEqual(logboek);
    expect(laadStand(pad, tien + 86_400_000).logboek).toEqual(logboek);
    // In een nieuw jaar telt het oude jaar niet meer.
    expect(laadStand(pad, Date.UTC(2027, 0, 2, 12)).jaar).toBeNull();
  });
});

describe('bewaren zonder half bestand', () => {
  const map = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kosten-'));

  it('schrijft via .nieuw en houdt de vorige goede als .vorige', () => {
    const pad = path.join(map(), 'vandaag.json');
    const een = { dag: null, vorige: { afname_kwh: 1, teruglevering_kwh: 2 }, jaar: null, logboek: null };
    const twee = { ...een, vorige: { afname_kwh: 3, teruglevering_kwh: 4 } };
    expect(bewaarStand(pad, een)).toBeNull();
    expect(bewaarStand(pad, twee)).toBeNull();
    expect(JSON.parse(fs.readFileSync(pad, 'utf8'))).toEqual(twee);
    expect(JSON.parse(fs.readFileSync(`${pad}.vorige`, 'utf8'))).toEqual(een);
    expect(fs.existsSync(`${pad}.nieuw`)).toBe(false);
  });

  it('een half vandaag.json (stroom eraf): verder met .vorige, met een regel in het logboek', () => {
    const pad = path.join(map(), 'vandaag.json');
    const jaar = { jaar: 2026, begin_kwh: 12_753, teruglevering_kwh: 7456.7, teller_kwh: 20_209.7, moment: tien };
    bewaarStand(pad, { dag: null, vorige: null, jaar, logboek: null });
    bewaarStand(pad, { dag: null, vorige: null, jaar, logboek: null });
    fs.writeFileSync(pad, '{"dag": {"datum": "2026-1');
    const regels = [];
    const stand = laadStand(pad, tien, { log: (t) => regels.push(t) });
    expect(stand.jaar).toEqual(jaar);
    expect(regels).toHaveLength(2);
    expect(regels[0]).toBe('vandaag.json was kapot; ik heb hem opzij gezet als vandaag.json.kapot.');
    expect(regels[1]).toMatch(/^vandaag\.json was kapot of weg; ik ga verder met de stand van \d\d:\d\d\.$/);
    expect(fs.readFileSync(`${pad}.kapot`, 'utf8')).toBe('{"dag": {"datum": "2026-1');
    expect(fs.existsSync(pad)).toBe(false);
    // Allebei weg: gewoon opnieuw beginnen, zonder fout.
    fs.rmSync(`${pad}.vorige`);
    expect(laadStand(pad, tien).jaar).toBeNull();
  });

  it('niet kunnen bewaren geeft de fout terug in plaats van te stoppen', () => {
    const fout = bewaarStand(path.join(map(), 'bestaat-niet', 'vandaag.json'), { dag: null });
    expect(fout?.code).toBe('ENOENT');
  });

  it('een URL als pad werkt ook (zoals in brug.mjs)', () => {
    const pad = pathToFileURL(path.join(map(), 'vandaag.json'));
    expect(bewaarStand(pad, { dag: null, vorige: null, jaar: null, logboek: null })).toBeNull();
    expect(laadStand(pad, tien).vorige).toBeNull();
  });
});

describe('vaste kosten', () => {
  const vast = { levering_per_maand: 6.25, netbeheer_per_maand: 38, vermindering_energiebelasting_per_maand: 52.41 };

  it('per maand, gedeeld door de dagen van die maand; min = geld terug', () => {
    expect(vastPerDag(vast, '2026-10-30')).toBeCloseTo((6.25 + 38 - 52.41) / 31, 9);
    expect(vastPerDag(vast, '2026-11-01')).toBeCloseTo((6.25 + 38 - 52.41) / 30, 9);
    expect(vastPerDag(vast, '2028-02-10')).toBeCloseTo((6.25 + 38 - 52.41) / 29, 9);
    expect(vastPerDag(null, '2026-10-30')).toBeNull();
  });

  it('gaan mee naar de app, of null als ze niet zijn ingevuld', () => {
    const dag = telBij(null, tel(1000, 0), prijs, tien).dag;
    // (6,25 + 38 − 52,41) / 31 dagen in oktober
    expect(dagVoorApp(dag, vastPerDag(vast, dag.datum)).vaste_kosten_eur).toBe(-0.2632);
    expect(dagVoorApp(dag).vaste_kosten_eur).toBeNull();
  });
});

describe('telBij: een lang gat (wifi weg, programmaatje afgeschoten)', () => {
  const UUR = 3_600_000;
  // 18:00 tot 20:00 kost € 0,40, daarna € 0,10.
  const prijsVoor = (ms) => ({ afname_kwh: ms < tien + 10 * UUR ? 0.4 : 0.1, teruglevering_kwh: 0.05 });

  it('verdeelt de sprong over het gat, elk kwartier met zijn eigen prijs; de dag is dan niet compleet', () => {
    let stand = telBij(null, tel(1000, 50), prijs, tien + 8 * UUR); // 18:00
    stand = telBij(stand, tel(1002, 50), prijsVoor(tien + 10 * UUR), tien + 10 * UUR, { prijsVoor }); // 20:00, 2 kWh
    expect(stand.dag.afname_kwh).toBeCloseTo(2, 9);
    expect(stand.dag.kosten_eur).toBeCloseTo(0.8, 9);
    expect(stand.dag.geschat_kwh).toBeCloseTo(2, 9);
    expect(dagVoorApp(stand.dag).compleet).toBe(false);
  });

  it('een sprong van meer dan 5 kWh na vijf uur telt nu wel', () => {
    let stand = telBij(null, tel(1000, 50), prijs, tien);
    stand = telBij(stand, tel(1006, 50), prijs, tien + 5 * UUR);
    expect(stand.dag.afname_kwh).toBeCloseTo(6, 9);
    expect(stand.dag.kosten_eur).toBeCloseTo(1.8, 9);
  });

  it('over middernacht telt alleen het deel na middernacht voor vandaag', () => {
    const elfUur = Date.UTC(2026, 9, 30, 22, 0); // 23:00 in Nederland
    let stand = telBij(null, tel(1000, 50), prijs, elfUur);
    stand = telBij(stand, tel(1002, 50), prijs, elfUur + 2 * UUR); // 01:00
    expect(stand.dag.datum).toBe('2026-10-31');
    expect(stand.dag.afname_kwh).toBeCloseTo(1, 9);
  });

  it('een gewone korte pauze (twee minuten) telt zoals altijd: compleet', () => {
    let stand = telBij(null, tel(1000, 50), prijs, tien);
    stand = telBij(stand, tel(1000.1, 50), prijs, tien + 120_000);
    expect(stand.dag.afname_kwh).toBeCloseTo(0.1, 9);
    expect(dagVoorApp(stand.dag).compleet).toBe(true);
  });

  it('een sprong die ook met het gat niet kan (een andere meter): niet geteld, en de dag is niet compleet', () => {
    let stand = telBij(null, tel(1000, 50), prijs, tien);
    for (let i = 1; i <= 3; i += 1) stand = telBij(stand, tel(9000, 50), prijs, tien + i * 5_000);
    expect(stand.dag.afname_kwh).toBe(0);
    expect(stand.vorige).toMatchObject(tel(9000, 50));
    expect(dagVoorApp(stand.dag).compleet).toBe(false);
  });
});
