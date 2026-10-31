import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { tijd } from '@/lib/opmaak';

/**
 * Eén reeks door de tijd, per kwartier: de zon van vandaag, de batterij, de
 * prijs van vandaag en morgen. Eén as (nooit twee), dunne lijn met een
 * vleugje kleur eronder, een "nu"-streep, en bij aanraken of met de pijltjes
 * een streep met de waarde van dat kwartier. Wat in de tip staat, staat ook
 * in de tabel eronder (uitklappen): de tip helpt, hij is nooit de enige weg.
 *
 * Kleur: alleen de lijn en het vlak; tekst blijft in de tekstkleuren.
 *
 * Met `labels` gaat de as niet per kwartier maar per dag, week of maand
 * (Week, Maand, Kwartaal en Jaar op het tabblad Overzicht): onder elke plek
 * een kort label, in de tip en de tabel de lange naam. Met `vorm="staaf"`
 * staven: hooguit 24 px breed, 2 px lucht ertussen, afgerond aan het eind en
 * recht op de nul-lijn. Twee reeksen met een tegengesteld teken (afgenomen
 * boven, teruggeleverd onder) staan op dezelfde plek.
 */

/** Ruimte links voor de as; met langere labels ('12,5 kWh', '€ 0,40') meer (asRuimte). */
const LINKS = 46;
const RECHTS = 8;
const BOVEN = 10;
const ONDER = 22;

function useBreedte(ref) {
  const [breedte, setBreedte] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const meet = () => setBreedte(el.clientWidth);
    meet();
    const kijker = new ResizeObserver(meet);
    kijker.observe(el);
    return () => kijker.disconnect();
  }, [ref]);
  return breedte;
}

/** Ronde streepjes op de as: 0, 500, 1.000 of 0,10, 0,20. Altijd met 0 erin als de reeks er overheen gaat. */
export function mooieAs(laag, hoog, aantal = 4) {
  let min = Math.min(laag, 0);
  let max = Math.max(hoog, 0);
  if (!(max > min)) max = min + 1;
  const ruw = (max - min) / aantal;
  const macht = 10 ** Math.floor(Math.log10(ruw));
  const stap = [1, 2, 2.5, 5, 10].map((f) => f * macht).find((s) => s >= ruw - 1e-12);
  min = Math.floor(min / stap + 1e-9) * stap;
  max = Math.ceil(max / stap - 1e-9) * stap;
  const streepjes = [];
  for (let t = min; t <= max + stap / 2; t += stap) streepjes.push(Math.round(t / stap) * stap);
  return { min, max, streepjes };
}

