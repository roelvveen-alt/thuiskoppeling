import { Cloud, CloudDrizzle, CloudFog, CloudHail, CloudLightning, CloudMoon, CloudMoonRain, CloudRain, CloudSnow, CloudSun, CloudSunRain, Cloudy, Moon, Sun, Wind } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { isDag } from '@/lib/dagNacht';
import { useGelijk } from '@/lib/gelijk';
import { spotsAan } from '@/lib/lampen';
import { NIETS_W, STROOM_W } from '@/lib/nuInWoorden';
import { euro, procent, vermogen } from '@/lib/opmaak';
import { ringTekst, ringVoor } from '@/lib/ringen';
import { boog, boogLangs, dikteVoor, duurVoor, route, STIP_AFSTAND, stipBanen } from '@/lib/vorm';
import { weerBeeld, weerIcoon, weerZin } from '@/lib/weerBeeld';
import HuisTekening from './HuisTekening';
import { PuntIcoon } from './iconen';

/**
 * Rondjes: de vier vaste punten iets groter dan de apparaten, en allebei
 * minstens 44 px om op te tikken. Op een smalle foto (een telefoon) alles 44 px
 * en onder elk rondje alleen het getal; het plaatje zegt dan wat het is.
 */
const SMAL_ONDER_PX = 440;
const maatVan = (punt, smal) => (smal || punt.soort === 'apparaat' ? 44 : 48);
const binnen = (v) => Math.min(96, Math.max(4, v));

/** Kaartje boven het rondje als eronder geen plek is, of bij de zon (die staat bovenaan en stuurt naar beneden). */
const kaartjeBoven = (punt) => punt.soort === 'zon' || punt.y > 86;
/**
 * Bij de rand het kaartje naar binnen laten wijzen, anders valt het half van
 * de foto. Staat er vlak rechts naast (en niet links) een ander rondje op
 * dezelfde hoogte, dan het kaartje naar links laten uitlopen, en andersom:
 * zo valt "82% · laadt 2,4 kW" niet over het net.
 */
const kaartjeKant = (punt, anderen = []) => {
  if (punt.x < 15) return 'links';
  if (punt.x > 85) return 'rechts';
  const buur = (kant) => anderen.some((a) => a.sleutel !== punt.sleutel && Math.abs(a.y - punt.y) < 14 && kant * (a.x - punt.x) > 0 && Math.abs(a.x - punt.x) < 30);
  const rechts = buur(1);
  const links = buur(-1);
  if (rechts && !links) return 'rechts';
  if (links && !rechts) return 'links';
  return 'midden';
};

/** Wat er onder een rondje staat. De naam is die van het punt: een eigen naam uit de app, of die van thuis. */
export function kaartje(punt, stand, verdeling) {
  switch (punt.soort) {
    case 'zon': {
      // Alle plekken samen (zonSamen): hetzelfde totaal als de Zon-tegel op Nu.
      if (punt.plekken) return { naam: punt.naam, waarde: verdeling?.zon_w ?? stand?.zon_w ?? null };
      if (punt.sleutel === 'zon') return { naam: punt.naam, waarde: stand?.zon_w ?? null };
      const bron = stand?.zonnen?.find((z) => z.sleutel === punt.sleutel);
      return { naam: punt.naam, waarde: bron?.vermogen_w ?? null };
    }
    case 'batterij':
      return { naam: `${punt.naam} ${procent(stand?.batterij_procent)}`, waarde: stand?.batterij_w ?? null };
    case 'net':
      return { naam: punt.naam, waarde: stand?.net_w ?? null };
    case 'huis':
      // Zonder meting weten we niets: "–", niet "gebruikt 0 W".
      // Zonder de meter in de meterkast is het verbruik niet te weten: ook "–".
      return { naam: punt.naam, waarde: stand && stand.net_w != null ? verdeling.huis_w : null };
    default: {
      const apparaat = stand?.apparaten?.find((a) => a.sleutel === punt.sleutel);
      return { naam: punt.naam, waarde: apparaat?.vermogen_w ?? null };
    }
  }
}

