import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import Energie from './Energie';

it('meer uit het net dan het huis gebruikte (de batterij laadde uit het net): de zin zegt waarom', () => {
  // Zoals bij Tim 's nachts (31-10-2026): huis 2,3 kWh, uit het net 4,7 kWh, de batterij laadde 2,9 kWh.
  const html = renderToStaticMarkup(<Energie zon={0} huis={2.3} geladen={2.9} ontladen={0.5} afname={4.7} terug={0} />);
  expect(html).toMatch(/ook om de batterij te laden \(2,9\skWh\)/u);
  expect(html).toContain('telt als net');
});

it('gewoon: het huis en wat er uit het net kwam', () => {
  const html = renderToStaticMarkup(<Energie zon={5} huis={8} geladen={1} ontladen={1} afname={3} terug={1} />);
  expect(html).toMatch(/het huis gebruikte 8,0\skWh, en 3,0\skWh kwam uit het net\./u);
});
