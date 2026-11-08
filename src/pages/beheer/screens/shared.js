// Helpers shared by the admin screens: names, totals, page head, KPI tiles, chips, payment lines.
import { state } from "../../../data/admin-store.js";
import { DIET_OPTIONS, NOTE_MAX, hasDiet } from "../../../utils/diet.js";
import { countByType } from "../../../utils/member-types.js";
import { html, joinHtml, euro, formatDate } from "../../../utils/html.js";
import { SHARED_FUND, getFinancialSummary, getRegistrationCounts } from "../../../utils/finance.js";

export const portionsOf = person =>
  Object.values(person?.orders || {}).reduce((sum, qty) => sum + Math.max(0, Number(qty) || 0), 0);
export const familyPortions = registration =>
  (registration.members || []).reduce((sum, person) => sum + portionsOf(person), 0);
export const today = () => new Date().toISOString().slice(0, 10);
export const eventName = () => state.eventName || "Evenement";
export const editionName = () => state.activeEvent?.name || "";
export const eventTitle = () => eventName() + (editionName() ? " " + editionName() : "");
export function barBalance(registrations = state.registrations || [], expenses = state.expenses || []) {
  const charged = registrations.reduce(
    (sum, reg) => sum + (reg.members || []).reduce((s, p) => s + Math.max(0, Number(p.barCents) || 0), 0),
    0
  );
  const purchases = expenses
    .filter(expense => expense.method === "bar")
    .reduce((sum, expense) => sum + (Number(expense.amountCents) || 0), 0);
  return { charged, purchases, difference: charged - purchases, used: charged > 0 || purchases > 0 };
}
export function barCheck(bar) {
  if (!bar.used) return "";
  if (!bar.difference)
    return html`<span class="bh-chip bh-chip-ok">✓ Bar sluitend: barrekeningen = rekening (€ 0,00 verschil)</span>`;
  return html`<span class="bh-chip bh-chip-due">⚠
      Bar: ${euro(Math.abs(bar.difference))}${bar.difference > 0 ? " meer aangerekend dan de rekening" : " minder aangerekend dan de rekening"}</span>`;
}
export const dietChips = person =>
  hasDiet(person)
    ? html`<span class="bh-diet">${joinHtml(
        (person.diet || []).map(item => html`<b>${item}</b>`),
        ""
      )}${person.notes ? html`<em>${person.notes}</em>` : ""}</span>`
    : "";
export const dietFields = person =>
  html`<fieldset class="bh-diet-edit bh-span-2">
      <legend>Allergieën en voorkeuren</legend>${joinHtml(
        DIET_OPTIONS.map(
          option =>
            html`<label>
          <input type="checkbox" name="diet"
              value="${option}"${(person.diet || []).includes(option) ? " checked" : ""}> ${option}</label>`
        ),
        ""
      )}</fieldset>
    <input name="notes" class="bh-span-2" maxlength="${NOTE_MAX}" value="${person.notes || ""}" placeholder="Opmerking
        (optioneel)" aria-label="Opmerking">`;
export const payerName = (id, regs = state.registrations || []) =>
  id === SHARED_FUND ? "de gemeenschappelijke kas" : regs.find(reg => reg.id === id)?.name || "Onbekend";
export function paymentLine(payment, withFamily) {
  const refund = payment.kind === "refund";
  const label =
    (refund ? "Terugbetaald aan het gezin" : "Betaling") +
    " · " +
    formatDate(payment.date) +
    " · " +
    (payment.method === "cash" ? "cash" : "overschrijving");
  return html`<li${refund ? html` class="bh-refund"` : ""}>
        <span>${
          withFamily
            ? html`<strong>${payerName(payment.registrationId)}</strong>
        <small>${label}</small>`
            : label
        }</span>
        <span class="bh-line-end">
          <b>${refund ? "− " : ""}${euro(payment.amountCents)}</b>
          <button type="button" class="bh-icon-btn" data-action="delete-payment" data-id="${payment.id}"
              aria-label="${refund ? "Terugbetaling" : "Betaling"} verwijderen">×</button>
        </span>
      </li>`;
}
export function refundForm(registrationId, creditCents, compact = true) {
  return html`<form id="add-refund-form" class="bh-form-grid${compact ? " bh-form-compact" : ""}">
        <input type="hidden" name="registrationId" value="${registrationId}">
        <label>Terugbetaald (€)<input name="amount" type="number" min="0.01" step="0.01"
            max="${(creditCents / 100).toFixed(2)}" value="${(creditCents / 100).toFixed(2)}" required>
        </label>
        <label>Datum<input name="date" type="date" value="${today()}" required>
        </label>
        <label>Wijze<select name="method">
            <option value="cash">Cash</option>
            <option value="bank">Overschrijving</option>
          </select>
        </label>
        <button type="submit" class="bh-btn bh-btn-primary">Terugbetaling registreren</button>
      </form>`;
}
export const METHOD_HINT = {
  general: "Iedereen, ook kinderen (bv. zaal, decoratie, frisdrank)",
  adults: "Alleen volwassenen (bv. alcohol, cava)",
  meat: "Volgens bestelde porties",
  bar: "Aankoop drank voor de open bar (niet verdeeld: gedekt door de persoonlijke barrekeningen)"
};

