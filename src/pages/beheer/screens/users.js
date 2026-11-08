// Gebruikers: gezinnen (over alle edities heen) en accounts.
import { state } from "../../../data/admin-store.js";
import { typeLabel, typeOptions, countsText } from "../../../utils/member-types.js";
import { html, joinHtml, euro, plural } from "../../../utils/html.js";
import { getFinancialSummary } from "../../../utils/finance.js";
import {
  familyPortions,
  familyBalanceChip,
  dietFields,
  dietChips,
  eventTitle,
  accessChip,
  allFamilies,
  accounts,
  accountsForFamily,
  pageHead
} from "./shared.js";
import { renderAccess } from "./families.js";
import { dash, shortDate, activeFilter, sortRows, sortHeader, filterBar } from "./table.js";

// ---------------- Gebruikers ----------------
function participationRow(family) {
  const rows = joinHtml(
    (family.registrations || []).map(reg => {
      const loaded = reg.editionId === state.activeEditionId;
      const live = loaded ? state.registrations.find(item => item.id === reg.id) : null;
      const summary = live
        ? getFinancialSummary(state.registrations, state.expenses, state.payments).find(item => item.id === reg.id)
        : null;
      return html`<li>
            <span>
              <strong>${reg.event} ${reg.edition}</strong>
              <small>${reg.editionStatus === "archived" ? "Afgesloten editie" : "Actieve editie"}${
                live
                  ? " · " +
                    plural(familyPortions(live), "portie", "porties") +
                    " · aandeel " +
                    euro(summary?.shareCents || 0)
                  : ""
              }</small>
            </span>
            <span class="bh-line-end">${summary ? familyBalanceChip(summary) : ""}${
              loaded
                ? html`<button type="button" class="bh-btn bh-btn-sm" data-action="open-family"
                    data-id="${reg.id}">Inschrijving ›</button>`
                : html`<button type="button" class="bh-btn bh-btn-sm" data-action="open-edition"
                    data-id="${reg.editionId}">Editie openen ›</button>`
            }</span>
          </li>`;
    }),
    ""
  );
  return (
    rows ||
    html`<li>
      <span class="bh-muted">Nog nergens ingeschreven.</span>
    </li>`
  );
}

