#!/usr/bin/env node
/**
 * De app uitrollen naar je eigen Base44-app (het app-id staat in base44/.app.jsonc,
 * dat de Base44-CLI maakt en dat nooit in git hoort), met de afspraken uit
 * README.md (Uitrollen) afgedwongen in plaats van alleen opgeschreven.
 *
 *   node scripts/uitrollen.mjs               (npm run uitrollen) nagaan, uitrollen, nameten, tag zetten
 *   node scripts/uitrollen.mjs --droog       alleen nagaan (ook de live tabellen, alleen lezen); niets live
 *   node scripts/uitrollen.mjs --terug <tag> een eerdere uitrol terugzetten: alleen functies en site,
 *                                            nooit de tabellen (zie onder)
 *
 * Uitrollen, in deze volgorde; bij de eerste weigering stopt hij:
 *   1. BASE44_APP_ID mag niet gezet zijn (de CLI zou die app nemen in plaats van base44/.app.jsonc).
 *   2. Niet vanuit een map in .claude/worktrees (een werkmap van een helper kan achterlopen).
 *   3. Git schoon (ook geen nieuwe bestanden buiten git) en gelijk aan de upstream (gepusht).
 *   4. Alle poorten groen (scripts/poorten.mjs).
 *   5. De live tabellen ophalen, alleen lezen (`api fetch GET …/entity-schemas --read-only`), en
 *      weigeren als live een tabel of veld staat dat hier ontbreekt, een type anders is, of de rls
 *      niet meer alleen-beheerder is. Heeft de live app geen enkele tabel van hier: verkeerde app, weigeren.
 *   6. `deploy --build --yes` (tabellen, functies en site in één keer).
 *   7. Nameten: ontvangMeting zonder sleutel en huis zonder gebruiker geven allebei 401.
 *   8. Tag uitrol/JJJJ-MM-DD-UUMM op deze commit, en die tag pushen (zo is "de vorige" altijd bekend).
 *
 * Terugzetten (--terug uitrol/…): een tijdelijke werkmap op die tag (buiten
 * .claude), `npm ci`, dan alleen `functions deploy` en `site deploy --build
 * --yes`. Nooit `deploy`: die zet ook de tabellen gelijk aan die oudere stand
 * en haalt live weg wat daarna bijkwam (zoals Dag), met wat erin staat. Oude
 * code negeert nieuwe velden. Daarna dezelfde nameting.
 *
 * Alle CLI-aanroepen: `node node_modules/base44/bin/run.js …` met
 * NODE_USE_ENV_PROXY=1 (anders gaat de CLI in de cloudsessie niet door de proxy).
 * De weigerregels staan als losse functies hieronder; base44/tests/uitrollen.test.js
 * test ze met nep-uitvoer, zonder echte aanroepen.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { alleTabellen, veldenVan } from './velden.mjs';
import { draaiPoorten } from './poorten.mjs';

export const HOOFDMAP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = ['node_modules/base44/bin/run.js'];
const ACTIES = ['create', 'read', 'update', 'delete'];
/** Velden die Base44 zelf bij elke rij zet; die staan niet in base44/entities. */
const INGEBOUWD = new Set(['id', 'created_date', 'updated_date', 'created_by', 'created_by_id', 'is_sample']);

// ---------- weigerregels (puur, getest) ----------

export function omgevingWeigering(env) {
  if (env.BASE44_APP_ID) return 'BASE44_APP_ID is gezet: de CLI zou dan die app nemen in plaats van die in base44/.app.jsonc. Haal hem weg (unset BASE44_APP_ID).';
  return null;
}

export function mapWeigering(map) {
  if (/[\\/]\.claude[\\/]worktrees([\\/]|$)/.test(map)) return `Dit is een werkmap in .claude/worktrees (${map}). Uitrollen alleen vanuit de hoofdmap.`;
  return null;
}

/** @param {{ status: string, head: string, upstream: string|null }} git  `git status --porcelain`, HEAD en @{u} */
export function gitWeigering({ status, head, upstream }) {
  if (status.trim()) return `Niet alles is gecommit:\n${status.trimEnd()}`;
  if (!upstream) return 'Deze tak heeft geen upstream: eerst pushen (git push -u origin <tak>).';
  if (head !== upstream) return 'Deze stand is niet gelijk aan wat gepusht is: eerst pushen (of pullen).';
  return null;
}

