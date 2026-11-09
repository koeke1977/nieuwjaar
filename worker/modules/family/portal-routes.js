// The signed-in portal: what the family sees, registering for an edition, saving people and orders.
import { getFamilyFinanceBreakdown } from "../../../src/utils/finance.js";
import { withDiet } from "../../../src/utils/diet.js";
import { isMemberType, EVENING } from "../../../src/utils/member-types.js";
import { ordersClosed } from "../../../src/utils/time.js";
import { familyAccountCookie, familyAccountSession } from "./session.js";
import { logActivity, logRegistrationChange } from "../activity.js";

const closedMessage = deadline =>
  "Bestellen is afgesloten" +
  (deadline ? " sinds " + deadline.replace("T", " om ") : "") +
  ". Wil je toch nog iets wijzigen? Vraag het aan de organisatie.";

// Family-facing finance for a normalized edition: shares are computed over all active
// registrations of the edition, but only this registration's figures are returned.
async function normalizedFamilyFinance(env, editionId, registration) {
  const [rows, snapshot] = await Promise.all([
    env.DB.prepare("SELECT id, data_json FROM event_registrations WHERE edition_id = ? AND status = 'active'")
      .bind(editionId)
      .all(),
    env.DB.prepare(
      "SELECT expenses_json, payments_json, costs_finalized, costs_finalized_at FROM edition_finance_snapshots WHERE edition_id = ?"
    )
      .bind(editionId)
      .first()
  ]);
  const registrations = (rows.results || []).map(row => {
    let data = {};
    try {
      data = JSON.parse(row.data_json || "{}");
    } catch {
      /* telt dan als lege inschrijving */
    }
    return row.id === registration.id
      ? registration
      : {
          id: row.id,
          members: Array.isArray(data.members) ? data.members : [],
          adults: data.adults,
          children: data.children
        };
  });
  let expenses = [],
    payments = [];
  try {
    expenses = JSON.parse(snapshot?.expenses_json || "[]");
    payments = JSON.parse(snapshot?.payments_json || "[]");
  } catch {
    /* lege afrekening */
  }
  return {
    finalized: Boolean(snapshot?.costs_finalized),
    finalizedAt: snapshot?.costs_finalized_at || null,
    ...getFamilyFinanceBreakdown(registration, registrations, expenses, payments)
  };
}

// Members compared by content: key order and zero quantities do not count as a change.
function canonicalMembers(members) {
  return JSON.stringify(
    (Array.isArray(members) ? members : []).map(person => ({
      id: String(person?.id ?? ""),
      name: String(person?.name ?? "").trim(),
      type: person?.type,
      diet: Array.isArray(person?.diet) ? [...person.diet].sort() : [],
      notes: String(person?.notes ?? "").trim(),
      orders: Object.entries(person?.orders && typeof person.orders === "object" ? person.orders : {})
        .filter(([, qty]) => Number(qty) > 0)
        .map(([id, qty]) => [id, Number(qty)])
        .sort(([a], [b]) => a.localeCompare(b))
    }))
  );
}

