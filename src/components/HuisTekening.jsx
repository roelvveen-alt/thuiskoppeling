import { memo, useEffect, useId, useRef, useState } from 'react';

/**
 * Het getekende erf, staand (4:5). Welke tekening kies je in Instellingen ›
 * Indelen (`soort`); de beginplekken van de rondjes staan in src/lib/opstelling.js.
 *
 *   dierenverblijf  een twee-onder-een-kap (het dak loopt links door naar de
 *                   buren) met zwarte panelen die het dakvlak volgen, rechts
 *                   een carport met een lichte auto en een
 *                   buitenkastje, achter het huis (kleiner, verder weg,
 *                   deels erachter verscholen) het dierenverblijf met eigen
 *                   panelen, rechts aan de rand een kerktoren in de verte, en
 *                   voor het huis een tweede auto, van opzij
 *   garage          een vrijstaand huis met een steil pannendak, twee
 *                   dakkapellen en panelen links op het dak; links een losse
 *                   garage, rechts een houten carport, een haag en een vlaggenmast
 *   schuur          een gewoon huis met een stenen schuur (of garage) met panelen
 *   huis            een gewoon huis zonder bijgebouw: een grote boom en een haag
 *
 * De tekening rekent in eenheden van 0–100 breed en 0–125 hoog (een procent
 * hoogte = 1,25 eenheid). De rondjes liggen erbovenop en zijn groot (zo'n 13
 * eenheden breed op een telefoon): wat eronder valt, zie je niet. Daarom
 * liggen de panelen ruim om de beginplek van een zon-rondje heen, en staat er
 * onder de rondjes niets wat je moet kunnen zien.
 *
 * Wat meebeweegt met de cijfers:
 *   dag  de panelen leveren: zon, wolken en glans over de panelen;
 *        anders maan, sterren en licht achter de ramen
 *   spots  de spotjes in het overstek (programmaatje 0.8.0, Tuya-lampen; zie
 *        spotsAan in src/lib/lampen.js): true branden ze, false zijn ze donker,
 *        null (geen lampen) staan ze er niet, zoals vroeger. Stil licht, zonder
 *        filters of beweging.
 *   weer  het weer van nu (programmaatje 0.9.0, weerBeeld in src/lib/weerBeeld.js),
 *        of null (een oudere brug): dan zoals altijd. Wolken van geen tot een
 *        dichte grijze lucht (zon, maan en sterren erachter weg), vallende
 *        regen-, motregen-, sneeuw- of hagelstreepjes (twee paden die
 *        omlaag schuiven), bij onweer af en toe een flits, mist als een paar
 *        waasbanen, en bij harde wind of storm (data-wind)
 *        een snellere molen, snellere wolken en wiegende bomen. Weinig
 *        elementen en geen filters.
 * De molen draait altijd. Wie minder beweging wil (systeeminstelling), ziet
 * alles stilstaan (index.css); een flits is er dan nooit.
 *
 * De kleuren staan hier vast: de tekening schildert zijn eigen lucht en
 * grond, dus hij hoeft niet mee te wisselen met licht of donker. Herhalende
 * lijnen (voegen, naden, planken) zijn telkens één pad: zo blijft de tekening
 * licht, ook op een oude telefoon.
 */
const NACHT = {
  luchtBoven: '#081627',
  luchtOnder: '#1b3b5c',
  wolk: '#2a4766',
  heuvelVer: '#10263c',
  heuvel: '#0d2033',
  boom: '#0a1c22',
  boomDonker: '#08161b',
  boomLicht: '#0d2228',
  gras: '#0b1b29',
  grasRand: '#10263a',
  pad: '#1a2e44',
  gevel: '#4f322b',
  voeg: '#3d2621',
  baksteen: '#472823',
  baksteenVoeg: '#361e1a',
  baksteenRood: '#4c2722',
  baksteenRoodVoeg: '#3a1d19',
  donkereSteen: '#191c22',
  dak: '#161c25',
  dakLijn: '#0e131a',
  dakZwart: '#11151b',
  pannen: '#181d26',
  pannenLijn: '#10141b',
  zwartPaneel: { vlak: '#0f1c2e', rand: '#2b4566', cellen: false },
  blauwPaneel: { vlak: '#132944', rand: '#2c4c74', cellen: true },
  raam: '#f5c56c',
  kozijn: '#4b586a',
  dorpel: '#3a4150',
  wit: '#4b586a',
  deur: '#2a1b16',
  plank: '#2e1f1b',
  plankLijn: '#24170f',
  staldeur: '#22150f',
  hek: '#33465a',
  molen: '#16304a',
  wiek: '#21405f',
  molenWit: '#7189a3',
  molenRand: '#3c5168',
  haag: '#0c2421',
  haagLicht: '#123029',
  bloem: '#3b3f63',
  carport: '#0a0f16',
  carportDeur: '#070b10',
  paal: '#262c35',
  kastje: '#080b10',
  kastjeRooster: '#252d38',
  autoGlas: '#0a1119',
  koplamp: '#7c776a',
  band: '#06090d',
  kliko: '#17301f',
  klikoDeksel: '#122717',
  tuin: '#0f171d',
  plant: '#0e2522',
  bank: '#141a21',
  stoep: '#1a2838',
  stoepLijn: '#142130',
  oprit: '#131c27',
  opritLijn: '#0f1720',
  straat: '#1c2430',
  klinker: '#1c2735',
  klinkerLijn: '#16202c',
  garagedeur: '#151b23',
  garagedeurLijn: '#0e1319',
  dakkapel: '#465161',
  hout: '#4d3b28',
  houtDonker: '#3a2c1e',
  autoGrijs: '#1b1f26',
  achterlicht: '#5e1d1d',
  vlag: '#6e2b27',
  // Tekening dierenverblijf: de kerk aan de rand, de auto in de carport en de auto voor het huis.
  kerk: '#17293c',
  kerkDak: '#122135',
  kerkLicht: '#e9bd68',
  autoLicht: '#8a929c',
  autoLichtGlas: '#0a1119',
  autoLichtLamp: '#5b6470',
  autoOpzij: '#2f343b',
  autoOpzijDonker: '#1f2328',
  autoOpzijLicht: '#454b53',
  autoOpzijDak: '#05070a',
  autoOpzijGlas: '#16212d',
  remklauw: '#3a3f46',
  // De lampen van de auto's branden: ook 's nachts fel, zonder gloed-bol eromheen.
  lampAan: '#ffe6a3',
  // Tekening garage: een SUV en een kleine auto (zwart dak) voor de garage.
  autoSuv: '#2a2e34',
  autoSuvDonker: '#1a1d22',
  autoSuvGlas: '#16212d',
  autoKlein: '#3a3f46',
  autoKleinDak: '#05070a',
  achterlichtAan: '#ff3b2f',
  bekleding: '#07090c',
  velg: '#3a414c',
  nat: '#9db4cc',
  steenKap: '#3a4250',
  kip: '#c9c3b8',
  kipStaart: '#aaa497',
};

const DAG = {
  luchtBoven: '#5fa3dd',
  luchtOnder: '#cde6f7',
  wolk: '#ffffff',
  heuvelVer: '#b5d6a8',
  heuvel: '#8fc07c',
  boom: '#3f7a43',
  boomDonker: '#2f6436',
  boomLicht: '#4f8f4f',
  gras: '#79ad66',
  grasRand: '#8cc077',
  pad: '#d9cdb6',
  gevel: '#b0603f',
  voeg: '#934d33',
  baksteen: '#8e4836',
  baksteenVoeg: '#733829',
  baksteenRood: '#a34c3a',
  baksteenRoodVoeg: '#863b2c',
  donkereSteen: '#43474e',
  dak: '#3b4350',
  dakLijn: '#2c323c',
  dakZwart: '#2a2f37',
  pannen: '#4b5159',
  pannenLijn: '#3a3f47',
  zwartPaneel: { vlak: '#172131', rand: '#55667f', cellen: false },
  blauwPaneel: { vlak: '#22487a', rand: '#93b6df', cellen: true },
  raam: '#9ec0dc',
  kozijn: '#f6f3ed',
  dorpel: '#e4ddd0',
  wit: '#f4f1ea',
  deur: '#4f3226',
  plank: '#8a4a33',
  plankLijn: '#713a28',
  staldeur: '#5a3324',
  hek: '#f0e6d4',
  molen: '#7d8fa3',
  wiek: '#93a4b6',
  molenWit: '#fbfcfd',
  molenRand: '#aab8c6',
  haag: '#4b8746',
  haagLicht: '#62a052',
  bloem: '#f2b8c6',
  carport: '#373a41',
  carportDeur: '#25282e',
  paal: '#5b616b',
  kastje: '#1d2229',
  kastjeRooster: '#4d5663',
  autoGlas: '#26323f',
  koplamp: '#f3efe4',
  band: '#16191e',
  kliko: '#3f7a3c',
  klikoDeksel: '#346a31',
  tuin: '#6d5843',
  plant: '#5f8f48',
  bank: '#3c4048',
  stoep: '#cfbd9f',
  stoepLijn: '#b9a686',
  oprit: '#8f918c',
  opritLijn: '#7c7e7a',
  straat: '#a5695a',
  klinker: '#caa999',
  klinkerLijn: '#b59284',
  garagedeur: '#37414b',
  garagedeurLijn: '#2a323a',
  dakkapel: '#eee8dc',
  hout: '#c69357',
  houtDonker: '#a87a45',
  autoGrijs: '#4b4f56',
  achterlicht: '#d33a32',
  vlag: '#d9433a',
  kerk: '#a9b6c4',
  kerkDak: '#8998aa',
  kerkLicht: '#d7dfe7',
  autoLicht: '#d9dce0',
  autoLichtGlas: '#1c2733',
  autoLichtLamp: '#56606c',
  autoOpzij: '#5d636b',
  autoOpzijDonker: '#3f444b',
  autoOpzijLicht: '#7c838c',
  autoOpzijDak: '#111418',
  autoOpzijGlas: '#2d3e50',
  remklauw: '#7a7f86',
  lampAan: '#fff7dc',
  autoSuv: '#6b7178',
  autoSuvDonker: '#4a4f56',
  autoSuvGlas: '#2d3e50',
  autoKlein: '#8a8f96',
  autoKleinDak: '#15181c',
  achterlichtAan: '#ff3b30',
  bekleding: '#1d2026',
  velg: '#8d96a1',
  nat: '#e6f0f8',
  steenKap: '#d9d6cf',
  kip: '#fbf7f0',
  kipStaart: '#ece4d6',
};

const STERREN = [
  [6, 4, 0.35],
  [19, 30, 0.25],
  [28, 6, 0.3],
  [41, 13, 0.22],
  [52, 4, 0.28],
  [63, 15, 0.3],
  [72, 6, 0.24],
  [83, 24, 0.22],
  [94, 10, 0.3],
  [8, 38, 0.22],
  [96, 36, 0.2],
];

const r2 = (v) => Math.round(v * 100) / 100;

/** Een pad van evenwijdige lijnen: liggend (H) op elke y van x1 tot x2, of staand (V) op elke x van y1 tot y2. */
const liggend = (ys, x1, x2) => ys.map((y) => `M${x1} ${y}H${x2}`).join('');
const staand = (xs, y1, y2) => xs.map((x) => `M${x} ${y1}V${y2}`).join('');
const reeks = (van, tot, stap) => Array.from({ length: Math.floor((tot - van) / stap + 1e-9) + 1 }, (_, i) => r2(van + i * stap));

