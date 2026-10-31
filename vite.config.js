import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';

// Twee bouwsoorten:
//   vite build                  de echte app voor Base44 (praat met Base44)
//   vite build --mode voorbeeld alleen nepcijfers, met relatieve paden, zodat
//                               het los te bekijken is (scripts/maakVoorbeeld.mjs)
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig(({ mode }) => ({
  // De versie van de app (package.json), te zien in Instellingen › Account.
  define: { 'import.meta.env.VITE_APP_VERSIE': JSON.stringify(version) },
  base: mode === 'voorbeeld' ? './' : '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  build: {
    outDir: mode === 'voorbeeld' ? 'dist-voorbeeld' : 'dist',
    // De echte app laadt Instellingen, de bladen en sommige tabbladen pas als
    // ze nodig zijn (src/lib/lui.jsx). Het voorbeeld wordt één los
    // HTML-bestand (scripts/maakVoorbeeld.mjs): daar alles in één bestand.
    ...(mode === 'voorbeeld' ? { rolldownOptions: { output: { codeSplitting: false } } } : {}),
  },
  test: {
    include: ['src/**/*.test.{js,jsx}', 'brug/**/*.test.js', 'base44/**/*.test.js'],
    environment: 'node',
  },
}));
