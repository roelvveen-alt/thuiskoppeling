/**
 * Eén ronde van het programmaatje (meten, bijhouden, versturen), los van
 * brug.mjs zodat de tests hem kunnen nalopen (ronde.test.js, sinds 1.2.0).
 * brug.mjs geeft alles mee wat met de buitenwereld praat: de meters, de app,
 * de klok, het logboek, bewaren en opnieuw starten. Wat hier staat, rekent
 * alleen en beslist wat er gebeurt.
 *
 *   meetAlles   alle meters tegelijk lezen (een meter die niet antwoordt houdt even zijn laatste waarde)
 *   maakRonde   één ronde; geeft terug hoe lang er daarna gewacht wordt (null = stoppen)
 *   draaiLus    ronde, wachten, ronde, …: altijd na elkaar, nooit twee tegelijk
 */
import { maakMissers, volgKlok } from './bewaking.mjs';
import { dagVoorApp as dagVoorLogboek, logMeting, meterkastMetVandaag, middernacht } from './dag.mjs';
import { bedragenOntbreken } from './energyzero.mjs';
import { gekoppeldVoorApp, meldingenVoorApp, productNaam, volgFouten } from './gekoppeld.mjs';
import { leesHomeWizard } from './homewizard.mjs';
import { dagVoorApp, datumInNederland, telBij, vastPerDag, volgJaar } from './kosten.mjs';
import { gemeldVoorApp } from './opAfstand.mjs';
import { nominaalUitType, prijzenVan } from './omvormerPlan.mjs';
import { spanningenUit } from './spanning.mjs';
import { jaarVoorApp, naPlafond, prijsOp, prijsVoorApp, voorspellingVoorApp } from './prijzen.mjs';
import { maakMeting, metGeheugen, verbruikTekst } from './samenvoegen.mjs';
import { metTuya } from './tuya.mjs';
import { kiesExtrasPassend, pasInGrootte } from './versturen.mjs';
import { veldRegel } from './kennis.mjs';
import { inGewoneWoorden } from './web.mjs';
import { leesZendureP1 } from './zendure.mjs';
import { isNacht, zonVoorApp } from './zon.mjs';

/** Kent de app de sleutel niet (401), dan blijven we meten en proberen het zo vaak opnieuw. */
export const SLEUTEL_OPNIEUW_MS = 5 * 60_000;
/** Zo vaak het logboek klein houden en een samenvatting van haperende meters. */
export const ELK_UUR_MS = 60 * 60_000;
/**
 * Weigert de app de extra's (een blok klopt niet, of te groot), dan zo lang alleen de stand.
 * Hoe vaak elk extra blok meegaat: EXTRA_ELKE_MS in versturen.mjs (de dag, koppelingen en het
 * brugblok elke minuut; herkend als het verandert en elke minuut; voorspelling en weer als ze
 * veranderen en eens per kwartier, zodat ze er ook na een deploy of hapering bij Base44 staan).
 */
export const EXTRA_PAUZE_MS = 15 * 60_000;
/** Na een ronde altijd minstens zo lang wachten, ook als hij langer duurde dan de 5 s. */
export const MINSTENS_WACHT_MS = 1000;
export const SLEUTEL_WEG =
  'De app kent deze sleutel niet (meer). Zet de nieuwe erin met: node brug.mjs instellen (in de app: Instellingen › Delen › Nieuwe sleutel). Ik blijf meten en probeer het elke 5 minuten opnieuw.';

/**
 * Een lezing die misging. Pas na een paar keer op rij (maakMissers) staat het
 * apparaat in `problemen` (dus "geen antwoord" in de app) en komt er een regel
 * in het logboek; daarna alleen nog als de reden verandert.
 */
function gemist(log, missers, problemen, sleutel, naam, fout) {
  const tekst = inGewoneWoorden(fout);
  if (!missers.mis(sleutel)) return;
  if (problemen.get(sleutel) !== tekst) log(`${naam}: ${tekst}`);
  problemen.set(sleutel, tekst);
}

/** Een lezing die lukte; was het apparaat weg, dan een regel dat het er weer is. */
function gelukt(log, missers, problemen, sleutel, naam) {
  if (missers.goed(sleutel) && problemen.has(sleutel)) log(`${naam}: antwoordt weer.`);
  problemen.delete(sleutel);
}

