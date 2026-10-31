import { describe, expect, it } from 'vitest';
import { maakAdvies } from './advies';
import { batterijRegels } from './batterijGegevens';
import { dagenUit } from './periode';
import { nepDagen, nepWeer } from './morgenProef';
import { puntenVoor } from './opstelling';
import { verwachtingVoor } from './verwachting';
import { voorbeeldDagen, voorbeeldStand } from './voorbeeld';
import { adviesBereik } from './adviesBron';

const UUR = 3_600_000;
/** Vrijdag 30 oktober 2026, 14:00 in Nederland. */
const NU = Date.parse('2026-10-30T13:00:00Z');
const VANDAAG = '2026-10-30';

const zonPunt = (eigenMax) => [{ soort: 'zon', sleutel: 'zon', naam: 'Zon', eigenMax }];
const stand = (weer, over = {}) => ({ weer, batterij_procent: 40, batterij_info: { inhoud_kwh: 8.64 }, voorspelling: null, dag: null, zon_w: 0, zonnen: [{ sleutel: 'zon', naam: 'Zon' }], brug: { zon: null }, ...over });

/** De zon per uur zoals Advies en Voorspelling hem zien, op de uren die ze allebei hebben. */
function beideZonnen(advies, morgen) {
  const opBegin = new Map(morgen.uren.map((u) => [u.begin, u.zonW]));
  return advies.uren.filter((u) => opBegin.get(u.begin) !== null && opBegin.has(u.begin)).map((u) => [u.zonW, Math.round(opBegin.get(u.begin))]);
}

describe('één zonverwachting voor Huis en Voorspelling (R19-RK-01, weergave-1)', () => {
  it('na een grijze week en een zonnige morgen: Advies rekent per uur met precies de zon van Voorspelling', () => {
    // 4 kWp op het zuiden, 7 grijze dagen geleerd, morgen zonnig.
    const plekken = [{ sleutel: 'zon', kwp: 4, helling: 35, richting: 180, prestatie: 0.8 }];
    const dagen = nepDagen({ tot: VANDAAG, aantal: 7, plekken, helder: () => 0.2 });
    const weer = nepWeer({ vandaag: VANDAAG, opgehaald: NU - 600_000, helder: (i) => (i >= 25 ? 0.75 : 0.3) });
    const s = stand(weer);
    const v = verwachtingVoor({ stand: s, dagen, punten: zonPunt(4000), nu: NU, metVoorbeeld: false });
    const a = maakAdvies({ stand: s, dagen, nu: NU, verwachting: v.morgen });
    const paren = beideZonnen(a, v.morgen);
    expect(paren.length).toBeGreaterThanOrEqual(20);
    for (const [huis, voorspelling] of paren) expect(huis).toBe(voorspelling);
    expect(a.zonBron).toBe('voorspelling');
    expect(a.toelichting).toContain('De zon per uur is dezelfde als op het tabblad Weer: uit het weerbericht en wat de app van je panelen leerde.');
    // Zonder die ene bron (de oude schatting met één verhouding) was het morgen veel minder: dat was de tegenspraak.
    const oud = maakAdvies({ stand: s, dagen, nu: NU });
    const som = (r) => r.uren.filter((u) => u.morgen).reduce((t, u) => t + u.zonW, 0);
    expect(som(oud)).toBeLessThan(som(a) * 0.8);
  });

  it('in het voorbeeld hetzelfde nepweer en dezelfde nepdagen als het tabblad Voorspelling', () => {
    const nacht = Date.parse('2026-11-05T23:00:00Z');
    const nu = nacht + 10.25 * UUR;
    const s = voorbeeldStand(10.25, 0, 'dierenverblijf', nacht);
    const punten = puntenVoor({}, s);
    const { van, tot, vandaag } = adviesBereik(nu);
    const v = verwachtingVoor({ stand: s, dagen: [], punten, nu, metVoorbeeld: true });
    expect(v.weer?.straling?.length).toBeGreaterThan(24);
    const a = maakAdvies({ stand: { ...s, weer: v.weer }, dagen: dagenUit(voorbeeldDagen(van, tot, vandaag)).slice(-14), nu, verwachting: v.morgen });
    expect(a.zonBron).toBe('voorspelling');
    for (const [huis, voorspelling] of beideZonnen(a, v.morgen)) expect(huis).toBe(voorspelling);
    expect(a.regels.some((r) => r.soort === 'weer')).toBe(true);
  });
});

