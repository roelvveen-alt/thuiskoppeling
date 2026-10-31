import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { goedgekeurdTekst } from '../scripts/brugGoedkeuren.mjs';

const SCRIPT = new URL('./bijwerken.sh', import.meta.url);
const basisEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  BRUG_WACHT: '3',
  BRUG_STAP: '1',
};
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: basisEnv, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

/**
 * Een nep-programmaatje: `modus` zegt wat het bij het starten in opstart.txt zet
 * (goed: eerste stand; fout: vastgelopen; gestart: draait maar nog geen stand; niets: start niet).
 */
const nepBrug = (modus = 'goed') =>
  [
    "import fs from 'node:fs';",
    'const [o] = process.argv.slice(2);',
    "if (o === 'status') process.exit(fs.existsSync(new URL('./draait', import.meta.url)) ? 0 : 1);",
    "if (o === undefined) {",
    `  const t = { goed: 'eerste-stand', fout: 'fout', gestart: 'gestart' }[${JSON.stringify(modus)}];`,
    "  if (t) fs.writeFileSync(new URL('./opstart.txt', import.meta.url), `${t} x\\n`);",
    '}',
    '',
  ].join('\n');

const slot = (versie, mqtt = '5.16.1') =>
  `${JSON.stringify({ name: 'b', version: versie, lockfileVersion: 3, packages: { '': { name: 'b', version: versie, dependencies: { mqtt } }, 'node_modules/mqtt': { version: mqtt } } }, null, 2)}\n`;

const schrijf = (pad, inhoud, modus) => {
  fs.writeFileSync(pad, inhoud);
  if (modus) fs.chmodSync(pad, modus);
};

/**
 * Een bron (zoals GitHub) en een telefoon of Chromebook met een kloon ervan.
 * systemd: een nep-systemctl en -sudo (de dienst bestaat; `actief` zegt of hij draait).
 * Zonder: Termux (start.sh); `gestopt` zegt of het programmaatje met de hand uit staat.
 */
function opzet({ systemd = false, actief = true, gestopt = !systemd } = {}) {
  const map = fs.mkdtempSync(path.join(os.tmpdir(), 'bijwerken-'));
  const bron = path.join(map, 'bron');
  const nep = path.join(map, 'nep');
  const logPad = path.join(map, 'nep.log');
  fs.mkdirSync(path.join(bron, 'brug'), { recursive: true });
  fs.mkdirSync(nep);
  git(bron, 'init', '-q', '-b', 'werk');
  fs.copyFileSync(SCRIPT, path.join(bron, 'brug', 'bijwerken.sh'));
  fs.writeFileSync(path.join(bron, 'brug', 'brug.mjs'), nepBrug('goed'));
  fs.writeFileSync(path.join(bron, 'brug', 'start.sh'), 'cd "$(dirname "$0")" || exit 1\necho start >> "$NEP_LOG"\nnode brug.mjs\n');
  fs.writeFileSync(path.join(bron, 'brug', 'package-lock.json'), slot('0.1.0'));
  git(bron, 'add', '.');
  git(bron, 'commit', '-q', '-m', 'begin');
  const telefoon = path.join(map, 'telefoon');
  git(map, 'clone', '-q', '-b', 'werk', bron, telefoon);
  const brug = path.join(telefoon, 'brug');
  fs.mkdirSync(path.join(brug, 'node_modules'));
  if (gestopt) fs.writeFileSync(path.join(brug, 'gestopt'), 'uit\n');
  if (actief) fs.writeFileSync(path.join(map, 'actief'), '');
  schrijf(path.join(nep, 'npm'), '#!/bin/sh\necho "npm $*" >> "$NEP_LOG"\nexit "${NEP_NPM_CODE:-0}"\n', 0o755);
  schrijf(path.join(nep, 'sudo'), '#!/bin/sh\n[ "$1" = -n ] && shift\nexec "$@"\n', 0o755);
  schrijf(
    path.join(nep, 'systemctl'),
    systemd
      ? [
          '#!/bin/sh',
          'case "$1" in',
          '  cat) exit 0 ;;',
          '  is-active) [ -e "$NEP_MAP/actief" ] ;;',
          '  restart) echo "systemctl restart" >> "$NEP_LOG"; touch "$NEP_MAP/actief"; cd "$NEP_BRUG" && node brug.mjs ;;',
          '  *) exit 1 ;;',
          'esac',
          '',
        ].join('\n')
      : '#!/bin/sh\nexit 1\n',
    0o755,
  );
  const env = { ...basisEnv, PATH: `${nep}:${process.env.PATH}`, NEP_LOG: logPad, NEP_MAP: map, NEP_BRUG: brug };
  const nieuweVersie = (bestanden, bericht = 'nieuw') => {
    for (const [bestand, inhoud] of Object.entries(bestanden)) fs.writeFileSync(path.join(bron, 'brug', bestand), inhoud);
    git(bron, 'add', '.');
    git(bron, 'commit', '-q', '-m', bericht);
    return git(bron, 'rev-parse', 'HEAD');
  };
  const bijwerken = (extra = {}) => spawnSync('sh', [path.join(brug, 'bijwerken.sh')], { env: { ...env, ...extra }, encoding: 'utf8' });
  const nepLog = () => (fs.existsSync(logPad) ? fs.readFileSync(logPad, 'utf8') : '');
  return { bron, brug, telefoon, nieuweVersie, bijwerken, nepLog, kop: () => git(telefoon, 'rev-parse', 'HEAD'), env };
}

