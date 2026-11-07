# Evenementen — gezinnen, bestellingen en afrekening

Webapp voor terugkerende familie-evenementen (zoals Nieuwjaar): gezinnen schrijven zich in per editie, bestellen
vlees, geven allergieën door, voeren eigen kosten in (met kasticket) en zien hun afrekening tot op de cent. De
organisatie beheert alles in `/beheer`.

- Productie: <https://nieuwjaar.datuur.be> — familieportaal op `/familie`, beheer op `/beheer`
- Eén omgeving: productie (geen aparte testomgeving)
- E-mail (uitnodigingen, wachtwoordherstel, berichten) gaat uitsluitend via `registratie@datuur.be` (Microsoft 365)

## Begrippen

| Begrip       | Betekenis                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| Evenement    | Bijvoorbeeld _Nieuwjaar_. Komt terug in edities.                                                       |
| Editie       | Bijvoorbeeld _2026–2027_: eigen producten, kosten, betalingen, einddatum bestellen en datum van feest. |
| Gezin        | Bestaat één keer, over alle evenementen heen. Heeft accounts (beheerder, bewerker of lezer).           |
| Inschrijving | Eén gezin in één editie, met de gezinsleden en hun bestellingen van dat jaar.                          |
| Categorie    | `Volwassene` (18+), `Kind`, of `Avondgast` (komt na het eten: betaalt alleen de eigen barrekening).    |

## Afrekening

Alle bedragen zijn gehele eurocenten. De verdeling gebeurt in `src/utils/finance.js` (exacte verdeling, geen
afrondingsverschillen):

- **Algemeen**: over alle personen aan tafel (volwassenen en kinderen).
- **18+**: alleen over volwassenen.
- **Vlees**: volgens het aantal bestelde porties.
- **Bar**: geen verdeling. Elke persoon heeft een eigen barrekening (`barCents`), na het feest ingevuld. Een
  _aankoop voor de bar_ wordt terugbetaald aan wie ze voorschoot; barrekeningen en aankopen moeten samen op € 0,00
  uitkomen.
- **Gemeenschappelijke kas** (`advancedBy: "kas"`): een kost die door niemand werd voorgeschoten.
- Saldo per gezin = eigen aandeel − voorgeschoten − betaald (+ terugbetalingen aan het gezin).

## Structuur

```
src/
  app.js                    beheer: laden, opslaan, klikken en formulieren
  main.js                   start de juiste app (beheer, familieportaal of startpagina)
  data/admin-store.js       toestand van het beheer (evenementen + één geladen editie)
  data/edition-payload.js   omzetting editie ⇄ op te slaan gegevens (elk veld per persoon moet hierin!)
  services/admin-state.js   laden, opslaan met automatisch samenvoegen, live verversen
  pages/beheer/             schermen van /beheer (beheer-view.js) en hun stijl
  pages/family-auth/        familieportaal: aanmelden, gezin, bestelling, kosten, aftelling
  utils/                    gedeelde logica: finance, member-types, diet, time, html, state-merge
worker/
  index.js                  Cloudflare Worker: routes, admin-login, e-mail, foto's, nachtelijke taken
  modules/admin-edition-state.js   één editie laden/opslaan, volgende editie, bericht aan gezinnen
  modules/admin-events.js          evenementen en edities aanmaken
  modules/admin-family-users.js    gezinnen, accounts en uitnodigingen
  modules/family-account.js        familieportaal (sessie, inschrijving, eigen kosten, kastickets)
  modules/receipts.js              privé-opslag van kastickets
  modules/backup.js                nachtelijke back-up naar R2
migrations/                 databaseschema (Cloudflare D1)
tests/                      automatische tests (node --test, met een echte SQLite-database)
scripts/                    hulpscripts (admin-wachtwoord, back-up terugzetten)
```

Opslag in Cloudflare D1: `events`, `event_editions` (producten en instellingen in `config_json`),
`event_registrations` (één rij per gezin per editie), `edition_finance_snapshots` (kosten en betalingen),
`families`, `family_users`, `family_memberships`. Bij het opslaan wordt elke gewijzigde rij gecontroleerd op de
versie die de gebruiker zag; bij een conflict wordt niets weggeschreven en voegt het beheer automatisch samen.

Foto's van producten, kastickets en back-ups staan in R2 (`nieuwjaar-photos`). Alleen productfoto's zijn publiek
(`/media/products/…`); kastickets en back-ups zijn enkel bereikbaar na aanmelden.

## Werken aan de app

```powershell
npm install
npm run dev            # lokaal (frontend)
npm test               # automatische tests
npm run lint           # ESLint: fouten en ongebruikte code
npm run format         # Prettier: opmaak
npm run build
npm run deploy         # build + publiceren naar Cloudflare (productie)
```

GitHub Actions controleert bij elke push: opmaak, lint, tests en build. Werk op een aparte branch, zet die na
groene controles door naar `main`, en publiceer vanaf daar.

## Back-ups

- Elke nacht (02:30 UTC) schrijft de Worker een volledige kopie van de database naar R2 (laatste 35 dagen).
- In **Beheer → Instellingen → Back-ups**: overzicht, downloaden en _Nu back-up maken_.
- Terugzetten:
  ```powershell
  node scripts/backup-to-sql.mjs nieuwjaar-d1-2026-11-08.json > restore.sql
  npx wrangler d1 execute nieuwjaar-db --remote --file=restore.sql
  ```
- Maak voor elke ingreep in de database eerst een export (`npx wrangler d1 export nieuwjaar-db --remote`) en test de
  ingreep op een lokale kopie.

## Afspraken

1. Autorisatie wordt altijd door de Worker afgedwongen; iets verbergen in het scherm is geen beveiliging.
2. Tekst in HTML wordt altijd ontsnapt via `esc()` uit `src/utils/html.js`.
3. Geldberekeningen staan in `src/utils/finance.js`, niet in schermen.
4. Nieuwe velden per persoon toevoegen in `edition-payload.js` (anders wist een opslag in het beheer ze) en een test
   schrijven die dat bewaakt.
