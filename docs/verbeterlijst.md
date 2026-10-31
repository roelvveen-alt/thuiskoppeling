# Verbeterlijst (onderzoek ronde 3, 30-10-2026)

116 punten uit zes invalshoeken (beveiliging, rekenregels, programmaatje, weergave, proces, prestaties).
Een deel is door twee controleurs nagekeken; bijna de helft daarvan bleek niet te kloppen. Daarom: elk punt eerst zelf nagaan.
Werk zuinig: één pakketje tegelijk, testen, samenvoegen, uitrollen. Status: **klaar**, **bezig**, **weerlegd**, of open.

| id | ernst | soort | status | titel |
|---|---|---|---|---|
| beveiliging-1 | hoog | beveiliging | weerlegd | Realtime-meldingen per tabel: nameten of een vreemde alle huizen live kan meelezen, en zo nodig de inhoud versleutelen |
| beveiliging-2 | middel | beveiliging | weerlegd | Een Base44-Api-Url uit het verzoek bepaalt waar het servertoken heen gaat |
| beveiliging-3 | middel | beveiliging | weerlegd | Uitgeschakeld en onbevestigd: magInDeApp kijkt naar een veld dat deze app niet heeft |
| beveiliging-4 | middel | beveiliging | weerlegd | Zonder account de rem van de hele app opmaken via ontvangMeting en huis |
| beveiliging-5 | middel | beveiliging | weerlegd | Zendure-cloud: de inlog voor de berichtenserver gaat onversleuteld over internet |
| beveiliging-6 | middel | beveiliging | klaar | De telefoon krijgt via gh auth login schrijfrechten op al je repo's, ook die van je werk |
| beveiliging-7 | middel | beveiliging | weerlegd | Uitrollen controleert niet naar welke app het gaat |
| beveiliging-8 | middel | beveiliging | weerlegd | Altijd meteen de nieuwste versie, met installatiescripts aan |
| beveiliging-9 | middel | fout | klaar | Eén traag apparaat in de wifi (of een trage server) zet het programmaatje stil |
| beveiliging-10 | middel | fout | klaar | Jaarteller voor het Zonnebonus-plafond: één lage lezing telt de hele meterstand erbij |
| beveiliging-11 | laag | beveiliging | klaar | Kijkers zien de adressen van alle apparaten in de wifi |
| beveiliging-12 | laag | beveiliging | klaar | Een tikfout in instellingen.json zet een stukje van de sleutels in brug.log |
| beveiliging-13 | laag | beveiliging | klaar | Rechten van de bestanden met geheimen worden niet nagekeken |
| beveiliging-14 | laag | fout | klaar | Na een nieuwe sleutel zegt het programmaatje 'Gestopt', maar het start elke halve minuut opnieuw |
| beveiliging-15 | laag | beveiliging | klaar | HomeWizard: zonder serienummer telt elk HomeWizard-certificaat, en v1 heeft geen enkele controle |
| beveiliging-16 | laag | verbetering | klaar | Datums van het programmaatje worden alleen op vorm getoetst (risico voor de nieuwe tabel Dag) |
| beveiliging-17 | laag | verbetering | klaar | Tekst uit de wifi en uit instellingen.json gaat zonder filter op stuurtekens naar terminal en app |
| beveiliging-18 | laag | verbetering | later | Geen CSP terwijl het inlogtoken in localStorage staat, en lettertypes via Google |
| programmaatje-1 | hoog | fout | klaar | Eén afgekeurd blok houdt de hele app stil, tot middernacht |
| programmaatje-2 | hoog | fout | klaar | Na een herstart van de telefoon start het programmaatje soms niet meer (oud draait.pid) |
| programmaatje-3 | hoog | fout | klaar | Half geschreven vandaag.json: vandaag, de grafiek, de week en de jaartelling weg |
| programmaatje-4 | hoog | fout | klaar | Eén lagere tellerstand zet de jaartelling voor het plafond op 30.704 kWh |
| programmaatje-5 | middel | fout | klaar | Zon en batterij op één meter: als de Zendure-cloud achterloopt, klopt de som niet meer (laden telt als huis, spookzon) |
| programmaatje-6 | middel | fout | klaar | Zendure-cloud valt stil: tot 10 minuten oude batterij telt als nu, en opnieuw verbinden duurt ~25 minuten |
| programmaatje-7 | middel | fout | klaar | Zendure-cloud niet bereikbaar bij het starten: het hele programmaatje stopt, en zegt dat de sleutel niet klopt |
| programmaatje-8 | middel | fout | klaar | Een meter die blijft hangen, laat het hele programmaatje voor altijd stilstaan |
| programmaatje-9 | middel | fout | klaar | Sleutel niet (meer) goed: geen stop maar elke 30 seconden opnieuw, met elke keer een inlog bij Zendure en Zonneplan |
| programmaatje-10 | middel | fout | klaar | Wifi of programmaatje uren weg op één dag: het verbruik telt tegen de verkeerde prijs of helemaal niet, en de dag heet toch compleet |
| programmaatje-11 | middel | fout | klaar | Verkeerde klok bij het opstarten gooit vandaag weg, zet '1970' in de week en kan de jaartelling terugzetten |
| programmaatje-12 | middel | verbetering | klaar | Wat er mis is, staat alleen in brug.log: laat het programmaatje het zelf in de app melden |
| programmaatje-13 | middel | verbetering | klaar | Bijwerken met git pull is niet altijd veilig: tussenstanden, geen npm ci, geen zelftest of terugval |
| programmaatje-14 | middel | beveiliging | klaar | Op de telefoon staat een GitHub-sleutel met toegang tot al je privé-repo's |
| programmaatje-15 | middel | verbetering | klaar | Krijgt een meter een ander IP-adres, dan vindt het programmaatje hem nooit meer (en bij v1 kan het een andere meter lezen) (ronde 21, 1.3.0: kenmerk per apparaat in adressen.json, elk antwoord nagekeken, rustig terugzoeken in hetzelfde netwerk, logregel en melding; adressen.mjs. Niet voor Tuya) |
| programmaatje-16 | middel | verbetering | klaar | Dag en nacht op een Android-telefoon: de handleiding mist het afschieten door Android, een waakhond van buiten en de accu |
| programmaatje-17 | laag | verbetering | klaar | Logboek groeit door zolang node draait, een haperende meter vult het snel, en er staat geen datum in |
| programmaatje-18 | laag | verbetering | klaar | Foutmeldingen in het logboek zijn Node-jargon |
| programmaatje-19 | laag | verbetering | klaar | Bedragen van 2026 staan vast; vanaf 1 januari 2027 rekenen de schatting en de vaste kosten stil verkeerd |
| programmaatje-20 | laag | verbetering | klaar | De som voor het huis staat dubbel (programmaatje en site), straks driedubbel met de Dag, zonder gezamenlijke test |
| rekenregels-1 | hoog | fout | weerlegd | Vanaf 1 januari 2027 telt de terugleverprijs de inkoopvergoeding (en btw) mee, terwijl de regel 'marktprijs plus Zonnebonus' zegt |
| rekenregels-2 | middel | fout | weerlegd | Een gat in de metingen wordt in één keer geboekt tegen de prijs van nu, ook over middernacht, en dan tellen de Vandaag-tegels niet meer op |
| rekenregels-3 | middel | fout | klaar | Betaald en Verdiend staan er zonder teken: bij negatieve prijzen klopt het Geld-blok niet |
| rekenregels-4 | middel | fout | weerlegd | Het plafond van de Zonnebonus hangt aan vandaag.json: is dat bestand kwijt, dan telt de app weer vanaf het getal uit de instelhulp |
| rekenregels-5 | middel | fout | klaar | Meter 'zon + batterij': valt de Zendure even stil of loopt hij achter, dan wordt de batterij 'zon', ook 's nachts |
| rekenregels-6 | middel | fout | weerlegd | De gladstrijking (mediaan van drie) zit alleen op de zon: bij elke wolk springt het huis even naar 0 of naar 5 kW |
| rekenregels-7 | middel | fout | klaar | Eigen verbruik en zelfvoorzienend worden berekend op kwartiergemiddelden: afnemen en terugleveren binnen een kwartier vallen tegen elkaar weg |
| rekenregels-8 | middel | fout | weerlegd | Zelfvoorzienend telt stroom die via de batterij uit het net kwam als 'niet uit het net' |
| rekenregels-9 | middel | verbetering | klaar | Eigen verbruik verandert stilletjes mee als verdeelStroom de regel 'de batterij gaat voor' krijgt |
| rekenregels-10 | middel | verbetering | later | Saldering 2026: wat je meer teruglevert dan je afneemt, telt in de app toch mee met energiebelasting |
| rekenregels-11 | middel | fout | klaar | Prijzen verversen vervangt de hele lijst: begint het antwoord van Zonneplan bij het huidige uur, dan verdwijnt de ochtend uit de voorspelling |
| rekenregels-12 | laag | fout | klaar | dag.mjs: een meting zonder net telt als 0 W in het kwartier, en het huis wordt dan zon + batterij |
| rekenregels-13 | laag | fout | klaar | 'Morgen' = nu + 24 uur: op de zaterdagavond voor de zomertijd is 'morgen' maandag |
| rekenregels-14 | laag | fout | klaar | De site kijkt niet naar de datum van vandaag, dag, jaar en prijs: gisteren staat er als vandaag |
| rekenregels-15 | laag | fout | klaar | Voorspelling op 31 december: 1 januari zonder Zonnebonus, omdat het plafond van 2026 vol is |
| rekenregels-16 | laag | fout | klaar | Eén prijs boven € 5 laat de hele meting weigeren, en de brug blijft hem sturen: dan staat de hele app stil |
| prestaties-1 | hoog | verbetering | klaar | Twee huizen met elk een open scherm gaan over de rem van Base44 |
| prestaties-2 | middel | fout | klaar | Eén te grote of afgekeurde volle meting houdt daarna álle metingen tegen |
| prestaties-3 | middel | verbetering | klaar | De site vraagt elke 5 s, ook als het programmaatje trager stuurt, stilstaat of nog nooit stuurde |
| prestaties-4 | middel | verbetering | niet nodig | 'stand' voor de beheerder leest Huis.get zonder dat het iets beslist |
| prestaties-5 | middel | verbetering | klaar | auth.me en het lidmaatschap worden voor een leesvraag elke 5 s vers opgehaald |
| prestaties-6 | middel | verbetering | klaar | ontvangMeting zoekt bij elke meting het huis opnieuw op via de sleutel |
| prestaties-7 | middel | verbetering | klaar | 'stand' stuurt elke 5 s de hele rij van ~12 KB mee, ook wat maar eens per minuut of kwartier verandert |
| prestaties-8 | middel | verbetering | klaar | Bij de rem probeert één 'stand' het tot 12 keer, terwijl het antwoord 5 s later toch weer gevraagd wordt |
| prestaties-9 | middel | verbetering | klaar | De animaties op het tabblad Huis houden de hoofddraad van een gewone telefoon 80-85% bezig (ronde 21: stipjes als losse rondjes met een animatie op transform, ring zonder overgang, korte lussen met Web Animations; gemeten met CPU 4x trager op 390 px: 72-79% → 7-8% in beeld, 23% → 3% uit beeld) |
| prestaties-10 | middel | verbetering | klaar | Risico's voor de nieuwe Dag-tabel en de actie 'periode' (patronen uit de huidige code) |
| prestaties-11 | laag | fout | klaar | Stipjes springen bij elke nieuwe stand |
| prestaties-12 | laag | verbetering | klaar | De bundel is 506 KB; de Base44-SDK sleept ~140 KB mee die de site niet gebruikt (ronde 20: eigen verbinding zonder SDK, en Weer/Overzicht/Apparaten/bladen/Instellingen apart: hoofdbundel 697 → 443 KB, gzip 224 → 145 KB) |
| prestaties-13 | laag | verbetering | klaar | Lettertypes van Google: een blokkerend stijlblad en ~138 KB van een derde partij bij elke koude opening |
| prestaties-14 | laag | verbetering | klaar | De foto van het huis komt bij elke opening en elke 50 minuten opnieuw binnen |
| prestaties-15 | laag | verbetering | klaar | Elke 5 s een nieuwe TLS-verbinding vanaf de telefoon, naar Base44 én naar elke HomeWizard (ronde 21, 1.3.0: keep-alive in web.mjs, per HomeWizard v2 een eigen verbinding; harde tijdslimiet blijft) |
| prestaties-16 | laag | fout | klaar | vandaag.json wordt elke minuut overschreven zonder vangnet |
| prestaties-17 | laag | beveiliging | klaar | Een aanroep van de functie huis zonder inlog kost toch een Base44-aanroep |
| prestaties-18 | laag | verbetering | klaar | Bij het openen wachten de eerste cijfers achter de indeling, en is er drie keer auth.me (ronde 20: de stand van het vorige huis vóór 'mijn'; ronde 21: mijn en opstelling gebruiken het onthouden auth.me van de leesvragen, openen kost één auth.me; rem.test.js) |
| prestaties-19 | laag | verbetering | klaar | Het hele scherm rekent elke 5 s opnieuw, ook als er niets veranderde (ronde 21: gelijke delen houden hun object, `src/lib/gelijk.js`; tekening als memo; React-werk op Huis 106 → 58 ms per 10 s) |
| prestaties-20 | laag | fout | klaar | Na 'nietBijgewerkt' vraagt de site niet meer, terwijl de kop 'zo weer live' belooft |
| weergave-1 | hoog | fout | klaar | Vanaf het beginscherm op een iPhone valt de kop met het tandwiel onder de statusbalk, en in licht thema is de klok onleesbaar |
| weergave-2 | hoog | verbetering | klaar | Op de foto staat nergens dat het getal onder het huis het eigen verbruik is, en er staat nooit 'laadt', 'levert' of 'terug' |
| weergave-3 | middel | fout | klaar | De lijn huis → net loopt dwars door het batterijrondje, en lijkt zo batterij → net |
| weergave-4 | middel | verbetering | weerlegd | Rond 0 W knippert het net: zin, lijn en kop wisselen elke 5 seconden |
| weergave-5 | middel | verbetering | klaar | Cijfers in JetBrains Mono geven '458  W', '2 , 8 kW' en '€  0,00', en de notatie verschilt per plek |
| weergave-6 | middel | fout | klaar | Tablet staand (768–834 px): kaarten van 164–230 px breed, afgekapte tekst en een pagina die breder is dan het scherm |
| weergave-7 | middel | fout | weerlegd | De zwevende tabbalk dekt op een liggende tablet de onderkant van de foto af (en op 320 px wordt 'Apparaten' afgekapt) |
| weergave-8 | middel | fout | klaar | Tijdens laden en in lege toestanden staat er wat niet klopt ('Je huis gebruikt nu 0 W', 'Geen batterij gekoppeld') |
| weergave-9 | middel | fout | klaar | Als de meter in de meterkast wegvalt, is het huisverbruik een gok, en de geldkaart zegt 'Nog geen stroomprijs bekend' naast de prijs |
| weergave-10 | middel | verbetering | klaar | Oude cijfers zien eruit als live: de stipjes op de foto blijven lopen |
| weergave-11 | middel | fout | klaar | Het detailblad heet een 'modal', maar Tab springt naar de pagina erachter |
| weergave-12 | laag | fout | klaar | Toetsenbord en focus: tabbalk onbereikbaar in Instellingen, geen focusrand op 'Eigen foto kiezen', keuzerijen zonder pijltjes |
| weergave-13 | laag | verbetering | klaar | De live-regel in de kop praat elke seconde tegen een schermlezer |
| weergave-14 | middel | verbetering | klaar | De animaties op de foto laten de telefoon continu rekenen, ook als de foto uit beeld is (ronde 21: ook stil als het scherm weg is; bij minder beweging staan de stipjes op hun plek) |
| weergave-15 | middel | verbetering | deels | Huis-tab en Nu-tab tonen hetzelfde, maar net anders (volgorde, batterijgetal, zinnen, namen) |
| weergave-16 | laag | verbetering | klaar | Het getal onder een rondje reageert niet op een tik, en nergens staat dat je rondjes kunt aantikken |
| weergave-17 | laag | verbetering | klaar | Groot scherm: het blad dekt het aangetikte rondje af, en de Nu-tegels worden uitgerekt (ronde 21: vanaf 1024 px het blad rechts naast de foto, daartussen boven of onder het rondje (`bladPlek`); tegels zo hoog als hun inhoud) |
| weergave-18 | laag | verbetering | klaar | Detailbladen: dubbele zin bij de batterij, '100%' zonder duidelijke basis, en de Zon-tegel opent maar één plek |
| weergave-19 | middel | fout | klaar | 'Zelfvoorzienend' telt netstroom die 's nachts via de batterij ging als 'niet uit het net' (sinds ronde 19 op het scherm 1 − uit het net ÷ huis, delenVan; de verdeling blijft alleen in het veld van de tabel Dag; test in periode.test.js) |
| weergave-20 | laag | verbetering | klaar | Grafiek (gedeeld, ook voor het nieuwe Overzicht): tabelknop zonder pijltje, as zonder eenheid, label over de lijn (ronde 21: kWh en € op elke as, 'nu' en de vlaklabels zoeken een vrije plek) |
| weergave-21 | laag | verbetering | klaar | Technische uitleg (Termux, instellingen.json) staat ook bij kijkers, en wijst niet naar de instelhulp |
| weergave-22 | laag | verbetering | klaar | Delen: de prullenbak haalt iemand meteen weg, zonder te vragen |
| weergave-23 | laag | verbetering | klaar | Een paar losse kleuren buiten de tokens in index.css |
| weergave-24 | laag | verbetering | klaar | 'Wat gebruikt er nu stroom?' op Apparaten is te lang: één regel nu aan, één regel altijd aan, de rest in een blok dat dicht staat |
| weergave-25 | laag | verbetering | klaar | Vlaggenmast bij het garagehuis netter, met een vlag die met de wind meegaat: slap, wapperen, stevig, storm (30-10-2026) |
| weergave-26 | laag | verbetering | klaar | Tekening met dierenverblijf: panelen op het dierenverblijf verder weg, een kerktoren rechts aan de rand in plaats van de molen, geen kip voor het huis, een auto in de carport en een auto voor het huis (30-10-2026) |
| weergave-27 | laag | verbetering | klaar | De panelen op het hoofddak volgen het dakvlak (evenwijdig aan nok en goot, langs de schuine rand) en bedekken meer: 7 x 5 (30-10-2026) |
| weergave-28 | laag | verbetering | klaar | Het weer duidelijker op elke tekening: meer wolken, dichtere regen en sneeuw, natte grond met plassen, een sneeuwlaag, lage mist, windstrepen, bomen en hagen die meebuigen (30-10-2026) |
| weergave-29 | middel | verbetering | klaar | 'Nog niks te leren?': de herkenning leert handtekeningen (piek bij het aangaan, traag aanlopen en afbouwen, golven, aan-en-uit, rustig blok), groepeert wat terugkomt en vraagt de eigenaar bovenaan 'Wat gebruikt er nu stroom?' wat het is (hooguit twee, 'Weet ik niet'/'Later' een week niet, stipje bij Apparaten, kijkers niet); 'Ik ken nu N apparaten'; terugkerende onbekenden apart in Overzicht › Apparaten in plaats van in de Rest (31-10-2026; ronde 23, programmaatje 1.4.0: brug/herkennen.mjs, base44/shared/herkennen.js, Herkennen.jsx) |
| data-1 | middel | verbetering | klaar | Meer uit de apparaten, alleen lezen: gas, water en warmte van de slimme meter (per dag, op Nu en in Overzicht) en gasmeterstanden zelf invullen bij Instellingen › Gas; tarief en maandpiek; isolatie, lekstroom, busspanning en arbeidsfactor van de omvormer met een melding (app en Logboek) buiten de grens; per accu celspanningen, laadcycli en verwarmen, en de laad-/leverlimiet; tot 18 accu's (drie 2400 AC's met elk 6); de batterij leert hoeveel kWh er echt per procent uit of in gaat; eens per dag de veldnamen per apparaat voor de beheerder (31-10-2026; ronde 23, programmaatje 1.4.0) |
| proces-1 | hoog | fout | klaar | Een uitrol wist live alles wat lokaal ontbreekt (tabellen, velden, koppelingen), zonder het te melden |
| proces-2 | hoog | verbetering | klaar | Geen uitrolscript: de nameting bewijst niets, en twee stille valkuilen |
| proces-3 | hoog | beveiliging | klaar | Op de telefoons staat een GitHub-sleutel voor al je repo's, ook die van je werk |
| proces-4 | middel | fout | klaar | Eén onbekende waarde in 'gekoppeld' houdt het hele huis stil (nieuwe brug, oude functie) |
| proces-5 | middel | fout | klaar | Na één 'nietBijgewerkt' tijdens een uitrol leest de site nooit meer opnieuw |
| proces-6 | middel | fout | klaar | nieuwste.mjs meldt 'alles is de nieuwste versie' als het register onbereikbaar is |
| proces-7 | middel | fout | klaar | De versie van het programmaatje zegt niet welke code er draait |
| proces-8 | middel | beveiliging | klaar | Niets bewaakt dat elke tabel 'alleen beheerder' blijft en dat velden er alleen bij komen |
| proces-9 | middel | verbetering | klaar | Terugdraaien staat nergens, en de voor de hand liggende manier wist de nieuwste tabellen |
| proces-10 | middel | verbetering | klaar | De keten brug → controle → stand → scherm wordt nergens in één test nagelopen |
| proces-11 | middel | verbetering | klaar | De servercode draait in de poorten nooit in Deno, en deno check kijkt naar twee regels |
| proces-12 | middel | verbetering | klaar | De draailus van het programmaatje is helemaal ongetest |
| proces-13 | middel | verbetering | klaar | Bijwerken op de telefoon: één veilige opdracht, een vaste lijn en een weg terug |
| proces-14 | middel | verbetering | klaar | Dezelfde verdeelregel komt dubbel: Vandaag (site) en Week/Maand (server) kunnen gaan verschillen (op het scherm rekenen Vandaag en Week/Maand allebei met delenVan uit de kWh; de verdeling site/server/programmaatje houden dagboek.test.js en brug/dag.test.js gelijk, en periode.test.js Vandaag en Week) |
| proces-15 | middel | verbetering | klaar | Met het tweede huis komt de rem van Base44 in zicht |
| proces-16 | middel | verbetering | klaar | Eén opdracht voor alle poorten, die dist/ niet met het voorbeeld vult |
| proces-17 | laag | fout | klaar | vandaag.json wordt niet veilig weggeschreven; een kapot bestand zet de jaarteller terug |
| proces-18 | laag | fout | klaar | Het stappenplan voor een tweede huis is achterhaald over de Zendure P1 |
| proces-19 | laag | fout | klaar | maakIconen.mjs doet stil niets in een map met een spatie of op Windows |

