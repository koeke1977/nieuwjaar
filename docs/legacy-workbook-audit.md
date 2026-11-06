# Analyse oude nieuwjaars-Excel 2025–2026

Bronbestand: `BBQOudNieuw20252026.xlsm`  
Status: inhoud en formules geïnspecteerd; bedragen hieronder zijn de berekende waarden uit de werkmap.

## 1. Opbouw van de werkmap

De werkmap bevat 13 tabbladen:
- `Algemeen`: centrale deelnemersaantallen, vleesoverzicht, uitgaven, verdeelsleutels en eindafrekening.
- `G`: totaaloverzicht van de vleesbestellingen.
- `H` t/m `R`: 11 afzonderlijke groepsfiches met de vleesbestelling en financiële samenvatting.

De huidige werkmap werkt dus met 11 groepen en niet met 51 afzonderlijke persoonsfiches. De individuele namen van de leden zijn niet in deze fiches opgenomen; alleen aantallen volwassenen/18+ en totaalaantallen per groep. Voor de nieuwe app kunnen de bestaande groepen dus als startgroepen worden overgenomen, maar individuele personen moeten nadien worden toegevoegd.

## 2. Deelnemers en groepen

| Groep | 18+ in Excel | Personen | Kinderen / overige |
|---|---:|---:|---:|
| Olivier & Kelly | 2 | 4 | 2 |
| Boef & Claudia | 2 | 4 | 2 |
| Koen & Isabella | 2 | 4 | 2 |
| Lorenzo & Kim | 2 | 4 | 2 |
| Ben & Tina | 4 | 6 | 2 |
| Inge | 1 | 3 | 2 |
| Jurgen & Nathalie | 2 | 4 | 2 |
| Filip & Nathalie | 2 | 4 | 2 |
| Maaike & Jelke | 2 | 2 | 0 |
| Wim & Annelies | 2 | 5 | 3 |
| Jong geweld | 11 | 11 | 0 |
| **Totaal** | **32** | **51** | **19** |

De rij `18+ Drinkers` wordt in de Excel gebruikt als basis voor de volwassen-/drankverdeling. De nieuwe app moet dit expliciet per persoon en per editie vastleggen, zodat er geen leeftijdscategorie op groepsniveau hoeft te worden verondersteld.

### Nieuwe deelnemersstructuur

De nieuwe gegevensstructuur vertrekt van individuele personen:
- Elke deelnemer krijgt een eigen fiche.
- Een persoon kan zelfstandig deelnemen of lid zijn van een groep.
- Een groep kan bestaan uit volwassenen en kinderen, bijvoorbeeld twee ouders en hun kinderen.
- Een groep kan later worden aangepast, gesplitst of opnieuw samengesteld.
- "Jong geweld" kan dus worden opgesplitst in individuele deelnemers en later desgewenst opnieuw als groep worden beheerd.
- Deelnemers zonder groep vormen elk hun eigen afrekeneenheid.

Voor bestellingen en afrekening worden individuele gegevens op groepsniveau samengebracht. Het groepsportaal kan namens alle leden bestellingen beheren; individuele deelnemers zonder groep beheren hun eigen fiche.

## 3. Vleesbestellingen

De Excel bevat acht vleescategorieën:

| Vleescategorie | Totaal besteld |
|---|---:|
| Steak | 28 |
| Kip | 14 |
| Saté | 8 |
| Worst | 15 |
| Hamburger | 5 |
| Witte pens | 6 |
| Sparerib | 18 |
| Bolletjes op stok | 13 |
| **Totaal** | **107** |

De beenhouwerfactuur bedraagt **€ 738,00**. De berekening gebruikt één prijs per vleesportie:

`€738,00 / 107 = €6,897196...` per portie.

Elk gezin krijgt zijn aandeel op basis van het aantal bestelde vleesporties, ongeacht het type vlees. De app moet de factuur dus verdelen over de effectieve porties. Gebruik intern eurocenten en een vaste restverdeling, zodat de toegewezen bedragen samen exact € 738,00 blijven.

### Bestellingen per groep

