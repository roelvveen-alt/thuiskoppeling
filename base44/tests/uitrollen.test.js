import { describe, expect, it } from 'vitest';
import { alleTabellen } from '../../scripts/velden.mjs';
import {
  gitWeigering,
  liveTabellenUit,
  mapWeigering,
  nametingWeigeringen,
  omgevingWeigering,
  tabelWeigeringen,
  tagNaam,
  uitrollen,
} from '../../scripts/uitrollen.mjs';

const lokaal = alleTabellen();
// Zo zou Base44 de tabellen terug kunnen geven; de echte vorm is niet nagemeten, dus liveTabellenUit neemt er een paar.
const liveGelijk = () => ({ entityNameToSchema: structuredClone(lokaal) });

/** Nep voor git en de CLI: onthoudt wat er aangeroepen werd. */
function nep({ status = '', head = 'abc1234', upstream = 'abc1234', schemas = liveGelijk(), deploy = 0 } = {}) {
  const aanroepen = [];
  const voer = (opdracht, args) => {
    const regel = [opdracht, ...args].join(' ');
    aanroepen.push(regel);
    if (regel === 'git status --porcelain') return { status: 0, stdout: status, stderr: '' };
    if (regel === 'git rev-parse HEAD') return { status: 0, stdout: `${head}\n`, stderr: '' };
    if (regel.startsWith('git rev-parse --verify --quiet @{u}')) return upstream ? { status: 0, stdout: `${upstream}\n`, stderr: '' } : { status: 1, stdout: '', stderr: '' };
    if (regel.includes('entity-schemas')) return { status: 0, stdout: JSON.stringify(schemas), stderr: '' };
    if (regel.endsWith('deploy --build --yes')) return { status: deploy, stdout: '', stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  };
  return { voer, aanroepen };
}

const rol = (o) =>
  uitrollen({
    argv: [],
    env: {},
    map: '/home/tim/thuis-energie',
    poorten: () => true,
    appId: () => 'a1b2c3d4e5f6',
    lokaal,
    haal: async () => 401,
    wacht: async () => {},
    nu: new Date('2026-10-30T13:42:00Z'),
    uit: () => {},
    ...o,
  });

describe('uitrollen: de weigerregels', () => {
  it('weigert met BASE44_APP_ID, vanuit een werkmap, of bij een vuile of ongepushte stand', () => {
    expect(omgevingWeigering({ BASE44_APP_ID: 'x' })).toMatch(/BASE44_APP_ID/);
    expect(omgevingWeigering({})).toBeNull();
    expect(mapWeigering('/home/user/thuis-energie/.claude/worktrees/ronde6')).toMatch(/werkmap/);
    expect(mapWeigering('C:\\Users\\tim\\thuis-energie\\.claude\\worktrees\\a')).toMatch(/werkmap/);
    expect(mapWeigering('/home/user/thuis-energie')).toBeNull();
    expect(gitWeigering({ status: ' M src/x.js\n', head: 'a', upstream: 'a' })).toMatch(/gecommit/);
    expect(gitWeigering({ status: '?? nieuw.js\n', head: 'a', upstream: 'a' })).toMatch(/gecommit/);
    expect(gitWeigering({ status: '', head: 'a', upstream: null })).toMatch(/upstream/);
    expect(gitWeigering({ status: '', head: 'a', upstream: 'b' })).toMatch(/gepusht/);
    expect(gitWeigering({ status: '', head: 'a', upstream: 'a' })).toBeNull();
  });

  it('leest de live tabellen in een paar vormen, en weigert een onbekende vorm', () => {
    const huis = { name: 'Huis', properties: { naam: { type: 'string' } }, rls: {} };
    expect(liveTabellenUit([huis])).toEqual({ Huis: huis });
    expect(liveTabellenUit({ entities: [huis] })).toEqual({ Huis: huis });
    expect(liveTabellenUit({ Huis: huis })).toEqual({ Huis: huis });
    // De echte vorm (gemeten 2026-10-30).
    const echt = { name: 'Huis', type: 'object', properties: { naam: { type: 'string' } }, rls: {} };
    expect(liveTabellenUit({ schemas: [{ entity_name: 'Huis', entity_schema: echt }] })).toEqual({ Huis: echt });
    expect(liveTabellenUit('tekst')).toBeNull();
    expect(tabelWeigeringen(null, lokaal)[0]).toMatch(/onbekende vorm/);
  });

  it('live gelijk aan hier: geen weigering; ingebouwde velden tellen niet', () => {
    const live = liveTabellenUit(liveGelijk());
    live.Huis.properties.created_date = { type: 'string' };
    expect(tabelWeigeringen(live, lokaal)).toEqual([]);
  });

  it('weigert een live tabel of veld dat hier ontbreekt, een ander type, en rls die niet alleen-beheerder is', () => {
    const live = liveTabellenUit(liveGelijk());
    live.Extra = { properties: {}, rls: live.Huis.rls };
    live.Meting.properties.alleen_live = { type: 'string' };
    live.Meting.properties.net_w = { type: 'string' };
    live.Dag.rls = { ...live.Dag.rls, read: {} };
    const fouten = tabelWeigeringen(live, lokaal).join('\n');
    expect(fouten).toMatch(/tabel Extra/);
    expect(fouten).toMatch(/Meting\.alleen_live/);
    expect(fouten).toMatch(/Meting\.net_w is live "string"/);
    expect(fouten).toMatch(/Dag: de rls/);
  });

  it('weigert een andere app (andere tabelnamen)', () => {
    const fouten = tabelWeigeringen({ Project: { properties: {} }, Persoon: { properties: {} } }, lokaal);
    expect(fouten[0]).toMatch(/Verkeerde app/);
  });

  it('nameting: alleen twee keer 401 is goed', () => {
    expect(nametingWeigeringen({ ontvangMeting: 401, huis: 401 })).toEqual([]);
    expect(nametingWeigeringen({ ontvangMeting: 200, huis: null })).toEqual([
      'ontvangMeting zonder sleutel gaf 200, niet 401.',
      'huis zonder gebruiker gaf geen antwoord, niet 401.',
    ]);
  });

  it('de tag is in Nederlandse tijd', () => {
    expect(tagNaam(new Date('2026-10-30T13:42:00Z'))).toBe('uitrol/2026-10-30-1442');
  });
});

describe('uitrollen: de volgorde, met nep (niets echt)', () => {
  const deployt = (aanroepen) => aanroepen.some((r) => / deploy( |$)/.test(r));

  it('alles goed: tabellen eerst ophalen (alleen lezen), dan deploy --build --yes, nameten, tag', async () => {
    const { voer, aanroepen } = nep();
    const { gelukt } = await rol({ voer });
    expect(gelukt).toBe(true);
    const schemas = aanroepen.findIndex((r) => r.includes('entity-schemas') && r.includes('--read-only') && r.includes(' GET '));
    const deploy = aanroepen.indexOf('node node_modules/base44/bin/run.js deploy --build --yes');
    expect(schemas).toBeGreaterThan(-1);
    expect(deploy).toBeGreaterThan(schemas);
    expect(aanroepen).toContain('git tag uitrol/2026-10-30-1442');
    expect(aanroepen).toContain('git push origin refs/tags/uitrol/2026-10-30-1442');
  });

  it.each([
    ['BASE44_APP_ID', { env: { BASE44_APP_ID: 'x' } }, {}],
    ['werkmap', { map: '/x/.claude/worktrees/y' }, {}],
    ['vuil', {}, { status: ' M a.js\n' }],
    ['ongepusht', {}, { upstream: 'anders' }],
    ['poort rood', { poorten: () => false }, {}],
    ['live veld ontbreekt hier', {}, { schemas: { Huis: { properties: { weg: { type: 'string' } }, rls: lokaal.Huis.rls } } }],
  ])('weigert (%s) zonder deploy', async (_naam, opties, nepOpties) => {
    const { voer, aanroepen } = nep(nepOpties);
    const { gelukt, tekst } = await rol({ voer, ...opties });
    expect(gelukt).toBe(false);
    expect(tekst.at(-1)).toMatch(/^Niet uitgerold/);
    expect(deployt(aanroepen)).toBe(false);
  });

  it('--droog haalt de tabellen op maar zet niets live', async () => {
    const { voer, aanroepen } = nep();
    expect((await rol({ voer, argv: ['--droog'] })).gelukt).toBe(true);
    expect(aanroepen.some((r) => r.includes('entity-schemas'))).toBe(true);
    expect(deployt(aanroepen)).toBe(false);
  });

  it('nameting zonder 401: mislukt, en geen tag', async () => {
    const { voer, aanroepen } = nep();
    const { gelukt } = await rol({ voer, haal: async () => 200 });
    expect(gelukt).toBe(false);
    expect(aanroepen.some((r) => r.startsWith('git tag'))).toBe(false);
  });

  it('--terug zet alleen functies en site terug, nooit de tabellen (geen kale deploy)', async () => {
    const { voer, aanroepen } = nep();
    const gekopieerd = [];
    const { gelukt } = await rol({ voer, argv: ['--terug', 'uitrol/2026-10-30-1442'], kopieer: (van, naar) => gekopieerd.push(naar) });
    expect(gelukt).toBe(true);
    const cli = aanroepen.filter((r) => r.startsWith('node node_modules/base44/bin/run.js'));
    expect(cli).toEqual([
      'node node_modules/base44/bin/run.js functions deploy',
      'node node_modules/base44/bin/run.js site deploy --build --yes',
    ]);
    expect(gekopieerd[0]).toMatch(/\.app\.jsonc$/);
    expect(aanroepen.some((r) => r.startsWith('git worktree remove'))).toBe(true);
    expect((await rol({ voer, argv: ['--terug', 'iets'] })).gelukt).toBe(false);
  });
});
