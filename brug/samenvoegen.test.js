import { describe, expect, it } from 'vitest';
import {
  maakMeting,
  maakVerbruikWacht,
  mediaanVanDrie,
  metGeheugen,
  vermogenInWoorden,
  verbruikTekst,
  zonmetersMetVerbruik,
  zonUitGroep,
  zonVanMeter,
} from './samenvoegen.mjs';

const meter = (rol, naam = rol, extra = {}) => ({ rol, naam, sleutel: `hw-${naam}`, soort: 'stekker', ...extra });

describe('maakMeting', () => {
  it('P1, kWh-meter op panelen, apparaat en een Zendure met eigen panelen', () => {
    const uit = maakMeting({
      homewizard: [
        { meter: meter('net'), w: -312.4 },
        { meter: meter('zon', 'dak'), w: -1200 },
        { meter: meter('apparaat', 'wasmachine', { soort: 'wasmachine' }), w: 2050.6 },
      ],
      zendure: { zon_w: 400, batterij_w: -350, batterij_procent: 62.6, ac_w: 50 },
      versie: '0.1.0',
    });
    expect(uit).toEqual({
      net_w: -312,
      net_bron: 'homewizard',
      net_zendure_w: null,
      zon_w: 1600,
      zonnen: [
        { sleutel: 'hw-dak', naam: 'dak', vermogen_w: 1200 },
        { sleutel: 'zendure-zon', naam: 'Zon (Zendure)', vermogen_w: 400 },
      ],
      batterij_w: -350,
      batterij_procent: 63,
      apparaten: [{ sleutel: 'hw-wasmachine', naam: 'wasmachine', soort: 'wasmachine', vermogen_w: 2051 }],
      bron: 'brug 0.1.0',
    });
  });

  it('zoals bij Tim: P1, "Batterij + Zon" met een 2400 AC, en panelen bij het dierenverblijf', () => {
    // Overdag: de GoodWe levert 3000 W, de 2400 AC laadt 1000 W daaruit; het dierenverblijf levert 800 W.
    const uit = maakMeting({
      homewizard: [
        { meter: meter('net', 'meterkast'), w: -1500 },
        { meter: meter('zon-en-batterij', 'batterij-zon', { naam: 'Batterij + Zon' }), w: -2000 },
        { meter: meter('zon', 'dierenverblijf'), w: -800 },
      ],
      zendure: { zon_w: null, batterij_w: -1000, batterij_procent: 70, ac_w: -1000 },
      versie: 'x',
    });
    expect(uit.zonnen).toEqual([
      { sleutel: 'hw-batterij-zon', naam: 'Batterij + Zon', vermogen_w: 3000 },
      { sleutel: 'hw-dierenverblijf', naam: 'dierenverblijf', vermogen_w: 800 },
    ]);
    expect(uit.zon_w).toBe(3800);
    expect(uit.batterij_w).toBe(-1000);
  });

  it('de panelen bij de batterij eerst (het dak van het huis), wat de volgorde in de instellingen ook is', () => {
    // Zo bewaarde de instelhulp het bij Tim: op adres, dus het dierenverblijf (.21) vóór het hoofddak (.112).
    const uit = maakMeting({
      homewizard: [
        { meter: meter('zon', 'dierenverblijf'), w: -142 },
        { meter: meter('zon-en-batterij', 'zon-batterij'), w: -1962 },
        { meter: meter('net', 'meterkast'), w: -1675 },
      ],
      zendure: { zon_w: null, batterij_w: 1700, batterij_procent: 47, ac_w: 1700 },
      versie: 'x',
    });
    expect(uit.zonnen.map((z) => [z.sleutel, z.vermogen_w])).toEqual([
      ['hw-zon-batterij', 262],
      ['hw-dierenverblijf', 142],
    ]);
    expect(uit.zon_w).toBe(404);
  });

  it("'s nachts laden uit het net: de meter op zon + batterij geeft geen zon", () => {
    const uit = maakMeting({
      homewizard: [{ meter: meter('zon-en-batterij', 'groep'), w: 2300 }],
      zendure: { zon_w: null, batterij_w: -2300, batterij_procent: 40, ac_w: -2300 },
      versie: 'x',
    });
    expect(uit.zonnen[0].vermogen_w).toBe(0);
    expect(uit.zon_w).toBe(0);
  });

  it('wat er niet is of niet antwoordt wordt null', () => {
    const uit = maakMeting({ homewizard: [{ meter: meter('net'), w: null }, { meter: meter('apparaat', 'tv'), w: null }], versie: 'x' });
    expect(uit).toMatchObject({ net_w: null, zon_w: null, zonnen: [], batterij_w: null, batterij_procent: null });
    expect(uit.apparaten[0].vermogen_w).toBeNull();
  });

  it('een zonnebron zonder antwoord blijft in de lijst, maar telt niet mee', () => {
    const uit = maakMeting({ homewizard: [{ meter: meter('zon', 'a'), w: null }, { meter: meter('zon', 'b'), w: -500 }], versie: 'x' });
    expect(uit.zon_w).toBe(500);
    expect(uit.zonnen.map((z) => z.vermogen_w)).toEqual([null, 500]);
  });

  it('een apparaat dat iets teruglevert telt als 0', () => {
    const uit = maakMeting({ homewizard: [{ meter: meter('apparaat', 'a'), w: -3 }], versie: 'x' });
    expect(uit.apparaten[0].vermogen_w).toBe(0);
  });

  it('een Zendure P1-meter op dezelfde meterkast: ernaast, net_w blijft van de HomeWizard', () => {
    const uit = maakMeting({ homewizard: [{ meter: meter('net'), w: -312.4 }], zendureP1: -298.6, versie: 'x' });
    expect(uit.net_w).toBe(-312);
    expect(uit.net_zendure_w).toBe(-299);
    expect(uit.net_bron).toBe('homewizard');
  });

  it('antwoordt de HomeWizard P1 niet, dan komt het net van de Zendure P1 (reserve)', () => {
    const weg = maakMeting({ homewizard: [{ meter: meter('net'), w: null }], zendureP1: 500.4, versie: 'x' });
    expect(weg).toMatchObject({ net_w: 500, net_bron: 'zendure-p1', net_zendure_w: 500 });
    // Geen HomeWizard P1 ingesteld, alleen een Zendure P1: die is dan het net.
    expect(maakMeting({ homewizard: [], zendureP1: -1200, versie: 'x' })).toMatchObject({ net_w: -1200, net_bron: 'zendure-p1' });
    // Allebei weg, of geen Zendure P1: zoals vroeger.
    expect(maakMeting({ homewizard: [{ meter: meter('net'), w: null }], zendureP1: null, versie: 'x' })).toMatchObject({ net_w: null, net_bron: null });
    expect(maakMeting({ homewizard: [{ meter: meter('net'), w: -40 }], versie: 'x' })).toMatchObject({ net_w: -40, net_bron: 'homewizard' });
  });

  it('twee P1-meters (twee aansluitingen) worden opgeteld', () => {
    const uit = maakMeting({ homewizard: [{ meter: meter('net', 'a'), w: 100 }, { meter: meter('net', 'b'), w: 50 }], versie: 'x' });
    expect(uit.net_w).toBe(150);
  });

  it('één scheve meting bij zon + batterij wordt gladgestreken', () => {
    const historie = new Map();
    const lees = (w, ac) =>
      maakMeting({
        homewizard: [{ meter: meter('zon-en-batterij', 'g'), w }],
        zendure: { batterij_w: ac, ac_w: ac },
        versie: 'x',
        historie,
      }).zonnen[0].vermogen_w;
    expect(lees(-1000, -1000)).toBe(2000);
    expect(lees(-1000, -1000)).toBe(2000);
    // De batterij stopt net tussen de twee metingen in: los gerekend zou dat 3000 W zon geven.
    expect(lees(-3000, 0)).toBe(2000);
    expect(lees(-3000, 0)).toBe(3000);
  });
});

