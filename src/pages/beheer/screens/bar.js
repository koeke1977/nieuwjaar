// Editie → Bar: persoonlijke barrekening per persoon en controle op € 0.
import { state, financeOptions } from "../../../data/admin-store.js";
import { barBufferCents } from "../../../utils/finance.js";
import { EVENING } from "../../../utils/member-types.js";
import { html, joinHtml, euro, plural } from "../../../utils/html.js";
import { barBalance, pageHead, kpi } from "./shared.js";

export function renderBar() {
  const regs = state.registrations || [];
  const barOf = person => Math.max(0, Number(person.barCents) || 0);
  const charged = regs.reduce((sum, reg) => sum + (reg.members || []).reduce((s, p) => s + barOf(p), 0), 0);
  const purchases = (state.expenses || [])
    .filter(expense => expense.method === "bar")
    .reduce((sum, expense) => sum + (Number(expense.amountCents) || 0), 0);
  const bar = barBalance(regs, state.expenses || []);
  const cards = joinHtml(
    regs.map(reg => {
      const familyBar = (reg.members || []).reduce((s, p) => s + barOf(p), 0);
      const rows = joinHtml(
        (reg.members || []).map(
          person =>
            html`<div class="bh-stepper-row">
                <span>${person.name}${
                  person.type !== "Volwassene"
                    ? html` <small class="bh-muted">(${person.type === EVENING ? "avondgast" : "kind"})</small>`
                    : ""
                }</span>
                <label class="bh-bar-amount">
                  <span aria-hidden="true">€</span>
                  <input type="number" min="0" step="0.01" inputmode="decimal"
                      value="${barOf(person) ? (barOf(person) / 100).toFixed(2) : ""}" placeholder="0,00" data-bar-input
                      data-registration="${reg.id}" data-person="${person.id}" aria-label="Barrekening
                      van ${person.name}">
                </label>
              </div>`
        ),
        ""
      );
      return html`<details class="bh-member"${familyBar ? "" : " open"}>
            <summary>
              <span class="bh-avatar bh-avatar-sm">${(reg.name || "?").charAt(0).toUpperCase()}</span>
              <span class="bh-family-name">
                <strong>${reg.name}</strong>
                <small>${plural((reg.members || []).length, "persoon", "personen")}</small>
              </span>
              <span class="bh-chip${familyBar ? " bh-chip-ok" : ""}">🍺 ${euro(familyBar)}</span>
              <i class="bh-chev" aria-hidden="true">›</i>
            </summary>
            <div class="bh-member-body">${rows || html`<p class="bh-empty">Nog geen gezinsleden.</p>`}</div>
          </details>`;
    }),
    ""
  );
  return html`${pageHead(
    "Bar",
    "Na het feest: vul per persoon het bedrag van zijn of haar barrekening in. Dat bedrag komt rechtstreeks op de afrekening van dat gezin."
  )}<section class="bh-kpis bh-kpis-4">${kpi(
    euro(charged),
    bar.buffer ? "aangerekend + " + euro(bar.buffer) + " barbuffer" : "aangerekend"
  )}${kpi(euro(purchases), "aankopen bar")}${kpi(
    bar.difference ? (bar.difference > 0 ? "+ " : "− ") + euro(Math.abs(bar.difference)) : "✓ € 0,00",
    bar.buffer
      ? bar.off
        ? "tekort, ook met de buffer"
        : "over → naar volgend jaar"
      : bar.difference
        ? "verschil (moet € 0,00 zijn)"
        : "verschil: sluitend"
  )}${kpi(regs.filter(reg => (reg.members || []).some(p => barOf(p))).length + "/" + regs.length, "gezinnen ingevuld")}</section>${
    bar.used
      ? html`<section class="bh-card bh-bar-check ${bar.off ? "is-off" : "is-ok"}">
          <div>
            <h2>${bar.off ? "De bar is nog niet sluitend" : bar.buffer ? "De bar is gedekt" : "De bar is sluitend"}</h2>
            <p>${
              bar.buffer
                ? "Barrekeningen " +
                  euro(charged) +
                  " + barbuffer " +
                  euro(bar.buffer) +
                  " − rekening van de drank " +
                  euro(purchases) +
                  " = " +
                  (bar.off
                    ? "tekort van " + euro(-bar.difference) + ". Controleer de barrekeningen en de rekening."
                    : euro(bar.difference) +
                      " over" +
                      (purchases
                        ? ": dat gaat naar volgend jaar."
                        : ". Er is nog geen rekening van de drank ingevoerd."))
                : bar.difference
                  ? (purchases
                      ? "Barrekeningen samen " + euro(charged) + ", rekening van de drank " + euro(purchases) + ". "
                      : "Er is nog geen rekening van de drank ingevoerd. ") +
                    (bar.difference > 0
                      ? "Er is " +
                        euro(bar.difference) +
                        " te veel aangerekend: verlaag een barrekening of voeg de ontbrekende rekening toe."
                      : "Er is nog " +
                        euro(-bar.difference) +
                        " niet aangerekend: verhoog de barrekeningen of controleer de rekening.")
                  : "Wat de drinkers betalen (" +
                    euro(charged) +
                    ") is exact de rekening die werd voorgeschoten. Het verschil is € 0,00."
            }</p>
          </div>
        </section>`
      : ""
  }<section class="bh-card">${
    bar.buffer
      ? html`<p class="bh-note">Barbuffer: iedereen betaalt ${euro(barBufferCents(financeOptions()))}
            bovenop de eigen barrekening, voor de streepjes die niemand zette (instellen bij Editie).</p>`
      : ""
  }
        <p class="bh-note">Elke persoon betaalt zijn eigen drankjes: het bedrag wordt <strong>niet verdeeld</strong> over
            de anderen. Kocht iemand de drank voor de bar aan? Voer die aankoop in bij Financiën als kost van het
            soort <strong>🍺 Aankoop voor de bar</strong>: die persoon krijgt het geld terug via de afrekening, en de
            aankoop zelf wordt gedekt door de barrekeningen.</p>
      </section>${
        cards
          ? html`<div class="bh-members">${cards}</div>`
          : html`<p class="bh-empty">Nog geen
          inschrijvingen.</p>`
      }`;
}
