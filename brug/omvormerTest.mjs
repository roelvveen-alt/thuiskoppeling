import { AAN, UIT } from './omvormerSturen.mjs';

/**
 * `node brug.mjs omvormer-test` (programmaatje 1.5.0, 1.6.0): de eigenaar staat bij de omvormer en kijkt
 * mee. Lezen hoe hij staat (grens 40336 en de schakelaar 40327), 2 minuten begrenzen naar 0%
 * (grens 0, schakelaar aan) met aftellen en het vermogen elke paar seconden, bij genoeg zon kort
 * 50% (klopt de eenheid: procent of 0,1%?), dan de schakelaar uit, teruglezen, en in gewone
 * woorden zeggen wat er gebeurde. Met Ctrl+C, SIGTERM of SIGHUP (`onderbroken`, luisterOnderbreken)
 * meteen de schakelaar uit. Schrijft
 * alleen via de verbinding uit omvormerSturen.mjs (twee registers, een harde lijst). Los van
 * brug.mjs, zodat omvormerTest.test.js het met een nep kan nalopen.
 *
 * Wie is de baas (zoals de besturing, omvormerPlan.mjs): staat de schakelaar uit, dan is hij vrij,
 * wat de grens ook zegt (in huis A 2%, van de installateur): gewoon doorgaan. Staat hij aan en niet
 * door het programmaatje: niets doen en dat zeggen.
 */

/** De signalen die de test onderbreken (1.6.1): Ctrl+C, een stop (systemctl, kill) en ssh die wegvalt. */
export const ONDERBREEK_SIGNALEN = Object.freeze(['SIGINT', 'SIGTERM', 'SIGHUP']);

/**
 * Luisteren naar Ctrl+C, SIGTERM en SIGHUP (1.6.1): allemaal hetzelfde als Ctrl+C. Is er nog niets
 * geschreven (`bezig()` false), dan meteen weg; anders onderbroken, zodat de test meteen de schakelaar
 * uitzet. Een tweede signaal: toch meteen weg. Na SIGHUP is het scherm weg: een schrijffout naar het
 * scherm mag het vrijgeven dan niet tegenhouden. Geeft () => onderbroken.
 */
export function luisterOnderbreken({ proces = process, bezig = () => true, weg = (code) => proces.exit(code) } = {}) {
  let onderbroken = false;
  const op = (signaal) => {
    if (signaal === 'SIGHUP') for (const s of [proces.stdout, proces.stderr]) s?.on?.('error', () => {});
    if (onderbroken || !bezig()) {
      weg(130);
      return;
    }
    onderbroken = true;
  };
  for (const s of ONDERBREEK_SIGNALEN) proces.on(s, op);
  return () => onderbroken;
}

/** Minder zon dan dit: het effect is moeilijk te zien. */
export const ZWAK_W = 300;
/** Pas met meer dan dit vooraf heeft de 50%-proef zin. */
export const GENOEG_VOOR_50_W = 2000;

