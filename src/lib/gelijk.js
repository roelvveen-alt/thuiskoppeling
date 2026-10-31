/**
 * Vergelijken op de inhoud, zodat een gelijke stand geen nieuw scherm geeft
 * (prestaties-19). Elke 5 s komt er een nieuwe stand binnen (in het voorbeeld
 * elke 2 s): een nieuw object, ook als de prijs, de dag, de voorspelling of
 * het weer precies hetzelfde zijn. Met deelGelijk houdt elk deel dat niet
 * veranderde zijn oude object; wat daarop rekent (useMemo) of ermee tekent
 * (memo) hoeft dan niets te doen. Wat wel veranderde, is altijd nieuw: er
 * bevriest niets.
 */
import { useState } from 'react';

const gewoonObject = (v) => v !== null && typeof v === 'object' && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

/** Dezelfde inhoud (getallen, tekst, lijsten en gewone objecten; NaN is gelijk aan NaN). */
export function gelijk(a, b) {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!gelijk(a[i], b[i])) return false;
    return true;
  }
  if (!gewoonObject(a) || !gewoonObject(b)) return false;
  const sleutels = Object.keys(a);
  if (sleutels.length !== Object.keys(b).length) return false;
  for (const k of sleutels) if (!Object.hasOwn(b, k) || !gelijk(a[k], b[k])) return false;
  return true;
}

/**
 * `nieuw`, maar met de oude delen waar die gelijk zijn. Is alles gelijk, dan
 * `oud` zelf. Alleen de bovenste laag (de velden van een stand): daaronder
 * telt een deel als geheel.
 */
export function deelGelijk(oud, nieuw) {
  if (Object.is(oud, nieuw)) return oud;
  if (!gewoonObject(oud) || !gewoonObject(nieuw)) return gelijk(oud, nieuw) ? oud : nieuw;
  let anders = Object.keys(oud).length !== Object.keys(nieuw).length;
  const uit = {};
  for (const k of Object.keys(nieuw)) {
    if (Object.hasOwn(oud, k) && gelijk(oud[k], nieuw[k])) {
      uit[k] = oud[k];
    } else {
      uit[k] = nieuw[k];
      anders = true;
    }
  }
  return anders ? uit : oud;
}

/**
 * Een waarde die zijn vorige object houdt zolang de inhoud gelijk is (per
 * veld, zie deelGelijk). Zo kan een memo of useMemo verderop op het object
 * vertrouwen.
 */
export function useGelijk(waarde) {
  const [vorige, setVorige] = useState(waarde);
  const uit = deelGelijk(vorige, waarde);
  if (uit !== vorige) setVorige(uit);
  return uit;
}
