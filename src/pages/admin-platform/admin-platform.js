import template from "./admin-platform.html?raw";
import "./admin-platform.css";

const sections = {
  users: {
    eyebrow: "PLATFORMBEHEER · IDENTITEITEN",
    title: "Gebruikers & gezinnen",
    intro: "Beheer centrale gebruikersaccounts en bepaal tot welke inschrijvingen een gezin toegang heeft.",
    cards: [
      ["♙","Gebruikersaccounts","Accounts op basis van e-mailadres. Uitnodigen, activeren, blokkeren en opnieuw uitnodigen.","Accountbeheer"],
      ["⌂","Gezinnen & inschrijvingen","Koppel een account aan één of meerdere inschrijvingen, per evenement en editie.","Koppelingen"],
      ["⚿","Rollen & sessies","Beheer toegangsrechten en trek actieve aanmeldsessies in wanneer dat nodig is.","Toegangsbeheer"],
      ["✉","Uitnodigingen","Eenmalige activatielinks en wachtwoordherstel via de Nieuwjaar-mailservice.","E-mailworkflow"]
    ],
    noteTitle: "Veilige overgang",
    note: "De bestaande persoonlijke gezinslinks blijven actief tijdens de migratie. Accounts worden pas in gebruik genomen nadat uitnodigingen, koppelingen en de nieuwe familieportal volledig getest zijn."
  },
  events: {
    eyebrow: "PLATFORMBEHEER · ORGANISATIE",
    title: "Evenementen",
    intro: "Beheer evenementen als zelfstandige onderdelen. Elk evenement kan meerdere edities en inschrijvingsperiodes bevatten.",
    cards: [
      ["▦","Evenementen","Maak evenementen aan en beheer naam, beschrijving, organisator en status.","Evenementbeheer"],
      ["◷","Edities","Elke editie heeft eigen inschrijvingen, bestellingen, kosten en betalingen.","Editiebeheer"],
      ["♧","Inschrijvingen","Koppel gezinnen en deelnemers aan de juiste editie zonder historische gegevens te vermengen.","Deelnemersbeheer"],
      ["⚙","Instellingen","Configureer inschrijvingsvensters, catalogus, communicatie en praktische afspraken per evenement.","Configuratie"]
    ],
    noteTitle: "Van editie naar evenement",
    note: "De huidige Nieuwjaar-editie blijft behouden. We brengen de bestaande editie- en archieflogica stapsgewijs onder in een centrale evenementenstructuur; er wordt niets automatisch verplaatst of verwijderd."
  }
};

export function renderAdminPlatformSection(section) {
  const config = sections[section];
  if (!config) return "";
  const wrapper = document.createElement("div");
  wrapper.innerHTML = template;
  wrapper.querySelector("[data-platform-eyebrow]").textContent = config.eyebrow;
  wrapper.querySelector("[data-platform-title]").textContent = config.title;
  wrapper.querySelector("[data-platform-intro]").textContent = config.intro;
  wrapper.querySelector("[data-platform-cards]").innerHTML = config.cards.map(([icon,title,description,status]) =>
    '<article class="admin-platform-card"><div class="admin-platform-card-icon" aria-hidden="true">'+icon+'</div><h2>'+title+'</h2><p>'+description+'</p><small>'+status+'</small></article>'
  ).join("");
  wrapper.querySelector("[data-platform-note-title]").textContent = config.noteTitle;
  wrapper.querySelector("[data-platform-note-text]").textContent = config.note;
  return wrapper.innerHTML;
}