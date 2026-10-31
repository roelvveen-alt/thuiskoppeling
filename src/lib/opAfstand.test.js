/**
 * Op afstand instellen: versleutelen in de browser (Web Crypto, hier die van
 * Node) en ontsleutelen thuis (brug/opAfstand.mjs, node:crypto). Ook dat de
 * drie kanten (browser, server, programmaatje) dezelfde vingerafdruk rekenen.
 */
import { describe, expect, it } from 'vitest';
import { maakSleutelpaar, ontsleutel, vingerafdruk as vingerafdrukThuis } from '../../brug/opAfstand.mjs';
import { pakketUit, vingerafdrukVan } from '../../base44/shared/opAfstand.js';
import { cloudsleutelFout, kortAfdruk, paarVan, publiekVorm, staatVan, versleutel, vingerafdruk } from './opAfstand';

const PAAR = maakSleutelpaar();
const ANDER = maakSleutelpaar();
/** Zoals een Autorisatiecloudsleutel uit de Zendure-app eruitziet: base64 van "<adres>.<appKey>" (verzonnen). */
const CLOUDSLEUTEL = btoa('https://app.zendure.tech/eu.Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op56');

describe('versleutelen in de browser, ontsleutelen thuis', () => {
  it('heen en terug, en de server vindt de vorm goed zonder de inhoud te kunnen lezen', async () => {
    expect(publiekVorm(PAAR.publiek)).toBe(true);
    const pakket = await versleutel(PAAR.publiek, 'zendure.cloudsleutel', CLOUDSLEUTEL);
    expect(pakketUit(pakket)).toEqual(pakket);
    // Nergens de sleutel zelf, ook niet stukjes ervan.
    expect(JSON.stringify(pakket)).not.toContain(CLOUDSLEUTEL.slice(0, 12));
    expect(ontsleutel({ veld: 'zendure.cloudsleutel', ...pakket }, PAAR.prive)).toBe(CLOUDSLEUTEL);
  });

  it('elke keer anders (nieuwe AES-sleutel en iv), ook voor dezelfde waarde', async () => {
    const a = await versleutel(PAAR.publiek, 'zendure.cloudsleutel', CLOUDSLEUTEL);
    const b = await versleutel(PAAR.publiek, 'zendure.cloudsleutel', CLOUDSLEUTEL);
    expect(a.data).not.toBe(b.data);
    expect(a.sleutel).not.toBe(b.sleutel);
    expect(a.voor).toBe(b.voor);
  });

  it('een ander sleutelpaar, een veranderd stuk of een ander veld: niet te openen', async () => {
    const pakket = { veld: 'zendure.cloudsleutel', ...(await versleutel(PAAR.publiek, 'zendure.cloudsleutel', CLOUDSLEUTEL)) };
    expect(() => ontsleutel(pakket, ANDER.prive)).toThrow();
    const data = Buffer.from(pakket.data, 'base64');
    data[3] ^= 1;
    expect(() => ontsleutel({ ...pakket, data: data.toString('base64') }, PAAR.prive)).toThrow();
    // Het veld zit in de controle: hetzelfde stuk onder een andere naam gaat niet open.
    expect(() => ontsleutel({ ...pakket, veld: 'iets.anders' }, PAAR.prive)).toThrow();
  });

  it('browser, server en programmaatje rekenen dezelfde vingerafdruk', async () => {
    const browser = await vingerafdruk(PAAR.publiek);
    expect(browser).toMatch(/^[0-9a-f]{32}$/);
    expect(await vingerafdrukVan(PAAR.publiek)).toBe(browser);
    expect(vingerafdrukThuis(PAAR.publiek)).toBe(browser);
    expect(await vingerafdruk(ANDER.publiek)).not.toBe(browser);
  });
});

describe('de cloudsleutel nakijken voordat hij weggaat', () => {
  it('zoals leesCloudsleutel thuis: base64 van adres en appKey', () => {
    expect(cloudsleutelFout(CLOUDSLEUTEL)).toBeNull();
    expect(cloudsleutelFout(` ${CLOUDSLEUTEL}\n`)).toBeNull();
    expect(cloudsleutelFout('')).toMatch(/Plak/);
    for (const fout of ['hallo', btoa('geen adres.abc'), btoa('https://app.zendure.tech/eu.met spatie'), '%%%%%%%%%%%%%%%%%%']) expect(cloudsleutelFout(fout)).toMatch(/geen Autorisatiecloudsleutel/);
  });
});

describe('hoe het ervoor staat (staatVan)', () => {
  const klaar = { veld: 'zendure.cloudsleutel', op: '2026-10-30T15:00:00.000Z', voor: 'a'.repeat(32) };
  it('wacht, overgenomen, mislukt, of voor een ander sleutelpaar', () => {
    expect(staatVan(undefined, null, null)).toEqual({ soort: 'geen' });
    expect(staatVan(klaar, { opAfstand: [] }, 'a'.repeat(32)).soort).toBe('wacht');
    // Een oudere melding (van een eerder stuk) telt niet.
    expect(staatVan(klaar, { opAfstand: [{ veld: klaar.veld, op: '2026-10-29T10:00:00.000Z', ok: true }] }, 'a'.repeat(32)).soort).toBe('wacht');
    expect(staatVan(klaar, { opAfstand: [{ veld: klaar.veld, op: klaar.op, ok: true }] }, 'a'.repeat(32)).soort).toBe('overgenomen');
    expect(staatVan(klaar, { opAfstand: [{ veld: klaar.veld, op: klaar.op, ok: false, fout: 'geen-zendure' }] }, 'a'.repeat(32))).toMatchObject({ soort: 'mislukt', fout: 'geen-zendure' });
    expect(staatVan(klaar, { opAfstand: [] }, 'b'.repeat(32)).soort).toBe('anderPaar');
  });
});

describe('het sleutelpaar tegenover het vertrouwde (paarVan, kortAfdruk; ronde 19)', () => {
  it('onbekend, eerste, zelfde of ander', () => {
    const a = 'a'.repeat(32);
    const b = 'b'.repeat(32);
    expect(paarVan(null, a)).toBe('onbekend');
    // Nog niets vastgezet, of een oudere functie die publiek_vast niet meestuurt.
    expect(paarVan(a, null)).toBe('eerste');
    expect(paarVan(a, undefined)).toBe('eerste');
    expect(paarVan(a, a)).toBe('zelfde');
    expect(paarVan(a, b)).toBe('ander');
  });

  it('de korte vingerafdruk: vier groepjes van vier, zoals de server (base44/shared/opAfstand.js)', () => {
    expect(kortAfdruk('0123456789abcdef0123456789abcdef')).toBe('0123 4567 89ab cdef');
    expect(kortAfdruk('nee')).toBeNull();
    expect(kortAfdruk(null)).toBeNull();
  });
});

