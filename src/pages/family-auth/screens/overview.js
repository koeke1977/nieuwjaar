// Tab Overzicht: wat staat er nog open, aftelling, kerncijfers.
import { html, joinHtml, euro, plural } from "../../../utils/html.js";
import { portionsOf, settlementHero, countdownCard } from "./shared.js";

// "Wie komt er nog?": names only with permission, see worker/modules/family/guest-list.js.
function guestListCard(item) {
  const list = item.guestList;
  if (!list) return "";
  const canAnswer = item.accessRole !== "viewer";
  const answerButton = (visible, label, primary) =>
    html`<button type="button" class="fa-btn fa-btn-small${primary ? " fa-btn-primary" : ""}" data-action="guest-list"
        data-visible="${visible}">${label}</button>`;
  const question =
    canAnswer && list.answer === null
      ? html`<div class="fa-guest-question">
          <p><strong>Mogen de andere gezinnen zien dat jullie komen?</strong> We tonen alleen jullie gezinsnaam en het
            aantal personen.</p>
          <div class="fa-row-actions">${answerButton(true, "Ja, toon ons", true)}${answerButton(false, "Liever niet")}</div>
        </div>`
      : "";
  const change =
    canAnswer && list.answer !== null
      ? html`<p class="fa-guest-choice">${
          list.answer
            ? html`Jullie staan in de lijst. ${answerButton(false, "Toch liever niet")}`
            : html`Jullie staan niet in de lijst. ${answerButton(true, "Toch tonen")}`
        }</p>`
      : "";
  const rows = joinHtml(
    list.families.map(
      family => html`<li>
          <span>${family.name}${family.own ? html` <small>(jullie)</small>` : ""}</span>${
            family.people ? html`<small>${plural(family.people, "persoon", "personen")}</small>` : ""
          }</li>`
    ),
    ""
  );
  return html`<section class="fa-guests">
      <h3>Wie komt er nog?</h3>${question}${rows ? html`<ul class="fa-guest-list">${rows}</ul>` : ""}${
        list.others
          ? html`<p class="fa-muted">${rows ? "+ " : ""}${plural(list.others, "gezin", "gezinnen")}${
              rows ? "" : " ingeschreven"
            }${rows ? " die liever niet of nog niet in de lijst staan" : ", nog niemand in de lijst"}.</p>`
          : ""
      }${change}</section>`;
}

export function renderOverview(item) {
  const members = item.registration.members || [];
  const finance = item.finance;
  const portions = members.reduce((sum, person) => sum + portionsOf(person), 0);
  return html`${settlementHero(finance)}${countdownCard(item)}<div class="fa-stats">
        <button type="button" class="fa-stat" data-tab-target="family" aria-label="Gezin bekijken">
          <span class="fa-stat-icon" aria-hidden="true">👨‍👩‍👧</span>
          <strong>${members.length}</strong>
          <small>${members.length === 1 ? "deelnemer" : "deelnemers"}</small>
          <em>Gezin <i aria-hidden="true">›</i>
          </em>
        </button>
        <button type="button" class="fa-stat" data-tab-target="order" aria-label="Bestelling aanpassen">
          <span class="fa-stat-icon" aria-hidden="true">🍖</span>
          <strong>${portions}</strong>
          <small>vleesporties</small>
          <em>Bestellen <i aria-hidden="true">›</i>
          </em>
        </button>
        <button type="button" class="fa-stat" data-tab-target="costs" aria-label="Berekening bekijken">
          <span class="fa-stat-icon" aria-hidden="true">€</span>
          <strong>${euro(finance?.totals?.shareCents || 0)}</strong>
          <small>ons aandeel</small>
          <em>Berekening <i aria-hidden="true">›</i>
          </em>
        </button>
      </div>${guestListCard(item)}${
        members.length
          ? ""
          : html`<p class="fa-empty">Voeg eerst jullie gezinsleden toe via <button type="button" class="fa-inline-link"
              data-tab-target="family">Gezin</button>.</p>`
      }`;
}
