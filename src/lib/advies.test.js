import { describe, expect, it } from 'vitest';
import {
  batterijVoorAdvies,
  capaciteitBijTemperatuur,
  HANDEL_DREMPEL_EUR,
  klok,
  koudsteAccu,
  leerHuis,
  maakAdvies,
  momentTekst,
  prijzenPerUur,
  rekenDoor,
  rekenHandel,
  rendementNu,
  STANDAARD_HUIS,
  uurVan,
  verliesBijTemperatuur,
} from './advies';
import { dagenUit } from './periode';

const UUR = 3_600_000;
/** Middernacht van vrijdag 6 november 2026 in Nederland (wintertijd: 23:00 UTC de dag ervoor). */
const NACHT = Date.parse('2026-11-05T23:00:00Z');
/** Vrijdag 10:15. */
const NU = NACHT + 10.25 * UUR;

/** Een huis zoals dat van Tim: 's nachts weinig, 's avonds het meest. */
const huisUur = (h) => (h < 6 ? 250 : h < 8 ? 700 : h < 17 ? 450 : h < 21 ? 1400 : 600);
const zonUur = (h, piek) => (h >= 8 && h <= 16 ? Math.round(piek * Math.sin((Math.PI * (h - 7.5)) / 9.5)) : 0);

/** Een dag uit 'periode' zoals de server hem geeft (Dag-rij), met per uur huis en zon. */
const dagRij = (datum, piek, { zon = true } = {}) => ({
  datum,
  huis_kwh: 14,
  zon_kwh: 10,
  kwartieren: 96,
  huis_uur_wh: Array.from({ length: 24 }, (_, h) => huisUur(h)),
  ...(zon ? { zon_uur_wh: Array.from({ length: 24 }, (_, h) => zonUur(h, piek)) } : {}),
  uur_kwartieren: Array(24).fill(4),
});
const WEEK = ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'];
const dagen = (piek, aantal = 7, opties) => dagenUit(WEEK.slice(7 - aantal).map((d) => dagRij(d, piek, opties)));

/** Gewoon 0,25; 12–15 uur goedkoop (0,15), 17–20 uur duur (0,40). Teruglevering twee cent minder. */
const prijs = (h) => (h >= 12 && h < 15 ? 0.15 : h >= 17 && h < 20 ? 0.4 : 0.25);
const voorspelling = (f = prijs, kwartieren = 192) => ({
  van: NACHT,
  stapMs: 15 * 60_000,
  afname: Array.from({ length: kwartieren }, (_, i) => f(Math.floor(i / 4) % 24)),
  terug: Array.from({ length: kwartieren }, (_, i) => f(Math.floor(i / 4) % 24) - 0.02),
  bonus: Array(kwartieren).fill(0),
});

const ZENDURE = { inhoud_kwh: 8.64, ontlaadgrens_pct: 10, laadgrens_pct: 100, pakketten: 3 };
const stand = (over = {}) => ({ batterij_procent: 30, batterij_info: ZENDURE, voorspelling: voorspelling(), zon_w: 300, zonnen: [], dag: null, ...over });

describe('de klok in Nederland', () => {
  it('uren en kloktijden in Nederlandse tijd, ook als de computer elders staat', () => {
    expect(uurVan(NACHT)).toBe(0);
    expect(uurVan(NU)).toBe(10);
    expect(klok(NACHT + 13 * UUR)).toBe('13:00');
  });
});

