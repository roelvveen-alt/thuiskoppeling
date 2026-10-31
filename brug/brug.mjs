#!/usr/bin/env node
/**
 * Het programmaatje thuis: leest je HomeWizard-meters, je Zendure-batterij en
 * (als je die hebt) je GoodWe-omvormer en Tuya-apparaten, en stuurt de stand elke ~5 seconden
 * naar de app in Base44. Alles alleen lezen: er gaat niets naar de apparaten. Eén
 * uitzondering (1.5.0, alleen als de eigenaar het in de app aanzet): de GoodWe-omvormer
 * begrenzen bij een negatieve terugleverprijs (omvormerSturen.mjs: de grens 40336 en, sinds
 * 1.6.0, de schakelaar van die grens 40327).
 *
 *   node brug.mjs                        meten en doorsturen (blijft draaien)
 *   node brug.mjs instellen [192.168.1]  instelhulp: zoekt je meters en vraagt de rest (Enter = voorstel)
 *   node brug.mjs proef                  één keer meten en laten zien, niets versturen
 *   node brug.mjs proef --versturen      … en de stand één keer naar de app (kloppen sleutel en adres?)
 *   node brug.mjs proef --alles          … met de hele meting erbij

 *   node brug.mjs zoek [192.168.1]       HomeWizard, Zendure en GoodWe in je netwerk zoeken
 *                                        (meer netwerken mag: zoek 192.168.1 192.168.0)
 *   node brug.mjs homewizard-code        codes maken voor HomeWizard API v2 (knopje per meter)
 *   node brug.mjs homewizard-code <ip>   alleen voor die ene meter
 *   node brug.mjs zonneplan-login        één keer inloggen bij Zonneplan, voor de stroomprijzen
 *   node brug.mjs omvormer-test          samen testen bij de omvormer: 2 minuten begrenzen (0%, dan kort 50%), dan vrij
 *   node brug.mjs status | herstart | stop   draait hij; opnieuw starten (na git pull); stoppen
 *                                        (onder systemd, zoals op een Chromebook, via systemctl)
 *   node brug.mjs nakijken               laadt alles en kloppen de instellingen (voor bijwerken.sh)

 *   node brug.mjs termux-boot            Android: na een herstart van de telefoon vanzelf starten
 *   sh start.sh                          Android: op de achtergrond aanzetten en aan houden
 *   sh bijwerken.sh                      veilig bijwerken (alleen vooruit, nakijken, anders terug)
 *
 * Draait op alles wat thuis altijd aanstaat en Node 20 of nieuwer heeft:
 * een Raspberry Pi, een NAS, een oude laptop. Zie de LEESMIJ in de hoofdmap.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { adressenPad, bewaarAdressen, laadAdressen, maakAdressen } from './adressen.mjs';
import { gewijzigdOp, houdLogKlein, KLOK_WACHT_HOOGSTENS_MS, klokKlopt, maakMissers, tijdstempel } from './bewaking.mjs';
import { bootScript, DIENST, dienstOpdracht, draaitAl, geefPlekVrij, meldOpstart, naastSystemd, neemPlek, onderSystemd, stuurStop } from './draaien.mjs';
import { energyZeroBron } from './energyzero.mjs';
import { goodweVolger, leesGoodWe, leesGoodWeSerie, leesGoodWeType, metExtra, omvormerMeldingVolger, omvormerZinnen } from './goodwe.mjs';
import { maakBatterijLeren } from './batterijLeren.mjs';
import { bewaarHerkennen, laadHerkennen, maakHerkenner } from './herkennen.mjs';
import { leesHomeWizard, maakCode, meterkastZinnen, netStoringVolger, zwakkeControle } from './homewizard.mjs';
import { bewaarInstellingen, leesBestaand, maakVraag, voerUit } from './instellen.mjs';
import { laadInstellingen, leesJsonBestand, maakPrive, probeerInstellingen, sleutelVan, STANDAARD_PAD } from './instellingen.mjs';
import { kennisVolger } from './kennis.mjs';
import { bewaarStand, datumInNederland, laadStand, vastPerDag, volgJaar } from './kosten.mjs';
import { metReserve, prijsOp, prijsVolger, prijsVoorApp } from './prijzen.mjs';
import { maakStuurder, nominaalUitType, planUit, planZinnen, prijzenVan } from './omvormerPlan.mjs';
import { leesGrens, leesSchakelaar, omvormerVerbinding } from './omvormerSturen.mjs';
import { luisterOnderbreken, samenTest } from './omvormerTest.mjs';
import { BRON_TEKST, spanningenUit, spanningWacht } from './spanning.mjs';
import { kortAfdruk, laadOfMaak, leesPubliek, padNaast, pakOp } from './opAfstand.mjs';
import { beginStaat, draaiLus, maakRonde, meetAlles } from './ronde.mjs';
import { tuyaVolger } from './tuya.mjs';
import { maakVerbruikWacht, verbruikTekst, zonmetersMetVerbruik } from './samenvoegen.mjs';
import { antwoordInWoorden, EXTRA_BLOKKEN, extraPlanner, metingKort, verstuur, verstuurMetTerugval } from './versturen.mjs';
import { versieMetCommit } from './versie.mjs';
import { haalWeer, nuRegel, weerRegel, weerVolger } from './weer.mjs';
import { inGewoneWoorden, slaap } from './web.mjs';
import { batterijZinnen, houdZendureCloud, leesZendureLokaal, zendureMetReserve } from './zendure.mjs';
import { bewaarSessie, geefInlogcode, laadSessie, vraagInlogcode, zonneplanBron } from './zonneplan.mjs';
import { bereik, netwerkenUitTekst, zoekApparaten, zoekOpnieuw } from './zoek.mjs';

/** De versie met de commit erbij ('0.5.2+680c351'), zie versie.mjs. */
const VERSIE = versieMetCommit();
/** Elke regel met datum en tijd in Nederlandse tijd ('30-10 10:37:29'). */
const log = (tekst) => console.log(`${tijdstempel(Date.now())}  ${tekst}`);

/** De sessie bij Zonneplan en de stand van vandaag; allebei in .gitignore. */
const SESSIE_PAD = process.env.BRUG_ZONNEPLAN_SESSIE || new URL('./zonneplan-sessie.json', import.meta.url);
const VANDAAG_PAD = process.env.BRUG_VANDAAG || new URL('./vandaag.json', import.meta.url);
/** Wat het herkennen van apparaten onthoudt (herkennen.mjs): labels, nachten, de laatste gebeurtenissen; ook in .gitignore. */
const HERKENNEN_PAD = process.env.BRUG_HERKENNEN || new URL('./herkennen.json', import.meta.url);
/** Wat het van de batterij leerde (1.4.0, batterijLeren.mjs): bewaard zoals herkennen.json. */
const BATTERIJ_GELEERD_PAD = process.env.BRUG_BATTERIJ_GELEERD || new URL('./batterij-geleerd.json', import.meta.url);
/** De omvormer begrenzen (1.5.0, omvormerPlan.mjs): de rem en wat er openstaat, ook na een herstart; ook in .gitignore. */
const OMVORMER_STUREN_PAD = process.env.BRUG_OMVORMER_STUREN || new URL('./omvormer-sturen.json', import.meta.url);
/** De spanningswacht (1.5.0, spanning.mjs): de hoogste spanning van vandaag, de tellers en de lijst; ook in .gitignore. */
const SPANNING_PAD = process.env.BRUG_SPANNING || new URL('./spanning.json', import.meta.url);
/**
 * Zo lang hooguit wachten op het vrijgeven bij het stoppen: eerst hooguit STOP_WACHT_MS op een lopende
 * ronde (omvormerPlan.mjs), dan lezen en vrijgeven, met teruglezen en één keer opnieuw (1.6.1).
 */
