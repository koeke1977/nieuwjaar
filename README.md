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
  app.js                    start: juiste app kiezen, klikken/formulieren doorsturen naar pages/beheer/actions
  main.js                   start de juiste app (beheer, familieportaal of startpagina)
  data/admin-store.js       toestand van het beheer (evenementen + één geladen editie)
  data/edition-payload.js   omzetting editie ⇄ op te slaan gegevens (elk veld per persoon moet hierin!)
  services/admin-state.js   laden, opslaan met automatisch samenvoegen, live verversen
  pages/beheer/
    beheer-view.js          kader en navigatie van /beheer
    screens/                één bestand per scherm (overview, families, order, bar, finance, edition,
                            events, users, settings) + shared.js met gedeelde stukjes
    admin-core.js           aanmelding, opslaan, live verversen, server-aanroepen, renderApp
    actions/                wat een klik of formulier doet, per onderdeel (navigation, registrations,
                            finance, edition, accounts): `clicks = { "data-action": … }`, `forms = { "form-id": … }`
  pages/family-auth/
    family-auth.js          start van het familieportaal: klikken/formulieren doorsturen
    family-account-view.js  kop, keuze van evenement en tabs; elke tab in screens/ (overview, family,
                            order, costs) + shared.js
    portal-core.js          gedeelde toestand, opslaan, verversen, meldingen, aftelling
    sign-in.js              aanmelden, wachtwoord vergeten, activeren, afmelden
    family-actions.js       zelf inschrijven, personen, bestelling
    cost-actions.js         eigen kosten met kasticket
  utils/                    gedeelde logica: finance, member-types, diet, time, html, state-merge
worker/
  index.js                  Cloudflare Worker: routes, admin-login, e-mail, foto's, nachtelijke taken
  modules/admin-edition-state.js   routes van één editie; het werk zit in modules/edition/ (load, clean, save, mail)
  modules/settlement-mail.js       afrekening per gezin per e-mail
  modules/admin-events.js          evenementen en edities aanmaken
  modules/admin-family-users.js    gezinnen, accounts en uitnodigingen
  modules/family-account.js        routes van het familieportaal; het werk zit in modules/family/ (session,
                                   auth-routes, portal-routes, cost-routes)
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
2. Schermen bouwen HTML met `` html`…` `` uit `src/utils/html.js`: elke `${waarde}` wordt automatisch ontsnapt,
   behalve stukken die zelf met `` html`…` `` gemaakt zijn. Lijsten: `${lijst.map(x => html`…`)}` of
   `joinHtml(lijst, scheiding)`. Een regeleinde in de sjabloontekst verdwijnt naast een tag en wordt elders één
   spatie. Plak nooit HTML met `+` aan elkaar (dan wordt die als tekst getoond).
3. Geldberekeningen staan in `src/utils/finance.js`, niet in schermen.
4. Nieuwe velden per persoon toevoegen in `edition-payload.js` (anders wist een opslag in het beheer ze) en een test
   schrijven die dat bewaakt.
