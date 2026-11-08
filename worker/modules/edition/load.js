// Reading an edition from the normalized tables, its change marker, and starting the next edition.
import { parse } from "./common.js";
import { validName } from "./clean.js";

export async function loadEditionState(env, editionId) {
  const edition = await env.DB.prepare(
    "SELECT d.id, d.event_id, d.label, d.status, d.starts_at, d.ends_at, d.config_json, d.updated_at, e.name AS event_name, e.finance_strategy, e.updated_at AS event_updated_at FROM event_editions d JOIN events e ON e.id = d.event_id WHERE d.id = ?"
  )
    .bind(editionId)
    .first();
  if (!edition) return null;
  const [rows, snapshot] = await Promise.all([
    env.DB.prepare(
      "SELECT id, family_id, data_json, updated_at FROM event_registrations WHERE edition_id = ? AND status = 'active' ORDER BY created_at, id"
    )
      .bind(editionId)
      .all(),
    env.DB.prepare(
      "SELECT expenses_json, payments_json, costs_finalized, costs_finalized_at, updated_at FROM edition_finance_snapshots WHERE edition_id = ?"
    )
      .bind(editionId)
      .first()
  ]);
  const config = parse(edition.config_json, {}) || {};
  const registrations = (rows.results || []).map(row => {
    const data = parse(row.data_json, {}) || {};
    const members = Array.isArray(data.members) ? data.members : [];
    return {
      id: row.id,
      familyId: row.family_id,
      name: String(data.name || ""),
      adults: members.length
        ? members.filter(p => p?.type === "Volwassene").length
        : Math.max(0, Number(data.adults) || 0),
      children: members.length
        ? members.filter(p => p?.type === "Kind").length
        : Math.max(0, Number(data.children) || 0),
      members,
      revision: Number(row.updated_at) || 0
    };
  });
  return {
    editionId: edition.id,
    eventId: edition.event_id,
    eventName: edition.event_name,
    editionLabel: edition.label,
    editionStatus: edition.status,
    financeStrategy: edition.finance_strategy,
    startsAt: edition.starts_at,
    endsAt: edition.ends_at,
    catalog: Array.isArray(config.catalog) ? config.catalog : [],
    orderDeadline: typeof config.orderDeadline === "string" ? config.orderDeadline : null,
    butcherEmail: typeof config.butcherEmail === "string" ? config.butcherEmail : "",
    butcherSentAt: Number(config.butcherSentAt) || null,
    settlementSentAt: Number(config.settlementSentAt) || null,
    cancelRequests: config.cancelRequests && typeof config.cancelRequests === "object" ? config.cancelRequests : {},
    registrations,
    expenses: parse(snapshot?.expenses_json, []) || [],
    payments: parse(snapshot?.payments_json, []) || [],
    costsFinalized: Boolean(snapshot?.costs_finalized),
    costsFinalizedAt: snapshot?.costs_finalized_at || null,
    financeRevision: Number(snapshot?.updated_at) || 0,
    configRevision: Number(edition.updated_at) || 0,
    version: await editionVersion(env, editionId)
  };
}

// Cheap change marker for live refresh: changes whenever anything in the edition changes.
export async function editionVersion(env, editionId) {
  const row = await env.DB.prepare(
    "SELECT d.updated_at AS d, e.updated_at AS e, LENGTH(d.config_json) AS c, (SELECT COUNT(*) FROM event_registrations WHERE edition_id = d.id) AS n, (SELECT MAX(updated_at) FROM event_registrations WHERE edition_id = d.id) AS r, (SELECT updated_at FROM edition_finance_snapshots WHERE edition_id = d.id) AS f FROM event_editions d JOIN events e ON e.id = d.event_id WHERE d.id = ?"
  )
    .bind(editionId)
    .first();
  return row ? [row.d, row.e, row.n, row.r || 0, row.f || 0, row.c || 0].join(".") : null;
}

// Archive the current edition and open the next one. Families and their accounts stay;
// they register again for the new edition.
export async function startNextEdition(env, editionId, body, now) {
  const label = validName(body?.label, 100);
  if (!label) return { status: 400, error: "Geef de nieuwe editie een naam." };
  const current = await env.DB.prepare("SELECT id, event_id, status, config_json FROM event_editions WHERE id = ?")
    .bind(editionId)
    .first();
  if (!current) return { status: 404, error: "Editie niet gevonden." };
  if (current.status === "archived") return { status: 409, error: "Deze editie is al afgesloten." };
  const duplicate = await env.DB.prepare("SELECT 1 FROM event_editions WHERE event_id = ? AND lower(label) = lower(?)")
    .bind(current.event_id, label)
    .first();
  if (duplicate) return { status: 409, error: "Er bestaat al een editie met deze naam." };
  const config = parse(current.config_json, {}) || {};
  const newConfig = body?.copyCatalog === false ? {} : { catalog: Array.isArray(config.catalog) ? config.catalog : [] };
  if (typeof config.butcherEmail === "string" && config.butcherEmail) newConfig.butcherEmail = config.butcherEmail;
  const id = "edition-" + crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("UPDATE event_editions SET status = 'archived', updated_at = ? WHERE id = ?").bind(now, editionId),
    env.DB.prepare(
      "INSERT INTO event_editions (id, event_id, label, status, config_json, created_at, updated_at) VALUES (?, ?, ?, 'open', ?, ?, ?)"
    ).bind(id, current.event_id, label, JSON.stringify(newConfig), now, now),
    env.DB.prepare(
      "INSERT INTO edition_finance_snapshots (edition_id, expenses_json, payments_json, costs_finalized, created_at, updated_at) VALUES (?, '[]', '[]', 0, ?, ?)"
    ).bind(id, now, now)
  ]);
  return { status: 201, editionId: id };
}
