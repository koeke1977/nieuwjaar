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
const METHOD_SHORT = { general: "Algemeen", adults: "18+", meat: "Vlees" };
const METHOD_ICON = { general: "👥", adults: "🥂", meat: "🍖" };
const METHOD_HINT = { general: "Iedereen, ook kinderen (bv. zaal, decoratie, frisdrank)", adults: "Alleen volwassenen (bv. alcohol, cava)", meat: "Volgens bestelde porties" };

// ---- External data provided by app.js (accounts and personal links) ----
let accounts = [];
let invites = [];
export function setBeheerAccounts(list) { accounts = Array.isArray(list) ? list : []; }
export function setBeheerInvites(list) { invites = Array.isArray(list) ? list : []; }
const accountsFor = registrationId => accounts.filter(user => (user.registrations || []).some(link => link.registrationId === registrationId));
const activeInviteFor = registrationId => invites.find(invite => invite.edition_id === "live" && invite.registration_id === registrationId && !invite.revoked_at);

export const SECTIONS = [
  { id: "overview", label: "Dashboard", icon: "▦" },
  { id: "families", label: "Gezinnen", icon: "♧" },
  { id: "order", label: "Bestelling", icon: "🍖" },
  { id: "finance", label: "Financiën", icon: "€" },
  { id: "settings", label: "Instellingen", icon: "⚙" }
];
// Old section ids still used by some buttons map onto the new structure.
const SECTION_ALIASES = { registrations: "families", meat: "order", payments: "finance", expenses: "finance", settlement: "finance", catalog: "settings", editions: "settings", users: "settings", events: "settings" };
export function normalizeSection(section) {
  const id = SECTION_ALIASES[section] || section;
  return SECTIONS.some(entry => entry.id === id) ? id : "overview";
}

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
    received: (state.payments || []).reduce((sum, p) => sum + (Number(p.amountCents) || 0), 0),
    outstanding: summary.reduce((sum, row) => sum + row.remainingCents, 0),
    toRefund: summary.reduce((sum, row) => sum + Math.max(0, row.balanceCents) + row.overpaidCents, 0),
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
  const tag = target ? 'button type="button" data-section="' + target + '"' : "div";
  return '<' + tag + ' class="bh-kpi"><strong>' + value + '</strong><span>' + esc(label) + '</span>' + (sub ? '<small>' + sub + '</small>' : "") + '</' + (target ? "button" : "div") + '>';
}

function familyBalanceChip(row) {
  if (!row) return "";
  if (row.remainingCents > 0) return '<span class="bh-chip bh-chip-due">' + euro(row.remainingCents) + ' open</span>';
  const credit = Math.max(0, row.balanceCents) + row.overpaidCents;
  if (credit > 0) return '<span class="bh-chip bh-chip-info">' + euro(credit) + ' terug</span>';
  if (row.shareCents > 0) return '<span class="bh-chip bh-chip-ok">In orde</span>';
  return '<span class="bh-chip">Geen saldo</span>';
}

