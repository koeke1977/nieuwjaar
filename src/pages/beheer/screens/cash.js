// Editie → Kassa: cash ontvangen en teruggeven op het feest zelf. Groot en eenvoudig, voor de gsm.
// Each tap adds a normal payment (method cash), so Financiën and the portal follow immediately.
import { state } from "../../../data/admin-store.js";
import { html, joinHtml, euro } from "../../../utils/html.js";
import { eventTotals, pageHead, kpi, statusChip } from "./shared.js";
import { activeFilter, filterBar } from "./table.js";

const CASH_FILTERS = [
  { id: "due", label: "Te betalen", test: row => row.remainingCents > 0 },
  { id: "credit", label: "Terug te geven", test: row => row.creditCents > 0 },
  { id: "settled", label: "In orde", test: row => !row.remainingCents && !row.creditCents },
  { id: "all", label: "Alle", test: () => true }
];

const byName = (a, b) => String(a.name || "").localeCompare(String(b.name || ""), "nl", { sensitivity: "base" });

function cashRow(row) {
  const status =
    row.remainingCents > 0
      ? html`<b class="bh-cash-amount is-due">${euro(row.remainingCents)}</b>
          <small>nog te betalen</small>`
      : row.creditCents > 0
        ? html`<b class="bh-cash-amount is-credit">${euro(row.creditCents)}</b>
            <small>terug te geven</small>`
        : html`<span class="bh-chip bh-chip-ok">In orde</span>`;
  const actions =
    row.remainingCents > 0
      ? html`<button type="button" class="bh-btn bh-btn-primary bh-cash-btn" data-action="cash-pay"
            data-id="${row.id}">💶 ${euro(row.remainingCents)} ontvangen</button>
          <button type="button" class="bh-btn bh-btn-sm" data-action="cash-other" data-id="${row.id}">Ander bedrag</button>`
      : row.creditCents > 0
        ? html`<button type="button" class="bh-btn bh-cash-btn" data-action="cash-refund"
            data-id="${row.id}">↩ ${euro(row.creditCents)} teruggegeven</button>`
        : "";
  return html`<li class="bh-cash-row">
      <div class="bh-cash-family">
        <strong>${row.name}</strong>
        <div class="bh-cash-status">${status}</div>
      </div>${actions ? html`<div class="bh-cash-actions">${actions}</div>` : ""}</li>`;
}

// The latest cash movements entered here, newest first, with ✕ to undo a mistake.
function recentCash() {
  const names = new Map((state.registrations || []).map(reg => [reg.id, reg.name]));
  const recent = (state.payments || [])
    .filter(payment => payment.method === "cash" && payment.at)
    .sort((a, b) => b.at - a.at)
    .slice(0, 10);
  if (!recent.length) return "";
  return html`<section class="bh-card">
      <header class="bh-card-head">
        <h2>Laatst in de kassa</h2>
      </header>
      <ul class="bh-lines">${joinHtml(
        recent.map(
          payment => html`<li${payment.kind === "refund" ? html` class="bh-refund"` : ""}>
              <span>
                <strong>${names.get(payment.registrationId) || "Gezin"}</strong>
                <small>${payment.kind === "refund" ? "teruggegeven" : "ontvangen"} om
                  ${new Date(payment.at * 1000).toLocaleTimeString("nl-BE", { hour: "2-digit", minute: "2-digit" })}</small>
              </span>
              <span class="bh-line-end">
                <b>${payment.kind === "refund" ? "− " : ""}${euro(payment.amountCents)}</b>
                <button type="button" class="bh-icon-btn" data-action="delete-payment" data-id="${payment.id}"
                    aria-label="Ongedaan maken">×</button>
              </span>
            </li>`
        ),
        ""
      )}</ul>
    </section>`;
}

export function renderCash() {
  const t = eventTotals();
  const all = [...t.summary].sort(byName);
  const rows = all.filter(activeFilter("cash", CASH_FILTERS).test);
  const cashIn = (state.payments || [])
    .filter(payment => payment.method === "cash" && payment.kind !== "refund")
    .reduce((sum, payment) => sum + (Number(payment.amountCents) || 0), 0);
  return html`${pageHead(
    "Kassa",
    "Tik op het bedrag als een gezin cash betaalt of geld terugkrijgt. Het wordt meteen bewaard als betaling.",
    statusChip()
  )}<section class="bh-kpis">${kpi(euro(cashIn), "cash ontvangen")}${kpi(euro(t.outstanding), "nog te ontvangen")}${kpi(
    euro(t.toRefund),
    "nog terug te geven"
  )}</section>
    <section class="bh-card">${filterBar("cash", CASH_FILTERS, all)}${
      rows.length
        ? html`<ul class="bh-cash-list">${joinHtml(rows.map(cashRow), "")}</ul>`
        : html`<p class="bh-empty">${all.length ? "Geen gezinnen in deze lijst. 🎉" : "Nog geen inschrijvingen."}</p>`
    }</section>${recentCash()}`;
}
