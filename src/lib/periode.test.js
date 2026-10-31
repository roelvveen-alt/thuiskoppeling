import { describe, expect, it } from 'vitest';
import { zonnebonusVan as zonnebonusOpDeServer } from '../../base44/functions/ontvangMeting/dagboek.js';
import { dagUit, voorspellingUit } from './bron';
import { dagOverzicht, delenVan } from './dagoverzicht';
import { dagenUit, dagNaam, dagNummer, metVandaag, periodeVan, reeksenVoor, stavenVan, titelVan, totalenVan, weekNummer, zonnebonusVan } from './periode';

const op = (iso) => Date.parse(iso);
const bereik = (keuze, iso) => {
  const p = periodeVan(keuze, op(iso));
  return `${p.van} t/m ${p.tot}`;
};

describe('welke dagen bij een periode horen (Nederlandse tijd)', () => {
  it('week: maandag t/m zondag', () => {
    expect(bereik('week', '2026-10-30T11:00:00Z')).toBe('2026-10-26 t/m 2026-11-01');
    // Zondagavond 23:30 hoort nog bij deze week, maandag 00:30 bij de volgende.
    expect(bereik('week', '2026-11-01T22:30:00Z')).toBe('2026-10-26 t/m 2026-11-01');
    expect(bereik('week', '2026-11-01T23:30:00Z')).toBe('2026-11-02 t/m 2026-11-08');
  });

  it('week: ook in het weekend dat de klok verzet wordt', () => {
    // Wintertijd vanaf zondag 25 oktober: 23:30 die zondag is 22:30 UTC, maandag 00:00 is 23:00 UTC.
    expect(bereik('week', '2026-10-25T22:30:00Z')).toBe('2026-10-19 t/m 2026-10-25');
    expect(bereik('week', '2026-10-25T23:00:00Z')).toBe('2026-10-26 t/m 2026-11-01');
    // Zomertijd vanaf zondag 29 maart: 23:59 die zondag is 21:59 UTC, maandag 00:00 is 22:00 UTC.
    expect(bereik('week', '2026-03-29T21:59:00Z')).toBe('2026-03-23 t/m 2026-03-29');
    expect(bereik('week', '2026-03-29T22:00:00Z')).toBe('2026-03-30 t/m 2026-04-05');
  });

  it('maand: de eerste t/m de laatste, ook in februari', () => {
    expect(bereik('maand', '2026-10-30T11:00:00Z')).toBe('2026-10-01 t/m 2026-10-31');
    expect(bereik('maand', '2026-10-31T23:30:00Z')).toBe('2026-11-01 t/m 2026-11-30');
    expect(bereik('maand', '2027-02-10T12:00:00Z')).toBe('2027-02-01 t/m 2027-02-28');
    expect(bereik('maand', '2028-02-10T12:00:00Z')).toBe('2028-02-01 t/m 2028-02-29');
  });

  it('kwartaal: januari–maart, april–juni, juli–september, oktober–december', () => {
    expect(bereik('kwartaal', '2026-10-30T11:00:00Z')).toBe('2026-10-01 t/m 2026-12-31');
    // 31 maart 23:30 zomertijd is 21:30 UTC; 1 april 00:30 is 22:30 UTC.
    expect(bereik('kwartaal', '2026-03-31T21:30:00Z')).toBe('2026-01-01 t/m 2026-03-31');
    expect(bereik('kwartaal', '2026-03-31T22:30:00Z')).toBe('2026-04-01 t/m 2026-06-30');
    expect(bereik('kwartaal', '2026-08-15T12:00:00Z')).toBe('2026-07-01 t/m 2026-09-30');
  });

  it('jaar, en de jaarwisseling', () => {
    expect(bereik('jaar', '2026-12-31T22:59:00Z')).toBe('2026-01-01 t/m 2026-12-31');
    expect(bereik('jaar', '2026-12-31T23:00:00Z')).toBe('2027-01-01 t/m 2027-12-31');
    // De week rond nieuwjaar loopt over twee jaren.
    expect(bereik('week', '2026-12-31T23:30:00Z')).toBe('2026-12-28 t/m 2027-01-03');
    expect(periodeVan('vandaag', op('2026-12-31T23:30:00Z'))).toMatchObject({ van: '2027-01-01', tot: '2027-01-01', vandaag: '2027-01-01' });
  });

  it('weeknummers zoals op de kalender', () => {
    const wk = (datum) => weekNummer(dagNummer(datum));
    expect(wk('2026-01-01')).toBe(1);
    expect(wk('2026-10-30')).toBe(44);
    expect(wk('2026-12-31')).toBe(53);
    expect(wk('2027-01-03')).toBe(53);
    expect(wk('2027-01-04')).toBe(1);
    expect(wk('2024-12-30')).toBe(1);
  });

  it('namen en koppen', () => {
    expect(dagNaam('2026-10-30')).toBe('vrijdag 30 oktober');
    expect(dagNummer('2026-02-30')).toBeNull();
    const nu = op('2026-10-30T11:00:00Z');
    expect(titelVan(periodeVan('week', nu))).toEqual({ titel: 'Deze week', bereik: '26\u00a0okt – 1\u00a0nov' });
    expect(titelVan(periodeVan('maand', nu))).toEqual({ titel: 'Deze maand', bereik: 'oktober 2026' });
    expect(titelVan(periodeVan('kwartaal', nu))).toEqual({ titel: 'Dit kwartaal', bereik: 'oktober t/m december 2026' });
    expect(titelVan(periodeVan('jaar', nu))).toEqual({ titel: 'Dit jaar', bereik: '2026' });
  });
});