export async function portalData({ request, env, json, cookieValue, sha256 }) {
  const session = await familyAccountSession(request, env, cookieValue, sha256);
  if (!session) return json({ authenticated: false }, 200, { "Set-Cookie": familyAccountCookie("", 0) });
  // Access is per family (membership); a family has one registration per edition.
  // Archived editions are history and are not shown in the portal.
  const result = await env.DB.prepare(
    "SELECT er.id AS registration_id, er.edition_id, er.data_json, er.updated_at, d.label AS edition_label, d.status AS edition_status, d.starts_at, d.config_json, e.name AS event_name, e.finance_strategy, fm.role AS membership_role FROM family_memberships fm JOIN event_registrations er ON er.family_id = fm.family_id AND er.status = 'active' JOIN event_editions d ON d.id = er.edition_id JOIN events e ON e.id = d.event_id WHERE fm.user_id = ? AND d.status != 'archived' ORDER BY d.created_at DESC, e.name"
  )
    .bind(session.user_id)
    .all();
  const registrations = [];
  for (const row of result.results || []) {
    let registration, config;
    try {
      registration = JSON.parse(row.data_json || "{}");
      config = JSON.parse(row.config_json || "{}");
    } catch {
      continue;
    }
    const members = (Array.isArray(registration.members) ? registration.members : []).map(person => ({
      id: person.id,
      name: person.name,
      type: person.type,
      orders: person.orders && typeof person.orders === "object" && !Array.isArray(person.orders) ? person.orders : {},
      diet: Array.isArray(person.diet) ? person.diet : [],
      notes: typeof person.notes === "string" ? person.notes : "",
      barCents: Math.max(0, Number(person.barCents) || 0)
    }));
    const own = {
      id: row.registration_id,
      name: registration.name || "",
      members,
      adults: members.filter(person => person.type === "Volwassene").length,
      children: members.filter(person => person.type === "Kind").length
    };
    registrations.push({
      edition: row.edition_id,
      editionLabel: row.edition_label || "Editie",
      editionStatus: row.edition_status,
      startsAt: row.starts_at || null,
      orderDeadline: typeof config.orderDeadline === "string" ? config.orderDeadline : null,
      ordersClosed: ordersClosed(config.orderDeadline),
      cancelRequestedAt: Number(config.cancelRequests?.[row.registration_id]?.at) || null,
      event: row.event_name || "Evenement",
      accessRole: row.membership_role || "viewer",
      registration: own,
      catalog: (Array.isArray(config.catalog) ? config.catalog : [])
        .filter(item => item && item.active !== false)
        .map(item => ({ id: item.id, name: item.name, image: item.image || null })),
      revision: Number(row.updated_at) || 0,
      finance: row.finance_strategy === "nieuwjaar" ? await normalizedFamilyFinance(env, row.edition_id, own) : null
    });
  }
  // Open editions this family can still register for (owners and editors only).
  const open = await env.DB.prepare(
    "SELECT d.id AS edition_id, d.label AS edition_label, e.name AS event_name, f.id AS family_id, f.display_name AS family_name FROM family_memberships fm JOIN families f ON f.id = fm.family_id JOIN event_editions d ON d.status = 'open' JOIN events e ON e.id = d.event_id AND e.status = 'active' WHERE fm.user_id = ? AND fm.role IN ('owner', 'editor') AND NOT EXISTS (SELECT 1 FROM event_registrations er WHERE er.edition_id = d.id AND er.family_id = f.id AND er.status = 'active') ORDER BY d.created_at DESC"
  )
    .bind(session.user_id)
    .all();
  const openEditions = (open.results || []).map(row => ({
    edition: row.edition_id,
    editionLabel: row.edition_label,
    event: row.event_name,
    familyId: row.family_id,
    familyName: row.family_name
  }));
  return json({
    authenticated: true,
    user: { email: session.email, displayName: session.display_name },
    registrations,
    openEditions
  });
}

export async function selfRegister({ request, env, now, json, sameOrigin, cookieValue, sha256 }) {
  if (!sameOrigin(request)) return json({ error: "Ongeldige aanvraag." }, 403);
  const session = await familyAccountSession(request, env, cookieValue, sha256);
  if (!session) return json({ error: "Je sessie is verlopen. Meld je opnieuw aan." }, 401);
  const body = await request.json().catch(() => null);
  const editionId = typeof body?.edition === "string" ? body.edition : "";
  const familyId = typeof body?.familyId === "string" ? body.familyId : "";
  const target = await env.DB.prepare(
    "SELECT d.id, f.display_name, fm.role FROM event_editions d JOIN events e ON e.id = d.event_id JOIN family_memberships fm ON fm.family_id = ? AND fm.user_id = ? JOIN families f ON f.id = fm.family_id WHERE d.id = ? AND d.status = 'open' AND e.status = 'active'"
  )
    .bind(familyId, session.user_id, editionId)
    .first();
  if (!target) return json({ error: "Deze editie is niet (meer) open voor inschrijving." }, 404);
  if (!["owner", "editor"].includes(target.role))
    return json({ error: "Je hebt alleen leesrechten voor dit gezin." }, 403);
  // Start from the members of the family's most recent registration; orders start empty.
  const previous = await env.DB.prepare(
    "SELECT data_json FROM event_registrations WHERE family_id = ? AND edition_id != ? ORDER BY updated_at DESC LIMIT 1"
  )
    .bind(familyId, editionId)
    .first();
  let members = [];
  try {
    members = (JSON.parse(previous?.data_json || "{}").members || []).map(
      person =>
        withDiet({ id: person.id, name: person.name, type: person.type, orders: {} }, person) || {
          id: person.id,
          name: person.name,
          type: person.type,
          orders: {}
        }
    );
  } catch {
    members = [];
  }
  const data = JSON.stringify({
    name: target.display_name,
    adults: members.filter(p => p.type === "Volwassene").length,
    children: members.filter(p => p.type === "Kind").length,
    members
  });
  const registrationId = "inschrijving-" + crypto.randomUUID();
  const result = await env.DB.prepare(
    "INSERT INTO event_registrations (id, edition_id, family_id, status, data_json, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?, ?) ON CONFLICT(edition_id, family_id) DO UPDATE SET status = 'active', data_json = excluded.data_json, updated_at = excluded.updated_at WHERE event_registrations.status = 'cancelled'"
  )
    .bind(registrationId, editionId, familyId, data, now, now)
    .run();
  if (!Number(result?.meta?.changes ?? 0))
    return json({ error: "Jullie gezin is al ingeschreven voor deze editie." }, 409);
  await logActivity(env, {
    now,
    editionId,
    familyId,
    registrationId,
    familyName: target.display_name,
    actorId: session.user_id,
    actor: session.display_name || "",
    type: "registered",
    summary: "Ingeschreven"
  });
  return json({ registered: true }, 201);
}