/**
 * Alles één keer meten, alle meters tegelijk: zo zien de meter "zon en
 * batterij" en de Zendure hetzelfde moment, en klopt de uitgerekende zon.
 * Een meter die niet antwoordt houdt even zijn laatste waarde.
 *
 * `lees` (voor de tests): hoe een HomeWizard en de Zendure P1 gelezen worden.
 * `adressen` (adressen.mjs, sinds 1.3.0): hoort na elke lezing of het apparaat antwoordde,
 * geeft de lezers mee wat we van elk apparaat weten (plek), en zoekt na de ronde op de
 * achtergrond wat er een tijd niet (of als een ander apparaat) antwoordt.
 */
export async function meetAlles({
  instellingen,
  zendure,
  geheugen,
  problemen,
  historie,
  missers = maakMissers(),
  goodwe = null,
  tuya = null,
  versie,
  log,
  nuMs = Date.now,
  lees = { homewizard: leesHomeWizard, zendureP1: leesZendureP1 },
  adressen = null,
}) {
  const nu = nuMs();
  const plek = (sleutel) => adressen?.plek(sleutel) ?? null;
  const gelezen = (sleutel, uit) => adressen?.gelezen(sleutel, { nu, ...uit });
  const mis = (...a) => gemist(log, missers, problemen, ...a);
  const goed = (...a) => gelukt(log, missers, problemen, ...a);
  // Tuya (tuya.mjs): elk apparaat hooguit eens per 20 s, tussendoor de laatste stand.
  const tuyaLezing = (async () => {
    if (!tuya) return [];
    const lezingen = await tuya.ronde();
    for (const { apparaat, fout, gelezen } of lezingen) {
      if (!gelezen) continue;
      if (fout) mis(apparaat.sleutel, `${apparaat.naam} (${apparaat.adres})`, fout);
      else goed(apparaat.sleutel, `${apparaat.naam} (${apparaat.adres})`);
    }
    return lezingen;
  })();
  // 's Nachts geen zon, de Zendure van de groepsmeter (zie groepVerdelen in samenvoegen.mjs), en de omvormer slaapt.
  const nacht = isNacht(nu, datumInNederland(nu), instellingen.plaats);
  // De omvormer: geen antwoord 's nachts (of als hij net ging slapen) is geen fout (goodweVolger).
  let omvormerRegisters = null;
  const omvormerLezing = (async () => {
    if (!goodwe) return null;
    const uit = await goodwe.ronde({ nacht, datum: datumInNederland(nu) });
    if (uit.gelezen && uit.fout) mis('goodwe', goodwe.naam, uit.fout);
    else if (uit.gelezen) goed('goodwe', goodwe.naam);
    // Terugvinden: alleen overdag telt geen antwoord (of slapen) mee; 's nachts slaapt hij gewoon.
    if (uit.gelezen) gelezen('goodwe', { ok: !uit.fout && !['slaapt', 'weg'].includes(uit.blok?.stand), rust: nacht });
    omvormerRegisters = uit.registers ?? null;
    return uit.blok;
  })();
  const zendureLezing = (async () => {
    const lokaal = instellingen.zendure?.manier === 'lokaal';
    try {
      const stand = await zendure.lees();
      goed('zendure', 'Zendure');
      // Via de cloud als reserve: lokaal antwoordde hij niet (of er zat een andere Zendure).
      if (lokaal && stand) gelezen('zendure', { ok: stand.bron !== 'cloud-reserve' });
      return stand;
    } catch (fout) {
      mis('zendure', 'Zendure', fout);
      if (lokaal) gelezen('zendure', { ok: false });
      return null;
    }
  })();
  // Zonder geheugen: een oude waarde zou een verschil laten zien dat er niet is.
  const zendureP1Lezing = (async () => {
    if (!instellingen.zendure_p1) return null;
    try {
      const w = await lees.zendureP1(instellingen.zendure_p1.adres, { plek: plek('zendure-p1') });
      goed('zendure-p1', `Zendure P1-meter (${instellingen.zendure_p1.adres})`);
      gelezen('zendure-p1', { ok: true });
      return w;
    } catch (fout) {
      mis('zendure-p1', `Zendure P1-meter (${instellingen.zendure_p1.adres})`, fout);
      gelezen('zendure-p1', { ok: false });
      return null;
    }
  })();
  const homewizard = await Promise.all(
    instellingen.homewizard.map(async (meter) => {
      let lezing = null;
      try {
        lezing = await lees.homewizard(meter, { plek: plek(meter.sleutel) });
        goed(meter.sleutel, `${meter.naam} (${meter.adres})`);
        gelezen(meter.sleutel, { ok: true });
      } catch (fout) {
        mis(meter.sleutel, `${meter.naam} (${meter.adres})`, fout);
        gelezen(meter.sleutel, { ok: false });
      }
      return {
        meter,
        w: metGeheugen(geheugen, meter.sleutel, lezing?.w ?? null, nu),
        tellers: lezing?.tellers ?? null,
        fasen: lezing?.fasen ?? null,
        storingen: lezing?.storingen ?? null,
        // 1.4.0: tarief, gas en meer (alleen de P1-meter), en de kennislijst (een functie, zie lezingUit).
        meterkast: lezing?.meterkast ?? null,
        kennis: lezing?.kennis ?? null,
        // 1.5.0: de spanning per fase van elke meter (spanningUit), voor de spanningswacht.
        spanning: lezing?.spanning ?? null,
      };
    }),
  );
  let zendureStand = await zendureLezing;
  if (zendureStand) geheugen.set('zendure', { stand: zendureStand, moment: nu });
  else if (nu - (geheugen.get('zendure')?.moment ?? 0) < 60_000) zendureStand = geheugen.get('zendure').stand;
  // De tellers van de meterkast (P1): daarmee rekenen de kosten van vandaag.
  const p1 = homewizard.find((h) => h.meter.rol === 'net' && h.tellers?.afname_kwh !== null && h.tellers?.afname_kwh !== undefined);
  const zendureP1 = await zendureP1Lezing;
  const omvormer = await omvormerLezing;
  const tuyaLezingen = await tuyaLezing;
  // Iets een tijd weg, of een ander apparaat op zijn adres? Dan zoeken, op de achtergrond (niet afwachten).
  adressen?.tik(nuMs());
  return {
    meting: metTuya(
      maakMeting({
        homewizard,
        zendure: zendureStand,
        zendureP1,
        fasen: homewizard.find((h) => h.meter.rol === 'net' && h.fasen?.length)?.fasen ?? null,
        omvormer,
        meterkast: homewizard.find((h) => h.meter.rol === 'net' && h.meterkast)?.meterkast ?? null,
        versie,
        historie,
        nacht,
      }),
      tuyaLezingen,
    ),
    tuyaLezingen,
    homewizard,
    zendureStand,
    zendureP1,
    omvormer,
    omvormerRegisters,
    nacht,
    tellers: p1?.tellers ?? null,
  };
}

