# Multi-event platform — migratieplan

Status: ontwerp- en veiligheidsfase. Dit document verandert geen runtimegedrag en voert geen datamigratie uit.

## Doel

Van de huidige Nieuwjaar-app naar een live-only platform voor meerdere evenementtypes, met afzonderlijke edities, families en persoonlijke accounts. Een familie kan aan meerdere evenementen/edities deelnemen en meerdere persoonlijke accounts kunnen dezelfde familie beheren.

## Huidige toestand (geverifieerd in code)

- De functionele data staat als JSON-snapshot in `app_state`, met primaire sleutel `environment` en momenteel twee waarden: `test` en `live`.
- Registraties, deelnemers, bestellingen, catalogus, kosten, betalingen, archief en finalisatiestatus zitten samen in die snapshot.
- Accounts zijn globaal (`family_users`), maar de koppeling `family_user_registrations` bevat zowel `edition_id` als `registration_id`.
- De huidige unieke beperking `UNIQUE (edition_id, registration_id)` verhindert dat twee accounts dezelfde inschrijving delen.
- De huidige API leest en schrijft registratiegegevens rechtstreeks in de JSON-snapshot.
- De huidige financiële domeinlogica gebruikt drie verdeelsleutels: `general` (personen), `adults` (volwassenen) en `meat` (porties).
- De bestaande financiële tests zijn beperkt maar aanwezig via `node --test`.

## Doelmodel

### Event
Een soort/organisatie van evenement, bijvoorbeeld Nieuwjaar of BBQ. Bevat naam, beschrijving, standaardinstellingen en verwijzing naar een financiële strategie.

### Event edition
Een concrete uitvoering van een event, met datum/periode, status, catalogus/configuratie en inschrijvingen. Een editie is geen test/live-omgeving.

### Family
Een gezin/groep die één inschrijving beheert binnen een editie. Bevat deelnemers, bestellingen en contactgegevens. De registratie wordt niet langer eigendom van één login.

### Family user en family membership
Een persoon heeft een eigen account en login. Een membership koppelt die gebruiker aan een family met een rol (owner/editor/viewer). Meerdere users mogen dezelfde family delen. Eén user mag lid zijn van meerdere families.

### Registration
Koppelt een family aan een event edition. Financiële gegevens en deelnemers/bestellingen horen bij deze registratie of bij genormaliseerde onderliggende tabellen, afhankelijk van de migratiefase.

### Finance
Kosten, voorschotten, betalingen en afsluiting worden aan een editie gekoppeld. De berekening wordt gekozen via de event-specifieke finance strategy.

## Financiële compatibiliteit: harde acceptatiecriteria

De huidige implementatie blijft de referentie voor Nieuwjaar. Geen herwerking van de verdeelregels tijdens de platformmigratie.

- `general`: verdeling per persoon/registratie; individuele uitsplitsing gelijk per lid.
- `adults`: verdeling per volwassen deelnemer; individuele uitsplitsing uitsluitend voor `Volwassene`.
- `meat`: verdeling volgens het aantal bestelde porties; individuele uitsplitsing volgens de orders.
- Alle bedragen blijven gehele eurocenten.
- Largest-remainder afronding behoudt exact het totale bedrag en gebruikt de huidige volgorde als tie-break.
- Voorschot wordt volledig toegekend aan `advancedBy`; betalingen blijven gekoppeld aan de familie-inschrijving.
- Openstaand, betaald en te veel betaald blijven volgens de bestaande berekening bepaald.
- Finaliseren/heropenen en archivering mogen geen bedragen veranderen.
- De bestaande Nieuwjaar-implementatie wordt niet vervangen vóór alle referentietests slagen.

### Verplichte referentiescenario's

1. Algemene kosten met families van verschillende grootte.
2. 18+-kosten met gezinnen met volwassenen en kinderen, inclusief gezin zonder volwassenen.
3. Vleesjeskosten met ongelijke bestellingen en een gezin zonder porties.
4. Bedragen die niet gelijk deelbaar zijn in centen (tie-break controle).
5. Meerdere kostenmethodes gecombineerd.
6. Eén familie schiet kosten voor, andere families betalen gedeeltelijk of volledig.
7. Overbetaling en resterend saldo.
8. Familie met geaggregeerde aantallen zonder individuele leden.
9. Archiveren en opnieuw openen van een editie.
10. Definitieve Nieuwjaar-afrekening: totalen per familie én per deelnemer.

