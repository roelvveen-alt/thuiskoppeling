/**
 * De vorm van een stroomlijn op de foto: een licht gebogen lijn van het ene
 * rondje naar het andere, met stipjes die in de richting van de stroom lopen.
 * Hoe meer vermogen, hoe sneller de stipjes en hoe dikker de lijn.
 *
 * Een tekening kan voor één lijn een eigen route hebben (route(), langs
 * vaste punten): zo loopt de kabel van het dierenverblijf om het huis heen
 * naar de meterkast in plaats van er dwars overheen (31-10-2026).
 */

const rond = (v) => Math.round(v * 10) / 10;

/**
 * Pad (SVG "d") van a naar b, in pixels. Begint en eindigt bij de rand van de
 * rondjes, niet erin. Heen en terug buigen naar een andere kant, zodat twee
 * lijnen tussen dezelfde punten niet over elkaar vallen. Staan de rondjes zo
 * dicht op elkaar dat er geen lijn tussen past, dan null.
 */
export function boog(a, b, { straalA = 24, straalB = 24, buiging = 0.16, kant = 1 } = {}) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const afstand = Math.hypot(dx, dy);
  const ruimte = afstand - straalA - straalB - 6;
  if (!(ruimte > 8)) return null;
  const ux = dx / afstand;
  const uy = dy / afstand;
  const start = { x: a.x + ux * straalA, y: a.y + uy * straalA };
  const eind = { x: b.x - ux * (straalB + 6), y: b.y - uy * (straalB + 6) };
  const k = buiging * ruimte * (kant < 0 ? -1 : 1);
  const bocht = { x: (start.x + eind.x) / 2 - uy * k, y: (start.y + eind.y) / 2 + ux * k };
  return `M${rond(start.x)} ${rond(start.y)} Q${rond(bocht.x)} ${rond(bocht.y)} ${rond(eind.x)} ${rond(eind.y)}`;
}

/**
 * De stukken van een pad uit boog() ("M x y Q cx cy x y") of route() (ook
 * "L x y"), elk met `op(t)`: waar je bent op een deel t (0–1) van dat stuk.
 * Iets wat er niet op lijkt: geen stukken.
 */
function stukkenVan(d) {
  const delen = String(d ?? '').match(/[MLQ]|-?\d+(\.\d+)?/g) ?? [];
  const stukken = [];
  let hier = null;
  let i = 0;
  const getal = () => Number(delen[i++]);
  while (i < delen.length) {
    const letter = delen[i++];
    if (letter === 'M') {
      hier = { x: getal(), y: getal() };
    } else if (letter === 'L' && hier) {
      const [a, b] = [hier, { x: getal(), y: getal() }];
      stukken.push({ soort: 'L', op: (t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }) });
      hier = b;
    } else if (letter === 'Q' && hier) {
      const [a, c, b] = [hier, { x: getal(), y: getal() }, { x: getal(), y: getal() }];
      stukken.push({
        soort: 'Q',
        op: (t) => {
          const u = 1 - t;
          return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
        },
      });
      hier = b;
    } else {
      return [];
    }
    if (!Number.isFinite(hier.x) || !Number.isFinite(hier.y)) return [];
  }
  return stukken;
}

/**
 * Punten op een pad, om te kijken of het iets raakt: per bocht 12 stappen
 * (zoals altijd), een recht stuk om de 6 px (een lang recht stuk mag geen
 * rondje overslaan).
 */
function puntenOp(d, n = 12) {
  return stukkenVan(d).flatMap((stuk, s) => {
    const stappen = stuk.soort === 'L' ? Math.max(1, Math.ceil(Math.hypot(stuk.op(1).x - stuk.op(0).x, stuk.op(1).y - stuk.op(0).y) / 6)) : n;
    return Array.from({ length: stappen + (s === 0 ? 1 : 0) }, (_, i) => stuk.op((i + (s === 0 ? 0 : 1)) / stappen));
  });
}

