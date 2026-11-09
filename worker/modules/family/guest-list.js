// "Wie komt er nog?": the families of an edition can see each other, but only with permission.
// A family is named only after saying yes; until then it just counts as "+ 3 andere gezinnen".
// Only the family name and the number of people are ever shared.
// Answers live in the edition's config (config.guestList = { registrationId: true | false }), outside
// its revision, so they cause no save conflicts. A new edition asks again.
import { familyAccountSession } from "./session.js";

const parse = (text, fallback) => {
  try {
    return JSON.parse(text || "") ?? fallback;
  } catch {
    return fallback;
  }
};

// What one registration gets to see; the answers come from the config it already loaded.
export async function guestListFor(env, editionId, registrationId, config) {
  const answers = config.guestList && typeof config.guestList === "object" ? config.guestList : {};
  const rows = await env.DB.prepare(
    "SELECT id, data_json FROM event_registrations WHERE edition_id = ? AND status = 'active'"
  )
    .bind(editionId)
    .all();
  const families = [];
  let others = 0;
  for (const row of rows.results || []) {
    if (answers[row.id] !== true) {
      others++;
      continue;
    }
    const data = parse(row.data_json, {}) || {};
    families.push({
      name: String(data.name || "Gezin"),
      people: Array.isArray(data.members) ? data.members.length : 0,
      own: row.id === registrationId
    });
  }
  families.sort((a, b) => a.name.localeCompare(b.name, "nl", { sensitivity: "base" }));
  const answer = answers[registrationId];
  return { answer: typeof answer === "boolean" ? answer : null, families, others };
}

export async function setGuestListAnswer({ request, env, json, sameOrigin, cookieValue, sha256 }) {
  if (!sameOrigin(request)) return json({ error: "Ongeldige aanvraag." }, 403);
  const session = await familyAccountSession(request, env, cookieValue, sha256);
  if (!session) return json({ error: "Je sessie is verlopen. Meld je opnieuw aan." }, 401);
  const body = await request.json().catch(() => null);
  const editionId = typeof body?.edition === "string" ? body.edition : "";
  const registrationId = typeof body?.registrationId === "string" ? body.registrationId : "";
  if (typeof body?.visible !== "boolean") return json({ error: "Ongeldige aanvraag." }, 400);
  const row = await env.DB.prepare(
    "SELECT d.config_json, d.status AS edition_status, fm.role FROM event_registrations er JOIN event_editions d ON d.id = er.edition_id JOIN family_memberships fm ON fm.family_id = er.family_id WHERE er.id = ? AND er.edition_id = ? AND er.status = 'active' AND fm.user_id = ?"
  )
    .bind(registrationId, editionId, session.user_id)
    .first();
  if (!row) return json({ error: "Deze inschrijving is niet aan je account gekoppeld." }, 403);
  if (row.role === "viewer") return json({ error: "Je hebt alleen leesrechten voor deze inschrijving." }, 403);
  if (row.edition_status === "archived") return json({ error: "Deze editie is afgesloten." }, 409);
  const config = parse(row.config_json, {}) || {};
  config.guestList = { ...config.guestList, [registrationId]: body.visible };
  await env.DB.prepare("UPDATE event_editions SET config_json = ? WHERE id = ?")
    .bind(JSON.stringify(config), editionId)
    .run();
  return json({ saved: true, visible: body.visible });
}