export async function saveRegistration({ request, env, now, json, sameOrigin, cookieValue, sha256 }) {
  if (!sameOrigin(request)) return json({ error: "Ongeldige aanvraag." }, 403);
  const session = await familyAccountSession(request, env, cookieValue, sha256);
  if (!session) return json({ error: "Je sessie is verlopen. Meld je opnieuw aan." }, 401);
  const body = await request.json().catch(() => null);
  const editionId = typeof body?.edition === "string" ? body.edition : "";
  const registrationId = typeof body?.registrationId === "string" ? body.registrationId : "";
  if (
    !editionId ||
    !registrationId ||
    !Number.isSafeInteger(body?.revision) ||
    !Array.isArray(body?.members) ||
    body.members.length < 1 ||
    body.members.length > 30
  ) {
    return json({ error: "Ongeldige inschrijvingsgegevens." }, 400);
  }
  const row = await env.DB.prepare(
    "SELECT er.id, er.family_id, er.data_json, er.updated_at, d.config_json, d.status AS edition_status, fm.role FROM event_registrations er JOIN event_editions d ON d.id = er.edition_id JOIN family_memberships fm ON fm.family_id = er.family_id WHERE er.id = ? AND er.edition_id = ? AND er.status = 'active' AND fm.user_id = ?"
  )
    .bind(registrationId, editionId, session.user_id)
    .first();
  if (!row) return json({ error: "Deze inschrijving is niet aan je account gekoppeld." }, 403);
  if (row.role === "viewer") return json({ error: "Je hebt alleen leesrechten voor deze inschrijving." }, 403);
  if (row.edition_status === "archived") return json({ error: "Deze editie is afgesloten." }, 409);
  if (Number(row.updated_at) !== body.revision)
    return json(
      {
        error:
          "Iemand anders heeft jullie inschrijving net aangepast. We tonen nu de nieuwste gegevens; controleer ze en pas opnieuw aan.",
        conflict: "registration"
      },
      409
    );
  let registration, config;
  try {
    registration = JSON.parse(row.data_json || "{}");
    config = JSON.parse(row.config_json || "{}");
  } catch {
    return json({ error: "De inschrijvingsgegevens zijn ongeldig." }, 500);
  }
  const activeIds = new Set(
    (Array.isArray(config.catalog) ? config.catalog : [])
      .filter(item => item && item.active !== false)
      .map(item => item.id)
  );
  const stored = new Map(
    (Array.isArray(registration.members) ? registration.members : []).map(person => [person.id, person])
  );
  const closed = ordersClosed(config.orderDeadline);
  const memberIds = new Set(),
    members = [];
  for (const person of body.members) {
    if (
      !person ||
      typeof person.id !== "string" ||
      !/^[A-Za-z0-9_-]{1,120}$/.test(person.id) ||
      typeof person.name !== "string" ||
      !person.name.trim() ||
      person.name.trim().length > 80 ||
      !isMemberType(person.type)
    ) {
      return json({ error: "Controleer de namen en categorieën van alle gezinsleden." }, 400);
    }
    if (memberIds.has(person.id)) return json({ error: "Een gezinslid komt meer dan één keer voor." }, 400);
    memberIds.add(person.id);
    // Keep quantities of products the family cannot edit (inactive or removed products).
    const orders = {};
    for (const [productId, qty] of Object.entries(stored.get(person.id)?.orders || {}))
      if (!activeIds.has(productId)) orders[productId] = qty;
    const sent =
      person.orders && typeof person.orders === "object" && !Array.isArray(person.orders) ? person.orders : {};
    for (const productId of activeIds) {
      // Evening guests come after dinner and order no meat.
      const quantity = person.type === EVENING ? 0 : Number(sent[productId] ?? 0);
      if (!Number.isInteger(quantity) || quantity < 0 || quantity > 99)
        return json({ error: "Ongeldig aantal in de bestelling." }, 400);
      if (closed && quantity !== (Number(stored.get(person.id)?.orders?.[productId]) || 0))
        return json({ error: closedMessage(config.orderDeadline), ordersClosed: true }, 409);
      orders[productId] = quantity;
    }
    const barCents = Math.max(0, Number(stored.get(person.id)?.barCents) || 0); // bar bill: only the organisation
    const member = withDiet(
      { id: person.id, name: person.name.trim(), type: person.type, orders, ...(barCents ? { barCents } : {}) },
      person
    );
    if (!member) return json({ error: "Controleer de allergieën en opmerkingen (maximaal 200 tekens)." }, 400);
    members.push(member);
  }
  // A bar bill is money owed: a person who has one stays, also before the order deadline.
  for (const [id, person] of stored) {
    if (!memberIds.has(id) && Number(person.barCents) > 0)
      return json(
        { error: person.name + " heeft een barrekening en kan niet worden verwijderd. Vraag het aan de organisatie." },
        409
      );
  }
  if (closed) {
    for (const [id, person] of stored) {
      const ordered = Object.values(person.orders || {}).some(qty => Number(qty) > 0);
      if (!memberIds.has(id) && (ordered || Number(person.barCents) > 0))
        return json({ error: closedMessage(config.orderDeadline), ordersClosed: true }, 409);
    }
  }
  const updatedRegistration = {
    ...registration,
    members,
    adults: members.filter(person => person.type === "Volwassene").length,
    children: members.filter(person => person.type === "Kind").length
  };
  const serialized = JSON.stringify(updatedRegistration);
  if (canonicalMembers(registration.members) === canonicalMembers(members))
    return json({
      saved: true,
      unchanged: true,
      revision: Number(row.updated_at),
      registration: { id: registrationId, ...updatedRegistration }
    });
  // One transaction: save the registration and reopen finalized edition costs,
  // the latter guarded on the exact row the first statement writes.
  const nextRevision = Math.max(body.revision + 1, now);
  const results = await env.DB.batch([
    env.DB.prepare(
      "UPDATE event_registrations SET data_json = ?, updated_at = ? WHERE id = ? AND edition_id = ? AND updated_at = ?"
    ).bind(serialized, nextRevision, registrationId, editionId, body.revision),
    env.DB.prepare(
      "UPDATE edition_finance_snapshots SET costs_finalized = 0, costs_finalized_at = NULL, updated_at = MAX(updated_at + 1, ?) WHERE edition_id = ? AND costs_finalized = 1 AND EXISTS (SELECT 1 FROM event_registrations WHERE id = ? AND updated_at = ? AND data_json = ?)"
    ).bind(now, editionId, registrationId, nextRevision, serialized)
  ]);
  if (!Number(results?.[0]?.meta?.changes ?? 0))
    return json(
      {
        error:
          "Iemand anders heeft jullie inschrijving net aangepast. We tonen nu de nieuwste gegevens; controleer ze en pas opnieuw aan.",
        conflict: "registration"
      },
      409
    );
  await logRegistrationChange(env, {
    editionId,
    familyId: row.family_id,
    registrationId,
    familyName: registration.name || "",
    actorId: session.user_id,
    actor: session.display_name || "",
    before: registration.members,
    after: members,
    catalog: config.catalog,
    now,
    sha256
  });
  return json({ saved: true, revision: nextRevision, registration: { id: registrationId, ...updatedRegistration } });
}
