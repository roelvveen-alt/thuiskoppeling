import { describe, expect, it, vi } from 'vitest';
import { dagUit } from '../../src/lib/bron.js';
import { dagOverzicht } from '../../src/lib/dagoverzicht.js';
import { controleerMeting } from '../functions/ontvangMeting/controle.js';
import { boekDag, dagDeel, datumKlopt, KWARTIER_MS, omvormerVan, OPNIEUW_MS, vandaagDeel, verbruikUitKwh, verbruikVan, zonnebonusVan } from '../functions/ontvangMeting/dagboek.js';
import { behandelMeting } from '../functions/ontvangMeting/ontvang.js';
import { dagNummer } from '../shared/dagen.js';
import { sha256Hex } from '../shared/sleutel.js';
import { tabellen } from '../shared/tabellen.js';
import { nepBase44, verzoek, zonderWachten } from './nep.js';

/** Middernacht van vrijdag 30 oktober 2026 in Nederland (wintertijd: 23:00 UTC de dag ervoor). */
const NACHT = Date.parse('2026-10-29T23:00:00Z');
const UUR = 3_600_000;

/** Een meting zoals het programmaatje hem stuurt, tot `kwartieren` ver in de dag. */
function rauw({ datum = '2026-10-30', van = NACHT, kwartieren = 44, afname = 1.234, terug = 2.5, kosten = 0.31, opbrengst = 0.52, zon = 4.2, net } = {}) {
  const metingen = Array.from({ length: kwartieren }, (_, i) => (i < 4 ? 0 : 180));
  const reeks = (f) => metingen.map((_, i) => Math.round(f(i)));
  return {
    net_w: -120,
    zon_w: 800,
    batterij_w: -600,
    batterij_procent: 40,
    vandaag: { datum, afname_kwh: afname, teruglevering_kwh: terug, kosten_eur: kosten, opbrengst_eur: opbrengst, vaste_kosten_eur: -0.2137, compleet: true },
    dag: {
      datum,
      van: new Date(van).toISOString(),
      stap_min: 15,
      sinds: new Date(van + UUR).toISOString(),
      metingen,
      huis_w: reeks(() => 450),
      zon_w: reeks((i) => (i > 30 ? 1200 : 0)),
      batterij_w: reeks((i) => (i > 30 ? -600 : 300)),
      net_w: net ?? reeks((i) => (i > 30 ? -150 : 150)),
      kwh: { zon, huis: 5.1, geladen: 2.3, ontladen: 1.9 },
      fasen: [1, 2, 3].map((fase) => ({ fase, a: reeks(() => fase), w: reeks(() => fase * 200), gemiddeld_a: 1.234 * fase, piek_a: 8.04 + fase })),
    },
  };
}

const goedgekeurd = (r, nu) => {
  const uit = controleerMeting(r, nu);
  if (!uit.ok) throw new Error(uit.fout);
  return uit.meting;
};

/** De Zonnebonus per kwartier van vandaag (vanaf middernacht), 0,012 euro per kWh van 08:00 tot 17:00. */
const voorspelling = (van = NACHT, lengte = 96) => ({
  van: new Date(van).toISOString(),
  stap_min: 15,
  afname_kwh: Array(lengte).fill(0.25),
  teruglevering_kwh: Array(lengte).fill(0.26),
  zonnebonus_kwh: Array.from({ length: lengte }, (_, i) => (i >= 32 && i < 68 ? 0.012 : 0)),
});

describe('welke dag het is', () => {
  it('een echte datum, vandaag in Nederland', () => {
    const middag = new Date('2026-10-30T11:00:00Z');
    expect(datumKlopt('2026-10-30', middag)).toBe(true);
    for (const fout of ['2026-10-29', '2026-10-31', '2026-02-30', '2026-10-3', 'gisteren', 20261030, null, '2019-12-31']) {
      expect(datumKlopt(fout, middag), String(fout)).toBe(false);
    }
    expect(dagNummer('2028-02-29')).not.toBeNull();
    expect(dagNummer('2027-02-29')).toBeNull();
  });

  it('rond middernacht ook gisteren of morgen: een klok thuis die even scheef loopt', () => {
    const naMiddernacht = new Date('2026-10-29T23:30:00Z'); // 00:30 op de 30e
    expect(datumKlopt('2026-10-29', naMiddernacht)).toBe(true);
    expect(datumKlopt('2026-10-30', naMiddernacht)).toBe(true);
    expect(datumKlopt('2026-10-28', naMiddernacht)).toBe(false);
    const voorMiddernacht = new Date('2026-10-29T22:30:00Z'); // 23:30 op de 29e
    expect(datumKlopt('2026-10-30', voorMiddernacht)).toBe(true);
    expect(datumKlopt('2026-10-31', voorMiddernacht)).toBe(false);
  });

  it('ook als de klok verzet wordt (zomer- en wintertijd)', () => {
    // Zondag 25 oktober: om 03:00 zomertijd gaat de klok naar 02:00. 00:30 zomertijd = 22:30 UTC.
    expect(datumKlopt('2026-10-25', new Date('2026-10-24T22:30:00Z'))).toBe(true);
    expect(datumKlopt('2026-10-25', new Date('2026-10-25T22:30:00Z'))).toBe(true); // 23:30 wintertijd
    expect(datumKlopt('2026-10-27', new Date('2026-10-25T22:30:00Z'))).toBe(false);
    // Zondag 29 maart: om 02:00 gaat de klok naar 03:00. 00:30 wintertijd = 23:30 UTC.
    expect(datumKlopt('2026-03-29', new Date('2026-03-28T23:30:00Z'))).toBe(true);
    expect(datumKlopt('2026-03-29', new Date('2026-03-29T21:30:00Z'))).toBe(true); // 23:30 zomertijd
    expect(datumKlopt('2026-03-31', new Date('2026-03-29T21:30:00Z'))).toBe(false);
  });
});

