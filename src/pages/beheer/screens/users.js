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
  pageHead
} from "./shared.js";
import { renderAccess } from "./families.js";

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

function renderUserFamilies() {
  const list = allFamilies();
  const rows = joinHtml(
    list.map(family => {
      const registration = state.registrations.find(item => item.familyId === family.id);
      const members = registration?.members || family.registrations?.[0]?.members || [];
      const editions = joinHtml(
        (family.registrations || []).map(
          reg =>
            html`<span
                class="bh-chip${reg.editionId === state.activeEditionId ? " bh-chip-info" : ""}">${reg.event + " " + reg.edition}</span>`
        ),
        ""
      );
      return html`<li>
            <button type="button" class="bh-family-row bh-family-row-user" data-action="open-user-family"
                data-id="${family.id}">
              <span class="bh-avatar">${(family.name || "?").charAt(0).toUpperCase()}</span>
              <span class="bh-family-name">
                <strong>${registration?.name || family.name}</strong>
                <small>${members.length ? countsText(members) : "Leden nog niet ingevuld"}</small>
              </span>
              <span class="bh-family-chips">${accessChip(family.id)}${
                editions ||
                html`<span class="bh-chip
                  bh-chip-muted">Niet ingeschreven</span>`
              }</span>
              <i class="bh-chev" aria-hidden="true">›</i>
            </button>
          </li>`;
    }),
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
      </section>${
        rows
          ? html`<ul class="bh-family-list">${rows}</ul>`
          : html`<p class="bh-empty">Nog geen
          gezinnen.</p>`
      }`;
}

function renderAccounts() {
  const rows = joinHtml(
    accounts.map(user => {
      const status =
        user.status === "active"
          ? html`<span class="bh-chip bh-chip-ok">Actief</span>`
          : user.status === "disabled"
            ? html`<span class="bh-chip bh-chip-due">Geblokkeerd</span>`
            : html`<span class="bh-chip bh-chip-warn">Uitgenodigd</span>`;
      const fams =
        joinHtml(
          (user.families || []).map(
            link =>
              html`<button type="button" class="bh-chip bh-chip-info" data-action="open-user-family"
                  data-id="${link.familyId}">${link.familyName || "Gezin"}</button>`
          ),
          ""
        ) || html`<span class="bh-chip bh-chip-muted">Geen gezin</span>`;
      const actions = html`${
        user.status === "invited"
          ? html`<button type="button" class="bh-btn bh-btn-sm" data-action="resend-account-invite"
              data-user="${user.id}">Opnieuw sturen</button>`
          : ""
      }${
        user.status === "active"
          ? html`<button type="button" class="bh-btn bh-btn-sm" data-action="account-status" data-user="${user.id}"
              data-status="disabled">Blokkeren</button>
            <button type="button" class="bh-btn bh-btn-sm" data-action="account-sessions" data-user="${user.id}">Afmelden
                op alle toestellen</button>`
          : ""
      }${
        user.status === "disabled"
          ? html`<button type="button" class="bh-btn bh-btn-sm" data-action="account-status" data-user="${user.id}"
              data-status="active">Deblokkeren</button>`
          : ""
      }<button type="button" class="bh-btn bh-btn-sm bh-btn-danger" data-action="account-delete" data-user="${user.id}"
          data-email="${user.email}">Verwijderen</button>`;
      return html`<li class="bh-account">
            <div class="bh-account-main">
              <strong>${user.displayName || user.email}</strong>
              <small>${user.email}${
                user.lastLoginAt
                  ? " · laatst aangemeld " + new Date(user.lastLoginAt * 1000).toLocaleDateString("nl-BE")
                  : ""
              }</small>
              <div class="bh-family-chips">${status}${fams}</div>
            </div>
            <div class="bh-actions">${actions}</div>
          </li>`;
    }),
    ""
  );
  return html`<section class="bh-card">
        <header class="bh-card-head">
          <h2>Accounts</h2>
          <span class="bh-count">${accounts.length}</span>
        </header>
        <p class="bh-note">Uitnodigen doe je bij het gezin (Gezinnen → gezin → Toegang). Een account hoort bij een gezin,
            niet bij één editie.</p>${
              rows
                ? html`<ul class="bh-accounts">${rows}</ul>`
                : html`<p class="bh-empty">Nog
            geen accounts.</p>`
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
