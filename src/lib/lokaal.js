/** Iets onthouden op dit toestel (localStorage), zonder te struikelen als dat niet mag. */

export function leesLokaal(sleutel) {
  try {
    const tekst = window.localStorage.getItem(sleutel);
    return tekst ? JSON.parse(tekst) : null;
  } catch {
    return null;
  }
}

/** @returns {boolean} false als het niet lukte (vol of geblokkeerd): dan blijft het tot je de pagina sluit. */
export function schrijfLokaal(sleutel, waarde) {
  try {
    if (waarde == null) window.localStorage.removeItem(sleutel);
    else window.localStorage.setItem(sleutel, JSON.stringify(waarde));
    return true;
  } catch {
    return false;
  }
}
