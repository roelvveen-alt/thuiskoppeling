import { describe, expect, it } from 'vitest';
import { alsTekst, duurOfGoedkoop, NIETS_W, nuInWoorden, STROOM_W, watt } from './nuInWoorden';
import { verdeelStroom } from './stroom';

/** Met gewone spaties: de app zet een vaste spatie tussen getal en eenheid. */
const gewoon = (tekst) => tekst.replace(/\s/g, ' ');
const keten = (stand, opties) => gewoon(nuInWoorden(stand, verdeelStroom(stand), opties).keten.map((z) => z.tekst).join(' '));
const erbij = (stand) => nuInWoorden(stand, verdeelStroom(stand)).erbij.map((z) => gewoon(z.tekst));
const alles = (stand) => gewoon(alsTekst(nuInWoorden(stand, verdeelStroom(stand))));

/** Tims twee zonnemeters, met de namen die hij ze in de app gaf. */
const tim = (hoofddak, dierenverblijf, batterij_w, net_w, batterij_procent = 50) => ({
  zon_w: hoofddak + dierenverblijf,
  zonnen: [
    { sleutel: 'hw-zon-batterij', naam: 'Hoofddak', vermogen_w: hoofddak },
    { sleutel: 'hw-zon-dierenverblijf', naam: 'Dierenverblijf', vermogen_w: dierenverblijf },
  ],
  batterij_w,
  net_w,
  batterij_procent,
});

describe('Nu in woorden: Tims echte standen van 30 oktober', () => {
  it('11:02: de zon laadt eerst de batterij, dan het huis, de rest gaat naar het net', () => {
    const stand = tim(701, 433, -627, -49, 7);
    expect(keten(stand)).toBe(
      'De zon levert 1.134 W (Hoofddak 701 W + Dierenverblijf 433 W). Daarvan laadt 627 W de batterij en gebruikt je huis 458 W. De rest, 49 W, gaat naar het net.',
    );
    expect(erbij(stand)).toEqual(['De batterij is bijna leeg (7%).']);
  });

  it('11:08: de zon gaat helemaal naar de batterij, en het net vult aan', () => {
    expect(keten(tim(656, 422, -2418, 1800, 8))).toBe(
      'De zon levert 1.078 W (Hoofddak 656 W + Dierenverblijf 422 W). Die gaat helemaal naar de batterij. De batterij laadt met 2.418 W: 1.078 W van de zon en 1.340 W uit het net. Je huis gebruikt 460 W, ook uit het net. Uit het net komt dus 1.800 W.',
    );
  });

  it('08:26: de batterij verkoopt aan het net, de zon is voor het huis', () => {
    expect(keten(tim(262, 142, 1700, -1675, 47))).toBe(
      'De zon levert 404 W (Hoofddak 262 W + Dierenverblijf 142 W). De batterij levert 1.700 W. Je huis gebruikt 429 W: 404 W van de zon en 25 W van de batterij. De rest, 1.675 W, gaat naar het net.',
    );
  });

  it('09:49: de batterij verkoopt, en wat de zon over heeft gaat ook naar het net', () => {
    const stand = tim(976, 568, 1700, -2800, 17);
    expect(keten(stand)).toBe(
      'De zon levert 1.544 W (Hoofddak 976 W + Dierenverblijf 568 W). De batterij levert 1.700 W. Je huis gebruikt 444 W, allemaal van de zon. De rest, 2.800 W, gaat naar het net: 1.100 W van de zon en 1.700 W van de batterij.',
    );
    expect(erbij(stand)).toEqual([]);
  });

  it('10:48: de batterij is bijna leeg en laadt met wat de zon over heeft', () => {
    const stand = tim(911, 571, -887, -61, 6);
    expect(keten(stand)).toBe(
      'De zon levert 1.482 W (Hoofddak 911 W + Dierenverblijf 571 W). Daarvan laadt 887 W de batterij en gebruikt je huis 534 W. De rest, 61 W, gaat naar het net.',
    );
    expect(erbij(stand)).toEqual(['De batterij is bijna leeg (6%).']);
  });

  it('11:05: hetzelfde verhaal, andere getallen; de delen tellen op tot de zon', () => {
    expect(keten(tim(807, 425, -647, -139, 7))).toBe(
      'De zon levert 1.232 W (Hoofddak 807 W + Dierenverblijf 425 W). Daarvan laadt 647 W de batterij en gebruikt je huis 446 W. De rest, 139 W, gaat naar het net.',
    );
    expect(647 + 446 + 139).toBe(1232);
  });
});

