// "Mijn account": change password or e-mail address, and see or invite who has access to the family.
import { html, joinHtml } from "../../../utils/html.js";

const MAX_ACCOUNTS_PER_FAMILY = 6;
const ROLE_LABEL = { owner: "Beheerder", editor: "Mag wijzigen", viewer: "Mag alleen kijken" };

function personRow(family, person) {
  const canRemove = family.role === "owner" && person.role !== "owner";
  return html`<li class="fa-access-row">
      <span>
        <strong>${person.name || person.email}${person.me ? " (jij)" : ""}</strong>
        <small>${person.email} · ${ROLE_LABEL[person.role] || person.role}${
          person.status === "invited" ? " · nog niet geactiveerd" : ""
        }</small>
      </span>${
        canRemove
          ? html`<button type="button" class="fa-btn fa-btn-small fa-btn-quiet" data-action="remove-family-user"
              data-family="${family.id}" data-user="${person.id}" data-name="${person.name || person.email}">Verwijderen</button>`
          : ""
      }</li>`;
}

function familyCard(family) {
  const inviteForm =
    family.role !== "owner"
      ? html`<p class="fa-muted">Alleen de beheerder van het gezin kan iemand uitnodigen.</p>`
      : family.people.length >= MAX_ACCOUNTS_PER_FAMILY
        ? html`<p class="fa-muted">Dit gezin heeft het maximum van ${MAX_ACCOUNTS_PER_FAMILY} accounts bereikt.</p>`
        : html`<form class="fa-settings-form" data-account-form="invite" data-family="${family.id}">
            <h4>Iemand uitnodigen</h4>
            <p class="fa-muted">Bijvoorbeeld je partner. Die krijgt een mail, kiest zelf een wachtwoord en kan daarna
              mee de gezinsleden, bestelling en kosten aanpassen.</p>
            <label class="fa-label">Naam<input name="displayName" maxlength="100" autocomplete="off" required>
            </label>
            <label class="fa-label">E-mailadres<input name="email" type="email" maxlength="254" autocomplete="off"
                required>
            </label>
            <button type="submit" class="fa-btn fa-btn-primary">Uitnodiging versturen</button>
          </form>`;
  return html`<section class="fa-settings-card">
      <h3>Toegang tot ${family.name}</h3>
      <ul class="fa-access">${joinHtml(
        family.people.map(person => personRow(family, person)),
        ""
      )}</ul>${inviteForm}</section>`;
}

export function renderSettings(user, settings) {
  return html`<div class="fa-settings">
      <button type="button" class="fa-btn fa-btn-quiet" data-action="close-settings">‹ Terug</button>
      <p class="fa-muted">Aangemeld als ${user?.email || ""}</p>
      <section class="fa-settings-card">
        <h3>Wachtwoord wijzigen</h3>
        <form class="fa-settings-form" data-account-form="password">
          <label class="fa-label">Huidig wachtwoord<input name="currentPassword" type="password"
              autocomplete="current-password" required>
          </label>
          <label class="fa-label">Nieuw wachtwoord (minstens 12 tekens)<input name="newPassword" type="password"
              minlength="12" autocomplete="new-password" required>
          </label>
          <label class="fa-label">Nieuw wachtwoord herhalen<input name="confirmPassword" type="password"
              autocomplete="new-password" required>
          </label>
          <button type="submit" class="fa-btn fa-btn-primary">Wachtwoord wijzigen</button>
        </form>
      </section>
      <section class="fa-settings-card">
        <h3>E-mailadres wijzigen</h3>
        <p class="fa-muted">Je meldt je nu aan met <strong>${user?.email || ""}</strong>. Het nieuwe adres gaat pas in
          nadat je op de link in de bevestigingsmail hebt geklikt.</p>
        <form class="fa-settings-form" data-account-form="email">
          <label class="fa-label">Nieuw e-mailadres<input name="newEmail" type="email" maxlength="254"
              autocomplete="email" required>
          </label>
          <label class="fa-label">Je wachtwoord ter bevestiging<input name="password" type="password"
              autocomplete="current-password" required>
          </label>
          <button type="submit" class="fa-btn fa-btn-primary">Bevestigingsmail versturen</button>
        </form>
      </section>${
        settings ? joinHtml(settings.families.map(familyCard), "") : html`<p class="fa-muted">Toegang laden…</p>`
      }<button type="button" class="fa-btn" data-action="logout">Afmelden</button>
    </div>`;
}
