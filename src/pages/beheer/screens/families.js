// Editie → Inschrijvingen: lijst van gezinnen, gezinsdetail, personen bewerken, toegang.
import { state } from "../../../data/admin-store.js";
import { typeLabel, typeOptions, countsText, EVENING } from "../../../utils/member-types.js";
import { html, joinHtml, euro, plural } from "../../../utils/html.js";
import { COST_ICON, getFinancialSummary, getFamilyFinanceBreakdown } from "../../../utils/finance.js";
import {
  allFamilies,
  eventTotals,
  familyPortions,
  familyBalanceChip,
  accessChip,
  pageHead,
  dietFields,
  dietChips,
  portionsOf,
  accountsForFamily,
  paymentLine,
  today,
  refundForm,
  statusChip,
  eventTitle
} from "./shared.js";
import { dash, activeFilter, sortRows, sortHeader, filterBar } from "./table.js";

// ---------------- Gezinnen ----------------
function registerExistingFamily() {
  if (state.editionStatus === "archived")
    return html`<p class="bh-alert bh-alert-info">Deze editie is afgesloten. Je kan ze nog aanpassen, maar nieuwe
        inschrijvingen horen bij de actieve editie.</p>`;
  const registered = new Set((state.registrations || []).map(reg => reg.familyId));
  const options = allFamilies().filter(family => !registered.has(family.id));
  if (!options.length) return "";
  return html`<section class="bh-card">
        <form id="register-family-form" class="bh-inline-form">
          <label for="bh-existing-family">Bestaand gezin inschrijven</label>
          <div>
            <select id="bh-existing-family" name="familyId" required>
              <option value="">Kies een gezin</option>${joinHtml(
                options.map(family => html`<option value="${family.id}">${family.name}</option>`),
                ""
              )}</select>
            <button type="submit" class="bh-btn bh-btn-primary">Inschrijven</button>
          </div>
          <small class="bh-muted">De gezinsleden van hun vorige inschrijving worden overgenomen; de bestelling start
              leeg.</small>
        </form>
      </section>`;
}

const HIGH = { highFirst: true };
const REG_FILTERS = [
  { id: "all", label: "Alle", test: () => true },
  { id: "no-order", label: "Nog niets besteld", test: row => row.dinner && !row.portions },
  { id: "due", label: "Nog te betalen", test: row => row.remaining > 0 },
  { id: "credit", label: "Terug te geven", test: row => row.credit > 0 },
  { id: "no-account", label: "Zonder account", test: row => row.access === 0 }
];
const REG_SORT = {
  name: row => row.name,
  people: row => row.people,
  portions: row => row.portions,
  share: row => row.share,
  balance: row => row.remaining - row.credit,
  access: row => row.access
};

function renderFamilyList() {
  const t = eventTotals();
  const regs = state.registrations || [];
  const all = regs.map(reg => {
    const summary = t.summary.find(item => item.id === reg.id);
    const members = reg.members || [];
    const users = accountsForFamily(reg.familyId);
    return {
      reg,
      summary,
      name: reg.name,
      members,
      people: members.length,
      dinner: members.some(person => person.type !== EVENING),
      portions: familyPortions(reg),
      share: summary?.shareCents || 0,
      remaining: summary?.remainingCents || 0,
      credit: summary?.creditCents || 0,
      access: users.some(user => user.status === "active") ? 2 : users.some(user => user.status === "invited") ? 1 : 0
    };
  });
  const rows = sortRows(all.filter(activeFilter("registrations", REG_FILTERS).test), "registrations", REG_SORT);
  const body = joinHtml(
    rows.map(
      row => html`<tr>
          <th scope="row">
            <button type="button" class="bh-link bh-row-link" data-action="open-family" data-id="${row.reg.id}">
              <strong>${row.name}</strong>
              <small>${row.members.length ? countsText(row.members) : "Gezin nog niet ingevuld"}</small>
            </button>
          </th>
          <td>${row.people || dash}</td>
          <td>${row.portions || (row.dinner ? html`<span class="bh-chip bh-chip-warn">Nog niets</span>` : dash)}</td>
          <td>${row.share ? euro(row.share) : dash}</td>
          <td>${familyBalanceChip(row.summary)}</td>
          <td>${accessChip(row.reg.familyId)}</td>
        </tr>`
    ),
    ""
  );
  return html`${pageHead(
    "Inschrijvingen",
    plural(regs.length, "gezin", "gezinnen") +
      " ingeschreven · " +
      t.people +
      " aan tafel (" +
      t.adults +
      " volwassenen, " +
      t.children +
      " kinderen)" +
      (t.evening ? " · " + t.evening + " avondgasten na het eten" : "")
  )}${registerExistingFamily()}<section class="bh-card">
        <form id="add-registration-form" class="bh-inline-form">
          <label for="bh-new-family">Nieuw gezin inschrijven</label>
          <div>
            <input id="bh-new-family" name="registrationName" maxlength="80" placeholder="Bijvoorbeeld: Jan & Els"
                required>
            <button type="submit" class="bh-btn bh-btn-primary">+ Gezin toevoegen</button>
          </div>
        </form>
      </section>${
        all.length
          ? html`<section class="bh-card">
          <header class="bh-card-head">
            <h2>Ingeschreven gezinnen</h2>
            <span class="bh-count">${all.length}</span>
          </header>${filterBar("registrations", REG_FILTERS, all)}${
            rows.length
              ? html`<div class="bh-table-wrap">
            <table class="bh-table bh-table-list">
              <thead>
                <tr>${sortHeader("registrations", "name", "Gezin")}${sortHeader("registrations", "people", "Personen", HIGH)}${sortHeader(
                  "registrations",
                  "portions",
                  "Porties",
                  HIGH
                )}${sortHeader("registrations", "share", "Aandeel", HIGH)}${sortHeader(
                  "registrations",
                  "balance",
                  "Saldo",
                  HIGH
                )}${sortHeader("registrations", "access", "Account", HIGH)}</tr>
              </thead>
              <tbody>${body}</tbody>
            </table>
          </div>`
              : html`<p class="bh-empty">Geen gezinnen voor deze filter.</p>`
          }</section>`
          : html`<p class="bh-empty">Nog geen inschrijvingen voor deze editie.</p>`
      }`;
}

