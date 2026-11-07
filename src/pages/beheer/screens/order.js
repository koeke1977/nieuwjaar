// Editie → Bestelling: totalen per product, allergieën, bestellen voor een gezin.
import { state } from "../../../data/admin-store.js";
import { DIET_OPTIONS, hasDiet } from "../../../utils/diet.js";
import { EVENING } from "../../../utils/member-types.js";
import { ordersClosed } from "../../../utils/time.js";
import { html, joinHtml, plural } from "../../../utils/html.js";
import { dietChips, familyPortions, portionsOf, pageHead } from "./shared.js";
import { deadlineText } from "./edition.js";

// ---------------- Bestelling ----------------
function renderDietOverview() {
  const rows = (state.registrations || []).flatMap(reg =>
    (reg.members || []).filter(hasDiet).map(person => ({ reg, person }))
  );
  if (!rows.length)
    return html`<section class="bh-card">
        <header class="bh-card-head">
          <h2>Allergieën & opmerkingen</h2>
        </header>
        <p class="bh-empty">Nog geen allergieën of opmerkingen doorgegeven.</p>
      </section>`;
  const counts = DIET_OPTIONS.map(option => [
    option,
    rows.filter(row => (row.person.diet || []).includes(option)).length
  ]).filter(([, n]) => n);
  return html`<section class="bh-card">
        <header class="bh-card-head">
          <h2>Allergieën & opmerkingen</h2>
          <span class="bh-count">${rows.length}</span>
        </header>${
          counts.length
            ? html`<div class="bh-member-costs">${joinHtml(
                counts.map(
                  ([option, n]) => html`<span>${option} <b>${n}</b>
          </span>`
                ),
                ""
              )}</div>`
            : ""
        }<ul class="bh-lines">${joinHtml(
          rows.map(
            ({ reg, person }) =>
              html`<li>
              <span>
                <strong>${person.name}</strong>
                <small>${reg.name}${person.type === "Kind" ? " · kind" : ""}</small>
              </span>${dietChips(person)}</li>`
          ),
          ""
        )}</ul>
      </section>`;
}

// Admin fills in the order on behalf of a family (e.g. someone who does not use the app).
function orderForFamilyCard() {
  const regs = [...(state.registrations || [])].sort((a, b) => String(a.name).localeCompare(String(b.name), "nl"));
  if (!regs.length) return "";
  return html`<section class="bh-card bh-order-for">
        <form id="order-for-family-form" class="bh-inline-form">
          <label for="bh-order-family">Bestelling invullen voor een gezin</label>
          <div>
            <select id="bh-order-family" name="registrationId" required>
              <option value="">Kies een gezin</option>${joinHtml(
                regs.map(
                  reg =>
                    html`<option
                        value="${reg.id}">${reg.name} — ${plural(familyPortions(reg), "portie", "porties")}</option>`
                ),
                ""
              )}</select>
            <button type="submit" class="bh-btn bh-btn-primary">Bestelling invullen</button>
          </div>
          <small class="bh-muted">Voor gezinnen die liever niet zelf met de app werken. Staat het gezin er nog niet
              in? <button type="button" class="bh-link" data-action="edition-tab" data-tab="registrations">Schrijf het
              eerst in</button>.</small>
        </form>
      </section>`;
}

// Mail the totals per product (no names) to the butcher, from registratie@datuur.be.
function butcherForm(total) {
  const sentAt = state.butcherSentAt
    ? new Date(state.butcherSentAt * 1000).toLocaleString("nl-BE", { dateStyle: "medium", timeStyle: "short" })
    : "";
  return html`<form id="butcher-mail-form" class="bh-form-grid bh-form-compact bh-butcher">
      <label>E-mail van de slager<input name="recipient" type="email" maxlength="254" autocomplete="email"
          value="${state.butcherEmail || ""}" placeholder="slager@voorbeeld.be" required>
      </label>
      <label class="bh-span-2">Bericht (optioneel)<textarea name="note" rows="3" maxlength="2000"
          placeholder="Bijvoorbeeld: we halen af op 31 december om 10 uur."></textarea>
      </label>
      <div class="bh-actions bh-span-2">
        <button type="submit" class="bh-btn bh-btn-primary"${total ? "" : " disabled"}>✉ Bestelling mailen</button>
        <small class="bh-muted">Alleen de totalen per product, zonder namen. Verstuurd vanuit
          registratie@datuur.be.${sentAt ? " Laatst verstuurd op " + sentAt + "." : ""}</small>
      </div>
    </form>`;
}

