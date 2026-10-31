import { describe, expect, it } from 'vitest';
import { alsTekst, nuInWoorden } from './nuInWoorden';
import { plekNaam } from './opmaak';
import { verdeelStroom } from './stroom';
import { MOMENTEN, uurVan, voorbeeldStand } from './voorbeeld';

const heeft = (stand, van, naar) => verdeelStroom(stand).stromen.some((s) => s.van === van && s.naar === naar);
const NACHT = Date.UTC(2026, 9, 29, 23);
/** Wat Nu in woorden bij dit uur zegt, met de namen zoals de app ze laat zien. */
const woorden = (uur) => {
  const stand = voorbeeldStand(uur, 0, 'dierenverblijf', NACHT);
  const naamVan = (s) => plekNaam(stand.zonnen.find((z) => z.sleutel === s)?.naam);
  return alsTekst(nuInWoorden(stand, verdeelStroom(stand), { naamVan })).replace(/\s/g, ' ');
};
const ZON_HUIS = 'hw-zon-batterij';
const ZON_DIER = 'hw-zon-dierenverblijf';

describe('voorbeeldStand', () => {
  it('01:30: de batterij laadt met 2300 W uit het net, zoals in de HomeWizard-grafiek', () => {
    const stand = voorbeeldStand(1.5);
    expect(stand.zon_w).toBe(0);
    expect(stand.batterij_w).toBe(-2300);
    expect(stand.net_w).toBeGreaterThan(2700);
    expect(heeft(stand, 'net', 'batterij')).toBe(true);
    expect(heeft(stand, 'net', 'huis')).toBe(true);
  });

  it('10:15: de zon van beide plekken draait de was (die zit in het huis, zonder eigen meter)', () => {
    const stand = voorbeeldStand(10.25);
    expect(stand.apparaten).toEqual([]);
    expect(verdeelStroom(stand).huis_w).toBeGreaterThan(2400);
    expect(heeft(stand, ZON_HUIS, 'huis')).toBe(true);
    expect(heeft(stand, ZON_DIER, 'huis')).toBe(true);
  });

  it('13:00: beide plekken laden de batterij en leveren terug', () => {
    const stand = voorbeeldStand(13);
    expect(stand.zon_w).toBeGreaterThan(4000);
    expect(stand.batterij_w).toBe(-2400);
    expect(stand.net_w).toBeLessThan(-1000);
    for (const bron of [ZON_HUIS, ZON_DIER]) {
      expect(heeft(stand, bron, 'batterij')).toBe(true);
      expect(heeft(stand, bron, 'net')).toBe(true);
      expect(heeft(stand, bron, 'huis')).toBe(true);
    }
  });

  it('08:30: de zon voor het huis, de batterij verkoopt aan het net (zoals bij Tim om 08:26)', () => {
    const stand = voorbeeldStand(8.5);
    expect(stand.batterij_w).toBe(1700);
    expect(stand.net_w).toBeLessThan(-1500);
    expect(heeft(stand, 'batterij', 'net')).toBe(true);
    expect(heeft(stand, 'batterij', 'huis')).toBe(false);
    expect(heeft(stand, ZON_HUIS, 'huis')).toBe(true);
  });

  it('12:00: een wolk, en de batterij laadt met de zon én uit het net', () => {
    const stand = voorbeeldStand(12);
    expect(stand.zon_w).toBeGreaterThan(800);
    expect(stand.zon_w).toBeLessThan(1300);
    expect(stand.batterij_w).toBe(-2300);
    expect(stand.net_w).toBeGreaterThan(1500);
    for (const bron of [ZON_HUIS, ZON_DIER]) {
      expect(heeft(stand, bron, 'batterij')).toBe(true);
      expect(heeft(stand, bron, 'huis')).toBe(false);
    }
    expect(heeft(stand, 'net', 'batterij')).toBe(true);
    expect(heeft(stand, 'net', 'huis')).toBe(true);
    // Voor en na de wolk weer de gewone zon.
    expect(voorbeeldStand(11.5).zon_w).toBeGreaterThan(3000);
  });

  it('elk moment laat een ander stuk van de keten zien (Nu in woorden)', () => {
    expect(woorden(1.5)).toMatch(/^Er is geen zon\. De batterij laadt met 2\.300 W uit het net\. Je huis gebruikt \d+ W, ook uit het net\. Uit het net komt dus 2\.\d{3} W\.$/);
    expect(woorden(8.5)).toMatch(/^De zon levert \d+ W \(Hoofddak \d+ W \+ Dierenverblijf \d+ W\)\. De batterij levert 1\.700 W\. Je huis gebruikt \d+ W, allemaal van de zon\. De rest, 1\.\d{3} W, gaat naar het net: \d+ W van de zon en 1\.700 W van de batterij\.$/);
    expect(woorden(10.25)).toMatch(/Daarvan laadt \d+ W de batterij en gebruikt je huis 2\.\d{3} W\. Er gaat niets naar het net en je haalt er niets uit\.$/);
    expect(woorden(12)).toMatch(
      /Die gaat helemaal naar de batterij\. De batterij laadt met 2\.300 W: 1\.\d{3} W van de zon en 1\.\d{3} W uit het net\. Je huis gebruikt \d+ W, ook uit het net\. Uit het net komt dus 1\.\d{3} W\. Stroom is nu goedkoop: € 0,\d{3} per kWh, goedkoper dan driekwart van de dag\.$/,
    );
    expect(woorden(13)).toMatch(/Daarvan laadt 2\.400 W de batterij en gebruikt je huis \d+ W\. De rest, 1\.\d{3} W, gaat naar het net\./);
    expect(woorden(19.75)).toMatch(/^Er is geen zon\. Je huis gebruikt 2\.\d{3} W: 2\.400 W van de batterij en \d+ W uit het net\. Stroom is nu duur: € 0,\d{3} per kWh, duurder dan driekwart van de dag\.$/);
  });

  it('19:45: geen zon, vaatwasser aan, de batterij levert het meeste', () => {
    const stand = voorbeeldStand(19.75);
    expect(stand.zon_w).toBe(0);
    expect(stand.batterij_w).toBe(2400);
    expect(stand.net_w).toBeGreaterThan(100);
    expect(heeft(stand, 'batterij', 'huis')).toBe(true);
  });

  it('de zon is de som van de twee plekken', () => {
    for (const uur of [9, 12, 16]) {
      const stand = voorbeeldStand(uur, 3);
      expect(stand.zon_w).toBe(stand.zonnen.reduce((som, z) => som + z.vermogen_w, 0));
    }
  });

  it('batterij tussen 0 en 100 procent, de hele dag', () => {
    for (let uur = 0; uur < 24; uur += 0.5) {
      const { batterij_procent } = voorbeeldStand(uur);
      expect(batterij_procent).toBeGreaterThanOrEqual(0);
      expect(batterij_procent).toBeLessThanOrEqual(100);
    }
  });

  it('zelfde uur en tik: zelfde cijfers; andere tik: een beetje anders', () => {
    expect(voorbeeldStand(13, 4)).toEqual(voorbeeldStand(13, 4));
    expect(voorbeeldStand(13, 4).zon_w).not.toBe(voorbeeldStand(13, 5).zon_w);
  });

  it('prijzen zoals Zonneplan: overdag Zonnebonus bij terugleveren, de avond is duur', () => {
    const middag = voorbeeldStand(13).prijs;
    expect(middag.zonnebonus_kwh).toBeGreaterThan(0);
    expect(middag.teruglevering_kwh).toBeCloseTo(middag.afname_kwh + middag.zonnebonus_kwh, 5);
    const avond = voorbeeldStand(19.75).prijs;
    expect(avond).toMatchObject({ zonnebonus_kwh: 0, teruglevering_kwh: avond.afname_kwh });
    expect(avond.afname_kwh).toBeGreaterThan(middag.afname_kwh);
  });

  it('vandaag: het nachtladen kost geld, de zon levert op; het telt alleen maar op', () => {
    const nacht = voorbeeldStand(3).vandaag;
    expect(nacht.afname_kwh).toBeGreaterThan(4);
    expect(nacht.teruglevering_kwh).toBeLessThan(0.05);
    const middag = voorbeeldStand(13).vandaag;
    expect(middag.teruglevering_kwh).toBeGreaterThan(1);
    expect(middag.opbrengst_eur).toBeGreaterThan(0);
    const avond = voorbeeldStand(19.75).vandaag;
    expect(avond.afname_kwh).toBeGreaterThanOrEqual(middag.afname_kwh);
    expect(avond.kosten_eur).toBeGreaterThanOrEqual(middag.kosten_eur);
    expect(voorbeeldStand(0).vandaag).toMatchObject({ afname_kwh: 0, kosten_eur: 0 });
    // Vaste kosten per dag (met de korting op de energiebelasting) en de Zonnebonus van dit jaar.
    expect(typeof avond.vaste_kosten_eur).toBe('number');
    expect(voorbeeldStand(13).jaar).toEqual({ teruglevering_kwh: 6830, plafond_kwh: 7500 });
  });

  it('past bij de tekening: een schuur, of alle panelen samen op het huis', () => {
    expect(voorbeeldStand(13).zonnen.map((z) => z.naam)).toEqual(['Zon hoofddak', 'Zon dierenverblijf']);
    expect(voorbeeldStand(13, 0, 'schuur').zonnen.map((z) => z.naam)).toEqual(['Zon hoofddak', 'Zon schuur']);
    // Alleen het huis, en vrijstaand met garage: daar liggen geen panelen op een bijgebouw.
    for (const tekening of ['huis', 'garage']) {
      const stand = voorbeeldStand(13, 0, tekening);
      expect(stand.zonnen, tekening).toHaveLength(1);
      expect(stand.zonnen[0], tekening).toMatchObject({ naam: 'Zon', vermogen_w: stand.zon_w });
      expect(stand.zon_w, tekening).toBe(voorbeeldStand(13).zon_w);
    }
  });

  it('elk vast moment bestaat en geeft een stand', () => {
    for (const moment of MOMENTEN.filter((m) => m.uur != null)) {
      const stand = voorbeeldStand(uurVan(moment.sleutel));
      expect(stand.apparaten).toHaveLength(0);
      expect(stand.zonnen).toHaveLength(2);
    }
  });
});

