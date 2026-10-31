#!/usr/bin/env node
/**
 * De vastgelegde velden van elke tabel (base44/entities/*.jsonc), met hun
 * type, in base44/tests/velden.json.
 *
 * Waarom: een uitrol (`deploy`) zet de tabellen live gelijk aan wat hier
 * staat. Een veld dat hier verdwijnt of hernoemd wordt, is live weg, met wat
 * erin stond. base44/tests/entiteiten.test.js kijkt bij elke `npx vitest run`
 * of elk vastgelegd veld er nog is, met hetzelfde type. Erbij komen mag: dan
 * dit script draaien en velden.json meecommitten.
 *
 *   node scripts/velden.mjs              velden.json bijwerken (alleen erbij; weghalen weigert hij)
 *   node scripts/velden.mjs --controle   alleen kijken; stopt met een fout als het niet klopt
 *
 * velden.json staat bij de tests, niet bij de tabellen: wat in base44/entities
 * staat, gaat naar Base44.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const HOOFDMAP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TABELLEN = path.join(HOOFDMAP, 'base44', 'entities');
export const VELDEN = path.join(HOOFDMAP, 'base44', 'tests', 'velden.json');

/** Een .jsonc-bestand: JSON met regels die met // beginnen. */
export function leesJsonc(pad) {
  return JSON.parse(fs.readFileSync(pad, 'utf8').replace(/^\s*\/\/.*$/gm, ''));
}

/** Alle tabellen: { Naam: schema }. */
export function alleTabellen(map = TABELLEN) {
  return Object.fromEntries(
    fs
      .readdirSync(map)
      .filter((f) => f.endsWith('.jsonc'))
      .sort()
      .map((f) => {
        const schema = leesJsonc(path.join(map, f));
        return [schema.name ?? path.basename(f, '.jsonc'), schema];
      }),
  );
}

/** Elk veld, ook binnenin (prijs.afname_kwh, zonnen[].sleutel), met zijn type. */
export function veldenVan(schema, voor = '') {
  const uit = {};
  for (const [naam, veld] of Object.entries(schema?.properties ?? {})) {
    const pad = `${voor}${naam}`;
    uit[pad] = veld?.type ?? '?';
    Object.assign(uit, veldenVan(veld, `${pad}.`));
    if (veld?.items) {
      uit[`${pad}[]`] = veld.items.type ?? '?';
      Object.assign(uit, veldenVan(veld.items, `${pad}[].`));
    }
  }
  return uit;
}

/** Wat er mis is tussen vastgelegd en nu: verdwenen tabellen of velden, en een ander type. */
export function verschillen(vastgelegd, tabellen) {
  const fouten = [];
  for (const [tabel, velden] of Object.entries(vastgelegd)) {
    if (!tabellen[tabel]) {
      fouten.push(`Tabel ${tabel} ontbreekt in base44/entities (een uitrol haalt hem live weg).`);
      continue;
    }
    const nu = veldenVan(tabellen[tabel]);
    for (const [veld, type] of Object.entries(velden)) {
      if (!(veld in nu)) fouten.push(`${tabel}.${veld} is weg (een uitrol haalt het live weg, met wat erin staat).`);
      else if (JSON.stringify(nu[veld]) !== JSON.stringify(type)) fouten.push(`${tabel}.${veld} was ${JSON.stringify(type)}, nu ${JSON.stringify(nu[veld])}.`);
    }
  }
  return fouten;
}

/** Wat er nieuw is en nog niet vastgelegd. */
export function nieuw(vastgelegd, tabellen) {
  const uit = [];
  for (const [tabel, schema] of Object.entries(tabellen)) {
    for (const veld of Object.keys(veldenVan(schema))) if (!(veld in (vastgelegd[tabel] ?? {}))) uit.push(`${tabel}.${veld}`);
  }
  return uit;
}

function hoofd() {
  const controle = process.argv.includes('--controle');
  const tabellen = alleTabellen();
  const vastgelegd = fs.existsSync(VELDEN) ? JSON.parse(fs.readFileSync(VELDEN, 'utf8')) : {};
  const fouten = verschillen(vastgelegd, tabellen);
  if (fouten.length) {
    console.error(`Niet alleen erbij:\n  - ${fouten.join('\n  - ')}\nZet het terug. Echt weg moet het alleen na overleg met de beheerder van de app, en dan haal je het met de hand uit velden.json.`);
    process.exit(1);
  }
  const erbij = nieuw(vastgelegd, tabellen);
  if (controle) {
    if (erbij.length) {
      console.error(`Nieuw en nog niet vastgelegd: ${erbij.join(', ')}. Draai: node scripts/velden.mjs`);
      process.exit(1);
    }
    console.log('Velden kloppen.');
    return;
  }
  const uit = Object.fromEntries(Object.entries(tabellen).map(([tabel, schema]) => [tabel, { ...(vastgelegd[tabel] ?? {}), ...veldenVan(schema) }]));
  for (const [tabel, velden] of Object.entries(vastgelegd)) if (!uit[tabel]) uit[tabel] = velden;
  fs.writeFileSync(VELDEN, `${JSON.stringify(uit, null, 2)}\n`);
  console.log(erbij.length ? `Vastgelegd: ${erbij.join(', ')}` : 'Niets nieuws.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) hoofd();