describe('leren van het huis', () => {
  it('zonder geschiedenis: een gewone dag van 8 kWh, en geen zon', () => {
    const g = leerHuis({ dagen: [], nu: NU });
    expect(g.dagen).toBe(0);
    expect(g.huisW.reduce((a, b) => a + b, 0)).toBeCloseTo(8000, 0);
    expect(g.zonW.every((w) => w === 0)).toBe(true);
    expect(g.metPanelen).toBe(false);
  });

  it('per uur het gemiddelde van de dagen, met één gewone dag erbij (voorzichtig)', () => {
    const g = leerHuis({ dagen: dagen(3000), nu: NU });
    expect(g.dagen).toBe(7);
    // 18:00: zeven dagen 1.400 W en één gewone dag van 14 kWh (dagtotaal van dit huis).
    expect(g.huisW[18]).toBeCloseTo((7 * 1400 + STANDAARD_HUIS[18] * 14_000) / 8, 3);
    expect(g.zonW[12]).toBe(zonUur(12, 3000));
    expect(g.metPanelen).toBe(true);
  });

  it('met één dag telt die voor de helft; de gewone dag krijgt de maat van de dagtotalen', () => {
    const g = leerHuis({ dagen: dagen(3000, 1), nu: NU });
    expect(g.dagen).toBe(1);
    expect(g.huisW[3]).toBeCloseTo((250 + STANDAARD_HUIS[3] * 14_000) / 2, 3);
  });

  it('dagen van vóór de uren (alleen totalen) tellen alleen voor de maat', () => {
    const oud = dagenUit([{ datum: '2026-10-30', huis_kwh: 20, kwartieren: 96 }]);
    const g = leerHuis({ dagen: oud, nu: NU });
    expect(g.dagen).toBe(0);
    expect(g.huisKwhDag).toBe(20);
  });

  it('een uur dat maar een kwartier gemeten is, telt niet; vandaag en later tellen niet als geschiedenis', () => {
    const rij = dagRij('2026-11-05', 3000);
    rij.uur_kwartieren = rij.uur_kwartieren.map((k, h) => (h === 18 ? 1 : k));
    const g = leerHuis({ dagen: dagenUit([rij, dagRij('2026-11-06', 3000)]), nu: NU });
    expect(g.dagen).toBe(1);
    expect(g.huisW[18]).toBeCloseTo(STANDAARD_HUIS[18] * 14_000, 3);
  });

  it('vandaag minder zon dan gewoonlijk: de rest van vandaag ook minder', () => {
    // Vandaag per kwartier tot 10:15, met een kwart van de gewone zon.
    const kwartieren = 41;
    const dag = {
      van: NACHT,
      stapMs: 15 * 60_000,
      metingen: Array(kwartieren).fill(10),
      huis: Array.from({ length: kwartieren }, (_, i) => huisUur(Math.floor(i / 4))),
      zon: Array.from({ length: kwartieren }, (_, i) => zonUur(Math.floor(i / 4), 3000) / 4),
    };
    const g = leerHuis({ dagen: dagen(3000), dag, nu: NU });
    expect(g.vandaagTelt).toBe(true);
    expect(g.zonVandaag).toBeCloseTo(0.25, 2);
    const a = maakAdvies({ stand: stand({ dag }), dagen: dagen(3000), nu: NU });
    expect(a.uren.find((u) => u.uur === 12).zonW).toBe(Math.round(zonUur(12, 3000) * 0.25));
    // Morgen weer gewoon.
    expect(a.uren.find((u) => u.uur === 9).zonW).toBe(zonUur(9, 3000));
    expect(a.toelichting.join(' ')).toMatch(/minder zon dan gewoonlijk/);
  });
});

