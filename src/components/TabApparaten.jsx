import { CircleAlert, CircleCheck, Cpu, Gauge, Moon, Plug, SolarPanel, Sun, UtilityPole } from 'lucide-react';
import { geleden, richting, sindsWanneer, tijd, vermogen, versieKort } from '@/lib/opmaak';
import BatterijGegevens from './BatterijGegevens';
import { HoeBijwerken, zieApparaten } from './Bijwerken';
import Herkennen from './Herkennen';
import Logboek from './Logboek';
import Lampen from './Lampen';
import Omvormer from './Omvormer';
import { SturenKaart } from './OmvormerSturen';
import Spanning from './Spanning';
import { Rondje } from './Tegel';
import { BatterijIcoon } from './iconen';

const ROL = {
  net: { tekst: 'de meterkast (P1)', icoon: UtilityPole, soort: 'net' },
  zon: { tekst: 'zonnepanelen', icoon: Sun, soort: 'zon' },
  'zon-en-batterij': { tekst: 'zon en batterij samen', icoon: Sun, soort: 'zon' },
  batterij: { tekst: 'de thuisbatterij', icoon: BatterijIcoon, soort: 'batterij' },
  vergelijk: { tekst: 'tweede P1-meter, om te vergelijken', icoon: Gauge, soort: 'net' },
  apparaat: { tekst: 'een apparaat', icoon: Plug, soort: 'apparaat' },
  omvormer: { tekst: 'de omvormer van de zonnepanelen', icoon: SolarPanel, soort: 'zon' },
};

const MANIER = {
  v1: 'lokale API (v1)',
  v2: 'lokale API met code (v2)',
  lokaal: 'rechtstreeks in je wifi',
  cloud: 'via de Zendure-cloud',
  // Lokaal ingesteld, maar hij antwoordt daar nu niet: het programmaatje leest hem via de cloud (brug 0.6.2).
  'cloud-reserve': 'via de cloud (reserve)',
};

/**
 * De naam op de kaart: de eigen naam uit Instellingen › Namen als die er is
 * (die belooft "overal in de app"), bij zonnepanelen de naam zoals op de foto,
 * anders die van het programmaatje. De meter in de meterkast en de batterij
 * heten op de foto 'net' en 'batterij'. `thuis`: de naam van het programmaatje,
 * als ondertitel als hij anders is.
 */
export function kaartNaam(a, punten = []) {
  const sleutel = a.rol === 'net' ? 'net' : a.rol === 'batterij' ? 'batterij' : a.sleutel;
  const punt = punten.find((p) => p.sleutel === sleutel);
  const eigen = typeof punt?.eigenNaam === 'string' ? punt.eigenNaam.trim() : '';
  const naam = eigen || (punt?.soort === 'zon' && punt.naam) || a.naam || a.soort || 'Apparaat';
  return { naam, thuis: a.naam && a.naam !== naam ? a.naam : null };
}

/** Groen met een vinkje of oranje met een uitroepteken, altijd met woorden erbij. Een omvormer die slaapt: een maantje. */
function Status({ ok, sinds, slaapt = false }) {
  if (ok && slaapt) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px]">
        <Moon size={16} className="text-tekst-zacht" aria-hidden="true" />
        slaapt (geen zon)
      </span>
    );
  }
  const kleur = ok ? 'var(--goed)' : 'var(--let-op)';
  const Icoon = ok ? CircleCheck : CircleAlert;
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px]">
      <Icoon size={16} style={{ color: kleur }} aria-hidden="true" />
      {ok ? 'antwoordt' : sinds ? `geen antwoord sinds ${tijd(sinds)}` : 'geen antwoord'}
    </span>
  );
}

/**
 * Tabblad Apparaten: het programmaatje thuis en alles wat eraan gekoppeld is,
 * met of het antwoordt. Geen codes, sleutels of serienummers: die stuurt het
 * programmaatje ook niet mee. Onderaan het logboek van storingen
 * (`logboek` uit useLogboek in src/lib/logboek.js; zonder geen kaart).
 * Daarboven "Wat gebruikt er nu stroom?" (Herkennen.jsx, brug 0.11.0); `onLabel`
 * bewaart wat de eigenaar aanwijst (zonder: alleen kijken).
 */
