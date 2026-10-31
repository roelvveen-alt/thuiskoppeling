import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { standUitRij } from '@/lib/bron';
import {
  basisKort,
  gewoonteZin,
  HOOGSTENS_VRAGEN,
  kaartStand,
  kennisRegels,
  kennisZin,
  KEUZES,
  labelVoor,
  labelVoorGroep,
  laterLabel,
  nachtZin,
  nuPerZekerheid,
  nuRegel,
  onbekendZin,
  regelNaam,
  SOORTEN,
  uitklapTitel,
  vraagZinnen,
  vragenVan,
  weekRegels,
  zekerWoord,
} from '@/lib/herkennen';
import Herkennen from './Herkennen';
import TabApparaten from './TabApparaten';

const MOMENT = '2026-10-30T12:00:00.000Z';
const NU = Date.parse('2026-10-30T12:00:05Z');
const HERKEND = {
  moment: MOMENT,
  nu: [
    { id: 'a-1', soort: 'koelkast', w: 110, zeker: 0.5, sinds: '2026-10-30T11:50:00Z' },
    { id: 'a-2', soort: 'wasmachine', deel: 'verwarmt', w: 2100, zeker: 0.65, sinds: '2026-10-30T11:40:00Z' },
    { id: 'a-3', w: 300, zeker: 0.1, sinds: '2026-10-30T11:55:00Z' },
  ],
  recent: [
    { id: 'a-4', soort: 'waterkoker', w: 2200, zeker: 0.7, van: '2026-10-30T09:00:00Z', tot: '2026-10-30T09:03:00Z' },
    { id: 'a-5', soort: 'anders', naam: 'Aquariumpomp', w: 60, zeker: 1, bevestigd: true, van: '2026-10-30T08:00:00Z', tot: '2026-10-30T08:15:00Z' },
    { id: 'a-6', w: 1200, zeker: 0.2, onbekend: 'A', van: '2026-10-30T07:00:00Z', tot: '2026-10-30T07:20:00Z' },
    { id: 'a-7', soort: 'oven', w: 2500, zeker: 0.7, van: '2026-10-29T09:00:00Z', tot: '2026-10-29T10:00:00Z' },
  ],
  onbekend: [{ id: 'g-a-6', letter: 'A', w: 1200, duur_s: 1200, n: 4, dagdeel: 'avond', fase: 1 }],
  basis: { w: 450, altijd_w: 380, warmtepomp: true },
  week: { van: '2026-10-26', apparaten: [{ sleutel: 'hw-spa', naam: 'Spa', keer: 12, kwh: 25.2, dagdeel: 'avond' }, { soort: 'wasmachine', keer: 3, kwh: 3.1, dag: 5, dagdeel: 'ochtend' }] },
};
const RIJ = { moment: MOMENT, net_w: 100, brug: { versie: '0.11.0+abc1234', gestart: '2026-10-30T06:00:00Z', elke_seconden: 5 }, herkend: HERKEND };

const kaart = (props = {}) => {
  const stand = standUitRij(props.rij ?? RIJ);
  return renderToStaticMarkup(<Herkennen herkend={stand.herkend} brugVersie={stand.brug?.versie ?? null} eigenaar nu={NU} onLabel={async () => true} {...props} />);
};

