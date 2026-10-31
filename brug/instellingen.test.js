import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { controleerInstellingen, leesJsonBestand, maakPrive } from './instellingen.mjs';
import { bewaarSessie, laadSessie } from './zonneplan.mjs';
import { bereik, eigenAdres, netwerkenUit, netwerkenUitTekst, netwerkUitTekst } from './zoek.mjs';

const goed = {
  app: { adres: 'https://base44.app/api/apps/abc/functions/ontvangMeting', sleutel: '0123456789abcdef'.repeat(3) },
  homewizard: [
    { naam: 'Meterkast', rol: 'net', adres: '192.168.1.20' },
    { naam: 'Wasmachine boven', rol: 'apparaat', soort: 'wasmachine', adres: '192.168.1.61', code: 'a'.repeat(32) },
  ],
  zendure: { manier: 'lokaal', adres: '192.168.1.30' },
};

describe('controleerInstellingen', () => {
  it('vult aan: elke 5 s, sleutels uit de naam, code in hoofdletters', () => {
    const uit = controleerInstellingen(goed);
    expect(uit.ok).toBe(true);
    expect(uit.instellingen.elke_seconden).toBe(5);
    expect(uit.instellingen.homewizard.map((m) => m.sleutel)).toEqual(['hw-meterkast', 'hw-wasmachine-boven']);
    expect(uit.instellingen.homewizard[0].soort).toBe('stekker');
    expect(uit.instellingen.homewizard[1].code).toBe('A'.repeat(32));
  });

  it('noemt alle fouten tegelijk', () => {
    const uit = controleerInstellingen({
      app: { adres: 'http://onveilig', sleutel: 'kort' },
      elke_seconden: 1,
      homewizard: [{ naam: '', rol: 'iets', adres: 'geen adres!' }],
      zendure: { manier: 'anders' },
    });
    expect(uit.ok).toBe(false);
    // adres en sleutel van de app, elke_seconden, naam, rol en adres van de meter, zendure.manier
    expect(uit.fouten).toHaveLength(7);
  });

  it('de sleutel uit de app: 48 tekens hex, in kleine letters', () => {
    const groot = controleerInstellingen({ ...goed, app: { ...goed.app, sleutel: ` ${'0123456789ABCDEF'.repeat(3)} ` } });
    expect(groot.instellingen.app.sleutel).toBe('0123456789abcdef'.repeat(3));
    for (const sleutel of ['x'.repeat(48), 'a'.repeat(47), 'PLAK-HIER-DE-SLEUTEL-UIT-DE-APP', undefined]) {
      const uit = controleerInstellingen({ ...goed, app: { ...goed.app, sleutel } });
      expect(uit.ok, String(sleutel)).toBe(false);
      expect(uit.fouten[0]).toMatch(/Instellingen › Delen › Nieuwe sleutel/);
    }
  });

  it('voor proef en zoek is de app niet nodig', () => {
    const zonder = { ...goed };
    delete zonder.app;
    expect(controleerInstellingen(zonder).ok).toBe(false);
    expect(controleerInstellingen(zonder, { zonderApp: true }).ok).toBe(true);
  });

  it('cloud vraagt een cloudsleutel; zonder meters kan niet', () => {
    expect(controleerInstellingen({ ...goed, zendure: { manier: 'cloud' } }).ok).toBe(false);
    expect(controleerInstellingen({ ...goed, zendure: { manier: 'cloud', cloudsleutel: 'aHR0cHM6Ly92b29yYmVlbGQu' } }).ok).toBe(true);
    expect(controleerInstellingen({ app: goed.app }).fouten).toEqual([
      'Er staat nog geen enkele meter in: vul "homewizard" en/of "zendure" in.',
    ]);
  });

  it('lokaal mag een cloudsleutel als reserve hebben; oude instellingen blijven zoals ze waren', () => {
    expect(controleerInstellingen(goed).instellingen.zendure).toEqual({ manier: 'lokaal', adres: '192.168.1.30' });
    const reserve = controleerInstellingen({ ...goed, zendure: { manier: 'lokaal', adres: '192.168.1.30', cloudsleutel: ' aHR0cHM6Ly92b29yYmVlbGQu ' } });
    expect(reserve.instellingen.zendure).toEqual({ manier: 'lokaal', adres: '192.168.1.30', cloudsleutel: 'aHR0cHM6Ly92b29yYmVlbGQu' });
    expect(controleerInstellingen({ ...goed, zendure: { manier: 'lokaal', adres: '192.168.1.30', cloudsleutel: 'kort' } }).fouten).toEqual([
      'zendure.cloudsleutel: de Autorisatiecloudsleutel uit de Zendure-app (als reserve), of laat hem weg.',
    ]);
  });

  it('het teken van een zonnemeter: min, plus of weg (zoals vroeger)', () => {
    const met = (opwek, rol = 'zon') => controleerInstellingen({ ...goed, homewizard: [{ naam: 'Zon', rol, adres: '192.168.1.22', opwek }] });
    expect(met(undefined).instellingen.homewizard[0]).not.toHaveProperty('opwek');
    expect(met('min').instellingen.homewizard[0].opwek).toBe('min');
    expect(met('plus').instellingen.homewizard[0].opwek).toBe('plus');
    // Alleen bij een gewone zonnemeter.
    expect(met('plus', 'apparaat').instellingen.homewizard[0]).not.toHaveProperty('opwek');
    expect(met('-').fouten).toEqual(['homewizard[0].opwek: "min" (gewoon: opwek is min) of "plus" (omgekeerd aangesloten: opwek is plus), of laat het weg.']);
  });

  it('zon-en-batterij: kan alleen met een Zendure; piek_w binnen grenzen', () => {
    const groep = { naam: 'Batterij + Zon', rol: 'zon-en-batterij', adres: '192.168.1.23', piek_w: 4000 };
    const met = controleerInstellingen({ ...goed, homewizard: [...goed.homewizard, groep] });
    expect(met.ok).toBe(true);
    expect(met.instellingen.homewizard[2]).toMatchObject({ sleutel: 'hw-batterij-zon', rol: 'zon-en-batterij', piek_w: 4000 });
    const zonder = { ...goed, homewizard: [groep] };
    delete zonder.zendure;
    expect(controleerInstellingen(zonder).fouten).toEqual([
      'Een meter met rol "zon-en-batterij" heeft de Zendure nodig om de zon uit te rekenen: vul "zendure" in.',
    ]);
    expect(controleerInstellingen({ ...goed, homewizard: [{ ...groep, piek_w: 5 }] }).ok).toBe(false);
  });

  it('een Zendure P1-meter om te vergelijken: alleen met een goed adres', () => {
    expect(controleerInstellingen(goed).instellingen.zendure_p1).toBeNull();
    expect(controleerInstellingen({ ...goed, zendure_p1: { adres: '192.168.1.31' } }).instellingen.zendure_p1).toEqual({ adres: '192.168.1.31' });
    expect(controleerInstellingen({ ...goed, zendure_p1: { adres: 'geen adres!' } }).fouten).toEqual([
      'zendure_p1.adres: het IP-adres van de Zendure P1-meter ontbreekt of klopt niet.',
    ]);
    expect(controleerInstellingen({ ...goed, zendure_p1: '192.168.1.31' }).ok).toBe(false);
  });

  it('een GoodWe-omvormer: een goed adres, en zo nodig bij welke panelen', () => {
    expect(controleerInstellingen(goed).instellingen.goodwe).toBeNull();
    expect(controleerInstellingen({ ...goed, goodwe: { adres: '192.168.1.40' } }).instellingen.goodwe).toEqual({ adres: '192.168.1.40' });
    expect(controleerInstellingen({ ...goed, goodwe: { adres: '192.168.1.40', bij: 'hw-zon-huis' } }).instellingen.goodwe).toEqual({ adres: '192.168.1.40', bij: 'hw-zon-huis' });
    expect(controleerInstellingen({ ...goed, goodwe: { adres: 'geen adres!' } }).fouten).toEqual([
      'goodwe.adres: het IP-adres van de omvormer ontbreekt of klopt niet (bijvoorbeeld 192.168.1.30).',
    ]);
    expect(controleerInstellingen({ ...goed, goodwe: { adres: '192.168.1.40', bij: 'zon huis!' } }).ok).toBe(false);
    expect(controleerInstellingen({ ...goed, goodwe: '192.168.1.40' }).ok).toBe(false);
    // Alleen een omvormer is ook genoeg om te beginnen.
    expect(controleerInstellingen({ app: goed.app, goodwe: { adres: '192.168.1.40' } }).ok).toBe(true);
  });

  it('prijzen: zonneplan, energyzero of niets', () => {
    expect(controleerInstellingen(goed).instellingen.prijzen).toBeNull();
    expect(controleerInstellingen({ ...goed, prijzen: 'zonneplan' }).instellingen.prijzen).toBe('zonneplan');
    expect(controleerInstellingen({ ...goed, prijzen: 'energyzero' }).instellingen.prijzen).toBe('energyzero');
    expect(controleerInstellingen({ ...goed, prijzen: 'vattenfall' }).fouten).toEqual(['prijzen: kies "zonneplan" of "energyzero", of laat het weg.']);
  });

  it('vaste kosten: alle drie de bedragen, en alleen met prijzen', () => {
    const vast = { levering_per_maand: 6.25, netbeheer_per_maand: 38.5, vermindering_energiebelasting_per_maand: 52.41 };
    expect(controleerInstellingen({ ...goed, prijzen: 'zonneplan', vaste_kosten: vast }).instellingen.vaste_kosten).toEqual(vast);
    expect(controleerInstellingen({ ...goed, prijzen: 'zonneplan' }).instellingen.vaste_kosten).toBeNull();
    expect(
      controleerInstellingen({ ...goed, prijzen: 'zonneplan', vaste_kosten: { ...vast, netbeheer_per_maand: 'VUL-IN-UIT-JE-CONTRACT' } }).fouten,
    ).toEqual(['vaste_kosten.netbeheer_per_maand: de netbeheerkosten per maand in euro; die staan in je contract in de Zonneplan-app.']);
    expect(controleerInstellingen({ ...goed, vaste_kosten: vast }).fouten).toEqual([
      'vaste_kosten: zet ook "prijzen" aan; zonder prijzen rekent het programmaatje geen kosten uit.',
    ]);
  });

  it('plaats voor zon op en onder: weg is De Bilt, anders twee getallen', () => {
    expect(controleerInstellingen(goed).instellingen.plaats).toBeNull();
    expect(controleerInstellingen({ ...goed, plaats: { breedte: 52.37, lengte: 4.9 } }).instellingen.plaats).toEqual({ breedte: 52.37, lengte: 4.9 });
    expect(controleerInstellingen({ ...goed, plaats: 'Amsterdam' }).ok).toBe(false);
  });

  it('wat je dit jaar al teruggeleverd hebt (voor het plafond)', () => {
    expect(controleerInstellingen({ ...goed, teruglevering_dit_jaar: { jaar: 2026, kwh: 7247 } }).instellingen.teruglevering_dit_jaar).toEqual({
      jaar: 2026,
      kwh: 7247,
    });
    expect(controleerInstellingen({ ...goed, teruglevering_dit_jaar: { kwh: 7247 } }).ok).toBe(false);
  });

  it('twee meters met dezelfde naam mag niet', () => {
    const dubbel = { ...goed, homewizard: [goed.homewizard[0], { ...goed.homewizard[0], adres: '192.168.1.40' }] };
    expect(controleerInstellingen(dubbel).ok).toBe(false);
  });
});