export default function TabApparaten({ stand, nu, eigenaar = true, logboek = null, onLabel = null, onWeek = null, punten = [], verwachtVol = null, sturen = null, zonFase = null }) {
  const brug = stand?.brug ?? null;
  const lijst = stand?.gekoppeld ?? null;
  const moment = stand?.moment ? Date.parse(stand.moment) : null;

  return (
    <div className="grid min-w-0 grid-cols-1 gap-2.5" id="tabblad" role="tabpanel" aria-labelledby="tab-apparaten">
      <h2 className="text-[22px] font-bold">Apparaten</h2>

      <section className="grid min-w-0 grid-cols-1 gap-2 rounded-2xl border border-lijn bg-vlak p-3.5" aria-label="Het programmaatje thuis">
        <span className="flex items-center gap-2.5">
          <Rondje soort="apparaat" icoon={Cpu} />
          <span className="text-[12.5px] font-semibold tracking-wide text-tekst-zacht uppercase">Het programmaatje thuis</span>
        </span>
        {brug?.meldingen?.length > 0 && (
          <ul className="m-0 grid list-none grid-cols-1 gap-1.5 p-0" aria-label="Wat het programmaatje meldt">
            {brug.meldingen.map((m) => (
              <li key={`${m.soort}-${m.tekst}`} className="flex min-w-0 items-start gap-2 text-[14px] leading-snug">
                <CircleAlert size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--let-op)' }} aria-hidden="true" />
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {m.tekst}
                  {m.sinds && <span className="text-tekst-zacht"> (sinds {sindsWanneer(m.sinds, nu)})</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
        {brug ? (
          <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[14px]">
            <dt className="text-tekst-zacht">Versie</dt>
            <dd className="cijfer m-0">{versieKort(brug.versie)}</dd>
            {brug.gestart && (
              <>
                <dt className="text-tekst-zacht">Draait sinds</dt>
                <dd className="m-0">{sindsWanneer(brug.gestart, nu)}</dd>
              </>
            )}
            {brug.elkeSeconden && (
              <>
                <dt className="text-tekst-zacht">Meet</dt>
                <dd className="m-0">elke {brug.elkeSeconden} seconden</dd>
              </>
            )}
            <dt className="text-tekst-zacht">Prijzen</dt>
            <dd className="m-0">{brug.prijzen ?? 'geen'}</dd>
            {moment && (
              <>
                <dt className="text-tekst-zacht">Laatste meting</dt>
                <dd className="m-0">{geleden(Math.max(0, nu - moment)) || tijd(moment)}</dd>
              </>
            )}
          </dl>
        ) : (
          <p className="m-0 text-[14px] leading-relaxed">
            {moment ? `Laatste meting ${geleden(Math.max(0, nu - moment))}. ` : ''}
            Werk het programmaatje bij: dan zie je hier welke versie draait, sinds wanneer, en per apparaat of het antwoordt.
            {eigenaar ? '' : ` ${zieApparaten(false)}`}
          </p>
        )}
        {eigenaar && <HoeBijwerken open={!brug} />}
      </section>

      <Herkennen herkend={stand?.herkend ?? null} brugVersie={brug?.versie ?? null} eigenaar={eigenaar} onLabel={onLabel} onWeek={onWeek} nu={nu} />

      <Lampen lampen={stand?.lampen} />

      {lijst && lijst.length > 0 && (
        <ul className="m-0 grid list-none grid-cols-1 items-start gap-2 p-0 sm:grid-cols-2">
          {lijst.map((a) => {
            const rol = ROL[a.rol] ?? ROL.apparaat;
            const p1 = a.rol === 'net' || a.rol === 'vergelijk';
            const { naam, thuis } = kaartNaam(a, punten);
            return (
              <li key={a.sleutel} className="grid min-w-0 grid-cols-1 content-start gap-2 rounded-2xl border border-lijn bg-vlak p-3.5">
                <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3">
                  <Rondje soort={rol.soort} icoon={rol.icoon} procent={a.rol === 'batterij' ? (stand?.batterij_procent ?? undefined) : undefined} />
                  <div className="grid min-w-0 gap-0.5">
                    <span className="text-[15.5px] font-semibold [overflow-wrap:anywhere]">{naam}</span>
                    <span className="text-[13px] text-tekst-zacht [overflow-wrap:anywhere]">
                      {[thuis && `heet thuis: ${thuis}`, a.soort, a.merk].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                  <span className="text-right">
                    <span className="cijfer block text-[16px] font-bold">{a.w === null ? '–' : vermogen(a.w)}</span>
                    {p1 && a.w !== null && <span className="block text-[12px] text-tekst-zacht">{richting(a.w)}</span>}
                  </span>
                </div>
                <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-0.5 text-[13.5px]">
                  <dt className="text-tekst-zacht">Is</dt>
                  <dd className="m-0">{rol.tekst}</dd>
                  <dt className="text-tekst-zacht">Koppeling</dt>
                  <dd className="m-0">{MANIER[a.manier] ?? a.manier}</dd>
                  {a.adres && (
                    <>
                      <dt className="text-tekst-zacht">Adres</dt>
                      <dd className="code m-0 break-all">{a.adres}</dd>
                    </>
                  )}
                </dl>
                <Status ok={a.ok} sinds={a.sinds} slaapt={a.rol === 'omvormer' && stand?.omvormer?.stand === 'slaapt'} />
                {a.rol === 'omvormer' && (
                  <div className="border-t border-lijn pt-2 empty:hidden">
                    <Omvormer omvormer={stand?.omvormer ?? null} compact />
                  </div>
                )}
                {a.rol === 'omvormer' && eigenaar && stand?.omvormer?.sturen && (
                  <div className="border-t border-lijn pt-2 empty:hidden">
                    <SturenKaart sturen={stand.omvormer.sturen} instelling={sturen?.instelling ?? null} nu={nu} onNuAan={sturen?.onNuAan ?? null} omvormerW={stand.omvormer.w ?? null} netW={stand.net_w ?? null} />
                  </div>
                )}
                {a.rol === 'batterij' && (
                  <div className="border-t border-lijn pt-2 empty:hidden">
                    <BatterijGegevens info={stand?.batterij_info ?? null} brugVersie={brug?.versie ?? null} compact opdracht={eigenaar} batterijW={stand?.batterij_w ?? null} procent={stand?.batterij_procent ?? null} verwacht={verwachtVol} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Spanning spanning={stand?.spanning ?? null} zonFase={zonFase} eigenaar={eigenaar} />

      {logboek && <Logboek gebeurtenissen={logboek.gebeurtenissen} status={logboek.status} nu={nu} />}
    </div>
  );
}
