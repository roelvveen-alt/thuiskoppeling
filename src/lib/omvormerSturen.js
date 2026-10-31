import { tijd } from './opmaak';

/**
 * De omvormer begrenzen als terugleveren geld kost (programmaatje 1.5.0, 1.6.0), aan de kant van de
 * site: alleen tonen en een instelling doorgeven. Het programmaatje thuis beslist en stuurt
 * (brug/omvormerPlan.mjs); de app bedient niets.
 *
 *   stand.omvormer.sturen  wat het programmaatje meldt (sturenUit): stand, plan, fout
 *   huis.omvormer_sturen   de instelling van de eigenaar (instellingUit): aan, niet_op, vrij_op, netto
 *
 * Een kijker krijgt geen van beide (de functie laat ze weg).
 */

const ISO = /^\d{4}-\d{2}-\d{2}T[0-9:.+\-Z]{5,30}$/;
const ms = (t) => (typeof t === 'string' && ISO.test(t) && Number.isFinite(Date.parse(t)) ? Date.parse(t) : null);
const getal = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const DATUM = /^\d{4}-\d{2}-\d{2}$/;

/** Wat het programmaatje meldt (Meting.omvormer.sturen), mild; zonder geldige stand: null (een oudere brug). */
export function sturenUit(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s) || !['onbekend', 'vrij', 'begrensd', 'eigen'].includes(s.stand)) return null;
  return {
    aan: s.aan === true,
    stand: s.stand,
    pct: Number.isInteger(s.pct) ? s.pct : null,
    sinds: ms(s.sinds),
    door: s.door === 'programmaatje' ? 'programmaatje' : null,
    aanpassingen: Number.isInteger(s.aanpassingen) ? s.aanpassingen : 0,
    doelW: getal(s.doel_w),
    grensPct: Number.isInteger(s.grens_pct) ? s.grens_pct : null,
    verbruikW: getal(s.verbruik_w),
    blokken: (Array.isArray(s.blokken) ? s.blokken : [])
      .map((b) => ({ van: ms(b?.van), tot: ms(b?.tot), laagste: getal(b?.laagste), modus: ['deels', 'uit', 'loont-niet'].includes(b?.modus) ? b.modus : 'deels', reden: b?.reden === 'saldering' ? 'saldering' : null, niet: typeof b?.niet === 'string' ? b.niet : null }))
      .filter((b) => b.van !== null && b.tot !== null && b.tot > b.van && b.laagste !== null),
    nuAan: s.nu_aan === true,
    fout: ['begrenzen', 'vrijgeven', 'eigen', 'rem'].includes(s.fout) ? s.fout : null,
    foutSinds: ms(s.fout_sinds),
    vrijOp: typeof s.vrij_op === 'string' ? s.vrij_op : null,
    // Programmaatje 1.6.0 (een oudere brug: null): de grens in watt, de zelfcontrole en hoe hij oorspronkelijk stond.
    grensW: getal(s.grens_w),
    controle: controleUit(s.controle),
    oorspronkelijk:
      s.oorspronkelijk && Number.isInteger(s.oorspronkelijk.grens_pct) && typeof s.oorspronkelijk.schakelaar === 'boolean'
        ? { grensPct: s.oorspronkelijk.grens_pct, schakelaar: s.oorspronkelijk.schakelaar, op: ms(s.oorspronkelijk.op) }
        : null,
  };
}

/** sturen.controle: { uitkomst: 'bezig'|'werkt'|'werkt-niet', op, pct, voorW, naW, via, reden }, of null (nog niet nagekeken). */
function controleUit(c) {
  if (!c || typeof c !== 'object' || !['bezig', 'werkt', 'werkt-niet'].includes(c.uitkomst)) return null;
  return {
    uitkomst: c.uitkomst,
    op: ms(c.op),
    pct: Number.isInteger(c.pct) ? c.pct : null,
    voorW: getal(c.voor_w),
    naW: getal(c.na_w),
    via: c.via === 'net' ? 'net' : c.via === 'omvormer' ? 'omvormer' : null,
    reden: c.reden === 'te-veel' ? 'te-veel' : c.reden === 'geen-effect' ? 'geen-effect' : null,
  };
}

/** De instelling van de eigenaar (huis.omvormer_sturen van de functie); zonder: uit. */
export function instellingUit(r) {
  if (!r || typeof r !== 'object') return { aan: false, nietOp: [], vrijOp: null, netto: 'afnemer' };
  return {
    aan: r.aan === true,
    nietOp: Array.isArray(r.niet_op) ? r.niet_op.filter((d) => typeof d === 'string' && DATUM.test(d)) : [],
    vrijOp: typeof r.vrij_op === 'string' ? r.vrij_op : null,
    netto: r.netto === 'terugleveraar' ? 'terugleveraar' : 'afnemer',
  };
}

