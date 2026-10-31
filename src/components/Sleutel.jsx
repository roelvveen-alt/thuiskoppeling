import { Check, Copy } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { APP_ID } from '@/api/base44Client';

/** Het adres waar het programmaatje thuis naartoe stuurt (app.adres in brug/instellingen.json). */
export const functieAdres = () => `https://base44.app/api/apps/${APP_ID ?? 'JOUW-APP-ID'}/functions/ontvangMeting`;

function KopieerKnop({ tekst, label }) {
  const [gekopieerd, setGekopieerd] = useState(false);
  const [mislukt, setMislukt] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const kopieer = async () => {
    try {
      await navigator.clipboard.writeText(tekst);
      setMislukt(false);
      setGekopieerd(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setGekopieerd(false), 2500);
    } catch {
      // Geen toestemming voor het klembord: dan selecteer je het zelf.
      setMislukt(true);
    }
  };

  return (
    <>
      <button type="button" className="knop" onClick={kopieer}>
        {gekopieerd ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
        {gekopieerd ? 'Gekopieerd' : label}
      </button>
      {mislukt && (
        <span className="basis-full text-[13px] text-tekst-zacht" role="status">
          Kopiëren mag hier niet; houd de tekst ingedrukt (of selecteer hem) en kopieer hem zelf.
        </span>
      )}
    </>
  );
}

/** De instelhulp van het programmaatje (vraagt de sleutel), en daarna opnieuw starten. */
const INSTELLEN = 'cd ~/thuis-energie && node brug/brug.mjs instellen && node brug/brug.mjs herstart';

/**
 * De sleutel voor het programmaatje thuis, één keer. Base44 bewaart alleen
 * een hash; wie hem kwijt is, maakt in Instellingen › Delen een nieuwe.
 */
export default function Sleutel({ sleutel, vervangen = false, onKlaar }) {
  const titel = useId();
  // Dit scherm komt in de plaats van wat er stond: begin bovenaan, bij de uitleg.
  useEffect(() => {
    window.scrollTo?.(0, 0);
  }, []);
  const stukje = `"app": {\n  "adres": "${functieAdres()}",\n  "sleutel": "${sleutel}"\n}`;

  return (
    <section className="grid gap-4 rounded-2xl border border-lijn bg-vlak p-4" aria-labelledby={titel}>
      <h2 id={titel} className="text-[21px] font-bold">
        {vervangen ? 'Je nieuwe sleutel' : 'De sleutel voor thuis'}
      </h2>
      <p className="m-0 text-[15px]">
        Hiermee stuurt het programmaatje thuis de cijfers naar dit huis. Op de telefoon thuis: start de
        instelhulp, plak de sleutel als hij erom vraagt, en start het programmaatje daarna opnieuw.
      </p>
      <p className="m-0 text-[15px] font-semibold">Je ziet hem maar één keer: de app bewaart hem niet.</p>
      <code
        className="code block rounded-xl border border-lijn bg-grond p-3 text-[15px] leading-snug break-all select-all"
        aria-label="Sleutel"
      >
        {sleutel}
      </code>
      <div className="flex flex-wrap items-center gap-2">
        <KopieerKnop tekst={sleutel} label="Sleutel kopiëren" />
      </div>
      <div className="grid gap-2">
        <h3 className="text-[15px] font-semibold">De instelhulp, in Termux</h3>
        <pre className="code m-0 rounded-xl border border-lijn bg-grond p-3 text-[13px] leading-snug break-all whitespace-pre-wrap select-all">
          {INSTELLEN}
        </pre>
        <div className="flex flex-wrap items-center gap-2">
          <KopieerKnop tekst={INSTELLEN} label="Opdracht kopiëren" />
        </div>
      </div>
      <div className="grid gap-2">
        <h3 className="text-[15px] font-semibold">Liever met de hand: zo komt het in instellingen.json</h3>
        <pre className="code m-0 rounded-xl border border-lijn bg-grond p-3 text-[13px] leading-snug break-all whitespace-pre-wrap select-all">
          {stukje}
        </pre>
        <div className="flex flex-wrap items-center gap-2">
          <KopieerKnop tekst={stukje} label="Adres en sleutel kopiëren" />
        </div>
      </div>
      {vervangen && (
        <p className="m-0 text-[14.5px]">
          De oude sleutel werkt vanaf nu niet meer. Zet de nieuwe erin en start het programmaatje opnieuw.
        </p>
      )}
      <p className="m-0 text-[13.5px] text-tekst-zacht">Kwijt? In Instellingen › Delen maak je een nieuwe.</p>
      <button type="button" className="knop knop-hoofd justify-self-start" onClick={onKlaar}>
        <Check size={18} aria-hidden="true" /> Ik heb hem bewaard
      </button>
    </section>
  );
}