| Groep | Steak | Kip | Saté | Worst | Hamburger | Witte pens | Sparerib | Bolletjes | Totaal |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Olivier & Kelly | 2 | 0 | 1 | 1 | 2 | 0 | 2 | 0 | 8 |
| Boef & Claudia | 2 | 1 | 1 | 0 | 2 | 0 | 2 | 0 | 8 |
| Koen & Isabella | 1 | 1 | 2 | 2 | 0 | 0 | 0 | 0 | 6 |
| Lorenzo & Kim | 2 | 0 | 1 | 1 | 0 | 2 | 2 | 1 | 9 |
| Ben & Tina | 4 | 3 | 1 | 0 | 0 | 1 | 3 | 0 | 12 |
| Inge | 1 | 1 | 0 | 1 | 0 | 1 | 0 | 2 | 6 |
| Jurgen & Nathalie | 3 | 1 | 0 | 2 | 1 | 0 | 1 | 2 | 10 |
| Filip & Nathalie | 3 | 1 | 1 | 2 | 0 | 0 | 0 | 2 | 9 |
| Maaike & Jelke | 2 | 1 | 0 | 0 | 0 | 1 | 0 | 0 | 4 |
| Wim & Annelies | 2 | 1 | 0 | 3 | 0 | 0 | 2 | 3 | 11 |
| Jong geweld | 6 | 4 | 1 | 3 | 0 | 1 | 6 | 3 | 24 |
| **Totaal** | **28** | **14** | **8** | **15** | **5** | **6** | **18** | **13** | **107** |

## 4. Uitgaven en verdeelsleutels

De totale uitgaven bedragen **€ 2.011,35**.

| Uitgave | Totaal | Huidige Excel-verdeelsleutel | Basis |
|---|---:|---|---:|
| Beenhouwer | € 738,00 | Per vleesportie | 107 porties |
| Afbakbrood + chips + accessoires | € 36,90 | Iedereen | 51 personen |
| Dessert + bruiswater, boter en saus | € 51,15 | Iedereen | 51 personen |
| Drank | € 455,37 | 18+ / niet voor kinderen | 32 personen |
| Aldi, bouchées en inhoud hapjes | € 83,25 | Iedereen | 51 personen |
| IJsblokken + ijsjes Kids | € 25,23 | Iedereen volgens de formule | 51 personen |
| Dip en Doritos | € 59,00 | Iedereen | 51 personen |
| Soep en Temu & Ava | € 77,45 | Iedereen | 51 personen |
| Limoncello + scampi's + aperitiefhapjes | € 119,00 | Iedereen | 51 personen |
| Vat bier | € 360,00 | 18+ | 32 personen |
| IJs vanille | € 6,00 | Iedereen | 51 personen |
| **Totaal** | **€ 2.011,35** | | |

De huidige verdeelsleutels worden in de Excel op de volgende manier berekend:
- **Iedereen:** kost gedeeld door 51, vervolgens vermenigvuldigd met het aantal personen in de groep.
- **18+:** kost gedeeld door 32, vervolgens vermenigvuldigd met het aantal 18+-deelnemers in de groep.
- **Per vleesportie:** beenhouwerfactuur gedeeld door 107, vervolgens vermenigvuldigd met het aantal bestelde porties.

De oude Excel bevat hiermee al het concept van een verdeelsleutel per uitgave. De nieuwe app moet dit als een expliciete keuze aanbieden, in plaats van via verborgen formules en vaste celverwijzingen.

### Te bevestigen regel

De post **"IJsblokken + ijsjes Kids"** wordt in de huidige Excel toch over alle 51 aanwezigen verdeeld. De omschrijving doet vermoeden dat mogelijk alleen kinderen bedoeld zijn, maar de formule gebruikt het totaal aantal personen. Dit is een bewuste bevestigingsvraag voor de nieuwe standaard; niet automatisch wijzigen.

## 5. Voorschotten en afrekening

