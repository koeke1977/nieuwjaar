import { html, joinHtml, euro, plural, formatDate } from "../../utils/html.js";
import { COST_SHORT, COST_ICON } from "../../utils/finance.js";
// Rendering of the signed-in family portal. Pure functions: data in, HTML string out.
// All figures come from the server-side finance breakdown (amounts in cents).

const percentFormat = new Intl.NumberFormat("nl-BE", { style: "percent", maximumFractionDigits: 1 });
const portionsOf = person => Object.values(person?.orders || {}).reduce((sum, qty) => sum + (Number(qty) || 0), 0);
import { DIET_OPTIONS, NOTE_MAX, hasDiet } from "../../utils/diet.js";
import { countdownState, formatEventDate } from "./countdown.js";
import { ordersClosed, localToDate } from "../../utils/time.js";

const deadlineLabel = deadline => {
  const date = deadline ? localToDate(deadline) : null;
  return date
    ? date.toLocaleDateString("nl-BE", {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: "Europe/Brussels"
      }) +
        " om " +
        date.toLocaleTimeString("nl-BE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" })
    : "";
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
  const clock = p
    ? html`<div class="fa-count-clock" aria-hidden="true">${joinHtml(
        [
          [p.days, "dagen"],
          [p.hours, "uur"],
          [p.minutes, "min"],
          [p.seconds, "sec"]
        ].map(
          ([n, label], i) =>
            html`<span>
                <b data-count-part="${i}">${String(n).padStart(i ? 2 : 1, "0")}</b>
                <small>${label}</small>
              </span>`
        ),
        ""
      )}</div>`
    : "";
  return html`<section class="fa-countdown fa-countdown-${state.phase}" data-countdown="${item.startsAt}"
      data-countdown-event="${item.event || "het feest"}">
        <p class="fa-eyebrow">${formatEventDate(item.startsAt)}</p>
        <h3 data-count-text>${state.text}</h3>${clock}</section>`;
}
function countdownChip(item) {
  const state = countdownState(item.startsAt, item.event || "het feest");
  return state && state.phase !== "over"
    ? html`<span class="fa-chip fa-chip-count" data-countdown-chip="${item.startsAt}">${state.short}</span>`
    : "";
}
const dietChips = person =>
  hasDiet(person)
    ? html`<div class="fa-diet">${joinHtml(
        (person.diet || []).map(item => html`<span>${item}</span>`),
        ""
      )}${person.notes ? html`<em>${person.notes}</em>` : ""}</div>`
    : "";
const METHOD_CHOICES = [
  ["general", "Algemeen — iedereen, ook kinderen (zaal, decoratie, frisdrank)"],
  ["adults", "18+ — alleen volwassenen (alcohol, cava)"],
  ["meat", "Vlees — volgens bestelde porties"],
  ["bar", "Aankoop voor de bar — wordt niet verdeeld; de barrekeningen dekken het"]
];
import { typeLabel, typeOptions, countByType, EVENING } from "../../utils/member-types.js";

export const TABS = [
  { id: "overview", label: "Overzicht" },
  { id: "family", label: "Gezin" },
  { id: "order", label: "Bestelling" },
  { id: "costs", label: "Kosten" }
];

const UNITS = {
  general: ["persoon", "personen"],
  adults: ["volwassene", "volwassenen"],
  meat: ["portie", "porties"],
  bar: ["persoon", "personen"]
};

function statusChip(finance) {
  if (!finance) return "";
  return finance.finalized
    ? html`<span class="fa-chip fa-chip-final">Definitief</span>`
    : html`<span class="fa-chip fa-chip-provisional">Voorlopig</span>`;
}

// The single most important answer for a family: what do we still owe or get back?
function settlementHero(finance) {
  if (!finance || !finance.expenses?.length) {
    return html`<div class="fa-hero fa-hero-neutral">
        <small>Afrekening</small>
        <strong>Nog geen kosten</strong>
        <p>Zodra de organisatie kosten invoert, zie je hier meteen jullie aandeel.</p>
      </div>`;
  }
  const t = finance.totals;
  const note = finance.finalized
    ? "Alle kosten zijn bevestigd door de organisatie."
    : "Voorlopig bedrag: er kunnen nog kosten bijkomen.";
  if (t.remainingCents > 0) {
    return html`<div class="fa-hero fa-hero-due">
          <small>Nog te betalen</small>
          <strong>${euro(t.remainingCents)}</strong>
          <p>${note}</p>
        </div>`;
  }
  if (t.creditCents > 0) {
    return html`<div class="fa-hero fa-hero-credit">
          <small>Jullie krijgen terug</small>
          <strong>${euro(t.creditCents)}</strong>
          <p>Jullie schoten meer voor dan jullie aandeel. ${note}</p>
        </div>`;
  }
  return html`<div class="fa-hero fa-hero-ok">
        <small>Afrekening</small>
        <strong>Alles in orde</strong>
        <p>Er staat niets meer open. ${note}</p>
      </div>`;
}

