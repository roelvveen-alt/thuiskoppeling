import { Suspense, startTransition, useCallback, useEffect, useMemo, useState } from 'react';
import { VOORBEELD } from '@/api/base44Client';
import { vraag } from '@/api/huis';
import Advies from '@/components/Advies';
import GeenCijfers, { ZONDER_CIJFERS } from '@/components/GeenCijfers';
import HuisBeeld from '@/components/HuisBeeld';
import HuisWoorden from '@/components/HuisWoorden';
import Instellingen, { DELEN_EIGENAAR, DELEN_KIJKER } from '@/components/Instellingen';
import Kop from '@/components/Kop';
import Momenten from '@/components/Momenten';
import Tabbalk, { tabUit } from '@/components/Tabbalk';
import TabNu from '@/components/TabNu';
import { OUD_NA_MS, useOpstelling, useStand } from '@/lib/bron';
import { leesUitgesteld, vragenVan } from '@/lib/herkennen';
import { instellingUit, wijzigLokaal } from '@/lib/omvormerSturen';
import { vanNu } from '@/lib/vanNu';
import { leesLokaal, schrijfLokaal } from '@/lib/lokaal';
import { euroPerUur, tijd } from '@/lib/opmaak';
import { useAdviesDagen } from '@/lib/adviesBron';
import { useAlleHuizen } from '@/lib/alleHuizen';
import { faseGrenzen } from '@/lib/fasen';
import { useGelijk } from '@/lib/gelijk';
import { useLogboek } from '@/lib/logboek';
import { laadStraks, lui } from '@/lib/lui';
import { LOKAAL_KEUZE } from '@/lib/overzichtKeuze';
import { beginplekken, kiesTekening, puntenVoor, verplaats, wisselZichtbaar, ZON_SAMEN, zetBatterijRol, zetFase, zetNaam, zetVermogen, zetZonFase, zonSamen } from '@/lib/opstelling';
import { zonmeterEenfase } from '@/lib/spanning';
import { lijnenVoorTekening, verdeelStroom } from '@/lib/stroom';
import { useVerwachting } from '@/lib/verwachting';

const LOKAAL_TAB = 'thuis-energie.tab.v1';

/**
 * Wat pas laadt als het nodig is (src/lib/lui.jsx): de app opent zo met
 * alleen Huis en Nu. Kort na het openen laadt de rest toch vooraf; het
 * tabblad dat dit toestel het laatst open had, meteen (hieronder).
 */
const TABS_LUI = {
  voorspelling: lui(() => import('@/components/TabVoorspelling')),
  overzicht: lui(() => import('@/components/TabOverzicht')),
  apparaten: lui(() => import('@/components/TabApparaten')),
};
const BLAD = lui(() => import('@/components/Detail'));
const INSTELLINGEN_LUI = {
  indelen: lui(() => import('@/components/Indelen')),
  namen: lui(() => import('@/components/Namen')),
  gas: lui(() => import('@/components/Gas')),
  account: lui(() => import('@/components/Account')),
  delen: lui(() => import('@/components/Delen')),
  afstand: lui(() => import('@/components/OpAfstand')),
  omvormer: lui(() => import('@/components/OmvormerSturen')),
};
const ALLES_LUI = [...Object.values(TABS_LUI), BLAD, ...Object.values(INSTELLINGEN_LUI)];
const TabVoorspelling = TABS_LUI.voorspelling.Onderdeel;
const TabOverzicht = TABS_LUI.overzicht.Onderdeel;
const TabApparaten = TABS_LUI.apparaten.Onderdeel;
const Detail = BLAD.Onderdeel;
const Indelen = INSTELLINGEN_LUI.indelen.Onderdeel;
const Namen = INSTELLINGEN_LUI.namen.Onderdeel;
const Gas = INSTELLINGEN_LUI.gas.Onderdeel;
const Account = INSTELLINGEN_LUI.account.Onderdeel;
const Delen = INSTELLINGEN_LUI.delen.Onderdeel;
const OpAfstand = INSTELLINGEN_LUI.afstand.Onderdeel;
const OmvormerSturen = INSTELLINGEN_LUI.omvormer.Onderdeel;
// Live loopt dit terwijl de site nog vraagt wie je bent: het tabblad van de vorige keer staat dan al klaar.
TABS_LUI[tabUit(leesLokaal(LOKAAL_TAB))]?.vooraf().catch(() => {});

