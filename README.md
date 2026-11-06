# Nieuwjaarsbeheer

Webapp voor de jaarlijkse nieuwjaarsbijeenkomst: inschrijvingen, individuele vleesbestellingen, gemeenschappelijke kosten, inkomsten, betalingen en een sluitende eindafrekening.

## Projectstatus

De eerste frontend-basis staat in de repository:
- Deelnemersportaal met gezinsoverzicht, vleesbestelling, gezinstotalen per vleessoort en afrekening.
- Admin Console met globaal dashboard, BBQ-overzicht, betalingslijst en eerste registratie van ontvangen bedragen.
- Responsive layout voor desktop, tablet en smartphone.
- Cloudflare Worker-entrypoint en Vite-buildconfiguratie.

De huidige schermen gebruiken **demodata**. Er is nog geen databasekoppeling, echte authenticatie of persistente opslag. Betalingsregistratie in deze prototypeversie wijzigt alleen de lokale schermstatus.

## Technologie en architectuur

- Frontend: Vite en vanilla JavaScript/CSS.
- Backend: Cloudflare Worker.
- Database: Cloudflare D1 (volgende bouwfase).
- Optioneel: Cloudflare R2 voor bonnetjes en facturen.
- GitHub is de centrale broncode; lokaal ontwikkelen gebeurt vanuit Visual Studio Code.
- Beoogd adres: `nieuwjaar.datuur.be`.
- Project blijft volledig gescheiden van andere applicaties.

## Lokaal starten

```bash
npm install
npm run dev
```

Productiebuild:

```bash
npm run build
```

Deployment naar Cloudflare gebeurt na het configureren van de Worker en D1-binding:

```bash
npm run deploy
```

## Deelnemers: eenvoudige onboarding

Bij de inschrijving kiest men één van twee opties: **Gezin** of **Alleen**.

### Gezin
- De inschrijver geeft de gezinsnaam op.
- De inschrijver voegt de gezinsleden toe.
- Per lid wordt aangeduid of die een volwassene of kind is.
- De gezinsfiche toont alle leden, categorieën, individuele bestellingen, gezinstotalen en het gezamenlijke saldo.

### Alleen
- De deelnemer vult de eigen naam in.
- De deelnemer kiest volwassene of kind.
- De individuele fiche is meteen ook de eigen bestel- en afrekeneenheid.

Elke inschrijving is één rekeneenheid: een gezin of één individuele deelnemer. Personen blijven individueel geregistreerd voor correcte kostenverdeling en vleesbestellingen. Een gezin beheert alle leden via één gezinslink; een alleenstaande gebruikt de eigen link.

## Vleesgamma en bestellingen

- Het vleesgamma is instelbaar per editie; de oude Excel-categorieën zijn geen verplichte standaard.
- Een nieuwe editie kan starten met een kopie van het vorige gamma.
- De beheerder kan producten toevoegen, hernoemen, activeren/deactiveren en herschikken.
- Bestellingen worden per persoon en per vleessoort ingevoerd.
- De deelnemers zien hun individuele bestellingen én de opgetelde aantallen per vleessoort voor hun gezin.
- De admin ziet de globale totalen per vleessoort als BBQ-lijst, geschikt om op de avond zelf te raadplegen of af te drukken.
- Producten met historische bestellingen worden niet hard verwijderd.

## Kosten en verdeelsleutels

**Alle uitgaven zijn altijd gemeenschappelijke kosten voor de volledige groep.** De admin kiest bij iedere uitgave één van drie vaste verdeelsleutels:

1. **Algemene kost:** gelijk verdeeld over alle deelnemers, volwassenen én kinderen.
2. **18+ kost:** gelijk verdeeld over alle volwassenen. Kinderen dragen hier niet aan bij.
3. **Vleesjeskost:** verdeeld volgens het aantal vleesporties dat iedere persoon individueel bestelt.

De betaler/voorschieter staat los van de verdeelsleutel. Bij iedere uitgave wordt vastgelegd welke gezin- of individuele inschrijving de volledige rekening heeft voorgeschoten. Die inschrijving krijgt het volledige voorschot als krediet, maar draagt ook haar eigen aandeel in de gemeenschappelijke kost.

Alle bedragen worden intern in eurocenten berekend. Afrondingsresten worden deterministisch verdeeld zodat de som van de toegewezen aandelen exact overeenkomt met de uitgave.

## Inkomsten en betalingen