function accessChip(registrationId) {
  const users = accountsFor(registrationId);
  if (users.some(user => user.status === "active")) return '<span class="bh-chip bh-chip-ok">Account actief</span>';
  if (users.some(user => user.status === "invited")) return '<span class="bh-chip bh-chip-warn">Uitgenodigd</span>';
  if (activeInviteFor(registrationId)) return '<span class="bh-chip">Oude link</span>';
  return '<span class="bh-chip bh-chip-muted">Geen toegang</span>';
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
    if (!accountsFor(reg.id).length) reasons.push("geen account");
    if (row?.remainingCents > 0) reasons.push(euro(row.remainingCents) + " openstaand");
    if (reasons.length) attention.push('<li><button type="button" data-action="open-family" data-id="' + esc(reg.id) + '"><strong>' + esc(reg.name) + '</strong><span>' + esc(reasons.join(" · ")) + '</span><i aria-hidden="true">›</i></button></li>');
  }
  const meat = state.catalog.map(product => ({ name: product.name, count: regs.reduce((sum, r) => sum + (r.members || []).reduce((s, p) => s + (Number(p.orders?.[product.id]) || 0), 0), 0) }))
    .filter(item => item.count > 0).sort((a, b) => b.count - a.count);
  const maxMeat = Math.max(1, ...meat.map(item => item.count));
  const byMethod = Object.keys(COST_METHODS).map(method => ({ method, cents: (state.expenses || []).filter(e => e.method === method).reduce((s, e) => s + (Number(e.amountCents) || 0), 0) })).filter(row => row.cents > 0);
  const progress = t.received + t.outstanding > 0 ? Math.round(t.received / (t.received + t.outstanding) * 100) : 0;
  return pageHead(eventTitle(), "Alles voor deze editie op één plek.", statusChip()) +
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
      '<section class="bh-card"><header class="bh-card-head"><h2>Vlees</h2><button type="button" class="bh-link" data-section="order">Volledig overzicht ›</button></header>' +
        (meat.length ? '<ul class="bh-bars">' + meat.map(item => '<li><span>' + esc(item.name) + '</span><div class="bh-bar"><i style="width:' + Math.round(item.count / maxMeat * 100) + '%"></i></div><b>' + item.count + '</b></li>').join("") + '</ul>' : '<p class="bh-empty">Nog geen bestellingen.</p>') +
        '<header class="bh-card-head bh-card-head-sub"><h2>Kosten per soort</h2><button type="button" class="bh-link" data-section="finance">Financiën ›</button></header>' +
        (byMethod.length ? '<ul class="bh-lines">' + byMethod.map(row => '<li><span>' + METHOD_ICON[row.method] + ' ' + esc(COST_METHODS[row.method].label) + '</span><b>' + euro(row.cents) + '</b></li>').join("") + '</ul>' : '<p class="bh-empty">Nog geen kosten ingevoerd.</p>') +
      '</section>' +
    '</div>';
}

// ---------------- Gezinnen ----------------
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
      '<span class="bh-family-chips">' + familyBalanceChip(row) + accessChip(reg.id) + '</span>' +
      '<i class="bh-chev" aria-hidden="true">›</i></button></li>';
  }).join("");
  return pageHead("Gezinnen", plural(regs.length, "gezin", "gezinnen") + " · " + t.people + " deelnemers (" + t.adults + " volwassenen, " + t.children + " kinderen)") +
    '<section class="bh-card"><form id="add-registration-form" class="bh-inline-form"><label for="bh-new-family">Nieuw gezin</label><div><input id="bh-new-family" name="registrationName" maxlength="80" placeholder="Bijvoorbeeld: Jan & Els" required><button type="submit" class="bh-btn bh-btn-primary">+ Gezin toevoegen</button></div></form></section>' +
    (rows ? '<ul class="bh-family-list">' + rows + '</ul>' : '<p class="bh-empty">Nog geen gezinnen voor deze editie.</p>');
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

