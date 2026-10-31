import { Zap } from 'lucide-react';
import { FASE_KLEUR, ZEKERING_A, ampere, faseGrenzen, faseRichting, faseSchaal, faseVermogen, hoogLaagZin, saldoZin, volt, weekGemiddelden, zwaar, zwaarsteFase, zwareFaseZin } from '@/lib/fasen';
import { vermogen } from '@/lib/opmaak';
import { bronTekst, faseSpanning, LET_OP_V } from '@/lib/spanning';
import Grafiek from './Grafiek';
import Tegel from './Tegel';

const asAmpere = (a) => `${a.toLocaleString('nl-NL')}\u00a0A`;

/** Het rondje of streepje in de kleur van de fase; de naam staat er altijd naast. */
function Kleurtje({ fase }) {
  return <span className="inline-block size-2.5 flex-none rounded-full" style={{ background: FASE_KLEUR[fase] }} aria-hidden="true" />;
}

/**
 * Tabblad Nu: per fase de stroom (balk, in ampère) en het vermogen met de
 * richting in woorden, welke fase nu het zwaarst is, en lopen de fasen
 * verschillende kanten op, dat de meter ze bij elkaar optelt (per saldo:
 * `net`, het totaal van de meter). Bij één fase één balk, geen lege.
 *
 * Boven de grens van dit huis (`grenzen`, faseGrenzen: standaard 80% van de zekering, de
 * zekering 25 A) staan de ampères en een zin rustig in let-op: de eigenaar weet het
 * meestal en doet het bewust, dus geen alarm. Met `dag` (vandaag van het programmaatje)
 * ook de piek van vandaag per fase.
 */
