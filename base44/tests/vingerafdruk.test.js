import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { functies, importsVan, regelIn, vingerafdrukVan } from '../../scripts/vingerafdruk.mjs';

describe('vingerafdruk van de functies', () => {
  it.each(functies().map(({ naam, entry }) => [naam, entry]))('%s: klopt met alles wat hij importeert', (naam, entry) => {
    expect(
      regelIn(entry),
      `De vingerafdruk in base44/functions/${naam}/entry.ts klopt niet meer: een bestand dat deze functie ` +
        'importeert is veranderd. Draai "node scripts/vingerafdruk.mjs" en commit entry.ts mee. Anders ziet ' +
        'Base44 de functie als ongewijzigd en blijft de oude live.',
    ).toBe(vingerafdrukVan(entry));
  });

  it('de functies importeren de gedeelde regels', () => {
    const namen = (naam) => [...importsVan(functies().find((f) => f.naam === naam).entry)].map((p) => path.basename(p));
    expect(namen('huis')).toEqual(expect.arrayContaining(['huizen.js', 'toegang.js', 'geduld.js', 'sleutel.js', 'tabellen.js']));
    expect(namen('ontvangMeting')).toEqual(expect.arrayContaining(['ontvang.js', 'controle.js', 'toegang.js', 'sleutel.js']));
  });

  it('verandert als een bestand verder weg verandert, niet door Windows-regeleinden', () => {
    const map = fs.mkdtempSync(path.join(os.tmpdir(), 'vingerafdruk-'));
    try {
      fs.mkdirSync(path.join(map, 'functie'));
      fs.mkdirSync(path.join(map, 'gedeeld'));
      const entry = path.join(map, 'functie', 'entry.ts');
      fs.writeFileSync(entry, "import { a } from './a.js';\n");
      fs.writeFileSync(path.join(map, 'functie', 'a.js'), "export { b as a } from '../gedeeld/b.js';\n");
      fs.writeFileSync(path.join(map, 'gedeeld', 'b.js'), 'export const b = 1;\n');
      const eerst = vingerafdrukVan(entry);

      fs.writeFileSync(path.join(map, 'gedeeld', 'b.js'), 'export const b = 1;\r\n');
      expect(vingerafdrukVan(entry)).toBe(eerst);

      fs.writeFileSync(path.join(map, 'gedeeld', 'b.js'), 'export const b = 2;\n');
      expect(vingerafdrukVan(entry)).not.toBe(eerst);
    } finally {
      fs.rmSync(map, { recursive: true, force: true });
    }
  });
});
