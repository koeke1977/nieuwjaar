// Editie → Overzicht: KPI's, aandachtspunten, bestelling en kosten in één oogopslag.
import { state } from "../../../data/admin-store.js";
import { html, joinHtml, euro, plural } from "../../../utils/html.js";
import { COST_ICON, COST_METHODS } from "../../../utils/finance.js";
import { eventTotals, familyPortions, accountsForFamily, pageHead, statusChip, kpi } from "./shared.js";
import { renderActivityCard } from "./activity.js";

// ---------------- Dashboard ----------------
export function renderOverview() {
  const t = eventTotals();
  const regs = state.registrations || [];
  const attention = [];
  for (const reg of regs) {
    const row = t.summary.find(item => item.id === reg.id);
    const reasons = [];
    if (state.cancelRequests?.[reg.id]) reasons.push("📨 wil zich afmelden");
    if (!(reg.members || []).length) reasons.push("nog geen gezinsleden");
    else if (!familyPortions(reg)) reasons.push("nog geen vleesbestelling");
    if (!accountsForFamily(reg.familyId).length) reasons.push("geen account");
    if (row?.remainingCents > 0) reasons.push(euro(row.remainingCents) + " openstaand");
    if (reasons.length)
      attention.push(
        html`<li>
            <button type="button" data-action="open-family" data-id="${reg.id}">
              <strong>${reg.name}</strong>
              <span>${reasons.join(" · ")}</span>
              <i aria-hidden="true">›</i>
            </button>
          </li>`
      );
  }
  const meat = state.catalog
    .map(product => ({
      name: product.name,
      count: regs.reduce(
        (sum, r) => sum + (r.members || []).reduce((s, p) => s + (Number(p.orders?.[product.id]) || 0), 0),
        0
      )
    }))
    .filter(item => item.count > 0)
    .sort((a, b) => b.count - a.count);
  const maxMeat = Math.max(1, ...meat.map(item => item.count));
  const byMethod = Object.keys(COST_METHODS)
    .map(method => ({
      method,
      cents: (state.expenses || [])
        .filter(e => e.method === method)
        .reduce((s, e) => s + (Number(e.amountCents) || 0), 0)
    }))
    .filter(row => row.cents > 0);
  const progress = t.received + t.outstanding > 0 ? Math.round((t.received / (t.received + t.outstanding)) * 100) : 0;
  return html`${pageHead("Overzicht", "De stand van deze editie in één oogopslag.", statusChip())}<section
      class="bh-kpis">${kpi(t.families, "gezinnen", "", "families")}${kpi(
        t.people,
        "aan tafel",
        t.adults +
          " volwassenen · " +
          t.children +
          " kinderen" +
          (t.evening ? " · + " + t.evening + " avondgasten" : ""),
        "families"
      )}${kpi(
        t.portions,
        "vleesporties",
        meat.length ? plural(meat.length, "product", "producten") : "nog niets besteld",
        "order"
      )}${kpi(euro(t.costs), "kosten", plural((state.expenses || []).length, "uitgave", "uitgaven"), "finance")}${kpi(
        euro(t.received),
        "ontvangen",
        t.received && t.outstanding ? progress + "% van het verschuldigde" : "",
        "finance"
      )}${kpi(euro(t.outstanding), "nog te ontvangen", t.toRefund ? euro(t.toRefund) + " terug te geven" : "", "finance")}</section>
      ${renderActivityCard()}<div class="bh-grid-2">
        <section class="bh-card">
          <header class="bh-card-head">
            <h2>Aandachtspunten</h2>
            <span class="bh-count">${attention.length}</span>
          </header>${
            attention.length
              ? html`<ul class="bh-attention">${attention}</ul>`
              : html`<p class="bh-empty">Alles is in orde. 🎉</p>`
          }</section>
        <section class="bh-card">
          <header class="bh-card-head">
            <h2>Vlees</h2>
            <button type="button" class="bh-link" data-action="edition-tab" data-tab="order">Volledig overzicht
                ›</button>
          </header>${
            meat.length
              ? html`<ul class="bh-bars">${joinHtml(
                  meat.map(
                    item =>
                      html`<li>
                  <span>${item.name}</span>
                  <div class="bh-bar">
                    <i style="width:${Math.round((item.count / maxMeat) * 100)}%">
                    </i>
                  </div>
                  <b>${item.count}</b>
                </li>`
                  ),
                  ""
                )}</ul>`
              : html`<p class="bh-empty">Nog geen bestellingen.</p>`
          }<header class="bh-card-head bh-card-head-sub">
            <h2>Kosten per soort</h2>
            <button type="button" class="bh-link" data-action="edition-tab" data-tab="finance">Financiën ›</button>
          </header>${
            byMethod.length
              ? html`<ul class="bh-lines">${joinHtml(
                  byMethod.map(
                    row =>
                      html`<li>
                  <span>${COST_ICON[row.method]} ${COST_METHODS[row.method].label}</span>
                  <b>${euro(row.cents)}</b>
                </li>`
                  ),
                  ""
                )}</ul>`
              : html`<p class="bh-empty">Nog geen kosten ingevoerd.</p>`
          }</section>
      </div>`;
}
