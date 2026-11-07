// Editie → Producten en Editie: producten, instellingen, bericht aan gezinnen, volgende editie.
import { state } from "../../../data/admin-store.js";
import { localToDate } from "../../../utils/time.js";
import { html, joinHtml, plural } from "../../../utils/html.js";
import { eventTitle, familyPortions, accountsForFamily, eventName, editionName } from "./shared.js";

// ---------------- Producten & editie ----------------

export function renderProducts() {
  const rows = joinHtml(
    state.catalog.map(
      item =>
        html`<li class="bh-product-row">
            <div class="bh-product-thumb">${
              item.image
                ? html`<img src="${item.image}"
                alt="">`
                : html`<span>🍖</span>`
            }</div>
            <span class="bh-family-name">
              <strong>${item.name}</strong>
              <small>${item.active ? "Zichtbaar voor gezinnen" : "Verborgen voor gezinnen"}</small>
            </span>
            <div class="bh-actions catalog-admin-actions">
              <label class="bh-btn bh-btn-sm"
                  for="photo-${item.id}">${item.image ? "Foto wijzigen" : "Foto toevoegen"}</label>
              <input class="visually-hidden" id="photo-${item.id}" type="file" accept="image/png,image/jpeg,image/webp"
                  data-upload-image="${item.id}">${
                    item.image
                      ? html`<button type="button" class="bh-btn bh-btn-sm" data-action="remove-image"
                      data-id="${item.id}">Foto wissen</button>`
                      : ""
                  }<button type="button" class="bh-btn bh-btn-sm${item.active ? "" : " bh-btn-primary"}"
                  data-action="toggle-product" data-id="${item.id}">${item.active ? "Verbergen" : "Tonen"}</button>
            </div>
          </li>`
    ),
    ""
  );
  return html`<section class="bh-card">
        <header class="bh-card-head">
          <h2>Producten</h2>
          <span class="bh-count">${state.catalog.length}</span>
        </header>
        <ul class="bh-product-list">${rows}</ul>
        <form id="add-product-form" class="bh-inline-form">
          <label for="new-product-name">Nieuw product</label>
          <div>
            <input id="new-product-name" name="productName" maxlength="60" placeholder="Bijvoorbeeld: Kippenbrochette"
                required>
            <button type="submit" class="bh-btn bh-btn-primary">+ Toevoegen</button>
          </div>
        </form>
      </section>`;
}

export const deadlineText = () => {
  const date = state.orderDeadline ? localToDate(state.orderDeadline) : null;
  return date
    ? date.toLocaleDateString("nl-BE", {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: "Europe/Brussels"
      }) +
        " om " +
        date.toLocaleTimeString("nl-BE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" })
    : "";
};

export const MESSAGE_TEMPLATES = {
  reminder: {
    subject: () => eventTitle() + ": vergeet niet te bestellen",
    message: () =>
      "We zien dat jullie nog geen vlees besteld hebben voor " +
      eventTitle() +
      ".\n\n" +
      (state.orderDeadline ? "Bestellen kan nog tot " + deadlineText() + ". " : "") +
      "Meld je aan in het familieportaal, kies per persoon wat je wil eten, en klaar.\n\nTot op het feest!"
  },
  info: {
    subject: () => "Praktische info voor " + eventTitle(),
    message: () =>
      "Het feest komt eraan!\n\nWanneer: \nWaar: \nWat breng je mee: \n\nDe bar werkt met streepjes: neem je een drankje, zet dan een streepje achter je naam. Na het feest tellen we alles op en verrekenen we het in jullie afrekening.\n\nTot dan!"
  }
};

function recipientCount(audience) {
  const regs = (state.registrations || []).filter(reg => audience !== "no-order" || !familyPortions(reg));
  const emails = new Set();
  for (const reg of regs)
    for (const user of accountsForFamily(reg.familyId)) if (user.status !== "disabled") emails.add(user.email);
  return { families: regs.length, people: emails.size };
}

function renderMessageCard() {
  const all = recipientCount("all"),
    noOrder = recipientCount("no-order");
  const draft = state.beheerMessageDraft || {};
  return html`<section class="bh-card">
        <header class="bh-card-head">
          <h2>Bericht aan gezinnen</h2>
        </header>
        <p class="bh-note">Verstuur een e-mail vanaf registratie@datuur.be naar de gezinnen van deze editie, met een knop
            naar het familieportaal.</p>
        <div class="bh-actions">
          <button type="button" class="bh-btn bh-btn-sm" data-action="message-template"
              data-template="reminder">Herinnering bestellen</button>
          <button type="button" class="bh-btn bh-btn-sm" data-action="message-template" data-template="info">Praktische
              info</button>
        </div>
        <form id="family-message-form" class="bh-form-grid">
          <label class="bh-span-2">Naar<select name="audience">
              <option value="all"${draft.audience !== "no-order" ? " selected" : ""}>Alle ingeschreven gezinnen
                  (${plural(all.people, "ontvanger", "ontvangers")})</option>
              <option value="no-order"${draft.audience === "no-order" ? " selected" : ""}>Alleen gezinnen zonder
                  bestelling (${plural(noOrder.people, "ontvanger", "ontvangers")})</option>
            </select>
          </label>
          <label class="bh-span-2">Onderwerp<input name="subject" maxlength="150" value="${draft.subject || ""}"
              required>
          </label>
          <label class="bh-span-2">Bericht<textarea name="message" rows="8" maxlength="5000"
              required>${draft.message || ""}</textarea>
          </label>
          <p class="bh-note bh-span-2">Elke ontvanger krijgt "Dag [naam]," bovenaan en "Groeten, de organisatie
              van ${eventTitle()}" onderaan. Alleen gezinnen met een account ontvangen het bericht.</p>
          <div class="bh-actions bh-span-2">
            <button type="submit" class="bh-btn bh-btn-primary">Bericht versturen</button>
          </div>
        </form>
      </section>`;
}

