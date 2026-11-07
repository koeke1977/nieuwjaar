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
const typeLabel = type => type === "Kind" ? "Kind" : type === "Volwassene" ? "Volwassene (18+)" : "Deelnemer";

export const TABS = [
  { id: "overview", label: "Overzicht" },
  { id: "family", label: "Gezin" },
  { id: "order", label: "Bestelling" },
  { id: "costs", label: "Kosten" }
];

const UNITS = { general: ["persoon", "personen"], adults: ["volwassene", "volwassenen"], meat: ["portie", "porties"] };
const METHOD_ICON = { general: "👥", adults: "🥂", meat: "🍖" };

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
  return settlementHero(finance) +
    '<div class="fa-stats">' +
      '<button type="button" class="fa-stat" data-tab-target="family"><strong>' + members.length + '</strong><small>' + (members.length === 1 ? "deelnemer" : "deelnemers") + '</small><em>' + adults + ' volw. · ' + (members.length - adults) + ' kind.</em></button>' +
      '<button type="button" class="fa-stat" data-tab-target="order"><strong>' + portions + '</strong><small>vleesporties</small><em>Bestelling aanpassen</em></button>' +
      '<button type="button" class="fa-stat" data-tab-target="costs"><strong>' + euro(finance?.totals?.shareCents || 0) + '</strong><small>ons aandeel</small><em>Bekijk de berekening</em></button>' +
    '</div>' +
    (members.length ? "" : '<p class="fa-empty">Voeg eerst jullie gezinsleden toe via <button type="button" class="fa-inline-link" data-tab-target="family">Gezin</button>.</p>');
}

function renderFamily(item, view) {
  const members = item.registration.members || [];
  const readOnly = item.accessRole === "viewer";
  const rows = members.map((person, index) => {
    if (!readOnly && view.editingMemberId === person.id) {
      return '<form class="fa-member fa-member-edit" data-edit-member="' + esc(person.id) + '">' +
        '<input name="memberName" aria-label="Naam" value="' + esc(person.name) + '" maxlength="80" required>' +
        '<select name="memberType" aria-label="Categorie"><option value="Volwassene"' + (person.type === "Volwassene" ? " selected" : "") + '>Volwassene (18+)</option><option value="Kind"' + (person.type === "Kind" ? " selected" : "") + '>Kind</option></select>' +
        '<div class="fa-row-actions"><button type="submit" class="fa-btn fa-btn-primary">Bewaren</button><button type="button" class="fa-btn" data-action="cancel-edit-member">Annuleren</button></div></form>';
    }
    return '<div class="fa-member"><span class="fa-avatar">' + esc((person.name || "?").charAt(0).toUpperCase()) + '</span>' +
      '<div class="fa-member-name"><strong>' + esc(person.name) + '</strong><small>' + esc(typeLabel(person.type)) + '</small></div>' +
      (readOnly ? "" : '<div class="fa-row-actions"><button type="button" class="fa-btn fa-btn-small" data-action="edit-member" data-person="' + esc(person.id) + '">Wijzigen</button>' +
        (members.length > 1 ? '<button type="button" class="fa-btn fa-btn-small fa-btn-quiet" data-action="remove-member" data-index="' + index + '" aria-label="' + esc(person.name) + ' verwijderen">Verwijderen</button>' : "") + '</div>') +
      '</div>';
  }).join("");
  return '<div class="fa-section-head"><h3>Wie komt er?</h3><p>Volwassenen (18+) delen ook in de kosten die alleen voor volwassenen zijn. Kinderen betalen die nooit.</p></div>' +
    '<div class="fa-list">' + (rows || '<p class="fa-empty">Nog geen gezinsleden toegevoegd.</p>') + '</div>' +
    (readOnly ? '<p class="fa-muted">Je hebt leesrechten voor deze inschrijving.</p>'
      : '<form class="fa-add" data-add-member><label class="fa-label" for="fa-new-name">Persoon toevoegen</label><div class="fa-add-grid"><input id="fa-new-name" name="memberName" placeholder="Voornaam en naam" maxlength="80" required><select name="memberType" aria-label="Categorie"><option value="Volwassene">Volwassene (18+)</option><option value="Kind">Kind</option></select><button type="submit" class="fa-btn fa-btn-primary">+ Toevoegen</button></div></form>');
}

