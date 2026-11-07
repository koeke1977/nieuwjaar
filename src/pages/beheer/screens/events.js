// Evenementen: lijst van evenementen en het kader van één editie (tabs).
import { state } from "../../../data/admin-store.js";
import { html, joinHtml, euro, plural } from "../../../utils/html.js";
import { eventTotals, pageHead, editionTab, eventName, editionName, statusChip, EDITION_TABS } from "./shared.js";
import { renderFamilies } from "./families.js";
import { renderOrder } from "./order.js";
import { renderFinance } from "./finance.js";
import { renderProducts, renderEventSettings } from "./edition.js";
import { renderBar } from "./bar.js";
import { renderCash } from "./cash.js";
import { renderOverview } from "./overview.js";

// ---------------- Evenementen ----------------
export function renderEvents() {
  const events = state.events || [];
  const cards = joinHtml(
    events.map(event => {
      const editions = event.editions || [];
      const rows = joinHtml(
        editions.map(edition => {
          const loaded = edition.id === state.activeEditionId;
          const t = loaded ? eventTotals() : null;
          const stats = t
            ? html`<span class="bh-edition-stats">
                <span>
                  <b>${t.families}</b> gezinnen</span>
                <span>
                  <b>${t.people}</b> deelnemers</span>
                <span>
                  <b>${t.portions}</b> porties</span>
                <span>
                  <b>${euro(t.outstanding)}</b> open</span>
              </span>`
            : html`<span class="bh-edition-stats">
              </span>`;
          return html`<button type="button"
              class="bh-edition-row${edition.status === "archived" ? " bh-edition-archived" : ""}"
              data-action="open-edition" data-id="${edition.id}">
                <span class="bh-edition-label">
                  <strong>${edition.label}</strong>
                  <small>${edition.status === "archived" ? "Afgesloten editie" : "Actieve editie"}${loaded ? " · geopend" : ""}</small>
                </span>${stats}<span class="bh-btn${edition.status === "archived" ? "" : " bh-btn-primary"}">Openen
                    ›</span>
              </button>`;
        }),
        ""
      );
      return html`<article class="bh-card bh-event-card">
            <header class="bh-card-head">
              <div>
                <h2 class="bh-event-name">${event.name}</h2>
                <small class="bh-muted">${plural(editions.length, "editie", "edities")}</small>
              </div>${
                event.status === "archived"
                  ? html`<span class="bh-chip">Afgesloten</span>`
                  : html`<span class="bh-chip bh-chip-ok">Actief</span>`
              }</header>${rows || html`<p class="bh-empty">Nog geen edities.</p>`}</article>`;
    }),
    ""
  );
  return html`${pageHead(
    "Evenementen",
    "Elk evenement komt terug in edities. Open een editie om inschrijvingen, bestellingen en financiën te beheren."
  )}${cards || html`<p class="bh-empty">Nog geen evenementen.</p>`}<details class="bh-card bh-card-dashed bh-add">
        <summary>+ Nieuw evenement</summary>
        <p class="bh-note">Bijvoorbeeld een BBQ of schoolfeest. Gezinnen en accounts worden gedeeld over alle
            evenementen; per editie schrijven ze zich in.</p>
        <form id="create-event-form" class="bh-form-grid">
          <label>Naam evenement<input name="eventName" maxlength="80" placeholder="Bijvoorbeeld: Zomer-BBQ" required>
          </label>
          <label>Eerste editie<input name="editionName" maxlength="80" placeholder="Bijvoorbeeld: 2027" required>
          </label>
          <div class="bh-actions bh-span-2">
            <button type="submit" class="bh-btn bh-btn-primary">Evenement aanmaken</button>
          </div>
        </form>
      </details>`;
}

export function renderEdition() {
  const tab = editionTab();
  const body =
    tab === "registrations"
      ? renderFamilies()
      : tab === "order"
        ? renderOrder()
        : tab === "finance"
          ? renderFinance()
          : tab === "products"
            ? renderProducts()
            : tab === "edition"
              ? renderEventSettings()
              : tab === "bar"
                ? renderBar()
                : tab === "cash"
                  ? renderCash()
                  : renderOverview();
  return html`<nav class="bh-crumbs" aria-label="Kruimelpad">
        <button type="button" class="bh-link" data-action="close-edition">Evenementen</button>
        <span aria-hidden="true">›</span>
        <span>${eventName()}</span>
        <span aria-hidden="true">›</span>
        <strong>${editionName()}</strong>
      </nav>
      <header class="bh-edition-head">
        <div>
          <p class="bh-eyebrow">${eventName()}</p>
          <h1>Editie ${editionName()}</h1>
        </div>
        <div class="bh-page-actions">${
          state.editionStatus === "archived"
            ? html`<span class="bh-chip">Afgesloten
            editie</span>`
            : ""
        }${statusChip()}</div>
      </header>
      <nav class="bh-subtabs bh-subtabs-sticky" aria-label="Editie">${joinHtml(
        EDITION_TABS.map(
          entry =>
            html`<button type="button" data-action="edition-tab" data-tab="${entry.id}"
                aria-current="${entry.id === tab}">${entry.label}</button>`
        ),
        ""
      )}</nav>${body}`;
}