/** De datum van een moment op dit toestel (in Nederland de Nederlandse, zoals de rest van de app): '2026-11-01'. */
export const datumVan = (t) => new Intl.DateTimeFormat('en-CA').format(new Date(t));

/** 'vandaag', 'morgen' of de datum ('3 nov.'). */
export function dagNaam(t, nu) {
  const d = datumVan(t);
  if (d === datumVan(nu)) return 'vandaag';
  if (d === datumVan(nu + 86_400_000) || d === datumVan(nu + 26 * 3_600_000)) return 'morgen';
  return new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short' }).format(new Date(t));
}

/** 1234 → "1,2 kW". */
export const kw = (w) => `${(Math.round(w / 100) / 10).toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}\u00a0kW`;
/** −0,034 → "3 ct" (zonder teken: "kost 3 ct"). */
export const cent = (euro) => {
  const ct = Math.abs(euro * 100);
  return `${ct >= 0.95 ? Math.round(ct) : ct.toFixed(1).replace('.', ',')}\u00a0ct`;
};

const hoofdletter = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const NIET_TEKST = { dag: 'die dag niet (jouw keuze)', 'nu-aan': '"Nu weer aan" gekozen', mislukt: 'begrenzen lukte niet; hij staat vrij', anders: 'iemand anders gaf hem vrij' };

/**
 * De zin bij een blok uit het plan, met de reden: "Morgen 12:00–15:15 begrensd tot ~1,2 kW:
 * terugleveren kost dan tot 4 ct/kWh, je eigen verbruik blijft van de zon." En als het niet
 * loont: "Morgen 12:00–15:15 is de prijs negatief, maar door de saldering loont begrenzen nog
 * niet; vanaf 2027 wel."
 */
export function blokZin(b, nu, { verbruikW = null } = {}) {
  const wanneer = `${hoofdletter(dagNaam(b.van, nu))} ${tijd(b.van)}–${tijd(b.tot)}`;
  if (b.modus === 'loont-niet') {
    return `${wanneer} is de prijs negatief, maar ${b.reden === 'saldering' ? 'door de saldering loont begrenzen nog niet; vanaf 2027 wel' : 'begrenzen loont dan niet'}.`;
  }
  const kost = `terugleveren kost dan tot ${cent(b.laagste)}/kWh`;
  const zin = b.modus === 'uit' ? `${wanneer} helemaal uit: ${kost} en stroom uit het net levert zelfs geld op.` : `${wanneer} begrensd tot ${verbruikW ? `~${kw(verbruikW + 300)}` : 'ongeveer je eigen verbruik'}: ${kost}, je eigen verbruik blijft van de zon.`;
  return b.niet ? `${zin} Niet: ${NIET_TEKST[b.niet] ?? b.niet}.` : zin;
}

/** De stand van nu in één zin, of null als er niets te zeggen is. */
export function standZin(s) {
  if (!s) return null;
  if (s.stand === 'begrensd') {
    const hoeveel = s.pct === 0 ? 'Helemaal uit' : s.doelW ? `Begrensd tot ~${kw(s.doelW)}` : `Begrensd op ${s.pct}%`;
    return `${hoeveel}${s.sinds ? ` sinds ${tijd(s.sinds)}` : ''} door het programmaatje${s.pct ? ', past zich aan je verbruik aan' : ''}.`;
  }
  if (s.stand === 'eigen') return `De omvormer heeft een eigen grens${s.grensPct !== null ? ` van ${s.grensPct}%` : ''} (de schakelaar van de grens staat aan, niet door het programmaatje); het programmaatje stuurt hem niet.`;
  if (s.nuAan) return 'Nu weer aan: hij levert vol, de rest van dit blok.';
  if (s.stand === 'vrij') return 'Vrij: hij levert vol.';
  return null;
}

const datumKort = (t) => new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short' }).format(new Date(t)).replace('.', '');

/**
 * De zelfcontrole van het programmaatje (1.6.0) in één zin: "Nog niet nagekeken", "Nagekeken op
 * 1 nov: van 3,1 kW naar 0,4 kW" of "Werkt niet op deze omvormer, uitgezet". Een oudere brug
 * (die niet nakijkt): null.
 */
