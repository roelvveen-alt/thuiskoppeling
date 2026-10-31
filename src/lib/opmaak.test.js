import { describe, expect, it } from 'vitest';
import {
  asEuro,
  asGetal,
  huisOnbekend,
  versieKort,
  euro,
  euroPerUur,
  geldRegels,
  geleden,
  kwh,
  prijsPerKwh,
  procent,
  richting,
  vermogen,
  zinBatterij,
  zinGeld,
  zinHuis,
  zinNet,
  zinVergelijk,
  zinZon,
} from './opmaak';

// Getal en eenheid staan met een vaste spatie aan elkaar.
const sp = ' ';

describe('vermogen', () => {
  it.each([
    [0, `0${sp}W`],
    [85, `85${sp}W`],
    [-300, `300${sp}W`],
    [999.4, `999${sp}W`],
    [999.6, `1,0${sp}kW`],
    [1234, `1,2${sp}kW`],
    [9949, `9,9${sp}kW`],
    [9950, `10${sp}kW`],
    [12500, `13${sp}kW`],
    [null, '–'],
    [Number.NaN, '–'],
  ])('%s → %s', (w, tekst) => {
    expect(vermogen(w)).toBe(tekst);
  });
});

describe('zinnen', () => {
  it('net', () => {
    expect(zinNet(300)).toBe(`Je neemt 300${sp}W af van het net`);
    expect(zinNet(-1234)).toBe(`Je levert 1,2${sp}kW terug aan het net`);
    expect(zinNet(3)).toBe('Er gaat bijna niets naar of uit het net');
    // Binnen ±20 W zegt Nu in woorden "niets naar het net"; de tegel dus ook.
    expect(zinNet(-15)).toBe('Er gaat bijna niets naar of uit het net');
    expect(zinNet(19)).toBe('Er gaat bijna niets naar of uit het net');
    expect(zinNet(-20)).toBe(`Je levert 20${sp}W terug aan het net`);
    expect(zinNet(null)).toBe('Geen meter gekoppeld');
  });

  it('batterij', () => {
    expect(zinBatterij(-450)).toBe(`De batterij laadt met 450${sp}W`);
    expect(zinBatterij(300)).toBe(`De batterij levert 300${sp}W`);
    expect(zinBatterij(0)).toBe('De batterij laadt niet en levert niets');
    expect(zinBatterij(undefined)).toBe('Geen batterij gekoppeld');
  });

  it('zon en huis', () => {
    expect(zinZon(1400)).toBe(`De panelen leveren 1,4${sp}kW`);
    expect(zinZon(0)).toBe('De panelen leveren nu niets');
    expect(zinZon(12)).toBe('De panelen leveren nu bijna niets');
    expect(zinZon(20)).toBe(`De panelen leveren 20${sp}W`);
    expect(zinHuis(650)).toBe(`Je huis gebruikt nu 650${sp}W`);
  });
});

describe('kwh', () => {
  it('heel, met een punt per duizend', () => {
    expect(kwh(1830.4)).toBe(`1.830${sp}kWh`);
    expect(kwh(7500)).toBe(`7.500${sp}kWh`);
    expect(kwh(12)).toBe(`12${sp}kWh`);
    expect(kwh(null)).toBe('–');
  });
});

describe('twee P1-meters', () => {
  it('de richting bij de meterkast', () => {
    expect(richting(312)).toBe('afnemen');
    expect(richting(-1234)).toBe('terugleveren');
    expect(richting(2)).toBe('');
    expect(richting(-15)).toBe('');
    expect(richting(-20)).toBe('terugleveren');
    expect(richting(null)).toBe('');
  });

  it('vergelijken: gelijk, bijna gelijk of een echt verschil', () => {
    expect(zinVergelijk(-312, -310)).toBe('Ze meten hetzelfde.');
    expect(zinVergelijk(-312, -298)).toBe(`Ze meten bijna hetzelfde: 14${sp}W verschil.`);
    // Bij veel vermogen mag het verschil iets groter zijn (5%).
    expect(zinVergelijk(3000, 2900)).toBe(`Ze meten bijna hetzelfde: 100${sp}W verschil.`);
    expect(zinVergelijk(-500, 500)).toContain(`Ze verschillen 1,0${sp}kW. Even kan dat`);
    expect(zinVergelijk(null, 500)).toBe('');
  });
});

