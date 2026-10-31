import { describe, expect, it } from 'vitest';
import { dagVoorApp, logMeting } from './dag.mjs';
import { HOOGSTENS_KENNIS_TEKENS } from './kennis.mjs';
import { antwoordInWoorden, EXTRA_BLOKKEN, extraPlanner, HOOGSTENS_TEKENS, kiesExtras, kiesExtrasPassend, metingKort, minderAccus, pasInGrootte, verstuur, verstuurMetTerugval } from './versturen.mjs';

const stand = { net_w: 120, zon_w: 0, batterij_w: 0, batterij_procent: 100 };
const app = { adres: 'https://voorbeeld.invalid/ontvangMeting', sleutel: 'x' };

describe('een afgekeurd blok houdt de stand niet tegen', () => {
  it('400 met extra\'s: meteen nog eens zonder, met de reden erbij', async () => {
    const gestuurd = [];
    const stuur = async (_app, meting) => {
      gestuurd.push(meting);
      return meting.dag ? { ok: false, status: 400, fout: 'dag.procent[44] klopt niet' } : { ok: true };
    };
    const uit = await verstuurMetTerugval(app, { ...stand, dag: { procent: [101] }, brug: { versie: '1' } }, { stuur });
    expect(uit).toEqual({ ok: true, geweigerd: 'dag.procent[44] klopt niet' });
    expect(gestuurd).toHaveLength(2);
    expect(gestuurd[1]).toEqual(stand);
  });

  it('413 (te groot) ook; zonder extra\'s, of bij een andere fout, niet nog eens', async () => {
    let keer = 0;
    const te = async (_app, m) => (keer++, m.gekoppeld ? { ok: false, status: 413, fout: 'Meting is te groot' } : { ok: true });
    expect((await verstuurMetTerugval(app, { ...stand, gekoppeld: [] }, { stuur: te })).geweigerd).toBe('Meting is te groot');
    expect(keer).toBe(2);
    keer = 0;
    const kapot = async () => (keer++, { ok: false, status: 400, fout: 'net_w klopt niet' });
    expect(await verstuurMetTerugval(app, stand, { stuur: kapot })).toEqual({ ok: false, status: 400, fout: 'net_w klopt niet' });
    expect(keer).toBe(1);
    keer = 0;
    const rem = async () => (keer++, { ok: false, status: 429, fout: 'rem' });
    await verstuurMetTerugval(app, { ...stand, dag: {} }, { stuur: rem });
    expect(keer).toBe(1);
  });
});

describe('niet te groot', () => {
  it('past het niet, dan gaat de grootste extra er deze keer uit', () => {
    const groot = { ...stand, dag: { huis_w: Array(5000).fill(1234) }, voorspelling: { a: 1 }, brug: { versie: '1' } };
    const { meting, weg } = pasInGrootte(groot);
    expect(weg).toEqual(['dag']);
    expect(meting).toEqual({ ...stand, voorspelling: { a: 1 }, brug: { versie: '1' } });
    expect(JSON.stringify(meting).length).toBeLessThanOrEqual(HOOGSTENS_TEKENS);
    expect(pasInGrootte(stand)).toEqual({ meting: stand, weg: [] });
  });
});

describe('herkennen (0.11.0)', () => {
  it('de labels uit het antwoord van de app komen mee; een oudere functie stuurt ze niet', async () => {
    const { verstuur } = await import('./versturen.mjs');
    const labels = [{ id: 'a-1', soort: 'vriezer', w: 120, op: '2026-10-30T10:00:00Z' }, 'rommel'];
    const nieuw = await verstuur(app, stand, { vraag: async () => ({ status: 200, json: { ok: true, herkend_labels: labels } }) });
    expect(nieuw).toEqual({ ok: true, herkend_labels: [labels[0]] });
    const oud = await verstuur(app, stand, { vraag: async () => ({ status: 200, json: { ok: true } }) });
    expect(oud).toEqual({ ok: true });
  });

  it('herkend is een extra: bij te groot of een afgekeurd blok gaat het er deze keer uit, de stand niet', async () => {
    const { meting, weg } = pasInGrootte({ ...stand, herkend: { nu: Array(2000).fill({ id: 'a-1', w: 100 }) } });
    expect(weg).toEqual(['herkend']);
    expect(meting).toEqual(stand);
    const stuur = async (_app, m) => (m.herkend ? { ok: false, status: 400, fout: 'oud' } : { ok: true });
    expect(await verstuurMetTerugval(app, { ...stand, herkend: { nu: [] } }, { stuur })).toEqual({ ok: true, geweigerd: 'oud' });
  });
});

