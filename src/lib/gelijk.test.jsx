// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { deelGelijk, gelijk, useGelijk } from './gelijk';
import { standUitRij } from './bron';
import { voorbeeldStand } from './voorbeeld';

describe('gelijk: op de inhoud', () => {
  it('getallen, tekst, lijsten en objecten', () => {
    expect(gelijk({ a: [1, { b: 'x' }], c: null }, { a: [1, { b: 'x' }], c: null })).toBe(true);
    expect(gelijk({ a: [1, 2] }, { a: [1, 3] })).toBe(false);
    expect(gelijk({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(gelijk([1], { 0: 1 })).toBe(false);
    expect(gelijk(Number.NaN, Number.NaN)).toBe(true);
    expect(gelijk(new Date(0), new Date(0))).toBe(false);
  });
});

describe('deelGelijk: wat niet veranderde, houdt zijn oude object (prestaties-19)', () => {
  const rij = (net_w, moment = '2026-10-30T12:00:00Z') =>
    standUitRij({ moment, net_w, zon_w: 1200, prijs: { afname_kwh: 0.25, teruglevering_kwh: 0.23, van: '2026-10-30T12:00:00Z', tot: '2026-10-30T12:15:00Z' } });

  it('alles gelijk: precies het oude object', () => {
    const oud = rij(300);
    expect(deelGelijk(oud, rij(300))).toBe(oud);
  });

  it('een nieuwe meting: een nieuw object, met de oude prijs erin', () => {
    const oud = rij(300);
    const nieuw = deelGelijk(oud, rij(320, '2026-10-30T12:00:05Z'));
    expect(nieuw).not.toBe(oud);
    expect(nieuw.net_w).toBe(320);
    expect(nieuw.moment).toBe('2026-10-30T12:00:05Z');
    expect(nieuw.prijs).toBe(oud.prijs);
    expect(nieuw.zonnen).toBe(oud.zonnen);
  });

  it('een veld weg of erbij telt als anders (een oudere of nieuwere brug)', () => {
    const oud = { a: 1, b: 2 };
    expect(deelGelijk(oud, { a: 1 })).toEqual({ a: 1 });
    expect(deelGelijk(oud, { a: 1, b: 2, c: 3 })).toEqual({ a: 1, b: 2, c: 3 });
  });

  it('het voorbeeld: twee tikken na elkaar delen de dag, de voorspelling en het weer', () => {
    const dag = Date.parse('2026-10-30T00:00:00');
    const a = voorbeeldStand(10.25, 1, 'dierenverblijf', dag);
    const b = deelGelijk(a, voorbeeldStand(10.25, 2, 'dierenverblijf', dag));
    expect(b).not.toBe(a);
    for (const deel of ['dag', 'voorspelling', 'weer', 'prijs', 'brug', 'omvormer']) expect(b[deel], deel).toBe(a[deel]);
  });
});

describe('useGelijk', () => {
  it('houdt het vorige object zolang de inhoud gelijk is, en geeft een nieuw als er iets verandert', () => {
    const { result, rerender } = renderHook(({ w }) => useGelijk(w), { initialProps: { w: { a: 1, lijst: [1, 2] } } });
    const eerste = result.current;
    rerender({ w: { a: 1, lijst: [1, 2] } });
    expect(result.current).toBe(eerste);
    rerender({ w: { a: 2, lijst: [1, 2] } });
    expect(result.current).not.toBe(eerste);
    expect(result.current.a).toBe(2);
    expect(result.current.lijst).toBe(eerste.lijst);
  });

  it('werkt ook op de server (geen effect nodig)', () => {
    function Toon() {
      return <span>{useGelijk({ a: 1 }).a}</span>;
    }
    expect(renderToStaticMarkup(<Toon />)).toBe('<span>1</span>');
  });
});
