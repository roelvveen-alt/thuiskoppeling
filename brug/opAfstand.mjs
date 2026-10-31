import { constants, createDecipheriv, createHash, createPrivateKey, createPublicKey, generateKeyPairSync, privateDecrypt } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { bewaarInstellingen } from './instellen.mjs';
import { controleerInstellingen, leesJsonBestand } from './instellingen.mjs';
import { leesCloudsleutel } from './zendure.mjs';

/**
 * Op afstand instellen (0.7.0): de eigenaar zet in de app een geheim klaar,
 * zoals de Zendure-cloudsleutel, zonder naar dit apparaat te gaan.
 *
 *   1. Bij het starten maakt het programmaatje één keer een sleutelpaar
 *      (RSA-OAEP 2048) en bewaart het in op-afstand.json, naast
 *      instellingen.json, alleen voor jou (0600; staat in .gitignore). Alleen
 *      het publieke deel gaat mee naar de app (brug.publiek).
 *   2. De browser van de eigenaar versleutelt de waarde daarmee (een nieuwe
 *      AES-256-GCM-sleutel, ingepakt met RSA-OAEP; src/lib/opAfstand.js). Base44
 *      ziet en bewaart alleen het versleutelde stuk.
 *   3. ontvangMeting geeft het in zijn antwoord terug (alleen aan dit
 *      programmaatje, met de sleutel van dit huis); hier wordt het ontsleuteld,
 *      nagekeken en in instellingen.json gezet. Dat bestand veranderen laat het
 *      programmaatje netjes opnieuw starten (zie brug.mjs).
 *
 * Eén regel in het logboek per stuk, nooit de waarde. Wat wel en niet lukte,
 * gaat terug naar de app (brug.op_afstand), zodat de eigenaar het ziet.
 */

/** Wat op afstand mag; de server heeft dezelfde lijst (base44/shared/opAfstand.js). */
export const VELDEN = Object.freeze(['zendure.cloudsleutel']);
const NAAM = { 'zendure.cloudsleutel': 'de Zendure-cloudsleutel' };

/** Hetzelfde als in de browser: het veld zit in de controle van AES-GCM, zo kan het niet ongemerkt een ander veld worden. */
export const extraData = (veld) => Buffer.from(`thuis-energie op-afstand v1 ${veld}`, 'utf8');

/** De vingerafdruk van het publieke deel: de eerste 32 tekens van de SHA-256 over de bytes (DER). */
export const vingerafdruk = (publiek) => createHash('sha256').update(Buffer.from(publiek, 'base64')).digest('hex').slice(0, 32);

/** Waar op-afstand.json staat: naast instellingen.json. */
export function padNaast(instellingenPad) {
  const bestand = instellingenPad instanceof URL ? fileURLToPath(instellingenPad) : String(instellingenPad);
  return path.join(path.dirname(bestand), 'op-afstand.json');
}

/** Een nieuw sleutelpaar: het privé-deel als PEM (PKCS#8), het publieke als SPKI in base64. */
export function maakSleutelpaar() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { prive: privateKey, publiek: publicKey.toString('base64') };
}

