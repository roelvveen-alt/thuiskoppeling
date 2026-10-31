import { describe, expect, it } from 'vitest';
import { batterijRegels, duur, graden, ouderDan, rendementRegel, wifiKwaliteit } from './batterijGegevens';
import { batterijInfoUit, standUitRij } from './bron';

/** Met gewone spaties en een gewoon min-teken: makkelijker te lezen in een test. */
const gewoon = (tekst) => tekst.replace(/\u00a0/g, ' ').replace(/\u2212/g, '-');
const zinnen = (info, opties) => batterijRegels(info, opties).map((r) => ({ ...r, tekst: gewoon(r.tekst), ...(r.bij ? { bij: gewoon(r.bij) } : {}) }));

/** Zoals de brug het stuurt bij een 2400 AC met twee accu's die 's nachts laadt (brug/zendure.test.js). */
const LADEN = {
  temp_c: 25.5,
  temp_min_c: 23,
  behuizing_c: 40,
  spanning_v: 52.4,
  stroom_a: 42.2,
  laadgrens_pct: 100,
  ontlaadgrens_pct: 10,
  pakketten: 2,
  inhoud_kwh: 5.76,
  vol_over_min: 130,
  verwarmt: false,
  kalibreert: false,
  wifi_dbm: -58,
  storing: false,
};

describe('batterij_info lezen (bron.js)', () => {
  it('neemt bekende velden met een echt getal of ja/nee over, de rest niet', () => {
    expect(batterijInfoUit(LADEN)).toEqual(LADEN);
    expect(batterijInfoUit({ temp_c: '25', verwarmt: 1, sn: 'FO4N', wifi_dbm: Number.NaN, leeg_over_min: 300 })).toEqual({ leeg_over_min: 300 });
    for (const rommel of [null, undefined, 'warm', 12, [LADEN], {}, { onbekend: true }]) expect(batterijInfoUit(rommel)).toBeNull();
  });

  it('een stand zonder batterij_info (oudere brug, of de functie nog niet bijgewerkt) kan gewoon', () => {
    expect(standUitRij({ moment: '2026-10-30T09:00:00Z', batterij_w: -2300 }).batterij_info).toBeNull();
    expect(standUitRij({ batterij_info: LADEN }).batterij_info).toEqual(LADEN);
  });
});

