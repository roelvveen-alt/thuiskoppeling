import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bewaarHerkennen,
  eigenGemeten,
  faseVanSprong,
  handtekeningenUit,
  herkendSleutel,
  herken,
  HOOGSTENS_DAG_APPARATEN,
  HOOGSTENS_ONBEKEND,
  huisVerbruik,
  kwhPerDag,
  laadHerkennen,
  labelsUit,
  maakHerkenner,
  PROFIELEN,
  scoreHandtekening,
  SOORTEN,
  tijdFactor,
  warmtepompPatroon,
  VORMEN,
  vormVan,
  weekVan,
} from './herkennen.mjs';

/**
 * Gesimuleerde huizen: elke 5 s een meting zoals maakMeting die maakt. Een
 * last is een functie van de tijd (s sinds het begin) naar watt. Met
 * `batterij` springt de Zendure één lezing later bij en blijft het net op 0.
 */
const BEGIN = Date.parse('2026-10-30T09:00:00Z');

function toeval(zaad = 7) {
  let s = zaad;
  return () => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s / 2 ** 31;
  };
}

function simuleer({ duurS, basis = () => 300, lasten = [], gemeten = [], batterij = false, ruis = 8, zaad = 7, begin = BEGIN, fasen = null }) {
  const r = toeval(zaad);
  const uit = [];
  let vorigeHuis = null;
  for (let s = 0; s < duurS; s += 5) {
    const apparaten = gemeten.map((g, i) => ({ sleutel: `hw-apparaat-${i}`, naam: `Apparaat ${i}`, soort: 'stekker', vermogen_w: Math.round(g(s)) }));
    const huis = basis(s) + lasten.reduce((som, l) => som + l(s), 0) + apparaten.reduce((som, a) => som + a.vermogen_w, 0) + (r() * 2 - 1) * ruis;
    const bat = batterij ? (vorigeHuis ?? huis) : 0;
    const net = huis - bat;
    vorigeHuis = huis;
    const meting = { net_w: Math.round(net), zon_w: 0, batterij_w: Math.round(bat), apparaten };
    if (fasen) meting.fasen = fasen(s, net);
    uit.push({ nu: begin + s * 1000, s, meting });
  }
  return uit;
}

/** Een blok: aan van `van` tot `tot` (s) met `w`, plus ruis die in het blok zelf zit. */
const blok = (van, tot, w, { onrust = 0, zaad = 3 } = {}) => {
  const r = toeval(zaad);
  return (s) => (s >= van && s < tot ? w + (onrust ? (r() * 2 - 1) * onrust : 0) : 0);
};
/** Herhaald aan en uit: elke `periode` s, `aan` s aan, vanaf `van` tot `tot`. */
const ritme = (van, tot, periode, aan, w) => (s) => (s >= van && s < tot && (s - van) % periode < aan ? w : 0);

function draai(reeks, herkenner = maakHerkenner(), { op = [] } = {}) {
  const momenten = {};
  for (const { nu, s, meting } of reeks) {
    herkenner.ronde({ nu, meting });
    if (op.includes(s)) momenten[s] = herkenner.voorApp(nu);
  }
  const laatste = reeks.at(-1).nu;
  return { herkenner, app: herkenner.voorApp(laatste), momenten };
}

const soorten = (lijst) => lijst.map((i) => i.soort ?? null);

describe('huisverbruik en eigen meters', () => {
  it('rekent zon + batterij + net op hele watts, zonder net niets', () => {
    expect(huisVerbruik({ net_w: 0, zon_w: 1000.4, batterij_w: -400.6 })).toBe(599);
    expect(huisVerbruik({ net_w: -2000, zon_w: 1500, batterij_w: 0 })).toBe(0);
    expect(huisVerbruik({ zon_w: 1000 })).toBeNull();
    expect(eigenGemeten({ apparaten: [{ vermogen_w: 1400 }, { vermogen_w: null }, { vermogen_w: -3 }] })).toBe(1400);
  });

  it('de fase van een sprong: die het meest meeging, minstens de helft', () => {
    const voor = new Map([
      [1, 300],
      [2, 0],
      [3, 0],
    ]);
    expect(faseVanSprong(voor, new Map([[1, 300], [2, 2100], [3, 0]]), 2100)).toBe(2);
    // De batterij stuurt op L1 al tegen: de fase van het apparaat blijft L2.
    expect(faseVanSprong(voor, new Map([[1, -1700], [2, 2100], [3, 0]]), 2100)).toBe(2);
    expect(faseVanSprong(voor, new Map([[1, 500], [2, 200], [3, 0]]), 2100)).toBeNull();
    expect(faseVanSprong(new Map(), new Map([[1, 1]]), 100)).toBeNull();
  });
});

