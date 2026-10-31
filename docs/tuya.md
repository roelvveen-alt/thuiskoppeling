# Tuya (Smart Life) koppelen

Sinds programmaatje 0.8.0 leest het programmaatje ook Tuya-apparaten uit: alles
wat in de app **Smart Life** of **Tuya Smart** zit. Bijvoorbeeld: in de meterkast een
DIN-schakelaar die stroom meet (zoals een **pomp**), een **lamp**-schakelaar, en
lampen die de **spotjes in het overstek** zijn.

**Alleen kijken.** Het programmaatje vraagt alleen de stand (aan of uit, en bij
de pomp het vermogen). Het kan niets schakelen of instellen: de enige berichten
die het naar een apparaat kan sturen zijn "maak een sessiesleutel" en "wat is je
stand" (`MAG_STUREN` in `brug/tuya.mjs`). In de app zit ook geen knop.

Wat je in de app ziet:

- de **pomp** (en elke andere Tuya-meter) bij de apparaten, met wat hij nu
  gebruikt, net als een HomeWizard-stekker;
- **Apparaten › Lampen en schakelaars**: per lamp "aan", "aan · 64%", "uit",
  of "weet niet" (geen antwoord);
- op de **tekening** een rijtje spotjes onder de goot: ze branden als de lamp
  die je als "spots in het overstek" hebt gekozen aan is, en zijn donker als hij
  uit is.

## Stap voor stap (één keer, op de computer)

Tuya geeft de sleutel waarmee een apparaat praat (de *local key*) alleen via een
eigen "cloudproject". Dat maak je één keer op iot.tuya.com; daarna praat het
programmaatje alleen nog in je eigen wifi.

1. **Account.** Ga naar <https://iot.tuya.com> en maak een gratis account
   (Sign Up; land Nederland). Dat is een ander account dan je Smart Life-app.
2. **Cloudproject.** Links **Cloud › Development › Create Cloud Project**:
   - Project Name: bijvoorbeeld `Energie thuis`
   - Industry: `Smart Home`
   - Development Method: `Smart Home`
   - Data Center: **Central Europe Data Center**
   - Create. Bij de vraag welke API's: laat de voorgestelde staan (IoT Core,
     Authorization Token Management) en klik **Authorize**.
3. **Je app koppelen.** In het project: **Devices › Link App Account › Add App
   Account**. Er komt een QR-code. Open op je telefoon **Smart Life** › **Ik**
   (Me) › het scan-icoontje rechtsboven, scan de code en bevestig. Je apparaten
   staan daarna in de lijst onder Devices.
4. **Access ID en Access Secret.** In het project: **Overview** (of
   "Authorization Key"). Daar staan **Access ID/Client ID** en **Access
   Secret/Client Secret** (klik op het oogje). Laat die pagina open.
5. **De instelhulp.** Op het apparaat met het programmaatje:

   ```bash
   cd ~/thuis-energie/brug && node brug.mjs instellen
   ```

   Alle vragen zoals altijd (Enter = wat je nu hebt). Vlak voor het bewaren:
   "Tuya-apparaten (Smart Life, Tuya Smart) koppelen?" → `j`. Plak de Access ID
   en het Access Secret (dat zie je niet terwijl je plakt; dat hoort zo), kies
   het datacentrum (Enter = Central Europe). Hij haalt de lijst op, luistert
   tien seconden in de wifi waar elk apparaat zit, en vraagt per apparaat:
   - **[1] meter** (meet stroom, zoals de pomp), **[2] lamp**, **[3] schakelaar**
     (aan/uit zonder meter), of **Enter/0 niet gebruiken**;
   - de naam;
   - het IP-adres, alleen als hij het niet hoorde (staat in je router, of in
     Smart Life bij het apparaat › potloodje/… › Apparaatinformatie);
   - de Tuya-versie, alleen als hij die niet hoorde: probeer `3.3`, werkt het
     niet dan `3.4`, dan `3.5`;
   - bij een lamp of schakelaar: **"Zijn dit de spotjes in het overstek?"**
   Daarna leest hij het apparaat één keer uit ("Nu: aan · 412 W"), zodat je ziet
   of het klopt.
6. **Kijken.** `node brug.mjs proef` laat per Tuya-apparaat de stand zien, of
   waarom niet. Draait het programmaatje al, dan start het vanzelf opnieuw met
   de nieuwe instellingen.

Het **Access Secret wordt nergens bewaard**: alleen tijdens de instelhulp, om de
lijst op te halen. Een volgende keer (een nieuw apparaat, of een apparaat
opnieuw gekoppeld in Smart Life: dan verandert de local key) vraagt de
instelhulp het opnieuw. De local keys staan in `instellingen.json` (alleen voor
jou leesbaar, 0600), net als de andere sleutels; ze komen nooit op het scherm of
in de app.

### Als het niet lukt

