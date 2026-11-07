// Beheer (admin): the page frame and navigation. Each section lives in ./screens/;
// pure render functions over the shared admin `state`; event handling lives in app.js.
import { state } from "../../data/admin-store.js";
import { html, joinHtml } from "../../utils/html.js";
import { normalizeSection, SECTIONS } from "./screens/shared.js";
import { renderUsers } from "./screens/users.js";
import { renderSettings } from "./screens/settings.js";
import { renderEdition, renderEvents } from "./screens/events.js";
export { normalizeSection, setBeheerAccounts, setBeheerFamilies, barBalance } from "./screens/shared.js";
export { MESSAGE_TEMPLATES } from "./screens/edition.js";

export function renderBeheer({ section, notice = "", platformHtml }) {
  const active = normalizeSection(section);
  const content =
    active === "users"
      ? renderUsers()
      : active === "settings"
        ? renderSettings()
        : state.beheerEventView === "edition"
          ? renderEdition()
          : renderEvents();
  const nav = joinHtml(
    SECTIONS.map(
      entry =>
        html`<button type="button" data-section="${entry.id}" aria-current="${entry.id === active ? "page" : "false"}">
          <span aria-hidden="true">${entry.icon}</span>${entry.label}</button>`
    ),
    ""
  );
  return html`<div class="bh-app">
        <header class="bh-top">
          <div class="bh-brand">
            <span class="bh-brand-mark" aria-hidden="true">✳</span>
            <span>
              <strong>Evenementen</strong>
              <small>Beheer · datuur.be</small>
            </span>
          </div>
          <button type="button" class="bh-btn bh-btn-ghost" data-action="admin-logout">Afmelden</button>
        </header>
        <nav class="bh-nav" aria-label="Beheer">${nav}</nav>
        <main class="bh-main content">${
          notice
            ? html`<div class="bh-alert"
            role="alert">${notice}</div>`
            : ""
        }${content}</main>
      </div>`;
}
