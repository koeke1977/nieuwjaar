// Saving an edition. A save is a single D1 batch: event_editions (label, catalog in config_json),
// event_registrations (one row per family per edition) and edition_finance_snapshots (costs, payments).
// Every row the client changed is guarded on the revision it last saw; a guard failure aborts the
// whole batch (nothing is written) and returns 409.
import { isLocalDateTime } from "../../../src/utils/time.js";
import { CONFLICT, ID, same, parse } from "./common.js";
import { validName, cleanCatalog, cleanMembers, cleanFinance } from "./clean.js";
import { loadEditionState } from "./load.js";

// A statement that aborts the batch (and so rolls back every write) when `existsSql` finds nothing.
function guard(env, existsSql, ...binds) {
  return env.DB.prepare(
    "SELECT json(CASE WHEN EXISTS (" + existsSql + ") THEN '1' ELSE '" + CONFLICT + "' END) AS ok"
  ).bind(...binds);
}

const registrationContent = r => ({ familyId: r.familyId, name: r.name, members: r.members });

export async function saveEditionState(env, editionId, body, now) {
  const base = body?.base,
    data = body?.data;
  if (!base || !data || typeof base !== "object" || typeof data !== "object")
    return { status: 400, error: "Ongeldige gegevens." };
  const current = await env.DB.prepare(
    "SELECT id, event_id, label, config_json, updated_at FROM event_editions WHERE id = ?"
  )
    .bind(editionId)
    .first();
  if (!current) return { status: 404, error: "Editie niet gevonden." };
  if (base.editionId !== editionId) return { status: 400, error: "De gegevens horen bij een andere editie." };

  const eventName = validName(data.eventName, 100),
    editionLabel = validName(data.editionLabel, 100);
  // Date and time of the edition (local time, e.g. "2026-12-31T20:00"), used for the countdown.
  const startsAt =
    data.startsAt == null || data.startsAt === ""
      ? null
      : typeof data.startsAt === "string" &&
          /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(data.startsAt) &&
          !Number.isNaN(Date.parse(data.startsAt))
        ? data.startsAt
        : undefined;
  if (startsAt === undefined) return { status: 400, error: "Controleer de datum en het uur van de editie." };
  const orderDeadline =
    data.orderDeadline == null || data.orderDeadline === ""
      ? null
      : isLocalDateTime(data.orderDeadline)
        ? data.orderDeadline
        : undefined;
  if (orderDeadline === undefined) return { status: 400, error: "Controleer de datum waarop het bestellen sluit." };
  const catalog = cleanCatalog(data.catalog);
  if (
    !eventName ||
    !editionLabel ||
    !catalog ||
    !Array.isArray(data.registrations) ||
    data.registrations.length > 500 ||
    typeof data.costsFinalized !== "boolean"
  ) {
    return { status: 400, error: "Controleer de naam van het evenement, de editie en de producten." };
  }
  const registrations = [];
  const seen = new Set();
  for (const raw of data.registrations) {
    const name = validName(raw?.name, 160);
    const members = cleanMembers(raw?.members);
    if (
      !raw ||
      !ID.test(String(raw.id)) ||
      seen.has(raw.id) ||
      !name ||
      !members ||
      (raw.familyId != null && !ID.test(String(raw.familyId)))
    ) {
      return { status: 400, error: "Controleer de namen en gezinsleden van alle inschrijvingen." };
    }
    seen.add(raw.id);
    registrations.push({
      id: raw.id,
      familyId: raw.familyId || null,
      name,
      members,
      revision: Number(raw.revision) || 0
    });
  }
  const finance = cleanFinance(data, seen);
  if (!finance)
    return {
      status: 400,
      error: "Een kost of betaling bevat ongeldige gegevens of verwijst naar een onbekende inschrijving."
    };

  const statements = [];
  const nextRevision = Math.max(now, Number(current.updated_at) + 1);
  const baseRegs = new Map((Array.isArray(base.registrations) ? base.registrations : []).map(r => [r.id, r]));

  // Event and edition names, catalog
  if (!same(base.eventName, eventName)) {
    statements.push(
      env.DB.prepare("UPDATE events SET name = ?, updated_at = ? WHERE id = ?").bind(eventName, now, current.event_id)
    );
  }
  if (
    !same(base.editionLabel, editionLabel) ||
    !same(base.catalog, catalog) ||
    !same(base.startsAt ?? null, startsAt) ||
    !same(base.orderDeadline ?? null, orderDeadline)
  ) {
    statements.push(
      guard(
        env,
        "SELECT 1 FROM event_editions WHERE id = ? AND updated_at = ?",
        editionId,
        Number(base.configRevision) || 0
      )
    );
    const config = parse(current.config_json, {}) || {};
    config.catalog = catalog;
    if (orderDeadline) config.orderDeadline = orderDeadline;
    else delete config.orderDeadline;
    statements.push(
      env.DB.prepare(
        "UPDATE event_editions SET label = ?, config_json = ?, starts_at = ?, updated_at = ? WHERE id = ?"
      ).bind(editionLabel, JSON.stringify(config), startsAt, nextRevision, editionId)
    );
  }

  // Registrations: insert new, update changed, cancel removed
  for (const reg of registrations) {
    const previous = baseRegs.get(reg.id);
    const payload = JSON.stringify({
      name: reg.name,
      adults: reg.members.filter(p => p.type === "Volwassene").length,
      children: reg.members.filter(p => p.type === "Kind").length,
      members: reg.members
    });
    if (!previous) {
      const familyId = reg.familyId || "family-" + crypto.randomUUID();
      statements.push(
        env.DB.prepare(
          "INSERT INTO families (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING"
        ).bind(familyId, reg.name, now, now)
      );
      // One registration per family per edition. Re-registering after "uitschrijven" reactivates
      // the cancelled row; registering a family that is already active is a conflict.
      statements.push(
        guard(
          env,
          "SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM event_registrations WHERE edition_id = ? AND family_id = ? AND status = 'active')",
          editionId,
          familyId
        )
      );
      statements.push(
        env.DB.prepare(
          "INSERT INTO event_registrations (id, edition_id, family_id, status, data_json, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?, ?) ON CONFLICT(edition_id, family_id) DO UPDATE SET status = 'active', data_json = excluded.data_json, updated_at = excluded.updated_at"
        ).bind(reg.id, editionId, familyId, payload, now, now)
      );
      continue;
    }
    if (same(registrationContent(previous), registrationContent({ ...reg, familyId: previous.familyId }))) continue;
    statements.push(
      guard(
        env,
        "SELECT 1 FROM event_registrations WHERE id = ? AND edition_id = ? AND status = 'active' AND updated_at = ?",
        reg.id,
        editionId,
        Number(previous.revision) || 0
      )
    );
    statements.push(
      env.DB.prepare("UPDATE event_registrations SET data_json = ?, updated_at = ? WHERE id = ?").bind(
        payload,
        Math.max(now, (Number(previous.revision) || 0) + 1),
        reg.id
      )
    );
    if (previous.name !== reg.name && previous.familyId) {
      statements.push(
        env.DB.prepare("UPDATE families SET display_name = ?, updated_at = ? WHERE id = ?").bind(
          reg.name,
          now,
          previous.familyId
        )
      );
    }
  }
  for (const [id, previous] of baseRegs) {
    if (seen.has(id)) continue;
    statements.push(
      guard(
        env,
        "SELECT 1 FROM event_registrations WHERE id = ? AND edition_id = ? AND status = 'active' AND updated_at = ?",
        id,
        editionId,
        Number(previous.revision) || 0
      )
    );
    statements.push(
      env.DB.prepare("UPDATE event_registrations SET status = 'cancelled', updated_at = ? WHERE id = ?").bind(
        Math.max(now, (Number(previous.revision) || 0) + 1),
        id
      )
    );
  }

  // Finance
  const financeChanged =
    !same(base.expenses, finance.expenses) ||
    !same(base.payments, finance.payments) ||
    !same(Boolean(base.costsFinalized), data.costsFinalized) ||
    (data.costsFinalized && !same(base.costsFinalizedAt, data.costsFinalizedAt));
  if (financeChanged) {
    const finalizedAt = data.costsFinalized
      ? typeof data.costsFinalizedAt === "string" && !Number.isNaN(Date.parse(data.costsFinalizedAt))
        ? data.costsFinalizedAt
        : new Date(now * 1000).toISOString()
      : null;
    const financeRevision = Number(base.financeRevision) || 0;
    statements.push(
      guard(
        env,
        "SELECT 1 WHERE COALESCE((SELECT updated_at FROM edition_finance_snapshots WHERE edition_id = ?), 0) = ?",
        editionId,
        financeRevision
      )
    );
    statements.push(
      env.DB.prepare(
        "INSERT INTO edition_finance_snapshots (edition_id, expenses_json, payments_json, costs_finalized, costs_finalized_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(edition_id) DO UPDATE SET expenses_json = excluded.expenses_json, payments_json = excluded.payments_json, costs_finalized = excluded.costs_finalized, costs_finalized_at = excluded.costs_finalized_at, source_environment = NULL, source_revision = NULL, updated_at = excluded.updated_at"
      ).bind(
        editionId,
        JSON.stringify(finance.expenses),
        JSON.stringify(finance.payments),
        data.costsFinalized ? 1 : 0,
        finalizedAt,
        now,
        Math.max(now, financeRevision + 1)
      )
    );
  }

  if (!statements.length) return { status: 200, state: await loadEditionState(env, editionId), unchanged: true };
  try {
    await env.DB.batch(statements);
  } catch (error) {
    const message = String(error?.message || "");
    if (/malformed JSON|JSON/i.test(message) && message.includes("malformed"))
      return { status: 409, error: "Iemand anders heeft deze editie net aangepast.", conflict: true };
    if (/UNIQUE/i.test(message))
      return { status: 409, error: "Dit gezin is al ingeschreven voor deze editie.", conflict: true };
    if (/FOREIGN KEY/i.test(message))
      return { status: 400, error: "Een inschrijving verwijst naar een onbekend gezin." };
    throw error;
  }
  return { status: 200, state: await loadEditionState(env, editionId) };
}