const VRIJ_BIJ_STOPPEN_MS = 25_000;

/** Een belofte met een eindtijd: daarna 'tijd'. */
const metEindtijd = (belofte, ms) => {
  let wekker;
  return Promise.race([belofte, new Promise((klaar) => {
    wekker = setTimeout(() => klaar('tijd'), ms);
    wekker.unref?.();
  })]).finally(() => clearTimeout(wekker));
};

/** Wie er draait (één tegelijk, zie draaien.mjs), en of start.sh moet ophouden; ook in .gitignore. */
const PID_PAD = new URL('./draait.pid', import.meta.url);
const GESTOPT_PAD = new URL('./gestopt', import.meta.url);
/** Hoe de laatste start ging (gestart, eerste-stand, fout), voor bijwerken.sh; ook in .gitignore. */
const OPSTART_PAD = new URL('./opstart.txt', import.meta.url);

/** De prijzen bijhouden, als dat in de instellingen staat: Zonneplan met EnergyZero als reserve, of alleen EnergyZero. */
function startPrijzen(instellingen, { eersteWachtMs } = {}) {
  if (!instellingen.prijzen) return null;
  const schatting = energyZeroBron({ plaats: instellingen.plaats });
  const bron =
    instellingen.prijzen === 'zonneplan'
      ? metReserve(zonneplanBron({ pad: SESSIE_PAD, plaats: instellingen.plaats }), schatting, { log })
      : { naam: `${schatting.naam} (schatting)`, haal: schatting.haal };
  return prijsVolger(bron, { log, ...(eersteWachtMs ? { eersteWachtMs } : {}) });
}

const euroTekst = (bedrag) => `€ ${bedrag.toFixed(3).replace('.', ',')}`;

/** De prijs van nu in één regel, voor proef en na het inloggen. */
function prijsRegel(prijs) {
  if (!prijs) return 'nog geen prijs voor dit kwartier';
  const bonus = prijs.zonnebonus_kwh > 0 ? `, waarvan Zonnebonus ${euroTekst(prijs.zonnebonus_kwh)}` : '';
  return `afnemen ${euroTekst(prijs.afname_kwh)} per kWh, terugleveren ${euroTekst(prijs.teruglevering_kwh)}${bonus} (${prijs.bron})`;
}

/** Is een ronde (meten en versturen) na zo lang nog niet klaar, dan hangt er iets: opnieuw starten. */
const HANGT_NA_MS = 3 * 60_000;

/** Het weerbericht voor Advies (weer.mjs, sinds 0.9.0): Open-Meteo, op de plaats uit de instellingen. */
const startWeer = (instellingen) => weerVolger({ haal: () => haalWeer(instellingen.plaats), log });

/**
 * Zendure starten; geeft iets met lees() → stand (of een fout), stop(), naam en product.
 * Via de cloud gooit het nooit: lukt de inlog niet, dan probeert houdZendureCloud
 * het op de achtergrond opnieuw en loopt de rest gewoon door.
 */
async function startZendure(zendure, { adressen = null } = {}) {
  if (!zendure) return { lees: async () => null, stop() {}, naam: null, product: null };
  // Lokaal: elk antwoord nagaan (dezelfde Zendure?), en het adres van nu (adressen.mjs: na terugvinden het nieuwe).
  const plek = adressen?.plek('zendure') ?? null;
  const leesLokaal = (adres) => leesZendureLokaal(adres, { plek });
  if (zendure.manier === 'lokaal' && zendure.cloudsleutel) {
    // Lokaal, en antwoordt hij een paar keer op rij niet, dan via de cloud (zie zendureMetReserve).
    const metReserve = zendureMetReserve(() => zendure.adres, zendure.cloudsleutel, { log, leesLokaal });
    return {
      lees: () => metReserve.lees(),
      stop: () => metReserve.stop(),
      get naam() {
        return `Zendure (lokaal, ${zendure.adres}, cloud als reserve)`;
      },
      product: null,
    };
  }
  if (zendure.manier === 'lokaal') {
    return {
      lees: () => leesLokaal(zendure.adres),
      stop() {},
      get naam() {
        return `Zendure (lokaal, ${zendure.adres})`;
      },
      product: null,
    };
  }
  const cloud = houdZendureCloud(zendure.cloudsleutel, { log });
  await cloud.start();
  return {
    lees: () => cloud.lees(),
    stop: () => cloud.stop(),
    get naam() {
      return `Zendure (cloud${cloud.namen.length ? `: ${cloud.namen.join(', ')}` : ', nog niet verbonden'})`;
    },
    get product() {
      return cloud.namen.join(', ') || null;
    },
  };
}

/**
 * De GoodWe-omvormer bijhouden (goodwe.mjs): hooguit eens per 15 s vragen, en
 * zijn type ("GW8K-DT") één keer, zodra hij antwoordt. Zonder omvormer null.
 * Met `adressen` (1.3.0): na het starten, na een gat en op een ander adres één keer
 * nagaan of het nog dezelfde omvormer is (zijn serienummer, als kenmerk).
 */
function startGoodWe(goodwe, { adressen = null } = {}) {
  if (!goodwe) return null;
  const plek = adressen?.plek('goodwe') ?? null;
  let nagegaan = null;
  const volger = goodweVolger(goodwe, {
    // 1.4.0: eens per minuut ook de isolatie en de lekstroom (metExtra in goodwe.mjs), alleen lezen.
    lees: metExtra(async (adres) => {
      try {
        const lezing = await leesGoodWe(adres);
        if (plek && nagegaan !== adres) {
          const serie = await leesGoodWeSerie(adres);
          if (serie !== null) {
            plek.controleer(serie);
            nagegaan = adres;
          }
        }
        return lezing;
      } catch (fout) {
        nagegaan = null;
        throw fout;
      }
    }),
  });
  let type = null;
  let typeGevraagd = false;
  return {
    get naam() {
      return `GoodWe-omvormer (${goodwe.adres})`;
    },
    get type() {
      return type;
    },
    async ronde(opties) {
      const uit = await volger.ronde(opties);
      if (uit.gelezen && !uit.fout && uit.blok?.stand !== 'slaapt' && !typeGevraagd) {
        typeGevraagd = true;
        type = await leesGoodWeType(goodwe.adres);
      }
      return uit;
    },
  };
}