/**
 * Het werkwoord bij het getal: wat het rondje nu doet. `kort` staat op de foto,
 * `lang` in het label voor een schermlezer. Dezelfde drempels als de lijnen en
 * de zinnen (5 W stroom, ±20 W bij het net); daaronder geen werkwoord.
 */
export function werkwoord(soort, waarde) {
  const w = waarde ?? 0;
  switch (soort) {
    case 'huis':
      return { kort: 'gebruikt', lang: 'gebruikt' };
    case 'zon':
      return w >= STROOM_W ? { kort: 'levert', lang: 'levert' } : null;
    case 'batterij':
      if (w <= -STROOM_W) return { kort: 'laadt', lang: 'laadt' };
      return w >= STROOM_W ? { kort: 'levert', lang: 'levert' } : null;
    case 'net':
      if (w >= NIETS_W) return { kort: 'neemt af', lang: 'neemt af' };
      return w <= -NIETS_W ? { kort: 'terug', lang: 'levert terug' } : null;
    default:
      return null;
  }
}

/**
 * De paden van de lijnen op de foto (w × h px), voor de punten zoals ze nu
 * staan (`plekVan`: tijdens het slepen de plek onder de vinger). Een lijn
 * buigt om de andere rondjes heen (boogLangs). Heeft het punt waar hij
 * begint een route naar het punt waar hij heen gaat (puntenVoor, alleen op
 * de beginplekken), dan loopt hij langs die route (route() in vorm.js),
 * behalve terwijl een van de twee versleept wordt of als de route dan door
 * een ander rondje zou gaan.
 */
/** Een knippad (evenodd): het hele vlak min de veelhoek, zodat wat erachter loopt verdwijnt. */
export function behalve(veelhoek, w, h) {
  const r = (v) => Math.round(v * 10) / 10;
  return `M0 0H${r(w)}V${r(h)}H0Z M${veelhoek.map((p) => `${r(p.x)} ${r(p.y)}`).join(' L')}Z`;
}

export function lijnPaden(stromen, zichtbaar, { w, h, smal, plekVan = (p) => p }) {
  if (!(w > 0)) return [];
  const opSleutel = Object.fromEntries(zichtbaar.map((p) => [p.sleutel, p]));
  const px = (plek) => ({ x: (plek.x / 100) * w, y: (plek.y / 100) * h });
  const opPlek = (p) => {
    const plek = plekVan(p);
    return plek.x === p.x && plek.y === p.y;
  };
  return stromen.flatMap((s) => {
    const van = opSleutel[s.van];
    const naar = opSleutel[s.naar];
    if (!van || !naar) return [];
    const a = plekVan(van);
    const b = plekVan(naar);
    // De andere rondjes, met hun ring (6 px rond): daar buigt de lijn omheen.
    const anderen = zichtbaar
      .filter((p) => p.sleutel !== van.sleutel && p.sleutel !== naar.sleutel)
      .map((p) => ({ ...px(plekVan(p)), straal: maatVan(p, smal) / 2 + 6 }));
    const opties = { straalA: maatVan(van, smal) / 2, straalB: maatVan(naar, smal) / 2 };
    const langs = van.route?.naar === naar.sleutel && opPlek(van) && opPlek(naar) ? van.route.langs.map(px) : null;
    const viaRoute = langs && route(px(a), langs, px(b), opties, anderen);
    const d = viaRoute || boogLangs(px(a), px(b), opties, anderen);
    if (!d) return [];
    // Een aanloop (in huis B: van achter het huis omhoog naar het rondje) alleen samen met de route.
    const aanloop = viaRoute && van.route.aanloop ? boog(px(van.route.aanloop), px(a), { straalA: 0, straalB: opties.straalA, buiging: 0.12 }) : null;
    // Wat achter het huis loopt, is niet te zien: `achter` (het dak, in procenten) verbergt dat stuk van de aanloop.
    const achter = van.route?.aanloop?.achter;
    const verberg = aanloop && Array.isArray(achter) && achter.length >= 3 ? achter.map(([x, y]) => px({ x, y })) : null;
    return [...(aanloop ? [{ ...s, d: aanloop, soort: van.soort, deel: 'aanloop', ...(verberg ? { verberg } : {}) }] : []), { ...s, d, soort: van.soort }];
  });
}

