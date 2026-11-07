// Tab Bestelling: vlees per persoon, met einddatum.
import { html, joinHtml, plural } from "../../../utils/html.js";
import { ordersClosed } from "../../../utils/time.js";
import { typeLabel, EVENING } from "../../../utils/member-types.js";
import { daysLeft, deadlineLabel, portionsOf, UNITS } from "./shared.js";
import { memberCostTotal } from "./family.js";

export function renderOrder(item, view) {
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
      return html`<details class="fa-order-person${portions ? "" : " fa-order-person-empty"}"
              data-order-person="${person.id}"${open ? " open" : ""}>
            <summary>
              <span class="fa-avatar">${(person.name || "?").charAt(0).toUpperCase()}</span>
              <span class="fa-member-name">
                <strong>${person.name}</strong>
                <small>${typeLabel(person.type)}<span
                    class="fa-portions-inline"> · ${portions ? plural(portions, UNITS.meat) : "nog niets besteld"}</span>
                </small>
              </span>
              <span class="fa-pill">${portions ? plural(portions, UNITS.meat) : "Nog niets besteld"}</span>${memberCostTotal(
                item,
                person
              )}</summary>
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
