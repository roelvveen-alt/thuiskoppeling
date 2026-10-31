import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LEGE_OPSTELLING, puntenVoor, verplaats } from '@/lib/opstelling';
import { lijnenVoorTekening, verdeelStroom } from '@/lib/stroom';
import { voorbeeldStand } from '@/lib/voorbeeld';
import { stipBanen } from '@/lib/vorm';
import HuisBeeld, { lijnPaden, werkwoord } from './HuisBeeld';

describe('werkwoord bij het getal op de foto', () => {
  it('het huis gebruikt, altijd', () => {
    expect(werkwoord('huis', 460).kort).toBe('gebruikt');
    expect(werkwoord('huis', 0).kort).toBe('gebruikt');
  });
  it('de batterij laadt of levert, vanaf 5 W', () => {
    expect(werkwoord('batterij', -2300).kort).toBe('laadt');
    expect(werkwoord('batterij', 458).kort).toBe('levert');
    expect(werkwoord('batterij', 3)).toBeNull();
  });
  it('het net neemt af of krijgt terug, buiten ±20 W', () => {
    expect(werkwoord('net', 401).kort).toBe('neemt af');
    expect(werkwoord('net', -1600)).toEqual({ kort: 'terug', lang: 'levert terug' });
    expect(werkwoord('net', 15)).toBeNull();
    expect(werkwoord('net', -15)).toBeNull();
  });
  it('de zon levert; een apparaat krijgt geen werkwoord', () => {
    expect(werkwoord('zon', 2000).kort).toBe('levert');
    expect(werkwoord('zon', 0)).toBeNull();
    expect(werkwoord('apparaat', 300)).toBeNull();
  });
});

describe('HuisBeeld: nepcijfers staan er niet als echte', () => {
  const toon = (extra) =>
    renderToStaticMarkup(
      <HuisBeeld tekening="woning" foto={null} punten={[]} stand={null} verdeling={verdeelStroom(null)} bewerken={false} gekozen={null} onKies={() => {}} onVerplaats={() => {}} geld={0.12} {...extra} />,
    );

  it("bij 'leeg' staat linksboven Voorbeeld, in plaats van het geldbordje", () => {
    const html = toon({ voorbeeld: true });
    expect(html).toContain('Voorbeeld');
    expect(html).toContain('Nepcijfers');
    expect(html).not.toContain('per uur');
  });

  it('gewoon live: geen voorbeeldlabel', () => {
    expect(toon({})).not.toContain('Nepcijfers');
  });
});

describe('HuisBeeld: het weer van nu', () => {
  const MOMENT = '2026-10-30T12:00:00.000Z';
  const weer = { nu: { code: 63, neerslag: 1, wind: 20, stoten: 30, bewolking: 100 }, opgehaald: Date.parse(MOMENT) - 600_000 };
  const toon = (extra) =>
    renderToStaticMarkup(
      <HuisBeeld tekening="huis" foto={null} punten={[]} stand={{ moment: MOMENT, weer }} verdeling={verdeelStroom(null)} bewerken={false} gekozen={null} onKies={() => {}} onVerplaats={() => {}} geld={null} {...extra} />,
    );

  it('op de tekening: de regen, en in woorden voor een schermlezer', () => {
    const html = toon({});
    expect(html).toContain('data-valt="regen"');
    expect(html).toContain('Weer nu: regen');
    expect(html).not.toContain('weer-hoek');
  });

  it('bij een eigen foto alleen een klein icoon in de hoek', () => {
    const html = toon({ foto: 'data:image/png;base64,AA==' });
    expect(html).toContain('class="weer-hoek"');
    expect(html).toContain('aria-label="Weer nu: regen"');
    expect(html).not.toContain('data-valt');
  });

  it('zonder weer (een oudere brug): geen icoon, geen weer op de tekening', () => {
    const html = toon({ stand: { moment: MOMENT }, foto: 'data:image/png;base64,AA==' });
    expect(html).not.toContain('weer-hoek');
    expect(toon({ stand: { moment: MOMENT } })).not.toContain('Weer nu');
  });
});

