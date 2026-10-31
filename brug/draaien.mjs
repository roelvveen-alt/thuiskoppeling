import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import process from 'node:process';

/**
 * Eén programmaatje tegelijk. Twee tegelijk sturen elk hun eigen stand naar
 * dezelfde rij Meting (Base44 verliest dan een van de twee), en Zendure laat
 * per account maar één cloudverbinding toe. Wie draait, staat in draait.pid
 * (naast brug.mjs, in .gitignore).
 *
 * Op een Android-telefoon houdt start.sh hem aan (ook na een herstart, via
 * Termux:Boot); `node brug.mjs herstart` en `stop` werken via dit bestand.
 */

/**
 * Leeft dit proces nog, en mogen wij het een signaal sturen? Het programmaatje
 * draait altijd als dezelfde gebruiker (in Termux: dezelfde app). EPERM betekent
 * dus: dit nummer is van een ander (na een herstart van de telefoon kan een
 * andere app ons oude nummer hebben), en dat telt als "niet van ons".
 */
export function levend(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** De opdrachtregel van een proces (Linux en Android), of null als dat niet te lezen is. */
export function opdrachtVan(pid) {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ');
  } catch {
    return null;
  }
}

/** Is er een /proc (Linux en Android)? Op een Mac niet; daar gaan we op het nummer af. */
export function heeftProc() {
  return fs.existsSync('/proc/self');
}

/** Een kenmerk van deze opstart van het apparaat (Linux en Android), of null. Na een herstart is het anders. */
export function opstartId() {
  try {
    return fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() || null;
  } catch {
    return null;
  }
}

/** Het briefje in draait.pid: "pid opstart-id" (het tweede deel mag ontbreken, zoals in oude briefjes). */
function leesBriefje(tekst) {
  const [pidDeel, opstart] = String(tekst ?? '').trim().split(/\s+/);
  return { pid: Number.parseInt(pidDeel ?? '', 10), opstart: opstart || null };
}

/**
 * Het pid van een ander programmaatje dat nu draait, of null. Na een herstart
 * van de telefoon kan een heel ander proces hetzelfde nummer hebben gekregen:
 * staat er een ander opstart-id in het briefje, dan is het oud. Waar /proc is,
 * moet de opdrachtregel te lezen zijn en brug.mjs bevatten; is hij niet te
 * lezen (Android verbergt de processen van andere apps), dan is het niet van ons.
 */
export function draaitAl(
  pidTekst,
  { leeft = levend, opdracht = opdrachtVan, proc = heeftProc, opstart = opstartId } = {},
) {
  const briefje = leesBriefje(pidTekst);
  const { pid } = briefje;
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return null;
  const nu = briefje.opstart ? opstart() : null;
  if (nu && nu !== briefje.opstart) return null;
  if (!leeft(pid)) return null;
  const regel = opdracht(pid);
  if (regel === null) return proc() ? null : pid;
  return regel.includes('brug.mjs') ? pid : null;
}

const lees = (pad) => {
  try {
    return fs.readFileSync(pad, 'utf8');
  } catch {
    return null;
  }
};

/** De plek innemen: null als het gelukt is, anders het pid van wie er al draait. */
export function neemPlek(pad, opties = {}) {
  const ander = draaitAl(lees(pad), opties);
  if (ander) return ander;
  const opstart = (opties.opstart ?? opstartId)();
  fs.writeFileSync(pad, `${process.pid}${opstart ? ` ${opstart}` : ''}\n`);
  return null;
}

/** De plek vrijgeven, alleen als hij nog van ons is. */
export function geefPlekVrij(pad) {
  if (leesBriefje(lees(pad)).pid === process.pid) fs.rmSync(pad, { force: true });
}

/**
 * Het draaiende programmaatje netjes laten stoppen (SIGTERM). Geeft zijn pid,
 * of null als er niets draait. Een oud briefje (niets draait meer, of het nummer
 * is van een ander) gaat weg; lukt het signaal niet (ESRCH, EPERM), dan ook.
 */
export function stuurStop(pad, { stuur = (pid) => process.kill(pid, 'SIGTERM'), ...opties } = {}) {
  const tekst = lees(pad);
  const pid = draaitAl(tekst, opties);
  if (!pid) {
    if (tekst !== null && leesBriefje(tekst).pid !== process.pid) fs.rmSync(pad, { force: true });
    return null;
  }
  try {
    stuur(pid);
  } catch (fout) {
    if (fout?.code !== 'ESRCH' && fout?.code !== 'EPERM') throw fout;
    fs.rmSync(pad, { force: true });
    return null;
  }
  return pid;
}

/** Het bestandje voor Termux:Boot (~/.termux/boot/thuis-energie): start start.sh na een herstart. */
export function bootScript(startPad) {
  const pad = `'${String(startPad).replace(/'/g, `'\\''`)}'`;
  return [
    '#!/data/data/com.termux/files/usr/bin/sh',
    '# Gemaakt door: node brug.mjs termux-boot. Start het programmaatje na een herstart van de telefoon.',
    `exec sh ${pad}`,
    '',
  ].join('\n');
}

/** De naam van de systemd-dienst op een Chromebook of Raspberry Pi (thuis-energie-brug.service). */
export const DIENST = 'thuis-energie-brug';

/**
 * Houdt systemd het programmaatje aan (Chromebook, Raspberry Pi)? Dan werken
 * stop en herstart via systemctl, niet via het bestand gestopt (dat systemd
 * niet kent). Op een telefoon (Termux) is er geen systemctl: false.
 */
export function onderSystemd({ voer = execFileSync } = {}) {
  try {
    voer('systemctl', ['is-active', '--quiet', DIENST], { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/** systemctl (stop, restart) zonder wachtwoord (sudo -n, zoals op een Chromebook). Lukt het niet: false. */
export function dienstOpdracht(opdracht, { voer = execFileSync } = {}) {
  try {
    voer('sudo', ['-n', 'systemctl', opdracht, DIENST], { stdio: 'ignore', timeout: 30_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Hoe de laatste start ging, voor bijwerken.sh (opstart.txt naast brug.mjs, in
 * .gitignore): "gestart", "eerste-stand" of "fout", met de versie erbij. Los van
 * waar het logboek staat (brug.log op de telefoon, het journal onder systemd).
 * Lukt schrijven niet, dan niets (het programmaatje gaat gewoon door).
 */
export function meldOpstart(pad, toestand, versie) {
  try {
    fs.writeFileSync(pad, `${toestand} ${versie}\n`);
  } catch {
    // Geen opslag: dan ziet bijwerken.sh het niet, en zegt het dat het niet zeker is.
  }
}

/**
 * Zou dit een tweede bewaker naast systemd worden (0.13.0)? Ja als er een dienst
 * thuis-energie-brug is en dit proces niet door systemd gestart is (systemd zet
 * INVOCATION_ID). Dan start bijvoorbeeld start.sh hem met de hand, terwijl systemd
 * hem over een halve minuut zelf weer start; de twee zouden elkaar dan elke 30 s
 * wegduwen. BRUG_ZONDER_SYSTEMD=1 laat hem toch draaien (zelf meekijken na
 * sudo systemctl stop).
 */
export function naastSystemd({ env = process.env, voer = execFileSync } = {}) {
  if (env.INVOCATION_ID || env.BRUG_ZONDER_SYSTEMD === '1') return false;
  try {
    voer('systemctl', ['cat', DIENST], { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
