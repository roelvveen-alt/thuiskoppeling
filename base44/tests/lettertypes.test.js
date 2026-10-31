import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { lettertypesErin } from '../../scripts/lettertypes.mjs';

const fonts = path.resolve(import.meta.dirname, '../../public/fonts');

describe('lettertypesErin: het losse voorbeeld heeft zijn letters bij zich', () => {
  it('zet elke woff2 uit fonts/ erin als data-URI, in alle schrijfwijzen van Vite', () => {
    const css = '@font-face{src:url(/fonts/instrument-sans-latin.woff2) format("woff2")}'
      + '@font-face{src:url("./fonts/bricolage-grotesque-latin.woff2")}.x{background:url(beeld.png)}';
    const { css: uit, ontbreekt } = lettertypesErin(css, fonts);
    expect(ontbreekt).toEqual([]);
    expect(uit).not.toContain('/fonts/');
    expect(uit.match(/data:font\/woff2;base64,/g)).toHaveLength(2);
    const verwacht = fs.readFileSync(path.join(fonts, 'instrument-sans-latin.woff2')).toString('base64');
    expect(uit).toContain(verwacht);
    expect(uit).toContain('url(beeld.png)');
  });

  it('meldt een lettertype dat er niet is, en laat het staan', () => {
    const { css, ontbreekt } = lettertypesErin('a{src:url(/fonts/weg.woff2)}', fonts);
    expect(ontbreekt).toEqual(['weg.woff2']);
    expect(css).toContain('/fonts/weg.woff2');
  });
});
