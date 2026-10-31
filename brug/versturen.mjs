import { APP_VERBINDING, inGewoneWoorden, vraagJson } from './web.mjs';

/**
 * Eén stand naar de functie ontvangMeting in Base44 sturen, met de geheime
 * code in de kop. Gooit niet: geeft { ok } of { ok: false, status, fout }.
 * Een nieuwere functie zegt welke losse blokken hij oversloeg (`overgeslagen`),
 * en geeft mee wat er op afstand klaarstaat (`op_afstand`, sinds 0.7.0).
 */
export async function verstuur(app, meting, { vraag = vraagJson } = {}) {
  try {
    const { status, json } = await vraag(app.adres, {
      methode: 'POST',
      kop: { 'x-brug-sleutel': app.sleutel },
      lichaam: meting,
      tijd: 10_000,
      // Elke 5 s over dezelfde verbinding (keep-alive, 1.3.0), niet elke keer een nieuwe TLS-verbinding.
      agent: APP_VERBINDING,
    });
    if (status === 200 && json?.ok) {
      const overgeslagen = Array.isArray(json.overgeslagen) ? json.overgeslagen.filter((t) => typeof t === 'string') : [];
      // Wat de eigenaar op afstand klaarzette (0.7.0, versleuteld; opAfstand.mjs). Een oudere functie stuurt het niet.
      const opAfstand = Array.isArray(json.op_afstand) ? json.op_afstand.filter((s) => s && typeof s === 'object').slice(0, 8) : [];
      // De labels uit de app (0.11.0, herkennen.mjs), als ze veranderd zijn; herkennen.mjs kijkt ze na. Een oudere functie stuurt ze niet.
      const labels = Array.isArray(json.herkend_labels) ? json.herkend_labels.filter((l) => l && typeof l === 'object').slice(0, 200) : [];
      return {
        ok: true,
        ...(overgeslagen.length ? { overgeslagen } : {}),
        ...(opAfstand.length ? { op_afstand: opAfstand } : {}),
        ...(labels.length ? { herkend_labels: labels } : {}),
        // De omvormer begrenzen bij een negatieve prijs (1.5.0, omvormerPlan.mjs kijkt het na). Een oudere functie stuurt het niet: dan uit.
        ...(json.omvormer_sturen && typeof json.omvormer_sturen === 'object' && !Array.isArray(json.omvormer_sturen) ? { omvormer_sturen: json.omvormer_sturen } : {}),
      };
    }
    return { ok: false, status, fout: json?.error ?? `antwoord ${status}` };
  } catch (fout) {
    return { ok: false, status: 0, fout: inGewoneWoorden(fout) };
  }
}

/**
 * De blokken die niet elke keer mee hoeven; de stand zelf (net, zon, batterij, prijs, vandaag) wel.
 * herkend (0.11.0) gaat mee als het verandert en eens per minuut; de app laat het staan tot het weer komt.
 * kennis (1.4.0): de veldnamen per apparaat, hooguit eens per dag per apparaat (kennis.mjs); alleen de beheerder ziet het.
 * spanning (1.5.0): de spanningswacht (spanning.mjs), eens per minuut.
 */
export const EXTRA_BLOKKEN = ['voorspelling', 'weer', 'dag', 'gekoppeld', 'brug', 'herkend', 'kennis', 'spanning'];

/** De functie weigert boven 20.000 tekens (ontvang.js); wij blijven er ruim onder. */
export const HOOGSTENS_TEKENS = 18_000;

const lengte = (meting) => JSON.stringify(meting).length;

/**
 * Past de meting? Zo niet, dan gaat deze keer de grootste extra eruit (en zo
 * nodig de volgende). Geeft { meting, weg: ['dag', …] }.
 */
export function pasInGrootte(meting, hoogstens = HOOGSTENS_TEKENS) {
  let uit = meting;
  const weg = [];
  while (lengte(uit) > hoogstens) {
    const grootste = EXTRA_BLOKKEN.filter((b) => uit[b] != null).sort((a, b) => lengte(uit[b]) - lengte(uit[a]))[0];
    if (!grootste) break;
    uit = Object.fromEntries(Object.entries(uit).filter(([veld]) => veld !== grootste));
    weg.push(grootste);
  }
  return { meting: uit, weg };
}

