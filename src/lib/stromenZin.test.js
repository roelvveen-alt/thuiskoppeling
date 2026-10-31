import { describe, expect, it } from 'vitest';
import { lijnenVoorTekening, stromenBij, verdeelStroom } from './stroom';
import { doorDeMeterkast, opsomming, regels, zinStromen } from './stromenZin';

const gewoon = (tekst) => tekst.replace(/\s/g, ' ');

/** Tims echte stand van een ochtend: dak 439 W, dierenverblijf 240 W, batterij levert 1,7 kW, 1,9 kW naar buiten. */
const TIM = {
  zonnen: [
    { sleutel: 'hw-zon-batterij', vermogen_w: 439 },
    { sleutel: 'hw-dierenverblijf', vermogen_w: 240 },
  ],
  batterij_w: 1700,
  net_w: -1929,
};
const PUNTEN = {
  'hw-zon-batterij': { sleutel: 'hw-zon-batterij', soort: 'zon', naam: 'zon + batterij' },
  'hw-dierenverblijf': { sleutel: 'hw-dierenverblijf', soort: 'zon', naam: 'Zon dierenverblijf' },
  zon: { sleutel: 'zon', soort: 'zon', naam: 'Zon' },
  batterij: { sleutel: 'batterij', soort: 'batterij', naam: 'Batterij' },
  net: { sleutel: 'net', soort: 'net', naam: 'Net' },
  huis: { sleutel: 'huis', soort: 'huis', naam: 'Huis' },
};
const puntVan = (s) => PUNTEN[s];

function blad(stand, sleutel) {
  const { stromen } = verdeelStroom(stand);
  const { erin, eruit } = stromenBij(sleutel, stromen);
  const binnen = regels(erin, 'erin', puntVan);
  const buiten = regels(eruit, 'eruit', puntVan);
  return { binnen, buiten, zin: gewoon(zinStromen(PUNTEN[sleutel], binnen, buiten)) };
}

