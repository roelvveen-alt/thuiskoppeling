import { describe, expect, it } from 'vitest';
import { meldingenVoorApp } from './gekoppeld.mjs';
import { spanningUit } from './homewizard.mjs';
import { DICHTBIJ_WEG_MS, spanningenUit, spanningWacht } from './spanning.mjs';

// 31 juli 2026, 13:00 Nederlandse tijd.
const MIDDAG = Date.parse('2026-07-31T11:00:00Z');

/** Zoals bij Dirk: een P1 zonder spanning, de driefase kWh-meter van de spa en de eenfase kWh-meter op de zon. */
const dirk = ({ spa = [230, 231, 229], zon = 232, zonW = 2500 } = {}) => ({
  meting: { fasen: [{ fase: 1, a: 3 }, { fase: 2, a: 1 }, { fase: 3, a: 2 }], zon_w: zonW },
  omvormer: null,
  homewizard: [
    { meter: { sleutel: 'p1', rol: 'net', naam: 'Meterkast' }, spanning: [] },
    { meter: { sleutel: 'spa', rol: 'apparaat', naam: 'Spa' }, spanning: spa.map((v, i) => ({ fase: i + 1, v })) },
    { meter: { sleutel: 'zon', rol: 'zon', naam: 'Zonnepanelen' }, spanning: zon === null ? [] : [{ fase: 1, v: zon }] },
  ],
});

/** Zoals het echt is bij Dirk (Tim, 31-10-2026): BEIDE kWh-meters driefase (de SolarEdge SE6K levert op alle drie de fasen). */
const dirkDriefase = ({ spa = [230, 231, 229], zon = [233, 232, 231], zonW = 2500 } = {}) => ({
  meting: { fasen: [{ fase: 1, a: 3 }, { fase: 2, a: 1 }, { fase: 3, a: 2 }], zon_w: zonW },
  omvormer: null,
  homewizard: [
    { meter: { sleutel: 'p1', rol: 'net', naam: 'Meterkast' }, spanning: [] },
    { meter: { sleutel: 'spa', rol: 'apparaat', naam: 'Spa' }, spanning: spa.map((v, i) => ({ fase: i + 1, v })) },
    { meter: { sleutel: 'zon', rol: 'zon', naam: 'Zonnepanelen' }, spanning: zon.map((v, i) => ({ fase: i + 1, v })) },
  ],
});

describe('de spanning uit een HomeWizard-meter', () => {
  it('eenfase (v1 active_voltage_v, v2 voltage_v) en driefase (l1…l3)', () => {
    expect(spanningUit({ active_voltage_v: 231.4 })).toEqual([{ fase: 1, v: 231.4 }]);
    expect(spanningUit({ voltage_v: 229 })).toEqual([{ fase: 1, v: 229 }]);
    expect(spanningUit({ active_voltage_l1_v: 230, active_voltage_l2_v: 231, active_voltage_l3_v: 232 })).toHaveLength(3);
    expect(spanningUit({ voltage_l1_v: null, active_power_w: 10 })).toEqual([]);
    expect(spanningUit({ active_voltage_v: 0 })).toEqual([]);
  });
});