describe('Nu in woorden: de andere gevallen', () => {
  it('Tims voorbeeld: zon 1000 W, de batterij trekt 2300 W, dan komt er 1300 W uit het net', () => {
    expect(keten(tim(600, 400, -2300, 1750))).toBe(
      'De zon levert 1.000 W (Hoofddak 600 W + Dierenverblijf 400 W). Die gaat helemaal naar de batterij. De batterij laadt met 2.300 W: 1.000 W van de zon en 1.300 W uit het net. Je huis gebruikt 450 W, ook uit het net. Uit het net komt dus 1.750 W.',
    );
  });

  it('net 0: niets naar het net en niets eruit', () => {
    expect(keten(tim(600, 400, -550, 0))).toBe(
      'De zon levert 1.000 W (Hoofddak 600 W + Dierenverblijf 400 W). Daarvan laadt 550 W de batterij en gebruikt je huis 450 W. Er gaat niets naar het net en je haalt er niets uit.',
    );
  });

  it('binnen ±20 W is het net ook niets, en staan het huis en de batterij zoals op de tegels', () => {
    expect(keten(tim(600, 400, -535, -15))).toBe(
      'De zon levert 1.000 W (Hoofddak 600 W + Dierenverblijf 400 W). Daarvan laadt 535 W de batterij en gebruikt je huis 450 W. Er gaat niets naar het net en je haalt er niets uit.',
    );
    expect(keten(tim(600, 400, -550, 10))).toContain('gebruikt je huis 460 W. Er gaat niets naar het net en je haalt er niets uit.');
    expect(keten(tim(600, 400, -550, -20))).toContain('De rest, 20 W, gaat naar het net.');
  });

  it('geen zon, de batterij levert precies wat het huis gebruikt', () => {
    expect(keten(tim(0, 0, 450, 0, 60))).toBe('Er is geen zon. Je huis draait op de batterij (450 W).');
  });

  it('geen zon, de batterij laadt uit het net (de nacht)', () => {
    expect(keten(tim(0, 0, -2300, 2850, 30))).toBe(
      'Er is geen zon. De batterij laadt met 2.300 W uit het net. Je huis gebruikt 550 W, ook uit het net. Uit het net komt dus 2.850 W.',
    );
  });

  it('de nacht met alleen het net: de batterij doet niets', () => {
    expect(keten(tim(0, 0, 0, 400, 25))).toBe('Er is geen zon. De batterij laadt niet en levert niets. Je huis haalt 400 W uit het net.');
  });

  it('de batterij is bijna leeg en doet niets: het huis haalt alles uit het net', () => {
    // 2 W uit de batterij is meetruis: hij "levert niets", maar het huis telt hem wel mee (zoals de tegel).
    const stand = tim(0, 0, 2, 400, 8);
    expect(keten(stand)).toBe('Er is geen zon. De batterij is bijna leeg (8%) en levert niets. Je huis haalt 402 W uit het net.');
    // Staat het al in de keten, dan niet nog eens erbij.
    expect(erbij(stand)).toEqual([]);
  });

  it('de avond: de batterij en het net samen voor een druk huis', () => {
    expect(keten(tim(0, 0, 800, 1600))).toBe('Er is geen zon. Je huis gebruikt 2.400 W: 800 W van de batterij en 1.600 W uit het net.');
  });

  it('de avond: de batterij verkoopt zonder zon', () => {
    expect(keten(tim(0, 0, 1700, -1250, 70))).toBe(
      'Er is geen zon. De batterij levert 1.700 W. Je huis gebruikt 450 W, allemaal van de batterij. De rest, 1.250 W, gaat naar het net.',
    );
  });

  it('de batterij is vol: wat de zon over heeft gaat naar het net', () => {
    expect(keten(tim(2000, 1000, 0, -2480, 100))).toBe(
      'De zon levert 3.000 W (Hoofddak 2.000 W + Dierenverblijf 1.000 W). De batterij is vol (100%) en laadt niet. Je huis gebruikt 520 W, allemaal van de zon. De rest, 2.480 W, gaat naar het net.',
    );
  });

  it('een zware fase staat als eerste erbij, en hooguit twee zinnen', () => {
    const stand = tim(0, 0, 800, 1600, 100);
    const uit = nuInWoorden(stand, verdeelStroom(stand), { zwareFase: 'L2 trekt nu 23,7 A, dicht bij de 25 A van de zekering.' });
    expect(uit.erbij).toEqual([
      { soort: 'fase', tekst: 'L2 trekt nu 23,7 A, dicht bij de 25 A van de zekering.' },
      { soort: 'batterij', tekst: 'De batterij is vol (100%).' },
    ]);
    expect(nuInWoorden(stand, verdeelStroom(stand)).erbij.map((z) => z.soort)).toEqual(['batterij']);
  });

  it('de batterij is vol en levert: dat staat erbij', () => {
    expect(erbij(tim(0, 0, 800, 1600, 100))).toEqual(['De batterij is vol (100%).']);
  });

  it('zon, batterij en net samen voor een druk huis', () => {
    expect(keten(tim(300, 200, 800, 200))).toBe(
      'De zon levert 500 W (Hoofddak 300 W + Dierenverblijf 200 W). Je huis gebruikt 1.500 W: 500 W van de zon, 800 W van de batterij en 200 W uit het net.',
    );
  });

  it('de zon laadt de batterij vol op, het huis krijgt de rest en vult aan uit het net', () => {
    expect(keten(tim(1700, 733, -2300, 387))).toBe(
      'De zon levert 2.433 W (Hoofddak 1.700 W + Dierenverblijf 733 W). Daarvan laadt 2.300 W de batterij; de rest, 133 W, gaat naar je huis. Je huis gebruikt 520 W: 133 W van de zon en 387 W uit het net.',
    );
  });

  it('één zonnemeter in plaats van twee: geen plekken tussen haakjes', () => {
    const stand = { zon_w: 1134, zonnen: [{ sleutel: 'zon-dak', naam: 'Zon', vermogen_w: 1134 }], batterij_w: -627, net_w: -49 };
    expect(keten(stand)).toBe('De zon levert 1.134 W. Daarvan laadt 627 W de batterij en gebruikt je huis 458 W. De rest, 49 W, gaat naar het net.');
    expect(keten({ zon_w: 1134, batterij_w: -627, net_w: -49 })).toBe(
      'De zon levert 1.134 W. Daarvan laadt 627 W de batterij en gebruikt je huis 458 W. De rest, 49 W, gaat naar het net.',
    );
  });

  it('geen batterij: de zon voor het huis, de rest naar het net', () => {
    const stand = { ...tim(800, 400, null, -750), batterij_procent: null };
    expect(keten(stand)).toBe('De zon levert 1.200 W (Hoofddak 800 W + Dierenverblijf 400 W). Daarvan gebruikt je huis 450 W. De rest, 750 W, gaat naar het net.');
    expect(keten({ ...tim(200, 100, null, 150), batterij_procent: null })).toBe(
      'De zon levert 300 W (Hoofddak 200 W + Dierenverblijf 100 W). Je huis gebruikt 450 W: 300 W van de zon en 150 W uit het net.',
    );
  });

  it('geen zonnepanelen: geen woord over de zon', () => {
    expect(keten({ zon_w: null, zonnen: [], batterij_w: 450, net_w: 0 })).toBe('Je huis draait op de batterij (450 W).');
    expect(keten({ zon_w: null, zonnen: [], batterij_w: null, net_w: 400 })).toBe('Je huis haalt 400 W uit het net.');
    expect(keten({ zon_w: null, zonnen: [], batterij_w: -2300, net_w: 2850 })).toBe(
      'De batterij laadt met 2.300 W uit het net. Je huis gebruikt 550 W, ook uit het net. Uit het net komt dus 2.850 W.',
    );
  });

  it('een plek die 0 W meet staat er gewoon bij, zodat het optelt', () => {
    expect(keten(tim(701, 0, -251, 0))).toBe(
      'De zon levert 701 W (Hoofddak 701 W + Dierenverblijf 0 W). Daarvan laadt 251 W de batterij en gebruikt je huis 450 W. Er gaat niets naar het net en je haalt er niets uit.',
    );
  });

  it('onder 20 W is er geen zon, ook als de meters een paar watt zien', () => {
    expect(keten(tim(8, 4, 438, 0))).toBe('Er is geen zon. Je huis draait op de batterij (450 W).');
  });

  it('meters die even niet gelijk lopen: dat staat erbij', () => {
    expect(alles(tim(150, 50, -900, 100))).toBe(
      'De zon levert 200 W (Hoofddak 150 W + Dierenverblijf 50 W). Die gaat helemaal naar de batterij. De batterij laadt met 900 W: 200 W van de zon en 100 W uit het net. De meters meten niet precies tegelijk, dus nu tellen de getallen even niet op.',
    );
  });

  it('eigen namen uit de app gaan voor, met een hoofdletter', () => {
    const stand = { ...tim(701, 433, -627, -49), zonnen: [{ sleutel: 'a', naam: 'zon + batterij', vermogen_w: 701 }, { sleutel: 'b', naam: 'Zon dierenverblijf', vermogen_w: 433 }] };
    const namen = { a: 'hoofddak', b: 'dierenverblijf' };
    expect(keten(stand, { naamVan: (s) => namen[s] })).toMatch(/^De zon levert 1\.134 W \(Hoofddak 701 W \+ Dierenverblijf 433 W\)\./);
  });

  it('geen stand of niets gekoppeld: geen zinnen (dus geen lege kaart)', () => {
    expect(nuInWoorden(null, null)).toEqual({ keten: [], erbij: [] });
    const niets = { zon_w: null, zonnen: [], batterij_w: null, net_w: null };
    expect(nuInWoorden(niets, verdeelStroom(niets))).toEqual({ keten: [], erbij: [] });
  });
});

