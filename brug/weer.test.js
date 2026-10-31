import { describe, expect, it } from 'vitest';
import { verstuurMetTerugval } from './versturen.mjs';
import {
  haalWeer,
  morgenInHetKort,
  nuRegel,
  nuUitOpenMeteo,
  WEER_ELKE_MS,
  WEER_HOUDBAAR_MS,
  WEER_UREN,
  weerAdres,
  weerRegel,
  weerUitOpenMeteo,
  weerVoorApp,
  weerVolger,
} from './weer.mjs';

/**
 * Een vast antwoord in de vorm van Open-Meteo (zoals het op 30 oktober 2026
 * zou komen, wintertijd: UTC+1): vandaag en morgen per uur, lokale tijd
 * zonder zone. Vandaag grijs, morgen zonnig.
 */
function openMeteo({ dagen = ['2026-10-30', '2026-10-31'], offset = 3600, straling, bewolking, temp, oud = false } = {}) {
  const time = dagen.flatMap((d) => Array.from({ length: 24 }, (_, u) => `${d}T${String(u).padStart(2, '0')}:00`));
  // De straling bij u:00 is het gemiddelde van het uur ervoor: zon van ongeveer 8:00 tot 17:00.
  const licht = (u) => (u >= 9 && u <= 17 ? Math.round(Math.sin(((u - 8) / 10) * Math.PI) * 100) / 100 : 0);
  const json = {
    latitude: 52.1,
    longitude: 5.18,
    utc_offset_seconds: offset,
    timezone: 'Europe/Amsterdam',
    hourly_units: { time: 'iso8601', shortwave_radiation: 'W/m²', cloud_cover: '%', temperature_2m: '°C' },
    hourly: {
      time,
      shortwave_radiation: straling ?? time.map((t, i) => (i < 24 ? 120 : 380) * licht(Number(t.slice(11, 13)))),
      cloud_cover: bewolking ?? time.map((_, i) => (i < 24 ? 95 : 25)),
      temperature_2m: temp ?? time.map((_, i) => (i < 24 ? 9.4 : 6.15)),
    },
  };
  if (oud) return json;
  // Sinds 0.10.0: vandaag regen tot 15:00, morgen droog met 's middags stevige stoten.
  Object.assign(json.hourly_units, { weather_code: 'wmo code', precipitation: 'mm', precipitation_probability: '%', wind_gusts_10m: 'km/h' });
  Object.assign(json.hourly, {
    weather_code: time.map((t, i) => (i < 15 ? 61 : i < 24 ? 3 : 1)),
    precipitation: time.map((_, i) => (i < 15 ? 0.44 : 0)),
    precipitation_probability: time.map((_, i) => (i < 15 ? 80 : 5)),
    wind_gusts_10m: time.map((_, i) => (i >= 36 && i <= 40 ? 63.4 : 25)),
  });
  return json;
}

const NU = Date.parse('2026-10-30T19:00:00Z'); // 20:00 in Nederland