describe('zonUitGroep', () => {
  it('zon = −Zendure − meter, nooit onder 0, hooguit de piek', () => {
    expect(zonUitGroep(-2000, -1000)).toBe(3000);
    expect(zonUitGroep(-800, 800)).toBe(0);
    expect(zonUitGroep(50, 0)).toBe(0);
    expect(zonUitGroep(-6000, 0, 4000)).toBe(4000);
  });

  it('zonder Zendure-gegevens: wat de groep levert', () => {
    expect(zonUitGroep(-1200, null)).toBe(1200);
    expect(zonUitGroep(300, null)).toBe(0);
  });
});

describe('mediaanVanDrie en metGeheugen', () => {
  it('de middelste van de laatste drie', () => {
    const h = new Map();
    expect(mediaanVanDrie(h, 'a', 10)).toBe(10);
    expect(mediaanVanDrie(h, 'a', 30)).toBe(30);
    expect(mediaanVanDrie(h, 'a', 20)).toBe(20);
    expect(mediaanVanDrie(h, 'a', 1000)).toBe(30);
  });

  it('houdt de laatste waarde een minuut vast', () => {
    const geheugen = new Map();
    expect(metGeheugen(geheugen, 'p1', 300, 1000)).toBe(300);
    expect(metGeheugen(geheugen, 'p1', null, 50_000)).toBe(300);
    expect(metGeheugen(geheugen, 'p1', null, 62_000)).toBeNull();
    expect(metGeheugen(geheugen, 'onbekend', null, 1000)).toBeNull();
  });
});

