/**
 * Tekst van buiten (het programmaatje, een apparaat in de wifi, een naam die
 * iemand typt) zonder stuurtekens, onzichtbare tekens en omkeertekens: die
 * kunnen in de app of een terminal iets anders laten zien dan er staat.
 * Tab en nieuwe regel worden een spatie; daarna op lengte geknipt (op hele
 * tekens, niet halverwege een emoji). Geen tekst: een lege.
 */
// eslint-disable-next-line no-control-regex -- juist deze tekens moeten eruit
const ONZICHTBAAR = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

export function schoon(waarde, max) {
  if (typeof waarde !== 'string') return '';
  const tekst = waarde
    .normalize('NFC')
    .replace(/[\t\n\r]/g, ' ')
    .replace(ONZICHTBAAR, '')
    .replace(/ {2,}/g, ' ')
    .trim();
  return Array.from(tekst).slice(0, max).join('').trim();
}
