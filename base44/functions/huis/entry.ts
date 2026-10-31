// vingerafdruk: 428f3ee33a564f93
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.57';
import { behandelHuis } from '../../shared/huizen.js';

/**
 * Alles wat de site over een omgeving (een huis) vraagt of verandert: wie je
 * bent en welke omgevingen je hebt, de stand, de dagen van een periode, de
 * indeling, delen en de sleutel van het programmaatje. De acties staan in
 * base44/shared/huizen.js, wie wat mag in base44/shared/toegang.js.
 *
 *   POST { actie: 'mijn' | 'maak' | 'stand' | 'periode' | 'opstelling' | 'bewaarOpstelling'
 *                 | 'uitnodigen' | 'verwijderLid' | 'nieuweSleutel' | 'hernoem'
 *                 | 'zetOpAfstand' | 'wisOpAfstand' | 'labelHerkend', ... }
 *
 * De vingerafdruk hierboven hoort bij alles wat deze functie importeert. De
 * CLI van Base44 kijkt alleen of dit bestand veranderd is; zonder die regel
 * bleef de oude functie live als alleen een gedeeld bestand veranderde.
 * Bijwerken: node scripts/vingerafdruk.mjs
 */
Deno.serve((req) => behandelHuis(req, createClientFromRequest));
