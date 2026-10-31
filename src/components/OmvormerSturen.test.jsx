// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { standUitRij } from '@/lib/bron';
import { blokZin, controleZin, instellingUit, liveRegel, oorspronkelijkZin, standZin, sturenUit, wijzigLokaal } from '@/lib/omvormerSturen';
import { faseSpanning, spanningUit, zonmeterEenfase } from '@/lib/spanning';
import { FasenNu } from './Fasen';
import OmvormerSturen, { SturenKaart } from './OmvormerSturen';
import Spanning from './Spanning';
import TabApparaten from './TabApparaten';

afterEach(cleanup);

const tekst = (el) =>
  renderToStaticMarkup(el)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|\s/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/ +/g, ' ')
    .trim();

// 31 oktober 2026, 10:00 op de klok van de tests (UTC; in Nederland 11:00).
const NU = Date.parse('2026-10-31T10:00:00Z');
const RUW = {
  aan: true,
  stand: 'begrensd',
  pct: 20,
  sinds: '2026-10-31T09:45:00.000Z',
  door: 'programmaatje',
  aanpassingen: 1,
  doel_w: 1500,
  verbruik_w: 900,
  blokken: [
    { van: '2026-10-31T09:45:00.000Z', tot: '2026-10-31T13:15:00.000Z', laagste: -0.034, modus: 'deels' },
    { van: '2026-11-01T11:00:00.000Z', tot: '2026-11-01T14:15:00.000Z', laagste: -0.04, modus: 'deels' },
    { van: '2026-11-02T11:00:00.000Z', tot: '2026-11-02T12:00:00.000Z', laagste: -0.02, modus: 'loont-niet', reden: 'saldering' },
  ],
};

describe('de zinnen bij het begrenzen', () => {
  it('het plan, met de reden', () => {
    const s = sturenUit(RUW);
    expect(blokZin(s.blokken[1], NU, { verbruikW: s.verbruikW })).toBe('Morgen 11:00–14:15 begrensd tot ~1,2\u00a0kW: terugleveren kost dan tot 4\u00a0ct/kWh, je eigen verbruik blijft van de zon.');
    expect(blokZin(s.blokken[2], NU)).toMatch(/is de prijs negatief, maar door de saldering loont begrenzen nog niet; vanaf 2027 wel\.$/);
    expect(blokZin({ ...s.blokken[1], modus: 'uit' }, NU)).toMatch(/helemaal uit: terugleveren kost dan tot 4\u00a0ct\/kWh en stroom uit het net levert zelfs geld op\./);
  });
  it('de stand', () => {
    expect(standZin(sturenUit(RUW))).toBe('Begrensd tot ~1,5\u00a0kW sinds 09:45 door het programmaatje, past zich aan je verbruik aan.');
    expect(standZin(sturenUit({ stand: 'eigen', grens_pct: 70 }))).toMatch(/eigen grens van 70%/);
    expect(sturenUit({ stand: 'raar' })).toBeNull();
    expect(sturenUit(null)).toBeNull();
  });
  it('de instelling: zonder is uit; lokaal wijzigen zoals de functie', () => {
    expect(instellingUit(undefined)).toEqual({ aan: false, nietOp: [], vrijOp: null, netto: 'afnemer' });
    const r = wijzigLokaal(wijzigLokaal({}, { aan: true }), { dag: '2026-11-01', niet: true });
    expect(instellingUit(r)).toMatchObject({ aan: true, nietOp: ['2026-11-01'] });
    expect(wijzigLokaal(r, { nu_aan: true }, NU).vrij_op).toBe('2026-10-31T10:00:00.000Z');
  });
});

