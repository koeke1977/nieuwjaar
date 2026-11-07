// Rendering of the signed-in family portal. Pure functions: data in, HTML string out.
// All figures come from the server-side finance breakdown (amounts in cents).

const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const euroFormat = new Intl.NumberFormat("nl-BE", { style: "currency", currency: "EUR" });
const percentFormat = new Intl.NumberFormat("nl-BE", { style: "percent", maximumFractionDigits: 1 });
export const euro = cents => euroFormat.format((Number(cents) || 0) / 100);
const plural = (count, [one, many]) => count + " " + (count === 1 ? one : many);
const portionsOf = person => Object.values(person?.orders || {}).reduce((sum, qty) => sum + (Number(qty) || 0), 0);
const formatDate = value => {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return "";
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("nl-BE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};
import { DIET_OPTIONS, NOTE_MAX, hasDiet } from "../../utils/diet.js";
import { countdownState, formatEventDate } from "./countdown.js";
import { ordersClosed, localToDate } from "../../utils/time.js";

const deadlineLabel = deadline => {
  const date = deadline ? localToDate(deadline) : null;
  return date ? date.toLocaleDateString("nl-BE", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Brussels" }) + " om " + date.toLocaleTimeString("nl-BE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" }) : "";
};
const daysLeft = deadline => {
  const date = deadline ? localToDate(deadline) : null;
  return date ? Math.ceil((date.getTime() - Date.now()) / 86400000) : null;
};

// Countdown card on the overview; numbers are refreshed every second by family-auth.js.
function countdownCard(item) {
  const state = countdownState(item.startsAt, item.event || "het feest");
  if (!state || state.phase === "over") return "";
  const p = state.parts;
  const clock = p ? '<div class="fa-count-clock" aria-hidden="true">' + [[p.days, "dagen"], [p.hours, "uur"], [p.minutes, "min"], [p.seconds, "sec"]].map(([n, label], i) => '<span><b data-count-part="' + i + '">' + String(n).padStart(i ? 2 : 1, "0") + '</b><small>' + label + '</small></span>').join("") + '</div>' : "";
  return '<section class="fa-countdown fa-countdown-' + state.phase + '" data-countdown="' + esc(item.startsAt) + '" data-countdown-event="' + esc(item.event || "het feest") + '">' +
    '<p class="fa-eyebrow">' + esc(formatEventDate(item.startsAt)) + '</p><h3 data-count-text>' + esc(state.text) + '</h3>' + clock + '</section>';
}
function countdownChip(item) {
  const state = countdownState(item.startsAt, item.event || "het feest");
  return state && state.phase !== "over" ? '<span class="fa-chip fa-chip-count" data-countdown-chip="' + esc(item.startsAt) + '">' + esc(state.short) + '</span>' : "";
}
const dietChips = person => hasDiet(person)
  ? '<div class="fa-diet">' + (person.diet || []).map(item => '<span>' + esc(item) + '</span>').join("") + (person.notes ? '<em>' + esc(person.notes) + '</em>' : "") + '</div>' : "";
const METHOD_CHOICES = [["general", "Algemeen — iedereen, ook kinderen (zaal, decoratie, frisdrank)"], ["adults", "18+ — alleen volwassenen (alcohol, cava)"], ["meat", "Vlees — volgens bestelde porties"], ["bar", "Aankoop voor de bar — wordt niet verdeeld; de barrekeningen dekken het"]];
const typeLabel = type => type === "Kind" ? "Kind" : type === "Volwassene" ? "Volwassene (18+)" : "Deelnemer";

export const TABS = [
  { id: "overview", label: "Overzicht" },
  { id: "family", label: "Gezin" },
  { id: "order", label: "Bestelling" },
  { id: "costs", label: "Kosten" }
];

const UNITS = { general: ["persoon", "personen"], adults: ["volwassene", "volwassenen"], meat: ["portie", "porties"], bar: ["persoon", "personen"] };
const METHOD_ICON = { general: "👥", adults: "🥂", meat: "🍖", bar: "🍺" };

function statusChip(finance) {
  if (!finance) return "";
  return finance.finalized
    ? '<span class="fa-chip fa-chip-final">Definitief</span>'
    : '<span class="fa-chip fa-chip-provisional">Voorlopig</span>';
}

// The single most important answer for a family: what do we still owe or get back?
function settlementHero(finance) {
  if (!finance || !finance.expenses?.length) {
    return '<div class="fa-hero fa-hero-neutral"><small>Afrekening</small><strong>Nog geen kosten</strong><p>Zodra de organisatie kosten invoert, zie je hier meteen jullie aandeel.</p></div>';
  }
  const t = finance.totals;
  const note = finance.finalized ? "Alle kosten zijn bevestigd door de organisatie." : "Voorlopig bedrag: er kunnen nog kosten bijkomen.";
  if (t.remainingCents > 0) {
    return '<div class="fa-hero fa-hero-due"><small>Nog te betalen</small><strong>' + euro(t.remainingCents) + '</strong><p>' + esc(note) + '</p></div>';
  }
  if (t.creditCents > 0) {
    return '<div class="fa-hero fa-hero-credit"><small>Jullie krijgen terug</small><strong>' + euro(t.creditCents) + '</strong><p>Jullie schoten meer voor dan jullie aandeel. ' + esc(note) + '</p></div>';
  }
  return '<div class="fa-hero fa-hero-ok"><small>Afrekening</small><strong>Alles in orde</strong><p>Er staat niets meer open. ' + esc(note) + '</p></div>';
}

function renderOverview(item) {
  const members = item.registration.members || [];
  const finance = item.finance;
  const portions = members.reduce((sum, person) => sum + portionsOf(person), 0);
  const adults = members.filter(person => person.type === "Volwassene").length;
  return settlementHero(finance) + countdownCard(item) +
    '<div class="fa-stats">' +
      '<button type="button" class="fa-stat" data-tab-target="family" aria-label="Gezin bekijken"><span class="fa-stat-icon" aria-hidden="true">👨‍👩‍👧</span><strong>' + members.length + '</strong><small>' + (members.length === 1 ? "deelnemer" : "deelnemers") + ' · ' + adults + ' volw. · ' + (members.length - adults) + ' kind.</small><em>Gezin <i aria-hidden="true">›</i></em></button>' +
      '<button type="button" class="fa-stat" data-tab-target="order" aria-label="Bestelling aanpassen"><span class="fa-stat-icon" aria-hidden="true">🍖</span><strong>' + portions + '</strong><small>vleesporties</small><em>Bestellen <i aria-hidden="true">›</i></em></button>' +
      '<button type="button" class="fa-stat" data-tab-target="costs" aria-label="Berekening bekijken"><span class="fa-stat-icon" aria-hidden="true">€</span><strong>' + euro(finance?.totals?.shareCents || 0) + '</strong><small>ons aandeel</small><em>Berekening <i aria-hidden="true">›</i></em></button>' +
    '</div>' +
    (members.length ? "" : '<p class="fa-empty">Voeg eerst jullie gezinsleden toe via <button type="button" class="fa-inline-link" data-tab-target="family">Gezin</button>.</p>');
}

const SHORT_LABEL = { general: "Algemeen", adults: "18+", meat: "Vlees", bar: "Bar" };

// Per-person cost from the server breakdown; null while a new person is not yet saved.
function memberCost(item, personId) {
  const finance = item.finance;
  if (!finance?.expenses?.length) return null;
  return finance.members.find(member => member.id === personId) || null;
}

function memberCostDetail(item, person) {
  const cost = memberCost(item, person.id);
  if (!cost) return "";
  const parts = item.finance.categories.map(category => {
    if (category.method === "adults" && person.type !== "Volwassene") return "";
    return '<span>' + SHORT_LABEL[category.method] + ' <b>' + euro(cost.byMethod[category.method]) + '</b></span>';
  }).filter(Boolean).join("");
  return parts ? '<div class="fa-cost-parts">' + parts + '</div>' : "";
}

function memberCostTotal(item, person) {
  const cost = memberCost(item, person.id);
  if (!item.finance?.expenses?.length) return "";
  return '<strong class="fa-member-total">' + (cost ? euro(cost.totalCents) : "…") + '</strong>';
}

function renderFamily(item, view) {
  const members = item.registration.members || [];
  const readOnly = item.accessRole === "viewer";
  const hasCosts = Boolean(item.finance?.expenses?.length);
  const rows = members.map((person, index) => {
    if (!readOnly && view.editingMemberId === person.id) {
      return '<form class="fa-member fa-member-edit" data-edit-member="' + esc(person.id) + '">' +
        '<input name="memberName" aria-label="Naam" value="' + esc(person.name) + '" maxlength="80" required>' +
        '<select name="memberType" aria-label="Categorie"><option value="Volwassene"' + (person.type === "Volwassene" ? " selected" : "") + '>Volwassene (18+)</option><option value="Kind"' + (person.type === "Kind" ? " selected" : "") + '>Kind</option></select>' +
        '<fieldset class="fa-diet-edit"><legend>Allergieën en voorkeuren</legend>' + DIET_OPTIONS.map(option => '<label><input type="checkbox" name="diet" value="' + esc(option) + '"' + ((person.diet || []).includes(option) ? " checked" : "") + '> ' + esc(option) + '</label>').join("") + '</fieldset>' +
        '<input name="notes" aria-label="Opmerking" maxlength="' + NOTE_MAX + '" value="' + esc(person.notes || "") + '" placeholder="Opmerking, bv. geen pikant, notenallergie (ernstig)">' +
        '<div class="fa-row-actions"><button type="submit" class="fa-btn fa-btn-primary">Bewaren</button><button type="button" class="fa-btn" data-action="cancel-edit-member">Annuleren</button></div></form>';
    }
    return '<div class="fa-member"><span class="fa-avatar">' + esc((person.name || "?").charAt(0).toUpperCase()) + '</span>' +
      '<div class="fa-member-name"><strong>' + esc(person.name) + '</strong><small>' + esc(typeLabel(person.type)) + ' · ' + plural(portionsOf(person), UNITS.meat) + '</small>' + dietChips(person) + memberCostDetail(item, person) + '</div>' +
      memberCostTotal(item, person) +
      (readOnly ? "" : '<div class="fa-row-actions"><button type="button" class="fa-btn fa-btn-small" data-action="edit-member" data-person="' + esc(person.id) + '">Wijzigen</button>' +
        (members.length > 1 ? '<button type="button" class="fa-btn fa-btn-small fa-btn-quiet" data-action="remove-member" data-index="' + index + '" aria-label="' + esc(person.name) + ' verwijderen">Verwijderen</button>' : "") + '</div>') +
      '</div>';
  }).join("");
  const familyTotal = hasCosts
    ? '<div class="fa-family-total"><span>Totaal voor het gezin' + (item.finance.finalized ? "" : " <small>(voorlopig)</small>") + '</span><strong>' + euro(item.finance.totals.shareCents) + '</strong></div>'
    : "";
  return '<div class="fa-section-head"><h3>Wie komt er?</h3><p>Per persoon zie je wat die kost: vlees volgens de eigen bestelling, algemene kosten voor iedereen en 18+-kosten alleen voor volwassenen.</p></div>' +
    '<div class="fa-list">' + (rows || '<p class="fa-empty">Nog geen gezinsleden toegevoegd.</p>') + '</div>' + familyTotal +
    (readOnly ? '<p class="fa-muted">Je hebt leesrechten voor deze inschrijving.</p>'
      : '<form class="fa-add" data-add-member><label class="fa-label" for="fa-new-name">Persoon toevoegen</label><div class="fa-add-grid"><input id="fa-new-name" name="memberName" placeholder="Voornaam en naam" maxlength="80" required><select name="memberType" aria-label="Categorie"><option value="Volwassene">Volwassene (18+)</option><option value="Kind">Kind</option></select><button type="submit" class="fa-btn fa-btn-primary">+ Toevoegen</button></div></form>');
}

function renderOrder(item, view) {
  const members = item.registration.members || [];
  const catalog = item.catalog || [];
  const closed = item.ordersClosed || ordersClosed(item.orderDeadline);
  const readOnly = item.accessRole === "viewer" || closed;
  const left = daysLeft(item.orderDeadline);
  const banner = !item.orderDeadline ? ""
    : closed ? '<p class="fa-deadline fa-deadline-closed">🔒 Bestellen is afgesloten sinds ' + esc(deadlineLabel(item.orderDeadline)) + '. Wil je toch nog iets wijzigen? Vraag het aan de organisatie.</p>'
    : '<p class="fa-deadline' + (left <= 3 ? " fa-deadline-soon" : "") + '">⏰ Bestellen kan nog tot ' + esc(deadlineLabel(item.orderDeadline)) + (left <= 1 ? " — laatste kans!" : " (nog " + left + " dagen)") + '.</p>';
  if (!catalog.length) return '<p class="fa-empty">Er zijn nog geen producten om te bestellen.</p>';
  if (!members.length) return '<p class="fa-empty">Voeg eerst jullie gezinsleden toe via <button type="button" class="fa-inline-link" data-tab-target="family">Gezin</button>.</p>';
  const familyTotal = members.reduce((sum, person) => sum + portionsOf(person), 0);
  const productCards = catalog.map(product => {
    const count = members.reduce((sum, person) => sum + (Number(person.orders?.[product.id]) || 0), 0);
    return '<article class="fa-product' + (count ? " fa-product-active" : "") + '"><div class="fa-product-image">' +
      (product.image ? '<img src="' + esc(product.image) + '" alt="" loading="lazy">' : '<span aria-hidden="true">🍖</span>') +
      (count ? '<span class="fa-product-badge" aria-hidden="true">✓ ' + count + '</span>' : "") +
      '</div><div><strong>' + esc(product.name) + '</strong><small>' + (count ? "✓ " + count + " besteld" : "Nog niet besteld") + '</small></div></article>';
  }).join("");
  const people = members.map(person => {
    const controls = catalog.map(product => {
      const quantity = Number(person.orders?.[product.id]) || 0;
      return '<div class="fa-stepper-row' + (quantity ? " fa-stepper-row-active" : "") + '"><span>' + esc(product.name) + '</span>' + (readOnly ? '<b>' + quantity + '</b>'
        : '<div class="fa-stepper"><button type="button" data-action="quantity" data-person="' + esc(person.id) + '" data-product="' + esc(product.id) + '" data-delta="-1" aria-label="Eén ' + esc(product.name) + ' minder voor ' + esc(person.name) + '"' + (quantity === 0 ? " disabled" : "") + '>−</button><b aria-live="polite">' + quantity + '</b><button type="button" data-action="quantity" data-person="' + esc(person.id) + '" data-product="' + esc(product.id) + '" data-delta="1" aria-label="Eén ' + esc(product.name) + ' meer voor ' + esc(person.name) + '">+</button></div>') + '</div>';
    }).join("");
    const portions = portionsOf(person);
    const open = view.openPeople ? view.openPeople.has(person.id) : members.length <= 2;
    return '<details class="fa-order-person" data-order-person="' + esc(person.id) + '"' + (open ? " open" : "") + '><summary><span class="fa-avatar">' + esc((person.name || "?").charAt(0).toUpperCase()) + '</span><span class="fa-member-name"><strong>' + esc(person.name) + '</strong><small>' + esc(typeLabel(person.type)) + '<span class="fa-portions-inline"> · ' + plural(portions, UNITS.meat) + '</span></small></span><span class="fa-pill">' + plural(portions, UNITS.meat) + '</span>' + memberCostTotal(item, person) + '</summary><div class="fa-steppers">' + controls + '</div></details>';
  }).join("");
  return banner + '<div class="fa-section-head"><h3>Jullie vleesbestelling</h3><p>Totaal voor het gezin: <strong>' + plural(familyTotal, UNITS.meat) + '</strong>. Het vlees wordt verrekend volgens het aantal porties.</p></div>' +
    '<div class="fa-products">' + productCards + '</div>' +
    '<div class="fa-section-head"><h3>Per gezinslid</h3><p>Tik op een naam om de bestelling te openen. Wijzigingen worden meteen bewaard.</p></div>' +
    '<div class="fa-list">' + people + '</div>';
}

function categoryExplanation(category) {
  const unit = UNITS[category.method] || ["deel", "delen"];
  if (category.personal) return "Persoonlijke barrekening, na het feest berekend door de organisatie: " + (category.perMember || []).map(member => member.name + " " + euro(member.cents)).join(" · ") + ".";
  if (!category.totalUnits) return "Nog niemand komt in aanmerking voor deze kost.";
  const share = category.familyUnits / category.totalUnits;
  if (category.method === "meat") {
    return "In totaal zijn er " + plural(category.totalUnits, unit) + " besteld. Jullie bestelden er " + category.familyUnits + ": dat is " + percentFormat.format(share) + " van de vleeskost.";
  }
  if (category.method === "adults") {
    return "Verdeeld over " + plural(category.totalUnits, unit) + ". Jullie tellen " + plural(category.familyUnits, unit) + " (" + percentFormat.format(share) + "). Kinderen betalen hier niet mee.";
  }
  return "Verdeeld over alle " + plural(category.totalUnits, unit) + ", ook kinderen. Jullie zijn met " + category.familyUnits + " (" + percentFormat.format(share) + ").";
}

function renderOwnCosts(item, view) {
  if (item.accessRole === "viewer" || item.editionStatus === "archived") return "";
  const finance = item.finance;
  const own = (finance?.expenses || []).filter(expense => expense.advancedByUs);
  const form = (expense = null) => '<form class="fa-expense-form" data-family-expense="' + esc(expense?.id || "") + '">' +
    '<label class="fa-label">Wat betaalden jullie?<input name="description" maxlength="120" value="' + esc(expense?.description || "") + '" placeholder="Bv. drank, decoratie, brood" required></label>' +
    '<div class="fa-add-grid"><label class="fa-label">Bedrag (€)<input name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" value="' + (expense ? (expense.amountCents / 100).toFixed(2) : "") + '" required></label>' +
    '<label class="fa-label">Datum<input name="date" type="date" value="' + esc(expense?.date || new Date().toISOString().slice(0, 10)) + '" required></label></div>' +
    '<label class="fa-label">Wie betaalt mee?<select name="method">' + METHOD_CHOICES.map(([value, label]) => '<option value="' + value + '"' + ((expense?.method || "general") === value ? " selected" : "") + '>' + esc(label) + '</option>').join("") + '</select></label>' +
    '<label class="fa-label fa-receipt-field">' + (expense?.receipt ? "Nieuw kasticket (optioneel)" : "Foto van het kasticket (verplicht)") + '<input name="receipt" type="file" accept="image/*,application/pdf"' + (expense?.receipt ? "" : " required") + '><small>Neem een foto of kies een PDF. Zonder kasticket kan een kost niet worden ingediend.</small></label>' +
    (expense?.receipt ? '<a class="fa-inline-link" href="' + receiptUrl(expense.receipt) + '" target="_blank" rel="noopener">📎 Huidig kasticket bekijken</a>' : "") +
    '<div class="fa-row-actions"><button type="submit" class="fa-btn fa-btn-primary">' + (expense ? "Bewaren" : "Kost toevoegen") + '</button>' + (expense ? '<button type="button" class="fa-btn" data-action="cancel-edit-expense">Annuleren</button>' : "") + '</div></form>';
  const rows = own.map(expense => view.editingExpenseId === expense.id ? '<li>' + form(expense) + '</li>'
    : '<li><span><strong>' + esc(expense.description) + '</strong><small>' + esc(formatDate(expense.date)) + ' · ' + esc((COST_LABELS[expense.method] || "")) + (expense.enteredByFamily ? "" : " · ingevoerd door de organisatie") + '</small>' + (expense.receipt ? '<a class="fa-inline-link" href="' + receiptUrl(expense.receipt) + '" target="_blank" rel="noopener">📎 Kasticket</a>' : "") + '</span><span class="fa-own-end"><b>' + euro(expense.amountCents) + '</b>' +
      (expense.enteredByFamily ? '<button type="button" class="fa-btn fa-btn-small" data-action="edit-expense" data-id="' + esc(expense.id) + '">Wijzigen</button><button type="button" class="fa-btn fa-btn-small fa-btn-quiet" data-action="delete-expense" data-id="' + esc(expense.id) + '">Verwijderen</button>' : "") + '</span></li>').join("");
  return '<div class="fa-section-head"><h3>Kosten die jullie betaalden</h3><p>Schoten jullie iets voor (cash)? Voeg het hier toe. Het wordt verdeeld over alle deelnemers en verrekend in jullie afrekening. De organisatie kan het nog aanpassen.</p></div>' +
    (rows ? '<ul class="fa-own-costs">' + rows + '</ul>' : "") +
    (view.editingExpenseId ? "" : '<details class="fa-add-cost"' + (view.addCostOpen ? " open" : "") + '><summary>+ Kost toevoegen</summary>' + form() + '</details>');
}

const receiptUrl = key => "/api/family-account/receipts?key=" + encodeURIComponent(key);
const COST_LABELS = { general: "Algemeen", adults: "18+", meat: "Vlees", bar: "Bar" };

function renderCosts(item, view = {}) {
  const finance = item.finance;
  if (!finance) return '<p class="fa-empty">Voor dit evenement is nog geen kostenoverzicht beschikbaar.</p>';
  if (!finance.expenses.length) return settlementHero(finance) + renderOwnCosts(item, view);
  const t = finance.totals;
  const categories = finance.categories.map(category => {
    const lines = category.personal
      ? (category.perMember || []).map(member => '<li><span>' + esc(member.name) + '</span><span class="fa-amounts"><small></small><b>' + euro(member.cents) + '</b></span></li>').join("")
      : finance.expenses.filter(expense => expense.method === category.method).map(expense =>
      '<li><span>' + esc(expense.description) + (expense.date ? ' <small>' + esc(formatDate(expense.date)) + '</small>' : "") + (expense.advancedByUs ? ' <em class="fa-tag">voorgeschoten door jullie</em>' : "") + '</span><span class="fa-amounts"><small>' + euro(expense.amountCents) + '</small><b>' + euro(expense.familyCents) + '</b></span></li>'
    ).join("");
    const head = category.personal ? '<li class="fa-cost-lines-head"><span>Persoon</span><span class="fa-amounts"><small></small><b>Barrekening</b></span></li>' : '<li class="fa-cost-lines-head"><span>Kost</span><span class="fa-amounts"><small>Totaal</small><b>Jullie deel</b></span></li>';
    return '<article class="fa-cost-card"><header><span class="fa-cost-icon" aria-hidden="true">' + (METHOD_ICON[category.method] || "€") + '</span><div><h4>' + esc(category.label) + '</h4><small>' + esc(category.appliesTo) + '</small></div><strong>' + euro(category.familyCents) + '</strong></header>' +
      '<p class="fa-explain">' + esc(categoryExplanation(category)) + '</p>' +
      '<ul class="fa-cost-lines">' + head + lines + '</ul></article>';
  }).join("");

  const methods = finance.categories.map(category => category.method);
  const members = finance.members.map(member => {
    const parts = methods.map(method => {
      const label = { general: "Algemeen", adults: "18+", meat: "Vlees", bar: "Bar" }[method];
      const notApplicable = method === "adults" && member.type !== "Volwassene";
      const extra = method === "meat" ? " · " + plural(member.portions, UNITS.meat) : "";
      return '<li><span>' + label + extra + '</span><b>' + (notApplicable ? '<span class="fa-muted">n.v.t. (kind)</span>' : euro(member.byMethod[method])) + '</b></li>';
    }).join("");
    return '<article class="fa-member-cost"><header><span class="fa-avatar">' + esc((member.name || "?").charAt(0).toUpperCase()) + '</span><div class="fa-member-name"><strong>' + esc(member.name) + '</strong><small>' + esc(typeLabel(member.type)) + '</small></div><strong>' + euro(member.totalCents) + '</strong></header><ul>' + parts + '</ul></article>';
  }).join("");

  const settlementRows = [
    '<li><span>Ons aandeel in de kosten</span><b>' + euro(t.shareCents) + '</b></li>',
    t.advancedCents ? '<li><span>Min: door jullie voorgeschoten</span><b>− ' + euro(t.advancedCents) + '</b></li>' : "",
    t.paidCents ? '<li><span>Min: al betaald</span><b>− ' + euro(t.paidCents) + '</b></li>' : "",
    t.refundedCents ? '<li><span>Al terugbetaald aan jullie</span><b>' + euro(t.refundedCents) + '</b></li>' : "",
    t.remainingCents > 0 ? '<li class="fa-settle-total fa-due"><span>Nog te betalen</span><b>' + euro(t.remainingCents) + '</b></li>'
      : t.creditCents > 0 ? '<li class="fa-settle-total fa-credit"><span>Jullie krijgen terug</span><b>' + euro(t.creditCents) + '</b></li>'
      : '<li class="fa-settle-total fa-ok"><span>Saldo</span><b>' + euro(0) + '</b></li>'
  ].join("");
  const payments = finance.payments.length
    ? '<ul class="fa-payments">' + finance.payments.map(payment => '<li><span>' + (payment.kind === "refund" ? "Terugbetaald aan jullie · " : "Betaald · ") + esc(formatDate(payment.date) || "") + ' · ' + (payment.method === "cash" ? "cash" : "overschrijving") + '</span><b>' + (payment.kind === "refund" ? "+ " : "") + euro(payment.amountCents) + '</b></li>').join("") + '</ul>'
    : "";

  return '<div class="fa-section-head"><h3>1. Kosten van het evenement</h3><p>Per soort kost: het totaal en het deel dat jullie gezin draagt.</p></div>' + categories +
    '<div class="fa-section-head"><h3>2. Per gezinslid</h3><p>Opgeteld vormen deze bedragen exact jullie gezinsaandeel.</p></div><div class="fa-member-costs">' + members + '</div>' +
    '<div class="fa-section-head"><h3>3. Afrekening</h3><p>' + (finance.finalized ? "Definitief: alle kosten zijn bevestigd." : "Voorlopig: er kunnen nog kosten bijkomen.") + '</p></div>' +
    '<ul class="fa-settlement">' + settlementRows + '</ul>' + payments + renderOwnCosts(item, view);
}

export function renderEvent(item, view) {
  const tab = TABS.some(entry => entry.id === view.tab) ? view.tab : "overview";
  const body = tab === "family" ? renderFamily(item, view) : tab === "order" ? renderOrder(item, view) : tab === "costs" ? renderCosts(item, view) : renderOverview(item);
  return '<section class="fa-event" data-registration="' + esc(item.registration.id) + '">' +
    '<header class="fa-event-head"><div><p class="fa-eyebrow">' + esc(item.event || "Evenement") + (item.editionLabel ? " · " + esc(item.editionLabel) : "") + '</p><h2>' + esc(item.registration.name || "Jullie inschrijving") + '</h2></div><div class="fa-head-chips">' + countdownChip(item) + statusChip(item.finance) + '</div></header>' +
    '<nav class="fa-tabs" role="tablist" aria-label="Onderdelen">' + TABS.map(entry => '<button type="button" role="tab" data-tab="' + entry.id + '" aria-selected="' + (entry.id === tab) + '">' + entry.label + '</button>').join("") + '</nav>' +
    '<div class="fa-tab-body" role="tabpanel">' + body + '</div></section>';
}

function renderOpenEditions(openEditions = []) {
  return openEditions.map(open => '<section class="fa-open"><div><p class="fa-eyebrow">' + esc(open.event) + '</p><h2>Inschrijven voor ' + esc(open.event) + ' ' + esc(open.editionLabel) + '</h2><p>' + esc(open.familyName) + ' is nog niet ingeschreven. De gezinsleden van jullie vorige inschrijving worden overgenomen; daarna kies je zelf de bestelling.</p></div><button type="button" class="fa-btn fa-btn-primary" data-action="self-register" data-edition="' + esc(open.edition) + '" data-family="' + esc(open.familyId) + '">Inschrijven</button></section>').join("");
}

export function renderAccount({ user, items, activeId, view, openEditions = [] }) {
  const name = user?.displayName || "";
  const top = '<header class="fa-top"><div><p class="fa-eyebrow">Familieportaal</p><h1>' + (name ? "Hallo, " + esc(name) : "Welkom") + '</h1>' + (user?.email ? '<small>' + esc(user.email) + '</small>' : "") + '</div><button type="button" class="fa-btn fa-btn-quiet" data-action="logout">Afmelden</button></header>';
  if (!items.length) return top + (renderOpenEditions(openEditions) || '<p class="fa-empty">Je account is actief, maar er is nog geen inschrijving aan gekoppeld. Neem contact op met de organisatie als je dit niet verwacht.</p>');
  const active = items.find(item => item.registration.id === activeId) || items[0];
  const switcher = items.length > 1
    ? '<nav class="fa-switch" aria-label="Evenementen">' + items.map(item => '<button type="button" data-switch-registration="' + esc(item.registration.id) + '" aria-pressed="' + (item === active) + '"><strong>' + esc(item.event || "Evenement") + '</strong><small>' + esc(item.editionLabel || "") + '</small></button>').join("") + '</nav>'
    : "";
  return top + renderOpenEditions(openEditions) + switcher + renderEvent(active, view);
}