/**
 * Een raam met een wit kozijn en een vensterbank: overdag een glimp licht op
 * het glas, 's nachts licht erachter. `deling`: 'kruis' (vier ruitjes),
 * 'boven' (een bovenlicht) of 'geen'; een deur of dakkapel heeft geen bank.
 */
function Raam({ x, y, b, h, k, nacht, deling = 'kruis', bank = true }) {
  return (
    <g>
      {nacht && <rect x={x - 1.4} y={y - 1.4} width={b + 2.8} height={h + 2.8} rx="1.6" fill={k.raam} opacity="0.18" />}
      <rect x={x} y={y} width={b} height={h} fill={k.raam} stroke={k.kozijn} strokeWidth="0.8" />
      {!nacht && <path d={`M${r2(x + 0.6)} ${r2(y + h - 0.6)}L${r2(x + b * 0.45)} ${r2(y + 0.6)}`} stroke="#ffffff" strokeWidth="0.7" opacity="0.45" />}
      {deling === 'kruis' && (
        <path d={`M${r2(x + b / 2)} ${y}V${r2(y + h)}M${x} ${r2(y + h * 0.4)}H${r2(x + b)}`} stroke={k.kozijn} strokeWidth="0.7" />
      )}
      {deling === 'boven' && <path d={`M${x} ${r2(y + h * 0.28)}H${r2(x + b)}`} stroke={k.kozijn} strokeWidth="0.7" />}
      {bank && <rect x={r2(x - 0.7)} y={r2(y + h + 0.3)} width={r2(b + 1.4)} height="0.9" fill={k.dorpel} />}
    </g>
  );
}

/**
 * Een veld zonnepanelen: links-boven (x, y), kolommen × rijen van b × h, met
 * een smalle naad. Eén vlak met twee paden (naden en cellen) in plaats van
 * losse panelen, zodat het licht blijft.
 */
function Panelen({ x, y, kolommen, rijen, b, h, naad = 0.45, kleur }) {
  const breed = r2(kolommen * b + (kolommen - 1) * naad);
  const hoog = r2(rijen * h + (rijen - 1) * naad);
  const kolomX = Array.from({ length: kolommen }, (_, c) => x + c * (b + naad));
  const rijY = Array.from({ length: rijen }, (_, rij) => y + rij * (h + naad));
  const naden = staand(kolomX.slice(1).map((v) => r2(v - naad / 2)), y, r2(y + hoog)) + liggend(rijY.slice(1).map((v) => r2(v - naad / 2)), x, r2(x + breed));
  const cellen = staand(kolomX.map((v) => r2(v + b / 2)), y, r2(y + hoog)) + liggend(rijY.map((v) => r2(v + h / 2)), x, r2(x + breed));
  return (
    <g>
      <rect x={x} y={y} width={breed} height={hoog} rx="0.4" fill={kleur.vlak} stroke={kleur.rand} strokeWidth="0.35" />
      <rect x={x} y={y} width={breed} height={hoog} rx="0.4" fill="url(#paneelLucht)" />
      {kleur.cellen && <path d={cellen} stroke={kleur.rand} strokeWidth="0.16" opacity="0.5" />}
      <path d={naden} stroke={kleur.rand} strokeWidth={naad} />
    </g>
  );
}

/**
 * Een veld panelen dat meeloopt met een dakvlak: rijen evenwijdig aan nok en
 * goot, de rechterkant langs de schuine rand van het dak (van `rechtsBoven`
 * naar `rechtsOnder`), en de rijen bovenaan iets lager dan onderaan (verder
 * weg). Eén vlak en één pad met de naden, zoals Panelen.
 * @returns {{ d: string }}  de omtrek, voor de glans
 */
export function panelenVeld({ links, boven, onder, rechtsBoven, rechtsOnder, kolommen, rijen }) {
  const rechts = (y) => rechtsBoven + ((y - boven) / (onder - boven)) * (rechtsOnder - rechtsBoven);
  const xOp = (u, y) => r2(links + u * (rechts(y) - links));
  const gewicht = Array.from({ length: rijen }, (_, i) => 1 + 0.08 * (i - (rijen - 1) / 2));
  const som = gewicht.reduce((a, b) => a + b, 0);
  const rijY = [boven];
  for (const g of gewicht) rijY.push(r2(rijY.at(-1) + ((onder - boven) * g) / som));
  rijY[rijen] = onder;
  const d = `M${links} ${boven}H${r2(rechts(boven))}L${r2(rechts(onder))} ${onder}H${links}Z`;
  const kolomNaden = Array.from({ length: kolommen - 1 }, (_, c) => `M${xOp((c + 1) / kolommen, boven)} ${boven}L${xOp((c + 1) / kolommen, onder)} ${onder}`).join('');
  const rijNaden = rijY.slice(1, -1).map((y) => `M${links} ${y}H${r2(rechts(y))}`).join('');
  return { d, naden: kolomNaden + rijNaden, rijY };
}

function DakPanelen({ veld, kleur, naad = 0.45 }) {
  const { d, naden } = panelenVeld(veld);
  return (
    <g data-panelen="dak">
      <path d={d} fill={kleur.vlak} stroke={kleur.rand} strokeWidth="0.35" strokeLinejoin="round" />
      <path d={d} fill="url(#paneelLucht)" />
      <path d={naden} stroke={kleur.rand} strokeWidth={naad} />
    </g>
  );
}

/**
 * Een glimlicht dat over panelen schuift zolang ze leveren, alleen zichtbaar
 * binnen de vakken ({ x, y, b, h }). De schuine streep begint helemaal links
 * van de vakken (`van`) en eindigt er helemaal rechts van (index.css:
 * glans-huis schuift 72, glans-stal 48 eenheden).
 */
function Glans({ id, vakken, van, soort = 'huis', veld = null }) {
  const boven = Math.min(...vakken.map((v) => v.y));
  const onder = Math.max(...vakken.map((v) => v.y + v.h));
  return (
    <g>
      <defs>
        <clipPath id={id}>
          {veld ? (
            <path d={veld} />
          ) : (
            vakken.map((v) => <rect key={`${v.x}-${v.y}`} x={v.x} y={v.y} width={v.b} height={v.h} />)
          )}
        </clipPath>
      </defs>
      <g clipPath={`url(#${id})`}>
        <rect
          className={`glans glans-${soort}`}
          x={van}
          y={r2(boven - 4)}
          width="7"
          height={r2(onder - boven + 8)}
          fill="url(#glansStreep)"
          transform="skewX(-18)"
        />
      </g>
    </g>
  );
}

function Wolk({ x, y, schaal, kleur, className, dekking }) {
  return (
    <g className={className} opacity={dekking ?? (kleur === '#ffffff' ? 0.9 : 0.55)}>
      <g transform={`translate(${x} ${y}) scale(${schaal})`}>
        <ellipse cx="0" cy="3" rx="9" ry="3.2" fill={kleur} />
        <ellipse cx="-3.5" cy="1.4" rx="4.2" ry="3.4" fill={kleur} />
        <ellipse cx="2.6" cy="0.4" rx="5" ry="4.2" fill={kleur} />
      </g>
    </g>
  );
}

