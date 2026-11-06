# Nieuwjaarsbeheer

Webapp voor de jaarlijkse nieuwjaarsbijeenkomst: inschrijvingen, individuele vleesbestellingen, gemeenschappelijke kosten, inkomsten, betalingen en een sluitende eindafrekening.

## Projectstatus

De eerste frontend-basis staat in de repository:
- Deelnemersportaal met gezinsoverzicht, vleesbestelling, gezinstotalen per vleessoort en afrekening.
- Admin Console met globaal dashboard, BBQ-overzicht, betalingslijst en eerste registratie van ontvangen bedragen.
- Responsive layout voor desktop, tablet en smartphone.
- Cloudflare Worker-entrypoint en Vite-buildconfiguratie.

De huidige schermen gebruiken **demodata**. Er is nog geen databasekoppeling, echte authenticatie of persistente opslag. Betalingsregistratie in deze prototypeversie wijzigt alleen de lokale schermstatus.

## Frontend-structuur

De frontend is opgesplitst in kleine, doelgerichte modules. De HTML-shell blijft in `index.html`; schermopbouw gebeurt in JavaScript-componenten en alle styling staat in afzonderlijke CSS-bestanden.

```text
src/
├── main.js                 # Applicatie-entrypoint
├── app.js                  # Renderen en centrale events
├── components/
│   ├── header.js           # Bovenbalk
│   └── navigation.js       # Navigatie en portaalwisselaar (prototype)
├── data/
│   └── demo-data.js        # Tijdelijke voorbeeldgegevens
├── pages/
│   ├── user.js             # Deelnemersschermen
│   └── admin.js            # Beheerschermen
├── styles/
│   ├── index.css           # CSS-entrypoint
│   ├── base.css            # Fonts, tokens en basisregels
│   ├── components.css      # Component- en layoutstijlen
│   └── responsive.css      # Tablet, smartphone en print
└── utils/
    └── format.js           # Geld- en totalenformattering
```

Afspraken:
- `index.html` bevat alleen de documentstructuur en de module-entrypoint.
- Geen inline CSS of inline JavaScript.
- JavaScript maakt schermen en gedrag; CSS bepaalt de vormgeving.
- Voorbeeldgegevens staan apart en worden later vervangen door API-data.
- API- en databasecommunicatie komt in `services/`; herbruikbare invoervalidatie komt in `utils/`.
- De portaalwisselaar is uitsluitend een prototypehulpmiddel. Productietoegang wordt server-side gescheiden en beveiligd.

## Technologie en architectuur

- Frontend: Vite en vanilla JavaScript/CSS.
- Backend: Cloudflare Worker.
- Database: Cloudflare D1 (volgende bouwfase).
- Optioneel: Cloudflare R2 voor productfoto’s en bonnetjes.
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

## Visuele vleescatalogus

De vleescatalogus toont per product een foto naast de productnaam. Deelnemers kunnen daardoor ook op smartphone eenvoudig het juiste vleesproduct herkennen. De eerste frontend-prototypeversie bevat een catalogusweergave voor deelnemers en productbeheer voor de admin. De admin kan producten toevoegen, activeren/deactiveren en foto's toevoegen, vervangen of wissen. Uploads zijn voorlopig alleen lokaal in het browsergeheugen beschikbaar en verdwijnen bij herladen; dit is nog geen gedeelde of permanente opslag.

- Elk vleesproduct kan een eigen afbeelding hebben.
- De beheerder kan een afbeelding toevoegen, vervangen of verwijderen.
- De beheerder kan producten toevoegen, hernoemen, deactiveren en herschikken; nieuwe producten kunnen dus ook een foto krijgen.
- Producten zonder afbeelding krijgen een neutrale standaardafbeelding.
- Deelnemers zien alleen de actieve producten van de lopende editie.
- Historische bestellingen blijven gekoppeld aan het oorspronkelijke product; een foto- of cataloguswijziging overschrijft geen oude bestellingen.
- Afbeeldingen worden centraal opgeslagen (bij voorkeur Cloudflare R2) en via de backend aan de juiste editie/productcatalogus gekoppeld.

Technische aandachtspunten: toegestane afbeeldingsformaten en bestandsgrootte valideren, afbeeldingen optimaliseren voor mobiel en thumbnails gebruiken in de bestellijst. De beheerder krijgt een eenvoudige upload-/vervangactie in het productbeheer. De prototype-upload accepteert JPG, PNG en WebP tot 5 MB. Definitieve validatie, optimalisatie en opslag in R2 worden server-side gebouwd.

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
- De admin registreert uitsluitend betalingen via cash of overschrijving. Online betalingen maken geen deel uit van de applicatie.
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

## Beveiligde toegang en WhatsApp-uitnodigingen

De toegangsstructuur is bewust gescheiden:
- De organisator gebruikt een afzonderlijk adminwachtwoord.
- Gezinnen krijgen later een persoonlijke, willekeurige uitnodigingslink die via WhatsApp wordt doorgestuurd.
- Gezinslinks geven nooit toegang tot de adminomgeving.
- Adminsessies worden server-side bijgehouden en verlopen na 12 uur.
- Alleen hashes van sessietokens en uitnodigingstokens worden in D1 bewaard.

### Eenmalige Cloudflare-voorbereiding

1. Maak de D1-database aan:
   ```bash
   npx wrangler d1 create nieuwjaar-db
   ```
2. Kopieer de geretourneerde database-ID naar `database_id` in `wrangler.jsonc`.
3. Voer de migratie uit:
   ```bash
   npx wrangler d1 migrations apply nieuwjaar-db --local
   npx wrangler d1 migrations apply nieuwjaar-db --remote
   ```
4. Maak lokaal een PBKDF2-hash voor het adminwachtwoord:
   ```bash
   node scripts/create-admin-password-hash.mjs
   ```
   Gebruik een wachtwoord van minstens 14 tekens. Bewaar het hashresultaat als Cloudflare Worker secret:
   ```bash
   npx wrangler secret put ADMIN_PASSWORD_HASH
   ```

Het adminwachtwoord zelf wordt niet in Git, de frontend of D1 opgeslagen. Het script draait lokaal en toont alleen de hash die als secret moet worden ingesteld.

### API-basis

- `GET /api/admin/session`: controleert of de adminsessie geldig is.
- `POST /api/admin/login`: controleert het wachtwoord en maakt een server-side sessiecookie aan.
- `POST /api/admin/logout`: trekt de sessie in.
- Mislukte aanmeldingen worden gelogd en na 10 pogingen binnen 15 minuten tijdelijk geweigerd.

De frontend-login en de uitnodigingsbeheerknoppen worden in de volgende integratiestap op deze API aangesloten. Tot die integratie en de Cloudflare-configuratie afgerond zijn, is de bestaande frontendconsole nog een prototype en mag die niet als productiebeveiliging worden beschouwd.