describe('programmaatje 1.6.0: de zelfcontrole en de live regel', () => {
  const NIEUW = { ...RUW, grens_w: 1600, oorspronkelijk: { grens_pct: 2, schakelaar: false, op: '2026-10-31T08:00:00.000Z' } };

  it('nog niet nagekeken, bezig, nagekeken: werkt, en werkt niet', () => {
    expect(controleZin(sturenUit(NIEUW))).toMatch(/^Nog niet nagekeken/);
    expect(controleZin(sturenUit({ ...NIEUW, controle: { uitkomst: 'bezig', pct: 20, voor_w: 3100 } }))).toMatch(/^Bezig met nakijken/);
    expect(controleZin(sturenUit({ ...NIEUW, controle: { uitkomst: 'werkt', op: '2026-11-01T11:03:00.000Z', pct: 20, voor_w: 3100, na_w: 400, via: 'omvormer' } }))).toBe(
      'Nagekeken op 1 nov: van 3,1\u00a0kW naar 0,4\u00a0kW. Het werkt.',
    );
    expect(controleZin(sturenUit({ ...NIEUW, stand: 'vrij', controle: { uitkomst: 'werkt-niet', op: '2026-11-01T11:03:00.000Z', pct: 20, voor_w: 3100, na_w: 3050, reden: 'geen-effect' } }))).toMatch(
      /^Werkt niet op deze omvormer, uitgezet op 1 nov: hij bleef 3,1\u00a0kW leveren/,
    );
    // Een brug van 1.5.0 kijkt niet na: dan zegt de app er niets over.
    expect(controleZin(sturenUit(RUW))).toBeNull();
    expect(oorspronkelijkZin(sturenUit(NIEUW))).toMatch(/grens 2%, schakelaar van de grens uit/);
  });

  it('de live regel tijdens een blok: grens, wat hij levert, wat er naar het net gaat', () => {
    expect(liveRegel(sturenUit(NIEUW), { omvormerW: 1234, netW: -120 })).toBe('Grens nu 20% (~1,6\u00a0kW) · levert 1,2\u00a0kW · naar het net 0,1\u00a0kW');
    expect(liveRegel(sturenUit(NIEUW), { omvormerW: 1234, netW: 450 })).toMatch(/uit het net 0,5/);
    expect(liveRegel(sturenUit(RUW), {})).toBe('Grens nu 20%');
    expect(liveRegel(sturenUit({ ...NIEUW, stand: 'vrij' }), { omvormerW: 3000 })).toBeNull();
  });

  it('werkt niet: in de kaart oranje, en in Instellingen "Opnieuw proberen" (zet het nog eens aan)', async () => {
    const ruw = { ...NIEUW, stand: 'vrij', controle: { uitkomst: 'werkt-niet', op: '2026-11-01T11:03:00.000Z', pct: 20, voor_w: 3100, na_w: 3050, reden: 'geen-effect' } };
    expect(renderToStaticMarkup(<SturenKaart sturen={sturenUit(ruw)} instelling={instellingUit({ aan: true })} nu={NU} />)).toMatch(/text-let-op[^>]*>.*Werkt niet op deze omvormer, uitgezet/s);
    const onWijzig = vi.fn(async () => true);
    render(<OmvormerSturen instelling={instellingUit({ aan: true })} sturen={sturenUit(ruw)} nu={NU} onWijzig={onWijzig} />);
    fireEvent.click(screen.getByRole('button', { name: /Opnieuw proberen/ }));
    await waitFor(() => expect(onWijzig).toHaveBeenCalledWith({ aan: true }));
    expect(screen.getByText(/grens 2%, schakelaar van de grens uit/)).toBeTruthy();
  });

  it('Apparaten: de omvormerkaart met de live regel en de controle', () => {
    const stand = standUitRij({ moment: '2026-10-31T10:00:00Z', net_w: -150, omvormer: { stand: 'normaal', w: 1500, sturen: { ...NIEUW, controle: { uitkomst: 'werkt', op: '2026-10-31T09:48:00.000Z', voor_w: 3100, na_w: 1580 } } }, gekoppeld: [{ sleutel: 'goodwe', naam: 'Omvormer', rol: 'omvormer', manier: 'lokaal', ok: true }] });
    const t = tekst(<TabApparaten stand={stand} nu={NU} eigenaar />);
    expect(t).toMatch(/Grens nu 20% \(~1,6 kW\) · levert 1,5 kW · naar het net 0,2 kW/);
    expect(t).toMatch(/Nagekeken op 31 okt: van 3,1 kW naar 1,6 kW\. Het werkt\./);
  });
});