describe('komt van en gaat naar, in gewone woorden', () => {
  it('opsommen', () => {
    expect(opsomming(['a'])).toBe('a');
    expect(opsomming(['a', 'b'])).toBe('a en b');
    expect(opsomming(['a', 'b', 'c'])).toBe('a, b en c');
  });

  it('zoals bij Tim: het huis draait op de zon, de batterij verkoopt', () => {
    const huis = blad(TIM, 'huis');
    expect(huis.zin).toBe('Je huis draait nu helemaal op de zon.');
    expect(huis.binnen.map((r) => r.naam)).toEqual(['zon + batterij', 'Zon dierenverblijf']);
    expect(huis.binnen.reduce((t, r) => t + r.aandeel, 0)).toBeCloseTo(1);

    // Zelfde volgorde en woorden als Nu in woorden: eerst de zon, dan de batterij.
    expect(blad(TIM, 'net').zin).toBe('Naar het net gaat 1,9 kW: 229 W van de zon en 1,7 kW van de batterij.');
    expect(blad(TIM, 'batterij').zin).toBe('De batterij levert 1,7 kW, alles aan het net.');
  });

  it('11:02 bij Tim: de batterij gaat voor, en elk blad zegt hetzelfde als de keten', () => {
    const stand = { ...TIM, zonnen: [{ ...TIM.zonnen[0], vermogen_w: 701 }, { ...TIM.zonnen[1], vermogen_w: 433 }], batterij_w: -627, net_w: -49 };
    expect(blad(stand, 'batterij').zin).toBe('De batterij laadt met 627 W, allemaal van de zon.');
    expect(blad(stand, 'huis').zin).toBe('Je huis draait nu helemaal op de zon.');
    expect(blad(stand, 'net').zin).toBe('Naar het net gaat 49 W, allemaal van de zon.');
    expect(blad(stand, 'hw-zon-batterij').zin).toBe('Van de 701 W gaat 388 W naar de batterij, 283 W naar het huis en 30 W naar het net.');
    expect(blad(stand, 'hw-dierenverblijf').zin).toBe('Van de 433 W gaat 239 W naar de batterij, 175 W naar het huis en 19 W naar het net.');
  });

  it('Tims voorbeeld: de zon laadt de batterij, het net vult de batterij aan en geeft het huis', () => {
    const stand = { ...TIM, zonnen: [{ ...TIM.zonnen[0], vermogen_w: 600 }, { ...TIM.zonnen[1], vermogen_w: 400 }], batterij_w: -2300, net_w: 1750 };
    expect(blad(stand, 'batterij').zin).toBe('De batterij laadt met 2,3 kW: 1,0 kW van de zon en 1,3 kW uit het net.');
    expect(blad(stand, 'huis').zin).toBe('Je huis haalt nu alles uit het net.');
    expect(blad(stand, 'net').zin).toBe('Uit het net komt 1,8 kW: 1,3 kW voor de batterij en 450 W voor het huis.');
    expect(blad(stand, 'hw-zon-batterij').zin).toBe('Alles gaat naar de batterij.');
  });

  it('binnen ±20 W: het netblad zegt niets over een stroom (de tegel zegt dan "bijna niets")', () => {
    expect(blad({ zon_w: 1000, batterij_w: -535, net_w: -15 }, 'net').zin).toBe('');
    expect(blad({ zon_w: 1000, batterij_w: -535, net_w: -15 }, 'huis').zin).toBe('Je huis draait nu helemaal op de zon.');
  });

  it('een zonneplek zegt waar zijn eigen stroom heen gaat', () => {
    const plek = blad(TIM, 'hw-dierenverblijf');
    expect(plek.buiten.map((r) => r.naam)).toEqual(['Huis', 'Net']);
    expect(plek.zin).toMatch(/^Van de 240 W gaat \d+ W naar het huis en \d+ W naar het net\.$/);
  });

  it('avond en nacht', () => {
    expect(blad({ zon_w: 0, batterij_w: 800, net_w: 1600 }, 'huis').zin).toBe('Je huis haalt nu 33% van de batterij en 67% uit het net.');
    expect(blad({ zon_w: 0, batterij_w: -2300, net_w: 2850 }, 'net').zin).toBe('Uit het net komt 2,9 kW: 2,3 kW voor de batterij en 550 W voor het huis.');
    expect(blad({ zon_w: 0, batterij_w: -2300, net_w: 2850 }, 'batterij').zin).toBe('De batterij laadt met 2,3 kW, allemaal uit het net.');
    expect(blad({ zon_w: 0, batterij_w: 0, net_w: 400 }, 'huis').zin).toBe('Je huis haalt nu alles uit het net.');
  });

  it('niets te zeggen: geen zin', () => {
    expect(blad({ zon_w: 0, batterij_w: 0, net_w: 0 }, 'huis').zin).toBe('');
  });
});

describe('door de meterkast (huisblad)', () => {
  const door = (stand) => doorDeMeterkast(lijnenVoorTekening(stand), puntVan).map((r) => [r.naam, r.w]);

  it('zoals bij Tim om 10:48: de batterij laadt via het huis, en staat er dus ook', () => {
    const stand = {
      zonnen: [
        { sleutel: 'hw-zon-batterij', vermogen_w: 911 },
        { sleutel: 'hw-dierenverblijf', vermogen_w: 571 },
      ],
      batterij_w: -887,
      net_w: -61,
    };
    expect(door(stand)).toEqual([
      ['Batterij', 887],
      ['Net', 61],
    ]);
  });

  it('de batterij verkoopt: hij komt binnen, en gaat door naar het net', () => {
    expect(door(TIM)).toEqual([['Net', 1929]]);
  });

  it("'s avonds alles uit het net: er gaat niets doorheen, dus geen extra regels", () => {
    expect(door({ zon_w: 0, batterij_w: 0, net_w: 400 })).toEqual([]);
  });
});