function Kip({ x, y, k, spiegel, schaal = 1 }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${spiegel ? -schaal : schaal} ${schaal})`}>
      <path d="M-0.5 1.2L-0.6 2.6M0.5 1.2L0.6 2.6" stroke="#e8a33d" strokeWidth="0.35" />
      <ellipse cx="0" cy="0" rx="2" ry="1.5" fill={k.kip} />
      <path d="M-2 -0.4 L-3 -1.6 L-2.6 0.2 Z" fill={k.kipStaart} />
      <circle cx="1.7" cy="-1.2" r="0.95" fill={k.kip} />
      <path d="M1.3 -2.1 Q1.7 -2.8 2.1 -2.1 Z" fill="#d6463b" />
      <path d="M2.6 -1.3 L3.3 -1.05 L2.6 -0.85 Z" fill="#e8a33d" />
      <circle cx="1.95" cy="-1.35" r="0.16" fill="#1b1b1b" />
    </g>
  );
}

/** Wolkenkleuren bij een dichte lucht en bij onweer (of zware neerslag): grijs, niet wit. */
const GRIJS = {
  dag: { wolk: '#d3dae2', donker: '#8d99a7', waas: '#9aa7b5', waasDonker: '#56626f' },
  // 's Nachts lichter grijsblauw dan de lucht, anders zie je een dichte lucht niet ("87% bewolkt maar weinig wolken").
  nacht: { wolk: '#5b7592', donker: '#3d5168', waas: '#2a3d52', waasDonker: '#141f2c' },
};

/**
 * De lucht: overdag de zon en witte wolken, 's nachts de maan, sterren en
 * donkere wolken. Met het weer van nu (weer, of null zoals vroeger): geen tot
 * veel wolken, een grijze waas over de lucht en zon, maan en sterren weg
 * achter de wolken.
 */
function Lucht({ k, nacht, weer = null }) {
  const wolken = weer ? weer.wolken : 2;
  const dicht = wolken >= 3 || Boolean(weer?.mist);
  const donker = Boolean(weer?.onweer) || (dicht && Boolean(weer?.zwaar));
  const grijs = GRIJS[nacht ? 'nacht' : 'dag'];
  const kleur = dicht ? (donker ? grijs.donker : grijs.wolk) : k.wolk;
  const dekking = dicht ? 0.95 : undefined;
  const sterren = nacht && (!weer || (wolken <= 1 && !weer.mist));
  return (
    <g>
      <rect x="0" y="0" width="100" height="125" fill="url(#lucht)" />
      {sterren &&
        STERREN.map(([x, y, r], i) => (
          <circle key={`${x}-${y}`} className="ster" data-lus="twinkel" data-lus-duur="3500" data-lus-vertraging={Math.round(((i * 0.7) % 3.5) * 1000)} cx={x} cy={y} r={r} fill="#d6e6ff" />
        ))}
      {dicht ? null : nacht ? (
        <g opacity={wolken === 2 && weer ? 0.6 : undefined}>
          <circle cx="16" cy="14" r="8" fill="url(#raamGloed)" opacity="0.5" />
          <circle cx="16" cy="14" r="4.6" fill="#e9eff6" />
          <circle cx="18.2" cy="12.6" r="4.2" fill={k.luchtBoven} />
        </g>
      ) : (
        <g opacity={wolken === 2 && weer ? 0.6 : undefined}>
          <circle cx="16" cy="14" r="12" fill="url(#zonGloed)" />
          <circle cx="16" cy="14" r="5" fill="#ffd257" />
        </g>
      )}
      {dicht && <rect data-weer-waas="" x="0" y="0" width="100" height="105" fill={donker ? grijs.waasDonker : grijs.waas} opacity={donker ? 0.5 : nacht ? 0.55 : 0.45} />}
      {wolken >= 2 && <Wolk className="wolk wolk-a" x={60} y={9} schaal={1} kleur={kleur} dekking={dekking} />}
      {wolken >= 1 && <Wolk className="wolk wolk-b" x={30} y={25} schaal={0.75} kleur={kleur} dekking={dekking} />}
      {wolken >= 1 && <Wolk className="wolk wolk-c" x={80} y={33} schaal={0.6} kleur={kleur} dekking={dekking} />}
      {/* Met het weer erbij duidelijker: licht bewolkt drie wolken, half bewolkt vijf, dicht negen. */}
      {weer && wolken >= 1 && <Wolk className="wolk wolk-a" x={8} y={40} schaal={0.55} kleur={kleur} dekking={dekking} />}
      {weer && wolken >= 2 && <Wolk className="wolk wolk-c" x={40} y={13} schaal={0.85} kleur={kleur} dekking={dekking} />}
      {dicht && <Wolk className="wolk wolk-d" x={20} y={8} schaal={1.4} kleur={kleur} dekking={dekking} />}
      {dicht && <Wolk className="wolk wolk-e" x={78} y={18} schaal={1.2} kleur={donker ? grijs.wolk : kleur} dekking={dekking} />}
      {dicht && <Wolk className="wolk wolk-b" x={46} y={20} schaal={1.1} kleur={kleur} dekking={dekking} />}
      {dicht && <Wolk className="wolk wolk-c" x={6} y={30} schaal={0.9} kleur={kleur} dekking={dekking} />}
      {dicht && <Wolk className="wolk wolk-e" x={62} y={30} schaal={1} kleur={kleur} dekking={dekking} />}
    </g>
  );
}

/** Een vast, verspreid rijtje plekken (geen toeval: elke keer dezelfde tekening). */
const plekken = (aantal) => Array.from({ length: aantal }, (_, i) => [r2(((i * 37.3) % 120) - 10), r2((i * 53.7) % 125)]);

/** Per soort neerslag: hoeveel, hoe lang een streepje, hoe dik, welke kleur (dag/nacht), en hoe schuin bij wind. */
const NEERSLAG = {
  regen: { aantal: 42, lang: 3.4, dik: 0.32, dag: '#3f5a78', nacht: '#9db4cc', dekking: 0.5, duur: 900, zwaarDuur: 700 },
  motregen: { aantal: 34, lang: 1.4, dik: 0.22, dag: '#4f6884', nacht: '#9db4cc', dekking: 0.4, duur: 1800 },
  sneeuw: { aantal: 46, lang: 0, dik: 0.9, dag: '#ffffff', nacht: '#e6eef7', dekking: 0.9, duur: 11000 },
  hagel: { aantal: 36, lang: 0, dik: 1.1, dag: '#eef3f8', nacht: '#dfe8f2', dekking: 0.9, duur: 800 },
};

/**
 * Wat er valt: één pad met alle streepjes (of bolletjes bij sneeuw en hagel),
 * twee keer onder elkaar, en dat schuift in een lus omlaag (LUSSEN.vallen).
 * Bij wind schuin.
 */
function Neerslag({ weer, nacht }) {
  const soort = NEERSLAG[weer.valt];
  if (!soort) return null;
  // Dichter dan eerst (weer duidelijker op de tekening), zwaar nog eens 1,6 keer.
  const aantal = Math.round(soort.aantal * 1.3 * (weer.zwaar ? 1.6 : 1));
  const schuin = weer.wind === 'storm' ? 0.5 : weer.wind === 'stevig' ? 0.3 : 0.12;
  const d = plekken(aantal)
    .map(([x, y]) => (soort.lang ? `M${x} ${y}l${r2(-schuin * soort.lang)} ${soort.lang}` : `M${x} ${y}h0`))
    .join('');
  // Over 125 eenheden omlaag schuift het ook zoveel opzij: de kopie erboven staat daar al.
  const opzij = soort.lang ? r2(-schuin * 125) : 0;
  return (
    <g
      className="neerslag"
      data-valt={weer.valt}
      data-zwaar={weer.zwaar ? 'true' : 'false'}
      data-lus="vallen"
      data-lus-duur={weer.zwaar && soort.zwaarDuur ? soort.zwaarDuur : soort.duur}
      data-opzij={opzij}
      stroke={nacht ? soort.nacht : soort.dag}
      strokeWidth={soort.dik}
      strokeLinecap="round"
      opacity={soort.dekking}
      fill="none"
    >
      <path d={d} />
      <path d={d} transform={`translate(${-opzij} -125)`} />
    </g>
  );
}

/**
 * Het weer vóór het erf: wat er valt, mist als een paar waasbanen, en bij onweer af en toe een flits met een bliksem (index.css:
 * de flits staat stil, en dus uit, bij minder beweging).
 */
/** Waar de grond begint op elke tekening (stoep, gras, klinkers): daar komen plassen of sneeuw. */
const GROND_Y = 104;

/**
 * Nat na regen: een glans over de stoep en de straat, een paar plassen met een
 * lichte rand. Stil (geen animatie): duidelijk zonder rekenwerk.
 */
function NatteGrond({ k }) {
  return (
    <g data-weer-nat="" fill="none" stroke={k.nat} strokeLinecap="round">
      <rect x="-1" y={GROND_Y} width="102" height={125 - GROND_Y} fill={k.nat} stroke="none" opacity="0.1" />
      <path d="M4 112.6h9M22 116.4h12M48 111.2h7M63 118.4h14M84 113.4h10M10 121h8M40 122.6h11" strokeWidth="0.35" opacity="0.55" />
      {[
        [17, 114.2, 4.6],
        [55, 119.6, 5.4],
        [88, 116.6, 4],
      ].map(([x, y, rx]) => (
        <ellipse key={x} cx={x} cy={y} rx={rx} ry={r2(rx * 0.22)} fill={k.nat} fillOpacity="0.22" strokeWidth="0.25" opacity="0.8" />
      ))}
    </g>
  );
}

/** Sneeuw op de grond: een witte laag met een golvende bovenrand. */
function Sneeuwdek({ nacht }) {
  return (
    <g data-weer-sneeuw="">
      <path
        d={`M-1 ${GROND_Y + 1} Q8 ${GROND_Y - 0.6} 17 ${GROND_Y + 0.8} T35 ${GROND_Y + 0.6} T53 ${GROND_Y + 0.9} T71 ${GROND_Y + 0.5} T89 ${GROND_Y + 0.8} T101 ${GROND_Y + 0.6} V125 H-1 Z`}
        fill={nacht ? '#c9d6e4' : '#ffffff'}
        opacity={nacht ? 0.35 : 0.55}
      />
    </g>
  );
}

/** Wind (stevig of storm): een paar witte strepen die door de lucht waaien (LUSSEN.waai). */
const WINDSTREPEN = [
  [10, 0, 14],
  [30, 900, 10],
  [52, 1700, 16],
  [22, 2400, 9],
];
function WindStrepen({ wind, nacht }) {
  const duur = wind === 'storm' ? 1700 : 2800;
  return (
    <g data-weer-wind={wind} stroke={nacht ? '#9db4cc' : '#ffffff'} strokeWidth="0.45" strokeLinecap="round" fill="none">
      {WINDSTREPEN.map(([y, vertraging, lang]) => (
        <path
          key={y}
          d={`M${r2(8 + y * 1.3)} ${y} q${r2(lang / 2)} -1.6 ${lang} 0 t${r2(lang * 0.6)} 0`}
          opacity="0.45"
          data-lus="waai"
          data-lus-duur={duur}
          data-lus-vertraging={-Math.round((vertraging * duur) / 2800)}
        />
      ))}
    </g>
  );
}

function WeerVoor({ weer, nacht, k }) {
  const nat = weer.valt === 'regen' || weer.valt === 'motregen' || weer.valt === 'hagel';
  return (
    <g data-weer-voor="">
      {weer.valt === 'sneeuw' && <Sneeuwdek nacht={nacht} />}
      {nat && <NatteGrond k={k} />}
      {weer.mist && (
        // Mist hangt laag: de dichtste banen over de grond, een lichtere erboven.
        <g className="mist" fill="url(#mistBaan)">
          <rect x="-10" y="96" width="120" height="30" />
          <rect x="-10" y="82" width="120" height="22" />
          <rect x="-10" y="68" width="120" height="16" opacity="0.6" />
        </g>
      )}
      {weer.wind && <WindStrepen wind={weer.wind} nacht={nacht} />}
      {weer.valt && <Neerslag weer={weer} nacht={nacht} />}
      {weer.onweer && (
        <g>
          <rect className="flits" x="0" y="0" width="100" height="125" fill="#ffffff" opacity="0" />
          <path className="bliksem" d="M47 8 L42.5 20 L46.5 20 L41 33 L51 17.5 L46.8 17.5 L50.5 8 Z" fill="#fff4c2" opacity="0" />
        </g>
      )}
    </g>
  );
}

/**
 * Een rijtje spotjes onder het overstek, op hoogte y (de onderkant van de
 * goot). Aan: een warm puntje met een zachte bundel naar beneden langs de
 * gevel (één verloop, geen filter); uit: alleen het donkere armatuurtje.
 */
function Spotjes({ xs, y, aan }) {
  return (
    <g data-spots={aan ? 'aan' : 'uit'}>
      {aan && <path d={xs.map((x) => `M${r2(x - 0.7)} ${r2(y + 0.5)} L${r2(x - 3.4)} ${r2(y + 9)} L${r2(x + 3.4)} ${r2(y + 9)} L${r2(x + 0.7)} ${r2(y + 0.5)} Z`).join('')} fill="url(#spotBundel)" />}
      {xs.map((x) => (
        <g key={x}>
          <rect x={r2(x - 0.8)} y={r2(y - 0.1)} width="1.6" height="0.7" rx="0.3" fill="#20252d" />
          <circle cx={x} cy={r2(y + 0.6)} r={aan ? 0.55 : 0.4} fill={aan ? '#ffe7b0' : '#3a414c'} />
        </g>
      ))}
    </g>
  );
}

// ---- dierenverblijf: de twee-onder-een-kap met carport en dierenverblijf ----

/**
 * Een kerktoren in de verte, net rechts in beeld (deels buiten de rand): een
 * eenvoudig silhouet met een spits, een galmgat en een klok. Wazig licht
 * overdag; 's nachts donker met een verlichte klok.
 */
function Kerk({ k }) {
  return (
    <g data-kerk="">
      <rect x="94.6" y="40.5" width="8.6" height="26" fill={k.kerk} />
      <path d="M94 41 L98.9 21.6 L103.8 41 Z" fill={k.kerkDak} />
      <path d="M98.9 18.4 V21.8 M97.9 19.5 H99.9" stroke={k.kerkDak} strokeWidth="0.45" />
      <rect x="97.7" y="45" width="2.4" height="4.4" rx="1.2" fill={k.kerkDak} />
      <circle cx="98.9" cy="53.4" r="1.45" fill={k.kerkLicht} />
      <path d="M98.9 52.5 V53.4 H99.6" stroke={k.kerkDak} strokeWidth="0.25" fill="none" />
    </g>
  );
}

/**
 * Het panelenveld op het dierenverblijf: 5 × 2 kleine panelen, verder weg
 * dan die op het huis. Het rondje "Zon dierenverblijf" staat links erop
 * (DIERENVERBLIJF_PLEK in src/lib/opstelling.js), zodat rechts ervan
 * drie kolommen panelen in beeld blijven.
 */
export const DAK_DIERENVERBLIJF = { x: 65, y: 58.4, kolommen: 5, rijen: 2, b: 4, h: 4, naad: 0.4 };

/**
 * Achter het huis, verder weg en dus kleiner: het dierenverblijf (meer in
 * verhouding achter het huis). Links verdwijnt het
 * achter het huis, onderaan achter een haag en de carport; je ziet zijn dak
 * met eigen panelen, een strook planken met een raampje en een boom erachter.
 * De lijn van zijn panelen loopt langs de goot van het huis naar de meterkast
 * (de route bij DIERENVERBLIJF_PLEK).
 */
function DierenverblijfAchter({ k, dag, nacht }) {
  const v = DAK_DIERENVERBLIJF;
  const breed = r2(v.kolommen * v.b + (v.kolommen - 1) * v.naad);
  const hoog = r2(v.rijen * v.h + (v.rijen - 1) * v.naad);
  return (
    <g data-dierenverblijf="">
      <ellipse className="boom-wieg" cx="84.5" cy="57.6" rx="5.4" ry="6.6" fill={k.boom} />
      <rect x="58" y="67.6" width="31" height="8.4" fill={k.plank} />
      <path d={staand(reeks(66, 88, 2), 69.4, 76)} stroke={k.plankLijn} strokeWidth="0.25" opacity="0.8" />
      <rect x="81.6" y="70" width="2.8" height="1.9" fill={nacht ? '#f0a85a' : '#2a1a12'} opacity={nacht ? 0.85 : 1} />
      <path d="M57 68.6 L89.4 68.6 L89.4 57.4 L61 57.4 Z" fill={k.dak} />
      <line x1="61" y1="57.4" x2="89.4" y2="57.4" stroke={k.dakLijn} strokeWidth="0.7" />
      <Panelen x={v.x} y={v.y} kolommen={v.kolommen} rijen={v.rijen} b={v.b} h={v.h} naad={v.naad} kleur={k.zwartPaneel} />
      {dag && <Glans id="panelenStal" vakken={[{ x: v.x, y: v.y, b: breed, h: hoog }]} van={76.5} soort="stal" />}
      <rect x="56.6" y="68" width="33.4" height="1.1" rx="0.3" fill={k.dakLijn} />
      <path
        className="haag-wieg"
        d="M60 76.4 Q62.4 74.2 64.8 75.6 Q67.4 73.8 70 75.3 Q72.6 73.6 75.2 75.1 Q77.8 73.5 80.4 75 Q83 73.6 85.6 75.1 Q88.2 73.7 90.8 75.2 Q93.4 73.9 96 75.3 Q98.6 74.1 101 75.5 V84 H60 Z"
        fill={k.boom}
      />
    </g>
  );
}

/**
 * Een lichte auto in de carport, van voren (zonder kenteken): laag en breed,
 * een glazen dak, een gladde neus, smalle schuine koplampen en onderin een
 * smalle luchtinlaat, de wielen in de hoeken onder de spatborden.
 * Kleur: k.autoLicht.
 */
function AutoInCarport({ k }) {
  return (
    <g data-auto="carport">
      <ellipse cx="81" cy="104.2" rx="11" ry="0.6" fill={k.bekleding} opacity="0.35" />
      <rect x="70.7" y="99.4" width="3.3" height="4.8" rx="0.9" fill={k.band} />
      <rect x="88" y="99.4" width="3.3" height="4.8" rx="0.9" fill={k.band} />
      <path d="M74.3 95.2 L76.4 90.6 Q81 89.4 85.6 90.6 L87.7 95.2 Z" fill={k.autoLichtGlas} />
      <path d="M77 90.9 Q81 90.1 85 90.9" stroke={k.autoLicht} strokeWidth="0.25" fill="none" opacity="0.35" />
      <path
        d="M70.9 101.9 Q70.5 99.4 70.8 97.7 Q71.1 95.5 73.4 95 Q77 94.6 81 95.3 Q85 94.6 88.6 95 Q90.9 95.5 91.2 97.7 Q91.5 99.4 91.1 101.9 Q81 102.9 70.9 101.9 Z"
        fill={k.autoLicht}
      />
      <path d="M72.2 94.4 H70.6 Q70.3 95.3 70.9 95.7 H72.7 Z M89.8 94.4 H91.4 Q91.7 95.3 91.1 95.7 H89.3 Z" fill={k.autoLicht} />
      <path d="M71.1 96.2 Q73.6 96 76.9 97.2 L76.1 98.4 Q73.2 98.1 71.1 97.8 Z M90.9 96.2 Q88.4 96 85.1 97.2 L85.9 98.4 Q88.8 98.1 90.9 97.8 Z" fill={k.autoLichtLamp} />
      <path d="M71.4 96.5 Q73.6 96.4 76.4 97.3 L76.1 97.7 Q73.4 97.1 71.4 97 Z M90.6 96.5 Q88.4 96.4 85.6 97.3 L85.9 97.7 Q88.6 97.1 90.6 97 Z" fill={k.lampAan} />
      <circle cx="81" cy="96.7" r="0.3" fill={k.autoLichtLamp} />
      <path d="M76.6 100.4 Q81 100.9 85.4 100.4 L85.1 101.2 Q81 101.6 76.9 101.2 Z" fill={k.bekleding} opacity="0.85" />
      <ellipse cx="73.4" cy="100.3" rx="1" ry="0.45" fill={k.bekleding} opacity="0.6" />
      <ellipse cx="88.6" cy="100.3" rx="1" ry="0.45" fill={k.bekleding} opacity="0.6" />
    </g>
  );
}

/**
 * Een auto voor het huis, van opzij (de neus links): een elektrische SUV, dus
 * hoog op de wielen met een hoge motorkap en een rechtere voorruit, grote
 * wielen, iets groter omdat hij vooraan staat. Een zwart dak en zwarte
 * stijlen met een smalle ruitenband die naar achteren oploopt, een aflopend
 * dak, een hoge stompe neus met een smalle koplamp, zwarte wielkasten en
 * dorpel, velgen met dubbele spaken en achterlichten die om de hoek lopen.
 * Kleuren: k.autoOpzij, k.autoOpzijLicht, k.autoOpzijDonker, k.autoOpzijDak,
 * k.autoOpzijGlas.
 */
function AutoOpzij({ k }) {
  return (
    <g data-auto="opzij" transform="translate(0 -2)">
      <ellipse cx="24.03" cy="123.15" rx="21.25" ry="0.9" fill={k.bekleding} opacity="0.35" />
      <path d="M 4.94 119.69 Q 4.00 119.43 4.13 117.05 Q 4.21 114.84 5.28 114.33 L 7.23 113.91 Q 12.50 113.39 17.77 112.67 L 23.80 108.38 Q 26.53 107.70 29.93 107.70 Q 37.15 107.95 41.23 110.00 Q 42.76 110.33 43.99 110.59 L 44.08 112.97 Q 44.21 115.78 43.99 117.73 Q 43.87 119.43 43.10 119.69 Z" fill={k.autoOpzij} />
      <path d="M 27.38 112.89 Q 37.58 112.20 42.93 112.25 Q 37.83 112.67 27.38 112.89 Z" fill={k.autoOpzijLicht} opacity="0.55" />
      <path d="M 7.57 114.16 Q 21.00 113.48 27.38 113.06 Q 36.73 112.46 43.27 112.46" stroke={k.autoOpzijDonker} strokeWidth="0.2" fill="none" opacity="0.6" />
      <path d="M 15.73 116.54 Q 24.40 116.80 32.90 116.03" stroke={k.autoOpzijDonker} strokeWidth="0.2" fill="none" opacity="0.55" />
      <path d="M 19.13 112.67 Q 18.79 116.20 19.39 119.43 M 29.50 111.99 L 29.50 119.43 M 36.47 111.57 Q 36.64 115.69 33.92 117.39" stroke={k.autoOpzijDonker} strokeWidth="0.14" fill="none" opacity="0.5" />
      <path d="M 17.77 112.67 L 23.80 108.38 Q 26.53 107.70 29.93 107.70 Q 37.15 107.95 41.23 110.00 L 39.53 111.27 Q 28.65 112.03 17.77 112.67 Z" fill={k.autoOpzijDak} />
      <path d="M 19.47 112.38 L 24.15 108.89 Q 26.78 108.21 29.93 108.19 Q 34.77 108.38 38.51 110.08 L 38.09 111.14 Q 28.65 111.82 19.47 112.38 Z" fill={k.autoOpzijGlas} />
      <path d="M 29.50 111.95 L 29.50 108.17" stroke={k.autoOpzijDak} strokeWidth="0.8" />
      <path d="M 18.88 112.50 L 20.41 112.38 L 20.58 111.69 Q 19.47 111.53 18.79 111.99 Z" fill={k.autoOpzijDak} />
      <path d="M 4.94 119.69 Q 4.17 119.43 4.15 118.16 L 6.89 118.33 L 7.74 119.69 Z" fill={k.bekleding} opacity="0.85" />
      <path d="M 40.38 119.69 L 43.10 119.69 Q 43.87 119.43 43.99 118.07 L 40.80 118.24 Z" fill={k.bekleding} opacity="0.85" />
      <path d="M 15.05 119.26 L 33.41 119.26 L 33.41 120.45 L 15.05 120.58 Z" fill={k.bekleding} />
      <circle cx="11.65" cy="119.69" r="3.83" fill={k.bekleding} />
      <circle cx="11.65" cy="119.69" r="3.23" fill={k.band} />
      <circle cx="11.65" cy="119.69" r="3.13" fill="none" stroke={k.velg} strokeWidth="0.1" opacity="0.4" />
      <circle cx="11.65" cy="119.69" r="2.85" fill={k.velg} />
      <circle cx="11.65" cy="119.69" r="2.69" fill={k.bekleding} />
      <path d="M 9.12 119.33 A 2.55 2.55 0 0 1 10.86 117.26 L 11.23 118.39 A 1.36 1.36 0 0 0 10.30 119.50 Z" fill={k.remklauw} />
      <path d="M 11.63 119.02 L 11.51 119.04 L 10.82 117.13 L 11.49 117.00 Z M 11.67 119.02 L 11.79 119.04 L 12.48 117.13 L 11.81 117.00 Z M 12.27 119.46 L 12.22 119.35 L 13.82 118.11 L 14.15 118.70 Z M 12.29 119.50 L 12.31 119.62 L 14.34 119.69 L 14.25 119.01 Z M 12.06 120.21 L 12.14 120.13 L 13.82 121.26 L 13.36 121.76 Z M 12.02 120.23 L 11.92 120.29 L 12.48 122.24 L 13.09 121.95 Z M 11.28 120.23 L 11.38 120.29 L 10.82 122.24 L 10.21 121.95 Z M 11.24 120.21 L 11.16 120.13 L 9.48 121.26 L 9.94 121.76 Z M 11.01 119.50 L 10.99 119.62 L 8.96 119.69 L 9.05 119.01 Z M 11.03 119.46 L 11.08 119.35 L 9.48 118.11 L 9.15 118.70 Z" fill={k.velg} />
      <circle cx="11.65" cy="119.69" r="0.76" fill={k.velg} />
      <circle cx="11.65" cy="119.69" r="0.36" fill={k.bekleding} />
      <circle cx="37.01" cy="119.69" r="3.83" fill={k.bekleding} />
      <circle cx="37.01" cy="119.69" r="3.23" fill={k.band} />
      <circle cx="37.01" cy="119.69" r="3.13" fill="none" stroke={k.velg} strokeWidth="0.1" opacity="0.4" />
      <circle cx="37.01" cy="119.69" r="2.85" fill={k.velg} />
      <circle cx="37.01" cy="119.69" r="2.69" fill={k.bekleding} />
      <path d="M 36.99 119.02 L 36.88 119.04 L 36.18 117.13 L 36.85 117.00 Z M 37.04 119.02 L 37.15 119.04 L 37.84 117.13 L 37.18 117.00 Z M 37.64 119.46 L 37.59 119.35 L 39.19 118.11 L 39.51 118.70 Z M 37.65 119.50 L 37.67 119.62 L 39.70 119.69 L 39.61 119.01 Z M 37.42 120.21 L 37.51 120.13 L 39.19 121.26 L 38.72 121.76 Z M 37.38 120.23 L 37.28 120.29 L 37.84 122.24 L 38.46 121.95 Z M 36.64 120.23 L 36.74 120.29 L 36.18 122.24 L 35.57 121.95 Z M 36.61 120.21 L 36.52 120.13 L 34.84 121.26 L 35.31 121.76 Z M 36.38 119.50 L 36.35 119.62 L 34.33 119.69 L 34.41 119.01 Z M 36.39 119.46 L 36.44 119.35 L 34.84 118.11 L 34.51 118.70 Z" fill={k.velg} />
      <circle cx="37.01" cy="119.69" r="0.76" fill={k.velg} />
      <circle cx="37.01" cy="119.69" r="0.36" fill={k.bekleding} />
      <path d="M 4.51 114.84 L 8.08 114.41 L 8.42 114.71 L 4.68 115.31 Z" fill={k.lampAan} />
      <path d="M 42.59 110.93 L 43.98 110.80 L 44.07 111.61 L 42.76 111.57 Z" fill={k.achterlichtAan} />
    </g>
  );
}

/**
 * Rechts naast het huis: de carport met een plat dak en een wit boeideel, het
 * zwarte buitenkastje erop, de auto erin en achterin een deur met een lamp.
 * De achterkant is dicht (geen ren, hek of kip). De deur heeft een wit kozijn, twee vakken en een klink, zodat hij niet
 * op een zonnepaneel lijkt.
 */
function Carport({ k, nacht }) {
  return (
    <g>
      <rect x="61" y="85" width="37" height="19" fill={k.carport} />
      <rect x="63" y="88.2" width="6" height="15.8" fill={k.carportDeur} />
      <rect x="63" y="88.2" width="6" height="15.8" fill="none" stroke={k.wit} strokeWidth="0.45" />
      <rect x="64.1" y="89.4" width="3.8" height="5.6" rx="0.2" fill={k.wit} opacity="0.12" />
      <rect x="64.1" y="96.4" width="3.8" height="6.4" rx="0.2" fill={k.wit} opacity="0.12" />
      <rect x="67.5" y="96" width="0.9" height="0.35" rx="0.15" fill={k.paal} />
      {nacht && <circle cx="71" cy="90" r="3.4" fill="url(#raamGloed)" />}
      <rect x="70.5" y="89.2" width="1" height="1.6" rx="0.3" fill={nacht ? '#f5c56c' : k.paal} />
      <AutoInCarport k={k} />
      <rect x="98.2" y="78" width="3" height="26" fill={k.baksteen} />
      <rect x="96.6" y="85.5" width="1.7" height="18.5" fill={k.paal} />
      <rect x="62" y="76.4" width="9.6" height="6.4" rx="0.4" fill={k.kastje} />
      <circle cx="65.8" cy="79.6" r="2.25" fill="none" stroke={k.kastjeRooster} strokeWidth="0.5" />
      <path d={liggend([78, 79.2, 80.4, 81.6], 68.8, 70.8)} stroke={k.kastjeRooster} strokeWidth="0.35" />
      <rect x="60.4" y="82.4" width="39.6" height="3.4" fill={k.wit} />
      <rect x="61" y="85.8" width="37.3" height="1.1" fill="#000000" opacity="0.25" />
    </g>
  );
}

/**
 * De twee-onder-een-kap: het dak loopt links door naar de buren (dat stuk
 * zonder panelen) en ligt verder bijna helemaal vol zwarte panelen. Een wit
 * boeideel met de goot, witte kozijnen, een witte regenpijp, en de kliko
 * tussen de ramen (rechts, waar hij echt staat, valt hij onder de batterij).
 */
/**
 * Het panelenveld op het hoofddak: het dakvlak loopt van de nok (y 27) tot
 * de goot (y 61.5), rechts langs de schuine rand van (60, 27) naar (62.8, 61.5);
 * met een kleine rand daarbinnen, 7 kolommen en 5 rijen.
 */
const DAK_RAND = 1.4;
export const DAK_HUIS = {
  links: 4,
  boven: 28.6,
  onder: 59.6,
  rechtsBoven: r2(60 + (28.6 - 27) * (2.8 / 34.5) - DAK_RAND),
  rechtsOnder: r2(60 + (59.6 - 27) * (2.8 / 34.5) - DAK_RAND),
  kolommen: 7,
  rijen: 5,
};

function TweeOnderEenKap({ k, dag, nacht, spots = null }) {
  return (
    <g>
      <path d="M-1 61.5 L62.8 61.5 L60 27 L-1 27 Z" fill={k.dakZwart} />
      <path d={liggend(reeks(31, 59, 4), -1, 7.4)} stroke={k.dakLijn} strokeWidth="0.35" opacity="0.8" />
      <rect x="-1" y="26.2" width="61.3" height="1.7" fill={k.dakLijn} />
      <line x1="60" y1="27" x2="62.8" y2="61.5" stroke={k.dakLijn} strokeWidth="0.9" />
      {/* Meer panelen, die meelopen met het dakvlak: evenwijdig aan nok en goot, rechts langs de schuine rand. */}
      <DakPanelen veld={DAK_HUIS} kleur={k.zwartPaneel} />
      {dag && <Glans id="panelenHuis" vakken={[{ x: DAK_HUIS.links, y: DAK_HUIS.boven, b: DAK_HUIS.rechtsOnder - DAK_HUIS.links, h: DAK_HUIS.onder - DAK_HUIS.boven }]} veld={panelenVeld(DAK_HUIS).d} van={4} />}
      <rect x="-1" y="60.6" width="64.6" height="3.4" fill={k.wit} />

      <rect x="-1" y="64" width="62" height="40" fill={k.baksteen} />
      <path d={liggend(reeks(67.5, 102.5, 3.5), -1, 61)} stroke={k.baksteenVoeg} strokeWidth="0.22" opacity="0.7" />
      <rect x="-1" y="64" width="62" height="1.2" fill="#000000" opacity="0.16" />
      <rect x="-1" y="84.2" width="62" height="1.3" fill={k.baksteenVoeg} opacity="0.55" />
      <rect x="-1" y="102.2" width="62" height="1.8" fill={k.baksteenVoeg} opacity="0.6" />
      <Raam x={7.5} y={67.5} b={8.5} h={10} k={k} nacht={nacht} deling="geen" />
      <Raam x={19.5} y={67.5} b={5} h={10} k={k} nacht={nacht} deling="geen" />
      <Raam x={46.5} y={67.5} b={9} h={10} k={k} nacht={nacht} deling="geen" />
      <Raam x={5.5} y={87} b={24.5} h={10} k={k} nacht={nacht} deling="boven" />
      <Raam x={47.5} y={86.5} b={4.8} h={15} k={k} nacht={nacht} deling="geen" />

      <path d="M59.2 63.6 Q59.2 65.2 57.9 65.8 V104" fill="none" stroke={k.wit} strokeWidth="1.05" />
      <path d="M39.8 93.8 H46 L45.5 103.8 H40.3 Z" fill={k.kliko} />
      <rect x="39.4" y="92.7" width="7" height="1.5" rx="0.45" fill={k.klikoDeksel} />
      <circle cx="44.9" cy="103.6" r="0.9" fill={k.band} />
      {spots !== null && <Spotjes xs={[6, 17, 28, 39, 52]} y={64} aan={spots} />}
    </g>
  );
}

/** Voor het huis een strook tuin met plantjes en een bankje, dan de stoep; de oprit van grijze klinkers naar de carport. */
function TuinEnStoep({ k }) {
  return (
    <g>
      <rect x="-1" y="104" width="102" height="21" fill={k.stoep} />
      <path
        d={liggend([113.6, 118.2], -1, 61) + staand(reeks(3, 59, 8), 109.4, 113.6) + staand(reeks(7, 55, 8), 113.6, 118.2)}
        stroke={k.stoepLijn}
        strokeWidth="0.3"
      />
      <path d="M61 104 H101 V125 H59 Z" fill={k.oprit} />
      <path d={liggend([108, 112.2, 116.6, 121], 60.4, 101)} stroke={k.opritLijn} strokeWidth="0.3" />
      <rect x="-1" y="121.8" width="102" height="3.2" fill={k.straat} />

      <rect x="-1" y="104" width="62" height="5.4" fill={k.tuin} />
      <path
        className="haag-wieg"
        d="M-1 106.4 Q1.4 103.2 3.8 105.2 Q6.2 102.6 8.6 104.9 Q11 102.8 13 105 L23.6 105.2 Q26 102.6 28.4 104.8 Q30.8 102.4 33.2 104.7 Q35.6 102.8 38 104.9 Q40.4 102.5 42.8 104.7 Q45.2 102.9 47.6 105 Q50 103.2 51.8 105.4 L61 105.6 V109.4 H-1 Z"
        fill={k.plant}
      />
      {[2.6, 7.6, 27.2, 36.6, 46.2].map((x, i) => (
        <circle key={x} cx={x} cy={r2(104.4 - (i % 2) * 0.8)} r="0.55" fill={k.bloem} />
      ))}
      <rect x="13.4" y="98.4" width="9.8" height="1" rx="0.3" fill={k.bank} />
      <rect x="13" y="101.3" width="10.6" height="1.1" rx="0.3" fill={k.bank} />
      <path d={staand([14, 22.6], 99.4, 105.4)} stroke={k.bank} strokeWidth="0.7" />
    </g>
  );
}

/** Het erf met dierenverblijf: de twee-onder-een-kap, met achter het huis het dierenverblijf en aan de rand de kerk. */
function MetDierenverblijf({ k, dag, nacht, spots }) {
  return (
    <g>
      <Kerk k={k} />
      <ellipse className="boom-wieg" cx="99.5" cy="59.5" rx="5" ry="5.6" fill={k.boom} />
      <DierenverblijfAchter k={k} dag={dag} nacht={nacht} />
      <Carport k={k} nacht={nacht} />
      <TweeOnderEenKap k={k} dag={dag} nacht={nacht} spots={spots} />
      <TuinEnStoep k={k} />
      <AutoOpzij k={k} />
    </g>
  );
}

// ---- garage: vrijstaand met garage, carport, haag en vlaggenmast ----

/** Hoge bomen achter het huis en de garage. */
function BomenAchter({ k }) {
  return (
    <g className="boom-wieg">
      <ellipse cx="2" cy="66" rx="11" ry="17" fill={k.boomDonker} />
      <ellipse cx="16.5" cy="60" rx="12" ry="15" fill={k.boom} />
      <ellipse cx="31" cy="71" rx="9" ry="11" fill={k.boomDonker} />
      <ellipse cx="13" cy="53" rx="6.5" ry="5.5" fill={k.boomLicht} />
      <ellipse cx="81.5" cy="38.5" rx="7" ry="7.5" fill={k.boomDonker} />
      <ellipse cx="91" cy="46" rx="11" ry="12.5" fill={k.boom} />
      <ellipse cx="88" cy="40" rx="6" ry="5" fill={k.boomLicht} />
      <ellipse cx="101.5" cy="58" rx="9" ry="15" fill={k.boomDonker} />
    </g>
  );
}

/**
 * De garagedeur (tekening garage): een roldeur die omhoog rolt als hij open gaat (MetGarage houdt bij of hij open is). Achter
 * de deur een donkere garage met een plank met dozen (boven de auto's uit), een fiets en een lamp die 's avonds brandt.
 */
function GarageDeur({ k, nacht, open }) {
  const id = `garage${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <g data-garagedeur={open ? 'open' : 'dicht'}>
      <clipPath id={id}>
        <rect x="5" y="90.6" width="18" height="13.4" />
      </clipPath>
      <g clipPath={`url(#${id})`}>
        <rect x="5" y="90.6" width="18" height="13.4" fill={k.bekleding} />
        <rect x="5.4" y="93.6" width="17.2" height="0.45" fill={k.paal} />
        <rect x="6" y="91.9" width="2.2" height="1.7" fill={k.plank} />
        <rect x="8.6" y="92.3" width="1.7" height="1.3" fill={k.plank} opacity="0.8" />
        <rect x="16.4" y="92.1" width="2.4" height="1.5" fill={k.plank} />
        <rect x="19.3" y="92.6" width="1.4" height="1" fill={k.plank} opacity="0.8" />
        <path d="M16 102.4 L17.6 99.8 H20 L21.2 102.4 M17.6 99.8 L18.6 102.4 L20 99.8 M17.3 99.2 H18.3 M19.8 99.8 L19.5 99.1 H20.4" stroke={k.velg} strokeWidth="0.25" fill="none" strokeLinecap="round" />
        <circle cx="16" cy="102.4" r="1.45" stroke={k.velg} strokeWidth="0.25" fill="none" />
        <circle cx="21.2" cy="102.4" r="1.45" stroke={k.velg} strokeWidth="0.25" fill="none" />
        <rect x="13.4" y="90.6" width="0.12" height="0.9" fill={k.velg} />
        <circle cx="13.46" cy="91.8" r="0.45" fill={nacht ? k.lampAan : k.velg} />
        <g className="garagedeur-blad" style={{ transform: open ? 'translateY(-12.6px)' : 'none' }}>
          <rect x="5" y="90.6" width="18" height="13.4" fill={k.garagedeur} />
          <path d={liggend([93.9, 97.2, 100.5], 5, 23)} stroke={k.garagedeurLijn} strokeWidth="0.4" />
          <rect x="13.2" y="102.2" width="1.6" height="0.5" fill={k.kozijn} opacity="0.7" />
        </g>
      </g>
    </g>
  );
}