describe('netwerken om te doorzoeken', () => {
  it('neemt meer netwerken tegelijk aan, met spaties of komma’s', () => {
    expect(netwerkenUitTekst('192.168.1 192.168.0')).toEqual(['192.168.1.', '192.168.0.']);
    expect(netwerkenUitTekst(' 192.168.1, 192.168.0.97 ')).toEqual(['192.168.1.', '192.168.0.']);
    expect(netwerkenUitTekst('192.168.1 192.168.1')).toEqual(['192.168.1.']);
    expect(netwerkenUitTekst('192.168.1 thuis')).toBe(null);
    expect(netwerkenUitTekst('')).toBe(null);
  });

  it('zegt in gewone woorden waar hij zoekt', () => {
    expect(bereik(['192.168.1.'])).toBe('192.168.1.1 tot 192.168.1.254');
    expect(bereik(['192.168.1.', '10.0.0.'])).toBe('192.168.1.1 tot 192.168.1.254 en 10.0.0.1 tot 10.0.0.254');
    expect(bereik([])).toBe('je netwerk');
  });

  it('alleen thuisnetwerken, één keer per /24', () => {
    const interfaces = {
      lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
      wlan0: [
        { family: 'IPv4', internal: false, address: '192.168.1.44' },
        { family: 'IPv6', internal: false, address: 'fe80::1' },
      ],
      eth0: [{ family: 'IPv4', internal: false, address: '192.168.1.45' }],
      docker0: [{ family: 'IPv4', internal: false, address: '172.18.0.1' }],
      vpn: [{ family: 'IPv4', internal: false, address: '100.64.0.3' }],
    };
    expect(netwerkenUit(interfaces)).toEqual(['192.168.1.', '172.18.0.']);
  });

  it('een zelf genoemd netwerk', () => {
    expect(netwerkUitTekst('192.168.1')).toBe('192.168.1.');
    expect(netwerkUitTekst('10.0.0.0')).toBe('10.0.0.');
    expect(netwerkUitTekst('192.168.300')).toBeNull();
    expect(netwerkUitTekst('thuis')).toBeNull();
  });

  it('het eigen adres zonder de netwerklijst (zoals op Android) geeft een adres of niets, nooit een fout', async () => {
    const adres = await eigenAdres();
    expect(adres === null || /^\d+\.\d+\.\d+\.\d+$/.test(adres)).toBe(true);
  });
});