describe('SturenKaart en Instellingen › Omvormer', () => {
  it('de kaart: stand, plan en "Nu weer aan" voor de eigenaar', async () => {
    const onNuAan = vi.fn(async () => true);
    render(<SturenKaart sturen={sturenUit(RUW)} instelling={instellingUit({ aan: true })} nu={NU} onNuAan={onNuAan} />);
    expect(screen.getByText(/Begrensd tot ~1,5/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Nu weer aan/ }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/binnen een minuut vrij/));
    expect(onNuAan).toHaveBeenCalledTimes(1);
  });

  it('uit: één zin, geen knop', () => {
    const t = tekst(<SturenKaart sturen={sturenUit({ ...RUW, aan: false, stand: 'vrij' })} instelling={instellingUit({})} nu={NU} onNuAan={async () => true} />);
    expect(t).toMatch(/Begrenzen staat uit \(Instellingen › Omvormer\)/);
    expect(t).not.toMatch(/Nu weer aan/);
  });

  it('de schakelaar (standaard uit), per dag "niet", en de keuze over het jaar', async () => {
    const onWijzig = vi.fn(async () => true);
    const { rerender } = render(<OmvormerSturen instelling={instellingUit(undefined)} sturen={sturenUit(RUW)} nu={NU} onWijzig={onWijzig} />);
    const schakelaar = screen.getByRole('switch', { name: /Omvormer begrenzen als terugleveren geld kost/ });
    expect(schakelaar.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(schakelaar);
    await waitFor(() => expect(onWijzig).toHaveBeenCalledWith({ aan: true }));
    rerender(<OmvormerSturen instelling={instellingUit({ aan: true })} sturen={sturenUit(RUW)} nu={NU} onWijzig={onWijzig} />);
    fireEvent.click(screen.getByRole('switch', { name: /Morgen niet begrenzen/ }));
    await waitFor(() => expect(onWijzig).toHaveBeenCalledWith({ dag: '2026-11-01', niet: true }));
    fireEvent.click(screen.getByRole('radio', { name: 'Ik lever meer terug' }));
    await waitFor(() => expect(onWijzig).toHaveBeenCalledWith({ netto: 'terugleveraar' }));
    expect(screen.getByText(/node brug.mjs omvormer-test/)).toBeTruthy();
  });

  it('een oudere brug (geen sturen): zegt dat het vanaf 1.5.0 kan', () => {
    expect(tekst(<OmvormerSturen instelling={instellingUit({ aan: true })} sturen={null} nu={NU} onWijzig={async () => true} />)).toMatch(/vanaf versie 1\.5\.0/);
  });

  it('een fout van de functie komt in beeld', async () => {
    render(<OmvormerSturen instelling={instellingUit(undefined)} sturen={null} nu={NU} onWijzig={async () => 'Dat mag alleen de eigenaar.'} />);
    fireEvent.click(screen.getByRole('switch'));
    expect((await screen.findByRole('alert')).textContent).toBe('Dat mag alleen de eigenaar.');
  });

  it('Apparaten: een kijker ziet niets van het begrenzen', () => {
    const stand = standUitRij({ moment: '2026-10-31T10:00:00Z', omvormer: { stand: 'normaal', w: 1500, sturen: RUW }, gekoppeld: [{ sleutel: 'goodwe', naam: 'Omvormer', rol: 'omvormer', manier: 'lokaal', ok: true }] });
    expect(tekst(<TabApparaten stand={stand} nu={NU} eigenaar />)).toMatch(/Begrenzen bij negatieve prijs/);
    expect(tekst(<TabApparaten stand={stand} nu={NU} eigenaar={false} />)).not.toMatch(/Begrenzen bij negatieve prijs/);
  });
});

/** Zoals het programmaatje 1.5.0 het bij Dirk zou sturen: P1 zonder spanning, spa-meter driefase, zonnemeter eenfase. */
const DIRK = spanningUit({
  datum: '2026-07-31',
  herkomst: [
    { sleutel: 'L1', bron: 'meter', naam: 'Spa' },
    { sleutel: 'L2', bron: 'meter', naam: 'Spa' },
    { sleutel: 'L3', bron: 'meter', naam: 'Spa' },
    { sleutel: 'zon', bron: 'zon', naam: 'Zonnepanelen' },
  ],
  nu: [
    { sleutel: 'L1', v: 248.2 },
    { sleutel: 'L2', v: 246.9 },
    { sleutel: 'L3', v: 245.1 },
    { sleutel: 'zon', v: 251.4 },
  ],
  hoogste: [
    { sleutel: 'L1', v: 249 },
    { sleutel: 'L2', v: 247 },
    { sleutel: 'L3', v: 246 },
    { sleutel: 'zon', v: 254.2 },
  ],
  verschil: [{ sleutel: 'L1', v: 3.6 }],
  uitval_vandaag: 1,
  boven_250_vandaag: 3,
  boven_250_uitgevallen: 1,
  uitval_maand: 2,
  lijst: [{ op: '2026-07-31T11:42:00Z', sleutel: 'zon', v: 254.2, gem: 252.1 }],
});