/** Links de losse garage met een pannendak en een brede garagedeur; ertussen een stuk donkere steen met een deur en een raam. */
function Garage({ k, nacht, open = false }) {
  return (
    <g>
      <rect x="26.5" y="88" width="10.5" height="16" fill={k.donkereSteen} />
      <rect x="26" y="86.8" width="11.4" height="1.8" fill={k.wit} />
      <Raam x={28.2} y={90.4} b={4} h={13.6} k={k} nacht={nacht} deling="geen" bank={false} />
      <Raam x={33.4} y={90.4} b={2.2} h={8.6} k={k} nacht={nacht} deling="geen" bank={false} />

      <rect x="1.5" y="88" width="25.5" height="16" fill={k.baksteenRood} />
      <path d={liggend(reeks(91, 103, 3), 1.5, 27)} stroke={k.baksteenRoodVoeg} strokeWidth="0.22" opacity="0.7" />
      <path d="M-0.5 88.2 L29 88.2 L14.25 70.6 Z" fill={k.pannen} />
      <path d="M10.56 75H17.94M6.88 79.4H21.63M3.19 83.8H25.31" stroke={k.pannenLijn} strokeWidth="0.35" />
      <rect x="-0.5" y="86.8" width="29.5" height="1.8" fill={k.wit} />
      <GarageDeur k={k} nacht={nacht} open={open} />
      <line x1="3.2" y1="88.6" x2="3.2" y2="104" stroke={k.wit} strokeWidth="0.9" />
    </g>
  );
}