/** Hoeveel ruimte een pad laat tot de rand van de dichtstbijzijnde hindernis ({x, y, straal}); negatief = erdoorheen. */
export function vrijeRuimte(d, hindernissen) {
  if (!hindernissen.length) return Infinity;
  const punten = puntenOp(d);
  return Math.min(...hindernissen.map((h) => Math.min(...punten.map((p) => Math.hypot(p.x - h.x, p.y - h.y))) - h.straal));
}

/** Zoveel ruimte (px) houdt een lijn liefst tot een ander rondje (met zijn ring). */
export const VRIJ_PX = 8;

/**
 * Als boog(), maar de lijn buigt om de andere rondjes heen: eerst de gewone
 * kant, dan de andere, dan allebei wat ruimer. De eerste die VRIJ_PX vrij
 * houdt wint; past er geen, dan die met de meeste ruimte. Zo lijkt huis → net
 * nooit batterij → net omdat hij door de batterij loopt. Tussen twee rondjes
 * loopt hooguit één lijn, dus de kant omdraaien botst nergens mee.
 */
export function boogLangs(a, b, opties = {}, hindernissen = []) {
  let beste = null;
  for (const buiging of [opties.buiging ?? 0.16, 0.3]) {
    for (const kant of [1, -1]) {
      const d = boog(a, b, { ...opties, buiging, kant });
      if (!d) return null;
      const vrij = vrijeRuimte(d, hindernissen);
      if (vrij >= VRIJ_PX) return d;
      if (!beste || vrij > beste.vrij) beste = { d, vrij };
    }
  }
  return beste.d;
}

/** Hoe rond een hoek in een route is (px), hooguit de helft van de stukken ernaast. */
export const ROUTE_BOCHT_PX = 12;

/**
 * Pad (SVG "d") van a naar b langs vaste punten (`langs`, in pixels): rechte
 * stukken met ronde hoeken, zoals een kabel langs een gevel. Begint en eindigt
 * bij de rand van de rondjes, net als boog(). Raakt het pad een ander rondje
 * (een hindernis, {x, y, straal}), of is het eerste of laatste stuk te kort
 * (de rondjes liggen over het pad heen), dan null: dan een gewone boog.
 */
export function route(a, langs, b, { straalA = 24, straalB = 24 } = {}, hindernissen = []) {
  if (!Array.isArray(langs) || !langs.length) return null;
  const richting = (p, q) => {
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const l = Math.hypot(dx, dy);
    return l > 0 ? { x: dx / l, y: dy / l, l } : null;
  };
  const eerste = richting(a, langs[0]);
  const laatste = richting(langs.at(-1), b);
  if (!eerste || !laatste || !(eerste.l - straalA > 8) || !(laatste.l - straalB - 6 > 8)) return null;
  const pad = [
    { x: a.x + eerste.x * straalA, y: a.y + eerste.y * straalA },
    ...langs,
    { x: b.x - laatste.x * (straalB + 6), y: b.y - laatste.y * (straalB + 6) },
  ];
  // De afstand tot de randen is al van de stukken af; een hoek pakt hooguit de helft van wat er over is.
  const lengtes = pad.slice(1).map((p, i) => richting(pad[i], p)?.l ?? 0);
  let d = `M${rond(pad[0].x)} ${rond(pad[0].y)}`;
  for (let i = 1; i < pad.length - 1; i++) {
    const erin = richting(pad[i - 1], pad[i]);
    const eruit = richting(pad[i], pad[i + 1]);
    if (!erin || !eruit) continue;
    const r = Math.min(ROUTE_BOCHT_PX, lengtes[i - 1] / 2, lengtes[i] / 2);
    const p = pad[i];
    d += ` L${rond(p.x - erin.x * r)} ${rond(p.y - erin.y * r)} Q${rond(p.x)} ${rond(p.y)} ${rond(p.x + eruit.x * r)} ${rond(p.y + eruit.y * r)}`;
  }
  d += ` L${rond(pad.at(-1).x)} ${rond(pad.at(-1).y)}`;
  return vrijeRuimte(d, hindernissen) >= 0 ? d : null;
}

