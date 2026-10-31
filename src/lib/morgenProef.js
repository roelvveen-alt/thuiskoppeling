/**
 * Een nephuis voor de tests en het voorbeeld van het tabblad Voorspelling:
 * dagen met gemeten zon per uur en straling uit een "weerbericht", en een
 * weerbericht voor vandaag en morgen, in de vorm die de site heeft (dagenUit
 * in src/lib/periode.js en weerUit in src/lib/bron.js). De echte panelen
 * staan anders dan de app aanneemt (een ander dak, een andere
 * prestatieverhouding), zodat je ziet dat hij dat leert.
 */

import { dagErbij, middernachtVan } from './morgen';
import { bovenDeLucht, lichtOpPanelen, STANDAARD_PLAATS, zonnestand } from './zonnestand';

const UUR_MS = 3_600_000;

/** Helder of grijs per uur: de straling op de grond (W/m²) uit hoe helder het is (kt, 0 tot 1). */
export function stralingOp(begin, kt, plaats = STANDAARD_PLAATS) {
  const midden = begin + UUR_MS / 2;
  return Math.round(bovenDeLucht(midden, zonnestand(midden, plaats).hoogte) * kt);
}

/**
 * Een plek met panelen zoals hij echt is: { sleutel, kwp, helling, richting, prestatie }.
 * Wat hij levert in het uur vanaf `begin` bij `straling` W/m² (Wh).
 */
export function echteOpbrengst(plek, begin, straling, plaats = STANDAARD_PLAATS) {
  const licht = lichtOpPanelen(begin, straling, plaats, { helling: plek.helling, richting: plek.richting });
  // Een boom of de buren: onder deze zonshoogte nog maar een derde.
  const schaduw = plek.schaduwOnder && licht.hoogte < plek.schaduwOnder ? 0.33 : 1;
  return Math.round(plek.kwp * plek.prestatie * licht.schuin * schaduw);
}

/**
 * Dagen zoals dagenUit ze geeft, met per uur de straling en de gemeten zon
 * (per plek als `perPlek`), tot en met de dag vóór `tot`.
 *
 * @param {{ tot: string, aantal: number, plekken: Array, helder?: (dagIndex: number, uur: number) => number, perPlek?: boolean, omvormer?: string|null }} o
 */
export function nepDagen({ tot, aantal, plekken, helder = () => 0.55, perPlek = false, omvormer = null, huisW = 450 }) {
  const dagen = [];
  let teller = 23_000;
  for (let n = aantal; n >= 1; n--) {
    const datum = dagErbij(tot, -n);
    const begin = middernachtVan(datum);
    const stralingWh = [];
    const zonWh = [];
    const zonnenWh = Object.fromEntries(plekken.map((p) => [p.sleutel, []]));
    for (let h = 0; h < 24; h++) {
      const t = begin + h * UUR_MS;
      const s = stralingOp(t, helder(n, h));
      stralingWh.push(s);
      let totaal = 0;
      for (const p of plekken) {
        const wh = echteOpbrengst(p, t, s);
        zonnenWh[p.sleutel].push(wh);
        totaal += wh;
      }
      zonWh.push(totaal);
    }
    const zon = zonWh.reduce((a, b) => a + b, 0) / 1000;
    const omvormerKwh = omvormer ? zonnenWh[omvormer].reduce((a, b) => a + b, 0) / 1000 : null;
    if (omvormerKwh !== null) teller += omvormerKwh;
    dagen.push({
      datum,
      zon,
      huis: (huisW * 24) / 1000,
      kwartieren: 96,
      uren: { huisWh: Array(24).fill(huisW), zonWh, stralingWh, kwartieren: Array(24).fill(4), zonnenWh: perPlek && plekken.length >= 2 ? zonnenWh : null },
      omvormer: omvormer ? { kwh: Math.round(omvormerKwh * 100) / 100, totaal: Math.round(teller * 10) / 10, bij: omvormer } : null,
    });
  }
  return dagen;
}

/**
 * Het weerbericht zoals weerUit het geeft: van 23:00 gisteren tot 23:00 morgen,
 * met de nieuwe reeksen van 0.10.0 (of zonder, `oud`).
 *
 * @param {{ vandaag: string, helder?: (i: number, uur: number) => number, oud?: boolean, opgehaald: number,
 *   code?: (i: number) => number, neerslag?: (i: number) => number, kans?: (i: number) => number, stoten?: (i: number) => number,
 *   bewolking?: (i: number) => number, temp?: (i: number) => number }} o
 */
export function nepWeer({ vandaag, helder = () => 0.6, oud = false, opgehaald, code, neerslag, kans, stoten, bewolking, temp }) {
  const van = middernachtVan(vandaag) - UUR_MS;
  const rij = (f) => Array.from({ length: 48 }, (_, i) => f(i));
  const uur = (i) => new Date(van + i * UUR_MS).getUTCHours();
  const straling = rij((i) => stralingOp(van + i * UUR_MS, helder(i, uur(i))));
  const bew = rij(bewolking ?? ((i) => Math.round((1 - helder(i, uur(i))) * 100)));
  return {
    van,
    stapMs: UUR_MS,
    straling,
    bewolking: bew,
    temp: rij(temp ?? ((i) => 6 + 5 * Math.sin(((i % 24) - 9) / 24 * 2 * Math.PI))),
    code: oud ? null : rij(code ?? ((i) => (bew[i] < 20 ? 0 : bew[i] < 50 ? 1 : bew[i] < 85 ? 2 : 3))),
    neerslag: oud ? null : rij(neerslag ?? (() => 0)),
    kans: oud ? null : rij(kans ?? (() => 5)),
    stoten: oud ? null : rij(stoten ?? (() => 25)),
    nu: null,
    opgehaald,
    bron: 'open-meteo',
  };
}
