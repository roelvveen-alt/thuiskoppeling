/**
 * Rooktest in echte Deno (zoals Base44 de functies draait): één meting via
 * ontvangMeting en één 'stand' via huis, met de nep-Base44 uit nep.js. Vangt
 * wat vitest (Node) niet ziet, zoals Buffer of een import uit 'node:…' in de
 * servercode.
 *
 *   npx --yes deno@2.9.6 run --allow-read base44/tests/rook.deno.js
 *
 * In de poorten (scripts/poorten.mjs). vitest pakt deze naam niet op, en de
 * CLI stuurt base44/tests niet mee naar Base44.
 */
import { behandelMeting } from '../functions/ontvangMeting/ontvang.js';
import { behandelHuis } from '../shared/huizen.js';
import { sha256Hex } from '../shared/sleutel.js';
import { nepBase44, verzoek, zonderWachten } from './nep.js';

const SLEUTEL = '0123456789abcdef'.repeat(3);
const TIM = { id: 'gebruiker-tim', email: 'tim@voorbeeld.nl', role: 'admin' };
const nep = nepBase44({
  gebruiker: TIM,
  rijen: {
    Huis: [{ id: 'huis-tim01', naam: 'Thuis', eigenaar_id: TIM.id, eigenaar_email: TIM.email, leden: [], brug_sleutel_hash: await sha256Hex(SLEUTEL) }],
    Meting: [],
    Opstelling: [],
    Dag: [],
  },
});

function eis(waar, tekst) {
  if (!waar) {
    console.error(`Rooktest in Deno: ${tekst}`);
    Deno.exit(1);
  }
}

const meting = await behandelMeting(
  verzoek({ moment: '2026-10-30T12:00:00.000Z', net_w: -312, zon_w: 1500, bron: 'brug rooktest' }, { kop: { 'x-brug-sleutel': SLEUTEL } }),
  () => nep.client,
  { nu: () => new Date('2026-10-30T12:00:00Z'), geheugen: new Map(), dagGeheugen: new Map(), geduld: zonderWachten },
);
eis(meting.status === 200, `ontvangMeting gaf ${meting.status}: ${await meting.text()}`);

const stand = await behandelHuis(verzoek({ actie: 'stand', huis_id: 'huis-tim01' }, { kop: { Authorization: 'Bearer test' } }), () => nep.client, {
  geduld: zonderWachten,
  geheugen: new Map(),
});
const data = await stand.json();
eis(stand.status === 200, `stand gaf ${stand.status}: ${JSON.stringify(data)}`);
eis(data?.meting?.net_w === -312, `stand gaf niet de meting terug: ${JSON.stringify(data)}`);
console.log('Rooktest in Deno: ontvangMeting 200, stand 200, de meting komt aan.');
