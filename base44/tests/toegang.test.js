import { describe, expect, it } from 'vitest';
import { tabellen } from '../shared/tabellen.js';
import { alleHuizen, eigenHuisUit, huisVoor, isBeheerder, magInDeApp, magMaken, rolIn } from '../shared/toegang.js';
import { nepBase44 } from './nep.js';

const TIM = { id: 'gebruiker-tim', email: 'tim@voorbeeld.nl', role: 'admin' };
const DIRK = { id: 'gebruiker-dirk', email: 'DIRK@voorbeeld.nl', role: 'user' };
const VREEMDE = { id: 'gebruiker-vreemd', email: 'vreemd@voorbeeld.nl', role: 'user' };
const HUIS = { id: 'huis-tim01', eigenaar_id: TIM.id, eigenaar_email: 'tim@voorbeeld.nl', leden: [{ email: ' dirk@Voorbeeld.nl' }, null, { email: '' }] };

describe('rolIn', () => {
  it('eigenaar op id, kijker op e-mailadres (zonder hoofdletters), verder niemand', () => {
    expect(rolIn(HUIS, TIM)).toBe('eigenaar');
    expect(rolIn(HUIS, DIRK)).toBe('kijker');
    expect(rolIn(HUIS, VREEMDE)).toBeNull();
    // Een ander account met het e-mailadres van de eigenaar is niet de eigenaar.
    expect(rolIn(HUIS, { id: 'nieuw-account', email: 'tim@voorbeeld.nl' })).toBeNull();
    expect(rolIn(HUIS, { id: 'zonder-email' })).toBeNull();
    expect(rolIn(null, TIM)).toBeNull();
  });

  it('de beheerder heeft in elke omgeving de rechten van de eigenaar', () => {
    const vanDirk = { id: 'huis-dirk001', eigenaar_id: DIRK.id, eigenaar_email: 'dirk@voorbeeld.nl', leden: [] };
    expect(rolIn(vanDirk, TIM)).toBe('eigenaar');
    expect(rolIn(vanDirk, DIRK)).toBe('eigenaar');
    expect(rolIn(vanDirk, VREEMDE)).toBeNull();
    expect(rolIn(vanDirk, { ...TIM, is_active: false })).toBeNull();
    expect(isBeheerder(TIM)).toBe(true);
    expect(isBeheerder(DIRK)).toBe(false);
  });

  it('een uitgeschakeld account heeft nergens een rol, ook niet in zijn eigen huis', () => {
    expect(magInDeApp({ ...TIM, is_active: false })).toBe(false);
    expect(rolIn(HUIS, { ...TIM, is_active: false })).toBeNull();
    expect(rolIn(HUIS, { ...DIRK, is_active: false })).toBeNull();
    expect(magInDeApp(null)).toBe(false);
    expect(magInDeApp({ email: 'zonder-id@voorbeeld.nl' })).toBe(false);
  });
});

describe('magMaken', () => {
  it('alleen de beheerder; wie ergens meekijkt niet, een vreemde ook niet', () => {
    expect(magMaken(TIM)).toBe(true);
    expect(magMaken(DIRK)).toBe(false);
    expect(magMaken(VREEMDE)).toBe(false);
    expect(magMaken({ ...TIM, is_active: false })).toBe(false);
    expect(magMaken(null)).toBe(false);
  });
});

describe('eigenHuisUit', () => {
  it('de oudste omgeving waar iemand bij hoort, op id', () => {
    const nieuw = { id: 'huis-zz9999', eigenaar_id: 'iemand', leden: [{ email: 'dirk@voorbeeld.nl' }] };
    const oud = { id: 'huis-aa0001', eigenaar_id: 'iemand', leden: [{ email: 'dirk@voorbeeld.nl' }] };
    expect(eigenHuisUit([nieuw, HUIS, oud], DIRK)?.id).toBe('huis-aa0001');
    expect(eigenHuisUit([HUIS], VREEMDE)).toBeNull();
    expect(eigenHuisUit([HUIS], { ...DIRK, is_active: false })).toBeNull();
  });
});

