# Het programmaatje op een Chromebook — stap voor stap

Voor wie nog nooit een Chromebook gebruikte. Reken op een half uur. Je doet
het **in het huis waar hij komt te staan**, op die wifi.

Waarom een Chromebook: hij blijft rustig dag en nacht doorlopen, als hij aan de
lader staat. Het programmaatje draait in een stukje Linux dat in elke Chromebook
zit.

> Er mag per huis maar **één** programmaatje tegelijk naar de app sturen.
> Draait er in dat huis al een telefoon? Laat die aan tot de Chromebook werkt, en
> zet de telefoon pas daarna uit.

Wat je nodig hebt:
- de Chromebook met lader;
- de wifi-naam en het wachtwoord van het huis;
- een Google-account (een Gmail-adres) om op de Chromebook in te loggen;
- je eigen telefoon of computer om iets op GitHub te zetten (stap 5);
- de **sleutel van het programmaatje** voor dat huis (Instellingen › Delen in
  de app, of de sleutel die je bij het maken van de omgeving kreeg).

---

## Stap 1 — De Chromebook aanzetten

1. Stop de lader erin en klap hem open. Gaat hij niet aan: druk op de
   aan-knop (vaak rechtsboven op het toetsenbord of aan de zijkant).
2. Kies **Nederlands**, klik **Aan de slag**.
3. Kies de wifi van het huis en typ het wachtwoord.
4. Log in met het Google-account. Volg wat hij vraagt; alles mag op
   "Accepteren" of "Overslaan".
5. Je ziet nu het bureaublad. Onderaan staat een balk (de **plank**). Links
   onderin is een **rondje** (de **launcher**: daar vind je alle apps).
   Rechts onderin staat de **klok**.

## Stap 2 — Zorgen dat hij nooit in slaap valt

1. Klik rechtsonder op de **klok**. Er klapt een venster open.
2. Klik op het **tandwieltje** (Instellingen).
3. Links: **Apparaat** › **Voeding**. (Staat het er anders, typ bovenin het
   zoekvak "voeding".)
4. Zet:
   - bij **Aan de lader** › *Als het apparaat inactief is*: **Scherm uitzetten**
     (niet "Slaapstand");
   - **Slaapstand als de klep dicht is**: **uit**.
5. Laat dit venster open, je hebt het zo weer nodig.

## Stap 3 — Linux aanzetten

1. Typ in het zoekvak bovenin Instellingen: **Linux**.
2. Klik **Linux-ontwikkelomgeving** › **Aanzetten** (of *Instellen*).
3. Gebruikersnaam: laat staan wat hij voorstelt. Schijfgrootte: **10 GB** of
   meer. Klik **Installeren**. Dit duurt een paar minuten.
4. Daarna opent er vanzelf een zwart venster: de **Terminal**. Daarin typ (of
   plak) je de opdrachten hieronder.

**Plakken in de Terminal** gaat anders dan je gewend bent:
- kopiëren uit deze uitleg: selecteren en **Ctrl + C**;
- plakken in de Terminal: **Ctrl + Shift + V**, of klik met **twee vingers**
  op het touchpad (rechtermuisknop);
- daarna op **Enter** drukken.

Vraagt hij `[Y/n]` of "Do you want to continue?": typ **y** en Enter.

**De Terminal later terugvinden:** klik op het rondje links onderin, typ
**Terminal**, klik erop, en daarna op **penguin**.

## Stap 4 — Wat het programmaatje nodig heeft

Plak dit blok in de Terminal en druk op Enter. Het zet twee oude, kapotte
softwarebronnen uit (op oudere Chromebooks bestaan die niet meer) en haalt
Node rechtstreeks van nodejs.org, zodat het ook werkt als de Linux van de
Chromebook oud is (Debian 11, gemeten op 30-10-2026):

