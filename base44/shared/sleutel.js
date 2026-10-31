/**
 * De sleutel van het programmaatje thuis: 24 willekeurige bytes, als 48
 * tekens hex. De server bewaart alleen de SHA-256 ervan (Huis.brug_sleutel_hash)
 * en laat de sleutel zelf één keer zien, aan de eigenaar. Wie de database ziet,
 * kan er dus niet mee namens een huis meten sturen.
 */

export const SLEUTEL_VORM = /^[a-f0-9]{48}$/;

export const sleutelVorm = (sleutel) => typeof sleutel === 'string' && SLEUTEL_VORM.test(sleutel);

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

export function maakSleutel() {
  return hex(crypto.getRandomValues(new Uint8Array(24)));
}

export async function sha256Hex(tekst) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(tekst))));
}
