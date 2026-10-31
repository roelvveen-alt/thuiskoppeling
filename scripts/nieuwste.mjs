#!/usr/bin/env node
/**
 * Altijd de nieuwste versies (afspraak sinds 2026-10-30).
 *
 *   node scripts/nieuwste.mjs              laat zien wat er nieuwer is (hoofdmap en brug/, en Deno)
 *   node scripts/nieuwste.mjs --bijwerken  zet alles op de nieuwste versie, exact vastgezet
 *
 * Daarna altijd de poorten (node scripts/poorten.mjs): een nieuwe versie kan
 * iets veranderen. Komt @base44/sdk mee, dan zet --bijwerken dezelfde versie
 * in `npm:@base44/sdk@…` van elke base44/functions/<naam>/entry.ts, en de
 * vingerafdruk erachteraan (base44/tests/sdk.test.js houdt ze gelijk).
 *
 * Kan hij het register niet bereiken, dan zegt hij dat en stopt hij met code 2:
 * nooit "alles is de nieuwste versie" zonder antwoord.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { DENO } from './poorten.mjs';

const wortel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FUNCTIES = path.join(wortel, 'base44', 'functions');
const npm = (args, cwd) =>
  spawnSync('npm', args, { cwd, encoding: 'utf8', timeout: 60_000, shell: process.platform === 'win32' });

/**
 * Wat `npm outdated --json` teruggaf, als [[pakket, { current, latest }]] van wat
 * nieuwer is; null als er geen bruikbaar antwoord was (geen verbinding, een fout).
 * npm outdated stopt met code 1 als er iets nieuwer is; dat is hier geen fout.
 */
export function verouderdUit({ status, stdout, error }) {
  if (error || (status !== 0 && status !== 1)) return null;
  let uit;
  try {
    uit = JSON.parse(stdout || '{}');
  } catch {
    return null;
  }
  if (!uit || typeof uit !== 'object' || Array.isArray(uit) || 'error' in uit) return null;
  if (Object.values(uit).some((v) => !v || typeof v !== 'object' || !('latest' in v))) return null;
  return Object.entries(uit).filter(([, v]) => v.current !== v.latest);
}

/** De entry.ts-bestanden van de functies. */
export function entryBestanden() {
  return fs
    .readdirSync(FUNCTIES, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(FUNCTIES, d.name, 'entry.ts'))
    .filter((f) => fs.existsSync(f));
}

export const SDK_IN_FUNCTIE = /npm:@base44\/sdk@([\w.-]+)/g;

function hoofd() {
  const bijwerken = process.argv.includes('--bijwerken');
  let iets = false;
  let sdk = null;
  for (const map of [wortel, path.join(wortel, 'brug')]) {
    const naam = path.relative(wortel, map) || 'hoofdmap';
    const oud = verouderdUit(npm(['outdated', '--json', '--fetch-retries=1'], map));
    if (!oud) {
      console.error(`${naam}: kon niet nagaan wat er nieuwer is (geen antwoord van het npm-register, of een fout). Dit zegt dus niets; probeer het later nog eens.`);
      process.exit(2);
    }
    if (oud.length === 0) {
      console.log(`${naam}: alles is de nieuwste versie.`);
      continue;
    }
    iets = true;
    console.log(`${naam}:`);
    for (const [pakket, v] of oud) console.log(`  ${pakket.padEnd(28)} ${String(v.current).padEnd(10)} → ${v.latest}`);
    if (map === wortel) sdk = oud.find(([pakket]) => pakket === '@base44/sdk')?.[1].latest ?? null;
    if (bijwerken) {
      const uit = npm(['install', '--save-exact', '--no-audit', '--no-fund', ...oud.map(([pakket, v]) => `${pakket}@${v.latest}`)], map);
      if (uit.status !== 0) {
        console.error(uit.stderr || uit.error);
        process.exit(uit.status ?? 1);
      }
      console.log('  bijgewerkt.');
    }
  }

  if (bijwerken && sdk) {
    for (const f of entryBestanden()) fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(SDK_IN_FUNCTIE, `npm:@base44/sdk@${sdk}`));
    const vinger = spawnSync(process.execPath, [path.join(wortel, 'scripts', 'vingerafdruk.mjs')], { stdio: 'inherit' });
    if (vinger.status !== 0) process.exit(vinger.status ?? 1);
    console.log(`Functies: npm:@base44/sdk@${sdk} in elke entry.ts, vingerafdruk bijgewerkt.`);
  }

  const deno = npm(['view', 'deno', 'version'], wortel);
  const denoNu = DENO.split('@')[1];
  const denoNieuwst = deno.status === 0 ? deno.stdout.trim() : null;
  if (!denoNieuwst) console.log('Deno: kon de nieuwste versie niet nagaan.');
  else if (denoNieuwst !== denoNu) {
    iets = true;
    console.log(`Deno: de poorten gebruiken ${denoNu}, de nieuwste is ${denoNieuwst}. Zet DENO in scripts/poorten.mjs op ${denoNieuwst}.`);
  } else console.log(`Deno: ${denoNu} is de nieuwste.`);

  if (iets && !bijwerken) console.log('\nBijwerken: node scripts/nieuwste.mjs --bijwerken (en daarna de poorten draaien).');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) hoofd();
