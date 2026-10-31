// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extraData, kortAfdruk, vingerafdruk } from '@/lib/opAfstand';
import OpAfstand from './OpAfstand';

/**
 * Een sleutelpaar zoals het programmaatje het maakt (RSA-OAEP 2048), hier met Web Crypto; het ontsleutelen
 * met node:crypto zelf staat in src/lib/opAfstand.test.js en brug/opAfstand.test.js.
 */
const { subtle } = globalThis.crypto;
async function maakSleutelpaar() {
  const paar = await subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt']);
  const spki = new Uint8Array(await subtle.exportKey('spki', paar.publicKey));
  return { publiek: btoa(String.fromCharCode(...spki)), prive: paar.privateKey };
}
const uit64 = (t) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
async function ontsleutel(pakket, prive) {
  const ruw = await subtle.decrypt({ name: 'RSA-OAEP' }, prive, uit64(pakket.sleutel));
  const aes = await subtle.importKey('raw', ruw, 'AES-GCM', false, ['decrypt']);
  const tekst = await subtle.decrypt({ name: 'AES-GCM', iv: uit64(pakket.iv), additionalData: extraData(pakket.veld) }, aes, uit64(pakket.data));
  return JSON.parse(new TextDecoder().decode(tekst)).waarde;
}

const PAAR = await maakSleutelpaar();
const ANDER = await maakSleutelpaar();
const CLOUDSLEUTEL = btoa('https://app.zendure.tech/eu.Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op56');
const BRUG = { versie: '0.7.0', publiek: PAAR.publiek, opAfstand: [] };
const HUIS = { id: 'huis-dirk001', naam: 'Bij Dirk', rol: 'eigenaar', leden: [] };

afterEach(cleanup);