/** Een witte dakkapel (b breed) met een laag dakje, een wit boeideel en een raam. */
function Dakkapel({ x, b = 5.6, k, nacht }) {
  return (
    <g>
      <rect x={x} y="39.4" width={b} height="9.4" fill={k.dakkapel} />
      <rect x={x} y="48.2" width={b} height="0.6" fill="#000000" opacity="0.2" />
      <path d={`M${r2(x - 0.9)} 39.9 L${r2(x + 1.3)} 37.5 H${r2(x + b - 1.3)} L${r2(x + b + 0.9)} 39.9 Z`} fill={k.pannen} />
      <rect x={r2(x - 0.9)} y="39.4" width={r2(b + 1.8)} height="0.8" fill={k.wit} />
      <Raam x={r2(x + 1.2)} y={41.2} b={r2(b - 2.4)} h={5.4} k={k} nacht={nacht} deling="geen" bank={false} />
    </g>
  );
}

/**
 * Het vrijstaande huis: een steil pannendak met de goot op 62,6 en de nok op
 * 33, links drie rijen panelen (de bovenste korter, langs de schuine kant) en
 * rechts twee dakkapellen. Het zon-rondje begint links op de panelen, zodat
 * je ze rechts ervan goed ziet.
 */
function HuisMetDakkapellen({ k, nacht, spots = null }) {
  // De schuine kanten van het dak lopen van (32.5, 62.6) naar (47, 33) en van (94.5, 62.6) naar (80, 33).
  const links = (y) => r2(47 - (y - 33) * 0.49);
  const rechts = (y) => r2(80 + (y - 33) * 0.49);
  const pannen = [37, 41, 45, 49, 53, 57, 61].map((y) => `M${links(y)} ${y}H${rechts(y)}`).join('');
  return (
    <g>
      <path d="M32.5 62.6 L94.5 62.6 L80 33 L47 33 Z" fill={k.pannen} />
      <path d={pannen} stroke={k.pannenLijn} strokeWidth="0.35" />
      <line x1="47" y1="33" x2="80" y2="33" stroke={k.pannenLijn} strokeWidth="1" />
      {/* De panelen liggen hier op de achterkant van het dak: van voren zie je ze niet. Het zon-rondje
          staat boven het huis in de lucht en de lijn loopt over het dak naar de meterkast (BEGINPLEKKEN.garage). */}
      <Dakkapel x={52.7} k={k} nacht={nacht} />
      <Dakkapel x={68.7} k={k} nacht={nacht} />
      <rect x="32.5" y="61.6" width="62" height="2.4" fill={k.wit} />

      <rect x="36" y="64" width="55" height="40" fill={k.baksteenRood} />
      <path d={liggend(reeks(67.5, 102.5, 3.5), 36, 91)} stroke={k.baksteenRoodVoeg} strokeWidth="0.22" opacity="0.7" />
      <rect x="36" y="64" width="55" height="1.2" fill="#000000" opacity="0.16" />
      <Raam x={38.6} y={67.4} b={2.6} h={9.4} k={k} nacht={nacht} deling="geen" />
      <Raam x={45.4} y={67} b={7} h={10} k={k} nacht={nacht} deling="geen" />
      <Raam x={59.6} y={67} b={2.6} h={10} k={k} nacht={nacht} deling="geen" />
      <Raam x={66.4} y={67} b={7} h={10} k={k} nacht={nacht} deling="geen" />
      {/* de voordeur met een zijlicht, een lamp ernaast; een smal raam rechts */}
      <Raam x={46.6} y={85} b={4.4} h={19} k={k} nacht={nacht} deling="geen" bank={false} />
      <Raam x={51.8} y={85} b={6} h={16} k={k} nacht={nacht} deling="boven" bank={false} />
      {nacht && <circle cx="44.6" cy="87" r="3" fill="url(#raamGloed)" />}
      <rect x="44.1" y="86.2" width="1" height="1.6" rx="0.3" fill={nacht ? '#f5c56c' : k.kozijn} />
      <Raam x={62.2} y={85} b={2.6} h={13.6} k={k} nacht={nacht} deling="geen" />
      <Raam x={69} y={86} b={6} h={10} k={k} nacht={nacht} deling="geen" />
      {spots !== null && <Spotjes xs={[40, 52, 64, 76, 87]} y={64} aan={spots} />}
    </g>
  );
}