/** Het pad van de lijn: per stuk zonder gaten, door het midden van elk kwartier (of als trap). */
function paden(reeks, x, y, slot, trap) {
  const stukken = [];
  let stuk = null;
  reeks.forEach((v, i) => {
    if (v === null || v === undefined) {
      stuk = null;
      return;
    }
    if (!stuk) stukken.push((stuk = []));
    stuk.push(i);
  });
  return stukken.map((ix) => {
    const punten = trap
      ? ix.flatMap((i) => [
          [x(i), y(reeks[i])],
          [x(i) + slot, y(reeks[i])],
        ])
      : ix.map((i) => [x(i) + slot / 2, y(reeks[i])]);
    const lijn = punten.map(([px, py], n) => `${n ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('');
    const nul = y(0).toFixed(1);
    const vlak = `${lijn}L${punten.at(-1)[0].toFixed(1)},${nul}L${punten[0][0].toFixed(1)},${nul}Z`;
    return { lijn, vlak, enkel: ix.length === 1 ? punten[0] : null };
  });
}

/** De as voor alle lijnen samen: een vast domein, of ronde streepjes om de waarden heen. */
function asVoor(domein, lijnen) {
  if (domein) {
    const stap = (domein[1] - domein[0]) / 4;
    return { min: domein[0], max: domein[1], streepjes: [0, 1, 2, 3, 4].map((i) => domein[0] + i * stap) };
  }
  const waarden = lijnen.flatMap((l) => l.reeks).filter((v) => v !== null && v !== undefined);
  return mooieAs(waarden.length ? Math.min(...waarden) : 0, waarden.length ? Math.max(...waarden) : 1);
}

/** De tabel: per uur het gemiddelde van de kwartieren die er zijn, per lijn een kolom. */
export function tabelPerUur(lijnen, van, stapMs) {
  const perUur = Math.max(1, Math.round(3_600_000 / stapMs));
  const gemiddeld = (rij, i) => {
    const blok = rij.slice(i, i + perUur).filter((v) => v !== null && v !== undefined);
    return blok.length ? blok.reduce((t, v) => t + v, 0) / blok.length : null;
  };
  const lengte = Math.max(0, ...lijnen.map((l) => l.reeks.length));
  const rijen = [];
  for (let i = 0; i < lengte; i += perUur) {
    const v = lijnen.map((l) => gemiddeld(l.reeks, i));
    if (v.some((w) => w !== null)) rijen.push({ i, ms: van + i * stapMs, v });
  }
  return rijen;
}

/** Labels van banden die elkaar zouden raken (smal scherm) om en om een regel lager: 0 of 1 per band. */
export function bandRijen(banden, x) {
  const rij = new Array(banden.length).fill(0);
  let einde = -Infinity;
  let vorige = 1;
  [...banden.keys()]
    .sort((a, b) => banden[a].eerste - banden[b].eerste)
    .forEach((i) => {
      const links = x(banden[i].eerste) + 3;
      rij[i] = links < einde + 4 ? 1 - vorige : 0;
      vorige = rij[i];
      einde = links + banden[i].label.length * 6;
    });
  return rij;
}

/** Ongeveer hoe breed een label van 10,5 px is. */
const labelBreedte = (tekst) => tekst.length * 6;

/** Zoveel ruimte links dat het langste label van de as (met zijn eenheid) erin past, minstens LINKS. */
export function asRuimte(teksten) {
  return Math.max(LINKS, Math.ceil(Math.max(0, ...teksten.map((t) => String(t).length)) * 6) + 10);
}

/**
 * De eerste hoogte (basislijn van een label van 10,5 px) waar het label niets
 * raakt van wat er al staat: `bezet` is een lijst [boven, onder] in px (de
 * lijn binnen de breedte van het label, de strook onderaan). Past het nergens,
 * dan null (weergave-20: geen label over de lijn).
 */
export function vrijeHoogte(kandidaten, bezet) {
  return kandidaten.find((basis) => bezet.every(([boven, onder]) => onder < basis - 10 || boven > basis + 3)) ?? null;
}

/**
 * Waar het label van elke band in de grafiek komt, of niet: alleen als het in
 * zijn vlak past (anders staat het alleen in de legenda eronder). Zo loopt het
 * nooit over een buurvlak, de lijn of de rechterrand; labels die elkaar raken
 * om en om een regel lager (bandRijen).
 * @returns {Array<null | { x: number, rij: number }>}
 */
export function bandLabels(banden, x, slot) {
  const past = banden.map((b) => (b.laatste - b.eerste + 1) * slot >= labelBreedte(b.label) + 6);
  const getoond = banden.map((b, i) => ({ b, i })).filter(({ i }) => past[i]);
  const rijen = bandRijen(getoond.map(({ b }) => b), x);
  const uit = banden.map(() => null);
  getoond.forEach(({ b, i }, k) => {
    uit[i] = { x: x(b.eerste) + 3, rij: rijen[k] };
  });
  return uit;
}

/**
 * Een staaf van de nul-lijn naar de waarde: aan het eind afgerond (4 px, of
 * minder bij een smalle of lage staaf), recht op de nul-lijn. Met `lucht`
 * begint hij zoveel van de nul-lijn af: dan raken een staaf erboven en een
 * eronder (afgenomen en teruggeleverd) elkaar niet. Null als hij te laag is
 * om te zien.
 */
export function staafPad(links, breedte, yNul, yWaarde, lucht = 0) {
  const omhoog = yWaarde < yNul;
  const voet = omhoog ? yNul - lucht : yNul + lucht;
  const hoogte = Math.abs(yWaarde - voet);
  if (hoogte < 0.5 || breedte <= 0 || (omhoog ? yWaarde >= voet : yWaarde <= voet)) return null;
  const r = Math.min(4, breedte / 2, hoogte);
  const rechts = links + breedte;
  const eind = omhoog ? yWaarde + r : yWaarde - r;
  const f = (v) => v.toFixed(1);
  return `M${f(links)},${f(voet)}V${f(eind)}Q${f(links)},${f(yWaarde)} ${f(links + r)},${f(yWaarde)}H${f(rechts - r)}Q${f(rechts)},${f(yWaarde)} ${f(rechts)},${f(eind)}V${f(voet)}Z`;
}

/** Om de hoeveel plekken een label past: smalle plekken (een maand per dag op een telefoon) krijgen er niet elk een. */
export function labelStap(labels, slot) {
  const breed = Math.max(1, ...labels.map((t) => String(t).length)) * 6.3 + 6;
  return Math.max(1, Math.ceil(breed / Math.max(slot, 0.1)));
}

/**
 * @param {{ titel: string, uitleg?: string, reeks: Array<number|null>, van: number, stapMs: number,
 *   slots?: number, kleur: string, vorm?: 'vlak'|'lijn'|'trap', domein?: [number, number],
 *   waarde: (v: number) => string, asWaarde?: (v: number) => string, nu?: number|null,
 *   verledenDimmen?: boolean, banden?: Array<{ eerste: number, laatste: number, label: string, kleur?: string }>,
 *   strook?: Array<{ eerste: number, laatste: number }>, strookLabel?: string, strookKleur?: string,
 *   meer?: (i: number) => string[], hoogte?: number, uurStap?: number, dagNamen?: (ms: number) => string,
 *   reeksen?: Array<{ naam: string, reeks: Array<number|null>, kleur: string, bij?: (i: number) => string }> }} props
 *   reeksen: meer lijnen op dezelfde as (bijvoorbeeld de drie fasen); dan een legenda,
 *   in de tip alle lijnen op dat kwartier (met `bij` er iets achter, zoals het vermogen),
 *   en in de tabel een kolom per lijn.
 * @param {{ labels?: string[], namen?: string[], tabelKop?: string, kolom?: string, stapNaam?: string,
 *   legenda?: boolean, huidig?: number|null }} [per]  per dag, week of maand in plaats van per
 *   kwartier: `labels` onder de as, `namen` in de tip en de tabel, `huidig` (vandaag) vet.
 *   `kolom`: de kop boven de waarden in de tabel bij één reeks (per uur: Gemiddeld).
 *   `legenda={false}` als de uitleg al zegt wat boven en onder de nul staat.
 */
export default function Grafiek({
  titel,
  uitleg,
  reeks: losseReeks,
  van,
  stapMs,
  slots,
  kleur,
  vorm = 'vlak',
  domein,
  waarde,
  asWaarde = waarde,
  nu = null,
  verledenDimmen = false,
  banden = [],
  strook = [],
  strookLabel,
  strookKleur = kleur,
  meer,
  hoogte = 150,
  uurStap = 6,
  dagNamen,
  reeksen,
  labels,
  namen,
  tabelKop = 'Uur',
  kolom = 'Gemiddeld',
  stapNaam = 'kwartier',
  legenda = true,
  huidig = null,
}) {
  const lijnenLijst = reeksen ?? [{ naam: titel, reeks: losseReeks, kleur }];
  const perPlek = Array.isArray(labels);
  const staaf = vorm === 'staaf';
  const meerdere = lijnenLijst.length > 1;
  const reeks = lijnenLijst[0].reeks;
  const vlakRef = useRef(null);
  const breedte = useBreedte(vlakRef);
  const [gekozen, setGekozen] = useState(null);
  const id = useId();
  const n = Math.max(slots ?? 0, perPlek ? labels.length : 0, ...lijnenLijst.map((l) => l.reeks.length), 1);

  const as = asVoor(domein, lijnenLijst);
  const links = asRuimte(as.streepjes.map(asWaarde));

  const plotB = Math.max(0, breedte - links - RECHTS);
  const plotH = hoogte - BOVEN - ONDER;
  const slot = plotB / n;
  const x = (i) => links + i * slot;
  const y = (v) => BOVEN + ((as.max - v) / (as.max - as.min)) * plotH;
  const indexOp = (ms) => (ms - van) / stapMs;
  const nuI = nu === null || perPlek ? null : indexOp(nu);
  const toonNu = nuI !== null && nuI >= 0 && nuI <= n;

  const lijnen = breedte > 0 && !staaf ? lijnenLijst.map((l) => ({ ...l, paden: paden(l.reeks, x, y, slot, vorm === 'trap') })) : [];
  // Staven: hooguit 24 px, met 2 px lucht tussen twee staven.
  const staafB = Math.max(1, Math.min(24, slot - 2));
  const staven =
    breedte > 0 && staaf
      ? lijnenLijst.flatMap((l) =>
          l.reeks.map((v, i) => (v === null || v === undefined ? null : { sleutel: `${l.naam}-${i}`, i, kleur: l.kleur, d: staafPad(x(i) + (slot - staafB) / 2, staafB, y(0), y(v), 1) })).filter((s) => s?.d),
        )
      : [];
  // Wat er tussen twee x-posities staat: de lijn (met zijn buren, voor een schuin stuk) en de strook onderaan.
  const bezetTussen = (x0, x1) => {
    if (breedte <= 0) return [];
    const eerste = Math.max(0, Math.floor((x0 - links) / slot) - 1);
    const laatste = Math.min(n - 1, Math.ceil((x1 - links) / slot) + 1);
    const uit = [];
    for (const l of lijnenLijst) {
      for (let i = eerste; i <= laatste; i++) {
        const v = l.reeks[i];
        if (v === null || v === undefined) continue;
        uit.push(staaf ? [Math.min(y(v), y(0)), Math.max(y(v), y(0))] : [y(v) - 2, y(v) + 2]);
      }
    }
    for (const st of strook) if (st.eerste <= laatste && st.laatste >= eerste) uit.push([BOVEN + plotH - 5, BOVEN + plotH]);
    return uit;
  };
  const onderaan = BOVEN + plotH - 7 - (strook.length ? 5 : 0);
  // Labels van de banden: bovenin hun vlak, en raakt dat de lijn, dan onderin; anders alleen in de legenda.
  const bandLabel = bandLabels(banden, x, slot).map((plek, k) => {
    if (!plek) return null;
    const x1 = plek.x + labelBreedte(banden[k].label);
    const basis = vrijeHoogte([BOVEN + 11 + 12 * plek.rij, onderaan - 12 * plek.rij], bezetTussen(plek.x, x1));
    return basis === null ? null : { ...plek, basis };
  });
  // "nu": onderin naast de streep, en raakt dat de lijn of de strook, dan bovenin.
  const nuX = toonNu ? Math.min(x(nuI) + 4, links + plotB - 16) : 0;
  const nuBasis = toonNu ? (vrijeHoogte([onderaan, BOVEN + 11], bezetTussen(nuX, nuX + 14)) ?? BOVEN + 11) : 0;
  // De legenda van de banden: elke soort één keer, met de kleur van zijn vlak.
  const bandSoorten = [...new Map(banden.map((b) => [b.label, b])).values()];

  // Kloktijden langs de onderkant: elke `uurStap` uur, en bij een nieuwe dag de naam van de dag.
  // Per dag, week of maand: de labels, zoveel als er passen.
  const tijden = [];
  if (breedte > 0 && perPlek) {
    const elke = labelStap(labels, slot);
    labels.forEach((tekst, i) => {
      if (i % elke === 0) tijden.push({ i, tekst, plek: true, vet: i === huidig });
    });
  } else if (breedte > 0) {
    const perUur = 3_600_000 / stapMs;
    for (let i = 0; i < n; i += perUur) {
      const ms = van + i * stapMs;
      const uur = new Date(ms).getHours();
      if (uur % uurStap !== 0) continue;
      const tekst = uur === 0 && dagNamen ? dagNamen(ms) : tijd(ms).slice(0, 2);
      if (tekst) tijden.push({ i, tekst, dag: uur === 0 && Boolean(dagNamen) });
    }
  }

  const kies = (i) => setGekozen(i === null ? null : Math.max(0, Math.min(n - 1, reeks.length - 1, i)));
  const opWijzer = (e) => {
    const r = vlakRef.current.getBoundingClientRect();
    kies(Math.floor((e.clientX - r.left - links) / slot));
  };
  const toets = (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const stap = e.key === 'ArrowRight' ? 1 : -1;
      const begin = gekozen ?? (toonNu ? Math.min(reeks.length - 1, Math.floor(nuI)) : reeks.length - 1);
      kies(gekozen === null ? begin : begin + stap);
    } else if (e.key === 'Escape') {
      kies(null);
    }
  };

  const gekozenWaarde = gekozen === null ? null : reeks[gekozen];
  // De tip naast de streep als dat past (dan blijft het gekozen punt zichtbaar), anders erboven
  // binnen de grafiek. Met meer lijnen een vaste breedte, anders hoogstens zo breed (.grafiek-tip).
  // Met lange namen ("Teruggeleverd") breder, zodat naam en waarde op één regel passen.
  const langsteNaam = Math.max(0, ...lijnenLijst.map((l) => String(l.naam).length));
  const tipBreedte = meerdere ? Math.min(236, Math.max(172, Math.round(120 + langsteNaam * 6.8))) : 180;
  const midden = gekozen === null ? 0 : x(gekozen) + slot / 2;
  let tipPlek;
  if (midden + 10 + tipBreedte <= breedte) tipPlek = { left: midden + 10 };
  else if (midden - 10 - tipBreedte >= 0) tipPlek = { right: breedte - midden + 10 };
  else tipPlek = { left: Math.min(Math.max(midden - tipBreedte / 2, 0), Math.max(0, breedte - tipBreedte)) };

  const tabel = perPlek
    ? labels.map((label, i) => ({ i, naam: namen?.[i] ?? label, v: lijnenLijst.map((l) => l.reeks[i] ?? null) })).filter((r) => r.v.some((v) => v !== null))
    : tabelPerUur(lijnenLijst, van, stapMs);
  const wanneer = (i) => (perPlek ? (namen?.[i] ?? labels[i] ?? '') : `${tijd(van + i * stapMs)}–${tijd(van + (i + 1) * stapMs)}`);

  return (
    <section className="grid min-w-0 grid-cols-1 gap-2 rounded-2xl border border-lijn bg-vlak p-3.5" aria-labelledby={`${id}-titel`}>
      <div className="grid gap-0.5">
        <h3 id={`${id}-titel`} className="text-[15px] font-semibold">
          {titel}
        </h3>
        {uitleg && <p className="m-0 text-[12.5px] text-tekst-zacht">{uitleg}</p>}
        {meerdere && legenda && (
          <ul className="m-0 mt-1 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[12.5px] text-tekst-zacht" aria-label="Legenda">
            {lijnenLijst.map((l) => (
              <li key={l.naam} className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-4 rounded-full" style={{ background: l.kleur }} aria-hidden="true" />
                {l.naam}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div
        ref={vlakRef}
        className="grafiek-vlak"
        style={{ height: hoogte }}
        tabIndex={0}
        role="group"
        aria-label={`${titel}. Met de pijltjes ga je per ${stapNaam}.`}
        onPointerMove={opWijzer}
        onPointerDown={opWijzer}
        onPointerLeave={(e) => e.pointerType === 'mouse' && kies(null)}
        onKeyDown={toets}
        onBlur={() => kies(null)}
      >
        {breedte > 0 && (
          <svg width={breedte} height={hoogte} aria-hidden="true" className="block">
            {banden.map((b, k) => (
              <g key={`${b.label}-${b.eerste}`}>
                <rect x={x(b.eerste)} y={BOVEN} width={(b.laatste - b.eerste + 1) * slot} height={plotH} fill={b.kleur ?? 'var(--tekst)'} style={{ opacity: b.kleur ? 'var(--band-kleur)' : 'var(--band-grijs)' }} rx="4" />
                {bandLabel[k] && (
                  <text x={bandLabel[k].x} y={bandLabel[k].basis} fontSize="10.5" fill="var(--tekst-zacht)">
                    {b.label}
                  </text>
                )}
              </g>
            ))}
            {as.streepjes.map((t) => (
              <g key={t}>
                <line x1={links} x2={links + plotB} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--tekst-zacht)' : 'var(--lijn)'} strokeWidth="1" opacity={t === 0 ? 0.6 : 1} />
                <text x={links - 6} y={y(t) + 3.5} fontSize="10.5" textAnchor="end" fill="var(--tekst-zacht)" className="cijfer">
                  {asWaarde(t)}
                </text>
              </g>
            ))}
            {lijnen.map((l) =>
              l.paden.map((p, k) => (
                <g key={`${l.naam}-${k}`}>
                  {vorm !== 'lijn' && !meerdere && <path d={p.vlak} fill={l.kleur} opacity="0.12" />}
                  <path d={p.lijn} fill="none" stroke={l.kleur} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                  {p.enkel && <circle cx={p.enkel[0]} cy={p.enkel[1]} r="3" fill={l.kleur} />}
                </g>
              )),
            )}
            {staven.map((s) => (
              <path key={s.sleutel} d={s.d} fill={s.kleur} opacity={gekozen === null || gekozen === s.i ? 1 : 0.45} />
            ))}
            {strook.map((s) => (
              <rect key={s.eerste} x={x(s.eerste)} y={BOVEN + plotH - 4} width={(s.laatste - s.eerste + 1) * slot} height="4" rx="2" fill={strookKleur} />
            ))}
            {toonNu && verledenDimmen && <rect x={links} y={BOVEN} width={Math.max(0, x(nuI) - links)} height={plotH} fill="var(--vlak)" opacity="0.45" />}
            {toonNu && (
              <g>
                <line x1={x(nuI)} x2={x(nuI)} y1={BOVEN} y2={BOVEN + plotH} stroke="var(--tekst)" strokeWidth="1.5" />
                <text x={nuX} y={nuBasis} fontSize="10.5" fill="var(--tekst)" fontWeight="600">
                  nu
                </text>
              </g>
            )}
            {tijden.map((t) =>
              t.plek ? (
                <text key={t.i} x={x(t.i) + slot / 2} y={hoogte - 6} fontSize="10.5" textAnchor="middle" fill={t.vet ? 'var(--tekst)' : 'var(--tekst-zacht)'} fontWeight={t.vet ? 600 : 400}>
                  {t.tekst}
                </text>
              ) : (
                <text
                  key={t.i}
                  x={t.dag ? x(t.i) : Math.min(Math.max(x(t.i), links + 8), links + plotB - 8)}
                  y={hoogte - 6}
                  fontSize="10.5"
                  textAnchor={t.dag ? 'start' : 'middle'}
                  fill={t.dag ? 'var(--tekst)' : 'var(--tekst-zacht)'}
                  fontWeight={t.dag ? 600 : 400}
                >
                  {t.tekst}
                </text>
              ),
            )}
            {gekozen !== null && !staaf && (
              <g>
                <line x1={x(gekozen) + slot / 2} x2={x(gekozen) + slot / 2} y1={BOVEN} y2={BOVEN + plotH} stroke="var(--tekst-zacht)" strokeWidth="1" />
                {lijnenLijst.map((l) => {
                  const v = l.reeks[gekozen];
                  return v === null || v === undefined ? null : (
                    <circle key={l.naam} cx={x(gekozen) + slot / 2} cy={y(v)} r="4.5" fill={l.kleur} stroke="var(--vlak)" strokeWidth="2" />
                  );
                })}
              </g>
            )}
          </svg>
        )}
        {gekozen !== null && (
          <div className="grafiek-tip" style={{ ...tipPlek, top: 4, ...(meerdere ? { width: tipBreedte, maxWidth: tipBreedte } : {}) }} role="status">
            {meerdere ? (
              lijnenLijst.map((l) => (
                <div key={l.naam} className="flex items-center gap-1.5 whitespace-nowrap">
                  <span className="inline-block h-0.5 w-3 flex-none rounded-full" style={{ background: l.kleur }} aria-hidden="true" />
                  <span className="text-tekst-zacht">{l.naam}</span>
                  <span className="cijfer text-[13.5px] font-bold">{l.reeks[gekozen] == null ? '–' : waarde(l.reeks[gekozen])}</span>
                  {l.bij && l.reeks[gekozen] != null && <span className="cijfer text-tekst-zacht">{l.bij(gekozen)}</span>}
                </div>
              ))
            ) : (
              <div className="cijfer text-[14px] font-bold">{gekozenWaarde === null || gekozenWaarde === undefined ? (perPlek ? 'geen cijfers' : 'geen meting') : waarde(gekozenWaarde)}</div>
            )}
            <div className="text-tekst-zacht">{wanneer(gekozen)}</div>
            {gekozenWaarde !== null && gekozenWaarde !== undefined && meer?.(gekozen).map((r) => (
              <div key={r} className="text-tekst-zacht">
                {r}
              </div>
            ))}
          </div>
        )}
      </div>
      {(bandSoorten.length > 0 || (strookLabel && strook.length > 0)) && (
        <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[12.5px] text-tekst-zacht" aria-label="Legenda">
          {bandSoorten.map((b) => (
            <li key={b.label} className="flex items-center gap-2">
              <span
                className="inline-block h-3 w-4 rounded-[3px]"
                style={{ background: b.kleur ?? 'var(--tekst)', opacity: b.kleur ? 'var(--band-kleur)' : 'var(--band-grijs)' }}
                aria-hidden="true"
              />
              {b.uitleg ?? b.label}
            </li>
          ))}
          {strookLabel && strook.length > 0 && (
            <li className="flex items-center gap-2">
              <span className="inline-block h-1 w-5 rounded-full" style={{ background: strookKleur }} aria-hidden="true" />
              {strookLabel}
            </li>
          )}
        </ul>
      )}
      <details className="group text-[13px]">
        {/* Een eigen pijltje: het driehoekje van de browser valt weg in een flex-summary (Chromium) of ziet er overal anders uit. */}
        <summary className="inline-flex min-h-[44px] cursor-pointer list-none items-center gap-1.5 text-tekst-zacht hover:text-tekst [&::-webkit-details-marker]:hidden">
          <ChevronDown size={16} className="flex-none transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
          Als tabel, per {perPlek ? stapNaam : 'uur'}
        </summary>
        <div className="max-h-64 overflow-y-auto">
          <table className="grafiek-tabel">
            <thead>
              <tr>
                <th scope="col">{tabelKop}</th>
                {meerdere ? (
                  lijnenLijst.map((l) => (
                    <th key={l.naam} scope="col">
                      {l.naam}
                    </th>
                  ))
                ) : (
                  <th scope="col">{kolom}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {tabel.map((r) => (
                <tr key={r.i}>
                  <td>
                    {perPlek ? r.naam : `${dagNamen && new Date(r.ms).getHours() === 0 ? `${dagNamen(r.ms)} ` : ''}${tijd(r.ms)}`}
                  </td>
                  {r.v.map((v, k) => (
                    <td key={lijnenLijst[k].naam} className={perPlek ? 'cijfer whitespace-nowrap' : 'cijfer'}>
                      {v === null ? '–' : waarde(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