export function renderEventSettings() {
  const event = (state.events || []).find(item => item.id === state.activeEventId);
  const others = (event?.editions || []).filter(edition => edition.id !== state.activeEditionId);
  const archived = state.editionStatus === "archived";
  const editionCounts = [
    plural((state.registrations || []).length, "gezin", "gezinnen"),
    plural((state.expenses || []).length, "kost", "kosten"),
    plural((state.payments || []).length, "betaling", "betalingen")
  ].join(" · ");
  const otherRows = joinHtml(
    others.map(
      edition =>
        html`<li>
            <span>
              <strong>${edition.label}</strong>
              <small>${edition.status === "archived" ? "Afgesloten" : "Actief"}</small>
            </span>
            <button type="button" class="bh-btn bh-btn-sm" data-action="open-edition" data-id="${edition.id}">Openen
                ›</button>
          </li>`
    ),
    ""
  );
  return html`<section class="bh-card">
        <header class="bh-card-head">
          <h2>Evenement & editie</h2>${
            archived
              ? html`<span class="bh-chip">Afgesloten</span>`
              : html`<span
              class="bh-chip bh-chip-ok">Actief</span>`
          }</header>
        <p class="bh-note">Een evenement komt terug in <strong>edities</strong>. Gezinnen en hun accounts blijven
            bestaan; per editie schrijven ze zich opnieuw in, met hun eigen bestellingen, kosten en betalingen.</p>
        <form id="event-settings-form" class="bh-form-grid">
          <label>Evenement<input name="eventName" maxlength="80" value="${eventName()}" placeholder="Bijvoorbeeld:
              Nieuwjaar" required>
          </label>
          <label>Deze editie<input name="editionName" maxlength="80" value="${editionName()}" placeholder="Bijvoorbeeld:
              2026–2027" required>
          </label>
          <label class="bh-span-2">Bestellen kan tot<input name="orderDeadline" type="datetime-local" value="${
            state.orderDeadline
              ? state.orderDeadline.length === 10
                ? state.orderDeadline + "T23:59"
                : state.orderDeadline
              : ""
          }">
            <small class="bh-muted">Daarna kunnen gezinnen hun bestelling niet meer wijzigen (jij als beheerder wel).
                Leeg laten = altijd open.</small>
          </label>
          <label class="bh-span-2">Datum en uur van het feest<input name="startsAt" type="datetime-local"
              value="${state.startsAt ? (state.startsAt.length === 10 ? state.startsAt + "T20:00" : state.startsAt) : ""}">
            <small class="bh-muted">Gezinnen zien hiermee een aftelling in hun portaal.</small>
          </label>
          <div class="bh-actions bh-span-2">
            <button type="submit" class="bh-btn bh-btn-primary">Namen bewaren</button>
          </div>
        </form>
        <p class="bh-note">${editionCounts} in deze editie.</p>
      </section>${archived ? "" : renderMessageCard()}${
        archived
          ? ""
          : html`<section class="bh-card">
          <header class="bh-card-head">
            <h2>Volgende editie starten</h2>
          </header>
          <p class="bh-note">Doe dit pas als ${eventTitle()} volledig is afgerond. Deze editie wordt dan afgesloten (je
              kan ze nog altijd openen). Gezinnen en accounts blijven bestaan en kunnen zich inschrijven voor de nieuwe
              editie.</p>
          <form id="new-edition-form" class="bh-form-grid">
            <label class="bh-span-2">Naam nieuwe editie<input name="editionName" maxlength="80"
                placeholder="Bijvoorbeeld: 2027–2028" required>
            </label>
            <label class="bh-check bh-span-2">
              <input type="checkbox" name="copyCatalog" checked> Producten en foto's overnemen</label>
            <div class="bh-actions bh-span-2">
              <button type="submit" class="bh-btn bh-btn-danger">Afsluiten & nieuwe editie starten</button>
            </div>
          </form>
        </section>`
      }<section class="bh-card">
        <header class="bh-card-head">
          <h2>Andere edities van ${eventName()}</h2>
          <span class="bh-count">${others.length}</span>
        </header>${
          otherRows
            ? html`<ul class="bh-lines">${otherRows}</ul>`
            : html`<p class="bh-empty">Nog geen andere
            edities.</p>`
        }</section>`;
}