/** De grijze auto onder de carport, van achteren (zonder kenteken). */
function AutoAchter({ k }) {
  return (
    <g>
      <rect x="89.8" y="101" width="3.2" height="3.5" rx="0.8" fill={k.band} />
      <path d="M88.6 102.2 V96.8 Q88.8 93.6 91.6 91.8 L101 91.2 V102.2 Z" fill={k.autoGrijs} />
      <path d="M90.3 96.2 Q90.7 94.1 92.5 92.9 L101 92.5 V96.2 Z" fill={k.autoGlas} />
      <rect x="88.9" y="97.4" width="3.2" height="1.4" rx="0.5" fill={k.achterlicht} />
      <rect x="88.6" y="100.2" width="12.4" height="1.2" fill={k.band} opacity="0.5" />
    </g>
  );
}

/** Rechts tegen het huis: de carport met houten palen en een pannendak, met de auto eronder. */
function CarportHout({ k }) {
  const links = (y) => r2(78.6 + (80.6 - y) * 1.09);
  const pannen = [69, 73, 77].map((y) => `M${links(y)} ${y}H101`).join('');
  return (
    <g>
      <rect x="89" y="74" width="12" height="30" fill={k.boomDonker} />
      <ellipse cx="95.5" cy="86" rx="5" ry="3.4" fill={k.boom} />
      <rect x="79" y="83" width="22" height="21" fill="#000000" opacity="0.22" />
      <AutoAchter k={k} />
      <path d="M78.6 80.6 L101 80.6 L101 66.4 L96 64.6 Z" fill={k.pannen} />
      <path d={pannen} stroke={k.pannenLijn} strokeWidth="0.35" />
      <rect x="78.4" y="79.8" width="22.6" height="1.8" fill={k.wit} />
      <rect x="79" y="81.6" width="22" height="2" fill={k.hout} />
      <rect x="85.6" y="83.4" width="2.2" height="20.6" fill={k.hout} />
      <rect x="87.2" y="83.4" width="0.6" height="20.6" fill={k.houtDonker} />
    </g>
  );
}

/**
 * Hoe de vlag erbij hangt, uit de wind van het weerbericht (weerBeeld): slap
 * zonder (of met weinig) wind of zonder weerbericht, wapperen bij gewone wind
 * (vanaf 12 km/h), bijna horizontaal en snel bij harde wind (`wind` 'stevig',
 * vanaf 39 km/h) en strak horizontaal bij storm (vanaf 62 km/h).
 * @returns {'slap'|'wapper'|'stevig'|'storm'}
 */
export function vlagStand(weer) {
  const kmh = Number.isFinite(weer?.windKmh) ? weer.windKmh : 0;
  if (weer?.wind === 'storm' || kmh >= 62) return 'storm';
  if (weer?.wind === 'stevig' || kmh >= 39) return 'stevig';
  return kmh >= 12 ? 'wapper' : 'slap';
}

/** Per stand: hoe snel een golf over de vlag gaat (ms) en hoe hoog (eenheden); bij storm trilt alleen het uiteinde. */
export function vlagGolf(stand, kmh = 0) {
  switch (stand) {
    case 'wapper':
      // Van 2,2 s bij 12 km/h tot 1,2 s bij 39 km/h: sneller naarmate het harder waait.
      return { duur: Math.round(2200 - (Math.min(Math.max(kmh, 12), 39) - 12) * (1000 / 27)), hoog: 0.35, stroken: [0, 1, 2, 3, 4, 5] };
    case 'stevig':
      return { duur: 700, hoog: 0.25, stroken: [0, 1, 2, 3, 4, 5] };
    case 'storm':
      return { duur: 280, hoog: 0.12, stroken: [4, 5] };
    default:
      return null;
  }
}

/** Een effen vlag van 4 rijen van 6 blokjes (zo kan elke kolom apart golven). */
export const VLAG_RIJEN = 4;
export const VLAG_KOLOMMEN = 6;
const BLOK = 1.5;

/**
 * Een slanke vlaggenmast met een knop, achter de haag, met een effen vlag
 * (2:3). De vlag waait naar links. Elke kolom blokjes is een
 * eigen strook die met een kleine golf op en neer gaat (LUSSEN.golf, iets
 * later naarmate hij verder van de mast is): zo loopt er een golf over de
 * vlag, met alleen transform. Slap hangt hij stil langs de mast.
 */
