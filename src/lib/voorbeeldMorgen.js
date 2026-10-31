/**
 * Het tabblad Voorspelling in het voorbeeld (zonder app-id, of nog niets van
 * thuis): zes nepdagen met de zon per plek en de straling per uur, en een
 * weerbericht voor vandaag en morgen met alles erin (programmaatje 0.10.0):
 * morgenochtend buien, 's middags zon, 's avonds stevige windstoten. Zo zie
 * je hoe het tabblad leert en wat het laat zien. Alleen de datum telt.
 */

import { datumVan, middernachtVan } from './morgen';
import { nepDagen, nepWeer } from './morgenProef';
import { voorbeeldWeer } from './voorbeeld';

const UUR_MS = 3_600_000;
/** Zo helder was het de laatste dagen (1 = gisteren). */
const DAGEN_HELDER = [0.58, 0.32, 0.5, 0.22, 0.61, 0.44];

/**
 * Het weer van vandaag per uur zoals de tekening het toont (voorbeeldWeer):
 * de mist van de ochtend, de bui rond twaalf, de regen en wind van de avond.
 * Valt er in dat uur iets (of mist), dan telt dat; anders het halve uur.
 * Zo zegt Voorspelling niet "droog" terwijl het op de tekening regent (weergave-12).
 */
export function weerVanUur(uur) {
  const monsters = [0, 0.25, 0.5, 0.75].map((d) => voorbeeldWeer(uur + d).nu);
  return monsters.find((n) => n.neerslag > 0 || n.code === 45) ?? monsters[2];
}

/**
 * @param {number} nu  ms (in het voorbeeld de klok van het gekozen moment)
 * @param {Array<{ sleutel: string, maxW: number|null }>} bronnen  de zonnebronnen (bronnenUit in morgen.js)
 * @returns {{ dagen: Array, weer: object }}
 */
export function voorbeeldMorgen(nu, bronnen) {
  const vandaag = datumVan(nu);
  // De echte panelen staan anders dan de app aanneemt: het hoofddak op het zuidwesten, het dierenverblijf plat op het oosten.
  const plekken = bronnen.map((b, i) => ({
    sleutel: b.sleutel,
    kwp: (b.maxW ?? (i === 0 ? 8000 : 3000)) / 1000,
    helling: i === 0 ? 40 : 15,
    richting: i === 0 ? 210 : 120,
    prestatie: i === 0 ? 0.74 : 0.84,
  }));
  const dagen = nepDagen({ tot: vandaag, aantal: DAGEN_HELDER.length, plekken, perPlek: true, helder: (n) => DAGEN_HELDER[(n - 1) % DAGEN_HELDER.length] });
  // Plek i in het bericht is het uur vanaf 23:00 gisteren + i; morgen h:00 is plek 25 + h.
  const van = middernachtVan(vandaag) - UUR_MS;
  const uurVan = (i) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', hour: '2-digit', hourCycle: 'h23' }).format(new Date(van + i * UUR_MS))) % 24;
  const morgen = (i) => i >= 25;
  const buien = (i) => morgen(i) && uurVan(i) >= 7 && uurVan(i) < 11;
  const wind = (i) => morgen(i) && uurVan(i) >= 18 && uurVan(i) < 22;
  // Vandaag (plek 1–24): hetzelfde weer als op de tekening.
  const vandaagWeer = (i) => (i >= 1 && !morgen(i) ? weerVanUur(uurVan(i)) : null);
  const nat = (i) => (vandaagWeer(i)?.neerslag ?? 0) > 0;
  const weer = nepWeer({
    vandaag,
    opgehaald: nu - 20 * 60_000,
    helder: (i) => (buien(i) ? 0.25 : morgen(i) ? 0.62 : 0.45),
    bewolking: (i) => vandaagWeer(i)?.bewolking ?? (buien(i) ? 90 : morgen(i) ? (uurVan(i) >= 11 && uurVan(i) < 17 ? 30 : 55) : 65),
    code: (i) => vandaagWeer(i)?.code ?? (buien(i) ? (uurVan(i) === 8 ? 81 : 80) : morgen(i) ? (uurVan(i) >= 11 && uurVan(i) < 17 ? 1 : 2) : 3),
    neerslag: (i) => vandaagWeer(i)?.neerslag ?? (buien(i) ? (uurVan(i) === 8 ? 1.6 : 0.5) : 0),
    kans: (i) => (buien(i) || nat(i) ? 70 : 10),
    stoten: (i) => vandaagWeer(i)?.stoten ?? (wind(i) ? 64 : 28),
    temp: (i) => 7 + 5 * Math.sin(((uurVan(i) - 9) / 24) * 2 * Math.PI) + (morgen(i) ? 1 : 0),
  });
  return { dagen, weer };
}