describe('herkennen in gesimuleerde huizen', () => {
  it('koelkast: na een paar keer in hetzelfde ritme "koelkast", en de basis blijft 200 W', () => {
    // 110 W, 20 minuten aan, 35 uit, vier uur lang, op een basis van 200 W (zoals bij Dirk).
    const reeks = simuleer({ duurS: 4 * 3600, basis: () => 200, lasten: [ritme(600, 4 * 3600, 55 * 60, 20 * 60, 110)] });
    const { app, momenten } = draai(reeks, undefined, { op: [600 + 3 * 55 * 60 + 600] });
    const nu = momenten[600 + 3 * 55 * 60 + 600].nu;
    expect(nu).toHaveLength(1);
    expect(nu[0].soort).toBe('koelkast');
    expect(nu[0].w).toBeGreaterThanOrEqual(100);
    expect(nu[0].w).toBeLessThanOrEqual(120);
    expect(nu[0].zeker).toBeGreaterThanOrEqual(0.35);
    // Eerder: de latere keren koelkast (de eerste twee zijn nog zonder ritme).
    const koelkast = app.recent.filter((r) => r.soort === 'koelkast');
    expect(koelkast.length).toBeGreaterThanOrEqual(2);
    expect(app.basis.w).toBeGreaterThanOrEqual(175);
    expect(app.basis.w).toBeLessThanOrEqual(225);
  });

  it('waterkoker: 2,2 kW, drie minuten, "waarschijnlijk" waterkoker', () => {
    const reeks = simuleer({ duurS: 1200, basis: () => 450, lasten: [blok(300, 480, 2200)] });
    const { app, momenten } = draai(reeks, undefined, { op: [330] });
    // Terwijl hij loopt: al wel een vermoeden, nog niet zeker (het kan ook iets langs zijn).
    expect(momenten[330].nu[0].w).toBe(2200);
    expect(momenten[330].nu[0].zeker).toBeLessThan(0.6);
    expect(app.nu).toHaveLength(0);
    expect(app.recent).toHaveLength(1);
    expect(app.recent[0]).toMatchObject({ soort: 'waterkoker', w: 2200 });
    expect(app.recent[0].zeker).toBeGreaterThanOrEqual(0.6);
    expect(Date.parse(app.recent[0].tot) - Date.parse(app.recent[0].van)).toBe(180_000);
  });

  it('batterij springt bij: het net blijft op 0, het huis stijgt, en de waterkoker wordt toch gezien', () => {
    const reeks = simuleer({ duurS: 1200, basis: () => 450, lasten: [blok(300, 480, 2200)], batterij: true });
    // Alleen de eerste lezing van de sprong is op de P1 te zien.
    expect(reeks.filter((x) => Math.abs(x.meting.net_w) > 1000)).toHaveLength(2);
    const { app } = draai(reeks);
    expect(app.recent).toHaveLength(1);
    expect(app.recent[0]).toMatchObject({ soort: 'waterkoker', w: 2200 });
  });

  it('wasmachine: verwarmen, dan de trommel en de centrifuge; het verwarmen heet daarna "wasmachine, verwarmt"', () => {
    const verwarmen = blok(300, 300 + 14 * 60, 2050);
    const trommelVan = 300 + 14 * 60 + 30;
    const trommel = (s) => (s >= trommelVan && s < trommelVan + 25 * 60 && (s - trommelVan) % 25 < 15 ? 200 : 0);
    const centrifugeVan = trommelVan + 25 * 60 + 60;
    const centrifuge = blok(centrifugeVan, centrifugeVan + 6 * 60, 450, { onrust: 30 });
    const reeks = simuleer({ duurS: centrifugeVan + 15 * 60, basis: () => 300, lasten: [verwarmen, trommel, centrifuge] });
    const { app, momenten } = draai(reeks, undefined, { op: [600, trommelVan + 10 * 60] });
    // Tijdens het verwarmen: een vermoeden, met het deel erbij.
    const tijdens = momenten[600].nu[0];
    expect(tijdens.w).toBe(2050);
    expect(['wasmachine', 'vaatwasser', 'waterkoker']).toContain(tijdens.soort);
    // Tijdens de trommel: één regel "wasmachine, trommel", niet tientallen stukjes.
    const trommelNu = momenten[trommelVan + 10 * 60].nu.filter((i) => i.soort === 'wasmachine');
    expect(trommelNu).toHaveLength(1);
    expect(trommelNu[0]).toMatchObject({ deel: 'trommel', vorm: 'puls' });
    const warm = app.recent.find((r) => r.w === 2050);
    expect(warm).toMatchObject({ soort: 'wasmachine', deel: 'verwarmt' });
    expect(app.recent.some((r) => r.soort === 'wasmachine' && r.deel === 'trommel')).toBe(true);
    expect(app.recent.some((r) => r.soort === 'wasmachine' && r.deel === 'centrifuge')).toBe(true);
    // Hooguit een handvol regels, niet elke draai van de trommel apart.
    expect(app.recent.length).toBeLessThanOrEqual(8);
  });

  it('strijkijzer: pulserend (20 s aan, 40 s uit), één regel "strijkijzer"', () => {
    const reeks = simuleer({ duurS: 1800, basis: () => 450, lasten: [ritme(300, 300 + 15 * 60, 60, 20, 2000)] });
    const { app, momenten } = draai(reeks, undefined, { op: [300 + 8 * 60 + 30] });
    const tijdens = momenten[300 + 8 * 60 + 30].nu;
    expect(soorten(tijdens)).toEqual(['strijkijzer']);
    expect(tijdens[0]).toMatchObject({ vorm: 'puls', w: 2000 });
    const strijk = app.recent.filter((r) => r.soort === 'strijkijzer');
    expect(strijk).toHaveLength(1);
    expect(strijk[0].zeker).toBeGreaterThanOrEqual(0.6);
    expect(app.recent).toHaveLength(1);
  });

  it('stofzuiger: 850 W, onrustig, acht minuten: "stofzuiger" (misschien of waarschijnlijk)', () => {
    const reeks = simuleer({ duurS: 1500, basis: () => 450, lasten: [blok(300, 300 + 8 * 60, 850, { onrust: 50 })] });
    const { app } = draai(reeks);
    const groot = app.recent.filter((r) => r.w >= 600);
    expect(groot).toHaveLength(1);
    expect(groot[0].soort).toBe('stofzuiger');
    expect(groot[0].zeker).toBeGreaterThanOrEqual(0.35);
    // Geen reeks kleine stapjes uit de onrust.
    expect(app.recent.length).toBeLessThanOrEqual(2);
  });

  it('warmtepomp die langzaam wisselt (400–500 W): geen apparaten, wel de basis, en een warmtepomp in het patroon', () => {
    // 450 W ± 60 W in golven van 50 minuten, en twee keer per uur 100 W erbij over twee minuten (modulatie).
    const basis = (s) => 450 + 60 * Math.sin((2 * Math.PI * s) / 3000) + Math.min(100, Math.max(0, ((s % 1800) - 600) / 1.2)) * (s % 1800 < 1200 ? 1 : 0);
    const reeks = simuleer({ duurS: 12 * 3600, basis });
    const { app } = draai(reeks);
    expect(app.nu).toEqual([]);
    expect(app.recent).toEqual([]);
    expect(app.basis.w).toBeGreaterThanOrEqual(350);
    expect(app.basis.w).toBeLessThanOrEqual(600);
    expect(app.basis.warmtepomp).toBe(true);
  });

  it('bij Dirk: de spa met een eigen meter telt niet mee, de basis is 200 W en er is geen warmtepomp', () => {
    // De spa (1,4 kW) slaat elk uur een half uur aan, op zijn eigen kWh-meter (meting.apparaten).
    const spa = ritme(0, 12 * 3600, 3600, 1800, 1400);
    const reeks = simuleer({ duurS: 12 * 3600, basis: () => 200, gemeten: [spa], begin: Date.parse('2026-10-29T21:00:00Z') });
    const { app } = draai(reeks);
    expect(app.recent).toEqual([]);
    expect(app.nu).toEqual([]);
    expect(app.basis.w).toBe(200);
    expect(app.basis.warmtepomp).toBe(false);
    // De nacht (00:00–05:00 in Nederland) zit erin: het laagste van de nacht is de basis.
    expect(app.basis.altijd_w).toBe(200);
  });

  it('de P1 per fase als aanwijzing: een waterkoker op L2', () => {
    const reeks = simuleer({
      duurS: 900,
      basis: () => 300,
      lasten: [blok(300, 480, 2200)],
      fasen: (s) => [
        { fase: 1, w: 300 },
        { fase: 2, w: s >= 300 && s < 480 ? 2200 : 0 },
        { fase: 3, w: 0 },
      ],
    });
    const { app } = draai(reeks);
    expect(app.recent[0]).toMatchObject({ soort: 'waterkoker', fase: 2 });
  });

  it('een meting zonder net (oude of halve lezing): geen fout, niets herkend', () => {
    const h = maakHerkenner();
    h.ronde({ nu: BEGIN, meting: { zon_w: 100 } });
    expect(h.voorApp(BEGIN)).toBeNull();
    h.ronde({ nu: BEGIN + 5000, meting: {} });
    expect(h.voorApp(BEGIN + 5000)).toBeNull();
  });
});

