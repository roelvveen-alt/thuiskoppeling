import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { AnderApparaat, kenmerkVan } from './kenmerk.mjs';
import { bereik } from './zoek.mjs';

/**
 * Apparaten terugvinden als de router ze een ander adres geeft (programmaatje-15,
 * sinds 1.3.0). Zonder dit vond het programmaatje een meter met een nieuw adres
 * nooit meer, en bij een HomeWizard met v1 kon het zelfs een andere meter lezen.
 *
 *   onthouden   per apparaat een vast kenmerk (kenmerk.mjs: een vingerafdruk van het
 *               serienummer, nooit het nummer zelf) en het adres van nu, in
 *               adressen.json naast instellingen.json. Dat bestand blijft thuis en
 *               gaat nooit naar de app; instellingen.json blijft zoals je hem maakte.
 *   nagaan      bij elk antwoord (Zendure), elke nieuwe verbinding (HomeWizard v2:
 *               het certificaat; v1: /api) of na een gat (GoodWe) of het nog
 *               hetzelfde apparaat is. Het eerste antwoord na het bijwerken leert het
 *               kenmerk, als instellingen.json geen serienummer heeft.
 *   zoeken      antwoordt een apparaat ZOEK_NA_MS niet (de omvormer: OMVORMER_ZOEK_NA_MS
 *               overdag; 's nachts slaapt hij), of zit er een ander apparaat op zijn
 *               adres, dan zoeken we het in hetzelfde netwerk (zoek.mjs), op de
 *               achtergrond: de rondes lopen gewoon door. Rustig: hooguit één
 *               zoektocht tegelijk, nooit binnen ZOEK_TUSSEN_MS na de vorige, en vindt
 *               hij het niet, dan pas na ZOEK_OPNIEUW_MS weer (oplopend).
 *   gevonden    het nieuwe adres meteen gebruiken en bewaren, met een regel in het
 *               logboek ("Meterkast gevonden op een nieuw adres: …") en een kwartier
 *               een melding in de app (zonder adres).
 *
 * Verandert iemand het adres in instellingen.json (de instelhulp), dan geldt dat
 * weer: een bewaard adres hoort bij het adres dat toen in instellingen.json stond.
 */

/** Zo lang geen antwoord voordat we gaan zoeken (een herstart van de meter of de router duurt korter). */
export const ZOEK_NA_MS = 3 * 60_000;
/** De omvormer: zo lang overdag geen antwoord (bij weinig licht slaapt hij ook overdag nog even). */
export const OMVORMER_ZOEK_NA_MS = 60 * 60_000;
/** Niet gevonden: zo lang wachten voor de volgende zoektocht, steeds langer (daarna elke 3 uur). */
export const ZOEK_OPNIEUW_MS = Object.freeze([15 * 60_000, 60 * 60_000, 3 * 60 * 60_000]);
/** Nooit twee zoektochten dichter op elkaar dan dit. */
export const ZOEK_TUSSEN_MS = 5 * 60_000;
/** Zo lang staat "gevonden op een nieuw adres" als melding in de app (en dus één keer in het logboek). */
export const GEVONDEN_MELDING_MS = 15 * 60_000;

const ADRES = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const KENMERK = /^[0-9a-f]{16}$/;

/** Het /24-netwerk van een IP-adres ("192.168.1.20" → "192.168.1."), of null (een naam, of geen adres). */
export function netVan(adres) {
  const deel = ADRES.exec(String(adres ?? ''));
  if (!deel || deel.slice(1).some((d) => Number(d) > 255)) return null;
  return `${deel[1]}.${deel[2]}.${deel[3]}.`;
}

/** Waar adressen.json staat: naast instellingen.json (of BRUG_ADRESSEN). */
export function adressenPad(instellingenPad, omgeving = process.env) {
  if (omgeving.BRUG_ADRESSEN) return omgeving.BRUG_ADRESSEN;
  const bestand = instellingenPad instanceof URL ? fileURLToPath(instellingenPad) : String(instellingenPad);
  return path.join(path.dirname(bestand), 'adressen.json');
}

/** adressen.json lezen; weg of kapot is gewoon leeg (dan leert het programmaatje het opnieuw). */
export function laadAdressen(pad) {
  try {
    const ruw = JSON.parse(fs.readFileSync(pad, 'utf8'));
    return ruw && typeof ruw === 'object' && !Array.isArray(ruw) && ruw.apparaten && typeof ruw.apparaten === 'object' ? ruw.apparaten : {};
  } catch {
    return {};
  }
}

