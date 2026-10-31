import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { omvormerUit, standUitRij } from '@/lib/bron';
import { GRENZEN, omvormerHoortBij, omvormerRegels } from '@/lib/omvormer';
import { verdeelStroom } from '@/lib/stroom';
import { voorbeeldStand } from '@/lib/voorbeeld';
import Detail from './Detail';
import Omvormer from './Omvormer';
import TabApparaten from './TabApparaten';

/** Zonder opmaak, met gewone spaties. */
const tekst = (el) =>
  renderToStaticMarkup(el)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|\s/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\u2212/g, '-')
    .replace(/ +/g, ' ')
    .trim();

/** Zoals de functie het teruggeeft (base44/functions/ontvangMeting/controle.js), met de getallen van een GW6000-DT uit de goodwe-bibliotheek. */
const OMVORMER = {
  stand: 'normaal',
  bij: 'hw-zon-huis',
  w: 1835,
  rijen: [
    { v: 320.8, a: 3.1 },
    { v: 324.1, a: 3.2 },
  ],
  fasen: [
    { v: 225.6, a: 2.7 },
    { v: 229.7, a: 2.6 },
    { v: 231, a: 2.7 },
  ],
  hz: 49.98,
  temp_c: 41.3,
  vandaag_kwh: 6,
  totaal_kwh: 13350.2,
};

const RIJ = {
  moment: '2026-10-30T12:00:00Z',
  net_w: -300,
  zon_w: 2235,
  zonnen: [
    { sleutel: 'hw-zon-dierenverblijf', naam: 'Zon dierenverblijf', vermogen_w: 400 },
    { sleutel: 'hw-zon-huis', naam: 'Hoofddak', vermogen_w: 1835 },
  ],
  omvormer: OMVORMER,
  gekoppeld: [{ sleutel: 'goodwe', naam: 'Omvormer', merk: 'GoodWe', soort: 'GW8K-DT', rol: 'omvormer', manier: 'lokaal', adres: '192.168.1.40', ok: true, w: 1835 }],
  brug: { versie: '0.6.0', gestart: '2026-10-30T06:00:00Z', elke_seconden: 5 },
};

describe('omvormerUit (bron.js): veilig lezen', () => {
  it('zoals de server het geeft', () => {
    // De velden van 1.4.0 zijn er niet (een oudere brug): null.
    expect(omvormerUit(OMVORMER)).toEqual({ ...OMVORMER, storingen: [], waarschuwing: 0, beperkt: [], pf: null, bus_v: null, koelplaat_c: null, uren: null, isolatie_kohm: null, lekstroom_ma: null, sturen: null });
  });

  it('een oude server of brug zonder blok: null; rommel valt weg', () => {
    expect(standUitRij({ net_w: 1 }).omvormer).toBeNull();
    for (const rommel of [null, 'aan', [OMVORMER], { w: 3 }, { stand: '' }]) expect(omvormerUit(rommel)).toBeNull();
    expect(omvormerUit({ stand: 'storing', storingen: [17, 9, 'x', 40, 9], rijen: [{ v: 'hoog' }, { v: 600 }], hz: '50' })).toMatchObject({
      storingen: [9, 17],
      rijen: [{ v: 600, a: null }],
      hz: null,
    });
  });
});