describe('prijzen per uur en de batterij', () => {
  it('per uur het gemiddelde van de kwartieren; voorbij de prijzen null', () => {
    const p = prijzenPerUur(voorspelling(prijs, 96), NACHT + 10 * UUR);
    expect(p[2]).toEqual({ afname: 0.15, terug: 0.13 });
    expect(p[13]).toEqual({ afname: 0.25, terug: 0.23 });
    expect(p[14]).toBeNull();
    expect(prijzenPerUur(null, NACHT)[0]).toBeNull();
  });

  it('de batterij: wat erin zit en tussen welke grenzen; zonder inhoud geschat op de accu’s', () => {
    const b = batterijVoorAdvies(stand());
    expect(b).toMatchObject({ inhoud: 8.64, geschat: false });
    expect(b.max).toBeCloseTo(8.64, 6);
    expect(b.min).toBeCloseTo(0.864, 6);
    expect(b.kwh).toBeCloseTo(2.592, 6);
    expect(batterijVoorAdvies(stand({ batterij_info: { pakketten: 2 } }))).toMatchObject({ inhoud: 5.76, geschat: true });
    expect(batterijVoorAdvies(stand({ batterij_procent: null }))).toBeNull();
  });

  it('doorrekenen: zon over gaat eerst in de batterij, tekort komt er eerst uit, nooit buiten de grenzen', () => {
    const uren = [
      { huisW: 500, zonW: 3500, deel: 1, prijs: { afname: 0.2, terug: 0.18 } },
      { huisW: 3000, zonW: 0, deel: 1, prijs: { afname: 0.4, terug: 0.38 } },
    ];
    const heen = Math.sqrt(0.94);
    const r = rekenDoor({ uren, batterij: { kwh: 8, min: 0.864, max: 8.64, inhoud: 8.64, heen } });
    // Uur 1: 3.000 W over, de batterij kan nog 640 Wh (en verliest de helft van 6% bij laden), de rest naar het net.
    expect(r.stappen[0].kwh).toBeCloseTo(8.64, 6);
    expect(r.stappen[0].netW).toBeCloseTo(-(3000 - 640 / heen), 3);
    // Uur 2: hooguit 2.400 W uit de batterij, de rest uit het net.
    expect(r.stappen[1].batterijW).toBe(2400);
    expect(r.stappen[1].netW).toBeCloseTo(600, 6);
  });
});