describe('fasen in de meting', () => {
  it('per fase W heel, A en V op één decimaal; zonder fasen geen veld', async () => {
    const { maakMeting } = await import('./samenvoegen.mjs');
    const uit = maakMeting({ fasen: [{ fase: 1, w: -1700.4, a: 7.44, v: 231.27 }, { fase: 2, w: 412, a: null, v: null }], versie: 'x' });
    expect(uit.fasen).toEqual([{ fase: 1, w: -1700, a: 7.4, v: 231.3 }, { fase: 2, w: 412 }]);
    expect(maakMeting({ versie: 'x' })).not.toHaveProperty('fasen');
  });
});

describe('meer over de batterij in de meting', () => {
  it('gaat mee als batterij_info; zonder (geen Zendure, of hij meldt niets extra) geen veld', () => {
    const info = { temp_c: 25.5, behuizing_c: 40, laadgrens_pct: 100 };
    const uit = maakMeting({ zendure: { zon_w: null, batterij_w: -2300, batterij_procent: 41, ac_w: -2300, info }, versie: 'x' });
    expect(uit.batterij_info).toEqual(info);
    expect(maakMeting({ zendure: { zon_w: null, batterij_w: 10, batterij_procent: 41, ac_w: 10, info: null }, versie: 'x' })).not.toHaveProperty('batterij_info');
    expect(maakMeting({ versie: 'x' })).not.toHaveProperty('batterij_info');
  });
});