/**
 * Hoe een draaiend programmaatje begint: wat de ronde van keer tot keer
 * onthoudt. brug.mjs bewaart `kosten` en `logboek` (vandaag.json), en de
 * waakhond kijkt naar `rondSinds` (een ronde die blijft hangen).
 */
export function beginStaat({ kosten, basis, nu, klok, instellingenOp }) {
  return {
    kosten,
    // Vandaag per kwartier (dag.mjs); staat naast de kosten in vandaag.json.
    logboek: kosten?.logboek ?? null,
    kostenBewaard: nu,
    wacht: basis,
    verstuurd: 0,
    laatsteFout: '',
    laatsteMelding: nu,
    // Weigert de app een blok, dan tot dan alleen de stand.
    extraNietVoor: 0,
    // Van welke meter het net komt; één regel in het logboek als dat wisselt (zie samenvoegen.mjs).
    netBron: null,
    // Sinds wanneer de Zendure via de cloud gaat omdat hij lokaal niet antwoordt (een melding in de app).
    reserveSinds: null,
    // Kent de app de sleutel niet, dan tot dan alleen meten (en vandaag bijhouden).
    appNietVoor: 0,
    uurOp: klok,
    klokStaat: null,
    instellingenOp,
    // Sinds wanneer de ronde van nu loopt (klok van het proces), of null tussen twee rondes.
    rondSinds: null,
  };
}