describe('geld', () => {
  const prijs = { afname_kwh: 0.28, teruglevering_kwh: 0.11 };

  it('euro en prijs per kWh', () => {
    expect(euro(3.4912)).toBe(`€${sp}3,49`);
    expect(euro(-0.8)).toBe(`€${sp}0,80`);
    expect(euro(null)).toBe('–');
    expect(prijsPerKwh(0.2843)).toBe(`€${sp}0,284`);
    expect(prijsPerKwh(-0.0123)).toBe(`€${sp}\u22120,012`);
  });

  it('per uur: afnemen kost, terugleveren levert op', () => {
    expect(euroPerUur(2000, prijs)).toBeCloseTo(0.56, 9);
    expect(euroPerUur(-1500, prijs)).toBeCloseTo(-0.165, 9);
    expect(euroPerUur(500, null)).toBeNull();
  });

  it('negatieve prijzen draaien het om', () => {
    // Terugleveren bij een negatieve prijs kost geld; afnemen bij een negatieve prijs levert op.
    expect(euroPerUur(-1000, { afname_kwh: 0.1, teruglevering_kwh: -0.05 })).toBeCloseTo(0.05, 9);
    expect(euroPerUur(1000, { afname_kwh: -0.02, teruglevering_kwh: 0 })).toBeCloseTo(-0.02, 9);
  });

  it('in gewone woorden', () => {
    expect(zinGeld(0.56)).toBe(`Je betaalt nu €${sp}0,56 per uur`);
    expect(zinGeld(-0.165)).toBe(`Je verdient nu €${sp}0,17 per uur`);
    expect(zinGeld(0.001)).toBe('Je betaalt en verdient nu bijna niets');
    expect(zinGeld(null)).toBe('Nog geen stroomprijs bekend');
  });
});

describe('procent en geleden', () => {
  it('procent blijft tussen 0 en 100', () => {
    expect(procent(63.4)).toBe('63%');
    expect(procent(120)).toBe('100%');
    expect(procent(-5)).toBe('0%');
    expect(procent(null)).toBe('–');
  });

  it('geleden in gewone woorden', () => {
    expect(geleden(5_000)).toBe('zojuist');
    expect(geleden(30_000)).toBe(`30${sp}s geleden`);
    expect(geleden(16_000)).toBe(`20${sp}s geleden`);
    expect(geleden(34_000)).toBe(`30${sp}s geleden`);
    expect(geleden(180_000)).toBe(`3${sp}min geleden`);
    expect(geleden(3_600_000)).toBe('1 uur geleden');
    expect(geleden(7_200_000)).toBe('2 uur geleden');
    expect(geleden(-1)).toBe('');
  });
});

describe('namen en getallen voor de tabbladen', () => {
  it('plekNaam: alleen "Zon" gevolgd door een woord valt weg, met een hoofdletter', async () => {
    const { plekNaam } = await import('./opmaak');
    expect(plekNaam('Zon dierenverblijf')).toBe('Dierenverblijf');
    expect(plekNaam('zon huis')).toBe('Huis');
    expect(plekNaam('zon + batterij')).toBe('Zon + batterij');
    expect(plekNaam('hoofddak')).toBe('Hoofddak');
    expect(plekNaam('Zonnedak')).toBe('Zonnedak');
    expect(plekNaam('Zon')).toBe('Zon');
    expect(plekNaam('')).toBe('Zon');
  });

  it('kWh van een dag met één decimaal, aandelen in procenten, van–tot', async () => {
    const { deel, kwhDag } = await import('./opmaak');
    expect(kwhDag(4.236).replace(/\s/g, ' ')).toBe('4,2 kWh');
    expect(kwhDag(1234.5).replace(/\s/g, ' ')).toBe('1.234,5 kWh');
    expect(kwhDag(null)).toBe('–');
    expect(deel(0.624)).toBe('62%');
    expect(deel(1.4)).toBe('100%');
    expect(deel(null)).toBe('–');
  });
});

