// Helpers shared by the portal tabs: deadline, countdown, tabs, chips, the settlement hero.
import { html, joinHtml, euro } from "../../../utils/html.js";
import { hasDiet } from "../../../utils/diet.js";
import { countdownState, formatEventDate } from "../countdown.js";
import { localToDate } from "../../../utils/time.js";

export const percentFormat = new Intl.NumberFormat("nl-BE", { style: "percent", maximumFractionDigits: 1 });
export const portionsOf = person =>
  Object.values(person?.orders || {}).reduce((sum, qty) => sum + (Number(qty) || 0), 0);

export const deadlineLabel = deadline => {
  const date = deadline ? localToDate(deadline) : null;
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
export const daysLeft = deadline => {
  const date = deadline ? localToDate(deadline) : null;
  return date ? Math.ceil((date.getTime() - Date.now()) / 86400000) : null;
};

// Countdown card on the overview; numbers are refreshed every second by family-auth.js.
export function countdownCard(item) {
  const state = countdownState(item.startsAt, item.event || "het feest");
  if (!state || state.phase === "over") return "";
  const p = state.parts;
  const clock = p
    ? html`<div class="fa-count-clock" aria-hidden="true">${joinHtml(
        [
          [p.days, "dagen"],
          [p.hours, "uur"],
          [p.minutes, "min"],
          [p.seconds, "sec"]
        ].map(
          ([n, label], i) =>
            html`<span>
                <b data-count-part="${i}">${String(n).padStart(i ? 2 : 1, "0")}</b>
                <small>${label}</small>
              </span>`
        ),
        ""
      )}</div>`
    : "";
  return html`<section class="fa-countdown fa-countdown-${state.phase}" data-countdown="${item.startsAt}"
      data-countdown-event="${item.event || "het feest"}">
        <p class="fa-eyebrow">${formatEventDate(item.startsAt)}</p>
        <h3 data-count-text>${state.text}</h3>${clock}</section>`;
}
export function countdownChip(item) {
  const state = countdownState(item.startsAt, item.event || "het feest");
  return state && state.phase !== "over"
    ? html`<span class="fa-chip fa-chip-count" data-countdown-chip="${item.startsAt}">${state.short}</span>`
    : "";
}
export const dietChips = person =>
  hasDiet(person)
    ? html`<div class="fa-diet">${joinHtml(
        (person.diet || []).map(item => html`<span>${item}</span>`),
        ""
      )}${person.notes ? html`<em>${person.notes}</em>` : ""}</div>`
    : "";
export const METHOD_CHOICES = [
  ["general", "Algemeen — iedereen, ook kinderen (zaal, decoratie, frisdrank)"],
  ["adults", "18+ — alleen volwassenen (alcohol, cava)"],
  ["meat", "Vlees — volgens bestelde porties"],
  ["bar", "Aankoop voor de bar — wordt niet verdeeld; de barrekeningen dekken het"]
];

export const TABS = [
  { id: "overview", label: "Overzicht" },
  { id: "family", label: "Gezin" },
  { id: "order", label: "Bestelling" },
  { id: "costs", label: "Kosten" }
];

export const UNITS = {
  general: ["persoon", "personen"],
  adults: ["volwassene", "volwassenen"],
  meat: ["portie", "porties"],
  bar: ["persoon", "personen"]
};

export function statusChip(finance) {
  if (!finance) return "";
  return finance.finalized
    ? html`<span class="fa-chip fa-chip-final">Definitief</span>`
    : html`<span class="fa-chip fa-chip-provisional">Voorlopig</span>`;
}

// The single most important answer for a family: what do we still owe or get back?
export function settlementHero(finance) {
  if (!finance || !finance.expenses?.length) {
    return html`<div class="fa-hero fa-hero-neutral">
        <small>Afrekening</small>
        <strong>Nog geen kosten</strong>
        <p>Zodra de organisatie kosten invoert, zie je hier meteen jullie aandeel.</p>
      </div>`;
  }
  const t = finance.totals;
  const note = finance.finalized
    ? "Alle kosten zijn bevestigd door de organisatie."
    : "Voorlopig bedrag: er kunnen nog kosten bijkomen.";
  if (t.remainingCents > 0) {
    return html`<div class="fa-hero fa-hero-due">
          <small>Nog te betalen</small>
          <strong>${euro(t.remainingCents)}</strong>
          <p>${note}</p>
        </div>`;
  }
  if (t.creditCents > 0) {
    return html`<div class="fa-hero fa-hero-credit">
          <small>Jullie krijgen terug</small>
          <strong>${euro(t.creditCents)}</strong>
          <p>Jullie schoten meer voor dan jullie aandeel. ${note}</p>
        </div>`;
  }
  return html`<div class="fa-hero fa-hero-ok">
        <small>Afrekening</small>
        <strong>Alles in orde</strong>
        <p>Er staat niets meer open. ${note}</p>
      </div>`;
}
