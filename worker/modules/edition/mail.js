// Mail from an edition: message to the families and the meat order for the butcher.
import { esc, formatDate } from "../../../src/utils/html.js";
import { EVENING } from "../../../src/utils/member-types.js";
import { parse } from "./common.js";

// Recipients of a message: accounts (active or invited) of the families registered in this
// edition; "no-order" limits it to families that have not ordered anything yet.
export async function messageRecipients(env, editionId, audience) {
  const rows = await env.DB.prepare(
    "SELECT family_id, data_json FROM event_registrations WHERE edition_id = ? AND status = 'active'"
  )
    .bind(editionId)
    .all();
  const families = (rows.results || [])
    .filter(row => {
      if (audience !== "no-order") return true;
      let data = {};
      try {
        data = JSON.parse(row.data_json || "{}");
      } catch {
        /* counts as no order */
      }
      const members = data.members || [];
      // Only families that come for dinner can be reminded to order meat.
      return (
        members.some(person => person.type !== EVENING) &&
        !members.some(person => Object.values(person.orders || {}).some(qty => Number(qty) > 0))
      );
    })
    .map(row => row.family_id);
  if (!families.length) return [];
  const users = await env.DB.prepare(
    "SELECT DISTINCT u.email, u.display_name FROM family_memberships fm JOIN family_users u ON u.id = fm.user_id WHERE u.status IN ('active', 'invited') AND fm.family_id IN (" +
      families.map(() => "?").join(",") +
      ")"
  )
    .bind(...families)
    .all();
  return users.results || [];
}

export function messageHtml({ displayName, subject, message, eventTitle }) {
  const paragraphs = message
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map(block => "<p>" + esc(block).replace(/\n/g, "<br>") + "</p>")
    .join("");
  return (
    '<div style="font-family:Arial,sans-serif;color:#1b2a3b;line-height:1.6;max-width:560px">' +
    '<p style="color:#b18a3d;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;margin:0 0 8px">' +
    esc(eventTitle) +
    "</p>" +
    '<h2 style="margin:0 0 16px">' +
    esc(subject) +
    "</h2><p>Dag " +
    esc(displayName || "") +
    ",</p>" +
    paragraphs +
    '<p style="margin:24px 0"><a href="https://nieuwjaar.datuur.be/familie" style="display:inline-block;padding:12px 20px;border-radius:10px;background:#14263b;color:#fff;font-weight:700;text-decoration:none">Naar het familieportaal</a></p>' +
    "<p>Groeten,<br>De organisatie van " +
    esc(eventTitle) +
    "</p></div>"
  );
}

// Meat order for the butcher: totals per product over everyone at dinner (no names), from the
// saved registrations of this edition.
export async function butcherOrder(env, editionId) {
  const edition = await env.DB.prepare(
    "SELECT d.label, d.starts_at, d.config_json, e.name FROM event_editions d JOIN events e ON e.id = d.event_id WHERE d.id = ?"
  )
    .bind(editionId)
    .first();
  if (!edition) return null;
  const config = parse(edition.config_json, {}) || {};
  const catalog = Array.isArray(config.catalog) ? config.catalog : [];
  const rows = await env.DB.prepare(
    "SELECT data_json FROM event_registrations WHERE edition_id = ? AND status = 'active'"
  )
    .bind(editionId)
    .all();
  const counts = new Map();
  for (const row of rows.results || []) {
    const members = parse(row.data_json, {})?.members || [];
    for (const person of members) {
      if (person?.type === EVENING) continue;
      for (const [productId, qty] of Object.entries(person?.orders || {})) {
        const n = Math.max(0, Math.floor(Number(qty) || 0));
        if (n) counts.set(productId, (counts.get(productId) || 0) + n);
      }
    }
  }
  const lines = catalog
    .filter(product => counts.get(product.id))
    .map(product => ({ name: String(product.name || product.id), count: counts.get(product.id) }));
  return {
    config,
    eventTitle: edition.name + " " + edition.label,
    partyDate: formatDate(edition.starts_at || ""),
    lines,
    total: lines.reduce((sum, line) => sum + line.count, 0)
  };
}

export function butcherMailHtml({ eventTitle, partyDate, lines, total, note }) {
  const cell = "padding:8px 12px;border-bottom:1px solid #e6e1d8";
  const rows = lines
    .map(
      line =>
        '<tr><td style="' +
        cell +
        '">' +
        esc(line.name) +
        '</td><td style="' +
        cell +
        ';text-align:right;font-weight:700">' +
        line.count +
        "</td></tr>"
    )
    .join("");
  const noteHtml = note
    ? note
        .replace(/\r\n/g, "\n")
        .split(/\n{2,}/)
        .map(block => "<p>" + esc(block).replace(/\n/g, "<br>") + "</p>")
        .join("")
    : "";
  return (
    '<div style="font-family:Arial,sans-serif;color:#1b2a3b;line-height:1.6;max-width:560px">' +
    "<p>Beste,</p><p>Hierbij onze bestelling voor <strong>" +
    esc(eventTitle) +
    "</strong>" +
    (partyDate ? " (feest op " + esc(partyDate) + ")" : "") +
    ':</p><table style="border-collapse:collapse;min-width:280px;margin:8px 0 16px">' +
    '<tr><th style="' +
    cell +
    ';text-align:left">Product</th><th style="' +
    cell +
    ';text-align:right">Porties</th></tr>' +
    rows +
    '<tr><td style="padding:8px 12px;font-weight:700">Totaal</td><td style="padding:8px 12px;text-align:right;font-weight:700">' +
    total +
    "</td></tr></table>" +
    noteHtml +
    "<p>Met vriendelijke groeten,<br>De organisatie van " +
    esc(eventTitle) +
    "</p></div>"
  );
}
