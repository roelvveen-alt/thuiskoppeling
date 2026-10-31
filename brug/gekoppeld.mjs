/**
 * Wat er aan het programmaatje gekoppeld is, voor de lijst in de app
 * (tabblad Apparaten): per apparaat merk, soort, rol, manier, adres, of het
 * de laatste keer antwoordde (en anders sinds wanneer niet) en wat het nu meet.
 *
 * Geen geheimen: geen HomeWizard-codes, geen Zendure-sleutel, geen
 * serienummers. Alleen wat je ook op de meter of in je router ziet.
 */

/** "solarFlow2400AC" (zoals de Zendure het lokaal noemt) → "SolarFlow 2400 AC". */
export function productNaam(product) {
  const tekst = String(product ?? '').trim();
  if (!tekst) return '';
  return tekst
    .replace(/^solarflow/i, 'SolarFlow ')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .replace(/^./, (l) => l.toUpperCase());
}

/**
 * Sinds wanneer elk apparaat niet antwoordt. `problemen` (sleutel → fout) houdt
 * meetAlles bij; hier onthouden we wanneer het misging (ms) en vergeten we dat
 * zodra het weer lukt.
 */
export function volgFouten(problemen, sinds, nu) {
  for (const sleutel of problemen.keys()) if (!sinds.has(sleutel)) sinds.set(sleutel, nu);
  for (const sleutel of [...sinds.keys()]) if (!problemen.has(sleutel)) sinds.delete(sleutel);
  return sinds;
}

const rondW = (w) => (typeof w === 'number' && Number.isFinite(w) ? Math.round(w) : null);

/**
 * @param {object} instellingen  uit laadInstellingen
 * @param {{ sinds: Map<string, number>, homewizard: Array<{ meter, w }>, zendureStand: object|null,
 *           zendureP1: number|null, zendureProduct: string|null, omvormer?: object|null, omvormerType?: string|null }} meting
 *   omvormer: het blok van de GoodWe (omvormerVoorApp); omvormerType: "GW8K-DT", of null
 */
export function gekoppeldVoorApp(instellingen, { sinds, homewizard, zendureStand, zendureP1, zendureProduct, omvormer = null, omvormerType = null }) {
  const status = (sleutel, w) => {
    const fout = sinds.get(sleutel);
    return { ok: fout === undefined, sinds: fout === undefined ? null : new Date(fout).toISOString(), w: fout === undefined ? rondW(w) : null };
  };
  const lijst = instellingen.homewizard.map((meter) => {
    const w = homewizard.find((h) => h.meter.sleutel === meter.sleutel)?.w ?? null;
    return {
      sleutel: meter.sleutel,
      naam: meter.naam,
      merk: 'HomeWizard',
      soort: meter.rol === 'net' ? 'P1-meter' : 'kWh-meter',
      rol: meter.rol,
      manier: meter.code ? 'v2' : 'v1',
      adres: meter.adres,
      ...status(meter.sleutel, w),
    };
  });
  const z = instellingen.zendure;
  if (z) {
    lijst.push({
      sleutel: 'zendure',
      naam: 'Zendure-batterij',
      merk: 'Zendure',
      soort: productNaam(zendureStand?.product ?? zendureProduct) || 'SolarFlow',
      rol: 'batterij',
      // Lokaal met de cloud als reserve: zolang hij lokaal niet antwoordt 'cloud-reserve' (zendureMetReserve).
      manier: z.manier !== 'lokaal' ? 'cloud' : zendureStand?.bron === 'cloud-reserve' ? 'cloud-reserve' : 'lokaal',
      adres: z.manier === 'lokaal' ? z.adres : null,
      // Via de cloud komt er soms gewoon niets, zonder fout: dan antwoordt hij ook niet.
      ...(zendureStand ? status('zendure', zendureStand.batterij_w ?? null) : { ...status('zendure', null), ok: false }),
    });
  }
  if (instellingen.zendure_p1) {
    lijst.push({
      sleutel: 'zendure-p1',
      naam: 'Zendure P1-meter',
      merk: 'Zendure',
      soort: 'P1-meter',
      rol: 'vergelijk',
      manier: 'lokaal',
      adres: instellingen.zendure_p1.adres,
      ...status('zendure-p1', zendureP1),
    });
  }
  if (instellingen.goodwe) {
    // 's Nachts slaapt hij: dat is geen storing (ok), maar er is ook geen vermogen.
    lijst.push({
      sleutel: 'goodwe',
      naam: 'Omvormer',
      merk: 'GoodWe',
      soort: omvormerType ?? 'omvormer',
      rol: 'omvormer',
      manier: 'lokaal',
      adres: instellingen.goodwe.adres,
      ...status('goodwe', omvormer?.w ?? null),
    });
  }
  return lijst;
}