function renderOrder(item, view) {
  const members = item.registration.members || [];
  const catalog = item.catalog || [];
  const readOnly = item.accessRole === "viewer";
  if (!catalog.length) return '<p class="fa-empty">Er zijn nog geen producten om te bestellen.</p>';
  if (!members.length) return '<p class="fa-empty">Voeg eerst jullie gezinsleden toe via <button type="button" class="fa-inline-link" data-tab-target="family">Gezin</button>.</p>';
  const familyTotal = members.reduce((sum, person) => sum + portionsOf(person), 0);
  const productCards = catalog.map(product => {
    const count = members.reduce((sum, person) => sum + (Number(person.orders?.[product.id]) || 0), 0);
    return '<article class="fa-product' + (count ? " fa-product-active" : "") + '"><div class="fa-product-image">' +
      (product.image ? '<img src="' + esc(product.image) + '" alt="" loading="lazy">' : '<span aria-hidden="true">🍖</span>') +
      '</div><div><strong>' + esc(product.name) + '</strong><small>' + (count ? count + " besteld" : "Nog niet besteld") + '</small></div></article>';
  }).join("");
  const people = members.map(person => {
    const controls = catalog.map(product => {
      const quantity = Number(person.orders?.[product.id]) || 0;
      return '<div class="fa-stepper-row"><span>' + esc(product.name) + '</span>' + (readOnly ? '<b>' + quantity + '</b>'
        : '<div class="fa-stepper"><button type="button" data-action="quantity" data-person="' + esc(person.id) + '" data-product="' + esc(product.id) + '" data-delta="-1" aria-label="Eén ' + esc(product.name) + ' minder voor ' + esc(person.name) + '"' + (quantity === 0 ? " disabled" : "") + '>−</button><b aria-live="polite">' + quantity + '</b><button type="button" data-action="quantity" data-person="' + esc(person.id) + '" data-product="' + esc(product.id) + '" data-delta="1" aria-label="Eén ' + esc(product.name) + ' meer voor ' + esc(person.name) + '">+</button></div>') + '</div>';
    }).join("");
    const portions = portionsOf(person);
    const open = view.openPeople ? view.openPeople.has(person.id) : members.length <= 2;
    return '<details class="fa-order-person" data-order-person="' + esc(person.id) + '"' + (open ? " open" : "") + '><summary><span class="fa-avatar">' + esc((person.name || "?").charAt(0).toUpperCase()) + '</span><span class="fa-member-name"><strong>' + esc(person.name) + '</strong><small>' + esc(typeLabel(person.type)) + '</small></span><span class="fa-pill">' + plural(portions, UNITS.meat) + '</span></summary><div class="fa-steppers">' + controls + '</div></details>';
  }).join("");
  return '<div class="fa-section-head"><h3>Jullie vleesbestelling</h3><p>Totaal voor het gezin: <strong>' + plural(familyTotal, UNITS.meat) + '</strong>. Het vlees wordt verrekend volgens het aantal porties.</p></div>' +
    '<div class="fa-products">' + productCards + '</div>' +
    '<div class="fa-section-head"><h3>Per gezinslid</h3><p>Tik op een naam om de bestelling te openen. Wijzigingen worden meteen bewaard.</p></div>' +
    '<div class="fa-list">' + people + '</div>';
}