function renderOverview(item) {
  const members = item.registration.members || [];
  const finance = item.finance;
  const portions = members.reduce((sum, person) => sum + portionsOf(person), 0);
  const kinds = countByType(members);
  return html`${settlementHero(finance)}${countdownCard(item)}<div class="fa-stats">
        <button type="button" class="fa-stat" data-tab-target="family" aria-label="Gezin bekijken">
          <span class="fa-stat-icon" aria-hidden="true">👨‍👩‍👧</span>
          <strong>${members.length}</strong>
          <small>${members.length === 1 ? "deelnemer" : "deelnemers"} · ${kinds.adults} volw.
              · ${kinds.children} kind.${kinds.evening ? " · " + kinds.evening + " avondg." : ""}</small>
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
      </div>${
        members.length
          ? ""
          : html`<p class="fa-empty">Voeg eerst jullie gezinsleden toe via <button type="button" class="fa-inline-link"
              data-tab-target="family">Gezin</button>.</p>`
      }`;
}

// Per-person cost from the server breakdown; null while a new person is not yet saved.
function memberCost(item, personId) {
  const finance = item.finance;
  if (!finance?.expenses?.length) return null;
  return finance.members.find(member => member.id === personId) || null;
}

function memberCostDetail(item, person) {
  const cost = memberCost(item, person.id);
  if (!cost) return "";
  const parts = joinHtml(
    item.finance.categories
      .map(category => {
        if (category.method === "adults" && person.type !== "Volwassene") return "";
        if (person.type === EVENING && category.method !== "bar") return "";
        return html`<span>${COST_SHORT[category.method]} <b>${euro(cost.byMethod[category.method])}</b>
        </span>`;
      })
      .filter(Boolean),
    ""
  );
  return parts ? html`<div class="fa-cost-parts">${parts}</div>` : "";
}

function memberCostTotal(item, person) {
  const cost = memberCost(item, person.id);
  if (!item.finance?.expenses?.length) return "";
  return html`<strong class="fa-member-total">${cost ? euro(cost.totalCents) : "…"}</strong>`;
}

function renderFamily(item, view) {
  const members = item.registration.members || [];
  const readOnly = item.accessRole === "viewer";
  const hasCosts = Boolean(item.finance?.expenses?.length);
  const rows = joinHtml(
    members.map((person, index) => {
      if (!readOnly && view.editingMemberId === person.id) {
        return html`<form class="fa-member fa-member-edit" data-edit-member="${person.id}">
              <input name="memberName" aria-label="Naam" value="${person.name}" maxlength="80" required>
              <select name="memberType" aria-label="Categorie">${typeOptions(person.type)}</select>
              <fieldset class="fa-diet-edit">
                <legend>Allergieën en voorkeuren</legend>${joinHtml(
                  DIET_OPTIONS.map(
                    option =>
                      html`<label>
                  <input type="checkbox" name="diet"
                      value="${option}"${(person.diet || []).includes(option) ? " checked" : ""}> ${option}</label>`
                  ),
                  ""
                )}</fieldset>
              <input name="notes" aria-label="Opmerking" maxlength="${NOTE_MAX}" value="${person.notes || ""}"
                  placeholder="Opmerking, bv. geen pikant, notenallergie (ernstig)">
              <div class="fa-row-actions">
                <button type="submit" class="fa-btn fa-btn-primary">Bewaren</button>
                <button type="button" class="fa-btn" data-action="cancel-edit-member">Annuleren</button>
              </div>
            </form>`;
      }
      return html`<div class="fa-member">
            <span class="fa-avatar">${(person.name || "?").charAt(0).toUpperCase()}</span>
            <div class="fa-member-name">
              <strong>${person.name}</strong>
              <small>${typeLabel(person.type)} · ${plural(portionsOf(person), UNITS.meat)}</small>${dietChips(person)}${memberCostDetail(item, person)}</div>${memberCostTotal(item, person)}${
                readOnly
                  ? ""
                  : html`<div class="fa-row-actions">
              <button type="button" class="fa-btn fa-btn-small" data-action="edit-member"
                  data-person="${person.id}">Wijzigen</button>${
                    members.length > 1
                      ? html`<button type="button" class="fa-btn fa-btn-small fa-btn-quiet" data-action="remove-member"
                      data-index="${index}" aria-label="${person.name} verwijderen">Verwijderen</button>`
                      : ""
                  }</div>`
              }</div>`;
    }),
    ""
  );
  const familyTotal = hasCosts
    ? html`<div class="fa-family-total">
        <span>Totaal voor het gezin${item.finance.finalized ? "" : html` <small>(voorlopig)</small>`}</span>
        <strong>${euro(item.finance.totals.shareCents)}</strong>
      </div>`
    : "";
  return html`<div class="fa-section-head">
        <h3>Wie komt er?</h3>
        <p>Per persoon zie je wat die kost: vlees volgens de eigen bestelling, algemene kosten voor iedereen en
            18+-kosten alleen voor volwassenen. Komt iemand pas na het eten? Kies dan <strong>Avondgast</strong>: die
            betaalt alleen zijn eigen barrekening.</p>
      </div>
      <div class="fa-list">${
        rows ||
        html`<p class="fa-empty">Nog geen gezinsleden
          toegevoegd.</p>`
      }</div>${familyTotal}${
        readOnly
          ? html`<p class="fa-muted">Je hebt leesrechten voor deze inschrijving.</p>`
          : html`<form class="fa-add" data-add-member>
          <label class="fa-label" for="fa-new-name">Persoon toevoegen</label>
          <div class="fa-add-grid">
            <input id="fa-new-name" name="memberName" placeholder="Voornaam en naam" maxlength="80" required>
            <select name="memberType" aria-label="Categorie">${typeOptions("Volwassene")}</select>
            <button type="submit" class="fa-btn fa-btn-primary">+ Toevoegen</button>
          </div>
        </form>`
      }`;
}