describe('uurVan', () => {
  it('vaste momenten', () => {
    expect(uurVan('middag')).toBe(13);
    expect(uurVan('nacht')).toBe(1.5);
  });

  it('nu is de klok van het toestel', () => {
    expect(uurVan('nu', new Date(2026, 9, 29, 21, 30))).toBe(21.5);
  });
});

describe('wat de batterij in het voorbeeld zelf meldt', () => {
  it('01:30 laden: warmer, hoe lang nog tot vol, stroom erbij; 19:45 leveren: hoe lang nog tot leeg', () => {
    const nacht = voorbeeldStand(1.5).batterij_info;
    expect(nacht).toMatchObject({ laadgrens_pct: 100, ontlaadgrens_pct: 10, pakketten: 3, inhoud_kwh: 8.64, storing: false });
    expect(nacht.accus).toHaveLength(3);
    expect(nacht.vol_over_min).toBeGreaterThan(60);
    expect(nacht.vol_over_min).toBeLessThan(180);
    expect(nacht).not.toHaveProperty('leeg_over_min');
    expect(nacht.stroom_a).toBeGreaterThan(40);
    const avond = voorbeeldStand(19.75).batterij_info;
    expect(avond.leeg_over_min).toBeGreaterThan(30);
    expect(avond).not.toHaveProperty('vol_over_min');
  });

  it('de hele dag aannemelijk: temperaturen, spanning, de koelste accu niet warmer dan de warmste', () => {
    for (let uur = 0; uur < 24; uur += 0.5) {
      const info = voorbeeldStand(uur).batterij_info;
      expect(info.temp_c).toBeGreaterThan(15);
      expect(info.temp_c).toBeLessThan(30);
      expect(info.temp_min_c).toBeLessThanOrEqual(info.temp_c);
      expect(info.behuizing_c).toBeLessThan(45);
      expect(info.spanning_v).toBeGreaterThan(49);
      expect(info.spanning_v).toBeLessThan(55);
      expect(info.vol_over_min ?? 1).toBeGreaterThan(0);
    }
  });
});

