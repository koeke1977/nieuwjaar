// Tab Kosten: afrekening, uitleg per soort kost, eigen kosten met kasticket, betalingen.
import { html, joinHtml, euro, plural, formatDate } from "../../../utils/html.js";
import { COST_SHORT, COST_ICON } from "../../../utils/finance.js";
import { todayLocal } from "../../../utils/time.js";
import { typeLabel, EVENING } from "../../../utils/member-types.js";
import { UNITS, percentFormat, METHOD_CHOICES, settlementHero } from "./shared.js";

function categoryExplanation(category) {
  const unit = UNITS[category.method] || ["deel", "delen"];
  if (category.personal)
    return (
      "Persoonlijke barrekening, na het feest berekend door de organisatie: " +
      (category.perMember || []).map(member => member.name + " " + euro(member.cents)).join(" · ") +
      "."
    );
  if (!category.totalUnits) return "Nog niemand komt in aanmerking voor deze kost.";
  const share = category.familyUnits / category.totalUnits;
  if (category.method === "meat") {
    return (
      "In totaal zijn er " +
      plural(category.totalUnits, unit) +
      " besteld. Jullie bestelden er " +
      category.familyUnits +
      ": dat is " +
      percentFormat.format(share) +
      " van de vleeskost."
    );
  }
  if (category.method === "adults") {
    return (
      "Verdeeld over " +
      plural(category.totalUnits, unit) +
      ". Jullie tellen " +
      plural(category.familyUnits, unit) +
      " (" +
      percentFormat.format(share) +
      "). Kinderen betalen hier niet mee."
    );
  }
  return (
    "Verdeeld over alle " +
    plural(category.totalUnits, unit) +
    ", ook kinderen. Jullie zijn met " +
    category.familyUnits +
    " (" +
    percentFormat.format(share) +
    ")."
  );
}

function renderOwnCosts(item, view) {
  if (item.accessRole === "viewer" || item.editionStatus === "archived") return "";
  const finance = item.finance;
  const own = (finance?.expenses || []).filter(expense => expense.advancedByUs);
  const form = (expense = null) =>
    html`<form class="fa-expense-form" data-family-expense="${expense?.id || ""}">
        <label class="fa-label">Wat betaalden jullie?<input name="description" maxlength="120"
            value="${expense?.description || ""}" placeholder="Bv. drank, decoratie, brood" required>
        </label>
        <div class="fa-add-grid">
          <label class="fa-label">Bedrag (€)<input name="amount" type="number" min="0.01" step="0.01" inputmode="decimal"
              value="${expense ? (expense.amountCents / 100).toFixed(2) : ""}" required>
          </label>
          <label class="fa-label">Datum<input name="date" type="date"
              value="${expense?.date || todayLocal()}" required>
          </label>
        </div>
        <label class="fa-label">Wie betaalt mee?<select name="method">${joinHtml(
          METHOD_CHOICES.map(
            ([value, label]) =>
              html`<option
                  value="${value}"${(expense?.method || "general") === value ? " selected" : ""}>${label}</option>`
          ),
          ""
        )}</select>
        </label>
        <label class="fa-label
            fa-receipt-field">${expense?.receipt ? "Nieuw kasticket (optioneel)" : "Foto van het kasticket (verplicht)"}<input
            name="receipt" type="file" accept="image/*,application/pdf"${expense?.receipt ? "" : " required"}>
          <small>Neem een foto of kies een PDF. Zonder kasticket kan een kost niet worden ingediend.</small>
        </label>${
          expense?.receipt
            ? html`<a class="fa-inline-link" href="${receiptUrl(expense.receipt)}" target="_blank" rel="noopener">📎
                Huidig kasticket bekijken</a>`
            : ""
        }<div class="fa-row-actions">
          <button type="submit" class="fa-btn
              fa-btn-primary">${expense ? "Bewaren" : "Kost toevoegen"}</button>${
                expense
                  ? html`<button type="button"
              class="fa-btn" data-action="cancel-edit-expense">Annuleren</button>`
                  : ""
              }</div>
      </form>`;
  const rows = joinHtml(
    own.map(expense =>
      view.editingExpenseId === expense.id
        ? html`<li>${form(expense)}</li>`
        : html`<li>
            <span>
              <strong>${expense.description}</strong>
              <small>${formatDate(expense.date)} · ${COST_SHORT[expense.method] || ""}${expense.enteredByFamily ? "" : " · ingevoerd door de organisatie"}</small>${
                expense.receipt
                  ? html`<a class="fa-inline-link" href="${receiptUrl(expense.receipt)}" target="_blank"
                      rel="noopener">📎 Kasticket</a>`
                  : ""
              }</span>
            <span class="fa-own-end">
              <b>${euro(expense.amountCents)}</b>${
                expense.enteredByFamily
                  ? html`<button type="button" class="fa-btn fa-btn-small" data-action="edit-expense"
                      data-id="${expense.id}">Wijzigen</button>
              <button type="button" class="fa-btn fa-btn-small fa-btn-quiet" data-action="delete-expense"
                  data-id="${expense.id}">Verwijderen</button>`
                  : ""
              }</span>
          </li>`
    ),
    ""
  );
  return html`<div class="fa-section-head">
        <h3>Kosten die jullie betaalden</h3>
        <p>Schoten jullie iets voor (cash)? Voeg het hier toe. Het wordt verdeeld over alle deelnemers en verrekend in
            jullie afrekening. De organisatie kan het nog aanpassen.</p>
      </div>${rows ? html`<ul class="fa-own-costs">${rows}</ul>` : ""}${
        view.editingExpenseId
          ? ""
          : html`<details class="fa-add-cost"${view.addCostOpen ? " open" : ""}>
          <summary>+ Kost toevoegen</summary>${form()}</details>`
      }`;
}