describe('de beste bron per fase', () => {
  it('bij Dirk: P1 zonder spanning + driefase spa-meter → alle drie fasen een spanning, met de naam; de zonmeter apart', () => {
    const uit = spanningenUit(dirk());
    expect(uit.fasen).toEqual([
      { fase: 1, v: 230, bron: 'meter', sleutel: 'spa', naam: 'Spa' },
      { fase: 2, v: 231, bron: 'meter', sleutel: 'spa', naam: 'Spa' },
      { fase: 3, v: 229, bron: 'meter', sleutel: 'spa', naam: 'Spa' },
    ]);
    expect(uit.zon).toEqual({ v: 232, sleutel: 'zon', naam: 'Zonnepanelen' });
    expect(uit.spanningen.map((x) => x.sleutel)).toEqual(['L1', 'L2', 'L3', 'zon']);
  });
  it('bij Tim: de omvormer gaat voor, dan de P1', () => {
    const uit = spanningenUit({ meting: { fasen: [{ fase: 1, v: 233 }, { fase: 2, v: 232 }, { fase: 3, v: 229 }] }, omvormer: { fasen: [{ v: 236 }, { v: 235 }, { v: 233 }] } });
    expect(uit.fasen.map((f) => [f.bron, f.v])).toEqual([['omvormer', 236], ['omvormer', 235], ['omvormer', 233]]);
    expect(spanningenUit({ meting: { fasen: [{ fase: 1, v: 233 }] } }).fasen[0].bron).toBe('p1');
  });
  it('bij Dirk, twee driefase meters: de zonmeter gaat voor (het dichtst bij de omvormer), de spa-meter is de tweede', () => {
    const uit = spanningenUit(dirkDriefase());
    expect(uit.fasen).toEqual([
      { fase: 1, v: 233, bron: 'zon', sleutel: 'zon', naam: 'Zonnepanelen' },
      { fase: 2, v: 232, bron: 'zon', sleutel: 'zon', naam: 'Zonnepanelen' },
      { fase: 3, v: 231, bron: 'zon', sleutel: 'zon', naam: 'Zonnepanelen' },
    ]);
    expect(uit.zon).toBeNull();
    expect(uit.tweede).toMatchObject({ bron: 'meter', naam: 'Spa', fasen: [{ fase: 1, v: 230 }, { fase: 2, v: 231 }, { fase: 3, v: 229 }] });
    expect(uit.spanningen.map((x) => x.sleutel)).toEqual(['L1', 'L2', 'L3']);
  });
  it('volgorde: omvormer, driefase zonmeter, andere driefase meter, dan de P1', () => {
    const p1 = { fasen: [{ fase: 1, v: 228 }, { fase: 2, v: 228 }, { fase: 3, v: 228 }] };
    expect(spanningenUit({ ...dirkDriefase(), meting: p1 }).fasen[0].bron).toBe('zon');
    expect(spanningenUit({ ...dirk(), meting: p1 }).fasen[0].bron).toBe('meter');
    expect(spanningenUit({ meting: p1, homewizard: [] }).fasen[0].bron).toBe('p1');
    // Alleen een driefase zonmeter en de P1: dan vergelijkt hij met de P1.
    const zonEnP1 = spanningenUit({ meting: p1, homewizard: [dirkDriefase().homewizard[2]] });
    expect(zonEnP1.tweede).toMatchObject({ bron: 'p1' });
    // Een eenfase zonmeter (zoals eerst gedacht): geen tweede, de zon apart.
    expect(spanningenUit(dirk()).tweede).toBeNull();
  });
  it('geen enkele bron: leeg, en de app krijgt een blok zonder herkomst', () => {
    const uit = spanningenUit({ meting: { fasen: [{ fase: 1, a: 2 }] }, homewizard: [] });
    expect(uit).toMatchObject({ fasen: [], zon: null, bron: null });
    const w = spanningWacht();
    w.ronde({ nu: MIDDAG, ...uit, zonW: 0 });
    expect(w.voorApp(MIDDAG)).toMatchObject({ herkomst: [], hoogste: [], nu: [] });
  });
});

/** Rondes van 5 s met spanning per sleutel en zon. */
function draai(w, { van, tot, bron, zonW = () => 2500, storingen = () => [], zelfBegrensd = false }) {
  const zinnen = [];
  for (let nu = van; nu < tot; nu += 5000) {
    zinnen.push(...w.ronde({ nu, ...bron(nu), zonW: zonW(nu), nacht: false, storingen: storingen(nu), zelfBegrensd }));
  }
  return zinnen;
}