De Excel maakt een onderscheid tussen:
- **Betalen:** het aandeel van een groep in de totale uitgaven. In de werkmap wordt dit als negatief bedrag weergegeven.
- **Krijgen:** de uitgaven die door die groep zijn voorgeschoten of betaald voor de organisatie.
- **Saldo:** voorgeschoten bedragen minus het eigen kostenaandeel.

Een positief saldo betekent dat de groep geld terug moet krijgen. Een negatief saldo betekent dat de groep nog moet betalen.

| Groep | Aandeel kosten | Voorgeschoten | Saldo |
|---|---:|---:|---:|
| Olivier & Kelly | € 142,06 | € 455,37 | + € 313,31 |
| Boef & Claudia | € 142,06 | € 51,15 | - € 90,91 |
| Koen & Isabella | € 128,26 | € 36,90 | - € 91,36 |
| Lorenzo & Kim | € 148,96 | € 83,25 | - € 65,71 |
| Ben & Tina | € 238,57 | € 1.175,45 | + € 936,88 |
| Inge | € 93,80 | € 6,00 | - € 87,80 |
| Jurgen & Nathalie | € 155,85 | € 119,00 | - € 36,85 |
| Filip & Nathalie | € 148,96 | € 59,00 | - € 89,96 |
| Maaike & Jelke | € 96,51 | € 0,00 | - € 96,51 |
| Wim & Annelies | € 171,73 | € 25,23 | - € 146,50 |
| Jong geweld | € 544,60 | € 0,00 | - € 544,60 |

De som van de saldi is nul op basis van de ongeronde Excel-bedragen (minieme floating-point rest). De nieuwe app moet exact op nul uitkomen in eurocenten.

**Belangrijk voor de app:** een uitgave is niet alleen een bedrag dat verdeeld wordt; ze heeft ook een betaler/voorschieter. Dat krediet moet bij de juiste persoon of groep worden geboekt. Het totaal van alle terugbetalingen en bij te betalen bedragen moet in evenwicht zijn.

De app moet daarnaast ook inkomsten kunnen registreren. Inkomsten zijn niet hetzelfde als voorgeschoten uitgaven. Het invoerscherm moet daarom duidelijk onderscheiden tussen:
- een gedeelde opbrengst die de totale kost verlaagt;
- een bedrag dat door of voor een specifieke deelnemer/groep werd ontvangen.

De concrete boekingswijze en verdeling van inkomsten wordt als afzonderlijke businessregel vastgelegd.

## 6. Wat de oude Excel niet doet of niet goed genoeg modelleert

1. Er bestaan geen individuele persoonsfiches; alleen groepsnamen en aantallen.
2. De lijst met groepsleden is niet aanwezig. De app kan de groepslabels en totalen als startpunt gebruiken, maar mag geen individuele namen verzinnen.
3. Deelnemerscategorieën zijn samengevat op groepsniveau. De nieuwe app legt de categorie per persoon en per editie vast.
4. Verdeelregels zitten in celverwijzingen en formules. De app maakt ze configureerbaar per uitgave.
5. De bedragen bevatten meer decimalen dan eurocenten. De app moet geld in gehele centen berekenen en afrondingsresten sluitend verdelen.
6. De afrekening koppelt voorgeschoten uitgaven aan groepen. De nieuwe app moet de daadwerkelijke betaler per uitgave opslaan en daar automatisch een tegoed van maken.
7. De werkmap scheidt inkomsten niet expliciet van voorgeschoten aankopen. De app doet dat wel.

## 7. Functionele vertaling naar de nieuwe app

### Personen en groepen
- Personen toevoegen, wijzigen, archiveren en per editie activeren.
- Per persoon naam en categorie (volwassene/kind) vastleggen.
- Groepen aanmaken en personen eraan koppelen.
- Een groep kunnen hernoemen, splitsen, samenvoegen of opnieuw samenstellen.
- Personen zonder groep blijven zelfstandig zichtbaar en afrekenbaar.
- Groepsleden blijven individueel zichtbaar, ook als hun bestelling en saldo op groepsniveau worden samengevat.

### Bestellingen
- Vleescatalogus per editie beheren.
- Aantallen per persoon ingeven.
- Groepstotalen automatisch berekenen.
- Bestellingen afsluiten en alleen door de organisator opnieuw openen.

