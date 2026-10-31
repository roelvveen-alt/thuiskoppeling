import { describe, expect, it } from 'vitest';
import { LAAD_VLAK_W, laadVlakken } from './OverzichtVandaag';

const KW = 15 * 60_000;
const VAN = Date.UTC(2026, 9, 30, 11, 0);

describe('groene vlakken: waar de batterij echt laadde', () => {
  it('aaneengesloten laadkwartieren worden één vlak, ook als de prijzen eerder beginnen', () => {
    const dag = { van: VAN, stapMs: KW, metingen: [1, 1, 1, 1, 1, 0], batterij: [100, -2400, -2300, -50, -2400, -2400] };
    // De prijzen beginnen een uur eerder: index 4 is het eerste kwartier van de dag.
    // Een gat van één kwartier (index 7) hoort er nog bij: één vlak, niet twee keer "laadde".
    expect(laadVlakken(dag, VAN - 4 * KW, KW, 20)).toEqual([{ eerste: 5, laatste: 8, label: 'laadde', uitleg: 'toen laadde je batterij', kleur: 'var(--batterij)' }]);
    const lang = { van: VAN, stapMs: KW, metingen: [1, 1, 1, 1, 1, 1], batterij: [-2400, 0, 0, 0, -2400, 0] };
    expect(laadVlakken(lang, VAN, KW, 6).map((v) => [v.eerste, v.laatste])).toEqual([[0, 0], [4, 4]]);
  });

  it('weinig laden, geen dag of geen metingen: geen vlak', () => {
    expect(laadVlakken({ van: VAN, stapMs: KW, metingen: [1], batterij: [-(LAAD_VLAK_W - 1)] }, VAN, KW, 4)).toEqual([]);
    expect(laadVlakken(null, VAN, KW, 4)).toEqual([]);
    expect(laadVlakken({ van: VAN, stapMs: KW, metingen: [0], batterij: [-2400] }, VAN, KW, 4)).toEqual([]);
  });
});