describe('het advies', () => {
  it('een zonnige dag: een goed moment bij de zon en liever niet ’s avonds, in gewone woorden, zonder de batterij', () => {
    const a = maakAdvies({ stand: stand(), dagen: dagen(4000), nu: NU });
    expect(a.regels).toEqual([
      { soort: 'goed', kop: 'Goed moment', tekst: 'Vandaag tussen 12 en 15 uur: goed om stroom te gebruiken, zoals wassen, vaatwasser of drogen.' },
      { soort: 'liever', kop: 'Liever niet', tekst: 'Vandaag tussen 17 en 20 uur.' },
    ]);
    expect(a.beste.tijd).toBe('12:00–15:00');
    expect(a.zinnen.join(' ')).not.toMatch(/batterij|kWh|€/);
    expect(a.uren).toHaveLength(24);
    expect(a.uren.find((u) => u.uur === 13).soort).toBe('gunstig');
    expect(a.uren.find((u) => u.uur === 18).soort).toBe('duur');
    expect(a.eenheid).toBe('euro');
    expect(a.zekerheid).toBe('goed');
    expect(a.leertNog).toBe(false);
  });

  it('de tijdlijn zegt hetzelfde als de regels: het goede blok groen, liever niet oranje', () => {
    for (const piek of [500, 1500, 4000]) {
      const a = maakAdvies({ stand: stand(), dagen: dagen(piek), nu: NU });
      if (a.beste) for (let k = a.beste.eerste; k <= a.beste.laatste; k++) expect(a.uren[k].soort).toBe('gunstig');
      if (a.slechtste) for (let k = a.slechtste.eerste; k <= a.slechtste.laatste; k++) expect(a.uren[k].soort).toBe('duur');
    }
  });

  it('een grijze dag: de goedkope middag is geen goed moment (die stroom mist de batterij ’s avonds), en nog steeds niets over de batterij', () => {
    const a = maakAdvies({ stand: stand(), dagen: dagen(500), nu: NU });
    expect(a.slechtste.tijd).toBe('17:00–20:00');
    expect(a.beste.tijd).not.toBe('12:00–15:00');
    expect(a.zinnen.join(' ')).not.toMatch(/batterij/);
  });

  it('een volle batterij: zon over is dan het goedkoopst', () => {
    const a = maakAdvies({ stand: stand({ batterij_procent: 100 }), dagen: dagen(4000), nu: NU });
    expect(a.beste.tijd).toBe('12:00–15:00');
  });

  it('een negatieve prijs in het goede moment: dan krijg je zelfs geld toe', () => {
    const negatief = (h) => (h >= 12 && h < 15 ? -0.05 : prijs(h));
    const a = maakAdvies({ stand: stand({ voorspelling: voorspelling(negatief) }), dagen: dagen(4000), nu: NU });
    expect(a.regels[0].tekst).toBe('Vandaag tussen 12 en 15 uur: goed om stroom te gebruiken, zoals wassen, vaatwasser of drogen. Je krijgt dan zelfs geld toe.');
  });

  it('geen prijs: advies op de zon, en dat staat in de details', () => {
    const a = maakAdvies({ stand: stand({ voorspelling: null, batterij_procent: 50 }), dagen: dagen(3000), nu: NU });
    expect(a.eenheid).toBe('kwh');
    expect(a.regels[0].soort).toBe('goed');
    expect(a.toelichting).toContain('Nog geen stroomprijzen: dit advies gaat alleen over de zon en je verbruik.');
    expect(a.uren.every((u) => u.prijs === null)).toBe(true);
  });

  it('prijzen alleen tot middernacht (voor 13:00): morgen met het gemiddelde, en dat staat erbij', () => {
    const a = maakAdvies({ stand: stand({ voorspelling: voorspelling(prijs, 96) }), dagen: dagen(4000), nu: NU });
    expect(a.toelichting.join(' ')).toMatch(/prijzen van morgen komen rond 13:00/);
  });

  it('geen weer (geen programmaatje stuurt het nog): de zon van de laatste dagen, en dat staat erbij', () => {
    const a = maakAdvies({ stand: stand({ brug: { versie: '0.6.1' } }), dagen: dagen(3000), nu: NU });
    expect(a.zonBron).toBe('dagen');
    expect(a.toelichting).toContain('Het weer zit er nog niet in: de zon is geschat op de laatste dagen.');
  });

  it('geen geschiedenis: "ik leer nog", en voorzichtig rekenen', () => {
    const a = maakAdvies({ stand: stand({ batterij_procent: 50 }), dagen: [], nu: NU });
    expect(a.zekerheid).toBe('laag');
    expect(a.leertNog).toBe(true);
    expect(a.toelichting[0]).toMatch(/^Ik leer nog: er zijn nog geen dagen van je huis bewaard/);
    expect(a.toelichting.join(' ')).toMatch(/Hoeveel zon je panelen geven, weet ik pas na een dag/);
    expect(a.slechtste.tijd).toBe('17:00–20:00');
    // Een paar dagen: dat staat erbij.
    expect(maakAdvies({ stand: stand(), dagen: dagen(3000, 2), nu: NU }).toelichting[0]).toBe('Ik leer nog (2 dagen bekeken): na een week wordt dit beter.');
  });

  it('het tweede huis (dirk): zon van een kWh-meter, geen omvormer, wel een batterij', () => {
    const dirk = stand({ omvormer: null, zon_w: 0, zonnen: [{ sleutel: 'hw-zon', naam: 'Zonnepanelen', vermogen_w: 0 }], batterij_procent: 60 });
    const a = maakAdvies({ stand: dirk, dagen: dagen(2500), nu: NU });
    expect(a.beste.tijd).toBe('12:00–15:00');
    expect(a.geleerd.metPanelen).toBe(true);
  });

  it('een huis zonder panelen en zonder batterij: alleen de prijs, geen weerregel', () => {
    const kaal = { voorspelling: voorspelling(), batterij_procent: null, zon_w: null, dag: null };
    const a = maakAdvies({ stand: kaal, dagen: dagen(0, 7, { zon: false }), nu: NU });
    expect(a.zinnen).toEqual(['Vandaag tussen 12 en 15 uur: goed om stroom te gebruiken, zoals wassen, vaatwasser of drogen.', 'Vandaag tussen 17 en 20 uur.']);
    expect(a.toelichting.join(' ')).not.toMatch(/zon/);
    expect(a.uren.every((u) => u.procent === null && u.zonW === 0)).toBe(true);
  });

  it('weinig verschil tussen de uren: geen blok, alles gewoon, en dat in één regel', () => {
    const vlak = maakAdvies({ stand: stand({ voorspelling: voorspelling(() => 0.25), zon_w: null }), dagen: dagen(0, 7, { zon: false }), nu: NU });
    expect(vlak.beste).toBeNull();
    expect(vlak.uren.every((u) => u.soort === 'gewoon')).toBe(true);
    expect(vlak.regels).toEqual([{ soort: 'gewoon', kop: 'Maakt weinig uit', tekst: 'De komende uren maakt het weinig uit wanneer je stroom gebruikt.' }]);
  });

  it('het blok kan morgen zijn; ’s nachts geen wasmachine-advies', () => {
    const laat = NACHT + 21.5 * UUR;
    const a = maakAdvies({ stand: stand(), dagen: dagen(4000), nu: laat });
    expect(a.beste.tijd).toBe('morgen 12:00–15:00');
    expect(a.regels[0].tekst).toBe('Morgen tussen 12 en 15 uur: goed om stroom te gebruiken, zoals wassen, vaatwasser of drogen.');
    for (const u of a.uren) expect(u.begin).toBeGreaterThanOrEqual(NACHT + 21 * UUR);
  });

  it('het moment in woorden: nu tot, vandaag, morgen, tot middernacht', () => {
    const uren = Array.from({ length: 24 }, (_, k) => ({ begin: NACHT + (10 + k) * UUR }));
    expect(momentTekst(uren, { van: 0, tot: 3 })).toBe('Nu tot 13 uur');
    expect(momentTekst(uren, { van: 7, tot: 10 })).toBe('Vandaag tussen 17 en 20 uur');
    expect(momentTekst(uren, { van: 11, tot: 14 })).toBe('Vandaag van 21 uur tot middernacht');
    expect(momentTekst(uren, { van: 22, tot: 24 })).toBe('Morgen tussen 8 en 10 uur');
  });

  it('geen stand: geen advies', () => {
    expect(maakAdvies({ stand: null, nu: NU })).toBeNull();
  });
});