function Vlaggenmast({ k, weer = null }) {
  const stand = vlagStand(weer);
  const golf = vlagGolf(stand, weer?.windKmh ?? 0);
  return (
    <g data-vlag={stand}>
      <rect x="40.47" y="38" width="0.56" height="66" fill={k.wit} />
      <circle cx="40.75" cy="37.7" r="0.62" fill={k.wit} />
      <g transform="translate(40.47 38.5)">
        <g className="vlag-doek" data-stand={stand}>
          {Array.from({ length: VLAG_KOLOMMEN }, (_, kolom) => (
            <g
              key={kolom}
              className="vlag-strook"
              {...(golf && golf.stroken.includes(kolom)
                ? { 'data-lus': 'golf', 'data-lus-duur': golf.duur, 'data-lus-vertraging': -Math.round((kolom * golf.duur) / VLAG_KOLOMMEN), 'data-golf': golf.hoog }
                : {})}
            >
              {Array.from({ length: VLAG_RIJEN }, (_, rij) => (
                <rect
                  key={rij}
                  x={r2(-(kolom + 1) * BLOK)}
                  y={r2(rij * BLOK)}
                  width={BLOK + 0.02}
                  height={BLOK + 0.02}
                  fill={k.vlag}
                />
              ))}
            </g>
          ))}
        </g>
      </g>
    </g>
  );
}

/** Voor het huis een groene haag, links een stenen paal; overal klinkers. */
function HaagEnKlinkers({ k }) {
  return (
    <g>
      <rect x="-1" y="104" width="102" height="21" fill={k.klinker} />
      <path d={liggend([108.4, 119.2], -1, 101)} stroke={k.klinkerLijn} strokeWidth="0.3" />
      <rect x="-1" y="113" width="102" height="1.2" fill={k.klinkerLijn} />
      <path d={staand(reeks(4, 96, 8), 104, 108.4) + staand(reeks(8, 92, 12), 108.4, 113.4)} stroke={k.klinkerLijn} strokeWidth="0.3" />
      <rect x="34.2" y="93" width="3.4" height="13" fill={k.baksteenRood} />
      <rect x="33.8" y="92.2" width="4.2" height="1.2" fill={k.steenKap} />
      <path
        className="haag-wieg"
        d="M37.6 106 V98.6 Q39.8 95.4 42.6 96.8 Q45.4 94.8 48.2 96.4 Q51 94.6 53.8 96.2 Q56.6 94.6 59.4 96.2 Q62.2 94.8 65 96.4 Q67.8 94.8 70.6 96.6 Q73.4 95 76.2 96.8 Q79 95.4 81.8 97 Q83.8 96.4 85 98.4 V106 Z"
        fill={k.haag}
      />
      {[
        [41, 99.5],
        [47, 101.8],
        [52.6, 98.8],
        [58.4, 102],
        [64, 99.2],
        [70, 101.6],
        [75.6, 99],
        [81, 101.4],
      ].map(([x, y]) => (
        <ellipse key={x} cx={x} cy={y} rx="1.5" ry="0.9" fill={k.haagLicht} />
      ))}
    </g>
  );
}

/**
 * Een SUV voor de garage, van voren (zonder kenteken), rechts naast de kleine
 * auto: hoger en breder, met een gesplitste koplamp (een smalle dagrijlamp
 * boven in de hoek, de koplamp lager in de bumper), een zwarte grille, een
 * dakreling en zwarte onderkant. De lampen branden. Kleuren: k.autoSuv, k.autoSuvGlas.
 */
function SuvVoor({ k }) {
  return (
    <g data-auto="suv">
      <ellipse cx="25.5" cy="106.4" rx="8.4" ry="0.7" fill={k.bekleding} opacity="0.35" />
      <rect x="18.0" y="102.2" width="2.9" height="4.1" rx="0.7" fill={k.band} />
      <rect x="30.1" y="102.2" width="2.9" height="4.1" rx="0.7" fill={k.band} />
      <path d="M19.8 97 L20.9 92 Q25.5 91.4 30.1 92 L31.2 97 Z" fill={k.autoSuvGlas} />
      <path d="M20.7 91.9 Q25.5 91.1 30.3 91.9 L30.2 92.4 Q25.5 91.8 20.8 92.4 Z" fill={k.autoSuv} />
      <path d="M21.2 91.6 V91 M29.8 91.6 V91" stroke={k.velg} strokeWidth="0.4" strokeLinecap="round" />
      <path d="M17.9 104.6 Q17.6 100 18.3 98 Q18.7 96.9 19.9 96.8 H31.1 Q32.3 96.9 32.7 98 Q33.4 100 33.1 104.6 Z" fill={k.autoSuv} />
      <path d="M18.1 96.6 H16.7 V97.7 H18.4 Z M32.9 96.6 H34.3 V97.7 H32.6 Z" fill={k.autoSuv} />
      <path d="M18.5 98 L21.9 98.4 L21.8 98.9 L18.4 98.6 Z M32.5 98 L29.1 98.4 L29.2 98.9 L32.6 98.6 Z" fill={k.lampAan} />
      <path d="M22.5 99.3 H28.5 L29.1 101 L28.1 102.8 H22.9 L21.9 101 Z" fill={k.autoKleinDak} />
      <rect x="24.9" y="100.6" width="1.2" height="0.5" rx="0.2" fill={k.velg} />
      <rect x="18.8" y="100.4" width="2" height="0.8" rx="0.3" fill={k.lampAan} />
      <rect x="30.2" y="100.4" width="2" height="0.8" rx="0.3" fill={k.lampAan} />
      <path d="M18.0 103.5 H33.0 V104.6 H18.0 Z" fill={k.bekleding} />
    </g>
  );
}

/**
 * Een kleine auto voor de garage, van voren (zonder kenteken), links: klein en
 * hoog, met een zwart dak, smalle koplampen in de hoeken, een zwarte grille en
 * zwarte wielkasten. De lampen branden (zonder gloed). Kleuren: k.autoKlein,
 * k.autoKleinDak.
 */
function KleineAuto({ k }) {
  return (
    <g data-auto="klein" transform="translate(-5 0)">
      <ellipse cx="14" cy="106.3" rx="7.6" ry="0.7" fill={k.bekleding} opacity="0.35" />
      <rect x="7.6" y="103.2" width="2.6" height="3" rx="0.7" fill={k.band} />
      <rect x="17.8" y="103.2" width="2.6" height="3" rx="0.7" fill={k.band} />
      <path d="M9.6 97.2 L10.9 93.3 Q14 92.5 17.1 93.3 L18.4 97.2 Z" fill={k.autoKleinDak} />
      <path d="M10.2 96.9 L11.3 93.9 Q14 93.3 16.7 93.9 L17.8 96.9 Z" fill={k.autoSuvGlas} />
      <path d="M7.4 104.4 Q7 100 8.4 98 Q9.2 96.9 10.4 96.8 H17.6 Q18.8 96.9 19.6 98 Q21 100 20.6 104.4 Z" fill={k.autoKlein} />
      <path d="M8 102.4 L10.3 104.4 H8 Z M20 102.4 L17.7 104.4 H20 Z" fill={k.bekleding} />
      <rect x="10.6" y="100.2" width="6.8" height="2.6" rx="0.5" fill={k.autoKleinDak} />
      <path d="M8.2 98.6 L10.6 99.1 L10.3 99.8 L8.1 99.5 Z M19.8 98.6 L17.4 99.1 L17.7 99.8 L19.9 99.5 Z" fill={k.lampAan} />
      <path d="M8.4 96.6 H7.1 V97.6 H8.7 Z M19.6 96.6 H20.9 V97.6 H19.3 Z" fill={k.autoKleinDak} />
    </g>
  );
}

/** Vrijstaand met een losse garage links en een houten carport rechts, een haag en een vlaggenmast. */
function MetGarage({ k, nacht, spots, weer }) {
  // Een grapje: tik op de garagedeur en hij rolt open of dicht. Alleen in de tekening, er wordt niets bediend.
  const [open, setOpen] = useState(false);
  return (
    <g>
      <BomenAchter k={k} />
      <Garage k={k} nacht={nacht} open={open} />
      <HuisMetDakkapellen k={k} nacht={nacht} spots={spots} />
      <CarportHout k={k} />
      <Vlaggenmast k={k} weer={weer} />
      <HaagEnKlinkers k={k} />
      <KleineAuto k={k} />
      <SuvVoor k={k} />
      <rect
        data-garageknop=""
        x="5"
        y="90.6"
        width="18"
        height="13.4"
        fill="transparent"
        style={{ pointerEvents: 'all', cursor: 'pointer' }}
        onClick={() => setOpen((o) => !o)}
      />
    </g>
  );
}

// ---- schuur en huis: een gewoon huis, met een stenen schuur of een boom ernaast ----

/** De molen aan de horizon, half achter wat er rechts staat. De wieken draaien om (90, 44.6) (index.css). */
function OudeMolen({ k }) {
  return (
    <g>
      <path d="M87.4 66 L88.7 45 L91.3 45 L92.6 66 Z" fill={k.molen} />
      <path d="M88.3 45.4 Q90 42.2 91.7 45.4 Z" fill={k.molen} />
      <g className="wieken">
        {[0, 90, 180, 270].map((hoek) => (
          <g key={hoek} transform={`rotate(${hoek} 90 44.6)`}>
            <rect x="89.55" y="34.6" width="0.9" height="10" fill={k.wiek} />
            <rect x="90.45" y="35.2" width="2.2" height="8.6" fill="none" stroke={k.wiek} strokeWidth="0.35" />
            <path d="M90.45 37.5H92.65M90.45 40H92.65" stroke={k.wiek} strokeWidth="0.3" />
          </g>
        ))}
        <circle cx="90" cy="44.6" r="0.7" fill={k.molen} />
      </g>
    </g>
  );
}

/** Een lage haag langs de voorkant, rechts van het huis. */
function Haag({ k }) {
  return (
    <path
      className="haag-wieg"
      d="M70 105.5 Q72.5 101.8 75.5 103.6 Q78.5 100.8 81.5 103.4 Q84.5 101 87.5 103.6 Q90.5 101.2 93.5 103.4 Q96.5 101 100 102.8 V105.5 Z"
      fill={k.haag}
    />
  );
}

/** Rechts naast het huis: een stenen schuur (of garage) met panelen op het dak. */
function Schuur({ k, dag, nacht }) {
  return (
    <g>
      <rect x="71" y="82" width="26" height="22" fill={k.gevel} />
      <path d={liggend(reeks(85.5, 103, 3.5), 71, 97)} stroke={k.voeg} strokeWidth="0.22" opacity="0.6" />
      <path d="M68 82 L100 82 L93 66 L75 66 Z" fill={k.dak} />
      <line x1="75" y1="66" x2="93" y2="66" stroke={k.dakLijn} strokeWidth="0.9" />
      <Panelen x={76.2} y={68} kolommen={3} rijen={2} b={5.2} h={6} naad={0.6} kleur={k.blauwPaneel} />
      {dag && <Glans id="panelenSchuur" vakken={[{ x: 76.2, y: 68, b: 16.8, h: 12.6 }]} van={85} soort="stal" />}
      <rect x="67" y="81" width="34" height="1.9" rx="0.3" fill={k.wit} />
      {/* kanteldeur */}
      <rect x="73" y="88" width="10.5" height="16" fill={k.deur} stroke={k.kozijn} strokeWidth="0.5" />
      <path d={liggend([91, 94, 97, 100], 73.3, 83.2)} stroke={k.kozijn} strokeWidth="0.35" opacity="0.7" />
      <Raam x={90} y={86} b={5.5} h={5} k={k} nacht={nacht} />
      <Haag k={k} />
    </g>
  );
}

