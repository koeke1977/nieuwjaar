// Sortable, filterable admin tables (Inschrijvingen, Gebruikers → Gezinnen and Accounts).
// Sort and filter per table live in state.beheerTableSort / state.beheerTableFilter, keyed by table name;
// the actions "table-sort" and "table-filter" (actions/navigation.js) change them.
import { state } from "../../../data/admin-store.js";
import { html, joinHtml } from "../../../utils/html.js";

const compareText = (a, b) => String(a || "").localeCompare(String(b || ""), "nl", { sensitivity: "base" });
const sortOf = table => state.beheerTableSort?.[table] || { key: "name", dir: "asc" };

export const dash = html`<span class="bh-dim">–</span>`;
export const shortDate = seconds =>
  seconds
    ? new Date(seconds * 1000).toLocaleDateString("nl-BE", { day: "numeric", month: "short", year: "numeric" })
    : "";

// The active filter option of a table (the first option, "Alle", when none is chosen).
export const activeFilter = (table, options) =>
  options.find(option => option.id === state.beheerTableFilter?.[table]) || options[0];

// getters = { name: row => …, otherKey: row => number | string }; ties are sorted by name.
export function sortRows(rows, table, getters) {
  const { key, dir } = sortOf(table);
  const get = getters[key] || getters.name;
  const sign = dir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const x = get(a),
      y = get(b);
    const order = typeof x === "string" || typeof y === "string" ? compareText(x, y) : (x || 0) - (y || 0);
    return order * sign || compareText(getters.name(a), getters.name(b));
  });
}

// Column title that sorts; highFirst columns (numbers, dates) start with the highest value.
export function sortHeader(table, key, label, { highFirst = false } = {}) {
  const { key: active, dir } = sortOf(table);
  const current = active === key;
  return html`<th aria-sort="${current ? (dir === "asc" ? "ascending" : "descending") : "none"}">
      <button type="button" class="bh-sort${current ? " is-active" : ""}" data-action="table-sort" data-table="${table}"
          data-key="${key}"${highFirst ? html` data-first="desc"` : ""}>${label}<span aria-hidden="true">${
            current ? (dir === "asc" ? "▲" : "▼") : "↕"
          }</span></button>
    </th>`;
}

// Filter buttons with the number of rows each one would show.
export function filterBar(table, options, rows) {
  const active = activeFilter(table, options).id;
  return html`<div class="bh-filters" role="group" aria-label="Filter">${joinHtml(
    options.map(
      option => html`<button type="button" class="bh-filter" data-action="table-filter" data-table="${table}"
          data-filter="${option.id}" aria-pressed="${option.id === active}">${option.label}
          <b>${rows.filter(option.test).length}</b></button>`
    ),
    ""
  )}</div>`;
}
