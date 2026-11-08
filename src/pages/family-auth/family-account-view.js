// Familieportaal (aangemeld): kop, keuze van evenement en de tabs. Elke tab staat in ./screens/.
// Pure functions: data in, HTML out. All figures come from the server-side finance breakdown (cents).
import { html, joinHtml } from "../../utils/html.js";
import { TABS, countdownChip, statusChip } from "./screens/shared.js";
import { renderFamily } from "./screens/family.js";
import { renderOrder } from "./screens/order.js";
import { renderCosts } from "./screens/costs.js";
import { renderOverview } from "./screens/overview.js";
import { renderSettings } from "./screens/account.js";
export { TABS } from "./screens/shared.js";

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

export function renderAccount({ user, items, activeId, view, openEditions = [], settings = null }) {
  const name = user?.displayName || "";
  const top = html`<header class="fa-top">
        <div>
          <p class="fa-eyebrow">Familieportaal</p>
          <h1>${name ? "Hallo, " + name : "Welkom"}</h1>${user?.email ? html`<small>${user.email}</small>` : ""}</div>
        <div class="fa-top-actions">
          <button type="button" class="fa-btn fa-btn-quiet" data-action="open-settings">Mijn account</button>
          <button type="button" class="fa-btn fa-btn-quiet" data-action="logout">Afmelden</button>
        </div>
      </header>`;
  if (view?.settingsOpen) return html`${top}${renderSettings(user, settings)}`;
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