describe('leren met de gebruiker', () => {
  const eenKeer = (van, w = 120, duur = 25 * 60) => blok(van, van + duur, w);

  it('"Dat was de vriezer": de volgende keer zegt hij "vriezer", ook al had het profiel "koelkast"', () => {
    // Eén keer 120 W, 25 minuten: zonder ritme nog geen zeker antwoord.
    const eerste = simuleer({ duurS: 3600, basis: () => 250, lasten: [eenKeer(300)] });
    const { herkenner, app } = draai(eerste);
    const gebeurtenis = app.recent.find((r) => r.w >= 100);
    expect(gebeurtenis.zeker).toBeLessThan(0.6);
    // De gebruiker in de app: "Dat was …" vriezer. De server geeft het label terug in het antwoord van ontvangMeting.
    const label = {
      id: gebeurtenis.id,
      soort: 'vriezer',
      w: gebeurtenis.w,
      duur_s: (Date.parse(gebeurtenis.tot) - Date.parse(gebeurtenis.van)) / 1000,
      was: gebeurtenis.soort ?? undefined,
      op: '2026-10-30T10:05:00.000Z',
    };
    expect(herkenner.zetLabels([label])).toBe(true);
    expect(herkenner.labelsOp).toBe('2026-10-30T10:05:00.000Z');
    // De gebeurtenis zelf staat nu als bevestigd in Eerder.
    expect(herkenner.voorApp(eerste.at(-1).nu).recent.find((r) => r.id === gebeurtenis.id)).toMatchObject({ soort: 'vriezer', zeker: 1, bevestigd: true });
    // Een uur later weer 120 W: nu "vriezer", en waarschijnlijk.
    const tweede = simuleer({ duurS: 3600, basis: () => 250, lasten: [eenKeer(600, 125, 22 * 60)], begin: BEGIN + 3600_000, zaad: 11 });
    const { app: daarna } = draai(tweede, herkenner);
    const nieuw = daarna.recent.find((r) => r.id !== gebeurtenis.id && r.w >= 100);
    expect(nieuw.soort).toBe('vriezer');
    expect(nieuw.bevestigd).toBeUndefined();
    expect(nieuw.zeker).toBeGreaterThanOrEqual(0.6);
  });

  it('een eigen naam ("Aquariumpomp") komt terug als naam', () => {
    const reeks = simuleer({ duurS: 2400, basis: () => 250, lasten: [eenKeer(300, 65, 15 * 60)] });
    const { herkenner, app } = draai(reeks);
    const g = app.recent[0];
    herkenner.zetLabels([{ id: g.id, soort: 'anders', naam: 'Aquariumpomp', w: g.w, duur_s: 900, op: '2026-10-30T10:00:00Z' }]);
    const { app: daarna } = draai(simuleer({ duurS: 2400, basis: () => 250, lasten: [eenKeer(300, 65, 15 * 60)], begin: BEGIN + 7200_000 }), herkenner);
    const nieuw = daarna.recent.find((r) => r.id !== g.id);
    expect(nieuw).toMatchObject({ soort: 'anders', naam: 'Aquariumpomp' });
  });

  it('labels mild nagekeken, de nieuwste per id, en handtekeningen per soort', () => {
    const labels = labelsUit([
      { id: 'a-1', soort: 'koelkast', w: 110, op: '2026-10-30T10:00:00Z' },
      { id: 'a-1', soort: 'vriezer', w: 110, op: '2026-10-30T11:00:00Z' },
      { id: 'a-2', soort: 'vriezer', w: 130, duur_s: 1500, fase: 2, op: '2026-10-30T10:30:00Z' },
      { id: 'a-3', soort: 'raket', w: 110, op: '2026-10-30T10:00:00Z' },
      { id: 'A 4', soort: 'oven', w: 2000, op: '2026-10-30T10:00:00Z' },
      { id: 'a-5', soort: 'oven', w: 'veel', op: '2026-10-30T10:00:00Z' },
      { id: 'a-6', soort: 'oven', w: 2000 },
      { id: 'a-7', soort: 'anders', naam: 'Pomp‮ vijver', w: 300, op: '2026-10-30T09:00:00Z' },
      null,
    ]);
    expect(labels.map((l) => [l.id, l.soort])).toEqual([
      ['a-7', 'anders'],
      ['a-2', 'vriezer'],
      ['a-1', 'vriezer'],
    ]);
    expect(labels[0].naam).toBe('Pomp vijver');
    const { handtekeningen } = handtekeningenUit(labels);
    const vriezer = handtekeningen.find((h) => h.soort === 'vriezer');
    expect(vriezer).toMatchObject({ w: 120, n: 2, duur_s: 1500, fase: 2 });
    expect(labelsUit('nee')).toEqual([]);
  });

  it('"Klopt" maakt hetzelfde zekerder dan het profiel alleen', () => {
    const k = { w: 2150, duur_s: 200, klaar: true, traag: false, ruis: null, vorm: null, ritme: false, fase: null };
    const zonder = herken(k);
    const met = herken(k, handtekeningenUit(labelsUit([{ id: 'x-1', soort: 'waterkoker', was: 'waterkoker', w: 2150, duur_s: 190, op: '2026-10-30T10:00:00Z' }])));
    expect(zonder.soort).toBe('waterkoker');
    expect(met.soort).toBe('waterkoker');
    expect(met.zeker).toBeGreaterThan(zonder.zeker);
  });
});