/** adressen.json veilig wegschrijven (eerst .nieuw, dan erover). Geeft de fout, of null. */
export function bewaarAdressen(pad, apparaten) {
  try {
    const nieuw = `${pad}.nieuw`;
    fs.writeFileSync(nieuw, `${JSON.stringify({ uitleg: 'Waar de apparaten in de wifi nu zitten (programmaatje, sinds 1.3.0). Mag weg: dan leert het programmaatje het opnieuw.', apparaten }, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(nieuw, pad);
    return null;
  } catch (fout) {
    return fout;
  }
}

/**
 * Welke apparaten we kunnen nagaan en terugvinden, uit de instellingen. `instelling` is het
 * object uit de instellingen zelf: het adres daarin verandert mee, zodat alles wat het leest
 * (meten, namen in het logboek, de lijst in de app) het nieuwe adres gebruikt.
 * Tuya-apparaten en de Zendure via de cloud niet (die hebben geen adres dat we zoeken).
 */
export function apparatenUit(instellingen) {
  const lijst = (instellingen.homewizard ?? []).map((m) => ({ sleutel: m.sleutel, naam: m.naam, merk: 'HomeWizard', instelling: m, serienummer: m.serienummer ?? null }));
  if (instellingen.zendure?.manier === 'lokaal') lijst.push({ sleutel: 'zendure', naam: 'Zendure-batterij', merk: 'Zendure', instelling: instellingen.zendure });
  if (instellingen.zendure_p1) lijst.push({ sleutel: 'zendure-p1', naam: 'Zendure P1-meter', merk: 'Zendure', instelling: instellingen.zendure_p1 });
  if (instellingen.goodwe) lijst.push({ sleutel: 'goodwe', naam: 'Omvormer', merk: 'GoodWe', instelling: instellingen.goodwe, omvormer: true });
  return lijst.filter((a) => typeof a.instelling?.adres === 'string');
}

/**
 * @param {object} o
 * @param {object} o.instellingen      uit laadInstellingen; de adressen erin worden bijgewerkt
 * @param {object} [o.opgeslagen]      uit laadAdressen
 * @param {(apparaten: object) => (Error|null|void)} [o.bewaar]
 * @param {(tekst: string) => void} [o.log]
 * @param {null | ((o: { netten: string[], merken: Set<string> }) => Promise<Array<{ adres, merk, kenmerk? }>>)} [o.zoek]
 *   zoekOpnieuw uit zoek.mjs; null = niet zoeken (proef)
 * @param {() => number} [o.klok]
 */
export function maakAdressen({ instellingen, opgeslagen = {}, bewaar = () => null, log = () => {}, zoek = null, klok = Date.now }) {
  const lijst = apparatenUit(instellingen).map((a) => {
    const oud = opgeslagen?.[a.sleutel];
    // Een bewaard adres geldt alleen zolang instellingen.json nog hetzelfde zegt als toen.
    const geldig = oud && typeof oud === 'object' && oud.instellingen === a.instelling.adres && netVan(oud.adres) !== null;
    const vanInstellingen = a.serienummer ? kenmerkVan(a.serienummer) : null;
    const bewaard = geldig && KENMERK.test(oud.kenmerk ?? '') ? oud.kenmerk : null;
    const plek = {
      ...a,
      oorspronkelijk: a.instelling.adres,
      kenmerk: vanInstellingen ?? bewaard,
      verplaatstOp: geldig && oud.adres !== a.instelling.adres && typeof oud.sinds === 'string' ? oud.sinds : null,
      zoekNa: a.omvormer ? OMVORMER_ZOEK_NA_MS : ZOEK_NA_MS,
      wegSinds: null,
      ander: false,
      pogingen: 0,
      volgende: 0,
      zonderKenmerkGezegd: false,
    };
    if (geldig) a.instelling.adres = oud.adres;
    return plek;
  });
  const perSleutel = new Map(lijst.map((p) => [p.sleutel, p]));
  let meldingen = [];
  let bezig = null;
  let laatsteZoektocht = -Infinity;
  let bewaarFoutGezegd = false;

  function bewaarNu() {
    const apparaten = {};
    for (const p of lijst) {
      if (!p.kenmerk && p.instelling.adres === p.oorspronkelijk) continue;
      apparaten[p.sleutel] = {
        instellingen: p.oorspronkelijk,
        adres: p.instelling.adres,
        ...(p.kenmerk ? { kenmerk: p.kenmerk } : {}),
        ...(p.verplaatstOp ? { sinds: p.verplaatstOp } : {}),
      };
    }
    const fout = bewaar(apparaten);
    if (fout && !bewaarFoutGezegd) log(`Kon adressen.json niet bewaren (${fout.code ?? 'fout'}); na een herstart zoek ik de apparaten zo nodig opnieuw.`);
    bewaarFoutGezegd = Boolean(fout);
  }

  function weg(p, nu) {
    p.wegSinds ??= nu;
  }

  /** Wat de lezer van een apparaat gebruikt om na te gaan of het nog hetzelfde is. */
  function plek(sleutel) {
    const p = perSleutel.get(sleutel);
    if (!p) return null;
    return {
      get adres() {
        return p.instelling.adres;
      },
      /**
       * Het serienummer dat het apparaat nu noemt. Nog geen kenmerk: dit is het (leren).
       * Een ander: AnderApparaat, en zo snel mogelijk zoeken.
       */
      controleer(serienummer) {
        const k = kenmerkVan(serienummer);
        if (!k) return;
        if (!p.kenmerk) {
          p.kenmerk = k;
          bewaarNu();
          return;
        }
        if (k === p.kenmerk) return;
        p.ander = true;
        weg(p, klok());
        throw new AnderApparaat(`op dit adres zit nu een ander apparaat (${p.merk}); ik zoek ${p.naam} in het netwerk`);
      },
    };
  }

  /**
   * Na elke lezing: ok, of niet. `rust`: niet meetellen (de omvormer 's nachts: dan slaapt hij,
   * en begint de klok voor het zoeken pas weer als het dag is).
   */
  function gelezen(sleutel, { ok, nu = klok(), rust = false }) {
    const p = perSleutel.get(sleutel);
    if (!p) return;
    if (ok) {
      p.wegSinds = null;
      p.ander = false;
      p.pogingen = 0;
      p.volgende = 0;
      return;
    }
    if (rust) {
      p.wegSinds = null;
      return;
    }
    weg(p, nu);
  }

  async function zoektocht(nodig) {
    const netten = [...new Set(nodig.map((p) => netVan(p.instelling.adres)).filter(Boolean))];
    const merken = new Set(nodig.map((p) => p.merk));
    const namen = nodig.map((p) => p.naam).join(', ');
    log(`${namen}: ${nodig.length > 1 ? 'antwoorden' : 'antwoordt'} niet op ${nodig.length > 1 ? 'hun' : 'zijn'} adres (of daar zit een ander apparaat); ik zoek in ${bereik(netten)}.`);
    let gevonden = [];
    try {
      gevonden = await zoek({ netten, merken });
    } catch (fout) {
      log(`Zoeken lukte niet (${fout?.message ?? fout}).`);
    }
    const nu = klok();
    for (const p of nodig) {
      // Kwam hij tijdens het zoeken vanzelf terug, dan is er niets te doen.
      if (p.wegSinds === null) continue;
      const g = gevonden.find((x) => x.merk === p.merk && x.kenmerk === p.kenmerk);
      if (g && g.adres !== p.instelling.adres) {
        const oud = p.instelling.adres;
        p.instelling.adres = g.adres;
        p.verplaatstOp = new Date(nu).toISOString();
        p.ander = false;
        p.pogingen = 0;
        p.volgende = 0;
        // Pas weg als de volgende lezing lukt; tot dan geen nieuwe zoektocht voor hem.
        p.wegSinds = nu;
        bewaarNu();
        log(`${p.naam} gevonden op een nieuw adres: ${oud} → ${g.adres} (de router gaf hem een ander adres). Bewaard in adressen.json; instellingen.json blijft zoals hij is.`);
        meldingen.push({ tekst: `${p.naam}: kreeg van de router een ander adres; weer gevonden.`, sinds: nu });
        continue;
      }
      const wacht = ZOEK_OPNIEUW_MS[Math.min(p.pogingen, ZOEK_OPNIEUW_MS.length - 1)];
      p.pogingen += 1;
      p.volgende = nu + wacht;
      if (g) log(`${p.naam}: wel gevonden, op hetzelfde adres; misschien even weg geweest.`);
      else log(`${p.naam}: niet gevonden in ${bereik(netten)} (uit, of niet in de wifi?). Ik zoek over ${Math.round(wacht / 60_000)} minuten opnieuw.`);
    }
  }

  return {
    plek,
    gelezen,
    /**
     * Na elke ronde: moet er gezocht worden? Dan op de achtergrond (geeft de belofte, of null).
     * Een apparaat zonder kenmerk kunnen we niet herkennen: dat zeggen we één keer.
     */
    tik(nu = klok()) {
      if (!zoek || bezig || nu - laatsteZoektocht < ZOEK_TUSSEN_MS) return null;
      const nodig = [];
      for (const p of lijst) {
        if (p.wegSinds === null) continue;
        const vanaf = Math.max(p.volgende, p.wegSinds + (p.ander ? 0 : p.zoekNa));
        if (nu < vanaf) continue;
        if (!p.kenmerk) {
          if (!p.zonderKenmerkGezegd) log(`${p.naam} antwoordt niet; ik weet niet genoeg van hem om hem zelf terug te vinden. Zoek hem met: node brug.mjs instellen`);
          p.zonderKenmerkGezegd = true;
          continue;
        }
        if (netVan(p.instelling.adres) === null) continue;
        nodig.push(p);
      }
      if (!nodig.length) return null;
      laatsteZoektocht = nu;
      bezig = zoektocht(nodig)
        .catch((fout) => log(`Zoeken lukte niet (${fout?.message ?? fout}).`))
        .finally(() => {
          bezig = null;
        });
      return bezig;
    },
    /** Wat er als melding in de app staat: { tekst, sinds } van het laatste kwartier, nieuwste eerst. */
    meldingen(nu = klok()) {
      meldingen = meldingen.filter((m) => nu - m.sinds < GEVONDEN_MELDING_MS);
      return [...meldingen].reverse();
    },
    /** Voor het begin van het logboek: wat er nu anders is dan in instellingen.json. */
    verplaatst() {
      return lijst.filter((p) => p.instelling.adres !== p.oorspronkelijk).map((p) => ({ naam: p.naam, adres: p.instelling.adres, instellingen: p.oorspronkelijk }));
    },
    get bezig() {
      return bezig !== null;
    },
  };
}