## Ronde 24 (31-10-2026): programmaatje 1.5.0, de omvormer bij een negatieve prijs en de spanningswacht

| id | ernst | soort | status | titel |
|---|---|---|---|---|
| ronde24-1 | middel | verbetering | klaar | De GoodWe begrenzen als terugleveren geld kost: één register (40336, 0–100% in stappen van 10), alleen als de eigenaar het aanzet, teruglezen, schrijfrem, bij twijfel vrij |
| ronde24-2 | middel | verbetering | klaar | Begrenzen alleen als het loont: saldering tot 2027 (netto-afnemer of -terugleveraar), gedeeltelijk tot het eigen verbruik, live bijsturen (wasmachine), helemaal uit alleen als afnemen ook geld oplevert |
| ronde24-3 | middel | verbetering | klaar | De spanningswacht: 10-minutengemiddelde en piek per fase uit de beste bron (omvormer, P1, driefase kWh-meter; zonnemeter apart), uitval bij hoge spanning (ook storingsbit 17), tellers en een lijst voor de netbeheerder; niets bijsturen |
| ronde24-4 | middel | onderzoek | open | Met de eigenaar bij de omvormer `node brug.mjs omvormer-test` draaien: begrenst 40336 het hele vermogen of alleen de teruglevering (GoodWe-meter?), staat de grensschakelaar 40327 aan, en onthoudt hij de waarde na een herstart (flash)? Pas daarna aanzetten |
| ronde24-5 | laag | onderzoek | open | Of 40336 bij elke schrijfactie in flash gaat, staat nergens (dt.py zegt het niet); daarom nu zuinig (omlaag 5 min, omhoog 1 min, 6 per uur, 20 per dag). Met GoodWe of de installateur nagaan, dan de rem eventueel ruimer |
| ronde24-6 | laag | verbetering | open | Netto-afnemer of -terugleveraar zet de eigenaar nu zelf; het programmaatje kan het uit de jaartellers van de P1 halen (afname en teruglevering dit jaar) |
| ronde24-7 | laag | onderzoek | open | De spanningswacht in huis B: werkt pas na bijwerken (hij draait 0.6.1); kijken of de zonnemeter en de spa-meter op dezelfde fase een paar volt verschillen, en welke fase de zonnepanelen zijn (Instellingen › Namen) |
