#!/usr/bin/env node
/**
 * Een versie van het programmaatje goedkeuren voor de telefoons en de
 * Chromebook (programmaatje 0.13.0, zie brug/bijwerken.sh):
 *
 *   node scripts/brugGoedkeuren.mjs
 *
 * Alleen op een schone stand, en alleen als alle poorten groen zijn (zoals
 * scripts/uitrollen.mjs). Dan komt de commit van nu in brug/goedgekeurd.txt,
 * in een eigen commit erbovenop. bijwerken.sh gaat daarna hooguit tot die
 * commit, ook als er later op de tak iets half af bijkomt. Pushen doe je zelf
 * (of uitrollen.mjs, die weigert een ongepushte stand).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { HOOFDMAP } from './poorten.mjs';

export const GOEDGEKEURD = path.join('brug', 'goedgekeurd.txt');

/** De inhoud van goedgekeurd.txt: uitleg in commentaar, dan de commit op een eigen regel (die leest bijwerken.sh). */
export function goedgekeurdTekst(commit, moment = new Date()) {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`"${commit}" is geen volledige commit.`);
  return [
    '# De versie van het programmaatje die bijwerken.sh mag zetten (nagekeken: poorten groen).',
    `# Gemaakt met: node scripts/brugGoedkeuren.mjs, ${moment.toISOString().slice(0, 16).replace('T', ' ')} (UTC).`,
    commit,
    '',
  ].join('\n');
}

function hoofd() {
  const git = (...args) => execFileSync('git', args, { cwd: HOOFDMAP, encoding: 'utf8' }).trim();
  if (git('status', '--porcelain')) {
    console.error('Er staan nog wijzigingen klaar; eerst committen (alleen een schone stand wordt goedgekeurd).');
    process.exit(1);
  }
  const poorten = spawnSync(process.execPath, ['scripts/poorten.mjs'], { cwd: HOOFDMAP, stdio: 'inherit' });
  if (poorten.status !== 0) {
    console.error('Een poort is rood: niet goedgekeurd.');
    process.exit(1);
  }
  const commit = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(HOOFDMAP, GOEDGEKEURD), goedgekeurdTekst(commit));
  git('add', GOEDGEKEURD);
  git('commit', '-q', '-m', `Programmaatje: ${commit.slice(0, 7)} goedgekeurd voor bijwerken.sh (poorten groen)`);
  console.log(`Goedgekeurd: ${commit.slice(0, 7)}. Push de tak; daarna haalt bijwerken.sh deze versie.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) hoofd();