/** De Tuya-apparaten bijhouden (tuya.mjs); zonder apparaten null. */
function startTuya(apparaten) {
  return apparaten?.length ? tuyaVolger(apparaten) : null;
}

/** Wat proef van elk Tuya-apparaat laat zien: wat het nu is, of waarom niet. */
function tuyaRegels(lezingen) {
  return (lezingen ?? []).map(({ apparaat, stand, fout }) => {
    const naam = `${apparaat.naam} (Tuya ${apparaat.versie}, ${apparaat.wat})`.padEnd(36);
    if (!stand) return `${naam}     ${fout ? `geen antwoord: ${inGewoneWoorden(fout)}` : 'geen antwoord'}`;
    const aan = stand.aan === null ? 'aan/uit onbekend' : stand.aan ? 'aan' : 'uit';
    const extra = [stand.w !== null ? `${Math.round(stand.w)} W` : null, stand.helderheid ? `${stand.helderheid}%` : null, apparaat.spots ? 'spots in het overstek' : null].filter(Boolean);
    return `${naam}     ${[aan, ...extra].join(' · ')}`;
  });
}

/**
 * Eén keer meten en laten zien. Verstuurt niets, behalve met --versturen: dan gaat alleen de
 * stand (zonder de extra blokken) één keer naar de app, en zie je of de sleutel en het adres
 * kloppen. Doe dat alleen als het programmaatje zelf nog niet draait (twee schrijvers op één rij).
 * Met --alles ook de hele meting (honderden regels); anders een korte samenvatting.
 */