function renderMemberEditor(registration) {
  const members = registration.members || [];
  const products = state.catalog.filter(product => product.active);
  return joinHtml(
    members.map((person, index) => {
      if (state.editingAdminMemberIndex === index) {
        return html`<form id="edit-admin-member-form" data-index="${index}" class="bh-member bh-member-edit">
              <input name="memberName" maxlength="80" value="${person.name}" aria-label="Naam" required>
              <select name="memberType"
                  aria-label="Categorie">${typeOptions(person.type)}</select>${dietFields(person)}<div
                  class="bh-actions">
                <button type="submit" class="bh-btn bh-btn-primary">Bewaren</button>
                <button type="button" class="bh-btn" data-action="cancel-edit-admin-member">Annuleren</button>
              </div>
            </form>`;
      }
      const steppers =
        person.type === EVENING
          ? html`<p class="bh-note">🌙 Komt na het eten: geen vlees en geen gedeelde kosten, alleen de eigen
              barrekening.</p>`
          : joinHtml(
              products.map(product => {
                const quantity = Number(person.orders?.[product.id]) || 0;
                return html`<div class="bh-stepper-row">
                      <span>${product.name}</span>
                      <div class="bh-stepper">
                        <button type="button" data-action="admin-quantity" data-registration="${registration.id}"
                            data-person="${person.id}" data-product="${product.id}" data-delta="-1"
                            aria-label="Minder ${product.name}"${quantity ? "" : " disabled"}>−</button>
                        <b>${quantity}</b>
                        <button type="button" data-action="admin-quantity" data-registration="${registration.id}"
                            data-person="${person.id}" data-product="${product.id}" data-delta="1"
                            aria-label="Meer ${product.name}">+</button>
                      </div>
                    </div>`;
              }),
              ""
            );
      return html`<details class="bh-member"
          data-member-id="${person.id}"${state.beheerOpenMembers?.has(person.id) ? " open" : ""}>
            <summary>
              <span class="bh-avatar bh-avatar-sm">${(person.name || "?").charAt(0).toUpperCase()}</span>
              <span class="bh-family-name">
                <strong>${person.name}</strong>
                <small>${typeLabel(person.type)}</small>${dietChips(person)}</span>
              <span class="bh-chip">${plural(portionsOf(person), "portie", "porties")}</span>
              <i class="bh-chev" aria-hidden="true">›</i>
            </summary>
            <div class="bh-member-body">${steppers || html`<p class="bh-empty">Geen actieve producten.</p>`}<div
                class="bh-actions">
                <button type="button" class="bh-btn bh-btn-sm" data-action="edit-member" data-index="${index}">Naam of
                    categorie wijzigen</button>
                <button type="button" class="bh-btn bh-btn-sm bh-btn-danger" data-action="delete-member"
                    data-index="${index}">Verwijderen</button>
              </div>
            </div>
          </details>`;
    }),
    ""
  );
}