/** Zolang een deel nog laadt (alleen als het vooraf laden nog niet klaar was): een lege plek, geen flits. */
const NOG_NIET = <div className="min-h-[50vh]" aria-busy="true" />;
/** Of hier al eens een blad openging: dan hoeft de hint onder de foto niet meer. */
const LOKAAL_BLAD_GEZIEN = 'thuis-energie.blad-gezien.v1';

/** Bij 'leeg' boven de tegels: dit zijn nepcijfers, niet die van thuis (weergave-8). */
export function NogNietsVanThuis() {
  return (
    <p className="m-0 rounded-xl border border-lijn bg-vlak px-3.5 py-2.5 text-[14px]" role="status">
      Nog niets van thuis: dit is een voorbeeld.
    </p>
  );
}

/** De klok, elke 15 seconden bijgewerkt: genoeg voor "nu" in de grafieken en "laatste meting". */
function useKlok(elkeMs = 15_000) {
  const [nu, setNu] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNu(Date.now()), elkeMs);
    return () => clearInterval(id);
  }, [elkeMs]);
  return nu;
}

/**
 * Het scherm van één omgeving, in tabbladen (onderaan): Huis (de foto met de
 * stroom en de kaarten), Voorspelling (het weer en de zon van morgen), Nu,
 * Overzicht (vandaag met de prijzen, en week,
 * maand, kwartaal en jaar) en Apparaten. Achter het
 * tandwiel de instellingen. In het voorbeeld zonder omgevingen (alles op
 * dit toestel); live staat de gekozen omgeving in `omgevingen.huis`.
 *
 * Een kijker ziet hetzelfde, behalve Indelen, Namen, Delen en Op afstand. Dat is gemak, geen
 * beveiliging: de functie huis weigert hem ook als hij het toch probeert.
 */