describe('slim: groepen onbekenden, gewoonten, tellen per week, zelflerende zekerheid', () => {
  // Elke avond om 18:00 (Nederland, wintertijd) een onbekend apparaat van 1,2 kW, twintig minuten.
  const avond = (dag) => Date.parse('2026-11-02T17:00:00Z') + dag * 86_400_000;
  const keerOnbekend = (h, dag, zaad = 5) => draai(simuleer({ duurS: 3600, basis: () => 300, lasten: [blok(300, 300 + 20 * 60, 1200)], begin: avond(dag), zaad }), h);

  it('terugkerend en onbekend: "Onbekend apparaat A" na drie keer, met vermogen, duur en dagdeel', () => {
    const h = maakHerkenner();
    keerOnbekend(h, 0);
    keerOnbekend(h, 1, 9);
    expect(h.voorApp(avond(1) + 3600_000).onbekend).toEqual([]);
    const { app } = keerOnbekend(h, 2, 13);
    expect(app.onbekend).toHaveLength(1);
    expect(app.onbekend[0]).toMatchObject({ letter: 'A', w: 1200, n: 3, dagdeel: 'avond' });
    expect(app.onbekend[0].duur_s).toBeGreaterThanOrEqual(1150);
    expect(app.onbekend[0].duur_s).toBeLessThanOrEqual(1250);
    // De regels in Eerder dragen de letter, zodat de app ze bij elkaar kan zetten.
    expect(app.recent.filter((r) => r.onbekend === 'A').length).toBeGreaterThanOrEqual(1);
  });

  it('één label voor de groep benoemt ze allemaal, telt ze in de week, en de volgende keer is het "zeker"', () => {
    const h = maakHerkenner();
    for (let dag = 0; dag < 4; dag += 1) keerOnbekend(h, dag, 5 + dag * 4);
    const groep = h.voorApp(avond(3) + 3600_000).onbekend[0];
    expect(groep.n).toBe(4);
    h.zetLabels([{ id: groep.id, soort: 'anders', naam: 'Kachel', w: groep.w, duur_s: groep.duur_s, aantal: groep.n, op: '2026-11-05T20:00:00Z' }]);
    const na = h.voorApp(avond(3) + 3600_000);
    expect(na.onbekend).toEqual([]);
    // Eerder houdt een dag bij: de laatste staat er, nu benoemd.
    expect(na.recent.filter((r) => r.w >= 1000)).toEqual([expect.objectContaining({ naam: 'Kachel', bevestigd: true })]);
    const kachel = na.week.apparaten.find((a) => a.naam === 'Kachel');
    expect(kachel).toMatchObject({ soort: 'anders', keer: 4 });
    expect(kachel.kwh).toBeCloseTo(1.6, 1);
    // De vijfde avond: meteen herkend, en zeker (vier keer bevestigd, geen verbetering).
    const { app } = keerOnbekend(h, 4, 31);
    const vijfde = app.recent.find((r) => !r.bevestigd);
    expect(vijfde).toMatchObject({ soort: 'anders', naam: 'Kachel' });
    expect(vijfde.zeker).toBeGreaterThanOrEqual(0.85);
  });

  it('een handtekening die vaak bevestigd is, wordt zekerder; een die verbeterd wordt, zakt', () => {
    const k = { w: 1200, duur_s: 1200, klaar: true, fase: null, vorm: null };
    const een = scoreHandtekening({ soort: 'oven', w: 1200, duur_s: 1200, n: 1 }, k);
    const vaak = scoreHandtekening({ soort: 'oven', w: 1200, duur_s: 1200, n: 5 }, k);
    const verbeterd = scoreHandtekening({ soort: 'oven', w: 1200, duur_s: 1200, n: 1, verbeterd: 2 }, k);
    expect(vaak).toBeGreaterThan(een);
    expect(verbeterd).toBeLessThan(een / 2);
    // Uit de labels: eerst "oven", daarna twee keer "Dat was de airfryer" bij hetzelfde vermogen.
    const { handtekeningen } = handtekeningenUit(
      labelsUit([
        { id: 'a-1', soort: 'oven', w: 1200, op: '2026-11-01T10:00:00Z' },
        { id: 'a-2', soort: 'airfryer', was: 'oven', w: 1210, op: '2026-11-02T10:00:00Z' },
        { id: 'a-3', soort: 'airfryer', was: 'oven', w: 1190, op: '2026-11-03T10:00:00Z' },
      ]),
    );
    expect(handtekeningen.find((x) => x.soort === 'oven').verbeterd).toBe(2);
    expect(handtekeningen.find((x) => x.soort === 'airfryer')).toMatchObject({ n: 2, verbeterd: 0 });
  });

  it('het gewone tijdstip: zaterdagochtend-wasmachine telt om 9 uur iets zwaarder, om 3 uur iets lichter', () => {
    const uren = Array(24).fill(0);
    uren[9] = 6;
    uren[10] = 4;
    const g = { uren, dagen: [0, 0, 0, 0, 0, 10, 0], n: 10 };
    expect(tijdFactor(g, 9)).toBeGreaterThan(1.1);
    expect(tijdFactor(g, 3)).toBeLessThan(1);
    expect(tijdFactor({ ...g, n: 3 }, 9)).toBe(1);
    expect(tijdFactor(null, 9)).toBe(1);
  });

  it('wat een eigen meter heeft (de spa bij Dirk) telt in de week: keer en kWh', () => {
    const spa = ritme(0, 12 * 3600, 3600, 1800, 1400);
    const reeks = simuleer({ duurS: 12 * 3600, basis: () => 200, gemeten: [spa], begin: Date.parse('2026-10-29T21:00:00Z') });
    const { app } = draai(reeks);
    const regel = app.week.apparaten.find((a) => a.sleutel === 'hw-apparaat-0');
    expect(regel).toMatchObject({ naam: 'Apparaat 0', keer: 12 });
    expect(regel.kwh).toBeCloseTo(8.4, 0);
    expect(app.week.van).toBe('2026-10-26');
  });

  it('de week begint op maandag in Nederland', () => {
    expect(weekVan(Date.parse('2026-11-01T22:30:00Z'))).toBe('2026-10-26'); // zondag 23:30
    expect(weekVan(Date.parse('2026-11-01T23:30:00Z'))).toBe('2026-11-02'); // maandag 00:30
  });
});

describe('per dag (0.12.0): kWh en keer per apparaat van vandaag, en de basis', () => {
  it('waterkoker en basis: herkend telt pas na het uitgaan; de basis is het huis min de waterkoker', () => {
    // Een uur: basis 450 W, om 09:05 (UTC) drie minuten een waterkoker van 2,2 kW.
    const reeks = simuleer({ duurS: 3600, basis: () => 450, lasten: [blok(300, 480, 2200)] });
    const { herkenner } = draai(reeks);
    const dag = herkenner.dagVoorApp('2026-10-30');
    expect(dag.apparaten).toEqual([{ sleutel: 'h:waterkoker', soort: 'waterkoker', kwh: 0.11, keer: 1 }]);
    // 450 W een uur lang (de eerste ronde telt nog niet mee): bijna 0,45 kWh.
    expect(dag.basis_kwh).toBeGreaterThan(0.42);
    expect(dag.basis_kwh).toBeLessThan(0.47);
    // Een andere dag: niets (dan gaat er niets extra mee).
    expect(herkenner.dagVoorApp('2026-10-29')).toEqual({});
  });

  it('bij Dirk: de spa met een eigen meter staat er gemeten in, met keer en kWh', () => {
    const spa = ritme(0, 12 * 3600, 3600, 1800, 1400);
    // Van 22:00 tot 10:00 (Nederland): de spa telt bij de dag waarop hij liep, de basis ook.
    const reeks = simuleer({ duurS: 12 * 3600, basis: () => 200, gemeten: [spa], begin: Date.parse('2026-10-29T21:00:00Z') });
    const { herkenner } = draai(reeks);
    const gisteren = herkenner.dagVoorApp('2026-10-29');
    const vandaag = herkenner.dagVoorApp('2026-10-30');
    expect(gisteren.apparaten[0]).toMatchObject({ sleutel: 'hw-apparaat-0', naam: 'Apparaat 0', gemeten: true, keer: 2 });
    expect(vandaag.apparaten[0]).toMatchObject({ sleutel: 'hw-apparaat-0', gemeten: true, keer: 10 });
    expect(gisteren.apparaten[0].kwh + vandaag.apparaten[0].kwh).toBeCloseTo(8.4, 0);
    // Niets herkend: de spa gaat er eerst af.
    expect(vandaag.apparaten.filter((a) => !a.gemeten)).toEqual([]);
    expect(vandaag.basis_kwh).toBeCloseTo(2, 0);
  });

  it('een groep onbekenden die een naam krijgt, telt alsnog bij vandaag', () => {
    const avond = (dag) => Date.parse('2026-11-02T17:00:00Z') + dag * 86_400_000;
    const h = maakHerkenner();
    for (let dag = 0; dag < 3; dag += 1) draai(simuleer({ duurS: 3600, basis: () => 300, lasten: [blok(300, 1500, 1200)], begin: avond(dag), zaad: 5 + dag }), h);
    // Drie keer terug en nog zonder naam (1.4.0): apart, niet in de Rest.
    const groep = h.voorApp(avond(2) + 3600_000).onbekend[0];
    expect(h.dagVoorApp('2026-11-04').apparaten).toEqual([{ sleutel: `h:onbekend:${groep.id}`, naam: 'Onbekend apparaat A, zo’n 1,2 kW', kwh: 0.4, keer: 1 }]);
    h.zetLabels([{ id: groep.id, soort: 'anders', naam: 'Kachel', w: groep.w, op: '2026-11-04T20:00:00Z' }]);
    const kachel = h.dagVoorApp('2026-11-04').apparaten[0];
    expect(kachel).toMatchObject({ sleutel: 'h:anders:kachel', soort: 'anders', naam: 'Kachel', keer: 1 });
    expect(kachel.kwh).toBeCloseTo(0.4, 1);
    expect(h.dagVoorApp('2026-11-04').apparaten).toHaveLength(1);
  });

  it('de sleutel van een herkend apparaat: kort, zonder accenten, en niet als die van een meter', () => {
    expect(herkendSleutel('wasmachine')).toBe('h:wasmachine');
    expect(herkendSleutel('anders', 'Föhn van Anna!')).toBe('h:anders:fohn-van-anna');
    expect(herkendSleutel('anders', 'x'.repeat(100))).toHaveLength(60);
    expect(herkendSleutel('anders', 'Aquariumpomp')).toMatch(/^[a-zA-Z0-9._:-]{1,60}$/);
  });

  it('herkennen.json van 0.11.0 (zonder dagen) laadt gewoon, en de dag overleeft een herstart', () => {
    const h = maakHerkenner();
    draai(simuleer({ duurS: 1200, basis: () => 450, lasten: [blok(300, 480, 2200)] }), h);
    const { dagen, ...oud } = h.bewaar();
    expect(Object.keys(dagen)).toEqual(['2026-10-30']);
    expect(maakHerkenner({ staat: oud }).dagVoorApp('2026-10-30')).toEqual({});
    const weer = maakHerkenner({ staat: JSON.parse(JSON.stringify(h.bewaar())) });
    expect(weer.dagVoorApp('2026-10-30')).toEqual(h.dagVoorApp('2026-10-30'));
  });

  it('hooguit HOOGSTENS_DAG_APPARATEN, meeste kWh eerst', () => {
    const veel = Array.from({ length: 40 }, (_, i) => (s) => (s < 600 ? 10 + i * 5 : 0));
    const { herkenner } = draai(simuleer({ duurS: 900, basis: () => 200, gemeten: veel }));
    const { apparaten } = herkenner.dagVoorApp('2026-10-30');
    expect(apparaten).toHaveLength(HOOGSTENS_DAG_APPARATEN);
    expect(apparaten[0].sleutel).toBe('hw-apparaat-39');
    expect(apparaten.every((a, i) => i === 0 || apparaten[i - 1].kwh >= a.kwh)).toBe(true);
  });
});