async function proef(opties = []) {
  const versturen = opties.includes('--versturen');
  const instellingen = laadInstellingen({ zonderApp: !versturen });
  // Adressen die het programmaatje zelf terugvond (adressen.json, 1.3.0); proef zoekt niet en bewaart niets.
  const adressen = maakAdressen({ instellingen, opgeslagen: laadAdressen(adressenPad(process.env.BRUG_INSTELLINGEN || STANDAARD_PAD)) });
  for (const v of adressen.verplaatst()) console.log(`${v.naam}: op ${v.adres} (teruggevonden; in instellingen.json staat ${v.instellingen}).`);
  // Het weer alvast ophalen terwijl de rest meet.
  const weer = startWeer(instellingen);
  const weerKlaar = weer.tik();
  const zendure = await startZendure(instellingen.zendure, { adressen });
  if (instellingen.zendure?.manier === 'cloud') {
    log('Even wachten op het eerste bericht van Zendure…');
    await slaap(8000);
  }
  const goodwe = startGoodWe(instellingen.goodwe, { adressen });
  const tuya = startTuya(instellingen.tuya);
  const { meting, homewizard, zendureStand, zendureP1, omvormer, nacht, tellers, tuyaLezingen } = await meetAlles({
    instellingen,
    zendure,
    geheugen: new Map(),
    problemen: new Map(),
    historie: undefined,
    missers: maakMissers(),
    goodwe,
    tuya,
    versie: VERSIE,
    log,
    adressen,
  });
  zendure.stop();
  console.log('');
  for (const { meter, w } of homewizard) {
    const zon = meter.rol === 'zon-en-batterij' ? meting.zonnen.find((z) => z.sleutel === meter.sleutel)?.vermogen_w : null;
    const extra = zon !== null && zon !== undefined ? `  → zon uitgerekend: ${zon} W` : '';
    console.log(`  ${`${meter.naam} (${meter.rol})`.padEnd(36)} ${meter.code ? 'v2' : 'v1'}  ${w === null ? 'geen antwoord' : `${Math.round(w)} W`}${extra}`);
  }
  // De meterkast (1.4.0): tarief, gas, water en warmte, als de P1-meter ze geeft.
  for (const regel of meterkastZinnen(meting.meterkast)) console.log(`  ${'Meterkast'.padEnd(36)}     ${regel}`);
  for (const meter of instellingen.homewizard) {
    const zwak = zwakkeControle(meter);
    if (zwak) console.log(`  Let op: ${zwak}`);
  }
  // Een zonnemeter die overdag stroom gebruikt (zoals de spa in huis B): staat hij goed? Eén lezing is hier genoeg.
  for (const v of zonmetersMetVerbruik({ homewizard, meting, nacht, omvormerW: omvormer?.w ?? null })) console.log(`  Let op: ${verbruikTekst(v)}`);
  if (zendure.naam) {
    const z = zendureStand;
    const tekst = z
      ? `batterij ${z.batterij_w ?? '–'} W (plus = levert) · ${z.batterij_procent ?? '–'}%${z.zon_w !== null ? ` · eigen zon ${z.zon_w} W` : ''}`
      : 'geen antwoord';
    console.log(`  ${zendure.naam.padEnd(36)}     ${tekst}`);
    if (!z && instellingen.zendure.manier === 'lokaal' && instellingen.zendure.cloudsleutel) {
      console.log(`  ${''.padEnd(36)}       Draait het programmaatje, dan neemt de cloud het over na 3 keer op rij geen antwoord.`);
    }
    // Meer over de batterij (temperatuur, spanning, grenzen, …), elk op een eigen regel.
    if (z) for (const regel of batterijZinnen(z.info ?? null)) console.log(`  ${''.padEnd(36)}       ${regel}`);
  }
  if (instellingen.zendure_p1) {
    const naam = `Zendure P1-meter (${instellingen.zendure_p1.adres})`;
    console.log(`  ${naam.padEnd(36)}     ${zendureP1 === null ? 'geen antwoord' : `${Math.round(zendureP1)} W`}`);
    // Valt de HomeWizard weg, dan is net_w de Zendure zelf (reserve); vergelijken heeft dan geen zin.
    const hw = meting.net_bron === 'homewizard' ? meting.net_w : null;
    if (meting.net_bron === 'zendure-p1' && instellingen.homewizard.some((m) => m.rol === 'net')) {
      console.log('  De HomeWizard P1 antwoordt niet: het net en de kosten komen nu van de Zendure P1 (reserve).');
    } else if (zendureP1 !== null && hw !== null && Math.abs(hw) > 100 && Math.abs(zendureP1) > 100 && Math.sign(hw) !== Math.sign(zendureP1)) {
      console.log(`  Let op: de HomeWizard zegt ${hw} W en de Zendure ${Math.round(zendureP1)} W; plus en min lijken omgedraaid. Geef dit door.`);
    }
  }
  if (goodwe) {
    // Alleen lezen; de omvormer krijgt nooit een opdracht. Het type komt niet in de app (wel bij Apparaten, als soort).
    const regels = omvormerZinnen(omvormer, { type: goodwe.type });
    console.log(`  ${goodwe.naam.padEnd(36)}     ${regels[0]}`);
    for (const regel of regels.slice(1)) console.log(`  ${''.padEnd(36)}       ${regel}`);
  }
  // De netspanning per fase (1.5.0, de spanningswacht): uitval boven 253 V (10 minuten gemiddeld).
  const { fasen: spanningFasen, zon: spanningZon } = spanningenUit({ meting, omvormer, homewizard });
  const spanningRegels = [
    ...spanningFasen.map((f) => `L${f.fase} ${Math.round(f.v)} V (${f.naam ? `${f.naam}-meter` : BRON_TEKST[f.bron].replace('gemeten door ', '')})`),
    ...(spanningZon ? [`zonnefase ${Math.round(spanningZon.v)} V (${spanningZon.naam ?? 'zonmeter'})`] : []),
  ];
  console.log(`  ${'Netspanning'.padEnd(36)}     ${spanningRegels.length ? `${spanningRegels.join(' · ')}; een omvormer valt uit boven 253 V (10 minuten gemiddeld)` : 'deze meterkast geeft geen spanning door'}`);
  // Tuya: alleen de stand, nooit schakelen.
  for (const regel of tuyaRegels(tuyaLezingen)) console.log(`  ${regel}`);
  // proef wacht wel op de prijzen (een minuut hooguit): hij laat ze één keer zien.
  const prijzen = startPrijzen(instellingen, { eersteWachtMs: 60_000 });
  if (prijzen) {
    meting.prijs = prijsVoorApp(await prijzen.nu(), prijzen.naam);
    console.log(`  ${'Stroomprijs nu'.padEnd(36)}     ${prijsRegel(meting.prijs)}`);
    const vast = vastPerDag(instellingen.vaste_kosten, datumInNederland(Date.now()));
    if (vast !== null) {
      const tekst = `€ ${Math.abs(vast).toFixed(2).replace('.', ',')} ${vast >= 0 ? 'kosten' : 'korting'}`;
      console.log(`  ${'Vaste kosten per dag'.padEnd(36)}     ${tekst} (levering + netbeheer − korting energiebelasting)`);
    }
    const jaar = volgJaar(laadStand(VANDAAG_PAD, Date.now()).jaar, tellers, Date.now(), instellingen.teruglevering_dit_jaar);
    console.log(`  ${'Teruggeleverd dit jaar'.padEnd(36)}     ${Math.round(jaar.teruglevering_kwh)} kWh (Zonnebonus over de eerste 7500 kWh)`);
    // 1.5.0: wanneer het programmaatje de omvormer zou begrenzen (proef schrijft niets).
    if (goodwe) {
      // Zoals het programmaatje rekent: met saldering (tot 2027) als je over het jaar meer afneemt dan teruglevert.
      const blokken = planUit(prijzen.alle(), { vanaf: Date.now(), prijsVan: (t) => prijzenVan(t, { kwhDitJaar: jaar.teruglevering_kwh, jaar: String(jaar.jaar) }) });
      const zinnen = planZinnen(blokken, Date.now(), { verbruikW: laadHerkennen(OMVORMER_STUREN_PAD)?.verbruik_gem ?? null });
      console.log(`  ${'Omvormer bij negatieve prijs'.padEnd(36)}     ${zinnen[0]}`);
      for (const zin of zinnen.slice(1)) console.log(`  ${''.padEnd(36)}       ${zin}`);
      console.log(`  ${''.padEnd(36)}       (alleen als het in de app aanstaat: Instellingen › Omvormer; proef schrijft niets)`);
    }
  }
  if (goodwe) {
    // Alleen lezen: hoe de teruglevergrens nu staat (40336) en of de grens aan staat (40327).
    // Schakelaar uit = vrij, wat de grens ook zegt (1.6.0).
    const schakelaar = await leesSchakelaar(instellingen.goodwe.adres).catch(() => null);
    const grens = schakelaar === null ? null : await leesGrens(instellingen.goodwe.adres).catch(() => null);
    const tekst = schakelaar === null
      ? 'niet te lezen (slaapt hij?)'
      : `${schakelaar ? 'grensschakelaar aan: begrensd' : 'grensschakelaar uit: vrij'}${grens === null ? '' : ` (grens ${grens}%${schakelaar ? '' : ', doet nu niets'})`}`;
    console.log(`  ${'Teruglevergrens omvormer'.padEnd(36)}     ${tekst}`);
  }
  // Het weerbericht voor Advies (Open-Meteo); zonder internet "niet bereikbaar", de rest werkt gewoon.
  await weerKlaar;
  const weerBlok = weer.blok();
  if (weerBlok) meting.weer = weerBlok;
  console.log(`  Weer: ${weerRegel(weerBlok, Date.now(), weer.fout())}`);
  if (nuRegel(weerBlok)) console.log(`  Weer nu: ${nuRegel(weerBlok)}`);
  // Het sleutelpaar voor op afstand (opAfstand.mjs): de korte vingerafdruk staat ook in de app (Instellingen › Op afstand).
  const publiek = leesPubliek(padNaast(process.env.BRUG_INSTELLINGEN || STANDAARD_PAD));
  console.log(`  Sleutel op afstand: ${publiek ? `${kortAfdruk(publiek)} (vergelijk met de app)` : 'nog geen (het programmaatje maakt hem bij de eerste start)'}`);
  if (opties.includes('--alles')) {

    console.log('\nDit zou naar de app gaan (batterij: plus = levert, min = laadt; net: plus = afnemen, min = terugleveren):');
    console.log(JSON.stringify(meting, null, 2));
  } else {
    console.log('\nDit zou naar de app gaan (alles zien: node brug.mjs proef --alles):');
    for (const regel of metingKort(meting)) console.log(`  ${regel}`);
  }
  if (versturen) {
    const stand = Object.fromEntries(Object.entries(meting).filter(([veld]) => !EXTRA_BLOKKEN.includes(veld)));
    console.log(`\nNaar de app: ${antwoordInWoorden(await verstuur(instellingen.app, stand))}`);
  } else {
    console.log('\nOf de app hem aanneemt (sleutel en adres): node brug.mjs proef --versturen (alleen als het programmaatje nog niet draait).');
  }
}