describe('Op afstand instellen', () => {
  it('versleutelt in de browser: naar de functie gaat alleen het stuk, en het veld is daarna leeg', async () => {
    const onZet = vi.fn(async () => {});
    render(<OpAfstand huis={HUIS} brug={BRUG} onZet={onZet} onWis={vi.fn()} />);
    const veld = screen.getByLabelText('Zendure-cloudsleutel');
    expect(veld.getAttribute('type')).toBe('password');
    fireEvent.change(veld, { target: { value: `  ${CLOUDSLEUTEL}\n` } });
    fireEvent.click(screen.getByRole('button', { name: /Versleuteld klaarzetten/ }));
    await waitFor(() => expect(onZet).toHaveBeenCalledTimes(1));
    const [veldNaam, pakket] = onZet.mock.calls[0];
    expect(veldNaam).toBe('zendure.cloudsleutel');
    expect(JSON.stringify(pakket)).not.toContain(CLOUDSLEUTEL.slice(0, 12));
    // Alleen het programmaatje met het privé-deel krijgt hem weer open.
    expect(await ontsleutel({ veld: 'zendure.cloudsleutel', ...pakket }, PAAR.prive)).toBe(CLOUDSLEUTEL);
    expect(await screen.findByText(/Versleuteld klaargezet/)).toBeTruthy();
    expect(screen.getByLabelText('Zendure-cloudsleutel').value).toBe('');
  });

  it('een sleutel die er niet uitziet als een cloudsleutel gaat niet weg', async () => {
    const onZet = vi.fn();
    render(<OpAfstand huis={HUIS} brug={BRUG} onZet={onZet} onWis={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Zendure-cloudsleutel'), { target: { value: 'dit is hem niet' } });
    fireEvent.click(screen.getByRole('button', { name: /Versleuteld klaarzetten/ }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/geen Autorisatiecloudsleutel/);
    expect(onZet).not.toHaveBeenCalled();
  });

  it('daarna alleen "ingesteld op", met hoe het ervoor staat; nooit de sleutel; wissen vraagt eerst', async () => {
    const voor = await vingerafdruk(PAAR.publiek);
    const klaar = { veld: 'zendure.cloudsleutel', op: '2026-10-30T15:05:00.000Z', voor };
    const onWis = vi.fn(async () => {});
    const { rerender } = render(<OpAfstand huis={{ ...HUIS, op_afstand: [klaar] }} brug={BRUG} onZet={vi.fn()} onWis={onWis} />);
    expect(screen.getByText(/Ingesteld op 30 oktober om \d{2}:05/)).toBeTruthy();
    expect(screen.getByText(/haalt hem binnen een paar minuten op/)).toBeTruthy();
    rerender(<OpAfstand huis={{ ...HUIS, op_afstand: [klaar] }} brug={{ ...BRUG, opAfstand: [{ veld: klaar.veld, op: klaar.op, ok: true }] }} onZet={vi.fn()} onWis={onWis} />);
    expect(screen.getByText(/heeft hem overgenomen/)).toBeTruthy();
    rerender(<OpAfstand huis={{ ...HUIS, op_afstand: [klaar] }} brug={{ ...BRUG, opAfstand: [{ veld: klaar.veld, op: klaar.op, ok: false, fout: 'geen-zendure' }] }} onZet={vi.fn()} onWis={onWis} />);
    expect(screen.getByText(/geen Zendure in de instellingen/)).toBeTruthy();
    // Een ander sleutelpaar dan waarvoor hij klaarstaat: niet meteen "opnieuw invullen", eerst vergelijken (ronde 19).
    rerender(<OpAfstand huis={{ ...HUIS, op_afstand: [klaar], publiek_vast: voor }} brug={{ ...BRUG, publiek: ANDER.publiek }} onZet={vi.fn()} onWis={onWis} />);
    expect(await screen.findByText(/meldt nu een ander sleutelpaar/)).toBeTruthy();
    expect(screen.queryByText(/Vul hem opnieuw in/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Wissen' }));
    expect(onWis).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Ja, wissen/ }));
    await waitFor(() => expect(onWis).toHaveBeenCalledWith('zendure.cloudsleutel'));
  });

  it('de vingerafdruk staat erbij, om te vergelijken met node brug.mjs proef', async () => {
    const voor = await vingerafdruk(PAAR.publiek);
    render(<OpAfstand huis={HUIS} brug={BRUG} onZet={vi.fn()} onWis={vi.fn()} />);
    expect((await screen.findByText(kortAfdruk(voor))).textContent).toMatch(/^[0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{4}$/);
    expect(screen.getByText(/vergelijk ze één keer/)).toBeTruthy();
    cleanup();
    render(<OpAfstand huis={{ ...HUIS, publiek_vast: voor }} brug={BRUG} onZet={vi.fn()} onWis={vi.fn()} />);
    expect(await screen.findByText(kortAfdruk(voor))).toBeTruthy();
    expect(screen.queryByText(/vergelijk ze één keer/)).toBeNull();
  });

  it('een ander sleutelpaar dan het vertrouwde: eerst een waarschuwing en bevestigen, dan pas invullen (met de bevestiging erbij)', async () => {
    const vast = await vingerafdruk(PAAR.publiek);
    const nieuw = await vingerafdruk(ANDER.publiek);
    const onZet = vi.fn(async () => {});
    render(<OpAfstand huis={{ ...HUIS, publiek_vast: vast }} brug={{ ...BRUG, publiek: ANDER.publiek }} onZet={onZet} onWis={vi.fn()} />);
    const waarschuwing = await screen.findByRole('alert');
    expect(waarschuwing.textContent).toContain('Er meldt zich een ander sleutelpaar dan eerst');
    expect(waarschuwing.textContent).toContain(kortAfdruk(vast));
    expect(waarschuwing.textContent).toContain(kortAfdruk(nieuw));
    expect(waarschuwing.textContent).toMatch(/nieuwe sleutel/);
    expect(screen.queryByLabelText('Zendure-cloudsleutel')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Klopt, dit is mijn programmaatje/ }));
    fireEvent.change(screen.getByLabelText('Zendure-cloudsleutel'), { target: { value: CLOUDSLEUTEL } });
    fireEvent.click(screen.getByRole('button', { name: /Versleuteld klaarzetten/ }));
    await waitFor(() => expect(onZet).toHaveBeenCalledTimes(1));
    const [, pakket, nieuwPaar] = onZet.mock.calls[0];
    expect(pakket.voor).toBe(nieuw);
    expect(nieuwPaar).toBe(nieuw);
    expect(await ontsleutel({ veld: 'zendure.cloudsleutel', ...pakket }, ANDER.prive)).toBe(CLOUDSLEUTEL);
  });

  it('het vertrouwde paar: geen bevestiging mee', async () => {
    const vast = await vingerafdruk(PAAR.publiek);
    const onZet = vi.fn(async () => {});
    render(<OpAfstand huis={{ ...HUIS, publiek_vast: vast }} brug={BRUG} onZet={onZet} onWis={vi.fn()} />);
    await screen.findByText(kortAfdruk(vast));
    fireEvent.change(screen.getByLabelText('Zendure-cloudsleutel'), { target: { value: CLOUDSLEUTEL } });
    fireEvent.click(screen.getByRole('button', { name: /Versleuteld klaarzetten/ }));
    await waitFor(() => expect(onZet).toHaveBeenCalledTimes(1));
    expect(onZet.mock.calls[0][2]).toBeNull();
  });

  it('een oudere brug (geen publiek deel): eerst bijwerken, geen invulveld', () => {
    render(<OpAfstand huis={HUIS} brug={{ versie: '0.6.2+5ecccfb', publiek: null, opAfstand: [] }} onZet={vi.fn()} onWis={vi.fn()} />);
    expect(screen.getByText(/Werk het programmaatje eerst bij naar 0\.7\.0 of nieuwer \(nu 0\.6\.2\)/)).toBeTruthy();
    expect(screen.queryByLabelText('Zendure-cloudsleutel')).toBeNull();
    cleanup();
    render(<OpAfstand huis={HUIS} brug={null} onZet={vi.fn()} onWis={vi.fn()} />);
    expect(screen.getByText(/nog geen meting van het programmaatje/)).toBeTruthy();
  });

  it('in het voorbeeld alleen uitleg', () => {
    render(<OpAfstand voorbeeld huis={null} brug={null} onZet={vi.fn()} onWis={vi.fn()} />);
    expect(screen.getByText(/In de echte app vul je hier de Zendure-cloudsleutel/)).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
