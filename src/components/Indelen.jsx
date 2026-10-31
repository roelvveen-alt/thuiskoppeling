import { Image, ImagePlus, RotateCcw } from 'lucide-react';
import { useId } from 'react';
import { keuzeTab, keuzeToets } from '@/lib/keuzeToets';
import { TEKENINGEN } from '@/lib/opstelling';
import { PuntIcoon } from './iconen';

/**
 * Instellingen › Indelen (alleen de eigenaar): welke tekening (of eigen foto),
 * welke rondjes erop staan, en terug naar de beginplekken. Het slepen zelf
 * gebeurt op de foto (HuisBeeld).
 */
export default function Indelen({ punten, tekening, foto, onKiesTekening, onKiesFoto, onWisFoto, onWissel, onBeginplekken, voorbeeld }) {
  const fotoId = useId();
  const tekeningId = useId();

  return (
    <div className="grid gap-5">
      <p className="m-0 max-w-[60ch] text-[14.5px] text-tekst-zacht">
        Sleep de rondjes naar de goede plek op de foto. Op een computer kan het ook: klik een rondje aan en schuif met
        de pijltjestoetsen.
      </p>

      {!foto && (
        <div className="grid gap-2">
          <h3 className="text-[15px] font-semibold" id={tekeningId}>
            Welke tekening?
          </h3>
          <div role="radiogroup" aria-labelledby={tekeningId} className="flex flex-wrap gap-2" onKeyDown={keuzeToets}>
            {TEKENINGEN.map((t, i) => (
              <button
                key={t.sleutel}
                type="button"
                role="radio"
                aria-checked={tekening === t.sleutel ? 'true' : 'false'}
                tabIndex={keuzeTab(tekening === t.sleutel, i, TEKENINGEN.some((x) => x.sleutel === tekening))}
                className="keuze"
                onClick={() => onKiesTekening(t.sleutel)}
              >
                {t.naam}
              </button>
            ))}
          </div>
          <p className="m-0 text-[13px] text-tekst-zacht">Bij een andere tekening gaan de rondjes naar hun beginplek.</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <label htmlFor={fotoId} className="knop fotoknop">
          <ImagePlus size={18} aria-hidden="true" /> {foto ? 'Andere foto' : 'Eigen foto kiezen'}
        </label>
        <input
          id={fotoId}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(e) => {
            const bestand = e.target.files?.[0];
            e.target.value = '';
            if (bestand) onKiesFoto(bestand);
          }}
        />
        {foto && (
          <button type="button" className="knop" onClick={onWisFoto}>
            <Image size={18} aria-hidden="true" /> Tekening gebruiken
          </button>
        )}
        <button type="button" className="knop" onClick={onBeginplekken}>
          <RotateCcw size={18} aria-hidden="true" /> Beginplekken
        </button>
      </div>
      <p className="m-0 -mt-2 text-[13px] text-tekst-zacht">
        {voorbeeld
          ? 'In dit voorbeeld blijft je foto op dit toestel; er gaat niets naar internet.'
          : 'Je foto staat afgeschermd: alleen wie bij dit huis mag, ziet hem.'}{' '}
        Een staande foto past het best.
      </p>

      <div className="grid gap-2">
        <h3 className="text-[15px] font-semibold">Wat wil je op de foto zien?</h3>
        <ul className="m-0 grid list-none gap-1.5 p-0">
          {punten.map((punt) => {
            return (
              <li key={punt.sleutel}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={punt.zichtbaar ? 'true' : 'false'}
                  onClick={() => onWissel(punt.sleutel)}
                  className="flex min-h-[48px] w-full cursor-pointer items-center gap-3 rounded-xl border border-lijn bg-vlak px-3 text-left text-tekst hover:bg-vlak-hoog"
                >
                  <PuntIcoon punt={punt} size={18} className="flex-none text-tekst-zacht" />
                  <span className="min-w-0 flex-1 truncate text-[14.5px] font-semibold">{punt.naam}</span>
                  <span className="schakelaar" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
