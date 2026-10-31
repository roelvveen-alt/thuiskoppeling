import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { adviesBereik } from '@/lib/adviesBron';
import { maakAdvies } from '@/lib/advies';
import { standUitRij } from '@/lib/bron';
import { dagenUit } from '@/lib/periode';
import { voorbeeldDagen, voorbeeldStand } from '@/lib/voorbeeld';
import Advies from './Advies';
import Namen from './Namen';

const UUR = 3_600_000;
const NACHT = Date.parse('2026-11-05T23:00:00Z');
const NU = NACHT + 10.25 * UUR;

/** Een meting van brug 0.6.1 zoals Base44 hem bewaart: prijzen per kwartier, batterij, geen weer. */
const RIJ = {
  moment: new Date(NU).toISOString(),
  net_w: 120,
  zon_w: 900,
  batterij_w: -300,
  batterij_procent: 40,
  batterij_info: { inhoud_kwh: 8.64, ontlaadgrens_pct: 10, laadgrens_pct: 100 },
  voorspelling: {
    van: new Date(NACHT).toISOString(),
    stap_min: 15,
    afname_kwh: Array.from({ length: 96 }, (_, i) => (i >= 68 && i < 80 ? 0.38 : i >= 48 && i < 60 ? 0.16 : 0.25)),
    teruglevering_kwh: Array(96).fill(0.2),
    zonnebonus_kwh: Array(96).fill(0),
  },
  brug: { versie: '0.6.1', gestart: '2026-11-01T10:00:00Z', elke_seconden: 5 },
};

describe('de kaart Advies', () => {
  it('hooguit drie grote regels, een tijdlijn van 24 vakjes met woorden erbij, de details dicht, en geen knoppen of keuzes', () => {
    const html = renderToStaticMarkup(<Advies stand={standUitRij(RIJ)} dagen={[]} nu={NU} />);
    expect(html).toContain('Advies');
    expect(html).toContain('Goed moment');
    expect(html).toContain('Liever niet');
    expect(html).toContain('ik leer nog');
    expect(html).toContain('De komende 24 uur');
    // Elk uur een vakje met zijn betekenis in woorden (niet alleen kleur), het uur van nu heet "nu".
    expect(html.match(/aria-label="(nu, )?\d+ tot \d+ uur: (goed|gewoon|liever niet)"/g)).toHaveLength(24);
    expect(html).toContain('aria-label="nu, 10 tot 11 uur:');
    expect(html).toMatch(/aria-label="Wat de kleuren zeggen"/);
    // De tabel en de uitleg achter "Meer details" (dicht).
    expect(html).toMatch(/<details[^>]*>.*Meer details/);
    expect(html).not.toMatch(/<details[^>]* open/);
    expect(html).toContain('Alleen raad: de app zet niets aan of uit.');
    expect(html).not.toMatch(/<button|<input|radiogroup/);
  });

  it('niets over de batterij op de kaart, ook niet met de rol handelen', () => {
    for (const rol of ['eigen', 'handelen']) {
      const html = renderToStaticMarkup(<Advies stand={standUitRij(RIJ)} dagen={[]} nu={NU} rol={rol} />);
      const kaart = html.replace(/<details.*<\/details>/s, '');
      expect(kaart).not.toMatch(/batterij|Eigen gebruik|Handelen|€|kWh/i);
    }
  });

  it('de keuze eigen gebruik of handelen staat bij Instellingen › Namen, alleen met een batterij', () => {
    const batterij = { soort: 'batterij', sleutel: 'batterij', naam: 'Batterij', bronNaam: 'Batterij', eigenNaam: '' };
    const huis = { soort: 'huis', sleutel: 'huis', naam: 'Huis', bronNaam: 'Huis', eigenNaam: '' };
    const met = renderToStaticMarkup(<Namen punten={[huis, batterij]} onNaam={() => {}} batterijRol="handelen" onBatterijRol={() => {}} />);
    expect(met).toContain('Batterij in het advies');
    expect(met.match(/role="radio"/g)).toHaveLength(2);
    expect(met).toMatch(/aria-checked="true"[^>]*>Handelen</);
    const zonder = renderToStaticMarkup(<Namen punten={[huis]} onNaam={() => {}} batterijRol="eigen" onBatterijRol={() => {}} />);
    expect(zonder).not.toContain('Batterij in het advies');
  });

  it('zonder stand: niets', () => {
    expect(renderToStaticMarkup(<Advies stand={null} dagen={[]} nu={NU} />)).toBe('');
  });

  it('de dagen voor Advies en Voorspelling: zes weken tot en met gisteren, in één vraag', () => {
    expect(adviesBereik(NU)).toEqual({ van: '2026-09-25', tot: '2026-11-05', vandaag: '2026-11-06' });
  });

  it('het voorbeeld heeft dagen met uren, zodat het advies daar geleerd is', () => {
    const { van, tot, vandaag } = adviesBereik(NU);
    const dagen = dagenUit(voorbeeldDagen(van, tot, vandaag)).slice(-14);
    expect(dagen.every((d) => d.uren?.huisWh.length === 24)).toBe(true);
    const a = maakAdvies({ stand: voorbeeldStand(10.25, 0, 'dierenverblijf', NACHT), dagen, nu: NU });
    expect(a.geleerd.dagen).toBe(14);
    expect(a.regels.length).toBeGreaterThanOrEqual(1);
    expect(a.regels.length).toBeLessThanOrEqual(3);
  });
});
