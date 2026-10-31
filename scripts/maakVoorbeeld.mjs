#!/usr/bin/env node
/**
 * Het voorbeeld (alleen nepcijfers) als één los HTML-bestand, om te bekijken
 * zonder Base44: bijvoorbeeld als pagina op je telefoon.
 *
 *   node scripts/maakVoorbeeld.mjs [uitvoerbestand]
 *
 * Bouwt met `vite build --mode voorbeeld` en zet de CSS en JavaScript in de
 * pagina zelf. Zonder <html>/<head>/<body>: de pagina komt in een geraamte dat
 * daar zelf voor zorgt. De lettertypes (public/fonts) gaan er als data-URI in.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { lettertypesErin } from './lettertypes.mjs';

const wortel = path.resolve(import.meta.dirname, '..');
const uit = path.resolve(process.argv[2] ?? path.join(wortel, 'dist-voorbeeld', 'voorbeeld.html'));

const bouw = spawnSync('npx', ['vite', 'build', '--mode', 'voorbeeld'], { cwd: wortel, stdio: 'inherit', shell: process.platform === 'win32' });
if (bouw.status !== 0) process.exit(bouw.status ?? 1);

const map = path.join(wortel, 'dist-voorbeeld');
const html = fs.readFileSync(path.join(map, 'index.html'), 'utf8');
const css = [...html.matchAll(/<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)"[^>]*>/g)].map((m) => m[1]);
const js = [...html.matchAll(/<script type="module"[^>]*src="\.\/(assets\/[^"]+\.js)"[^>]*><\/script>/g)].map((m) => m[1]);
if (css.length !== 1 || js.length !== 1) {
  console.error(`Verwachtte één CSS- en één JS-bestand in index.html, vond ${css.length} en ${js.length}.`);
  process.exit(1);
}
const lees = (bestand) => fs.readFileSync(path.join(map, bestand), 'utf8');
// Een "</script" of "</style" in de code zou de pagina te vroeg afsluiten.
const veiligScript = lees(js[0]).replaceAll('</script', '<\\/script');
const { css: metLetters, ontbreekt } = lettertypesErin(lees(css[0]), path.join(wortel, 'public', 'fonts'));
if (ontbreekt.length) {
  console.error(`Lettertype niet gevonden in public/fonts: ${ontbreekt.join(', ')}`);
  process.exit(1);
}
const veiligCss = metLetters.replaceAll('</style', '<\\/style');

const pagina = `<title>Energie thuis</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="description" content="Voorbeeld met nepcijfers: HomeWizard en de thuisbatterij samen op het huis, met de stroom die je ziet lopen.">
<style>
${veiligCss}
</style>
<div id="root"></div>
<script type="module">
${veiligScript}
</script>
`;

fs.mkdirSync(path.dirname(uit), { recursive: true });
fs.writeFileSync(uit, pagina);
console.log(`Klaar: ${path.relative(process.cwd(), uit)} (${Math.round(pagina.length / 1024)} kB)`);
