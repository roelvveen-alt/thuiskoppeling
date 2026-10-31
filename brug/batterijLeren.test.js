/**
 * De batterij leren kennen (1.4.0, batterijLeren.mjs): hoeveel kWh er echt uit of in gaat per procent.
 */
import { describe, expect, it } from 'vitest';
import { controleerMeting } from '../base44/functions/ontvangMeting/controle.js';
import { controleerMeting as controleerLive } from '../base44/tests/oudeFunctie/controle.js';
import { batterijRegels, eigenSchatting } from '../src/lib/batterijGegevens.js';
import { batterijInfoUit } from '../src/lib/bron.js';
import { GAT_MS, maakBatterijLeren } from './batterijLeren.mjs';

const T0 = Date.UTC(2026, 9, 31, 18);

/**
 * Laat de batterij `w` watt leveren (positief) of laden (negatief) tot hij `tot` procent is, elke 5 s
 * een meting; `kwhPerPct` is hoeveel kWh er echt per procent uit of in gaat. Geeft de nieuwe tijd.
 */
function draai(leer, { van, tot, w, kwhPerPct, t = T0, zinnen = [] }) {
  let pct = van;
  let nu = t;
  while (w > 0 ? pct > tot : pct < tot) {
    const zin = leer.ronde({ batterij_w: w, batterij_procent: Math.round(pct) }, nu);
    if (zin) zinnen.push(zin);
    nu += 5000;
    const energie = (Math.abs(w) * 5000) / 3_600_000 / 1000;
    pct += (w > 0 ? -1 : 1) * (energie / kwhPerPct);
  }
  return nu;
}

describe('batterijLeren', () => {
  it('leveren: na 10% een meting dicht bij wat er echt uitkwam; het gemiddelde glijdt mee', () => {
    const leer = maakBatterijLeren();
    expect(leer.voorApp()).toBeNull();
    const zinnen = [];
    // 3 accu's van 2,88 kWh met verlies: 0,0816 kWh per procent eruit (8,16 kWh voor 100%).
    draai(leer, { van: 80, tot: 39, w: 800, kwhPerPct: 0.0816, zinnen });
    const g = leer.voorApp();
    expect(g.metingen).toBeGreaterThanOrEqual(3);
    expect(g.kwh_per_pct_leveren).toBeGreaterThan(0.0816 * 0.9);
    expect(g.kwh_per_pct_leveren).toBeLessThan(0.0816 * 1.1);
    expect(g).not.toHaveProperty('kwh_per_pct_laden');
    expect(zinnen[0]).toMatch(/^Batterij geleerd \(leveren\): \d+ Wh per procent/);
  });

  it('laden apart; een andere richting, een gat of stilstand-alleen telt niet als meting', () => {
    const leer = maakBatterijLeren();
    let t = draai(leer, { van: 20, tot: 45, w: -1500, kwhPerPct: 0.095 });
    expect(leer.voorApp().kwh_per_pct_laden).toBeCloseTo(0.095, 1);
    expect(leer.voorApp()).not.toHaveProperty('kwh_per_pct_leveren');
    // Steeds wisselen (minder dan 10% per richting): niets nieuws.
    const voor = leer.voorApp().metingen;
    for (let i = 0; i < 20; i++) {
      t = draai(leer, { van: 50, tot: 47, w: 900, kwhPerPct: 0.08, t });
      t = draai(leer, { van: 47, tot: 50, w: -900, kwhPerPct: 0.08, t });
    }
    expect(leer.voorApp().metingen).toBe(voor);
    // Een gat in de metingen: de energie ertussen kennen we niet, dus opnieuw beginnen.
    const gat = maakBatterijLeren();
    gat.ronde({ batterij_w: 800, batterij_procent: 80 }, T0);
    gat.ronde({ batterij_w: 800, batterij_procent: 80 }, T0 + 5000);
    gat.ronde({ batterij_w: 800, batterij_procent: 60 }, T0 + 5000 + GAT_MS + 1);
    expect(gat.voorApp()).toBeNull();
    // Geen batterij (of geen procent): niets, en geen fout.
    expect(gat.ronde({ batterij_w: null, batterij_procent: null }, T0)).toBeNull();
  });

  it('wat niet kan (een sprong zonder energie) telt niet; bewaren en weer laden', () => {
    const leer = maakBatterijLeren();
    leer.ronde({ batterij_w: 30, batterij_procent: 90 }, T0);
    leer.ronde({ batterij_w: 30, batterij_procent: 90 }, T0 + 5000);
    // In 5 s 20% zakken met 30 W: 0,00002 kWh per procent, kan niet.
    leer.ronde({ batterij_w: 30, batterij_procent: 70 }, T0 + 10_000);
    expect(leer.voorApp()).toBeNull();
    draai(leer, { van: 70, tot: 55, w: 1200, kwhPerPct: 0.0816, t: T0 + 15_000 });
    const opnieuw = maakBatterijLeren({ staat: JSON.parse(JSON.stringify(leer.bewaar())) });
    expect(opnieuw.voorApp()).toEqual(leer.voorApp());
    expect(maakBatterijLeren({ staat: { leveren: { kwh_per_pct: 99, n: 3 }, laden: 'kapot' } }).voorApp()).toBeNull();
  });
});