export function renderOrder() {
  const regs = state.registrations || [];
  const products = state.catalog.filter(
    product => product.active || regs.some(r => (r.members || []).some(p => Number(p.orders?.[product.id]) > 0))
  );
  const countFor = (members, productId) =>
    members.reduce((sum, person) => sum + (Number(person.orders?.[productId]) || 0), 0);
  const allMembers = regs.flatMap(r => r.members || []);
  const total = allMembers.reduce((sum, person) => sum + portionsOf(person), 0);
  const cards = joinHtml(
    products.map(product => {
      const count = countFor(allMembers, product.id);
      return html`<article class="bh-product">
            <div class="bh-product-img">${
              product.image
                ? html`<img src="${product.image}" alt=""
                loading="lazy">`
                : html`<span>🍖</span>`
            }</div>
            <div>
              <strong>${product.name}</strong>
              <b>${count}</b>
            </div>
          </article>`;
    }),
    ""
  );
  const head = html`<tr>
        <th>Gezin</th>${joinHtml(
          products.map(product => html`<th>${product.name}</th>`),
          ""
        )}<th>Totaal</th>
      </tr>`;
  const body = joinHtml(
    regs.map(reg => {
      const members = reg.members || [];
      const cells = joinHtml(
        products.map(product => {
          const c = countFor(members, product.id);
          return html`<td>${c || html`<span class="bh-dim">–</span>`}</td>`;
        }),
        ""
      );
      const memberRows = joinHtml(
        members.map(
          person =>
            html`<tr class="bh-sub-row">
                <td>${person.name}${
                  person.type !== "Volwassene"
                    ? html` <small>(${person.type === EVENING ? "avondgast" : "kind"})</small>`
                    : ""
                }</td>${joinHtml(
                  products.map(product => {
                    const c = Number(person.orders?.[product.id]) || 0;
                    return html`<td>${c || html`<span class="bh-dim">–</span>`}</td>`;
                  }),
                  ""
                )}<td>${portionsOf(person)}</td>
              </tr>`
        ),
        ""
      );
      return html`<tbody class="bh-group">
            <tr class="bh-group-row">
              <th scope="row">
                <button type="button" class="bh-link" data-action="open-family" data-id="${reg.id}">${reg.name}</button>
              </th>${cells}<td>
                <b>${familyPortions(reg)}</b>
              </td>
            </tr>${memberRows}</tbody>`;
    }),
    ""
  );
  const foot = html`<tfoot>
        <tr>
          <th>Totaal</th>${joinHtml(
            products.map(product => html`<th>${countFor(allMembers, product.id)}</th>`),
            ""
          )}<th>${total}</th>
        </tr>
      </tfoot>`;
  const deadlineBanner = !state.orderDeadline
    ? html`<p class="bh-alert bh-alert-info">Er is geen einddatum om te bestellen. Stel er een in bij <button
        type="button" class="bh-link" data-action="edition-tab" data-tab="edition">Editie</button>.</p>`
    : ordersClosed(state.orderDeadline)
      ? html`<p class="bh-alert">🔒 Bestellen is gesloten sinds ${deadlineText()}. Gezinnen kunnen niets meer wijzigen;
          jij kan dat als beheerder nog wel.</p>`
      : html`<p class="bh-alert bh-alert-info">Gezinnen kunnen bestellen tot ${deadlineText()}.</p>`;
  return html`${deadlineBanner}${pageHead(
    "Bestelling",
    plural(total, "portie", "porties") +
      " in totaal, door " +
      plural(regs.filter(r => familyPortions(r) > 0).length, "gezin", "gezinnen") +
      ".",
    html`<button type="button" class="bh-btn" data-action="print">Afdrukken</button>`
  )}${orderForFamilyCard()}<section class="bh-card">
        <header class="bh-card-head">
          <h2>Voor de slager</h2>
        </header>
        <div class="bh-products">${cards || html`<p class="bh-empty">Geen producten.</p>`}</div>${butcherForm(total)}
      </section>
      <section class="bh-card">
        <header class="bh-card-head">
          <h2>Wie bestelde wat?</h2>
        </header>${
          regs.length
            ? html`<div class="bh-table-wrap">
          <table class="bh-table">
            <thead>${head}</thead>${body}${foot}</table>
        </div>`
            : html`<p class="bh-empty">Nog geen gezinnen.</p>`
        }</section>${renderDietOverview()}`;
}
