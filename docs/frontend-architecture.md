# Frontend-architectuur

## Doel

De frontend blijft onderhoudbaar door verantwoordelijkheden duidelijk te scheiden. De huidige refactor behoudt het bestaande prototypegedrag; ze introduceert nog geen echte inschrijving, authenticatie of database.

## Verantwoordelijkheden

- `index.html`: semantische HTML-shell en Vite-entrypoint.
- `main.js`: laadt globale CSS en start de applicatie.
- `app.js`: centrale schermrendering en eventafhandeling.
- `components/`: herbruikbare UI-bouwstenen.
- `pages/`: inhoud van afzonderlijke portalen en schermen.
- `data/`: tijdelijke demo-data; geen productiedata.
- `styles/`: alle vormgeving, opgesplitst in basis, componenten en responsive/print.
- `utils/`: kleine, zuivere hulpfuncties.
- `services/`: wordt toegevoegd voor API-communicatie zodra de backend wordt aangesloten.

## Codeafspraken

1. Geen inline CSS of JavaScript in HTML.
2. Geen stylinglogica of grote HTML-fragmenten in eventhandlers.
3. UI-componenten renderen markup; services verzorgen communicatie met de backend.
4. Financiële berekeningen worden later in gedeelde, testbare domeinfuncties geplaatst en niet in schermcomponenten.
5. Autorisatie wordt altijd door de Worker/API afgedwongen; verbergen van navigatie is geen beveiliging.
6. Productie gebruikt aparte deelnemer- en beheerentrees. De consolewisselaar in het huidige prototype is alleen voor ontwikkeling.

## Volgende stap

De eerstvolgende functionele stap is de onboarding: keuze Gezin/Alleen, leden toevoegen en per persoon de categorie volwassene/kind instellen. De registratie is in de frontend inmiddels de gedeelde bron voor het deelnemersportaal en beheer. Daarna volgen persistente opslag en server-side toegangscontrole.