describe('Nu in woorden: duur of goedkoop tegenover vandaag', () => {
  // Middernacht van 30 oktober 2026 in Nederland (wintertijd).
  const NACHT = Date.UTC(2026, 9, 29, 23);
  const KWARTIER = 15 * 60_000;
  // Een dag van 96 kwartieren: van € 0,200 tot € 0,295, elk kwartier een tiende cent duurder.
  const voorspelling = { van: NACHT, stapMs: KWARTIER, afname: Array.from({ length: 96 }, (_, i) => 0.2 + i * 0.001) };
  const op = (kwartier) => ({
    ...tim(701, 433, -627, -49),
    klok: NACHT + kwartier * KWARTIER,
    prijs: { afname_kwh: voorspelling.afname[kwartier], teruglevering_kwh: 0.3 },
    voorspelling,
  });

  it('in het duurste kwart van de dag: duur, met de prijs', () => {
    expect(gewoon(duurOfGoedkoop(op(90)))).toBe('Stroom is nu duur: € 0,290 per kWh, duurder dan driekwart van de dag.');
    expect(erbij(op(90))).toEqual(['Stroom is nu duur: € 0,290 per kWh, duurder dan driekwart van de dag.']);
  });

  it('in het goedkoopste kwart: goedkoop; daartussen niets', () => {
    expect(gewoon(duurOfGoedkoop(op(3)))).toBe('Stroom is nu goedkoop: € 0,203 per kWh, goedkoper dan driekwart van de dag.');
    expect(duurOfGoedkoop(op(48))).toBe('');
  });

  it('zonder prijzen van vandaag, of met te weinig, geen zin over de prijs', () => {
    expect(duurOfGoedkoop({ ...op(90), voorspelling: null })).toBe('');
    expect(duurOfGoedkoop({ ...op(90), klok: NACHT + 3 * 86_400_000 })).toBe('');
    expect(duurOfGoedkoop({ ...op(90), voorspelling: { ...voorspelling, afname: voorspelling.afname.slice(0, 20) } })).toBe('');
    expect(duurOfGoedkoop({ ...op(90), prijs: null })).toBe('');
  });

  it('live telt het moment van de meting als nu', () => {
    const { klok, ...stand } = op(90);
    expect(gewoon(duurOfGoedkoop({ ...stand, moment: new Date(klok).toISOString() }))).toMatch(/^Stroom is nu duur/);
  });

  it('hooguit twee zinnen erbij', () => {
    const stand = { ...tim(150, 50, -900, 100, 5), klok: NACHT + 90 * KWARTIER, prijs: { afname_kwh: 0.29, teruglevering_kwh: 0.3 }, voorspelling };
    expect(erbij(stand)).toEqual(['De meters meten niet precies tegelijk, dus nu tellen de getallen even niet op.', 'De batterij is bijna leeg (5%).']);
  });
});

