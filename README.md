# Nieuwjaarsbeheer

Een webapp om de jaarlijkse nieuwjaarsbijeenkomst te beheren: personen, gezinnen en groepen, vleesbestellingen, kosten, inkomsten en de eindafrekening.

## Architectuurkeuzes

- Frontend en API in één Cloudflare Worker.
- Cloudflare D1 voor relationele gegevens.
- Cloudflare R2 optioneel voor bonnetjes en facturen; kan later toegevoegd worden.
- GitHub is de centrale broncode; lokaal ontwikkelen gebeurt vanuit Visual Studio Code.
- Eigen deployment en configuratie, los van andere projecten.
- Beoogd adres: `nieuwjaar.datuur.be`.

## Deelnemers: personen én groepen

Personen zijn de basis. Een persoon heeft een eigen fiche en een type dat per editie kan worden vastgelegd (volwassene of kind).

Een groep is een bundeling van personen, bijvoorbeeld:
- een gezin met twee volwassenen en twee kinderen;
- een vriendengroep;
- een tijdelijke groep zoals "Jong geweld".

Iedere persoon kan in een editie zelfstandig deelnemen of lid zijn van één groep. Een groep kan op elk moment worden samengesteld of aangepast. Personen blijven individueel zichtbaar, ook wanneer ze samen in een groep zitten.

Voor de afrekening is de groep de standaard rekeneenheid: de kosten van de leden worden op groepsniveau samengebracht. Een persoon zonder groep vormt automatisch een eigen rekeneenheid. Dit maakt het mogelijk om "Jong geweld" later op te splitsen in individuele personen, zonder de optie te verliezen om hen opnieuw samen te groeperen.

Bestellingen worden per persoon geregistreerd en op de groepsfiche samengevat. Een groepslink kan de bestellingen van de leden beheren; een individuele deelnemer zonder groep beheert de eigen bestelling.

## Kosten en inkomsten

Elke uitgave krijgt een verdeelsleutel die de organisator kiest, bijvoorbeeld:
- iedereen (volwassenen en kinderen);
- alleen volwassenen (18+ volgens de ingestelde deelnemerscategorie);
- alleen kinderen;
- per besteld vleesje;
- eventueel een aangepaste verdeelsleutel.

De verdeling gebeurt op basis van de effectieve aantallen/gewichten en wordt in eurocenten afgerond. Afrondingsverschillen worden verdeeld zodat de som van de toegewezen bedragen altijd exact gelijk is aan het ingevoerde totaal.

Inkomsten worden apart geregistreerd. Bij de afrekening wordt duidelijk vastgelegd wie het bedrag ontving of voor wie het bedoeld is, zodat inkomsten niet dubbel of verkeerd worden verrekend.

Een uitgave bevat minstens omschrijving, bedrag, betaler/aankoper, verdeelsleutel en eventueel notitie of bon. Historische uitgaven blijven gekoppeld aan de editie waarin ze zijn ingevoerd.

## Editie- en toegangsmodel

- Meerdere edities kunnen naast elkaar bestaan.
- Een nieuwe editie kan personen, groepen en vleescatalogus van de vorige editie overnemen.
- De deelnemers krijgen een lange, willekeurige toegangscode via hun persoonlijke of groepslink.
- De database bewaart alleen een hash van deze toegangscode.
- Een deelnemer ziet uitsluitend de eigen fiche of groep.
- De organisator beheert deelnemers, groepen, bestellingen, uitgaven, inkomsten en afrekening via een afzonderlijk beveiligd beheergedeelte.
- Links kunnen door de organisator worden ingetrokken of opnieuw gegenereerd.

## Functionele schermen (eerste versie)

1. **Deelnemersportaal** — eigen persoon/groep bekijken, aantallen volwassenen/kinderen controleren waar nodig, bestellingen beheren en afrekening bekijken.
2. **Organisatie-dashboard** — totalen, bestellingen, uitgaven, inkomsten en saldo's.
3. **Personen en groepen** — personen toevoegen, bewerken, archiveren en samenstellen in groepen.
4. **Vleesbestellingen** — catalogus en aantallen per persoon, met groepssamenvatting.
5. **Uitgaven en inkomsten** — bedragen invoeren, betaler/ontvanger registreren en verdeelsleutel kiezen.
6. **Afrekening** — verschuldigde bedragen en tegoeden per groep of zelfstandige deelnemer.
7. **Editiebeheer** — editie openen, afsluiten, archiveren en kopiëren.

## Uitgangspunten voor correcte berekeningen

- Alle geldbedragen worden intern in eurocenten opgeslagen.
- De som van alle kostenverdelingen moet exact overeenkomen met de kost.
- Vlees wordt verdeeld op basis van het effectieve aantal porties, niet op een afgeronde prijs per portie.
- De categorie volwassene/kind is expliciet per editie vastgelegd; de app leidt dit niet stilzwijgend af uit een geboortedatum.
- Wijzigingen aan afgesloten edities worden beperkt en gelogd.

## Nog te valideren op basis van de bestaande Excel

De bestaande werkmap `BBQOudNieuw20252026.xlsm` wordt gebruikt als functionele referentie. De huidige rekenregels en historische invoer worden eerst gevalideerd voordat ze als definitieve standaard worden overgenomen. Afwijkingen in de oude formules worden niet automatisch als gewenst gedrag beschouwd.
