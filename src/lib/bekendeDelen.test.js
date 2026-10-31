import { describe, expect, it } from 'vitest';
import { hebVan, metBekendeDelen } from '@/lib/bron';

const dag = { datum: '2026-10-30', metingen: [1] };
const voorspelling = { van: '2026-10-29T23:00:00Z' };

describe("'stand' zonder de zware delen die de site al heeft", () => {
  it('eerste keer: alles binnen, en bewaard met kenmerk', () => {
    const { meting, bewaard } = metBekendeDelen({ meting: { moment: 'a', dag, voorspelling }, kenmerken: { dag: 'k1', voorspelling: 'k2' } });
    expect(meting).toEqual({ moment: 'a', dag, voorspelling });
    expect(hebVan(bewaard)).toEqual({ dag: 'k1', voorspelling: 'k2' });
  });

  it('daarna: wat bekend is komt uit het bewaarde, wat nieuw is vervangt het', () => {
    const eerst = metBekendeDelen({ meting: { moment: 'a', dag, voorspelling }, kenmerken: { dag: 'k1', voorspelling: 'k2' } });
    const nieuweVoorspelling = { van: '2026-10-30T23:00:00Z' };
    const { meting, bewaard } = metBekendeDelen(
      { meting: { moment: 'b', voorspelling: nieuweVoorspelling }, kenmerken: { dag: 'k1', voorspelling: 'k3' }, bekend: ['dag'] },
      eerst.bewaard,
    );
    expect(meting).toEqual({ moment: 'b', dag, voorspelling: nieuweVoorspelling });
    expect(meting.dag).toBe(dag);
    expect(hebVan(bewaard)).toEqual({ dag: 'k1', voorspelling: 'k3' });
  });

  it('een oude functie (geen kenmerken): de meting zoals hij is, niets te bewaren', () => {
    const { meting, bewaard } = metBekendeDelen({ meting: { moment: 'a', dag } }, { dag: { kenmerk: 'k1', waarde: dag } });
    expect(meting).toEqual({ moment: 'a', dag });
    expect(hebVan(bewaard)).toEqual({});
  });

  it('een deel weg dat niet meer in de meting staat, en geen meting', () => {
    const eerst = metBekendeDelen({ meting: { moment: 'a', dag }, kenmerken: { dag: 'k1' } });
    expect(metBekendeDelen({ meting: { moment: 'b' }, kenmerken: {} }, eerst.bewaard).meting).toEqual({ moment: 'b' });
    expect(metBekendeDelen({ meting: null }, eerst.bewaard)).toEqual({ meting: null, bewaard: {} });
  });
});
