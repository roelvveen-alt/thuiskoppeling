import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { alleTabellen, nieuw, veldenVan, VELDEN, verschillen } from '../../scripts/velden.mjs';
import { METING_INTERN, METING_VELDEN } from '../shared/huizen.js';

const tabellen = alleTabellen();
const ALLEEN_BEHEERDER = { user_condition: { role: 'admin' } };

describe('tabellen: alleen de beheerder, en velden komen er alleen bij', () => {
  it('elke tabel is voor iedereen dicht behalve de beheerder (de functies toetsen zelf, toegang.js)', () => {
    expect(Object.keys(tabellen).length).toBeGreaterThan(0);
    for (const [naam, schema] of Object.entries(tabellen)) {
      for (const actie of ['create', 'read', 'update', 'delete']) {
        expect(schema.rls?.[actie], `${naam}: rls.${actie}`).toEqual(ALLEEN_BEHEERDER);
      }
    }
  });

  it('geen vastgelegd veld weg of van type veranderd, en elk nieuw veld vastgelegd (node scripts/velden.mjs)', () => {
    const vastgelegd = JSON.parse(fs.readFileSync(VELDEN, 'utf8'));
    expect(verschillen(vastgelegd, tabellen)).toEqual([]);
    expect(nieuw(vastgelegd, tabellen), 'Nieuwe velden: draai node scripts/velden.mjs en commit base44/tests/velden.json').toEqual([]);
  });

  it('de controle merkt een verdwenen veld, een ander type en een verdwenen tabel', () => {
    const vastgelegd = { Meting: { net_w: 'number', weg_veld: 'string' }, Weg: { a: 'string' } };
    const nu = { Meting: { properties: { net_w: { type: 'string' } } } };
    expect(verschillen(vastgelegd, nu)).toEqual([
      'Meting.net_w was "number", nu "string".',
      'Meting.weg_veld is weg (een uitrol haalt het live weg, met wat erin staat).',
      'Tabel Weg ontbreekt in base44/entities (een uitrol haalt hem live weg).',
    ]);
    expect(veldenVan({ properties: { prijs: { type: 'object', properties: { a: { type: 'number' } } }, l: { type: 'array', items: { type: 'object', properties: { s: { type: 'string' } } } } } })).toEqual({
      prijs: 'object',
      'prijs.a': 'number',
      l: 'array',
      'l[]': 'object',
      'l[].s': 'string',
    });
  });

  it('de site krijgt elk veld van Meting (behalve huis_id, storingen_open en kennis): een nieuw veld vergeten in METING_VELDEN valt op', () => {
    // kennis (1.4.0) is alleen voor de beheerder, via de actie overzicht.
    expect([...METING_INTERN]).toEqual(['huis_id', 'storingen_open', 'kennis']);
    const velden = Object.keys(tabellen.Meting.properties).filter((v) => !METING_INTERN.includes(v));
    expect([...METING_VELDEN].sort()).toEqual(velden.sort());
  });
});
