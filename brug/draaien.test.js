import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { bootScript, DIENST, dienstOpdracht, draaitAl, geefPlekVrij, meldOpstart, naastSystemd, neemPlek, onderSystemd, stuurStop } from './draaien.mjs';

const leeft = (...pids) => (pid) => pids.includes(pid);
const brug = () => '/data/data/com.termux/files/usr/bin/node brug.mjs ';
const tijdelijk = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'draaien-')), 'draait.pid');

describe('één programmaatje tegelijk', () => {
  it('draait er al een: alleen een levend proces dat brug.mjs is', () => {
    expect(draaitAl('4242\n', { leeft: leeft(4242), opdracht: brug })).toBe(4242);
    // Na een herstart van de telefoon heeft een ander proces dat nummer.
    expect(draaitAl('4242', { leeft: leeft(4242), opdracht: () => 'com.android.chrome' })).toBe(null);
    // Opdrachtregel niet te lezen zonder /proc (Mac): op het nummer af.
    expect(draaitAl('4242', { leeft: leeft(4242), opdracht: () => null, proc: () => false })).toBe(4242);
    // Wel /proc maar niet te lezen (Android verbergt andere apps): niet van ons.
    expect(draaitAl('4242', { leeft: leeft(4242), opdracht: () => null, proc: () => true })).toBe(null);
    expect(draaitAl('4242', { leeft: leeft(), opdracht: brug })).toBe(null);
    expect(draaitAl(String(process.pid), { leeft: leeft(process.pid), opdracht: brug })).toBe(null);
    for (const rommel of [null, '', 'abc', '1', '-5']) expect(draaitAl(rommel, { leeft: () => true, opdracht: brug })).toBe(null);
  });

  it('neemt de plek in, ook van een die niet meer draait, maar niet van een die nog draait', () => {
    const pad = tijdelijk();
    expect(neemPlek(pad, { leeft: leeft(), opdracht: brug, opstart: () => null })).toBe(null);
    expect(fs.readFileSync(pad, 'utf8').trim()).toBe(String(process.pid));

    fs.writeFileSync(pad, '4242\n');
    expect(neemPlek(pad, { leeft: leeft(4242), opdracht: brug })).toBe(4242);
    expect(fs.readFileSync(pad, 'utf8').trim()).toBe('4242');

    expect(neemPlek(pad, { leeft: leeft(), opdracht: brug, opstart: () => 'boot-a' })).toBe(null);
    expect(fs.readFileSync(pad, 'utf8').trim()).toBe(`${process.pid} boot-a`);
  });

  it('een briefje van voor een herstart van de telefoon is oud, ook als het nummer weer leeft', () => {
    const opties = { leeft: leeft(4242), opdracht: brug };
    expect(draaitAl('4242 boot-a', { ...opties, opstart: () => 'boot-a' })).toBe(4242);
    expect(draaitAl('4242 boot-a', { ...opties, opstart: () => 'boot-b' })).toBe(null);
    // Opstart niet te lezen: dan beslist de rest.
    expect(draaitAl('4242 boot-a', { ...opties, opstart: () => null })).toBe(4242);
  });

  it('een proces van een andere app (EPERM) leeft voor ons niet', async () => {
    const { levend } = await import('./draaien.mjs');
    const echteKill = process.kill;
    try {
      process.kill = () => {
        throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' });
      };
      expect(levend(4242)).toBe(false);
    } finally {
      process.kill = echteKill;
    }
    expect(levend(process.pid)).toBe(true);
  });

  it('geeft de plek alleen vrij als hij nog van hem is', () => {
    const pad = tijdelijk();
    fs.writeFileSync(pad, '4242\n');
    geefPlekVrij(pad);
    expect(fs.existsSync(pad)).toBe(true);
    fs.writeFileSync(pad, `${process.pid}\n`);
    geefPlekVrij(pad);
    expect(fs.existsSync(pad)).toBe(false);
    geefPlekVrij(pad);
  });

  it('stop en herstart gaan naar het proces dat draait, en anders nergens heen', () => {
    const pad = tijdelijk();
    const gestuurd = [];
    const stuur = (pid) => gestuurd.push(pid);
    expect(stuurStop(pad, { stuur, leeft: leeft(4242), opdracht: brug })).toBe(null);
    fs.writeFileSync(pad, '4242\n');
    expect(stuurStop(pad, { stuur, leeft: leeft(4242), opdracht: brug })).toBe(4242);
    expect(stuurStop(pad, { stuur, leeft: leeft(), opdracht: brug })).toBe(null);
    expect(gestuurd).toEqual([4242]);
    // Niets draait meer: het oude briefje gaat weg.
    expect(fs.existsSync(pad)).toBe(false);
  });

  it('stop met een signaal dat niet aankomt (EPERM, ESRCH): geen fout, briefje weg', () => {
    const pad = tijdelijk();
    for (const code of ['EPERM', 'ESRCH']) {
      fs.writeFileSync(pad, '4242\n');
      const stuur = () => {
        throw Object.assign(new Error(`kill ${code}`), { code });
      };
      expect(stuurStop(pad, { stuur, leeft: leeft(4242), opdracht: brug })).toBe(null);
      expect(fs.existsSync(pad)).toBe(false);
    }
  });
});