function schrijf(pad, staat) {
  const tijdelijk = `${pad}.nieuw`;
  fs.rmSync(tijdelijk, { force: true });
  fs.writeFileSync(tijdelijk, `${JSON.stringify(staat, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  fs.renameSync(tijdelijk, pad);
}

/**
 * De korte vingerafdruk om met de app te vergelijken (0.13.0): de eerste 16 hex-tekens van
 * vingerafdruk(publiek), in groepjes van vier ("a1b2 c3d4 e5f6 0718"); de app toont hetzelfde.
 */
export const kortAfdruk = (publiek) =>
  vingerafdruk(publiek)
    .slice(0, 16)
    .match(/.{4}/g)
    .join(' ');

/**
 * Het publieke deel uit op-afstand.json, alleen lezen (voor proef): null als het er nog niet is
 * of niet klopt. Maakt nooit een nieuw paar; dat doet het draaiende programmaatje (laadOfMaak).
 */
export function leesPubliek(pad) {
  try {
    const staat = leesJsonBestand(fs.readFileSync(pad, 'utf8'), 'op-afstand.json');
    return geldig(staat) ? staat.publiek : null;
  } catch {
    return null;
  }
}

/** Klopt wat er staat (een privé-deel dat bij het publieke hoort)? */

function geldig(staat) {
  try {
    if (!staat || typeof staat.prive !== 'string' || typeof staat.publiek !== 'string') return false;
    const afgeleid = createPublicKey(createPrivateKey(staat.prive)).export({ type: 'spki', format: 'der' }).toString('base64');
    return afgeleid === staat.publiek;
  } catch {
    return false;
  }
}

/**
 * op-afstand.json lezen, of (de eerste keer, of als het kapot is) een nieuw
 * sleutelpaar maken en bewaren. Gooit niet: lukt het niet, dan null (dan kan
 * er niets op afstand, en meet het programmaatje gewoon door).
 * @returns {{ pad, prive, publiek, voor, toegepast: object } | null}
 */
export function laadOfMaak(pad, { log = () => {}, maak = maakSleutelpaar } = {}) {
  try {
    let staat = null;
    let kapot = false;
    try {
      staat = leesJsonBestand(fs.readFileSync(pad, 'utf8'), 'op-afstand.json');
      kapot = !geldig(staat);
    } catch (fout) {
      if (fout?.code !== 'ENOENT') kapot = true;
    }
    if (staat && !kapot) {
      // Met de hand gekopieerd: dan zetten we het recht goed.
      if (process.platform !== 'win32' && (fs.statSync(pad).mode & 0o077) !== 0) fs.chmodSync(pad, 0o600);
      return { pad, prive: staat.prive, publiek: staat.publiek, voor: vingerafdruk(staat.publiek), toegepast: toegepastUit(staat.toegepast) };
    }
    const nieuw = { ...maak(), gemaakt: new Date().toISOString(), toegepast: {} };
    schrijf(pad, nieuw);
    log(
      kapot
        ? 'op-afstand.json klopte niet; ik heb een nieuw sleutelpaar gemaakt. Wat al op afstand klaarstond, moet in de app opnieuw.'
        : 'Nieuw sleutelpaar gemaakt (op-afstand.json): de eigenaar kan nu in de app een sleutel op afstand instellen.',
    );
    return { pad, prive: nieuw.prive, publiek: nieuw.publiek, voor: vingerafdruk(nieuw.publiek), toegepast: {} };
  } catch (fout) {
    log(`Op afstand instellen kan nu niet (${fout?.code ?? fout?.message ?? 'fout'}); de rest werkt gewoon.`);
    return null;
  }
}

function toegepastUit(ruw) {
  const uit = {};
  for (const veld of VELDEN) {
    const t = ruw?.[veld];
    if (t && typeof t.op === 'string') uit[veld] = { op: t.op, ok: t.ok === true, ...(typeof t.fout === 'string' ? { fout: t.fout } : {}) };
  }
  return uit;
}

/** Wat er mee naar de app gaat (brug.op_afstand): per veld het moment van het laatste stuk en of het lukte. */
export function gemeldVoorApp(staat) {
  if (!staat) return [];
  return Object.entries(staat.toegepast).map(([veld, t]) => ({ veld, op: t.op, ok: t.ok, ...(t.fout ? { fout: t.fout } : {}) }));
}

/** Het stuk ontsleutelen; gooit als het niet voor dit sleutelpaar is of als er iets aan veranderd is. */
export function ontsleutel(stuk, prive) {
  const aes = privateDecrypt({ key: prive, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(stuk.sleutel, 'base64'));
  const data = Buffer.from(stuk.data, 'base64');
  if (aes.length !== 32 || data.length < 17) throw new Error('stuk klopt niet');
  const ontcijfer = createDecipheriv('aes-256-gcm', aes, Buffer.from(stuk.iv, 'base64'));
  ontcijfer.setAAD(extraData(stuk.veld));
  ontcijfer.setAuthTag(data.subarray(data.length - 16));
  const tekst = Buffer.concat([ontcijfer.update(data.subarray(0, data.length - 16)), ontcijfer.final()]).toString('utf8');
  const inhoud = JSON.parse(tekst);
  if (!inhoud || inhoud.veld !== stuk.veld || typeof inhoud.waarde !== 'string') throw new Error('stuk klopt niet');
  return inhoud.waarde;
}

/**
 * De Zendure-cloudsleutel in instellingen.json zetten: bij lokaal als reserve,
 * bij de cloud als de sleutel. Zonder Zendure in de instellingen: niets.
 * Geeft { fout } (een foutcode) of { geschreven, zin }.
 */
function zetCloudsleutel(instellingenPad, waarde) {
  try {
    leesCloudsleutel(waarde);
  } catch {
    return { fout: 'ongeldig' };
  }
  const ruw = leesJsonBestand(fs.readFileSync(instellingenPad, 'utf8'));
  if (!ruw?.zendure || typeof ruw.zendure !== 'object' || Array.isArray(ruw.zendure)) return { fout: 'geen-zendure' };
  const zin = ruw.zendure.manier === 'lokaal' ? 'de Zendure-cloudsleutel (als reserve)' : 'de Zendure-cloudsleutel';
  const sleutel = waarde.trim();
  if (ruw.zendure.cloudsleutel === sleutel) return { geschreven: false, zin };
  const nieuw = { ...ruw, zendure: { ...ruw.zendure, cloudsleutel: sleutel } };
  if (!controleerInstellingen(nieuw).ok) return { fout: 'ongeldig' };
  bewaarInstellingen(instellingenPad, nieuw);
  return { geschreven: true, zin };
}

const ZET = { 'zendure.cloudsleutel': zetCloudsleutel };

const UITLEG = {
  sleutelpaar: 'het is versleuteld voor een ander sleutelpaar; zet hem in de app opnieuw klaar',
  ongeldig: 'het lijkt geen geldige waarde; kijk hem na en zet hem in de app opnieuw klaar',
  'geen-zendure': 'er staat geen Zendure in instellingen.json; zet die eerst erin met node brug.mjs instellen',
  bewaren: 'instellingen.json bewaren lukte niet',
};

/**
 * Wat ontvangMeting teruggaf (op_afstand) oppakken: elk stuk dat nieuwer is
 * dan wat hier al is opgepakt. Gooit niet. Geeft { veranderd }: true als
 * instellingen.json veranderde (dan start brug.mjs netjes opnieuw).
 */
export function pakOp(stukken, staat, { instellingenPad, log = () => {} }) {
  let veranderd = false;
  if (!staat || !Array.isArray(stukken)) return { veranderd };
  const lijst = stukken
    .filter((s) => s && typeof s === 'object' && VELDEN.includes(s.veld) && typeof s.op === 'string')
    .sort((a, b) => (a.op < b.op ? -1 : 1));
  for (const stuk of lijst) {
    const eerder = staat.toegepast[stuk.veld];
    if (eerder && eerder.op >= stuk.op) continue;
    let fout = null;
    let waarde = null;
    if (stuk.voor !== staat.voor) fout = 'sleutelpaar';
    else {
      try {
        waarde = ontsleutel(stuk, staat.prive);
      } catch {
        fout = 'sleutelpaar';
      }
    }
    let uit = null;
    if (!fout) {
      try {
        uit = ZET[stuk.veld](instellingenPad, waarde);
        fout = uit.fout ?? null;
      } catch {
        fout = 'bewaren';
      }
    }
    const geschreven = !fout && uit?.geschreven === true;
    veranderd ||= geschreven;
    staat.toegepast[stuk.veld] = { op: stuk.op, ok: !fout, ...(fout ? { fout } : {}) };
    try {
      schrijf(staat.pad, { ...leesJsonBestand(fs.readFileSync(staat.pad, 'utf8'), 'op-afstand.json'), toegepast: staat.toegepast });
    } catch {
      // Lukt dit niet, dan komt het stuk de volgende keer gewoon nog eens; overnemen is steeds hetzelfde.
    }
    log(
      fout
        ? `Op afstand: ${NAAM[stuk.veld]} niet overgenomen: ${UITLEG[fout]}.`
        : `Op afstand ingesteld: ${uit.zin}${geschreven ? '; ik start opnieuw met de nieuwe instellingen' : ' (stond er al zo in)'}.`,
    );
  }
  return { veranderd };
}