describe('de staven: per dag, per week of per maand', () => {
  const nu = op('2026-10-30T11:00:00Z');

  it('week: zeven dagen, ma t/m zo', () => {
    const staven = stavenVan(periodeVan('week', nu));
    expect(staven.map((s) => s.kort)).toEqual(['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo']);
    expect(staven[4]).toEqual({ van: '2026-10-30', tot: '2026-10-30', kort: 'vr', lang: 'vrijdag 30 oktober' });
  });

  it('maand: elke dag, met het dagnummer', () => {
    const staven = stavenVan(periodeVan('maand', nu));
    expect(staven).toHaveLength(31);
    expect(staven.at(-1)).toMatchObject({ van: '2026-10-31', kort: '31' });
  });

  it('kwartaal: per week, de eerste en laatste afgekapt op het kwartaal', () => {
    const staven = stavenVan(periodeVan('kwartaal', nu));
    expect(staven).toHaveLength(14);
    expect(staven[0]).toEqual({ van: '2026-10-01', tot: '2026-10-04', kort: '40', lang: 'week 40 · 1\u00a0okt – 4\u00a0okt' });
    expect(staven[1]).toMatchObject({ van: '2026-10-05', tot: '2026-10-11', kort: '41' });
    expect(staven.at(-1)).toMatchObject({ van: '2026-12-28', tot: '2026-12-31', kort: '53' });
    // Samen precies het kwartaal, zonder gaten.
    const dagen = staven.reduce((t, s) => t + dagNummer(s.tot) - dagNummer(s.van) + 1, 0);
    expect(dagen).toBe(92);
  });

  it('jaar: per maand', () => {
    const staven = stavenVan(periodeVan('jaar', nu));
    expect(staven.map((s) => s.kort)).toEqual(['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']);
    expect(staven[1]).toMatchObject({ van: '2026-02-01', tot: '2026-02-28', lang: 'februari 2026' });
  });
});

/** Een dag zoals de server hem geeft (actie periode). */
const rij = (datum, extra = {}) => ({
  datum,
  zon_kwh: 10,
  huis_kwh: 12,
  geladen_kwh: 5,
  ontladen_kwh: 4.5,
  afname_kwh: 6,
  teruglevering_kwh: 4,
  kosten_eur: 1.5,
  opbrengst_eur: 1,
  vaste_kosten_eur: -0.2,
  zonnebonus_eur: 0.03,
  compleet: true,
  eigen_verbruik: 0.6,
  zelfvoorzienend: 0.5,
  fasen: [
    { fase: 1, gemiddeld_a: 3, piek_a: 12 },
    { fase: 2, gemiddeld_a: 2, piek_a: 9 },
  ],
  kwartieren: 96,
  ...extra,
});

describe('de dagen van de server', () => {
  it('schoon, op datum, elke datum één keer', () => {
    const dagen = dagenUit([rij('2026-10-28'), rij('2026-10-27'), rij('2026-10-28', { zon_kwh: 99 }), { datum: 'gisteren' }, null, rij('2026-10-29', { eigen_verbruik: 1.4, zon_kwh: 'veel' })]);
    expect(dagen.map((d) => d.datum)).toEqual(['2026-10-27', '2026-10-28', '2026-10-29']);
    expect(dagen[1].zon).toBe(10);
    expect(dagen[2]).toMatchObject({ zon: null, eigenVerbruik: 1 });
    expect(dagenUit('rommel')).toEqual([]);
  });
});