```bash
sudo sed -i '/bullseye-backports/s/^deb/# deb/' /etc/apt/sources.list /etc/apt/sources.list.d/*.list 2>/dev/null; sudo sed -i 's/^deb/# deb/' /etc/apt/sources.list.d/cros.list 2>/dev/null; cd ~ && V=$(curl -fsSL https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt | grep -o 'node-v[0-9.]*-linux-x64.tar.xz' | head -1) && curl -fsSLO https://nodejs.org/dist/latest-v24.x/$V && tar -xJf $V && rm $V && sudo ln -sf ~/${V%.tar.xz}/bin/node /usr/local/bin/node && sudo ln -sf ~/${V%.tar.xz}/bin/npm /usr/local/bin/npm && node --version && git --version
```

Onderaan moeten twee regels staan, zoals `v24.22.2` en `git version 2.30.2`.
(Git en curl zitten al in de Linux van de Chromebook.)

## Stap 5 — Toegang tot de code (alleen lezen)

Hieronder staat de code in je eigen (privé) kopie van thuiskoppeling op GitHub.
De Chromebook krijgt een eigen sleutel die alleen deze code mag **lezen**,
verder niets. (Is je kopie openbaar, dan kan het ook zonder sleutel:
`git clone https://github.com/<jouw-account>/thuiskoppeling.git ~/thuis-energie`.)

1. Plak in de Terminal:

   ```bash
   ssh-keygen -t ed25519 -N "" -f ~/.ssh/thuis-energie && cat ~/.ssh/thuis-energie.pub
   ```

   Onderaan verschijnt één lange regel die begint met `ssh-ed25519`. Dat is
   de sleutel (niet geheim: alleen het openbare deel).
2. Stuur die regel naar jezelf (bijvoorbeeld via WhatsApp Web of mail), of
   typ hem over.
3. Op je eigen telefoon of computer: ga naar
   **github.com/<jouw-account>/thuiskoppeling** › **Settings** › **Deploy keys**
   › **Add deploy key**.
   - Title: `Chromebook`
   - Key: de regel plakken
   - **Allow write access**: NIET aanvinken
   - **Add key**.
4. Terug op de Chromebook, plak:

   ```bash
   cd ~ && git clone -c core.sshCommand="ssh -i ~/.ssh/thuis-energie -o IdentitiesOnly=yes" git@github.com:<jouw-account>/thuiskoppeling.git thuis-energie
   ```

   De eerste keer vraagt hij *"Are you sure you want to continue connecting?"*:
   typ **yes** en Enter.

## Stap 6 — Het programmaatje instellen

```bash
cd ~/thuis-energie/brug && npm ci --omit=dev && node brug.mjs instellen
```

De instelhulp stelt vragen, net als op de telefoon (zie de antwoorden in
`docs/tweede-huis.md`, stap 2).

**Vindt hij de meters niet?** De Linux van een Chromebook zit achter een eigen
netwerkje. Vraagt hij om een ander netwerk: typ het netwerk van het huis,
meestal **192.168.1** of **192.168.0** (soms iets anders, zoals **172.16.0**; de eerste drie getallen van het adres van de router). Je kunt het ook meteen meegeven: `node brug.mjs instellen 172.16.0`. Lukt dat niet, vul de adressen dan met
de hand in: die staan in de **HomeWizard Energy-app** bij elk apparaat
(*Apparaat* › *Info* › *IP-adres*).

Krijgt een meter later van de router een ander adres, dan zoekt het
programmaatje (vanaf 1.3.0) hem zelf terug, in het netwerk van het huis waar hij
zat, niet in het netwerkje van de Chromebook. Daar hoef je
niets voor te doen; in `journalctl -u thuis-energie-brug` staat dan
"… gevonden op een nieuw adres".

## Stap 7 — Proberen

```bash
node brug.mjs proef
```

Hij laat zien wat hij van elke meter leest (en onderaan kort wat er naar de app
zou gaan); hij verstuurt nog niets. Of de app de meting aanneemt (kloppen de
sleutel en het adres?), zie je met:

