import { describe, expect, it } from 'vitest';
import { tellersUit, tlsVoor, vermogenUit } from './homewizard.mjs';

describe('vermogenUit', () => {
  it('v1 en v2', () => {
    expect(vermogenUit({ active_power_w: -678 })).toBe(-678);
    expect(vermogenUit({ power_w: 400, power_l1_w: 200 })).toBe(400);
    expect(vermogenUit({ wifi_ssid: 'thuis' })).toBeNull();
    expect(vermogenUit(null)).toBeNull();
  });
});

describe('tellersUit', () => {
  it('v1 en v2, alle tarieven samen', () => {
    expect(tellersUit({ total_power_import_kwh: 13779.338, total_power_import_t1_kwh: 10830.511, total_power_export_kwh: 4.0 })).toEqual({
      afname_kwh: 13779.338,
      teruglevering_kwh: 4,
    });
    expect(tellersUit({ energy_import_kwh: 120.5, energy_export_kwh: 33.25 })).toEqual({ afname_kwh: 120.5, teruglevering_kwh: 33.25 });
    expect(tellersUit({})).toEqual({ afname_kwh: null, teruglevering_kwh: null });
  });
});

describe('certificaat van HomeWizard (v2)', () => {
  const controle = (serienummer, cn) => tlsVoor(serienummer).checkServerIdentity('192.168.1.20', { subject: { CN: cn } });

  it('naam van een HomeWizard-apparaat is goed', () => {
    expect(controle(undefined, 'appliance/p1dongle/5c2fafaabbcc')).toBeUndefined();
    expect(controle('5C2FAFAABBCC', 'appliance/p1dongle/5c2fafaabbcc')).toBeUndefined();
  });

  it('ander serienummer of andere naam is fout', () => {
    expect(controle('5c2fafaabbcd', 'appliance/p1dongle/5c2fafaabbcc')).toBeInstanceOf(Error);
    expect(controle(undefined, 'router.thuis')).toBeInstanceOf(Error);
    expect(controle(undefined, '')).toBeInstanceOf(Error);
  });

  it('bevat de CA van HomeWizard', () => {
    expect(tlsVoor().ca.toString()).toContain('-----BEGIN CERTIFICATE-----');
  });
});

describe('per fase', () => {
  it('v1 en v2, met teken op het vermogen en zonder teken op de stroom', async () => {
    const { fasenUit } = await import('./homewizard.mjs');
    const v1 = { active_power_l1_w: -1700, active_power_l2_w: 412, active_power_l3_w: 35, active_current_l1_a: 7.4, active_current_l2_a: 1.9, active_current_l3_a: 0.3, active_voltage_l1_v: 231.2, active_voltage_l2_v: 229.8, active_voltage_l3_v: 230.4 };
    expect(fasenUit(v1)).toEqual([
      { fase: 1, w: -1700, a: 7.4, v: 231.2 },
      { fase: 2, w: 412, a: 1.9, v: 229.8 },
      { fase: 3, w: 35, a: 0.3, v: 230.4 },
    ]);
    const v2 = { power_l1_w: 300, current_l1_a: -1.3, voltage_l1_v: 230 };
    expect(fasenUit(v2)).toEqual([{ fase: 1, w: 300, a: 1.3, v: 230 }]);
  });

  it('eenfase: alleen L1; zonder stroom rekent hij hem uit vermogen en spanning', async () => {
    const { fasenUit } = await import('./homewizard.mjs');
    expect(fasenUit({ active_power_l1_w: -460, active_voltage_l1_v: 230 })).toEqual([{ fase: 1, w: -460, a: 2, v: 230 }]);
    expect(fasenUit({ active_power_w: 300 })).toEqual([]);
  });
});

