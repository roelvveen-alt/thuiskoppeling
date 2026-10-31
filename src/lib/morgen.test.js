import { describe, expect, it } from 'vitest';
import { BAND_VOORUIT_MIN, kwhKort, leerZon, maakMorgen, metBewaard, omvormerDagen } from './morgen';
import { nepDagen, nepWeer } from './morgenProef';
import { STANDAARD_PLAATS } from './zonnestand';

/** Vrijdag 30 oktober 2026, 14:00 in Nederland. */
const NU = Date.parse('2026-10-30T13:00:00Z');
const VANDAAG = '2026-10-30';

/** Tims panelen zoals ze echt zijn (de app weet dat niet): het hoofddak schuin op het zuidwesten, het dierenverblijf plat op het oosten. */
const ECHT = [
  { sleutel: 'hw-zon-huis', kwp: 8, helling: 40, richting: 210, prestatie: 0.72 },
  { sleutel: 'hw-zon-verblijf', kwp: 3, helling: 15, richting: 120, prestatie: 0.85 },
];
/** Wat Tim in Namen invulde (Opstelling vermogens). */
const PUNTEN = [
  { soort: 'zon', sleutel: 'hw-zon-huis', naam: 'Hoofddak', eigenMax: 8000 },
  { soort: 'zon', sleutel: 'hw-zon-verblijf', naam: 'Dierenverblijf', eigenMax: 3000 },
  { soort: 'huis', sleutel: 'huis', naam: 'Huis' },
];

const standMet = (weer, extra = {}) => ({ weer, batterij_procent: 40, batterij_info: { inhoud_kwh: 8.64 }, voorspelling: null, dag: null, brug: { zon: null }, ...extra });
const fout = (voorspeld, echt) => Math.abs(voorspeld / echt - 1);

function morgenVoor({ aantal, perPlek = false, punten = PUNTEN, plekken = ECHT, omvormer = null, nu = NU, vandaag = VANDAAG, helder = (n) => (n % 3 === 0 ? 0.3 : 0.6), ...rest }) {
  const dagen = nepDagen({ tot: vandaag, aantal, plekken, perPlek, omvormer, helder });
  const weer = nepWeer({ vandaag, opgehaald: nu - 600_000 });
  return { dagen, m: maakMorgen({ stand: standMet(weer), dagen, punten, nu, ...rest }) };
}

/** De echte opbrengst van één dag (kWh), totaal en per plek, met het weer van het bericht. */
function echteDag(datum, plekken = ECHT) {
  const [dag] = nepDagen({ tot: datum, aantal: 1, plekken, helder: () => 0.6, perPlek: true });
  return { totaal: dag.zon, perPlek: Object.fromEntries(Object.entries(dag.uren.zonnenWh ?? { [plekken[0].sleutel]: dag.uren.zonWh }).map(([s, wh]) => [s, wh.reduce((a, b) => a + b, 0) / 1000])) };
}