Voor elk scenario worden de huidige outputwaarden als golden fixture vastgelegd vóór migratie. De nieuwe route moet exact dezelfde cents per registratie en lid produceren.

## Voorgestelde relationele structuur

- `events(id, slug, name, description, finance_strategy, settings_json, status, created_at, updated_at)`
- `event_editions(id, event_id, label, starts_at, ends_at, status, config_json, created_at, updated_at)`
- `families(id, display_name, contact_email, created_at, updated_at)`
- `family_memberships(id, family_id, user_id, role, created_at)`, unique op `family_id,user_id`
- `registrations(id, edition_id, family_id, status, data_json, created_at, updated_at)`, unique op `edition_id,family_id`
- `expenses(id, edition_id, description, amount_cents, method, advanced_by_registration_id, occurred_at)`
- `payments(id, registration_id, amount_cents, method, paid_at, reference)`
- `edition_archives(id, edition_id, snapshot_json, archived_at)`

De eerste migratie mag bestaande gegevens nog in `data_json` bewaren. Normalisatie van deelnemers, orders en financiële lijnen gebeurt pas wanneer er een afzonderlijke migratie- en paritytest voor bestaat. Bestaande accounttabellen blijven behouden; een nieuwe membership-laag vervangt de exclusieve registratie-link.

## Reeds toegevoegd aan de branch

- `0007_multi_event_foundation.sql`: uitsluitend nieuwe event-, editie-, familie-, membership-, registratie- en financiële snapshot-tabellen. Bestaande snapshots en accountkoppelingen blijven staan.
- `0008_shared_family_registration_access.sql`: bouwt de accountkoppeltabel opnieuw op zonder de exclusieve registratiebeperking. Bestaande koppelingen worden één-op-één gekopieerd. Een gebruiker kan dezelfde registratie niet dubbel koppelen; meerdere gebruikers kunnen dat wel.
- De financiële referentietests staan in `tests/finance-baseline.test.js`. De verwachte bedragen zijn gebaseerd op de huidige `finance.js`-implementatie.

Deze migrations zijn nog niet uitgevoerd op lokaal of remote D1.

## Migratievolgorde

1. **Baseline** — alle huidige finance tests uitbreiden met de tien scenario's; output bewaren als fixtures.
2. **Schema toevoegen** — nieuwe tabellen en indexen toevoegen zonder bestaande tabellen/kolommen te verwijderen. Geen live-data wijzigen.
3. **Backfill-preview** — script dat alleen leest en een rapport maakt van voorgestelde event-, editie-, familie- en registratie-ID's. Conflicten en ontbrekende koppelingen blokkeren de migratie.
4. **Backfill uitvoeren** — expliciet, herhaalbaar en transactioneel; oude JSON-snapshots blijven onaangeroerd als rollbackbron.
5. **Dual-read/compare** — nieuwe datalaag berekent en leest naast de oude laag; verschillen worden gelogd, oude laag blijft leidend.
6. **Omschakelen** — pas na volledige financiële parity en functionele acceptatietests. Back-up en rollbackprocedure verplicht.
7. **Live-only vereenvoudigen** — environment-parameter uit de applicatiedomeinlaag halen; event edition blijft de functionele context.
8. **Testopruiming (laatste stap)** — pas na expliciete controle en back-up: test-snapshot, testlinks, test-invites/sessies en uitsluitend test-only users opruimen; R2-prefix `products/test/` verwijderen. Users met live membership blijven bestaan. Daarna testlabels, testselecties en test-specifieke API-paden verwijderen.

## Risico's en blokkades

