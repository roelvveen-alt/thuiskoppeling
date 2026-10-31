import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Logboek from '@/components/Logboek';
import TabApparaten from '@/components/TabApparaten';
import { duurTekst, gebeurtenissenUit, hoeLang, voorbeeldLogboek, watTekst } from '@/lib/logboek';

const gewoon = (t) => t.replace(/\u00a0/g, ' ');
const tekst = (el) =>
  gewoon(
    renderToStaticMarkup(el)
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
// Op de klok van dit toestel, zodat de test in elke tijdzone hetzelfde zegt.
const NU = new Date(2026, 9, 30, 15, 0).getTime();
const om = (u, m, dag = 30) => new Date(2026, 9, dag, u, m).toISOString();

const UIT_DE_FUNCTIE = [
  { id: 'g1', sleutel: 'stil', soort: 'stil', wat: 'Geen cijfers van het programmaatje', begin: om(9, 40), eind: om(10, 3), loopt: false },
  { id: 'g2', sleutel: 'meter:hw-p1', soort: 'meter', wat: 'P1-meter antwoordt niet', begin: om(14, 2), eind: null, loopt: true },
  { id: 'g3', sleutel: 'omvormer:13', soort: 'omvormer', wat: 'Omvormer: storingscode 13', begin: om(12, 0, 29), eind: om(14, 5, 29), loopt: false },
  { id: 'g4', sleutel: 'batterij', soort: 'batterij', wat: 'De batterij meldt een storing', begin: om(8, 0, 28), eind: null, loopt: false },
  { id: 'kapot', begin: 'gisteren' },
  null,
];

describe('het logboek in woorden', () => {
  it('schoon en nieuwste eerst; rommel valt weg', () => {
    const lijst = gebeurtenissenUit(UIT_DE_FUNCTIE);
    expect(lijst.map((g) => g.id)).toEqual(['g2', 'g1', 'g3', 'g4']);
    expect(gebeurtenissenUit(undefined)).toEqual([]);
  });

  it('wat: de omvormer met de naam van zijn storing, de rest zoals de server het zegt', () => {
    const [g2, g1, g3] = gebeurtenissenUit(UIT_DE_FUNCTIE);
    expect(watTekst(g3)).toBe('Omvormer: te warm');
    expect(watTekst({ ...g3, sleutel: 'omvormer:2' })).toBe('Omvormer: storingscode 13');
    expect(watTekst(g2)).toBe('P1-meter antwoordt niet');
    expect(watTekst(g1)).toBe('Geen cijfers van het programmaatje');
  });

  it('hoe lang: een duur, "loopt nog", of "einde onbekend"', () => {
    expect(['', 'minder dan een minuut', '45 min', '2 u', '2 u 5 min', '1 dag', '2 dagen 2 u'].map((x) => x)).toEqual(
      [-1, 20_000, 45 * 60_000, 120 * 60_000, 125 * 60_000, 24 * 3_600_000, 50 * 3_600_000].map((ms) => gewoon(duurTekst(ms))),
    );
    const [g2, g1, , g4] = gebeurtenissenUit(UIT_DE_FUNCTIE);
    expect(gewoon(hoeLang(g1, NU))).toBe('23 min');
    expect(gewoon(hoeLang(g2, NU))).toBe('loopt nog (al 58 min)');
    expect(hoeLang(g4, NU)).toBe('einde onbekend');
  });

  it('de kaart: wanneer, wat en hoe lang; wat loopt in let-op', () => {
    const el = <Logboek gebeurtenissen={gebeurtenissenUit(UIT_DE_FUNCTIE)} status="klaar" nu={NU} />;
    const t = tekst(el);
    expect(t).toContain('Logboek');
    expect(t).toContain('P1-meter antwoordt niet 14:02 · loopt nog (al 58 min)');
    expect(t).toContain('Geen cijfers van het programmaatje 09:40 · 23 min');
    expect(t).toContain('Omvormer: te warm gisteren 12:00 · 2 u 5 min');
    expect(t).toContain('De batterij meldt een storing 28-10 08:00 · einde onbekend');
    expect(renderToStaticMarkup(el).split('text-let-op').length - 1).toBe(1);
  });

  it('leeg, of een oudere functie die het nog niet kent: een gewone zin', () => {
    expect(tekst(<Logboek gebeurtenissen={[]} status="klaar" nu={NU} />)).toContain('Nog geen storingen.');
    expect(tekst(<Logboek gebeurtenissen={[]} status="nietBijgewerkt" nu={NU} />)).toContain('de app wordt net bijgewerkt');
    expect(tekst(<Logboek gebeurtenissen={voorbeeldLogboek(NU)} status="voorbeeld" nu={NU} />)).toContain('P1-meter antwoordt niet');
  });

  it('op Apparaten, onderaan; zonder logboek geen kaart', () => {
    const stand = { moment: new Date(NU - 5000).toISOString() };
    expect(tekst(<TabApparaten stand={stand} nu={NU} logboek={{ gebeurtenissen: [], status: 'klaar' }} />)).toContain('Nog geen storingen.');
    expect(tekst(<TabApparaten stand={stand} nu={NU} />)).not.toContain('Logboek');
  });
});