describe('in gewone woorden', () => {
  it('een 2400 AC die laadt', () => {
    expect(zinnen(LADEN)).toEqual([
      { sleutel: 'temperatuur', tekst: "Temperatuur accu's 23–26 °C", bij: 'binnenin de Zendure 40 °C' },
      { sleutel: 'elektrisch', tekst: 'Spanning 52,4 V', bij: 'stroom 42,2 A' },
      { sleutel: 'grenzen', tekst: 'Laadt tot 100% · ontlaadt tot 10%' },
      { sleutel: 'tijd', tekst: 'Vol over ongeveer 2 uur 10 min', bij: 'schatting van de Zendure, bij het vermogen van nu' },
      { sleutel: 'wifi', tekst: 'Wifi-signaal goed (-58 dBm)' },
      { sleutel: 'accus', tekst: "2 accu's · samen 5,76 kWh" },
    ]);
  });

  it('per accu een regel (brug 0.7.0), drie zoals bij Tim en Dirk; de temperatuur staat dan daar', () => {
    const info = batterijInfoUit({
      ...LADEN,
      pakketten: 3,
      accus: [
        { nr: 2, temp_c: 25.5, procent: 40 },
        { nr: 1, temp_c: 23, procent: 41 },
        { nr: 3, temp_c: 22.4, procent: 'veel' },
        { nr: 3, temp_c: 99 },
        { nr: 'vier', temp_c: 20 },
      ],
    });
    expect(info.accus).toEqual([
      { nr: 1, temp_c: 23, procent: 41 },
      { nr: 2, temp_c: 25.5, procent: 40 },
      { nr: 3, temp_c: 22.4, procent: null },
    ]);
    expect(zinnen(info).slice(0, 4)).toEqual([
      { sleutel: 'temperatuur', tekst: 'Binnenin de Zendure 40 °C' },
      { sleutel: 'accu-1', tekst: 'Accu 1 · 23 °C · 41%', procent: 41 },
      { sleutel: 'accu-2', tekst: 'Accu 2 · 26 °C · 40%', procent: 40 },
      { sleutel: 'accu-3', tekst: 'Accu 3 · 22 °C' },
    ]);
    // Zonder binnenin, en alleen procenten: dan blijft de gewone temperatuur staan.
    expect(zinnen({ accus: [{ nr: 1, temp_c: 24 }] })).toEqual([{ sleutel: 'accu-1', tekst: 'Accu 1 · 24 °C' }]);
    expect(zinnen({ temp_c: 24, accus: [{ nr: 1, procent: 50 }] })).toEqual([
      { sleutel: 'temperatuur', tekst: 'Temperatuur 24 °C' },
      { sleutel: 'accu-1', tekst: 'Accu 1 · 50%', procent: 50 },
    ]);
    // Een oudere brug of functie: geen accus, en alles zoals vroeger.
    expect(batterijInfoUit(LADEN)).not.toHaveProperty('accus');
  });

  it('één accu, leveren, en wat er bij kou of bij een storing gebeurt', () => {
    expect(
      zinnen({ temp_c: 4.4, spanning_v: 51.2, leeg_over_min: 300, verwarmt: true, kalibreert: true, pakketten: 1, gezondheid_pct: 99.6, storing: true, storing_niveau: 2, wifi_dbm: -77 }),
    ).toEqual([
      { sleutel: 'storing', tekst: 'De batterij meldt een storing', bij: 'niveau 2 · kijk in de Zendure-app', letOp: true },
      { sleutel: 'temperatuur', tekst: 'Temperatuur 4 °C' },
      { sleutel: 'elektrisch', tekst: 'Spanning 51,2 V' },
      { sleutel: 'tijd', tekst: 'Leeg over ongeveer 5 uur', bij: 'schatting van de Zendure, bij het vermogen van nu' },
      { sleutel: 'verwarmt', tekst: 'Verwarmt zichzelf nu', bij: "bij kou warmt hij zijn accu's op" },
      { sleutel: 'kalibreert', tekst: 'Kalibreert nu zijn batterijstand', bij: 'hij stelt opnieuw vast hoe vol hij is' },
      { sleutel: 'wifi', tekst: 'Wifi-signaal zwak (-77 dBm)' },
      { sleutel: 'accus', tekst: '1 accu', bij: 'gezondheid 99,6%' },
    ]);
  });

  it('alleen wat er is: twee accu’s even warm, alleen binnenin, alleen een ontlaadgrens, alleen gezondheid', () => {
    expect(zinnen({ temp_c: 21.2, temp_min_c: 20.9 })[0].tekst).toBe('Temperatuur 21 °C');
    expect(zinnen({ behuizing_c: -2.6 })).toEqual([{ sleutel: 'temperatuur', tekst: 'Binnenin de Zendure -3 °C' }]);
    expect(zinnen({ ontlaadgrens_pct: 10, stroom_a: 0 })).toEqual([{ sleutel: 'grenzen', tekst: 'Ontlaadt tot 10%' }]);
    expect(zinnen({ stroom_a: 3.4 })).toEqual([{ sleutel: 'elektrisch', tekst: 'Stroom 3,4 A' }]);
    expect(zinnen({ gezondheid_pct: 100 })).toEqual([{ sleutel: 'accus', tekst: 'Gezondheid 100%' }]);
    // Gewoon (verwarmt niet, geen storing) zegt niets.
    expect(zinnen({ verwarmt: false, kalibreert: false, storing: false })).toEqual([]);
    expect(batterijRegels(null)).toEqual([]);
  });

  it('nooit een temperatuurgrens: daarvoor geeft Zendure voor de 2400 AC niets op (geen let-op bij hitte of kou)', () => {
    for (const temp_c of [-25, 0, 70]) expect(batterijRegels({ temp_c }).some((r) => r.letOp)).toBe(false);
  });

  it('hoe lang nog, afgerond zoals je het zegt (zelfde als de brug)', () => {
    expect(gewoon(duur(7))).toBe('ongeveer 7 min');
    expect(gewoon(duur(47))).toBe('ongeveer 45 min');
    expect(gewoon(duur(58))).toBe('ongeveer 1 uur');
    expect(gewoon(duur(92))).toBe('ongeveer 1 uur 30 min');
    expect(gewoon(duur(299))).toBe('ongeveer 5 uur');
    expect(gewoon(duur(490))).toBe('ongeveer 8 uur');
    expect(duur(2880)).toBe('meer dan twee dagen');
    expect(duur(0)).toBe('');
  });

  it('graden, wifi en versies', () => {
    expect(gewoon(graden(23.6))).toBe('24 °C');
    expect(gewoon(graden(-0.4))).toBe('0 °C');
    expect([-50, -60, -61, -70, -75, -81].map(wifiKwaliteit)).toEqual(['goed', 'goed', 'redelijk', 'redelijk', 'zwak', 'slecht']);
    expect(ouderDan('0.4.0', '0.5.0')).toBe(true);
    expect(ouderDan('0.5.0', '0.5.0')).toBe(false);
    expect(ouderDan('0.10.1', '0.5.0')).toBe(false);
    expect(ouderDan(null, '0.5.0')).toBe(false);
    expect(ouderDan('proef', '0.5.0')).toBe(false);
  });
});