// ---- External data provided by app.js (accounts and personal links) ----
let families = [];
export let accounts = [];
export function setBeheerFamilies(list) {
  families = Array.isArray(list) ? list : [];
}
export function setBeheerAccounts(list) {
  accounts = Array.isArray(list) ? list : [];
}
// Families of the loaded edition that the server list does not know yet (just added) are
// shown from the edition state until the next reload.
export function allFamilies() {
  const known = new Set(families.map(family => family.id));
  const pending = (state.registrations || [])
    .filter(reg => reg.familyId && !known.has(reg.familyId))
    .map(reg => ({
      id: reg.familyId,
      name: reg.name,
      registrations: [
        {
          id: reg.id,
          editionId: state.activeEditionId,
          edition: editionName(),
          event: eventName(),
          editionStatus: state.editionStatus,
          members: reg.members || []
        }
      ],
      accounts: []
    }));
  return [...families, ...pending];
}
export const accountsForFamily = familyId => allFamilies().find(family => family.id === familyId)?.accounts || [];

// Layers: Evenementen (each event has editions; all event work happens inside an edition),
// Gebruikers (families, their members and accounts) and global Instellingen.
export const SECTIONS = [
  { id: "events", label: "Evenementen", icon: "🗓" },
  { id: "users", label: "Gebruikers", icon: "👥" },
  { id: "settings", label: "Instellingen", icon: "⚙" }
];
export const EDITION_TABS = [
  { id: "overview", label: "Overzicht" },
  { id: "registrations", label: "Inschrijvingen" },
  { id: "order", label: "Bestelling" },
  { id: "finance", label: "Financiën" },
  { id: "cash", label: "Kassa" },
  { id: "bar", label: "Bar" },
  { id: "products", label: "Producten" },
  { id: "edition", label: "Editie" }
];
// Older ids (buttons, saved UI state) that now live inside an edition.
export const EDITION_TAB_ALIASES = {
  families: "registrations",
  meat: "order",
  payments: "finance",
  expenses: "finance",
  settlement: "finance",
  catalog: "products",
  editions: "edition"
};
export function normalizeSection(section) {
  return SECTIONS.some(entry => entry.id === section) ? section : "events";
}
export const editionTab = () => {
  const tab = EDITION_TAB_ALIASES[state.beheerEditionTab] || state.beheerEditionTab;
  return EDITION_TABS.some(entry => entry.id === tab) ? tab : "overview";
};

export function eventTotals() {
  const regs = state.registrations || [];
  const counts = regs.map(getRegistrationCounts);
  const summary = getFinancialSummary(regs, state.expenses, state.payments);
  return {
    families: regs.length,
    people: counts.reduce((sum, c) => sum + c.people, 0),
    adults: counts.reduce((sum, c) => sum + c.adults, 0),
    children: counts.reduce((sum, c) => sum + c.children, 0),
    evening: regs.reduce((sum, reg) => sum + countByType(reg.members || []).evening, 0),
    portions: regs.reduce((sum, r) => sum + familyPortions(r), 0),
    costs: (state.expenses || []).reduce((sum, e) => sum + (Number(e.amountCents) || 0), 0),
    received: (state.payments || [])
      .filter(p => p.kind !== "refund")
      .reduce((sum, p) => sum + (Number(p.amountCents) || 0), 0),
    outstanding: summary.reduce((sum, row) => sum + row.remainingCents, 0),
    toRefund: summary.reduce((sum, row) => sum + row.creditCents, 0),
    refunded: (state.payments || [])
      .filter(p => p.kind === "refund")
      .reduce((sum, p) => sum + (Number(p.amountCents) || 0), 0),
    summary
  };
}

export function statusChip() {
  return state.costsFinalized
    ? html`<span class="bh-chip bh-chip-ok">Kosten definitief</span>`
    : html`<span class="bh-chip bh-chip-warn">Kosten voorlopig</span>`;
}

export function pageHead(title, intro, actions = "") {
  return html`<header class="bh-page-head">
        <div>
          <h1>${title}</h1>${intro ? html`<p>${intro}</p>` : ""}</div>${
            actions
              ? html`<div
              class="bh-page-actions">${actions}</div>`
              : ""
          }</header>`;
}

export function kpi(value, label, sub = "", target = "") {
  const body = html`<strong>${value}</strong><span>${label}</span>${sub ? html`<small>${sub}</small>` : ""}`;
  return target
    ? html`<button type="button" data-action="edition-tab" data-tab="${EDITION_TAB_ALIASES[target] || target}"
        class="bh-kpi">${body}</button>`
    : html`<div class="bh-kpi">${body}</div>`;
}

export function familyBalanceChip(row) {
  if (!row) return "";
  if (row.remainingCents > 0) return html`<span class="bh-chip bh-chip-due">${euro(row.remainingCents)} open</span>`;
  const credit = row.creditCents;
  if (credit > 0) return html`<span class="bh-chip bh-chip-info">${euro(credit)} terug</span>`;
  if (row.shareCents > 0) return html`<span class="bh-chip bh-chip-ok">In orde</span>`;
  return html`<span class="bh-chip">Geen saldo</span>`;
}

export function accessChip(familyId) {
  const users = accountsForFamily(familyId);
  if (users.some(user => user.status === "active")) return html`<span class="bh-chip bh-chip-ok">Account actief</span>`;
  if (users.some(user => user.status === "invited")) return html`<span class="bh-chip bh-chip-warn">Uitgenodigd</span>`;
  return html`<span class="bh-chip bh-chip-muted">Geen account</span>`;
}