function renderOrder(item, view) {
  const members = item.registration.members || [];
  const catalog = item.catalog || [];
  const closed = item.ordersClosed || ordersClosed(item.orderDeadline);
  const readOnly = item.accessRole === "viewer" || closed;
  const left = daysLeft(item.orderDeadline);
  const banner = !item.orderDeadline
    ? ""
    : closed
      ? html`<p class="fa-deadline fa-deadline-closed">🔒 Bestellen is afgesloten
          sinds ${deadlineLabel(item.orderDeadline)}. Wil je toch nog iets wijzigen? Vraag het aan de organisatie.</p>`
      : html`<p class="fa-deadline${left <= 3 ? " fa-deadline-soon" : ""}">⏰ Bestellen kan nog
          tot ${deadlineLabel(item.orderDeadline)}${left <= 1 ? " — laatste kans!" : " (nog " + left + " dagen)"}.</p>`;
  if (!catalog.length) return html`<p class="fa-empty">Er zijn nog geen producten om te bestellen.</p>`;
  if (!members.length)
    return html`<p class="fa-empty">Voeg eerst jullie gezinsleden toe via <button type="button" class="fa-inline-link"
        data-tab-target="family">Gezin</button>.</p>`;
  const familyTotal = members.reduce((sum, person) => sum + portionsOf(person), 0);
  const productCards = joinHtml(
    catalog.map(product => {
      const count = members.reduce((sum, person) => sum + (Number(person.orders?.[product.id]) || 0), 0);
      return html`<article class="fa-product${count ? " fa-product-active" : ""}">
            <div class="fa-product-image">${
              product.image
                ? html`<img src="${product.image}" alt="" loading="lazy">`
                : html`<span aria-hidden="true">🍖</span>`
            }${count ? html`<span class="fa-product-badge" aria-hidden="true">✓ ${count}</span>` : ""}</div>
            <div>
              <strong>${product.name}</strong>
              <small>${count ? "✓ " + count + " besteld" : "Nog niet besteld"}</small>
            </div>
          </article>`;
    }),
    ""
  );
  const people = joinHtml(
    members.map(person => {
      if (person.type === EVENING) {
        return html`<div class="fa-member fa-member-evening">
              <span class="fa-avatar">${(person.name || "?").charAt(0).toUpperCase()}</span>
              <span class="fa-member-name">
                <strong>${person.name}</strong>
                <small>🌙 Komt na het eten — geen bestelling</small>
              </span>
            </div>`;
      }
      const controls = joinHtml(
        catalog.map(product => {
          const quantity = Number(person.orders?.[product.id]) || 0;
          return html`<div class="fa-stepper-row${quantity ? " fa-stepper-row-active" : ""}">
                <span>${product.name}</span>${
                  readOnly
                    ? html`<b>${quantity}</b>`
                    : html`<div class="fa-stepper">
                  <button type="button" data-action="quantity" data-person="${person.id}" data-product="${product.id}"
                      data-delta="-1" aria-label="Eén ${product.name} minder
                      voor ${person.name}"${quantity === 0 ? " disabled" : ""}>−</button>
                  <b aria-live="polite">${quantity}</b>
                  <button type="button" data-action="quantity" data-person="${person.id}" data-product="${product.id}"
                      data-delta="1" aria-label="Eén ${product.name} meer voor ${person.name}">+</button>
                </div>`
                }</div>`;
        }),
        ""
      );
      const portions = portionsOf(person);
      const open = view.openPeople ? view.openPeople.has(person.id) : members.length <= 2;
      return html`<details class="fa-order-person" data-order-person="${person.id}"${open ? " open" : ""}>
            <summary>
              <span class="fa-avatar">${(person.name || "?").charAt(0).toUpperCase()}</span>
              <span class="fa-member-name">
                <strong>${person.name}</strong>
                <small>${typeLabel(person.type)}<span
                    class="fa-portions-inline"> · ${plural(portions, UNITS.meat)}</span>
                </small>
              </span>
              <span class="fa-pill">${plural(portions, UNITS.meat)}</span>${memberCostTotal(item, person)}</summary>
            <div class="fa-steppers">${controls}</div>
          </details>`;
    }),
    ""
  );
  return html`${banner}<div class="fa-section-head">
        <h3>Jullie vleesbestelling</h3>
        <p>Totaal voor het gezin: <strong>${plural(familyTotal, UNITS.meat)}</strong>. Het vlees wordt verrekend volgens
            het aantal porties.</p>
      </div>
      <div class="fa-products">${productCards}</div>
      <div class="fa-section-head">
        <h3>Per gezinslid</h3>
        <p>Tik op een naam om de bestelling te openen. Wijzigingen worden meteen bewaard.</p>
      </div>
      <div class="fa-list">${people}</div>`;
}

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
              value="${expense?.date || new Date().toISOString().slice(0, 10)}" required>
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

