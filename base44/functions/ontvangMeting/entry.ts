// vingerafdruk: 5b532ca9b4968d54
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.57';
import { behandelMeting } from './ontvang.js';

/**
 * Hier stuurt het programmaatje thuis (brug/brug.mjs) elke ~5 seconden de
 * laatste stand naartoe.
 *
 *   POST { net_w, zon_w, batterij_w, batterij_procent, apparaten: [...], bron }
 *        header x-brug-sleutel: <de sleutel van dit huis, uit de app>
 *   →    { ok: true }
 *
 * Het werk staat in ontvang.js (sleutel → huis → die ene rij Meting, en
 * hooguit eens per kwartier de rij van vandaag in Dag, zie dagboek.js), de
 * rechten in base44/shared/toegang.js.
 *
 * De vingerafdruk hierboven hoort bij alles wat deze functie importeert. De
 * CLI van Base44 kijkt alleen of dit bestand veranderd is; zonder die regel
 * bleef de oude functie live als alleen een gedeeld bestand veranderde.
 * Bijwerken: node scripts/vingerafdruk.mjs
 */
Deno.serve((req) => behandelMeting(req, createClientFromRequest));