/** Een blok van precies n tekens als JSON. */
const blok = (n) => ({ x: 'a'.repeat(n - 8) });

describe('extra\'s spreiden (0.13.0): elk blok komt aan de beurt, en de meting blijft onder de grens', () => {
  it('kiesExtras: wat het langst wachtte eerst; wat niet meer past de volgende ronde; te groot apart', () => {
    const extras = { dag: blok(9000), herkend: blok(6000), voorspelling: blok(4000) };
    const { meting, mee, later, teGroot } = kiesExtras(stand, extras, { dag: 100, herkend: 50 }, 12_000);
    // voorspelling ging nog nooit mee (0), dan herkend (50), dan dag (100) past niet meer.
    expect(mee).toEqual(['voorspelling', 'herkend']);
    expect(later).toEqual(['dag']);
    expect(teGroot).toEqual([]);
    expect(JSON.stringify(meting).length).toBeLessThanOrEqual(12_000);
    expect(kiesExtras(stand, { dag: blok(20_000) }).teGroot).toEqual(['dag']);
    // Precies tot de grens.
    const precies = kiesExtras(stand, { brug: blok(100) }, {}, JSON.stringify({ ...stand, brug: blok(100) }).length);
    expect(precies.mee).toEqual(['brug']);
  });

  it("1.4.0: 18 accu's met alles, de meterkast, de omvormer en de kennislijst bij het grootste huis dat we kennen: nooit boven de grens, alles komt aan", () => {
    // De stand van hieronder (4.310, met 8 accu's van voor 1.4.0), met nu 18 accu's met alles (zendure.test.js meet
    // het: 3 × 6 accu's), de meterkast met gas, water en warmte en de omvormer van 1.4.0.
    const accu = (nr) => ({ nr, temp_c: 24.5, procent: 45, cel_min_v: 3.256, cel_max_v: 3.291, verwarmt: true, gezondheid_pct: 99.6, cycli: 1550 });
    const batterij_info = { temp_c: 25.5, temp_min_c: 19, behuizing_c: 40, spanning_v: 52.4, stroom_a: 42.2, laadgrens_pct: 100, ontlaadgrens_pct: 10, pakketten: 18, inhoud_kwh: 51.84, gezondheid_pct: 98.9, cel_min_v: 3.251, cel_max_v: 3.299, invoer_limiet_w: 7200, uitvoer_limiet_w: 7200, omvormer_max_w: 7200, accus: Array.from({ length: 18 }, (_, i) => accu(i + 1)) };
    const meterkast = { tarief: 2, gemiddeld_w: 1234, maandpiek_w: 4321, maandpiek_op: '2026-10-12T17:15:00.000Z', meters: ['gas', 'water', 'warmte'].map((soort) => ({ soort, stand: 12345.678, eenheid: soort === 'warmte' ? 'GJ' : 'm3', op: '2026-10-31T12:55:00.000Z', vandaag: 1.234 })) };
    const omvormer = { pf: 0.987, bus_v: 601.2, koelplaat_c: 45.4, uren: 84511, isolatie_kohm: 1850, lekstroom_ma: 12.5 };
    const oudeAccus = JSON.stringify({ accus: Array.from({ length: 8 }, (_, i) => ({ nr: i + 1, temp_c: 24.5, procent: 45 })) }).length;
    const standGroot = { ...blok(4310 - oudeAccus), batterij_info, meterkast, omvormer };
    expect(JSON.stringify(standGroot).length).toBeLessThan(8000);
    const grootte = { dag: 13_025, herkend: 9383, voorspelling: 4341, brug: 2528, gekoppeld: 2398, weer: 1754, kennis: HOOGSTENS_KENNIS_TEKENS };
    const plan = extraPlanner();
    let grootste = 0;
    // De kennislijst komt om middernacht (de meters) en later nog eens (de omvormer wordt wakker).
    const kennisNieuw = [0, 20 * 60_000];
    let kennisOpen = null;
    const kennisWacht = [];
    const laatsteKeer = {};
    const grootsteGat = {};
    let rondes = 0;
    let volleAccus = 0;
    for (let nu = 0; nu <= 40 * 60_000; nu += 5000) {
      rondes += 1;
      if (kennisNieuw.includes(nu)) kennisOpen = nu;
      const extras = {};
      for (const b of EXTRA_BLOKKEN) {
        if (b === 'kennis') {
          if (kennisOpen !== null) extras.kennis = blok(grootte.kennis);
        } else if (plan.nodig(b, nu, b === 'herkend' ? String(nu) : null)) extras[b] = blok(grootte[b]);
      }
      const { meting, teGroot } = kiesExtrasPassend(standGroot, extras, plan.laatst);
      expect(teGroot).toEqual([]);
      expect(pasInGrootte(meting).weg).toEqual([]);
      grootste = Math.max(grootste, JSON.stringify(meting).length);
      if (meting.batterij_info.accus?.[0]?.cycli) volleAccus += 1;
      plan.verstuurd(meting, { herkend: String(nu) }, nu);
      if (meting.kennis) {
        kennisWacht.push(nu - kennisOpen);
        kennisOpen = null;
      }
      for (const b of EXTRA_BLOKKEN) {
        if (meting[b] == null) continue;
        if (laatsteKeer[b] !== undefined) grootsteGat[b] = Math.max(grootsteGat[b] ?? 0, nu - laatsteKeer[b]);
        laatsteKeer[b] = nu;
      }
    }
    expect(grootste).toBeLessThanOrEqual(HOOGSTENS_TEKENS);
    expect(kennisWacht).toHaveLength(2);
    expect(Math.max(...kennisWacht)).toBeLessThanOrEqual(60_000);
    expect(grootsteGat.dag).toBeLessThanOrEqual(80_000);
    // Alleen als de dag meegaat (eens per minuut) zijn de accu's korter; verder alles.
    expect(volleAccus / rondes).toBeGreaterThan(0.8);
  });

  it('minderAccus: eerst per accu alleen nr, temperatuur en procent, dan zonder lijst; zonder accu\'s dezelfde meting', () => {
    const m = { net_w: 1, batterij_info: { temp_c: 20, accus: [{ nr: 1, temp_c: 20, procent: 50, cel_min_v: 3.2, cycli: 3 }, { nr: 2, procent: 40 }] } };
    expect(minderAccus(m, 1).batterij_info).toEqual({ temp_c: 20, accus: [{ nr: 1, temp_c: 20, procent: 50 }, { nr: 2, procent: 40 }] });
    expect(minderAccus(m, 2).batterij_info).toEqual({ temp_c: 20 });
    expect(m.batterij_info.accus[0].cycli).toBe(3);
    expect(minderAccus(stand, 1)).toBe(stand);
    // Past alles, dan niets korter.
    expect(kiesExtrasPassend(m, { brug: blok(100) }).kleiner).toBeUndefined();
  });

  it('de grootste meting die we kennen (gemeten: 30 apparaten, 3 fasen, 8 accu\'s, 20 lampen, 8 meldingen, alles herkend): nooit boven de grens, alles komt aan', () => {
    // Gemeten met de echte modules (ronde 19): de stand 4.310 tekens, dag 13.025, herkend 9.383,
    // voorspelling 4.341, brug 2.528, gekoppeld 2.398, weer 1.754. Samen 37.739: nooit in één keer.
    const grootte = { dag: 13_025, herkend: 9383, voorspelling: 4341, brug: 2528, gekoppeld: 2398, weer: 1754 };
    const standGroot = blok(4310);
    const plan = extraPlanner();
    const laatsteKeer = {};
    const grootsteGat = {};
    let grootste = 0;
    for (let nu = 0; nu <= 40 * 60_000; nu += 5000) {
      const extras = {};
      const kernen = {};
      for (const b of EXTRA_BLOKKEN) {
        // herkend verandert elke ronde (het ergste), de voorspelling om de 20 minuten.
        const kern = b === 'herkend' ? String(nu) : b === 'voorspelling' ? String(Math.floor(nu / 1_200_000)) : null;
        if (plan.nodig(b, nu, kern)) {
          extras[b] = blok(grootte[b]);
          if (kern !== null) kernen[b] = kern;
        }
      }
      const { meting, teGroot } = kiesExtras(standGroot, extras, plan.laatst);
      expect(teGroot).toEqual([]);
      const lengte = JSON.stringify(meting).length;
      grootste = Math.max(grootste, lengte);
      expect(pasInGrootte(meting).weg).toEqual([]);
      plan.verstuurd(meting, kernen, nu);
      for (const b of EXTRA_BLOKKEN) {
        if (meting[b] == null) continue;
        if (laatsteKeer[b] !== undefined) grootsteGat[b] = Math.max(grootsteGat[b] ?? 0, nu - laatsteKeer[b]);
        laatsteKeer[b] = nu;
      }
    }
    expect(grootste).toBeLessThanOrEqual(HOOGSTENS_TEKENS);
    // De dag en de rest elke minuut, hooguit een paar rondes later; voorspelling en weer eens per kwartier.
    expect(grootsteGat.dag).toBeLessThanOrEqual(80_000);
    expect(grootsteGat.brug).toBeLessThanOrEqual(80_000);
    expect(grootsteGat.gekoppeld).toBeLessThanOrEqual(80_000);
    expect(grootsteGat.herkend).toBeLessThanOrEqual(80_000);
    expect(grootsteGat.voorspelling).toBeLessThanOrEqual(15 * 60_000 + 30_000);
    expect(grootsteGat.weer).toBeLessThanOrEqual(15 * 60_000 + 30_000);
  });

  it('de echte dag (25 uur, 3 fasen, 2 plekken, de week, 30 apparaten met lange namen) past met een grote stand', () => {
    let logboek = null;
    const begin = Date.UTC(2026, 9, 24, 22);
    for (let t = begin; t < begin + 25 * 3600_000; t += 5000) {
      logboek = logMeting(
        logboek,
        {
          zon_w: 2345,
          batterij_w: -1234,
          net_w: -1234,
          batterij_procent: 55,
          fasen: [1, 2, 3].map((fase) => ({ fase, w: -1234, a: 12.34 + (t % 7) / 100 })),
          zonnen: [{ sleutel: 'hw-batterij-zon-huis-dak', vermogen_w: 1234 }, { sleutel: 'hw-zon-dierenverblijf-1', vermogen_w: 1235 }],
        },
        t,
      );
    }
    logboek.week = Array.from({ length: 7 }, (_, i) => ({ datum: `2026-10-${18 + i}`, fasen: [1, 2, 3].map((fase) => ({ fase, gemiddeld_a: 12.34, piek_a: 34.5 })) }));
    const dag = dagVoorApp(logboek);
    dag.apparaten = Array.from({ length: 30 }, (_, i) => ({ sleutel: `h:anders:aquariumpomp-in-de-achterkamer-nummer-${i}`, soort: 'anders', naam: `Aquariumpomp in de achterkamer nummer ${i}`, kwh: 12.34, keer: 123 }));
    dag.basis_kwh = 12.34;
    const lengte = JSON.stringify(dag).length;
    expect(lengte).toBeGreaterThan(10_000);
    expect(kiesExtras(blok(4310), { dag }).mee).toEqual(['dag']);
  });
});