describe('bijwerken.sh', { timeout: 30_000 }, () => {
  it('niets nieuws: dat zegt hij, en er verandert niets', () => {
    const { bijwerken } = opzet();
    const uit = bijwerken();
    expect(uit.stdout).toContain('Je hebt de nieuwste versie al');
    expect(uit.status).toBe(0);
  });

  it('een goede nieuwe versie: bijgewerkt (het programmaatje stond uit en blijft uit)', () => {
    const { brug, nieuweVersie, bijwerken } = opzet();
    nieuweVersie({ 'extra.mjs': 'export const x = 1;\n' });
    const uit = bijwerken();
    expect(uit.stdout).toContain('blijft uit');
    expect(uit.status).toBe(0);
    expect(fs.existsSync(path.join(brug, 'extra.mjs'))).toBe(true);
  });

  it('een fout in een .mjs: vanzelf terug naar de vorige versie', () => {
    const { brug, nieuweVersie, bijwerken, kop } = opzet();
    const vorige = kop();
    nieuweVersie({ 'kapot.mjs': 'export const = ;\n' });
    const uit = bijwerken();
    expect(uit.stdout).toContain('In kapot.mjs zit een fout. Ik ga terug naar de vorige versie.');
    expect(uit.status).toBe(1);
    expect(kop()).toBe(vorige);
    expect(fs.existsSync(path.join(brug, 'kapot.mjs'))).toBe(false);
  });

  it('hier veranderd: hij weigert zonder iets kwijt te raken', () => {
    const { brug, nieuweVersie, bijwerken, kop } = opzet();
    const vorige = kop();
    fs.writeFileSync(path.join(brug, 'start.sh'), 'echo eigen\n');
    nieuweVersie({ 'start.sh': 'echo nieuw\n' });
    const uit = bijwerken();
    expect(uit.stdout).toContain('Er is niets veranderd.');
    expect(uit.status).toBe(1);
    expect(kop()).toBe(vorige);
    expect(fs.readFileSync(path.join(brug, 'start.sh'), 'utf8')).toBe('echo eigen\n');
  });

  it('wat node --check niet ziet (een ontbrekende export): node brug.mjs nakijken faalt, dus terug', () => {
    const { nieuweVersie, bijwerken, kop } = opzet({ gestopt: false });
    const vorige = kop();
    nieuweVersie({ 'brug.mjs': `import { bestaatNiet } from './extra.mjs';\nconsole.log(bestaatNiet);\n${nepBrug('goed')}`, 'extra.mjs': 'export const x = 1;\n' });
    const uit = bijwerken();
    expect(uit.stdout).toContain('De nieuwe versie start niet:');
    expect(uit.stdout).toContain('bestaatNiet');
    expect(uit.status).toBe(1);
    expect(kop()).toBe(vorige);
  });

  it('telefoon: de nieuwe versie loopt vast (opstart.txt zegt fout): terug, en de vorige weer gestart', () => {
    const { nieuweVersie, bijwerken, kop, nepLog } = opzet({ gestopt: false });
    const vorige = kop();
    nieuweVersie({ 'brug.mjs': nepBrug('fout') });
    const uit = bijwerken();
    expect(uit.stdout).toContain('De nieuwe versie liep vast (zie tail -f ~/thuis-energie/brug/brug.log)');
    expect(uit.status).toBe(1);
    expect(kop()).toBe(vorige);
    expect(nepLog().match(/^start$/gm)).toHaveLength(2);
  });

  it('telefoon: start de nieuwe versie helemaal niet, dan terug; start hij wel maar komt er geen stand (internet?), dan blijft hij', () => {
    const a = opzet({ gestopt: false });
    const vorige = a.kop();
    a.nieuweVersie({ 'brug.mjs': nepBrug('niets') });
    const uitA = a.bijwerken();
    expect(uitA.stdout).toContain('De nieuwe versie start niet');
    expect(a.kop()).toBe(vorige);

    const b = opzet({ gestopt: false });
    const nieuw = b.nieuweVersie({ 'brug.mjs': nepBrug('gestart') });
    const uitB = b.bijwerken();
    expect(uitB.stdout).toContain('nog geen stand in de app');
    expect(uitB.status).toBe(0);
    expect(b.kop()).toBe(nieuw);
  });

  it('telefoon: een goede nieuwe versie start via start.sh en meldt de eerste stand', () => {
    const { nieuweVersie, bijwerken, nepLog } = opzet({ gestopt: false });
    nieuweVersie({ 'extra.mjs': 'export const x = 2;\n' });
    const uit = bijwerken();
    expect(uit.stdout).toContain('de eerste stand staat in de app');
    expect(uit.status).toBe(0);
    expect(nepLog()).toContain('start');
  });

  it('npm ci alleen als de pakketten echt veranderen, niet als alleen het versienummer in de lock verandert', () => {
    const { nieuweVersie, bijwerken, nepLog } = opzet();
    nieuweVersie({ 'package-lock.json': slot('0.2.0') });
    bijwerken();
    expect(nepLog()).not.toContain('npm ci');
    nieuweVersie({ 'package-lock.json': slot('0.3.0', '5.17.0') });
    bijwerken();
    expect(nepLog()).toContain('npm ci');
  });

  it('lukt npm ci niet bij het teruggaan, dan zegt hij dat (niet stil verder)', () => {
    const { nieuweVersie, bijwerken, kop } = opzet();
    const vorige = kop();
    nieuweVersie({ 'package-lock.json': slot('0.2.0', '5.17.0') });
    const uit = bijwerken({ NEP_NPM_CODE: '1' });
    expect(uit.stdout).toContain('De pakketten bijwerken lukt niet.');
    expect(uit.stdout).toContain('terugzetten lukte niet');
    expect(kop()).toBe(vorige);
  });
});

