# Bijdragen aan thuiskoppeling

Fijn dat je wilt helpen. Een paar afspraken, zodat het voor iedereen blijft
werken.

## Voor je iets indient

- **Alle poorten groen**: `node scripts/poorten.mjs` (eslint, vitest,
  `deno check`, een rooktest in Deno, de vingerafdruk, de velden en een
  build). Eén regel per poort; bij rood stopt het met code 1.
- Iets veranderd in `base44/shared/` of naast een functie? Eerst
  `node scripts/vingerafdruk.mjs`.
- Een veld of tabel erbij in `base44/entities/`? Eerst `node scripts/velden.mjs`.
  Velden en tabellen komen er alleen bij: nooit iets weghalen of hernoemen (een
  deploy haalt live weg wat hier ontbreekt, met wat erin staat).
- Schrijf in het Nederlands, kort en in gewone taal: in de app, in de
  meldingen van het programmaatje en in de commits.

## Oude versies blijven werken

Elk huis werkt zijn programmaatje (`brug/`) in eigen tempo bij. Dus:

- de functies en de site nemen elke eerdere versie van het programmaatje aan
  en tonen die (nieuwe velden zijn altijd optioneel; onbekende velden van een
  nieuwere versie vallen mild weg);
- een nieuw programmaatje werkt ook met een oudere functie;
- site en functies gaan niet tegelijk live, dus de site moet het oude
  antwoord van de server nog aankunnen.

Test een wijziging ook met een meting van de vorige versie
(`base44/tests/oudeBrug.test.js` en `nieuweBrug.test.js` laten zien hoe).

## Alleen lezen

De app en het programmaatje **kijken alleen**: ze bedienen niets (geen
batterij laden, niets schakelen). Er is één uitdrukkelijk afgebakende
uitzondering: de begrenzing van een GoodWe-omvormer bij een negatieve
terugleverprijs (`brug/omvormerSturen.mjs` met de harde lijst `SCHRIJFBAAR`,
beslist in `brug/omvormerPlan.mjs`). Die staat standaard uit, alleen de
eigenaar zet hem aan, schrijft hooguit een paar keer per uur en leest daarna
terug, en bij twijfel of een fout geeft hij de omvormer vrij. Breid dat niet
uit zonder overleg in een issue; nieuwe bediening hoort er niet in.

## Rechten en rem

- Wie wat mag, staat op één plek: `base44/shared/toegang.js`. Elke actie eerst
  401 zonder gebruiker, dan de rest. Omgevingen zien niets van elkaar.
- Base44 remt bij ongeveer 115 aanroepen per 65 s voor de hele app.
  `base44/tests/rem.test.js` houdt de som bij; een nieuwe actie die vaak loopt,
  telt mee.

## Geen geheimen in git

Nooit in git: `base44/.app.jsonc` (het app-id; dat maakt de Base44-CLI),
`brug/instellingen.json`, `brug/op-afstand.json`, `brug/zonneplan-sessie.json`,
`.env`-bestanden, sleutels, tokens, wachtwoorden, serienummers of adressen uit
echte huizen. Gebruik in tests en voorbeelden verzonnen waarden (zoals
`192.168.1.50` of `voorbeeld.nl`). `.gitignore` vangt de bekende bestanden af;
kijk voor je commit toch even met `git status` en `git diff`.

## Licentie

Wat je bijdraagt, valt onder de MIT-licentie van dit project (zie `LICENSE`).
