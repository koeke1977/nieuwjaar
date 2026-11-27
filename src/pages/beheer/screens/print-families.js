// Paper overview for the organiser: per family the costs without the bar, the barbuffer, what
// the family advanced, and the difference to collect from or pay back to that family.
import { state, financeOptions } from "../../../data/admin-store.js";
import { barBufferCents } from "../../../utils/finance.js";
import { html, raw, joinHtml, euro, plural, formatDate } from "../../../utils/html.js";
import { eventTotals, eventTitle, today } from "./shared.js";

const STYLE = `
  @page { size: A4 portrait; margin: 16mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 11pt/1.4 system-ui, "Segoe UI", Arial, sans-serif; color: #111; }
  h1 { margin: 0 0 2px; font-size: 18pt; }
  p { margin: 0 0 14px; color: #555; font-size: 10pt; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 6px 8px; border-bottom: 1px solid #ccc; text-align: right; white-space: nowrap; }
  th:first-child, td:first-child { text-align: left; white-space: normal; }
  thead th { border-bottom: 2px solid #111; font-size: 9.5pt; text-transform: uppercase; letter-spacing: .03em; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  tfoot td { border-bottom: 0; border-top: 2px solid #111; font-weight: 700; }
  tfoot tr + tr td { border-top: 0; font-weight: 400; }
  .pay { font-weight: 700; }
  .back { font-weight: 700; color: #1d5fa8; }
  small { display: block; color: #666; font-size: 8.5pt; font-weight: 400; }
`;

function deltaCell(cents) {
  if (cents > 0) return html`<td class="pay">${euro(cents)}<small>te betalen</small></td>`;
  if (cents < 0) return html`<td class="back">${euro(-cents)}<small>terug te krijgen</small></td>`;
  return html`<td>${euro(0)}<small>in orde</small></td>`;
}

export function familyCostsRows() {
  const { summary } = eventTotals();
  return [...(state.registrations || [])]
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "nl"))
    .map(reg => {
      const row = summary.find(item => item.id === reg.id) || {};
      const costs = Math.max(0, (row.shareCents || 0) - (row.barCents || 0) - (row.bufferCents || 0));
      const buffer = row.bufferCents || 0;
      const advanced = row.advancedCents || 0;
      return { name: reg.name, costs, buffer, advanced, delta: costs + buffer - advanced };
    });
}

export function familyCostsDocument() {
  const rows = familyCostsRows();
  const sum = pick => rows.reduce((total, row) => total + pick(row), 0);
  const body = joinHtml(
    rows.map(
      row => html`<tr>
          <td>${row.name}</td>
          <td>${euro(row.costs)}</td>
          <td>${row.buffer ? euro(row.buffer) : "–"}</td>
          <td>${row.advanced ? euro(row.advanced) : "–"}</td>${deltaCell(row.delta)}</tr>`
    ),
    ""
  );
  const title = "Afrekening gezinnen · " + eventTitle();
  return String(html`<!doctype html>
    <html lang="nl">
      <head>
        <meta charset="utf-8">
        <title>${title}</title>
        <style>${raw(STYLE)}</style>
      </head>
      <body>
        <h1>${title}</h1>
        <p>Kosten zonder bar${barBufferCents(financeOptions()) ? " · barbuffer " + euro(barBufferCents(financeOptions())) + " per persoon" : ""} · ${state.costsFinalized ? "kosten definitief" : "kosten voorlopig"} ·
            ${plural(rows.length, "gezin", "gezinnen")} · afgedrukt op ${formatDate(today())}</p>
        <table>
          <thead>
            <tr>
              <th>Gezin</th>
              <th>Kosten</th>
              <th>Barbuffer</th>
              <th>Voorgeschoten</th>
              <th>Verschil</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
          <tfoot>
            <tr>
              <td>Totaal</td>
              <td>${euro(sum(row => row.costs))}</td>
              <td>${euro(sum(row => row.buffer))}</td>
              <td>${euro(sum(row => row.advanced))}</td>
              <td></td>
            </tr>
            <tr>
              <td>Te innen bij gezinnen</td>
              <td></td>
              <td></td>
              <td></td>
              <td>${euro(sum(row => Math.max(0, row.delta)))}</td>
            </tr>
            <tr>
              <td>Terug te geven aan gezinnen</td>
              <td></td>
              <td></td>
              <td></td>
              <td>${euro(sum(row => Math.max(0, -row.delta)))}</td>
            </tr>
          </tfoot>
        </table>
      </body>
    </html>`);
}
