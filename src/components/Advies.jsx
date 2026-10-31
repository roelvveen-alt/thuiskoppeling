import { Check, ChevronDown, Clock, Cloud, CloudSun, Hand, Lightbulb, Minus, Sun, ThumbsUp } from 'lucide-react';
import { createElement, useMemo } from 'react';
import { klok, maakAdvies } from '@/lib/advies';
import { prijsPerKwh, vermogen } from '@/lib/opmaak';

const UUR_MS = 3_600_000;

/** Per soort regel: het icoon en de kleur van het rondje (de kleur zit nooit op de tekst; het woord zegt het ook). */
const REGEL = {
  goed: { icoon: ThumbsUp, kleur: 'var(--goed)' },
  liever: { icoon: Hand, kleur: 'var(--let-op)' },
  gewoon: { icoon: Clock, kleur: 'var(--tekst-zacht)' },
};
const WEER = { zon: { icoon: Sun, kleur: 'var(--zon)' }, zonWolk: { icoon: CloudSun, kleur: 'var(--zon)' }, wolk: { icoon: Cloud, kleur: 'var(--tekst-zacht)' } };

/** Per uur in de tijdlijn: goed (groen, vinkje), gewoon (grijs), liever niet (oranje, streepje). */
export const VAKJE = {
  gunstig: { naam: 'goed', icoon: Check, vul: 'var(--goed)' },
  gewoon: { naam: 'gewoon', icoon: null, vul: 'color-mix(in srgb, var(--tekst-zacht) 26%, transparent)' },
  duur: { naam: 'liever niet', icoon: Minus, vul: 'var(--let-op)' },
};

/**
 * Advies onderaan het tabblad Huis, zo eenvoudig mogelijk ("denk aan een
 * oud dametje dat simpel hulp nodig heeft"): hooguit drie grote regels (goed
 * moment, liever niet, het weer) en een tijdlijn van de komende 24 uur met
 * per uur een gekleurd vakje met een teken erin. Niets over de batterij: die
 * gaat vanzelf. De tabel en de uitleg staan achter "Meer details". De keuze
 * eigen gebruik of handelen staat bij Instellingen › Namen (de berekening
 * blijft; standaard eigen gebruik). Alleen raad: de app bedient niets.
 *
 * @param {{ stand: object|null, dagen: Array, nu: number, rol?: 'eigen'|'handelen', verwachting?: object|null }} props
 *   dagen: uit useAdviesDagen (src/lib/adviesBron.js); verwachting: useVerwachting (src/lib/verwachting.js),
 *   dezelfde zon als het tabblad Voorspelling
 */
export default function Advies({ stand, dagen, nu, rol = 'eigen', verwachting = null }) {
  // Opnieuw rekenen hooguit eens per minuut (de stand komt elke 5 s), bij een andere keuze of andere dagen, prijzen of verwachting.
  const minuut = Math.floor(nu / 60_000);
  const metStand = Boolean(stand);
  const prijzen = stand?.voorspelling;
  const morgen = verwachting?.morgen ?? null;
  const weer = verwachting ? verwachting.weer : stand?.weer;
  const advies = useMemo(
    () => (stand ? maakAdvies({ stand: { ...stand, weer: weer ?? null }, dagen, nu, rol, verwachting: morgen }) : null),
    [minuut, rol, dagen, prijzen, weer, morgen, metStand], // eslint-disable-line react-hooks/exhaustive-deps
  );
  if (!advies) return null;

  return (
    <section className="grid min-w-0 gap-4 rounded-2xl border border-lijn bg-vlak p-3.5" aria-labelledby="advies-kop">
      <div className="flex items-center gap-2.5">
        <span
          className="grid size-9 flex-none place-items-center rounded-full"
          style={{ color: 'var(--zon)', background: 'color-mix(in srgb, var(--zon) 14%, transparent)' }}
          aria-hidden="true"
        >
          <Lightbulb size={18} strokeWidth={2.2} />
        </span>
        <h2 id="advies-kop" className="m-0 text-[13px] font-semibold tracking-wide text-tekst-zacht uppercase">
          Advies
        </h2>
        {advies.leertNog && <span className="ml-auto text-[13px] text-tekst-zacht">ik leer nog</span>}
      </div>

      <ul className="m-0 grid list-none gap-3 p-0">
        {advies.regels.map((r) => {
          const stijl = r.soort === 'weer' ? (WEER[r.icoon] ?? WEER.zonWolk) : REGEL[r.soort];
          return (
            <li key={r.soort} className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3">
              <span
                className="grid size-11 place-items-center rounded-full"
                style={{ color: stijl.kleur, background: `color-mix(in srgb, ${stijl.kleur} 16%, transparent)` }}
                aria-hidden="true"
              >
                {createElement(stijl.icoon, { size: 24, strokeWidth: 2.2 })}
              </span>
              <span className="grid min-w-0 gap-0.5 pt-0.5">
                <span className="text-[17px] leading-tight font-semibold">{r.kop}</span>
                <span className="text-[17px] leading-snug">{r.tekst}</span>
              </span>
            </li>
          );
        })}
      </ul>

      <Tijdlijn uren={advies.uren} nu={nu} />

      <details className="group text-[14px]">
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-tekst-zacht hover:text-tekst [&::-webkit-details-marker]:hidden">
          <ChevronDown size={18} className="flex-none transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
          Meer details
        </summary>
        <div className="grid gap-3 pt-1">
          <div className="max-h-72 overflow-auto">
            <table className="grafiek-tabel">
              <thead>
                <tr>
                  <th scope="col">Uur</th>
                  <th scope="col">Advies</th>
                  <th scope="col">Zon</th>
                  {advies.eenheid === 'euro' && <th scope="col">Prijs</th>}
                </tr>
              </thead>
              <tbody>
                {advies.uren.map((u, k) => [
                  u.morgen && !advies.uren[k - 1]?.morgen && (
                    <tr key={`dag-${u.begin}`}>
                      <th scope="colgroup" colSpan={advies.eenheid === 'euro' ? 4 : 3}>
                        Morgen
                      </th>
                    </tr>
                  ),
                  <tr key={u.begin}>
                    <td className="whitespace-nowrap">{klok(u.begin)}</td>
                    <td>{VAKJE[u.soort].naam}</td>
                    <td className="cijfer whitespace-nowrap">{u.zonW >= 20 ? vermogen(u.zonW) : '–'}</td>
                    {advies.eenheid === 'euro' && <td className="cijfer whitespace-nowrap">{u.prijs ? prijsPerKwh(u.prijs.afname) : '–'}</td>}
                  </tr>,
                ])}
              </tbody>
            </table>
          </div>
          <div className="grid gap-1 text-[13px] leading-relaxed text-tekst-zacht">
            {advies.toelichting.map((t) => (
              <p key={t} className="m-0">
                {t}
              </p>
            ))}
            <p className="m-0">Alleen raad: de app zet niets aan of uit.</p>
          </div>
        </div>
      </details>
    </section>
  );
}