/**
 * Hoe vaak elk extra blok mee moet als het niet verandert. De dag, de koppelingen
 * en het brugblok elke minuut; herkend elke minuut (en meteen als het verandert);
 * de voorspelling en het weer eens per kwartier (en als ze veranderen). De app
 * voegt samen: wat ontbreekt blijft staan.
 */
export const EXTRA_ELKE_MS = Object.freeze({ dag: 60_000, gekoppeld: 60_000, brug: 60_000, herkend: 60_000, voorspelling: 15 * 60_000, weer: 15 * 60_000, kennis: 24 * 60 * 60_000, spanning: 60_000 });

/**
 * De extra's die mee moeten, zo dat de meting onder `hoogstens` blijft (0.13.0).
 * Wat het langst niet meeging eerst; wat er deze keer niet meer bij past, gaat
 * de volgende ronde (5 s later) mee. Zo komt elk blok aan de beurt en gaat er
 * niet meer telkens hetzelfde grote blok (de dag) weg, zoals bij pasInGrootte.
 * Geeft { meting, mee: [...], later: [...], teGroot: [...] }; teGroot: past
 * zelfs alleen met de stand niet (dat blijft zo tot het kleiner wordt).
 */
export function kiesExtras(meting, extras, laatst = {}, hoogstens = HOOGSTENS_TEKENS) {
  const uit = { ...meting };
  const basis = lengte(uit);
  let nu = basis;
  const mee = [];
  const later = [];
  const teGroot = [];
  const volgorde = EXTRA_BLOKKEN.filter((b) => extras?.[b] != null).sort((a, b) => (laatst[a] ?? 0) - (laatst[b] ?? 0));
  for (const blok of volgorde) {
    // Erbij in een object dat al velden heeft: ,"blok":waarde
    const extra = JSON.stringify(blok).length + 2 + lengte(extras[blok]);
    if (basis + extra > hoogstens) teGroot.push(blok);
    else if (nu + extra <= hoogstens) {
      uit[blok] = extras[blok];
      nu += extra;
      mee.push(blok);
    } else later.push(blok);
  }
  return { meting: uit, mee, later, teGroot };
}

/**
 * De stand wat kleiner, voor als een extra blok er anders nooit bij past (1.4.0):
 * tot 18 accu's met alles (cellen, gezondheid, laadcycli) kosten zo'n 2.000 tekens.
 *   stap 1  per accu alleen nr, temperatuur en procent (zoals voor 1.4.0)
 *   stap 2  zonder de lijst per accu (de batterij zelf blijft: temperatuur, grenzen, inhoud)
 * Alleen in de ronde dat het nodig is; de volgende ronde gaat alles weer mee. Niets te
 * verkleinen: dezelfde meting terug.
 */
export function minderAccus(meting, stap) {
  const accus = meting?.batterij_info?.accus;
  if (!Array.isArray(accus) || !accus.length) return meting;
  const kort = stap === 1 ? accus.map(({ nr, temp_c, procent }) => ({ nr, ...(temp_c === undefined ? {} : { temp_c }), ...(procent === undefined ? {} : { procent }) })) : null;
  const rest = Object.fromEntries(Object.entries(meting.batterij_info).filter(([veld]) => veld !== 'accus'));
  return { ...meting, batterij_info: kort ? { ...rest, accus: kort } : rest };
}

/**
 * Zoals kiesExtras, maar past een blok zelfs met de stand alleen niet (teGroot), dan
 * eerst de accu's korter (minderAccus): liever deze ronde minder per accu dan een dag
 * die nooit aankomt. Geeft wat kiesExtras geeft, met `kleiner` (1 of 2) als dat nodig was.
 */
