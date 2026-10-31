import fs from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BEGINPLEKKEN, DIERENVERBLIJF_PLEK, TEKENINGEN } from '@/lib/opstelling';
import { weerBeeld } from '@/lib/weerBeeld';
import HuisTekening, { DAK_DIERENVERBLIJF, DAK_HUIS, panelenVeld } from './HuisTekening';

const teken = (soort, dag) => renderToStaticMarkup(<HuisTekening soort={soort} dag={dag} />);
const elementen = (html) => (html.match(/<[a-zA-Z]/g) ?? []).length;
const SOORTEN = TEKENINGEN.map((t) => t.sleutel);

/** De vakken van elke clipPath (de panelen waar de glans overheen gaat), in eenheden van de tekening. */
function panelenIn(html) {
  const vakken = {};
  for (const [, id, binnen] of html.matchAll(/<clipPath id="(\w+)">(.*?)<\/clipPath>/g)) {
    vakken[id] = [...binnen.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)].map((m) => m.slice(1).map(Number));
    // Een veld dat het dakvlak volgt (panelenVeld): "M links boven H … L rechts onder H links Z", als omsluitend vak.
    for (const m of binnen.matchAll(/<path d="M([\d.]+) ([\d.]+)H[\d.]+L([\d.]+) ([\d.]+)H/g)) {
      const [x, y, x2, y2] = m.slice(1).map(Number);
      vakken[id].push([x, y, x2 - x, y2 - y]);
    }
  }
  return vakken;
}

/** Ligt een beginplek (procenten, 4:5) op een van deze vakken? Een procent hoogte is 1,25 eenheid. */
const opPanelen = (plek, vakken) => vakken.some(([x, y, b, h]) => plek.x >= x && plek.x <= x + b && plek.y * 1.25 >= y && plek.y * 1.25 <= y + h);

