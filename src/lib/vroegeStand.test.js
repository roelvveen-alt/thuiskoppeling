// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = { heeftToken: () => true };
vi.mock('@/api/base44Client', () => ({ VOORBEELD: false, base44: { auth: { heeftToken: () => auth.heeftToken() } }, statusVan: () => null }));
const vraag = vi.fn(async () => ({ meting: null }));
vi.mock('@/api/huis', async (origineel) => ({ ...(await origineel()), vraag: (...a) => vraag(...a) }));

const { LOKAAL_LAATSTE_HUIS, neemVroegeStand, onthoudLaatsteHuis, vergeetVroegeStand, vraagVroegeStand, VROEG_GELDIG_MS } = await import('./vroegeStand.js');

beforeEach(() => {
  window.localStorage.clear();
  vergeetVroegeStand();
  vraag.mockClear();
  auth.heeftToken = () => true;
});

describe('de vroege stand', () => {
  it('zonder onthouden huis: niets vragen', () => {
    vraagVroegeStand();
    expect(vraag).not.toHaveBeenCalled();
    expect(neemVroegeStand('huis-1')).toBeNull();
  });

  it('zonder token: niets vragen (dat kan alleen 401 worden; "mijn" stuurt naar het inloggen)', () => {
    onthoudLaatsteHuis('huis-1');
    auth.heeftToken = () => false;
    vraagVroegeStand();
    expect(vraag).not.toHaveBeenCalled();
  });

  it('één keer per pagina, één keer te nemen, alleen voor hetzelfde huis', () => {
    onthoudLaatsteHuis('huis-1');
    expect(JSON.parse(window.localStorage.getItem(LOKAAL_LAATSTE_HUIS))).toBe('huis-1');
    vraagVroegeStand({ klok: () => 1000 });
    vraagVroegeStand({ klok: () => 1000 });
    expect(vraag).toHaveBeenCalledTimes(1);
    expect(vraag).toHaveBeenCalledWith('stand', { huis_id: 'huis-1' }, { herhalen: false });
    expect(neemVroegeStand('huis-2', { klok: () => 1000 })).toBeNull();
    // Ook na een verkeerd huis is hij op.
    expect(neemVroegeStand('huis-1', { klok: () => 1000 })).toBeNull();
  });

  it('te oud: niet meer gebruiken', async () => {
    onthoudLaatsteHuis('huis-1');
    vraagVroegeStand({ klok: () => 0 });
    expect(neemVroegeStand('huis-1', { klok: () => VROEG_GELDIG_MS + 1 })).toBeNull();
    vergeetVroegeStand();
    vraagVroegeStand({ klok: () => 0 });
    await expect(neemVroegeStand('huis-1', { klok: () => VROEG_GELDIG_MS })).resolves.toEqual({ meting: null });
  });
});