export function controleZin(s, brugNieuw = Boolean(s?.oorspronkelijk || s?.controle || s?.grensW !== null)) {
  if (!s) return null;
  const c = s.controle;
  if (!c) return brugNieuw ? 'Nog niet nagekeken: bij de eerste begrenzing met genoeg zon kijkt het programmaatje of het werkt.' : null;
  const van = (w) => (w !== null ? kw(w) : 'onbekend');
  if (c.uitkomst === 'bezig') return `Bezig met nakijken: werkt het begrenzen (vooraf ${van(c.voorW)})?`;
  const wanneer = c.op ? ` op ${datumKort(c.op)}` : '';
  if (c.uitkomst === 'werkt') return `Nagekeken${wanneer}: van ${van(c.voorW)} naar ${van(c.naW)}${c.via === 'net' ? ' naar het net' : ''}. Het werkt.`;
  const waarom = c.reden === 'te-veel' ? `hij leverde veel minder dan bedoeld (${van(c.naW)} bij ${c.pct ?? '?'}%)` : `hij bleef ${van(c.naW)} leveren (was ${van(c.voorW)})`;
  return `Werkt niet op deze omvormer, uitgezet${wanneer}: ${waarom}. Het programmaatje gaf hem vrij en stuurt hem niet meer tot je het opnieuw aanzet.`;
}

/**
 * Tijdens een blok, begrensd: de grens nu, wat hij levert, wat er naar het net gaat (of eruit
 * komt): "Grens nu 20% (~1,6 kW) · levert 1,2 kW · naar het net 0,1 kW". Anders null.
 * `netW`: plus = afnemen, min = terugleveren (zoals stand.net_w).
 */
export function liveRegel(s, { omvormerW = null, netW = null } = {}) {
  if (!s || s.stand !== 'begrensd' || s.pct === null) return null;
  const delen = [`Grens nu ${s.pct}%${s.grensW !== null ? ` (~${kw(s.grensW)})` : ''}`];
  if (Number.isFinite(omvormerW)) delen.push(`levert ${kw(omvormerW)}`);
  if (Number.isFinite(netW)) delen.push(netW <= -20 ? `naar het net ${kw(-netW)}` : netW >= 20 ? `uit het net ${kw(netW)}` : 'niets naar het net');
  return delen.join(' · ');
}

/** "Zoals de installateur hem achterliet: grens 2%, schakelaar uit." of null. */
export function oorspronkelijkZin(s) {
  const o = s?.oorspronkelijk;
  if (!o) return null;
  return `Zoals hij stond voor het programmaatje hem bediende: grens ${o.grensPct}%, schakelaar van de grens ${o.schakelaar ? 'aan' : 'uit'}${o.op ? ` (gelezen ${datumKort(o.op)})` : ''}.`;
}

/** Een fout in gewone woorden, of null. */
export function foutZin(s) {
  return (
    {
      begrenzen: 'Begrenzen lukte niet; het programmaatje gaf hem vrij en laat dit blok met rust.',
      vrijgeven: 'Vrijgeven lukte niet; het programmaatje probeert het over een paar minuten opnieuw.',
      rem: 'Het programmaatje wacht even: het schrijft hooguit een paar keer per uur naar de omvormer.',
    }[s?.fout] ?? null
  );
}

/** De blokken die er nog komen of nu lopen (op volgorde). */
export const blokkenVanaf = (s, nu) => (s?.blokken ?? []).filter((b) => b.tot > nu);

/** Het blok van nu, of null. */
export const blokNu = (s, nu) => (s?.blokken ?? []).find((b) => b.van <= nu && nu < b.tot) ?? null;

/**
 * Een wijziging zoals de functie hem doet (wijzig in base44/shared/omvormerSturen.js), maar op
 * dit toestel: voor het voorbeeld. Geeft de nieuwe ruwe instelling ({ aan, niet_op, vrij_op, netto }).
 */
export function wijzigLokaal(oud, w, nu = Date.now()) {
  const r = { aan: oud?.aan === true, niet_op: [...(oud?.niet_op ?? [])], vrij_op: oud?.vrij_op ?? null, netto: oud?.netto ?? 'afnemer' };
  if (typeof w?.aan === 'boolean') r.aan = w.aan;
  if (typeof w?.dag === 'string') r.niet_op = w.niet ? [...new Set([...r.niet_op, w.dag])].sort() : r.niet_op.filter((d) => d !== w.dag);
  if (w?.nu_aan === true) r.vrij_op = new Date(nu).toISOString();
  if (w?.netto === 'afnemer' || w?.netto === 'terugleveraar') r.netto = w.netto;
  return r;
}