describe('batterij_info.geleerd in de app', () => {
  const info = { inhoud_kwh: 8.64, ontlaadgrens_pct: 5, laadgrens_pct: 100, leeg_over_min: 140, accus: [{ nr: 1, temp_c: 31 }] };
  const geleerd = { kwh_per_pct_leveren: 0.06, kwh_per_pct_laden: 0.1, metingen: 7 };

  it('de functie neemt het mild aan; de functie die nu live staat laat het stil vallen', () => {
    const nu = new Date('2026-10-31T18:00:00Z');
    const uit = controleerMeting({ net_w: 1, batterij_info: { ...info, geleerd } }, nu);
    expect(uit.meting.batterij_info.geleerd).toEqual(geleerd);
    const raar = controleerMeting({ net_w: 1, batterij_info: { ...info, geleerd: { kwh_per_pct_leveren: 5, kwh_per_pct_laden: 0.1, metingen: 'veel' } } }, nu);
    expect(raar.meting.batterij_info.geleerd).toEqual({ kwh_per_pct_laden: 0.1, metingen: 1 });
    expect(controleerMeting({ net_w: 1, batterij_info: { ...info, geleerd: { kwh_per_pct_leveren: -1 } } }, nu).meting.batterij_info).not.toHaveProperty('geleerd');
    const live = controleerLive({ net_w: 1, batterij_info: { ...info, geleerd } }, nu);
    expect(live.ok).toBe(true);
    expect(live.meting.batterij_info).not.toHaveProperty('geleerd');
    expect(batterijInfoUit({ ...info, geleerd }).geleerd).toEqual(geleerd);
  });

  it('eigenSchatting rekent met wat het leerde, en de regel zegt dat', () => {
    // 10% → 5% bij 344 W leveren: 5 × 0,06 kWh = 0,3 kWh, dus 52 minuten.
    expect(eigenSchatting({ ...info, geleerd }, 344, 10)).toEqual({ min: 52, laden: false, grens: 5, geleerd: true });
    // Laden van 90% tot 100% met 2000 W: 10 × 0,1 kWh = 1 kWh, 30 minuten.
    expect(eigenSchatting({ ...info, geleerd }, -2000, 90)).toEqual({ min: 30, laden: true, grens: 100, geleerd: true });
    // Alleen leveren geleerd: laden zoals eerst.
    expect(eigenSchatting({ ...info, geleerd: { kwh_per_pct_leveren: 0.06, metingen: 2 } }, -2000, 90).geleerd).toBe(false);
    // Zonder inhoud maar wel geleerd: toch een schatting.
    expect(eigenSchatting({ ontlaadgrens_pct: 5, geleerd }, 344, 10).min).toBe(52);
    const tijd = batterijRegels({ ...info, geleerd }, { batterijW: 344, procent: 10 }).find((r) => r.sleutel === 'tijd');
    expect(tijd.bij).toMatch(/^geleerd van jouw batterij, tot je ingestelde grens · de Zendure zegt/);
    const zonder = batterijRegels(info, { batterijW: 344, procent: 10 }).find((r) => r.sleutel === 'tijd');
    expect(zonder.bij).toMatch(/^eigen schatting, tot je ingestelde grens en met verlies/);
  });
});