function useMaat(ref) {
  const [maat, setMaat] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const meet = () => setMaat({ w: el.clientWidth, h: el.clientHeight });
    meet();
    const kijker = new ResizeObserver(meet);
    kijker.observe(el);
    return () => kijker.disconnect();
  }, [ref]);
  return maat;
}

/**
 * Of de foto in beeld is (niet naar de kaarten gescrold). Zo niet, dan staat
 * alles erop stil: de animaties kosten een telefoon anders continu rekenwerk.
 */
function useInBeeld(ref) {
  const [inBeeld, setInBeeld] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const kijker = new IntersectionObserver(([e]) => setInBeeld(e.isIntersecting));
    kijker.observe(el);
    return () => kijker.disconnect();
  }, [ref]);
  return inBeeld;
}

/** Of het scherm zichtbaar is (niet een ander tabblad, de telefoon niet op slot). */
function useZichtbaar() {
  const [zichtbaar, setZichtbaar] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  useEffect(() => {
    const kijk = () => setZichtbaar(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', kijk);
    return () => document.removeEventListener('visibilitychange', kijk);
  }, []);
  return zichtbaar;
}

/** De systeeminstelling "minder beweging". */
function useMinderBeweging() {
  const vraag = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null);
  const [minder, setMinder] = useState(() => Boolean(vraag()?.matches));
  useEffect(() => {
    const mq = vraag();
    if (!mq?.addEventListener) return undefined;
    const kijk = () => setMinder(mq.matches);
    mq.addEventListener('change', kijk);
    return () => mq.removeEventListener('change', kijk);
  }, []);
  return minder;
}

/**
 * De stipjes op één lijn: losse rondjes die met een animatie op transform en
 * opacity langs het pad lopen (stipBanen in src/lib/vorm.js). Zo'n animatie
 * draait op de grafische kaart: de hoofddraad van de telefoon heeft er geen
 * werk aan (prestaties-9; een lopende stroke-dashoffset kostte elk beeldje
 * een nieuwe tekening van de hele foto).
 *
 * De ronde heeft een vaste duur (STIP_DUUR_S); harder of zachter gaat met de
 * afspeelsnelheid, zodat de stipjes bij een nieuwe meting niet verspringen.
 * Staat alles stil (`beweegt` false: uit beeld, blad erover, oude cijfers,
 * minder beweging), dan staan ze op hun beginplek, zonder animatie.
 */
const STIP_DUUR_S = 1.6;
function Stippen({ d, soort, dikte, duur, beweegt, knip = null }) {
  const banen = useMemo(() => stipBanen(d, STIP_AFSTAND), [d]);
  const laag = useRef(null);
  const animaties = useRef([]);
  const snelheid = STIP_DUUR_S / duur;
  const snelheidRef = useRef(snelheid);

  // Eerst de snelheid (ook voor de animaties hieronder, die hem bij het maken meekrijgen).
  useEffect(() => {
    snelheidRef.current = snelheid;
    if (!Number.isFinite(snelheid)) return;
    for (const a of animaties.current) if (a.playbackRate !== snelheid) a.updatePlaybackRate?.(snelheid);
  }, [snelheid]);

  useEffect(() => {
    const stippen = [...(laag.current?.children ?? [])];
    if (!beweegt || !stippen.length || typeof stippen[0].animate !== 'function') return undefined;
    animaties.current = stippen.map((el, i) => {
      const a = el.animate(
        banen[i].map((f) => ({ offset: f.offset, transform: `translate(${f.x}px, ${f.y}px)`, opacity: f.zicht })),
        { duration: STIP_DUUR_S * 1000, iterations: Infinity, easing: 'linear' },
      );
      if (Number.isFinite(snelheidRef.current)) a.playbackRate = snelheidRef.current;
      // Stoppen (cancel) wijst 'finished' af: dat is hier de bedoeling, geen fout.
      a.finished?.catch?.(() => {});
      return a;
    });
    return () => {
      for (const a of animaties.current) a.cancel();
      animaties.current = [];
    };
  }, [banen, beweegt]);

  return (
    <div
      ref={laag}
      className="stroom-stippen"
      data-duur={duur}
      style={{ '--kleur': `var(--foto-${soort})`, '--stip': `${dikte}px`, ...(knip ? { clipPath: `path(evenodd, '${knip}')` } : {}) }}
    >
      {banen.map((baan) => (
        <span key={`${baan[0].x},${baan[0].y}`} style={{ transform: `translate(${baan[0].x}px, ${baan[0].y}px)` }} />
      ))}
    </div>
  );
}