describe('bewaren en de lijsten', () => {
  it('herkennen.json: bewaren, laden, en verder met dezelfde labels en nachten', () => {
    const map = fs.mkdtempSync(path.join(os.tmpdir(), 'herkennen-'));
    const pad = path.join(map, 'herkennen.json');
    const h = maakHerkenner();
    draai(simuleer({ duurS: 900, basis: () => 300, lasten: [blok(300, 480, 2200)] }), h);
    h.zetLabels([{ id: 'x-1', soort: 'waterkoker', w: 2200, op: '2026-10-30T10:00:00Z' }]);
    expect(bewaarHerkennen(pad, h.bewaar())).toBeNull();
    const weer = maakHerkenner({ staat: laadHerkennen(pad) });
    expect(weer.labelsOp).toBe('2026-10-30T10:00:00Z');
    expect(laadHerkennen(path.join(map, 'weg.json'))).toBeNull();
    fs.writeFileSync(pad, '{kapot');
    expect(laadHerkennen(pad)).toBeNull();
    fs.rmSync(map, { recursive: true, force: true });
  });

  it('elk profiel heeft een soort uit de lijst en zinnige grenzen', () => {
    for (const [soort, p] of Object.entries(PROFIELEN)) {
      expect(SOORTEN).toContain(soort);
      expect(p.w[0]).toBeLessThan(p.w[1]);
      expect(p.duur[0]).toBeLessThan(p.duur[1]);
      expect(p.kans).toBeGreaterThan(0);
      expect(p.kans).toBeLessThanOrEqual(1);
    }
  });

  it('het warmtepomp-patroon: wisselend en hoog wel, rustig of laag niet', () => {
    const vakken = (waarden) => waarden.flatMap((w) => [w, w, w]).map((w, i) => ({ vijf: i, som: w * 60, n: 60 }));
    expect(warmtepompPatroon(vakken([400, 450, 500, 480, 420, 410, 470, 500, 460]))).toBe(true);
    expect(warmtepompPatroon(vakken([200, 205, 210, 200, 195, 200, 210, 205, 200]))).toBe(false);
    expect(warmtepompPatroon(vakken([150, 250, 150, 250, 150, 250, 150, 250]))).toBe(false);
    expect(warmtepompPatroon(vakken([400, 500]))).toBe(false);
  });

  // Een hele dag (17.280 rondes, elke ronde ook voorApp) kost hier zo'n 2,5 s: ~0,15 ms per ronde van 5 s. Ook op een
  // trage telefoon blijft dat ruim onder een paar ms per ronde. De grens is ruim, zodat een drukke testmachine niet
  // vals rood geeft (1.4.0: de handtekeningen kwamen erbij).
  it('licht genoeg: een dag lezingen in een paar seconden (~0,15 ms per ronde)', () => {
    const reeks = simuleer({ duurS: 24 * 3600, basis: () => 450, lasten: [ritme(0, 24 * 3600, 3300, 1200, 110), ritme(3600, 4500, 60, 20, 2000)] });
    const begin = performance.now();
    const h = maakHerkenner();
    for (const { nu, meting } of reeks) {
      h.ronde({ nu, meting });
      h.voorApp(nu);
    }
    expect(performance.now() - begin).toBeLessThan(8000);
    const app = h.voorApp(reeks.at(-1).nu);
    expect(app.nu.length).toBeLessThanOrEqual(10);
    expect(app.recent.length).toBeLessThanOrEqual(20);
    expect(JSON.stringify(app).length).toBeLessThan(5000);
  });
});