- De huidige registratiegegevens zitten in JSON; er is geen volledige relationele bron om blind te migreren.
- De huidige koppeling legt één account per registratie op. De nieuwe membership-structuur moet dit vervangen zonder accounts of wachtwoorden te verliezen.
- De huidige legacy family invite/session routes bestaan naast account-login routes. Beide moeten geïnventariseerd en gecontroleerd uitgefaseerd worden.
- Geen toegang tot productie-D1/R2 vanuit deze migratiestap. De eigenaar voert remote backup, migratie en verificatie uit.
- Er wordt geen productie- of testdata verwijderd door deze codefase.

## Definition of done

- Alle huidige Nieuwjaar-fixtures slagen exact op centniveau.
- Twee of meer accounts kunnen dezelfde familie veilig beheren.
- Eén familie kan meerdere event-edities beheren zonder registratievermenging.
- Event-specifieke finance strategies zijn geïsoleerd.
- Admin- en familieportaal zijn event-aware, niet Nieuwjaar-hardcoded.
- Backfill is herhaalbaar en heeft rapport/rollback.
- Testdata is pas verwijderd na live acceptatie en expliciete laatste cleanup.


## Voortgang na de eerste implementatiestap

- De SQLite-table-rebuild uit migratie 0008 is nagebootst met foreign keys ingeschakeld: bestaande links blijven behouden, twee verschillende accounts kunnen dezelfde registratie koppelen, een dubbele koppeling voor hetzelfde account wordt geweigerd en `PRAGMA foreign_key_check` geeft geen fouten. Dit is een lokale SQLite-simulatie, geen uitvoering op Cloudflare D1.
- Het familieportaal gebruikt nu een neutrale evenementfallback in plaats van standaard Nieuwjaar en de introductietekst verwijst naar evenementen in het algemeen.
- Nieuwe en opnieuw verstuurde accountuitnodigingen gebruiken de evenementnaam uit de gekoppelde editiegegevens in onderwerp en mailinhoud.
- De huidige `test/live`-labels en legacy API-koppelingen zijn bewust nog niet verwijderd. Eerst moet de nieuwe relationele familie-/editiekoppeling volledig worden gevuld en gecontroleerd; voortijdig verwijderen zou bestaande toegang kunnen breken.


## Functionele stap: evenementen- en editiebeheer

De eerste echte platformfunctie is toegevoegd, achter de bestaande adminsectie **Evenementen**:

- Lijst bestaande evenementen met hun edities.
- Nieuw evenement aanmaken met naam, beschrijving en financiële strategie.
- Per evenement een editie aanmaken met label en optionele start-/einddatum.
- API-routes zijn uitsluitend toegankelijk met een geldige admin-sessie en controleren same-origin bij schrijfacties.
- Invoer wordt gevalideerd; dubbele evenementcodes geven een duidelijke conflictmelding.
- De UI meldt expliciet wanneer de nieuwe databasetabellen nog ontbreken.

Deze functionaliteit gebruikt tabellen uit migratie 0007. Zonder die migratie kan de pagina geladen worden, maar kunnen evenementen niet worden opgehaald of aangemaakt. De bestaande Nieuwjaar-registraties worden door deze stap niet aangepast. Er is geen lokale build uitgevoerd: de uitvoeromgeving kan GitHub niet clonen door ontbrekende netwerktoegang. De code is wel nagelezen op de relevante API-/UI-koppelingen.


## Migratievoorbereiding in beheer

In het evenementenbeheer staat nu ook een **alleen-lezen migratiecontrole**. Die telt per bestaande omgeving het aantal inschrijvingen, gekoppelde familieaccounts, accountkoppelingen, inschrijvingen zonder account en verweesde koppelingen. De controle geeft geen namen of e-mailadressen terug en voert geen writes uit. Ze is bedoeld om vóór een backfill de omvang en datakwaliteit zichtbaar te maken.

De echte backfill is nog niet vrijgegeven. Eerst moeten de migraties op de juiste database staan, moet de preview gecontroleerd worden en moet een herstelbare snapshot/back-up beschikbaar zijn. De bestaande app_state blijft tijdens deze voorbereidende fase de bron van waarheid.


## Veiligheidscontrole backfill — 7 november 2026