function accessData(familyId) {
  return { users: accountsForFamily(familyId) };
}

export function renderAccess(familyId) {
  const { users } = accessData(familyId);
  const accountRows = joinHtml(
    users.map(
      user =>
        html`<li>
            <span>
              <strong>${user.displayName || user.email}</strong>
              <small>${user.email} · ${user.role === "owner" ? "beheerder" : user.role === "viewer" ? "lezer" : "bewerker"}</small>
            </span>
            <span class="bh-line-end">${
              user.status === "active"
                ? html`<span class="bh-chip bh-chip-ok">Actief</span>`
                : user.status === "disabled"
                  ? html`<span class="bh-chip bh-chip-due">Geblokkeerd</span>`
                  : html`<span class="bh-chip bh-chip-warn">Uitgenodigd</span>
              <button type="button" class="bh-btn bh-btn-sm" data-action="resend-account-invite"
                  data-user="${user.id}">Opnieuw sturen</button>`
            }</span>
          </li>`
    ),
    ""
  );
  return html`${
    accountRows
      ? html`<ul class="bh-lines">${accountRows}</ul>`
      : html`<p class="bh-note">Dit gezin heeft nog geen account. Stuur een uitnodiging: ze kiezen zelf een wachtwoord en
          beheren daarna hun gezin, bestelling en afrekening.</p>`
  }<form data-invite-account="${familyId}" class="bh-form-grid bh-form-compact">
        <label>Naam<input name="displayName" maxlength="100" placeholder="Naam contactpersoon" required>
        </label>
        <label>E-mailadres<input name="email" type="email" maxlength="254" placeholder="naam@voorbeeld.be" required>
        </label>
        <button type="submit" class="bh-btn
            bh-btn-primary">${users.length ? "Extra account uitnodigen" : "Uitnodiging versturen"}</button>
      </form>`;
}