describe('dag één: een natuurkundige start uit het vermogen', () => {
  it('zonder enige dag al een verwachting per plek, met een ruime bandbreedte en eerlijk dat het nog niets leerde', () => {
    const { m } = morgenVoor({ aantal: 0 });
    const echt = echteDag('2026-10-31');
    expect(m.zon.kwh).toBeGreaterThan(10);
    // De natuurkunde alleen zit er hooguit een kwart naast (de echte panelen staan anders dan een gewoon dak).
    expect(fout(m.zon.kwh, echt.totaal)).toBeLessThan(0.25);
    expect(m.zon.perBron.map((b) => b.naam)).toEqual(['Hoofddak', 'Dierenverblijf']);
    expect(m.zon.perBron[0].kwh / m.zon.perBron[1].kwh).toBeCloseTo(8 / 3, 1);
    expect(m.band).toBe(0.4);
    expect(m.toelichting[0]).toMatch(/^Nog niets geleerd: een natuurkundige schatting uit het vermogen van je panelen \(8,0.kW en 3,0.kW\)/);
    expect(m.zinnen[0]).toMatch(/^Morgen zo'n \d+.kWh zon \(tussen \d+.kWh en \d+.kWh\)\.$/);
  });

  it('nooit meer dan het maximale vermogen van een plek', () => {
    const { m } = morgenVoor({ aantal: 0, punten: [{ soort: 'zon', sleutel: 'z', naam: 'Zon', eigenMax: 500 }] });
    expect(Math.max(...m.morgenUren.map((u) => u.zonW ?? 0))).toBeLessThanOrEqual(500);
  });
});

describe('snel leren', () => {
  it('na één dag zit hij al dichter bij, na drie dagen binnen een paar procent; de band krimpt niet onder wat een bericht een dag vooruit weet', () => {
    const echt = echteDag('2026-10-31').totaal;
    const nul = morgenVoor({ aantal: 0 }).m;
    const een = morgenVoor({ aantal: 1 }).m;
    const drie = morgenVoor({ aantal: 3 }).m;
    expect(fout(een.zon.kwh, echt)).toBeLessThan(fout(nul.zon.kwh, echt));
    expect(fout(drie.zon.kwh, echt)).toBeLessThan(0.05);
    expect(drie.band).toBeLessThanOrEqual(een.band);
    expect(drie.band).toBeGreaterThanOrEqual(BAND_VOORUIT_MIN);
    expect(drie.toelichting[0]).toBe('Geleerd van 3 dagen, met de natuurkunde als start. Na een week met zon is het stevig.');
  });

  it('vandaag tot nu telt ook mee: de hele uren die voorbij zijn', () => {
    const weer = nepWeer({ vandaag: VANDAAG, opgehaald: NU - 600_000 });
    // De zon per kwartier van vandaag tot 14:00, gemeten aan de echte panelen.
    const [vandaagEcht] = nepDagen({ tot: '2026-10-31', aantal: 1, plekken: ECHT, helder: () => 0.6 });
    const metingen = Array.from({ length: 96 }, (_, i) => (i < 56 ? 180 : 0));
    const zon = Array.from({ length: 96 }, (_, i) => (i < 56 ? vandaagEcht.uren.zonWh[Math.floor(i / 4)] : 0));
    const dag = { van: Date.parse('2026-10-29T23:00:00Z'), stapMs: 900_000, metingen, zon, zonnen: null };
    const m = maakMorgen({ stand: standMet(weer, { dag }), dagen: [], punten: PUNTEN, nu: NU });
    expect(m.geleerd.vandaagTelt).toBe(true);
    expect(m.toelichting[0]).toMatch(/^Geleerd van vandaag tot nu/);
    expect(fout(m.zon.kwh, echteDag('2026-10-31').totaal)).toBeLessThan(0.1);
  });

  it('per plek: met de zon per plek (programmaatje 0.10.0) klopt ook de verdeling', () => {
    const echt = echteDag('2026-10-31').perPlek;
    const zonder = morgenVoor({ aantal: 5 }).m.zon.perBron;
    const met = morgenVoor({ aantal: 5, perPlek: true }).m;
    const verblijf = (lijst) => lijst.find((b) => b.sleutel === 'hw-zon-verblijf').kwh;
    expect(fout(verblijf(met.zon.perBron), echt['hw-zon-verblijf'])).toBeLessThan(fout(verblijf(zonder), echt['hw-zon-verblijf']));
    expect(fout(verblijf(met.zon.perBron), echt['hw-zon-verblijf'])).toBeLessThan(0.1);
    expect(met.toelichting[0]).toMatch(/^Geleerd van 5 dagen, per plek/);
  });

  it('per plek ook uit de omvormer (GoodWe: wat hij per dag zegt, of het verschil van zijn teller)', () => {
    const echt = echteDag('2026-10-31').perPlek;
    const met = morgenVoor({ aantal: 5, omvormer: 'hw-zon-huis' }).m;
    const dak = met.zon.perBron.find((b) => b.sleutel === 'hw-zon-huis');
    expect(fout(dak.kwh, echt['hw-zon-huis'])).toBeLessThan(0.1);
    expect(dak.perPlek).toBe(true);
    // Alleen de teller (oudere dagen zonder kWh van die dag): het verschil telt.
    const dagen = nepDagen({ tot: VANDAAG, aantal: 3, plekken: ECHT, omvormer: 'hw-zon-huis' }).map((d) => ({ ...d, omvormer: { ...d.omvormer, kwh: null } }));
    const uit = omvormerDagen(dagen, VANDAAG);
    expect(uit).toHaveLength(2);
    expect(uit[0].kwh).toBeCloseTo(dagen[1].omvormer.totaal - dagen[0].omvormer.totaal, 5);
    expect(uit.every((o) => o.kwh > 5 && o.bij === 'hw-zon-huis')).toBe(true);
  });

  it('een seizoensfactor naar de zonnestand: schaduw bij een lage zon leert hij apart', () => {
    const plekken = [{ ...ECHT[0], schaduwOnder: 14 }];
    const punten = [PUNTEN[0]];
    const { m } = morgenVoor({ aantal: 10, plekken, punten });
    const laag = m.geleerd.standen;
    // De bakjes met een lage zon (0 tot 8° en 8 tot 16°) leveren minder dan de natuurkunde, de hogere niet.
    expect(Math.min(laag['0-oost'] ?? 1, laag['1-oost'] ?? 1, laag['1-west'] ?? 1, laag['0-west'] ?? 1)).toBeLessThan(0.8);
    expect(laag['2-zuid']).toBeGreaterThan(0.85);
    expect(fout(m.zon.kwh, echteDag('2026-10-31', plekken).totaal)).toBeLessThan(0.08);
  });
});

describe('winter en zomer', () => {
  it('in juni veel meer dan in december, en elk seizoen klopt na een paar dagen leren in dat seizoen', () => {
    const zomer = morgenVoor({ aantal: 4, nu: Date.parse('2027-06-15T11:00:00Z'), vandaag: '2027-06-15' }).m;
    const winter = morgenVoor({ aantal: 4, nu: Date.parse('2026-12-15T12:00:00Z'), vandaag: '2026-12-15' }).m;
    expect(zomer.zon.kwh).toBeGreaterThan(2.5 * winter.zon.kwh);
    expect(fout(zomer.zon.kwh, echteDag('2027-06-16').totaal)).toBeLessThan(0.06);
    expect(fout(winter.zon.kwh, echteDag('2026-12-16').totaal)).toBeLessThan(0.06);
    // In de winter is de zon er korter: het meest rond het middaguur.
    expect(winter.zon.piek.tijd).toMatch(/tussen 1[12]:00 en 1[34]:00/);
  });
});

describe('het huis van Dirk: één kWh-meter, geen vermogen ingevuld', () => {
  const DIRK = [{ sleutel: 'zon', kwp: 2.4, helling: 35, richting: 170, prestatie: 0.8 }];
  const PUNTEN_DIRK = [{ soort: 'zon', sleutel: 'zon', naam: 'Zon', eigenMax: null }];

  it('zonder dagen: geen getal, wel de vraag om het vermogen in te vullen', () => {
    const { m } = morgenVoor({ aantal: 0, plekken: DIRK, punten: PUNTEN_DIRK });
    expect(m.zon).toBeNull();
    expect(m.vraagVermogen).toEqual(['Zon']);
    expect(m.zinnen[0]).toMatch(/weet ik pas na een paar uur zon/);
    expect(m.toelichting.some((t) => t.startsWith('Vul bij Instellingen › Namen het maximale vermogen van Zon in'))).toBe(true);
  });

  it('na één dag geleerd: dan wel, zonder start uit de natuurkunde', () => {
    const { m } = morgenVoor({ aantal: 1, plekken: DIRK, punten: PUNTEN_DIRK, helder: () => 0.6 });
    expect(m.geleerd.zonderVermogen).toBe(true);
    expect(fout(m.zon.kwh, echteDag('2026-10-31', DIRK).totaal)).toBeLessThan(0.1);
    expect(m.toelichting[0]).toBe('Geleerd van 1 dag. Na een week met zon is het stevig.');
    expect(m.band).toBe(0.35);
  });

  it('geen panelen: niets te voorspellen (alleen het weer)', () => {
    const m = maakMorgen({ stand: standMet(nepWeer({ vandaag: VANDAAG, opgehaald: NU })), dagen: [], punten: [{ soort: 'huis', sleutel: 'huis' }], nu: NU });
    expect(m.metPanelen).toBe(false);
    expect(m.zon).toBeNull();
  });
});

describe('een oudere brug', () => {
  it('0.9.0 (straling en bewolking, geen weercode): de zon wel', () => {
    const weer = nepWeer({ vandaag: VANDAAG, opgehaald: NU, oud: true });
    const m = maakMorgen({ stand: standMet(weer), dagen: [], punten: PUNTEN, nu: NU });
    expect(m.zon.kwh).toBeGreaterThan(10);
  });

  it('0.8.0 en ouder (geen weer): eerlijk dat er geen bericht is', () => {
    const m = maakMorgen({ stand: standMet(null), dagen: [], punten: PUNTEN, nu: NU });
    expect(m.zon).toBeNull();
    expect(m.zinnen[0]).toMatch(/geen weerbericht/);
  });

  it('een bericht dat morgen nog niet dekt (te oud): geen getal voor morgen', () => {
    const weer = nepWeer({ vandaag: '2026-10-29', opgehaald: NU - 20 * 3_600_000 });
    const m = maakMorgen({ stand: standMet(weer), dagen: [], punten: PUNTEN, nu: NU });
    expect(m.zon).toBeNull();
    expect(m.zinnen[0]).toMatch(/reikt nog niet tot en met morgen/);
    expect(m.toelichting.some((t) => t.startsWith('Het weerbericht is van'))).toBe(true);
  });
});

describe('de batterij en het geld', () => {
  /** Prijzen per kwartier vanaf middernacht vandaag: `dagen` dagen, overdag goedkoper. */
  const prijzen = (dagen) => {
    const n = dagen * 96;
    const afname = Array.from({ length: n }, (_, i) => ((i % 96) >= 40 && (i % 96) < 64 ? 0.18 : 0.3));
    return { van: Date.parse('2026-10-29T23:00:00Z'), stapMs: 900_000, afname, terug: afname.map((p) => p - 0.02), bonus: afname.map(() => 0) };
  };

  it('wanneer hij vol is en wat er naar het net gaat; met de prijzen van morgen wat de zon scheelt', () => {
    const dagen = nepDagen({ tot: VANDAAG, aantal: 3, plekken: ECHT });
    const stand = standMet(nepWeer({ vandaag: VANDAAG, opgehaald: NU }), { voorspelling: prijzen(2) });
    const m = maakMorgen({ stand, dagen, punten: PUNTEN, nu: NU });
    expect(m.batterij.vol).not.toBeNull();
    expect(m.zinnen.find((z) => z.startsWith('De batterij'))).toMatch(/^De batterij is morgen rond \d\d:00 vol \(om middernacht zo'n \d+%\); daarna gaat zo'n \d+.kWh naar het net\.$/);
    expect(m.geld.metPrijzen).toBe(true);
    expect(m.geld.scheelt).toBeGreaterThan(1);
    expect(m.zinnen.find((z) => z.startsWith('Met de prijzen van morgen'))).toMatch(/scheelt de zon zo'n €.\d+,\d\d/);
  });

  it('voor 13:00 (nog geen prijzen van morgen): met de prijzen van vandaag, en dat staat erbij', () => {
    const dagen = nepDagen({ tot: VANDAAG, aantal: 3, plekken: ECHT });
    const stand = standMet(nepWeer({ vandaag: VANDAAG, opgehaald: NU }), { voorspelling: prijzen(1) });
    const m = maakMorgen({ stand, dagen, punten: PUNTEN, nu: NU });
    expect(m.geld.metPrijzen).toBe(false);
    expect(m.zinnen.some((z) => z.startsWith('Met de prijzen van vandaag'))).toBe(true);
    expect(m.toelichting.some((t) => t.startsWith('De prijzen van morgen komen rond 13:00'))).toBe(true);
  });

  it('een kleine zon in de winter: de batterij komt niet vol', () => {
    const m = morgenVoor({ aantal: 3, nu: Date.parse('2026-12-15T12:00:00Z'), vandaag: '2026-12-15', punten: [{ soort: 'zon', sleutel: 'hw-zon-verblijf', naam: 'Dierenverblijf', eigenMax: 3000 }], plekken: [ECHT[1]] }).m;
    expect(m.batterij.vol).toBeNull();
    expect(m.zinnen.find((z) => z.startsWith('De batterij'))).toMatch(/^De batterij komt morgen niet vol: hooguit zo'n \d+%/);
  });
});

describe('de band van morgen (R19-RK-06)', () => {
  /** Wat dit toestel de dagen ervoor voorspelde: de echte opbrengst maal `maal`. */
  const bewaardVan = (dagen, maal) => Object.fromEntries(dagen.slice(-3).map((d) => [d.datum, Math.round(d.zon * maal * 100) / 100]));

  it('zonder bewaarde voorspellingen minstens een kwart, ook na een week leren met het weer van die dag zelf', () => {
    const { m } = morgenVoor({ aantal: 7 });
    expect(m.geleerd.spreiding).not.toBeNull();
    expect(m.band).toBeGreaterThanOrEqual(BAND_VOORUIT_MIN);
  });

  it('met drie bewaarde dagen: zo ver als die ernaast zaten', () => {
    const dagen = nepDagen({ tot: VANDAAG, aantal: 7, plekken: ECHT, helder: (n) => (n % 3 === 0 ? 0.3 : 0.6) });
    const weer = nepWeer({ vandaag: VANDAAG, opgehaald: NU - 600_000 });
    const met = (bewaard) => maakMorgen({ stand: standMet(weer), dagen, punten: PUNTEN, nu: NU, bewaard });
    expect(met(bewaardVan(dagen, 1.02)).band).toBeLessThan(BAND_VOORUIT_MIN);
    expect(met(bewaardVan(dagen, 1.6)).band).toBeGreaterThan(0.5);
    // Twee dagen is nog te weinig: dan de ondergrens.
    const twee = Object.fromEntries(Object.entries(bewaardVan(dagen, 1.02)).slice(1));
    expect(met(twee).band).toBeGreaterThanOrEqual(BAND_VOORUIT_MIN);
  });
});

describe('de batterij en het geld, eerlijk geteld', () => {
  const ELF = Date.parse('2026-10-30T10:00:00Z');
  /** Vandaag zonnig, morgen grijs; prijzen voor vandaag en morgen: afnemen 0,25, terugleveren 0,10. */
  const zonnigDanGrijs = (procent) => {
    const dagen = nepDagen({ tot: VANDAAG, aantal: 7, plekken: ECHT, helder: () => 0.6 });
    const weer = nepWeer({ vandaag: VANDAAG, opgehaald: ELF, helder: (i) => (i >= 25 ? 0.08 : 0.65) });
    const n = 192;
    const voorspelling = { van: Date.parse('2026-10-29T23:00:00Z'), stapMs: 900_000, afname: Array(n).fill(0.25), terug: Array(n).fill(0.1), bonus: Array(n).fill(0) };
    return maakMorgen({ stand: standMet(weer, { voorspelling, batterij_procent: procent }), dagen, punten: PUNTEN, nu: ELF });
  };

  it('wat de zon van morgen scheelt, telt de zon van vandaag niet mee (R19-RK-04)', () => {
    const m = zonnigDanGrijs(40);
    expect(m.zon.kwh).toBeLessThan(5);
    // Hooguit alles zelf gebruikt tegen de afnameprijs.
    expect(m.geld.scheelt).toBeLessThanOrEqual(m.zon.kwh * 0.25 + 0.005);
    expect(m.geld.scheelt).toBeGreaterThan(0);
  });

  it('"hooguit" is nooit minder dan de stand om middernacht; laadt hij morgen niet bij, dan zegt hij dat (R19-RK-05)', () => {
    const m = zonnigDanGrijs(40);
    expect(m.batterij.hoogste).toBeGreaterThanOrEqual(m.batterij.beginMorgen);
    const zin = m.zinnen.find((z) => z.startsWith('De batterij'));
    if (m.batterij.hoogste === m.batterij.beginMorgen) expect(zin).toBe(`De batterij laadt morgen nauwelijks bij: om middernacht zo'n ${m.batterij.beginMorgen}%, daarna minder.`);
    else expect(zin).toMatch(/hooguit zo'n (\d+)%/);
    expect(zin).not.toMatch(new RegExp(`hooguit zo'n ${m.batterij.beginMorgen - 1}%`));
  });

  it('de eerste keer vol, ook vandaag, voor het batterijblad: dezelfde rekening als de zin van morgen', () => {
    const m = zonnigDanGrijs(40);
    expect(m.batterij.eersteVolTekst).toMatch(/^vandaag rond \d\d:00$/);
    expect(m.batterij.alVol).toBe(false);
  });
});

describe('hoe kwam gisteren uit', () => {
  it('met wat dit toestel eergisteren bewaarde', () => {
    const { dagen, m } = morgenVoor({ aantal: 4, bewaard: { '2026-10-29': 20 } });
    const gemeten = dagen.at(-1).zon;
    expect(m.gisteren).toMatchObject({ soort: 'bewaard', voorspeld: 20, datum: '2026-10-29' });
    expect(m.gisteren.zin).toBe(`Gisteren voorspelde ik 20\u00a0kWh zon; het werd ${kwhKort(gemeten)} (${Math.round(Math.abs(gemeten / 20 - 1) * 100)}% ${gemeten > 20 ? 'meer' : 'minder'}).`);
  });

  it('niets bewaard: een terugblik met het geleerde van daarvoor en het weer van gisteren', () => {
    const { m } = morgenVoor({ aantal: 4 });
    expect(m.gisteren.soort).toBe('terugblik');
    expect(m.gisteren.zin).toMatch(/^Terugblik op gisteren: met het weer van gisteren had ik [\d,]+.kWh gezegd; het werd [\d,]+.kWh/);
    expect(Math.abs(m.gisteren.voorspeld / m.gisteren.gemeten - 1)).toBeLessThan(0.1);
  });

  it('zonder dag van gisteren: niets', () => {
    expect(morgenVoor({ aantal: 0 }).m.gisteren).toBeNull();
  });
});

describe('leerZon los', () => {
  it('zonder uren met licht geen factor bij een onbekend vermogen, wel de natuurkunde bij een bekend', () => {
    const bronnen = [{ sleutel: 'zon', naam: 'Zon', maxW: null }];
    expect(leerZon({ bronnen, plaats: STANDAARD_PLAATS, vandaag: VANDAAG, nu: NU }).factor).toBeNull();
    expect(leerZon({ bronnen: [{ ...bronnen[0], maxW: 4000 }], plaats: STANDAARD_PLAATS, vandaag: VANDAAG, nu: NU }).factor).toBe(1);
  });

  it('een dag met een uur van de klokwissel (8 kwartieren) laat dat uur liggen', () => {
    const [dag] = nepDagen({ tot: '2026-10-26', aantal: 1, plekken: ECHT });
    dag.uren.kwartieren[2] = 8;
    const geleerd = leerZon({ dagen: [dag], bronnen: [{ sleutel: 'a', naam: 'A', maxW: 11000 }], plaats: STANDAARD_PLAATS, vandaag: '2026-10-26', nu: Date.parse('2026-10-26T12:00:00Z') });
    expect(geleerd.dagen).toBe(1);
  });
});

describe('kWh in woorden', () => {
  it('onder de 10 op een decimaal, daarboven heel', () => {
    expect(kwhKort(0.04)).toBe('0,0\u00a0kWh');
    expect(kwhKort(9.4)).toBe('9,4\u00a0kWh');
    expect(kwhKort(26.3)).toBe('26\u00a0kWh');
  });
});

describe('wat dit toestel bewaart', () => {
  it('per huis de voorspelde kWh per datum, hooguit vier datums, de nieuwste; zelfde getal: hetzelfde voorwerp', () => {
    let b = null;
    for (const d of ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']) b = metBewaard(b, 'huis-tim01', d, 12.345);
    expect(Object.keys(b['huis-tim01'])).toEqual(['2026-10-30', '2026-10-29', '2026-10-28', '2026-10-27']);
    expect(b['huis-tim01']['2026-10-30']).toBe(12.35);
    expect(metBewaard(b, 'huis-tim01', '2026-10-30', 12.35)).toBe(b);
    const ander = metBewaard(b, 'huis-dirk001', '2026-10-31', 3);
    expect(ander['huis-tim01']).toEqual(b['huis-tim01']);
    expect(metBewaard('kapot', 'h', '2026-10-31', 1)).toEqual({ h: { '2026-10-31': 1 } });
  });
});