const WEER_ICONEN = { Cloud, CloudDrizzle, CloudFog, CloudHail, CloudLightning, CloudMoon, CloudMoonRain, CloudRain, CloudSnow, CloudSun, CloudSunRain, Cloudy, Moon, Sun, Wind };

/** Bij een eigen foto: het weer van nu als klein icoon linksonder (de tekening tekent het zelf). */
function WeerHoek({ beeld, dag }) {
  const Icoon = WEER_ICONEN[weerIcoon(beeld, dag)] ?? Cloud;
  const zin = weerZin(beeld);
  return (
    <span className="weer-hoek" role="img" aria-label={zin} title={zin} data-weer={beeld.code ?? 'bewolking'}>
      <Icoon size={18} strokeWidth={2} aria-hidden="true" />
    </span>
  );
}

/** Groen bij laden, oranje bij leveren, geel bij de zon (src/lib/ringen.js). */
const RING_KLEUR = { laden: 'var(--foto-batterij)', leveren: 'var(--foto-let-op)', stil: 'var(--foto-batterij)', zon: 'var(--foto-zon)' };

/**
 * De ring om een rondje, die meegroeit met wat het nu doet: bij de batterij
 * hoe hard hij laadt of levert, bij panelen wat ze leveren, tegen het maximum.
 */
