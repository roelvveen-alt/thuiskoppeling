# thuiskoppeling

Je slimme energie-apparaten samen in één overzicht: de meters van
**HomeWizard**, een **Zendure**-batterij, een **GoodWe**-omvormer en de
stroomprijzen van **Zonneplan**, op een tekening (of een foto) van je huis, met
de stroom die je ziet lopen: van de panelen naar de batterij, van het net naar
het huis, van het huis naar de wasmachine. Open source (MIT-licentie), in het
Nederlands. In de app zelf heet het **Energie thuis**.

## Wat het kan

- **Nu**: elke paar seconden zon, batterij, huis en net, op de tekening en in
  gewone woorden ("De zon levert 1.134 W. Daarvan laadt 627 W de batterij …"),
  met de belasting en de spanning per fase.
- **Overzicht**: vandaag, week, maand, kwartaal en jaar, met wat je betaalde en
  verdiende (de prijzen per kwartier van Zonneplan, of een schatting via
  EnergyZero), zelfvoorzienend en eigen verbruik.
- **Weer en advies**: het weerbericht (Open-Meteo), hoeveel zon er morgen komt
  en eenvoudige raad wanneer de wasmachine het best kan draaien.
- **Apparaten**: wat er gekoppeld is, wat de batterij en de omvormer zelf
  melden, welk apparaat waarschijnlijk stroom gebruikt, en een logboek van
  storingen. Tuya-meetschakelaars en -lampen kunnen erbij.
- **Meer huizen**: elk huis is een eigen omgeving met een eigen programmaatje;
  je kunt anderen uitnodigen om mee te kijken. Omgevingen zien niets van elkaar.

**Alleen kijken.** De app en het programmaatje bedienen niets: geen batterij,
geen schakelaar. Er is precies één uitzondering, scherp afgebakend en
**standaard uit**: als de eigenaar het in de app aanzet, mag het programmaatje
een GoodWe-omvormer begrenzen zolang terugleveren geld kost, en hem daarna weer
vrijgeven (zie **De omvormer bij een negatieve prijs** hieronder).

## Zelf draaien, in het kort

1. **Een eigen app in Base44.** In deze map: `npm install`, `npx base44 login`
   en `npx base44 link --create --name "thuiskoppeling"`. De CLI zet het app-id in
   `base44/.app.jsonc`; dat bestand staat in `.gitignore` en hoort **nooit** in
   git. Daarna live zetten met `node scripts/uitrollen.mjs --droog` en
   `node scripts/uitrollen.mjs` (zie **1. De app in Base44**).
2. **Het programmaatje thuis** (`brug/`, Node 20 of nieuwer) op iets dat thuis
   altijd aanstaat: een oude Android-telefoon, een Raspberry Pi of een
   Chromebook. `node brug.mjs instellen` zoekt je meters en vraagt de rest. De
   sleutels van je apparaten blijven thuis, in `brug/instellingen.json` (ook
   nooit in git). Zie **2. Het programmaatje thuis**.
3. **In de app**: een omgeving maken, de tekening kiezen en de rondjes op hun
   plek zetten. Zie **3. In de app**.

Zonder Base44 kun je de site ook bekijken met nepcijfers: `npm run dev`.

**Bijdragen?** Graag. Lees eerst [CONTRIBUTING.md](CONTRIBUTING.md).

Over de voorbeelden in deze tekst: **huis A** en **huis B** zijn de twee
proefhuizen waarmee de app gebouwd is. Huis A heeft panelen op het huis en op
een dierenverblijf, een kWh-meter op zon en batterij samen en een
GoodWe-omvormer; huis B heeft één kWh-meter op de zonnepanelen (een
SolarEdge-omvormer), een spa met een eigen meter en geen GoodWe. Getallen en
adressen in de voorbeelden zijn voorbeelden, geen echte.

Eén app voor meer huizen. Je logt in, en elk huis is een eigen **omgeving**
met een eigen programmaatje thuis. In je eigen omgeving kun je anderen
uitnodigen om mee te kijken (alleen kijken). Omgevingen zien niets van
elkaar.

## Hoe het werkt

```
HomeWizard (P1-meter, stekkers, kWh-meters) ─┐
Zendure-batterij (lokaal of via de cloud) ───├─► programmaatje thuis ─► Base44-app ─► je telefoon
GoodWe-omvormer (lokaal, mag weg) ───────────┘     (brug/)               (deze site)    (ook onderweg)
```

- **HomeWizard** geeft zijn cijfers alleen binnen je eigen wifi. Een app op
  internet kan daar niet zelf bij. Daarom is er thuis een klein programmaatje
  nodig dat de meters uitleest en de getallen doorstuurt.
- **Zendure** kan op twee manieren: lokaal (nieuwere modellen) of via de cloud
  met de *Autorisatiecloudsleutel* uit de Zendure-app. Lokaal mag ook met die
  sleutel als reserve (sinds 0.6.2): zie **De cloud als reserve** hieronder.
- **GoodWe-omvormer** (DT-serie, zoals de GW8000-DT; mag weg): lokaal via zijn
  wifi-stekker, alleen lezen. Zie **De omvormer** hieronder.
- **Tuya** (Smart Life, Tuya Smart; mag weg, sinds 0.8.0): een meetschakelaar
  (zoals een pomp) bij de apparaten, lampen en schakelaars aan/uit, en de
  spotjes in het overstek op de tekening. Lokaal, alleen lezen; de sleutels één
  keer uit een eigen Tuya-cloudproject. Zie **`docs/tuya.md`**.
- **Het weerbericht** (sinds 0.9.0): per uur de zonnestraling, de bewolking en
  de temperatuur van vandaag en morgen, bij Open-Meteo (gratis, geen sleutel),
  voor Advies; sinds 0.10.0 ook regen (kans en mm), onweer, mist en sneeuw (de
  weercode) en windstoten, voor het tabblad Voorspelling. Zie **Het weer** hieronder.
- **Welk apparaat stroom gebruikt** (sinds 0.11.0): het programmaatje raadt uit
  het huisverbruik (koelkast, wasmachine, strijkijzer, waterkoker …) en leert
  van wat je in de app aanwijst. Alleen raden, nooit bedienen. Sinds 0.12.0
  telt het per dag per apparaat de kWh en hoe vaak het aan was (ook wat een
  eigen meter heeft), voor **Overzicht › Apparaten**. Zie **Apparaten
  herkennen** hieronder.
- **De sleutels blijven thuis.** De app krijgt alleen getallen. Hij kan niets
  bedienen: alleen kijken.
- **Elk huis zijn eigen sleutel.** Het programmaatje stuurt met de sleutel van
  zijn omgeving; die krijg je één keer in de app. Base44 bewaart er alleen een
  hash van, dus wie de database ziet, kan er niets mee.
- De cijfers verversen ongeveer elke 5 seconden: zo vaak stuurt het
  programmaatje, en zo vaak kijkt de app. Elke seconde gaat via internet niet
  goed: Base44 remt af bij te veel aanroepen. De bewegende stipjes lopen
  intussen gewoon door. (`elke_seconden` in `instellingen.json` kan van 3 tot
  300.)

## Wat je nodig hebt

- Iets dat thuis altijd aanstaat, met Node 20 of nieuwer (zie hieronder wat kan).
- **HomeWizard: niets in de app.** Het programmaatje gebruikt de nieuwe manier
  van HomeWizard (API v2): `node brug.mjs homewizard-code` loopt je meters
  langs en vraagt per meter om op het knopje te drukken; de code komt dan
  vanzelf in `instellingen.json`. Kent een oude meter dat nog niet, dan zegt
  hij dat; zet dan in de HomeWizard-app bij die meter **Lokale API** aan.
- **Zendure: de Autorisatiecloudsleutel** uit de Zendure-app (**Profiel ›
  Autorisatiecloudsleutel › Ophalen**). Behandel hem als een wachtwoord.
  Zendure staat per account maar één zo'n verbinding toe, dus niet tegelijk in
  Home Assistant of Homey. Lokaal lezen kan ook (iets sneller), maar daarvoor
  moet in de Zendure-app "HEMS" worden toegevoegd en dat zit niet in elke
  versie van de app.

### Waar het programmaatje op kan draaien

Gratis, met wat je misschien al hebt:

- **Een oude Android-telefoon of -tablet** aan de lader, op de wifi, met de
  gratis app Termux: zie **Op een Android-telefoon (Termux)** hieronder.
  Kost een paar euro stroom per jaar. Android kan apps soms toch stoppen; met
  Termux:Boot start hij na een herstart vanzelf weer. Een iPhone kan dit niet.