describe('Termux:Boot', () => {
  it('start start.sh na een herstart, ook met een rare naam in het pad', () => {
    const tekst = bootScript('/data/data/com.termux/files/home/thuis-energie/brug/start.sh');
    expect(tekst.split('\n')[0]).toBe('#!/data/data/com.termux/files/usr/bin/sh');
    expect(tekst).toContain("exec sh '/data/data/com.termux/files/home/thuis-energie/brug/start.sh'");
    expect(bootScript("/home/tim's/start.sh")).toContain(`exec sh '/home/tim'\\''s/start.sh'`);
  });
});

describe('onder systemd (Chromebook)', () => {
  it('onderSystemd: alleen als systemctl zegt dat de dienst draait; zonder systemctl (Termux) nee', () => {
    const gevraagd = [];
    expect(onderSystemd({ voer: (...a) => gevraagd.push(a) })).toBe(true);
    expect(gevraagd[0][0]).toBe('systemctl');
    expect(gevraagd[0][1]).toEqual(['is-active', '--quiet', DIENST]);
    expect(
      onderSystemd({
        voer: () => {
          throw Object.assign(new Error('niet gevonden'), { code: 'ENOENT' });
        },
      }),
    ).toBe(false);
  });

  it('dienstOpdracht: sudo -n (nooit om een wachtwoord vragen); lukt het niet, dan false', () => {
    const gevraagd = [];
    expect(dienstOpdracht('stop', { voer: (...a) => gevraagd.push(a) })).toBe(true);
    expect(gevraagd[0].slice(0, 2)).toEqual(['sudo', ['-n', 'systemctl', 'stop', DIENST]]);
    expect(
      dienstOpdracht('restart', {
        voer: () => {
          throw new Error('a password is required');
        },
      }),
    ).toBe(false);
  });

  it('meldOpstart schrijft de toestand voor bijwerken.sh, en gooit nooit', () => {
    const map = fs.mkdtempSync(path.join(os.tmpdir(), 'opstart-'));
    meldOpstart(path.join(map, 'opstart.txt'), 'eerste-stand', '0.13.0');
    expect(fs.readFileSync(path.join(map, 'opstart.txt'), 'utf8')).toBe('eerste-stand 0.13.0\n');
    expect(() => meldOpstart(path.join(map, 'bestaat', 'niet', 'opstart.txt'), 'fout', '0.13.0')).not.toThrow();
  });
});

describe('geen tweede bewaker naast systemd (0.13.0)', () => {
  it('naastSystemd: dienst bestaat en niet door systemd gestart: ja; door systemd (INVOCATION_ID), Termux of met BRUG_ZONDER_SYSTEMD: nee', () => {
    const ok = () => {};
    const geen = () => {
      throw Object.assign(new Error('geen systemctl'), { code: 'ENOENT' });
    };
    expect(naastSystemd({ env: {}, voer: ok })).toBe(true);
    expect(naastSystemd({ env: { INVOCATION_ID: 'abc' }, voer: ok })).toBe(false);
    expect(naastSystemd({ env: { BRUG_ZONDER_SYSTEMD: '1' }, voer: ok })).toBe(false);
    expect(naastSystemd({ env: {}, voer: geen })).toBe(false);
  });
});