describe('Open-Meteo ontleden', () => {
  it('een gewoon antwoord: lokale tijd met de afwijking naar echte tijd, alles op het begin van het uur', () => {
    const weer = weerUitOpenMeteo(openMeteo());
    // 00:00 lokaal is 23:00 UTC; de eerste straling hoort bij het uur ervoor: van 22:00 UTC (23:00 gisteren).
    expect(new Date(weer.van).toISOString()).toBe('2026-10-29T22:00:00.000Z');
    expect(weer.stap_min).toBe(60);
    expect(weer.straling_wm2).toHaveLength(WEER_UREN);
    expect(weer.bewolking_pct).toHaveLength(WEER_UREN);
    expect(weer.temp_c[30]).toBe(6.2);
    // Plek 12 is 11:00–12:00 lokaal: de waarde die Open-Meteo bij 12:00 zet.
    expect(weer.straling_wm2[12]).toBe(Math.round(120 * Math.round(Math.sin(0.4 * Math.PI) * 100) / 100));
  });

  it('sinds 0.10.0 ook de weercode, neerslag, kans en windstoten per uur, op dezelfde plekken', () => {
    const weer = weerUitOpenMeteo(openMeteo());
    // Plek i is het uur dat eindigt op tijd i van Open-Meteo (zoals de straling): plek 14 is 13:00–14:00, Open-Meteo zet het bij 14:00.
    expect(weer.weercode).toHaveLength(WEER_UREN);
    expect(weer.weercode[14]).toBe(61);
    expect(weer.weercode[15]).toBe(3);
    expect(weer.neerslag_mm[0]).toBe(0.4);
    expect(weer.neerslag_kans_pct[13]).toBe(80);
    expect(weer.windstoten_kmh[36]).toBe(63);
  });

  it('een oud soort antwoord (zonder de nieuwe reeksen) of een vreemde waarde: alleen die reeks null', () => {
    const oud = weerUitOpenMeteo(openMeteo({ oud: true }));
    expect(oud.weercode).toBeNull();
    expect(oud.neerslag_mm).toBeNull();
    expect(oud.straling_wm2).toHaveLength(WEER_UREN);

    const halfGetal = openMeteo();
    halfGetal.hourly.weather_code[5] = 61.5;
    expect(weerUitOpenMeteo(halfGetal).weercode).toBeNull();
    // Open-Meteo geeft de kans soms niet voor elk uur: dan is die reeks er niet, de rest wel.
    const zonderKans = openMeteo();
    zonderKans.hourly.precipitation_probability[40] = null;
    expect(weerUitOpenMeteo(zonderKans).neerslag_kans_pct).toBeNull();
    expect(weerUitOpenMeteo(zonderKans).neerslag_mm).toHaveLength(WEER_UREN);
    const inches = openMeteo();
    inches.hourly_units.precipitation = 'inch';
    expect(weerUitOpenMeteo(inches).neerslag_mm).toBeNull();
    // Een code die wij niet kennen (maar wel een heel getal tot 99) mag: de site maakt er bewolking van.
    const onbekend = openMeteo();
    onbekend.hourly.weather_code[2] = 42;
    expect(weerUitOpenMeteo(onbekend).weercode[2]).toBe(42);
  });

  it('in de zomer (UTC+2) twee uur terug', () => {
    const weer = weerUitOpenMeteo(openMeteo({ dagen: ['2027-06-20', '2027-06-21'], offset: 7200 }));
    expect(new Date(weer.van).toISOString()).toBe('2027-06-19T21:00:00.000Z');
  });

  it('een reeks die ontbreekt, te kort is, een andere eenheid heeft of een gat heeft: alleen die reeks null', () => {
    const zonderTemp = openMeteo();
    delete zonderTemp.hourly.temperature_2m;
    expect(weerUitOpenMeteo(zonderTemp).temp_c).toBeNull();

    const kort = openMeteo();
    kort.hourly.cloud_cover = kort.hourly.cloud_cover.slice(0, 40);
    expect(weerUitOpenMeteo(kort).bewolking_pct).toBeNull();
    expect(weerUitOpenMeteo(kort).straling_wm2).toHaveLength(48);

    const fahrenheit = openMeteo();
    fahrenheit.hourly_units.temperature_2m = '°F';
    expect(weerUitOpenMeteo(fahrenheit).temp_c).toBeNull();

    const gat = openMeteo();
    gat.hourly.shortwave_radiation[30] = null;
    expect(weerUitOpenMeteo(gat).straling_wm2).toBeNull();

    const teVeel = openMeteo();
    teVeel.hourly.shortwave_radiation[12] = 5000;
    expect(weerUitOpenMeteo(teVeel).straling_wm2).toBeNull();
    expect(weerUitOpenMeteo(teVeel).bewolking_pct).not.toBeNull();
  });

  it('tijden die niet per uur oplopen: tot daar, nooit een gat', () => {
    const json = openMeteo();
    json.hourly.time[20] = '2026-10-30T22:00';
    const weer = weerUitOpenMeteo(json);
    expect(weer.straling_wm2).toHaveLength(20);
    expect(weer.temp_c).toHaveLength(20);
  });

  it('kapot of leeg: een fout, geen half bericht', () => {
    expect(() => weerUitOpenMeteo(null)).toThrow('onverwacht antwoord');
    expect(() => weerUitOpenMeteo({ error: true, reason: 'Latitude must be in range of -90 to 90°.' })).toThrow('onverwacht antwoord');
    expect(() => weerUitOpenMeteo({ ...openMeteo(), utc_offset_seconds: undefined })).toThrow('tijdzone');
    expect(() => weerUitOpenMeteo({ utc_offset_seconds: 3600, hourly: { time: [] } })).toThrow('geen tijden');
    expect(() => weerUitOpenMeteo({ utc_offset_seconds: 3600, hourly: { time: ['gisteren'] } })).toThrow('geen tijden');
    const alleenTemp = openMeteo();
    delete alleenTemp.hourly.shortwave_radiation;
    delete alleenTemp.hourly.cloud_cover;
    expect(() => weerUitOpenMeteo(alleenTemp)).toThrow('geen straling en geen bewolking');
  });
});