describe('uitval herkennen', () => {
  it('de zon valt plots weg bij een hoge spanning op de zonnefase: melding, regel, lijst en tellers', () => {
    const w = spanningWacht();
    const uitval = MIDDAG + 12 * 60_000;
    const zinnen = draai(w, {
      van: MIDDAG,
      tot: uitval + 60_000,
      bron: () => spanningenUit(dirk({ zon: 254, spa: [249, 251, 248] })),
      zonW: (nu) => (nu < uitval ? 3000 : 0),
    });
    expect(zinnen).toHaveLength(1);
    expect(zinnen[0]).toMatch(/^Omvormer viel om 13:12 uit bij hoge netspanning: zonnefase 254 V \(10 min gem\. 254 V\); Spa L1 249\/L2 251\/L3 248 V\. Meld het bij de netbeheerder\.$/);
    expect(zinnen[0].length).toBeLessThanOrEqual(160);
    const blok = w.voorApp(uitval + 60_000);
    expect(blok).toMatchObject({ uitval_vandaag: 1, uitval_maand: 1, lijst: [expect.objectContaining({ sleutel: 'zon', v: 254 })] });
    expect(w.meldingen()).toHaveLength(1);
    // De melding gaat als soort 'spanning' naar de app (en zo één regel in het Logboek).
    const m = meldingenVoorApp({ homewizard: [], tuya: [] }, { problemen: new Map(), sinds: new Map(), spanning: w.meldingen(), nu: uitval });
    expect(m).toEqual([expect.objectContaining({ soort: 'spanning', tekst: zinnen[0] })]);
  });

  it('dezelfde val zonder hoge spanning: geen spanningsuitval', () => {
    const w = spanningWacht();
    const uitval = MIDDAG + 12 * 60_000;
    expect(draai(w, { van: MIDDAG, tot: uitval + 60_000, bron: () => spanningenUit(dirk()), zonW: (nu) => (nu < uitval ? 3000 : 0) })).toEqual([]);
    expect(w.voorApp(uitval).uitval_vandaag).toBe(0);
  });

  it('een wolk laat de zon in een paar minuten zakken: geen uitval, ook niet bij een hoge spanning', () => {
    const w = spanningWacht();
    const wolk = MIDDAG + 12 * 60_000;
    const zonW = (nu) => (nu < wolk ? 3000 : Math.max(120, 3000 - ((nu - wolk) / 120_000) * 2900));
    expect(draai(w, { van: MIDDAG, tot: wolk + 5 * 60_000, bron: () => spanningenUit(dirk({ zon: 254 })), zonW })).toEqual([]);
  });

  it('de GoodWe meldt zelf een netspanningsfout (bit 17): uitval, ook als de P1 het niet zo hoog zag; één keer', () => {
    const w = spanningWacht();
    const fout = MIDDAG + 5 * 60_000;
    const bron = () => spanningenUit({ meting: { fasen: [{ fase: 1, v: 236 }, { fase: 2, v: 238 }, { fase: 3, v: 235 }] } });
    const zinnen = draai(w, { van: MIDDAG, tot: fout + 3 * 60_000, bron, zonW: (nu) => (nu < fout ? 4000 : 0), storingen: (nu) => (nu >= fout ? [17] : []) });
    expect(zinnen).toHaveLength(1);
    expect(zinnen[0]).toMatch(/uit bij hoge netspanning \(melding van de omvormer\): L2 238 V/);
  });

  it('het programmaatje begrensde zelf: geen uitval', () => {
    const w = spanningWacht();
    const val = MIDDAG + 12 * 60_000;
    expect(draai(w, { van: MIDDAG, tot: val + 60_000, bron: () => spanningenUit(dirk({ zon: 255 })), zonW: (nu) => (nu < val ? 3000 : 0), zelfBegrensd: true })).toEqual([]);
  });
});