/** De live tabellen uit het antwoord van `entity-schemas`, als { Naam: schema }; null als de vorm onbekend is. */
export function liveTabellenUit(antwoord) {
  let lijst = antwoord;
  if (lijst && !Array.isArray(lijst) && typeof lijst === 'object') {
    lijst = lijst.entityNameToSchema ?? lijst.entities ?? lijst.schemas ?? lijst.data ?? lijst;
  }
  if (Array.isArray(lijst)) {
    const uit = {};
    for (const s of lijst) {
      const naam = s?.name ?? s?.entity_name;
      if (typeof naam !== 'string') return null;
      // Gemeten 2026-10-30: { schemas: [{ entity_name, entity_schema: { properties, rls, … } }] }.
      const schema = s.entity_schema ?? s.schema;
      uit[naam] = schema && !s.properties ? { ...schema, rls: s.rls ?? schema.rls } : s;
    }
    return uit;
  }
  if (lijst && typeof lijst === 'object' && Object.values(lijst).every((s) => s && typeof s === 'object' && 'properties' in s)) return lijst;
  return null;
}

const alleenBeheerder = (rls) =>
  ACTIES.every((actie) => JSON.stringify(rls?.[actie]) === JSON.stringify({ user_condition: { role: 'admin' } }));

/** Wat er live staat en een uitrol zou weghalen of breken; leeg = goed. */
export function tabelWeigeringen(live, lokaal) {
  if (!live) return ['Het antwoord van entity-schemas heeft een onbekende vorm. Niet uitrollen; eerst nakijken.'];
  const namen = Object.keys(live);
  if (!namen.some((n) => n in lokaal)) return [`Live staan andere tabellen (${namen.join(', ') || 'geen'}): dit lijkt niet deze app. Verkeerde app?`];
  const fouten = [];
  for (const [naam, schema] of Object.entries(live)) {
    if (!lokaal[naam]) {
      fouten.push(`Live staat tabel ${naam}, hier niet (een uitrol haalt hem weg, met wat erin staat).`);
      continue;
    }
    if (!alleenBeheerder(schema.rls)) fouten.push(`${naam}: de rls live is niet meer alleen-beheerder (${JSON.stringify(schema.rls ?? null)}).`);
    const hier = veldenVan(lokaal[naam]);
    for (const [veld, type] of Object.entries(veldenVan(schema))) {
      if (INGEBOUWD.has(veld)) continue;
      if (!(veld in hier)) fouten.push(`Live staat ${naam}.${veld}, hier niet (een uitrol haalt het weg).`);
      else if (JSON.stringify(hier[veld]) !== JSON.stringify(type)) fouten.push(`${naam}.${veld} is live ${JSON.stringify(type)}, hier ${JSON.stringify(hier[veld])}.`);
    }
  }
  return fouten;
}

/** @param {{ ontvangMeting: number|null, huis: number|null }} statussen */
export function nametingWeigeringen(statussen) {
  return Object.entries(statussen)
    .filter(([, status]) => status !== 401)
    .map(([functie, status]) => `${functie} zonder ${functie === 'huis' ? 'gebruiker' : 'sleutel'} gaf ${status ?? 'geen antwoord'}, niet 401.`);
}

export function tagNaam(nu = new Date()) {
  const d = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(nu);
  return `uitrol/${d.replace(' ', '-').replace(':', '')}`;
}

// ---------- uitvoeren (met in te pluggen voer/haal, zodat de test niets echt aanroept) ----------

function echteVoer(opdracht, args, { cwd = HOOFDMAP, toon = false } = {}) {
  const env = { ...process.env, NODE_USE_ENV_PROXY: '1' };
  delete env.BASE44_APP_ID;
  const r = spawnSync(opdracht, args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: toon ? ['ignore', 'inherit', 'inherit'] : ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: `${r.stderr ?? ''}${r.error ? String(r.error) : ''}` };
}

