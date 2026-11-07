// Tab Overzicht: wat staat er nog open, aftelling, kerncijfers.
import { html, euro } from "../../../utils/html.js";
import { countByType } from "../../../utils/member-types.js";
import { portionsOf, settlementHero, countdownCard } from "./shared.js";

export function renderOverview(item) {
  const members = item.registration.members || [];
  const finance = item.finance;
  const portions = members.reduce((sum, person) => sum + portionsOf(person), 0);
  const kinds = countByType(members);
  return html`${settlementHero(finance)}${countdownCard(item)}<div class="fa-stats">
        <button type="button" class="fa-stat" data-tab-target="family" aria-label="Gezin bekijken">
          <span class="fa-stat-icon" aria-hidden="true">👨‍👩‍👧</span>
          <strong>${members.length}</strong>
          <small>${members.length === 1 ? "deelnemer" : "deelnemers"} · ${kinds.adults} volw.
              · ${kinds.children} kind.${kinds.evening ? " · " + kinds.evening + " avondg." : ""}</small>
          <em>Gezin <i aria-hidden="true">›</i>
          </em>
        </button>
        <button type="button" class="fa-stat" data-tab-target="order" aria-label="Bestelling aanpassen">
          <span class="fa-stat-icon" aria-hidden="true">🍖</span>
          <strong>${portions}</strong>
          <small>vleesporties</small>
          <em>Bestellen <i aria-hidden="true">›</i>
          </em>
        </button>
        <button type="button" class="fa-stat" data-tab-target="costs" aria-label="Berekening bekijken">
          <span class="fa-stat-icon" aria-hidden="true">€</span>
          <strong>${euro(finance?.totals?.shareCents || 0)}</strong>
          <small>ons aandeel</small>
          <em>Berekening <i aria-hidden="true">›</i>
          </em>
        </button>
      </div>${
        members.length
          ? ""
          : html`<p class="fa-empty">Voeg eerst jullie gezinsleden toe via <button type="button" class="fa-inline-link"
              data-tab-target="family">Gezin</button>.</p>`
      }`;
}