### Uitgaven, inkomsten en saldo
- Uitgaven registreren met bedrag, omschrijving, datum, betaler en verdeelsleutel.
- Inkomsten apart registreren, met duidelijk onderscheid tussen algemene opbrengst en ontvangst door een specifieke persoon/groep.
- Aandelen per persoon berekenen en op de groep samenvatten.
- Voorschotten per betaler optellen.
- Eindafrekening per groep of zelfstandige deelnemer tonen.
- Alle sommen exact laten aansluiten in eurocenten.

### Edities
- Historische edities onveranderlijk bewaren.
- Een nieuwe editie kunnen starten op basis van vorige groepen, personen en catalogus.
- Leden, groepssamenstellingen en categorieën per editie kunnen aanpassen zonder oude edities te wijzigen.


## 8. Besluit onboarding voor de nieuwe app

De standaard onboarding wordt bewust vereenvoudigd tot twee keuzes:

1. **Gezin:** de inschrijver geeft een gezinsnaam op en voegt alle leden toe. Per lid wordt de categorie volwassene of kind vastgelegd.
2. **Alleen:** één persoon schrijft zichzelf in en kiest volwassene of kind.

Een inschrijving (gezin of alleenstaande) is de standaard rekeneenheid voor bestellingen en afrekening. Er is geen algemene vrije groepsbeheerlaag nodig. De individuele leden blijven wel apart opgeslagen om verdeelsleutels per volwassene/kind correct te kunnen berekenen.

## 9. Vleescatalogus per editie

De acht vleescategorieën uit de oude Excel zijn uitsluitend historische gegevens en vormen geen vast gamma voor toekomstige edities.

De organisator/beheerder moet voor elke nieuwe editie zelf het actuele vleesgamma kunnen beheren:
- vleesproduct toevoegen;
- naam en eventueel korte omschrijving aanpassen;
- product activeren of deactiveren;
- productvolgorde bepalen;
- producten met bestaande bestellingen niet hard verwijderen, maar archiveren of deactiveren.

De deelnemers zien uitsluitend de actieve producten van de huidige editie. Een nieuwe editie kan desgewenst een kopie van het vorige gamma starten, waarna de beheerder het aanbod aanpast voordat de bestellingen openen. De oude editie en haar bestellingen blijven ongewijzigd.


## 10. Kost boeken op een gezin of alleenstaande

Alle uitgaven zijn altijd gemeenschappelijke kosten voor de volledige nieuwjaarsgroep. Een uitgave wordt dus nooit uitsluitend aan één gezin of deelnemer toegewezen.

Bij iedere uitgave registreert de organisator:
- **Bedrag en omschrijving:** de gemeenschappelijke aankoop of kost.
- **Voorgeschoten door:** de inschrijving (gezin of alleenstaande) die de rekening heeft betaald.
- **Verdeelsleutel:** bepaalt hoe de volledige groep de kost draagt (iedereen, volwassenen, kinderen, vleesporties of een andere ingestelde regel).
- **Ingevoerd door:** de beheerder die de registratie heeft aangemaakt of aangepast; dit wordt automatisch als auditinformatie bewaard.

Voorbeeld: Koen doet een aankoop van €150 en boekt die als voorgeschoten door **Gezin Thomaes-Beckers**. De volledige €150 wordt over alle deelnemers verdeeld volgens de gekozen verdeelsleutel. Het gezin krijgt de €150 als voorschot in de afrekening terug, naast zijn eigen aandeel in de gemeenschappelijke kosten.

De betaler/voorschieter en de verdeling van de kost zijn dus twee aparte gegevens.

## 11. Vorig vleesgamma als standaard startpunt

Omdat het waarschijnlijk is dat het vleesaanbod grotendeels hetzelfde blijft, stelt de app bij het aanmaken van een nieuwe editie standaard het gamma van de vorige editie voor als kopie. De beheerder kan producten toevoegen, wijzigen, uitschakelen of herschikken vóór de bestellingen opengaan. De catalogus van de vorige editie blijft ongewijzigd.