describe('v1: zit er op het adres nog dezelfde meter?', () => {
  const meter = { sleutel: 'hw-dak', adres: '192.168.1.22', serienummer: 'aabbccddeeff' };
  it('hetzelfde serienummer: goed; een ander: niet gebruiken, en dat even onthouden', async () => {
    const { zelfdeMeterV1, SERIENUMMER_ELKE_MS } = await import('./homewizard.mjs');
    const gezien = new Map();
    let serial = 'AABBCCDDEEFF';
    let keer = 0;
    const vraag = async () => {
      keer += 1;
      return { status: 200, json: { serial } };
    };
    await expect(zelfdeMeterV1(meter, { nu: 0, gezien, vraag })).resolves.toBeUndefined();
    serial = '112233445566';
    await expect(zelfdeMeterV1(meter, { nu: 1000, gezien, vraag })).resolves.toBeUndefined();
    expect(keer).toBe(1);
    // Zonder het serienummer in de melding: die gaat ook naar de app.
    const fout = await zelfdeMeterV1(meter, { nu: SERIENUMMER_ELKE_MS, gezien, vraag }).catch((f) => f);
    expect(fout.message).toMatch(/andere HomeWizard/);
    expect(fout.message).not.toContain('112233445566');
    expect(fout.code).toBe('ANDER_APPARAAT');
    await expect(zelfdeMeterV1(meter, { nu: SERIENUMMER_ELKE_MS + 1000, gezien, vraag })).rejects.toThrow(/andere HomeWizard/);
    expect(keer).toBe(2);
    // Zonder serienummer in de instellingen, of /api antwoordt niet: niet tegenhouden.
    await expect(zelfdeMeterV1({ ...meter, serienummer: undefined }, { gezien, vraag })).resolves.toBeUndefined();
    await expect(zelfdeMeterV1({ ...meter, sleutel: 'x' }, { gezien: new Map(), vraag: async () => { throw new Error('weg'); } })).resolves.toBeUndefined();
  });
});

describe('zwakkeControle', () => {
  it('v1 zonder code en v2 zonder serienummer krijgen een gewone zin met de opdracht; v2 met serienummer niet', async () => {
    const { zwakkeControle } = await import('./homewizard.mjs');
    expect(zwakkeControle({ naam: 'Meterkast', adres: '192.168.1.64' })).toBe(
      'Meterkast: zonder code (API v1) gaat het programmaatje alleen via /api na of op 192.168.1.64 nog dezelfde meter zit. Veiliger met een code: node brug.mjs homewizard-code 192.168.1.64',
    );
    expect(zwakkeControle({ naam: 'Zon', adres: '192.168.1.20', code: 'x' })).toMatch(/zonder serienummer.*node brug\.mjs instellen$/);
    expect(zwakkeControle({ naam: 'Zon', adres: '192.168.1.20', code: 'x', serienummer: '5c2fafabcdef' })).toBeNull();
  });
});

describe('storingen op het net (0.13.0): wat de P1-meter telt', () => {
  it('storingenUit: v1 en v2 dezelfde namen; een kWh-meter heeft ze niet', async () => {
    const { storingenUit } = await import('./homewizard.mjs');
    expect(storingenUit({ any_power_fail_count: 4, long_power_fail_count: 1, voltage_sag_l1_count: 2, voltage_sag_l2_count: 0, voltage_swell_l1_count: 0 })).toEqual({
      uitval: 4,
      lang: 1,
      dip: [2, 0, null],
      piek: [0, null, null],
    });
    expect(storingenUit({ active_power_w: 300 })).toBeNull();
  });

  it('een nep-P1 (v1): een dip op L2 en een korte onderbreking geven een regel en een kwartier een melding', async () => {
    const http = await import('node:http');
    const { leesHomeWizard, netStoringVolger } = await import('./homewizard.mjs');
    const tellers = { active_power_w: 120, any_power_fail_count: 3, long_power_fail_count: 1, voltage_sag_l1_count: 0, voltage_sag_l2_count: 5, voltage_sag_l3_count: 0, voltage_swell_l1_count: 0, voltage_swell_l2_count: 0, voltage_swell_l3_count: 0 };
    const server = http.createServer((_v, a) => {
      a.writeHead(200, { 'content-type': 'application/json' });
      a.end(JSON.stringify(tellers));
    });
    await new Promise((klaar) => server.listen(0, '127.0.0.1', klaar));
    const meter = { naam: 'Meterkast', rol: 'net', adres: `127.0.0.1:${server.address().port}` };
    try {
      const volger = netStoringVolger();
      const nu = Date.parse('2026-10-30T20:14:00Z');
      expect(volger.ronde((await leesHomeWizard(meter)).storingen, nu)).toEqual([]);
      tellers.voltage_sag_l2_count = 6;
      tellers.any_power_fail_count = 4;
      const zinnen = volger.ronde((await leesHomeWizard(meter)).storingen, nu + 5000, 'Meterkast');
      expect(zinnen).toEqual(['Meterkast: korte stroomonderbreking gemeten (21:14)', 'Meterkast: spanningsdip op L2 gemeten (21:14)']);
      expect(volger.meldingen(nu + 60_000).map((m) => m.tekst)).toEqual([...zinnen].reverse());
      expect(volger.meldingen(nu + 16 * 60_000)).toEqual([]);
      // Een lange onderbreking telt ook als onderbreking: dan alleen "lange".
      tellers.any_power_fail_count = 5;
      tellers.long_power_fail_count = 2;
      expect(volger.ronde((await leesHomeWizard(meter)).storingen, nu + 20 * 60_000)).toEqual(['Meterkast: lange stroomonderbreking gemeten (21:34)']);
      // Een nieuwe meter (tellers lager): geen melding, daar opnieuw beginnen.
      tellers.voltage_sag_l2_count = 0;
      expect(volger.ronde((await leesHomeWizard(meter)).storingen, nu + 21 * 60_000)).toEqual([]);
      tellers.voltage_sag_l2_count = 2;
      expect(volger.ronde((await leesHomeWizard(meter)).storingen, nu + 22 * 60_000)).toEqual(['Meterkast: spanningsdip op L2 (2 keer) gemeten (21:36)']);
    } finally {
      server.close();
    }
  });
});