export function kiesExtrasPassend(meting, extras, laatst = {}, hoogstens = HOOGSTENS_TEKENS) {
  let gekozen = kiesExtras(meting, extras, laatst, hoogstens);
  for (const stap of [1, 2]) {
    if (!gekozen.teGroot.length) break;
    const klein = minderAccus(meting, stap);
    if (klein === meting) break;
    const opnieuw = kiesExtras(klein, extras, laatst, hoogstens);
    if (opnieuw.teGroot.length < gekozen.teGroot.length) gekozen = { ...opnieuw, kleiner: stap };
  }
  return gekozen;
}

/**
 * Houdt per extra blok bij wanneer het het laatst echt aankwam, en wat de kern
 * was (voor "alleen als het verandert"). `nodig` zegt of het deze ronde mee moet;
 * `verstuurd` na een geslaagde verzending (alleen wat er echt in zat).
 */
export function extraPlanner(elke = EXTRA_ELKE_MS) {
  const laatst = {};
  const kern = {};
  return {
    laatst,
    nodig(blok, nu, k = null) {
      if (laatst[blok] === undefined) return true;
      return nu - laatst[blok] >= elke[blok] || (k !== null && k !== kern[blok]);
    },
    verstuurd(meting, kernen, nu) {
      for (const blok of EXTRA_BLOKKEN) {
        if (meting[blok] == null) continue;
        laatst[blok] = nu;
        if (blok in kernen) kern[blok] = kernen[blok];
      }
    },
  };
}

const zonderExtras = (meting) =>
 Object.fromEntries(Object.entries(meting).filter(([veld]) => !EXTRA_BLOKKEN.includes(veld)));

/**
 * Versturen. Weigert de app een meting mét extra's (400: een blok klopt niet,
 * of een vorm die een oudere functie nog niet kent; 413: te groot), dan meteen
 * nog eens zonder extra's: de stand van nu komt dan toch aan.
 * Geeft wat verstuur geeft, plus `geweigerd` (de reden van de app) als de extra's eruit moesten.
 */
export async function verstuurMetTerugval(app, meting, { stuur = verstuur } = {}) {
  const uit = await stuur(app, meting);
  const metExtra = EXTRA_BLOKKEN.some((b) => meting[b] != null);
  if (uit.ok || !metExtra || (uit.status !== 400 && uit.status !== 413)) return uit;
  const opnieuw = await stuur(app, zonderExtras(meting));
  return { ...opnieuw, geweigerd: uit.fout };
}

const getalNl = (n) => n.toLocaleString('nl-NL');

/**
 * Voor proef: wat er naar de app zou gaan, kort (0.13.0), zodat het overzicht erboven op een
 * telefoon- of Chromebookscherm blijft staan. De hele meting alleen met `proef --alles`.
 */
export function metingKort(meting) {
  const velden = Object.keys(meting);
  const blokken = velden
    .filter((v) => meting[v] !== null && typeof meting[v] === 'object')
    .map((v) => `${v} (${getalNl(lengte(meting[v]))})`);
  return [
    `${getalNl(lengte(meting))} tekens (de app neemt er hooguit ${getalNl(20_000)} aan; het programmaatje blijft onder ${getalNl(HOOGSTENS_TEKENS)}).`,
    `Velden: ${velden.join(', ')}.`,
    ...(blokken.length ? [`Blokken (tekens): ${blokken.join(', ')}.`] : []),
  ];
}

/** Voor proef --versturen: het antwoord van de app in gewone woorden. */
export function antwoordInWoorden(uit) {
  if (uit.ok) return `De app neemt de meting aan.${uit.overgeslagen?.length ? ` Overgeslagen: ${uit.overgeslagen.join('; ')}.` : ''}`;
  if (uit.status === 401) return 'De app kent deze sleutel niet. Zet de goede erin met: node brug.mjs instellen (in de app: Instellingen › Delen › Nieuwe sleutel).';
  if (uit.status === 404) return 'Het adres van de app klopt niet (404). Kijk "app.adres" in instellingen.json na (de instelhulp vult het in).';
  if (uit.status === 429) return 'Base44 remt even (429); de sleutel en het adres kloppen wel. Probeer het over een minuut nog eens.';
  if (uit.status === 0) return `De app is niet te bereiken: ${uit.fout}. Is er internet?`;
  return `De app weigert de meting (${uit.status}): ${uit.fout}`;
}
