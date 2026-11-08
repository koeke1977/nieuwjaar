// Tab Gezin: personen, categorie, allergieën en opmerkingen, kost per persoon.
import { html, joinHtml, euro, plural } from "../../../utils/html.js";
import { COST_SHORT } from "../../../utils/finance.js";
import { DIET_OPTIONS, NOTE_MAX } from "../../../utils/diet.js";
import { typeLabel, typeOptions, EVENING } from "../../../utils/member-types.js";
import { portionsOf, UNITS, dietChips } from "./shared.js";

// Per-person cost from the server breakdown; null while a new person is not yet saved.
function memberCost(item, personId) {
  const finance = item.finance;
  if (!finance?.expenses?.length) return null;
  return finance.members.find(member => member.id === personId) || null;
}

function memberCostDetail(item, person) {
  const cost = memberCost(item, person.id);
  if (!cost) return "";
  const parts = joinHtml(
    item.finance.categories
      .map(category => {
        if (category.method === "adults" && person.type !== "Volwassene") return "";
        if (person.type === EVENING && category.method !== "bar") return "";
        return html`<span>${COST_SHORT[category.method]} <b>${euro(cost.byMethod[category.method])}</b>
        </span>`;
      })
      .filter(Boolean),
    ""
  );
  return parts ? html`<div class="fa-cost-parts">${parts}</div>` : "";
}

export function memberCostTotal(item, person) {
  const cost = memberCost(item, person.id);
  if (!item.finance?.expenses?.length) return "";
  return html`<strong class="fa-member-total">${cost ? euro(cost.totalCents) : "…"}</strong>`;
}

// "Wij komen niet": at once, or as a request when the organisation has to decide (see cancel-route.js).
function cancelBlock(item) {
  return item.cancelRequestedAt
    ? html`<p class="fa-cancel fa-cancel-asked">📨 Jullie vraag om af te melden is doorgegeven aan de organisatie.</p>`
    : html`<div class="fa-cancel">
        <span>Komen jullie toch niet?</span>
        <button type="button" class="fa-btn fa-btn-small fa-btn-quiet" data-action="cancel-registration">Wij komen
          niet</button>
      </div>`;
}

export function renderFamily(item, view) {
  const members = item.registration.members || [];
  const readOnly = item.accessRole === "viewer";
  const hasCosts = Boolean(item.finance?.expenses?.length);
  const rows = joinHtml(
    members.map((person, index) => {
      if (!readOnly && view.editingMemberId === person.id) {
        return html`<form class="fa-member fa-member-edit" data-edit-member="${person.id}">
              <input name="memberName" aria-label="Naam" value="${person.name}" maxlength="80" required>
              <select name="memberType" aria-label="Categorie">${typeOptions(person.type)}</select>
              <fieldset class="fa-diet-edit">
                <legend>Allergieën en voorkeuren</legend>${joinHtml(
                  DIET_OPTIONS.map(
                    option =>
                      html`<label>
                  <input type="checkbox" name="diet"
                      value="${option}"${(person.diet || []).includes(option) ? " checked" : ""}> ${option}</label>`
                  ),
                  ""
                )}</fieldset>
              <input name="notes" aria-label="Opmerking" maxlength="${NOTE_MAX}" value="${person.notes || ""}"
                  placeholder="Opmerking, bv. geen pikant, notenallergie (ernstig)">
              <div class="fa-row-actions">
                <button type="submit" class="fa-btn fa-btn-primary">Bewaren</button>
                <button type="button" class="fa-btn" data-action="cancel-edit-member">Annuleren</button>
              </div>
            </form>`;
      }
      return html`<div class="fa-member">
            <span class="fa-avatar">${(person.name || "?").charAt(0).toUpperCase()}</span>
            <div class="fa-member-name">
              <strong>${person.name}</strong>
              <small>${typeLabel(person.type)} · ${plural(portionsOf(person), UNITS.meat)}</small>${dietChips(person)}${memberCostDetail(item, person)}</div>${memberCostTotal(item, person)}${
                readOnly
                  ? ""
                  : html`<div class="fa-row-actions">
              <button type="button" class="fa-btn fa-btn-small" data-action="edit-member"
                  data-person="${person.id}">Wijzigen</button>${
                    Number(person.barCents) > 0
                      ? html`<small class="fa-muted">Heeft een barrekening: verwijderen kan alleen via de
                          organisatie.</small>`
                      : members.length > 1
                        ? html`<button type="button" class="fa-btn fa-btn-small fa-btn-quiet" data-action="remove-member"
                        data-index="${index}" aria-label="${person.name} verwijderen">Verwijderen</button>`
                        : ""
                  }</div>`
              }</div>`;
    }),
    ""
  );
  const familyTotal = hasCosts
    ? html`<div class="fa-family-total">
        <span>Totaal voor het gezin${item.finance.finalized ? "" : html` <small>(voorlopig)</small>`}</span>
        <strong>${euro(item.finance.totals.shareCents)}</strong>
      </div>`
    : "";
  return html`<div class="fa-section-head">
        <h3>Wie komt er?</h3>
        <p>Per persoon zie je wat die kost: vlees volgens de eigen bestelling, algemene kosten voor iedereen en
            18+-kosten alleen voor volwassenen. Komt iemand pas na het eten? Kies dan <strong>Avondgast</strong>: die
            betaalt alleen zijn eigen barrekening.</p>
      </div>
      <div class="fa-list">${
        rows ||
        html`<p class="fa-empty">Nog geen gezinsleden
          toegevoegd.</p>`
      }</div>${familyTotal}${
        readOnly
          ? html`<p class="fa-muted">Je hebt leesrechten voor deze inschrijving.</p>`
          : html`<form class="fa-add" data-add-member>
          <label class="fa-label" for="fa-new-name">Persoon toevoegen</label>
          <div class="fa-add-grid">
            <input id="fa-new-name" name="memberName" placeholder="Voornaam en naam" maxlength="80" required>
            <select name="memberType" aria-label="Categorie">${typeOptions("Volwassene")}</select>
            <button type="submit" class="fa-btn fa-btn-primary">+ Toevoegen</button>
          </div>
        </form>${cancelBlock(item)}`
      }`;
}
