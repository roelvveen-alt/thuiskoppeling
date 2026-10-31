import Uitklap from './Uitklap';

/**
 * Hoe het programmaatje thuis bijgewerkt wordt: op één plek in de app
 * (Apparaten › Het programmaatje thuis), per toestel. Elders staat alleen
 * "zie Apparaten" (ZieApparaten), zodat er nooit een oude opdracht blijft staan.
 */

/** De veilige manier op de telefoon (Termux), sinds 0.5.2: kijkt alles na en gaat bij een fout vanzelf terug. */
export const BIJWERKEN_TELEFOON = 'sh ~/thuis-energie/brug/bijwerken.sh';
/** Van vóór 0.5.2 staat bijwerken.sh nog niet op de telefoon: dan één keer zo. */
export const BIJWERKEN_OUD = 'cd ~/thuis-energie && git pull && node brug/brug.mjs herstart';
/** Op een Chromebook (Linux, systemd), zoals docs/chromebook.md. */
export const BIJWERKEN_CHROMEBOOK = 'cd ~/thuis-energie && git pull --ff-only && cd brug && npm ci --omit=dev && sudo systemctl restart thuis-energie-brug';

function Opdracht({ children }) {
  return <span className="code block text-[13px] [overflow-wrap:anywhere]">{children}</span>;
}

/**
 * De opdrachten zelf, in een uitklapper. `open`: meteen open (een oude versie
 * die eerst bijgewerkt moet worden).
 */
export function HoeBijwerken({ open = false }) {
  return (
    <Uitklap titel="Zo werk je het programmaatje bij" open={open}>
      <div className="grid gap-2 pt-1 text-[14px] leading-relaxed">
        <p className="m-0">
          Op de telefoon, in Termux:
          <Opdracht>{BIJWERKEN_TELEFOON}</Opdracht>
        </p>
        <p className="m-0 text-[13px] text-tekst-zacht">
          Hij kijkt alles na en gaat vanzelf terug als het misgaat. Staat dat bestand er nog niet (van vóór 0.5.2), dan één keer:{' '}
          <span className="code text-[13px] [overflow-wrap:anywhere]">{BIJWERKEN_OUD}</span>
        </p>
        <p className="m-0">
          Op een Chromebook:
          <Opdracht>{BIJWERKEN_CHROMEBOOK}</Opdracht>
        </p>
      </div>
    </Uitklap>
  );
}

/**
 * Eén zin voor elders in de app: wie bijwerkt, leest op Apparaten hoe.
 * Een kijker kan zelf niets bijwerken en hoort dat de eigenaar het weet.
 */
export function zieApparaten(eigenaar) {
  return eigenaar ? 'Hoe je het bijwerkt, staat op Apparaten.' : 'De eigenaar weet hoe je het bijwerkt.';
}