describe('het weer van nu (current)', () => {
  const current = { time: '2026-10-30T20:00', interval: 900, weather_code: 61, precipitation: 0.43, wind_speed_10m: 22.3, wind_gusts_10m: 41, cloud_cover: 100, is_day: 0 };
  const units = { time: 'iso8601', interval: 'seconds', weather_code: 'wmo code', precipitation: 'mm', wind_speed_10m: 'km/h', wind_gusts_10m: 'km/h', cloud_cover: '%', is_day: '' };

  it('code, neerslag, wind, stoten en bewolking, afgerond; mee in het blok', () => {
    expect(nuUitOpenMeteo(current, units)).toEqual({ code: 61, neerslag_mm: 0.4, wind_kmh: 22, windstoten_kmh: 41, bewolking_pct: 100 });
    const blok = weerVoorApp(weerUitOpenMeteo({ ...openMeteo(), current, current_units: units }), NU);
    expect(blok.nu).toEqual({ code: 61, neerslag_mm: 0.4, wind_kmh: 22, windstoten_kmh: 41, bewolking_pct: 100 });
    expect(nuRegel(blok)).toBe('lichte regen, 0,4 mm, wind 22 km/h (stoten 41 km/h)');
  });

  it('verdraagzaam: een onbekende code, een andere eenheid of onzin valt weg; niets over = geen nu', () => {
    expect(nuUitOpenMeteo({ ...current, weather_code: 42, wind_speed_10m: -3 }, { ...units, wind_gusts_10m: 'mp/h' })).toEqual({ neerslag_mm: 0.4, bewolking_pct: 100 });
    expect(nuUitOpenMeteo({ weather_code: '61' }, units)).toBeNull();
    expect(nuUitOpenMeteo(null)).toBeNull();
    expect(nuUitOpenMeteo([1, 2])).toBeNull();
    // Zonder current (of kapot): de uren gewoon, zonder nu.
    expect(weerUitOpenMeteo({ ...openMeteo(), current: 'x' })).not.toHaveProperty('nu');
    expect(nuRegel(weerVoorApp(weerUitOpenMeteo(openMeteo()), NU))).toBeNull();
  });
});

describe('het blok voor de app', () => {
  it('klein, met de bron en wanneer opgehaald; past ruim in een meting', () => {
    const blok = weerVoorApp(weerUitOpenMeteo(openMeteo()), NU);
    expect(Object.keys(blok)).toEqual(['van', 'stap_min', 'straling_wm2', 'bewolking_pct', 'temp_c', 'weercode', 'neerslag_mm', 'neerslag_kans_pct', 'windstoten_kmh', 'opgehaald', 'bron']);
    expect(blok).toMatchObject({ van: '2026-10-29T22:00:00.000Z', stap_min: 60, opgehaald: '2026-10-30T19:00:00.000Z', bron: 'open-meteo' });
    // Zeven reeksen van 48 uur: nog steeds klein.
    expect(JSON.stringify(blok).length).toBeLessThan(2000);
  });

  it('een reeks die er niet is, staat er niet in (geen null)', () => {
    const json = openMeteo();
    delete json.hourly.temperature_2m;
    expect(weerVoorApp(weerUitOpenMeteo(json), NU)).not.toHaveProperty('temp_c');
  });

  it('weer is een extra: weigert een functie hem, dan komt de stand toch aan', async () => {
    const gestuurd = [];
    const stuur = async (_app, m) => {
      gestuurd.push(m);
      return m.weer ? { ok: false, status: 400, fout: 'weer klopt niet' } : { ok: true };
    };
    const uit = await verstuurMetTerugval({}, { net_w: 1, weer: { van: 'x' } }, { stuur });
    expect(uit).toMatchObject({ ok: true, geweigerd: 'weer klopt niet' });
    expect(gestuurd[1]).toEqual({ net_w: 1 });
  });
});

describe('proef: morgen in het kort', () => {
  it('zonnig morgen: kWh per m² en de bewolking zolang de zon op is', () => {
    const blok = weerVoorApp(weerUitOpenMeteo(openMeteo()), NU);
    const kort = morgenInHetKort(blok, NU);
    expect(kort.woorden).toBe('veel zon');
    expect(kort.bewolking_pct).toBe(25);
    expect(kort.kwh_m2).toBeGreaterThan(1.5);
    expect(weerRegel(blok, NU)).toMatch(/^morgen veel zon \(\d+,\d kWh\/m²\), bewolking 25%, droog$/);
    // Een bericht van voor 0.10.0 (zonder neerslag): zoals vroeger.
    expect(weerRegel(weerVoorApp(weerUitOpenMeteo(openMeteo({ oud: true })), NU), NU)).toMatch(/bewolking 25%$/);
  });

  it('bewolkt morgen, en zonder straling alleen de bewolking', () => {
    const json = openMeteo({ bewolking: Array(48).fill(90), oud: true });
    delete json.hourly.shortwave_radiation;
    expect(weerRegel(weerVoorApp(weerUitOpenMeteo(json), NU), NU)).toBe('morgen bewolkt, weinig zon, bewolking 90%');
  });

  it('niet bereikbaar, met de reden', () => {
    expect(weerRegel(null, NU)).toBe('niet bereikbaar');
    expect(weerRegel(null, NU, 'geen internet (de naam is niet te vinden) (ENOTFOUND)')).toBe('niet bereikbaar (geen internet (de naam is niet te vinden) (ENOTFOUND))');
  });
});