function renderFamilyDetail(registration) {
  const finance = getFamilyFinanceBreakdown(registration, state.registrations, state.expenses, state.payments);
  const t = finance.totals;
  const users = accountsFor(registration.id);
  const invite = activeInviteFor(registration.id);
  const inviteUrl = invite?.token_value ? "https://nieuwjaar.datuur.be/familie/" + encodeURIComponent(invite.token_value) : "";
  const counts = getRegistrationCounts(registration);
  const payments = (state.payments || []).filter(payment => payment.registrationId === registration.id);

  const settlement = finance.expenses.length
    ? '<ul class="bh-lines">' + finance.categories.map(category => '<li><span>' + METHOD_ICON[category.method] + ' ' + esc(category.label) + ' <small>' + category.familyUnits + "/" + category.totalUnits + " " + (category.method === "meat" ? "porties" : category.method === "adults" ? "volwassenen" : "personen") + '</small></span><b>' + euro(category.familyCents) + '</b></li>').join("") +
      '<li class="bh-line-strong"><span>Aandeel van het gezin</span><b>' + euro(t.shareCents) + '</b></li>' +
      (t.advancedCents ? '<li><span>Min: voorgeschoten</span><b>− ' + euro(t.advancedCents) + '</b></li>' : "") +
      (t.paidCents ? '<li><span>Min: betaald</span><b>− ' + euro(t.paidCents) + '</b></li>' : "") +
      (t.remainingCents ? '<li class="bh-line-total bh-due"><span>Nog te betalen</span><b>' + euro(t.remainingCents) + '</b></li>'
        : t.creditCents ? '<li class="bh-line-total bh-credit"><span>Terug te geven</span><b>' + euro(t.creditCents) + '</b></li>'
        : '<li class="bh-line-total bh-ok"><span>Saldo</span><b>' + euro(0) + '</b></li>') + '</ul>' +
      '<div class="bh-member-costs">' + finance.members.map(member => '<span>' + esc(member.name) + ' <b>' + euro(member.totalCents) + '</b></span>').join("") + '</div>'
    : '<p class="bh-empty">Nog geen kosten ingevoerd.</p>';

  const paymentList = payments.length ? '<ul class="bh-lines">' + payments.map(payment => '<li><span>' + esc(formatDate(payment.date)) + ' · ' + (payment.method === "cash" ? "cash" : "overschrijving") + '</span><span class="bh-line-end"><b>' + euro(payment.amountCents) + '</b><button type="button" class="bh-icon-btn" data-action="delete-payment" data-id="' + esc(payment.id) + '" aria-label="Betaling verwijderen">×</button></span></li>').join("") + '</ul>' : "";
  const paymentForm = t.remainingCents > 0
    ? '<form id="add-payment-form" class="bh-form-grid bh-form-compact"><input type="hidden" name="registrationId" value="' + esc(registration.id) + '"><label>Bedrag (€)<input name="amount" type="number" min="0.01" step="0.01" max="' + (t.remainingCents / 100).toFixed(2) + '" value="' + (t.remainingCents / 100).toFixed(2) + '" required></label><label>Datum<input name="date" type="date" value="' + today() + '" required></label><label>Wijze<select name="method"><option value="bank">Overschrijving</option><option value="cash">Cash</option></select></label><button type="submit" class="bh-btn bh-btn-primary">Betaling registreren</button></form>'
    : "";

  const accountRows = users.map(user => '<li><span><strong>' + esc(user.displayName || user.email) + '</strong><small>' + esc(user.email) + '</small></span><span class="bh-line-end">' + (user.status === "active" ? '<span class="bh-chip bh-chip-ok">Actief</span>' : user.status === "disabled" ? '<span class="bh-chip bh-chip-due">Geblokkeerd</span>' : '<span class="bh-chip bh-chip-warn">Uitgenodigd</span><button type="button" class="bh-btn bh-btn-sm" data-action="resend-account-invite" data-user="' + esc(user.id) + '">Opnieuw sturen</button>') + '</span></li>').join("");
  const access = (accountRows ? '<ul class="bh-lines">' + accountRows + '</ul>' : '<p class="bh-note">Dit gezin heeft nog geen account. Stuur een uitnodiging: ze kiezen zelf een wachtwoord en beheren daarna hun gezin en bestelling.</p>') +
    '<form data-invite-account="' + esc(registration.id) + '" class="bh-form-grid bh-form-compact"><label>Naam<input name="displayName" maxlength="100" placeholder="Naam contactpersoon" required></label><label>E-mailadres<input name="email" type="email" maxlength="254" placeholder="naam@voorbeeld.be" required></label><button type="submit" class="bh-btn bh-btn-primary">' + (users.length ? "Extra account uitnodigen" : "Uitnodiging versturen") + '</button></form>' +
    '<details class="bh-subtle"><summary>Persoonlijke link (oude manier)</summary>' +
      (inviteUrl ? '<div class="bh-copy"><input readonly value="' + esc(inviteUrl) + '" aria-label="Persoonlijke link"><button type="button" class="bh-btn bh-btn-sm" data-action="copy-family-invite-url" data-url="' + esc(inviteUrl) + '">Kopiëren</button><button type="button" class="bh-btn bh-btn-sm bh-btn-danger" data-action="revoke-family-invite" data-id="' + esc(invite.id) + '">Intrekken</button></div>'
        : invite ? '<p class="bh-note">Er is een oude link actief waarvan de code niet meer zichtbaar is.</p><button type="button" class="bh-btn bh-btn-sm" data-action="create-family-invite" data-id="' + esc(registration.id) + '">Nieuwe link maken</button>'
        : '<p class="bh-note">Geen actieve link. Families stappen over op een account.</p><button type="button" class="bh-btn bh-btn-sm" data-action="create-family-invite" data-id="' + esc(registration.id) + '">Toch een link maken</button>') +
    '</details>';

  return '<button type="button" class="bh-back" data-action="close-family">‹ Alle gezinnen</button>' +
    '<header class="bh-page-head"><div>' +
      (state.beheerRenaming ? '<form id="rename-registration-form" class="bh-rename"><input name="registrationName" maxlength="80" value="' + esc(registration.name) + '" aria-label="Naam gezin" required><button type="submit" class="bh-btn bh-btn-primary">Bewaren</button><button type="button" class="bh-btn" data-action="cancel-rename">Annuleren</button></form>'
        : '<h1>' + esc(registration.name) + ' <button type="button" class="bh-icon-btn" data-action="rename-registration" aria-label="Naam wijzigen">✎</button></h1>') +
      '<p>' + counts.adults + ' volwassenen · ' + counts.children + ' kinderen · ' + plural(familyPortions(registration), "portie", "porties") + '</p></div>' +
      '<div class="bh-page-actions">' + accessChip(registration.id) + familyBalanceChip(getFinancialSummary(state.registrations, state.expenses, state.payments).find(row => row.id === registration.id)) + '</div></header>' +
    '<div class="bh-grid-2">' +
      '<section class="bh-card"><header class="bh-card-head"><h2>Gezinsleden & bestelling</h2><span class="bh-count">' + (registration.members || []).length + '</span></header>' +
        ((registration.members || []).length ? '<div class="bh-members">' + renderMemberEditor(registration) + '</div>' : '<p class="bh-empty">Nog geen gezinsleden. Het gezin kan ze zelf toevoegen, of je voegt ze hier toe.</p>') +
        '<form id="add-member-form" class="bh-form-grid bh-form-compact"><label>Naam<input name="memberName" maxlength="80" placeholder="Voornaam en naam" required></label><label>Categorie<select name="memberType"><option value="Volwassene">Volwassene (18+)</option><option value="Kind">Kind</option></select></label><button type="submit" class="bh-btn">+ Persoon toevoegen</button></form>' +
      '</section>' +
      '<div class="bh-stack">' +
        '<section class="bh-card"><header class="bh-card-head"><h2>Afrekening</h2>' + statusChip() + '</header>' + settlement + '</section>' +
        '<section class="bh-card"><header class="bh-card-head"><h2>Betalingen</h2><span class="bh-count">' + payments.length + '</span></header>' + (paymentList || (t.remainingCents ? "" : '<p class="bh-empty">Geen betalingen nodig.</p>')) + paymentForm + '</section>' +
        '<section class="bh-card"><header class="bh-card-head"><h2>Toegang</h2></header>' + access + '</section>' +
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
    '<label class="bh-span-2">Voorgeschoten door<select name="advancedBy" required><option value="">Kies het gezin dat betaalde</option>' + (state.registrations || []).map(reg => '<option value="' + esc(reg.id) + '"' + (expense?.advancedBy === reg.id ? " selected" : "") + '>' + esc(reg.name) + '</option>').join("") + '</select></label>' +
    '<div class="bh-actions bh-span-2"><button type="submit" class="bh-btn bh-btn-primary">' + (isEdit ? "Wijzigingen bewaren" : "+ Kost toevoegen") + '</button>' + (isEdit ? '<button type="button" class="bh-btn" data-action="cancel-edit-expense">Annuleren</button>' : "") + '</div></form>';
}