| Wat je ziet | Wat te doen |
|---|---|
| "Tuya weigert de handtekening" | Access Secret opnieuw kopiëren (het oogje), zonder spatie. |
| "Tuya kent deze Access ID niet" | Klopt de Access ID, en het datacentrum (Central Europe)? |
| "het cloudproject mag dit niet" | Stap 3 (app koppelen) nog eens; en bij **Service API** moet "IoT Core" aan staan. |
| "Tuya geeft geen apparaten" | Het app-account is niet gekoppeld (stap 3), of in een ander datacentrum. |
| "de local_key klopt niet" | Het apparaat is opnieuw gekoppeld in Smart Life: draai de instelhulp opnieuw. |
| "het apparaat begrijpt de vraag niet" | Een andere versie kiezen (3.3 → 3.4 → 3.5). |
| "geen antwoord binnen 5 s" / "de verbinding viel weg" | Ander adres (router)? Of een ander programma (Home Assistant LocalTuya, Homey) houdt de verbinding bezet: veel Tuya-apparaten nemen er maar één tegelijk aan. |
| "een oud type; nog niet ondersteund" | Sommige oudere apparaten (id van 22 tekens) willen de stand alleen via een schakelbericht geven; dat sturen we bewust niet. |
| "achter een gateway" | Zigbee/Bluetooth-apparaten praten niet zelf in de wifi; die kunnen (nog) niet. |

## In instellingen.json

```json
"tuya": [
  { "naam": "Pomp", "id": "bf…", "local_key": "…16 tekens…", "adres": "192.168.1.50",
    "versie": "3.4", "wat": "meter", "soort": "pomp", "dp": { "aan": 1, "vermogen": 19, "schaal": 1 } },
  { "naam": "Spots overstek", "id": "bf…", "local_key": "…", "adres": "192.168.1.51",
    "versie": "3.3", "wat": "lamp", "spots": true }
]
```

`dp` (mag weg) zegt welke datapunten wat zijn; de instelhulp haalt het uit de
Tuya-cloud. Weg = de gewone: meter 1 aan/uit en 19 vermogen (× 0,1 W), lamp 20
aan/uit en 22 helderheid (10–1000; een oudere lamp 1 en 3), schakelaar 1.

## Hoe het werkt (voor wie het nakijkt)

- Elk apparaat **hooguit eens per 20 seconden**, met een harde eindtijd van 5 s
  (verbinden, afspreken en antwoord samen). Tussendoor gaat de laatste stand
  mee; na 90 s zonder antwoord "weet niet". Na drie keer op rij geen antwoord
  een melding bovenaan Apparaten (zoals bij de meters).
- Poort 6668 (TCP). **3.3**: 55AA-bericht met CRC32, inhoud AES-128-ECB met de
  local key. **3.4**: eerst een sessiesleutel (onze nonce, hun nonce met een
  HMAC van de onze, onze bevestiging; sleutel = de twee XOR, versleuteld met de
  local key), dan 55AA met HMAC-SHA256 en ECB met de sessiesleutel. **3.5**: de
  zelfde afspraak in 6699-berichten met AES-128-GCM.
- Zoeken: alleen luisteren op UDP 6666/6667 (de apparaten roepen zelf elke paar
  seconden hun adres, id en versie). Wij sturen niets.
- De meting: de pomp in `apparaten` (`vermogen_w`), lampen in het nieuwe blok
  `lampen` (`sleutel`, `naam`, `soort`, `aan`, `helderheid`, `rol: "spots"`).
  Een oudere functie in Base44 kent `lampen` niet en laat het stil weg; de pomp
  staat dan gewoon bij de apparaten. Een oudere brug stuurt geen `lampen`: dan
  geen lampen en geen spotjes, zoals vroeger.

### Wat zeker is en wat niet

- **3.3**: zeker. Vorm en CRC nagerekend op echte opnames (TuyaAPI/cli issue
  #23), AES met het echte voorbeeld uit TuyAPI, en de statusvraag byte voor byte
  gelijk aan tinytuya.
- **3.4** en **3.5**: de berichten en de sessiesleutel zijn byte voor byte gelijk
  aan wat tinytuya 1.17.4 maakt (met vaste nonces; zie hieronder). Er zijn geen
  openbare opnames mét sleutel, dus nog niet nagelopen met een echt apparaat.
- **Datapunten**: 19 = vermogen × 0,1 W is het gewone; de cloudspecificatie
  geeft per apparaat het echte nummer en de schaal. Een DIN-meter die alles in
  één raw-datapunt (`phase_a`) meldt, wordt (nog) niet gelezen.
- **Lokaal adres**: de cloudlijst geeft het adres van je internetaansluiting,
  niet dat in de wifi; dat komt uit het luisteren, of je typt het.

Bronnen: tinytuya (<https://github.com/jasonacox/tinytuya>, `core/*.py`,
`Cloud.py`), TuyAPI (<https://github.com/codetheweb/tuyapi>, `lib/cipher.js`,
`test/`), Tuya's eigen `tuya-connector-python` (`openapi.py`, het ondertekenen),
TuyaAPI/cli issue #23 (echte 3.3-opnames).

De vaste testberichten in `brug/tuya.test.js` zijn zo gemaakt (Python met
`pip install tinytuya==1.17.4`, tijd vast op 1700000000, debug aan voor de vaste
iv `0123456789ab`): `OutletDevice(id, ip, key, version=…)`, dan
`generate_payload(DP_QUERY)` en `_encode_message(...)` voor wat wij sturen,
`_negotiate_session_key_generate_step_1/3/finalize` met onze nonce `00 01 … 0f`
en hun nonce `a0 a1 … af`, en `pack_message(TuyaMessage(...), hmac_key=…)` voor
de antwoorden van het apparaat.

## Stand (30-10-2026)

De code staat klaar sinds programmaatje 0.8.0, maar is nog niet met echte apparaten in een proefhuis nagelopen. Werkt het bij jou niet: zie de stappen hierboven, en meld het graag (CONTRIBUTING.md).