/**
 * Eén ronde, met alles wat naar buiten gaat als afhankelijkheid (brug.mjs geeft de echte mee,
 * de tests een nep). `ronde()` geeft terug hoeveel ms er daarna gewacht wordt, of null als
 * het programmaatje opnieuw moet starten (dan heeft `afsluiten` het al geregeld).
 *
 * @param {object} d
 * @param {object} d.staat          uit beginStaat; wordt bijgewerkt
 * @param {object} d.instellingen
 * @param {number} d.basis          elke_seconden × 1000
 * @param {() => Promise<object>} d.meet  één keer alles meten (meetAlles)
 * @param {(meting: object) => Promise<object>} d.verstuur  naar de app (verstuurMetTerugval)
 * @param {() => number} d.nu       de klok van de telefoon (Date.now)
 * @param {() => number} d.klok     de klok van het proces (performance.now)
 * @param {(tekst: string) => void} d.log
 * @param {() => void} d.bewaar     vandaag.json en herkennen.json bewaren
 * @param {(code: number) => void} d.afsluiten  netjes stoppen (start.sh of systemd start opnieuw)
 */
export function maakRonde(d) {
  const { staat: st, instellingen, basis, log } = d;
  const { herkenner, verbruikWacht, netStoringen, missers, problemen, sindsFout, plan, prijzen, weer, opAfstand, zendure, goodwe } = d;
  // 1.4.0, allebei niet verplicht (de tests van eerder geven ze niet): de kennislijst en de meldingen van de omvormer.
  const kennis = d.kennis ?? null;
  const omvormerMeldingen = d.omvormerMeldingen ?? null;
  // 1.4.0: hoeveel kWh er echt in of uit de batterij gaat per procent (batterijLeren.mjs); niet verplicht.
  const batterijLeren = d.batterijLeren ?? null;
  // 1.5.0: de omvormer begrenzen bij een negatieve terugleverprijs (omvormerPlan.mjs); niet verplicht, zonder GoodWe null.
  const stuurder = d.stuurder ?? null;
  // 1.5.0: de spanningswacht (spanning.mjs), alleen lezen; niet verplicht.
  const spanning = d.spanning ?? null;
  // Elke reden één keer in het logboek.
  const gemeld = new Set();
  const meldEenKeer = (tekst) => {
    if (gemeld.has(tekst)) return;
    if (gemeld.size > 100) gemeld.clear();
    gemeld.add(tekst);
    log(tekst);
  };
  const metHomeWizardP1 = instellingen.homewizard.some((m) => m.rol === 'net');

  async function ronde() {
    const begin = d.nu();
    st.klokStaat = volgKlok(st.klokStaat, begin);
    if (st.klokStaat.terug) {
      meldEenKeer('De klok van de telefoon sprong terug; ik wacht tot hij weer klopt (de stand van vandaag en dit jaar blijft zoals hij was).');
      return basis;
    }
    // Verandert instellingen.json (de instelhulp, een nieuwe sleutel, een code), dan opnieuw starten met de nieuwe.
    const veranderd = d.bestandOp(d.instellingenPad);
    if (veranderd !== st.instellingenOp) {
      st.instellingenOp = veranderd;
      const nieuw = d.probeerInstellingen(d.instellingenPad);
      if (nieuw.ok) {
        log('instellingen.json is veranderd; ik start opnieuw met de nieuwe instellingen.');
        d.afsluiten(0);
        return null;
      }
      log(`instellingen.json is veranderd maar klopt nog niet (${nieuw.fouten.join('; ')}); ik ga door met de oude.`);
    }
    if (d.klok() - st.uurOp >= ELK_UUR_MS) {
      st.uurOp = d.klok();
      for (const [sleutel, keer] of missers.samenvatting()) {
        const naam =
          instellingen.homewizard.find((m) => m.sleutel === sleutel)?.naam ??
          instellingen.tuya.find((a) => a.sleutel === sleutel)?.naam ??
          ({ 'zendure-p1': 'Zendure P1-meter', goodwe: 'GoodWe-omvormer' }[sleutel] ?? 'Zendure');
        log(`${naam}: ${keer} keer geen antwoord in het afgelopen uur.`);
      }
      if (d.houdLogKlein()) log('Het logboek werd te groot; het oude staat nu in brug.log.1.');
    }
    st.rondSinds = d.klok();
    const { meting, tellers, homewizard, zendureStand, zendureP1, omvormer, omvormerRegisters = null, nacht } = await d.meet();
    const nu = d.nu();
    herkenner.ronde({ nu, meting });
    const herkend = herkenner.voorApp(nu);
    // De extra blokken van deze ronde (wat er mee moet), en hun kern om te zien of ze veranderden.
    const extras = {};
    const kernen = {};
    // Zonder de basis en de week: die kruipen (de warmtepomp, de kWh), en dan zou het blok elke ronde meegaan.
    const herkendKern = herkend ? JSON.stringify({ nu: herkend.nu, recent: herkend.recent, onbekend: herkend.onbekend }) : '';
    if (herkend && plan.nodig('herkend', nu, herkendKern)) {
      extras.herkend = herkend;
      kernen.herkend = herkendKern;
    }
    const verbruik = verbruikWacht.ronde({ homewizard, meting, nacht, omvormerW: omvormer?.w ?? null, nu });
    for (const v of verbruik.nieuw) log(verbruikTekst(v));
    const zonVerbruik = verbruik.gemeld.map((v) => ({ tekst: verbruikTekst(v), sinds: v.sinds }));
    const p1 = homewizard.find((h) => h.meter.rol === 'net' && h.storingen);
    if (p1) for (const zin of netStoringen.ronde(p1.storingen, nu, p1.meter.naam)) log(zin);
    volgFouten(problemen, sindsFout, nu);
    st.logboek = logMeting(st.logboek, meting, nu);
    // Gas, water en warmte van vandaag bij de standen (1.4.0): zo staan ze elke meting op Nu.
    if (meting.meterkast) meting.meterkast = meterkastMetVandaag(meting.meterkast, st.logboek);
    // Wat het van de batterij leerde (1.4.0): mee als batterij_info.geleerd; een oudere functie laat het stil vallen.
    if (batterijLeren) {
      const zin = batterijLeren.ronde(meting, nu);
      if (zin) log(zin);
      const geleerd = batterijLeren.voorApp();
      if (geleerd && meting.batterij_info) meting.batterij_info = { ...meting.batterij_info, geleerd };
    }
    // De spanningswacht (1.5.0): netspanning per fase, en of de omvormer uitviel bij een hoge spanning. Alleen lezen.
    if (spanning) {
      const zonW = typeof omvormer?.w === 'number' ? omvormer.w : omvormer?.stand === 'storing' || omvormer?.stand === 'wacht' ? 0 : meting.zon_w;
      for (const zin of spanning.ronde({ nu, ...spanningenUit({ meting, omvormer, homewizard }), zonW, nacht, zelfBegrensd: stuurder?.staat?.bekend === 'begrensd', storingen: omvormer?.storingen ?? [] })) log(zin);
    }
    // Isolatie en lekstroom van de omvormer (1.4.0): een melding als het buiten de grens blijft.
    if (omvormerMeldingen) for (const zin of omvormerMeldingen.ronde(omvormer, nu)) log(zin);
    // Wat elk apparaat teruggeeft (1.4.0): hooguit eens per dag per apparaat een lijst met veldnamen.
    if (kennis) {
      for (const h of homewizard) {
        if (h.kennis) kennis.zie(h.meter.sleutel, `HomeWizard ${h.meter.rol === 'net' ? 'P1-meter' : 'kWh-meter'} (${h.meter.code ? 'v2' : 'v1'})`, h.kennis, nu);
      }
      if (typeof zendureStand?.kennis === 'function') kennis.zie('zendure', productNaam(zendureStand.product ?? zendure?.product) || 'Zendure', zendureStand.kennis, nu);
      if (omvormerRegisters) {
        kennis.zie('goodwe', goodwe?.type ? `GoodWe ${goodwe.type}` : 'GoodWe-omvormer', () => Object.entries(omvormerRegisters).map(([nr, v]) => veldRegel(`r${nr}`, v)).filter(Boolean), nu);
      }
    }
    if (metHomeWizardP1 && meting.net_bron !== st.netBron) {
      if (meting.net_bron === 'zendure-p1') log('De HomeWizard P1 antwoordt niet: het net en de kosten komen nu van de Zendure P1.');
      else if (st.netBron === 'zendure-p1' && meting.net_bron === 'homewizard') log('De HomeWizard P1 antwoordt weer: het net en de kosten komen weer van de HomeWizard.');
    }
    st.netBron = meting.net_bron;
    st.reserveSinds = zendureStand?.bron === 'cloud-reserve' ? (st.reserveSinds ?? nu) : null;
    let tijdvak = null;
    if (prijzen) {
      // Dit jaar al 7.500 kWh teruggeleverd? Dan geen Zonnebonus meer (zie volgJaar en naPlafond).
      st.kosten = { ...st.kosten, jaar: volgJaar(st.kosten.jaar, tellers, nu, instellingen.teruglevering_dit_jaar) };
      tijdvak = naPlafond(await prijzen.nu(), st.kosten.jaar.teruglevering_kwh);
      // Wat er sinds de vorige keer door de meterkast ging, met de prijs van nu (zie kosten.mjs).
      // Zonder tellers van de HomeWizard telt de Zendure P1 als reserve (zie kosten.mjs).
      // Na een lang gat telt elk kwartier van het gat met zijn eigen prijs (prijsVoor).
      const plafond = st.kosten.jaar.teruglevering_kwh;
      st.kosten = telBij(st.kosten, tellers, tijdvak, nu, { reserveW: zendureP1, prijsVoor: (ms) => naPlafond(prijsOp(prijzen.alle(), ms), plafond) });
      meting.prijs = prijsVoorApp(tijdvak, prijzen.naam);
      meting.vandaag = dagVoorApp(st.kosten.dag, vastPerDag(instellingen.vaste_kosten, st.kosten.dag.datum));
      meting.jaar = jaarVoorApp(st.kosten.jaar);
      const voorspelling = voorspellingVoorApp(prijzen.alle(), {
        vanaf: middernacht(nu),
        teruggeleverdDitJaarKwh: st.kosten.jaar.teruglevering_kwh,
        bron: prijzen.naam,
      });
      const kern = voorspelling ? JSON.stringify(voorspelling) : null;
      if (voorspelling && plan.nodig('voorspelling', nu, kern)) {
        extras.voorspelling = voorspelling;
        kernen.voorspelling = kern;
      }
    }
    // De omvormer bij een negatieve terugleverprijs (1.5.0): plan uit de prijzen, en alleen op de randen
    // van een blok schrijven (omvormerPlan.mjs). Alleen als de eigenaar het in de app aanzette.
    if (stuurder) {
      const kwhDitJaar = st.kosten?.jaar?.teruglevering_kwh ?? 0;
      const jaar = datumInNederland(nu).slice(0, 4);
      try {
        await stuurder.ronde({
          nu,
          tijdvakken: prijzen ? prijzen.alle() : [],
          prijsVan: (t, opties) => prijzenVan(t, { ...opties, kwhDitJaar, jaar }),
          omvormerStand: omvormer?.stand ?? null,
          // Live bijsturen op wat het huis doet: het net (P1), alle zon, de batterij en wat de GoodWe zelf levert.
          meting: { netW: meting.net_w, zonW: meting.zon_w, batterijW: meting.batterij_w, omvormerW: omvormer?.w ?? null },
          nominaal: nominaalUitType(goodwe?.type),
        });
      } catch (fout) {
        // Een fout hier houdt de meting nooit tegen; de besturing geeft zelf vrij bij twijfel.
        meldEenKeer(`Omvormer sturen: ${inGewoneWoorden(fout)}`);
      }
      if (meting.omvormer) meting.omvormer = { ...meting.omvormer, sturen: stuurder.voorApp(nu) };
    }
    // Het weer (weer.mjs): op de achtergrond hooguit eens per uur opgehaald; geen aanroep extra naar de app.
    weer.tik();
    const weerBlok = weer.blok();
    const weerKern = weerBlok ? JSON.stringify(weerBlok) : null;
    if (weerBlok && plan.nodig('weer', nu, weerKern)) {
      extras.weer = weerBlok;
      kernen.weer = weerKern;
    }
    if (nu < st.extraNietVoor) {
      for (const blok of Object.keys(extras)) delete extras[blok];
    } else {
      if (plan.nodig('dag', nu)) {
        const dag = dagVoorLogboek(st.logboek);
        // Per apparaat van vandaag (0.12.0, herkennen.mjs): kWh en keer, en de basis; voor Overzicht › Apparaten.
        // Een oudere functie laat die velden stil vallen (controle.js neemt alleen wat hij kent).
        if (dag) extras.dag = Object.assign(dag, herkenner.dagVoorApp(dag.datum));
      }
      // De spanningswacht (1.5.0): eens per minuut; een oudere functie laat het blok stil vallen.
      const spanningBlok = spanning && plan.nodig('spanning', nu) ? spanning.voorApp(nu) : null;
      if (spanningBlok) extras.spanning = spanningBlok;
      // De kennislijst (1.4.0): alleen als er een nieuwe is (hooguit eens per dag per apparaat).
      const kennisBlok = kennis?.blok() ?? null;
      if (kennisBlok) extras.kennis = kennisBlok;
      if (plan.nodig('gekoppeld', nu)) {
        extras.gekoppeld = gekoppeldVoorApp(instellingen, {
          sinds: sindsFout,
          homewizard,
          zendureStand,
          zendureP1,
          zendureProduct: zendure.product,
          omvormer,
          omvormerType: goodwe?.type ?? null,
        });
      }
    }
    if (nu >= st.extraNietVoor && plan.nodig('brug', nu)) {
      const bedragen = prijzen ? bedragenOntbreken(nu) : null;
      if (bedragen) meldEenKeer(bedragen);
      extras.brug = {
        versie: d.versie,
        gestart: d.gestart,
        elke_seconden: instellingen.elke_seconden,
        prijzen: prijzen ? (tijdvak?.bron ?? prijzen.naam) : null,
        meldingen: meldingenVoorApp(instellingen, {
          problemen,
          sinds: sindsFout,
          prijzen: prijzen?.probleem() ?? null,
          opslag: d.opslagFout(),
          bedragen,
          zendureReserve: st.reserveSinds,
          zonVerbruik,
          net: netStoringen.meldingen(nu),
          adressen: d.adressen?.meldingen(nu) ?? [],
          omvormer: omvormerMeldingen?.meldingen() ?? [],
          spanning: spanning?.meldingen() ?? [],
          nu,
        }),
        // Zon op en onder van vandaag: daarop schakelt de tekening in de app tussen dag en nacht.
        zon: zonVoorApp(datumInNederland(nu), instellingen.plaats),
        // Het publieke deel van het sleutelpaar, en wat er al op afstand is opgepakt (opAfstand.mjs).
        ...(opAfstand ? { publiek: opAfstand.publiek, op_afstand: gemeldVoorApp(opAfstand) } : {}),
        // Herkennen (0.11.0): het kan labels aannemen, en het nieuwste dat het al heeft. Dan geeft de app alleen nieuwere terug.
        herkent: true,
        ...(herkenner.labelsOp ? { labels_op: herkenner.labelsOp } : {}),
      };
    }
    if (nu - st.kostenBewaard > 60_000) {
      d.bewaar();
      st.kostenBewaard = nu;
    }
    // Zoveel extra's als er passen, wat het langst wachtte eerst; de rest gaat de volgende ronde mee (versturen.mjs).
    // Past een blok zelfs met de stand alleen niet (veel accu's, 1.4.0), dan deze ronde de accu's korter.
    const gekozen = kiesExtrasPassend(meting, extras, plan.laatst);
    if (gekozen.teGroot.length) meldEenKeer(`De meting wordt te groot; ${gekozen.teGroot.join(' en ')} past niet mee.`);
    // Voor de zekerheid nog eens: past hij nooit, dan de grootste extra eruit.
    const { meting: past, weg } = pasInGrootte(gekozen.meting);
    if (weg.length) meldEenKeer(`De meting wordt te groot; ${weg.join(' en ')} gaat deze keer niet mee.`);
    if (nu < st.appNietVoor) {
      st.rondSinds = null;
      return Math.max(MINSTENS_WACHT_MS, basis - (d.nu() - begin));
    }
    const uit = await d.verstuur(past);
    if (uit.geweigerd) {
      st.extraNietVoor = nu + EXTRA_PAUZE_MS;
      meldEenKeer(`De app weigert een blok (${uit.geweigerd}); een kwartier alleen de stand van nu.`);
    }
    for (const reden of uit.overgeslagen ?? []) meldEenKeer(`De app sloeg over: ${reden}`);
    // De instelling voor de omvormer (1.5.0): elk goed antwoord zegt het; zonder (een oudere functie) staat het uit.
    if (uit.ok) stuurder?.zetInstelling(uit.omvormer_sturen ?? null);
    // Iets op afstand klaargezet (een cloudsleutel)? Overnemen; veranderde instellingen.json, dan netjes opnieuw starten.
    if (uit.op_afstand && d.pakOp(uit.op_afstand).veranderd) {
      d.afsluiten(0);
      return null;
    }
    // Labels uit de app ("Klopt", "Dat was …"): de handtekeningen bijwerken, en meteen bewaren.
    if (uit.herkend_labels && herkenner.zetLabels(uit.herkend_labels)) {
      log(`Herkennen: ${uit.herkend_labels.length} label(s) uit de app overgenomen.`);
      d.bewaarHerkennen();
    }
    // Alleen wat er echt in zat (en niet geweigerd werd) telt als verstuurd; de rest gaat de volgende ronde mee.
    if (uit.ok && !uit.geweigerd) {
      plan.verstuurd(past, kernen, nu);
      if (past.kennis) kennis?.verstuurd();
    }

    if (uit.ok) {
      st.verstuurd += 1;
      st.wacht = basis;
      if (st.verstuurd === 1) {
        log('Eerste stand staat in de app.');
        d.meldOpstart('eerste-stand');
      }
      if (st.laatsteFout) log('Versturen lukt weer.');
      st.laatsteFout = '';
      gemeld.delete(SLEUTEL_WEG);
      if (d.nu() - st.laatsteMelding > 30 * 60_000) {
        log(`Nog steeds bezig: ${st.verstuurd} keer verstuurd.`);
        st.laatsteMelding = d.nu();
      }
    } else if (uit.status === 401) {
      // Niet stoppen: start.sh zou hem elke 30 s opnieuw starten, met elke keer een inlog bij
      // Zendure en Zonneplan. Blijven meten; een nieuwe sleutel in instellingen.json start hem opnieuw.
      st.appNietVoor = nu + SLEUTEL_OPNIEUW_MS;
      meldEenKeer(SLEUTEL_WEG);
      st.laatsteFout = 'sleutel';
    } else {
      if (uit.status === 429) st.wacht = Math.min(st.wacht * 2, 120_000);
      // De app of het internet hapert (5xx, geen antwoord): een milde pauze die oploopt, 5 → 10 → 20 → 30 s.
      else if (uit.status === 0 || uit.status >= 500) st.wacht = Math.max(basis, Math.min(Math.max(st.wacht, basis) * 2, 30_000));
      if (uit.fout !== st.laatsteFout) log(`Versturen lukt niet: ${uit.fout}${uit.status === 429 ? ` (Base44 remt; even ${st.wacht / 1000} s wachten)` : ''}`);
      st.laatsteFout = uit.fout;
    }
    st.rondSinds = null;
    return Math.max(MINSTENS_WACHT_MS, st.wacht - (d.nu() - begin));
  }

  return { ronde, meldEenKeer };
}

/**
 * Ronde na ronde: pas als een ronde helemaal klaar is (meten, versturen) wordt er gewacht, en
 * pas daarna begint de volgende. Zo lopen er nooit twee tegelijk, ook niet als een ronde langer
 * duurt dan de 5 s (dan wacht hij daarna nog 1 s). Geeft een ronde null, dan stopt de lus.
 * `door` (voor de tests): zolang die true geeft, gaat het door.
 */
export async function draaiLus({ ronde, slaap, door = () => true }) {
  while (door()) {
    const wacht = await ronde();
    if (wacht === null) return;
    await slaap(wacht);
  }
}