describe('het voorbeeld: de tekening en Voorspelling zeggen hetzelfde weer', () => {
  it('mist om 08:30, een bui om 12:00, regen en wind om 19:45, droog om 13:00', async () => {
    const { voorbeeldMorgen } = await import('./voorbeeldMorgen');
    const { voorbeeldWeer } = await import('./voorbeeld');
    const dag = Date.parse('2026-10-29T23:00:00Z'); // middernacht in Nederland (wintertijd)
    const { weer } = voorbeeldMorgen(dag + 12 * 3_600_000, [{ sleutel: 'a', maxW: 8000 }, { sleutel: 'b', maxW: 3000 }]);
    const plek = (u) => Math.floor(u) + 1; // plek 0 is 23:00 gisteren
    for (const u of [8.5, 12, 13, 19.75]) {
      const tekening = voorbeeldWeer(u).nu;
      const i = plek(u);
      expect(weer.neerslag[i] > 0, `regen om ${u}`).toBe(tekening.neerslag > 0);
      expect(weer.code[i] === 45, `mist om ${u}`).toBe(tekening.code === 45);
    }
  });
});

describe('het voorbeeld loopt niet achter', () => {
  it('het programmaatje in het voorbeeld heeft de versie van brug/versie.mjs', async () => {
    const fs = await import('node:fs');
    const { VOORBEELD_BRUG_VERSIE } = await import('./voorbeeld');
    const tekst = fs.readFileSync(new URL('../../brug/versie.mjs', import.meta.url), 'utf8');
    expect(VOORBEELD_BRUG_VERSIE).toBe(tekst.match(/export const VERSIE = '([^']+)'/)[1]);
  });
});