Inkomsten worden afzonderlijk geregistreerd en mogen niet verward worden met voorschotten of betalingen van deelnemers. De precieze boekingsregel voor inkomsten moet nog finaal worden vastgelegd voordat de financiële backend wordt gebouwd.

Ontvangen betalingen zijn **vereffeningen van een bestaand saldo**, geen nieuwe inkomsten of kosten:
- De admin kan cash, overschrijving of een andere betaalwijze registreren.
- Gedeeltelijke betalingen zijn toegestaan.
- Het ontvangen bedrag wordt opgeteld bij de betrokken inschrijving.
- Het openstaande bedrag wordt onmiddellijk herberekend.
- Deelnemers zien in hun eigen app hun actuele afrekening en het door de admin meegedeelde bedrag dat ze moeten meebrengen.

De admin kan vooraf de mee te brengen bedragen bekendmaken. Die meegedeelde bedragen worden als momentopname bewaard, zodat latere wijzigingen niet ongemerkt een eerder gecommuniceerd bedrag veranderen.

## Afrekening

De afrekening wordt per gezin of individuele deelnemer getoond:
- aandeel in de gemeenschappelijke kosten;
- voorgeschoten bedragen;
- eventuele inkomsten/credits volgens de nog vast te leggen inkomstenregel;
- vooraf meegedeeld bedrag;
- effectief ontvangen betalingen;
- resterend openstaand bedrag of terug te betalen saldo.

De **som van alle deelnemerssaldi moet exact € 0,00 zijn**. Betalingen verschuiven alleen het openstaande bedrag; ze veranderen de totale kostenverdeling niet. De admin krijgt een controle die bevestigt dat de groepsafrekening sluit.

## Editie- en toegangsmodel

- Meerdere edities kunnen naast elkaar bestaan.
- Een nieuwe editie kan personen, gezinsindelingen en vleescatalogus van de vorige editie overnemen.
- Deelnemers krijgen een lange, willekeurige toegangscode via hun persoonlijke of gezinslink.
- De database bewaart alleen een hash van de toegangscode.
- Een deelnemer ziet uitsluitend de eigen fiche of het eigen gezin.
- De organisator beheert alle deelnemers, bestellingen, uitgaven, inkomsten, betalingen en afrekening via een afzonderlijk beveiligd beheergedeelte.
- Links kunnen door de organisator worden ingetrokken of opnieuw gegenereerd.
- Historische edities blijven bewaard en worden niet stilzwijgend aangepast.

## Eerste functionele schermen

### Deelnemersportaal
- Overzicht met deelnemers, vleesporties en mee te brengen bedrag.
- Gezin beheren.
- Bestelling per persoon aanpassen.
- Vleessoorten en aantallen voor het volledige gezin terugvinden.
- Eigen actuele afrekening en betalingsstatus bekijken.

### Admin Console
- Dashboard met deelnemers, vleesporties, ontvangen bedragen en openstaande bedragen.
- Globaal BBQ-overzicht per vleessoort en printweergave.
- Personen en gezinnen beheren.
- Vleesgamma en bestellingen beheren.
- Kosten registreren met één van de drie vaste verdeelsleutels en een voorschieter.
- Inkomsten registreren.
- Ontvangen betalingen registreren, inclusief gedeeltelijke betalingen.
- Bedragen mee te brengen bekendmaken en vastzetten.
- Eindafrekening controleren op exact € 0,00.

## Rekenregels en technische uitgangspunten

- Geld wordt intern in gehele eurocenten opgeslagen.
- De som van alle kostenverdelingen is exact gelijk aan de ingevoerde kosten.
- Beenhouwerkosten worden verdeeld op basis van de individuele vleesporties; het gezinsaandeel is de som van de ledenaandelen.
- Volwassene/kind wordt expliciet per editie vastgelegd; de app leidt dit niet stilzwijgend af uit een geboortedatum.
- Betalingen zijn geen inkomsten en geen uitgaven.
- De som van alle definitieve deelnemerssaldi is exact nul.
- Wijzigingen aan afgesloten edities worden beperkt en gelogd.

## Nog te beslissen vóór de financiële backend

De concrete verwerking van algemene inkomsten (bijvoorbeeld opbrengsten voor de hele groep) moet nog finaal worden bevestigd: verminderen ze eerst de gezamenlijke kostenpot, of worden ze aan een specifieke inschrijving gecrediteerd? De rest van de drie verdeelsleutels, voorschotten, betalingen en nulafrekening is vastgelegd.