describe('HuisBeeld: de stipjes zijn losse rondjes, geen lopende stroke-dashoffset (prestaties-9)', () => {
  const punten = [
    { sleutel: 'zon', soort: 'zon', naam: 'Zon', x: 50, y: 15, zichtbaar: true },
    { sleutel: 'huis', soort: 'huis', naam: 'Huis', x: 50, y: 70, zichtbaar: true },
  ];
  it('zonder gemeten maat nog geen lijnen; de laag voor de stipjes staat er wel', () => {
    const html = renderToStaticMarkup(
      <HuisBeeld tekening="woning" foto={null} punten={punten} stand={null} verdeling={verdeelStroom(null)} lijnen={[{ van: 'zon', naar: 'huis', w: 2000 }]} bewerken={false} gekozen={null} onKies={() => {}} onVerplaats={() => {}} />,
    );
    expect(html).toContain('class="stippenlaag"');
    expect(html).not.toContain('stroke-dasharray: 0 18');
  });

  it('index.css: geen animatie op stroke-dashoffset en geen overgang op de ring meer', async () => {
    const fs = await import('node:fs');
    const css = fs.readFileSync(new URL('../index.css', import.meta.url), 'utf8');
    expect(css).not.toMatch(/stroke-dashoffset/);
    expect(css).not.toMatch(/transition:[^;]*stroke-dasharray/);
    expect(css).toMatch(/\.huisbeeld\[data-oud="true"\] \.stippenlaag/);
  });
});

describe('lijnPaden: de kabel van het dierenverblijf loopt om het huis heen naar de meterkast (Tim, 31-10-2026)', () => {
  // 13:00 in het voorbeeld: beide plekken met panelen leveren, de batterij laadt, het net krijgt terug.
  const stand = voorbeeldStand(13, 0, 'dierenverblijf');
  const dier = stand.zonnen[1].sleutel;
  const lijnen = lijnenVoorTekening(stand);
  // De foto is staand 4:5: een telefoon van 320 en 390 px, en een groot scherm.
  const MATEN = [288, 358, 540].map((w) => ({ w, h: w * 1.25 }));
  const paden = (opstelling, { w, h }, plekVan) =>
    lijnPaden(lijnen, puntenVoor(opstelling, stand).filter((p) => p.zichtbaar), { w, h, smal: w < 440, plekVan });
  const vanDier = (l) => l.van === dier;
  const isBoog = (d) => /^M[\d.]+ [\d.]+ Q[\d.]+ [\d.]+ [\d.]+ [\d.]+$/.test(d);

  it('het dierenverblijf levert en heeft een lijn naar het huis', () => {
    expect(lijnen).toContainEqual(expect.objectContaining({ van: dier, naar: 'huis' }));
  });

  it('op de beginplekken: langs de goot (de witte rand onder het dak), pas boven de meterkast omlaag het huis in', () => {
    for (const maat of MATEN) {
      const { w, h } = maat;
      const lijn = paden(LEGE_OPSTELLING, maat).find(vanDier);
      expect(lijn.d, `${w}px`).not.toSatisfy(isBoog);
      // Elk stipje: op de goot (y 48,5–51,2%), of in het laatste stukje naar de meterkast (links van de knik op x 49%).
      for (const baan of stipBanen(lijn.d)) {
        for (const { x, y } of baan) {
          const opGoot = y >= 0.485 * h && y <= 0.512 * h;
          expect(opGoot || x <= 0.49 * w + 0.5, `${w}px: ${x}, ${y}`).toBe(true);
        }
      }
      // De pijl wijst de meterkast (het huis) in, van rechtsboven: niet op dezelfde plek als de lijn van het hoofddak.
      const [ex, ey] = lijn.d.match(/-?\d+(\.\d+)?/g).map(Number).slice(-2);
      expect(Math.hypot(ex - 0.4 * w, ey - 0.62 * h)).toBeCloseTo(maatVan(w) / 2 + 6, 0);
      const hoofddak = paden(LEGE_OPSTELLING, maat).find((l) => l.van === stand.zonnen[0].sleutel);
      const [hx, hy] = hoofddak.d.match(/-?\d+(\.\d+)?/g).map(Number).slice(-2);
      expect(Math.hypot(ex - hx, ey - hy), `${w}px`).toBeGreaterThan(12);
    }
  });

  it('de andere lijnen buigen zoals altijd', () => {
    for (const maat of MATEN) {
      for (const lijn of paden(LEGE_OPSTELLING, maat).filter((l) => !vanDier(l))) expect(lijn.d, `${lijn.van} > ${lijn.naar}`).toSatisfy(isBoog);
    }
  });

  it('een verplaatst dierenverblijf of huis (Indelen) houdt de gewone lijn, ook tijdens het slepen', () => {
    const maat = MATEN[1];
    expect(paden(verplaats(LEGE_OPSTELLING, dier, 84, 57), maat).find(vanDier).d).toSatisfy(isBoog);
    expect(paden(verplaats(LEGE_OPSTELLING, 'huis', 30, 70), maat).find(vanDier).d).toSatisfy(isBoog);
    const sleept = (p) => (p.sleutel === dier ? { sleutel: dier, x: 75, y: 45 } : p);
    expect(paden(LEGE_OPSTELLING, maat, sleept).find(vanDier).d).toSatisfy(isBoog);
  });

  it('staat er een ander rondje op de route, dan de gewone boog eromheen', () => {
    const lijn = paden(verplaats(LEGE_OPSTELLING, 'batterij', 58, 50), MATEN[1]).find(vanDier);
    expect(lijn.d).toSatisfy(isBoog);
  });
});

