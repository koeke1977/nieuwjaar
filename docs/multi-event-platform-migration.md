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

## Reeds toegevoegd aan de branch\n\n- `0007_multi_event_foundation.sql`: uitsluitend nieuwe event-, editie-, familie-, membership-, registratie- en financiële snapshot-tabellen. Bestaande snapshots en accountkoppelingen blijven staan.\n- `0008_shared_family_registration_access.sql`: bouwt de accountkoppeltabel opnieuw op zonder de exclusieve registratiebeperking. Bestaande koppelingen worden één-op-één gekopieerd. Een gebruiker kan dezelfde registratie niet dubbel koppelen; meerdere gebruikers kunnen dat wel.\n- De financiële referentietests staan in `tests/finance-baseline.test.js`. De verwachte bedragen zijn gebaseerd op de huidige `finance.js`-implementatie.\n\nDeze migrations zijn nog niet uitgevoerd op lokaal of remote D1.\n\n## Migratievolgorde

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