describe('de meterkast en het geld van vandaag', () => {
  it('neemt de bedragen over en rekent de gemiddelde prijs uit', () => {
    const deel = vandaagDeel({ datum: '2026-10-30', afname_kwh: 2, teruglevering_kwh: 4, kosten_eur: 0.5, opbrengst_eur: 1.0004, vaste_kosten_eur: -0.21371, compleet: false });
    expect(deel).toEqual({
      datum: '2026-10-30',
      velden: {
        afname_kwh: 2,
        teruglevering_kwh: 4,
        kosten_eur: 0.5,
        opbrengst_eur: 1.0004,
        vaste_kosten_eur: -0.2137,
        afname_prijs_kwh: 0.25,
        teruglevering_prijs_kwh: 0.2501,
        compleet: false,
      },
    });
  });

  it('bij bijna niets afgenomen of teruggeleverd geen gemiddelde prijs; zonder vaste kosten leeg', () => {
    const deel = vandaagDeel({ datum: '2026-10-30', afname_kwh: 0.01, teruglevering_kwh: 0, kosten_eur: 0.003, opbrengst_eur: 0, compleet: true });
    expect(deel.velden).toMatchObject({ afname_prijs_kwh: null, teruglevering_prijs_kwh: null, vaste_kosten_eur: null });
  });

  it('wat niet klopt, telt niet', () => {
    const goed = { datum: '2026-10-30', afname_kwh: 1, teruglevering_kwh: 1, kosten_eur: 0.2, opbrengst_eur: 0.2 };
    for (const fout of [null, 'x', { ...goed, datum: '30-10-2026' }, { ...goed, afname_kwh: Number.NaN }, { ...goed, kosten_eur: 1e9 }, { ...goed, teruglevering_kwh: -1 }]) {
      expect(vandaagDeel(fout), JSON.stringify(fout)).toBeNull();
    }
  });
});