function renderUserFamily(family) {
  const registration = state.registrations.find(item => item.familyId === family.id);
  const latest = (family.registrations || [])[0];
  if (registration) state.managingRegistrationId = registration.id; // member handlers act on this
  const members = registration ? registration.members || [] : latest?.members || [];
  const rows = joinHtml(
    members.map((person, index) =>
      registration && state.editingAdminMemberIndex === index
        ? html`<li>
            <form id="edit-admin-member-form" data-index="${index}" class="bh-member-edit">
              <input name="memberName" maxlength="80" value="${person.name}" aria-label="Naam" required>
              <select name="memberType"
                  aria-label="Categorie">${typeOptions(person.type)}</select>${dietFields(person)}<div
                  class="bh-actions">
                <button type="submit" class="bh-btn bh-btn-primary">Bewaren</button>
                <button type="button" class="bh-btn" data-action="cancel-edit-admin-member">Annuleren</button>
              </div>
            </form>
          </li>`
        : html`<li>
            <span class="bh-person">
              <span class="bh-avatar bh-avatar-sm">${(person.name || "?").charAt(0).toUpperCase()}</span>
              <span class="bh-family-name">
                <strong>${person.name}</strong>
                <small>${typeLabel(person.type)}</small>${dietChips(person)}</span>
            </span>${
              registration
                ? html`<span class="bh-line-end">
                <button type="button" class="bh-btn bh-btn-sm" data-action="edit-member"
                    data-index="${index}">Wijzigen</button>
                <button type="button" class="bh-btn bh-btn-sm bh-btn-danger" data-action="delete-member"
                    data-index="${index}">Verwijderen</button>
              </span>`
                : ""
            }</li>`
    ),
    ""
  );
  const name = registration?.name || family.name;
  const membersCard = html`<section class="bh-card">
        <header class="bh-card-head">
          <h2>Gezinsleden</h2>
          <span class="bh-count">${members.length}</span>
        </header>${
          registration
            ? ""
            : html`<p
                class="bh-note">${latest ? "Zoals bij de laatste inschrijving (" + latest.event + " " + latest.edition + "). " : ""}Niet
                ingeschreven voor ${eventTitle()}.</p>`
        }${
          members.length
            ? html`<ul class="bh-lines bh-people">${rows}</ul>`
            : html`<p class="bh-empty">Nog geen gezinsleden.</p>`
        }${
          registration
            ? html`<form id="add-member-form" class="bh-form-grid bh-form-compact">
          <label>Naam<input name="memberName" maxlength="80" placeholder="Voornaam en naam" required>
          </label>
          <label>Categorie<select name="memberType">${typeOptions("Volwassene")}</select>
          </label>
          <button type="submit" class="bh-btn">+ Persoon toevoegen</button>
        </form>`
            : state.editionStatus === "archived"
              ? ""
              : html`<button type="button" class="bh-btn bh-btn-primary" data-action="register-family"
                  data-id="${family.id}">Inschrijven voor ${eventTitle()}</button>`
        }</section>`;
  return html`<button type="button" class="bh-back" data-action="close-user-family">‹ Alle gezinnen</button>
      <header class="bh-page-head">
        <div>${
          registration && state.beheerRenaming
            ? html`<form id="rename-registration-form" data-id="${registration.id}" class="bh-rename">
          <input name="registrationName" maxlength="80" value="${name}" aria-label="Naam gezin" required>
          <button type="submit" class="bh-btn bh-btn-primary">Bewaren</button>
          <button type="button" class="bh-btn" data-action="cancel-rename">Annuleren</button>
        </form>`
            : html`<h1>${name}${
                registration
                  ? html` <button type="button" class="bh-icon-btn" data-action="rename-registration" aria-label="Naam
                      wijzigen">✎</button>`
                  : ""
              }</h1>`
        }<p>${countsText(members)}</p>
        </div>
        <div class="bh-page-actions">${accessChip(family.id)}</div>
      </header>
      <div class="bh-grid-2">${membersCard}<div class="bh-stack">
          <section class="bh-card">
            <header class="bh-card-head">
              <h2>Toegang</h2>
            </header>${renderAccess(family.id)}</section>
          <section class="bh-card">
            <header class="bh-card-head">
              <h2>Deelname aan evenementen</h2>
            </header>
            <ul class="bh-lines">${participationRow(family)}</ul>
          </section>
        </div>
      </div>`;
}

const HIGH = { highFirst: true };

const ACCESS_LABEL = ["Geen account", "Uitgenodigd", "Account actief"];
const ACCESS_CHIP = ["bh-chip-muted", "bh-chip-warn", "bh-chip-ok"];

function familyRows() {
  const lastLogin = new Map();
  for (const user of accounts)
    for (const link of user.families || [])
      if (user.lastLoginAt) lastLogin.set(link.familyId, Math.max(lastLogin.get(link.familyId) || 0, user.lastLoginAt));
  return allFamilies().map(family => {
    const registration = state.registrations.find(item => item.familyId === family.id);
    const members = registration?.members || family.registrations?.[0]?.members || [];
    const users = accountsForFamily(family.id);
    return {
      id: family.id,
      name: registration?.name || family.name,
      members,
      people: members.length,
      registered: registration ? 1 : 0,
      portions: registration ? familyPortions(registration) : 0,
      access: users.some(user => user.status === "active") ? 2 : users.some(user => user.status === "invited") ? 1 : 0,
      login: lastLogin.get(family.id) || 0
    };
  });
}

const FAMILY_FILTERS = [
  { id: "all", label: "Alle", test: () => true },
  { id: "registered", label: "Ingeschreven", test: row => row.registered },
  { id: "not-registered", label: "Niet ingeschreven", test: row => !row.registered },
  { id: "no-account", label: "Zonder account", test: row => row.access === 0 },
  { id: "invited", label: "Nog niet aangemeld", test: row => row.access === 1 }
];
const FAMILY_SORT = {
  name: row => row.name,
  people: row => row.people,
  registered: row => row.registered,
  portions: row => row.portions,
  access: row => row.access,
  login: row => row.login
};