describe('het beste moment volgt het dak (R19-RK-02)', () => {
  /** Zonnige week, vandaag zonnig, 07:30, geen batterij en geen prijzen: dan telt alleen waar de zon over is. */
  function besteUur(richting) {
    const nu = Date.parse('2026-10-30T06:30:00Z');
    const plekken = [{ sleutel: 'zon', kwp: 4, helling: 35, richting, prestatie: 0.8 }];
    const dagen = nepDagen({ tot: VANDAAG, aantal: 7, plekken, helder: () => 0.7 });
    const weer = nepWeer({ vandaag: VANDAAG, opgehaald: nu - 600_000, helder: () => 0.7 });
    const s = stand(weer, { batterij_procent: null });
    const v = verwachtingVoor({ stand: s, dagen, punten: zonPunt(4000), nu, metVoorbeeld: false });
    const a = maakAdvies({ stand: s, dagen, nu, verwachting: v.morgen });
    return { van: a.uren[a.beste.eerste].uur, tot: a.uren[a.beste.laatste].uur + 1 };
  }

  it('een dak op het westen: ’s middags; op het oosten: ’s ochtends', () => {
    expect(besteUur(270).van).toBeGreaterThanOrEqual(12);
    expect(besteUur(90).tot).toBeLessThanOrEqual(13);
  });
});

describe('het batterijblad volgt dezelfde verwachting (weergave-2)', () => {
  const info = { vol_over_min: 30 * 60, pakketten: 3, inhoud_kwh: 8.64 };

  it('met de verwachting: "Verwacht vol", en het getal van de Zendure met zijn vermogen erbij', () => {
    const regels = batterijRegels(info, { batterijW: -143, verwacht: { eersteVolTekst: 'vandaag rond 15:00', alVol: false, laadtNiet: false } });
    expect(regels.find((r) => r.sleutel === 'tijd')).toEqual({
      sleutel: 'tijd',
      tekst: 'Verwacht vol vandaag rond 15:00',
      bij: 'met de zon van tabblad Weer · de Zendure zelf, bij 143 W laden: vol over ongeveer 30 uur',
    });
  });

  it('zonder verwachting (of hij komt niet vol): alleen de Zendure, met het vermogen erbij', () => {
    const tijd = (verwacht) => batterijRegels(info, { batterijW: -143, verwacht }).find((r) => r.sleutel === 'tijd');
    const zelf = { sleutel: 'tijd', tekst: 'Bij 143 W laden: vol over ongeveer 30 uur', bij: 'schatting van de Zendure, bij het vermogen van nu' };
    expect(tijd(null)).toEqual(zelf);
    expect(tijd({ eersteVolTekst: null, alVol: false, laadtNiet: false })).toEqual(zelf);
  });

  it('de verwachting uit maakMorgen komt tot het blad: zelfde rekening als Voorspelling', () => {
    const plekken = [{ sleutel: 'zon', kwp: 4, helling: 35, richting: 180, prestatie: 0.8 }];
    const nu = Date.parse('2026-10-30T09:00:00Z');
    const dagen = nepDagen({ tot: VANDAAG, aantal: 7, plekken, helder: () => 0.7 });
    const weer = nepWeer({ vandaag: VANDAAG, opgehaald: nu - 600_000, helder: () => 0.7 });
    const v = verwachtingVoor({ stand: stand(weer, { batterij_procent: 60 }), dagen, punten: zonPunt(4000), nu, metVoorbeeld: false });
    const regel = batterijRegels(info, { batterijW: -143, verwacht: v.morgen.batterij }).find((r) => r.sleutel === 'tijd');
    expect(regel.tekst).toBe(`Verwacht vol ${v.morgen.batterij.eersteVolTekst}`);
    expect(v.morgen.batterij.eersteVolTekst).toMatch(/^vandaag rond \d\d:00$/);
  });
});