describe('wat de dagen samen zijn', () => {
  it('sommen, netto, gemiddelde prijzen en gewogen percentages', () => {
    const t = totalenVan(dagenUit([rij('2026-10-26'), rij('2026-10-27', { zon_kwh: 30, eigen_verbruik: 0.2, kosten_eur: 0.5, opbrengst_eur: 3 })]));
    expect(t).toMatchObject({ dagen: 2, eerste: '2026-10-26', zon: 40, huis: 24, afname: 12, terug: 8, kosten: 2, opbrengst: 4, compleet: true, zonderVast: 0 });
    expect(t.vast).toBeCloseTo(-0.4);
    expect(t.netto).toBeCloseTo(2 - 4 - 0.4);
    expect(t.bonus).toBeCloseTo(0.06);
    expect(t.afnamePrijs).toBeCloseTo(2 / 12);
    expect(t.terugPrijs).toBeCloseTo(4 / 8);
    // Eigen verbruik naar de zon gewogen: (0,6 × 10 + 0,2 × 30) / 40.
    expect(t.eigenVerbruik).toBeCloseTo(0.3);
    expect(t.zelfvoorzienend).toBeCloseTo(0.5);
    expect(t.fasen).toEqual([
      { fase: 1, gemiddeldA: 3, piekA: 12, dagen: 2 },
      { fase: 2, gemiddeldA: 2, piekA: 9, dagen: 2 },
    ]);
  });

  it('wat geen enkele dag had, is er niet; een dag zonder prijs maakt het onvolledig', () => {
    const zonderGeld = { kosten_eur: undefined, opbrengst_eur: undefined, vaste_kosten_eur: undefined, zonnebonus_eur: undefined, afname_kwh: undefined, teruglevering_kwh: undefined };
    const t = totalenVan(dagenUit([rij('2026-10-26', zonderGeld)]));
    expect(t).toMatchObject({ kosten: null, opbrengst: null, netto: null, bonus: null, afnamePrijs: null, zon: 10 });
    const deels = totalenVan(dagenUit([rij('2026-10-26', { compleet: false }), rij('2026-10-27', { vaste_kosten_eur: null })]));
    expect(deels).toMatchObject({ compleet: false, zonderVast: 1 });
    expect(totalenVan([])).toMatchObject({ dagen: 0, eerste: null, zon: null, netto: null, eigenVerbruik: null });
  });
});

describe('per staaf, voor de grafieken', () => {
  it('per week de som van de dagen erin; een week zonder dagen is leeg, niet nul', () => {
    const periode = periodeVan('kwartaal', op('2026-10-30T11:00:00Z'));
    const staven = stavenVan(periode);
    const dagen = dagenUit([rij('2026-10-26'), rij('2026-10-27'), rij('2026-10-30', { zon_kwh: 5 })]);
    const r = reeksenVoor(staven, dagen);
    const week44 = staven.findIndex((s) => s.kort === '44');
    expect(r.zon[week44]).toBe(25);
    expect(r.dagen[week44]).toBe(3);
    expect(r.zon[0]).toBeNull();
    expect(r.netto[week44]).toBeCloseTo(3 * (1.5 - 1 - 0.2));
    expect(r.fasen.map((f) => f.fase)).toEqual([1, 2]);
    expect(r.fasen[0].reeks[week44]).toBe(3);
  });
});