function renderUserFamilies() {
  const all = familyRows();
  const filter = activeFilter("families", FAMILY_FILTERS);
  const rows = sortRows(all.filter(filter.test), "families", FAMILY_SORT);
  const body = joinHtml(
    rows.map(
      row => html`<tr>
          <th scope="row">
            <button type="button" class="bh-link bh-row-link" data-action="open-user-family" data-id="${row.id}">
              <strong>${row.name}</strong>
              <small>${row.members.length ? countsText(row.members) : "Leden nog niet ingevuld"}</small>
            </button>
          </th>
          <td>${row.people || dash}</td>
          <td>${row.registered ? html`<span class="bh-chip bh-chip-info">Ingeschreven</span>` : dash}</td>
          <td>${row.registered ? row.portions || dash : dash}</td>
          <td>
            <span class="bh-chip ${ACCESS_CHIP[row.access]}">${ACCESS_LABEL[row.access]}</span>
          </td>
          <td>${shortDate(row.login) || dash}</td>
        </tr>`
    ),
    ""
  );
  return html`<section class="bh-card">
        <form id="add-registration-form" data-context="users" class="bh-inline-form">
          <label for="bh-new-user-family">Nieuw gezin</label>
          <div>
            <input id="bh-new-user-family" name="registrationName" maxlength="80" placeholder="Bijvoorbeeld: Jan & Els"
                required>
            <button type="submit" class="bh-btn bh-btn-primary">+ Gezin toevoegen</button>
          </div>
          <small class="bh-muted">${
            state.editionStatus === "archived"
              ? "Open eerst een actieve editie om een nieuw gezin in te schrijven."
              : "Een nieuw gezin wordt meteen ingeschreven voor " + eventTitle() + "."
          }</small>
        </form>
      </section>
      <section class="bh-card">
        <header class="bh-card-head">
          <h2>Gezinnen</h2>
          <span class="bh-count">${all.length}</span>
        </header>${filterBar("families", FAMILY_FILTERS, all)}<p class="bh-note">Ingeschreven en porties gelden voor
          ${eventTitle()}. Klik op een kolomtitel om te sorteren.</p>${
            rows.length
              ? html`<div class="bh-table-wrap">
          <table class="bh-table bh-table-list">
            <thead>
              <tr>${sortHeader("families", "name", "Gezin")}${sortHeader("families", "people", "Personen", HIGH)}${sortHeader("families", "registered", "Ingeschreven", HIGH)}${sortHeader("families", "portions", "Porties", HIGH)}${sortHeader("families", "access", "Account", HIGH)}${sortHeader("families", "login", "Laatst aangemeld", HIGH)}</tr>
            </thead>
            <tbody>${body}</tbody>
          </table>
        </div>`
              : html`<p class="bh-empty">${all.length ? "Geen gezinnen voor deze filter." : "Nog geen gezinnen."}</p>`
          }</section>`;
}

const STATUS_RANK = { active: 0, invited: 1, disabled: 2 };
const STATUS_LABEL = { active: "Actief", invited: "Uitgenodigd", disabled: "Geblokkeerd" };
const STATUS_CHIP = { active: "bh-chip-ok", invited: "bh-chip-warn", disabled: "bh-chip-due" };
const ACCOUNT_FILTERS = [
  { id: "all", label: "Alle", test: () => true },
  { id: "active", label: "Actief", test: user => user.status === "active" },
  { id: "invited", label: "Uitgenodigd", test: user => user.status === "invited" },
  { id: "disabled", label: "Geblokkeerd", test: user => user.status === "disabled" },
  { id: "locked", label: "Vergrendeld", test: user => user.loginLocked || user.resetLocked }
];

// Locked by the limits on wrong passwords or reset mails (not the same as blocked by the admin).
const lockChips = user =>
  html`${
    user.loginLocked
      ? html` <span class="bh-chip bh-chip-due" title="Te veel foute wachtwoorden">🔒 Aanmelden</span>`
      : ""
  }${
    user.resetLocked
      ? html` <span class="bh-chip bh-chip-due" title="Te veel herstelmails aangevraagd">🔒 Wachtwoordherstel</span>`
      : ""
  }`;
const ACCOUNT_SORT = {
  name: user => user.displayName || user.email,
  email: user => user.email,
  status: user => STATUS_RANK[user.status] ?? 3,
  family: user => (user.families || [])[0]?.familyName || "",
  login: user => user.lastLoginAt || 0
};

