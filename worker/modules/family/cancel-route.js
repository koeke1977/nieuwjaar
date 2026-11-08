// "Wij komen niet": a family cancels its registration. This happens at once only when no money is
// involved yet. Once the order is placed, or with costs, payments or a bar bill, cancelling would
// shift or lose money, so it becomes a request for the organisation.
import { esc } from "../../../src/utils/html.js";
import { ordersClosed } from "../../../src/utils/time.js";
import { setCancelRequest } from "../edition/cancel-requests.js";
import { familyAccountSession } from "./session.js";

const parse = (text, fallback) => {
  try {
    return JSON.parse(text || "") ?? fallback;
  } catch {
    return fallback;
  }
};
const portionsOf = members =>
  members.reduce(
    (sum, person) => sum + Object.values(person.orders || {}).reduce((s, qty) => s + (Number(qty) || 0), 0),
    0
  );

// Why the organisation has to decide; empty when the family can simply cancel.
function reasonsToAsk({ config, snapshot, registrationId, members }) {
  const expenses = parse(snapshot?.expenses_json, []) || [];
  const payments = parse(snapshot?.payments_json, []) || [];
  const reasons = [];
  if (ordersClosed(config.orderDeadline)) reasons.push("de einddatum om te bestellen is voorbij");
  if (config.butcherSentAt) reasons.push("de bestelling is al naar de slager gemaild");
  if (snapshot?.costs_finalized) reasons.push("de afrekening is definitief");
  if (expenses.some(expense => expense.advancedBy === registrationId)) reasons.push("het gezin schoot kosten voor");
  if (payments.some(payment => payment.registrationId === registrationId)) reasons.push("het gezin heeft betalingen");
  if (members.some(person => Number(person.barCents) > 0)) reasons.push("er is een barrekening");
  return reasons;
}

async function tellOrganizer(env, sendGraphMail, subject, lines) {
  try {
    await sendGraphMail(
      env,
      env.ORGANIZER_EMAIL || "registratie@datuur.be",
      subject,
      '<div style="font-family:Arial,sans-serif;color:#242424;line-height:1.6"><h2>' +
        esc(subject) +
        "</h2>" +
        lines.map(line => "<p>" + esc(line) + "</p>").join("") +
        '<p><a href="https://nieuwjaar.datuur.be/beheer">Naar het beheer</a></p></div>'
    );
  } catch (error) {
    console.error("Cancellation notice failed:", error?.message);
  }
}

export async function cancelRegistration({ request, env, now, json, sameOrigin, cookieValue, sha256, sendGraphMail }) {
  if (!sameOrigin(request)) return json({ error: "Ongeldige aanvraag." }, 403);
  const session = await familyAccountSession(request, env, cookieValue, sha256);
  if (!session) return json({ error: "Je sessie is verlopen. Meld je opnieuw aan." }, 401);
  const body = await request.json().catch(() => null);
  const editionId = typeof body?.edition === "string" ? body.edition : "";
  const registrationId = typeof body?.registrationId === "string" ? body.registrationId : "";
  const row = await env.DB.prepare(
    "SELECT er.data_json, er.updated_at, d.label, d.status AS edition_status, d.config_json, e.name AS event_name, fm.role FROM event_registrations er JOIN event_editions d ON d.id = er.edition_id JOIN events e ON e.id = d.event_id JOIN family_memberships fm ON fm.family_id = er.family_id WHERE er.id = ? AND er.edition_id = ? AND er.status = 'active' AND fm.user_id = ?"
  )
    .bind(registrationId, editionId, session.user_id)
    .first();
  if (!row) return json({ error: "Deze inschrijving is niet aan je account gekoppeld." }, 403);
  if (row.role === "viewer") return json({ error: "Je hebt alleen leesrechten voor deze inschrijving." }, 403);
  if (row.edition_status === "archived") return json({ error: "Deze editie is afgesloten." }, 409);
  const snapshot = await env.DB.prepare(
    "SELECT expenses_json, payments_json, costs_finalized FROM edition_finance_snapshots WHERE edition_id = ?"
  )
    .bind(editionId)
    .first();
  const config = parse(row.config_json, {}) || {};
  const data = parse(row.data_json, {}) || {};
  const members = Array.isArray(data.members) ? data.members : [];
  const family = String(data.name || "Een gezin");
  const eventTitle = row.event_name + " " + row.label;
  const summary = members.length + " personen, " + portionsOf(members) + " porties.";
  const reasons = reasonsToAsk({ config, snapshot, registrationId, members });

  if (reasons.length) {
    if (!config.cancelRequests?.[registrationId]) {
      await setCancelRequest(env, editionId, registrationId, now);
      await tellOrganizer(env, sendGraphMail, family + " wil zich afmelden voor " + eventTitle, [
        "Aangevraagd door " + (session.display_name || session.email) + ". " + summary,
        "Je beslist zelf, omdat " + reasons.join(", ") + ". Je vindt de aanvraag bij het gezin onder Inschrijvingen."
      ]);
    }
    return json({ requested: true });
  }

  const result = await env.DB.prepare(
    "UPDATE event_registrations SET status = 'cancelled', updated_at = MAX(updated_at + 1, ?) WHERE id = ? AND edition_id = ? AND status = 'active' AND updated_at = ?"
  )
    .bind(now, registrationId, editionId, row.updated_at)
    .run();
  if (!Number(result?.meta?.changes ?? 0))
    return json({ error: "Jullie inschrijving is net aangepast. Probeer het opnieuw." }, 409);
  if (config.cancelRequests?.[registrationId]) await setCancelRequest(env, editionId, registrationId, null);
  await tellOrganizer(env, sendGraphMail, family + " heeft zich afgemeld voor " + eventTitle, [
    "Afgemeld door " + (session.display_name || session.email) + ". Het ging om " + summary,
    "Het gezin staat niet meer bij de inschrijvingen en kan zich zelf opnieuw inschrijven."
  ]);
  return json({ cancelled: true });
}