export default function Hoofdscherm({ omgevingen = null, onSleutel }) {
  const huis = omgevingen?.huis ?? null;
  const eigenaar = VOORBEELD || huis?.rol === 'eigenaar';
  // Het voorbeeld opent op een druk moment: dan loopt er stroom uit alle hoeken.
  const [moment, setMoment] = useState('wassen');
  const { opstelling, wijzig, foto, kiesFoto, wisFoto, melding, gasStand } = useOpstelling(huis?.id ?? null, eigenaar);
  // In het voorbeeld passen de nepcijfers bij de gekozen tekening (wel of geen dierenverblijf).
  /** null = dicht; anders het onderdeel van Instellingen dat open staat. */
  const [instelling, zetInstelling] = useState(null);
  // In een overgang: laadt een deel nog, dan blijft het vorige even staan in plaats van een lege plek.
  const setInstelling = useCallback((waarde) => startTransition(() => zetInstelling(waarde)), []);
  const [gekozen, setGekozen] = useState(null);
  // Welk tabblad open staat, onthouden op dit toestel (alleen gemak). Vandaag en Prijzen zitten nu in Overzicht.
  const [tab, setTab] = useState(() => tabUit(leesLokaal(LOKAAL_TAB)));
  // Live cijfers in beeld (de foto, Nu of een blad): zo vaak lezen als thuis stuurt; anders eens per 30 s.
  const snel = instelling !== null || gekozen !== null || tab === 'huis' || tab === 'nu';
  const { stand: ruweStand, status } = useStand(huis?.id ?? null, moment, opstelling.tekening, { snel });
  const kiesTab = useCallback((sleutel) => {
    startTransition(() => {
      setTab(sleutel);
      zetInstelling(null);
      setGekozen(null);
    });
    schrijfLokaal(LOKAAL_TAB, sleutel);
    window.scrollTo?.({ top: 0 });
  }, []);
  // Kort na het openen de rest alvast laden, zodat elke tik meteen iets laat zien.
  useEffect(() => laadStraks(ALLES_LUI), []);
  // Apparaten › "Per apparaat, per week": Overzicht openen met Week gekozen (de week staat maar op één plek).
  const naarWeek = useCallback(() => {
    schrijfLokaal(LOKAAL_KEUZE, 'week');
    kiesTab('overzicht');
  }, [kiesTab]);
  // "Nu" voor de tabbladen: in het voorbeeld het gekozen moment, live de klok.
  const klok = useKlok();
  const nu = ruweStand?.klok ?? klok;
  const metVoorbeeld = status === 'voorbeeld' || status === 'leeg';
  // Het logboek van storingen alleen met Apparaten open, hooguit eens per twee minuten (src/lib/logboek.js).
  // In het voorbeeld rond het gekozen moment, niet de echte klok: anders staan er storingen "later" dan nu.
  const logboek = useLogboek(huis?.id ?? null, tab === 'apparaten' && instelling === null, VOORBEELD ? nu : klok);
  // "Klopt" of "Dat was …" bij het herkennen van apparaten: alleen de eigenaar (de functie toetst het ook).
  // In het voorbeeld alleen op dit scherm. Geeft true, of een zin waarom niet.
  const huisId = huis?.id ?? null;
  const labelHerkend = useCallback(
    async (label) => {
      if (VOORBEELD) return true;
      try {
        await vraag('labelHerkend', { huis_id: huisId, label });
        return true;
      } catch (fout) {
        return fout?.message || 'Bewaren lukte niet. Probeer het zo nog eens.';
      }
    },
    [huisId],
  );
  // De dagen waar Advies en Voorspelling van leren: alleen met Huis of Voorspelling open, samen hooguit eens per half uur
  // (één vraag voor beide, src/lib/adviesBron.js).
  const advies = useAdviesDagen({ huisId: huis?.id ?? null, actief: (tab === 'huis' || tab === 'voorspelling') && instelling === null, metVoorbeeld, nu });
  // Alle huizen met de kern van nu: alleen de beheerder, alleen met Account open, hooguit eens per 30 s (src/lib/alleHuizen.js).
  const overzicht = useAlleHuizen(instelling === 'account' && Boolean(omgevingen?.gebruiker?.beheerder));
  // Staat het programmaatje stil: geen "vandaag", "nu" of jaar van een andere dag (het voorbeeld heeft zijn eigen klok).
  // Zelfde inhoud als net: dezelfde delen (src/lib/gelijk.js), dan rekent en tekent wat erop leunt niet opnieuw (prestaties-19).
  const stand = useGelijk(useMemo(() => (metVoorbeeld ? ruweStand : vanNu(ruweStand, nu)), [metVoorbeeld, ruweStand, nu]));
  // Een stipje bij Apparaten zolang het programmaatje de eigenaar iets vraagt (brug 1.4.0); niet op Apparaten zelf.
  const openVragen = eigenaar && tab !== 'apparaten' && stand?.herkend ? vragenVan(stand.herkend, { uitgesteld: leesUitgesteld(nu) }).length : 0;

  // Begrenzen bij een negatieve prijs (1.5.0): de instelling van de eigenaar; in het voorbeeld op dit toestel.
  const [voorbeeldSturen, setVoorbeeldSturen] = useState({ aan: true, niet_op: [], vrij_op: null, netto: 'afnemer' });
  const instellingSturen = useMemo(() => instellingUit(VOORBEELD ? voorbeeldSturen : huis?.omvormer_sturen), [voorbeeldSturen, huis?.omvormer_sturen]);
  const omvormerSturenVraag = omgevingen?.omvormerSturen;
  const wijzigSturen = useCallback(
    async (wijziging) => {
      if (VOORBEELD) {
        setVoorbeeldSturen((oud) => wijzigLokaal(oud, wijziging));
        return true;
      }
      try {
        await omvormerSturenVraag(huisId, wijziging);
        return true;
      } catch (fout) {
        return fout?.message || 'Bewaren lukte niet. Probeer het zo nog eens.';
      }
    },
    [huisId, omvormerSturenVraag],
  );
  // Het onderdeel Omvormer alleen met een omvormer (in huis B niet); de functie toetst de rechten zelf.
  const delen = eigenaar ? DELEN_EIGENAAR.filter((d) => d.sleutel !== 'omvormer' || VOORBEELD || (status !== 'leeg' && Boolean(stand?.omvormer))) : DELEN_KIJKER;
  const bewerken = instelling === 'indelen';
  const verdeling = useMemo(() => verdeelStroom(stand), [stand]);
  // Op de tekening loopt alles via het huis (de meterkast); wie aan wie levert staat in de bladen.
  const lijnen = useGelijk(useMemo(() => lijnenVoorTekening(stand), [stand]));
  const punten = useGelijk(useMemo(() => puntenVoor(opstelling, stand), [opstelling, stand]));
  // Eén verwachting van de zon en de batterij voor Voorspelling, Advies en het batterijblad (src/lib/verwachting.js):
  // rekenen hooguit eens per minuut, geen eigen vraag aan Base44.
  const verwachting = useVerwachting({ stand, dagen: advies.leerDagen, punten, nu, huisId: huis?.id ?? null, metVoorbeeld });
  // De grens en zekering per fase van dit huis (Instellingen › Namen), anders 20 A en 25 A.
  const grenzen = useMemo(() => faseGrenzen(opstelling), [opstelling]);
  // De Zon-tegel op Nu opent bij meer plekken met panelen het blad van alle plekken samen.
  const gekozenPunt = punten.find((p) => p.sleutel === gekozen) ?? (gekozen === ZON_SAMEN ? zonSamen(punten) : null);
  // Oude cijfers (er komt niets nieuws van thuis, of Base44 antwoordt even niet): niet laten lijken alsof het nu zo is.
  const oud =
    !metVoorbeeld &&
    Boolean(stand?.moment) &&
    (status === 'fout' || status === 'rem' || !(klok - new Date(stand.moment).getTime() < OUD_NA_MS));
  const oudRegel = oud ? `Stand van ${tijd(stand.moment)}` : null;
  // Nog geen enkele meting binnen (laden, of Base44 antwoordt niet): geen "0 W" en "Geen … gekoppeld".
  const zonderCijfers = !stand && ZONDER_CIJFERS.includes(status);

  const sluit = useCallback(() => setGekozen(null), []);
  const [bladGezien, setBladGezien] = useState(() => leesLokaal(LOKAAL_BLAD_GEZIEN) === true);
  const kies = useCallback((sleutel) => {
    setGekozen(sleutel);
    setBladGezien(true);
    schrijfLokaal(LOKAAL_BLAD_GEZIEN, true);
  }, []);
  const zetVerder = useCallback((sleutel, x, y) => wijzig((o) => verplaats(o, sleutel, x, y)), [wijzig]);

  // Weg uit deze omgeving (verwijderd, of niet meer gedeeld): opnieuw vragen welke er zijn.
  const laad = omgevingen?.laad;
  useEffect(() => {
    if (status === 'geenHuis') laad?.();
  }, [status, laad]);

  const maak = async (naam) => {
    const uit = await omgevingen.maak(naam);
    onSleutel({ sleutel: uit.sleutel, huis: uit.huis });
  };

  return (
    <div className="schil" data-tabbalk="true">
      <Kop
        titel={huis?.naam}
        status={status}
        moment={stand?.moment}
        open={instelling !== null}
        onInstellingen={() => {
          setGekozen(null);
          setInstelling((open) => (open ? null : delen[0].sleutel));
        }}
      />

      <Suspense fallback={NOG_NIET}>
      {instelling !== null || tab === 'huis' ? (
      <main
        className="grid items-start gap-5 lg:grid-cols-[minmax(0,540px)_minmax(0,1fr)] lg:gap-8"
        {...(instelling === null ? { id: 'tabblad', role: 'tabpanel', 'aria-labelledby': 'tab-huis' } : {})}
      >
        <div className="mx-auto grid w-full max-w-[560px] gap-4 lg:sticky lg:top-[max(16px,env(safe-area-inset-top,0px))] lg:mx-0 lg:max-w-none">
          <HuisBeeld
            tekening={opstelling.tekening}
            foto={foto}
            punten={punten}
            stand={stand}
            verdeling={verdeling}
            lijnen={lijnen}
            bewerken={bewerken}
            gekozen={gekozen}
            onKies={kies}
            onVerplaats={zetVerder}
            geld={euroPerUur(stand?.net_w, stand?.prijs)}
            oud={oudRegel}
            voorbeeld={status === 'leeg'}
          />
          {!instelling && !bladGezien && !zonderCijfers && (
            <p className="m-0 text-[13.5px] text-tekst-zacht">Tik op een rondje: waar de stroom vandaan komt en heen gaat.</p>
          )}
          {metVoorbeeld && !instelling && <Momenten gekozen={moment} onKies={setMoment} />}
        </div>

        <div className="grid min-w-0 gap-4">
          {status === 'leeg' && !instelling && <NogNietsVanThuis />}
          {melding && (
            <p className="m-0 rounded-xl border border-lijn bg-vlak px-3.5 py-2.5 text-[14px]" role="status">
              {melding}
            </p>
          )}
          {instelling ? (
            <Instellingen delen={delen} deel={instelling} onDeel={setInstelling} onKlaar={() => setInstelling(null)}>
              {instelling === 'indelen' && (
                <Indelen
                  punten={punten}
                  tekening={opstelling.tekening}
                  foto={foto}
                  onKiesTekening={(tekening) => wijzig((o) => kiesTekening(o, tekening))}
                  voorbeeld={VOORBEELD}
                  onKiesFoto={kiesFoto}
                  onWisFoto={wisFoto}
                  onWissel={(sleutel) => wijzig((o) => wisselZichtbaar(o, sleutel))}
                  onBeginplekken={() => wijzig(beginplekken)}
                />
              )}
              {instelling === 'namen' && (
                <Namen
                  punten={punten}
                  voorbeeld={VOORBEELD}
                  onNaam={(sleutel, naam) => wijzig((o) => zetNaam(o, sleutel, naam))}
                  onVermogen={(sleutel, w) => wijzig((o) => zetVermogen(o, sleutel, w))}
                  fase={{ faseGrens: opstelling.faseGrens, zekering: opstelling.zekering, metFasen: Boolean(stand?.fasen?.length) }}
                  onFase={(veld, a) => wijzig((o) => zetFase(o, veld, a))}
                  batterijRol={opstelling.batterijRol}
                  onBatterijRol={(rol) => wijzig((o) => zetBatterijRol(o, rol))}
                  zonFase={zonmeterEenfase(stand?.spanning) ? { fase: opstelling.zonFase, onFase: (f) => wijzig((o) => zetZonFase(o, f)) } : null}
                />
              )}
              {instelling === 'gas' && <Gas standen={opstelling.gasStanden} meterkast={stand?.meterkast ?? null} nu={klok} onStand={gasStand} />}
              {instelling === 'account' && (
                <Account
                  voorbeeld={VOORBEELD}
                  gebruiker={omgevingen?.gebruiker}
                  huizen={omgevingen?.huizen}
                  huisId={huis?.id}
                  magMaken={omgevingen?.magMaken}
                  onKies={omgevingen?.kies}
                  onOpen={(id) => {
                    omgevingen?.kies(id);
                    setInstelling(null);
                  }}
                  onHernoem={omgevingen?.hernoem}
                  onMaak={maak}
                  overzicht={overzicht}
                  nu={klok}
                />
              )}
              {instelling === 'delen' && (
                <Delen
                  voorbeeld={VOORBEELD}
                  huis={huis}
                  beheerder={Boolean(omgevingen?.gebruiker?.beheerder)}
                  onUitnodigen={(email) => omgevingen.uitnodigen(huis.id, email)}
                  onVerwijder={(email) => omgevingen.verwijderLid(huis.id, email)}
                  onNieuweSleutel={async () => onSleutel({ sleutel: await omgevingen.nieuweSleutel(huis.id), vervangen: true })}
                />
              )}
              {instelling === 'omvormer' && (
                <OmvormerSturen voorbeeld={VOORBEELD} instelling={instellingSturen} sturen={stand?.omvormer?.sturen ?? null} nu={nu} onWijzig={wijzigSturen} omvormerW={stand?.omvormer?.w ?? null} netW={stand?.net_w ?? null} />
              )}
              {instelling === 'afstand' && (
                <OpAfstand
                  voorbeeld={VOORBEELD}
                  huis={huis}
                  brug={stand?.brug ?? null}
                  onZet={(veld, pakket, nieuwPaar) => omgevingen.zetOpAfstand(huis.id, veld, pakket, nieuwPaar)}
                  onWis={(veld) => omgevingen.wisOpAfstand(huis.id, veld)}
                />
              )}
            </Instellingen>
          ) : (
            zonderCijfers ? (
              <GeenCijfers status={status} />
            ) : (
              <>
                <HuisWoorden stand={stand} verdeling={verdeling} punten={punten} grenzen={grenzen} onNu={() => kiesTab('nu')} />
                {!oud && (
                  <Advies stand={stand} dagen={advies.dagen} nu={nu} rol={opstelling.batterijRol} verwachting={verwachting} />
                )}
              </>
            )
          )}
          {metVoorbeeld && !instelling && (
            <p className="m-0 max-w-[62ch] text-[13.5px] leading-relaxed text-tekst-zacht">
              Dit zijn nepcijfers van een gewone dag. Zodra het programmaatje thuis draait, zie je hier je eigen
              HomeWizard-meters en je Zendure-batterij, ongeveer elke 5 seconden bijgewerkt.
              {status === 'leeg' && eigenaar && ' Heb je de sleutel uit de app thuis ingevuld (node brug.mjs instellen, en plakken)? Kwijt: Instellingen › Delen.'}
            </p>
          )}
        </div>
      </main>
      ) : (
        <main className="grid min-w-0 grid-cols-1 gap-4">
          {status === 'leeg' && <NogNietsVanThuis />}
          {melding && (
            <p className="m-0 rounded-xl border border-lijn bg-vlak px-3.5 py-2.5 text-[14px]" role="status">
              {melding}
            </p>
          )}
          {tab === 'nu' && oudRegel && (
            <p className="m-0 rounded-xl border border-lijn bg-vlak px-3.5 py-2.5 text-[14px]">
              {oudRegel} · dit is niet wat er nu loopt.
            </p>
          )}
          {tab === 'nu' && (zonderCijfers ? <GeenCijfers status={status} tab="nu" /> : <TabNu stand={stand} verdeling={verdeling} punten={punten} onKies={kies} grenzen={grenzen} />)}
          {tab === 'overzicht' && (
            <TabOverzicht
              stand={stand}
              nu={nu}
              huisId={huis?.id ?? null}
              metVoorbeeld={metVoorbeeld}
              zonderCijfers={zonderCijfers ? <GeenCijfers status={status} /> : null}
              eigenaar={eigenaar}
              namen={opstelling.namen}
              gasStanden={opstelling.gasStanden}
              instellingSturen={eigenaar ? instellingSturen : null}
            />
          )}
          {tab === 'voorspelling' && (
            <TabVoorspelling
              stand={stand}
              dagen={advies.leerDagen}
              punten={punten}
              nu={nu}
              huisId={huis?.id ?? null}
              eigenaar={eigenaar}
              metVoorbeeld={metVoorbeeld}
              onNamen={eigenaar ? () => setInstelling('namen') : null}
              zonderCijfers={zonderCijfers ? <GeenCijfers status={status} /> : null}
              verwachting={verwachting}
            />
          )}
          {tab === 'apparaten' && (zonderCijfers ? <GeenCijfers status={status} tab="apparaten" /> : <TabApparaten stand={stand} nu={nu} eigenaar={eigenaar} logboek={logboek} onLabel={eigenaar ? labelHerkend : null} onWeek={naarWeek} punten={punten} verwachtVol={verwachting?.morgen?.batterij ?? null} sturen={eigenaar ? { instelling: instellingSturen, onNuAan: () => wijzigSturen({ nu_aan: true }) } : null} zonFase={opstelling.zonFase} />)}
          {metVoorbeeld && (
            <div className="grid gap-2">
              <Momenten gekozen={moment} onKies={setMoment} />
              <p className="m-0 max-w-[62ch] text-[13.5px] leading-relaxed text-tekst-zacht">
                Dit zijn nepcijfers van een gewone dag
                {tab === 'overzicht' ? ', met nepdagen voor de week, maand, kwartaal en het jaar' : tab === 'voorspelling' ? ', met een nepweerbericht en zes nepdagen om van te leren' : ''}. Kies
                hierboven een ander moment van de dag.
              </p>
            </div>
          )}
        </main>
      )}
      </Suspense>

      <Tabbalk gekozen={instelling === null ? tab : null} onKies={kiesTab} vragen={openVragen} />

      {gekozenPunt && !instelling && (
        <Suspense fallback={null}>
        <Detail key={gekozenPunt.sleutel} punt={gekozenPunt} punten={punten} stand={stand} verdeling={verdeling} onSluit={sluit} onKies={kies} verwachtVol={verwachting?.morgen?.batterij ?? null} eigenaar={eigenaar} />
        </Suspense>
      )}
    </div>
  );
}
