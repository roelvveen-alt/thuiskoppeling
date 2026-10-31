import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * De versie van het programmaatje, op één plek (brug/package.json zegt
 * hetzelfde; brug/versie.test.js houdt ze gelijk). Ophogen bij elke wijziging
 * in brug/.
 */
export const VERSIE = '1.6.1';

/**
 * De versie met de commit erbij ('0.6.0+680c351'), zodat de app ziet welke
 * code er echt draait, ook als het nummer eens niet is opgehoogd. Zonder git
 * (of als git niet antwoordt) alleen het nummer.
 */
export function versieMetCommit({ map = fileURLToPath(new URL('.', import.meta.url)), voer = execFileSync } = {}) {
  try {
    const commit = String(voer('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: map, timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] })).trim();
    return /^[0-9a-f]{7,12}$/.test(commit) ? `${VERSIE}+${commit}` : VERSIE;
  } catch {
    return VERSIE;
  }
}
