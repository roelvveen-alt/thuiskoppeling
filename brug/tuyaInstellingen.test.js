import { describe, expect, it } from 'vitest';
import { controleerInstellingen } from './instellingen.mjs';
import { metTuya } from './tuya.mjs';
import { controleerTuya, tuyaSleutelVan } from './tuyaInstellingen.mjs';

const pomp = { naam: 'Pomp', id: 'bf11111111111111111111', local_key: 'a1b2c3d4e5f6g7h8', adres: '192.168.1.50', versie: '3.4', wat: 'meter', soort: 'pomp', dp: { aan: 1, vermogen: 19, schaal: 1 } };
const spots = { naam: 'Spots overstek', id: 'bf22222222222222222222', local_key: "x'Y;z|1#2$3%4&5*", adres: '192.168.1.51', versie: '3.5', wat: 'lamp', spots: true };

describe('controleerTuya', () => {
  it('goed: met sleutel, soort bij een meter, spots bij een lamp', () => {
    const fouten = [];
    expect(controleerTuya([pomp, spots], fouten)).toEqual([
      { ...pomp, sleutel: 'tuya-pomp' },
      { naam: 'Spots overstek', id: spots.id, local_key: spots.local_key, adres: spots.adres, versie: '3.5', wat: 'lamp', sleutel: 'tuya-spots-overstek', spots: true },
    ]);
    expect(fouten).toEqual([]);
  });

  it('weg of leeg: geen apparaten, geen fout', () => {
    const fouten = [];
    expect(controleerTuya(undefined, fouten)).toEqual([]);
    expect(controleerTuya([], fouten)).toEqual([]);
    expect(fouten).toEqual([]);
  });

  it('fout: alles in gewone woorden, een raar datapunt valt stil weg', () => {
    const fouten = [];
    const uit = controleerTuya([{ ...pomp, local_key: 'kort', versie: '3.1', wat: 'stopcontact', adres: '', dp: { aan: 'een', vermogen: 999 } }, { ...pomp }], fouten);
    expect(fouten.join(' ')).toMatch(/local key is 16 tekens/);
    expect(fouten.join(' ')).toMatch(/3\.3", "3\.4" of "3\.5"/);
    expect(fouten.join(' ')).toMatch(/"meter", "lamp" of "schakelaar"/);
    expect(fouten.join(' ')).toMatch(/IP-adres/);
    expect(fouten.join(' ')).toMatch(/dezelfde naam/);
    expect(uit[0].dp).toBeUndefined();
  });

  it('sleutel uit de naam', () => {
    expect(tuyaSleutelVan('Lamp schuur!')).toBe('tuya-lamp-schuur');
    expect(tuyaSleutelVan('')).toBe('tuya-apparaat');
  });
});

describe('instellingen.json met tuya', () => {
  const app = { adres: 'https://x.base44.app/functions/ontvangMeting', sleutel: 'a'.repeat(48) };
  it('alleen Tuya is ook genoeg; oude instellingen zonder tuya: een lege lijst', () => {
    const alleen = controleerInstellingen({ app, tuya: [pomp] });
    expect(alleen.ok).toBe(true);
    expect(alleen.instellingen.tuya).toHaveLength(1);
    const oud = controleerInstellingen({ app, homewizard: [{ naam: 'Meterkast', rol: 'net', adres: '192.168.1.20' }] });
    expect(oud.ok).toBe(true);
    expect(oud.instellingen.tuya).toEqual([]);
  });
});

describe('metTuya', () => {
  const meting = () => ({ zonnen: [{ sleutel: 'hw-zon', vermogen_w: 100 }], apparaten: [{ sleutel: 'hw-was', naam: 'Was', soort: 'wasmachine', vermogen_w: 5 }] });
  it('de pomp achter de andere apparaten, de lampen als blok', () => {
    const uit = metTuya(meting(), [
      { apparaat: { sleutel: 'tuya-pomp', naam: 'Pomp', wat: 'meter', soort: 'pomp' }, stand: { aan: true, w: 412.4 } },
      { apparaat: { sleutel: 'tuya-spots', naam: 'Spots', wat: 'lamp', spots: true }, stand: { aan: false, helderheid: null } },
    ]);
    expect(uit.apparaten.map((a) => a.sleutel)).toEqual(['hw-was', 'tuya-pomp']);
    expect(uit.apparaten[1].vermogen_w).toBe(412);
    expect(uit.lampen).toEqual([{ sleutel: 'tuya-spots', naam: 'Spots', soort: 'lamp', aan: false, rol: 'spots' }]);
  });
  it('zonder Tuya: de meting zoals hij was, zonder lampen', () => {
    expect(metTuya(meting(), [])).toEqual(meting());
  });
});