function renderFinance() {
  const t = eventTotals();
  const regs = state.registrations || [];
  const nameOf = id => regs.find(reg => reg.id === id)?.name || "Onbekend";
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
    const credit = Math.max(0, row.balanceCents) + row.overpaidCents;
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
        (payments.length ? '<ul class="bh-lines">' + payments.map(payment => '<li><span><strong>' + esc(nameOf(payment.registrationId)) + '</strong><small>' + esc(formatDate(payment.date)) + ' · ' + (payment.method === "cash" ? "cash" : "overschrijving") + '</small></span><span class="bh-line-end"><b>' + euro(payment.amountCents) + '</b><button type="button" class="bh-icon-btn" data-action="delete-payment" data-id="' + esc(payment.id) + '" aria-label="Betaling verwijderen">×</button></span></li>').join("") + '</ul>' : '<p class="bh-empty">Nog geen betalingen.</p>') +
        '<details class="bh-add"><summary>+ Betaling registreren</summary><form id="add-payment-form" class="bh-form-grid"><label class="bh-span-2">Van<select name="registrationId" required><option value="">Kies een gezin</option>' + t.summary.filter(row => row.remainingCents > 0).map(row => '<option value="' + esc(row.id) + '">' + esc(row.name) + ' — ' + euro(row.remainingCents) + ' open</option>').join("") + '</select></label><label>Bedrag (€)<input name="amount" type="number" min="0.01" step="0.01" required></label><label>Datum<input name="date" type="date" value="' + today() + '" required></label><label class="bh-span-2">Wijze<select name="method"><option value="bank">Overschrijving</option><option value="cash">Cash</option></select></label><div class="bh-actions bh-span-2"><button type="submit" class="bh-btn bh-btn-primary">Betaling registreren</button></div></form></details>' +
      '</section>' +
    '</div>' +
    '<section class="bh-card"><header class="bh-card-head"><h2>Afrekening per gezin</h2><span class="bh-chip ' + (balanced ? "bh-chip-ok" : "bh-chip-due") + '">' + (balanced ? "✓ Sluitend: alle kosten zijn verdeeld" : "Niet sluitend: " + euro(t.costs - shareTotal) + " niet verdeeld") + '</span></header>' +
      (regs.length ? '<div class="bh-table-wrap"><table class="bh-table bh-table-money"><thead><tr><th>Gezin</th><th>Aandeel</th><th>Voorgeschoten</th><th>Betaald</th><th>Saldo</th></tr></thead><tbody>' + settlementRows + '</tbody><tfoot><tr><th>Totaal</th><th>' + euro(shareTotal) + '</th><th>' + euro(t.summary.reduce((s, r) => s + r.advancedCents, 0)) + '</th><th>' + euro(t.received) + '</th><th></th></tr></tfoot></table></div>' : '<p class="bh-empty">Nog geen gezinnen.</p>') +
      (balanced ? "" : '<p class="bh-note">Een kost wordt niet verdeeld als niemand in aanmerking komt, bv. een vleeskost terwijl nog niemand vlees bestelde, of een 18+-kost zonder volwassenen.</p>') +
    '</section>';
}