function renderFamilyDetail(registration) {
  const finance = getFamilyFinanceBreakdown(registration, state.registrations, state.expenses, state.payments);
  const t = finance.totals;
  const payments = (state.payments || []).filter(payment => payment.registrationId === registration.id);

  const categoryShare = category =>
    category.personal
      ? "persoonlijke barrekening"
      : category.familyUnits +
        "/" +
        category.totalUnits +
        " " +
        (category.method === "meat" ? "porties" : category.method === "adults" ? "volwassenen" : "personen");
  const settlement = finance.expenses.length
    ? html`<ul class="bh-lines">${joinHtml(
        finance.categories.map(
          category =>
            html`<li>
                <span>${COST_ICON[category.method]} ${category.label} <small>${categoryShare(category)}</small>
                </span>
                <b>${euro(category.familyCents)}</b>
              </li>`
        ),
        ""
      )}<li class="bh-line-strong">
          <span>Aandeel van het gezin</span>
          <b>${euro(t.shareCents)}</b>
        </li>${
          t.advancedCents
            ? html`<li>
          <span>Min: voorgeschoten</span>
          <b>− ${euro(t.advancedCents)}</b>
        </li>`
            : ""
        }${
          t.paidCents
            ? html`<li>
          <span>Min: betaald</span>
          <b>− ${euro(t.paidCents)}</b>
        </li>`
            : ""
        }${
          t.refundedCents
            ? html`<li>
            <span>Al terugbetaald aan het gezin</span>
            <b>${euro(t.refundedCents)}</b>
          </li>`
            : ""
        }${
          t.remainingCents
            ? html`<li class="bh-line-total bh-due">
            <span>Nog te betalen</span>
            <b>${euro(t.remainingCents)}</b>
          </li>`
            : t.creditCents
              ? html`<li class="bh-line-total bh-credit">
              <span>Terug te geven</span>
              <b>${euro(t.creditCents)}</b>
            </li>`
              : html`<li class="bh-line-total bh-ok">
              <span>Saldo</span>
              <b>${euro(0)}</b>
            </li>`
        }</ul>
      <div class="bh-member-costs">${joinHtml(
        finance.members.map(
          member => html`<span>${member.name} <b>${euro(member.totalCents)}</b>
          </span>`
        ),
        ""
      )}</div>`
    : html`<p class="bh-empty">Nog geen kosten ingevoerd.</p>`;

  const paymentList = payments.length
    ? html`<ul class="bh-lines">${payments.map(payment => paymentLine(payment, false))}</ul>`
    : "";
  const paymentForm =
    t.remainingCents > 0
      ? html`<form id="add-payment-form" class="bh-form-grid bh-form-compact">
          <input type="hidden" name="registrationId" value="${registration.id}">
          <label>Bedrag (€)<input name="amount" type="number" min="0.01" step="0.01"
              max="${(t.remainingCents / 100).toFixed(2)}" value="${(t.remainingCents / 100).toFixed(2)}" required>
          </label>
          <label>Datum<input name="date" type="date" value="${today()}" required>
          </label>
          <label>Wijze<select name="method">
              <option value="cash">Cash</option>
              <option value="bank">Overschrijving</option>
            </select>
          </label>
          <button type="submit" class="bh-btn bh-btn-primary">Betaling registreren</button>
        </form>`
      : t.creditCents > 0
        ? refundForm(registration.id, t.creditCents)
        : "";

  return html`<button type="button" class="bh-back" data-action="close-family">‹ Alle inschrijvingen</button>
      <header class="bh-page-head">
        <div>${
          state.beheerRenaming
            ? html`<form id="rename-registration-form" data-id="${registration.id}" class="bh-rename">
          <input name="registrationName" maxlength="80" value="${registration.name}" aria-label="Naam gezin" required>
          <button type="submit" class="bh-btn bh-btn-primary">Bewaren</button>
          <button type="button" class="bh-btn" data-action="cancel-rename">Annuleren</button>
        </form>`
            : html`<h1>${registration.name} <button type="button" class="bh-icon-btn" data-action="rename-registration"
                aria-label="Naam wijzigen">✎</button>
        </h1>`
        }<p>${countsText(registration.members)} · ${plural(familyPortions(registration), "portie", "porties")}</p>
        </div>
        <div class="bh-page-actions">${accessChip(registration.familyId)}${familyBalanceChip(
          getFinancialSummary(state.registrations, state.expenses, state.payments).find(
            row => row.id === registration.id
          )
        )}</div>
      </header>
      <div class="bh-grid-2">
        <section class="bh-card">
          <header class="bh-card-head">
            <h2>Gezinsleden & bestelling</h2>
            <span class="bh-count">${(registration.members || []).length}</span>
          </header>${
            (registration.members || []).length
              ? html`<div class="bh-members">${renderMemberEditor(registration)}</div>`
              : html`<p class="bh-empty">Nog geen gezinsleden. Het gezin kan ze zelf toevoegen, of je voegt ze hier
                  toe.</p>`
          }<form id="add-member-form" class="bh-form-grid bh-form-compact">
            <label>Naam<input name="memberName" maxlength="80" placeholder="Voornaam en naam" required>
            </label>
            <label>Categorie<select name="memberType">${typeOptions("Volwassene")}</select>
            </label>
            <button type="submit" class="bh-btn">+ Persoon toevoegen</button>
          </form>
        </section>
        <div class="bh-stack">
          <section class="bh-card">
            <header class="bh-card-head">
              <h2>Afrekening</h2>${statusChip()}</header>${settlement}</section>
          <section class="bh-card">
            <header class="bh-card-head">
              <h2>Betalingen</h2>
              <span class="bh-count">${payments.length}</span>
            </header>${
              paymentList ||
              (t.remainingCents
                ? ""
                : html`<p class="bh-empty">Geen betalingen of
                terugbetalingen nodig.</p>`)
            }${paymentForm}</section>
          <section class="bh-card">
            <header class="bh-card-head">
              <h2>Gezin & toegang</h2>${accessChip(registration.familyId)}</header>
            <p class="bh-note">Namen, accounts en uitnodigingen beheer je bij het gezin onder Gebruikers.</p>
            <button type="button" class="bh-btn" data-action="open-user-family" data-id="${registration.familyId}">Gezin
                openen in Gebruikers ›</button>
          </section>
          <section class="bh-card">
            <header class="bh-card-head">
              <h2>Uitschrijven</h2>
            </header>
            <p class="bh-note">Haalt dit gezin uit ${eventTitle()}. Het gezin, de leden en de accounts blijven bestaan
                onder Gebruikers.</p>
            <button type="button" class="bh-btn bh-btn-danger" data-action="unregister-family"
                data-id="${registration.id}">Uitschrijven uit deze editie</button>
          </section>
        </div>
      </div>`;
}

export function renderFamilies() {
  const registration = (state.registrations || []).find(item => item.id === state.beheerFamilyId);
  if (registration) {
    state.managingRegistrationId = registration.id; // add/edit/delete member handlers act on this
    return renderFamilyDetail(registration);
  }
  return renderFamilyList();
}
