// Editie → Financiën: kosten, betalingen en afrekening per gezin.
import { state } from "../../../data/admin-store.js";
import { html, joinHtml, euro, plural, formatDate } from "../../../utils/html.js";
import { SHARED_FUND, COST_ICON, getExpenseShares, COST_METHODS } from "../../../utils/finance.js";
import {
  today,
  METHOD_HINT,
  eventTotals,
  payerName,
  pageHead,
  statusChip,
  kpi,
  paymentLine,
  barCheck,
  barBalance
} from "./shared.js";

// ---------------- Financiën ----------------
function renderExpenseForm(expense = null) {
  const isEdit = Boolean(expense);
  const method = expense?.method || "general";
  return html`<form id="${isEdit ? "edit-expense-form" : "add-expense-form"}" class="bh-form-grid">
        <label class="bh-span-2">Omschrijving<input name="description" maxlength="120"
            value="${expense?.description || ""}" placeholder="Bv. Beenhouwer, Drank, Decoratie" required>
        </label>
        <label>Bedrag (€)<input name="amount" type="number" min="0.01" step="0.01"
            value="${expense ? (expense.amountCents / 100).toFixed(2) : ""}" placeholder="0,00" required>
        </label>
        <label>Datum<input name="date" type="date" value="${expense?.date || today()}" required>
        </label>
        <label class="bh-span-2">Wie betaalt mee?<select name="method">${joinHtml(
          Object.keys(COST_METHODS).map(
            key =>
              html`<option
                  value="${key}"${key === method ? " selected" : ""}>${COST_ICON[key]} ${COST_METHODS[key].label} — ${METHOD_HINT[key]}</option>`
          ),
          ""
        )}</select>
        </label>
        <label class="bh-span-2">Voorgeschoten door<select name="advancedBy" required>
            <option value="">Wie betaalde deze kost?</option>
            <option value="${SHARED_FUND}"${expense?.advancedBy === SHARED_FUND ? " selected" : ""}>Gemeenschappelijke
                kas / organisatie</option>${joinHtml(
                  (state.registrations || []).map(
                    reg =>
                      html`<option
                      value="${reg.id}"${expense?.advancedBy === reg.id ? " selected" : ""}>${reg.name}</option>`
                  ),
                  ""
                )}</select>
        </label>
        <div class="bh-actions bh-span-2">
          <button type="submit" class="bh-btn
              bh-btn-primary">${isEdit ? "Wijzigingen bewaren" : "+ Kost toevoegen"}</button>${
                isEdit
                  ? html`<button
              type="button" class="bh-btn" data-action="cancel-edit-expense">Annuleren</button>`
                  : ""
              }</div>
      </form>`;
}

// Mail every family its own statement (worker/modules/settlement-mail.js); a test goes to one address.
function settlementCard() {
  const rows = eventTotals().summary || [];
  const due = rows.filter(row => row.remainingCents > 0).length;
  const credit = rows.filter(row => row.creditCents > 0).length;
  const sentAt = state.settlementSentAt
    ? new Date(state.settlementSentAt * 1000).toLocaleString("nl-BE", { dateStyle: "medium", timeStyle: "short" })
    : "";
  return html`<details class="bh-card bh-settlement">
      <summary>✉ Afrekening mailen naar de gezinnen${
        sentAt
          ? html` <small class="bh-muted">· laatst verstuurd op
            ${sentAt}</small>`
          : ""
      }</summary>
      <form id="settlement-mail-form" class="bh-form-grid">
        <p class="bh-note bh-span-2">Elk gezin krijgt zijn eigen overzicht: aandeel per soort kost (de bar per persoon),
          wat het voorschoot en betaalde, en wat er nog te betalen of terug te krijgen is. Verstuurd vanuit
          registratie@datuur.be naar de accounts van het gezin.${
            state.costsFinalized ? "" : " De kosten zijn nog voorlopig: de mail vermeldt dat ook."
          }</p>
        <label>Naar<select name="audience">
            <option value="all">Alle ingeschreven gezinnen</option>
            <option value="due">Alleen wie nog moet betalen (${due})</option>
            <option value="credit">Alleen wie geld terugkrijgt (${credit})</option>
          </select>
        </label>
        <label>Proefmail naar (optioneel)<input name="testRecipient" type="email" maxlength="254"
            placeholder="jouw@adres.be" autocomplete="email">
        </label>
        <label class="bh-span-2">Jouw bericht (optioneel)<textarea name="note" rows="4" maxlength="3000"
            placeholder="Bijvoorbeeld: betalen kan cash op het feest of bij Koen."></textarea>
        </label>
        <div class="bh-actions bh-span-2">
          <button type="submit" name="mode" value="test" class="bh-btn">Proefmail sturen</button>
          <button type="submit" name="mode" value="send" class="bh-btn bh-btn-primary">Afrekening versturen</button>
        </div>
      </form>
    </details>`;
}