export function FasenNu({ fasen, net = null, grenzen = faseGrenzen(), dag = null, spanning = null }) {
  if (!fasen?.length) return null;
  const schaal = faseSchaal(fasen, grenzen.zekering);
  const zwaarst = zwaarsteFase(fasen);
  const zwaarsteA = fasen.find((f) => f.fase === zwaarst)?.a;
  const saldo = saldoZin(fasen, net);
  const zwaarZin = zwareFaseZin(fasen, grenzen);
  const piekVan = (fase) => dag?.fasen?.find((d) => d.fase === fase)?.piekA ?? null;
  // De spanning per fase (1.5.0): van de P1, en anders van de spanningswacht (de omvormer of een driefase kWh-meter, in huis B de spa-meter).
  const spanningVan = (f) => (f.v != null ? { v: f.v, herkomst: { bron: 'p1' } } : faseSpanning(spanning, f.fase));
  const bronnen = [...new Set(fasen.map((f) => bronTekst(spanningVan(f)?.herkomst)).filter(Boolean))];
  return (
    <Tegel soort="net" icoon={Zap} kop={fasen.length > 1 ? 'Belasting per fase' : 'Belasting'}>
      <ul className="m-0 grid list-none gap-2.5 p-0">
        {fasen.map((f) => (
          <li key={f.fase} className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1">
            <span className="flex items-center gap-1.5 text-[14.5px] font-semibold">
              <Kleurtje fase={f.fase} />L{f.fase}
            </span>
            <span className="block h-2 overflow-hidden rounded-full bg-vlak-hoog" aria-hidden="true">
              <span
                className="block h-full rounded-full"
                style={{ width: `${f.a > 0 ? Math.max(2, Math.min(100, (100 * f.a) / schaal)) : 0}%`, background: FASE_KLEUR[f.fase] }}
              />
            </span>
            <span className={`cijfer text-[15px] font-semibold whitespace-nowrap${zwaar(f.a, grenzen) ? ' text-let-op' : ''}`}>{ampere(f.a)}</span>
            <span className="col-start-2 col-end-4 flex flex-wrap justify-between gap-x-3 text-[12.5px] text-tekst-zacht">
              {/* Zonder teken: de richting staat er in woorden achter ("312 W naar het net"). */}
              <span>{f.w != null && <><span className="cijfer">{vermogen(f.w)}</span> {faseRichting(f.w)}</>}</span>
              <span className="flex flex-wrap gap-x-3">
                {piekVan(f.fase) != null && (
                  <span className={zwaar(piekVan(f.fase), grenzen) ? 'text-let-op' : undefined}>
                    piek vandaag <span className="cijfer">{ampere(piekVan(f.fase))}</span>
                  </span>
                )}
                {spanningVan(f) && <span className={`cijfer${spanningVan(f).v >= LET_OP_V ? ' text-let-op' : ''}`}>{volt(spanningVan(f).v)}</span>}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {zwaarZin && <span className="text-[13.5px] leading-snug text-let-op">{zwaarZin}</span>}
      {saldo && <span className="text-[13.5px] leading-snug">{saldo}</span>}
      {bronnen.length > 0 && <span className="text-[12.5px] leading-snug text-tekst-zacht">Spanning {bronnen.join('; ')}.</span>}
      <span className="text-[13.5px] leading-snug text-tekst-zacht">
        {zwaarst ? `L${zwaarst} is nu het zwaarst belast (${ampere(zwaarsteA)}). ` : ''}
        {fasen.length === 1 ? `Eén fase: alles loopt over L${fasen[0].fase}. ` : ''}
        De balk loopt tot {Math.round(schaal)}&nbsp;A
        {schaal === grenzen.zekering ? (grenzen.zekering === ZEKERING_A ? ', de gewone hoofdzekering' : ', de zekering') : ''}.
      </span>
    </Tegel>
  );
}

/**
 * Tabblad Vandaag: de stroom per fase per kwartier (één lijn per fase, één
 * as), en per fase het gemiddelde en de piek, met welke fase het hoogst en
 * het laagst zit: vandaag, en over de dagen ervoor zodra die er zijn.
 */
export function FasenVandaag({ dag, slots, nu }) {
  const fasen = dag?.fasen;
  if (!fasen?.length) return null;
  const week = weekGemiddelden(dag.week);
  const weekVan = new Map(week.map((f) => [f.fase, f]));
  const dagen = Math.max(0, ...week.map((f) => f.dagen));
  const zinVandaag = hoogLaagZin(fasen);
  const zinWeek = hoogLaagZin(week);
  const meer = fasen.length > 1;
  return (
    <>
      <Grafiek
        titel={meer ? 'Belasting per fase' : `Belasting op L${fasen[0].fase}`}
        uitleg="De stroom per fase in ampère, gemiddeld per kwartier."
        reeksen={fasen.map((f) => ({
          naam: `L${f.fase}`,
          reeks: f.a,
          kleur: FASE_KLEUR[f.fase],
          bij: f.w ? (i) => faseVermogen(f.w[i]) : undefined,
        }))}
        van={dag.van}
        stapMs={dag.stapMs}
        slots={slots}
        vorm="lijn"
        nu={nu}
        waarde={ampere}
        asWaarde={asAmpere}
      />
      <Tegel soort="net" icoon={Zap} kop={meer ? 'Fasen vandaag' : 'Belasting vandaag'}>
        <table className="grafiek-tabel">
          <thead>
            <tr>
              <th scope="col">Fase</th>
              <th scope="col">Gemiddeld</th>
              <th scope="col">Piek</th>
              {dagen > 0 && <th scope="col">Week</th>}
            </tr>
          </thead>
          <tbody>
            {fasen.map((f) => (
              <tr key={f.fase}>
                <th scope="row" className="font-semibold">
                  <span className="flex items-center gap-1.5">
                    <Kleurtje fase={f.fase} />L{f.fase}
                  </span>
                </th>
                <td className="cijfer">{ampere(f.gemiddeldA)}</td>
                <td className="cijfer">{ampere(f.piekA)}</td>
                {dagen > 0 && <td className="cijfer">{ampere(weekVan.get(f.fase)?.gemiddeldA)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        <span className="grid gap-1 text-[13.5px] leading-snug text-tekst-zacht">
          {zinVandaag && <span>Vandaag: {zinVandaag}</span>}
          {dagen > 0 && zinWeek && (
            <span>
              {dagen === 1 ? 'De dag ervoor' : `De ${dagen} dagen ervoor`}: {zinWeek}
            </span>
          )}
          {dagen > 0 && <span>Week is het gemiddelde over {dagen === 1 ? '1 eerdere dag' : `${dagen} eerdere dagen`}. Piek is de hoogste stroom die het programmaatje zag.</span>}
          {dagen === 0 && <span>Piek is de hoogste stroom die het programmaatje zag. Vanaf morgen staat hier ook hoe de fasen de dagen ervoor gemiddeld belast waren.</span>}
          {!meer && <span>Eén fase: alles loopt over L{fasen[0].fase}.</span>}
        </span>
      </Tegel>
    </>
  );
}
