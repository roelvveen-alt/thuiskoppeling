import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Grafiek, { labelStap, staafPad } from './Grafiek';

describe('staven', () => {
  it('omhoog en omlaag vanaf de nul-lijn, afgerond aan het eind', () => {
    // Plus: van y 100 (nul) naar y 40, 10 px breed.
    expect(staafPad(0, 10, 100, 40)).toBe('M0.0,100.0V44.0Q0.0,40.0 4.0,40.0H6.0Q10.0,40.0 10.0,44.0V100.0Z');
    // Min: van de nul-lijn naar beneden.
    expect(staafPad(0, 10, 100, 130)).toBe('M0.0,100.0V126.0Q0.0,130.0 4.0,130.0H6.0Q10.0,130.0 10.0,126.0V100.0Z');
  });

  it('met lucht raken een staaf boven en een onder de nul elkaar niet', () => {
    expect(staafPad(0, 10, 100, 40, 1)).toMatch(/^M0\.0,99\.0V44\.0/);
    expect(staafPad(0, 10, 100, 130, 1)).toMatch(/^M0\.0,101\.0V126\.0/);
    expect(staafPad(0, 10, 100, 100.8, 1)).toBeNull();
  });

  it('een smalle of lage staaf krijgt een kleinere ronding; te laag om te zien is geen staaf', () => {
    expect(staafPad(0, 4, 100, 50)).toContain('Q0.0,50.0 2.0,50.0');
    expect(staafPad(0, 10, 100, 98)).toContain('Q0.0,98.0 2.0,98.0');
    expect(staafPad(0, 10, 100, 99.8)).toBeNull();
  });

  it('labels: zoveel als er passen', () => {
    // Een week op een telefoon: elke dag.
    expect(labelStap(['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'], 30)).toBe(1);
    // Een maand per dag op 320 px (een plek van ruim 6 px): om de drie.
    expect(labelStap(Array.from({ length: 31 }, (_, i) => String(i + 1)), 6.6)).toBe(3);
  });
});

describe('een grafiek per dag', () => {
  it('de tabel per dag, met de lange naam, alleen dagen met een waarde', () => {
    const html = renderToStaticMarkup(
      <Grafiek
        titel="Zon"
        reeks={[4.2, null, 7.5]}
        labels={['ma', 'di', 'wo']}
        namen={['maandag 26 oktober', 'dinsdag 27 oktober', 'woensdag 28 oktober']}
        tabelKop="Dag"
        stapNaam="dag"
        vorm="staaf"
        kleur="var(--zon)"
        waarde={(v) => `${v} kWh`}
        van={0}
        stapMs={86_400_000}
      />,
    );
    expect(html).toContain('Als tabel, per dag');
    expect(html).toContain('<th scope="col">Dag</th>');
    expect(html).toContain('maandag 26 oktober');
    expect(html).not.toContain('dinsdag 27 oktober');
    expect(html).toContain('7.5 kWh');
    expect(html).toContain('Met de pijltjes ga je per dag.');
  });
});