describe('dicht bij de grens, de hoogste van vandaag en het verschil tussen de meters', () => {
  it('drie keer boven 250 V zonder uitval; de hoogste per fase; het grootste verschil zon min spa', () => {
    const w = spanningWacht();
    let nu = MIDDAG;
    for (let keer = 0; keer < 3; keer += 1) {
      draai(w, { van: nu, tot: nu + 60_000, bron: () => spanningenUit(dirk({ zon: 251.5, spa: [248.4, 247, 246] })) });
      nu += 60_000;
      draai(w, { van: nu, tot: nu + DICHTBIJ_WEG_MS + 10_000, bron: () => spanningenUit(dirk({ zon: 241, spa: [239, 240, 238] })) });
      nu += DICHTBIJ_WEG_MS + 10_000;
    }
    const blok = w.voorApp(nu);
    expect(blok).toMatchObject({ boven_250_vandaag: 3, boven_250_uitgevallen: 0, uitval_vandaag: 0 });
    expect(blok.hoogste).toEqual([
      expect.objectContaining({ sleutel: 'L1', v: 248.4 }),
      expect.objectContaining({ sleutel: 'L2', v: 247 }),
      expect.objectContaining({ sleutel: 'L3', v: 246 }),
      expect.objectContaining({ sleutel: 'zon', v: 251.5 }),
    ]);
    expect(blok.verschil.find((x) => x.sleutel === 'L1').v).toBe(3.1);
    expect(blok.herkomst).toEqual([
      { sleutel: 'L1', bron: 'meter', naam: 'Spa' },
      { sleutel: 'L2', bron: 'meter', naam: 'Spa' },
      { sleutel: 'L3', bron: 'meter', naam: 'Spa' },
      { sleutel: 'zon', bron: 'zon', naam: 'Zonnepanelen' },
    ]);
  });

  it('twee driefase meters: per fase het verschil (L1 zon − L1 spa, enz.), per dag het grootste, met de naam; geen zonnefase', () => {
    const w = spanningWacht();
    draai(w, { van: MIDDAG, tot: MIDDAG + 60_000, bron: () => spanningenUit(dirkDriefase({ zon: [244, 243, 241], spa: [240, 241, 240] })) });
    draai(w, { van: MIDDAG + 60_000, tot: MIDDAG + 120_000, bron: () => spanningenUit(dirkDriefase({ zon: [246.5, 242, 241], spa: [240, 241, 240] })) });
    const blok = w.voorApp(MIDDAG + 120_000);
    expect(blok.verschil.map((x) => [x.sleutel, x.v])).toEqual([['L1', 6.5], ['L2', 2], ['L3', 1]]);
    expect(blok.verschil_met).toBe('Spa');
    expect(blok.herkomst).toEqual([
      { sleutel: 'L1', bron: 'zon', naam: 'Zonnepanelen' },
      { sleutel: 'L2', bron: 'zon', naam: 'Zonnepanelen' },
      { sleutel: 'L3', bron: 'zon', naam: 'Zonnepanelen' },
    ]);
    expect(blok.hoogste.map((h) => h.sleutel)).toEqual(['L1', 'L2', 'L3']);
  });

  it('twee driefase meters: de uitval-regel noemt het verschil per fase met de spa-meter', () => {
    const w = spanningWacht();
    const uitval = MIDDAG + 12 * 60_000;
    const zinnen = draai(w, {
      van: MIDDAG,
      tot: uitval + 60_000,
      bron: () => spanningenUit(dirkDriefase({ zon: [255, 249, 247], spa: [249, 248, 247] })),
      zonW: (nu) => (nu < uitval ? 3000 : 0),
    });
    expect(zinnen).toEqual(['Omvormer viel om 13:12 uit bij hoge netspanning: L1 255 V (10 min gem. 255 V); verschil met Spa L1 +6, L2 +1, L3 0 V. Meld het bij de netbeheerder.']);
    expect(zinnen[0].length).toBeLessThanOrEqual(160);
  });

  it('bewaart wat een herstart moet overleven (tellers, hoogste, lijst) en neemt het weer op', () => {
    let bewaard = null;
    const w = spanningWacht({ bewaar: (x) => (bewaard = x) });
    draai(w, { van: MIDDAG, tot: MIDDAG + 30_000, bron: () => spanningenUit(dirk({ zon: 249 })) });
    const opnieuw = spanningWacht({ opgeslagen: JSON.parse(JSON.stringify(bewaard)) });
    expect(opnieuw.voorApp(MIDDAG + 30_000).hoogste.find((h) => h.sleutel === 'zon').v).toBe(249);
  });
});