/** Afstand tussen twee stipjes, in pixels. De animatie schuift precies één afstand per ronde. */
export const STIP_AFSTAND = 18;

/** Seconden per ronde: 300 W loopt rustig, 3 kW hard, een paar watt kruipt. */
export function duurVoor(w) {
  const s = 1.6 * Math.sqrt(300 / Math.max(w, 20));
  return Math.min(4, Math.max(0.35, Math.round(s * 100) / 100));
}

export function dikteVoor(w) {
  return rond(1.5 + 3.5 * Math.min(1, Math.sqrt(Math.max(w, 0) / 2500)));
}

/**
 * De stipjes op een pad uit boog() of route(), als banen voor een animatie die alleen
 * transform en opacity gebruikt (dan loopt hij op de grafische kaart, niet op
 * de hoofddraad van de telefoon; prestaties-9). Op het begin van een ronde
 * staat er elke `afstand` px een stipje, vanaf het begin van het pad; in één
 * ronde schuift elk stipje precies één afstand op, zodat het einde van de ene
 * ronde het begin van de volgende is (zoals stroke-dasharray "0 18" met een
 * lopende stroke-dashoffset). Een stipje dat voorbij het eind van het pad zou
 * gaan, verdwijnt daar.
 *
 * @returns {Array<Array<{ offset: number, x: number, y: number, zicht: 0|1 }>>}  per stipje de tussenstappen
 */
export function stipBanen(d, afstand = STIP_AFSTAND, stappen = 4) {
  // Lengte langs het pad: een bocht in 64 stukjes (genoeg voor een licht
  // gebogen lijn), een recht stuk in één.
  const stukjes = [];
  let totaal = 0;
  for (const stuk of stukkenVan(d)) {
    const N = stuk.soort === 'Q' ? 64 : 1;
    let vorige = stuk.op(0);
    for (let i = 1; i <= N; i++) {
      const p = stuk.op(i / N);
      const lang = Math.hypot(p.x - vorige.x, p.y - vorige.y);
      stukjes.push({ stuk, t0: (i - 1) / N, t1: i / N, s0: totaal, s1: totaal + lang });
      totaal += lang;
      vorige = p;
    }
  }
  if (!(totaal > 0)) return [];
  const plekOp = (s) => {
    const doel = Math.min(Math.max(s, 0), totaal);
    let i = 0;
    while (i < stukjes.length - 1 && stukjes[i].s1 < doel) i++;
    const { stuk, t0, t1, s0, s1 } = stukjes[i];
    const p = stuk.op(t0 + (s1 > s0 ? (doel - s0) / (s1 - s0) : 0) * (t1 - t0));
    return { x: rond(p.x), y: rond(p.y) };
  };
  const banen = [];
  for (let begin = 0; begin < totaal; begin += afstand) {
    const baan = [];
    for (let j = 0; j <= stappen; j++) {
      const s = begin + (j / stappen) * afstand;
      if (s <= totaal) {
        baan.push({ offset: j / stappen, ...plekOp(s), zicht: 1 });
        continue;
      }
      // Hier is het pad op: tot het eind lopen, dan weg tot de volgende ronde.
      const eind = (totaal - begin) / afstand;
      const plek = plekOp(totaal);
      if (eind > baan.at(-1).offset) baan.push({ offset: eind, ...plek, zicht: 1 });
      baan.push({ offset: Math.min(1, baan.at(-1).offset + 0.001), ...plek, zicht: 0 }, { offset: 1, ...plek, zicht: 0 });
      break;
    }
    banen.push(baan.filter((f, i, alle) => i === 0 || f.offset > alle[i - 1].offset || i === alle.length - 1));
  }
  return banen;
}