describe('het verlies van de batterij bij elke temperatuur', () => {
  it('Tims getallen van 10 tot 40 °C: 6% bij 25–30, oplopend tot 10% bij 40, 11% bij 10', () => {
    expect(verliesBijTemperatuur(25)).toBeCloseTo(0.06, 6);
    expect(verliesBijTemperatuur(27)).toBeCloseTo(0.06, 6);
    expect(verliesBijTemperatuur(30)).toBeCloseTo(0.06, 6);
    expect(verliesBijTemperatuur(35)).toBeCloseTo(0.08, 6);
    expect(verliesBijTemperatuur(40)).toBeCloseTo(0.1, 6);
    expect(verliesBijTemperatuur(45)).toBeCloseTo(0.1, 6);
    expect(verliesBijTemperatuur(17.5)).toBeCloseTo(0.085, 6);
    expect(verliesBijTemperatuur(10)).toBeCloseTo(0.11, 6);
  });

  it('onder 10 °C snel slechter (bronnen in de code): 19% bij 0 °C, 34% bij −20 °C en niet verder', () => {
    expect(verliesBijTemperatuur(5)).toBeCloseTo(0.15, 6);
    expect(verliesBijTemperatuur(0)).toBeCloseTo(0.19, 6);
    expect(verliesBijTemperatuur(-10)).toBeCloseTo(0.265, 6);
    expect(verliesBijTemperatuur(-20)).toBeCloseTo(0.34, 6);
    expect(verliesBijTemperatuur(-35)).toBeCloseTo(0.34, 6);
  });

  it('kouder is nooit beter, warmer dan 30 °C ook niet', () => {
    for (let t = -30; t < 25; t++) expect(verliesBijTemperatuur(t)).toBeGreaterThanOrEqual(verliesBijTemperatuur(t + 1) - 1e-12);
    for (let t = 30; t < 50; t++) expect(verliesBijTemperatuur(t + 1)).toBeGreaterThanOrEqual(verliesBijTemperatuur(t) - 1e-12);
  });

  it('zonder temperatuur: geen getal (dan een vaste schatting)', () => {
    for (const t of [null, undefined, Number.NaN, '20']) expect(verliesBijTemperatuur(t)).toBeNull();
    expect(rendementNu({})).toEqual({ rendement: 0.92, temp: null, geschat: true, laadtNiet: false });
  });

  it('bruikbare inhoud: alles vanaf 10 °C, 85% bij −10 °C, 65% bij −20 °C', () => {
    expect(capaciteitBijTemperatuur(15)).toBe(1);
    expect(capaciteitBijTemperatuur(0)).toBeCloseTo(0.925, 6);
    expect(capaciteitBijTemperatuur(-10)).toBeCloseTo(0.85, 6);
    expect(capaciteitBijTemperatuur(-20)).toBeCloseTo(0.65, 6);
    expect(capaciteitBijTemperatuur(-30)).toBeCloseTo(0.65, 6);
    expect(capaciteitBijTemperatuur(null)).toBe(1);
  });

  it('de koudste accu telt; zonder accu’s temp_min_c, dan temp_c', () => {
    expect(koudsteAccu({ temp_c: 30, accus: [{ nr: 1, temp_c: 27 }, { nr: 2, temp_c: 24 }, { nr: 3, temp_c: null }] })).toBe(24);
    expect(koudsteAccu({ temp_c: 30, temp_min_c: 22 })).toBe(22);
    expect(koudsteAccu({ temp_c: 30 })).toBe(30);
    expect(koudsteAccu(null)).toBeNull();
    expect(rendementNu({ accus: [{ nr: 1, temp_c: 27 }] })).toMatchObject({ rendement: 0.94, temp: 27, geschat: false, laadtNiet: false });
    expect(rendementNu({ accus: [{ nr: 1, temp_c: -2 }] }).laadtNiet).toBe(true);
  });
});