function Ring({ ring }) {
  const omtrek = 2 * Math.PI * 27;
  return (
    <svg className="punt-ring" data-soort={ring.soort} viewBox="0 0 60 60" aria-hidden="true">
      <circle cx="30" cy="30" r="27" fill="none" stroke="var(--foto-ring-spoor)" strokeWidth="4" />
      {ring.deel > 0 && (
        <circle
          className="punt-ring-deel"
          cx="30"
          cy="30"
          r="27"
          fill="none"
          stroke={RING_KLEUR[ring.soort]}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${ring.deel * omtrek} ${omtrek}`}
        />
      )}
    </svg>
  );
}

/**
 * De foto (of tekening) van het huis met een rondje per meter en de stroom
 * ertussen. In de bewerkstand sleep je de rondjes naar hun plek; met een
 * toetsenbord kan het met de pijltjes (Shift voor grotere stappen).
 */
/** Rechtsboven op de foto: wat het net nu per uur kost of oplevert. */
function GeldBordje({ perUur }) {
  const soort = Math.abs(perUur) < 0.005 ? 'stil' : perUur > 0 ? 'betalen' : 'verdienen';
  const woord = { stil: 'Nu', betalen: 'Je betaalt nu', verdienen: 'Je verdient nu' }[soort];
  return (
    <div className="geldbordje" data-soort={soort}>
      <span className="geldbordje-woord">{woord}</span>
      <span className="geldbordje-bedrag">
        {euro(perUur)}
        <span className="geldbordje-per"> per uur</span>
      </span>
    </div>
  );
}

/**
 * `oud`: de cijfers zijn niet van nu (bijvoorbeeld "Stand van 14:02"). Dan
 * staan de stipjes stil, zijn lijnen en ringen gedimd, en staat dat
 * linksboven in plaats van het geldbordje.
 * `voorbeeld`: er kwam nog niets van thuis en dit zijn nepcijfers. Dan staat
 * dat linksboven, zodat ze niet op echte cijfers lijken.
 */
export default function HuisBeeld({ tekening, foto, punten, stand, verdeling, lijnen: stromen = [], bewerken, gekozen, onKies, onVerplaats, geld, oud = null, voorbeeld = false }) {
  const vlak = useRef(null);
  const { w, h } = useMaat(vlak);
  const [sleep, setSleep] = useState(null);
  const smal = w > 0 && w < SMAL_ONDER_PX;
  const inBeeld = useInBeeld(vlak);
  const schermZichtbaar = useZichtbaar();
  const minderBeweging = useMinderBeweging();
  // Uit beeld, het scherm weg, of het blad ligt erover: alles stil (index.css, data-rust).
  const rust = !inBeeld || !schermZichtbaar || (Boolean(gekozen) && !bewerken);
  const stippenLopen = !rust && !oud && !minderBeweging;
  // Het weer van nu (brug 0.9.0), op het moment van de stand; zonder weer (een oudere brug) of zonder moment null: dan zoals altijd.
  const moment = Date.parse(stand?.moment ?? '');
  // Zelfde weer als net: hetzelfde object, dan tekent de tekening (memo) niet opnieuw.
  const weer = useGelijk(Number.isFinite(moment) ? weerBeeld(stand?.weer, moment) : null);
  const dag = isDag(stand, verdeling);

  const zichtbaar = punten.filter((p) => p.zichtbaar);
  const plekVan = (p) => (sleep?.sleutel === p.sleutel ? sleep : p);
  const lijnen = lijnPaden(stromen, zichtbaar, { w, h, smal, plekVan });

  const plekUitWijzer = (e) => {
    const r = vlak.current.getBoundingClientRect();
    return { x: binnen(((e.clientX - r.left) / r.width) * 100), y: binnen(((e.clientY - r.top) / r.height) * 100) };
  };

  const pak = (e, punt) => {
    if (!bewerken) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setSleep({ sleutel: punt.sleutel, x: punt.x, y: punt.y });
  };
  const beweeg = (e) => {
    if (!sleep) return;
    const plek = plekUitWijzer(e);
    setSleep((s) => (s ? { ...s, ...plek } : s));
  };
  const laatLos = () => {
    if (!sleep) return;
    onVerplaats(sleep.sleutel, sleep.x, sleep.y);
    setSleep(null);
  };
  const toets = (e, punt) => {
    if (!bewerken) return;
    const stap = e.shiftKey ? 5 : 1;
    const richting = { ArrowLeft: [-stap, 0], ArrowRight: [stap, 0], ArrowUp: [0, -stap], ArrowDown: [0, stap] }[e.key];
    if (!richting) return;
    e.preventDefault();
    onVerplaats(punt.sleutel, punt.x + richting[0], punt.y + richting[1]);
  };

  return (
    <div
      ref={vlak}
      className="huisbeeld"
      data-bewerken={bewerken ? 'true' : 'false'}
      data-smal={smal ? 'true' : 'false'}
      data-oud={oud ? 'true' : 'false'}
      data-rust={rust ? 'true' : 'false'}
    >
      {foto ? (
        <img className="huisfoto" src={foto} alt="" draggable="false" />
      ) : (
        <HuisTekening soort={tekening} dag={dag} spots={spotsAan(stand?.lampen)} weer={weer} stil={rust || minderBeweging} />
      )}
      {foto && weer && !bewerken && <WeerHoek beeld={weer} dag={dag} />}
      {!foto && weer && <span className="sr-only">{weerZin(weer)}</span>}

      {voorbeeld && !bewerken && (
        <div className="geldbordje" data-soort="oud">
          <span className="geldbordje-woord">Voorbeeld</span>
          <span className="geldbordje-bedrag">Nepcijfers</span>
        </div>
      )}
      {!voorbeeld && oud && !bewerken && (
        <div className="geldbordje" data-soort="oud">
          <span className="geldbordje-woord">Geen live cijfers</span>
          <span className="geldbordje-bedrag">{oud}</span>
        </div>
      )}
      {!voorbeeld && !oud && geld != null && !bewerken && <GeldBordje perUur={geld} />}

      <svg className="stroomlaag" viewBox={`0 0 ${w || 1} ${h || 1}`} aria-hidden="true">
        <defs>
          {lijnen
            .filter((l) => l.verberg)
            .map((l) => (
              <clipPath key={`achter-${l.van}`} id={`achter-${l.van}`}>
                <path d={behalve(l.verberg, w, h)} clipRule="evenodd" />
              </clipPath>
            ))}
          {['zon', 'batterij', 'net', 'huis'].map((soort) => (
            <marker
              key={soort}
              id={`pijl-${soort}`}
              viewBox="0 0 10 10"
              refX="6"
              refY="5"
              markerWidth="4.5"
              markerHeight="4.5"
              markerUnits="strokeWidth"
              orient="auto"
            >
              <path d="M1 1 L8 5 L1 9 Z" style={{ fill: `var(--foto-${soort})` }} />
            </marker>
          ))}
        </defs>
        {lijnen.map((l) => (
          <g key={`${l.van}>${l.naar}${l.deel ?? ''}`} style={{ '--kleur': `var(--foto-${l.soort})` }} clipPath={l.verberg ? `url(#achter-${l.van})` : undefined}>
            <path d={l.d} className="stroom-onder" strokeWidth={dikteVoor(l.w) + 5} />
            <path d={l.d} className="stroom-spoor" strokeWidth={dikteVoor(l.w)} markerEnd={`url(#pijl-${l.soort})`} />
          </g>
        ))}
      </svg>
      <div className="stippenlaag" aria-hidden="true">
        {lijnen.map((l) => (
          <Stippen
            key={`${l.van}>${l.naar}${l.deel ?? ''}`}
            d={l.d}
            soort={l.soort}
            dikte={dikteVoor(l.w) + 3}
            duur={duurVoor(l.w)}
            beweegt={stippenLopen}
            knip={l.verberg ? behalve(l.verberg, w, h) : null}
          />
        ))}
      </div>

      {zichtbaar.map((punt) => {
        const { naam, waarde } = kaartje(punt, stand, verdeling);
        const plek = plekVan(punt);
        // Stil zoals de lijnen en de zinnen: het net binnen ±20 W, de zon als alle panelen samen onder 20 W blijven.
        const stil =
          punt.soort === 'net'
            ? !(Math.abs(waarde ?? 0) >= NIETS_W)
            : !(Math.abs(waarde ?? 0) >= STROOM_W) || (punt.soort === 'zon' && verdeling.zon_w < NIETS_W);
        const maat = maatVan(punt, smal);
        const ring = ringVoor(punt, waarde);
        const metRing = ring ? `, ${ringTekst(ring, punt.max_w)}` : '';
        const woord = waarde == null ? null : werkwoord(punt.soort, waarde);
        const getal = woord ? `${woord.kort} ${vermogen(waarde)}` : vermogen(waarde);
        return (
          <button
            key={punt.sleutel}
            type="button"
            className="punt"
            data-sleutel={punt.sleutel}
            data-soort={punt.soort}
            data-stil={stil ? 'true' : 'false'}
            data-gekozen={gekozen === punt.sleutel ? 'true' : 'false'}
            data-sleept={sleep?.sleutel === punt.sleutel ? 'true' : 'false'}
            data-boven={kaartjeBoven({ ...punt, ...plek }) ? 'true' : 'false'}
            data-kant={kaartjeKant({ ...punt, ...plek }, zichtbaar.map((p) => ({ ...p, ...plekVan(p) })))}
            style={{
              left: `${plek.x}%`,
              top: `${plek.y}%`,
              '--maat': `${maat}px`,
              '--kleur': `var(--foto-${punt.soort})`,
            }}
            aria-label={
              bewerken
                ? `${naam} verplaatsen; sleep, of gebruik de pijltjestoetsen`
                : `${naam}${woord ? ` ${woord.lang}` : ':'} ${vermogen(waarde)}${metRing}`
            }
            onClick={() => !bewerken && onKies(punt.sleutel)}
            onPointerDown={(e) => pak(e, punt)}
            onPointerMove={beweeg}
            onPointerUp={laatLos}
            onPointerCancel={laatLos}
            onKeyDown={(e) => toets(e, punt)}
          >
            {ring && <Ring ring={ring} />}
            <span className="punt-rond">
              <PuntIcoon
                punt={punt}
                procent={stand?.batterij_procent}
                size={punt.soort === 'apparaat' ? 20 : 22}
                strokeWidth={2}
              />
            </span>
            <span className="punt-kaartje">
              {!smal && <span className="punt-naam">{naam}</span>}
              <span className="punt-waarde">
                {smal && punt.soort === 'batterij' && `${procent(stand?.batterij_procent)} · `}
                {getal}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