describe('HuisTekening', () => {
  it('elke keuze uit Indelen heeft een eigen tekening, en die blijft licht', () => {
    const gezien = new Set();
    for (const soort of SOORTEN) {
      for (const dag of [true, false]) {
        const html = teken(soort, dag);
        expect(html).toContain(`data-tekening="${soort}"`);
        expect(elementen(html), `${soort} ${dag ? 'dag' : 'nacht'}`).toBeLessThan(400);
        // Geen dure filters: die laten een telefoon zweten.
        expect(html).not.toMatch(/<filter|filter="/);
        gezien.add(html.replace(/data-tekening="\w+"/, ''));
      }
    }
    expect(gezien.size).toBe(SOORTEN.length * 2);
  });

  it('een onbekende tekening wordt de standaard: met dierenverblijf', () => {
    const zonder = (html) => html.replace(/data-tekening="\w+"/, '');
    expect(zonder(teken('kasteel', true))).toBe(zonder(teken('dierenverblijf', true)));
    expect(zonder(renderToStaticMarkup(<HuisTekening dag />))).toBe(zonder(teken('dierenverblijf', true)));
  });

  it("overdag de zon en een glans over de panelen; 's nachts de maan, sterren en licht achter de ramen", () => {
    for (const soort of SOORTEN) {
      const dag = teken(soort, true);
      const nacht = teken(soort, false);
      // Bij de tekening garage liggen de panelen op de achterkant: daar glimt van voren niets.
      if (soort !== 'garage') expect(dag, soort).toMatch(/class="glans glans-(huis|stal)"/);
      expect(dag, soort).not.toContain('class="ster"');
      expect(nacht, soort).not.toContain('class="glans');
      expect(nacht, soort).toContain('class="ster"');
      expect(nacht, soort).toContain('fill="#f5c56c"');
    }
  });

  it('bij de tekening dierenverblijf glimmen het hoofddak en het dierenverblijf; de molen is een kerktoren geworden', () => {
    const html = teken('dierenverblijf', true);
    expect(html).toContain('class="glans glans-huis"');
    expect(html).toContain('class="glans glans-stal"');
    expect(html).not.toContain('class="wieken"');
    expect(html).toContain('data-kerk=""');
    for (const soort of ['schuur', 'huis']) expect(teken(soort, true), soort).toContain('class="wieken"');
    for (const soort of ['schuur', 'huis', 'garage']) expect(teken(soort, true), soort).not.toContain('data-kerk');
  });

  it('bij de tekening dierenverblijf: een lichte auto in de carport, een auto voor het huis, de oranje auto en de kippen weg', () => {
    for (const dag of [true, false]) {
      const html = teken('dierenverblijf', dag);
      expect(html).toContain('data-auto="carport"');
      expect(html).toContain('data-auto="opzij"');
      // De kam van een kip: geen kip meer, ook niet naast de auto.
      expect(html).not.toContain('fill="#d6463b"');
    }
    expect(teken('dierenverblijf', true)).toContain('fill="#d9dce0"');
    expect(teken('dierenverblijf', true)).toContain('fill="#5d636b"');
    expect(teken('dierenverblijf', true)).not.toContain('#f06a26');
  });

  it('de panelen op het hoofddak lopen mee met het dakvlak en bedekken meer (7 x 5)', () => {
    // Het dakvlak: nok y 27, goot y 61.5, rechts van (60, 27) naar (62.8, 61.5).
    const helling = 2.8 / 34.5;
    expect((DAK_HUIS.rechtsOnder - DAK_HUIS.rechtsBoven) / (DAK_HUIS.onder - DAK_HUIS.boven)).toBeCloseTo(helling, 2);
    const randRechts = (y) => 60 + (y - 27) * helling;
    for (const y of [DAK_HUIS.boven, DAK_HUIS.onder]) {
      const rechts = DAK_HUIS.rechtsBoven + ((y - DAK_HUIS.boven) / (DAK_HUIS.onder - DAK_HUIS.boven)) * (DAK_HUIS.rechtsOnder - DAK_HUIS.rechtsBoven);
      expect(randRechts(y) - rechts).toBeGreaterThan(1);
      expect(randRechts(y) - rechts).toBeLessThan(2);
    }
    expect(DAK_HUIS.boven).toBeGreaterThan(27);
    expect(DAK_HUIS.onder).toBeLessThan(60.6);
    expect(DAK_HUIS.kolommen * DAK_HUIS.rijen).toBe(35);
    const { naden, rijY } = panelenVeld(DAK_HUIS);
    // Rijen evenwijdig aan nok en goot (horizontaal), bovenaan iets lager (verder weg).
    expect(rijY.at(1) - rijY.at(0)).toBeLessThan(rijY.at(-1) - rijY.at(-2));
    expect((naden.match(/H/g) ?? []).length).toBe(DAK_HUIS.rijen - 1);
    expect((naden.match(/L/g) ?? []).length).toBe(DAK_HUIS.kolommen - 1);
  });

  it('het dierenverblijf staat kleiner en verder weg achter het huis, deels erachter verscholen', () => {
    for (const dag of [true, false]) {
      const html = teken('dierenverblijf', dag);
      // Eerst getekend, dan de carport en het huis eroverheen: zo staat het erachter.
      expect(html.indexOf('data-dierenverblijf=""')).toBeGreaterThan(-1);
      expect(html.indexOf('data-dierenverblijf=""')).toBeLessThan(html.indexOf('data-auto="carport"'));
      for (const soort of ['schuur', 'huis', 'garage']) expect(teken(soort, dag), soort).not.toContain('data-dierenverblijf');
    }
    // Kleiner dan eerst (5 × 2 panelen van 3,9 × 5,3 op 21,3 × 11 eenheden).
    const v = DAK_DIERENVERBLIJF;
    const breed = v.kolommen * v.b + (v.kolommen - 1) * v.naad;
    const hoog = v.rijen * v.h + (v.rijen - 1) * v.naad;
    expect(breed * hoog).toBeLessThan(0.8 * 21.3 * 11.05);
    const [[x, y, b, h]] = panelenIn(teken('dierenverblijf', true)).panelenStal;
    expect([x, y, b, h]).toEqual([v.x, v.y, Math.round(breed * 100) / 100, Math.round(hoog * 100) / 100]);
    // De panelen beginnen rechts van het huis (dakrand en goot tot x 63,6), en blijven links van de kerk.
    expect(x).toBeGreaterThan(63.6);
    expect(x + b).toBeLessThan(94);
    // Het rondje (44 px op een foto van 358 px: 12,3 eenheden breed) staat links op de panelen: rechts ervan blijven twee kolommen of meer in beeld.
    const rondjeRechts = DIERENVERBLIJF_PLEK.x + (44 / 358) * 100 / 2;
    expect(x + b - rondjeRechts).toBeGreaterThan(2 * (v.b + v.naad));
  });

  it('het witte batterijkastje met het lampje is weg: de batterij is alleen nog het rondje', () => {
    for (const soort of SOORTEN) {
      for (const dag of [true, false]) expect(teken(soort, dag)).not.toContain('lampje');
    }
  });

  it('elk zon-rondje begint op de panelen van zijn tekening', () => {
    const waar = { dierenverblijf: ['panelenHuis', 'panelenStal'], schuur: ['panelenHuis', 'panelenSchuur'], huis: ['panelenHuis'], garage: [] };
    for (const soort of SOORTEN) {
      const vakken = panelenIn(teken(soort, true));
      waar[soort].forEach((id, i) => {
        expect(vakken[id], `${soort}: ${id}`).toBeDefined();
        expect(opPanelen(BEGINPLEKKEN[soort].zon[i], vakken[id]), `${soort}: zon ${i + 1} op ${id}`).toBe(true);
      });
    }
  });

  it('bij de tekening garage liggen de panelen op de achterkant: van voren geen panelen, het zon-rondje boven het huis met een lijn over het dak naar de meterkast', () => {
    const html = teken('garage', true);
    expect(html).not.toContain('data-panelen');
    const zon = BEGINPLEKKEN.garage.zon[0];
    expect(zon.y * 1.25).toBeLessThan(33);
    expect(zon.route.naar).toBe('huis');
    // De lijn komt van achter het huis omhoog naar het rondje: hij begint op het dak, en het dak verbergt dat stuk.
    expect(zon.route.aanloop.y).toBeGreaterThan(26.4);
    expect(zon.route.aanloop.achter.some(([, y]) => y === 26.4)).toBe(true);
  });

  it('de molen draait om zijn as, en wie minder beweging wil ziet alles stilstaan', () => {
    const css = fs.readFileSync(path.resolve(import.meta.dirname, '../index.css'), 'utf8');
    expect(css).toMatch(/\.huistekening \.wieken \{[^}]*transform-origin: 90px 44\.6px/);
    for (const soort of ['schuur', 'huis']) expect(teken(soort, false), soort).toContain('rotate(0 90 44.6)');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^@]*\.huistekening \* \{\s*animation: none !important;/);
    expect(css).not.toContain('lampje');
  });
});