describe('vandaag vers uit de stand', () => {
  const NACHT = op('2026-10-29T23:00:00Z');
  const stand = (datum) => ({
    vandaag: { datum, afname_kwh: 2, teruglevering_kwh: 7, kosten_eur: 0.4, opbrengst_eur: 1.6, vaste_kosten_eur: -0.21, compleet: true },
    dag: dagUit({
      datum,
      van: new Date(NACHT).toISOString(),
      stap_min: 15,
      sinds: new Date(NACHT).toISOString(),
      metingen: [180, 180, 0, 180],
      huis_w: [400, 400, 0, 400],
      zon_w: [0, 1000, 0, 2000],
      batterij_w: [400, -300, 0, -1000],
      net_w: [0, -300, 0, -600],
      kwh: { zon: 11, huis: 9, geladen: 4, ontladen: 3 },
      fasen: [{ fase: 1, a: [1, 2, 0, 3], w: [100, 200, 0, 300], gemiddeld_a: 2.5, piek_a: 11 }],
    }),
  });

  it('vervangt de rij van vandaag (die is hooguit een kwartier oud)', () => {
    const dagen = metVandaag(dagenUit([rij('2026-10-29'), rij('2026-10-30', { zon_kwh: 1 })]), stand('2026-10-30'), '2026-10-30');
    expect(dagen.map((d) => d.datum)).toEqual(['2026-10-29', '2026-10-30']);
    expect(dagen[1]).toMatchObject({ zon: 11, huis: 9, afname: 2, kosten: 0.4, vast: -0.21, kwartieren: 3, fasen: [{ fase: 1, gemiddeldA: 2.5, piekA: 11 }] });
    expect(dagen[1].eigenVerbruik).toBeGreaterThan(0);
  });

  it('zet vandaag erbij als de server hem nog niet had; een stand van gisteren telt niet', () => {
    expect(metVandaag([], stand('2026-10-30'), '2026-10-30').map((d) => d.datum)).toEqual(['2026-10-30']);
    const oud = dagenUit([rij('2026-10-30')]);
    expect(metVandaag(oud, stand('2026-10-29'), '2026-10-30')).toBe(oud);
    // Het voorbeeld heeft geen datum: dat is vandaag.
    expect(metVandaag([], stand(null), '2026-10-30')[0]).toMatchObject({ datum: '2026-10-30', zon: 11 });
  });

  it('Vandaag en de Week rekenen zelfvoorzienend en eigen verbruik op één plek (delenVan), uit dezelfde kWh (proces-14)', () => {
    // Zoals OverzichtVandaag: de kWh van de dag en van de meterkast van vandaag.
    const s = stand('2026-10-30');
    const vandaag = delenVan({ zon: s.dag.kwh.zon, huis: s.dag.kwh.huis, afname: s.vandaag.afname_kwh, terug: s.vandaag.teruglevering_kwh });
    // Zoals OverzichtPeriode: de totalen van de dagen, met vandaag vers uit de stand.
    const t = totalenVan(metVandaag(dagenUit([]), s, '2026-10-30'));
    expect(delenVan({ zon: t.zon, huis: t.huis, afname: t.afname, terug: t.terug })).toEqual(vandaag);
    expect(vandaag.zelfvoorzienend).toBeCloseTo(1 - 2 / 9);
    // Een week: dezelfde regel op de sommen van de dagen.
    const week = totalenVan(metVandaag(dagenUit([rij('2026-10-28'), rij('2026-10-29')]), s, '2026-10-30'));
    expect(delenVan({ zon: week.zon, huis: week.huis, afname: week.afname, terug: week.terug }).zelfvoorzienend).toBeCloseTo(1 - week.afname / week.huis);
  });

  it("netstroom die 's nachts via de batterij naar het huis ging, telt als uit het net (weergave-19)", () => {
    // Geen zon: 's nachts laadt de batterij 1 kWh uit het net (en het huis neemt 0,2 kWh uit het net), 's avonds levert hij die 1 kWh aan het huis.
    const ruw = {
      datum: '2026-10-30',
      van: new Date(NACHT).toISOString(),
      stap_min: 15,
      sinds: new Date(NACHT).toISOString(),
      metingen: [180, 180, 180, 180],
      huis_w: [200, 200, 1000, 1000],
      zon_w: [0, 0, 0, 0],
      batterij_w: [-2000, -2000, 2000, 2000],
      net_w: [2200, 2200, -1000, -1000],
      kwh: { zon: 0, huis: 1.2, geladen: 1, ontladen: 1 },
    };
    const dag = dagUit(ruw);
    // Op het scherm (kaart Energie): uit het net 1,1 kWh tegen 1,2 kWh in huis: bijna niets zelf.
    expect(delenVan({ zon: 0, huis: dag.kwh.huis, afname: 1.1, terug: 0.5 }).zelfvoorzienend).toBeCloseTo(1 - 1.1 / 1.2);
    // De verdeling per kwartier (alleen nog het veld in de tabel Dag, niet op het scherm) telde de batterij als eigen.
    expect(dagOverzicht(dag).zelfvoorzienend).toBeGreaterThan(0.5);
  });

  it('de Zonnebonus van vandaag: dezelfde som als de server voor elke dag', () => {
    const ruweDag = {
      datum: '2026-10-30',
      van: new Date(NACHT).toISOString(),
      stap_min: 15,
      sinds: new Date(NACHT).toISOString(),
      metingen: [180, 180, 0, 180],
      huis_w: [400, 400, 0, 400],
      net_w: [0, -300, 0, -600],
      kwh: { zon: 1, huis: 1, geladen: 0, ontladen: 0 },
    };
    const ruweVoorspelling = { van: new Date(NACHT).toISOString(), stap_min: 15, afname_kwh: [0.2, 0.2, 0.2, 0.2], teruglevering_kwh: [0.2, 0.2, 0.2, 0.2], zonnebonus_kwh: [0, 0.01, 0.01, 0.02] };
    const site = zonnebonusVan(dagUit(ruweDag), voorspellingUit(ruweVoorspelling));
    expect(site).toBeCloseTo((0.3 / 4) * 0.01 + (0.6 / 4) * 0.02, 6);
    // De server rondt af op hele honderdsten van een cent.
    expect(zonnebonusOpDeServer(ruweDag, ruweDag.net_w, ruweVoorspelling)).toBeCloseTo(site, 3);
    expect(zonnebonusVan(dagUit(ruweDag), null)).toBeNull();
  });
});