describe('v1 met wat we van de meter weten (adressen.mjs, 1.3.0)', () => {
  it('leert het kenmerk bij de eerste lezing, gaat na bij elke nieuwe verbinding, en een andere meter telt niet', async () => {
    const { zelfdeMeterV1, SERIENUMMER_ELKE_MS } = await import('./homewizard.mjs');
    const { maakAdressen } = await import('./adressen.mjs');
    const instellingen = { homewizard: [{ sleutel: 'hw-dak', naam: 'Dak', adres: '192.168.1.22' }] };
    const adressen = maakAdressen({ instellingen });
    const plek = adressen.plek('hw-dak');
    const meter = instellingen.homewizard[0];
    const gezien = new Map();
    let serial = 'aabbccddeeff';
    let keer = 0;
    const vraag = async () => {
      keer += 1;
      return { status: 200, json: { serial } };
    };
    await zelfdeMeterV1(meter, { plek, nu: 0, gezien, vraag });
    // Over dezelfde verbinding: niet elke keer vragen.
    await zelfdeMeterV1(meter, { plek, nu: 5000, gezien, vraag });
    expect(keer).toBe(1);
    // Een nieuwe verbinding (de oude viel weg): opnieuw nagaan, want er kan een ander apparaat achter zitten.
    serial = '112233445566';
    const fout = await zelfdeMeterV1(meter, { plek, nieuw: true, nu: 10_000, gezien, vraag }).catch((f) => f);
    expect(keer).toBe(2);
    expect(fout.code).toBe('ANDER_APPARAAT');
    expect(fout.message).toBe('op dit adres zit nu een ander apparaat (HomeWizard); ik zoek Dak in het netwerk');
    // Onthouden, ook bij een nieuwe verbinding, tot het volgende kwartier of een ander adres.
    await expect(zelfdeMeterV1(meter, { plek, nieuw: true, nu: 15_000, gezien, vraag })).rejects.toThrow(/ik zoek Dak/);
    expect(keer).toBe(2);
    meter.adres = '192.168.1.40';
    serial = 'aabbccddeeff';
    await expect(zelfdeMeterV1(meter, { plek, nu: 20_000, gezien, vraag })).resolves.toBeUndefined();
    expect(keer).toBe(3);
    expect(SERIENUMMER_ELKE_MS).toBeLessThanOrEqual(15 * 60_000);
  });

  it('een echte meter (v1, over een blijvende verbinding): dezelfde verbinding, en een andere meter op hetzelfde adres valt op', async () => {
    const http = await import('node:http');
    const { leesHomeWizard } = await import('./homewizard.mjs');
    const { maakAdressen } = await import('./adressen.mjs');
    let serial = 'aabbccddeeff';
    let w = 350;
    const verbindingen = new Set();
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(req.url === '/api' ? { product_type: 'HWE-P1', serial } : { active_power_w: w }));
    });
    server.on('connection', (s) => verbindingen.add(s));
    await new Promise((klaar) => server.listen(0, '127.0.0.1', klaar));
    const adres = `127.0.0.1:${server.address().port}`;
    const instellingen = { homewizard: [{ sleutel: 'hw-test-v1', naam: 'Meterkast', adres }] };
    const plek = maakAdressen({ instellingen }).plek('hw-test-v1');
    try {
      const meter = instellingen.homewizard[0];
      for (let i = 0; i < 4; i++) expect((await leesHomeWizard(meter, { plek })).w).toBe(350);
      // Vier lezingen (en één keer /api) over één verbinding, niet vier nieuwe.
      expect(verbindingen.size).toBe(1);
      // Nu zit er een andere HomeWizard achter dit adres (de verbinding valt weg, de nieuwe meter antwoordt).
      server.closeAllConnections();
      serial = '112233445566';
      w = 2000;
      await expect(leesHomeWizard(meter, { plek })).rejects.toMatchObject({ code: 'ANDER_APPARAAT' });
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});