/** Zoals in HuisBeeld.jsx: op een smalle foto 44 px, anders 48. */
const maatVan = (w) => (w < 440 ? 44 : 48);

describe('lijnPaden bij Dirk: de panelen liggen achter, de lijn komt van achter het huis omhoog naar het rondje en gaat voor het huis omlaag (Tim, 31-10-2026)', () => {
  const stand = voorbeeldStand(13, 0, 'garage');
  const lijnen = lijnenVoorTekening(stand);
  const opstelling = { ...LEGE_OPSTELLING, tekening: 'garage' };
  const paden = (opst, w, plekVan) =>
    lijnPaden(lijnen, puntenVoor(opst, stand).filter((p) => p.zichtbaar), { w, h: w * 1.25, smal: w < 440, plekVan });

  it('op de beginplekken: een aanloop van de nok naar het rondje, en de stroom van het rondje naar de meterkast', () => {
    for (const w of [288, 358, 540]) {
      const vanZon = paden(opstelling, w).filter((l) => l.van === stand.zonnen[0].sleutel && l.naar === 'huis');
      expect(vanZon.map((l) => l.deel ?? 'stroom'), `${w}px`).toEqual(['aanloop', 'stroom']);
      // De aanloop begint achter de nok (op het dak, onder 26,4%) en het dak verbergt dat stuk.
      const [, y0] = vanZon[0].d.match(/^M([\d.]+) ([\d.]+)/).slice(1).map(Number);
      expect(y0 / (w * 1.25)).toBeGreaterThan(0.264);
      expect(vanZon[0].verberg).toHaveLength(4);
    }
  });

  it('wie het zon-rondje verplaatst, krijgt de gewone boog en geen aanloop', () => {
    const zon = stand.zonnen[0].sleutel;
    const vanZon = paden(verplaats(opstelling, zon, 30, 30), 358).filter((l) => l.van === zon);
    expect(vanZon.some((l) => l.deel === 'aanloop')).toBe(false);
  });
});
