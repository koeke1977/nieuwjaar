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
  const ordered = catalog
    .map(product => ({
      name: product.name,
      count: members.reduce((sum, person) => sum + (Number(person.orders?.[product.id]) || 0), 0)
    }))
    .filter(product => product.count);
  // Opens by itself: the first person who still has to order, or else the first at dinner.
  const dinner = members.filter(person => person.type !== EVENING);
  const firstOpen = (dinner.find(person => !portionsOf(person)) || dinner[0])?.id;
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
                <span class="fa-stepper-product">${
                  product.image
                    ? html`<img src="${product.image}" alt="" loading="lazy">`
                    : html`<i aria-hidden="true">🍖</i>`
                }${product.name}</span>${
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
      const open = view.openPeople ? view.openPeople.has(person.id) : members.length <= 2 || person.id === firstOpen;
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
        <p>Tik op een naam en kies met − en +. Alles wordt meteen bewaard.</p>
      </div>
      <p class="fa-order-total">Samen <strong>${plural(familyTotal, UNITS.meat)}</strong>${joinHtml(
        ordered.map(product => html`<span>✓ ${product.name} ${product.count}</span>`),
        ""
      )}</p>
      <div class="fa-list">${people}</div>`;
}