const receiptUrl = key => "/api/family-account/receipts?key=" + encodeURIComponent(key);

export function renderCosts(item, view = {}) {
  const finance = item.finance;
  if (!finance) return html`<p class="fa-empty">Voor dit evenement is nog geen kostenoverzicht beschikbaar.</p>`;
  if (!finance.expenses.length) return html`${settlementHero(finance)}${renderOwnCosts(item, view)}`;
  const t = finance.totals;
  const categories = joinHtml(
    finance.categories.map(category => {
      const lines = category.personal
        ? joinHtml(
            (category.perMember || []).map(
              member =>
                html`<li>
                    <span>${member.name}</span>
                    <span class="fa-amounts">
                      <small>
                      </small>
                      <b>${euro(member.cents)}</b>
                    </span>
                  </li>`
            ),
            ""
          )
        : joinHtml(
            finance.expenses
              .filter(expense => expense.method === category.method)
              .map(
                expense =>
                  html`<li>
                    <span>${expense.description}${expense.date ? html` <small>${formatDate(expense.date)}</small>` : ""}${
                      expense.advancedByUs
                        ? html` <em
                        class="fa-tag">voorgeschoten door jullie</em>`
                        : ""
                    }</span>
                    <span class="fa-amounts">
                      <small>${euro(expense.amountCents)}</small>
                      <b>${euro(expense.familyCents)}</b>
                    </span>
                  </li>`
              ),
            ""
          );
      const head = category.personal
        ? html`<li class="fa-cost-lines-head">
            <span>Persoon</span>
            <span class="fa-amounts">
              <small>
              </small>
              <b>Barrekening</b>
            </span>
          </li>`
        : html`<li class="fa-cost-lines-head">
            <span>Kost</span>
            <span class="fa-amounts">
              <small>Totaal</small>
              <b>Jullie deel</b>
            </span>
          </li>`;
      return html`<article class="fa-cost-card">
            <header>
              <span class="fa-cost-icon" aria-hidden="true">${COST_ICON[category.method] || "€"}</span>
              <div>
                <h4>${category.label}</h4>
                <small>${category.appliesTo}</small>
              </div>
              <strong>${euro(category.familyCents)}</strong>
            </header>
            <p class="fa-explain">${categoryExplanation(category)}</p>
            <ul class="fa-cost-lines">${head}${lines}</ul>
          </article>`;
    }),
    ""
  );

  const methods = finance.categories.map(category => category.method);
  const members = joinHtml(
    finance.members.map(member => {
      const parts = joinHtml(
        methods.map(method => {
          const label = COST_SHORT[method];
          const notApplicable =
            (member.type === EVENING && method !== "bar") || (method === "adults" && member.type !== "Volwassene");
          const extra = method === "meat" ? " · " + plural(member.portions, UNITS.meat) : "";
          return html`<li>
                <span>${label}${extra}</span>
                <b>${
                  notApplicable
                    ? html`<span class="fa-muted">n.v.t. (${member.type === EVENING ? "avondgast" : "kind"})</span>`
                    : euro(member.byMethod[method])
                }</b>
              </li>`;
        }),
        ""
      );
      return html`<article class="fa-member-cost">
            <header>
              <span class="fa-avatar">${(member.name || "?").charAt(0).toUpperCase()}</span>
              <div class="fa-member-name">
                <strong>${member.name}</strong>
                <small>${typeLabel(member.type)}</small>
              </div>
              <strong>${euro(member.totalCents)}</strong>
            </header>
            <ul>${parts}</ul>
          </article>`;
    }),
    ""
  );

  const settlementRows = [
    html`<li>
        <span>Ons aandeel in de kosten</span>
        <b>${euro(t.shareCents)}</b>
      </li>`,
    t.advancedCents
      ? html`<li>
        <span>Min: door jullie voorgeschoten</span>
        <b>− ${euro(t.advancedCents)}</b>
      </li>`
      : "",
    t.paidCents
      ? html`<li>
        <span>Min: al betaald</span>
        <b>− ${euro(t.paidCents)}</b>
      </li>`
      : "",
    t.refundedCents
      ? html`<li>
        <span>Al terugbetaald aan jullie</span>
        <b>${euro(t.refundedCents)}</b>
      </li>`
      : "",
    t.remainingCents > 0
      ? html`<li class="fa-settle-total fa-due">
          <span>Nog te betalen</span>
          <b>${euro(t.remainingCents)}</b>
        </li>`
      : t.creditCents > 0
        ? html`<li class="fa-settle-total fa-credit">
            <span>Jullie krijgen terug</span>
            <b>${euro(t.creditCents)}</b>
          </li>`
        : html`<li class="fa-settle-total fa-ok">
            <span>Saldo</span>
            <b>${euro(0)}</b>
          </li>`
  ];
  const payments = finance.payments.length
    ? html`<ul class="fa-payments">${joinHtml(
        finance.payments.map(
          payment =>
            html`<li>
                <span>${payment.kind === "refund" ? "Terugbetaald aan jullie · " : "Betaald · "}${formatDate(payment.date) || ""} · ${payment.method === "cash" ? "cash" : "overschrijving"}</span>
                <b>${payment.kind === "refund" ? "+ " : ""}${euro(payment.amountCents)}</b>
              </li>`
        ),
        ""
      )}</ul>`
    : "";

  return html`<div class="fa-section-head">
        <h3>1. Kosten van het evenement</h3>
        <p>Per soort kost: het totaal en het deel dat jullie gezin draagt.</p>
      </div>${categories}<div class="fa-section-head">
        <h3>2. Per gezinslid</h3>
        <p>Opgeteld vormen deze bedragen exact jullie gezinsaandeel.</p>
      </div>
      <div class="fa-member-costs">${members}</div>
      <div class="fa-section-head">
        <h3>3. Afrekening</h3>
        <p>${finance.finalized ? "Definitief: alle kosten zijn bevestigd." : "Voorlopig: er kunnen nog kosten bijkomen."}</p>
      </div>
      <ul class="fa-settlement">${settlementRows}</ul>${payments}${renderOwnCosts(item, view)}`;
}