async function draai() {
  // Op een Chromebook of Raspberry Pi houdt systemd hem aan: dan geen tweede ernaast (start.sh stopt bij 3).
  if (naastSystemd()) {
    log(`Hier houdt systemd het programmaatje aan. Aanzetten: sudo systemctl start ${DIENST}; meekijken: journalctl -u ${DIENST} -f.`);
    process.exit(3);
  }
  const ander = neemPlek(PID_PAD);

  if (ander) {
    log(`Het programmaatje draait al (proces ${ander}). Opnieuw starten: node brug.mjs herstart. Stoppen: node brug.mjs stop.`);
    process.exit(3);
  }
  process.on('exit', () => geefPlekVrij(PID_PAD));
  const instellingen = laadInstellingen();
  // Alles geladen en de instellingen kloppen: bijwerken.sh weet zo dat de nieuwe versie start.
  meldOpstart(OPSTART_PAD, 'gestart', VERSIE);
  const basis = instellingen.elke_seconden * 1000;
  // Na een lege accu start de telefoon soms met een verkeerde klok (1970, of een dag terug), tot hij
  // de tijd van internet heeft. Dan nog niets doen: anders raakt de stand van vandaag en dit jaar weg.
  const bewaardOp = laadStand(VANDAAG_PAD, Date.now()).bewaard_op;
  const wachtBegin = performance.now();
  for (let gezegd = false; ; gezegd = true) {
    const geduldOp = performance.now() - wachtBegin > KLOK_WACHT_HOOGSTENS_MS;
    if (klokKlopt(Date.now(), geduldOp ? null : bewaardOp)) break;
    if (!gezegd) log('De klok van de telefoon klopt nog niet; ik wacht tot hij de tijd van internet heeft.');
    await slaap(10_000);
  }
  // Apparaten die van de router een ander adres kregen: nagaan en terugvinden (adressen.mjs, 1.3.0).
  const adressenBestand = adressenPad(process.env.BRUG_INSTELLINGEN || STANDAARD_PAD);
  const adressen = maakAdressen({
    instellingen,
    opgeslagen: laadAdressen(adressenBestand),
    bewaar: (apparaten) => bewaarAdressen(adressenBestand, apparaten),
    log,
    zoek: zoekOpnieuw,
  });
  const zendure = await startZendure(instellingen.zendure, { adressen });
  const goodwe = startGoodWe(instellingen.goodwe, { adressen });
  const tuya = startTuya(instellingen.tuya);
  const prijzen = startPrijzen(instellingen);
  const weer = startWeer(instellingen);
  const geheugen = new Map();
  const problemen = new Map();
  const historie = new Map();
  const missers = maakMissers();
  // Wat de ronde van keer tot keer onthoudt (ronde.mjs): de kosten en vandaag per kwartier (vandaag.json), en meer.
  const staat = beginStaat({ kosten: laadStand(VANDAAG_PAD, Date.now(), { log }), basis, nu: Date.now(), klok: performance.now(), instellingenOp: null });
  // Welk apparaat er nu stroom gebruikt (herkennen.mjs): alleen raden, nooit iets bedienen.
  const herkenner = maakHerkenner({ staat: laadHerkennen(HERKENNEN_PAD, { log }) });
  const batterijLeren = maakBatterijLeren({ staat: laadHerkennen(BATTERIJ_GELEERD_PAD, { log }) });
  const gestart = new Date().toISOString();
  const sindsFout = new Map();
  // Wat er het laatst is meegestuurd, per extra blok (versturen.mjs). Base44 voegt samen: wat ontbreekt blijft staan.
  const plan = extraPlanner();
  // Zonnemeters die overdag verbruik meten (samenvoegen.mjs): één regel in het logboek, en een melding in de app.
  const verbruikWacht = maakVerbruikWacht();
  // Stroomonderbrekingen, spanningsdips en -pieken die de P1-meter telt (homewizard.mjs, 0.13.0).
  const netStoringen = netStoringVolger();
  // Isolatie en lekstroom van de omvormer (goodwe.mjs, 1.4.0), en wat elk apparaat teruggeeft (kennis.mjs, 1.4.0).
  const omvormerMeldingen = omvormerMeldingVolger();
  const kennis = kennisVolger();
  // De omvormer begrenzen bij een negatieve terugleverprijs (1.5.0): alleen met een GoodWe, en alleen als de eigenaar het
  // in de app aanzet (tot het eerste antwoord van de app: uit). Het adres van nu (adressen.mjs werkt het bij).
  const stuurder = instellingen.goodwe
    ? maakStuurder({
        verbinding: omvormerVerbinding(() => instellingen.goodwe.adres),
        log,
        opgeslagen: laadHerkennen(OMVORMER_STUREN_PAD, { log }),
        bewaar: (staatSturen) => {
          const fout = bewaarHerkennen(OMVORMER_STUREN_PAD, staatSturen);
          if (fout) log(`Kon omvormer-sturen.json niet bewaren (${fout.code ?? 'fout'}).`);
        },
        gestart: Date.now(),
      })
    : null;
  // De netspanning per fase, en of de omvormer uitvalt bij een hoge spanning (1.5.0): voor elk huis, alleen lezen.
  const spanning = spanningWacht({
    opgeslagen: laadHerkennen(SPANNING_PAD, { log }),
    bewaar: (staatSpanning) => bewaarHerkennen(SPANNING_PAD, staatSpanning),
  });
  /** Bij elk stoppen: eerst de omvormer vrijgeven als hij door ons begrensd staat (hooguit VRIJ_BIJ_STOPPEN_MS). */
  const omvormerVrij = async () => {
    if (!stuurder) return;
    try {
      const uit = await metEindtijd(stuurder.stop(), VRIJ_BIJ_STOPPEN_MS);
      if (uit === 'mislukt' || uit === 'tijd') log('Omvormer: vrijgeven bij het stoppen lukte niet; bij de volgende start probeer ik het opnieuw.');
    } catch {
      // Stoppen gaat altijd door.
    }
  };

  // Lukt bewaren niet (opslag vol?), dan één keer in het logboek, en weer als het daarna eerst lukte.
  // Ook in de app (meldingen bij Apparaten), met sinds wanneer.
  let bewaarFout = null;
  const bewaar = () => {
    const fout = bewaarStand(VANDAAG_PAD, { ...staat.kosten, logboek: staat.logboek, bewaard_op: Date.now() });
    // Lukt herkennen.json niet, dan begint het herkennen na een herstart opnieuw; de labels komen dan weer van de app.
    bewaarHerkennen(HERKENNEN_PAD, herkenner.bewaar());
    // Lukt dit niet, dan leert hij na een herstart opnieuw; niets meer.
    bewaarHerkennen(BATTERIJ_GELEERD_PAD, batterijLeren.bewaar());
    const tekst = fout ? `Kon vandaag.json niet bewaren (${fout.code ?? 'fout'}); de stand van vandaag kan bij een herstart weg zijn. Is de opslag van de telefoon vol?` : null;
    if (tekst && !bewaarFout) log(tekst);
    bewaarFout = tekst ? (bewaarFout ?? { tekst, sinds: Date.now() }) : null;
  };
  let stoppen = null;
  const stop = () => {
    // Twee keer Ctrl+C: meteen weg.
    if (stoppen) process.exit(0);
    log('Gestopt.');
    stoppen = (async () => {
      await omvormerVrij();
      zendure.stop();
      bewaar();
      process.exit(0);
    })();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  // Een onverwachte fout: in het logboek, de stand bewaren, en stoppen met 1 (start.sh start hem opnieuw).
  const opFout = async (fout) => {
    if (stoppen) return;
    stoppen = true;
    log(`Onverwachte fout: ${inGewoneWoorden(fout)}. Ik bewaar de stand en start opnieuw.${fout?.stack ? `\n${fout.stack}` : ''}`);
    meldOpstart(OPSTART_PAD, 'fout', VERSIE);
    // Bij twijfel vrij: eerst de omvormer vrijgeven (hooguit een paar seconden).
    await omvormerVrij();
    try {
      bewaar();
    } catch {
      // Bewaren lukte niet: dan toch stoppen.
    }
    process.exit(1);
  };
  process.on('uncaughtException', opFout);
  process.on('unhandledRejection', opFout);

  // De waakhond: hangt een ronde (een apparaat of server die nooit klaar is), dan opnieuw starten.
  // Met de klok van het proces zelf, niet die van de telefoon (die kan verspringen).
  setInterval(() => {
    if (staat.rondSinds === null || performance.now() - staat.rondSinds < HANGT_NA_MS) return;
    log('Het programmaatje hing (een ronde duurde langer dan 3 minuten); ik bewaar de stand en start opnieuw.');
    if (stoppen) return;
    stoppen = true;
    omvormerVrij().finally(() => {
      zendure.stop();
      bewaar();
      process.exit(1);
    });
  }, 60_000);

  // Verandert instellingen.json (de instelhulp, een nieuwe sleutel, een code), dan opnieuw starten met de nieuwe.
  const instellingenPad = process.env.BRUG_INSTELLINGEN || STANDAARD_PAD;
  staat.instellingenOp = gewijzigdOp(instellingenPad);
  // Op afstand instellen (opAfstand.mjs): het sleutelpaar naast instellingen.json, de eerste keer gemaakt.
  const opAfstand = laadOfMaak(padNaast(instellingenPad), { log });
  staat.uurOp = performance.now();

  log(
    `Thuis-energie brug ${VERSIE}: ${instellingen.homewizard.length} HomeWizard-meter(s)${zendure.naam ? `, ${zendure.naam}` : ''}${goodwe ? `, ${goodwe.naam}` : ''}` +
      `${instellingen.tuya.length ? `, ${instellingen.tuya.length} Tuya-apparaat/apparaten (alleen lezen)` : ''}` +
      `${prijzen ? `, prijzen van ${prijzen.naam}` : ''}, weerbericht van Open-Meteo, elke ${instellingen.elke_seconden} s.`,
  );
  for (const meter of instellingen.homewizard) {
    const zwak = zwakkeControle(meter);
    if (zwak) log(`Let op: ${zwak}`);
  }
  for (const v of adressen.verplaatst()) log(`${v.naam} zit op ${v.adres}: eerder teruggevonden (adressen.json); in instellingen.json staat ${v.instellingen}.`);
  if (instellingen.zendure?.manier === 'cloud') await slaap(5000);

  // Eén ronde (ronde.mjs, getest in ronde.test.js); hier alleen wat met de buitenwereld praat.
  const { ronde } = maakRonde({
    staat,
    instellingen,
    basis,
    instellingenPad,
    versie: VERSIE,
    gestart,
    herkenner,
    verbruikWacht,
    netStoringen,
    omvormerMeldingen,
    kennis,
    batterijLeren,
    missers,
    problemen,
    sindsFout,
    plan,
    prijzen,
    weer,
    opAfstand,
    zendure,
    goodwe,
    stuurder,
    spanning,
    adressen,
    log,
    nu: () => Date.now(),
    klok: () => performance.now(),
    meet: () => meetAlles({ instellingen, zendure, geheugen, problemen, historie, missers, goodwe, tuya, versie: VERSIE, log, adressen }),
    verstuur: (meting) => verstuurMetTerugval(instellingen.app, meting),
    bestandOp: gewijzigdOp,
    probeerInstellingen,
    houdLogKlein,
    opslagFout: () => bewaarFout,
    bewaar,
    bewaarHerkennen: () => bewaarHerkennen(HERKENNEN_PAD, herkenner.bewaar()),
    meldOpstart: (stand) => meldOpstart(OPSTART_PAD, stand, VERSIE),
    pakOp: (gemeld) => pakOp(gemeld, opAfstand, { instellingenPad, log }),
    afsluiten: (code) => {
      if (stoppen) return;
      stoppen = true;
      omvormerVrij().finally(() => {
        zendure.stop();
        bewaar();
        process.exit(code);
      });
    },
  });
  await draaiLus({ ronde, slaap });
}

async function zoek(netwerkTekst) {
  const netwerk = netwerkTekst ? netwerkenUitTekst(netwerkTekst) : undefined;
  if (netwerkTekst && !netwerk) throw new Error(`"${netwerkTekst}" is geen netwerk; bijvoorbeeld: node brug.mjs zoek 192.168.1`);
  let waar = [];
  const gevonden = await zoekApparaten({
    netwerk,
    opNetten: (netten) => {
      waar = netten;
      log(`Zoeken in ${bereik(netten)}… (zo’n twintig seconden)`);
    },
  });
  if (gevonden.length === 0) {
    console.log(`\nNiets gevonden in ${bereik(waar)}. Staat dit apparaat op dezelfde wifi als de meters?`);
    console.log(
      'Kijk bij Wifi › details naar het IP-adres van dit apparaat en zoek met de eerste drie getallen, bijvoorbeeld: node brug.mjs zoek 192.168.1',
    );
    return;
  }
  console.log('');
  for (const g of gevonden) {
    console.log(`  ${g.adres.padEnd(16)} ${g.merk.padEnd(11)} ${String(g.soort ?? '').padEnd(18)} ${String(g.serienummer ?? '').padEnd(14)} ${g.api}`);
  }
  console.log("\nZet ze erin met: node brug.mjs instellen. Een GoodWe-omvormer vind je alleen overdag ('s nachts staat hij uit).");
}

/** In gewone woorden waarom er geen code kwam. */
function waaromGeenCode(fout) {
  if (fout?.code === 'ECONNREFUSED') {
    return 'deze meter kent de nieuwe manier (API v2) nog niet. Werk hem bij in de HomeWizard-app, of zet daar bij de meter "Lokale API" aan.';
  }
  return fout.message;
}

/**
 * Codes voor HomeWizard API v2: met een adres voor die ene meter, zonder
 * adres voor elke meter in instellingen.json die nog geen code heeft. Per
 * meter druk je één keer op het knopje; de code komt dan vanzelf in
 * instellingen.json. Zo hoeft er in de HomeWizard-app niets aan.
 */
async function homewizardCode(adres) {
  const knop = (naam) => () => log(`Druk nu op het knopje van ${naam} (bij een kWh-meter 1 tot 3 seconden ingedrukt houden).`);
  if (adres) {
    log(`Code aanvragen bij ${adres}…`);
    const code = await maakCode(adres, { opKnopWachten: knop('de meter') }).catch((fout) => {
      throw new Error(waaromGeenCode(fout));
    });
    console.log(`\nGelukt. Zet bij deze meter in instellingen.json:\n  "code": "${code}"\n`);
    return;
  }
  const pad = process.env.BRUG_INSTELLINGEN || STANDAARD_PAD;
  maakPrive(pad);
  const ruw = leesJsonBestand(fs.readFileSync(pad, 'utf8'));
  const zonder = (ruw.homewizard ?? []).filter((m) => m && !m.code);
  if (zonder.length === 0) {
    log('Elke meter in instellingen.json heeft al een code.');
    return;
  }
  // Een meter die het programmaatje op een nieuw adres terugvond (adressen.json, 1.3.0): daar de code vragen.
  const teruggevonden = laadAdressen(adressenPad(pad));
  for (const meter of zonder) {
    const t = teruggevonden[typeof meter.sleutel === 'string' ? meter.sleutel : sleutelVan(String(meter.naam ?? ''))];
    const adres = t && t.instellingen === meter.adres && typeof t.adres === 'string' ? t.adres : meter.adres;
    log(`${meter.naam} (${adres}): code aanvragen…`);
    try {
      meter.code = await maakCode(adres, { opKnopWachten: knop(meter.naam) });
      bewaarInstellingen(pad, ruw);
      log(`${meter.naam}: gelukt, de code staat in instellingen.json.`);
    } catch (fout) {
      log(`${meter.naam}: ${waaromGeenCode(fout)}`);
    }
  }
}

/**
 * Eén keer inloggen bij Zonneplan: e-mailadres, dan de code uit de mail. Het
 * e-mailadres gaat alleen naar Zonneplan en wordt nergens bewaard; de sessie
 * komt in brug/zonneplan-sessie.json. De instelhulp geeft zijn eigen vraag mee.
 */
async function zonneplanLogin({ vraag: meegegeven, inInstellen = false } = {}) {
  const vraag = meegegeven ?? maakVraag();
  try {
    const email = (await vraag('Je e-mailadres bij Zonneplan: ')).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Dat lijkt geen e-mailadres.');
    const uitdaging = await vraagInlogcode(email);
    console.log('Zonneplan mailt je nu een inlogcode van 6 cijfers (kijk ook bij de reclame of spam).');
    const code = (await vraag('Inlogcode: ')).replace(/\s/g, '');
    if (!/^\d{6}$/.test(code)) throw new Error('Een inlogcode is 6 cijfers. Start opnieuw: node brug.mjs zonneplan-login');
    bewaarSessie(SESSIE_PAD, await geefInlogcode(uitdaging, code));
    log('Ingelogd. Even de prijs van nu ophalen…');
    try {
      const tijdvak = prijsOp(await zonneplanBron({ pad: SESSIE_PAD }).haal(), Date.now());
      console.log(`\nStroomprijs nu: ${prijsRegel(prijsVoorApp(tijdvak, 'Zonneplan'))}.`);
    } catch (fout) {
      console.log(`De prijs ophalen lukte nu niet (${fout.message}); het programmaatje probeert het straks vanzelf.`);
    }
    if (!inInstellen) {
      console.log('Zet "prijzen": "zonneplan" in instellingen.json (als dat er nog niet staat) en start het programmaatje opnieuw.');
    }
  } finally {
    if (!meegegeven) vraag.sluit();
  }
}

/**
 * De instelhulp: zoekt de meters en vraagt de rest, met een voorstel uit de
 * huidige instellingen (Enter). Zie instellen.mjs.
 */
async function instellen(netwerkTekst) {
  const netwerk = netwerkTekst ? netwerkenUitTekst(netwerkTekst) : undefined;
  if (netwerkTekst && !netwerk) throw new Error(`"${netwerkTekst}" is geen netwerk; bijvoorbeeld: node brug.mjs instellen 192.168.1`);
  const pad = process.env.BRUG_INSTELLINGEN || STANDAARD_PAD;
  const bestand = pad instanceof URL ? fileURLToPath(pad) : pad;
  const bestaand = leesBestaand(bestand);
  const kort = path.relative(process.cwd(), bestand);
  const vraag = maakVraag();
  try {
    const uit = await voerUit({
      vraag,
      zoek: zoekApparaten,
      netwerk,
      maakCode: (adres, opties) =>
        maakCode(adres, opties).catch((fout) => {
          throw new Error(waaromGeenCode(fout));
        }),
      zonneplanLogin: () => zonneplanLogin({ vraag, inInstellen: true }),
      zonneplanIngelogd: () => laadSessie(SESSIE_PAD) !== null,
      bestaand,
      bewaar: (ruw) => bewaarInstellingen(bestand, ruw),
      // Wat elke gevonden meter nu meet, met teken (plus = gebruikt); alleen lezen.
      leesVermogen: async (g, code) =>
        (await leesHomeWizard({ adres: g.adres, ...(code ? { code, ...(/^[a-f0-9]{12}$/i.test(g.serienummer ?? '') ? { serienummer: g.serienummer } : {}) } : {}) })).w,
      waar: kort && !kort.startsWith('..') && !path.isAbsolute(kort) ? kort : bestand,
    });
    if (uit.fouten) process.exitCode = 1;
  } finally {
    vraag.sluit();
  }
}

/**
 * Samen testen bij de omvormer (1.5.0, 1.6.0, omvormerTest.mjs): lezen, 2 minuten begrenzen naar 0%
 * (grens 0, schakelaar aan) met aftellen, bij genoeg zon kort 50%, de schakelaar uit, teruglezen, en in
 * gewone woorden wat er gebeurde. Ctrl+C, SIGTERM of SIGHUP: meteen de schakelaar uit (1.6.1).
 * Niet terwijl het programmaatje zelf draait: één stuurder tegelijk.
 */
async function omvormerTestOpdracht() {
  const instellingen = laadInstellingen({ zonderApp: true });
  if (!instellingen.goodwe) {
    console.log('In instellingen.json staat geen GoodWe-omvormer; dan doet dit niets (zoals bij een huis zonder GoodWe).');
    return;
  }
  let pid = null;
  try {
    pid = draaitAl(fs.readFileSync(PID_PAD, 'utf8'));
  } catch {
    // Geen draait.pid: dan draait er niets.
  }
  if (pid) {
    console.log(`Het programmaatje draait (proces ${pid}). Stop het eerst, zodat er maar één de omvormer stuurt:`);
    console.log(onderSystemd() ? `  sudo systemctl stop ${DIENST}   (daarna weer aan: sudo systemctl start ${DIENST})` : '  node brug.mjs stop   (daarna weer aan: sh start.sh)');
    process.exitCode = 1;
    return;
  }
  // Het adres dat het programmaatje zelf terugvond (adressen.json), zoals proef.
  maakAdressen({ instellingen, opgeslagen: laadAdressen(adressenPad(process.env.BRUG_INSTELLINGEN || STANDAARD_PAD)) });
  const adres = instellingen.goodwe.adres;
  // Ctrl+C, SIGTERM (systemctl, kill) en SIGHUP (ssh valt weg) allemaal als Ctrl+C: meteen de schakelaar uit (1.6.1).
  // Nog niets geschreven: meteen weg. Twee keer: dan toch meteen weg (de test gaf hem dan al vrij, of probeert het nu).
  let geschrevenOoit = false;
  const onderbroken = luisterOnderbreken({ bezig: () => geschrevenOoit });
  // De schrijfacties van de test tellen mee in de rem van het programmaatje (omvormer-sturen.json), en de
  // test bewaart daar ook of de schakelaar van ons is, hoe hij oorspronkelijk stond en wat hij zag (1.6.0).
  const pasAan = (f) => {
    const staatSturen = laadHerkennen(OMVORMER_STUREN_PAD) ?? {};
    const fout = bewaarHerkennen(OMVORMER_STUREN_PAD, { ...staatSturen, ...f(staatSturen) });
    if (fout) console.log(`Kon omvormer-sturen.json niet bewaren (${fout.code ?? 'fout'}).`);
  };
  const geschreven = () => {
    geschrevenOoit = true;
    pasAan((x) => ({ schrijven: [...(Array.isArray(x.schrijven) ? x.schrijven : []), Date.now()], ooit: true }));
  };
  // Het type ("GW8K-DT") voor het vermogen; zonder vergelijkt de 50%-proef alleen met wat hij vooraf leverde.
  const type = await leesGoodWeType(adres);
  const uitkomst = await samenTest({
    verbinding: omvormerVerbinding(adres),
    leesVermogen: async () => {
      try {
        return (await leesGoodWe(adres)).w;
      } catch {
        return null;
      }
    },
    vraagStart: async () => {
      const vraag = maakVraag();
      try {
        await vraag('Sta je bij de omvormer? Druk op Enter om 2 minuten te begrenzen (Ctrl+C = niet doen): ');
        return true;
      } finally {
        vraag.sluit();
      }
    },
    wacht: slaap,
    onderbroken,
    uit: (tekst) => console.log(tekst),
    geschreven,
    vanOns: () => (laadHerkennen(OMVORMER_STUREN_PAD) ?? {}).schakelaar_door_ons === true,
    schakelaarDoorOns: (aan) => pasAan(() => ({ schakelaar_door_ons: aan })),
    oorspronkelijk: ({ grens, schakelaar }) => pasAan((x) => (x.oorspronkelijk ? {} : { oorspronkelijk: { grens, schakelaar, op: Date.now() } })),
    nagekeken: (c) => pasAan(() => ({ controle: { ...c, voorW: Math.round(c.voorW), naW: Math.round(c.naW), op: Date.now() } })),
    nominaal: nominaalUitType(type),
  });
  if (uitkomst === 'vrijgeven-mislukt' || uitkomst === 'geen-antwoord') process.exitCode = 1;
}

/** Draait hij? Ja: exitcode 0 (start.sh kijkt daarnaar), nee: 1. */
async function status() {
  let pid = null;
  try {
    pid = draaitAl(fs.readFileSync(PID_PAD, 'utf8'));
  } catch {
    // Geen draait.pid: dan draait er niets.
  }
  console.log(pid ? `Het programmaatje draait (proces ${pid}).` : 'Het programmaatje draait niet.');
  process.exitCode = pid ? 0 : 1;
}

/**
 * Netjes stoppen. Bij `herstart` start start.sh hem meteen weer, met wat er nu staat (na git pull dus de nieuwe versie).
 * Houdt systemd hem aan (Chromebook), dan via systemctl: het bestand gestopt kent systemd niet, die zou hem
 * na een halve minuut gewoon weer starten.
 */
async function stopOfHerstart({ herstart }) {
  if (onderSystemd()) {
    if (dienstOpdracht(herstart ? 'restart' : 'stop')) {
      console.log(herstart ? 'Opnieuw gestart (systemd).' : `Gestopt (systemd). Weer aan: sudo systemctl start ${DIENST}`);
      return;
    }
    if (!herstart) {
      console.log(`Hier houdt systemd het programmaatje aan. Stoppen: sudo systemctl stop ${DIENST}`);
      process.exitCode = 1;
      return;
    }
    // Herstart zonder sudo: stoppen, en systemd start hem binnen een halve minuut weer.
    const pid = stuurStop(PID_PAD);
    console.log(pid ? `Proces ${pid} stopt; systemd start hem binnen een halve minuut weer.` : `Het programmaatje draait niet. Aanzetten: sudo systemctl start ${DIENST}`);
    return;
  }
  if (!herstart) fs.writeFileSync(GESTOPT_PAD, 'Gestopt met: node brug.mjs stop. Weer aan: sh start.sh\n');
  const pid = stuurStop(PID_PAD);
  if (!pid) {
    console.log(`Het programmaatje draait niet.${herstart ? ' Aanzetten: sh ~/thuis-energie/brug/start.sh' : ''}`);
    return;
  }
  console.log(
    herstart
      ? `Opnieuw aan het starten: proces ${pid} stopt en start.sh zet hem binnen een paar seconden weer aan. (Draaide hij zonder start.sh, start hem dan zelf.)`
      : `Gestopt (proces ${pid}). Weer aan: sh ~/thuis-energie/brug/start.sh`,
  );
}

/** Na een herstart van de telefoon vanzelf starten, met de app Termux:Boot. */
async function termuxBoot() {
  if (!String(process.env.PREFIX ?? '').includes('com.termux')) {
    throw new Error('Dit is alleen voor Termux op een Android-telefoon.');
  }
  const map = path.join(os.homedir(), '.termux', 'boot');
  fs.mkdirSync(map, { recursive: true });
  const doel = path.join(map, 'thuis-energie');
  fs.writeFileSync(doel, bootScript(fileURLToPath(new URL('./start.sh', import.meta.url))), { mode: 0o700 });
  fs.chmodSync(doel, 0o700);
  console.log(`Klaar: ${doel}`);
  console.log('Na een herstart van de telefoon start het programmaatje nu vanzelf, als Termux:Boot er is en je die app één keer hebt geopend.');
}

/**
 * Laadt alles en kloppen de instellingen? Voor bijwerken.sh, vóór het opnieuw starten: zo valt
 * ook op wat node --check niet ziet (een ontbrekende export, een veld dat de nieuwe versie strenger
 * nakijkt). Niets meten, niets versturen.
 */
async function nakijken() {
  laadInstellingen();
  console.log(`Thuis-energie brug ${VERSIE}: alles laadt en de instellingen kloppen.`);
}

const [opdracht, ...rest] = process.argv.slice(2);
const opdrachten = {
  instellen: () => instellen(rest.join(' ')),
  proef: () => proef(rest),
  zoek: () => zoek(rest.join(' ')),
  'homewizard-code': () => homewizardCode(rest[0]),
  'zonneplan-login': zonneplanLogin,
  'omvormer-test': omvormerTestOpdracht,
  status,
  nakijken,
  herstart: () => stopOfHerstart({ herstart: true }),
  stop: () => stopOfHerstart({ herstart: false }),
  'termux-boot': termuxBoot,
};

const kies = opdracht === undefined ? draai : opdrachten[opdracht];
if (!kies) {
  console.error(
    `Onbekende opdracht "${opdracht}". Kies uit: instellen, proef, zoek, homewizard-code [ip], zonneplan-login, omvormer-test, status, nakijken, herstart, stop, termux-boot, of niets (draaien).`,
  );
  process.exit(1);
}
kies().catch((fout) => {
  // Start het programmaatje zelf niet (de instellingen kloppen niet), dan ziet bijwerken.sh dat aan opstart.txt.
  if (kies === draai) meldOpstart(OPSTART_PAD, 'fout', VERSIE);
  console.error(`Fout: ${inGewoneWoorden(fout)}`);
  process.exit(1);
});
