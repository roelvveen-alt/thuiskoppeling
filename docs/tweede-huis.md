# Een tweede huis: stappenplan

Eén app, meer huizen. Elk huis is een eigen **omgeving** met een eigen
programmaatje. Wie je in die omgeving uitnodigt, ziet alleen dat ene huis; de
beheerder van de app (rol admin in Base44) ziet ze allemaal en wisselt
ertussen. Begin pas met een tweede huis als het eerste goed werkt.

Het tweede huis hoeft niet hetzelfde te zijn als het eerste. Een paar
voorbeelden van verschillen die gewoon werken:

- **geen meter op zon en batterij samen**: de zonnepanelen hebben een eigen
  kWh-meter, en de Zendure meldt zelf wat de batterij doet;
- **een andere omvormer** (geen GoodWe): dan valt alleen het blok van de
  omvormer weg;
- **een Zendure P1-meter die later komt**: om te vergelijken met de HomeWizard
  P1, en als reserve als die niet antwoordt.

## 1. Omgeving maken (de beheerder, in de app)

1. Tandwiel › **Account** › **Nieuwe omgeving maken**, met een naam, zoals
   **Vakantiehuis**.
2. De **sleutel** en het **adres** staan er één keer: bewaar ze tot stap 2
   (kwijt: in die omgeving tandwiel › Delen › nieuwe sleutel).

## 2. Het programmaatje in dat huis (op die wifi)

Een Android-telefoon die daar blijft liggen, aan de lader, of een Chromebook
of Raspberry Pi. Stap voor stap: de README onder **Op een Android-telefoon
(Termux)**, of `docs/chromebook.md`. Gebruik voor elk toestel een eigen
alleen-lezen sleutel (deploy key) voor je kopie van de code, niet je hele
GitHub-account (zie de README onder **Liever geen GitHub-account op de
telefoon?**).

Antwoorden in de instelhulp (`node brug.mjs instellen`):

- de **P1-meter**: de meterkast;
- de **zonnepanelenmeter**: "alleen zonnepanelen" als er geen meter op zon en
  batterij samen zit;
- de **namen** zoals de bewoners ze willen zien;
- **Zendure**: lokaal als hij hem vindt, anders (of als reserve) de
  Autorisatiecloudsleutel uit de Zendure-app van dat huis. Zendure staat per
  account maar één cloudverbinding toe: gebruik die sleutel nergens anders;
- **Zonneplan**: inloggen met het e-mailadres van dat huis (de code komt in die
  mail), en de eigen **vaste kosten** uit dat contract;
- **teruggeleverd dit jaar**: uit de Zonneplan-app van dat huis;
- **plaats**: de breedte en lengte van dat huis (zonder plaats rekent het met
  het midden van het land);
- **adres en sleutel van de app**: die van stap 1.

Doe het overdag: dan kan de instelhulp nagaan of de zonnemeter levert. Zegt hij
bij de zonnemeter "Let op", kijk dan of je de goede meter hebt.

Daarna:

```bash
node brug.mjs proef
sh start.sh                 # op een telefoon; op een Chromebook via systemd
node brug.mjs termux-boot   # alleen op een telefoon
```

## 3. In de app (de beheerder)

1. Tandwiel › **Account**: kies de nieuwe omgeving.
2. **Indelen**: de tekening die het best past, rondjes goed slepen.
3. **Namen**: waar nodig.
4. **Delen**: het e-mailadres van wie er meekijkt. Die krijgt een mail van
   Base44, logt in en ziet alleen deze omgeving. Hoort hij al bij een andere
   omgeving (bijvoorbeeld als kijker in je eigen huis), haal hem daar dan eerst
   weg: iemand hoort bij één omgeving, en alleen de beheerder wisselt.

**Op afstand** (Instellingen › Op afstand): de beheerder kan daar een
Zendure-cloudsleutel invullen zonder naar het toestel in dat huis te gaan. Het
programmaatje maakt daarvoor bij de eerste start een sleutelpaar in
`brug/op-afstand.json` (nooit in git). Vergelijk de vingerafdruk in de app met
`node brug.mjs proef` op het toestel.

## Daarna: de eerste dag op de rem letten

Base44 remt voor alle huizen samen (README, **Hoeveel aanroepen**). Met twee
huizen en een paar schermen gaat dat ruim goed, maar kijk de eerste dag even:
in `brug.log` geen regels "Base44 remt", en in de app niet steeds "Base44 remt
even af". Zie je dat toch vaak, zet dan bij een van de huizen `elke_seconden`
op 10.

## Later: een Zendure P1-meter erbij

Als hij geplaatst is en op de wifi van dat huis zit, op het toestel daar:

```bash
cd ~/thuis-energie/brug && node brug.mjs instellen
```

Overal Enter; bij "Zendure P1-meter … vergelijken met de HomeWizard P1?" ja.
Daarna `node brug.mjs herstart`. In de app staat hij dan bij Net naast de
HomeWizard; valt de HomeWizard weg, dan neemt het programmaatje de Zendure P1
als reserve.