describe('omvormerRegels: in gewone woorden', () => {
  it('de temperatuur bovenaan (groot), dan stand, paneelrijen, net en opbrengst', () => {
    const regels = omvormerRegels(omvormerUit(OMVORMER));
    expect(regels.map((r) => [r.tekst, r.bij ?? ''].join(' | ').replace(/\u00a0/g, ' '))).toEqual([
      '41 °C | binnenin de omvormer',
      'Levert stroom | ',
      'Paneelrij 1: 320,8 V | stroom 3,1 A',
      'Paneelrij 2: 324,1 V | stroom 3,2 A',
      'Net 225,6 · 229,7 · 231,0 V | L1 tot L3, 49,98 Hz',
      'Vandaag 6,0 kWh | totaal 13.350 kWh',
    ]);
    expect(regels[0]).toMatchObject({ sleutel: 'temperatuur', groot: true });
    expect(regels.filter((r) => r.groot)).toHaveLength(1);
    expect(regels.some((r) => r.letOp)).toBe(false);
  });

  it('een paneelrij zonder spanning naast een met spanning valt weg (één ingang in gebruik); alles 0: geen rijen', () => {
    const een = omvormerRegels(omvormerUit({ ...OMVORMER, rijen: [{ v: 612.4, a: 9.1 }, { v: 0, a: 0 }] }));
    expect(een.filter((r) => r.sleutel.startsWith('rij-')).map((r) => r.tekst.replace(/\u00a0/g, ' '))).toEqual(['Paneelrij 1: 612,4 V']);
    // Is rij 1 de lege, dan heet de andere gewoon rij 2.
    const tweede = omvormerRegels(omvormerUit({ ...OMVORMER, rijen: [{ v: 0.4 }, { v: 598 }] }));
    expect(tweede.filter((r) => r.sleutel.startsWith('rij-')).map((r) => r.sleutel)).toEqual(['rij-2']);
    const nacht = omvormerRegels(omvormerUit({ stand: 'slaapt', rijen: [{ v: 0 }, { v: 0 }], vandaag_kwh: 23.4 }));
    expect(nacht.map((r) => r.tekst.replace(/\u00a0/g, ' '))).toEqual(['Slaapt', 'Vandaag 23,4 kWh']);
  });

  it('storingen (na de temperatuur) in de let-op-kleur, met een onbekend bit als code', () => {
    const regels = omvormerRegels(omvormerUit({ ...OMVORMER, stand: 'storing', storingen: [9, 26], beperkt: [0] }));
    expect(regels.slice(1, 4).map((r) => [r.tekst, Boolean(r.letOp)])).toEqual([
      ['Geen net (stroomstoring?)', true],
      ['Storingscode 26', true],
      ['Storing', false],
    ]);
    expect(regels.find((r) => r.sleutel === 'beperkt').tekst).toBe('Levert minder: te warm');
  });

  it("'s nachts: slaapt, met de opbrengst van vandaag; overdag geen antwoord vraagt aandacht", () => {
    expect(omvormerRegels(omvormerUit({ stand: 'slaapt', vandaag_kwh: 23.4, totaal_kwh: 13372 })).map((r) => r.tekst.replace(/\u00a0/g, ' '))).toEqual(['Slaapt', 'Vandaag 23,4 kWh']);
    expect(omvormerRegels(omvormerUit({ stand: 'weg' }))[0]).toMatchObject({ tekst: 'Geen antwoord', letOp: true });
    expect(omvormerRegels(null)).toEqual([]);
  });
});

describe('waar het staat', () => {
  const stand = standUitRij(RIJ);
  const punten = [
    { sleutel: 'hw-zon-huis', soort: 'zon', naam: 'Hoofddak' },
    { sleutel: 'hw-zon-dierenverblijf', soort: 'zon', naam: 'Zon dierenverblijf' },
    { sleutel: 'huis', soort: 'huis', naam: 'Huis' },
    { sleutel: 'net', soort: 'net', naam: 'Net' },
  ];
  const blad = (sleutel, s = stand) =>
    tekst(<Detail punt={punten.find((p) => p.sleutel === sleutel)} punten={punten} stand={s} verdeling={verdeelStroom(s)} onSluit={() => {}} />);

  it('in het blad van de zon waar hij bij hoort (het hoofddak), niet bij de andere zon of het net', () => {
    expect(blad('hw-zon-huis')).toMatch(/Omvormer 41 °C binnenin de omvormer Levert stroom Paneelrij 1: 320,8 V stroom 3,1 A/);
    expect(blad('hw-zon-dierenverblijf')).not.toMatch(/Paneelrij/);
    expect(blad('net')).not.toMatch(/Paneelrij/);
  });

  it('zonder bij (of een bij die er niet is): bij het eerste zon-punt', () => {
    expect(omvormerHoortBij({ bij: null }, punten[0], punten)).toBe(true);
    expect(omvormerHoortBij({ bij: 'weg' }, punten[1], punten)).toBe(false);
    expect(omvormerHoortBij({ bij: 'hw-zon-dierenverblijf' }, punten[1], punten)).toBe(true);
    expect(omvormerHoortBij(null, punten[0], punten)).toBe(false);
    expect(omvormerHoortBij({ bij: null }, punten[2], punten)).toBe(false);
  });

  it('een oude server zonder blok: het blad werkt gewoon, zonder omvormer', () => {
    const oud = standUitRij({ ...RIJ, omvormer: undefined });
    expect(blad('hw-zon-huis', oud)).not.toMatch(/Omvormer/);
  });

  it('op Apparaten bij de GoodWe, en slapend met een maantje in plaats van "antwoordt"', () => {
    const t = tekst(<TabApparaten stand={stand} nu={Date.parse(RIJ.moment)} />);
    expect(t).toMatch(/Omvormer GW8K-DT · GoodWe .*de omvormer van de zonnepanelen .*antwoordt 41 °C binnenin de omvormer Levert stroom Paneelrij 1/);
    const nacht = standUitRij({ ...RIJ, omvormer: { stand: 'slaapt', vandaag_kwh: 23.4 }, gekoppeld: [{ ...RIJ.gekoppeld[0], w: null }] });
    const n = tekst(<TabApparaten stand={nacht} nu={Date.parse(RIJ.moment)} />);
    expect(n).toMatch(/slaapt \(geen zon\) Slaapt geen zon: de omvormer en zijn wifi-stekker zijn uit Vandaag 23,4 kWh/);
    expect(n).not.toMatch(/antwoordt/);
  });

  it('de storing in de let-op-kleur', () => {
    const html = renderToStaticMarkup(<Omvormer omvormer={omvormerUit({ ...OMVORMER, stand: 'storing', storingen: [18] })} />);
    expect(html).toMatch(/color:var\(--let-op\)[^<]*>[^<]*<svg/);
    expect(tekst(<Omvormer omvormer={omvormerUit({ ...OMVORMER, stand: 'storing', storingen: [18] })} />)).toMatch(/^Omvormer 41 °C binnenin de omvormer Isolatiefout bij de panelen of kabels foutcode 18/);
    expect(renderToStaticMarkup(<Omvormer omvormer={null} />)).toBe('');
  });

  it('het voorbeeld: overdag levert hij op het hoofddak, ’s nachts slaapt hij', () => {
    const dag = voorbeeldStand(12.5, 0, 'dierenverblijf', 0);
    expect(dag.omvormer).toMatchObject({ stand: 'normaal', bij: 'hw-zon-batterij' });
    // Tims GW8000-DT: één ingang in gebruik, de tweede 0 V; de app laat die weg.
    expect(dag.omvormer.rijen).toHaveLength(2);
    expect(omvormerRegels(dag.omvormer).filter((r) => r.sleutel.startsWith('rij-'))).toHaveLength(1);
    expect(dag.omvormer.fasen).toHaveLength(3);
    expect(dag.omvormer.w).toBe(dag.zonnen[0].vermogen_w);
    expect(dag.omvormer.vandaag_kwh).toBeGreaterThan(0);
    expect(dag.omvormer.rijen[0].v).toBeGreaterThan(500);
    expect(dag.omvormer.rijen[1].v).toBe(0);
    const nacht = voorbeeldStand(2, 0, 'dierenverblijf', 0);
    expect(nacht.omvormer).toMatchObject({ stand: 'slaapt' });
    expect(omvormerRegels(nacht.omvormer)[0].tekst).toBe('Slaapt');
    expect(dag.gekoppeld.find((a) => a.sleutel === 'goodwe')).toMatchObject({ merk: 'GoodWe', rol: 'omvormer' });
  });
});

