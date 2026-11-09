// "Laatste activiteit": what families do, for the admin. Logging never gets in the way: if writing a
// line fails, the family's own action still succeeds.
// Allergies and notes are never stored here, only that they changed; nor are e-mail addresses.
const MERGE_WINDOW_SECONDS = 15 * 60;
const LIST_LIMIT = 200;
const KEEP_SECONDS = 365 * 24 * 60 * 60;

async function insert(env, entry) {
  await env.DB.prepare(
    "INSERT INTO family_activity (id, at, edition_id, family_id, registration_id, family_name, actor_id, actor, type, summary, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      crypto.randomUUID(),
      entry.now,
      entry.editionId ?? null,
      entry.familyId ?? null,
      entry.registrationId ?? null,
      entry.familyName || "",
      entry.actorId ?? null,
      entry.actor || "",
      entry.type,
      entry.summary,
      entry.data ?? null
    )
    .run();
}

export async function logActivity(env, entry) {
  try {
    await insert(env, entry);
  } catch (error) {
    console.error("Activity log failed:", error?.message);
  }
}

// An account event, shown once for each family the account belongs to.
export async function logAccountActivity(env, { userId, actor, type, summary, now }) {
  try {
    const families = await env.DB.prepare(
      "SELECT f.id, f.display_name FROM family_memberships fm JOIN families f ON f.id = fm.family_id WHERE fm.user_id = ?"
    )
      .bind(userId)
      .all();
    for (const family of families.results || [])
      await insert(env, {
        now,
        familyId: family.id,
        familyName: family.display_name,
        actorId: userId,
        actor,
        type,
        summary
      });
  } catch (error) {
    console.error("Activity log failed:", error?.message);
  }
}

// Only what is needed to describe a change later. Allergies and notes are reduced to a fingerprint.
async function snapshot(members, sha256) {
  return Promise.all(
    (Array.isArray(members) ? members : []).map(async person => {
      const personal = [Array.isArray(person?.diet) ? [...person.diet].sort() : [], String(person?.notes || "").trim()];
      return {
        id: String(person?.id ?? ""),
        name: String(person?.name ?? ""),
        type: person?.type,
        orders: Object.fromEntries(
          Object.entries(person?.orders || {})
            .map(([id, qty]) => [id, Number(qty) || 0])
            .filter(([, qty]) => qty > 0)
        ),
        private: personal[0].length || personal[1] ? await sha256(JSON.stringify(personal)) : ""
      };
    })
  );
}

const orderText = (orders, nameOf) =>
  Object.entries(orders)
    .map(([id, qty]) => nameOf(id) + " " + qty)
    .join(", ");

// "Jan: Steak 2 → 3 · Tom toegevoegd als Avondgast"; empty when nothing visible changed.
export function describeMemberChanges(before, after, catalog = []) {
  const names = new Map((Array.isArray(catalog) ? catalog : []).map(product => [product.id, product.name]));
  const nameOf = id => names.get(id) || id;
  const old = new Map(before.map(person => [person.id, person]));
  const lines = [];
  for (const person of after) {
    const previous = old.get(person.id);
    if (!previous) {
      const ordered = orderText(person.orders, nameOf);
      lines.push(person.name + " toegevoegd als " + person.type + (ordered ? " (" + ordered + ")" : ""));
      continue;
    }
    const parts = [];
    if (previous.name !== person.name) parts.push("was " + previous.name);
    if (previous.type !== person.type) parts.push("nu " + person.type);
    for (const id of new Set([...Object.keys(previous.orders), ...Object.keys(person.orders)])) {
      const from = previous.orders[id] || 0,
        to = person.orders[id] || 0;
      if (from !== to) parts.push(nameOf(id) + " " + from + " → " + to);
    }
    if (previous.private !== person.private) parts.push("allergie of opmerking gewijzigd");
    if (parts.length) lines.push(person.name + ": " + parts.join(", "));
  }
  const kept = new Set(after.map(person => person.id));
  for (const person of before) if (!kept.has(person.id)) lines.push(person.name + " verwijderd");
  return lines.join(" · ");
}

// A family saved people or orders. Quick edits by the same person become one line, compared with the
// state before the first edit: tapping + five times reads "Steak 1 → 6", and undoing leaves nothing.
export async function logRegistrationChange(env, details) {
  const { editionId, familyId, registrationId, familyName, actorId, actor, before, after, catalog, now, sha256 } =
    details;
  try {
    const current = await snapshot(after, sha256);
    const last = await env.DB.prepare(
      "SELECT id, at, data FROM family_activity WHERE registration_id = ? AND type = 'registration' AND actor_id = ? ORDER BY at DESC, rowid DESC LIMIT 1"
    )
      .bind(registrationId, actorId)
      .first();
    if (last && now - last.at <= MERGE_WINDOW_SECONDS) {
      const start = JSON.parse(last.data || "[]");
      const summary = describeMemberChanges(start, current, catalog);
      if (summary)
        await env.DB.prepare("UPDATE family_activity SET at = ?, summary = ? WHERE id = ?")
          .bind(now, summary, last.id)
          .run();
      else await env.DB.prepare("DELETE FROM family_activity WHERE id = ?").bind(last.id).run();
      return;
    }
    const start = await snapshot(before, sha256);
    const summary = describeMemberChanges(start, current, catalog);
    if (summary)
      await insert(env, {
        now,
        editionId,
        familyId,
        registrationId,
        familyName,
        actorId,
        actor,
        type: "registration",
        summary,
        data: JSON.stringify(start)
      });
  } catch (error) {
    console.error("Activity log failed:", error?.message);
  }
}

// This edition's activity plus account events, newest first.
export async function listActivity(env, editionId) {
  const rows = await env.DB.prepare(
    "SELECT id, at, family_id, registration_id, family_name, actor, type, summary FROM family_activity WHERE edition_id = ? OR edition_id IS NULL ORDER BY at DESC, rowid DESC LIMIT ?"
  )
    .bind(editionId, LIST_LIMIT)
    .all();
  return (rows.results || []).map(row => ({
    id: row.id,
    at: row.at,
    familyId: row.family_id,
    registrationId: row.registration_id,
    familyName: row.family_name,
    actor: row.actor,
    type: row.type,
    summary: row.summary
  }));
}

// Nightly: kept until a year after the edition was archived; account events for a year.
export async function pruneActivity(env, now = Math.floor(Date.now() / 1000)) {
  const limit = now - KEEP_SECONDS;
  await env.DB.prepare(
    "DELETE FROM family_activity WHERE (edition_id IS NULL AND at < ?) OR edition_id IN (SELECT id FROM event_editions WHERE status = 'archived' AND updated_at < ?)"
  )
    .bind(limit, limit)
    .run();
}
