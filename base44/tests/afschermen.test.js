/**
 * Kijkers zien geen adressen en serienummers (ronde 19, B6): niet in
 * gekoppeld, niet in de meldingen van het programmaatje, niet in het logboek.
 * De eigenaar ziet alles zoals het binnenkwam.
 */
import { describe, expect, it } from 'vitest';
import { metingVoorKijker, zonderAdressen } from '../shared/afschermen.js';
import { behandelHuis } from '../shared/huizen.js';
import { nepBase44, verzoek, zonderWachten } from './nep.js';

describe('zonderAdressen', () => {
  it('haalt IPv4, IPv6, hostnamen, MAC-adressen en serienummers weg', () => {
    const gevallen = {
      'P1-meter: geen antwoord van 192.168.1.20:80': 'P1-meter: geen antwoord van het adres',
      'Maak een code met: node brug.mjs homewizard-code p1meter-3c39e7.fritz.box': 'Maak een code met: node brug.mjs homewizard-code het adres',
      'node brug.mjs homewizard-code p1meter-3c39e7': 'node brug.mjs homewizard-code het adres',
      'Zendure op fe80::1 antwoordt niet': 'Zendure op het adres antwoordt niet',
      'via [fe80::1c2d%wlan0]:8080 en 2001:db8:85a3:0:0:8a2e:370:7334.': 'via het adres en het adres.',
      'op dit adres zit nu een andere HomeWizard (3c39e7aabbcc)': 'op dit adres zit nu een andere HomeWizard (het serienummer)',
      'apparaat 3C:39:E7:AA:BB:CC of 3c-39-e7-aa-bb-cc': 'apparaat het serienummer of het serienummer',
      'omvormer 5010KDTA000X en batterij FO4NXXXX1234567': 'omvormer het serienummer en batterij het serienummer',
      'Zendure-batterij: homewizard.local en router.lan.': 'Zendure-batterij: het adres en het adres.',
      'Prijzen: api.energyzero.com antwoordt niet': 'Prijzen: het adres antwoordt niet',
    };
    for (const [in_, uit] of Object.entries(gevallen)) expect(zonderAdressen(in_), in_).toBe(uit);
  });

  it('laat gewone tekst staan: opdrachten, bestanden, tijden, versies, getallen en merken', () => {
    for (const tekst of [
      'Log opnieuw in bij Zonneplan: node brug.mjs zonneplan-login',
      'Kijk in brug.log en instellingen.json (zie docs/bij-dirk.md); start.sh opnieuw',
      'sinds 12:30:45 geen antwoord',
      'brug 0.12.0+5ecccfb, elke 5 s',
      'het huis gebruikt 1.134 W, 3.5 kWh vandaag',
      'SolarFlow 2400 AC, HWE-P1, Hyper 2000, hw-zon-huis, zendure-p1',
      'Opslag bijna vol (93%)',
    ]) {
      expect(zonderAdressen(tekst), tekst).toBe(tekst);
    }
    expect(zonderAdressen(null)).toBeNull();
    expect(zonderAdressen('')).toBe('');
  });

  it('metingVoorKijker: gekoppeld zonder adres, meldingen schoon, de meting zelf niet veranderd', () => {
    const meting = {
      net_w: 5,
      gekoppeld: [{ sleutel: 'hw-p1', naam: 'P1 3c39e7aabbcc', adres: 'p1meter-3c39e7.local', ok: false }, null],
      brug: { versie: '0.12.0', meldingen: [{ soort: 'apparaat', tekst: 'P1: geen antwoord van fe80::1', sinds: '2026-10-30T12:00:00Z' }, 'raar'] },
    };
    const kopie = structuredClone(meting);
    expect(metingVoorKijker(meting)).toEqual({
      net_w: 5,
      gekoppeld: [{ sleutel: 'hw-p1', naam: 'P1 het serienummer', ok: false }, null],
      brug: { versie: '0.12.0', meldingen: [{ soort: 'apparaat', tekst: 'P1: geen antwoord van het adres', sinds: '2026-10-30T12:00:00Z' }, 'raar'] },
    });
    expect(meting).toEqual(kopie);
    // Een oude meting zonder deze blokken (brug 0.3) blijft zoals hij is.
    expect(metingVoorKijker({ net_w: 1, bron: 'brug 0.3.0' })).toEqual({ net_w: 1, bron: 'brug 0.3.0' });
  });
});

describe('stand en logboek: de kijker krijgt het schoon, de eigenaar alles', () => {
  const TIM = { id: 'gebruiker-tim', email: 'tim@voorbeeld.nl', role: 'admin' };
  const DIRK = { id: 'gebruiker-dirk', email: 'dirk@voorbeeld.nl', role: 'user' };
  const HUIS = { id: 'huis-tim01', naam: 'Thuis', eigenaar_id: TIM.id, eigenaar_email: TIM.email, leden: [{ email: DIRK.email }], brug_sleutel_hash: 'a'.repeat(64) };
  const MELDING = 'P1-meter: geen antwoord; maak een code met: node brug.mjs homewizard-code p1meter-3c39e7.fritz.box';
  const rijen = () => ({
    Huis: [HUIS],
    Meting: [
      {
        id: 'meting-1',
        huis_id: HUIS.id,
        moment: '2026-10-30T12:00:00.000Z',
        net_w: 100,
        gekoppeld: [{ sleutel: 'hw-p1', naam: 'P1-meter', merk: 'HomeWizard', soort: 'P1-meter', rol: 'net', manier: 'v1', adres: '2001:db8::20', ok: false }],
        brug: { versie: '0.12.0', gestart: '2026-10-30T06:00:00Z', elke_seconden: 5, meldingen: [{ soort: 'apparaat', tekst: MELDING }] },
        storingen_open: [],
      },
    ],
    Gebeurtenis: [{ id: 'g-1', huis_id: HUIS.id, sleutel: 'melding:homewizard:p1', soort: 'melding', wat: 'HomeWizard (3c39e7aabbcc) op 192.168.1.20 weg', begin: '2026-10-30T11:00:00.000Z' }],
  });
  const vraag = async (gebruiker, lichaam) => {
    const nep = nepBase44({ gebruiker, rijen: rijen() });
    const res = await behandelHuis(verzoek(lichaam, { kop: { Authorization: 'Bearer t' } }), () => nep.client, { geduld: zonderWachten, geheugen: new Map() });
    return res.json();
  };

  it('stand', async () => {
    const kijker = (await vraag(DIRK, { actie: 'stand', huis_id: HUIS.id })).meting;
    expect(kijker.gekoppeld[0]).not.toHaveProperty('adres');
    expect(kijker.brug.meldingen[0].tekst).toBe('P1-meter: geen antwoord; maak een code met: node brug.mjs homewizard-code het adres');
    const eigenaar = (await vraag(TIM, { actie: 'stand', huis_id: HUIS.id })).meting;
    expect(eigenaar.gekoppeld[0].adres).toBe('2001:db8::20');
    expect(eigenaar.brug.meldingen[0].tekst).toBe(MELDING);
  });

  it('logboek', async () => {
    expect((await vraag(DIRK, { actie: 'logboek', huis_id: HUIS.id })).gebeurtenissen[0].wat).toBe('HomeWizard (het serienummer) op het adres weg');
    expect((await vraag(TIM, { actie: 'logboek', huis_id: HUIS.id })).gebeurtenissen[0].wat).toBe('HomeWizard (3c39e7aabbcc) op 192.168.1.20 weg');
  });
});