describe('ronde 19 (0.13.0): groepen, puls en cyclus, middernacht, lang aan, dubbel tellen, veilig bewaren', () => {
  /** Een herkenner met een klok: stap(w, s) meet s seconden lang w (elke 5 s). */
  const huis = (begin) => {
    const h = maakHerkenner();
    let t = Date.parse(begin);
    const stap = (w, s) => {
      for (let i = 0; i < s / 5; i += 1) {
        h.ronde({ nu: t, meting: { net_w: w, zon_w: 0, batterij_w: 0, apparaten: [] } });
        t += 5000;
      }
    };
    return { h, stap, nu: () => t };
  };

  it('na twaalf eenmalige onbekenden komt een nieuwe die vaker terugkomt toch in een groep (de app vraagt erom)', () => {
    const { h, stap, nu } = huis('2026-11-02T08:00:00Z');
    stap(200, 600);
    const eenmalig = [300, 405, 547, 738, 997, 1346, 1817, 2453, 3311, 7300, 9900, 13_000];
    expect(eenmalig).toHaveLength(HOOGSTENS_ONBEKEND);
    for (const w of eenmalig) {
      stap(200 + w, 4000);
      stap(200, 1500);
    }
    expect(h.bewaar().onbekend).toHaveLength(HOOGSTENS_ONBEKEND);
    for (let k = 0; k < 6; k += 1) {
      stap(5400, 4000);
      stap(200, 1500);
    }
    const groepen = h.bewaar().onbekend;
    expect(groepen.length).toBeLessThanOrEqual(HOOGSTENS_ONBEKEND);
    const groot = groepen.find((c) => c.w > 5000 && c.w < 6000);
    expect(groot).toMatchObject({ n: 6 });
    // Elke keer verwijst naar een groep die bestaat.
    expect(h.bewaar().recent.filter((r) => r.w > 5000 && r.w < 6000).every((r) => groepen.some((c) => c.id === r.cluster))).toBe(true);
    expect(h.voorApp(nu()).onbekend.map((c) => c.n)).toContain(6);
  });

  it('een eenmalige onbekende die twee weken wegbleef, vervalt', () => {
    const { h, stap } = huis('2026-11-02T08:00:00Z');
    stap(200, 600);
    stap(530, 4000);
    stap(200, 1500);
    expect(h.bewaar().onbekend).toHaveLength(1);
    // Vijftien dagen later een heel andere.
    const staat = h.bewaar();
    staat.onbekend[0].laatst -= 15 * 86_400_000;
    const h2 = maakHerkenner({ staat: JSON.parse(JSON.stringify(staat)) });
    let t = Date.parse('2026-11-02T12:00:00Z');
    for (const [w, s] of [[200, 600], [3300, 4000], [200, 1500]]) {
      for (let i = 0; i < s / 5; i += 1) {
        h2.ronde({ nu: t, meting: { net_w: w, zon_w: 0, batterij_w: 0, apparaten: [] } });
        t += 5000;
      }
    }
    expect(h2.bewaar().onbekend.map((c) => c.w)).toEqual([3100]);
  });

  it('strijkijzer een uur (40 keer 30 s aan, 60 s uit, 1.500 W): 0,5 kWh, niet de hele tijd', () => {
    const { h, stap } = huis('2026-11-02T09:00:00Z');
    stap(200, 600);
    for (let k = 0; k < 40; k += 1) {
      stap(1700, 30);
      stap(200, 60);
    }
    stap(200, 1800);
    const dag = h.dagVoorApp('2026-11-02');
    expect(dag.apparaten).toEqual([{ sleutel: 'h:strijkijzer', soort: 'strijkijzer', kwh: 0.5, keer: 1 }]);
  });

  it('kwhPerDag: over middernacht naar de tijd verdeeld; een dag die al voorbij is, telt bij vandaag', () => {
    const van = Date.parse('2026-11-02T22:30:00Z'); // 23:30 in Nederland
    const tot = van + 3600_000; // 00:30
    expect(kwhPerDag([[van, tot, 2000]]).map((d) => [d.datum, d.kwh])).toEqual([['2026-11-02', 1], ['2026-11-03', 1]]);
    expect(kwhPerDag([[van, tot, 2000]], { nu: tot + 600_000 }).map((d) => [d.datum, d.kwh])).toEqual([['2026-11-03', 2]]);
    // Een puls: alleen de stukken.
    expect(kwhPerDag([[van, van + 30_000, 1200], [van + 90_000, van + 120_000, 1200]])[0].kwh).toBeCloseTo(0.02, 5);
    // De nacht van de wintertijd (25 uur) loopt ook goed.
    const lang = Date.parse('2026-10-24T22:00:00Z');
    expect(kwhPerDag([[lang, lang + 25 * 3600_000, 1000]]).map((d) => [d.datum, Math.round(d.kwh)])).toEqual([['2026-10-25', 25]]);
  });

  it('waterkoker om 23:55: telt bij de volgende dag (de app neemt de vorige niet meer aan), niet kwijt', () => {
    const { h, stap } = huis('2026-11-02T22:30:00Z');
    stap(200, 1500); // tot 23:55
    stap(2400, 180);
    stap(200, 1500);
    expect(h.dagVoorApp('2026-11-02').apparaten).toEqual([]);
    expect(h.dagVoorApp('2026-11-03').apparaten).toEqual([{ sleutel: 'h:waterkoker', soort: 'waterkoker', kwh: 0.11, keer: 1 }]);
  });

  it('een warmtepomp die langer dan 12 uur draait, telt (apparaat plus basis is het huis, geen Rest)', () => {
    const h = maakHerkenner();
    const start = Date.parse('2026-11-01T23:00:00Z'); // 00:00 in Nederland
    const pompVan = Date.parse('2026-11-02T05:00:00Z'); // 06:00
    const eind = Date.parse('2026-11-02T22:59:00Z');
    let huisKwh = 0;
    for (let t = start; t <= eind; t += 5000) {
      let w = 250;
      if (t >= pompVan) {
        const s = (t - pompVan) / 1000;
        w += s < 40 ? 40 * s : 1600;
      }
      if (t > start) huisKwh += (w * 5) / 3.6e6;
      h.ronde({ nu: t, meting: { net_w: w, zon_w: 0, batterij_w: 0, apparaten: [] } });
    }
    const dag = h.dagVoorApp('2026-11-02');
    expect(dag.apparaten.map((a) => a.sleutel)).toEqual(['h:warmtepomp']);
    const samen = dag.apparaten[0].kwh + dag.basis_kwh;
    expect(Math.abs(samen - huisKwh)).toBeLessThan(0.5);
  });

  it('een niet-herkend apparaat dat 12 uur aan staat, telt bij de basis', () => {
    const { h, stap } = huis('2026-11-01T23:00:00Z');
    stap(200, 600);
    stap(200 + 640, 13 * 3600);
    const dag = h.dagVoorApp('2026-11-02');
    // 200 W × ~13 uur plus 640 W × 13 uur, min de eerste ronde.
    expect(dag.basis_kwh + dag.apparaten.reduce((s, a) => s + a.kwh, 0)).toBeGreaterThan(10.8);
  });

  it('een label op één keer en daarna op zijn groep: die keer telt één keer (4 keer, 0,24 kWh)', () => {
    const h = maakHerkenner();
    const start = Date.parse('2026-11-02T07:00:00Z');
    const runs = [0, 1, 2, 3].map((k) => [start + 1800_000 + k * 3 * 3600_000, start + 1800_000 + k * 3 * 3600_000 + 480_000]);
    for (let t = start; t <= start + 13 * 3600_000; t += 5000) {
      let w = 250;
      for (const [v, e] of runs) if (t >= v && t < e) w += 450;
      h.ronde({ nu: t, meting: { net_w: w, zon_w: 0, batterij_w: 0, apparaten: [] } });
    }
    const groep = h.bewaar().onbekend[0];
    expect(groep.n).toBe(4);
    const een = h.voorApp(start + 13 * 3600_000).recent.at(-1);
    h.zetLabels([{ id: een.id, soort: 'anders', naam: 'Aquarium', w: 450, op: '2026-11-02T20:00:00Z' }]);
    const voor = h.dagVoorApp('2026-11-02').apparaten;
    expect(voor.find((a) => a.sleutel === 'h:anders:aquarium')).toMatchObject({ kwh: 0.06, keer: 1 });
    // De andere drie keer: apart als terugkerend onbekend (1.4.0), niet in de Rest.
    expect(voor.find((a) => a.sleutel.startsWith('h:onbekend:'))).toMatchObject({ kwh: 0.18, keer: 3, naam: 'Onbekend apparaat A, zo’n 450 W' });
    h.zetLabels([
      { id: een.id, soort: 'anders', naam: 'Aquarium', w: 450, op: '2026-11-02T20:00:00Z' },
      { id: groep.id, soort: 'anders', naam: 'Aquarium', w: 450, aantal: groep.n, op: '2026-11-02T20:05:00Z' },
    ]);
    expect(h.dagVoorApp('2026-11-02').apparaten).toEqual([{ sleutel: 'h:anders:aquarium', soort: 'anders', naam: 'Aquarium', kwh: 0.24, keer: 4 }]);
    expect(h.voorApp(start + 13 * 3600_000).week.apparaten[0]).toMatchObject({ naam: 'Aquarium', keer: 4 });
  });

  it('herkennen.json van 0.12.0 (een puls zonder stukken): laadt en telt zoals toen', () => {
    const { h, stap } = huis('2026-11-02T09:00:00Z');
    stap(200, 600);
    for (let k = 0; k < 10; k += 1) {
      stap(1700, 30);
      stap(200, 60);
    }
    stap(200, 60);
    const staat = JSON.parse(JSON.stringify(h.bewaar()));
    for (const r of staat.recent) delete r.stukken;
    const oud = maakHerkenner({ staat });
    let t = Date.parse('2026-11-02T09:00:00Z') + (600 + 10 * 90 + 60) * 1000;
    for (let i = 0; i < 1200 / 5; i += 1) {
      oud.ronde({ nu: t, meting: { net_w: 200, zon_w: 0, batterij_w: 0, apparaten: [] } });
      t += 5000;
    }
    const strijk = oud.dagVoorApp('2026-11-02').apparaten.find((a) => a.soort === 'strijkijzer');
    // Zoals 0.12.0: de hele tijd van de groep (13,5 min × 1.500 W).
    expect(strijk.kwh).toBeCloseTo(0.34, 1);
  });

  it('herkennen.json veilig bewaren: met .vorige; kapot, dan de vorige (en het kapotte opzij)', () => {
    const map = fs.mkdtempSync(path.join(os.tmpdir(), 'herkennen-'));
    const pad = path.join(map, 'herkennen.json');
    expect(bewaarHerkennen(pad, { v: 1, labels: [], letters: 1 })).toBeNull();
    expect(bewaarHerkennen(pad, { v: 1, labels: [], letters: 2 })).toBeNull();
    expect(JSON.parse(fs.readFileSync(`${pad}.vorige`, 'utf8')).letters).toBe(1);
    fs.writeFileSync(pad, '{"v":1,"lab');
    // proef en de tests kijken alleen: niets opzij.
    expect(laadHerkennen(pad).letters).toBe(1);
    expect(fs.existsSync(`${pad}.kapot`)).toBe(false);
    const regels = [];
    expect(laadHerkennen(pad, { log: (r) => regels.push(r) }).letters).toBe(1);
    expect(fs.existsSync(`${pad}.kapot`)).toBe(true);
    expect(regels).toEqual(['herkennen.json was kapot; ik heb hem opzij gezet als herkennen.json.kapot.', 'herkennen.json was kapot of weg; ik ga verder met de vorige.']);
    fs.rmSync(`${pad}.vorige`);
    expect(laadHerkennen(pad)).toBeNull();
    fs.rmSync(map, { recursive: true, force: true });
  });
});

