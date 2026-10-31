import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { huizenUit, kernRegels, STIL_NA_MS } from '@/lib/alleHuizen';
import Account from './Account';

const tekst = (el) =>
  renderToStaticMarkup(el)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|\s/g, ' ')
    .replace(/ +/g, ' ')
    .trim();
const gewoon = (t) => t.replace(/\u00a0/g, ' ');
// Op de klok van dit toestel, zodat de test in elke tijdzone hetzelfde zegt.
const NU = new Date(2026, 9, 30, 18, 10).getTime();
const om = (u, m) => new Date(2026, 9, 30, u, m).toISOString();

const ANTWOORD = {
  huizen: [
    {
      id: 'huis-dirk001',
      naam: 'Bij Dirk',
      eigenaar_email: 'tim@voorbeeld.nl',
      meting: { moment: om(18, 2), zon_w: null, batterij_w: 640, batterij_procent: 40, net_w: 412, brug_versie: '0.6.1', storingen: [{ wat: 'P1-meter antwoordt niet' }, { wat: 'Omvormer: storingscode 13' }] },
    },
    { id: 'huis-leeg01', naam: 'Nieuw', eigenaar_email: 'tim@voorbeeld.nl', meting: null },
    {
      id: 'huis-tim01',
      naam: 'Thuis',
      eigenaar_email: 'tim@voorbeeld.nl',
      meting: { moment: om(18, 9), zon_w: 1134, batterij_w: -627, batterij_procent: 57, net_w: -49, brug_versie: '0.7.0', storingen: [] },
    },
  ],
};

describe('alle huizen in het kort', () => {
  it('de kern van nu, hoe oud, de brug, en een open storing', () => {
    const perHuis = huizenUit(ANTWOORD);
    const thuis = kernRegels(perHuis.get('huis-tim01'), NU);
    expect(gewoon(thuis.kern)).toBe('Zon 1,1 kW · Batterij 57% · Net 49 W terug · Huis 458 W');
    expect(thuis.staat).toEqual({ tekst: 'Bijgewerkt 18:09 · brug 0.7.0', letOp: false });
    expect(thuis.storing).toBeNull();

    const dirk = kernRegels(perHuis.get('huis-dirk001'), NU);
    expect(gewoon(dirk.kern)).toBe('Batterij 40% · Net 412 W uit · Huis 1,1 kW');
    // Ouder dan vijf minuten: in let-op.
    expect(dirk.staat).toEqual({ tekst: 'Geen cijfers sinds 18:02 · brug 0.6.1', letOp: true });
    expect(dirk.storing).toBe('P1-meter antwoordt niet (en nog 1)');

    expect(kernRegels(perHuis.get('huis-leeg01'), NU)).toEqual({ kern: '', staat: { tekst: 'Nog geen cijfers van thuis', letOp: true }, storing: null });
    expect(kernRegels(perHuis.get('huis-tim01'), Date.parse(om(18, 9)) + STIL_NA_MS).staat.letOp).toBe(true);
    // Een oudere functie kent de vraag niet: niets, en geen fout.
    expect(huizenUit(undefined).size).toBe(0);
  });

  it('de beheerder: in Account onder elk huis de cijfers; wat aandacht vraagt in let-op', () => {
    const gebruiker = { email: 'tim@voorbeeld.nl', beheerder: true };
    const huizen = ANTWOORD.huizen.map(({ id, naam, eigenaar_email }) => ({ id, naam, eigenaar_email, rol: 'eigenaar' }));
    const el = (
      <Account gebruiker={gebruiker} huizen={huizen} huisId="huis-tim01" overzicht={{ perHuis: huizenUit(ANTWOORD), status: 'klaar' }} nu={NU} onKies={() => {}} />
    );
    const t = gewoon(tekst(el));
    expect(t).toContain('Alle huizen');
    expect(t).toContain('Bij Dirk Van jou Batterij 40% · Net 412 W uit · Huis 1,1 kW Geen cijfers sinds 18:02 · brug 0.6.1 P1-meter antwoordt niet (en nog 1)');
    expect(t).toContain('Thuis Van jou Zon 1,1 kW · Batterij 57% · Net 49 W terug · Huis 458 W Bijgewerkt 18:09 · brug 0.7.0');
    expect(t).toContain('Nieuw Van jou Nog geen cijfers van thuis');
    // Dirk: oud en een storing; Nieuw: nog niets. Thuis is rustig.
    expect(renderToStaticMarkup(el).split('text-let-op').length - 1).toBe(3);
  });

  it('een gewone gebruiker krijgt geen overzicht, ook als het er per ongeluk zou zijn', () => {
    const gebruiker = { email: 'dirk@voorbeeld.nl', beheerder: false };
    const huizen = [{ id: 'huis-dirk001', naam: 'Bij Dirk', eigenaar_email: 'tim@voorbeeld.nl', rol: 'kijker' }];
    const t = tekst(<Account gebruiker={gebruiker} huizen={huizen} huisId="huis-dirk001" overzicht={{ perHuis: huizenUit(ANTWOORD), status: 'klaar' }} nu={NU} />);
    expect(t).toContain('Je huis');
    expect(t).not.toContain('Alle huizen');
    expect(t).not.toContain('Batterij 40%');
  });
});