describe('de spanningswacht in de app', () => {
  it('bij Dirk: alle drie de fasen van de spa-meter, de zonnemeter apart, met de bron in gewone woorden', () => {
    const t = tekst(<Spanning spanning={DIRK} eigenaar />);
    expect(t).toMatch(/L1 248 V L2 247 V L3 245 V zonnepanelen 251 V/);
    expect(t).toMatch(/Hoogste vandaag: L1 249 V · L2 247 V · L3 246 V · zonnepanelen 254 V/);
    expect(t).toMatch(/Vandaag 3 keer boven 250 V, waarvan 1 keer uitgevallen\./);
    expect(t).toMatch(/L1, L2 en L3 gemeten door de spa-meter; zonnepanelen gemeten door de zonnepanelen-meter/);
    expect(t).toMatch(/Op welke fase zitten de zonnepanelen\? Kies het bij Instellingen › Namen/);
    expect(t).toMatch(/Lijst voor de netbeheerder \(1\)/);
  });

  it('met de fase van de zonnepanelen (Namen): het verschil tussen de twee meters', () => {
    expect(tekst(<Spanning spanning={DIRK} zonFase={1} eigenaar />)).toMatch(/Zonnemeter 251 V, spa-meter 248 V op L1: 3 V verschil; vandaag hooguit 4 V\./);
  });

  it('zoals het echt is bij Dirk (1.6.0): twee driefase meters; per fase het verschil met de spa-meter, geen keuze bij Namen', () => {
    const drie = spanningUit({
      datum: '2026-07-31',
      herkomst: [1, 2, 3].map((f) => ({ sleutel: `L${f}`, bron: 'zon', naam: 'Zonnepanelen' })),
      nu: [
        { sleutel: 'L1', v: 252.4 },
        { sleutel: 'L2', v: 249 },
        { sleutel: 'L3', v: 247.2 },
      ],
      hoogste: [{ sleutel: 'L1', v: 254 }],
      verschil: [
        { sleutel: 'L1', v: 6.4 },
        { sleutel: 'L2', v: 2.1 },
        { sleutel: 'L3', v: -0.6 },
      ],
      verschil_met: 'Spa',
      lijst: [],
    });
    expect(zonmeterEenfase(drie)).toBe(false);
    expect(zonmeterEenfase(DIRK)).toBe(true);
    const t = tekst(<Spanning spanning={drie} zonFase={1} eigenaar />);
    expect(t).toMatch(/L1 252 V L2 249 V L3 247 V/);
    expect(t).toMatch(/Verschil zonnemeter en spa-meter per fase, vandaag het grootst: L1 6 V · L2 2 V · L3 1 V\./);
    expect(t).toMatch(/L1, L2 en L3 gemeten door de zonnepanelen-meter/);
    expect(t).not.toMatch(/Op welke fase zitten de zonnepanelen/);
    // Een eenfase zonmeter blijft werken zoals het was.
    expect(tekst(<Spanning spanning={DIRK} zonFase={1} eigenaar />)).toMatch(/Zonnemeter 251 V, spa-meter 248 V op L1: 3 V verschil/);
  });

  it('boven 250 V in de let-op-kleur', () => {
    expect(renderToStaticMarkup(<Spanning spanning={DIRK} />)).toMatch(/text-let-op">zonnepanelen 254/);
  });

  it('geen enkele bron: één korte zin', () => {
    expect(tekst(<Spanning spanning={spanningUit({ datum: '2026-07-31', herkomst: [], nu: [], hoogste: [], lijst: [] })} />)).toBe('Netspanning Deze meterkast geeft geen spanning door.');
    expect(tekst(<Spanning spanning={null} />)).toBe('');
  });

  it('Belasting per fase: de P1 geeft geen spanning, dan die van de spa-meter, met de bron', () => {
    const fasen = [
      { fase: 1, a: 3, w: 600, v: null },
      { fase: 2, a: 1, w: 200, v: null },
      { fase: 3, a: 2, w: 400, v: null },
    ];
    expect(faseSpanning(DIRK, 2).v).toBe(246.9);
    const t = tekst(<FasenNu fasen={fasen} spanning={DIRK} />);
    expect(t).toMatch(/248/);
    expect(t).toMatch(/247/);
    expect(t).toMatch(/245/);
    expect(t).toMatch(/Spanning gemeten door de spa-meter\./);
  });
});