/**
 * De komende 24 uur als vakjes, per dag in twee rijen van twaalf uur (0–11 en
 * 12–23), zodat elk uur op dezelfde plek staat: groen met een vinkje is goed,
 * grijs is gewoon, oranje met een streepje is liever niet. Het uur van nu
 * heeft een rand en heet "nu". Uren van zo'n rij die al voorbij zijn (of na de
 * 24 uur komen) staan er leeg en gestippeld bij, zodat de rij als een klok
 * leest. Onder de vakjes de uren; de legenda zegt het ook in woorden (kleur
 * is nooit de enige betekenis).
 */
export function Tijdlijn({ uren, nu }) {
  const vandaag = uren[0] ? datumTekst(uren[0].begin) : '';
  const rijen = [];
  for (const [k, u] of uren.entries()) {
    const dag = datumTekst(u.begin) === vandaag ? 'Vandaag' : 'Morgen';
    const helft = u.uur < 12 ? 0 : 1;
    let rij = rijen.find((r) => r.dag === dag && r.helft === helft);
    if (!rij) {
      rij = { dag, helft, vakjes: [] };
      rijen.push(rij);
    }
    // Het dubbele uur als de klok terug gaat: één vakje op die plek.
    if (!rij.vakjes.some((v) => v.uur === u.uur)) rij.vakjes.push({ ...u, nu: k === 0 && nu >= u.begin && nu < u.begin + UUR_MS });
  }
  return (
    <div className="grid min-w-0 gap-2">
      <h3 className="m-0 text-[15px] font-semibold">De komende 24 uur</h3>
      {rijen.map((rij, i) => (
        <div key={`${rij.dag}-${rij.helft}`} className="grid min-w-0 gap-1">
          {(i === 0 || rijen[i - 1].dag !== rij.dag) && <span className="text-[14px] text-tekst-zacht">{rij.dag}</span>}
          <ol className="m-0 grid list-none grid-cols-12 gap-[2px] p-0" aria-label={`${rij.dag}, ${rij.helft === 0 ? 'nacht en ochtend' : 'middag en avond'}`}>
            {Array.from({ length: 12 }, (_, kolom) => rij.helft * 12 + kolom)
              .filter((uur) => !rij.vakjes.some((v) => v.uur === uur))
              .map((uur) => (
                <li key={`leeg-${uur}`} className="grid min-w-0 justify-items-center gap-0.5 opacity-60" style={{ gridColumnStart: (uur % 12) + 1, gridRowStart: 1 }} aria-hidden="true">
                  <span className="h-9 w-full rounded-[4px] border border-dashed border-lijn" />
                  <span className="text-[12.5px] leading-tight text-tekst-zacht tabular-nums">{uur}</span>
                </li>
              ))}
            {rij.vakjes.map((v) => {
              const s = VAKJE[v.soort];
              const naam = `${v.nu ? 'nu, ' : ''}${v.uur} tot ${(v.uur + 1) % 24 || 24} uur: ${s.naam}`;
              return (
                <li key={v.begin} className="grid min-w-0 justify-items-center gap-0.5" style={{ gridColumnStart: (v.uur % 12) + 1, gridRowStart: 1 }} title={naam} aria-label={naam}>
                  <span
                    className="grid h-9 w-full place-items-center rounded-[4px]"
                    style={{ background: s.vul, color: 'var(--grond)', boxShadow: v.nu ? '0 0 0 2px var(--vlak), 0 0 0 4px var(--tekst)' : undefined }}
                    aria-hidden="true"
                  >
                    {s.icoon && createElement(s.icoon, { size: 16, strokeWidth: 3 })}
                  </span>
                  <span className={`text-[12.5px] leading-tight tabular-nums ${v.nu ? 'font-semibold' : 'text-tekst-zacht'}`} aria-hidden="true">
                    {v.nu ? 'nu' : v.uur}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
      <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[14px]" aria-label="Wat de kleuren zeggen">
        {['gunstig', 'gewoon', 'duur'].map((soort) => {
          const s = VAKJE[soort];
          return (
            <li key={soort} className="flex items-center gap-1.5">
              <span className="grid size-5 place-items-center rounded-[4px]" style={{ background: s.vul, color: 'var(--grond)' }} aria-hidden="true">
                {s.icoon && createElement(s.icoon, { size: 13, strokeWidth: 3 })}
              </span>
              {s.naam}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const datumNotatie = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' });
const datumTekst = (ms) => datumNotatie.format(new Date(ms));