describe('geheimen blijven geheim', () => {
  it('kapotte JSON: de melding noemt de plek, nooit een stukje van de sleutel', () => {
    const tekst = '{"app": {"sleutel": geheimgeheimgeheim}}';
    expect(() => leesJsonBestand(tekst)).toThrow(/^instellingen\.json is geen geldige JSON/);
    try {
      leesJsonBestand(tekst);
    } catch (fout) {
      expect(fout.message).not.toContain('geheim');
    }
    const meerRegels = '{\n  "a": 1,\n  "sleutel": "geheim" "c"\n}';
    expect(() => leesJsonBestand(meerRegels)).toThrow(/\(regel 3, kolom \d+\)\.$/);
    expect(() => leesJsonBestand(meerRegels)).not.toThrow(/geheim/);
    expect(leesJsonBestand('{"a":1}')).toEqual({ a: 1 });
  });

  it.skipIf(process.platform === 'win32')('een bestand dat anderen kunnen lezen wordt 0600, met één regel', () => {
    const pad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'prive-')), 'instellingen.json');
    fs.writeFileSync(pad, '{}', { mode: 0o644 });
    fs.chmodSync(pad, 0o644);
    const regels = [];
    expect(maakPrive(pad, { log: (t) => regels.push(t) })).toBe(true);
    expect(fs.statSync(pad).mode & 0o777).toBe(0o600);
    expect(maakPrive(pad, { log: (t) => regels.push(t) })).toBe(false);
    expect(regels).toEqual(['instellingen.json was leesbaar voor anderen op deze computer; nu alleen voor jou.']);
    expect(maakPrive(pad, { platform: 'win32' })).toBe(false);
    expect(maakPrive(`${pad}.weg`, { log: () => {} })).toBe(false);
  });

  it.skipIf(process.platform === 'win32')('de Zonneplan-sessie: ook 0600 bij laden, en een oud .nieuw houdt zijn rechten niet', () => {
    const pad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'prive-')), 'zonneplan-sessie.json');
    fs.writeFileSync(`${pad}.nieuw`, 'oud', { mode: 0o644 });
    fs.chmodSync(`${pad}.nieuw`, 0o644);
    bewaarSessie(pad, { access_token: 'a', refresh_token: 'b', verloopt: 1 });
    expect(fs.statSync(pad).mode & 0o777).toBe(0o600);
    fs.chmodSync(pad, 0o644);
    expect(laadSessie(pad, { log: () => {} })?.access_token).toBe('a');
    expect(fs.statSync(pad).mode & 0o777).toBe(0o600);
  });
});