async function echteHaal(adres, body) {
  try {
    const r = await fetch(adres, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    return r.status;
  } catch {
    return null;
  }
}

function leesAppId(map) {
  try {
    const tekst = fs.readFileSync(path.join(map, 'base44', '.app.jsonc'), 'utf8');
    const id = JSON.parse(tekst.replace(/^\s*\/\/.*$/gm, '')).id;
    return typeof id === 'string' && /^[a-f0-9]{10,40}$/i.test(id) ? id : null;
  } catch {
    return null;
  }
}

class Weigering extends Error {}
const weiger = (tekst) => {
  throw new Weigering(tekst);
};

async function nameten({ appId, haal, wacht, uit }) {
  const basis = `https://base44.app/api/apps/${appId}/functions`;
  let fouten = [];
  for (let poging = 1; poging <= 3; poging++) {
    const statussen = {
      ontvangMeting: await haal(`${basis}/ontvangMeting`, {}),
      huis: await haal(`${basis}/huis`, { actie: 'stand' }),
    };
    fouten = nametingWeigeringen(statussen);
    if (fouten.length === 0) {
      uit('Nameting: ontvangMeting zonder sleutel en huis zonder gebruiker geven 401.');
      return;
    }
    if (poging < 3) await wacht(10_000);
  }
  weiger(`Nameting klopt niet:\n  - ${fouten.join('\n  - ')}\nKijk in Base44 wat er live staat; terug kan met --terug <vorige uitrol-tag>.`);
}

/**
 * @param {object} o
 * @param {string[]} [o.argv]
 * @param {object} [o.env]
 * @param {string} [o.map]          de hoofdmap
 * @param {Function} [o.voer]       (opdracht, args, opties) => { status, stdout, stderr }
 * @param {Function} [o.haal]       async (adres, body) => HTTP-status of null
 * @param {Function} [o.poorten]    () => true als alles groen is
 * @param {Function} [o.appId]      (map) => app-id of null
 * @param {object}   [o.lokaal]     de tabellen hier ({ Naam: schema })
 * @param {Function} [o.kopieer]    (van, naar) => void, voor base44/.app.jsonc in de werkmap van --terug
 * @returns {Promise<{ gelukt: boolean, tekst: string[] }>}
 */
export async function uitrollen({
  argv = process.argv.slice(2),
  env = process.env,
  map = HOOFDMAP,
  voer = echteVoer,
  haal = echteHaal,
  poorten = () => draaiPoorten(),
  appId = leesAppId,
  lokaal = alleTabellen(path.join(map, 'base44', 'entities')),
  wacht = (ms) => new Promise((klaar) => setTimeout(klaar, ms)),
  nu = new Date(),
  uit = console.log,
  kopieer = (van, naar) => {
    fs.mkdirSync(path.dirname(naar), { recursive: true });
    fs.copyFileSync(van, naar);
  },
} = {}) {
  const tekst = [];
  const zeg = (regel) => {
    tekst.push(regel);
    uit(regel);
  };
  const git = (...args) => voer('git', args, { cwd: map });
  const cli = (args, opties = {}) => voer('node', [...CLI, ...args], { cwd: map, ...opties });
  try {
    const terugIndex = argv.indexOf('--terug');
    const droog = argv.includes('--droog');
    for (const w of [omgevingWeigering(env), mapWeigering(map)]) if (w) weiger(w);
    const id = appId(map);
    if (!id) weiger('Geen app gekoppeld (base44/.app.jsonc). Eerst: npx base44 link.');

    if (terugIndex >= 0) {
      const tag = argv[terugIndex + 1];
      if (!tag || !tag.startsWith('uitrol/')) weiger('Zeg welke uitrol terug moet: --terug uitrol/JJJJ-MM-DD-UUMM (git tag -l "uitrol/*").');
      if (git('rev-parse', '--verify', '--quiet', `refs/tags/${tag}`).status !== 0) weiger(`Tag ${tag} bestaat hier niet (git fetch --tags?).`);
      if (droog) {
        zeg(`Droog: zou ${tag} terugzetten (alleen functies en site, de tabellen blijven).`);
        return { gelukt: true, tekst };
      }
      const werkmap = fs.mkdtempSync(path.join(os.tmpdir(), 'energie-terug-'));
      try {
        if (git('worktree', 'add', '--detach', werkmap, tag).status !== 0) weiger(`Kon geen werkmap op ${tag} maken.`);
        kopieer(path.join(map, 'base44', '.app.jsonc'), path.join(werkmap, 'base44', '.app.jsonc'));
        if (voer('npm', ['ci', '--no-audit', '--no-fund'], { cwd: werkmap, toon: true }).status !== 0) weiger('npm ci in de werkmap lukte niet.');
        // Nooit `deploy` hier: die zet ook de tabellen terug en haalt live weg wat later bijkwam.
        if (voer('node', [...CLI, 'functions', 'deploy'], { cwd: werkmap, toon: true }).status !== 0) weiger('functions deploy lukte niet.');
        if (voer('node', [...CLI, 'site', 'deploy', '--build', '--yes'], { cwd: werkmap, toon: true }).status !== 0) weiger('site deploy lukte niet (de functies staan al op de oude stand).');
      } finally {
        git('worktree', 'remove', '--force', werkmap);
        fs.rmSync(werkmap, { recursive: true, force: true });
      }
      await nameten({ appId: id, haal, wacht, uit: zeg });
      zeg(`Terug op ${tag}: functies en site. De tabellen zijn niet aangeraakt.`);
      return { gelukt: true, tekst };
    }

    const status = git('status', '--porcelain');
    if (status.status !== 0) weiger('git status lukte niet.');
    const head = git('rev-parse', 'HEAD').stdout.trim();
    const up = git('rev-parse', '--verify', '--quiet', '@{u}');
    const gw = gitWeigering({ status: status.stdout, head, upstream: up.status === 0 ? up.stdout.trim() : null });
    if (gw) weiger(gw);
    zeg('Git: schoon en gepusht.');

    if (!poorten()) weiger('Niet alle poorten zijn groen (node scripts/poorten.mjs).');

    const schemas = cli(['api', 'fetch', 'GET', '/api/apps/{app_id}/entity-schemas', '--read-only']);
    if (schemas.status !== 0) weiger(`De live tabellen ophalen lukte niet:\n${schemas.stderr.trim()}`);
    let antwoord;
    try {
      // De CLI kan er voortgangsregels voor zetten: lees vanaf het eerste '{'.
      antwoord = JSON.parse(schemas.stdout.slice(schemas.stdout.indexOf('{')));
    } catch {
      antwoord = undefined;
    }
    const tw = tabelWeigeringen(liveTabellenUit(antwoord), lokaal);
    if (tw.length) weiger(`De live tabellen passen niet bij base44/entities:\n  - ${tw.join('\n  - ')}\nNiet uitrollen; eerst nakijken.`);
    zeg('Live tabellen: niets dat hier ontbreekt, zelfde types, rls alleen-beheerder.');

    if (droog) {
      zeg('Droog: alles klopt; er is niets live gezet.');
      return { gelukt: true, tekst };
    }

    if (cli(['deploy', '--build', '--yes'], { toon: true }).status !== 0) weiger('deploy lukte niet. Kijk wat er live staat voordat je het nog eens probeert.');
    zeg('Deploy klaar: tabellen, functies en site.');

    await nameten({ appId: id, haal, wacht, uit: zeg });

    const tag = tagNaam(nu);
    if (git('tag', tag).status === 0 && git('push', 'origin', `refs/tags/${tag}`).status === 0) zeg(`Tag ${tag} gezet en gepusht (terug kan met --terug ${tag}).`);
    else zeg(`Let op: tag ${tag} zetten of pushen lukte niet; zet hem met de hand.`);
    zeg(`Klaar: commit ${head.slice(0, 7)} staat live.`);
    return { gelukt: true, tekst };
  } catch (e) {
    if (!(e instanceof Weigering)) throw e;
    zeg(`Niet uitgerold. ${e.message}`);
    return { gelukt: false, tekst };
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.NODE_USE_ENV_PROXY !== '1' && (process.env.HTTPS_PROXY || process.env.https_proxy)) {
    // fetch voor de nameting moet ook door de proxy: opnieuw starten met de variabele.
    const r = spawnSync(process.execPath, process.argv.slice(1), { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' } });
    process.exit(r.status ?? 1);
  }
  const { gelukt } = await uitrollen();
  process.exit(gelukt ? 0 : 1);
}