describe('het verwachte rendement nu', () => {
  it('met de koudste accu als maat (Tims getallen)', () => {
    expect(rendementRegel({ accus: [{ nr: 1, temp_c: 27 }, { nr: 2, temp_c: 29 }] })).toEqual([
      { sleutel: 'rendement', tekst: 'Verwacht rendement nu: 94%', bij: 'laden en weer leveren · koudste accu 27\u00a0°C' },
    ]);
    expect(rendementRegel({ temp_c: 12, temp_min_c: 10 })[0].tekst).toBe('Verwacht rendement nu: 89%');
  });

  it('onder 0 °C: dat hij dan niet laadt', () => {
    expect(rendementRegel({ accus: [{ nr: 1, temp_c: -2 }] })[0].bij).toMatch(/onder 0 °C laadt hij niet/);
  });

  it('zonder temperatuur een vaste schatting, en dat erbij; zonder gegevens niets', () => {
    expect(rendementRegel({ laadgrens_pct: 100 })).toEqual([
      { sleutel: 'rendement', tekst: 'Verwacht rendement ongeveer 92%', bij: "laden en weer leveren · een vaste schatting: de accu's melden geen temperatuur" },
    ]);
    expect(rendementRegel(null)).toEqual([]);
  });
});

describe('eigen schatting: hoe lang nog tot de grens (Tim: de Zendure is te positief)', () => {
  // Zoals bij Tim om 08:01 (31-10-2026): 10%, 344 W leveren, ontlaadt tot 5%, 8,64 kWh, koudste accu 31 °C.
  const info = { inhoud_kwh: 8.64, ontlaadgrens_pct: 5, laadgrens_pct: 100, leeg_over_min: 140, accus: [{ nr: 1, temp_c: 31 }] };
  it('leveren: alleen wat er boven de ontlaadgrens zit, met verlies', async () => {
    const { eigenSchatting } = await import('./batterijGegevens');
    const s = eigenSchatting(info, 344, 10);
    expect(s.laden).toBe(false);
    expect(s.grens).toBe(5);
    // 5% van 8,64 kWh = 0,43 kWh, maal ~0,97 verlies, bij 344 W: ruim een uur, niet de 2 uur 20 van de Zendure.
    expect(s.min).toBeGreaterThan(60);
    expect(s.min).toBeLessThan(80);
  });
  it('de regel noemt de eigen schatting en wat de Zendure zegt', () => {
    const r = zinnen(info, { batterijW: 344, procent: 10 }).find((x) => x.sleutel === 'tijd');
    expect(r.tekst).toMatch(/^Bij 344\sW leveren: op 5% over ongeveer 1 uur/u);
    expect(r.bij).toMatch(/eigen schatting.*de Zendure zegt leeg over ongeveer 2 uur 20 min/u);
  });
  it('zonder stand of grens: zoals eerst, de schatting van de Zendure', () => {
    const r = zinnen(info, { batterijW: 344 }).find((x) => x.sleutel === 'tijd');
    expect(r.bij).toBe('schatting van de Zendure, bij het vermogen van nu');
  });
});