- **Een oude laptop of pc die aan mag blijven.** Werkt meteen, maar gebruikt
  meer stroom (een laptop 10 W is zo'n € 25 per jaar). Je gewone pc alleen als
  die toch altijd aanstaat.

Met apparatuur:

- **Raspberry Pi** (aanrader voor dit plan). Een Zero 2 W is genoeg (een paar
  tientjes met voeding en kaartje); een Pi 5 kost nu rond € 70–85 los. Zuinig
  (een paar watt) en het programmaatje draait er precies zo op, met
  `brug/thuis-energie-brug.service` start hij vanzelf.
- **Home Assistant Green** (adviesprijs € 179). Kant-en-klaar kastje met Home
  Assistant: HomeWizard en Zendure kunnen er ook in, en het kan zelf een
  stroomschema tonen en later slim sturen (bijvoorbeeld laden bij lage prijs).
  Meer mogelijkheden, wel meer om te leren; de cijfers gaan dan via Home
  Assistant naar deze app.

## 1. De app in Base44

De app draait in je eigen Base44-account, privé (alleen wie is uitgenodigd
komt erin; `base44/config.jsonc` houdt hem bij elke deploy privé). Eén keer een
app maken en koppelen, in deze map:

```bash
npm install
npx base44 login                         # inloggen bij Base44 (code in je browser goedkeuren)
npx base44 link --create --name "thuiskoppeling"   # maakt de app; het app-id komt in base44/.app.jsonc
```

`base44/.app.jsonc` staat in `.gitignore`: het app-id hoort niet in git (en zet
het ook niet in `BASE44_APP_ID`; het uitrolscript weigert dan). Live zetten,
ook elke volgende versie:

```bash
node scripts/uitrollen.mjs --droog       # alles nagaan, ook de live tabellen (alleen lezen)
node scripts/uitrollen.mjs               # nagaan, dan tabellen, functies en site live, nameten, tag
node scripts/uitrollen.mjs --terug uitrol/2026-10-30-1442   # alleen functies en site terug
```

Het script weigert als de stand niet schoon en gepusht is, als een poort rood
is, of als live een tabel of veld staat dat hier ontbreekt. Doe dan niet met de
hand `npx base44 deploy`: eerst uitzoeken.

Op een pc met Windows: in PowerShell `npx.cmd` in plaats van `npx`, en achter
een bedrijfsproxy eerst `$env:NODE_OPTIONS="--use-system-ca"`.

Open de app en log in. Jij bent de beheerder van de app, dus jij mag een
omgeving maken: kies een naam (bijvoorbeeld "Thuis") en klik op **Omgeving
maken**. Je krijgt één keer de **sleutel** voor het programmaatje, met het adres
erbij. Die geef je het programmaatje in stap 2 (de instelhulp vraagt erom).
Kwijt? In **Instellingen › Delen** maak je een nieuwe; de oude werkt dan meteen
niet meer.

Het adres staat ook hier:

```bash
node scripts/functieAdres.mjs
```

### Na een deploy

- `deploy --build --yes` zet tabellen, rechten, functies en de site meteen
  live; Publish in Base44 is bij een app die met de CLI gemaakt is niet nodig.
  Gemeten op 30 oktober 2026: een bijgewerkte functie antwoordde direct na de
  deploy met de nieuwe code. (Een app die in de Base44-editor gemaakt is, kan
  anders werken.)
- Eerst gaan de functies live, daarna de site. Zegt de app heel even "De app
  wordt net bijgewerkt", dan is dat het.
- Base44 kijkt per functie alleen of `entry.ts` zelf veranderd is. Verandert
  alleen een gedeeld bestand (`base44/shared/`), dan blijft de oude functie
  live. Daarom staat bovenaan elke `entry.ts` een vingerafdruk van alles wat hij
  gebruikt. `node scripts/vingerafdruk.mjs` werkt die bij; `npm test` zegt het
  als je dat vergat.
- Let op: een deploy zet de tabellen live **gelijk aan wat hier staat**. Wat
  hier ontbreekt (een tabel, een veld, een koppeling), gaat live weg, met wat
  erin stond, zonder vraag en zonder melding. Haal dus nooit een tabel of veld
  weg en hernoem er geen; erbij komen mag. `npm test` bewaakt dat lokaal
  (`base44/tests/entiteiten.test.js`; een nieuw veld vastleggen met
  `node scripts/velden.mjs`). De rechten van Huis, Meting, Opstelling en Dag
  blijven "alleen de beheerder"; de site leest ze nooit zelf.
- `scripts/uitrollen.mjs` haalt vóór elke deploy de live tabellen op (dit
  leest alleen: `api fetch GET "/api/apps/{app_id}/entity-schemas" --read-only`)
  en legt ze naast `base44/entities/`. Staat er live iets dat hier ontbreekt,
  is een type anders of is de rls niet meer `admin`, dan weigert hij. Ook vanuit
  een map in `.claude/worktrees` weigert hij (een werkmap kan achterlopen).
- Terugdraaien nooit met `deploy` vanaf een oudere stand: die kent de nieuwste
  tabellen of velden niet en haalt ze live weg. `--terug` zet alleen functies
  en site terug.

## 2. Het programmaatje thuis

Op een Android-telefoon: zie **Op een Android-telefoon (Termux)** hieronder.
Anders: zet de map `brug/` op het apparaat dat altijd aanstaat. Daar:

```bash
npm install                                    # nodig voor Zendure via de cloud
node brug.mjs instellen                        # de instelhulp: zoekt je meters en vraagt de rest
```

**De instelhulp** zoekt je HomeWizard- en Zendure-apparaten (en een GoodWe-omvormer) in de wifi en
vraagt per HomeWizard wat hij meet (de meterkast, zonnepanelen én batterij
samen op één meter zoals in huis A, alleen zonnepanelen, of één apparaat) en hoe
hij heet. Bij elke meter staat wat hij nu doet ("levert nu 121 W", "gebruikt nu
1.372 W"), zodat je ziet welke meter wat is; zie **Een zonnemeter en zijn
teken** hieronder. Een batterij zonder eigen meter is prima: de Zendure meldt zelf wat
hij doet. Daarna de Zendure (lokaal, en dan desgewenst de cloudsleutel als
reserve; of de Autorisatiecloudsleutel plakken), de GoodWe-omvormer (als hij er is, en bij welke panelen hij hoort), de stroomprijzen van Zonneplan (inloggen
kan meteen), de vaste kosten, wat je dit jaar al teruggeleverd hebt, waar het
huis staat, het adres en de sleutel van de app, en als laatste of je
Tuya-apparaten wilt koppelen (Enter = nee; zie `docs/tuya.md`). Bij elke vraag staat tussen
[haken] wat je krijgt met alleen Enter; de tweede keer komt dat uit je huidige
instellingen. Een meter die alleen de nieuwe manier (API v2) kent, krijgt
meteen een code: druk op het knopje als hij erom vraagt. Codes en sleutels
komen niet op het scherm. De instelhulp zegt waar hij zoekt. Ziet het apparaat
zijn eigen netwerk niet, of vindt hij niets, dan vraagt hij welk netwerk; of
geef het mee: `node brug.mjs instellen 192.168.1`. Zitten de meters in een
ander netwerk dan het apparaat (bijvoorbeeld HomeWizards in 192.168.1, telefoon en
Zendure P1 in 192.168.0), noem ze dan allebei:
`node brug.mjs instellen 192.168.1 192.168.0`.

Het adres en de sleutel van de app mag je eerst overslaan (Enter): `proef`
werkt zonder. De app laat ze zien als je je omgeving maakt (stap 1), en de
sleutel maar één keer. Kwijt? In de app bij **Instellingen › Delen › Nieuwe
sleutel**; draai daarna `node brug.mjs instellen` opnieuw en plak hem.

Liever zelf in het bestand? Kopieer `instellingen.voorbeeld.json` naar
`instellingen.json` en maak hem alleen voor jou leesbaar (er komen sleutels in):
`cp instellingen.voorbeeld.json instellingen.json && chmod 600 instellingen.json`.
Vergeten? Het programmaatje zet het bij het starten zelf recht. Zoek de adressen met `node brug.mjs zoek`, koppel de
HomeWizard-meters met `node brug.mjs homewizard-code` (per meter op het knopje
drukken) en vul in:

| Veld | Wat |
|---|---|
| `app.adres` | het adres uit de app (staat bij de sleutel), of de uitkomst van `node scripts/functieAdres.mjs` |
| `app.sleutel` | de sleutel van je omgeving uit de app (48 tekens). Kwijt: **Instellingen › Delen › Nieuwe sleutel** |
| `homewizard[]` | per meter: `naam`, `rol` en `adres`. Rol is `net` (de P1-meter), `zon` (een kWh-meter op panelen), `zon-en-batterij` (een kWh-meter op een groep met panelen én de Zendure, zie hieronder) of `apparaat`. Bij een apparaat mag `soort` (wasmachine, vaatwasser, koelkast, laadpaal, warmtepomp, boiler, tv, …) voor het plaatje. Bij `zon` mag `opwek`: `"min"` (gewoon) of `"plus"` (omgekeerd aangesloten); de instelhulp zet het, zie hieronder. |
| `zendure` | `{ "manier": "cloud", "cloudsleutel": "…" }`, of lokaal: `{ "manier": "lokaal", "adres": "192.168.1.30" }`, of lokaal met de cloud als reserve: `{ "manier": "lokaal", "adres": "192.168.1.30", "cloudsleutel": "…" }` |
| `zendure_p1` | (mag weg) een Zendure P1-meter op dezelfde meterkast: `{ "adres": "192.168.1.23" }`. Om te vergelijken, en als reserve als de HomeWizard P1 niet antwoordt; zie hieronder. |
| `goodwe` | (mag weg) een GoodWe-omvormer van de DT-serie: `{ "adres": "192.168.1.40", "bij": "hw-zon-huis" }`. `bij` is de sleutel van de zonnepanelen (meter) waar hij bij hoort, voor het blad in de app; weg = de eerste. Zie **De omvormer** hieronder. |
| `prijzen` | (mag weg) `"zonneplan"` voor de stroomprijzen van Zonneplan, of `"energyzero"` voor alleen een schatting zonder inloggen. Zie **Stroomprijzen** hieronder. |
| `vaste_kosten` | (mag weg) per maand, in euro: `levering_per_maand` (Zonneplan: 6.25), `netbeheer_per_maand` (staat in je contract in de Zonneplan-app; bijvoorbeeld 39.66, het verschilt per netbeheerder) en `vermindering_energiebelasting_per_maand` (2026: 52.41). |
| `teruglevering_dit_jaar` | (mag weg) wat je dit jaar al teruggeleverd hebt voordat het programmaatje draaide, bijvoorbeeld `{ "jaar": 2026, "kwh": 7247 }`. Staat in de Zonneplan-app bij Inzichten › Jaar › Teruglevering; vul het in vlak voor de eerste start. Alleen voor het plafond van de Zonnebonus. |
| `plaats` | (mag weg) waar het huis staat, voor zonsopkomst en -ondergang (Zonnebonus): `{ "breedte": 52.1, "lengte": 5.18 }`. Weg = De Bilt (het midden van het land). |
| `tuya` | (mag weg, sinds 0.8.0) Tuya-apparaten: per apparaat `naam`, `id`, `local_key`, `adres`, `versie` (3.3, 3.4 of 3.5) en `wat` (`meter`, `lamp` of `schakelaar`); bij een lamp of schakelaar mag `spots: true` (de spotjes in het overstek). Maak het met de instelhulp; zie `docs/tuya.md`. |

**Twee P1-meters op één meterkast** (HomeWizard en Zendure). Ze lezen allebei
de slimme meter en horen hetzelfde te zien. In de app, bij het rondje Net,
staan ze onder elkaar met het verschil erbij. Zo zie je of de meter waar de
batterij op stuurt hetzelfde ziet als de HomeWizard. De HomeWizard blijft de
meter voor het plaatje en de kosten. `zoek` vindt de Zendure P1-meter ook.
`proef` waarschuwt als plus en min bij de twee omgedraaid lijken: geef dat dan
door.

**De Zendure P1 als reserve.** Antwoordt de HomeWizard P1 niet (langer dan een
minuut), dan neemt het programmaatje het net van de Zendure P1 (`net_bron` in
de meting zegt welke; in het logboek staat één regel als hij overschakelt en
één als de HomeWizard terug is). De kosten van vandaag en de teruglevering voor
het plafond lopen door met het vermogen van de Zendure P1 × de tijd. Is de
HomeWizard terug, dan telt van de sprong in zijn tellers alleen wat de reserve
nog niet telde: niets dubbel, en een korte hapering telt gewoon helemaal mee.
Valt ook de Zendure P1 langer dan een minuut weg, dan telt dat stuk niet. Zonder
HomeWizard P1 is de Zendure P1 vanzelf de meter voor het net.

**Een zonnemeter en zijn teken** (sinds 0.6.2). Op een kWh-meter is opwek
meestal min, maar sommige zijn omgekeerd aangesloten (opwek plus). Daarom per
meter met rol `zon` het teken in `opwek`:

- `"min"`: opwek is min; wat hij gebruikt (plus) telt niet als zon;
- `"plus"`: omgekeerd aangesloten; opwek is plus;
- weg (instellingen van vóór 0.6.2): zoals altijd telt wat hij meet, plus of
  min, als zon. Zo blijft een omgekeerd aangesloten meter gewoon werken.

Het teken zet de instelhulp, maar alleen als hij het kan nagaan: overdag, bij
een duidelijk vermogen (50 W of meer). Levert de meter, dan klopt het en komt
het teken erin. Gebruikt hij stroom, dan zegt de instelhulp "Let op" en kies je:
toch iets anders (opnieuw kiezen), de zonnemeter maar omgekeerd aangesloten, of
zo laten. Bewust niet "het teken dat hij nu geeft is opwek": in huis B stonden
twee meters verwisseld en gaf de "zon" overdag ook een flink getal (+1.372 W,
een spa), en de app liet 1,4 kW zon zien. 's Nachts of zonder antwoord vraagt
hij niets en blijft het zoals het was.

Terwijl het programmaatje draait: meet een zonnemeter overdag 3 lezingen op rij
duidelijk verbruik, dan komt er één regel in het logboek en een melding in de
app (bovenaan Apparaten): "De meter 'Zon' meet verbruik (+1.372 W), geen
opwek: staat hij goed in de instelhulp?". Met een bekend teken is dat genoeg;
zonder teken alleen als iets anders laat zien dat er wat niet klopt (een andere
zonnebron of de omvormer levert, of een "apparaat" levert stroom). De melding
blijft tot de meter weer duidelijk opwek meet. `node brug.mjs proef` zegt het
ook, na één lezing.

**De cloud als reserve** (Zendure, sinds 0.6.2). Staat de Zendure lokaal
ingesteld én staat er een `cloudsleutel` bij, dan leest het programmaatje hem
gewoon lokaal. Antwoordt hij lokaal 3 keer op rij niet (dezelfde drempel als
bij de meters), dan komt de stand uit de Zendure-cloud (hooguit 3 minuten oud),
tot hij lokaal weer antwoordt; dan meteen weer lokaal. In het logboek één regel
bij het overschakelen en één bij terug; in de app staat bij Apparaten "via de
cloud (reserve)" en bovenaan een melding. De cloudverbinding gaat pas open als
hij nodig is (bij de tweede gemiste lezing, zodat hij er bij de derde is) en
weer dicht als de Zendure 10 minuten lokaal goed antwoordt: Zendure laat per
account maar één cloudverbinding toe, en als lokaal werkt hoeft die niet bezet
te zijn. Gebruik de sleutel dus niet ook in Home Assistant of Homey. De
instelhulp vraagt erom na "lokaal uitlezen" (Enter = overslaan).

**Op afstand instellen** (sinds 0.7.0). De cloudsleutel kan ook vanuit de app,
zonder naar het apparaat te gaan: **Instellingen › Op afstand** (alleen de
eigenaar en de beheerder). Zo werkt het, en zo blijft hij geheim:

- Het programmaatje maakt bij de eerste start van 0.7.0 een sleutelpaar
  (RSA 2048) in `brug/op-afstand.json`, naast `instellingen.json`, alleen voor
  jou (0600, niet in git). Alleen het **publieke** deel gaat mee naar de app;
  het privé-deel blijft thuis.
- Je plakt de sleutel in de app. Je **browser** versleutelt hem met dat
  publieke deel (een nieuwe AES-256-GCM-sleutel per keer, ingepakt met
  RSA-OAEP). Base44 krijgt en bewaart alleen het versleutelde stuk en kan het
  zelf niet lezen. De app laat daarna alleen zien wanneer hij is ingesteld,
  nooit de sleutel; **Wissen** haalt het stuk van de server.
- Het programmaatje krijgt het stuk mee in het antwoord op een meting (alleen
  het programmaatje met de sleutel van dát huis, en alleen als het voor zijn
  sleutelpaar is), ontsleutelt het, kijkt na of het een cloudsleutel is (sinds
  0.13.0 ook dat hij naar de Zendure-cloud wijst: alleen https en een adres van
  zendure.tech, zendure.com of zendure.cn; de site zegt dat al bij het plakken),
  zet

  hem in `instellingen.json` (bij lokaal als reserve) en start netjes opnieuw.
  Eén regel in het logboek, nooit de sleutel zelf. In de app staat dan "Het
  programmaatje heeft hem overgenomen" (meestal binnen een à twee minuten).
- Lukt het niet (geen Zendure in de instellingen, geen geldige sleutel, of
  het programmaatje kreeg een nieuw sleutelpaar), dan zegt de app dat, en
  verandert er thuis niets.

**Een ander adres van de router** (sinds 1.3.0). Een router deelt de adressen
in de wifi uit, en geeft een meter soms een ander adres (na een stroomstoring,
een nieuwe router, of zomaar). Tot 1.2.0 vond het programmaatje hem dan nooit
meer, en bij een HomeWizard zonder code (v1) kon het zelfs een andere meter op
het oude adres lezen. Nu (`brug/adressen.mjs`):

- **Elk apparaat heeft een vast kenmerk**: een vingerafdruk van zijn
  serienummer (HomeWizard, Zendure, Zendure P1, GoodWe; `brug/kenmerk.mjs`),
  niet het nummer zelf. Staat het serienummer in `instellingen.json` (de
  instelhulp zet het bij HomeWizard), dan is dat het; anders leert het
  programmaatje het bij het eerste antwoord. Het staat thuis in
  `brug/adressen.json` (naast `instellingen.json`, in `.gitignore`) en gaat
  nooit naar de app.
- **Elk antwoord wordt nagekeken**: de Zendure noemt zijn serienummer in elk
  antwoord, een HomeWizard met code in het certificaat van elke nieuwe
  verbinding, een HomeWizard zonder code via `/api` (bij elke nieuwe
  verbinding, na een misser en elke 10 minuten), de GoodWe na elk gat (ook
  elke ochtend). Zit er een ander apparaat, dan tellen die cijfers niet.
- **Zoeken**: antwoordt een apparaat 3 minuten niet (de omvormer: een uur
  overdag; 's nachts slaapt hij), of zit er een ander apparaat op zijn adres
  (dan meteen), dan zoekt het programmaatje het in hetzelfde netwerk als het
  oude adres (bijvoorbeeld 172.16.0 of 192.168.1), alleen naar dat merk,
  rustig (acht adressen tegelijk) en op de achtergrond: het meten gaat gewoon
  door. Hooguit één zoektocht per 5 minuten; niet gevonden, dan na een
  kwartier opnieuw, dan na een uur, daarna elke 3 uur.
- **Gevonden**: meteen het nieuwe adres gebruiken en bewaren in
  `adressen.json`, met een regel in `brug.log` ("Meterkast gevonden op een
  nieuw adres: 172.16.0.20 → 172.16.0.31") en een kwartier een melding in de
  app (soort `adres`, zonder adres), die zo ook in het Logboek op Apparaten
  komt. `instellingen.json` blijft zoals hij is; bij de start staat in het
  logboek welk adres anders is. Zet je met de instelhulp zelf een ander adres,
  dan geldt dat weer.
- Niet voor Tuya-apparaten (die zoek je opnieuw met de instelhulp) en de
  Zendure via de cloud (die heeft geen adres). Wil je het helemaal niet meer
  meemaken: geef de meters in de router een vast adres ("DHCP-reservering").

**Blijvende verbindingen** (sinds 1.3.0). Het programmaatje maakte elke 5 s een
nieuwe beveiligde verbinding met Base44 en een nieuwe met elke meter. Nu gaat
het volgende verzoek over dezelfde verbinding (keep-alive, `brug/web.mjs`):
minder werk voor de telefoon en de meters. Een verbinding die even niets doet
gaat na 20 s dicht; een hangende verbinding houdt de ronde niet op (de harde
tijdslimiet blijft), en een verbinding die de andere kant net sloot, wordt één
keer vervangen door een nieuwe.
- Een programmaatje van voor 0.7.0 heeft geen sleutelpaar: dan zegt de app
  "werk het programmaatje eerst bij". De sleutel van het programmaatje
  (Instellingen › Delen) blijft net zo geheim als de cloudsleutel zelf: wie die
  heeft, kan zich voor het programmaatje uitgeven.
- **Vingerafdruk** (sinds ronde 19). Het publieke deel komt via de server. De
  app laat daarom een korte vingerafdruk zien (zoals `a1b2 c3d4 e5f6 0718`);
  het programmaatje laat dezelfde zien bij `node brug.mjs proef`. Vergelijk ze
  één keer. De eerste keer dat je iets klaarzet, onthoudt de server dat
  sleutelpaar. Meldt zich later een ander paar, dan waarschuwt de app met
  beide afdrukken en kun je pas weer klaarzetten na "Klopt, dit is mijn
  programmaatje" (de server weigert het anders ook). Klopt de afdruk op het
  toestel niet, bevestig dan niet: dan gebruikt iemand anders de sleutel van
  het programmaatje. Maak bij Delen een nieuwe sleutel.

**Zon en batterij op één meter** (zoals "Batterij + Zon": de GoodWe en de
SolarFlow 2400 AC op dezelfde groep). De meter ziet alleen de som. Het
programmaatje haalt er de batterij uit met de cijfers van de Zendure zelf:

```
zon = −(wat de Zendure nu aan het huis geeft) − wat de meter meet
```

's Nachts laden met 2300 W: meter +2300, Zendure −2300, zon 0. Overdag 3000 W
zon en 1000 W laden: meter −2000, Zendure −1000, zon 3000. Alle meters worden
tegelijk gelezen en één scheve meting wordt gladgestreken. Weet je wat de
panelen hoogstens leveren, zet dan `"piek_w": 4000` (bijvoorbeeld) bij die
meter. Via de cloud kan de Zendure een paar tellen achterlopen; daarom die
gladstrijking. Lukt lokaal later toch, dan is het nog iets preciezer.

Elke meter met panelen (`zon` of `zon-en-batterij`) krijgt een eigen
zon-rondje in de app, bijvoorbeeld "Zon huis" en "Zon dierenverblijf".

**Stroomprijzen (Zonneplan).** Eén keer inloggen:

```bash
node brug.mjs zonneplan-login     # je e-mailadres, dan de code van 6 cijfers uit de mail van Zonneplan
```

De sessie komt in `brug/zonneplan-sessie.json` (niet in git; behandel het als
een wachtwoord). Het programmaatje ververst hem zelf. Lukt dat ooit niet meer,
dan zie je dat in het logboek en log je gewoon opnieuw in.

Wat de app laat zien, per kwartier, zoals Zonneplan rekent (bevestigd door
Zonneplan in oktober 2026: het contract "Stroom tegen kwartierprijzen", Kiki in
de app, en de mail "Salderen stopt op 1 januari"):

- **Afnemen**: de prijs uit de Zonneplan-app, alles erin: marktprijs,
  inkoopvergoeding (€ 0,02), energiebelasting (€ 0,11085) en btw.
- **Terugleveren** in 2026: evenveel als afnemen (saldering loopt tot en met
  2026), plus de **Zonnebonus**: 10% van de prijs zonder energiebelasting
  (marktprijs + inkoopvergoeding), met 21% btw. Alleen tussen zonsopkomst en
  zonsondergang en alleen als dat bedrag boven nul is. Zon op en onder rekent
  het programmaatje uit voor de `plaats` uit `instellingen.json`, zonder plaats
  voor De Bilt (`brug/zon.mjs`).
- **Vanaf 2027** (geen saldering meer): de belastingen vallen weg. Je krijgt de
  marktprijs plus de Zonnebonus, zonder terugleverkosten. Bron: de mail van
  Zonneplan van 29-09-2026 ("Salderen stopt op 1 januari"); vastgelegd als
  `EINDE_SALDERING` en `TERUGLEVERKOSTEN_PER_KWH = 0` in `brug/prijzen.mjs`.
  Voor elk huis bij Zonneplan dezelfde regels.
- **Plafond**: "De zonnebonus geldt voor de eerste 7.500 kWh die je per
  kalenderjaar teruglevert" (contract). Alle teruglevering telt dus mee, ook
  's nachts of bij een negatieve prijs. Het programmaatje telt met de teller
  van de P1-meter, dus ook als het een tijd uit stond, plus wat je bij
  `teruglevering_dit_jaar` invult. Na 7.500 kWh rekent het tot 1 januari
  zonder Zonnebonus. De app laat zien hoeveel er nog over is. Teruglevering via
  Powerplay (de batterijhandel van Zonneplan) telt volgens het contract niet mee;
  het programmaatje gaat ervan uit dat de batterij van jezelf is.
- **Nagelopen met het contract** (31-10-2026, dynamisch, kwartierprijzen EPEX Day
  Ahead): terugleveren = EPEX + € 0,02 inkoopvergoeding (die krijg je dus ook bij
  teruglevering; met btw, in de reserve van EnergyZero precies € 0,02), met
  saldering t/m 2026 de energiebelasting erbij; de Zonnebonus is nooit negatief;
  vanaf 2027 kost terugleveren pas geld als EPEX (met btw) onder −€ 0,02 komt. Het
  contract noemt de bedragen van 2025 (energiebelasting € 0,12286, korting € 52,93
  per maand); het programmaatje rekent met die van 2026 (€ 0,11085 en € 52,41).
- **Vandaag**: precies wat de tellers van de P1-meter optellen, maal de prijs
  van dat kwartier.
- **Vaste kosten** (als je `vaste_kosten` invult): levering (€ 6,25) en
  netbeheer (bijvoorbeeld € 39,66, volgens je contract) per maand, min de
  korting op de energiebelasting (€ 52,41 per maand in 2026), gedeeld door de
  dagen van de maand. In de app als "Vaste
  kosten" of, als de korting groter is, "Vaste korting", en verrekend in
  "Netto". Bedragen voor 2027 nakijken als ze bekend zijn.
- Niet meegenomen: wat er in 2026 gebeurt als je over het hele jaar meer
  teruglevert dan afneemt.

**Hoe vaak.** Bij een dynamisch contract liggen de prijzen van morgen rond
13:00 vast. Het programmaatje vraagt ze dus op bij het starten, en daarna elke
dag vanaf 13:00 elk kwartier tot de prijzen van morgen er zijn.

Antwoordt Zonneplan even niet, dan rekent het programmaatje met de kale
marktprijs van EnergyZero en de opbouw van Zonneplan. Dat scheelt hooguit een
fractie van een cent; de app zet er dan "schatting" bij, en het programmaatje
probeert Zonneplan elk kwartier opnieuw. Verloopt de sessie eerder dan gezegd,
dan ververst hij hem meteen (0.13.0); kan dat niet meer, dan staat "opnieuw
inloggen nodig" bij Apparaten. Het ophalen houdt de meetronde nooit op: hangt
het internet half, dan gaat de stand zonder prijs door tot die er is (alleen de
allereerste ronde wacht hooguit 5 s).


Proberen zonder iets te versturen, daarna echt starten:

```bash
node brug.mjs proef
node brug.mjs
```

`proef` laat per meter zien wat hij leest, de prijs, het weer, de korte
vingerafdruk van het sleutelpaar voor op afstand ("Sleutel op afstand: a1b2
c3d4 e5f6 0718", dezelfde als in de app bij Instellingen › Op afstand) en
onderaan kort wat er naar de app zou gaan (sinds 0.13.0; de hele meting met
`proef --alles`). Of de app hem aanneemt (sleutel en adres):
`node brug.mjs proef --versturen` stuurt de stand één keer; doe dat alleen
als het programmaatje zelf nog niet draait.

Altijd laten draaien op een Raspberry Pi: zie `brug/thuis-energie-brug.service`.

**HomeWizard API v2** (de nieuwere manier, met een code in plaats van "Lokale
API"): `node brug.mjs homewizard-code 192.168.1.20`, druk op de knop van de
meter, en zet de code die je krijgt bij die meter als `"code"`.

**Wat het programmaatje meestuurt** (versie 0.5.0). Alleen getallen en namen,
nooit codes, sleutels of serienummers:

- **Elke keer** (elke 5 s): de stand van nu (net, zon per plek, batterij,
  apparaten, prijs, vandaag, het plafond van de Zonnebonus) en **per fase** van
  de P1-meter het vermogen, de stroom en de spanning (L1, L2, L3; bij één fase
  alleen L1). Sinds 0.5.0 ook **wat de batterij zelf meldt** (zie hieronder).
- **Elke minuut** erbij: **de dag** per kwartier (zon, huis, batterij, net, hoe
  vol de batterij was, en per fase de stroom en het vermogen), de kWh van
  vandaag, per fase het gemiddelde en de piek, en de daggemiddelden per fase van
  de zeven dagen ervoor. En **wat er gekoppeld is**: per apparaat de naam, het
  merk, de soort, het adres in je wifi, of het antwoordt (en zo niet, sinds
  wanneer) en wat het nu meet; plus de versie van het programmaatje, sinds
  wanneer het draait en waar de prijzen vandaan komen.
- **De prijzen per kwartier** van vandaag en morgen, met de Zonnebonus (en het
  plafond) erin verrekend, als ze veranderen en verder eens per kwartier.
  Een schatting (EnergyZero) staat erbij als schatting.
- **Het weer** (sinds 0.9.0) per uur van vandaag en morgen: zonnestraling
  (W/m²), bewolking (%) en temperatuur (°C), sinds 0.10.0 ook de weercode,
  neerslag (mm), kans op neerslag (%) en windstoten (km/h), als het verandert
  en verder eens per kwartier. Zie **Het weer** hieronder.
- **De zon per plek** (sinds 0.10.0): met panelen op twee of meer plekken (zoals
  het hoofddak en het dierenverblijf) in de dag ook per plek het gemiddelde per
  kwartier, zodat de app per plek leert wat die bij zoveel licht levert.

- **Wat het herkent** (sinds 0.11.0): wat nu aan staat, eerder vandaag, de
  basis, terugkerende onbekenden en deze week per apparaat, als het verandert
  en verder eens per minuut. Zie **Apparaten herkennen** hieronder.
- **Apparaten per dag** (sinds 0.12.0): in de dag (elke minuut) ook
  `apparaten` (per apparaat de kWh en het aantal keer van vandaag, hooguit 30,
  meeste eerst; `gemeten: true` bij een eigen meter) en `basis_kwh`. De app
  bewaart dat in de rij van die dag (Dag.apparaten_kwh, Dag.basis_kwh), zonder
  aanroep extra.

- **Storingen op het net** (sinds 0.13.0): telt de P1-meter een
  stroomonderbreking, een spanningsdip of een spanningspiek (per fase) meer
  dan bij de vorige lezing, dan een kwartier een melding (soort `net`,
  "Meterkast: spanningsdip op L2 gemeten (21:14)"); zo staat hij ook in het
  Logboek op Apparaten. Een onderbreking waarbij het programmaatje zelf uitviel,
  ziet hij niet (dan is er een gat: "geen cijfers").

Base44 onthoudt van elk veld de laatste waarde, dus wat niet elke keer meegaat,
blijft gewoon staan. Alles samen is ruim onder de 20.000 tekens: sinds 0.13.0
gaan de extra blokken mee zoveel als er onder de 18.000 passen, wat het langst
wachtte eerst; de rest gaat 5 s later mee (`kiesExtras` in
`brug/versturen.mjs`). Zo valt bij een groot huis niet meer telkens de dag weg.
 De dag staat
thuis in `brug/vandaag.json` (met de kosten), dus een herstart verliest hem
niet; een tijd zonder programmaatje is een gat in de grafiek. De grafieken van
vandaag beginnen pas als 0.4.0 draait: de app zegt "Geschiedenis vanaf …".

**De dagen bewaart de app zelf.** Uit wat het programmaatje toch al stuurt
(vandaag, de dag per kwartier en de prijzen) schrijft de app per huis per dag
één rij in de tabel Dag: de kWh, het geld, eigen verbruik, zelfvoorzienend en
per fase het gemiddelde. Hooguit eens per kwartier, en vlak na middernacht nog
één keer de laatste stand van gisteren. Zo heeft het tabblad Overzicht een
week, maand, kwartaal en jaar, ook op een nieuwe telefoon. Het programmaatje
hoeft daarvoor niet bijgewerkt te worden; de geschiedenis begint op de dag dat
deze versie van de app live staat. De Zonnebonus per dag is een schatting (per
kwartier wat er teruggeleverd werd maal de Zonnebonus van dat kwartier): het
programmaatje telt hem niet apart.

**Wie aan wie, per meting** (sinds 1.2.0). Eigen verbruik en zelfvoorzienend in
de tabel Dag rekende de app uit de gemiddelden per kwartier. Kookte je een
kwartier lang half op stroom uit het net en ging de andere helft zon terug, dan
leek dat kwartier helemaal op de zon te draaien. Vanaf 1.2.0 verdeelt het
programmaatje elke meting (elke 5 s) zelf, met dezelfde regel als de app (de
batterij voorop), en telt het op hoeveel kWh van de zon in huis of batterij
bleef (`kwh.zon_zelf`) en hoeveel het huis uit het net haalde (`kwh.net_huis`).
Daar rekent de app dan mee; een oudere versie stuurt ze niet, dan blijft het per
kwartier. Op het scherm verandert niets: de kaart Energie rekende al met de kWh
van de meters (uit het net en teruggeleverd van de P1-meter, zon en huis per
meting opgeteld).

**Wat de batterij zelf meldt** (sinds 0.5.0). De Zendure meldt meer dan vermogen
en vulling. De app laat het zien in het blad van de batterij (tik op het rondje)
en op het tabblad Apparaten bij de Zendure, in gewone woorden:

- de **temperatuur** binnenin de Zendure en (sinds 0.7.0) **per accu** een regel,
  zoals "Accu 1 · 24 °C · 41%" (hooguit acht; een oudere versie meldt alleen de
  warmste en de koelste);
- de **spanning** en de **stroom**;
- tot hoe vol hij **laadt** en tot hoe leeg hij **ontlaadt** (zoals ingesteld in de
  Zendure-app);
- hoe lang nog tot **vol** of **leeg**: wat de Zendure zelf zegt, of anders een
  schatting met de inhoud van de accu's en het vermogen van nu;
- of hij zichzelf **verwarmt** (bij kou), of hij **kalibreert**, het
  **wifi-signaal**, hoeveel **accu's** en hun inhoud samen, de **gezondheid** (als
  hij die meldt) en een **storing** (bovenaan, in oranje: kijk dan in de Zendure-app).

Alles alleen lezen: het programmaatje verandert niets aan de batterij. Wat niet
aannemelijk is of wat een oudere Zendure niet kent, laat het weg; serienummers
gaan nooit mee. Over temperatuurgrenzen zegt de app niets: voor de 2400 AC geeft
Zendure alleen een bedrijfstemperatuur van −20 tot 60 °C op, geen grenzen voor
laden en ontladen. Bronnen: zenSDK en de Home Assistant-koppeling van Zendure
(onderaan). `node brug.mjs proef` laat het ook in woorden zien.

**Het weer** (sinds 0.9.0). Voor Advies haalt het programmaatje het weerbericht
bij [Open-Meteo](https://open-meteo.com/en/docs) (gratis, geen sleutel, geen
account): per uur van vandaag en morgen de zonnestraling, de bewolking en de
temperatuur, en sinds 0.10.0 (voor het tabblad Voorspelling) ook de weercode
(zon, wolken, regen, onweer, sneeuw, mist), de neerslag, de kans op neerslag en
de windstoten, op de `plaats` uit `instellingen.json` (zonder plaats De Bilt),
afgerond op twee decimalen (ongeveer een kilometer). Meteen bij het starten,
daarna hooguit eens per uur; lukt het niet, dan een kwartier later nog eens, en
tot 3 uur lang het laatste goede bericht. Eén regel in het logboek als het
misgaat en één als het weer lukt. Het gaat mee in de meting die toch al
verstuurd wordt: geen aanroep extra naar de app. `node brug.mjs proef` laat
het zien als "Weer: morgen veel zon (5,2 kWh/m²), bewolking 30%, droog" (sinds
0.10.0 met de regen: "…, 3,4 mm regen"), of "Weer:
niet bereikbaar" (met de reden), en daaronder het weer van nu ("Weer nu: lichte
regen, 0,4 mm, wind 22 km/h (stoten 41 km/h)") voor de tekening van het huis. Een oudere app laat het weer gewoon liggen;
een oudere brug stuurt geen weer, en dan rekent Advies zoals vroeger.

**Apparaten herkennen** (sinds 0.11.0, `brug/herkennen.mjs`). Het programmaatje
kijkt naar het **huisverbruik** (zon + batterij + net), niet naar de meterkast:
de Zendure springt binnen seconden bij, dan blijft de P1 op nul terwijl het
huis 2 kW meer gebruikt. Wat al een eigen meter heeft (zoals de spa in huis B)
gaat er eerst af. Daarin zoekt het sprongen die twee lezingen op rij blijven
staan, koppelt aan en uit, en kijkt naar de grootte, de duur, de fase (de P1
per fase, alleen als aanwijzing), of het pulseert (strijkijzer), in cycli gaat
(oven), onrustig is (stofzuiger) of in een ritme terugkomt (koelkast). Het
verwarmen van een wasmachine heet "wasmachine, verwarmt" zodra de trommel en de
centrifuge erna komen. De **basis** loopt langzaam mee zonder sprongen (een
warmtepomp die van 400 naar 500 W kruipt) en wordt per huis geleerd: het
laagste van de nachten is "altijd-aan"; een warmtepomp neemt het alleen aan als
de basis flink en langzaam wisselt op een hoog niveau. Raden gaat met
startprofielen per soort (gangbare vermogens en vormen: Milieu Centraal,
typeplaatjes, de NILM-datasets REDD en UK-DALE) plus wat jij aanwijst. In de
app (Apparaten › Wat gebruikt er nu stroom?, onder "Eerder vandaag en
aanwijzen") zeg je per regel **Klopt** of **Dat was …**; wat vaker terugkomt en onbekend is, vraagt de app als groep
("Onbekend apparaat A: zo'n 1,2 kW, zo'n 20 minuten, meestal 's avonds"), en
één keuze benoemt ze allemaal. De labels gaan terug naar het programmaatje in
het antwoord op de meting (geen aanroep extra). Wat vaak bevestigd is wordt
"zeker", wat vaak verbeterd wordt zakt; het gewone tijdstip per apparaat telt
licht mee. Per week telt het per apparaat hoe vaak en hoeveel kWh, en sinds
0.12.0 ook per dag, plus de basis in kWh (altijd-aan en een warmtepomp die
kruipt; een warmtepomp die als apparaat herkend is, telt bij dat apparaat).
Een herkend apparaat telt pas tien minuten nadat het uitging; een eigen meter
telt meteen. Sinds 0.13.0 gaan de kWh naar de tijd over de dagen (een
vaatwasser over middernacht), en wat bij een dag zou landen die al voorbij is
(de app neemt die niet meer aan), telt bij vandaag: wat na 23:50 uitgaat, raakt
niet meer kwijt. Een puls of cyclus (strijkijzer, oven) telt alleen de tijd dat
hij echt aan was, een apparaat dat langer dan 12 uur aan staat telt alsnog (bij
de warmtepomp als hij zo herkend is, anders bij de basis), en een label op één
keer en daarna op zijn groep telt die keer één keer. Groepen onbekenden: een
nieuwe blijft staan, eenmalige vervallen na twee weken. Wat het
onthoudt staat in `brug/herkennen.json` (in `.gitignore`), net zo veilig
bewaard als `vandaag.json` (met `herkennen.json.vorige`); kapot, dan gaat het
verder met de vorige, en zijn ze allebei weg, dan begint het opnieuw en komen
de labels weer uit de app. Een oudere app laat het
blok liggen; een oudere brug stuurt het niet, en dan vraagt de kaart om bij te
werken.

**Handtekeningen en vragen** (programmaatje 1.4.0, `brug/herkennen.mjs`). Per
aan-en-uit ook de vorm: een korte piek bij het aangaan (aanloopstroom van een
motor), traag aanlopen en afbouwen (warmtepomp), golven (motor), aan-en-uit
(strijkijzer, oven) of één rustig blok (verwarmingselement). Wat lijkt (zelfde
familie van vorm, vermogen ±20%, duur, fase) komt in één groep, ook wat alleen
op een profiel geraden is, met de laatste begintijden, hoe vaak vandaag en per
dag. Na drie keer vraagt de app de eigenaar bovenaan de kaart "Er komt iets
terug van zo'n 1,8 kW … Wat is het?" (hooguit twee tegelijk, een stipje bij
Apparaten); "Weet ik niet" of "Later" is een label `{ id, later: true }` dat
de server een week bewaart en nooit naar het programmaatje stuurt (de stand
zet dan `later` bij die groep; dit toestel onthoudt het ook). De kaart zegt
wat het kent ("Ik ken nu 4 apparaten van je; 2 vragen staan open", per
apparaat hoe zeker in het blok eronder: `herkend.kennis`). Een terugkerende
groep zonder naam staat per dag apart in Overzicht › Apparaten ("Onbekend
apparaat A, zo'n 1,8 kW", sleutel `h:onbekend:<groep>`), niet in de Rest.
Kijkers krijgen geen vragen en geen begintijden. Een oudere brug: geen kennis,
dan alles zoals eerst.

**Meer uit de apparaten** (programmaatje 1.4.0, ronde 23; alles alleen lezen):

- **Meterkast** (`meterkastUit` in `brug/homewizard.mjs`, `Meting.meterkast`): het
  tarief van nu (`active_tariff`/`tariff`: 1 = dal, 2 = normaal), het gemiddelde
  van het kwartier en de maandpiek als de P1-meter die geeft, en de meters die
  aan de slimme meter hangen (v1 `total_gas_m3` met `gas_timestamp`, en
  `external[]` in v1 en v2: gas, water, warmte) met hun stand en tijd. Gas,
  water en warmte per dag rekent het programmaatje zelf (`brug/dag.mjs`, vanaf
  de laatste stand van gisteren) en gaan mee in de dag (`Dag.gas_m3`,
  `water_m3`, `warmte_gj`). Op Nu een tegel Meterkast en in het blad van het
  net; in Overzicht gas (en water) per dag of periode. Zonder gasmeter staat er
  niets. **Zelf invullen**: bij Instellingen › Gas vult de eigenaar
  gasmeterstanden in (datum en stand in m³, actie `gasStand`, op
  `Opstelling.gas_standen`, hooguit 400, oplopend); Overzicht verdeelt het
  verschil tussen twee standen eerlijk over de dagen ertussen
  (`src/lib/gasStanden.js`). Met gas van de slimme meter gaat de meter voor.
- **Omvormer** (GoodWe DT, registers uit de Home Assistant-bibliotheek goodwe,
  `dt.py`): arbeidsfactor (30139), koelplaat (30142), uren in bedrijf (30147),
  busspanning (30163), en apart gevraagd de isolatie van de panelen (30173, "ISO
  test value", aangenomen kΩ) en de lekstroom (30210, tienden mA). Onder 100 kΩ
  of vanaf 150 mA, twee minuten lang, een melding (soort `omvormer`) in de app
  en in het Logboek; weer goed na vijf minuten.
- **Batterij** (zenSDK): per accu de laagste en hoogste celspanning
  (`minVol`/`maxVol`), gezondheid, laadcycli als hij die meldt, en of hij zich
  verwarmt; de ingestelde laad- en leverlimiet (`inputLimit`, `outputLimit`).
  Tot 6 accu's per SolarFlow 2400 AC en tot drie 2400 AC's: 18 accu's samen
  (meer dan 4: op één regel met elke accu apart in een blok dat dicht staat).
  Past de meting zo niet, dan gaan de accu's die ronde korter mee
  (`minderAccus` in `brug/versturen.mjs`). En het leert hoeveel kWh er echt
  per procent uit of in gaat (`brug/batterijLeren.mjs`, stukken van 10%,
  bewaard in `batterij-geleerd.json`): `batterij_info.geleerd`, waarmee de app
  zegt hoe lang nog ("geleerd van jouw batterij").
- **Kennis terug** (`brug/kennis.mjs`): hooguit eens per dag per apparaat de
  namen van de velden die het teruggeeft (met een getal als dat niets
  herkenbaars is; nooit serienummers, MAC/IP, wifinamen, sleutels of tokens),
  op de server de laatste lijst per huis (`Meting.kennis`, niet met de stand
  mee); alleen de beheerder ziet hem, in Instellingen › Account onder elk huis.

### Programmaatje 1.5.0, 1.6.0 en 1.6.1: de omvormer bij een negatieve prijs

Eén uitzondering op "alleen lezen" (31-10-2026: "ja uitzetten voor
stroomprijs; nog beter dat jij dat zelf kan doen"): het programmaatje mag de
**GoodWe-omvormer** zelf **begrenzen** als terugleveren geld kost, en hem daarna
weer **vrijgeven**. Alleen bij een GoodWe (in huis B gebeurt er niets), alleen als
de eigenaar het in de app aanzet (standaard uit), en niets anders.

- **Twee registers, een harde lijst** (`brug/omvormerSturen.mjs`, het enige bestand
  dat iets schrijft), met Modbus 0x06: de **grens** 40336 (in de bibliotheek
  goodwe, `dt.py`: `grid_export_limit`, "Grid Export Limit" in %, voor de
  driefase-DT zoals de GW8000-DT) met alleen 0, 10, 20 … 100, en sinds 1.6.0 de
  **schakelaar van die grens** 40327 ("Grid Export Limit Enabled") met alleen 0 of
  1 ("ja dat mag"). Gemeten in huis A (31-10-2026, met 1.5.0): grens 2%,
  schakelaar uit, en hij leverde gewoon 335 W: de grens doet alleen iets als de
  schakelaar aan staat. Start/stop (40330/40331) gebruikt hij niet.
  `omvormerSturen.test.js` loopt alle registers na en bewijst dat er alleen deze
  twee met deze waarden uit kunnen.
- **Hoe**: begrenzen = eerst de grens op de gewenste waarde (teruglezen), dan de
  schakelaar aan (teruglezen); bijstellen = alleen de grens; **vrijgeven = alleen
  de schakelaar uit** (teruglezen): de grens blijft staan, precies zoals de
  installateur hem achterliet. Klopt een teruglezing niet: één keer opnieuw, dan
  opgeven en de schakelaar uit. Hoe hij stond voor het programmaatje hem ooit
  bediende (grens en schakelaar), bewaart het in `omvormer-sturen.json` en laat de
  app zien (Instellingen › Omvormer).
- **Wie is de baas**: staat de schakelaar uit, dan is de omvormer vrij, wat de
  grens ook zegt (de 2% in huis A is dus geen "eigen grens van een ander"). Staat
  hij aan terwijl het programmaatje hem niet aanzette (de installateur, de app van
  GoodWe), dan schrijft het programmaatje niets en zegt dat. Een bestand van 1.5.0
  kent "door ons" niet: dan is een aan-staande schakelaar niet van ons.
- **Wanneer** (`brug/omvormerPlan.mjs`): alleen als een teruggeleverde kWh echt
  minder dan niets waard is. Tot 2027 (saldering) en als je over het jaar meer
  afneemt dan teruglevert, komt de energiebelasting terug: dan loont begrenzen pas
  bij een prijs die ook mét belasting onder nul is (de app zegt dan "door de
  saldering loont begrenzen nog niet; vanaf 2027 wel"). Vanaf 1-1-2027
  (`EINDE_SALDERING` in `brug/prijzen.mjs`, al zo in de kosten) telt de kale prijs
  plus de Zonnebonus. Lever je over het jaar meer terug dan je afneemt, zet dat dan
  in de app (Instellingen › Omvormer). Zodra de prijzen van morgen er zijn (rond
  13:00) staat het plan vast: blokken van negatieve kwartieren (een gat van één
  kwartier overbrugd). Een schatting (EnergyZero als reserve) begrenst nooit.
- **Hoeveel, en live bijgestuurd**: niet blind uit. Pas als er twee minuten lang
  meer dan 300 W teruggaat, begrenst hij tot ongeveer wat het huis en de batterij
  nu gebruiken plus 300 W (in stappen van 10% van 8 kW). Gebruikt het huis alles
  zelf, dan blijft hij aan. Komt er een minuut lang meer dan 150 W uit het net
  (of springt de batterij bij: de wasmachine), dan omhoog of vrij; gaat er weer
  twee minuten veel terug, dan iets omlaag. Helemaal uit (0%) alleen als ook
  afnemen geld oplevert.
- **De zelfcontrole** (1.6.0: "als je denkt dat het werkt, zetten we het
  gewoon aan"): na elke begrenzing kijkt het programmaatje 1 tot 3 minuten of het
  effect er is, alleen als er genoeg zon is om het te zien (vooraf minstens 600 W
  meer dan de grens). Levert de omvormer niet meer dan ongeveer de grens (+400 W),
  of zakt de teruglevering op de P1 tot de helft: "nagekeken: werkt", met datum.
  Blijft hij leveren, of levert hij veel minder dan bedoeld (0 W bij 50%: dan telt
  de grens anders, bijvoorbeeld in 0,1%): sinds 1.6.1 eerst nog één keer kijken,
  dan de schakelaar uit, en het
  programmaatje stuurt niet meer tot de eigenaar het in de app opnieuw aanzet
  ("Opnieuw proberen"); een regel in het Logboek. In de app bij Instellingen ›
  Omvormer en op de omvormerkaart: "Nog niet nagekeken", "Nagekeken op 1 nov: van
  3,1 kW naar 0,4 kW" of "Werkt niet op deze omvormer, uitgezet", en tijdens een
  blok een regel met de grens, wat hij levert en wat er naar het net gaat.
- **De schrijfrem**: we nemen aan dat de omvormer grens en schakelaar in zijn
  flashgeheugen bewaart (instellingen die een herstart overleven; bevestigd is het
  niet), dus zuinig. Elke schrijfactie telt, op beide registers: een begrenzing is
  2 (de grens niet als hij al goed staat), bijstellen 1, vrijgeven 1. Omlaag
  minstens 5 minuten na de vorige schrijfactie, omhoog minstens 1 minuut, hooguit
  8 per uur en 30 per dag (een normale dag met twee blokken en een paar
  bijstellingen past ruim), ook na een herstart (`omvormer-sturen.json`).
  Vrijgeven mag altijd.
- **Bij twijfel vrij**: bij stoppen (Ctrl+C, `node brug.mjs stop`, `systemctl
  stop`, een fout of de waakhond) zet hij eerst de schakelaar uit; bij het
  opstarten buiten een blok kijkt hij of hij nog door ons begrensd staat. "Door
  ons" bewaart hij vóór hij de schakelaar aanzet, zodat ook een stroomstoring
  daartussen goed afloopt. Zet iemand anders de schakelaar uit, dan vecht hij niet;
  staat onze schakelaar aan met een grens die wij niet zo zetten: schakelaar uit.
  's Nachts slaapt de omvormer: dan wacht hij gewoon.
- **Aanzetten**: in de app, **Instellingen › Omvormer** (alleen de eigenaar):
  "Omvormer begrenzen als terugleveren geld kost". Per dag "Vandaag niet" of
  "Morgen niet", en tijdens een blok **Nu weer aan** (meteen vrij, de rest van dat
  blok niet meer). De functie `ontvangMeting` geeft de instelling elke meting mee
  terug (`omvormer_sturen`, sinds 1.6.0 met `op`: wanneer de eigenaar het laatst
  iets veranderde); een oudere functie doet dat niet: dan staat het uit.
- **Zien**: op Apparaten bij de omvormer en bij de prijzen in Overzicht het plan
  ("Morgen 12:00–15:15 begrensd tot ~1,2 kW: terugleveren kost dan tot 4 ct/kWh")
  en de stand ("Begrensd tot ~1,5 kW sinds 12:00 door het programmaatje, past zich
  aan je verbruik aan"). In het Logboek één regel per blok (begin, hoe vaak
  bijgesteld, einde), en elke mislukte poging, "Nu weer aan" of "werkt niet op deze
  omvormer". Kijkers zien er niets van.
- **Samen testen** bij de omvormer (hoeft niet meer, de zelfcontrole doet het ook;
  het programmaatje eerst stoppen): `node brug.mjs omvormer-test`. Hij leest grens
  en schakelaar (schakelaar uit en grens 2%: gewoon doorgaan), vraagt om Enter,
  begrenst 2 minuten naar 0% (grens 0, schakelaar aan) met aftellen en het vermogen
  elke 5 seconden, bij meer dan 2 kW zon daarna kort 50% (telt de grens in % of in
  0,1%?), zet de schakelaar uit, leest terug en zegt in gewone woorden wat er
  gebeurde: "Het vermogen ging van X W naar Y W: de begrenzing werkt" of "Het
  vermogen bleef ~X W: deze omvormer begrenst zo niet (of er was te weinig zon om
  het te zien); zet de schakelaar in de app niet aan". Onder 300 W zon zegt hij dat
  het beter op een zonnig moment kan. Ctrl+C zet de schakelaar meteen uit (sinds
  1.6.1 ook een stop via `kill`/`systemctl` en een ssh-verbinding die wegvalt). De
  uitkomst telt ook als zelfcontrole. `node brug.mjs proef` laat het plan voor
  vandaag en morgen, de grens en de schakelaar zien, zonder iets te schrijven.
- **1.6.1: veiliger begrenzen** (na een onafhankelijke controle):
  - **Niet heen en weer**: helemaal uit (0%) echt alleen als afnemen geld oplevert,
    ook als de som per uur 0% net goedkoper vindt (2027, kaal −10 ct, afnemen
    +3 ct, huis 1 kW, zon 4 kW: eerst 21 schrijfacties in 2,5 uur, nu 2). Begrensd
    rekent hij met wat de zon zou kunnen (de laatste lezing zonder grens, hooguit
    een half uur oud), niet met wat de grens nog doorlaat.
  - **Nooit stil "vrij"**: pas na een geslaagde stap neemt hij een stand aan.
    Mislukt het teruglezen na het aanzetten én daarna het vrijgeven, dan weet hij
    het niet ("onbekend"): hij blijft lezen en vrijgeven tot het lukt.
  - **Stoppen midden in het begrenzen**: bij stoppen (Ctrl+C, `systemctl stop`, de
    waakhond) schrijft hij niets meer behalve vrijgeven, wacht hij hooguit 5 s op
    de lopende ronde, en geeft hij vrij als de schakelaar misschien door ons aan
    staat (`schakelaar_door_ons`); samen hooguit 25 s.
  - **Een wolk is geen "werkt niet"**: de zelfcontrole kijkt eerst nog één keer;
    "levert veel minder dan bedoeld" telt alleen als een andere zonmeter niet net
    zo zakte, hij de grens niet even toch haalde en de zon vooraf niet al sterk
    wisselde (dan: geen oordeel, bij een volgende begrenzing opnieuw).
  - **"Dag niet"**: een nieuw gekozen dag valt niet meer stil weg; voorbije dagen
    gaan eerst, en staan er al 14 komende, dan een duidelijke melding (functie `huis`).

**De spanningswacht** (1.5.0, `brug/spanning.mjs`, alleen lezen, voor elk huis):
per fase het 10-minutengemiddelde en de piek van de netspanning (een omvormer valt
uit boven 253 V, 10 minuten gemiddeld). De beste bron per fase (1.6.0): de
omvormer, dan een driefase kWh-meter op de zon (die zit het dichtst bij de
omvormer), dan een andere driefase kWh-meter in huis, dan de slimme meter (P1).
In huis B is de zonnemeter een driefase meter, net als die van de spa (de SolarEdge
SE6K levert op alle drie de fasen): dan komen L1–L3 van de zonnemeter en staat per
fase het verschil met de spa-meter (L1 zon − L1 spa, enz.; per dag het grootste),
ook in de uitval-regel. Een eenfase kWh-meter op de zon gaat apart ("zonnefase"),
met het verschil tegenover de driefase meter; alleen dan vraagt de app bij Namen
op welke fase de zonnepanelen zitten. Valt de zon overdag binnen een halve minuut van flink naar bijna
niets terwijl de spanning hoog was (10 min ≥ 251 V of een piek ≥ 256 V), of meldt
de GoodWe zelf een netspanningsfout (storingsbit 17), dan een melding (een
kwartier, dus één regel in het Logboek) en een regel in de lijst voor de
netbeheerder (datum, tijd, fase, spanning). Per dag ook hoe vaak een fase boven
250 V kwam zonder dat hij uitviel. Er wordt niets bijgestuurd vanwege de spanning
("eerst leren of het gebeurt"). Blok `spanning` in de meting, eens per
minuut; een oudere functie laat het stil vallen.

Hiervoor moet het programmaatje naar 0.5.0 of nieuwer. Op de telefoon in Termux:

```bash
sh ~/thuis-energie/brug/bijwerken.sh
```

(van voor 0.5.2 één keer: `cd ~/thuis-energie && git pull && node brug/brug.mjs herstart`)

Is de app nog niet bijgewerkt, of draait thuis nog 0.4.0, dan gaat er niets mis:
de rest werkt gewoon, en de batterijgegevens verschijnen zodra allebei zover zijn.

**Tuya** (sinds 0.8.0, Smart Life en Tuya Smart). Een meetschakelaar (de pomp)
gaat mee als apparaat met zijn vermogen, lampen en schakelaars als "aan" of
"uit" bij Apparaten, en een lamp die je als "spots in het overstek" kiest laat
de spotjes op de tekening branden. Alleen lezen: het programmaatje vraagt elk
apparaat hooguit eens per 20 seconden zijn stand en kan niets schakelen. De
local keys haalt de instelhulp één keer op bij je eigen Tuya-cloudproject; het
Access Secret wordt niet bewaard. Stap voor stap, en wat te doen als het niet
lukt: **`docs/tuya.md`**. Met een oudere app (functie) gaat het ook: de pomp
staat dan bij de apparaten, de lampen komen pas na de volgende uitrol.

**De omvormer** (sinds 0.6.0, GoodWe DT-serie, zoals de GW8000-DT in huis A). De
omvormer is via zijn wifi-stekker in je eigen wifi uit te lezen, zoals de Home
Assistant-koppeling `goodwe` dat doet (UDP-poort 8899; zoeken via poort 48899).
Alleen lezen: het programmaatje stelt nooit iets in. Hooguit eens per 15
seconden, om de kleine wifi-stekker niet zwaar te belasten. In de app, bij de
omvormer op Apparaten en in het blad van zijn zonnepanelen, in een rustig blok:

- de **temperatuur** bovenaan, groot;
- **storingen** daaronder, in oranje, in gewone woorden (bijvoorbeeld "geen net",
  "isolatiefout bij de panelen of kabels", "te warm"), en of hij **minder levert**
  en waarom;
- per **paneelrij** de spanning en de stroom (een ingang zonder panelen, die 0 V
  meldt terwijl een andere rij spanning heeft, laat de app weg), per **fase** de
  netspanning, en de **netfrequentie**;
- de **stand** (levert, wacht, storing, controle) en de **opbrengst vandaag** (en
  totaal).

's Nachts staat de omvormer uit, met zijn wifi-stekker. Dan staat er "slaapt"
(met de opbrengst van vandaag), geen fout. Zoek hem daarom overdag: `node brug.mjs
instellen` vindt hem dan vanzelf. Het type ("GW8K-DT") staat bij Apparaten; het
serienummer leest het programmaatje niet. De betekenis van de foutbits komt uit
de foutlijst van GoodWe zoals de bibliotheek hem kent; een bit dat daar niet in
staat, heet "storingscode N" (kijk dan in de SEMS-app).

### Op een Android-telefoon (Termux)

Een oude Android-telefoon aan de lader kan het programmaatje draaien. Eenmalig:

1. Installeer **Termux** uit F-Droid: https://f-droid.org/packages/com.termux/
   (niet uit de Play Store: die versie is verouderd). Op die pagina staat
   **Download APK**; Android vraagt dan of je browser apps mag installeren:
   toestaan. Open Termux.
2. Typ deze regels, elk gevolgd door Enter:

   ```bash
   pkg update -y && pkg upgrade -y
   pkg install -y nodejs-lts git gh
   gh auth login
   ```

   Vraagt `pkg` iets over een configuratiebestand: alleen Enter. Bij
   `gh auth login` kies je **GitHub.com**, **HTTPS**, **Y** en **Login with a
   web browser**. Je krijgt een code van acht tekens: open
   https://github.com/login/device in de browser (gaat soms vanzelf), log in
   en vul de code in.
3. Haal de code op en start de instelhulp:

   ```bash
   gh repo clone <jouw-account>/thuiskoppeling thuis-energie
   cd thuis-energie/brug
   npm install
   node brug.mjs instellen
   ```

4. Proberen, en dan aanzetten. `start.sh` zet hem op de achtergrond aan en
   houdt hem aan, ook na een fout (logboek: `brug/brug.log`):

   ```bash
   node brug.mjs proef
   sh start.sh
   ```

5. Zodat Android hem laat draaien: zet bij **Instellingen › Apps › Termux ›
   Batterij** het gebruik op **Onbeperkt** (bij Samsung ook: **Instellingen ›
   Batterij › Limieten voor achtergrondgebruik › Apps nooit in slaapstand**,
   Termux erbij), laat de lader erin, en veeg Termux niet weg bij je geopende
   apps.
6. Na een herstart van de telefoon vanzelf weer aan: installeer **Termux:Boot**
   uit F-Droid (https://f-droid.org/packages/com.termux.boot/, van dezelfde
   plek als Termux), open die app één keer, en typ in Termux:

   ```bash
   node ~/thuis-energie/brug/brug.mjs termux-boot
   ```

   Zet Termux:Boot bij Samsung ook bij **Apps nooit in slaapstand**.
7. Dag en nacht aan, ook als Android iets afschiet:
   - **Android 12 en nieuwer** schiet soms programma's af die een app zelf
     start (zoals node in Termux; de "phantom process killer"). Android 14 en
     nieuwer: in **Instellingen › Ontwikkelaarsopties** **Disable child process
     restrictions** aanzetten (Ontwikkelaarsopties: 7 keer tikken op het
     buildnummer bij Over de telefoon). Android 12 of 13: uitzetten via een
     computer met adb, zoals in de Termux-wiki (zoek op "phantom process
     killer termux").
   - **Een waakhond van buiten**: valt Termux zelf weg, dan start niets hem
     opnieuw tot de telefoon herstart. Installeer **Termux:API** uit F-Droid
     (https://f-droid.org/packages/com.termux.api/) en typ in Termux:

     ```bash
     pkg install -y termux-api
     termux-job-scheduler --script ~/thuis-energie/brug/waakhond.sh --period-ms 900000 --persisted true
     ```

     Dan kijkt Android elk kwartier of het programmaatje draait en zet het
     anders aan. Draait het al, of heb je het zelf gestopt (`node brug.mjs
     stop`), dan doet de waakhond niets.
   - **Na een lege accu**: veel telefoons gaan dan alleen laden en starten niet
     vanzelf op. Probeer het één keer: telefoon uit, lader eruit en weer erin.
     Start hij niet vanzelf, dan moet je na een stroomstoring zelf even op de
     aan-knop drukken.
   - **De accu**: een telefoon die maanden aan de lader hangt, kan opzwellen.
     Zet de laadbescherming aan als je telefoon die heeft (Samsung:
     **Instellingen › Batterij › Meer batterij-instellingen › Batterij
     beschermen**, tot 85 %; Pixel: de laadlimiet van 80 %). Leg hem niet in een
     dichte kast of op iets warms, en kijk af en toe of hij bol gaat staan.

Liever geen GitHub-account op de telefoon? `gh auth login` geeft de telefoon
toegang tot al je repo's, lezen én schrijven (ook die van je werk). Om bij te
werken is alleen **lezen van deze ene repo** nodig. Dat kan met een eigen
alleen-lezen sleutel per telefoon (een *deploy key*). Wat nu werkt, blijft
werken; dit kan er later bij:

1. In Termux een sleutel maken en laten zien:

   ```bash
   pkg install -y openssh
   ssh-keygen -t ed25519 -N "" -C "telefoon thuis" -f ~/.ssh/thuis-energie
   cat ~/.ssh/thuis-energie.pub
   ```

2. Op GitHub bij **je kopie van thuiskoppeling › Settings › Deploy keys › Add deploy key**:
   een naam (zoals "telefoon thuis"), de regel uit `cat` erin plakken, en
   **Allow write access** uit laten. Opslaan.
3. Terug in Termux: zeg dat GitHub die sleutel krijgt, en haal voortaan via
   SSH op:

   ```bash
   printf 'Host github.com\n  IdentityFile ~/.ssh/thuis-energie\n  IdentitiesOnly yes\n' >> ~/.ssh/config
   chmod 600 ~/.ssh/config
   cd ~/thuis-energie && git remote set-url origin git@github.com:<jouw-account>/thuiskoppeling.git
   git pull
   ```

   De eerste keer vraagt `git pull` of je github.com vertrouwt: `yes`.
4. Werkt `git pull`: dan `gh auth logout` (de brede toegang weg). `gh` is dan
   niet meer nodig.

Elke telefoon een eigen sleutel: kwijt of weg, dan haal je alleen die op
GitHub weg. Een nieuwe telefoon zonder gh: na stap 1 en 2 (en de `printf`-regel
uit stap 3) `git clone git@github.com:<jouw-account>/thuiskoppeling.git ~/thuis-energie`
in plaats van `gh repo clone`.

Wat je daarna nog typt:

| Wat | Typ |
|---|---|
| Draait hij? | `node ~/thuis-energie/brug/brug.mjs status` |
| Meekijken (stoppen met CTRL en c) | `tail -f ~/thuis-energie/brug/brug.log` |
| Bijwerken | `sh ~/thuis-energie/brug/bijwerken.sh` (ook op een Chromebook, sinds 0.13.0) |
| Stoppen | `node ~/thuis-energie/brug/brug.mjs stop` (onder systemd gaat dat via `sudo systemctl stop thuis-energie-brug`) |

| Weer aanzetten | `sh ~/thuis-energie/brug/start.sh` |

Er draait er altijd maar één: een tweede (bijvoorbeeld met de hand
`node brug.mjs`) stopt meteen met "draait al".

Bijwerken naar een nieuwe versie (zoals 0.5.2): de regel **Bijwerken** uit de
tabel. Die haalt de nieuwe versie op, alleen vooruit (er gaat op de telefoon
nooit iets verloren), kijkt elk bestand na (`node --check`, en sinds 0.13.0 of
alles laadt met jouw instellingen: `node brug.mjs nakijken`), werkt de
pakketten bij als die echt veranderden (`npm ci`; niet meer bij alleen een
nieuw versienummer), start opnieuw en kijkt of de eerste stand in de app komt.
Start de nieuwe versie niet of loopt hij meteen vast, dan gaat hij vanzelf
terug naar de vorige. Start hij wel maar komt er nog geen stand (internet weg,
sleutel), dan blijft hij staan en zegt hij waar je mee kunt kijken. Dat kijken
gaat sinds 0.13.0 via `brug/opstart.txt` (het programmaatje schrijft daar
"gestart", "eerste-stand" of "fout"), dus ook onder systemd op een Chromebook,
waar geen `brug.log` is; daar start hij opnieuw via systemd, nooit met
`start.sh` ernaast.

**Alleen een nagekeken versie** (sinds 0.13.0). `bijwerken.sh` gaat niet meer
naar de nieuwste commit van de tak, maar hooguit naar de commit in
`brug/goedgekeurd.txt` (op de tak), of naar de nieuwste tag `uitrol/…` als die
verder is; staat geen van beide er, dan de tak zoals vroeger. Zo komt een half
af commit of een push die niet door de poorten ging niet op de telefoons. (In
een verse kopie staat er nog geen `brug/goedgekeurd.txt`: dan de tak.)
Goedkeuren doe je na het werk, op een schone stand:
`node scripts/brugGoedkeuren.mjs` (draait alle poorten, zet de commit in
`brug/goedgekeurd.txt` en maakt daar een eigen commit van); daarna de tak
pushen. Werkt op elke computer, ook als tags pushen niet lukt. Veranderde
`bijwerken.sh` zelf, dan gaat de nieuwe versie ervan verder.
 Staat `bijwerken.sh` nog niet op de telefoon (van voor
0.5.2), dan één keer de oude manier:
`cd ~/thuis-energie && git pull && node brug/brug.mjs herstart`. Is de app nog niet bijgewerkt, dan gaat er niets mis: de nieuwe cijfers
verschijnen vanzelf zodra hij dat wel is (binnen een kwartier).

## 3. In de app

Onderaan staan vijf tabbladen. **Huis** is het plaatje en de eenvoud, **Nu** de cijfers:

| Tabblad | Wat je ziet |
|---|---|
| **Huis** | de tekening met de stroom die loopt, daaronder **Nu in woorden** (wat er nu gebeurt, om na te rekenen), een knop **Alle cijfers van nu** (naar Nu) en **Advies** (zie hieronder). Tik op een rondje: waar de stroom vandaan komt en heen gaat (het blad herhaalt Nu in woorden niet). |
| **Weer** | **het weer** van de rest van vandaag en van morgen per dagdeel (nacht, ochtend, middag, avond): een icoon en woorden (zon, wolken, regen met kans en mm, onweer, sneeuw, mist, windstoten) en de temperatuur; en **de zon van morgen**: zo'n zoveel kWh (met een bandbreedte), per plek met panelen, per uur in een staaf, wanneer de batterij vol is en wat er naar het net gaat, en met de prijzen (van morgen, of tot 13:00 die van vandaag) wat de zon scheelt. Zie **Weer (de voorspelling)** hieronder (in de code en de tekst eronder heet het nog Voorspelling). |
| **Nu** | vier tegels in de volgorde van de keten (zon, batterij, huis, net), elk met één korte regel in de woorden van de tekening ("Laadt nu"; panelen op meer plekken: de Zon-tegel opent het blad van alle plekken samen, met per plek een regel naar zijn eigen blad); **Wie levert aan wie**; de **apparaten** met een eigen meter; de **belasting per fase**: per fase de stroom (balk, tot de zekering), het vermogen met de richting in woorden ("312 W naar het net"), de piek van vandaag en de spanning, en lopen de fasen verschillende kanten op, dat de meter ze optelt ("per saldo lever je 49 W terug"); en één kaart **Geld** (per uur, de prijs nu met terugleveren, de Zonnebonus van dit jaar). Trekt een fase meer dan de grens (zonder eigen grens 80% van de zekering: 20 A bij 25 A), dan staat dat rustig in oranje bij de fasen en in Nu in woorden ("L2 trekt nu 23,7 A, dicht bij de 25 A van de zekering"; met een lagere eigen grens "boven je grens van 15 A"); alleen tonen, geen alarm. Tik op een tegel voor het blad met details. |
| **Overzicht** | bovenaan een keuze: **Vandaag · Week · Maand · Kwartaal · Jaar** (dit toestel onthoudt hem). **Vandaag**: betaald, verdiend, vast en netto, met de gemiddelde prijs per kWh; één kaart **Energie** met de kWh, en daaronder in een gewone zin zelfvoorzienend (1 − uit het net ÷ wat het huis gebruikte) en eigen verbruik (1 − teruggeleverd ÷ wat de zon opwekte), uit dezelfde kWh; netstroom die via de batterij in huis kwam telt als uit het net; de stroomprijs per kwartier van vandaag en morgen (morgen komt rond 13:00) met één kaart **Prijzen**: de goedkoopste twee uur om te laden en de duurste om terug te leveren, vandaag en morgen gemiddeld van–tot, de Zonnebonus, en "onder nul" alleen als het gebeurt; en in een blok dat dicht staat per kwartier de zon, het huis, de batterij, het net, hoe vol de batterij was en de stroom per fase, met per fase het gemiddelde en de piek, vandaag en de dagen ervoor. **Week** (maandag t/m zondag), **Maand**, **Kwartaal** en **Jaar**: dezelfde totalen over die periode, de Zonnebonus (ongeveer), en in een blok dat dicht staat staven per dag (week, maand), per week (kwartaal) of per maand (jaar): netto, zon, huis, net, batterij en de fasen. Is de geschiedenis korter dan de periode, dan staat erbij sinds wanneer. Bij Jaar ook hoeveel je dit jaar al teruggeleverd hebt tegenover het plafond van de Zonnebonus. Bij Vandaag en elke periode het onderdeel **Apparaten** (programmaatje 0.12.0): per apparaat de kWh, welk deel van het huis, ongeveer de euro's (met wat een kWh uit het net die dag gemiddeld kostte) en hoe vaak het aan was, grootste eerst met een balk; met een eigen meter precies ("gemeten", volle balk), herkend een schatting ("≈ herkend", gestreept); daaronder de Basis (altijd aan / warmtepomp) en de Rest (niet herkend). Bij Week, Maand en Kwartaal ook de periode ervoor ("vorige week 31,0 kWh"), uit dezelfde vraag aan de server. Tik op een regel voor een blad met per dag (week) een staafje. Met een oudere brug legt de kaart uit dat het na bijwerken komt. |
| **Apparaten** | het programmaatje (versie, sinds wanneer, hoe vaak, prijsbron), **Wat gebruikt er nu stroom?** (sinds 0.11.0, kort: sinds 1.4.0 bovenaan wat het programmaatje kent en hooguit twee vragen over wat terugkomt, voor de eigenaar; één regel met wat nu aan staat en één met wat altijd aan staat; in een blok dat dicht staat eerder vandaag, "Wat is dit?" en, voor de eigenaar, Klopt en Dat was …; en een knop naar Overzicht › Week: de week per apparaat staat op één plek) en elk gekoppeld apparaat met zijn eigen naam uit Instellingen › Namen (de naam van het programmaatje eronder): wat het is, het adres in je wifi, of het antwoordt ("geen antwoord sinds 08:12") en wat het nu meet; bij de Zendure ook wat de batterij zelf meldt (temperatuur, spanning, grenzen, hoe lang nog). Bovenaan, onder **Zo werk je het programmaatje bij**, de opdracht per toestel (telefoon: `sh ~/thuis-energie/brug/bijwerken.sh`, Chromebook): de enige plek in de app met een opdracht; elders staat "Hoe je het bijwerkt, staat op Apparaten". Onderaan het **Logboek**: wanneer de batterij, de omvormer, een meter of het programmaatje een storing meldde (of er een tijd geen cijfers kwamen), wat het was en hoe lang het duurde. |

**Weer (de voorspelling)** begint niet bij nul. Op dag één rekent het met natuurkunde: per
uur de straling uit het weerbericht, de stand van de zon (een gewoon dak, 30°
op het zuiden), een gewone prestatieverhouding (0,8) en het maximale vermogen
per plek (Instellingen › Namen, in huis A Hoofddak 8.000 W en Dierenverblijf
3.000 W). Vanaf het eerste hele uur met zon leert het per huis: één factor voor
het hele huis (gemeten tegenover berekend, met de natuurkunde als voorzichtige
start; na één zonnige dag weegt het gemeten al zwaarder), per plek (met
programmaatje 0.10.0 de zon per plek per uur, of per dag uit de GoodWe-omvormer
en zijn teller) en per stand van de zon (lage zon, oost/zuid/west: schaduw in de
winter of een dak op het westen leert het zo apart). Het leert van de laatste
zes weken (dezelfde vraag als Advies, geen aanroep extra) en vandaag tot nu.
Het zegt eerlijk hoe zeker het is ("Geleerd van 3 dagen en vandaag tot nu"),
met een bandbreedte van minstens een kwart (bij wisselende bewolking 35%: zo
ver zit een weerbericht een dag vooruit er vaak naast; met drie dagen waarvan
dit toestel de voorspelling bewaarde, zo ver als die ernaast zaten), en
hoe gisteren uitkwam (wat dit toestel eergisteren voorspelde, of anders een
terugblik met het weer van gisteren). Zonder vermogen (zoals huis B: één kWh-meter, geen
omvormer) leert het het na een paar uur zon en vraagt het om het vermogen in te
vullen. Een programmaatje van voor 0.10.0: alleen zon en wolken; van voor 0.9.0:
geen weerbericht.

**Advies** (onderaan Huis) is zo eenvoudig mogelijk ("denk aan een oud
dametje dat simpel hulp nodig heeft"): hooguit drie grote regels met een icoon,
**Goed moment** (groen duimpje: "Morgen tussen 10 en 13 uur: was draaien,
vaatwasser, drogen."), **Liever niet** (oranje hand: "Morgen tussen 17 en 20
uur.") en **Het weer** ("Morgen veel wolken, weinig zon."; vóór 6:00 over
vandaag), met rechtsboven een klein "ik leer nog" zolang het huis minder dan
een week bekend is. Daaronder **De komende 24 uur**: per uur een vakje, groen
met een vinkje (goed), grijs (gewoon) of oranje met een streepje (liever niet),
per dag in twee rijen van twaalf uur zodat elk uur op dezelfde plek staat, de
uren eronder, het uur van nu met een rand en "nu", en een legenda in woorden.
Geen euro's, geen kWh en niets over de batterij op de kaart: de batterij gaat
vanzelf. Onder **Meer details** de tabel per uur (advies, zon, stroomprijs) en
hoe het rekent.

Achter de schermen rekent het wel alles door: per uur wat een kWh extra in
totaal kost, met de batterij en de zon erbij (zon die anders naar het net ging,
kost alleen de teruglevering die je misloopt; stroom uit de batterij mis je
later; stroom uit het net kost de prijs van dat uur; zonder prijzen telt hoeveel
er extra uit het net komt). Het huis leert het per uur van de klok uit de
dagen die de server bewaart (gemiddeld over de laatste twee weken, met één
gewone dag erbij zolang er weinig is). **De zon per uur is dezelfde als op het
tabblad Voorspelling** (één verwachting voor het hele scherm,
`src/lib/verwachting.js`): hetzelfde weerbericht, dezelfde leerdagen, de stand
van de zon en het dak. Zo zeggen Huis en Voorspelling nooit iets anders, en
volgt het goede moment het dak (op het westen 's middags, op het oosten
's ochtends). Alleen zonder zonnepanelen in de opstelling of zonder iets
geleerd rekent het zoals vroeger (de zon van de laatste week, met het
weerbericht naar rato). Met een batterij kiest de eigenaar bij **Instellingen ›
Namen › Batterij in het advies** wat hij doet: **Eigen gebruik** (standaard:
zon opslaan en zelf gebruiken) of **Handelen** (laden als stroom goedkoop is,
ook uit het net, en terugleveren als hij duur is); handelen telt alleen mee als
het na het verlies van laden en leveren minstens € 0,10 per dag oplevert. Het
verlies hangt af van de koudste accu (uit de praktijk: 6% bij 25–30 °C, tot 10% bij 40 °C,
11% bij 10 °C; daaronder snel meer, onder 0 °C laadt hij niet); bij de batterij
staat het **verwachte rendement nu**. Op het batterijblad en bij Apparaten staat
**Verwacht vol vandaag rond 15:00**, uit dezelfde verwachting als Voorspelling,
en wat de Zendure zelf zegt altijd met zijn vermogen erbij ("bij 143 W laden:
vol over ongeveer 30 uur"). Alles is raad: de app zet niets aan of uit, de
Zendure-app (of ZENKI) stuurt de batterij zelf.

Bij elke grafiek: tik of schuif erover (of gebruik de pijltjes) voor dat
kwartier (of die dag, week of maand), en onder **Als tabel** staan dezelfde
cijfers als tabel.

Op de tekening: het batterij-icoon heeft 4 streepjes (hoe vol, per kwart), en
de ring eromheen is hoe hard hij laadt (groen) of levert (oranje), tegenover
zijn maximum. Om elk zonrondje vult de ring zich met wat die panelen nu
leveren, tegenover hun maximum. Die maxima zet je bij **Instellingen › Namen ›
Maximaal vermogen** (in huis A: Hoofddak 8000 W, Dierenverblijf 3000 W,
batterij 2400 W); zonder maximum heeft een zonrondje geen ring.

Wie levert aan wie rekent de app uit met de batterij voorop ("bat is
leidend"). Laadt de batterij, dan gaat de zon eerst naar de batterij, dan naar
het huis, en de rest naar het net; wat de batterij meer laadt dan de zon geeft,
komt uit het net, en wat het huis dan nog mist ook. Levert de batterij, dan gaat
de zon eerst naar het huis, vult de batterij aan wat het huis nog mist, en gaat
de rest naar het net. Alles in hele watts: eerst wordt elke meter afgerond, dan
pas gerekend, dus het huis is overal hetzelfde getal en alles telt op tot op de
watt. Op de tekening lopen de lijnen zoals de draden: alles via het huis (de
meterkast), dus nooit van de panelen of de batterij rechtstreeks naar het net.

**Nu in woorden** (op Huis, bovenaan Nu, en in het blad van het huis en van de
zon) zegt het als één verhaal, altijd in dezelfde volgorde: de zon (met de
plekken), de batterij, het huis, en wat er naar het net gaat of eruit komt. Zo
om 11:02 in huis A:

> De zon levert 1.134 W (Hoofddak 701 W + Dierenverblijf 433 W). Daarvan laadt
> 627 W de batterij en gebruikt je huis 458 W. De rest, 49 W, gaat naar het net.

En als de zon niet genoeg geeft voor de batterij:

> De zon levert 1.000 W (Hoofddak 600 W + Dierenverblijf 400 W). Die gaat
> helemaal naar de batterij. De batterij laadt met 2.300 W: 1.000 W van de zon
> en 1.300 W uit het net. Je huis gebruikt 450 W, ook uit het net. Uit het net
> komt dus 1.750 W.

Daaronder hooguit twee zinnen: of de batterij vol of bijna leeg is (10% of
minder), of dat de meters even niet gelijk lopen, en of stroom nu duur of
goedkoop is tegenover de rest van vandaag (duurder of goedkoper dan driekwart
van de kwartieren). Onder 5 W is iets geen stroom maar meetruis, onder 20 W zon
is er geen zon, en binnen ±20 W gaat er niets naar of uit het net ("Er gaat
niets naar het net en je haalt er niets uit."). De tegels, de bladen en de
tekening houden dezelfde grenzen aan.

- Tik op een rondje: waar de stroom vandaan komt en heen gaat.
- Staat er "Nog niets van thuis ontvangen", dan draait het programmaatje nog
  niet (of het adres of de sleutel klopt niet). Je ziet dan het voorbeeld.
- Rechtsboven het tandwiel, **Instellingen**:
  - **Indelen**: kies de tekening, sleep de rondjes naar de goede plek op de
    foto, kies wat je wilt zien, of kies een eigen foto van je huis in plaats
    van de tekening. Een staande foto (4:5) past het best. Die foto staat
    afgeschermd bij Base44; alleen wie in de omgeving mag, ziet hem. De
    tekeningen:
    - **Met dierenverblijf** (de standaard): een twee-onder-een-kap met
      zwarte panelen op bijna het hele dak, rechts een carport met een auto
      en een buitenkastje, daarachter het dierenverblijf met eigen panelen,
      een kerktoren in de verte en een auto voor het huis.
    - **Met schuur**: een gewoon huis met een stenen schuur met panelen.
    - **Alleen het huis**: een gewoon huis met een boom ernaast.
    - **Vrijstaand met garage en carport**: een steil
      pannendak met twee dakkapellen en links panelen, een losse garage, een
      houten carport, een haag en een vlaggenmast. De batterij begint hier in
      de garage, het huis (de meterkast) bij de voordeur.

    Bij een andere tekening gaan de rondjes naar hun beginplek. Overdag
    glimmen de panelen als ze leveren; 's nachts brandt er licht achter de
    ramen. Dag is van zonsopkomst tot zonsondergang op de plaats van het huis
    (het programmaatje stuurt die tijden mee, sinds 0.7.0); met een oudere
    versie is het dag zolang de zon iets levert. **Het weer van nu** (sinds
    0.9.0, Open-Meteo) staat op elke tekening: van geen wolken tot een
    grijze lucht (zon, maan en sterren erachter weg), vallende regen,
    motregen, sneeuw of hagel, bij onweer af en toe een flits, mist als een
    waas, en bij harde wind (vanaf 39 km/h of stoten vanaf 60) draaien de
    molen en de wolken sneller en wiegen de bomen. Bij een eigen foto staat
    alleen een klein weericoon linksonder. Zonder weer (een oudere
    versie) is de tekening zoals altijd. Wie op zijn telefoon minder beweging heeft ingesteld, ziet alles
    stilstaan.
  - **Namen**: geef elk rondje een eigen naam, bijvoorbeeld "Meterkast" in
    plaats van "Net" of "Stal" in plaats van "Zon dierenverblijf". Die naam
    staat dan overal: op de foto, in de kaarten, in het detailblad en bij de zon
    per plek. Laat je hem leeg, dan heet het weer zoals in `instellingen.json`.
    Daaronder de **grens per fase** en de **hoofdzekering** (leeg: 20 A en
    25 A): vanaf de grens zegt Nu dat een fase zwaar belast is.
  - **Account**: met welk e-mailadres je bent ingelogd, uitloggen, en je
    omgeving een andere naam geven. Alleen de beheerder kiest hier
    tussen de omgevingen (dit toestel onthoudt de keuze) en maakt er nieuwe.
    Hij ziet hier ook **alle huizen** met de cijfers van nu (zon, batterij,
    net, huis), de brugversie, "Geen cijfers sinds 18:02" als er langer dan
    vijf minuten niets kwam, en een open storing; tik op een huis om erheen te
    gaan. Dat wordt alleen met dit scherm open opgehaald, hooguit eens per 30 s.
  - **Delen**: wie er meekijkt, iemand uitnodigen of weghalen, en een nieuwe
    sleutel voor het programmaatje.

### Wie mag wat

| Wie | Mag |
|---|---|
| **Beheerder van de app** (rol admin in Base44) | alles: ziet elke omgeving en het overzicht van alle huizen, wisselt ertussen, maakt nieuwe, en beheert ze allemaal (indelen, namen, delen, sleutel, naam, op afstand instellen) |
| **Eigenaar** (wie de omgeving maakte) | alles in die ene omgeving. Omgevingen maakt alleen de beheerder, dus die is ook de eigenaar |
| **Kijker** (uitgenodigd) | kijken in zijn ene omgeving (ook het logboek), meer niet; onder Instellingen alleen Account. Geen andere omgeving, geen overzicht van alle huizen, niet wisselen, niets maken. Ziet geen adressen en serienummers, ook niet in de meldingen en het logboek (`base44/shared/afschermen.js`) |
| **Account zonder uitnodiging** | niets: geen omgeving, niets maken. Krijgt "Vraag degene die je uitnodigde…" |
| **Uitgeschakeld account** | niets |

Een gewone gebruiker hoort bij precies één omgeving (30 oktober 2026:
"alleen admin kan wisselen tussen huizen, user niet"). Uitnodigen weigert
daarom wie al bij een andere omgeving hoort; haal hem daar eerst weg. Staat
iemand door een vergissing toch bij twee, dan ziet en opent hij alleen de
oudste. De server houdt dat zo, ook als iemand de knoppen toch zou vinden.

Uitnodigen gaat in twee stappen. De app zet het e-mailadres bij de omgeving en
vraagt Base44 meteen om een uitnodiging voor de app te sturen. Dat laatste mag
alleen de beheerder: nodigt iemand anders uit, dan zegt de app dat de beheerder die
persoon in Base44 moet uitnodigen (bij Users). Een omgeving heeft hooguit 20
kijkers.

Hoe het werkt: de site leest en schrijft niets zelf, alles gaat via de functies
`huis` en `ontvangMeting`. Die werken met de rol van de server en toetsen
eerst: wie belt er (anders 401), staat dat account aan, en hoort hij bij deze
omgeving. Die regel staat op één plek: `base44/shared/toegang.js`. In de
rechten van de tabellen kan hij niet (Base44 kan daar alleen vaste velden van
de gebruiker vergelijken), dus die blijven op "alleen de beheerder".

### Hoeveel aanroepen

Base44 remt bij ongeveer 115 aanroepen per 65 seconden (gemeten in een
andere Base44-app), en dat geldt voor de hele app: alle huizen samen, ook wat de
functies met de serverrol doen en het nakijken wie er belt (auth.me).

Daarom onthouden de functies even wat elke 5 s hetzelfde antwoord geeft
(`base44/shared/toegang.js`, `LEZEN_ONTHOUDEN_MS` = 30 s):

- ontvangMeting weet 30 s bij welk huis een sleutel hoort. Een meting kost dan
  meestal één aanroep (bijwerken) in plaats van twee. Na "Nieuwe sleutel"
  werkt de oude nog hooguit 30 s; de nieuwe meteen.
- huis onthoudt bij de stand (en de periode) 30 s wie je bent en de rij van het
  huis, en 3 s de laatste meting, zodat twee schermen op hetzelfde huis één
  lezing delen. De rechten worden elke keer getoetst; een kijker die eruit
  gehaald wordt of een account dat uitgezet wordt, ziet de cijfers nog hooguit
  30 s. Bij het openen van de app (de stand, wie je bent en je omgevingen, de
  indeling) is dat sinds ronde 21 één keer "wie ben je" in plaats van drie: ook
  `mijn` en `opstelling` gebruiken het onthouden antwoord (de rechten toetsen ze
  vers). Al het andere (instellingen bewaren, delen, de sleutel) kijkt altijd
  vers.

De som (`base44/tests/rem.test.js`, geteld met de nep van Base44): twee huizen,
elk een programmaatje elke 5 s, en drie open schermen (in huis A een telefoon en
een tablet, in huis B één) kosten samen 68 aanroepen per 65 s (59% van de rem);
vóór deze ronde was dat 160 (139%). Eén programmaatje kost 16, één open scherm
16. Draait Base44 een functie in meer dan één tegelijk, dan begint elke nieuwe
met een leeg geheugen: een paar aanroepen extra, geen veelvoud.

Tegen wie de rem expres wil leegtrekken (ronde 19), ook goedkoop in het
geheugen van de functies:

- Een verzonnen brugsleutel of een ongeldig token kost één aanroep; daarna is
  die een minuut lang meteen 401. Hooguit 10 van zulke mislukte opzoekingen
  per 65 s; daarboven 429 zonder aanroep, behalve voor een sleutel of token dat
  het laatste kwartier goed was (de eigen programmaatjes en schermen).
- Per token hooguit 20 keer "wie ben je" (auth.me) per 65 s.
- Per huis hooguit één meting per 2 s (anders 429; het programmaatje wacht dan
  vanzelf langer), en het logboek hooguit 3 schrijfacties per meting.
- Een gewoon account vraagt een ander huis dan het zijne: meteen 404, zonder de
  rij te lezen.

`rem.test.js` speelt het na: een vreemde met verzonnen sleutels en tokens, een
ingelogde vreemde en een gekopieerde brugsleutel komen elk op 88 per 65 s
(77%, de eigen 68 erbij), onder de 92.

Het logboek van storingen (tabel Gebeurtenis) schrijft ontvangMeting alleen als
een storing begint of voorbij is, niet per meting; wat openstaat gaat mee in de
rij Meting die hij toch al schrijft. Op Apparaten haalt de app het logboek
hooguit eens per twee minuten; het overzicht van alle huizen (alleen de beheerder)
hooguit eens per 30 s, in één aanroep voor alle huizen samen. Met beide open
erbij komt de som op 78 per 65 s (68%).

De dag, de apparaten en de prijzen gaan mee in dezelfde aanroep. De dagen
(tabel Dag) schrijft ontvangMeting hooguit eens per kwartier per huis. Een
week, maand, kwartaal of jaar haalt de app alleen op als je dat tabblad met die
keuze open hebt, en hooguit eens per drie minuten. Advies (op Huis) vraagt de
dagen van de laatste twee weken hooguit eens per half uur: met drie schermen
tegelijk drie aanroepen erbij (71 per 65 s). Remt Base44 toch, dan vraagt
een scherm de stand niet meteen opnieuw maar wacht het 15 s tot een minuut, en
wacht het programmaatje steeds langer. Gebeurt het vaak, zet dan
`elke_seconden` op 10.

## Een tweede huis

Dezelfde app, een eigen omgeving. Wie je in dat huis uitnodigt, ziet alleen
zijn eigen huis; de beheerder ziet ze allemaal en wisselt ertussen. Het hele
stappenplan (ook een Zendure P1-meter die later bijkomt): `docs/tweede-huis.md`.

1. **Omgeving maken.** De beheerder opent **Instellingen › Account › Nieuwe
   omgeving maken**, met bijvoorbeeld de naam "Vakantiehuis". Je krijgt één
   keer de sleutel voor het programmaatje, met het adres erbij. (Alleen de
   beheerder maakt omgevingen.)
2. **Iemand uitnodigen.** In die omgeving: **Instellingen › Delen**, het
   e-mailadres. Die krijgt een mail van Base44 om in te loggen en ziet daarna
   alleen die omgeving. Hoort hij al bij een andere omgeving (bijvoorbeeld als
   kijker in je eigen huis), haal hem daar dan eerst weg: iemand hoort bij één
   omgeving.
3. **Een eigen programmaatje** in dat huis, op die wifi (bijvoorbeeld weer een
   oude telefoon), met eigen instellingen (`node brug.mjs instellen`; die
   vindt de meters zelf):
   - het adres en de sleutel zoals de app ze liet zien;
   - de **namen** kies je per meter, bijvoorbeeld "Zon garage" of
     "Warmtepomp"; zo heten ze ook in de app (of geef ze daar een eigen naam,
     bij **Instellingen › Namen**);
   - geef bij **Plaats** de breedte en lengte van dat huis (bijvoorbeeld uit
     Google Maps); zonder plaats rekent het met het midden van het land;
   - ook bij Zonneplan: inloggen met het eigen e-mailadres van dat huis, en de
     eigen vaste kosten (netbeheer verschilt per aansluiting).
4. **In die omgeving**: **Instellingen › Indelen**, kies de tekening die het
   best past (bijvoorbeeld **Vrijstaand met garage en carport**) en sleep de
   rondjes goed; bij **Namen** zo nodig een eigen naam.

Kiezen tussen de omgevingen (alleen de beheerder): **Instellingen › Account**.

## Werken aan de code

```bash
npm run dev         # de site op je pc, met nepcijfers (zonder Base44)
npm test            # alle tests (site, functie, programmaatje)
npm run lint
npm run build
npm run voorbeeld   # het voorbeeld als één los HTML-bestand
node scripts/poorten.mjs   # alle poorten in één keer (lint, tests, deno check, vingerafdruk, velden, build)
```

Bijdragen: zie [CONTRIBUTING.md](CONTRIBUTING.md). Alle poorten moeten groen zijn.

- Site: `src/` (React, Tailwind 4). Rekenregels in `src/lib/` (`stroom.js`
  verdeelt wie aan wie levert en tekent de lijnen via het huis; `fasen.js`,
  `prijsoverzicht.js`, `dagoverzicht.js` en `periode.js` (week, maand,
  kwartaal en jaar) voor de tabbladen). De tabbladen: `src/components/Tab*.jsx`
  (Overzicht: `TabOverzicht.jsx` met `OverzichtVandaag.jsx` en
  `OverzichtPeriode.jsx`, beide met `OverzichtApparaten.jsx`; de rekenregels
  daarvan in `src/lib/apparatenOverzicht.js`; elk onderblad gedraagt zich via
  `src/lib/bladHaak.js`), met `Tegel.jsx`, `Grafiek.jsx` (één as, een tip bij
  aanraken en een tabel; lijnen per kwartier of staven per dag, week of maand)
  en `Fasen.jsx`.
- Base44: `base44/entities/` (Huis, Meting, Opstelling, Dag), de functies
  `base44/functions/huis/` en `base44/functions/ontvangMeting/`, wat ze delen in
  `base44/shared/` (wie wat mag: `toegang.js`), en hun tests in `base44/tests/`
  (niet in de functiemappen: Base44 neemt alles uit zo'n map mee).
- Veranderd in `base44/shared/` of naast een functie? `node scripts/vingerafdruk.mjs`
  (zie **Na een deploy**).
- Alles wat de site aan Base44 vraagt, gaat door één loket: `src/api/huis.js`
  (na elkaar, pauze bij de rem). Daaronder niet de hele Base44-SDK maar
  `src/api/verbinding.js`: alleen de functie aanroepen, een foto uploaden,
  uitnodigen, inloggen en uitloggen, precies zoals de SDK (de test zet ze
  naast elkaar). Bij het openen vraagt de site eerst de stand van het huis van
  de vorige keer, nog vóór "wie ben je" (`src/lib/vroegeStand.js`).
- Weer, Overzicht, Apparaten, de bladen en Instellingen laden pas als ze nodig
  zijn, en kort na het openen toch vooraf (`src/lib/lui.jsx`); het voorbeeld
  blijft één bestand.
- Wie aan wie levert: `src/lib/stroom.js` (de batterij voorop, in hele watts).
  De woorden en de grenzen (5 W, ±20 W): `src/lib/nuInWoorden.js`; op het
  scherm `src/components/NuInWoorden.jsx`.
- Programmaatje: `brug/`. HomeWizard: `homewizard.mjs`, Zendure: `zendure.mjs`,
  wat de batterij verder meldt in `batterijInfoUit` (`zendure.mjs`), prijzen:
  `zonneplan.mjs`, `energyzero.mjs`, regels in `prijzen.mjs`, kosten van vandaag in `kosten.mjs`, de dag per kwartier en de fasen in `dag.mjs`,
  wat er gekoppeld is in `gekoppeld.mjs`, de GoodWe-omvormer in `goodwe.mjs`,
  apparaten nakijken en terugvinden na een ander adres in `adressen.mjs` en
  `kenmerk.mjs` (sinds 1.3.0, getest in `adressen.test.js`: nieuw adres,
  zelfde adres met een ander apparaat, twee meters die wisselen, helemaal weg).
  Eén ronde (meten, bijhouden, versturen, wachten) staat in `ronde.mjs`, los
  van `brug.mjs` zodat `ronde.test.js` hem met nep-meters, een nep-app en een
  nepklok naloopt (sinds 1.2.0): een gewone ronde, een meter die niet antwoordt,
  de app die 429, 401 of 500 geeft, een ronde die langer duurt dan 5 s, en dat
  er nooit twee rondes tegelijk lopen.

Bronnen: [HomeWizard API](https://github.com/homewizard/api-documentation),
[Zendure zenSDK](https://github.com/Zendure/zenSDK),
[Zendure Home Assistant-koppeling](https://github.com/Zendure/Zendure-HA)
(de cloudroute doet hetzelfde als die koppeling),
[Zonneplan in Home Assistant](https://github.com/fsaris/home-assistant-zonneplan-one)
en [pyzonneplan](https://github.com/erwindouna/pyzonneplan) (inloggen en prijzen),
[EnergyZero](https://github.com/klaasnicolaas/python-energyzero) (reserve),
[goodwe](https://github.com/marcelblijleven/goodwe) (de GoodWe-omvormer: protocol,
registers en voorbeeldbytes uit `dt.py`, `protocol.py`, `modbus.py`, `sensor.py`,
`const.py` en `tests/sample/dt/`, commit 66dfcdd).