describe('bijwerken.sh: alleen naar een nagekeken stand', { timeout: 30_000 }, () => {
  it('goedgekeurd.txt: tot die commit, niet verder (wat daarna kwam is nog niet nagekeken)', () => {
    const { nieuweVersie, bijwerken, kop } = opzet();
    const nagekeken = nieuweVersie({ 'extra.mjs': 'export const x = 1;\n' }, 'af');
    nieuweVersie({ 'goedgekeurd.txt': goedgekeurdTekst(nagekeken) }, 'goedgekeurd');
    nieuweVersie({ 'extra.mjs': 'export const x = 2; // half af\n' }, 'half af');
    const uit = bijwerken();
    expect(uit.stdout).toContain('Alleen tot de nagekeken versie (goedgekeurd');
    expect(kop()).toBe(nagekeken);
    // Nog eens: er is niets nieuws nagekeken.
    expect(bijwerken().stdout).toContain('Je hebt de nieuwste versie al (goedgekeurd)');
    expect(kop()).toBe(nagekeken);
  });

  it('een tag uitrol/… als er geen goedgekeurd.txt is', () => {
    const { bron, nieuweVersie, bijwerken, kop } = opzet();
    const nagekeken = nieuweVersie({ 'extra.mjs': 'export const x = 1;\n' }, 'af');
    git(bron, 'tag', 'uitrol/2026-10-30-2000');
    nieuweVersie({ 'extra.mjs': 'export const x = 2;\n' }, 'half af');
    bijwerken();
    expect(kop()).toBe(nagekeken);
  });

  it('geen goedgekeurd.txt en geen tags: de nieuwste van de tak (zoals vroeger)', () => {
    const { bron, nieuweVersie, bijwerken, kop } = opzet();
    nieuweVersie({ 'extra.mjs': 'export const x = 1;\n' });
    bijwerken();
    expect(kop()).toBe(git(bron, 'rev-parse', 'HEAD'));
  });

  it('goedgekeurdTekst: alleen een volledige commit', () => {
    expect(() => goedgekeurdTekst('abc')).toThrow();
    expect(goedgekeurdTekst('a'.repeat(40), new Date('2026-10-30T20:00:00Z'))).toContain(`\n${'a'.repeat(40)}\n`);
  });

  it('een goedgekeurde commit die niet op de tak staat, telt niet', () => {
    const { bron, nieuweVersie, bijwerken, kop } = opzet();
    nieuweVersie({ 'goedgekeurd.txt': `${'a'.repeat(40)}\n` });
    bijwerken();
    expect(kop()).toBe(git(bron, 'rev-parse', 'HEAD'));
  });

  it('veranderde bijwerken.sh zelf, dan gaat de nieuwe versie ervan verder', () => {
    const { nieuweVersie, bijwerken } = opzet();
    const nieuwScript = fs.readFileSync(SCRIPT, 'utf8').replace('echo "Bijgewerkt van', 'echo "(nieuw script) Bijgewerkt van');
    nieuweVersie({ 'bijwerken.sh': nieuwScript });
    const uit = bijwerken();
    expect(uit.stdout).toContain('(nieuw script) Bijgewerkt van');
    expect(uit.status).toBe(0);
  });
});