describe('Nu in woorden: altijd hetzelfde verhaal als de rest van de app', () => {
  it('hele watts met een punt voor de duizendtallen', () => {
    expect(gewoon(watt(1134))).toBe('1.134 W');
    expect(gewoon(watt(-49.4))).toBe('49 W');
    expect(gewoon(watt(12500))).toBe('12.500 W');
    expect(gewoon(watt(null))).toBe('0 W');
    expect([STROOM_W, NIETS_W]).toEqual([5, 20]);
  });

  it('bij elke stand: het huis staat erin als op de tegel, "niets naar het net" alleen binnen ±20 W, en de volgorde klopt', () => {
    // Een vast reeksje willekeurige standen.
    let zaad = 7;
    const toeval = () => {
      zaad = (zaad * 16807) % 2147483647;
      return zaad / 2147483647;
    };
    const volgorde = ['zon', 'batterij', 'huis', 'net'];
    for (let n = 0; n < 400; n++) {
      const hoofddak = Math.round(toeval() < 0.3 ? toeval() * 15 : toeval() * 3000);
      const dier = Math.round(toeval() * 1200 * (hoofddak > 15 ? 1 : 0));
      const huis = Math.round(200 + toeval() * 2500);
      const batterij = Math.round((toeval() - 0.5) * 4800);
      const net = huis - hoofddak - dier - batterij + Math.round((toeval() - 0.5) * 30);
      const stand = tim(hoofddak, dier, batterij, net);
      const v = verdeelStroom(stand);
      const uit = nuInWoorden(stand, v);
      const tekst = gewoon(alsTekst(uit));
      expect(tekst).not.toMatch(/NaN|undefined|null/);
      expect(uit.keten.length).toBeGreaterThan(0);
      if (v.huis_w >= NIETS_W && Math.abs(net) >= NIETS_W) expect(tekst).toContain(gewoon(watt(v.huis_w)));
      expect(tekst.includes('Er gaat niets naar het net')).toBe(Math.abs(net) < NIETS_W && !(batterij >= STROOM_W && hoofddak + dier < NIETS_W));
      const plekken = uit.keten.map((z) => volgorde.indexOf(z.soort));
      expect(plekken).toEqual([...plekken].sort((a, b) => a - b));
      expect(uit.erbij.length).toBeLessThanOrEqual(2);
    }
  });
});
