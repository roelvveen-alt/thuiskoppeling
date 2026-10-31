/**
 * De lettertypes uit public/fonts in de CSS zetten als data-URI, voor het
 * losse voorbeeld (scripts/maakVoorbeeld.mjs): daar is geen /fonts naast de
 * pagina. Alleen url(...) die naar een .woff2 in fonts/ wijst, verder niets.
 */
import fs from 'node:fs';
import path from 'node:path';

export function lettertypesErin(css, fontsMap) {
  const ontbreekt = [];
  const uit = css.replace(/url\(\s*(["']?)(?:\.{0,2}\/)*fonts\/([\w.-]+\.woff2)\1\s*\)/g, (geheel, _q, naam) => {
    const bestand = path.join(fontsMap, naam);
    if (!fs.existsSync(bestand)) {
      ontbreekt.push(naam);
      return geheel;
    }
    return `url("data:font/woff2;base64,${fs.readFileSync(bestand).toString('base64')}")`;
  });
  return { css: uit, ontbreekt };
}