function renderCosts(item, view = {}) {
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

export function renderEvent(item, view) {
  const tab = TABS.some(entry => entry.id === view.tab) ? view.tab : "overview";
  const body =
    tab === "family"
      ? renderFamily(item, view)
      : tab === "order"
        ? renderOrder(item, view)
        : tab === "costs"
          ? renderCosts(item, view)
          : renderOverview(item);
  return html`<section class="fa-event" data-registration="${item.registration.id}">
        <header class="fa-event-head">
          <div>
            <p class="fa-eyebrow">${item.event || "Evenement"}${item.editionLabel ? " · " + item.editionLabel : ""}</p>
            <h2>${item.registration.name || "Jullie inschrijving"}</h2>
          </div>
          <div class="fa-head-chips">${countdownChip(item)}${statusChip(item.finance)}</div>
        </header>
        <nav class="fa-tabs" role="tablist" aria-label="Onderdelen">${joinHtml(
          TABS.map(
            entry =>
              html`<button type="button" role="tab" data-tab="${entry.id}"
                  aria-selected="${entry.id === tab}">${entry.label}</button>`
          ),
          ""
        )}</nav>
        <div class="fa-tab-body" role="tabpanel">${body}</div>
      </section>`;
}

function renderOpenEditions(openEditions = []) {
  return joinHtml(
    openEditions.map(
      open =>
        html`<section class="fa-open">
            <div>
              <p class="fa-eyebrow">${open.event}</p>
              <h2>Inschrijven voor ${open.event} ${open.editionLabel}</h2>
              <p>${open.familyName} is nog niet ingeschreven. De gezinsleden van jullie vorige inschrijving worden
                  overgenomen; daarna kies je zelf de bestelling.</p>
            </div>
            <button type="button" class="fa-btn fa-btn-primary" data-action="self-register"
                data-edition="${open.edition}" data-family="${open.familyId}">Inschrijven</button>
          </section>`
    ),
    ""
  );
}

export function renderAccount({ user, items, activeId, view, openEditions = [] }) {
  const name = user?.displayName || "";
  const top = html`<header class="fa-top">
        <div>
          <p class="fa-eyebrow">Familieportaal</p>
          <h1>${name ? "Hallo, " + name : "Welkom"}</h1>${user?.email ? html`<small>${user.email}</small>` : ""}</div>
        <button type="button" class="fa-btn fa-btn-quiet" data-action="logout">Afmelden</button>
      </header>`;
  if (!items.length)
    return html`${top}${
      renderOpenEditions(openEditions) ||
      html`<p class="fa-empty">Je account is actief, maar er is nog geen inschrijving aan gekoppeld. Neem contact op met
          de organisatie als je dit niet verwacht.</p>`
    }`;
  const active = items.find(item => item.registration.id === activeId) || items[0];
  const switcher =
    items.length > 1
      ? html`<nav class="fa-switch" aria-label="Evenementen">${joinHtml(
          items.map(
            item =>
              html`<button type="button" data-switch-registration="${item.registration.id}"
                  aria-pressed="${item === active}">
                  <strong>${item.event || "Evenement"}</strong>
                  <small>${item.editionLabel || ""}</small>
                </button>`
          ),
          ""
        )}</nav>`
      : "";
  return html`${top}${renderOpenEditions(openEditions)}${switcher}${renderEvent(active, view)}`;
}