describe('wat de apparaten kunnen geven (programmaatje 1.4.0, alleen de beheerder)', () => {
  const MET_KENNIS = {
    huizen: [
      {
        ...ANTWOORD.huizen[2],
        meting: {
          ...ANTWOORD.huizen[2].meting,
          kennis: { op: om(1, 5), apparaten: [{ sleutel: 'hw-meterkast', soort: 'HomeWizard P1-meter (v1)', datum: '2026-10-30', velden: ['active_tariff=2', 'total_gas_m3=2569.646', 'unique_id', 7] }, { sleutel: 'leeg', velden: [] }] },
        },
      },
    ],
  };

  it('kennisUit: alleen tekst, lege lijsten weg; zonder (een oudere brug of functie) null', () => {
    const kennis = huizenUit(MET_KENNIS).get('huis-tim01').kennis;
    expect(kennis).toEqual({ op: Date.parse(om(1, 5)), apparaten: [{ sleutel: 'hw-meterkast', soort: 'HomeWizard P1-meter (v1)', datum: '2026-10-30', velden: ['active_tariff=2', 'total_gas_m3=2569.646', 'unique_id'] }] });
    expect(huizenUit(ANTWOORD).get('huis-tim01').kennis).toBeNull();
  });

  it('de beheerder ziet per huis een blok dat dicht staat; een gewone gebruiker niet', () => {
    const huizen = [{ id: 'huis-tim01', naam: 'Thuis', rol: 'eigenaar' }];
    const beheerder = tekst(<Account gebruiker={{ email: 'tim@voorbeeld.nl', beheerder: true }} huizen={huizen} huisId="huis-tim01" overzicht={{ perHuis: huizenUit(MET_KENNIS), status: 'klaar' }} nu={NU} onKies={() => {}} />);
    expect(beheerder).toMatch(/Wat de apparaten kunnen geven/);
    expect(beheerder).toMatch(/HomeWizard P1-meter \(v1\) · 3 velden · 2026-10-30/);
    expect(beheerder).toMatch(/active_tariff=2 · total_gas_m3=2569.646 · unique_id/);
    const gewone = tekst(<Account gebruiker={{ email: 'dirk@voorbeeld.nl' }} huizen={huizen} huisId="huis-tim01" overzicht={{ perHuis: huizenUit(MET_KENNIS), status: 'klaar' }} nu={NU} />);
    expect(gewone).not.toMatch(/Wat de apparaten kunnen geven|active_tariff/);
  });
});
