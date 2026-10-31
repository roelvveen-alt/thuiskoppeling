/**
 * De foto van het huis op dit toestel bewaren, onder het vaste kenmerk dat de
 * server meestuurt (foto_id). De link naar de foto is elke keer anders (hij
 * verloopt na een uur), dus zonder dit haalt de browser hem bij elke opening
 * en elk uur opnieuw. Nu alleen als het een andere foto is.
 *
 * Alles is een extraatje: lukt het bewaren of ophalen niet (geen Cache API,
 * de opslag zit vol, de link mag niet via fetch), dan gewoon de link zelf,
 * zoals vroeger. Er staat steeds hooguit één foto in de kast.
 */
export const FOTO_KAST = 'thuis-energie-foto-v1';

function sleutelVan(id) {
  const basis = globalThis.location?.origin ?? 'http://localhost';
  return new URL(`/__foto/${encodeURIComponent(id)}`, basis).href;
}

/**
 * Wat er in <img src> moet: een blob-adres uit de kast, of de link zelf.
 * @param {string|null|undefined} id  het kenmerk van de server (een oude server stuurt het niet)
 * @param {string|null|undefined} url  de link die de server net maakte
 */
export async function fotoBron(id, url, { kasten = globalThis.caches, haal = globalThis.fetch, maakAdres = (blob) => URL.createObjectURL(blob) } = {}) {
  if (!url) return null;
  if (!id || !kasten || !haal) return url;
  try {
    const kast = await kasten.open(FOTO_KAST);
    const sleutel = sleutelVan(id);
    let antwoord = await kast.match(sleutel);
    if (!antwoord) {
      const vers = await haal(url);
      if (!vers?.ok) return url;
      await kast.put(sleutel, vers.clone());
      for (const oud of await kast.keys()) {
        if (oud.url !== sleutel) await kast.delete(oud);
      }
      antwoord = vers;
    }
    return maakAdres(await antwoord.blob());
  } catch {
    return url;
  }
}

/** Geen foto meer (gewist, andere omgeving zonder foto, uitloggen): de kast leeg. */
export async function wisFotoKast({ kasten = globalThis.caches } = {}) {
  try {
    await kasten?.delete(FOTO_KAST);
  } catch {
    // Niets aan te doen; de volgende foto ruimt hem op.
  }
}