describe('de groepsmeter is het anker (zon + Zendure = −meter)', () => {
  const groep = meter('zon-en-batterij', 'hoofddak', { piek_w: 4000 });
  const met = (w, zendure, nacht = false) => maakMeting({ homewizard: [{ meter: groep, w }], zendure, versie: 'x', nacht, historie: new Map() });

  it("'s nachts: de batterij begint te laden, de cloud zegt nog 0: geen zon, de batterij laadt", () => {
    const uit = met(2300, { zon_w: null, batterij_w: 0, batterij_procent: 40, ac_w: 0 }, true);
    expect(uit.zon_w).toBe(0);
    expect(uit.batterij_w).toBe(-2300);
  });

  it("'s avonds: de batterij is gestopt, de cloud zegt nog laden: geen spookzon", () => {
    const uit = met(0, { zon_w: null, batterij_w: -2300, batterij_procent: 100, ac_w: -2300 }, true);
    expect(uit.zon_w).toBe(0);
    expect(uit.batterij_w).toBe(0);
  });

  it("'s nachts zonder Zendure-gegevens: wat de groep levert is de batterij, niet de zon", () => {
    const uit = met(-800, null, true);
    expect(uit.zon_w).toBe(0);
    expect(uit.batterij_w).toBe(800);
  });

  it('overdag: zon zou onder 0 komen; de rest gaat naar de batterij, niet naar het huis', () => {
    // Laden uit het net met 2300 W, de cloud zegt nog 0.
    const uit = met(2300, { zon_w: null, batterij_w: 0, batterij_procent: 40, ac_w: 0 });
    expect(uit.zon_w).toBe(0);
    expect(uit.batterij_w).toBe(-2300);
  });

  it('overdag: zon zou boven de piek komen; de rest is de batterij', () => {
    // Echt 3000 W zon en de batterij levert 1000 W, de cloud zegt nog -1000.
    const uit = met(-4000, { zon_w: null, batterij_w: -1000, batterij_procent: 60, ac_w: -1000 }, false);
    expect(uit.zon_w).toBe(4000);
    expect(uit.batterij_w).toBe(0);
    expect(uit.zon_w + uit.batterij_w).toBe(4000);
  });

  it('overdag en het klopt: de Zendure zoals hij zegt', () => {
    const uit = met(-2000, { zon_w: null, batterij_w: -1000, batterij_procent: 60, ac_w: -1000 });
    expect(uit.zon_w).toBe(3000);
    expect(uit.batterij_w).toBe(-1000);
  });

  it('overdag zonder Zendure-gegevens: gebruikt de groep stroom, dan laadt de batterij', () => {
    const uit = met(2300, null);
    expect(uit.zon_w).toBe(0);
    expect(uit.batterij_w).toBe(-2300);
    // Levert hij: zon (zoals vroeger), de batterij onbekend.
    expect(met(-1200, null)).toMatchObject({ zon_w: 1200, batterij_w: null });
  });

  it("een gewone zonmeter 's nachts: standby van de omvormer is geen zon", () => {
    const uit = maakMeting({ homewizard: [{ meter: meter('zon', 'dak'), w: 8 }], versie: 'x', nacht: true });
    expect(uit.zon_w).toBe(0);
  });
});

describe('een zonnemeter en zijn teken', () => {
  it("zonder teken (instellingen van voor 0.6.2) zoals altijd: |w|, 's nachts 0", () => {
    expect(zonVanMeter(-800, undefined)).toBe(800);
    expect(zonVanMeter(800, undefined)).toBe(800);
    expect(zonVanMeter(-800, undefined, { nacht: true })).toBe(0);
    expect(zonVanMeter(null, 'min')).toBe(null);
  });

  it("'min' (gewoon) en 'plus' (omgekeerd aangesloten): verbruik telt niet als zon", () => {
    expect(zonVanMeter(-800, 'min')).toBe(800);
    expect(zonVanMeter(1372, 'min')).toBe(0);
    expect(Object.is(zonVanMeter(0, 'min'), 0)).toBe(true);
    expect(zonVanMeter(800, 'plus')).toBe(800);
    expect(zonVanMeter(-5, 'plus')).toBe(0);
  });

  it("Tims 'Zon dierenverblijf' (levert min, geen teken in de instellingen) blijft precies hetzelfde", () => {
    const dierenverblijf = meter('zon', 'dierenverblijf', { naam: 'Zon dierenverblijf' });
    for (const w of [-800, -3, 0, 4]) {
      const oud = Math.abs(w);
      expect(maakMeting({ homewizard: [{ meter: dierenverblijf, w }], versie: 'x' }).zonnen[0].vermogen_w).toBe(oud);
    }
    expect(maakMeting({ homewizard: [{ meter: { ...dierenverblijf, opwek: 'min' }, w: -800 }], versie: 'x' }).zon_w).toBe(800);
  });

  it('woorden en watts zoals in de app: "levert nu 121 W", "gebruikt nu 1.372 W"', () => {
    expect(vermogenInWoorden(-121.4)).toBe('levert nu 121 W');
    expect(vermogenInWoorden(1372)).toBe('gebruikt nu 1.372 W');
    expect(vermogenInWoorden(2)).toBe('meet nu bijna niets (2 W)');
    expect(verbruikTekst({ naam: 'Zon', w: 1372 })).toBe("De meter 'Zon' meet verbruik (+1.372 W), geen opwek: staat hij goed in de instelhulp?");
    expect(verbruikTekst({ naam: 'x'.repeat(40), w: -12345 }).length).toBeLessThanOrEqual(160);
  });
});