describe('bijwerken.sh onder systemd (Chromebook)', { timeout: 30_000 }, () => {
  it('start via systemd, nooit start.sh ernaast, en leest opstart.txt (geen brug.log)', () => {
    const { nieuweVersie, bijwerken, nepLog, brug } = opzet({ systemd: true });
    nieuweVersie({ 'extra.mjs': 'export const x = 1;\n' });
    const uit = bijwerken();
    expect(uit.stdout).toContain('de eerste stand staat in de app');
    expect(uit.status).toBe(0);
    expect(nepLog()).toContain('systemctl restart');
    expect(nepLog()).not.toMatch(/^start$/m);
    expect(fs.existsSync(path.join(brug, 'brug.log'))).toBe(false);
  });

  it('loopt de nieuwe versie vast: terug, via systemd opnieuw gestart, en de hint wijst naar journalctl', () => {
    const { nieuweVersie, bijwerken, nepLog, kop } = opzet({ systemd: true });
    const vorige = kop();
    nieuweVersie({ 'brug.mjs': nepBrug('fout') });
    const uit = bijwerken();
    expect(uit.stdout).toContain('journalctl -u thuis-energie-brug -f');
    expect(uit.status).toBe(1);
    expect(kop()).toBe(vorige);
    expect(nepLog().match(/systemctl restart/g)).toHaveLength(2);
  });

  it('een oud bestand gestopt telt niet onder systemd; staat de dienst uit, dan blijft hij uit', () => {
    const aan = opzet({ systemd: true, gestopt: true });
    aan.nieuweVersie({ 'extra.mjs': 'export const x = 1;\n' });
    expect(aan.bijwerken().stdout).toContain('de eerste stand staat in de app');

    const uit = opzet({ systemd: true, actief: false });
    uit.nieuweVersie({ 'extra.mjs': 'export const x = 1;\n' });
    const res = uit.bijwerken();
    expect(res.stdout).toContain('blijft uit. Aanzetten: sudo systemctl start thuis-energie-brug');
    expect(uit.nepLog()).not.toContain('restart');
  });
});

describe('waakhond.sh', () => {
  it('zet het programmaatje aan via start.sh, behalve als het met de hand gestopt is', () => {
    const map = fs.mkdtempSync(path.join(os.tmpdir(), 'waakhond-'));
    fs.copyFileSync(new URL('./waakhond.sh', import.meta.url), path.join(map, 'waakhond.sh'));
    fs.writeFileSync(path.join(map, 'start.sh'), 'echo aan > aangezet\n');
    fs.writeFileSync(path.join(map, 'gestopt'), 'uit\n');
    expect(spawnSync('sh', [path.join(map, 'waakhond.sh')]).status).toBe(0);
    expect(fs.existsSync(path.join(map, 'aangezet'))).toBe(false);
    fs.rmSync(path.join(map, 'gestopt'));
    spawnSync('sh', [path.join(map, 'waakhond.sh')]);
    expect(fs.existsSync(path.join(map, 'aangezet'))).toBe(true);
  });
});
