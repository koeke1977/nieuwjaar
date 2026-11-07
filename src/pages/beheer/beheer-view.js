// Beheer (admin) — rendering of the redesigned admin console.
// Pure render functions over the shared admin `state`; event handling lives in app.js.
import { state } from "../../data/demo-data.js";
import { getExpenseShares, getFinancialSummary, getFamilyFinanceBreakdown, getRegistrationCounts, COST_METHODS } from "../../utils/finance.js";

const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const euroFormat = new Intl.NumberFormat("nl-BE", { style: "currency", currency: "EUR" });
const euro = cents => euroFormat.format((Number(cents) || 0) / 100);
const plural = (count, one, many) => count + " " + (count === 1 ? one : many);
const portionsOf = person => Object.values(person?.orders || {}).reduce((sum, qty) => sum + Math.max(0, Number(qty) || 0), 0);
const familyPortions = registration => (registration.members || []).reduce((sum, person) => sum + portionsOf(person), 0);
const today = () => new Date().toISOString().slice(0, 10);
const formatDate = value => {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return value || "";
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("nl-BE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};
export const eventName = () => state.eventName || "Nieuwjaar";
export const editionName = () => state.activeEvent?.name || "";
const eventTitle = () => eventName() + (editionName() ? " " + editionName() : "");
const SHARED_FUND = "kas";
const payerName = (id, regs = state.registrations || []) => id === SHARED_FUND ? "de gemeenschappelijke kas" : regs.find(reg => reg.id === id)?.name || "Onbekend";
function paymentLine(payment, withFamily) {
  const refund = payment.kind === "refund";
  const label = (refund ? "Terugbetaald aan het gezin" : "Betaling") + " · " + esc(formatDate(payment.date)) + " · " + (payment.method === "cash" ? "cash" : "overschrijving");
  return '<li' + (refund ? ' class="bh-refund"' : "") + '><span>' + (withFamily ? '<strong>' + esc(payerName(payment.registrationId)) + '</strong><small>' + label + '</small>' : label) + '</span><span class="bh-line-end"><b>' + (refund ? "− " : "") + euro(payment.amountCents) + '</b><button type="button" class="bh-icon-btn" data-action="delete-payment" data-id="' + esc(payment.id) + '" aria-label="' + (refund ? "Terugbetaling" : "Betaling") + ' verwijderen">×</button></span></li>';
}
function refundForm(registrationId, creditCents, compact = true) {
  return '<form id="add-refund-form" class="bh-form-grid' + (compact ? " bh-form-compact" : "") + '"><input type="hidden" name="registrationId" value="' + esc(registrationId) + '"><label>Terugbetaald (€)<input name="amount" type="number" min="0.01" step="0.01" max="' + (creditCents / 100).toFixed(2) + '" value="' + (creditCents / 100).toFixed(2) + '" required></label><label>Datum<input name="date" type="date" value="' + today() + '" required></label><label>Wijze<select name="method"><option value="bank">Overschrijving</option><option value="cash">Cash</option></select></label><button type="submit" class="bh-btn bh-btn-primary">Terugbetaling registreren</button></form>';
}
const METHOD_SHORT = { general: "Algemeen", adults: "18+", meat: "Vlees" };
const METHOD_ICON = { general: "👥", adults: "🥂", meat: "🍖" };
const METHOD_HINT = { general: "Iedereen, ook kinderen (bv. zaal, decoratie, frisdrank)", adults: "Alleen volwassenen (bv. alcohol, cava)", meat: "Volgens bestelde porties" };

// ---- External data provided by app.js (accounts and personal links) ----
let families = [];
let accounts = [];
export function setBeheerFamilies(list) { families = Array.isArray(list) ? list : []; }
export function setBeheerAccounts(list) { accounts = Array.isArray(list) ? list : []; }
// Families of the loaded edition that the server list does not know yet (just added) are
// shown from the edition state until the next reload.
function allFamilies() {
  const known = new Set(families.map(family => family.id));
  const pending = (state.registrations || []).filter(reg => reg.familyId && !known.has(reg.familyId))
    .map(reg => ({ id: reg.familyId, name: reg.name, registrations: [{ id: reg.id, editionId: state.activeEditionId, edition: editionName(), event: eventName(), editionStatus: state.editionStatus, members: reg.members || [] }], accounts: [] }));
  return [...families, ...pending];
}
const accountsForFamily = familyId => allFamilies().find(family => family.id === familyId)?.accounts || [];

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
  { id: "products", label: "Producten" },
  { id: "edition", label: "Editie" }
];
// Older ids (buttons, saved UI state) that now live inside an edition.
export const EDITION_TAB_ALIASES = { families: "registrations", meat: "order", payments: "finance", expenses: "finance", settlement: "finance", catalog: "products", editions: "edition" };
export function normalizeSection(section) {
  return SECTIONS.some(entry => entry.id === section) ? section : "events";
}
const editionTab = () => {
  const tab = EDITION_TAB_ALIASES[state.beheerEditionTab] || state.beheerEditionTab;
  return EDITION_TABS.some(entry => entry.id === tab) ? tab : "overview";
};

function eventTotals() {
  const regs = state.registrations || [];
  const counts = regs.map(getRegistrationCounts);
  const summary = getFinancialSummary(regs, state.expenses, state.payments);
  return {
    families: regs.length,
    people: counts.reduce((sum, c) => sum + c.people, 0),
    adults: counts.reduce((sum, c) => sum + c.adults, 0),
    children: counts.reduce((sum, c) => sum + c.children, 0),
    portions: regs.reduce((sum, r) => sum + familyPortions(r), 0),
    costs: (state.expenses || []).reduce((sum, e) => sum + (Number(e.amountCents) || 0), 0),
    received: (state.payments || []).filter(p => p.kind !== "refund").reduce((sum, p) => sum + (Number(p.amountCents) || 0), 0),
    outstanding: summary.reduce((sum, row) => sum + row.remainingCents, 0),
    toRefund: summary.reduce((sum, row) => sum + row.creditCents, 0),
    refunded: (state.payments || []).filter(p => p.kind === "refund").reduce((sum, p) => sum + (Number(p.amountCents) || 0), 0),
    summary
  };
}

function statusChip() {
  return state.costsFinalized ? '<span class="bh-chip bh-chip-ok">Kosten definitief</span>' : '<span class="bh-chip bh-chip-warn">Kosten voorlopig</span>';
}

function pageHead(title, intro, actions = "") {
  return '<header class="bh-page-head"><div><h1>' + esc(title) + '</h1>' + (intro ? '<p>' + esc(intro) + '</p>' : "") + '</div>' + (actions ? '<div class="bh-page-actions">' + actions + '</div>' : "") + '</header>';
}

function kpi(value, label, sub = "", target = "") {
  const tag = target ? 'button type="button" data-action="edition-tab" data-tab="' + (EDITION_TAB_ALIASES[target] || target) + '"' : "div";
  return '<' + tag + ' class="bh-kpi"><strong>' + value + '</strong><span>' + esc(label) + '</span>' + (sub ? '<small>' + sub + '</small>' : "") + '</' + (target ? "button" : "div") + '>';
}

function familyBalanceChip(row) {
  if (!row) return "";
  if (row.remainingCents > 0) return '<span class="bh-chip bh-chip-due">' + euro(row.remainingCents) + ' open</span>';
  const credit = row.creditCents;
  if (credit > 0) return '<span class="bh-chip bh-chip-info">' + euro(credit) + ' terug</span>';
  if (row.shareCents > 0) return '<span class="bh-chip bh-chip-ok">In orde</span>';
  return '<span class="bh-chip">Geen saldo</span>';
}

function accessChip(familyId) {
  const users = accountsForFamily(familyId);
  if (users.some(user => user.status === "active")) return '<span class="bh-chip bh-chip-ok">Account actief</span>';
  if (users.some(user => user.status === "invited")) return '<span class="bh-chip bh-chip-warn">Uitgenodigd</span>';
  return '<span class="bh-chip bh-chip-muted">Geen account</span>';
}

// ---------------- Dashboard ----------------
function renderOverview() {
  const t = eventTotals();
  const regs = state.registrations || [];
  const attention = [];
  for (const reg of regs) {
    const row = t.summary.find(item => item.id === reg.id);
    const reasons = [];
    if (!(reg.members || []).length) reasons.push("nog geen gezinsleden");
    else if (!familyPortions(reg)) reasons.push("nog geen vleesbestelling");
    if (!accountsForFamily(reg.familyId).length) reasons.push("geen account");
    if (row?.remainingCents > 0) reasons.push(euro(row.remainingCents) + " openstaand");
    if (reasons.length) attention.push('<li><button type="button" data-action="open-family" data-id="' + esc(reg.id) + '"><strong>' + esc(reg.name) + '</strong><span>' + esc(reasons.join(" · ")) + '</span><i aria-hidden="true">›</i></button></li>');
  }
  const meat = state.catalog.map(product => ({ name: product.name, count: regs.reduce((sum, r) => sum + (r.members || []).reduce((s, p) => s + (Number(p.orders?.[product.id]) || 0), 0), 0) }))
    .filter(item => item.count > 0).sort((a, b) => b.count - a.count);
  const maxMeat = Math.max(1, ...meat.map(item => item.count));
  const byMethod = Object.keys(COST_METHODS).map(method => ({ method, cents: (state.expenses || []).filter(e => e.method === method).reduce((s, e) => s + (Number(e.amountCents) || 0), 0) })).filter(row => row.cents > 0);
  const progress = t.received + t.outstanding > 0 ? Math.round(t.received / (t.received + t.outstanding) * 100) : 0;
  return pageHead("Overzicht", "De stand van deze editie in één oogopslag.", statusChip()) +
    '<section class="bh-kpis">' +
      kpi(t.families, "gezinnen", "", "families") +
      kpi(t.people, "deelnemers", t.adults + " volwassenen · " + t.children + " kinderen", "families") +
      kpi(t.portions, "vleesporties", meat.length ? plural(meat.length, "product", "producten") : "nog niets besteld", "order") +
      kpi(euro(t.costs), "kosten", plural((state.expenses || []).length, "uitgave", "uitgaven"), "finance") +
      kpi(euro(t.received), "ontvangen", t.received && t.outstanding ? progress + "% van het verschuldigde" : "", "finance") +
      kpi(euro(t.outstanding), "nog te ontvangen", t.toRefund ? euro(t.toRefund) + " terug te geven" : "", "finance") +
    '</section>' +
    '<div class="bh-grid-2">' +
      '<section class="bh-card"><header class="bh-card-head"><h2>Aandachtspunten</h2><span class="bh-count">' + attention.length + '</span></header>' +
        (attention.length ? '<ul class="bh-attention">' + attention.join("") + '</ul>' : '<p class="bh-empty">Alles is in orde. 🎉</p>') + '</section>' +
      '<section class="bh-card"><header class="bh-card-head"><h2>Vlees</h2><button type="button" class="bh-link" data-action="edition-tab" data-tab="order">Volledig overzicht ›</button></header>' +
        (meat.length ? '<ul class="bh-bars">' + meat.map(item => '<li><span>' + esc(item.name) + '</span><div class="bh-bar"><i style="width:' + Math.round(item.count / maxMeat * 100) + '%"></i></div><b>' + item.count + '</b></li>').join("") + '</ul>' : '<p class="bh-empty">Nog geen bestellingen.</p>') +
        '<header class="bh-card-head bh-card-head-sub"><h2>Kosten per soort</h2><button type="button" class="bh-link" data-action="edition-tab" data-tab="finance">Financiën ›</button></header>' +
        (byMethod.length ? '<ul class="bh-lines">' + byMethod.map(row => '<li><span>' + METHOD_ICON[row.method] + ' ' + esc(COST_METHODS[row.method].label) + '</span><b>' + euro(row.cents) + '</b></li>').join("") + '</ul>' : '<p class="bh-empty">Nog geen kosten ingevoerd.</p>') +
      '</section>' +
    '</div>';
}

// ---------------- Gezinnen ----------------
function registerExistingFamily() {
  if (state.editionStatus === "archived") return '<p class="bh-alert bh-alert-info">Deze editie is afgesloten. Je kan ze nog aanpassen, maar nieuwe inschrijvingen horen bij de actieve editie.</p>';
  const registered = new Set((state.registrations || []).map(reg => reg.familyId));
  const options = allFamilies().filter(family => !registered.has(family.id));
  if (!options.length) return "";
  return '<section class="bh-card"><form id="register-family-form" class="bh-inline-form"><label for="bh-existing-family">Bestaand gezin inschrijven</label><div><select id="bh-existing-family" name="familyId" required><option value="">Kies een gezin</option>' + options.map(family => '<option value="' + esc(family.id) + '">' + esc(family.name) + '</option>').join("") + '</select><button type="submit" class="bh-btn bh-btn-primary">Inschrijven</button></div><small class="bh-muted">De gezinsleden van hun vorige inschrijving worden overgenomen; de bestelling start leeg.</small></form></section>';
}

function renderFamilyList() {
  const t = eventTotals();
  const regs = state.registrations || [];
  const rows = regs.map(reg => {
    const counts = getRegistrationCounts(reg);
    const row = t.summary.find(item => item.id === reg.id);
    return '<li><button type="button" class="bh-family-row" data-action="open-family" data-id="' + esc(reg.id) + '">' +
      '<span class="bh-avatar">' + esc((reg.name || "?").charAt(0).toUpperCase()) + '</span>' +
      '<span class="bh-family-name"><strong>' + esc(reg.name) + '</strong><small>' + ((reg.members || []).length ? counts.adults + " volw. · " + counts.children + " kind. · " + plural(familyPortions(reg), "portie", "porties") : "Gezin nog niet ingevuld") + '</small></span>' +
      '<span class="bh-family-money"><b>' + euro(row?.shareCents || 0) + '</b><small>aandeel</small></span>' +
      '<span class="bh-family-chips">' + familyBalanceChip(row) + accessChip(reg.familyId) + '</span>' +
      '<i class="bh-chev" aria-hidden="true">›</i></button></li>';
  }).join("");
  return pageHead("Inschrijvingen", plural(regs.length, "gezin", "gezinnen") + " ingeschreven · " + t.people + " deelnemers (" + t.adults + " volwassenen, " + t.children + " kinderen)") +
    registerExistingFamily() + '<section class="bh-card"><form id="add-registration-form" class="bh-inline-form"><label for="bh-new-family">Nieuw gezin inschrijven</label><div><input id="bh-new-family" name="registrationName" maxlength="80" placeholder="Bijvoorbeeld: Jan & Els" required><button type="submit" class="bh-btn bh-btn-primary">+ Gezin toevoegen</button></div></form></section>' +
    (rows ? '<ul class="bh-family-list">' + rows + '</ul>' : '<p class="bh-empty">Nog geen inschrijvingen voor deze editie.</p>');
}

function renderMemberEditor(registration) {
  const members = registration.members || [];
  const products = state.catalog.filter(product => product.active);
  return members.map((person, index) => {
    if (state.editingAdminMemberIndex === index) {
      return '<form id="edit-admin-member-form" data-index="' + index + '" class="bh-member bh-member-edit"><input name="memberName" maxlength="80" value="' + esc(person.name) + '" aria-label="Naam" required><select name="memberType" aria-label="Categorie"><option value="Volwassene"' + (person.type === "Volwassene" ? " selected" : "") + '>Volwassene (18+)</option><option value="Kind"' + (person.type === "Kind" ? " selected" : "") + '>Kind</option></select><div class="bh-actions"><button type="submit" class="bh-btn bh-btn-primary">Bewaren</button><button type="button" class="bh-btn" data-action="cancel-edit-admin-member">Annuleren</button></div></form>';
    }
    const steppers = products.map(product => {
      const quantity = Number(person.orders?.[product.id]) || 0;
      return '<div class="bh-stepper-row"><span>' + esc(product.name) + '</span><div class="bh-stepper"><button type="button" data-action="admin-quantity" data-registration="' + esc(registration.id) + '" data-person="' + esc(person.id) + '" data-product="' + esc(product.id) + '" data-delta="-1" aria-label="Minder ' + esc(product.name) + '"' + (quantity ? "" : " disabled") + '>−</button><b>' + quantity + '</b><button type="button" data-action="admin-quantity" data-registration="' + esc(registration.id) + '" data-person="' + esc(person.id) + '" data-product="' + esc(product.id) + '" data-delta="1" aria-label="Meer ' + esc(product.name) + '">+</button></div></div>';
    }).join("");
    return '<details class="bh-member" data-member-id="' + esc(person.id) + '"' + (state.beheerOpenMembers?.has(person.id) ? " open" : "") + '><summary><span class="bh-avatar bh-avatar-sm">' + esc((person.name || "?").charAt(0).toUpperCase()) + '</span><span class="bh-family-name"><strong>' + esc(person.name) + '</strong><small>' + (person.type === "Kind" ? "Kind" : "Volwassene (18+)") + '</small></span><span class="bh-chip">' + plural(portionsOf(person), "portie", "porties") + '</span><i class="bh-chev" aria-hidden="true">›</i></summary>' +
      '<div class="bh-member-body">' + (steppers || '<p class="bh-empty">Geen actieve producten.</p>') + '<div class="bh-actions"><button type="button" class="bh-btn bh-btn-sm" data-action="edit-member" data-index="' + index + '">Naam of categorie wijzigen</button><button type="button" class="bh-btn bh-btn-sm bh-btn-danger" data-action="delete-member" data-index="' + index + '">Verwijderen</button></div></div></details>';
  }).join("");
}

function accessData(familyId) {
  return { users: accountsForFamily(familyId) };
}

function renderAccess(familyId) {
  const { users } = accessData(familyId);
  const accountRows = users.map(user => '<li><span><strong>' + esc(user.displayName || user.email) + '</strong><small>' + esc(user.email) + ' · ' + (user.role === "owner" ? "beheerder" : user.role === "viewer" ? "lezer" : "bewerker") + '</small></span><span class="bh-line-end">' + (user.status === "active" ? '<span class="bh-chip bh-chip-ok">Actief</span>' : user.status === "disabled" ? '<span class="bh-chip bh-chip-due">Geblokkeerd</span>' : '<span class="bh-chip bh-chip-warn">Uitgenodigd</span><button type="button" class="bh-btn bh-btn-sm" data-action="resend-account-invite" data-user="' + esc(user.id) + '">Opnieuw sturen</button>') + '</span></li>').join("");
  return (accountRows ? '<ul class="bh-lines">' + accountRows + '</ul>' : '<p class="bh-note">Dit gezin heeft nog geen account. Stuur een uitnodiging: ze kiezen zelf een wachtwoord en beheren daarna hun gezin, bestelling en afrekening.</p>') +
    '<form data-invite-account="' + esc(familyId) + '" class="bh-form-grid bh-form-compact"><label>Naam<input name="displayName" maxlength="100" placeholder="Naam contactpersoon" required></label><label>E-mailadres<input name="email" type="email" maxlength="254" placeholder="naam@voorbeeld.be" required></label><button type="submit" class="bh-btn bh-btn-primary">' + (users.length ? "Extra account uitnodigen" : "Uitnodiging versturen") + '</button></form>';
}

function renderFamilyDetail(registration) {
  const finance = getFamilyFinanceBreakdown(registration, state.registrations, state.expenses, state.payments);
  const t = finance.totals;
  const counts = getRegistrationCounts(registration);
  const payments = (state.payments || []).filter(payment => payment.registrationId === registration.id);

  const settlement = finance.expenses.length
    ? '<ul class="bh-lines">' + finance.categories.map(category => '<li><span>' + METHOD_ICON[category.method] + ' ' + esc(category.label) + ' <small>' + category.familyUnits + "/" + category.totalUnits + " " + (category.method === "meat" ? "porties" : category.method === "adults" ? "volwassenen" : "personen") + '</small></span><b>' + euro(category.familyCents) + '</b></li>').join("") +
      '<li class="bh-line-strong"><span>Aandeel van het gezin</span><b>' + euro(t.shareCents) + '</b></li>' +
      (t.advancedCents ? '<li><span>Min: voorgeschoten</span><b>− ' + euro(t.advancedCents) + '</b></li>' : "") +
      (t.paidCents ? '<li><span>Min: betaald</span><b>− ' + euro(t.paidCents) + '</b></li>' : "") +
      (t.refundedCents ? '<li><span>Al terugbetaald aan het gezin</span><b>' + euro(t.refundedCents) + '</b></li>' : "") +
      (t.remainingCents ? '<li class="bh-line-total bh-due"><span>Nog te betalen</span><b>' + euro(t.remainingCents) + '</b></li>'
        : t.creditCents ? '<li class="bh-line-total bh-credit"><span>Terug te geven</span><b>' + euro(t.creditCents) + '</b></li>'
        : '<li class="bh-line-total bh-ok"><span>Saldo</span><b>' + euro(0) + '</b></li>') + '</ul>' +
      '<div class="bh-member-costs">' + finance.members.map(member => '<span>' + esc(member.name) + ' <b>' + euro(member.totalCents) + '</b></span>').join("") + '</div>'
    : '<p class="bh-empty">Nog geen kosten ingevoerd.</p>';

  const paymentList = payments.length ? '<ul class="bh-lines">' + payments.map(payment => paymentLine(payment, false)).join("") + '</ul>' : "";
  const paymentForm = t.remainingCents > 0
    ? '<form id="add-payment-form" class="bh-form-grid bh-form-compact"><input type="hidden" name="registrationId" value="' + esc(registration.id) + '"><label>Bedrag (€)<input name="amount" type="number" min="0.01" step="0.01" max="' + (t.remainingCents / 100).toFixed(2) + '" value="' + (t.remainingCents / 100).toFixed(2) + '" required></label><label>Datum<input name="date" type="date" value="' + today() + '" required></label><label>Wijze<select name="method"><option value="bank">Overschrijving</option><option value="cash">Cash</option></select></label><button type="submit" class="bh-btn bh-btn-primary">Betaling registreren</button></form>'
    : t.creditCents > 0 ? refundForm(registration.id, t.creditCents) : "";

  return '<button type="button" class="bh-back" data-action="close-family">‹ Alle inschrijvingen</button>' +
    '<header class="bh-page-head"><div>' +
      (state.beheerRenaming ? '<form id="rename-registration-form" data-id="' + esc(registration.id) + '" class="bh-rename"><input name="registrationName" maxlength="80" value="' + esc(registration.name) + '" aria-label="Naam gezin" required><button type="submit" class="bh-btn bh-btn-primary">Bewaren</button><button type="button" class="bh-btn" data-action="cancel-rename">Annuleren</button></form>'
        : '<h1>' + esc(registration.name) + ' <button type="button" class="bh-icon-btn" data-action="rename-registration" aria-label="Naam wijzigen">✎</button></h1>') +
      '<p>' + counts.adults + ' volwassenen · ' + counts.children + ' kinderen · ' + plural(familyPortions(registration), "portie", "porties") + '</p></div>' +
      '<div class="bh-page-actions">' + accessChip(registration.familyId) + familyBalanceChip(getFinancialSummary(state.registrations, state.expenses, state.payments).find(row => row.id === registration.id)) + '</div></header>' +
    '<div class="bh-grid-2">' +
      '<section class="bh-card"><header class="bh-card-head"><h2>Gezinsleden & bestelling</h2><span class="bh-count">' + (registration.members || []).length + '</span></header>' +
        ((registration.members || []).length ? '<div class="bh-members">' + renderMemberEditor(registration) + '</div>' : '<p class="bh-empty">Nog geen gezinsleden. Het gezin kan ze zelf toevoegen, of je voegt ze hier toe.</p>') +
        '<form id="add-member-form" class="bh-form-grid bh-form-compact"><label>Naam<input name="memberName" maxlength="80" placeholder="Voornaam en naam" required></label><label>Categorie<select name="memberType"><option value="Volwassene">Volwassene (18+)</option><option value="Kind">Kind</option></select></label><button type="submit" class="bh-btn">+ Persoon toevoegen</button></form>' +
      '</section>' +
      '<div class="bh-stack">' +
        '<section class="bh-card"><header class="bh-card-head"><h2>Afrekening</h2>' + statusChip() + '</header>' + settlement + '</section>' +
        '<section class="bh-card"><header class="bh-card-head"><h2>Betalingen</h2><span class="bh-count">' + payments.length + '</span></header>' + (paymentList || (t.remainingCents ? "" : '<p class="bh-empty">Geen betalingen of terugbetalingen nodig.</p>')) + paymentForm + '</section>' +
        '<section class="bh-card"><header class="bh-card-head"><h2>Gezin & toegang</h2>' + accessChip(registration.familyId) + '</header><p class="bh-note">Namen, accounts en uitnodigingen beheer je bij het gezin onder Gebruikers.</p><button type="button" class="bh-btn" data-action="open-user-family" data-id="' + esc(registration.familyId) + '">Gezin openen in Gebruikers ›</button></section>' +
        '<section class="bh-card"><header class="bh-card-head"><h2>Uitschrijven</h2></header><p class="bh-note">Haalt dit gezin uit ' + esc(eventTitle()) + '. Het gezin, de leden en de accounts blijven bestaan onder Gebruikers.</p><button type="button" class="bh-btn bh-btn-danger" data-action="unregister-family" data-id="' + esc(registration.id) + '">Uitschrijven uit deze editie</button></section>' +
      '</div>' +
    '</div>';
}

function renderFamilies() {
  const registration = (state.registrations || []).find(item => item.id === state.beheerFamilyId);
  if (registration) {
    state.managingRegistrationId = registration.id; // add/edit/delete member handlers act on this
    return renderFamilyDetail(registration);
  }
  return renderFamilyList();
}

// ---------------- Bestelling ----------------
function renderOrder() {
  const regs = state.registrations || [];
  const products = state.catalog.filter(product => product.active || regs.some(r => (r.members || []).some(p => Number(p.orders?.[product.id]) > 0)));
  const countFor = (members, productId) => members.reduce((sum, person) => sum + (Number(person.orders?.[productId]) || 0), 0);
  const allMembers = regs.flatMap(r => r.members || []);
  const total = allMembers.reduce((sum, person) => sum + portionsOf(person), 0);
  const cards = products.map(product => {
    const count = countFor(allMembers, product.id);
    return '<article class="bh-product"><div class="bh-product-img">' + (product.image ? '<img src="' + esc(product.image) + '" alt="" loading="lazy">' : '<span>🍖</span>') + '</div><div><strong>' + esc(product.name) + '</strong><b>' + count + '</b></div></article>';
  }).join("");
  const head = '<tr><th>Gezin</th>' + products.map(product => '<th>' + esc(product.name) + '</th>').join("") + '<th>Totaal</th></tr>';
  const body = regs.map(reg => {
    const members = reg.members || [];
    const cells = products.map(product => { const c = countFor(members, product.id); return '<td>' + (c || '<span class="bh-dim">–</span>') + '</td>'; }).join("");
    const memberRows = members.map(person => '<tr class="bh-sub-row"><td>' + esc(person.name) + (person.type === "Kind" ? ' <small>(kind)</small>' : "") + '</td>' + products.map(product => { const c = Number(person.orders?.[product.id]) || 0; return '<td>' + (c || '<span class="bh-dim">–</span>') + '</td>'; }).join("") + '<td>' + portionsOf(person) + '</td></tr>').join("");
    return '<tbody class="bh-group"><tr class="bh-group-row"><th scope="row"><button type="button" class="bh-link" data-action="open-family" data-id="' + esc(reg.id) + '">' + esc(reg.name) + '</button></th>' + cells + '<td><b>' + familyPortions(reg) + '</b></td></tr>' + memberRows + '</tbody>';
  }).join("");
  const foot = '<tfoot><tr><th>Totaal</th>' + products.map(product => '<th>' + countFor(allMembers, product.id) + '</th>').join("") + '<th>' + total + '</th></tr></tfoot>';
  return pageHead("Bestelling", plural(total, "portie", "porties") + " in totaal, door " + plural(regs.filter(r => familyPortions(r) > 0).length, "gezin", "gezinnen") + ".", '<button type="button" class="bh-btn" data-action="print">Afdrukken</button>') +
    '<section class="bh-card"><header class="bh-card-head"><h2>Voor de slager</h2></header><div class="bh-products">' + (cards || '<p class="bh-empty">Geen producten.</p>') + '</div></section>' +
    '<section class="bh-card"><header class="bh-card-head"><h2>Wie bestelde wat?</h2></header>' + (regs.length ? '<div class="bh-table-wrap"><table class="bh-table">' + '<thead>' + head + '</thead>' + body + foot + '</table></div>' : '<p class="bh-empty">Nog geen gezinnen.</p>') + '</section>';
}

// ---------------- Financiën ----------------
function renderExpenseForm(expense = null) {
  const isEdit = Boolean(expense);
  const method = expense?.method || "general";
  return '<form id="' + (isEdit ? "edit-expense-form" : "add-expense-form") + '" class="bh-form-grid">' +
    '<label class="bh-span-2">Omschrijving<input name="description" maxlength="120" value="' + esc(expense?.description || "") + '" placeholder="Bv. Beenhouwer, Drank, Decoratie" required></label>' +
    '<label>Bedrag (€)<input name="amount" type="number" min="0.01" step="0.01" value="' + (expense ? (expense.amountCents / 100).toFixed(2) : "") + '" placeholder="0,00" required></label>' +
    '<label>Datum<input name="date" type="date" value="' + esc(expense?.date || today()) + '" required></label>' +
    '<label class="bh-span-2">Wie betaalt mee?<select name="method">' + Object.keys(COST_METHODS).map(key => '<option value="' + key + '"' + (key === method ? " selected" : "") + '>' + METHOD_ICON[key] + " " + esc(COST_METHODS[key].label) + " — " + esc(METHOD_HINT[key]) + '</option>').join("") + '</select></label>' +
    '<label class="bh-span-2">Voorgeschoten door<select name="advancedBy" required><option value="">Wie betaalde deze kost?</option><option value="' + SHARED_FUND + '"' + (expense?.advancedBy === SHARED_FUND ? " selected" : "") + '>Gemeenschappelijke kas / organisatie</option>' + (state.registrations || []).map(reg => '<option value="' + esc(reg.id) + '"' + (expense?.advancedBy === reg.id ? " selected" : "") + '>' + esc(reg.name) + '</option>').join("") + '</select></label>' +
    '<div class="bh-actions bh-span-2"><button type="submit" class="bh-btn bh-btn-primary">' + (isEdit ? "Wijzigingen bewaren" : "+ Kost toevoegen") + '</button>' + (isEdit ? '<button type="button" class="bh-btn" data-action="cancel-edit-expense">Annuleren</button>' : "") + '</div></form>';
}

function renderFinance() {
  const t = eventTotals();
  const regs = state.registrations || [];
  const nameOf = id => payerName(id, regs);
  const groups = Object.keys(COST_METHODS).map(method => {
    const list = (state.expenses || []).filter(expense => expense.method === method);
    if (!list.length) return "";
    const sum = list.reduce((s, e) => s + (Number(e.amountCents) || 0), 0);
    const rows = list.map(expense => {
      if (state.editingExpenseId === expense.id) return '<li class="bh-editing">' + renderExpenseForm(expense) + '</li>';
      const shares = getExpenseShares(expense, regs);
      return '<li><div class="bh-expense"><span><strong>' + esc(expense.description) + '</strong><small>' + esc(formatDate(expense.date)) + ' · voorgeschoten door ' + esc(nameOf(expense.advancedBy)) + ' · verdeeld over ' + plural(shares.length, "gezin", "gezinnen") + '</small></span><b>' + euro(expense.amountCents) + '</b></div><div class="bh-actions"><button type="button" class="bh-btn bh-btn-sm" data-action="edit-expense" data-id="' + esc(expense.id) + '">Wijzigen</button><button type="button" class="bh-btn bh-btn-sm bh-btn-danger" data-action="delete-expense" data-id="' + esc(expense.id) + '">Verwijderen</button></div></li>';
    }).join("");
    return '<section class="bh-expense-group"><header><span>' + METHOD_ICON[method] + ' ' + esc(COST_METHODS[method].label) + ' <small>' + esc(METHOD_HINT[method]) + '</small></span><b>' + euro(sum) + '</b></header><ul>' + rows + '</ul></section>';
  }).join("");

  const shareTotal = t.summary.reduce((sum, row) => sum + row.shareCents, 0);
  const balanced = shareTotal === t.costs;
  const settlementRows = t.summary.map(row => {
    const credit = row.creditCents;
    return '<tr><th scope="row"><button type="button" class="bh-link" data-action="open-family" data-id="' + esc(row.id) + '">' + esc(row.name) + '</button></th><td>' + euro(row.shareCents) + '</td><td>' + (row.advancedCents ? euro(row.advancedCents) : '<span class="bh-dim">–</span>') + '</td><td>' + (row.paidCents ? euro(row.paidCents) : '<span class="bh-dim">–</span>') + '</td><td class="' + (row.remainingCents ? "bh-due" : credit ? "bh-credit" : "") + '"><b>' + (row.remainingCents ? euro(row.remainingCents) + " te betalen" : credit ? euro(credit) + " terug" : "In orde") + '</b></td></tr>';
  }).join("");

  const payments = [...(state.payments || [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return pageHead("Financiën", "Kosten, betalingen en de afrekening per gezin.", statusChip()) +
    '<section class="bh-kpis bh-kpis-4">' + kpi(euro(t.costs), "kosten") + kpi(euro(t.received), "ontvangen") + kpi(euro(t.outstanding), "nog te ontvangen") + kpi(euro(t.toRefund), "terug te geven") + '</section>' +
    '<section class="bh-card bh-finalize ' + (state.costsFinalized ? "is-final" : "") + '"><div><h2>' + (state.costsFinalized ? "De afrekening is definitief" : "De afrekening is voorlopig") + '</h2><p>' + (state.costsFinalized ? "Gezinnen zien hun bedrag als definitief. Een wijziging aan kosten of bestellingen maakt het weer voorlopig." : "Zodra alle facturen binnen zijn, bevestig je de afrekening. Gezinnen zien dan een definitief bedrag.") + '</p></div>' +
      (state.costsFinalized ? '<button type="button" class="bh-btn" data-action="reopen-costs">Terug naar voorlopig</button>' : '<button type="button" class="bh-btn bh-btn-primary" data-action="finalize-costs">Alle kosten zijn binnen</button>') + '</section>' +
    '<div class="bh-grid-2">' +
      '<section class="bh-card"><header class="bh-card-head"><h2>Kosten</h2><span class="bh-count">' + (state.expenses || []).length + '</span></header>' +
        (groups || '<p class="bh-empty">Nog geen kosten. Voeg hieronder de eerste toe.</p>') +
        '<details class="bh-add"' + ((state.expenses || []).length ? "" : " open") + '><summary>+ Nieuwe kost</summary>' + (state.editingExpenseId ? '<p class="bh-note">Bewaar eerst de kost die je aan het wijzigen bent.</p>' : renderExpenseForm()) + '</details></section>' +
      '<section class="bh-card"><header class="bh-card-head"><h2>Betalingen</h2><span class="bh-count">' + payments.length + '</span></header>' +
        (payments.length ? '<ul class="bh-lines">' + payments.map(payment => paymentLine(payment, true)).join("") + '</ul>' : '<p class="bh-empty">Nog geen betalingen.</p>') +
        '<details class="bh-add"><summary>+ Betaling registreren</summary><form id="add-payment-form" class="bh-form-grid"><label class="bh-span-2">Van<select name="registrationId" required><option value="">Kies een gezin</option>' + t.summary.filter(row => row.remainingCents > 0).map(row => '<option value="' + esc(row.id) + '">' + esc(row.name) + ' — ' + euro(row.remainingCents) + ' open</option>').join("") + '</select></label><label>Bedrag (€)<input name="amount" type="number" min="0.01" step="0.01" required></label><label>Datum<input name="date" type="date" value="' + today() + '" required></label><label class="bh-span-2">Wijze<select name="method"><option value="bank">Overschrijving</option><option value="cash">Cash</option></select></label><div class="bh-actions bh-span-2"><button type="submit" class="bh-btn bh-btn-primary">Betaling registreren</button></div></form></details>' +
        (t.summary.some(row => row.creditCents > 0) ? '<details class="bh-add"><summary>+ Terugbetaling registreren</summary><p class="bh-note">Geld dat je teruggeeft aan een gezin dat meer voorschoot dan zijn aandeel.</p><form id="add-refund-form" class="bh-form-grid"><label class="bh-span-2">Aan<select name="registrationId" required><option value="">Kies een gezin</option>' + t.summary.filter(row => row.creditCents > 0).map(row => '<option value="' + esc(row.id) + '">' + esc(row.name) + ' — ' + euro(row.creditCents) + ' terug te geven</option>').join("") + '</select></label><label>Bedrag (€)<input name="amount" type="number" min="0.01" step="0.01" required></label><label>Datum<input name="date" type="date" value="' + today() + '" required></label><label class="bh-span-2">Wijze<select name="method"><option value="bank">Overschrijving</option><option value="cash">Cash</option></select></label><div class="bh-actions bh-span-2"><button type="submit" class="bh-btn bh-btn-primary">Terugbetaling registreren</button></div></form></details>' : "") +
      '</section>' +
    '</div>' +
    '<section class="bh-card"><header class="bh-card-head"><h2>Afrekening per gezin</h2><span class="bh-chip ' + (balanced ? "bh-chip-ok" : "bh-chip-due") + '">' + (balanced ? "✓ Sluitend: alle kosten zijn verdeeld" : "Niet sluitend: " + euro(t.costs - shareTotal) + " niet verdeeld") + '</span></header>' +
      (regs.length ? '<div class="bh-table-wrap"><table class="bh-table bh-table-money"><thead><tr><th>Gezin</th><th>Aandeel</th><th>Voorgeschoten</th><th>Betaald</th><th>Saldo</th></tr></thead><tbody>' + settlementRows + '</tbody><tfoot><tr><th>Totaal</th><th>' + euro(shareTotal) + '</th><th>' + euro(t.summary.reduce((s, r) => s + r.advancedCents, 0)) + '</th><th>' + euro(t.received) + '</th><th></th></tr></tfoot></table></div>' : '<p class="bh-empty">Nog geen gezinnen.</p>') +
      (balanced ? "" : '<p class="bh-note">Een kost wordt niet verdeeld als niemand in aanmerking komt, bv. een vleeskost terwijl nog niemand vlees bestelde, of een 18+-kost zonder volwassenen.</p>') +
    '</section>';
}

// ---------------- Producten & editie ----------------

function renderProducts() {
  const rows = state.catalog.map(item => '<li class="bh-product-row"><div class="bh-product-thumb">' + (item.image ? '<img src="' + esc(item.image) + '" alt="">' : "<span>🍖</span>") + '</div>' +
    '<span class="bh-family-name"><strong>' + esc(item.name) + '</strong><small>' + (item.active ? "Zichtbaar voor gezinnen" : "Verborgen voor gezinnen") + '</small></span>' +
    '<div class="bh-actions catalog-admin-actions"><label class="bh-btn bh-btn-sm" for="photo-' + esc(item.id) + '">' + (item.image ? "Foto wijzigen" : "Foto toevoegen") + '</label><input class="visually-hidden" id="photo-' + esc(item.id) + '" type="file" accept="image/png,image/jpeg,image/webp" data-upload-image="' + esc(item.id) + '">' +
    (item.image ? '<button type="button" class="bh-btn bh-btn-sm" data-action="remove-image" data-id="' + esc(item.id) + '">Foto wissen</button>' : "") +
    '<button type="button" class="bh-btn bh-btn-sm' + (item.active ? "" : " bh-btn-primary") + '" data-action="toggle-product" data-id="' + esc(item.id) + '">' + (item.active ? "Verbergen" : "Tonen") + '</button></div></li>').join("");
  return '<section class="bh-card"><header class="bh-card-head"><h2>Producten</h2><span class="bh-count">' + state.catalog.length + '</span></header><ul class="bh-product-list">' + rows + '</ul>' +
    '<form id="add-product-form" class="bh-inline-form"><label for="new-product-name">Nieuw product</label><div><input id="new-product-name" name="productName" maxlength="60" placeholder="Bijvoorbeeld: Kippenbrochette" required><button type="submit" class="bh-btn bh-btn-primary">+ Toevoegen</button></div></form></section>';
}

function renderEventSettings() {
  const event = (state.events || []).find(item => item.id === state.activeEventId);
  const others = (event?.editions || []).filter(edition => edition.id !== state.activeEditionId);
  const archived = state.editionStatus === "archived";
  const otherRows = others.map(edition => '<li><span><strong>' + esc(edition.label) + '</strong><small>' + (edition.status === "archived" ? "Afgesloten" : "Actief") + '</small></span><button type="button" class="bh-btn bh-btn-sm" data-action="open-edition" data-id="' + esc(edition.id) + '">Openen ›</button></li>').join("");
  return '<section class="bh-card"><header class="bh-card-head"><h2>Evenement & editie</h2>' + (archived ? '<span class="bh-chip">Afgesloten</span>' : '<span class="bh-chip bh-chip-ok">Actief</span>') + '</header>' +
      '<p class="bh-note">Een evenement komt terug in <strong>edities</strong>. Gezinnen en hun accounts blijven bestaan; per editie schrijven ze zich opnieuw in, met hun eigen bestellingen, kosten en betalingen.</p>' +
      '<form id="event-settings-form" class="bh-form-grid"><label>Evenement<input name="eventName" maxlength="80" value="' + esc(eventName()) + '" placeholder="Bijvoorbeeld: Nieuwjaar" required></label><label>Deze editie<input name="editionName" maxlength="80" value="' + esc(editionName()) + '" placeholder="Bijvoorbeeld: 2026–2027" required></label><div class="bh-actions bh-span-2"><button type="submit" class="bh-btn bh-btn-primary">Namen bewaren</button></div></form>' +
      '<p class="bh-note">' + plural((state.registrations || []).length, "gezin", "gezinnen") + ' · ' + plural((state.expenses || []).length, "kost", "kosten") + ' · ' + plural((state.payments || []).length, "betaling", "betalingen") + ' in deze editie.</p></section>' +
    (archived ? "" : '<section class="bh-card"><header class="bh-card-head"><h2>Volgende editie starten</h2></header><p class="bh-note">Doe dit pas als ' + esc(eventTitle()) + ' volledig is afgerond. Deze editie wordt dan afgesloten (je kan ze nog altijd openen). Gezinnen en accounts blijven bestaan en kunnen zich inschrijven voor de nieuwe editie.</p><form id="new-edition-form" class="bh-form-grid"><label class="bh-span-2">Naam nieuwe editie<input name="editionName" maxlength="80" placeholder="Bijvoorbeeld: 2027–2028" required></label><label class="bh-check bh-span-2"><input type="checkbox" name="copyCatalog" checked> Producten en foto\'s overnemen</label><div class="bh-actions bh-span-2"><button type="submit" class="bh-btn bh-btn-danger">Afsluiten & nieuwe editie starten</button></div></form></section>') +
    '<section class="bh-card"><header class="bh-card-head"><h2>Andere edities van ' + esc(eventName()) + '</h2><span class="bh-count">' + others.length + '</span></header>' + (otherRows ? '<ul class="bh-lines">' + otherRows + '</ul>' : '<p class="bh-empty">Nog geen andere edities.</p>') + '</section>';
}

function renderMail() {
  return '<section class="bh-card"><header class="bh-card-head"><h2>E-mail testen</h2></header><p class="bh-note">Uitnodigingen en wachtwoordherstel worden verstuurd vanaf registratie@datuur.be via Microsoft 365. Stuur een testmail om de koppeling te controleren.</p><form id="mail-test-form" class="bh-inline-form"><label for="mail-test-recipient">Testmail naar</label><div><input id="mail-test-recipient" name="recipient" type="email" maxlength="254" placeholder="jouw e-mailadres" required><button type="submit" class="bh-btn bh-btn-primary">Testmail versturen</button></div></form></section>';
}

// ---------------- Evenementen ----------------
function renderEvents() {
  const events = state.events || [];
  const cards = events.map(event => {
    const editions = event.editions || [];
    const rows = editions.map(edition => {
      const loaded = edition.id === state.activeEditionId;
      const t = loaded ? eventTotals() : null;
      const stats = t ? '<span class="bh-edition-stats"><span><b>' + t.families + '</b> gezinnen</span><span><b>' + t.people + '</b> deelnemers</span><span><b>' + t.portions + '</b> porties</span><span><b>' + euro(t.outstanding) + '</b> open</span></span>' : '<span class="bh-edition-stats"></span>';
      return '<button type="button" class="bh-edition-row' + (edition.status === "archived" ? " bh-edition-archived" : "") + '" data-action="open-edition" data-id="' + esc(edition.id) + '">' +
        '<span class="bh-edition-label"><strong>' + esc(edition.label) + '</strong><small>' + (edition.status === "archived" ? "Afgesloten editie" : "Actieve editie") + (loaded ? " · geopend" : "") + '</small></span>' + stats +
        '<span class="bh-btn' + (edition.status === "archived" ? "" : " bh-btn-primary") + '">Openen ›</span></button>';
    }).join("");
    return '<article class="bh-card bh-event-card"><header class="bh-card-head"><div><h2 class="bh-event-name">' + esc(event.name) + '</h2><small class="bh-muted">' + plural(editions.length, "editie", "edities") + '</small></div>' + (event.status === "archived" ? '<span class="bh-chip">Afgesloten</span>' : '<span class="bh-chip bh-chip-ok">Actief</span>') + '</header>' +
      (rows || '<p class="bh-empty">Nog geen edities.</p>') + '</article>';
  }).join("");
  return pageHead("Evenementen", "Elk evenement komt terug in edities. Open een editie om inschrijvingen, bestellingen en financiën te beheren.") +
    (cards || '<p class="bh-empty">Nog geen evenementen.</p>') +
    '<details class="bh-card bh-card-dashed bh-add"><summary>+ Nieuw evenement</summary><p class="bh-note">Bijvoorbeeld een BBQ of schoolfeest. Gezinnen en accounts worden gedeeld over alle evenementen; per editie schrijven ze zich in.</p><form id="create-event-form" class="bh-form-grid"><label>Naam evenement<input name="eventName" maxlength="80" placeholder="Bijvoorbeeld: Zomer-BBQ" required></label><label>Eerste editie<input name="editionName" maxlength="80" placeholder="Bijvoorbeeld: 2027" required></label><div class="bh-actions bh-span-2"><button type="submit" class="bh-btn bh-btn-primary">Evenement aanmaken</button></div></form></details>';
}

function renderEdition() {
  const tab = editionTab();
  const body = tab === "registrations" ? renderFamilies() : tab === "order" ? renderOrder() : tab === "finance" ? renderFinance()
    : tab === "products" ? renderProducts() : tab === "edition" ? renderEventSettings() : renderOverview();
  return '<nav class="bh-crumbs" aria-label="Kruimelpad"><button type="button" class="bh-link" data-action="close-edition">Evenementen</button><span aria-hidden="true">›</span><span>' + esc(eventName()) + '</span><span aria-hidden="true">›</span><strong>' + esc(editionName()) + '</strong></nav>' +
    '<header class="bh-edition-head"><div><p class="bh-eyebrow">' + esc(eventName()) + '</p><h1>Editie ' + esc(editionName()) + '</h1></div><div class="bh-page-actions">' + (state.editionStatus === "archived" ? '<span class="bh-chip">Afgesloten editie</span>' : "") + statusChip() + '</div></header>' +
    '<nav class="bh-subtabs bh-subtabs-sticky" aria-label="Editie">' + EDITION_TABS.map(entry => '<button type="button" data-action="edition-tab" data-tab="' + entry.id + '" aria-current="' + (entry.id === tab) + '">' + esc(entry.label) + '</button>').join("") + '</nav>' +
    body;
}

// ---------------- Gebruikers ----------------
function participationRow(family) {
  const rows = (family.registrations || []).map(reg => {
    const loaded = reg.editionId === state.activeEditionId;
    const live = loaded ? state.registrations.find(item => item.id === reg.id) : null;
    const summary = live ? getFinancialSummary(state.registrations, state.expenses, state.payments).find(item => item.id === reg.id) : null;
    return '<li><span><strong>' + esc(reg.event) + ' ' + esc(reg.edition) + '</strong><small>' + (reg.editionStatus === "archived" ? "Afgesloten editie" : "Actieve editie") + (live ? ' · ' + plural(familyPortions(live), "portie", "porties") + ' · aandeel ' + euro(summary?.shareCents || 0) : "") + '</small></span><span class="bh-line-end">' + (summary ? familyBalanceChip(summary) : "") +
      (loaded ? '<button type="button" class="bh-btn bh-btn-sm" data-action="open-family" data-id="' + esc(reg.id) + '">Inschrijving ›</button>' : '<button type="button" class="bh-btn bh-btn-sm" data-action="open-edition" data-id="' + esc(reg.editionId) + '">Editie openen ›</button>') + '</span></li>';
  }).join("");
  return rows || '<li><span class="bh-muted">Nog nergens ingeschreven.</span></li>';
}

function renderUserFamily(family) {
  const registration = state.registrations.find(item => item.familyId === family.id);
  const latest = (family.registrations || [])[0];
  if (registration) state.managingRegistrationId = registration.id; // member handlers act on this
  const members = registration ? registration.members || [] : (latest?.members || []);
  const rows = members.map((person, index) => registration && state.editingAdminMemberIndex === index
    ? '<li><form id="edit-admin-member-form" data-index="' + index + '" class="bh-member-edit"><input name="memberName" maxlength="80" value="' + esc(person.name) + '" aria-label="Naam" required><select name="memberType" aria-label="Categorie"><option value="Volwassene"' + (person.type === "Volwassene" ? " selected" : "") + '>Volwassene (18+)</option><option value="Kind"' + (person.type === "Kind" ? " selected" : "") + '>Kind</option></select><div class="bh-actions"><button type="submit" class="bh-btn bh-btn-primary">Bewaren</button><button type="button" class="bh-btn" data-action="cancel-edit-admin-member">Annuleren</button></div></form></li>'
    : '<li><span class="bh-person"><span class="bh-avatar bh-avatar-sm">' + esc((person.name || "?").charAt(0).toUpperCase()) + '</span><span class="bh-family-name"><strong>' + esc(person.name) + '</strong><small>' + (person.type === "Kind" ? "Kind" : "Volwassene (18+)") + '</small></span></span>' +
      (registration ? '<span class="bh-line-end"><button type="button" class="bh-btn bh-btn-sm" data-action="edit-member" data-index="' + index + '">Wijzigen</button><button type="button" class="bh-btn bh-btn-sm bh-btn-danger" data-action="delete-member" data-index="' + index + '">Verwijderen</button></span>' : "") + '</li>').join("");
  const adults = members.filter(p => p.type === "Volwassene").length;
  const name = registration?.name || family.name;
  const membersCard = '<section class="bh-card"><header class="bh-card-head"><h2>Gezinsleden</h2><span class="bh-count">' + members.length + '</span></header>' +
    (registration ? "" : '<p class="bh-note">' + (latest ? "Zoals bij de laatste inschrijving (" + esc(latest.event) + " " + esc(latest.edition) + "). " : "") + 'Niet ingeschreven voor ' + esc(eventTitle()) + '.</p>') +
    (members.length ? '<ul class="bh-lines bh-people">' + rows + '</ul>' : '<p class="bh-empty">Nog geen gezinsleden.</p>') +
    (registration ? '<form id="add-member-form" class="bh-form-grid bh-form-compact"><label>Naam<input name="memberName" maxlength="80" placeholder="Voornaam en naam" required></label><label>Categorie<select name="memberType"><option value="Volwassene">Volwassene (18+)</option><option value="Kind">Kind</option></select></label><button type="submit" class="bh-btn">+ Persoon toevoegen</button></form>'
      : (state.editionStatus === "archived" ? "" : '<button type="button" class="bh-btn bh-btn-primary" data-action="register-family" data-id="' + esc(family.id) + '">Inschrijven voor ' + esc(eventTitle()) + '</button>')) + '</section>';
  return '<button type="button" class="bh-back" data-action="close-user-family">‹ Alle gezinnen</button>' +
    '<header class="bh-page-head"><div>' +
      (registration && state.beheerRenaming ? '<form id="rename-registration-form" data-id="' + esc(registration.id) + '" class="bh-rename"><input name="registrationName" maxlength="80" value="' + esc(name) + '" aria-label="Naam gezin" required><button type="submit" class="bh-btn bh-btn-primary">Bewaren</button><button type="button" class="bh-btn" data-action="cancel-rename">Annuleren</button></form>'
        : '<h1>' + esc(name) + (registration ? ' <button type="button" class="bh-icon-btn" data-action="rename-registration" aria-label="Naam wijzigen">✎</button>' : "") + '</h1>') +
      '<p>' + plural(adults, "volwassene", "volwassenen") + ' · ' + plural(members.length - adults, "kind", "kinderen") + '</p></div><div class="bh-page-actions">' + accessChip(family.id) + '</div></header>' +
    '<div class="bh-grid-2">' + membersCard +
      '<div class="bh-stack">' +
        '<section class="bh-card"><header class="bh-card-head"><h2>Toegang</h2></header>' + renderAccess(family.id) + '</section>' +
        '<section class="bh-card"><header class="bh-card-head"><h2>Deelname aan evenementen</h2></header><ul class="bh-lines">' + participationRow(family) + '</ul></section>' +
      '</div>' +
    '</div>';
}

function renderUserFamilies() {
  const list = allFamilies();
  const rows = list.map(family => {
    const registration = state.registrations.find(item => item.familyId === family.id);
    const members = registration?.members || family.registrations?.[0]?.members || [];
    const adults = members.filter(p => p.type === "Volwassene").length;
    const editions = (family.registrations || []).map(reg => '<span class="bh-chip' + (reg.editionId === state.activeEditionId ? " bh-chip-info" : "") + '">' + esc(reg.event + " " + reg.edition) + '</span>').join("");
    return '<li><button type="button" class="bh-family-row bh-family-row-user" data-action="open-user-family" data-id="' + esc(family.id) + '">' +
      '<span class="bh-avatar">' + esc((family.name || "?").charAt(0).toUpperCase()) + '</span>' +
      '<span class="bh-family-name"><strong>' + esc(registration?.name || family.name) + '</strong><small>' + (members.length ? plural(adults, "volwassene", "volwassenen") + " · " + plural(members.length - adults, "kind", "kinderen") : "Leden nog niet ingevuld") + '</small></span>' +
      '<span class="bh-family-chips">' + accessChip(family.id) + (editions || '<span class="bh-chip bh-chip-muted">Niet ingeschreven</span>') + '</span>' +
      '<i class="bh-chev" aria-hidden="true">›</i></button></li>';
  }).join("");
  return '<section class="bh-card"><form id="add-registration-form" data-context="users" class="bh-inline-form"><label for="bh-new-user-family">Nieuw gezin</label><div><input id="bh-new-user-family" name="registrationName" maxlength="80" placeholder="Bijvoorbeeld: Jan & Els" required><button type="submit" class="bh-btn bh-btn-primary">+ Gezin toevoegen</button></div><small class="bh-muted">' + (state.editionStatus === "archived" ? "Open eerst een actieve editie om een nieuw gezin in te schrijven." : "Een nieuw gezin wordt meteen ingeschreven voor " + esc(eventTitle()) + ".") + '</small></form></section>' +
    (rows ? '<ul class="bh-family-list">' + rows + '</ul>' : '<p class="bh-empty">Nog geen gezinnen.</p>');
}

function renderAccounts() {
  const rows = accounts.map(user => {
    const status = user.status === "active" ? '<span class="bh-chip bh-chip-ok">Actief</span>' : user.status === "disabled" ? '<span class="bh-chip bh-chip-due">Geblokkeerd</span>' : '<span class="bh-chip bh-chip-warn">Uitgenodigd</span>';
    const fams = (user.families || []).map(link => '<button type="button" class="bh-chip bh-chip-info" data-action="open-user-family" data-id="' + esc(link.familyId) + '">' + esc(link.familyName || "Gezin") + '</button>').join("") || '<span class="bh-chip bh-chip-muted">Geen gezin</span>';
    const actions = (user.status === "invited" ? '<button type="button" class="bh-btn bh-btn-sm" data-action="resend-account-invite" data-user="' + esc(user.id) + '">Opnieuw sturen</button>' : "") +
      (user.status === "active" ? '<button type="button" class="bh-btn bh-btn-sm" data-action="account-status" data-user="' + esc(user.id) + '" data-status="disabled">Blokkeren</button><button type="button" class="bh-btn bh-btn-sm" data-action="account-sessions" data-user="' + esc(user.id) + '">Afmelden op alle toestellen</button>' : "") +
      (user.status === "disabled" ? '<button type="button" class="bh-btn bh-btn-sm" data-action="account-status" data-user="' + esc(user.id) + '" data-status="active">Deblokkeren</button>' : "") +
      '<button type="button" class="bh-btn bh-btn-sm bh-btn-danger" data-action="account-delete" data-user="' + esc(user.id) + '" data-email="' + esc(user.email) + '">Verwijderen</button>';
    return '<li class="bh-account"><div class="bh-account-main"><strong>' + esc(user.displayName || user.email) + '</strong><small>' + esc(user.email) + (user.lastLoginAt ? " · laatst aangemeld " + new Date(user.lastLoginAt * 1000).toLocaleDateString("nl-BE") : "") + '</small><div class="bh-family-chips">' + status + fams + '</div></div><div class="bh-actions">' + actions + '</div></li>';
  }).join("");
  return '<section class="bh-card"><header class="bh-card-head"><h2>Accounts</h2><span class="bh-count">' + accounts.length + '</span></header><p class="bh-note">Uitnodigen doe je bij het gezin (Gezinnen → gezin → Toegang). Een account hoort bij een gezin, niet bij één editie.</p>' +
    (rows ? '<ul class="bh-accounts">' + rows + '</ul>' : '<p class="bh-empty">Nog geen accounts.</p>') + '</section>';
}

export const USERS_TABS = [
  { id: "families", label: "Gezinnen" },
  { id: "accounts", label: "Accounts" }
];

function renderUsers() {
  const family = allFamilies().find(item => item.id === state.beheerUserFamilyId);
  if (family) return renderUserFamily(family);
  const tab = USERS_TABS.some(entry => entry.id === state.beheerUsersTab) ? state.beheerUsersTab : "families";
  return pageHead("Gebruikers", "Gezinnen, hun leden en de accounts waarmee ze aanmelden. Een gezin bestaat één keer en kan deelnemen aan alle evenementen.") +
    '<nav class="bh-subtabs" aria-label="Gebruikers">' + USERS_TABS.map(entry => '<button type="button" data-action="users-tab" data-tab="' + entry.id + '" aria-current="' + (entry.id === tab) + '">' + esc(entry.label) + '</button>').join("") + '</nav>' +
    (tab === "accounts" ? renderAccounts() : renderUserFamilies());
}

// ---------------- Instellingen (global) ----------------
function renderBackups() {
  const list = state.backups;
  const rows = (list || []).slice(0, 10).map(backup => {
    const file = backup.key.slice("backups/".length);
    return '<li><span><strong>' + esc(formatDate(file.slice(3, 13))) + '</strong><small>' + Math.max(1, Math.round((backup.size || 0) / 1024)) + ' kB</small></span><a class="bh-btn bh-btn-sm" href="/api/admin/backups/' + encodeURIComponent(file) + '" download>Downloaden</a></li>';
  }).join("");
  return '<section class="bh-card"><header class="bh-card-head"><h2>Back-ups</h2><button type="button" class="bh-btn bh-btn-sm" data-action="create-backup">Nu back-up maken</button></header>' +
    '<p class="bh-note">Elke nacht wordt automatisch een volledige kopie van de gegevens bewaard (de laatste 35 dagen), in de beveiligde opslag van de app. Daarnaast houdt Cloudflare zelf 7 dagen herstelpunten bij.</p>' +
    (list === undefined ? '<p class="bh-empty">Back-ups laden…</p>' : rows ? '<ul class="bh-lines">' + rows + '</ul>' : '<p class="bh-empty">Nog geen back-ups. De eerste wordt vannacht gemaakt, of klik op "Nu back-up maken".</p>') + '</section>';
}

function renderSettings() {
  return pageHead("Instellingen", "Algemene instellingen voor de hele app.") + renderMail() + renderBackups() +
    '<section class="bh-card"><header class="bh-card-head"><h2>Over deze app</h2></header><ul class="bh-lines"><li><span>Adres</span><b>nieuwjaar.datuur.be</b></li><li><span>Afzender e-mails</span><b>registratie@datuur.be</b></li><li><span>Familieportaal</span><b>nieuwjaar.datuur.be/familie</b></li></ul></section>';
}

export function renderBeheer({ section, notice = "", platformHtml }) {
  const active = normalizeSection(section);
  const content = active === "users" ? renderUsers() : active === "settings" ? renderSettings()
    : state.beheerEventView === "edition" ? renderEdition() : renderEvents();
  const nav = SECTIONS.map(entry => '<button type="button" data-section="' + entry.id + '" aria-current="' + (entry.id === active ? "page" : "false") + '"><span aria-hidden="true">' + entry.icon + '</span>' + esc(entry.label) + '</button>').join("");
  return '<div class="bh-app">' +
    '<header class="bh-top"><div class="bh-brand"><span class="bh-brand-mark" aria-hidden="true">✳</span><span><strong>Evenementen</strong><small>Beheer · datuur.be</small></span></div><button type="button" class="bh-btn bh-btn-ghost" data-action="admin-logout">Afmelden</button></header>' +
    '<nav class="bh-nav" aria-label="Beheer">' + nav + '</nav>' +
    '<main class="bh-main content">' + (notice ? '<div class="bh-alert" role="alert">' + notice + '</div>' : "") + content + '</main>' +
    '</div>';
}