describe('een zonnemeter die stroom gebruikt (zoals bij Dirk: de spa op de "zon")', () => {
  // Verwisseld: de "zon" zit op de spa (+1372 W), het "apparaat" op de panelen (−121 W).
  const zon = meter('zon', 'zon', { naam: 'Zon' });
  const spa = meter('apparaat', 'spa', { naam: 'Spa' });
  const lezing = (zonW, spaW, extra = {}) => {
    const homewizard = [
      { meter: { ...zon, ...extra }, w: zonW },
      { meter: spa, w: spaW },
    ];
    return { homewizard, meting: maakMeting({ homewizard, versie: 'x' }) };
  };

  it('overdag, met iets anders dat levert: gemeld; een omgekeerde meter alleen als er iets niet klopt', () => {
    expect(zonmetersMetVerbruik({ ...lezing(1372, -121) })).toEqual([{ sleutel: 'hw-zon', naam: 'Zon', w: 1372 }]);
    // Niets anders dat levert, en het teken is niet bekend: misschien een omgekeerd aangesloten meter die levert.
    expect(zonmetersMetVerbruik({ ...lezing(1372, 0) })).toEqual([]);
    // De omvormer levert: dan klopt het niet.
    expect(zonmetersMetVerbruik({ ...lezing(1372, 0), omvormerW: 900 })).toHaveLength(1);
    // Met een bekend teken is het genoeg dat hij gebruikt.
    expect(zonmetersMetVerbruik({ ...lezing(1372, 0, { opwek: 'min' }) })).toHaveLength(1);
    // Omgekeerd aangesloten en hij levert (plus): niets aan de hand, ook met een "apparaat" dat levert.
    expect(zonmetersMetVerbruik({ ...lezing(1372, -121, { opwek: 'plus' }) })).toEqual([]);
    // Een beetje standby is geen verbruik; 's nachts kijken we niet.
    expect(zonmetersMetVerbruik({ ...lezing(8, -121) })).toEqual([]);
    expect(zonmetersMetVerbruik({ ...lezing(1372, -121), nacht: true })).toEqual([]);
  });

  it('pas na 3 lezingen op rij gemeld, één keer nieuw, en weg zodra hij weer duidelijk opwek meet', () => {
    const wacht = maakVerbruikWacht();
    const ronde = (zonW, spaW, nu, extra) => wacht.ronde({ ...lezing(zonW, spaW, extra), nu });
    expect(ronde(1372, -121, 1)).toEqual({ nieuw: [], gemeld: [] });
    ronde(1372, -121, 2);
    // Eén lezing ertussen die niet verdacht is: weer van voren af aan.
    ronde(0, -121, 3);
    ronde(1372, -121, 4);
    ronde(1372, -121, 5);
    const derde = ronde(1380, -121, 6);
    expect(derde.nieuw).toEqual([{ sleutel: 'hw-zon', naam: 'Zon', w: 1380, sinds: 6 }]);
    expect(derde.gemeld).toEqual(derde.nieuw);
    // De spa slaat af: de melding blijft (anders springt hij heen en weer), maar niet opnieuw "nieuw".
    expect(ronde(0, -121, 7)).toEqual({ nieuw: [], gemeld: [{ sleutel: 'hw-zon', naam: 'Zon', w: 1380, sinds: 6 }] });
    // Meet hij weer duidelijk opwek, dan klopt hij toch.
    expect(ronde(-900, 0, 8)).toEqual({ nieuw: [], gemeld: [] });
  });
});