// The actions that make sense for this account; handled by handleAccountMenu (actions/accounts.js).
function accountMenu(user) {
  const options = [
    ...(user.loginLocked || user.resetLocked ? [["account-unlock", "Ontgrendelen"]] : []),
    ...(user.status === "invited" ? [["resend-account-invite", "Uitnodiging opnieuw sturen"]] : []),
    ...(user.status === "active"
      ? [
          ["account-status:disabled", "Blokkeren"],
          ["account-sessions", "Afmelden op alle toestellen"]
        ]
      : []),
    ...(user.status === "disabled" ? [["account-status:active", "Deblokkeren"]] : []),
    ["account-delete", "Verwijderen"]
  ];
  return html`<select class="bh-action-menu" data-account-menu data-user="${user.id}" data-email="${user.email}"
      aria-label="Actie voor ${user.email}">
      <option value="" selected>Actie kiezen…</option>${joinHtml(
        options.map(([value, label]) => html`<option value="${value}">${label}</option>`),
        ""
      )}</select>`;
}

function renderAccounts() {
  const filter = activeFilter("accounts", ACCOUNT_FILTERS);
  const rows = sortRows(accounts.filter(filter.test), "accounts", ACCOUNT_SORT);
  const body = joinHtml(
    rows.map(
      user => html`<tr>
          <th scope="row">${user.displayName || dash}</th>
          <td>${user.email}</td>
          <td>
            <span class="bh-chip ${STATUS_CHIP[user.status] || "bh-chip-muted"}">${
              STATUS_LABEL[user.status] || user.status
            }</span>${lockChips(user)}
          </td>
          <td>${
            joinHtml(
              (user.families || []).map(
                link => html`<button type="button" class="bh-chip bh-chip-info" data-action="open-user-family"
                    data-id="${link.familyId}">${link.familyName || "Gezin"}</button>`
              ),
              ""
            ) || html`<span class="bh-chip bh-chip-muted">Geen gezin</span>`
          }</td>
          <td>${shortDate(user.lastLoginAt) || dash}</td>
          <td>${accountMenu(user)}</td>
        </tr>`
    ),
    ""
  );
  return html`<section class="bh-card">
        <header class="bh-card-head">
          <h2>Accounts</h2>
          <span class="bh-count">${accounts.length}</span>
        </header>${filterBar("accounts", ACCOUNT_FILTERS, accounts)}<p class="bh-note">Uitnodigen doe je bij het gezin
          (Gezinnen → gezin → Toegang). Een account hoort bij een gezin, niet bij één editie.</p>${
            rows.length
              ? html`<div class="bh-table-wrap">
          <table class="bh-table bh-table-list">
            <thead>
              <tr>${sortHeader("accounts", "name", "Naam")}${sortHeader("accounts", "email", "E-mail")}${sortHeader(
                "accounts",
                "status",
                "Status"
              )}${sortHeader("accounts", "family", "Gezin")}${sortHeader("accounts", "login", "Laatst aangemeld", HIGH)}<th>
                  Acties</th>
              </tr>
            </thead>
            <tbody>${body}</tbody>
          </table>
        </div>`
              : html`<p class="bh-empty">${accounts.length ? "Geen accounts voor deze filter." : "Nog geen accounts."}</p>`
          }</section>`;
}

export const USERS_TABS = [
  { id: "families", label: "Gezinnen" },
  { id: "accounts", label: "Accounts" }
];

export function renderUsers() {
  const family = allFamilies().find(item => item.id === state.beheerUserFamilyId);
  if (family) return renderUserFamily(family);
  const tab = USERS_TABS.some(entry => entry.id === state.beheerUsersTab) ? state.beheerUsersTab : "families";
  return html`${pageHead(
    "Gebruikers",
    "Gezinnen, hun leden en de accounts waarmee ze aanmelden. Een gezin bestaat één keer en kan deelnemen aan alle evenementen."
  )}<nav class="bh-subtabs" aria-label="Gebruikers">${joinHtml(
    USERS_TABS.map(
      entry =>
        html`<button type="button" data-action="users-tab" data-tab="${entry.id}"
            aria-current="${entry.id === tab}">${entry.label}</button>`
    ),
    ""
  )}</nav>${tab === "accounts" ? renderAccounts() : renderUserFamilies()}`;
}