De backfill-endpoint voert nu zelf de kritieke preflight uit; de browser-preview is geen beveiligingsgrens. De endpoint blokkeert onder meer ontbrekende tabellen, ontbrekende test/live-snapshots, onverwachte omgevingen, ongeldige JSON/structuur, dubbele of ontbrekende registratie-ID's, verweesde accountkoppelingen en bestaande doelrecords die op een eerdere/gedeeltelijke migratie kunnen wijzen. Daardoor worden doelrecords niet langer stilzwijgend overgeslagen via `INSERT OR IGNORE` bij een collision.

De preview toont dezelfde blokkades vóór de gebruiker de migratie kan starten. Eén backfill wordt begrensd op maximaal 1.000 prepared statements om binnen een beheersbare transactie te blijven. Cloudflare documenteert een limiet van 30 seconden voor de volledige D1-batch; er is geen gedocumenteerde vaste limiet op het aantal statements zelf. Boven de lokale veiligheidsgrens stopt de endpoint zonder writes. Zie de [officiële D1-limieten](https://developers.cloudflare.com/d1/platform/limits/).

**Belangrijk:** dit is codecontrole, geen uitvoering op de echte D1-database. De backfill mag pas worden uitgevoerd na remote backup en nadat de preview op de doelomgeving groen is. De oude snapshots blijven behouden.


## Familieaccount-portaal — verdere compatibiliteitsstap

- De account-sessie geeft voor reeds overgenomen inschrijvingen nu de evenementnaam, de editienaam en de membershiprol terug vanuit de relationele eventtabellen.
- Het portaal toont de echte editienaam in plaats van uitsluitend de labels TESTEDITIE/LIVE-EDITIE.
- Een membership met rol `viewer` krijgt geen bestelknoppen of formulier om deelnemers toe te voegen. De API blijft de rol onafhankelijk controleren bij iedere schrijfaanvraag.
- Aanpassingen via de account-API worden tijdens de overgang in één D1-batch naar de oude `app_state`-snapshot en de relationele `event_registrations.data_json` geschreven. De optimistic revision guard wordt op beide writes toegepast.
- Accountkoppelingen die via uitnodiging of accountbeheer worden gelegd, schrijven de legacy link en relationele membership nu atomair in één D1-batch zodra de registratie is overgenomen.

Dit blijft een overgangsroute voor bestaande test/live-registraties. Volledig nieuwe event-edities zonder legacy `app_state` zijn nog niet geschikt voor het huidige account-/bestelportaal. De bestaande legacy token-portalroutes en de event-accountportal zijn nog twee afzonderlijke flows; die mogen niet worden uitgefaseerd voordat de nieuwe route alle registratieacties en autorisatie volledig vervangt.


## Event-native familieportaal (codefase)

Het familieportaal ondersteunt naast de tijdelijke test/live-koppeling nu ook registraties die uitsluitend in het relationele model bestaan:

- De sessie haalt relationele registraties op via `family_memberships`, `event_registrations`, `event_editions` en `events`.
- Registraties met een legacy-omgeving blijven via `app_state` lopen en worden niet dubbel getoond.
- Event-native registraties tonen evenementnaam, editienaam, toegangsrol, deelnemers en catalogus.
- Bewerkingen zijn beperkt tot de gekoppelde familie en de rollen owner/editor; viewer blijft alleen-lezen.
- De update gebruikt `event_registrations.updated_at` als afzonderlijke optimistische revisie. Revisies van andere registraties binnen dezelfde editie worden dus niet onterecht aangepast.
- De catalogus wordt gelezen uit `event_editions.config_json.catalog`, met een compatibele fallback naar `data_json.catalog`.

**Nog open vóór productie:** het aanmaken en beheren van nieuwe event-native families, registraties en uitnodigingen vanuit het beheerpaneel; de volledige financiële UI/strategie per editie; integratietests op een geïsoleerde D1-kopie; migratievolgorde en rollback-oefening. Deze codewijzigingen voeren geen migraties uit en wijzigen geen bestaande productiegegevens.


## Relationeel familiebeheer (admin-overzicht)

Het bestaande accountbeheer toont nu aanvullend een read-only overzicht uit het nieuwe model:

- Families worden als zelfstandige entiteit getoond, los van een test/live-omgeving.
- Per familie worden alle gekoppelde accounts met hun status en rol gegroepeerd.
- Alle gekoppelde evenementinschrijvingen tonen evenement, editie, status en financiële strategie.
- De oude test/live accountacties blijven voorlopig bestaan als overgangsbeheer.
- De nieuwe lijst is bewust read-only: families, memberships of inschrijvingen worden niet aangemaakt, verwijderd of gewijzigd vanuit dit overzicht.

Volgende stap is de volledige beheerworkflow: familie aanmaken, bestaande account uitnodigen of koppelen, event-native inschrijving aanmaken, en membership beheren. Daarbij moeten owner/editor/viewer-rechten en accountuitnodigingen transactioneel worden afgehandeld. Verwijderen blijft buiten scope tot de datamigratie en rollback volledig zijn gevalideerd.


## Relationeel familiebeheer — acties en toegangsrollen

Het familiebeheer bevat nu ook schrijfacties voor het nieuwe model:

- Een beheerder kan een familie met een nieuwe event-native inschrijving aanmaken binnen een bestaande, niet-gearchiveerde editie.
- Een bestaand actief account kan aan een extra familie worden gekoppeld; een nieuw of nog uitgenodigd account krijgt een activatielink.
- De genormaliseerde accountuitnodiging gebruikt `/familie/activeren/<token>` en de activatiepagina roept `/api/family-account/activate` aan. De oudere eenmalige legacy-uitnodiging via `/familie/<token>` blijft een afzonderlijke compatibiliteitsflow. Bij een nieuwe of opnieuw verstuurde genormaliseerde uitnodiging worden eerdere ongebruikte tokens atomair ingetrokken en vervangen.
- Rollen owner/editor/viewer kunnen per familie worden aangepast. Een account kan dus in verschillende families een andere rol hebben.
- Een membership kan worden losgekoppeld zonder het account, de familie of de evenementinschrijving te verwijderen.
- De laatste owner kan niet worden gedegradeerd of losgekoppeld; eerst moet een tweede owner worden toegevoegd.

De nieuwe beheeracties zijn alleen beschikbaar via een geldige admin-sessie en same-origin schrijfacties. Dit is nog geen volledige beheer- of financiële afwerking: eventcatalogus/configuratie, registratiebeheer na aanmaak en financiële instellingen per editie moeten nog worden uitgewerkt en getest. De code is niet op de echte D1-database uitgevoerd en er zijn geen migraties gestart.


## Laatste preview- en herstelvoorbereiding — 7 november 2026

- De alleen-lezen preview controleert nu dezelfde basisstructuur voor registraties, kosten en betalingen als de uitvoerende backfill. Een preview mag dus geen groen resultaat geven op een snapshot die de backfill vervolgens op die structuur afkeurt.
- De preview is geen back-up en bewijst niet dat een remote migratie uitvoerbaar is. De productie-D1 blijft onaangeroerd totdat de eigenaar vóór de migratie een remote export heeft opgeslagen buiten de projectomgeving.
- Voor de migratiedag zijn minimaal nodig: een D1-export van vóór de eerste migratie, bevestiging dat het exportbestand leesbaar is, een vastgelegde branch/commit-SHA, de uitkomst van de preview, en een herstelbeslissing waarbij de oude `app_state` en accountkoppelingen intact blijven.
- Na schema-installatie wordt de preview opnieuw uitgevoerd op remote D1. Alleen een foutloze preview, een bewaarde back-up en een expliciet akkoord mogen voorafgaan aan de backfill.
- Herstel gebeurt niet door tabellen blind te droppen. Bij afwijkingen wordt de backfill gestopt; de oude `app_state` blijft de bron van waarheid en herstel gebeurt vanuit de bewaarde D1-export volgens een afzonderlijk gecontroleerd herstelplan.
- De preview en backfill zijn codegewijs voorbereid, maar de echte remote preview, export, migratie en hersteltest zijn nog niet uitgevoerd.
