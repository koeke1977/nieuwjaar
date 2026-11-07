// Instellingen: e-mail, back-ups en info over de app.
import { state } from "../../../data/admin-store.js";
import { html, joinHtml, formatDate } from "../../../utils/html.js";
import { pageHead } from "./shared.js";

function renderMail() {
  return html`<section class="bh-card">
      <header class="bh-card-head">
        <h2>E-mail testen</h2>
      </header>
      <p class="bh-note">Uitnodigingen en wachtwoordherstel worden verstuurd vanaf registratie@datuur.be via Microsoft
          365. Stuur een testmail om de koppeling te controleren.</p>
      <form id="mail-test-form" class="bh-inline-form">
        <label for="mail-test-recipient">Testmail naar</label>
        <div>
          <input id="mail-test-recipient" name="recipient" type="email" maxlength="254" placeholder="jouw e-mailadres"
              required>
          <button type="submit" class="bh-btn bh-btn-primary">Testmail versturen</button>
        </div>
      </form>
    </section>`;
}

// ---------------- Instellingen (global) ----------------
function renderBackups() {
  const list = state.backups;
  const rows = joinHtml(
    (list || []).slice(0, 10).map(backup => {
      const file = backup.key.slice("backups/".length);
      return html`<li>
            <span>
              <strong>${formatDate(file.slice(3, 13))}</strong>
              <small>${Math.max(1, Math.round((backup.size || 0) / 1024))} kB</small>
            </span>
            <a class="bh-btn bh-btn-sm" href="/api/admin/backups/${encodeURIComponent(file)}" download>Downloaden</a>
          </li>`;
    }),
    ""
  );
  return html`<section class="bh-card">
        <header class="bh-card-head">
          <h2>Back-ups</h2>
          <button type="button" class="bh-btn bh-btn-sm" data-action="create-backup">Nu back-up maken</button>
        </header>
        <p class="bh-note">Elke nacht wordt automatisch een volledige kopie van de gegevens bewaard (de laatste 35
            dagen), in de beveiligde opslag van de app. Daarnaast houdt Cloudflare zelf 7 dagen herstelpunten bij.</p>${
              list === undefined
                ? html`<p class="bh-empty">Back-ups laden…</p>`
                : rows
                  ? html`<ul class="bh-lines">${rows}</ul>`
                  : html`<p class="bh-empty">Nog geen back-ups. De eerste wordt vannacht gemaakt, of klik op "Nu back-up
                  maken".</p>`
            }</section>`;
}

export function renderSettings() {
  return html`${pageHead("Instellingen", "Algemene instellingen voor de hele app.")}${renderMail()}${renderBackups()}<section
      class="bh-card">
        <header class="bh-card-head">
          <h2>Over deze app</h2>
        </header>
        <ul class="bh-lines">
          <li>
            <span>Adres</span>
            <b>nieuwjaar.datuur.be</b>
          </li>
          <li>
            <span>Afzender e-mails</span>
            <b>registratie@datuur.be</b>
          </li>
          <li>
            <span>Familieportaal</span>
            <b>nieuwjaar.datuur.be/familie</b>
          </li>
        </ul>
      </section>`;
}