const komma = (g) => String(Math.round(g)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const watt = (w) => (Number.isFinite(w) ? `${komma(w)} W` : 'onbekend');
const mmss = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const midden = (l) => {
  const g = l.filter(Number.isFinite).sort((x, y) => x - y);
  return g.length ? (g.length % 2 ? g[(g.length - 1) / 2] : (g[g.length / 2 - 1] + g[g.length / 2]) / 2) : null;
};

/**
 * @param {object} d
 * @param {{ leesGrens, leesSchakelaar, schrijfGrens, schrijfSchakelaar }} d.verbinding  omvormerVerbinding (of een nep)
 * @param {() => Promise<number|null>} d.leesVermogen  wat hij nu levert (W), of null
 * @param {() => Promise<boolean>} d.vraagStart  true = Enter (beginnen)
 * @param {(ms: number) => Promise<void>} d.wacht
 * @param {() => boolean} d.onderbroken  Ctrl+C gedrukt?
 * @param {(tekst: string) => void} d.uit
 * @param {() => void} [d.geschreven]  na elke schrijfactie (voor de rem van het programmaatje)
 * @param {() => boolean} [d.vanOns]  zette het programmaatje de schakelaar aan (omvormer-sturen.json)?
 * @param {(aan: boolean) => void} [d.schakelaarDoorOns]  bewaren vóór het aanzetten, en na het uitzetten
 * @param {(o: { grens: number, schakelaar: boolean }) => void} [d.oorspronkelijk]  hoe hij stond (de eerste keer bewaren)
 * @param {(c: object) => void} [d.nagekeken]  de uitkomst, zoals de zelfcontrole van de besturing hem bewaart
 * @param {number|null} [d.nominaal]  het vermogen van de omvormer (W), voor de 50%-proef
 * @returns {Promise<'klaar'|'geen-antwoord'|'eigen'|'was-begrensd'|'niet-begonnen'|'begrenzen-mislukt'|'vrijgeven-mislukt'>}
 */
export async function samenTest({
  verbinding,
  leesVermogen,
  vraagStart,
  wacht,
  onderbroken = () => false,
  uit,
  geschreven = () => {},
  vanOns = () => false,
  schakelaarDoorOns = () => {},
  oorspronkelijk = () => {},
  nagekeken = () => {},
  nominaal = null,
  duurMs = 120_000,
  stapMs = 5_000,
  duur50Ms = 60_000,
}) {
  const probeer = async (f) => {
    try {
      return await f();
    } catch {
      return null;
    }
  };
  const leesGrens = () => probeer(() => verbinding.leesGrens());
  const leesSchakelaar = () => probeer(() => verbinding.leesSchakelaar());
  /** Schrijven en teruglezen, één keer opnieuw. Geeft { gelukt, terug, fout }. */
  const zet = async (soort, waarde) => {
    let terug = null;
    let fout = null;
    for (let poging = 0; poging < 2; poging += 1) {
      geschreven();
      fout = null;
      try {
        if (soort === 'grens') await verbinding.schrijfGrens(waarde);
        else await verbinding.schrijfSchakelaar(waarde);
      } catch (f) {
        fout = f;
      }
      if (soort === 'grens') terug = await leesGrens();
      else {
        const s = await leesSchakelaar();
        terug = s === null ? null : s ? AAN : UIT;
      }
      if (terug === waarde) return { gelukt: true, terug, fout: null };
      const gelezen = terug === null ? 'geen antwoord' : soort === 'grens' ? `${terug}%` : terug ? 'aan' : 'uit';
      if (poging === 0) uit(`  Teruglezen: ${gelezen}${fout ? ` (${fout.message})` : ''}; nog één keer.`);
    }
    return { gelukt: false, terug, fout };
  };
  /** De schakelaar uit (vrijgeven), en bewaren dat hij niet meer van ons is. */
  const schakelaarUit = async () => {
    const v = await zet('schakelaar', UIT);
    if (v.gelukt) schakelaarDoorOns(false);
    return v;
  };
  /** Zo lang kijken, elke stapMs het vermogen; stopt bij Ctrl+C. Geeft de lezingen. */
  const kijk = async (duur, tekst) => {
    const lezingen = [];
    for (let over = duur; over > 0 && !onderbroken(); ) {
      const stap = Math.min(stapMs, over);
      for (let t = 0; t < stap && !onderbroken(); t += 1000) await wacht(Math.min(1000, stap - t));
      over -= stap;
      if (onderbroken()) break;
      const w = await leesVermogen();
      lezingen.push(w);
      uit(`  ${tekst} · nog ${mmss(over)} · levert ${watt(w)}`);
    }
    return lezingen;
  };

  uit('Omvormer samen testen. Er gebeurt niets voordat je op Enter drukt.');
  const grens = await leesGrens();
  const schakelaar = await leesSchakelaar();
  const wVoor = await leesVermogen();
  if (grens === null || schakelaar === null) {
    uit('De omvormer antwoordt niet. Doe dit overdag, als hij stroom levert (\'s nachts slaapt hij), en kijk of het adres klopt (node brug.mjs proef).');
    return 'geen-antwoord';
  }
  oorspronkelijk({ grens, schakelaar });
  uit(`Nu: levert ${watt(wVoor)}, de teruglevergrens staat op ${grens}%, de grensschakelaar staat ${schakelaar ? 'aan' : 'uit'}.`);
  if (schakelaar) {
    if (vanOns()) {
      uit('De grensschakelaar staat nog aan van het programmaatje. Ik zet hem eerst uit; draai de test daarna nog eens.');
      const v = await schakelaarUit();
      uit(v.gelukt ? 'De schakelaar staat weer uit: hij is vrij.' : 'Uitzetten lukte niet. Zet de exportgrens in de app van GoodWe (SolarGo) uit.');
      return v.gelukt ? 'was-begrensd' : 'vrijgeven-mislukt';
    }
    uit('De grensschakelaar staat aan, maar niet door het programmaatje (de installateur, of de app van GoodWe?). Dan verander ik niets. Geef dit door.');
    return 'eigen';
  }
  uit(`De schakelaar staat uit, dus de omvormer is vrij, wat de grens (${grens}%) ook zegt. Het programmaatje zet straks de grens op 0% en de schakelaar aan, en daarna de schakelaar weer uit (zoals hij nu staat).`);
  const zwak = !(Number.isFinite(wVoor) && wVoor >= ZWAK_W);
  if (zwak) uit(`Let op: hij levert nu ${watt(wVoor)}; met zo weinig zon is het effect moeilijk te zien. Liever op een zonnig moment; doorgaan mag ook.`);
  if (!(await vraagStart()) || onderbroken()) {
    uit('Niet begonnen; er is niets veranderd.');
    return 'niet-begonnen';
  }

  uit(`Begrenzen naar 0% (grens 0, schakelaar aan) voor ${mmss(duurMs)} minuten. Ctrl+C zet de schakelaar meteen uit.`);
  const g = grens === 0 ? { gelukt: true } : await zet('grens', 0);
  if (!g.gelukt) {
    uit(`De grens nam hij niet aan (${g.terug === null ? 'geen antwoord' : `hij staat op ${g.terug}%`}${g.fout ? `, ${g.fout.message}` : ''}). De schakelaar staat nog uit, dus hij levert gewoon. Zet het in de app (Instellingen › Omvormer) niet aan, en geef dit door.`);
    return 'begrenzen-mislukt';
  }
  // Onderbroken terwijl de grens geschreven werd: de schakelaar niet meer aanzetten (hij staat nog uit, dus vrij).
  if (onderbroken()) {
    uit('Onderbroken: de schakelaar staat nog uit, dus hij levert gewoon; er is verder niets veranderd.');
    return 'niet-begonnen';
  }
  // Al bewaren vóór het aanzetten: valt de stroom of het programmaatje weg, dan weet de volgende start dat hij van ons is.
  schakelaarDoorOns(true);
  const a = await zet('schakelaar', AAN);
  let lezingen0 = [];
  let lezingen50 = [];
  let vijftig = 'niet';
  if (a.gelukt) {
    uit('Teruggelezen: grens 0%, schakelaar aan. Nu kijken wat hij levert.');
    lezingen0 = await kijk(duurMs, 'grens 0%');
    const laagst0 = Math.min(...lezingen0.filter(Number.isFinite));
    const werkt0 = !zwak && Number.isFinite(laagst0) && laagst0 <= wVoor * 0.6;
    if (!onderbroken() && werkt0) {
      if (wVoor > GENOEG_VOOR_50_W) {
        uit('Nu kort 50%, om te zien of de grens in procent telt (of in 0,1%).');
        const h = await zet('grens', 50);
        if (h.gelukt) {
          lezingen50 = await kijk(duur50Ms, 'grens 50%');
          vijftig = 'gedaan';
        } else {
          vijftig = 'mislukt';
          uit('De grens op 50% nam hij niet aan; die proef sla ik over.');
        }
      } else {
        vijftig = 'te-weinig-zon';
      }
    }
    if (onderbroken()) uit('Ctrl+C: ik zet de schakelaar meteen uit.');
  } else {
    uit(`De schakelaar ging niet aan${a.fout ? ` (${a.fout.message})` : ''}.`);
  }

  uit('Vrijgeven (schakelaar uit).');
  const v = await schakelaarUit();
  uit(v.gelukt ? 'Teruggelezen: schakelaar uit. Hij is weer vrij.' : `Uitzetten lukte niet${v.fout ? ` (${v.fout.message})` : ''}.`);
  await wacht(Math.min(15_000, stapMs));
  const wNa = await leesVermogen();

  uit('');
  uit('Wat er gebeurde:');
  const laagst = lezingen0.filter(Number.isFinite).length ? Math.min(...lezingen0.filter(Number.isFinite)) : null;
  const bleef = midden(lezingen0);
  if (!a.gelukt) {
    uit('- Begrenzen lukte niet: de schakelaar ging niet aan. Zet het in de app (Instellingen › Omvormer) niet aan, en geef dit door.');
  } else if (!lezingen0.length) {
    uit('- Je stopte voordat er iets te zien was; draai de test nog eens.');
  } else if (zwak) {
    uit(`- Het vermogen ging van ${watt(wVoor)} naar ${watt(laagst)}, maar er was te weinig zon om het goed te zien. Doe de test liever op een zonnig moment opnieuw.`);
  } else if (laagst <= wVoor * 0.6) {
    uit(`- Het vermogen ging van ${watt(wVoor)} naar ${watt(laagst)}: de begrenzing werkt.`);
    nagekeken({ uitkomst: 'werkt', pct: 0, voorW: wVoor, naW: laagst, via: 'omvormer' });
  } else {
    uit(`- Het vermogen bleef ~${watt(bleef)}: deze omvormer begrenst zo niet (of er was te weinig zon om het te zien); zet de schakelaar in de app niet aan.`);
    nagekeken({ uitkomst: 'werkt-niet', pct: 0, voorW: wVoor, naW: bleef, reden: 'geen-effect' });
  }
  if (vijftig === 'te-weinig-zon') {
    uit(`- De 50%-proef heb ik overgeslagen: daarvoor moet hij vooraf meer dan ${watt(GENOEG_VOOR_50_W)} leveren. Dat kan later, op een zonnige dag.`);
  } else if (vijftig === 'gedaan') {
    const w50 = midden(lezingen50);
    const verwacht = nominaal > 0 ? Math.min(wVoor, nominaal * 0.5) : wVoor;
    if (!Number.isFinite(w50)) {
      uit('- Bij 50% kon ik het vermogen niet lezen; geef dit door.');
    } else if (w50 >= verwacht * 0.7) {
      uit(`- Bij 50% leverde hij ~${watt(w50)} (vooraf ${watt(wVoor)}${nominaal > 0 ? `, de helft van ${watt(nominaal)} is ${watt(nominaal / 2)}` : ''}): de grens telt in procent, gedeeltelijk begrenzen klopt.`);
    } else if (w50 <= (laagst ?? 0) + Math.max(300, wVoor * 0.1)) {
      uit(`- Bij 50% leverde hij bijna net zo weinig als bij 0% (~${watt(w50)}): de grens telt hier waarschijnlijk in 0,1% (50 = 5%). Gedeeltelijk begrenzen klopt dan niet; zet het in de app niet aan en geef dit door.`);
      nagekeken({ uitkomst: 'werkt-niet', pct: 50, voorW: wVoor, naW: w50, reden: 'te-veel' });
    } else {
      uit(`- Bij 50% leverde hij ~${watt(w50)} (vooraf ${watt(wVoor)}, bij 0% ${watt(laagst)}); dat is niet duidelijk. Geef de getallen door.`);
    }
  }
  uit(v.gelukt ? `- Vrijgeven lukte: de schakelaar staat weer uit; nu levert hij ${watt(wNa)} (hij komt rustig op gang). De grens blijft op ${lezingen50.length ? 50 : 0}% staan; met de schakelaar uit doet die niets.` : '- Vrijgeven lukte NIET. Zet de exportgrens in de app van GoodWe (SolarGo) uit, of draai deze test opnieuw.');
  return v.gelukt ? 'klaar' : 'vrijgeven-mislukt';
}