describe('spotjes in het overstek (programmaatje 0.8.0, Tuya-lampen)', () => {
  const metSpots = (soort, spots, dag = false) => renderToStaticMarkup(<HuisTekening soort={soort} dag={dag} spots={spots} />);

  it('zonder lampen (null) geen spotjes: precies de tekening van vroeger', () => {
    for (const soort of SOORTEN) {
      expect(metSpots(soort, null)).toBe(teken(soort, false));
      expect(metSpots(soort, null)).not.toContain('data-spots');
    }
  });

  it('bij elke tekening: aan branden ze (warm puntje en een bundel), uit zijn ze donker; licht en zonder filters', () => {
    for (const soort of SOORTEN) {
      for (const dag of [true, false]) {
        const aan = metSpots(soort, true, dag);
        const uit = metSpots(soort, false, dag);
        expect(aan, soort).toContain('data-spots="aan"');
        expect(aan, soort).toContain('url(#spotBundel)');
        expect(aan, soort).toContain('id="spotBundel"');
        expect(uit, soort).toContain('data-spots="uit"');
        expect(uit, soort).not.toContain('spotBundel');
        expect(aan).not.toMatch(/<filter|filter="|<animate/);
        expect(elementen(aan), soort).toBeLessThan(400);
      }
    }
  });
});

describe('HuisTekening met het weer van nu', () => {
  const NU = Date.parse('2026-10-30T12:00:00Z');
  const weer = (code, meer = {}) => weerBeeld({ nu: { code, neerslag: null, wind: 10, stoten: 15, bewolking: null, ...meer }, opgehaald: NU }, NU);
  const met = (soort, dag, w) => renderToStaticMarkup(<HuisTekening soort={soort} dag={dag} weer={w} />);

  it('zonder weer (een oudere brug) precies zoals vroeger', () => {
    for (const soort of SOORTEN) for (const dag of [true, false]) expect(met(soort, dag, null)).toBe(teken(soort, dag));
  });

  it('elk weer op elke tekening, dag en nacht: licht, zonder filters', () => {
    for (const code of [0, 1, 2, 3, 45, 53, 65, 75, 82, 95, 99]) {
      for (const soort of SOORTEN) {
        for (const dag of [true, false]) {
          const html = met(soort, dag, weer(code, { wind: code === 95 ? 70 : 10 }));
          expect(elementen(html), `${code} ${soort} ${dag}`).toBeLessThan(400);
          expect(html).not.toMatch(/<filter|filter="/);
        }
      }
    }
  });

  it('wolken: helder geen, bewolkt dicht en grijs met zon, maan en sterren weg', () => {
    const wolken = (html) => (html.match(/class="wolk /g) ?? []).length;
    expect(wolken(met('huis', true, weer(0)))).toBe(0);
    // Met het weer erbij duidelijker: licht bewolkt drie, half bewolkt vijf, dicht tien (zonder weer: twee of drie, zoals altijd).
    expect(wolken(met('huis', true, weer(1)))).toBe(3);
    expect(wolken(met('huis', true, weer(2)))).toBe(5);
    expect(wolken(met('huis', true, weer(3)))).toBe(10);
    expect(wolken(met('huis', true, null))).toBe(3);
    expect(met('huis', true, weer(3))).toContain('data-weer-waas');
    expect(met('huis', true, weer(3))).not.toContain('r="5" fill="#ffd257"');
    expect(met('huis', true, weer(0))).toContain('r="5" fill="#ffd257"');
    expect(met('huis', false, weer(0))).toContain('class="ster"');
    expect(met('huis', false, weer(3))).not.toContain('class="ster"');
    expect(met('huis', false, weer(2))).not.toContain('class="ster"');
  });

  it('regen, sneeuw, hagel en mist; onweer met een flits; wind laat de molen en de bomen gaan', () => {
    expect(met('huis', true, weer(63))).toMatch(/class="neerslag" data-valt="regen" data-zwaar="false"/);
    expect(met('huis', false, weer(53))).toContain('data-valt="motregen"');
    const sneeuw = met('schuur', true, weer(75));
    expect(sneeuw).toMatch(/data-valt="sneeuw" data-zwaar="true"/);
    expect(met('garage', true, weer(96))).toContain('data-valt="hagel"');
    expect(met('garage', true, weer(45))).toContain('class="mist"');
    expect(met('garage', true, weer(0))).not.toContain('class="mist"');
    const onweer = met('dierenverblijf', false, weer(95));
    expect(onweer).toContain('class="flits"');
    expect(onweer).toContain('class="bliksem"');
    expect(met('dierenverblijf', true, weer(2, { wind: 45 }))).toContain('data-wind="stevig"');
    expect(met('dierenverblijf', true, weer(2, { stoten: 100 }))).toContain('data-wind="storm"');
    expect(met('dierenverblijf', true, weer(2))).not.toContain('data-wind');
    for (const soort of SOORTEN) expect(met(soort, true, weer(2)), soort).toContain('class="boom-wieg"');
  });
});

describe('het weer duidelijker, op elke tekening hetzelfde', () => {
  const NU = Date.parse('2026-10-30T12:00:00Z');
  const weer = (code, meer = {}) => weerBeeld({ nu: { code, neerslag: null, wind: 10, stoten: 15, bewolking: null, ...meer }, opgehaald: NU }, NU);
  const met = (soort, dag, w) => renderToStaticMarkup(<HuisTekening soort={soort} dag={dag} weer={w} />);

  it('regen: natte grond met plassen; droog niet', () => {
    for (const soort of SOORTEN) {
      expect(met(soort, true, weer(63)), soort).toContain('data-weer-nat');
      expect(met(soort, false, weer(53)), soort).toContain('data-weer-nat');
      expect(met(soort, true, weer(0)), soort).not.toContain('data-weer-nat');
      expect(met(soort, true, weer(75)), soort).not.toContain('data-weer-nat');
    }
  });

  it('sneeuw: een witte laag op de grond', () => {
    for (const soort of SOORTEN) {
      expect(met(soort, true, weer(75)), soort).toContain('data-weer-sneeuw');
      expect(met(soort, true, weer(63)), soort).not.toContain('data-weer-sneeuw');
    }
  });

  it('mist hangt laag: de banen beginnen pas onder de daken', () => {
    const html = met('huis', true, weer(45));
    const banen = [...html.matchAll(/<g class="mist"[^>]*>(.*?)<\/g>/g)][0][1];
    for (const [, y] of banen.matchAll(/<rect x="-10" y="([\d.]+)"/g)) expect(Number(y)).toBeGreaterThanOrEqual(68);
  });

  it('harde wind: strepen door de lucht, en op elke tekening bomen en hagen die meebuigen', () => {
    for (const soort of SOORTEN) {
      const storm = met(soort, true, weer(3, { wind: 70 }));
      expect(storm, soort).toContain('data-weer-wind="storm"');
      expect(storm, soort).toContain('class="haag-wieg"');
      expect(storm, soort).toContain('class="boom-wieg"');
      expect(met(soort, true, weer(3)), soort).not.toContain('data-weer-wind');
    }
  });

  it('elk weer op elke tekening blijft licht', () => {
    for (const soort of SOORTEN) {
      for (const code of [45, 65, 75, 82, 95, 99]) {
        const html = met(soort, false, weer(code, { wind: 70, neerslag: 6 }));
        expect(elementen(html), `${soort} ${code}`).toBeLessThan(450);
        expect(html).not.toMatch(/<filter|filter="/);
      }
    }
  });
});

describe('HuisTekening tekent niet elke meting opnieuw (prestaties-19)', () => {
  it('is een memo: met dezelfde dag, spotjes en hetzelfde weer doet React niets', async () => {
    const { default: Tekening } = await import('./HuisTekening');
    expect(Tekening.$$typeof).toBe(Symbol.for('react.memo'));
  });
});

it('de garagedeur (een grapje) is alleen klikbaar bij de tekening met de garage', () => {
  expect(teken('garage', true)).toContain('data-garageknop');
  for (const soort of SOORTEN.filter((s) => s !== 'garage')) expect(teken(soort, true), soort).not.toContain('data-garageknop');
});