// ---------------- Instellingen ----------------
export const SETTINGS_TABS = [
  { id: "event", label: "Evenement" },
  { id: "products", label: "Producten" },
  { id: "accounts", label: "Accounts" },
  { id: "mail", label: "E-mail" }
];
const SETTINGS_ALIASES = { editions: "event", platform: "event" };

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
  const archives = [...(state.editionArchive || [])].reverse();
  const headcount = row => (row.members || []).length || (Number(row.adults) || 0) + (Number(row.children) || 0);
  const archiveCards = archives.map(edition => {
    const regs = edition.registrations || [];
    const people = regs.reduce((sum, row) => sum + headcount(row), 0);
    const costs = (edition.expenses || []).reduce((sum, item) => sum + (Number(item.amountCents) || 0), 0);
    return '<details class="bh-subtle"><summary><strong>' + esc(eventName()) + ' ' + esc(edition.event?.name || "Editie") + '</strong> · ' + plural(regs.length, "gezin", "gezinnen") + ' · ' + people + ' deelnemers · ' + euro(costs) + '</summary><ul class="bh-lines">' + regs.map(row => '<li><span>' + esc(row.name) + '</span><b>' + headcount(row) + '</b></li>').join("") + '</ul></details>';
  }).join("");
  return '<section class="bh-card"><header class="bh-card-head"><h2>Evenement & huidige editie</h2><span class="bh-chip bh-chip-ok">Actief</span></header>' +
      '<p class="bh-note">Een evenement komt elk jaar terug met een nieuwe <strong>editie</strong>. Gezinnen, bestellingen, kosten en betalingen horen altijd bij één editie.</p>' +
      '<form id="event-settings-form" class="bh-form-grid"><label>Evenement<input name="eventName" maxlength="80" value="' + esc(eventName()) + '" placeholder="Bijvoorbeeld: Nieuwjaar" required></label><label>Huidige editie<input name="editionName" maxlength="80" value="' + esc(editionName()) + '" placeholder="Bijvoorbeeld: 2026–2027" required></label><div class="bh-actions bh-span-2"><button type="submit" class="bh-btn bh-btn-primary">Namen bewaren</button></div></form>' +
      '<p class="bh-note">' + plural((state.registrations || []).length, "gezin", "gezinnen") + ' · ' + plural((state.expenses || []).length, "kost", "kosten") + ' · ' + plural((state.payments || []).length, "betaling", "betalingen") + ' in deze editie.</p></section>' +
    '<section class="bh-card"><header class="bh-card-head"><h2>Volgende editie starten</h2></header><p class="bh-note">Doe dit pas als ' + esc(eventTitle()) + ' volledig is afgerond. De huidige editie gaat dan naar het archief, en de nieuwe editie start zonder gezinnen, kosten en betalingen.</p><form id="new-edition-form" class="bh-form-grid"><label class="bh-span-2">Naam nieuwe editie<input name="editionName" maxlength="80" placeholder="Bijvoorbeeld: 2027–2028" required></label><label class="bh-check bh-span-2"><input type="checkbox" name="copyCatalog" checked> Producten en foto\'s overnemen</label><div class="bh-actions bh-span-2"><button type="submit" class="bh-btn bh-btn-danger">Archiveren & nieuwe editie starten</button></div></form></section>' +
    '<section class="bh-card"><header class="bh-card-head"><h2>Vorige edities</h2><span class="bh-count">' + archives.length + '</span></header>' + (archiveCards || '<p class="bh-empty">Nog geen vorige edities. Ze verschijnen hier zodra je een nieuwe editie start.</p>') + '</section>';
}