describe('de rol van de batterij: eigen gebruik of handelen', () => {
  /** 's Nachts goedkoop (0,12), 's avonds duur (0,42), verder 0,25; terugleveren twee cent minder. */
  const nachtGoedkoop = (h) => (h >= 2 && h < 5 ? 0.12 : h >= 17 && h < 20 ? 0.42 : 0.25);
  const warm = { ...ZENDURE, accus: [{ nr: 1, temp_c: 27 }, { nr: 2, temp_c: 28 }] };
  const grijs = (over = {}) => stand({ batterij_info: warm, voorspelling: voorspelling(nachtGoedkoop), ...over });

  it('eigen gebruik (de standaard): nooit uit het net laden, nooit aan het net leveren', () => {
    const a = maakAdvies({ stand: grijs(), dagen: dagen(500), nu: NU });
    expect(a.rol).toBe('eigen');
    expect(a.handelt).toBe(false);
    // Laden alleen met zon over (dan gaat er niets uit het net), leveren alleen aan het huis (dan gaat er niets naar het net).
    for (const u of a.uren) {
      if (u.batterijW < 0) expect(u.netW).toBeLessThanOrEqual(1);
      if (u.batterijW > 0) expect(u.netW).toBeGreaterThanOrEqual(-1);
    }
    expect(a.uren.some((u) => u.batterijW > 100)).toBe(true);
  });

  it('handelen met veel verschil in prijs: laden als het goedkoop is, terugleveren als het duur is, met het bedrag', () => {
    const a = maakAdvies({ stand: grijs(), dagen: dagen(500), nu: NU, rol: 'handelen' });
    expect(a.handelt).toBe(true);
    expect(a.winst).toBeGreaterThan(1);
    const nacht = a.uren.filter((u) => u.morgen && u.uur >= 2 && u.uur < 5);
    expect(nacht.some((u) => u.batterijW < -100 && u.netW > 100)).toBe(true);
    const avond = a.uren.filter((u) => !u.morgen && u.uur >= 17 && u.uur < 20);
    expect(avond.some((u) => u.batterijW > 100 && u.netW < -100)).toBe(true);
    // Op de kaart nog steeds niets over de batterij.
    expect(a.zinnen.join(' ')).not.toMatch(/batterij|handel/i);
  });

  it('handelen dat na het verlies niets oplevert: geen handelsadvies, gewoon eigen gebruik', () => {
    const vlak = (h) => 0.25 + (h % 2) * 0.01;
    const a = maakAdvies({ stand: grijs({ voorspelling: voorspelling(vlak) }), dagen: dagen(500), nu: NU, rol: 'handelen' });
    expect(a.handelt).toBe(false);
    expect(a.winst).toBeLessThan(HANDEL_DREMPEL_EUR);
    for (const u of a.uren) if (u.batterijW < 0) expect(u.netW).toBeLessThanOrEqual(1);
  });

  it('een batterij onder de ontlaadgrens of boven de koude bovengrens: geen nep-winst of nep-verlies bij vlakke prijzen (R19-RK-03)', () => {
    const vlak = { van: NACHT, stapMs: 15 * 60_000, afname: Array(192).fill(0.25), terug: Array(192).fill(0.25), bonus: Array(192).fill(0) };
    for (const [procent, info] of [
      [0, warm],
      [5, warm],
      [10, warm],
      [100, { ...ZENDURE, accus: [{ nr: 1, temp_c: -5 }] }],
    ]) {
      // Grijs (geen zon over): dan kan handelen met vlakke prijzen alleen iets "opleveren" door een andere begintoestand.
      const a = maakAdvies({ stand: stand({ batterij_procent: procent, batterij_info: info, voorspelling: vlak, zon_w: null }), dagen: dagen(0, 7, { zon: false }), nu: NU, rol: 'handelen' });
      expect(Math.abs(a.winst)).toBeLessThan(0.03);
      expect(a.handelt).toBe(false);
    }
  });

  it('meer verlies (koud) maakt handelen minder waard', () => {
    const koel = { ...ZENDURE, accus: [{ nr: 1, temp_c: 12 }] };
    const warmWinst = maakAdvies({ stand: grijs(), dagen: dagen(500), nu: NU, rol: 'handelen' }).winst;
    const koelWinst = maakAdvies({ stand: grijs({ batterij_info: koel }), dagen: dagen(500), nu: NU, rol: 'handelen' }).winst;
    expect(koelWinst).toBeLessThan(warmWinst);
  });

  it('onder 0 °C laadt hij niet: ook niet in het handelsplan', () => {
    const vries = { ...ZENDURE, accus: [{ nr: 1, temp_c: -3 }] };
    const a = maakAdvies({ stand: grijs({ batterij_info: vries }), dagen: dagen(500), nu: NU, rol: 'handelen' });
    expect(a.uren.some((u) => u.batterijW < 0)).toBe(false);
    expect(a.batterij.rendement).toBeCloseTo(0.79, 2);
  });

  it('handelen zonder prijzen: dan eigen gebruik, en dat staat erbij', () => {
    const a = maakAdvies({ stand: grijs({ voorspelling: null }), dagen: dagen(500), nu: NU, rol: 'handelen' });
    expect(a.handelt).toBe(false);
    expect(a.winst).toBeNull();
  });

  it('het handelsplan blijft binnen de grenzen en het vermogen, en kost nooit meer dan eigen gebruik', () => {
    const batterij = batterijVoorAdvies(grijs());
    const begin = Math.floor(NU / UUR) * UUR;
    const p = prijzenPerUur(voorspelling(nachtGoedkoop), begin);
    const uren = p.map((prijs, k) => ({ huisW: 600, zonW: k > 1 && k < 6 ? 1500 : 0, deel: 1, prijs }));
    const handel = rekenHandel({ uren, batterij });
    const eigen = rekenDoor({ uren, batterij });
    expect(handel.kosten).toBeLessThanOrEqual(eigen.kosten + 0.02);
    for (const st of handel.stappen) {
      expect(st.kwh).toBeGreaterThanOrEqual(batterij.min - 1e-9);
      expect(st.kwh).toBeLessThanOrEqual(batterij.max + 1e-9);
      expect(Math.abs(st.batterijW)).toBeLessThanOrEqual(2400 + 1e-6);
    }
  });

  it('zonder batterij maakt de rol niets uit', () => {
    const kaal = { voorspelling: voorspelling(nachtGoedkoop), batterij_procent: null, zon_w: null, dag: null };
    const a = maakAdvies({ stand: kaal, dagen: dagen(0, 7, { zon: false }), nu: NU, rol: 'handelen' });
    const b = maakAdvies({ stand: kaal, dagen: dagen(0, 7, { zon: false }), nu: NU });
    expect(a.zinnen).toEqual(b.zinnen);
    expect(a.handelt).toBe(false);
  });
});
