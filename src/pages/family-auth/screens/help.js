// "Hulp": the manual for families, inside the portal. One tap per topic, so it stays short on a phone.
import { html, joinHtml } from "../../../utils/html.js";

const TOPICS = [
  {
    title: "Bestelling",
    body: html`<p>Je kiest het vlees per persoon, en alles wordt meteen bewaard.</p>
      <ol>
        <li>Tik op de naam van een persoon.</li>
        <li>Kies met <strong>−</strong> en <strong>+</strong> hoeveel porties die persoon wil. Wat besteld is, kleurt
          groen.</li>
        <li>Doe hetzelfde voor de volgende persoon. Wie nog niets besteld heeft, staat in het rood.</li>
      </ol>
      <p>Bovenaan zie je tot wanneer je kan bestellen. Daarna kan je zelf niets meer wijzigen: vraag het dan aan de
        organisatie.</p>`
  },
  {
    title: "Gezin",
    body: html`<p>Controleer hier wie er komt. Per persoon zie je ook wat die kost, zodra er kosten zijn ingevoerd.</p>
      <ul>
        <li><strong>Persoon toevoegen:</strong> vul onderaan de naam in, kies de categorie en tik op
          <em>Toevoegen</em>.</li>
        <li><strong>Wijzigen:</strong> tik op <em>Wijzigen</em> om de naam of categorie aan te passen, en om allergieën
          of een opmerking door te geven.</li>
        <li><strong>Avondgast:</strong> kies dit voor wie pas na het eten komt. Die bestelt geen vlees, deelt niet in de
          gezamenlijke kosten en betaalt alleen de eigen barrekening.</li>
        <li><strong>Verwijderen:</strong> dat kan niet voor iemand met een barrekening. Vraag het dan aan de
          organisatie.</li>
      </ul>`
  },
  {
    title: "Kosten en betalen",
    body: html`<p>Op <em>Overzicht</em> zie je meteen wat jullie nog moeten betalen of terugkrijgen. Zolang niet alle
        kosten binnen zijn, is dat bedrag voorlopig. Op <em>Kosten</em> zie je per soort kost het totaal, jullie deel en
        hoe dat berekend is.</p>
      <p><strong>Zelf iets voorgeschoten?</strong> Voeg de kost toe op <em>Kosten</em> met omschrijving, bedrag, datum en
        soort kost. Een foto van het kasticket is verplicht. De kost wordt daarna automatisch verdeeld. Je kan alleen
        kosten wijzigen of verwijderen die je zelf hebt ingevoerd.</p>`
  },
  {
    title: "Wie komt er nog?",
    body: html`<p>Op <em>Overzicht</em> beslis je zelf of de andere gezinnen mogen zien dat jullie komen. Zij zien dan
        alleen jullie gezinsnaam en het aantal personen. Je kan dat altijd weer wijzigen.</p>`
  },
  {
    title: "Komen jullie toch niet?",
    body: html`<p>Tik onderaan op <em>Gezin</em> op <em>Wij komen niet</em>. Is de bestelling al doorgegeven, of zijn er
        kosten, betalingen of een barrekening? Dan gaat je vraag naar de organisatie, en die beslist.</p>`
  },
  {
    title: "Mijn account en aanmelden",
    body: html`<p>Via <em>Mijn account</em> kan je:</p>
      <ul>
        <li>je wachtwoord wijzigen;</li>
        <li>je e-mailadres wijzigen (je bevestigt het via een mail naar het nieuwe adres);</li>
        <li>zien wie toegang heeft tot jullie gezin;</li>
        <li>iemand uitnodigen, bijvoorbeeld je partner (alleen de beheerder van het gezin);</li>
        <li>afmelden.</li>
      </ul>
      <p><strong>Wachtwoord vergeten?</strong> Klik op <em>Wachtwoord vergeten?</em> op de aanmeldpagina. Je krijgt een
        mail met een link die 30 minuten geldig is.</p>`
  }
];

export function renderHelp(contactLine) {
  return html`<div class="fa-help">
      <button type="button" class="fa-btn fa-btn-quiet" data-action="close-help">‹ Terug</button>
      <section class="fa-settings-card">
        <h3>Hulp</h3>
        <p class="fa-muted">Hier geef je door wie er komt en wat jullie bestellen, en zie je wat jullie moeten betalen.
          Tik op een onderwerp.</p>${joinHtml(
            TOPICS.map(
              topic => html`<details class="fa-help-topic">
                  <summary>${topic.title}</summary>
                  <div>${topic.body}</div>
                </details>`
            ),
            ""
          )}<p class="fa-help-contact">${contactLine}</p>
      </section>
    </div>`;
}
