import { createHash } from 'node:crypto';

/**
 * Een vast kenmerk van een apparaat in de wifi (programmaatje-15, sinds 1.3.0):
 * een vingerafdruk van zijn serienummer (HomeWizard, Zendure, GoodWe), niet het
 * nummer zelf. Daarmee ziet het programmaatje of er op een adres nog hetzelfde
 * apparaat zit, en vindt het een meter terug als de router hem een ander adres
 * gaf (adressen.mjs). Het kenmerk blijft op dit apparaat (adressen.json) en gaat
 * nooit naar de app; uit een kenmerk is het serienummer niet terug te halen.
 *
 * Geeft 16 tekens (0-9, a-f), of null zonder serienummer.
 */
export function kenmerkVan(serienummer) {
  const tekst = typeof serienummer === 'string' ? serienummer.trim().toLowerCase() : '';
  if (!tekst || tekst.length > 80) return null;
  return createHash('sha256').update(`thuis-energie apparaat ${tekst}`).digest('hex').slice(0, 16);
}

/**
 * Op het adres antwoordt een ander apparaat dan we kennen (een andere meter,
 * of een ander merk). De tekst is gewone taal, zonder adres of serienummer:
 * hij komt ook als melding in de app.
 */
export class AnderApparaat extends Error {
  constructor(tekst) {
    super(tekst);
    this.name = 'AnderApparaat';
    this.code = 'ANDER_APPARAAT';
  }
}