describe('herkennen in woorden', () => {
  it('eerlijke zekerheid: zeker, waarschijnlijk, misschien, of onbekend', () => {
    expect(zekerWoord(0.9)).toBe('zeker');
    expect(zekerWoord(0.3, true)).toBe('zeker');
    expect(zekerWoord(0.65)).toBe('waarschijnlijk');
    expect(zekerWoord(0.4)).toBe('misschien');
    expect(zekerWoord(0.2)).toBeNull();
    expect(regelNaam({ soort: 'wasmachine', deel: 'verwarmt', zeker: 0.65 })).toBe('Wasmachine, verwarmt');
    expect(regelNaam({ soort: 'koelkast', zeker: 0.2, onbekend: 'B' })).toBe('Onbekend apparaat B');
    expect(regelNaam({ soort: 'koelkast', zeker: 0.2 })).toBe('Iets onbekends');
  });

  it('nu per zekerheid, het zekerst eerst', () => {
    const groepen = nuPerZekerheid(standUitRij(RIJ).herkend.nu);
    expect(groepen.map((g) => g.kop)).toEqual(['Waarschijnlijk aan', 'Misschien aan', 'Ook aan, nog onbekend']);
  });

  it('de hoofdregel: wat er nu aan staat in één regel, het zekerst eerst, of niets', () => {
    expect(nuRegel(standUitRij(RIJ).herkend.nu)).toBe('Wasmachine, verwarmt (2,1 kW, waarschijnlijk), Koelkast (110 W, misschien) en Iets onbekends (300 W)');
    expect(nuRegel([{ id: 'x', soort: 'koelkast', w: 110, zeker: 0.95 }])).toBe('Koelkast (110 W)');
    expect(nuRegel([])).toBeNull();
  });

  it('de basis kort: altijd aan, met de warmtepomp als die meetelt; de nacht apart', () => {
    expect(basisKort({ w: 450, altijd_w: 380, warmtepomp: true })).toBe('Altijd aan, met de warmtepomp: zo’n 450 W');
    expect(basisKort({ w: 196, altijd_w: 190, warmtepomp: false })).toBe('Altijd aan: zo’n 200 W');
    expect(basisKort(null)).toBeNull();
    expect(nachtZin({ w: 450, altijd_w: 380, warmtepomp: true })).toBe('’s nachts op z’n laagst zo’n 380 W');
    expect(nachtZin({ w: 200, altijd_w: 190, warmtepomp: false })).toBeNull();
    expect(nachtZin({ w: 200, altijd_w: null, warmtepomp: false })).toBeNull();
  });

  it('het kopje van het uitklapblok: aanwijzen alleen voor de eigenaar, met de open vragen', () => {
    expect(uitklapTitel({ eigenaar: true, nu: 2, eerder: 3, onbekend: 1, vragen: 1 })).toBe('Eerder vandaag en aanwijzen (1 vraag)');
    expect(uitklapTitel({ eigenaar: true, nu: 1, eerder: 0, onbekend: 2, vragen: 2 })).toBe('Aanwijzen wat het is (2 vragen)');
    expect(uitklapTitel({ eigenaar: false, nu: 2, eerder: 3, onbekend: 1 })).toBe('Eerder vandaag');
    expect(uitklapTitel({ eigenaar: false, nu: 2, eerder: 0, onbekend: 1 })).toBe('Onbekende apparaten');
    expect(uitklapTitel({ eigenaar: true })).toBe('Meer');
  });

  it('onbekend, gewoonte en de week in woorden, met euro’s tegen de prijs van nu', () => {
    expect(onbekendZin(standUitRij(RIJ).herkend.onbekend[0])).toBe('Onbekend apparaat A: zo’n 1,2 kW, zo’n 20 minuten, meestal ’s avonds, op L1 (4 keer gezien)'.replace('’s avonds', "'s avonds"));
    expect(gewoonteZin({ dag: 5, dagdeel: 'ochtend' })).toBe('meestal zaterdagochtend');
    const week = weekRegels(standUitRij(RIJ).herkend.week, { prijs: { afname_kwh: 0.3 }, namen: { 'hw-spa': 'Spa buiten' } });
    expect(week[0]).toMatchObject({ naam: 'Spa buiten', gewoonte: "meestal 's avonds" });
    expect(week[0].tekst).toBe('12 keer, 25,2 kWh, zo’n € 7,56');
    expect(week[1]).toMatchObject({ naam: 'Wasmachine', gewoonte: 'meestal zaterdagochtend' });
  });

  it('de labels voor de functie: Klopt (was = soort), Dat was …, en een hele groep', () => {
    const r = standUitRij(RIJ).herkend.recent[0];
    expect(labelVoor(r, { soort: 'waterkoker' })).toEqual({ id: 'a-4', soort: 'waterkoker', w: 2200, duur_s: 180, was: 'waterkoker' });
    expect(labelVoor(r, { soort: 'anders', naam: 'Theekoker' })).toMatchObject({ soort: 'anders', naam: 'Theekoker', was: 'waterkoker' });
    expect(labelVoorGroep(standUitRij(RIJ).herkend.onbekend[0], { soort: 'anders', naam: 'Kachel' })).toEqual({ id: 'g-a-6', soort: 'anders', naam: 'Kachel', w: 1200, duur_s: 1200, fase: 1, aantal: 4 });
  });

  it('welke kaart: geen brug niets, een oudere brug "werk bij", een nieuwe nog zonder blok "even geduld"', () => {
    expect(kaartStand(null, null)).toBe('niets');
    expect(kaartStand(null, '0.10.0+abc')).toBe('bijwerken');
    expect(kaartStand(null, '0.11.0')).toBe('geduld');
    expect(kaartStand({}, '0.10.0')).toBe('kaart');
  });
});