describe('proef (0.13.0): kort, en of de app hem aanneemt', () => {
  it('metingKort: tekens, velden en blokken op een paar regels, ook met het weer erbij', () => {
    const regels = metingKort({ ...stand, weer: { temp_c: Array(48).fill(12.3) } });
    expect(regels).toHaveLength(3);
    expect(regels[0]).toMatch(/^\d{1,3}(\.\d{3})* tekens/);
    expect(regels[1]).toBe('Velden: net_w, zon_w, batterij_w, batterij_procent, weer.');
    expect(regels[2]).toMatch(/^Blokken \(tekens\): weer \(\d+\)\.$/);
    expect(metingKort(stand)).toHaveLength(2);
  });

  it('antwoordInWoorden: aangenomen, sleutel onbekend, adres fout, rem, geen internet', () => {
    expect(antwoordInWoorden({ ok: true })).toBe('De app neemt de meting aan.');
    expect(antwoordInWoorden({ ok: false, status: 401, fout: 'x' })).toContain('kent deze sleutel niet');
    expect(antwoordInWoorden({ ok: false, status: 404, fout: 'x' })).toContain('adres van de app klopt niet');
    expect(antwoordInWoorden({ ok: false, status: 429, fout: 'x' })).toContain('remt');
    expect(antwoordInWoorden({ ok: false, status: 0, fout: 'geen internet' })).toContain('niet te bereiken: geen internet');
    expect(antwoordInWoorden({ ok: false, status: 400, fout: 'net_w klopt niet' })).toBe('De app weigert de meting (400): net_w klopt niet');
  });
});

describe('naar de app over een blijvende verbinding (prestaties-15, 1.3.0)', () => {
  it('elke meting over dezelfde verbinding (APP_VERBINDING), met de sleutel in de kop en 10 s tijd', async () => {
    const { APP_VERBINDING } = await import('./web.mjs');
    const gevraagd = [];
    const vraag = async (adres, opties) => {
      gevraagd.push({ adres, opties });
      return { status: 200, json: { ok: true } };
    };
    await verstuur({ adres: 'https://voorbeeld.base44.app/functions/ontvangMeting', sleutel: 'ab'.repeat(24) }, { net_w: 1 }, { vraag });
    expect(gevraagd[0].opties).toMatchObject({ methode: 'POST', tijd: 10_000, kop: { 'x-brug-sleutel': 'ab'.repeat(24) } });
    expect(gevraagd[0].opties.agent).toBe(APP_VERBINDING);
  });
});