/** Een vast reeksje willekeurige getallen (mulberry32), zodat de vergelijking hieronder elke keer hetzelfde doet. */
function toeval(zaad) {
  let a = zaad >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('eigen verbruik en zelfvoorzienend: hetzelfde als de app', () => {
  it('Tims ochtend (08:26): zon 404 W, de batterij levert 1700 W, 1675 W naar het net', () => {
    const server = verbruikVan([180], [404], [1700], [-1675]);
    const app = dagOverzicht(dagUit({ van: new Date(NACHT).toISOString(), stap_min: 15, metingen: [180], huis_w: [429], zon_w: [404], batterij_w: [1700], net_w: [-1675] }));
    expect(server).toEqual({ eigen_verbruik: app.eigenVerbruik, zelfvoorzienend: app.zelfvoorzienend });
    // Niets uit het net naar het huis: helemaal zelfvoorzienend.
    expect(server.zelfvoorzienend).toBe(1);
    // Een nacht zonder zon: geen percentage (onder de 50 Wh zegt het niets).
    expect(verbruikVan([180], [0], [300], [150]).eigen_verbruik).toBeNull();
  });

  it('elke dag rekent de server hetzelfde als het tabblad Vandaag (verdeelStroom in src/lib/stroom.js)', () => {
    const r = toeval(20261030);
    for (let n = 0; n < 300; n++) {
      const lengte = 1 + Math.floor(r() * 96);
      const metingen = Array.from({ length: lengte }, () => (r() < 0.15 ? 0 : 180));
      const getal = (laag, hoog) => Math.round(laag + r() * (hoog - laag));
      const zon = metingen.map(() => (r() < 0.3 ? 0 : getal(0, 5000)));
      const batterij = metingen.map(() => getal(-2400, 2400));
      const net = metingen.map(() => (r() < 0.1 ? getal(-3, 3) : getal(-4000, 4000)));
      const metZon = r() > 0.1;
      const metBatterij = r() > 0.1;
      const ruw = {
        datum: '2026-10-30',
        van: new Date(NACHT).toISOString(),
        stap_min: 15,
        sinds: new Date(NACHT).toISOString(),
        metingen,
        huis_w: metingen.map(() => 0),
        ...(metZon ? { zon_w: zon } : {}),
        ...(metBatterij ? { batterij_w: batterij } : {}),
        net_w: net,
        kwh: { zon: 1, huis: 1, geladen: 1, ontladen: 1 },
      };
      const server = dagDeel(ruw).velden;
      const app = dagOverzicht(dagUit(ruw));
      const zelfde = (a, b) => (b === null ? expect(a).toBeNull() : expect(a).toBeCloseTo(b, 3));
      // Gaat dit mis, dan is de verdeling in src/lib/stroom.js veranderd: werk kwartierDelen in
      // base44/functions/ontvangMeting/dagboek.js mee bij, anders rekenen Week en Maand anders dan Vandaag.
      zelfde(server.eigen_verbruik, app.eigenVerbruik);
      zelfde(server.zelfvoorzienend, app.zelfvoorzienend);
    }
  });
});

describe('eigen verbruik en zelfvoorzienend precies, per meting verdeeld (brug 1.2.0, rekenregels-7)', () => {
  // Overdag elk kwartier om en om: de waterkoker uit het net, dan zon die teruggaat. Per kwartier
  // gemiddeld lijkt het of het huis op de zon draait; per meting (elke 5 s) kwam de helft uit het net.
  const metStromen = (stromen) => {
    const r = rauw({ net: Array.from({ length: 44 }, () => 0) });
    r.dag.zon_w = r.dag.zon_w.map(() => 1200);
    r.dag.batterij_w = r.dag.batterij_w.map(() => 0);
    r.dag.kwh = { ...r.dag.kwh, zon: 12, huis: 12, ...stromen };
    return r;
  };

  it('stuurt het programmaatje zon_zelf en net_huis mee, dan rekent de server daarmee', () => {
    const nu = new Date(NACHT + 11 * UUR);
    const nieuw = goedgekeurd(metStromen({ zon_zelf: 2, net_huis: 10 }), nu);
    expect(nieuw.dag.kwh).toEqual({ zon: 12, huis: 12, geladen: 2.3, ontladen: 1.9, zon_zelf: 2, net_huis: 10 });
    expect(dagDeel(nieuw.dag).velden).toMatchObject({ eigen_verbruik: 0.1667, zelfvoorzienend: 0.1667 });
    // Een oudere brug (1.1.1, 0.6.1): zelfde dag, zonder de twee getallen: per kwartier, zoals eerst.
    const oud = goedgekeurd(metStromen({}), nu);
    expect(oud.dag.kwh).toEqual({ zon: 12, huis: 12, geladen: 2.3, ontladen: 1.9 });
    expect(dagDeel(oud.dag).velden).toMatchObject({ eigen_verbruik: 1, zelfvoorzienend: 1 });
  });

  it('mild: één van de twee, een min-getal of tekst: ze gaan niet mee, de dag wel (dan per kwartier)', () => {
    const nu = new Date(NACHT + 11 * UUR);
    for (const stromen of [{ zon_zelf: 2 }, { net_huis: 3 }, { zon_zelf: -1, net_huis: 3 }, { zon_zelf: '2', net_huis: 3 }, { zon_zelf: 2, net_huis: 5000 }, { zon_zelf: 2, net_huis: Number.NaN }]) {
      const uit = controleerMeting(metStromen(stromen), nu);
      expect(uit.ok, JSON.stringify(stromen)).toBe(true);
      expect(uit.overgeslagen).toEqual([]);
      expect(uit.meting.dag.kwh).toEqual({ zon: 12, huis: 12, geladen: 2.3, ontladen: 1.9 });
      expect(dagDeel(uit.meting.dag).velden.zelfvoorzienend).toBe(1);
    }
  });

  it('een veld dat deze functie (nog) niet kent, valt stil weg; de dag blijft (zo nam de functie van voor 1.2.0 ook zon_zelf aan)', () => {
    const uit = controleerMeting(metStromen({ zon_zelf: 2, net_huis: 10, iets_van_later: 7 }), new Date(NACHT + 11 * UUR));
    expect(uit.ok).toBe(true);
    expect(uit.overgeslagen).toEqual([]);
    expect(uit.meting.dag.kwh).not.toHaveProperty('iets_van_later');
    expect(uit.meting.dag.kwh.net_huis).toBe(10);
  });

  it('weinig zon of weinig verbruik: geen percentage (onder de 0,05 kWh), zoals per kwartier', () => {
    expect(verbruikUitKwh({ zon: 0.01, huis: 3, zon_zelf: 0.01, net_huis: 1.5 })).toEqual({ eigen_verbruik: null, zelfvoorzienend: 0.5 });
    expect(verbruikUitKwh({ zon: 4, huis: 0.02, zon_zelf: 4, net_huis: 0 })).toEqual({ eigen_verbruik: 1, zelfvoorzienend: null });
    expect(verbruikUitKwh({ zon: 4, huis: 3 })).toBeNull();
    expect(verbruikUitKwh(undefined)).toBeNull();
  });

  it('in de rij van vandaag, zonder een aanroep extra', async () => {
    const meting = goedgekeurd(metStromen({ zon_zelf: 2, net_huis: 10 }), new Date(NACHT + 11 * UUR));
    const { db, rijen, dagAanroepen } = nepDb();
    await boekDag(db, 'huis-dirk001', meting, op(NACHT + 11 * UUR), new Map());
    expect(dagAanroepen()).toHaveLength(2);
    expect(rijen()[0]).toMatchObject({ eigen_verbruik: 0.1667, zelfvoorzienend: 0.1667, zon_kwh: 12, huis_kwh: 12 });
  });

  it('de site (Vandaag) rekent met dezelfde getallen als de server', () => {
    const meting = goedgekeurd(metStromen({ zon_zelf: 2, net_huis: 10 }), new Date(NACHT + 11 * UUR));
    const app = dagOverzicht(dagUit(meting.dag));
    const server = dagDeel(meting.dag).velden;
    expect(app.eigenVerbruik).toBeCloseTo(server.eigen_verbruik, 3);
    expect(app.zelfvoorzienend).toBeCloseTo(server.zelfvoorzienend, 3);
    // Zonder (een oudere brug): beide per kwartier, en weer gelijk.
    const oud = goedgekeurd(metStromen({}), new Date(NACHT + 11 * UUR));
    expect(dagOverzicht(dagUit(oud.dag))).toMatchObject({ eigenVerbruik: 1, zelfvoorzienend: 1 });
  });
});

describe('de Zonnebonus van een dag (ongeveer)', () => {
  it('per kwartier wat er naar het net ging maal de Zonnebonus van dat kwartier', () => {
    const d = goedgekeurd(rauw(), new Date(NACHT + 11 * UUR)).dag;
    // Kwartier 31 t/m 43 levert 150 W terug; de Zonnebonus geldt vanaf kwartier 32.
    const verwacht = 12 * (0.15 / 4) * 0.012;
    expect(zonnebonusVan(d, d.net_w, voorspelling())).toBeCloseTo(verwacht, 6);
    expect(dagDeel(d, voorspelling()).velden.zonnebonus_eur).toBeCloseTo(verwacht, 4);
  });

  it('zonder prijzen, of prijzen die de dag niet dekken: geen getal', () => {
    const d = goedgekeurd(rauw(), new Date(NACHT + 11 * UUR)).dag;
    expect(zonnebonusVan(d, d.net_w, null)).toBeNull();
    expect(zonnebonusVan(d, d.net_w, voorspelling(NACHT + 12 * UUR))).toBeNull();
    expect(zonnebonusVan(d, d.net_w, voorspelling(NACHT, 20))).toBeNull();
    expect(dagDeel(d, null).velden).not.toHaveProperty('zonnebonus_eur');
    // De prijzen van gisteren en vandaag samen (zo stuurt het programmaatje ze na 13:00) dekken vandaag wel.
    expect(zonnebonusVan(d, d.net_w, { ...voorspelling(NACHT - 24 * UUR, 192), zonnebonus_kwh: [...Array(96).fill(0), ...voorspelling().zonnebonus_kwh] })).toBeGreaterThan(0);
  });
});

describe('de dag uit meting.dag', () => {
  it('kWh, fasen, kwartieren en sinds', () => {
    const deel = dagDeel(goedgekeurd(rauw(), new Date(NACHT + 11 * UUR)).dag);
    expect(deel.datum).toBe('2026-10-30');
    expect(deel.velden).toMatchObject({
      zon_kwh: 4.2,
      huis_kwh: 5.1,
      geladen_kwh: 2.3,
      ontladen_kwh: 1.9,
      kwartieren: 40,
      sinds: new Date(NACHT + UUR).toISOString(),
      fasen: [
        { fase: 1, gemiddeld_a: 1.23, piek_a: 9 },
        { fase: 2, gemiddeld_a: 2.47, piek_a: 10 },
        { fase: 3, gemiddeld_a: 3.7, piek_a: 11 },
      ],
    });
    expect(deel.velden.eigen_verbruik).toBeGreaterThan(0.8);
    expect(deel.velden.zelfvoorzienend).toBeGreaterThan(0);
  });

  it('per uur van de klok het huis en de zon in Wh, voor Advies (de kwartieren van 0:00 tot 1:00 zonder meting)', () => {
    const v = dagDeel(goedgekeurd(rauw(), new Date(NACHT + 11 * UUR)).dag).velden;
    expect(v.huis_uur_wh).toHaveLength(24);
    expect(v.uur_kwartieren.slice(0, 12)).toEqual([0, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 0]);
    // 450 W een uur lang = 450 Wh; van 0:00 tot 1:00 niets gemeten.
    expect(v.huis_uur_wh.slice(0, 3)).toEqual([0, 450, 450]);
    // Kwartier 31 tot en met 43: 1.200 W zon; kwartier 31 is 7:45.
    expect(v.zon_uur_wh.slice(6, 11)).toEqual([0, 300, 1200, 1200, 1200]);
  });

  it('per uur ook op de dag dat de klok terug gaat: het dubbele uur 2:00 telt acht kwartieren', () => {
    // Zondag 25 oktober 2026: middernacht is 22:00 UTC (zomertijd), om 3:00 zomertijd wordt het 2:00.
    const van = Date.parse('2026-10-24T22:00:00Z');
    const d = goedgekeurd(rauw({ datum: '2026-10-25', van, kwartieren: 100 }), new Date(van + 20 * UUR)).dag;
    const v = dagDeel(d).velden;
    expect(v.uur_kwartieren[2]).toBe(8);
    expect(v.uur_kwartieren.reduce((a, b) => a + b, 0)).toBe(96);
  });

  it('een meting van een oudere brug (0.6.1, zelfde dag-vorm) geeft de uren ook; zonder huis per kwartier geen uren', () => {
    const d = goedgekeurd({ ...rauw(), bron: 'brug 0.6.1' }, new Date(NACHT + 11 * UUR)).dag;
    expect(dagDeel(d).velden.huis_uur_wh).toHaveLength(24);
    const zonder = { ...d, huis_w: undefined };
    expect(dagDeel(zonder).velden).not.toHaveProperty('huis_uur_wh');
  });

  it('per plek met panelen (brug 0.10.0) per uur in Wh; een oudere brug of één plek: niet apart', () => {
    const r = rauw();
    const n = r.dag.metingen.length;
    r.dag.zonnen = [
      { sleutel: 'hw-zon-huis', w: Array.from({ length: n }, (_, i) => (i > 30 ? 900 : 0)) },
      { sleutel: 'hw-zon-verblijf', w: Array.from({ length: n }, (_, i) => (i > 30 ? 300 : 0)) },
    ];
    const v = dagDeel(goedgekeurd(r, new Date(NACHT + 11 * UUR)).dag).velden;
    expect(v.zonnen_uur_wh.map((z) => z.sleutel)).toEqual(['hw-zon-huis', 'hw-zon-verblijf']);
    expect(v.zonnen_uur_wh[0].uur_wh.slice(6, 11)).toEqual([0, 225, 900, 900, 900]);
    expect(v.zonnen_uur_wh[1].uur_wh[8]).toBe(300);
    // Mild in controle.js: een plek met een rij van de verkeerde lengte valt weg, dan is er nog maar één: niet apart.
    const raar = rauw();
    raar.dag.zonnen = [r.dag.zonnen[0], { sleutel: 'hw-zon-verblijf', w: [1, 2, 3] }];
    const meting = goedgekeurd(raar, new Date(NACHT + 11 * UUR));
    expect(meting.dag).not.toHaveProperty('zonnen');
    expect(meting.dag.huis_w).toHaveLength(n);
    expect(dagDeel(meting.dag).velden).not.toHaveProperty('zonnen_uur_wh');
    expect(dagDeel(goedgekeurd(rauw(), new Date(NACHT + 11 * UUR)).dag).velden).not.toHaveProperty('zonnen_uur_wh');
  });

  it('wat niet klopt, telt niet', () => {
    const d = goedgekeurd(rauw(), new Date(NACHT + 11 * UUR)).dag;
    for (const fout of [null, { ...d, datum: '2026-13-01' }, { ...d, stap_min: 5 }, { ...d, metingen: [] }, { ...d, kwh: { ...d.kwh, zon: -1 } }, { ...d, kwh: null }]) {
      expect(dagDeel(fout), JSON.stringify(fout)?.slice(0, 40)).toBeNull();
    }
  });
});

describe('apparaten per dag (brug 0.12.0)', () => {
  const APPARATEN = [
    { sleutel: 'h:wasmachine', soort: 'wasmachine', kwh: 1.234, keer: 1 },
    { sleutel: 'hw-spa', naam: 'Spa', kwh: 6.4, keer: 9, gemeten: true },
    { sleutel: 'h:anders:kachel', soort: 'anders', naam: 'Kachel', kwh: 0.4, keer: 2 },
  ];

  it('in de rij van vandaag: per apparaat kWh, keer en of het gemeten is, meeste eerst, en de basis', async () => {
    const r = rauw();
    r.dag.apparaten = APPARATEN;
    r.dag.basis_kwh = 2.345;
    const meting = goedgekeurd(r, new Date(NACHT + 11 * UUR));
    expect(meting.dag.apparaten.map((a) => a.sleutel)).toEqual(['hw-spa', 'h:wasmachine', 'h:anders:kachel']);
    const { db, rijen, dagAanroepen } = nepDb();
    await boekDag(db, 'huis-dirk001', meting, op(NACHT + 11 * UUR), new Map());
    // Geen aanroep extra: dezelfde schrijfbeurt als de rest van de dag.
    expect(dagAanroepen()).toHaveLength(2);
    expect(rijen()[0].apparaten_kwh).toEqual([
      { sleutel: 'hw-spa', naam: 'Spa', kwh: 6.4, keer: 9, gemeten: true },
      { sleutel: 'h:wasmachine', soort: 'wasmachine', kwh: 1.234, keer: 1, gemeten: false },
      { sleutel: 'h:anders:kachel', soort: 'anders', naam: 'Kachel', kwh: 0.4, keer: 2, gemeten: false },
    ]);
    expect(rijen()[0].basis_kwh).toBe(2.345);
  });

  it('mild: een regel die niet klopt valt weg, de dag niet; een lijst die geen lijst is ook', () => {
    const r = rauw();
    r.dag.apparaten = [
      ...APPARATEN,
      { sleutel: 'hw-spa', kwh: 3, keer: 1, gemeten: true },
      { sleutel: 'met spatie', kwh: 1, keer: 1 },
      { sleutel: 'h:raar', kwh: -1, keer: 1 },
      { sleutel: 'h:raar2', kwh: 1, keer: 1.5 },
      { sleutel: 'h:geheim', soort: 'kernreactor', kwh: 0.2, keer: 1, extra: 'x' },
      null,
    ];
    r.dag.basis_kwh = 'veel';
    const { dag } = goedgekeurd(r, new Date(NACHT + 11 * UUR));
    expect(dag.apparaten.map((a) => a.sleutel)).toEqual(['hw-spa', 'h:wasmachine', 'h:anders:kachel', 'h:geheim']);
    expect(dag.apparaten.at(-1)).toEqual({ sleutel: 'h:geheim', kwh: 0.2, keer: 1, gemeten: false });
    expect(dag).not.toHaveProperty('basis_kwh');
    expect(dag.huis_w).toHaveLength(r.dag.metingen.length);
    const lijst = rauw();
    lijst.dag.apparaten = { 'hw-spa': 3 };
    expect(goedgekeurd(lijst, new Date(NACHT + 11 * UUR)).dag).not.toHaveProperty('apparaten');
    const veel = rauw();
    veel.dag.apparaten = Array.from({ length: 50 }, (_, i) => ({ sleutel: `h:x${i}`, kwh: i / 10, keer: 1 }));
    const uit = goedgekeurd(veel, new Date(NACHT + 11 * UUR)).dag.apparaten;
    expect(uit).toHaveLength(30);
    expect(uit[0].kwh).toBeGreaterThanOrEqual(uit.at(-1).kwh);
  });

  it('een oudere brug (0.11.0 en ouder) stuurt ze niet: geen veld in de rij, de rest zoals altijd', async () => {
    const meting = goedgekeurd({ ...rauw(), bron: 'brug 0.11.0' }, new Date(NACHT + 11 * UUR));
    expect(meting.dag).not.toHaveProperty('apparaten');
    const v = dagDeel(meting.dag).velden;
    expect(v).not.toHaveProperty('apparaten_kwh');
    expect(v).not.toHaveProperty('basis_kwh');
    expect(v.huis_kwh).toBe(5.1);
  });
});

describe('wat de omvormer over de dag zegt (GoodWe)', () => {
  it('wakker: de kWh van vandaag, de teller en bij welke zonnebron; slapend niet (dan kan het nog van gisteren zijn)', () => {
    expect(omvormerVan({ stand: 'normaal', vandaag_kwh: 12.345, totaal_kwh: 23456.78, bij: 'hw-zon-huis' })).toEqual({ omvormer_kwh: 12.35, omvormer_totaal_kwh: 23456.8, omvormer_bij: 'hw-zon-huis' });
    expect(omvormerVan({ stand: 'wacht', totaal_kwh: 100 })).toEqual({ omvormer_totaal_kwh: 100 });
    for (const stand of ['slaapt', 'weg', 'onbekend']) expect(omvormerVan({ stand, vandaag_kwh: 3, totaal_kwh: 100 })).toBeNull();
    expect(omvormerVan(null)).toBeNull();
    expect(omvormerVan({ stand: 'normaal', vandaag_kwh: -1 })).toBeNull();
  });

  it('komt in de rij van vandaag, zonder een aanroep extra', async () => {
    const { db, rijen, dagAanroepen } = nepDb();
    const nu = NACHT + 11 * UUR;
    const meting = goedgekeurd({ ...rauw(), omvormer: { stand: 'normaal', w: 800, vandaag_kwh: 3.4, totaal_kwh: 23456.7, bij: 'hw-zon-huis' } }, op(nu));
    await boekDag(db, 'huis-tim01', meting, op(nu), new Map());
    expect(dagAanroepen()).toHaveLength(2);
    expect(rijen()[0]).toMatchObject({ omvormer_kwh: 3.4, omvormer_totaal_kwh: 23456.7, omvormer_bij: 'hw-zon-huis' });
  });
});

/** Een db met de nep-Base44; `aanroepen` telt alleen de tabel Dag. */
function nepDb(rijen = []) {
  const nep = nepBase44({ rijen: { Dag: rijen } });
  const db = tabellen(nep.client.asServiceRole.entities, zonderWachten);
  const dagAanroepen = () => nep.stand.aanroepen.filter((a) => a.startsWith('Dag.'));
  return { nep, db, dagAanroepen, rijen: () => nep.tabellen.Dag.lijst };
}

const op = (ms) => new Date(ms);

describe('de rij van vandaag schrijven: hooguit één keer per kwartier', () => {
  it('de eerste keer meteen, daarna pas na een kwartier, en steeds in dezelfde rij', async () => {
    const { db, dagAanroepen, rijen } = nepDb();
    const geheugen = new Map();
    const t0 = NACHT + 11 * UUR;
    await boekDag(db, 'huis-tim01', goedgekeurd(rauw(), op(t0)), op(t0), geheugen);
    expect(dagAanroepen()).toEqual(['Dag.filter', 'Dag.create']);
    expect(rijen()).toHaveLength(1);
    expect(rijen()[0]).toMatchObject({ huis_id: 'huis-tim01', datum: '2026-10-30', afname_kwh: 1.234, zon_kwh: 4.2, bijgewerkt: new Date(t0).toISOString() });

    // Elke 5 seconden een meting: niets naar Base44 tot het kwartier om is.
    for (let s = 5; s < 900; s += 5) {
      await boekDag(db, 'huis-tim01', goedgekeurd(rauw({ afname: 1.3 }), op(t0 + s * 1000)), op(t0 + s * 1000), geheugen);
    }
    expect(dagAanroepen()).toHaveLength(2);
    await boekDag(db, 'huis-tim01', goedgekeurd(rauw({ afname: 1.4 }), op(t0 + KWARTIER_MS)), op(t0 + KWARTIER_MS), geheugen);
    expect(dagAanroepen()).toEqual(['Dag.filter', 'Dag.create', 'Dag.update']);
    expect(rijen()).toHaveLength(1);
    expect(rijen()[0].afname_kwh).toBe(1.4);
  });

  it('wat niet in elke meting zit (de dag, elke minuut) blijft bewaard tot het geschreven wordt', async () => {
    const { db, rijen } = nepDb();
    const geheugen = new Map();
    const t0 = NACHT + 11 * UUR;
    const zonderDag = (r) => ({ ...r, dag: undefined });
    await boekDag(db, 'huis-tim01', goedgekeurd(zonderDag(rauw()), op(t0)), op(t0), geheugen);
    await boekDag(db, 'huis-tim01', goedgekeurd(rauw({ zon: 5.5 }), op(t0 + 60_000)), op(t0 + 60_000), geheugen);
    await boekDag(db, 'huis-tim01', goedgekeurd(zonderDag(rauw({ afname: 2 })), op(t0 + KWARTIER_MS)), op(t0 + KWARTIER_MS), geheugen);
    expect(rijen()[0]).toMatchObject({ zon_kwh: 5.5, afname_kwh: 2, kwartieren: 40 });
  });

  it('na een herstart van de functie (leeg geheugen): de bestaande rij van vandaag, geen tweede', async () => {
    const { db, rijen, dagAanroepen } = nepDb();
    const t0 = NACHT + 11 * UUR;
    await boekDag(db, 'huis-tim01', goedgekeurd(rauw(), op(t0)), op(t0), new Map());
    await boekDag(db, 'huis-tim01', goedgekeurd(rauw({ afname: 3 }), op(t0 + 5000)), op(t0 + 5000), new Map());
    expect(rijen()).toHaveLength(1);
    expect(rijen()[0].afname_kwh).toBe(3);
    expect(dagAanroepen()).toEqual(['Dag.filter', 'Dag.create', 'Dag.filter', 'Dag.update']);
  });

  it('elk huis zijn eigen rij', async () => {
    const { db, rijen } = nepDb([{ id: 'dag-dirk', huis_id: 'huis-dirk001', datum: '2026-10-30', afname_kwh: 9 }]);
    const geheugen = new Map();
    const t0 = NACHT + 11 * UUR;
    await boekDag(db, 'huis-tim01', goedgekeurd(rauw(), op(t0)), op(t0), geheugen);
    expect(rijen()).toHaveLength(2);
    expect(rijen().find((r) => r.huis_id === 'huis-dirk001').afname_kwh).toBe(9);
  });

  it('is de rij weg (404), dan zoekt hij opnieuw en maakt zo nodig een nieuwe', async () => {
    const { db, nep, rijen } = nepDb();
    const geheugen = new Map();
    const t0 = NACHT + 11 * UUR;
    await boekDag(db, 'huis-tim01', goedgekeurd(rauw(), op(t0)), op(t0), geheugen);
    nep.tabellen.Dag.lijst.length = 0;
    await boekDag(db, 'huis-tim01', goedgekeurd(rauw({ afname: 4 }), op(t0 + KWARTIER_MS)), op(t0 + KWARTIER_MS), geheugen);
    expect(rijen()).toEqual([expect.objectContaining({ huis_id: 'huis-tim01', afname_kwh: 4 })]);
  });

  it('een datum die niet bij nu past, schrijft niets', async () => {
    const { db, dagAanroepen } = nepDb();
    const t0 = NACHT + 11 * UUR;
    // controleerMeting kijkt alleen naar de vorm; de dag zelf moet ook kloppen.
    await boekDag(db, 'huis-tim01', goedgekeurd(rauw({ datum: '2026-10-20' }), op(t0)), op(t0), new Map());
    expect(dagAanroepen()).toEqual([]);
  });

  it('lukt schrijven niet, dan niet bij elke meting opnieuw maar over een minuut', async () => {
    const { db, nep, dagAanroepen, rijen } = nepDb();
    const geheugen = new Map();
    const t0 = NACHT + 11 * UUR;
    const echt = nep.tabellen.Dag.create;
    nep.tabellen.Dag.create = async () => {
      throw Object.assign(new Error('stuk'), { status: 500 });
    };
    const fout = vi.spyOn(console, 'error').mockImplementation(() => {});
    await boekDag(db, 'huis-tim01', goedgekeurd(rauw(), op(t0)), op(t0), geheugen);
    await boekDag(db, 'huis-tim01', goedgekeurd(rauw(), op(t0 + 5000)), op(t0 + 5000), geheugen);
    expect(dagAanroepen()).toEqual(['Dag.filter']);
    nep.tabellen.Dag.create = echt;
    await boekDag(db, 'huis-tim01', goedgekeurd(rauw(), op(t0 + OPNIEUW_MS)), op(t0 + OPNIEUW_MS), geheugen);
    expect(rijen()).toHaveLength(1);
    expect(fout).toHaveBeenCalledOnce();
    fout.mockRestore();
  });
});

describe('rond middernacht: de laatste stand van gisteren hoort bij gisteren', () => {
  it('begint een nieuwe dag, dan eerst gisteren afmaken, dan vandaag beginnen', async () => {
    const { db, rijen } = nepDb();
    const geheugen = new Map();
    const gisteren = NACHT - 24 * UUR;
    // 23:50: de rij van gisteren wordt geschreven.
    const t1 = NACHT - 10 * 60_000;
    await boekDag(db, 'huis-tim01', goedgekeurd(rauw({ datum: '2026-10-29', van: gisteren, kwartieren: 96, afname: 6 }), op(t1)), op(t1), geheugen);
    // 23:59:55: de laatste stand van gisteren (nog geen kwartier later, dus nog niet geschreven).
    const t2 = NACHT - 5000;
    await boekDag(db, 'huis-tim01', goedgekeurd(rauw({ datum: '2026-10-29', van: gisteren, kwartieren: 96, afname: 6.5, zon: 9 }), op(t2)), op(t2), geheugen);
    expect(rijen()[0]).toMatchObject({ datum: '2026-10-29', afname_kwh: 6 });
    // 00:00:05: een nieuwe dag (zonder dag-deel: dat komt elke minuut).
    const t3 = NACHT + 5000;
    await boekDag(db, 'huis-tim01', goedgekeurd({ ...rauw({ afname: 0.002 }), dag: undefined }, op(t3)), op(t3), geheugen);
    const [oud, nieuw] = rijen();
    expect(oud).toMatchObject({ datum: '2026-10-29', afname_kwh: 6.5, zon_kwh: 9, bijgewerkt: new Date(t3).toISOString() });
    expect(nieuw).toMatchObject({ datum: '2026-10-30', afname_kwh: 0.002 });
    expect(nieuw).not.toHaveProperty('zon_kwh');
  });

  it('een stand van gisteren die na de nieuwe dag nog binnenkomt, telt niet meer', async () => {
    const { db, rijen } = nepDb();
    const geheugen = new Map();
    const t = NACHT + 30_000;
    await boekDag(db, 'huis-tim01', goedgekeurd(rauw({ afname: 0.1 }), op(t)), op(t), geheugen);
    await boekDag(db, 'huis-tim01', goedgekeurd(rauw({ datum: '2026-10-29', van: NACHT - 24 * UUR, afname: 7 }), op(t + KWARTIER_MS)), op(t + KWARTIER_MS), geheugen);
    expect(rijen()).toEqual([expect.objectContaining({ datum: '2026-10-30', afname_kwh: 0.1 })]);
  });
});

describe('ontvangMeting met de dag erbij', () => {
  const SLEUTEL = '0123456789abcdef'.repeat(3);

  it('de meting en de dag; de tweede meting kost maar één aanroep', async () => {
    const nep = nepBase44({ rijen: { Huis: [{ id: 'huis-tim01', naam: 'Thuis', brug_sleutel_hash: await sha256Hex(SLEUTEL) }] } });
    const opties = { geheugen: new Map(), dagGeheugen: new Map(), geduld: zonderWachten };
    const stuur = async (ms, lichaam = rauw()) => {
      const res = await behandelMeting(verzoek(lichaam, { kop: { 'x-brug-sleutel': SLEUTEL } }), () => nep.client, { ...opties, nu: () => new Date(ms) });
      return { status: res.status, data: await res.json() };
    };
    const t0 = NACHT + 11 * UUR;
    expect(await stuur(t0)).toEqual({ status: 200, data: { ok: true } });
    expect(nep.tabellen.Dag.lijst).toEqual([expect.objectContaining({ huis_id: 'huis-tim01', datum: '2026-10-30', kosten_eur: 0.31 })]);
    nep.stand.aanroepen.length = 0;
    expect((await stuur(t0 + 5000)).status).toBe(200);
    // Het huis bij de sleutel staat nog in het geheugen (toegang.js, huisBijSleutel).
    expect(nep.stand.aanroepen).toEqual(['Meting.update']);
  });

  it('gaat de dag mis, dan staat de meting er toch en hoort het programmaatje ok', async () => {
    const nep = nepBase44({ rijen: { Huis: [{ id: 'huis-tim01', naam: 'Thuis', brug_sleutel_hash: await sha256Hex(SLEUTEL) }] } });
    nep.tabellen.Dag.filter = async () => {
      throw Object.assign(new Error('Rate limit exceeded'), { status: 429 });
    };
    const fout = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await behandelMeting(verzoek(rauw(), { kop: { 'x-brug-sleutel': SLEUTEL } }), () => nep.client, {
      geheugen: new Map(),
      dagGeheugen: new Map(),
      geduld: zonderWachten,
      nu: () => new Date(NACHT + 11 * UUR),
    });
    expect(res.status).toBe(200);
    expect(nep.tabellen.Meting.lijst).toHaveLength(1);
    fout.mockRestore();
  });
});