// Wat er buiten het uitklapblok staat (dat is altijd te zien).
const boven = (html) => html.split('<details')[0];

describe('de kaart "Wat gebruikt er nu stroom?"', () => {
  it('kort: één hoofdregel en de altijd-aan; de rest in een blok dat dicht staat', () => {
    const html = kaart();
    expect(html).toContain('Wat gebruikt er nu stroom?');
    const zichtbaar = boven(html);
    expect(zichtbaar).toContain('Nu aan:</span> Wasmachine, verwarmt (2,1 kW, waarschijnlijk), Koelkast (110 W, misschien) en Iets onbekends (300 W)');
    expect(zichtbaar).toContain('Altijd aan, met de warmtepomp: zo’n 450 W');
    // Eerder vandaag, de vraag en het aanwijzen staan pas in het blok, en dat staat dicht.
    for (const tekst of ['Eerder vandaag', 'Klopt het?', 'Wat is dit?', 'Dat was…', '<button', '<select', 'nachts']) expect(zichtbaar).not.toContain(tekst);
    expect(html).toMatch(/<details class="[^"]*"><summary/);
    expect(html).toContain('Eerder vandaag en aanwijzen (1 vraag)');
    expect(html).toContain('Wat altijd aan staat, is ’s nachts op z’n laagst zo’n 380 W.');
  });

  it('in het blok: nu, wat is dit en eerder vandaag, met de knoppen voor de eigenaar (zoals eerst)', () => {
    const html = kaart();
    expect(html).toContain('Klopt het? Wijs het aan: zo leert het programmaatje jouw apparaten kennen.');
    expect(html).toContain('aria-label="Nu aan"');
    expect(html).toContain('Wat is dit?');
    expect(html).toContain('Onbekend apparaat A');
    expect(html).toContain('Dit is het');
    expect(html).toContain('Eerder vandaag');
    expect(html).toContain('Waterkoker');
    expect(html).toContain('Aquariumpomp');
    expect(html).toContain('Zo aangewezen');
    // Van gisteren staat er niet bij.
    expect(html).not.toContain('Oven (2,5');
    expect(html).toContain('Klopt');
    expect(html).toContain('Dat was…');
    // De week per apparaat staat op één plek (Overzicht › Week), niet hier met andere getallen.
    expect(html).not.toContain('Deze week');
    expect(html).not.toContain('25,2 kWh');
    expect(boven(kaart({ onWeek: () => {} })).length).toBeLessThan(kaart({ onWeek: () => {} }).length);
    expect(kaart({ onWeek: () => {} })).toContain('Per week of maand: Overzicht › Week');
    // Elke knop minstens 44 px: dat doet de klasse knop (en het kopje van het blok is min-h-11).
    expect(html.match(/<button/g).length).toBe((html.match(/class="knop/g) ?? []).length);
    expect(html).toMatch(/<summary class="[^"]*min-h-11/);
  });

  it('niets apart aan: dat zegt de hoofdregel', () => {
    const html = kaart({ rij: { ...RIJ, herkend: { ...HERKEND, nu: [] } } });
    expect(boven(html)).toContain('Nu staat er niets apart aan.');
    expect(html).not.toContain('aria-label="Nu aan"');
  });

  it('een brug zonder basis en zonder eerder: alleen de hoofdregel, geen leeg blok', () => {
    const html = kaart({ rij: { ...RIJ, herkend: { moment: MOMENT, nu: [] } }, eigenaar: false, onLabel: null });
    expect(html).toContain('Nu staat er niets apart aan.');
    expect(html).not.toContain('<details');
    expect(html).not.toContain('Altijd aan');
  });

  it('een kijker ziet alles, maar zonder knoppen om te labelen', () => {
    const html = kaart({ eigenaar: false, onLabel: null });
    expect(html).toContain('2,1 kW, waarschijnlijk');
    expect(html).not.toMatch(/<button|<select|<input/);
    expect(html).not.toContain('Klopt het?');
    expect(html).not.toContain('aria-label="Nu aan"');
    expect(html).toContain('<summary');
    expect(html).toContain('Eerder vandaag');
    expect(html).toContain('De eigenaar kan aanwijzen wat het is.');
  });

  it('een oudere brug: werk het programmaatje bij (de eigenaar leest hoe bij Het programmaatje thuis, een kijker hoort van de eigenaar)', () => {
    const oud = { ...RIJ, herkend: undefined, brug: { ...RIJ.brug, versie: '0.10.0+9b38d46' } };
    expect(kaart({ rij: oud })).toContain('bovenaan bij Het programmaatje thuis');
    expect(kaart({ rij: oud })).not.toMatch(/git pull|bijwerken\.sh/);
    expect(kaart({ rij: oud, eigenaar: false })).toContain('De eigenaar weet hoe je het bijwerkt.');
    // Zonder brugblok (heel oud): geen kaart.
    expect(kaart({ rij: { moment: MOMENT, net_w: 100 } })).toBe('');
  });

  it('een blok van minuten oud: geen "nu" meer, wel eerder vandaag', () => {
    const html = kaart({ rij: { ...RIJ, moment: '2026-10-30T12:10:00.000Z' } });
    expect(html).toContain('stuurde een paar minuten niets');
    expect(html).not.toContain('Nu aan:');
    expect(html).toContain('Eerder vandaag');
  });

  it('staat op het tabblad Apparaten, boven de lampen', () => {
    const html = renderToStaticMarkup(<TabApparaten stand={standUitRij(RIJ)} nu={NU} />);
    expect(html).toContain('Wat gebruikt er nu stroom?');
  });
});

/** Wat brug 1.4.0 meestuurt: een terugkerende groep met handtekening, en wat het kent. */
const VRAGEN = {
  ...HERKEND,
  onbekend: [
    { id: 'g-b', letter: 'B', w: 1800, duur_s: 2400, n: 5, vorm: 'piek', tijden: ['2026-10-29T17:05:00Z', '2026-10-30T06:10:00Z', '2026-10-30T11:30:00Z'], vandaag: 2, per_dag: 2.7 },
    { id: 'g-a-6', letter: 'A', w: 1200, duur_s: 1200, n: 4, dagdeel: 'avond', fase: 1, vorm: 'vlak', vermoeden: 'oven' },
    { id: 'g-c', letter: 'C', w: 300, duur_s: 600, n: 3, vorm: 'traag', later: true },
  ],
  kennis: { apparaten: [{ soort: 'waterkoker', zeker: 0.95, aangewezen: 3 }, { soort: 'koelkast', zeker: 0.55 }, { soort: 'warmtepomp', zeker: 0.6, basis: true }] },
};
const MET_VRAGEN = { ...RIJ, brug: { ...RIJ.brug, versie: '1.4.0+abc1234' }, herkend: VRAGEN };

describe('vragen (brug 1.4.0)', () => {
  const herkend = standUitRij(MET_VRAGEN).herkend;

  it('vragenVan: hooguit twee, niet wat een week rust (server of dit toestel), en niets bij een oudere brug', () => {
    expect(vragenVan(herkend).map((c) => c.id)).toEqual(['g-b', 'g-a-6']);
    expect(vragenVan(herkend, { uitgesteld: { 'g-b': NU + 1000 } }).map((c) => c.id)).toEqual(['g-a-6']);
    expect(vragenVan(standUitRij(RIJ).herkend)).toEqual([]);
    expect(vragenVan(null)).toEqual([]);
    expect(HOOGSTENS_VRAGEN).toBe(2);
  });

  it('de vraag in gewone woorden: vermogen en duur, wanneer vandaag, de vorm en hoe vaak', () => {
    const [b, a] = vragenVan(herkend);
    expect(vraagZinnen(b, NU)).toEqual([
      'Er komt iets terug van zo’n 1,8\u00a0kW, ongeveer 40 minuten.',
      // De tests draaien in UTC (tijdzonevast): 06:10 en 11:30 hier is 07:10 en 12:30 in Nederland.
      'Vandaag 2 keer: om 06:10 en 11:30.',
      'Bij het aangaan is er eerst een korte piek, zoals bij een motor.',
      'Zo’n 3 keer per dag.',
    ]);
    expect(vraagZinnen(a, NU)).toEqual(['Er komt iets terug van zo’n 1,2\u00a0kW, ongeveer 20 minuten.', 'Al 4 keer gezien.', 'Het is één rustig blok, zoals iets dat verwarmt.', "Meestal 's avonds."]);
    // Vaker vandaag dan er tijden zijn: het aantal en de laatste.
    expect(vraagZinnen({ ...b, vandaag: 9 }, NU)[1]).toBe('Vandaag 9 keer, het laatst om 11:30.');
    // Vandaag nog niet: wanneer het laatst.
    expect(vraagZinnen({ ...b, vandaag: null, tijden: [Date.parse('2026-10-29T17:05:00Z')] }, NU)[1]).toBe('Al 5 keer gezien, het laatst gisteren 17:05.');
  });

  it('kennis: "Ik ken nu 3 apparaten van je", per apparaat hoe zeker; zonder kennis niets', () => {
    expect(kennisZin(herkend.kennis, 2)).toBe('Ik ken nu 3 apparaten van je; 2 vragen staan open.');
    expect(kennisZin(herkend.kennis, 1)).toBe('Ik ken nu 3 apparaten van je; 1 vraag staat open.');
    expect(kennisZin({ apparaten: [] }, 0)).toBe('Ik leer je apparaten nog kennen.');
    expect(kennisZin(null, 1)).toBeNull();
    expect(kennisRegels(herkend.kennis).map((k) => `${k.naam}: ${k.woord}, ${k.uitleg}`)).toEqual([
      'Waterkoker: zeker, 3 keer aangewezen',
      'Koelkast: misschien, uit zichzelf herkend',
      'Warmtepomp: waarschijnlijk, in wat altijd aan staat',
    ]);
  });

  it('de keuzelijst kent elke soort, en Verlichting als "Iets anders" met die naam', () => {
    expect(SOORTEN.every((s) => KEUZES.some((k) => k.soort === s))).toBe(true);
    expect(KEUZES.find((k) => k.waarde === 'verlichting')).toMatchObject({ soort: 'anders', naam: 'Verlichting' });
    expect(KEUZES.at(-1)).toMatchObject({ waarde: 'anders', tekst: 'Iets anders (zelf typen)' });
  });

  it('het label voor de groep: met de vorm en wat we vermoedden; "later" is alleen het id', () => {
    const a = herkend.onbekend[1];
    expect(labelVoorGroep(a, { soort: 'droger' })).toEqual({ id: 'g-a-6', soort: 'droger', w: 1200, duur_s: 1200, fase: 1, vorm: 'vlak', was: 'oven', aantal: 4 });
    expect(laterLabel(a)).toEqual({ id: 'g-a-6', later: true });
  });

  it('de kaart: bovenaan wat het kent en de vragen (vóór "Nu aan"), met Weet ik niet en Later', () => {
    const html = kaart({ rij: MET_VRAGEN });
    const plek = (tekst) => html.indexOf(tekst);
    expect(plek('Ik ken nu 3 apparaten van je; 2 vragen staan open.')).toBeGreaterThan(-1);
    expect(plek('Er komt iets terug van zo’n 1,8\u00a0kW')).toBeGreaterThan(plek('Ik ken nu'));
    expect(plek('Er komt iets terug van zo’n 1,2\u00a0kW')).toBeGreaterThan(plek('Er komt iets terug van zo’n 1,8\u00a0kW'));
    expect(plek('Nu aan:')).toBeGreaterThan(plek('Er komt iets terug van zo’n 1,2\u00a0kW'));
    expect(html).toContain('Misschien een oven.');
    expect(html).toContain('Weet ik niet');
    expect(html).toContain('Later');
    // De derde (rust een week) staat alleen in het blok eronder.
    expect(html).toContain('Komt ook vaker terug');
    expect(html).toContain('Wat ik al ken');
  });

  it('een kijker: wel wat het kent, geen vragen en geen knoppen', () => {
    const html = kaart({ rij: MET_VRAGEN, eigenaar: false, onLabel: null });
    expect(html).toContain('Ik ken nu 3 apparaten van je.');
    expect(html).not.toContain('Er komt iets terug');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('<select');
  });

  it('een oudere brug (zonder kennis): zoals vroeger, geen vraag bovenaan en geen lege kaart', () => {
    const html = kaart();
    expect(html).not.toContain('Ik ken nu');
    expect(html).not.toContain('Vragen van het programmaatje');
    expect(html).not.toContain('Er komt iets terug');
    expect(html).toContain('Wat is dit?');
  });
});
