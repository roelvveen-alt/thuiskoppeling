#!/usr/bin/env node
/**
 * Het app-icoon: een huisje met een bliksem erdoor en een batterij die laadt
 * (een wens). Eén tekening hieronder; dit script maakt er de bestanden in
 * public/ van:
 *
 *   favicon.svg            tabblad, met ronde hoeken
 *   apple-touch-icon.png   iPhone-beginscherm (180 px; iOS rondt zelf af)
 *   icon-192.png, icon-512.png       manifest
 *   icon-maskable-512.png  Android, met de tekening binnen de veilige cirkel
 *
 *   node scripts/maakIconen.mjs
 *
 * De PNG's tekent Chromium via Playwright (staat in de Claude-omgeving; geen
 * pakket van dit project). Kleuren: de tokens van src/index.css.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** De kleuren van het eerste :root-blok in src/index.css (donker, de standaard): één bron voor app en icoon. */
export function tokensUit(css) {
  const blok = css.match(/:root\s*\{([^}]*)\}/)?.[1] ?? '';
  return Object.fromEntries([...blok.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, naam, waarde]) => [naam, waarde.trim()]));
}

const TOKENS = tokensUit(fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8'));
const KLEUR = {
  achtergrond: TOKENS.grond,
  vlak: TOKENS.vlak,
  vlakHoog: TOKENS['vlak-hoog'],
  huis: TOKENS.huis,
  zon: TOKENS.zon,
  batterij: TOKENS.batterij,
};
for (const [naam, waarde] of Object.entries(KLEUR)) {
  if (!waarde) throw new Error(`maakIconen: kleur ${naam} niet gevonden in src/index.css (:root).`);
}

/** De tekening op 512 bij 512. `schaal` < 1 houdt hem binnen de veilige cirkel; `hoek` rondt de achtergrond af. */
export function icoonSvg({ schaal = 1, hoek = 0 } = {}) {
  const midden = `translate(256 256) scale(${schaal}) translate(-256 -256)`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="lucht" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${KLEUR.vlakHoog}"/>
      <stop offset="1" stop-color="${KLEUR.achtergrond}"/>
    </linearGradient>
    <linearGradient id="bliksem" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffd772"/>
      <stop offset="1" stop-color="${KLEUR.zon}"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="${hoek}" fill="url(#lucht)"/>
  <g transform="${midden} translate(-18 -8)">
    <path d="M118 262 L256 146 L394 262" fill="none" stroke="${KLEUR.huis}" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M150 238 V392 H362 V238" fill="none" stroke="${KLEUR.huis}" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M300 92 L190 292 H258 L220 448 L332 240 H264 Z" fill="url(#bliksem)" stroke="${KLEUR.achtergrond}" stroke-width="14" stroke-linejoin="round" paint-order="stroke"/>
    <rect x="296" y="322" width="150" height="88" rx="18" fill="${KLEUR.achtergrond}" stroke="${KLEUR.achtergrond}" stroke-width="30"/>
    <rect x="296" y="322" width="150" height="88" rx="18" fill="${KLEUR.vlak}" stroke="${KLEUR.batterij}" stroke-width="14"/>
    <rect x="446" y="348" width="16" height="36" rx="6" fill="${KLEUR.batterij}"/>
    <rect x="312" y="340" width="34" height="52" rx="6" fill="${KLEUR.batterij}"/>
    <rect x="355" y="340" width="34" height="52" rx="6" fill="${KLEUR.batterij}"/>
    <rect x="398" y="340" width="34" height="52" rx="6" fill="${KLEUR.batterij}" opacity="0.4"/>
  </g>
</svg>
`;
}

async function teken(page, svg, maat, pad) {
  await page.setViewportSize({ width: maat, height: maat });
  await page.setContent(`<body style="margin:0">${svg.replace('<svg ', `<svg width="${maat}" height="${maat}" `)}</body>`);
  await page.screenshot({ path: fileURLToPath(pad), clip: { x: 0, y: 0, width: maat, height: maat } });
}

async function maak() {
  let chromium;
  try {
    ({ chromium } = createRequire(import.meta.url)('playwright'));
  } catch {
    console.error('Playwright ontbreekt; dit script draait in de Claude-omgeving, waar het al staat.');
    process.exit(1);
  }
  const map = new URL('../public/', import.meta.url);
  fs.mkdirSync(map, { recursive: true });
  fs.writeFileSync(new URL('favicon.svg', map), icoonSvg({ hoek: 112 }));

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await teken(page, icoonSvg(), 180, new URL('apple-touch-icon.png', map));
    await teken(page, icoonSvg(), 192, new URL('icon-192.png', map));
    await teken(page, icoonSvg(), 512, new URL('icon-512.png', map));
    await teken(page, icoonSvg({ schaal: 0.8 }), 512, new URL('icon-maskable-512.png', map));
  } finally {
    await browser.close();
  }
  console.log('Klaar: public/favicon.svg, apple-touch-icon.png, icon-192.png, icon-512.png, icon-maskable-512.png');
}

// Zo werkt het ook in een map met een spatie en op Windows (zoals vingerafdruk.mjs).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await maak();
