#!/usr/bin/env node
/**
 * De vingerafdruk van elke functie: één regel bovenaan
 * base44/functions/<naam>/entry.ts,
 *
 *   // vingerafdruk: 3f9a0c1d2e4b5a67
 *
 * over alles wat die functie importeert (relatieve imports, ook verder door,
 * zoals base44/shared/toegang.js).
 *
 * Waarom: de CLI van Base44 kijkt per functie alleen of entry.ts zelf
 * veranderd is (gemeten in een andere Base44-app). Verandert alleen een gedeeld
 * bestand, dan ziet hij de functie als ongewijzigd en blijft de oude live, met
 * de oude rechten. Met deze regel verandert entry.ts mee.
 *
 *   node scripts/vingerafdruk.mjs              alle regels bijwerken
 *   node scripts/vingerafdruk.mjs --controle   alleen kijken; stopt met een fout als er een niet klopt
 *
 * base44/tests/vingerafdruk.test.js doet die controle bij elke `npx vitest run`.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const HOOFDMAP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FUNCTIES = path.join(HOOFDMAP, 'base44', 'functions');
const REGEL = /^\/\/ vingerafdruk: ([a-f0-9]+)$/m;
/** `… from './x.js'` (ook over meer regels) en `import './x.js'`. */
const IMPORT = /\bfrom\s+['"](\.\.?\/[^'"]+)['"]|\bimport\s+['"](\.\.?\/[^'"]+)['"]/g;

/** Alle bestanden die dit bestand relatief importeert, ook verder door. */
export function importsVan(bestand, gezien = new Set()) {
  for (const [, via, kaal] of fs.readFileSync(bestand, 'utf8').matchAll(IMPORT)) {
    const doel = path.resolve(path.dirname(bestand), via ?? kaal);
    if (gezien.has(doel)) continue;
    gezien.add(doel);
    importsVan(doel, gezien);
  }
  return gezien;
}

/** Windows-regeleinden tellen niet: ook op Windows moet hetzelfde uitkomen. */
const inhoud = (bestand) => fs.readFileSync(bestand, 'utf8').replace(/\r\n/g, '\n');

export function vingerafdrukVan(entry) {
  const hash = createHash('sha256');
  const paden = [...importsVan(entry)]
    .map((p) => [path.relative(HOOFDMAP, p).split(path.sep).join('/'), p])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [naam, pad] of paden) hash.update(`${naam}\n${inhoud(pad)}\n`);
  return hash.digest('hex').slice(0, 16);
}

/** De vingerafdruk die nu in entry.ts staat, of null. */
export const regelIn = (entry) => fs.readFileSync(entry, 'utf8').match(REGEL)?.[1] ?? null;

export function functies() {
  return fs
    .readdirSync(FUNCTIES)
    .filter((naam) => fs.existsSync(path.join(FUNCTIES, naam, 'entry.ts')))
    .sort()
    .map((naam) => ({ naam, entry: path.join(FUNCTIES, naam, 'entry.ts') }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const alleenKijken = process.argv.includes('--controle');
  let mis = false;
  for (const { naam, entry } of functies()) {
    const goed = vingerafdrukVan(entry);
    const nu = regelIn(entry);
    if (nu === goed) continue;
    if (alleenKijken) {
      console.error(`${naam}: vingerafdruk ${nu ?? 'ontbreekt'}, hoort ${goed}.`);
      mis = true;
      continue;
    }
    const tekst = fs.readFileSync(entry, 'utf8');
    const regel = `// vingerafdruk: ${goed}`;
    fs.writeFileSync(entry, nu === null ? `${regel}\n${tekst}` : tekst.replace(REGEL, regel));
    console.log(`${naam}: ${goed}`);
  }
  if (mis) {
    console.error('Draai: node scripts/vingerafdruk.mjs (en commit de entry.ts-bestanden mee).');
    process.exit(1);
  }
}
