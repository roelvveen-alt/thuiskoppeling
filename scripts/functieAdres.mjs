#!/usr/bin/env node
/**
 * Het adres van de functie ontvangMeting, voor app.adres in brug/instellingen.json.
 * Leest de app-id uit base44/.app.jsonc (die zet `npx base44 link`).
 *
 *   node scripts/functieAdres.mjs
 */
import fs from 'node:fs';
import process from 'node:process';

let id;
try {
  const tekst = fs.readFileSync(new URL('../base44/.app.jsonc', import.meta.url), 'utf8');
  id = JSON.parse(tekst.replace(/^\s*\/\/.*$/gm, '')).id;
} catch {
  // Hieronder de uitleg.
}
if (typeof id !== 'string' || !/^[a-f0-9]{10,40}$/i.test(id)) {
  console.error('Geen app gekoppeld. Draai eerst: npx base44 link --create --name "Energie thuis"');
  process.exit(1);
}
console.log(`https://base44.app/api/apps/${id}/functions/ontvangMeting`);