function categoryExplanation(category) {
  const unit = UNITS[category.method] || ["deel", "delen"];
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

function renderCosts(item) {
  const finance = item.finance;
  if (!finance) return '<p class="fa-empty">Voor dit evenement is nog geen kostenoverzicht beschikbaar.</p>';
  if (!finance.expenses.length) return settlementHero(finance);
  const t = finance.totals;
  const categories = finance.categories.map(category => {
    const lines = finance.expenses.filter(expense => expense.method === category.method).map(expense =>
      '<li><span>' + esc(expense.description) + (expense.date ? ' <small>' + esc(formatDate(expense.date)) + '</small>' : "") + (expense.advancedByUs ? ' <em class="fa-tag">voorgeschoten door jullie</em>' : "") + '</span><span class="fa-amounts"><small>' + euro(expense.amountCents) + '</small><b>' + euro(expense.familyCents) + '</b></span></li>'
    ).join("");
    return '<article class="fa-cost-card"><header><span class="fa-cost-icon" aria-hidden="true">' + (METHOD_ICON[category.method] || "€") + '</span><div><h4>' + esc(category.label) + '</h4><small>' + esc(category.appliesTo) + '</small></div><strong>' + euro(category.familyCents) + '</strong></header>' +
      '<p class="fa-explain">' + esc(categoryExplanation(category)) + '</p>' +
      '<ul class="fa-cost-lines"><li class="fa-cost-lines-head"><span>Kost</span><span class="fa-amounts"><small>Totaal</small><b>Jullie deel</b></span></li>' + lines + '</ul></article>';
  }).join("");

  const methods = finance.categories.map(category => category.method);
  const members = finance.members.map(member => {
    const parts = methods.map(method => {
      const label = { general: "Algemeen", adults: "18+", meat: "Vlees" }[method];
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
    t.remainingCents > 0 ? '<li class="fa-settle-total fa-due"><span>Nog te betalen</span><b>' + euro(t.remainingCents) + '</b></li>'
      : t.creditCents > 0 ? '<li class="fa-settle-total fa-credit"><span>Jullie krijgen terug</span><b>' + euro(t.creditCents) + '</b></li>'
      : '<li class="fa-settle-total fa-ok"><span>Saldo</span><b>' + euro(0) + '</b></li>'
  ].join("");
  const payments = finance.payments.length
    ? '<ul class="fa-payments">' + finance.payments.map(payment => '<li><span>' + esc(formatDate(payment.date) || "Betaling") + ' · ' + (payment.method === "cash" ? "cash" : payment.method === "bank" ? "overschrijving" : "betaling") + '</span><b>' + euro(payment.amountCents) + '</b></li>').join("") + '</ul>'
    : "";

  return '<div class="fa-section-head"><h3>1. Kosten van het evenement</h3><p>Per soort kost: het totaal en het deel dat jullie gezin draagt.</p></div>' + categories +
    '<div class="fa-section-head"><h3>2. Per gezinslid</h3><p>Opgeteld vormen deze bedragen exact jullie gezinsaandeel.</p></div><div class="fa-member-costs">' + members + '</div>' +
    '<div class="fa-section-head"><h3>3. Afrekening</h3><p>' + (finance.finalized ? "Definitief: alle kosten zijn bevestigd." : "Voorlopig: er kunnen nog kosten bijkomen.") + '</p></div>' +
    '<ul class="fa-settlement">' + settlementRows + '</ul>' + payments;
}

export function renderEvent(item, view) {
  const tab = TABS.some(entry => entry.id === view.tab) ? view.tab : "overview";
  const body = tab === "family" ? renderFamily(item, view) : tab === "order" ? renderOrder(item, view) : tab === "costs" ? renderCosts(item) : renderOverview(item);
  return '<section class="fa-event" data-registration="' + esc(item.registration.id) + '">' +
    '<header class="fa-event-head"><div><p class="fa-eyebrow">' + esc(item.event || "Evenement") + (item.editionLabel ? " · " + esc(item.editionLabel) : "") + '</p><h2>' + esc(item.registration.name || "Jullie inschrijving") + '</h2></div>' + statusChip(item.finance) + '</header>' +
    '<nav class="fa-tabs" role="tablist" aria-label="Onderdelen">' + TABS.map(entry => '<button type="button" role="tab" data-tab="' + entry.id + '" aria-selected="' + (entry.id === tab) + '">' + entry.label + '</button>').join("") + '</nav>' +
    '<div class="fa-tab-body" role="tabpanel">' + body + '</div></section>';
}

export function renderAccount({ user, items, activeId, view }) {
  const name = user?.displayName || "";
  const top = '<header class="fa-top"><div><p class="fa-eyebrow">Familieportaal</p><h1>' + (name ? "Hallo, " + esc(name) : "Welkom") + '</h1>' + (user?.email ? '<small>' + esc(user.email) + '</small>' : "") + '</div><button type="button" class="fa-btn fa-btn-quiet" data-action="logout">Afmelden</button></header>';
  if (!items.length) return top + '<p class="fa-empty">Je account is actief, maar er is nog geen inschrijving aan gekoppeld. Neem contact op met de organisatie als je dit niet verwacht.</p>';
  const active = items.find(item => item.registration.id === activeId) || items[0];
  const switcher = items.length > 1
    ? '<nav class="fa-switch" aria-label="Evenementen">' + items.map(item => '<button type="button" data-switch-registration="' + esc(item.registration.id) + '" aria-pressed="' + (item === active) + '"><strong>' + esc(item.event || "Evenement") + '</strong><small>' + esc(item.editionLabel || "") + '</small></button>').join("") + '</nav>'
    : "";
  return top + switcher + renderEvent(active, view);
}