/** Zoveel meldingen gaan hooguit mee, elk zo lang (dezelfde grenzen als ontvangMeting/controle.js). */
export const HOOGSTENS_MELDINGEN = 8;
export const MELDING_TEKENS = 160;

/** Geen adressen in de app: kijkers zien ze ook bij de apparaten niet (base44/shared/huizen.js). */
const zonderAdres = (tekst) => String(tekst).replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, 'het adres');

/**
 * Wat er mis is, in gewone woorden, voor bovenaan Apparaten: zo hoeft niemand
 * brug.log te lezen. Per melding een soort, de tekst (met de opdracht erbij
 * als die er is) en sinds wanneer. Geen geheimen en geen adressen.
 *
 * @param {object} instellingen  uit laadInstellingen (alleen de namen van de meters)
 * @param {{ problemen: Map<string, string>, sinds: Map<string, number>, prijzen?: { tekst, sinds }|null,
 *           opslag?: { tekst, sinds }|null, bedragen?: string|null, zendureReserve?: number|null, nu: number }} o
 *   zendureReserve: sinds wanneer (ms) de Zendure via de cloud gaat omdat hij lokaal niet antwoordt
 *   zonVerbruik: zonnemeters die verbruik meten ({ tekst, sinds }, zie maakVerbruikWacht in samenvoegen.mjs)
 *   adressen: apparaten die op een nieuw adres teruggevonden zijn ({ tekst, sinds }, adressen.mjs)
 *   omvormer: isolatie of lekstroom buiten de grens ({ tekst, sinds }, omvormerMeldingVolger in goodwe.mjs)
 */
export function meldingenVoorApp(
  instellingen,
  { problemen, sinds, prijzen = null, opslag = null, bedragen = null, zendureReserve = null, zonVerbruik = [], net = [], adressen = [], omvormer = [], spanning = [], nu },
) {
  const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
  const naamVan = (sleutel) =>
    instellingen.homewizard.find((m) => m.sleutel === sleutel)?.naam ??
    (instellingen.tuya ?? []).find((a) => a.sleutel === sleutel)?.naam ??
    { 'zendure-p1': 'Zendure P1-meter', zendure: 'Zendure-batterij', goodwe: 'Omvormer' }[sleutel] ??
    sleutel;
  const uit = [];
  if (opslag) uit.push({ soort: 'opslag', tekst: opslag.tekst, sinds: iso(opslag.sinds) });
  if (prijzen) uit.push({ soort: 'prijzen', tekst: prijzen.tekst, sinds: iso(prijzen.sinds) });
  if (zendureReserve !== null) {
    uit.push({ soort: 'reserve', tekst: 'Zendure-batterij: antwoordt lokaal niet; de stand komt nu via de Zendure-cloud (reserve).', sinds: iso(zendureReserve) });
  }
  for (const m of zonVerbruik) uit.push({ soort: 'meter', tekst: m.tekst, sinds: iso(m.sinds) });
  // Een apparaat dat van de router een ander adres kreeg en weer gevonden is (adressen.mjs, 1.3.0): een kwartier.
  for (const m of adressen) uit.push({ soort: 'adres', tekst: zonderAdres(m.tekst), sinds: iso(m.sinds) });
  for (const [sleutel, reden] of problemen) {
    uit.push({ soort: 'apparaat', tekst: `${naamVan(sleutel)}: ${zonderAdres(reden)}`, sinds: iso(sinds.get(sleutel) ?? nu) });
  }
  // Isolatie of lekstroom van de omvormer buiten de grens (1.4.0, omvormerMeldingVolger in goodwe.mjs):
  // zolang het zo is. De app zet het ook in het Logboek (één regel bij het begin, één bij het einde).
  for (const m of omvormer) uit.push({ soort: 'omvormer', tekst: m.tekst, sinds: iso(m.sinds) });
  // Uitval bij een hoge netspanning (spanning.mjs, 1.5.0): een kwartier lang, en zo één regel in het Logboek.
  for (const m of spanning) uit.push({ soort: 'spanning', tekst: m.tekst, sinds: iso(m.sinds) });
  // Wat de P1-meter aan storingen op het net telde (0.13.0): een kwartier lang, dan staat het in het logboek.
  for (const m of net) uit.push({ soort: 'net', tekst: m.tekst, sinds: iso(m.sinds) });
  if (bedragen) uit.push({ soort: 'bedragen', tekst: bedragen, sinds: null });
  return uit.slice(0, HOOGSTENS_MELDINGEN).map(({ soort, tekst, sinds: wanneer }) => ({
    soort,
    tekst: tekst.slice(0, MELDING_TEKENS),
    ...(wanneer ? { sinds: wanneer } : {}),
  }));
}
