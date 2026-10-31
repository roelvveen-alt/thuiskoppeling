#!/usr/bin/env node
/**
 * Alle poorten in één keer, na elkaar, met per poort één regel.
 *
 *   node scripts/poorten.mjs     (npm run poorten)
 *
 * Stopt met code 1 als er één rood is. De build gaat naar een tijdelijke map,
 * niet naar dist/: dat is de map die een uitrol live zet, en een build zonder
 * app-id is het voorbeeld met nepcijfers. De nieuwste-controle meldt alleen
 * (hij is geen poort: zonder internet zegt hij dat, en gaat het verder).
 *
 * scripts/uitrollen.mjs draait dit vóór elke uitrol.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const HOOFDMAP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** De Deno-versie van de poorten, op één plek (nieuwste.mjs vergelijkt hem met de nieuwste). */
export const DENO = 'deno@2.9.6';

const entryBestanden = () =>
  fs
    .readdirSync(path.join(HOOFDMAP, 'base44', 'functions'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(HOOFDMAP, 'base44', 'functions', d.name, 'entry.ts')))
    .map((d) => `base44/functions/${d.name}/entry.ts`)
    .sort();

/** De poorten: [naam, opdracht, argumenten]. */
export function poorten({ buildMap } = {}) {
  return [
    ['eslint', 'npx', ['eslint', '.']],
    ['vitest', 'npx', ['vitest', 'run']],
    ['deno check', 'npx', ['--yes', DENO, 'check', ...entryBestanden()]],
    ['deno rooktest', 'npx', ['--yes', DENO, 'run', '--allow-read', 'base44/tests/rook.deno.js']],
    ['vingerafdruk', 'node', ['scripts/vingerafdruk.mjs', '--controle']],
    ['velden', 'node', ['scripts/velden.mjs', '--controle']],
    ['vite build', 'npx', ['vite', 'build', '--outDir', buildMap, '--emptyOutDir']],
  ];
}

const voer = (opdracht, args, cwd = HOOFDMAP) =>
  spawnSync(opdracht, args, { cwd, encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 64 * 1024 * 1024 });

/** Draait alle poorten; geeft true als alles groen is. */
export function draaiPoorten({ uit = console.log } = {}) {
  const buildMap = fs.mkdtempSync(path.join(os.tmpdir(), 'energie-poort-'));
  let groen = true;
  try {
    const nieuwste = voer('node', ['scripts/nieuwste.mjs']);
    uit(`nieuwste: ${(nieuwste.stdout || nieuwste.stderr || '').trim().split('\n').join(' | ') || 'geen antwoord'}`);
    for (const [naam, opdracht, args] of poorten({ buildMap })) {
      const begin = Date.now();
      const r = voer(opdracht, args);
      const tijd = `${Math.round((Date.now() - begin) / 1000)} s`;
      if (r.status === 0) {
        uit(`${naam}: groen, ${tijd}`);
      } else {
        groen = false;
        uit(`${naam}: ROOD, ${tijd}`);
        uit(`${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? String(r.error) : ''}`.trim().split('\n').slice(-40).join('\n'));
      }
    }
  } finally {
    fs.rmSync(buildMap, { recursive: true, force: true });
  }
  uit(groen ? 'Alle poorten groen.' : 'Niet alles groen.');
  return groen;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(draaiPoorten() ? 0 : 1);
}