describe('handtekeningen (1.4.0): hoe iets aangaat en afvalt, groeperen, vragen', () => {
  /** Een moment in Nederland (november: wintertijd). */
  const om = (datum, klok) => Date.parse(`${datum}T${klok}:00+01:00`);
  /** Koelkast met aanloopstroom: de eerste lezing `piek`, daarna `w`; `aan` s aan per `periode`. */
  const koelkast = (van, tot, periode, aan, w, piek) => (s) => {
    if (s < van || s >= tot) return 0;
    const f = (s - van) % periode;
    return f >= aan ? 0 : f < 5 ? piek : w;
  };
  /** Iets dat traag aanloopt en afbouwt (een warmtepomp): in `aanloop` s van 0 naar `w`, en net zo terug. */
  const traag = (van, tot, w, aanloop) => (s) => {
    if (s < van || s >= tot + aanloop) return 0;
    if (s < van + aanloop) return (w * (s - van + 5)) / (aanloop + 5);
    if (s >= tot) return (w * (tot + aanloop - s)) / (aanloop + 5);
    return w;
  };
  /** Eén keer `last` in een venster van `duurS` vanaf `begin` (ms), in herkenner `h`. */
  const keer = (h, begin, duurS, lasten, zaad = 3, basis = () => 450) => draai(simuleer({ duurS, basis, lasten, begin, zaad }), h);

  it('vormVan: puls en cyclus, traag, een piek, golven, of een rustig blok', () => {
    expect(vormVan({ vorm: 'puls' })).toBe('puls');
    expect(vormVan({ vorm: 'cyclus', traag: true })).toBe('cyclus');
    expect(vormVan({ traag: true, piek_w: 400 })).toBe('traag');
    expect(vormVan({ piek_w: 400 })).toBe('piek');
    expect(vormVan({ ruis: 0.03 })).toBe('golf');
    expect(vormVan({ ruis: 0.005 })).toBe('vlak');
    expect(vormVan({})).toBe('vlak');
    expect(VORMEN).toEqual(['puls', 'cyclus', 'traag', 'piek', 'golf', 'vlak']);
  });

  it('koelkast die cyclust, met een korte piek bij het aangaan: één groep "piek", vermoeden koelkast, en niet half in de Rest', () => {
    // 110 W met een eerste lezing van 400 W, 20 minuten aan, 35 uit, zes uur lang, op een basis van 200 W (dirk).
    const reeks = simuleer({ duurS: 6 * 3600, basis: () => 200, lasten: [koelkast(600, 6 * 3600, 55 * 60, 20 * 60, 110, 400)], begin: om('2026-11-03', '06:00') });
    const { app, herkenner } = draai(reeks);
    expect(app.onbekend).toHaveLength(1);
    const groep = app.onbekend[0];
    expect(groep).toMatchObject({ letter: 'A', vorm: 'piek', vermoeden: 'koelkast' });
    expect(groep.w).toBeGreaterThanOrEqual(100);
    expect(groep.w).toBeLessThanOrEqual(120);
    expect(groep.n).toBeGreaterThanOrEqual(5);
    expect(groep.vandaag).toBe(groep.n);
    expect(groep.tijden).toHaveLength(4);
    // De begintijden: elke 55 minuten.
    expect(Date.parse(groep.tijden[3]) - Date.parse(groep.tijden[2])).toBe(55 * 60_000);
    // Wat het programmaatje kent: de koelkast, uit zichzelf (niet aangewezen).
    expect(app.kennis.apparaten).toEqual([expect.objectContaining({ soort: 'koelkast' })]);
    expect(app.kennis.apparaten[0].aangewezen).toBeUndefined();
    // Alles bij de koelkast, ook de eerste keren van voor het ritme: geen "Onbekend apparaat A" ernaast.
    const dag = herkenner.dagVoorApp('2026-11-03').apparaten;
    expect(dag.map((a) => a.sleutel)).toEqual(['h:koelkast']);
    expect(dag[0].keer).toBe(groep.n);
  });

  it('waterkoker: korte hoge sprong, drie keer vandaag (07:10, 12:30, 18:05): één groep "vlak", met de tijden', () => {
    const h = maakHerkenner();
    for (const [klok, w, zaad] of [['07:05', 2200, 3], ['12:25', 2100, 5], ['18:00', 2250, 7]]) {
      keer(h, om('2026-11-03', klok), 1500, [blok(300, 480, w)], zaad);
    }
    const app = h.voorApp(om('2026-11-03', '18:30'));
    expect(app.onbekend).toHaveLength(1);
    const groep = app.onbekend[0];
    expect(groep).toMatchObject({ vorm: 'vlak', vermoeden: 'waterkoker', n: 3, vandaag: 3, duur_s: 180 });
    expect(groep.w).toBeGreaterThanOrEqual(2100);
    expect(groep.w).toBeLessThanOrEqual(2250);
    expect(groep.tijden).toEqual([om('2026-11-03', '07:10'), om('2026-11-03', '12:30'), om('2026-11-03', '18:05')].map((t) => new Date(t).toISOString()));
    // Op een profiel herkend: telt bij de waterkoker, niet als onbekend.
    expect(h.dagVoorApp('2026-11-03').apparaten.map((a) => a.sleutel)).toEqual(['h:waterkoker']);
  });

  it('wasmachine: het verwarmen ("vlak", ~2 kW) en de trommel ("puls", ~200 W) zijn twee groepen, allebei wasmachine', () => {
    const h = maakHerkenner();
    const was = () => {
      const verwarmen = blok(300, 300 + 14 * 60, 2050);
      const trommelVan = 300 + 14 * 60 + 30;
      const trommel = (s) => (s >= trommelVan && s < trommelVan + 25 * 60 && (s - trommelVan) % 25 < 15 ? 200 : 0);
      const centrifugeVan = trommelVan + 25 * 60 + 60;
      return { lasten: [verwarmen, trommel, blok(centrifugeVan, centrifugeVan + 6 * 60, 450, { onrust: 30 })], duurS: centrifugeVan + 20 * 60 };
    };
    for (const dag of ['2026-11-02', '2026-11-04', '2026-11-07']) {
      const { lasten, duurS } = was();
      keer(h, om(dag, '09:00'), duurS, lasten, 11, () => 300);
    }
    const app = h.voorApp(om('2026-11-07', '11:00'));
    const warm = app.onbekend.find((c) => c.w >= 1900);
    const trommel = app.onbekend.find((c) => c.w < 300);
    expect(warm).toMatchObject({ vorm: 'vlak', n: 3, vermoeden: 'wasmachine', dagdeel: 'ochtend' });
    expect(trommel).toMatchObject({ vorm: 'puls', n: 3, vermoeden: 'wasmachine' });
    expect(warm.id).not.toBe(trommel.id);
    // Eén keer per wasdag.
    expect(warm.per_dag).toBe(1);
  });

  it('warmtepomp met trage aanloop en een even groot rustig blok: twee groepen, "traag" en "vlak"', () => {
    const h = maakHerkenner();
    const pomp = traag(300, 300 + 90 * 60, 1500, 60);
    const boiler = blok(300, 300 + 90 * 60, 1500);
    for (const [dag, n] of [['2026-11-03', 0], ['2026-11-04', 1], ['2026-11-05', 2]]) {
      keer(h, om(dag, '02:00'), 100 * 60 + 600, [pomp], 3 + n);
      keer(h, om(dag, '14:00'), 100 * 60 + 600, [boiler], 9 + n);
    }
    const app = h.voorApp(om('2026-11-05', '16:00'));
    const traagGroep = app.onbekend.find((c) => c.vorm === 'traag');
    const vlak = app.onbekend.find((c) => c.vorm === 'vlak');
    expect(traagGroep).toMatchObject({ n: 3, dagdeel: 'nacht', vermoeden: 'warmtepomp' });
    expect(vlak).toMatchObject({ n: 3, dagdeel: 'middag' });
    expect(vlak.vermoeden).not.toBe('warmtepomp');
    expect(traagGroep.w).toBeGreaterThanOrEqual(1400);
    expect(vlak.w).toBeGreaterThanOrEqual(1400);
    // Het traag afbouwen staat in de handtekening van elke keer.
    expect(h.bewaar().recent.filter((r) => r.k.traag).every((r) => r.k.uit_traag)).toBe(true);
  });

  it('een label voor de groep: de volgende keer zeker, en de kennis zegt hoe vaak aangewezen', () => {
    const h = maakHerkenner();
    const pomp = traag(300, 300 + 40 * 60, 1800, 40);
    for (const dag of ['2026-11-03', '2026-11-04', '2026-11-05']) keer(h, om(dag, '07:00'), 60 * 60, [pomp], 5);
    const groep = h.voorApp(om('2026-11-05', '08:00')).onbekend[0];
    expect(groep.vorm).toBe('traag');
    // Zoals de app hem stuurt (labelVoorGroep in src/lib/herkennen.js): met de vorm en wat we vermoedden.
    h.zetLabels([{ id: groep.id, soort: 'boiler', w: groep.w, duur_s: groep.duur_s, vorm: groep.vorm, was: groep.vermoeden, aantal: groep.n, op: '2026-11-05T08:00:00Z' }]);
    const na = h.voorApp(om('2026-11-05', '08:00'));
    expect(na.onbekend).toEqual([]);
    expect(na.kennis.apparaten[0]).toMatchObject({ soort: 'boiler', aangewezen: 3 });
    expect(na.kennis.apparaten[0].zeker).toBeGreaterThanOrEqual(0.95);
    const { app } = keer(h, om('2026-11-06', '07:00'), 60 * 60, [pomp], 21);
    expect(app.recent[0]).toMatchObject({ soort: 'boiler' });
    expect(app.recent[0].zeker).toBeGreaterThanOrEqual(0.85);
    // Uit een aangewezen handtekening herkend: geen nieuwe vraag.
    expect(app.onbekend).toEqual([]);
  });

  it('herkennen.json van 1.3.0 (groepen zonder vorm en tijden): laadt, en de handtekening groeit vanaf nu', () => {
    const h = maakHerkenner();
    for (const [klok, zaad] of [['07:05', 3], ['12:25', 5], ['18:00', 7]]) keer(h, om('2026-11-03', klok), 1500, [blok(300, 600, 1300)], zaad);
    const staat = JSON.parse(JSON.stringify(h.bewaar()));
    for (const c of staat.onbekend) {
      for (const veld of ['vormen', 'tijden', 'datum', 'op_dag', 'dagen_gezien', 'keren']) delete c[veld];
      c.letter = 'C';
    }
    const weer = maakHerkenner({ staat });
    weer.ronde({ nu: om('2026-11-03', '18:30'), meting: { net_w: 450, zon_w: 0, batterij_w: 0, apparaten: [] } });
    expect(weer.voorApp(om('2026-11-03', '18:30')).onbekend[0]).toMatchObject({ letter: 'C', n: 3 });
    expect(weer.voorApp(om('2026-11-03', '18:30')).onbekend[0].tijden).toBeUndefined();
    keer(weer, om('2026-11-04', '07:05'), 1500, [blok(300, 600, 1300)], 9);
    const groep = weer.voorApp(om('2026-11-04', '07:30')).onbekend[0];
    expect(groep).toMatchObject({ letter: 'C', n: 4, vandaag: 1 });
    // Pas één keer met een vorm gezien: nog geen vorm (dat kan pas vanaf twee).
    expect(groep.vorm).toBeUndefined();
    expect(groep.tijden).toEqual([new Date(om('2026-11-04', '07:10')).toISOString()]);
  });

  it('klein genoeg: een drukke dag met vijf groepen en de kennis blijft ruim onder de grens van een meting', () => {
    const h = maakHerkenner();
    for (const dag of ['2026-11-03', '2026-11-04', '2026-11-05']) {
      for (const [klok, w] of [['06:00', 300], ['08:00', 700], ['10:00', 1300], ['12:00', 2100], ['14:00', 3300]]) keer(h, om(dag, klok), 1800, [blok(300, 900, w)], w);
    }
    const app = h.voorApp(om('2026-11-05', '15:00'));
    expect(app.onbekend).toHaveLength(5);
    expect(app.onbekend.every((c) => c.tijden.length === 3 && c.n === 3)).toBe(true);
    expect(JSON.stringify(app).length).toBeLessThan(6000);
    expect(JSON.stringify(h.bewaar()).length).toBeLessThan(60_000);
  });
});
