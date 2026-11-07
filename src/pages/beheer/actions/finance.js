// Costs, payments, refunds and closing the accounts.
import { state } from "../../../data/admin-store.js";
import { euro } from "../../../utils/html.js";
import { getExpenseShares, getFinancialSummary, SHARED_FUND } from "../../../utils/finance.js";
import { barBalance } from "../beheer-view.js";
import { go, renderApp, makeId, markCostsProvisional } from "../admin-core.js";

export const clicks = {
  "edit-expense": action => {
    go({ editingExpenseId: action.dataset.id });
    return;
  },
  "cancel-edit-expense": action => {
    go({ editingExpenseId: null });
    return;
  },
  "finalize-costs": action => {
    const bar = barBalance();
    if (
      bar.used &&
      bar.difference &&
      !window.confirm(
        "Let op: de bar is niet sluitend. De barrekeningen samen (" +
          euro(bar.charged) +
          ") zijn niet gelijk aan de rekening van de drank (" +
          euro(bar.purchases) +
          "). Toch verdergaan?"
      )
    )
      return;
    if (
      !window.confirm(
        "Bevestig je dat alle kosten en facturen voor deze editie zijn ontvangen en ingevoerd? Daarna worden de bedragen als definitief getoond."
      )
    )
      return;
    go({ costsFinalized: true, costsFinalizedAt: new Date().toISOString() });
    return;
  },
  "reopen-costs": action => {
    if (!window.confirm("De eindafrekening opnieuw voorlopig maken?")) return;
    markCostsProvisional();
    renderApp();
    return;
  },
  "delete-expense": action => {
    const expense = state.expenses.find(item => item.id === action.dataset.id);
    if (
      !expense ||
      !window.confirm(
        `Verwijder de kost "${expense.description}" van ${euro(expense.amountCents)} definitief? De verdeling en saldi worden opnieuw berekend.`
      )
    )
      return;
    state.expenses = state.expenses.filter(item => item.id !== expense.id);
    markCostsProvisional();
    renderApp();
    return;
  },
  "delete-payment": action => {
    const payment = state.payments.find(item => item.id === action.dataset.id);
    if (!payment || !window.confirm("Deze betaling verwijderen? Het openstaande saldo wordt opnieuw berekend.")) return;
    state.payments = state.payments.filter(item => item.id !== payment.id);
    renderApp();
    return;
  }
};

export const forms = {
  "expense-form": async (form, event, id) => {
    event.preventDefault();
    const description = form.elements.description.value.trim();
    const amount = Number(form.elements.amount.value),
      amountCents = Math.round(amount * 100);
    const date = form.elements.date.value,
      method = form.elements.method.value,
      advancedBy = form.elements.advancedBy.value;
    if (
      !description ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !Number.isInteger(amountCents) ||
      !date ||
      !advancedBy ||
      !["general", "adults", "meat", "bar"].includes(method) ||
      !(advancedBy === SHARED_FUND || state.registrations.some(item => item.id === advancedBy))
    ) {
      window.alert("Controleer de omschrijving, het bedrag, de datum, de verdeelsleutel en wie voorschoot.");
      return;
    }
    const existing =
      id === "edit-expense-form" ? state.expenses.find(item => item.id === state.editingExpenseId) : null;
    const expense = { id: existing?.id || makeId("kost"), description, amountCents, date, method, advancedBy };
    // Bar purchases are not divided (the personal bar bills cover them).
    if (method !== "bar") {
      try {
        getExpenseShares(expense, state.registrations, { strict: true });
      } catch (error) {
        window.alert(error.message);
        return;
      }
    }
    if (existing) Object.assign(existing, expense);
    else state.expenses.push(expense);
    state.editingExpenseId = null;
    markCostsProvisional();
    renderApp();
    return;
  },
  "add-payment-form": async (form, event, id) => {
    event.preventDefault();
    const registrationId = form.elements.registrationId.value;
    const amount = Number(form.elements.amount.value),
      amountCents = Math.round(amount * 100);
    const date = form.elements.date.value,
      method = form.elements.method.value;
    if (
      !state.registrations.some(item => item.id === registrationId) ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !Number.isInteger(amountCents) ||
      !date ||
      !["cash", "bank"].includes(method)
    ) {
      window.alert("Controleer het gezin, het bedrag, de datum en de betaalwijze.");
      return;
    }
    const balance = getFinancialSummary(state.registrations, state.expenses, state.payments).find(
      row => row.id === registrationId
    );
    if (!balance || amountCents > balance.remainingCents) {
      window.alert(`Het bedrag is hoger dan het openstaande saldo van ${euro(balance?.remainingCents || 0)}.`);
      return;
    }
    state.payments.push({ id: makeId("betaling"), registrationId, amountCents, date, method });
    renderApp();
    return;
  },
  "add-refund-form": async (form, event, id) => {
    event.preventDefault();
    const registrationId = form.elements.registrationId.value;
    const amount = Number(form.elements.amount.value),
      amountCents = Math.round(amount * 100);
    const date = form.elements.date.value,
      method = form.elements.method.value;
    const balance = getFinancialSummary(state.registrations, state.expenses, state.payments).find(
      row => row.id === registrationId
    );
    if (
      !balance ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !Number.isInteger(amountCents) ||
      !date ||
      !["cash", "bank"].includes(method)
    ) {
      window.alert("Controleer het gezin, het bedrag, de datum en de betaalwijze.");
      return;
    }
    if (amountCents > balance.creditCents) {
      window.alert(`Het bedrag is hoger dan wat dit gezin nog terugkrijgt (${euro(balance.creditCents)}).`);
      return;
    }
    state.payments.push({ id: makeId("terugbetaling"), registrationId, amountCents, date, method, kind: "refund" });
    renderApp();
    return;
  }
};
