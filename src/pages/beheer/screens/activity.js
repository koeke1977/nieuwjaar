// "Laatste activiteit": what families did, on the overview and per family. New lines are marked until
// the admin leaves the overview or clicks "Alles gezien" (state.activitySeenAt, kept per device).
import { state } from "../../../data/admin-store.js";
import { html, joinHtml, plural } from "../../../utils/html.js";

const SHOWN_FIRST = 15;

export const newActivityCount = () =>
  (state.activity || []).filter(entry => entry.at > (state.activitySeenAt || 0)).length;

const dayKey = seconds => new Date(seconds * 1000).toDateString();
function dayLabel(seconds, now = Date.now()) {
  const day = dayKey(seconds);
  if (day === new Date(now).toDateString()) return "Vandaag";
  if (day === new Date(now - 24 * 60 * 60 * 1000).toDateString()) return "Gisteren";
  return new Date(seconds * 1000).toLocaleDateString("nl-BE", { weekday: "long", day: "numeric", month: "long" });
}
const timeOf = seconds => new Date(seconds * 1000).toLocaleTimeString("nl-BE", { hour: "2-digit", minute: "2-digit" });

function entryContent(entry, withFamily) {
  return html`<span class="bh-activity-time">${timeOf(entry.at)}</span>
    <span class="bh-activity-text">${withFamily ? html`<strong>${entry.familyName || "Gezin"}</strong>` : ""}
      <span>${entry.summary}</span>${entry.actor ? html`<small>door ${entry.actor}</small>` : ""}</span>`;
}

function entryRow(entry, withFamily) {
  const isNew = entry.at > (state.activitySeenAt || 0);
  const registered = (state.registrations || []).some(reg => reg.id === entry.registrationId);
  const target = !withFamily
    ? null
    : registered
      ? { action: "open-family", id: entry.registrationId }
      : entry.familyId
        ? { action: "open-user-family", id: entry.familyId }
        : null;
  return html`<li class="bh-activity-row${isNew ? " is-new" : ""}">${
    target
      ? html`<button type="button" data-action="${target.action}" data-id="${target.id}">${entryContent(entry, true)}</button>`
      : html`<div>${entryContent(entry, withFamily)}</div>`
  }</li>`;
}

// Lines grouped under Vandaag, Gisteren, or the date.
function activityList(entries, withFamily) {
  let day = null;
  return joinHtml(
    entries.map(entry => {
      const key = dayKey(entry.at);
      const heading = key === day ? "" : html`<li class="bh-activity-day">${dayLabel(entry.at)}</li>`;
      day = key;
      return html`${heading}${entryRow(entry, withFamily)}`;
    }),
    ""
  );
}

export function renderActivityCard() {
  const entries = state.activity || [];
  const fresh = newActivityCount();
  const first = entries.slice(0, Math.max(SHOWN_FIRST, fresh));
  const rest = entries.slice(first.length);
  return html`<section class="bh-card bh-activity">
      <header class="bh-card-head">
        <h2>Laatste activiteit</h2>${
          fresh
            ? html`<span class="bh-chip bh-chip-info">${fresh} nieuw</span>
              <button type="button" class="bh-link" data-action="activity-seen">Alles gezien</button>`
            : ""
        }</header>${
          entries.length
            ? html`<ul class="bh-activity-list">${activityList(first, true)}</ul>${
                rest.length
                  ? html`<details class="bh-activity-more">
                  <summary>Toon ouder (${rest.length})</summary>
                  <ul class="bh-activity-list">${activityList(rest, true)}</ul>
                </details>`
                  : ""
              }`
            : html`<p class="bh-empty">Nog geen activiteit. Wat gezinnen doen, verschijnt hier vanzelf.</p>`
        }</section>`;
}

export function renderFamilyHistory(familyId) {
  const entries = (state.activity || []).filter(entry => entry.familyId === familyId);
  return html`<section class="bh-card bh-activity">
      <header class="bh-card-head">
        <h2>Geschiedenis</h2>${
          entries.length ? html`<span class="bh-count">${plural(entries.length, "regel", "regels")}</span>` : ""
        }</header>${
          entries.length
            ? html`<ul class="bh-activity-list">${activityList(entries, false)}</ul>`
            : html`<p class="bh-empty">Nog niets gebeurd in het familieportaal.</p>`
        }</section>`;
}
