/**
 * Een rij keuzes (role="radiogroup" met knoppen role="radio") werkt met het
 * toetsenbord zoals een echte radiogroep: één Tab-stop (de gekozen keuze, of
 * de eerste als er niets gekozen is) en met de pijltjes, Home en End naar de
 * volgende, die dan ook meteen gekozen wordt.
 *
 * Gebruik: onKeyDown={keuzeToets} op de radiogroep, en op elke keuze
 * tabIndex={keuzeTab(gekozen, i, ietsGekozen)}.
 */
const STAP = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

export function keuzeToets(e) {
  if (e.target?.getAttribute?.('role') !== 'radio') return;
  const keuzes = [...e.currentTarget.querySelectorAll('[role="radio"]')].filter((k) => !k.disabled);
  const i = keuzes.indexOf(e.target);
  if (i < 0 || keuzes.length < 2) return;
  const n = keuzes.length;
  let naar;
  if (e.key in STAP) naar = (i + STAP[e.key] + n) % n;
  else if (e.key === 'Home') naar = 0;
  else if (e.key === 'End') naar = n - 1;
  else return;
  e.preventDefault();
  keuzes[naar].focus();
  keuzes[naar].click();
}

/** De Tab-stop: de gekozen keuze, of de eerste als er niets gekozen is. */
export function keuzeTab(gekozen, i, ietsGekozen = true) {
  return gekozen || (!ietsGekozen && i === 0) ? 0 : -1;
}