describe('geldRegels: het label zegt of je betaalde of kreeg', () => {
  it('gewoon: betaald, verdiend, netto', () => {
    expect(geldRegels({ kosten: 1, opbrengst: 0.3 })).toEqual([
      ['Betaald', 1],
      ['Verdiend', 0.3],
      ['Netto kosten', 0.7],
    ]);
  });

  it('negatieve prijzen: geld gekregen voor afnemen, bijbetaald voor terugleveren; de regels tellen op tot netto', () => {
    const regels = geldRegels({ kosten: -0.5, opbrengst: 0.3 });
    expect(regels.map(([label]) => label)).toEqual(['Gekregen', 'Verdiend', 'Netto winst']);
    expect(regels[2][1]).toBeCloseTo(-0.8, 9);
    const duur = geldRegels({ kosten: 1, opbrengst: -0.2, vast: -0.5 });
    expect(duur.map(([label]) => label)).toEqual(['Betaald', 'Bijbetaald', 'Vaste korting', 'Netto kosten']);
    expect(duur[3][1]).toBeCloseTo(0.7, 9);
    expect(euro(duur[1][1])).toBe(euro(0.2));
  });

  it('zonder bedragen (nog niets): geen fout', () => {
    expect(geldRegels({ kosten: null, opbrengst: undefined })).toEqual([
      ['Betaald', null],
      ['Verdiend', undefined],
      ['Netto kosten', 0],
    ]);
  });
});

describe('zinGeld en het huis zonder netmeter', () => {
  const zin = zinGeld;
  it('geen prijs, of wel een prijs maar geen meter in de meterkast', () => {
    expect(zin(null)).toBe('Nog geen stroomprijs bekend');
    expect(zin(null, { prijs: { afname_kwh: 0.234 }, net: null })).toMatch(/meter in de meterkast antwoordt niet/);
    expect(zin(null, { prijs: null, net: null })).toBe('Nog geen stroomprijs bekend');
  });
  it('huis onbekend alleen met een meting zonder net', () => {
    expect(huisOnbekend(null)).toBe(false);
    expect(huisOnbekend({ net_w: null, zon_w: 1200 })).toBe(true);
    expect(huisOnbekend({ net_w: 0 })).toBe(false);
  });
});

describe('sindsWanneer', () => {
  it('vandaag alleen de tijd, gisteren met "gisteren", anders met de datum', async () => {
    const { sindsWanneer, tijd } = await import('./opmaak');
    const nu = new Date(2026, 9, 30, 12, 0);
    const vanochtend = new Date(2026, 9, 30, 8, 12);
    expect(sindsWanneer(vanochtend, nu)).toBe(tijd(vanochtend));
    expect(sindsWanneer(new Date(2026, 9, 29, 8, 12), nu)).toBe(`gisteren ${tijd(vanochtend)}`);
    expect(sindsWanneer(new Date(2026, 9, 28, 8, 12).getTime(), nu)).toBe(`28-10 ${tijd(vanochtend)}`);
    expect(sindsWanneer('kapot', nu)).toBe('');
  });
});

describe('versieKort', () => {
  it('laat het commit-stukje na de + weg', () => {
    expect(versieKort('0.13.0+f694722')).toBe('0.13.0');
    expect(versieKort('0.6.1')).toBe('0.6.1');
    expect(versieKort(null)).toBe('');
  });
});

describe('as van een grafiek: altijd met eenheid (weergave-20)', () => {
  it('kWh en ampère, met een echt minteken', () => {
    expect(asGetal(2.5, 'kWh')).toBe('2,5 kWh');
    expect(asGetal(-1, 'kWh')).toBe('−1 kWh');
    expect(asGetal(10, 'A')).toBe('10 A');
    expect(asGetal(Number.NaN, 'kWh')).toBe('');
  });
  it('euro: heel zonder decimalen, anders twee; prijzen vast op twee', () => {
    expect(asEuro(2)).toBe('€ 2');
    expect(asEuro(-1.5)).toBe('€ −1,50');
    expect(asEuro(0.4, 2)).toBe('€ 0,40');
    expect(asEuro(-0.1, 2)).toBe('€ −0,10');
  });
});