export function renderFinance() {
  const t = eventTotals();
  const regs = state.registrations || [];
  const nameOf = id => payerName(id, regs);
  const groups = joinHtml(
    Object.keys(COST_METHODS).map(method => {
      const list = (state.expenses || []).filter(expense => expense.method === method);
      if (!list.length) return "";
      const sum = list.reduce((s, e) => s + (Number(e.amountCents) || 0), 0);
      const rows = joinHtml(
        list.map(expense => {
          if (state.editingExpenseId === expense.id)
            return html`<li class="bh-editing">${renderExpenseForm(expense)}</li>`;
          const shares = getExpenseShares(expense, regs);
          return html`<li>
                <div class="bh-expense">
                  <span>
                    <strong>${expense.description}</strong>
                    <small>${formatDate(expense.date)} · voorgeschoten door ${nameOf(expense.advancedBy)}${
                      expense.enteredBy === "family"
                        ? html` · <span class="bh-chip bh-chip-info">ingevoerd door gezin</span>`
                        : ""
                    }${
                      expense.receipt
                        ? html` · <a class="bh-link"
                            href="/api/admin/receipts?key=${encodeURIComponent(expense.receipt)}" target="_blank"
                            rel="noopener">📎 Kasticket</a>`
                        : ""
                    } · verdeeld over ${plural(shares.length, "gezin", "gezinnen")}</small>
                  </span>
                  <b>${euro(expense.amountCents)}</b>
                </div>
                <div class="bh-actions">
                  <button type="button" class="bh-btn bh-btn-sm" data-action="edit-expense"
                      data-id="${expense.id}">Wijzigen</button>
                  <button type="button" class="bh-btn bh-btn-sm bh-btn-danger" data-action="delete-expense"
                      data-id="${expense.id}">Verwijderen</button>
                </div>
              </li>`;
        }),
        ""
      );
      return html`<section class="bh-expense-group">
            <header>
              <span>${COST_ICON[method]} ${COST_METHODS[method].label} <small>${METHOD_HINT[method]}</small>
              </span>
              <b>${euro(sum)}</b>
            </header>
            <ul>${rows}</ul>
          </section>`;
    }),
    ""
  );

  const shareTotal = t.summary.reduce((sum, row) => sum + row.shareCents, 0);
  const splitShares = shareTotal - t.summary.reduce((sum, row) => sum + (row.barCents || 0), 0);
  const splitCosts = (state.expenses || [])
    .filter(expense => expense.method !== "bar")
    .reduce((sum, expense) => sum + (Number(expense.amountCents) || 0), 0);
  const balanced = splitShares === splitCosts;
  const settlementRows = joinHtml(
    t.summary.map(row => {
      const credit = row.creditCents;
      return html`<tr>
            <th scope="row">
              <button type="button" class="bh-link" data-action="open-family" data-id="${row.id}">${row.name}</button>
            </th>
            <td>${euro(row.shareCents)}</td>
            <td>${row.advancedCents ? euro(row.advancedCents) : html`<span class="bh-dim">–</span>`}</td>
            <td>${row.paidCents ? euro(row.paidCents) : html`<span class="bh-dim">–</span>`}</td>
            <td class="${row.remainingCents ? "bh-due" : credit ? "bh-credit" : ""}">
              <b>${row.remainingCents ? euro(row.remainingCents) + " te betalen" : credit ? euro(credit) + " terug" : "In orde"}</b>
            </td>
          </tr>`;
    }),
    ""
  );

  const payments = [...(state.payments || [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return html`${pageHead("Financiën", "Kosten, betalingen en de afrekening per gezin.", statusChip())}<section
      class="bh-kpis
      bh-kpis-4">${kpi(euro(t.costs), "kosten")}${kpi(euro(t.received), "ontvangen")}${kpi(euro(t.outstanding), "nog te ontvangen")}${kpi(euro(t.toRefund), "terug te geven")}</section>
      <section class="bh-card bh-finalize ${state.costsFinalized ? "is-final" : ""}">
        <div>
          <h2>${state.costsFinalized ? "De afrekening is definitief" : "De afrekening is voorlopig"}</h2>
          <p>${
            state.costsFinalized
              ? "Gezinnen zien hun bedrag als definitief. Een wijziging aan kosten of bestellingen maakt het weer voorlopig."
              : "Zodra alle facturen binnen zijn, bevestig je de afrekening. Gezinnen zien dan een definitief bedrag."
          }</p>
        </div>${
          state.costsFinalized
            ? html`<button type="button" class="bh-btn" data-action="reopen-costs">Terug naar voorlopig</button>`
            : html`<button type="button" class="bh-btn bh-btn-primary" data-action="finalize-costs">Alle kosten zijn
                binnen</button>`
        }</section>${settlementCard()}
      <div class="bh-grid-2">
        <section class="bh-card">
          <header class="bh-card-head">
            <h2>Kosten</h2>
            <span class="bh-count">${(state.expenses || []).length}</span>
          </header>${groups || html`<p class="bh-empty">Nog geen kosten. Voeg hieronder de eerste toe.</p>`}<details
              class="bh-add"${(state.expenses || []).length ? "" : " open"}>
            <summary>+ Nieuwe kost</summary>${
              state.editingExpenseId
                ? html`<p class="bh-note">Bewaar eerst de kost die je aan het wijzigen bent.</p>`
                : renderExpenseForm()
            }</details>
        </section>
        <section class="bh-card">
          <header class="bh-card-head">
            <h2>Betalingen</h2>
            <span class="bh-count">${payments.length}</span>
          </header>${
            payments.length
              ? html`<ul class="bh-lines">${payments.map(payment => paymentLine(payment, true))}</ul>`
              : html`<p class="bh-empty">Nog geen betalingen.</p>`
          }<details class="bh-add">
            <summary>+ Betaling registreren</summary>
            <form id="add-payment-form" class="bh-form-grid">
              <label class="bh-span-2">Van<select name="registrationId" required>
                  <option value="">Kies een gezin</option>${joinHtml(
                    t.summary
                      .filter(row => row.remainingCents > 0)
                      .map(
                        row => html`<option value="${row.id}">${row.name} — ${euro(row.remainingCents)} open</option>`
                      ),
                    ""
                  )}</select>
              </label>
              <label>Bedrag (€)<input name="amount" type="number" min="0.01" step="0.01" required>
              </label>
              <label>Datum<input name="date" type="date" value="${today()}" required>
              </label>
              <label class="bh-span-2">Wijze<select name="method">
                  <option value="cash">Cash</option>
                  <option value="bank">Overschrijving</option>
                </select>
              </label>
              <div class="bh-actions bh-span-2">
                <button type="submit" class="bh-btn bh-btn-primary">Betaling registreren</button>
              </div>
            </form>
          </details>${
            t.summary.some(row => row.creditCents > 0)
              ? html`<details class="bh-add">
          <summary>+ Terugbetaling registreren</summary>
          <p class="bh-note">Geld dat je teruggeeft aan een gezin dat meer voorschoot dan zijn aandeel.</p>
          <form id="add-refund-form" class="bh-form-grid">
            <label class="bh-span-2">Aan<select name="registrationId" required>
                <option value="">Kies een gezin</option>${joinHtml(
                  t.summary
                    .filter(row => row.creditCents > 0)
                    .map(
                      row =>
                        html`<option value="${row.id}">${row.name} — ${euro(row.creditCents)} terug te geven</option>`
                    ),
                  ""
                )}</select>
            </label>
            <label>Bedrag (€)<input name="amount" type="number" min="0.01" step="0.01" required>
            </label>
            <label>Datum<input name="date" type="date" value="${today()}" required>
            </label>
            <label class="bh-span-2">Wijze<select name="method">
                <option value="cash">Cash</option>
                <option value="bank">Overschrijving</option>
              </select>
            </label>
            <div class="bh-actions bh-span-2">
              <button type="submit" class="bh-btn bh-btn-primary">Terugbetaling registreren</button>
            </div>
          </form>
        </details>`
              : ""
          }</section>
      </div>
      <section class="bh-card">
        <header class="bh-card-head">
          <h2>Afrekening per gezin</h2>
          <span class="bh-chip ${balanced ? "bh-chip-ok" : "bh-chip-due"}">${
            balanced
              ? "✓ Sluitend: alle kosten zijn verdeeld"
              : "Niet sluitend: " + euro(splitCosts - splitShares) + " niet verdeeld"
          }</span>${barCheck(barBalance())}</header>${
            regs.length
              ? html`<div class="bh-table-wrap">
          <table class="bh-table bh-table-money">
            <thead>
              <tr>
                <th>Gezin</th>
                <th>Aandeel</th>
                <th>Voorgeschoten</th>
                <th>Betaald</th>
                <th>Saldo</th>
              </tr>
            </thead>
            <tbody>${settlementRows}</tbody>
            <tfoot>
              <tr>
                <th>Totaal</th>
                <th>${euro(shareTotal)}</th>
                <th>${euro(t.summary.reduce((s, r) => s + r.advancedCents, 0))}</th>
                <th>${euro(t.received)}</th>
                <th>
                </th>
              </tr>
            </tfoot>
          </table>
        </div>`
              : html`<p class="bh-empty">Nog geen gezinnen.</p>`
          }${
            balanced
              ? ""
              : html`<p class="bh-note">Een kost wordt niet verdeeld als niemand in aanmerking komt, bv. een vleeskost
                  terwijl nog niemand vlees bestelde, of een 18+-kost zonder volwassenen.</p>`
          }</section>`;
}