function renderMail() {
  return '<section class="bh-card"><header class="bh-card-head"><h2>E-mail testen</h2></header><p class="bh-note">Uitnodigingen en wachtwoordherstel worden verstuurd vanaf registratie@datuur.be via Microsoft 365. Stuur een testmail om de koppeling te controleren.</p><form id="mail-test-form" class="bh-inline-form"><label for="mail-test-recipient">Testmail naar</label><div><input id="mail-test-recipient" name="recipient" type="email" maxlength="254" placeholder="jouw e-mailadres" required><button type="submit" class="bh-btn bh-btn-primary">Testmail versturen</button></div></form></section>';
}

function renderSettings(platformHtml) {
  const requested = SETTINGS_ALIASES[state.beheerSettingsTab] || state.beheerSettingsTab;
  const tab = SETTINGS_TABS.some(entry => entry.id === requested) ? requested : "event";
  const body = tab === "products" ? renderProducts() : tab === "event" ? renderEventSettings() : tab === "mail" ? renderMail() : platformHtml(tab);
  return pageHead("Instellingen") +
    '<nav class="bh-subtabs" aria-label="Instellingen">' + SETTINGS_TABS.map(entry => '<button type="button" data-action="settings-tab" data-tab="' + entry.id + '" aria-current="' + (entry.id === tab) + '">' + esc(entry.label) + '</button>').join("") + '</nav>' + body;
}

export function renderBeheer({ section, notice = "", platformHtml }) {
  const active = normalizeSection(section);
  const content = active === "families" ? renderFamilies() : active === "order" ? renderOrder() : active === "finance" ? renderFinance() : active === "settings" ? renderSettings(platformHtml) : renderOverview();
  const nav = SECTIONS.map(entry => '<button type="button" data-section="' + entry.id + '" aria-current="' + (entry.id === active ? "page" : "false") + '"><span aria-hidden="true">' + entry.icon + '</span>' + esc(entry.label) + '</button>').join("");
  return '<div class="bh-app">' +
    '<header class="bh-top"><div class="bh-brand"><span class="bh-brand-mark" aria-hidden="true">✳</span><span><strong>' + esc(eventName()) + '</strong><small>Beheer · editie ' + esc(editionName()) + '</small></span></div><button type="button" class="bh-btn bh-btn-ghost" data-action="admin-logout">Afmelden</button></header>' +
    '<nav class="bh-nav" aria-label="Beheer">' + nav + '</nav>' +
    '<main class="bh-main content">' + (notice ? '<div class="bh-alert" role="alert">' + notice + '</div>' : "") + content + '</main>' +
    '</div>';
}