describe('huisVoor', () => {
  const db = (huizen = [HUIS]) => tabellen(nepBase44({ rijen: { Huis: huizen } }).client.asServiceRole.entities);
  // Elke test een eigen geheugen: welk huis van wie is, mag niet van de ene test naar de andere lekken.
  const vers = () => ({ geheugen: new Map() });

  it('kijker mag kijken, niet meer', async () => {
    await expect(huisVoor(db(), DIRK, HUIS.id, vers())).resolves.toMatchObject({ rol: 'kijker' });
    await expect(huisVoor(db(), DIRK, HUIS.id, { alleenEigenaar: true, ...vers() })).rejects.toMatchObject({ status: 403, code: 'alleenEigenaar' });
    await expect(huisVoor(db(), TIM, HUIS.id, { alleenEigenaar: true, ...vers() })).resolves.toMatchObject({ rol: 'eigenaar' });
  });

  it('andermans huis en een huis dat niet bestaat: dezelfde fout', async () => {
    const ander = await huisVoor(db(), VREEMDE, HUIS.id, vers()).catch((e) => e);
    const nergens = await huisVoor(db(), VREEMDE, 'huis-nergens', vers()).catch((e) => e);
    const raar = await huisVoor(db(), VREEMDE, { $ne: null }, vers()).catch((e) => e);
    for (const fout of [ander, nergens, raar]) expect(fout).toMatchObject({ status: 404, code: 'geenHuis', message: ander.message });
  });

  it('een gewone gebruiker opent alleen zijn ene omgeving, ook als hij (door een vergissing) bij meer staat', async () => {
    const ouder = { id: 'huis-aa0001', eigenaar_id: 'iemand', eigenaar_email: 'iemand@voorbeeld.nl', leden: [{ email: 'dirk@voorbeeld.nl' }] };
    const tabel = db([HUIS, ouder]);
    await expect(huisVoor(tabel, DIRK, ouder.id, vers())).resolves.toMatchObject({ rol: 'kijker' });
    const tweede = await huisVoor(tabel, DIRK, HUIS.id, vers()).catch((e) => e);
    const nergens = await huisVoor(tabel, DIRK, 'huis-nergens', vers()).catch((e) => e);
    expect(tweede).toMatchObject({ status: 404, code: 'geenHuis', message: nergens.message });
    // De beheerder opent ze allebei, als eigenaar.
    await expect(huisVoor(tabel, TIM, ouder.id, { alleenEigenaar: true, ...vers() })).resolves.toMatchObject({ rol: 'eigenaar' });
    await expect(huisVoor(tabel, TIM, HUIS.id, { alleenEigenaar: true, ...vers() })).resolves.toMatchObject({ rol: 'eigenaar' });
  });

  it('onthoudt een minuut welk huis van wie is, maar toetst het lidmaatschap elke keer vers', async () => {
    const nep = nepBase44({ rijen: { Huis: [HUIS] } });
    const tabel = tabellen(nep.client.asServiceRole.entities);
    const geheugen = new Map();
    await huisVoor(tabel, DIRK, HUIS.id, { geheugen, nu: 1_000 });
    await huisVoor(tabel, DIRK, HUIS.id, { geheugen, nu: 30_000 });
    expect(nep.stand.aanroepen.filter((a) => a === 'Huis.list')).toHaveLength(1);
    await huisVoor(tabel, DIRK, HUIS.id, { geheugen, nu: 62_000 });
    expect(nep.stand.aanroepen.filter((a) => a === 'Huis.list')).toHaveLength(2);
    // Uit het huis gehaald: meteen weg, ook al weet het geheugen nog welk huis het was.
    nep.tabellen.Huis.lijst[0].leden = [];
    await expect(huisVoor(tabel, DIRK, HUIS.id, { geheugen, nu: 63_000 })).rejects.toMatchObject({ status: 404 });
  });
});

describe('alleHuizen', () => {
  it('bladert op id tot een korte bladzijde, elk huis één keer', async () => {
    const huizen = Array.from({ length: 5 }, (_, i) => ({ id: `huis-0000${i}` }));
    const nep = nepBase44({ rijen: { Huis: huizen } });
    const uit = await alleHuizen(tabellen(nep.client.asServiceRole.entities), { pagina: 2 });
    expect(uit.map((h) => h.id)).toEqual(huizen.map((h) => h.id));
    expect(nep.stand.aanroepen).toEqual(['Huis.list', 'Huis.list', 'Huis.list']);
  });
});