```bash
node brug.mjs proef --versturen
```

Onderaan staat dan "Naar de app: De app neemt de meting aan." of in gewone
woorden wat er mis is. Staat er bij alles iets zinnigs: door naar stap 8. Staat
er een fout: maak een foto van het scherm en stuur hem.

## Stap 8 — Vanzelf laten draaien

Plak dit blok in één keer:

```bash
sed "s/User=pi/User=$USER/; s#/home/pi#$HOME#; s#/usr/bin/node#/usr/local/bin/node#" ~/thuis-energie/brug/thuis-energie-brug.service | sudo tee /etc/systemd/system/thuis-energie-brug.service >/dev/null && sudo systemctl daemon-reload && sudo systemctl enable --now thuis-energie-brug && systemctl status thuis-energie-brug --no-pager
```

Er moet **active (running)** in groen staan. Kijk in de app: binnen een paar
seconden verschijnen de cijfers van dat huis.

Klaar. Je mag de Terminal sluiten en de klep dichtdoen; laat hem aan de lader
staan.

---

## Later

**Na een herstart van de Chromebook** (bijvoorbeeld na een update van ChromeOS):
inloggen en één keer de **Terminal** openen (rondje links onderin › Terminal ›
penguin). Daarmee start Linux, en het programmaatje start vanzelf mee. Zonder
Terminal te openen draait het niet.

**Stoppen en weer aanzetten:** `sudo systemctl stop thuis-energie-brug` en
`sudo systemctl start thuis-energie-brug` (vanaf 0.13.0 doet
`node ~/thuis-energie/brug/brug.mjs stop` hetzelfde). Niet `sh start.sh`: dat is
voor een telefoon; hier houdt systemd hem aan.

**Meekijken wat hij doet:**

```bash
journalctl -u thuis-energie-brug -f
```

Stoppen met meekijken: **Ctrl + C** (het programmaatje blijft draaien).

**Bijwerken naar een nieuwe versie** (vanaf 0.13.0, net als op de telefoon):

```bash
sh ~/thuis-energie/brug/bijwerken.sh
```

Die haalt alleen een nagekeken versie op, kijkt alles na, start via systemd
opnieuw en kijkt of de eerste stand in de app komt; zo niet, dan gaat hij
vanzelf terug naar de vorige versie. Werkt hij niet zoals verwacht: kijk mee
met `journalctl -u thuis-energie-brug -f`.

**Eén keer, van 0.12.0 of ouder naar 0.13.0:** de `bijwerken.sh` die er nu
staat, kent systemd nog niet (hij zoekt in een `brug.log` die er hier niet is).
Dus deze ene keer nog met de hand:

```bash
cd ~/thuis-energie && git pull --ff-only && cd brug && npm ci --omit=dev && sudo systemctl restart thuis-energie-brug && sleep 20 && journalctl -u thuis-energie-brug -n 15 --no-pager
```

Onderaan moet "Eerste stand staat in de app." staan, en bij Apparaten in de
app versie 1.1.1 (of nieuwer). Daarna voortaan `sh ~/thuis-energie/brug/bijwerken.sh`.


Vanaf 0.7.0 maakt het programmaatje bij de eerste start een sleutelpaar in
`~/thuis-energie/brug/op-afstand.json` (alleen voor jou, niet in git). Daarmee
kan de beheerder de Zendure-cloudsleutel vanuit de app invullen (**Instellingen › Op
afstand**), zonder naar de Chromebook te gaan; zie `docs/tweede-huis.md`. Laat dat
bestand staan: weg of kapot betekent een nieuw sleutelpaar, en dan moet wat al
klaarstond in de app opnieuw.

**In de app** zie je op **Apparaten** welke versie draait en of de meters
antwoorden. Staat er "Geen live cijfers · Stand van …", dan slaapt de
Chromebook, is hij uit, of is de Terminal na een herstart nog niet geopend.
