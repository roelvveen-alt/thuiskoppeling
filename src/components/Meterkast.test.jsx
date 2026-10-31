import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LEGE_OPSTELLING, puntenVoor } from '@/lib/opstelling';
import { verdeelStroom } from '@/lib/stroom';
import Detail from './Detail';
import Gas, { standUit } from './Gas';
import { GasEnWater, MeterkastNu } from './Meterkast';
import TabNu from './TabNu';

const tekst = (el) =>
  renderToStaticMarkup(el)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|\s/g, ' ')
    .replace(/ +/g, ' ')
    .trim();

const DIRK = {
  zon_w: 0,
  zonnen: [],
  batterij_w: 640,
  batterij_procent: 57,
  net_w: 412,
  apparaten: [],
  meterkast: { tarief: 1, meters: [{ soort: 'gas', stand: 2569.646, eenheid: 'm3', op: null, vandaag: 1.234 }] },
};

describe('de meterkast (programmaatje 1.4.0)', () => {
  it('op Nu een tegel Meterkast met het tarief en het gas van vandaag; zonder meterkast niets', () => {
    expect(tekst(<MeterkastNu stand={DIRK} />)).toMatch(/Meterkast Nu daltarief zo telt de slimme meter Gas vandaag 1,23 m³ meterstand 2\.569,646 m³/);
    expect(renderToStaticMarkup(<MeterkastNu stand={{ ...DIRK, meterkast: null }} />)).toBe('');
    const nu = tekst(<TabNu stand={DIRK} verdeling={verdeelStroom(DIRK)} punten={puntenVoor(LEGE_OPSTELLING, DIRK)} onKies={() => {}} />);
    expect(nu).toMatch(/Gas vandaag 1,23 m³/);
    const zonder = tekst(<TabNu stand={{ ...DIRK, meterkast: null }} verdeling={verdeelStroom(DIRK)} punten={puntenVoor(LEGE_OPSTELLING, DIRK)} onKies={() => {}} />);
    expect(zonder).not.toMatch(/Meterkast Nu|Gas vandaag/);
  });

  it('in het blad van het net, met een kopje; met een dynamisch contract geen dal/normaal', () => {
    const punten = puntenVoor(LEGE_OPSTELLING, DIRK);
    const net = punten.find((p) => p.soort === 'net');
    const t = tekst(<Detail punt={net} punten={punten} stand={{ ...DIRK, prijs: { nu: 0.21 } }} verdeling={verdeelStroom(DIRK)} onSluit={() => {}} />);
    expect(t).toMatch(/Meterkast Gas vandaag 1,23 m³/);
    expect(t).not.toMatch(/daltarief/);
  });

  it('Overzicht: gas (en water) over een periode; zonder gas geen tegel', () => {
    expect(tekst(<GasEnWater gas={12.345} wanneer="deze week" bron="standen" />)).toMatch(/Gas deze week 12,35 m³ uit je ingevulde meterstanden/);
    expect(tekst(<GasEnWater gas={1.2} water={0.15} wanneer="vandaag" />)).toMatch(/Gas en water vandaag 1,20 m³ water 0,15 m³/);
    expect(renderToStaticMarkup(<GasEnWater wanneer="vandaag" />)).toBe('');
  });
});

describe('Instellingen › Gas: zelf meterstanden invullen', () => {
  it('wat iemand typt, als getal', () => {
    expect(standUit('2569,646')).toBe(2569.646);
    expect(standUit('2.569,646')).toBe(2569.646);
    expect(standUit('2569.646')).toBe(2569.646);
    expect(standUit(' 2.569 ')).toBe(2569);
    expect(standUit('12')).toBe(12);
    for (const fout of ['', 'veel', '-3', '1,2,3', '1.23456', null]) expect(standUit(fout)).toBeNull();
  });

  it('zonder gas van de slimme meter: uitleg, een formulier en de standen met wat er bij kwam; knoppen van 44 px', () => {
    const standen = [
      { datum: '2026-10-21', stand: 2500 },
      { datum: '2026-10-31', stand: 2520.5 },
    ];
    const html = renderToStaticMarkup(<Gas standen={standen} nu={Date.parse('2026-10-31T12:00:00Z')} onStand={async () => ({ ok: true })} />);
    const t = tekst(<Gas standen={standen} nu={Date.parse('2026-10-31T12:00:00Z')} onStand={async () => ({ ok: true })} />);
    expect(t).toMatch(/Geeft de slimme meter het gas niet door\?/);
    expect(t).toMatch(/31 okt 2026 · 2\.520,5 m³ 20,50 m³ sinds 21 okt/);
    expect(html).toContain('type="date"');
    expect(html).toContain('inputMode="decimal"');
    expect(html).toContain('size-11');
    expect(html).toMatch(/aria-label="Stand van 31.okt weghalen"/);
  });

  it('met gas van de slimme meter: alleen om te vergelijken', () => {
    const t = tekst(<Gas standen={[]} meterkast={DIRK.meterkast} nu={Date.parse('2026-10-31T12:00:00Z')} onStand={async () => ({ ok: true })} />);
    expect(t).toMatch(/De slimme meter geeft het gas al door \(stand nu 2\.569,646 m³ ?, vandaag 1,23 m³ ?\)/);
  });
});
