import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = fs.readFileSync(new URL('../index.css', import.meta.url), 'utf8');
const blok = (kiezer) => {
  const begin = css.indexOf(`\n${kiezer} {`);
  return begin === -1 ? '' : css.slice(begin, css.indexOf('}', begin));
};

describe('iPhone vanaf het beginscherm (statusbalk black-translucent)', () => {
  it('de kop begint onder de statusbalk, op elke pagina met .schil', () => {
    expect(blok('.schil')).toMatch(/padding-top:\s*calc\(12px \+ env\(safe-area-inset-top, 0px\)\)/);
    expect(blok('.schil')).not.toMatch(/padding-block/);
  });

  it('de strook onder de statusbalk is in beide thema\'s donker (iOS tekent de klok wit)', () => {
    expect(blok('body::before')).toMatch(/background:\s*var\(--statusbalk\)/);
    const keren = css.match(/--statusbalk:\s*([^;]+);/g) ?? [];
    expect(keren).toEqual(['--statusbalk: #081421;']);
  });
});

describe('segmentknoppen (Vandaag · Week · Maand · Kwartaal · Jaar)', () => {
  it('nooit smaller dan 44 px, ook op 320 px', () => {
    expect(blok('.segmenten .keuze')).toMatch(/min-width:\s*44px;/);
  });
});