describe('programmaatje 1.4.0: isolatie, lekstroom en meer', () => {
  const regelTekst = (regels) => regels.map((r) => [r.tekst, r.bij ?? ''].join(' | ').replace(/\u00a0/g, ' '));

  it('in gewone woorden: goed, matig of laag; de lekstroom; arbeidsfactor, busspanning, koelplaat en uren', () => {
    const regels = omvormerRegels(omvormerUit({ ...OMVORMER, isolatie_kohm: 1250, lekstroom_ma: 12.5, pf: 0.987, bus_v: 601.2, koelplaat_c: 45.4, uren: 8451 }));
    expect(regelTekst(regels)).toEqual([
      '41 °C | binnenin de omvormer · koelplaat 45 °C',
      'Levert stroom | ',
      'Isolatie van de panelen: goed (1,3 MΩ) | gemeten bij het opstarten',
      'Lekstroom naar aarde: laag (12,5 mA) | zo hoort het',
      'Paneelrij 1: 320,8 V | stroom 3,1 A',
      'Paneelrij 2: 324,1 V | stroom 3,2 A',
      'Net 225,6 · 229,7 · 231,0 V | L1 tot L3, 49,98 Hz',
      'Arbeidsfactor 0,99 | busspanning 601 V',
      'Vandaag 6,0 kWh | totaal 13.350 kWh · 8.451 uur in bedrijf',
    ]);
    expect(regels.some((r) => r.letOp)).toBe(false);
  });

  it('buiten de grens in de let-op-kleur, met wat je kunt doen', () => {
    const laag = omvormerRegels(omvormerUit({ ...OMVORMER, isolatie_kohm: GRENZEN.ISOLATIE_LAAG_KOHM - 1, lekstroom_ma: GRENZEN.LEKSTROOM_HOOG_MA }));
    expect(laag.find((r) => r.sleutel === 'isolatie')).toMatchObject({ letOp: true, bij: 'laat de installateur de panelen en kabels nakijken' });
    expect(laag.find((r) => r.sleutel === 'lekstroom')).toMatchObject({ letOp: true });
    const matig = omvormerRegels(omvormerUit({ ...OMVORMER, isolatie_kohm: 300, lekstroom_ma: 60 }));
    expect(regelTekst(matig.filter((r) => ['isolatie', 'lekstroom'].includes(r.sleutel)))).toEqual([
      'Isolatie van de panelen: matig (300 kΩ) | nog boven de grens van 100 kΩ; na regen is hij vaak lager',
      'Lekstroom naar aarde: wat hoger (60 mA) | een melding komt vanaf 150 mA',
    ]);
    expect(matig.some((r) => r.letOp)).toBe(false);
  });

  it('op de kaart: een schild bij de isolatie', () => {
    const html = renderToStaticMarkup(<Omvormer omvormer={omvormerUit({ ...OMVORMER, isolatie_kohm: 80 })} />);
    expect(html).toContain('Isolatie van de panelen: laag');
    expect(html).toContain('lucide-shield-alert');
  });
});
