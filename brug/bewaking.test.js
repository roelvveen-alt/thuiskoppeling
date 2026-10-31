import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BOUWDATUM, houdLogKlein, klokKlopt, maakMissers, tijdstempel, volgKlok } from './bewaking.mjs';

describe('het logboek', () => {
  it('elke regel met de datum, in Nederlandse tijd', () => {
    expect(tijdstempel(Date.UTC(2026, 9, 30, 9, 37, 29))).toBe('30-10 10:37:29');
    expect(tijdstempel(Date.UTC(2026, 6, 1, 22, 5, 0))).toBe('02-07 00:05:00');
  });

  it('boven de grens: een kopie naar .1 en weer leeg, ook terwijl het programmaatje draait', () => {
    const pad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'log-')), 'brug.log');
    const fd = fs.openSync(pad, 'a');
    fs.writeSync(fd, 'x'.repeat(2000));
    expect(houdLogKlein({ fd, hoogstens: 1000, pad })).toBe(true);
    expect(fs.statSync(`${pad}.1`).size).toBe(2000);
    expect(fs.statSync(pad).size).toBe(0);
    fs.writeSync(fd, 'verder\n');
    expect(fs.readFileSync(pad, 'utf8')).toBe('verder\n');
    expect(houdLogKlein({ fd, hoogstens: 1000, pad })).toBe(false);
    fs.closeSync(fd);
  });
});

describe('een meter met zwak wifi', () => {
  it('pas na drie gemiste lezingen op rij weg; eens per uur een samenvatting', () => {
    const m = maakMissers();
    expect(m.mis('dier')).toBe(false);
    expect(m.goed('dier')).toBe(false);
    expect(m.mis('dier')).toBe(false);
    expect(m.mis('dier')).toBe(false);
    expect(m.mis('dier')).toBe(true);
    expect(m.goed('dier')).toBe(true);
    expect(m.samenvatting()).toEqual([['dier', 4]]);
    expect(m.samenvatting()).toEqual([]);
  });
});

describe('de klok van de telefoon', () => {
  const nu = Date.UTC(2026, 10, 2, 12);
  it('niet vóór de bouwdatum, en niet vóór de laatst bewaarde stand', () => {
    expect(klokKlopt(0, null)).toBe(false);
    expect(klokKlopt(BOUWDATUM - 1, null)).toBe(false);
    expect(klokKlopt(nu, null)).toBe(true);
    expect(klokKlopt(nu - 86_400_000, nu)).toBe(false);
    expect(klokKlopt(nu, nu + 30_000)).toBe(true);
  });

  it('springt hij terug: wachten, en na een uur de nieuwe tijd toch geloven', () => {
    let k = volgKlok(null, nu);
    k = volgKlok(k, nu + 5000);
    expect(k.terug).toBe(false);
    k = volgKlok(k, nu - 86_400_000);
    expect(k.terug).toBe(true);
    k = volgKlok(k, nu - 86_400_000 + 30 * 60_000);
    expect(k.terug).toBe(true);
    k = volgKlok(k, nu - 86_400_000 + 61 * 60_000);
    expect(k.terug).toBe(false);
    // En zodra hij weer klopt, meteen.
    expect(volgKlok({ hoogste: nu, sinds: nu - 1000 }, nu + 1000).terug).toBe(false);
  });
});