/** Rechts naast het huis geen bijgebouw: een grote boom en een haag. */
function Boom({ k }) {
  return (
    <g>
      <rect x="83.6" y="76" width="2.8" height="28" fill={k.deur} />
      <g className="boom-wieg">
        <ellipse cx="79" cy="74" rx="7.5" ry="6.5" fill={k.boom} />
        <ellipse cx="91.5" cy="72.5" rx="8" ry="7" fill={k.boom} />
        <ellipse cx="85" cy="67" rx="12" ry="10.5" fill={k.boom} />
        <ellipse cx="82" cy="63" rx="6.5" ry="4.8" fill={k.haag} opacity="0.55" />
      </g>
      <Haag k={k} />
    </g>
  );
}

/**
 * Een gewoon huis met panelen op het dak, links een rijtje populieren en aan
 * de horizon een molen; rechts een schuur of een boom.
 */
function GewoonHuis({ k, dag, nacht, soort, spots = null }) {
  return (
    <g>
      <OudeMolen k={k} />
      <path d="M0 86 Q14 80 30 84 T62 82 T100 84 V105 H0 Z" fill={k.heuvelVer} />
      <path d="M0 92 Q20 87 40 91 T80 89 T100 91 V105 H0 Z" fill={k.heuvel} />
      {[
        [3.5, 80, 2.4, 10],
        [8, 77, 2.6, 12],
        [12.5, 82, 2.2, 9],
      ].map(([x, y, rx, ry]) => (
        <g key={x}>
          <rect x={x - 0.3} y={y + ry - 1} width="0.6" height="6" fill={k.boom} />
          <ellipse className="boom-wieg" cx={x} cy={y} rx={rx} ry={ry} fill={k.boom} />
        </g>
      ))}
      <rect x="0" y="103" width="100" height="22" fill={k.gras} />
      <rect x="0" y="103" width="100" height="2.2" fill={k.grasRand} />
      <path d="M35 104 H45 L50 125 H30 Z" fill={k.pad} />

      <rect x="50" y="21" width="5" height="11" fill={k.dak} />
      <rect x="49.4" y="20" width="6.2" height="1.6" fill={k.dakLijn} />
      <path d="M10 62 L70 62 L58 30 L22 30 Z" fill={k.dak} />
      <path d={[38, 46, 54].map((y) => `M${r2(22 - 12 * ((y - 30) / 32))} ${y}H${r2(58 + 12 * ((y - 30) / 32))}`).join('')} stroke={k.dakLijn} strokeWidth="0.3" opacity="0.6" />
      <line x1="22" y1="30" x2="58" y2="30" stroke={k.dakLijn} strokeWidth="1" />
      <Panelen x={25} y={35.6} kolommen={4} rijen={3} b={7} h={7.2} naad={0.6} kleur={k.blauwPaneel} />
      {dag && <Glans id="panelenHuis" vakken={[{ x: 25, y: 35.6, b: 29.8, h: 22.8 }]} van={20} />}
      <rect x="8.5" y="61" width="63" height="2.2" rx="0.3" fill={k.wit} />

      <rect x="14" y="63.2" width="52" height="40.8" fill={k.gevel} />
      <path d={liggend(reeks(66.5, 101.5, 3.5), 14, 66)} stroke={k.voeg} strokeWidth="0.22" opacity="0.6" />
      <Raam x={20} y={65.5} b={16} h={10} k={k} nacht={nacht} />
      <Raam x={44} y={65.5} b={16} h={10} k={k} nacht={nacht} />
      <Raam x={17} y={85} b={15} h={12} k={k} nacht={nacht} />
      <Raam x={47.5} y={85} b={9.5} h={12} k={k} nacht={nacht} />
      <rect x="35" y="82" width="10" height="22" fill={k.deur} stroke={k.kozijn} strokeWidth="0.6" />
      <rect x="36.6" y="83.8" width="6.8" height="4.4" fill={k.raam} opacity="0.9" />
      <circle cx="43.2" cy="94" r="0.55" fill={k.kozijn} />
      <rect x="34" y="103.4" width="12" height="1.2" fill={k.kozijn} opacity="0.85" />
      {nacht && <circle cx="33.4" cy="84.5" r="3.2" fill="url(#raamGloed)" />}
      <rect x="32.8" y="83.6" width="1.2" height="1.8" rx="0.3" fill={nacht ? '#f5c56c' : k.kozijn} />
      <path className="haag-wieg" d="M14 104 Q16 100.6 18.5 102.6 Q21 99.8 23.5 102.4 Q26 100.2 28.5 102.6 Q31 100.8 33 104 Z" fill={k.haag} />
      {[16, 19.5, 22.5, 26, 29.5].map((x, i) => (
        <circle key={x} cx={x} cy={r2(102.4 - (i % 2) * 0.8)} r="0.55" fill={k.bloem} />
      ))}

      {spots !== null && <Spotjes xs={[18, 30, 42, 54, 62]} y={63.2} aan={spots} />}
      {soort === 'schuur' ? <Schuur k={k} dag={dag} nacht={nacht} /> : <Boom k={k} />}
    </g>
  );
}

/**
 * Wat snel in een lus loopt (neerslag, sterren, de vlag): met een animatie
 * vanuit het script (Web Animations) in plaats van een CSS-animatie. Allebei
 * draaien ze op de grafische kaart, maar een korte CSS-lus vraagt bij elke
 * ronde de hoofddraad erbij (meting: regen 13,5% → 9,3% bezig, 4x trager).
 * Per element: data-lus (welke), data-lus-duur en data-lus-vertraging (ms).
 */
const getal = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
export const LUSSEN = {
  vallen: (el) => ({ frames: [{ transform: 'translate(0px, 0px)' }, { transform: `translate(${getal(el.dataset.opzij)}px, 125px)` }] }),
  twinkel: () => ({ frames: [{ opacity: 0.85 }, { opacity: 0.25 }, { opacity: 0.85 }], easing: 'ease-in-out' }),
  waai: () => ({
    frames: [
      { transform: 'translateX(-60px)', opacity: 0 },
      { transform: 'translateX(-20px)', opacity: 0.55, offset: 0.3 },
      { transform: 'translateX(40px)', opacity: 0.45, offset: 0.75 },
      { transform: 'translateX(70px)', opacity: 0 },
    ],
  }),
  // Bomen (draaien om hun voet) en hagen (buigen opzij) bij harde wind; hoe ver staat in data-wieg (graden).
  wieg: (el) => ({
    frames: [{ transform: `rotate(${-getal(el.dataset.wieg)}deg)` }, { transform: `rotate(${getal(el.dataset.wieg)}deg)` }],
    easing: 'ease-in-out',
    direction: 'alternate',
  }),
  buig: (el) => ({
    frames: [{ transform: `skewX(${-getal(el.dataset.wieg)}deg)` }, { transform: `skewX(${getal(el.dataset.wieg)}deg)` }],
    easing: 'ease-in-out',
    direction: 'alternate',
  }),
  golf: (el) => ({
    frames: [{ transform: `translateY(${-getal(el.dataset.golf)}px)` }, { transform: `translateY(${getal(el.dataset.golf)}px)` }],
    easing: 'ease-in-out',
    direction: 'alternate',
  }),
};

/** Start de lussen in de tekening; stil (uit beeld, blad erover, minder beweging): niets. */
function useLussen(ref, stil, ...sleutels) {
  useEffect(() => {
    const svg = ref.current;
    if (stil || !svg || typeof svg.animate !== 'function') return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    // Bij harde wind wiegen de bomen en buigen de hagen mee, op elke tekening (data-wind op de tekening); zonder wind niet.
    const wind = svg.getAttribute('data-wind');
    for (const el of svg.querySelectorAll('.boom-wieg, .haag-wieg')) {
      if (!wind) {
        el.removeAttribute('data-lus');
        continue;
      }
      const boom = el.classList.contains('boom-wieg');
      const storm = wind === 'storm';
      el.setAttribute('data-lus', boom ? 'wieg' : 'buig');
      el.setAttribute('data-wieg', String(boom ? (storm ? 4 : 2) : storm ? 6 : 3));
      el.setAttribute('data-lus-duur', String(storm ? 1300 : 2600));
    }
    const lopend = [...svg.querySelectorAll('[data-lus]')].flatMap((el) => {
      const lus = LUSSEN[el.dataset.lus]?.(el);
      if (!lus) return [];
      const opties = { duration: getal(el.dataset.lusDuur) || 1000, delay: getal(el.dataset.lusVertraging), iterations: Infinity, easing: lus.easing ?? 'linear', direction: lus.direction ?? 'normal' };
      const a = el.animate(lus.frames, opties);
      // Stoppen (cancel) wijst 'finished' af: dat is hier de bedoeling, geen fout.
      a.finished?.catch?.(() => {});
      return [a];
    });
    return () => {
      for (const a of lopend) a.cancel();
    };
  }, [ref, stil, ...sleutels]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * De tekening verandert alleen met dag/nacht, de spotjes, het weer en `stil`:
 * met memo tekent React hem niet elke 5 s opnieuw bij een nieuwe meting
 * (prestaties-19).
 */
export default memo(HuisTekening);

function HuisTekening({ dag, soort = 'dierenverblijf', spots = null, weer = null, stil = false }) {
  const k = dag ? DAG : NACHT;
  const nacht = !dag;
  const svg = useRef(null);
  useLussen(svg, stil, soort, dag, spots, weer);

  return (
    <svg
      ref={svg}
      className="huisfoto huistekening"
      data-tekening={soort}
      data-wind={weer?.wind ?? undefined}
      viewBox="0 0 100 125"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
    >
      <defs>
        <linearGradient id="lucht" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={k.luchtBoven} />
          <stop offset="0.72" stopColor={k.luchtOnder} />
        </linearGradient>
        <radialGradient id="zonGloed">
          <stop offset="0" stopColor="#ffd257" stopOpacity="0.6" />
          <stop offset="1" stopColor="#ffd257" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="raamGloed">
          <stop offset="0" stopColor="#f5c56c" stopOpacity="0.35" />
          <stop offset="1" stopColor="#f5c56c" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="paneelLucht" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity={dag ? 0.13 : 0.05} />
          <stop offset="0.7" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        {spots && (
          <linearGradient id="spotBundel" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffe7b0" stopOpacity={dag ? 0.4 : 0.55} />
            <stop offset="1" stopColor="#ffe7b0" stopOpacity="0" />
          </linearGradient>
        )}
        {weer?.mist && (
          <linearGradient id="mistBaan" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={dag ? '#eef2f6' : '#7d93ab'} stopOpacity="0" />
            <stop offset="0.5" stopColor={dag ? '#eef2f6' : '#7d93ab'} stopOpacity={dag ? 0.6 : 0.35} />
            <stop offset="1" stopColor={dag ? '#eef2f6' : '#7d93ab'} stopOpacity="0" />
          </linearGradient>
        )}
        <linearGradient id="glansStreep" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.38" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>

      <Lucht k={k} nacht={nacht} weer={weer} />
      {soort === 'garage' ? (
        <MetGarage k={k} nacht={nacht} spots={spots} weer={weer} />
      ) : soort === 'schuur' || soort === 'huis' ? (
        <GewoonHuis k={k} dag={dag} nacht={nacht} soort={soort} spots={spots} />
      ) : (
        <MetDierenverblijf k={k} dag={dag} nacht={nacht} spots={spots} />
      )}
      {weer && <WeerVoor weer={weer} nacht={nacht} k={k} />}
    </svg>
  );
}