describe('ophalen bij Open-Meteo', () => {
  it('het adres: de plaats op twee decimalen, zonder plaats De Bilt, met een harde eindtijd', async () => {
    expect(weerAdres(null)).toBe(
      'https://api.open-meteo.com/v1/forecast?latitude=52.10&longitude=5.18' +
        '&hourly=shortwave_radiation,cloud_cover,temperature_2m,weather_code,precipitation,precipitation_probability,wind_gusts_10m' +
        '&current=weather_code,precipitation,wind_speed_10m,wind_gusts_10m,cloud_cover,is_day&timezone=Europe%2FAmsterdam&forecast_days=2',
    );
    expect(weerAdres({ breedte: 52.123456, lengte: 4.9876 })).toContain('latitude=52.12&longitude=4.99');
    let opties = null;
    await haalWeer(null, {
      vraag: async (_adres, o) => {
        opties = o;
        return { status: 200, json: openMeteo() };
      },
    });
    expect(opties.tijd).toBeLessThanOrEqual(15_000);
  });

  it('een andere status is een fout', async () => {
    await expect(haalWeer(null, { vraag: async () => ({ status: 429, json: { error: true } }) })).rejects.toThrow('Open-Meteo antwoordde 429');
  });
});

describe('weerVolger: hooguit eens per uur, het laatste goede tot 3 uur oud', () => {
  function opzet() {
    let nu = NU;
    const regels = [];
    let keer = 0;
    let lukt = true;
    const volger = weerVolger({
      haal: async () => {
        keer += 1;
        if (!lukt) throw Object.assign(new Error('getaddrinfo ENOTFOUND api.open-meteo.com'), { code: 'ENOTFOUND' });
        return weerUitOpenMeteo(openMeteo());
      },
      log: (t) => regels.push(t),
      klok: () => nu,
    });
    return {
      volger,
      regels,
      keer: () => keer,
      zet: (ms) => {
        nu = ms;
      },
      mislukt: (ja) => {
        lukt = !ja;
      },
    };
  }

  it('meteen bij het starten, daarna niet elke meting maar eens per uur', async () => {
    const o = opzet();
    await o.volger.tik();
    expect(o.keer()).toBe(1);
    expect(o.volger.blok()).toMatchObject({ bron: 'open-meteo' });
    for (let t = NU; t < NU + WEER_ELKE_MS; t += 5000) {
      o.zet(t);
      await o.volger.tik();
    }
    expect(o.keer()).toBe(1);
    o.zet(NU + WEER_ELKE_MS);
    await o.volger.tik();
    expect(o.keer()).toBe(2);
    expect(o.regels).toEqual([]);
  });

  it('mislukt: één regel, het laatste goede blijft tot 3 uur oud, dan geen weer; daarna één regel bij herstel', async () => {
    const o = opzet();
    await o.volger.tik();
    const goed = o.volger.blok();
    o.mislukt(true);
    for (let t = NU + WEER_ELKE_MS; t < NU + WEER_HOUDBAAR_MS; t += 60_000) {
      o.zet(t);
      await o.volger.tik();
      expect(o.volger.blok()).toBe(goed);
    }
    // Elk kwartier een poging, maar één regel in het logboek.
    expect(o.keer()).toBeLessThanOrEqual(1 + 9);
    expect(o.regels).toHaveLength(1);
    expect(o.regels[0]).toMatch(/^Weerbericht \(Open-Meteo\): geen internet .*hooguit 3 uur oud/);
    expect(o.volger.fout()).toMatch(/geen internet/);
    o.zet(NU + WEER_HOUDBAAR_MS);
    expect(o.volger.blok()).toBeNull();
    o.mislukt(false);
    o.zet(NU + WEER_HOUDBAAR_MS + 15 * 60_000);
    await o.volger.tik();
    expect(o.volger.blok()).not.toBeNull();
    expect(o.regels).toEqual([o.regels[0], 'Weerbericht (Open-Meteo): lukt weer.']);
  });

  it('springt de klok terug, dan niet urenlang zonder nieuw bericht', async () => {
    const o = opzet();
    await o.volger.tik();
    o.zet(NU - 24 * WEER_ELKE_MS);
    await o.volger.tik();
    expect(o.keer()).toBe(2);
  });
});
