import { ChartColumnBig, CloudSun, Gauge, House, Router } from 'lucide-react';
import { createElement } from 'react';

/** Elk tabblad één naam, die ook op 320 px past (weergave-16: niet "Voorspelling" op het ene en "Morgen" op het andere scherm). */
export const TABS = [
  { sleutel: 'huis', naam: 'Huis', icoon: House },
  { sleutel: 'voorspelling', naam: 'Weer', icoon: CloudSun },
  { sleutel: 'nu', naam: 'Nu', icoon: Gauge },
  { sleutel: 'overzicht', naam: 'Overzicht', icoon: ChartColumnBig },
  { sleutel: 'apparaten', naam: 'Apparaten', icoon: Router },
];

/**
 * Wat een toestel nog onthield van voor het tabblad Overzicht: Vandaag en
 * Prijzen zitten daar nu in. Een onbekend tabblad wordt Huis.
 */
export function tabUit(bewaard) {
  const naam = bewaard === 'vandaag' || bewaard === 'prijzen' ? 'overzicht' : bewaard;
  return TABS.some((t) => t.sleutel === naam) ? naam : 'huis';
}

/**
 * Onderaan: vijf tabbladen, met de duim te bereiken; het tandwiel bovenin blijft de instellingen.
 * `vragen`: zoveel vragen van het programmaatje staan open (brug 1.4.0): een stipje bij Apparaten.
 */
export default function Tabbalk({ gekozen, onKies, vragen = 0 }) {
  const toets = (e) => {
    const nu = TABS.findIndex((t) => t.sleutel === gekozen);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const volgende = TABS[(nu + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
      onKies(volgende.sleutel);
      document.getElementById(`tab-${volgende.sleutel}`)?.focus();
    }
  };
  return (
    <nav className="tabbalk" aria-label="Tabbladen">
      <div role="tablist" aria-label="Tabbladen" className="contents" onKeyDown={toets}>
        {TABS.map((t) => (
          <button
            key={t.sleutel}
            id={`tab-${t.sleutel}`}
            type="button"
            role="tab"
            className="tab"
            aria-selected={gekozen === t.sleutel}
            aria-controls={gekozen ? 'tabblad' : undefined}
            tabIndex={gekozen === t.sleutel || (!gekozen && t.sleutel === TABS[0].sleutel) ? 0 : -1}
            onClick={() => onKies(t.sleutel)}
          >
            <span className="relative inline-grid">
              {createElement(t.icoon, { size: 21, strokeWidth: 2.1, 'aria-hidden': 'true' })}
              {t.sleutel === 'apparaten' && vragen > 0 && <span className="tab-stip" aria-hidden="true" />}
            </span>
            <span className="max-w-full truncate">{t.naam}</span>
            {t.sleutel === 'apparaten' && vragen > 0 && <span className="sr-only">, {vragen === 1 ? 'een vraag' : `${vragen} vragen`} voor jou</span>}
          </button>
        ))}
      </div>
    </nav>
  );
}
