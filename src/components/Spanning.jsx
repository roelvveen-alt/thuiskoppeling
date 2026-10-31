import { Activity, Copy } from 'lucide-react';
import { useId, useState } from 'react';
import { bronTekst, dichtbijZin, GRENS_V, hoogsteDelen, lijstRegel, sleutelNaam, verschilZin, voltTekst } from '@/lib/spanning';
import { Rondje } from './Tegel';
import Uitklap from './Uitklap';

/** Per bron welke sleutels hij meet: "L1, L2 en L3 gemeten door de spa-meter". */
function herkomstZinnen(spanning, zonFase) {
  const groepen = new Map();
  for (const h of spanning.herkomst) {
    const tekst = bronTekst(h);
    groepen.set(tekst, [...(groepen.get(tekst) ?? []), sleutelNaam(h.sleutel, zonFase)]);
  }
  const lijst = (namen) => (namen.length > 1 ? `${namen.slice(0, -1).join(', ')} en ${namen.at(-1)}` : namen[0]);
  return [...groepen].map(([tekst, namen]) => `${lijst(namen)} ${tekst}`);
}

/**
 * Apparaten › Netspanning (programmaatje 1.5.0, src/lib/spanning.js): de spanning per fase
 * nu en de hoogste van vandaag (vanaf 250 V in de let-op-kleur), waar hij vandaan komt, hoe
 * vaak het vandaag boven 250 V kwam en of de omvormer uitviel, het verschil tussen de
 * zonnemeter en de fase waar hij op zit, en de lijst voor de netbeheerder. Alleen kijken.
 *
 * @param {{ spanning: object|null, zonFase?: number|null, eigenaar?: boolean }} props  spanning: spanningUit (bron.js)
 */
export default function Spanning({ spanning, zonFase = null, eigenaar = false }) {
  const kopId = useId();
  const [gekopieerd, setGekopieerd] = useState(false);
  if (!spanning) return null;
  const geen = !spanning.herkomst.length && !spanning.hoogste.length;
  const delen = hoogsteDelen(spanning, zonFase);
  const verschil = verschilZin(spanning, zonFase);
  const metZonEnDriefase = spanning.herkomst.some((h) => h.sleutel === 'zon') && spanning.herkomst.some((h) => h.sleutel !== 'zon');
  const regels = spanning.lijst.map((x) => lijstRegel(x, zonFase));
  const kopieer = async () => {
    try {
      await navigator.clipboard.writeText(['Uitval van de omvormer bij een hoge netspanning', ...regels].join('\n'));
      setGekopieerd(true);
    } catch {
      setGekopieerd(false);
    }
  };
  return (
    <section className="grid min-w-0 grid-cols-1 gap-2 rounded-2xl border border-lijn bg-vlak p-3.5" aria-labelledby={kopId}>
      <span className="flex items-center gap-2.5">
        <Rondje soort="net" icoon={Activity} />
        <h3 id={kopId} className="text-[12.5px] font-semibold tracking-wide text-tekst-zacht uppercase">
          Netspanning
        </h3>
      </span>
      {geen ? (
        <p className="m-0 text-[14px]">Deze meterkast geeft geen spanning door.</p>
      ) : (
        <>
          {spanning.nu.length > 0 && (
            <p className="m-0 flex flex-wrap gap-x-3 gap-y-0.5 text-[15px]">
              {spanning.nu.map((x) => (
                <span key={x.sleutel} className="cijfer">
                  {sleutelNaam(x.sleutel, zonFase)} {voltTekst(x.v)}
                </span>
              ))}
            </p>
          )}
          {delen.length > 0 && (
            <p className="m-0 text-[14px] leading-snug">
              Hoogste vandaag:{' '}
              {delen.map((d, i) => (
                <span key={d.sleutel}>
                  {i > 0 && ' · '}
                  <span className={`cijfer whitespace-nowrap${d.letOp ? ' text-let-op' : ''}`}>{d.tekst}</span>
                </span>
              ))}
            </p>
          )}
          <p className="m-0 text-[14px] leading-snug">
            {dichtbijZin(spanning)}
            {spanning.uitvalMaand > 0 ? ` Deze maand ${spanning.uitvalMaand} keer uitgevallen bij een hoge spanning.` : ''}
          </p>
          {verschil && <p className="m-0 text-[13.5px] leading-snug">{verschil}</p>}
          {!verschil && metZonEnDriefase && eigenaar && !zonFase && (
            <p className="m-0 text-[13px] leading-snug text-tekst-zacht">Op welke fase zitten de zonnepanelen? Kies het bij Instellingen › Namen, dan staat hier het verschil tussen de twee meters.</p>
          )}
          <p className="m-0 text-[12.5px] leading-snug text-tekst-zacht">
            {herkomstZinnen(spanning, zonFase).join('; ')}. Een omvormer valt uit als het 10-minutengemiddelde boven {GRENS_V}&nbsp;V komt.
          </p>
        </>
      )}
      {regels.length > 0 && (
        <Uitklap titel={`Lijst voor de netbeheerder (${regels.length})`}>
          <ul className="m-0 mt-1 grid list-none gap-1 p-0 text-[13.5px]">
            {regels.map((r) => (
              <li key={r} className="[overflow-wrap:anywhere]">
                {r}
              </li>
            ))}
          </ul>
          <button type="button" className="knop mt-2" onClick={kopieer}>
            <Copy size={18} aria-hidden="true" /> {gekopieerd ? 'Gekopieerd' : 'Kopieer de lijst'}
          </button>
        </Uitklap>
      )}
    </section>
  );
}
