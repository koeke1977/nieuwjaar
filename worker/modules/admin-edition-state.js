// Admin API for one event edition, backed by the normalized tables:
//   event_editions (label, status, catalog in config_json)
//   event_registrations (one row per family per edition)
//   edition_finance_snapshots (expenses, payments, finalized flag)
// A save is a single D1 batch. Every row the client changed is guarded on the revision it
// last saw; a guard failure aborts the whole batch (nothing is written) and returns 409.

import { withDiet } from "../../src/utils/diet.js";

const ID = /^[A-Za-z0-9_-]{1,120}$/;
const PRODUCT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const CONFLICT = "edition-state-conflict";
// A cost paid from the shared kitty (not advanced by a family): nobody gets an advance credit.
export const SHARED_FUND = "kas";

function parse(json, fallback) { try { return JSON.parse(json || ""); } catch { return fallback; } }
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export async function loadEditionState(env, editionId) {
  const edition = await env.DB.prepare(
    "SELECT d.id, d.event_id, d.label, d.status, d.starts_at, d.ends_at, d.config_json, d.updated_at, e.name AS event_name, e.finance_strategy, e.updated_at AS event_updated_at FROM event_editions d JOIN events e ON e.id = d.event_id WHERE d.id = ?"
  ).bind(editionId).first();
  if (!edition) return null;
  const [rows, snapshot] = await Promise.all([
    env.DB.prepare("SELECT id, family_id, data_json, updated_at FROM event_registrations WHERE edition_id = ? AND status = 'active' ORDER BY created_at, id").bind(editionId).all(),
    env.DB.prepare("SELECT expenses_json, payments_json, costs_finalized, costs_finalized_at, updated_at FROM edition_finance_snapshots WHERE edition_id = ?").bind(editionId).first()
  ]);
  const config = parse(edition.config_json, {}) || {};
  const registrations = (rows.results || []).map(row => {
    const data = parse(row.data_json, {}) || {};
    const members = Array.isArray(data.members) ? data.members : [];
    return {
      id: row.id, familyId: row.family_id, name: String(data.name || ""),
      adults: members.length ? members.filter(p => p?.type === "Volwassene").length : Math.max(0, Number(data.adults) || 0),
      children: members.length ? members.filter(p => p?.type === "Kind").length : Math.max(0, Number(data.children) || 0),
      members, revision: Number(row.updated_at) || 0
    };
  });
  return {
    editionId: edition.id, eventId: edition.event_id, eventName: edition.event_name,
    editionLabel: edition.label, editionStatus: edition.status, financeStrategy: edition.finance_strategy,
    startsAt: edition.starts_at, endsAt: edition.ends_at,
    catalog: Array.isArray(config.catalog) ? config.catalog : [],
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
    "SELECT d.updated_at AS d, e.updated_at AS e, (SELECT COUNT(*) FROM event_registrations WHERE edition_id = d.id) AS n, (SELECT MAX(updated_at) FROM event_registrations WHERE edition_id = d.id) AS r, (SELECT updated_at FROM edition_finance_snapshots WHERE edition_id = d.id) AS f FROM event_editions d JOIN events e ON e.id = d.event_id WHERE d.id = ?"
  ).bind(editionId).first();
  return row ? [row.d, row.e, row.n, row.r || 0, row.f || 0].join(".") : null;
}

function validName(value, max) {
  return typeof value === "string" && value.trim() && value.trim().length <= max ? value.trim() : null;
}

function cleanMembers(members) {
  if (!Array.isArray(members) || members.length > 30) return null;
  const ids = new Set(), out = [];
  for (const person of members) {
    const name = validName(person?.name, 80);
    if (!person || typeof person.id !== "string" || !ID.test(person.id) || ids.has(person.id) || !name || !["Volwassene", "Kind"].includes(person.type)) return null;
    ids.add(person.id);
    const orders = {};
    for (const [productId, qty] of Object.entries(person.orders && typeof person.orders === "object" && !Array.isArray(person.orders) ? person.orders : {})) {
      const quantity = Number(qty);
      if (!PRODUCT_ID.test(productId) || !Number.isInteger(quantity) || quantity < 0 || quantity > 99) return null;
      orders[productId] = quantity;
    }
    const clean = withDiet({ id: person.id, name, type: person.type, orders }, person);
    if (!clean) return null;
    out.push(clean);
  }
  return out;
}

function cleanCatalog(catalog) {
  if (!Array.isArray(catalog) || catalog.length > 200) return null;
  const ids = new Set(), out = [];
  for (const raw of catalog) {
    const id = typeof raw?.id === "string" ? raw.id.trim() : "";
    const name = validName(raw?.name, 100);
    const image = typeof raw?.image === "string" ? raw.image.trim() : "";
    const safeImage = !image || (image.startsWith("/") && !image.startsWith("//") && !/[\s\\]/.test(image));
    if (!PRODUCT_ID.test(id) || ids.has(id) || !name || image.length > 1000 || !safeImage) return null;
    ids.add(id);
    out.push({ id, name, image: image || null, active: raw.active !== false });
  }
  return out;
}

function cleanFinance(data, registrationIds) {
  if (!Array.isArray(data.expenses) || data.expenses.length > 2000 || !Array.isArray(data.payments) || data.payments.length > 5000) return null;
  const expenseIds = new Set(), paymentIds = new Set(), expenses = [], payments = [];
  for (const item of data.expenses) {
    const description = validName(item?.description, 120);
    if (!item || !ID.test(String(item.id)) || expenseIds.has(item.id) || !description || !Number.isSafeInteger(item.amountCents) || item.amountCents <= 0 ||
        typeof item.date !== "string" || Number.isNaN(Date.parse(item.date)) || !["general", "adults", "meat"].includes(item.method) || !(registrationIds.has(item.advancedBy) || item.advancedBy === SHARED_FUND)) return null;
    expenseIds.add(item.id);
    if (item.enteredBy != null && item.enteredBy !== "family") return null;
    expenses.push({ id: item.id, description, amountCents: item.amountCents, date: item.date, method: item.method, advancedBy: item.advancedBy, ...(item.enteredBy === "family" ? { enteredBy: "family" } : {}) });
  }
  for (const item of data.payments) {
    if (!item || !ID.test(String(item.id)) || paymentIds.has(item.id) || !registrationIds.has(item.registrationId) || !Number.isSafeInteger(item.amountCents) || item.amountCents <= 0 ||
        typeof item.date !== "string" || Number.isNaN(Date.parse(item.date)) || !["cash", "bank"].includes(item.method) ||
        (item.kind != null && !["payment", "refund"].includes(item.kind))) return null;
    paymentIds.add(item.id);
    payments.push({ id: item.id, registrationId: item.registrationId, amountCents: item.amountCents, date: item.date, method: item.method, ...(item.kind === "refund" ? { kind: "refund" } : {}) });
  }
  return { expenses, payments };
}

// A statement that aborts the batch (and so rolls back every write) when `existsSql` finds nothing.
function guard(env, existsSql, ...binds) {
  return env.DB.prepare("SELECT json(CASE WHEN EXISTS (" + existsSql + ") THEN '1' ELSE '" + CONFLICT + "' END) AS ok").bind(...binds);
}

const registrationContent = r => ({ familyId: r.familyId, name: r.name, members: r.members });

export async function saveEditionState(env, editionId, body, now) {
  const base = body?.base, data = body?.data;
  if (!base || !data || typeof base !== "object" || typeof data !== "object") return { status: 400, error: "Ongeldige gegevens." };
  const current = await env.DB.prepare("SELECT id, event_id, label, config_json, updated_at FROM event_editions WHERE id = ?").bind(editionId).first();
  if (!current) return { status: 404, error: "Editie niet gevonden." };
  if (base.editionId !== editionId) return { status: 400, error: "De gegevens horen bij een andere editie." };

  const eventName = validName(data.eventName, 100), editionLabel = validName(data.editionLabel, 100);
  const catalog = cleanCatalog(data.catalog);
  if (!eventName || !editionLabel || !catalog || !Array.isArray(data.registrations) || data.registrations.length > 500 || typeof data.costsFinalized !== "boolean") {
    return { status: 400, error: "Controleer de naam van het evenement, de editie en de producten." };
  }
  const registrations = [];
  const seen = new Set();
  for (const raw of data.registrations) {
    const name = validName(raw?.name, 160);
    const members = cleanMembers(raw?.members);
    if (!raw || !ID.test(String(raw.id)) || seen.has(raw.id) || !name || !members || (raw.familyId != null && !ID.test(String(raw.familyId)))) {
      return { status: 400, error: "Controleer de namen en gezinsleden van alle inschrijvingen." };
    }
    seen.add(raw.id);
    registrations.push({ id: raw.id, familyId: raw.familyId || null, name, members, revision: Number(raw.revision) || 0 });
  }
  const finance = cleanFinance(data, seen);
  if (!finance) return { status: 400, error: "Een kost of betaling bevat ongeldige gegevens of verwijst naar een onbekende inschrijving." };

  const statements = [];
  const nextRevision = Math.max(now, Number(current.updated_at) + 1);
  const baseRegs = new Map((Array.isArray(base.registrations) ? base.registrations : []).map(r => [r.id, r]));

  // Event and edition names, catalog
  if (!same(base.eventName, eventName)) {
    statements.push(env.DB.prepare("UPDATE events SET name = ?, updated_at = ? WHERE id = ?").bind(eventName, now, current.event_id));
  }
  if (!same(base.editionLabel, editionLabel) || !same(base.catalog, catalog)) {
    statements.push(guard(env, "SELECT 1 FROM event_editions WHERE id = ? AND updated_at = ?", editionId, Number(base.configRevision) || 0));
    const config = parse(current.config_json, {}) || {};
    config.catalog = catalog;
    statements.push(env.DB.prepare("UPDATE event_editions SET label = ?, config_json = ?, updated_at = ? WHERE id = ?").bind(editionLabel, JSON.stringify(config), nextRevision, editionId));
  }

  // Registrations: insert new, update changed, cancel removed
  for (const reg of registrations) {
    const previous = baseRegs.get(reg.id);
    const payload = JSON.stringify({ name: reg.name, adults: reg.members.filter(p => p.type === "Volwassene").length, children: reg.members.filter(p => p.type === "Kind").length, members: reg.members });
    if (!previous) {
      const familyId = reg.familyId || "family-" + crypto.randomUUID();
      statements.push(env.DB.prepare("INSERT INTO families (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING").bind(familyId, reg.name, now, now));
      // One registration per family per edition. Re-registering after "uitschrijven" reactivates
      // the cancelled row; registering a family that is already active is a conflict.
      statements.push(guard(env, "SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM event_registrations WHERE edition_id = ? AND family_id = ? AND status = 'active')", editionId, familyId));
      statements.push(env.DB.prepare("INSERT INTO event_registrations (id, edition_id, family_id, status, data_json, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?, ?) ON CONFLICT(edition_id, family_id) DO UPDATE SET status = 'active', data_json = excluded.data_json, updated_at = excluded.updated_at").bind(reg.id, editionId, familyId, payload, now, now));
      continue;
    }
    if (same(registrationContent(previous), registrationContent({ ...reg, familyId: previous.familyId }))) continue;
    statements.push(guard(env, "SELECT 1 FROM event_registrations WHERE id = ? AND edition_id = ? AND status = 'active' AND updated_at = ?", reg.id, editionId, Number(previous.revision) || 0));
    statements.push(env.DB.prepare("UPDATE event_registrations SET data_json = ?, updated_at = ? WHERE id = ?").bind(payload, Math.max(now, (Number(previous.revision) || 0) + 1), reg.id));
    if (previous.name !== reg.name && previous.familyId) {
      statements.push(env.DB.prepare("UPDATE families SET display_name = ?, updated_at = ? WHERE id = ?").bind(reg.name, now, previous.familyId));
    }
  }
  for (const [id, previous] of baseRegs) {
    if (seen.has(id)) continue;
    statements.push(guard(env, "SELECT 1 FROM event_registrations WHERE id = ? AND edition_id = ? AND status = 'active' AND updated_at = ?", id, editionId, Number(previous.revision) || 0));
    statements.push(env.DB.prepare("UPDATE event_registrations SET status = 'cancelled', updated_at = ? WHERE id = ?").bind(Math.max(now, (Number(previous.revision) || 0) + 1), id));
  }

  // Finance
  const financeChanged = !same(base.expenses, finance.expenses) || !same(base.payments, finance.payments) ||
    !same(Boolean(base.costsFinalized), data.costsFinalized) || (data.costsFinalized && !same(base.costsFinalizedAt, data.costsFinalizedAt));
  if (financeChanged) {
    const finalizedAt = data.costsFinalized ? (typeof data.costsFinalizedAt === "string" && !Number.isNaN(Date.parse(data.costsFinalizedAt)) ? data.costsFinalizedAt : new Date(now * 1000).toISOString()) : null;
    const financeRevision = Number(base.financeRevision) || 0;
    statements.push(guard(env, "SELECT 1 WHERE COALESCE((SELECT updated_at FROM edition_finance_snapshots WHERE edition_id = ?), 0) = ?", editionId, financeRevision));
    statements.push(env.DB.prepare(
      "INSERT INTO edition_finance_snapshots (edition_id, expenses_json, payments_json, costs_finalized, costs_finalized_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(edition_id) DO UPDATE SET expenses_json = excluded.expenses_json, payments_json = excluded.payments_json, costs_finalized = excluded.costs_finalized, costs_finalized_at = excluded.costs_finalized_at, source_environment = NULL, source_revision = NULL, updated_at = excluded.updated_at"
    ).bind(editionId, JSON.stringify(finance.expenses), JSON.stringify(finance.payments), data.costsFinalized ? 1 : 0, finalizedAt, now, Math.max(now, financeRevision + 1)));
  }

  if (!statements.length) return { status: 200, state: await loadEditionState(env, editionId), unchanged: true };
  try {
    await env.DB.batch(statements);
  } catch (error) {
    const message = String(error?.message || "");
    if (/malformed JSON|JSON/i.test(message) && message.includes("malformed")) return { status: 409, error: "Iemand anders heeft deze editie net aangepast.", conflict: true };
    if (/UNIQUE/i.test(message)) return { status: 409, error: "Dit gezin is al ingeschreven voor deze editie.", conflict: true };
    if (/FOREIGN KEY/i.test(message)) return { status: 400, error: "Een inschrijving verwijst naar een onbekend gezin." };
    throw error;
  }
  return { status: 200, state: await loadEditionState(env, editionId) };
}

// Archive the current edition and open the next one. Families and their accounts stay;
// they register again for the new edition.
export async function startNextEdition(env, editionId, body, now) {
  const label = validName(body?.label, 100);
  if (!label) return { status: 400, error: "Geef de nieuwe editie een naam." };
  const current = await env.DB.prepare("SELECT id, event_id, status, config_json FROM event_editions WHERE id = ?").bind(editionId).first();
  if (!current) return { status: 404, error: "Editie niet gevonden." };
  if (current.status === "archived") return { status: 409, error: "Deze editie is al afgesloten." };
  const duplicate = await env.DB.prepare("SELECT 1 FROM event_editions WHERE event_id = ? AND lower(label) = lower(?)").bind(current.event_id, label).first();
  if (duplicate) return { status: 409, error: "Er bestaat al een editie met deze naam." };
  const config = parse(current.config_json, {}) || {};
  const newConfig = body?.copyCatalog === false ? {} : { catalog: Array.isArray(config.catalog) ? config.catalog : [] };
  const id = "edition-" + crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("UPDATE event_editions SET status = 'archived', updated_at = ? WHERE id = ?").bind(now, editionId),
    env.DB.prepare("INSERT INTO event_editions (id, event_id, label, status, config_json, created_at, updated_at) VALUES (?, ?, ?, 'open', ?, ?, ?)").bind(id, current.event_id, label, JSON.stringify(newConfig), now, now),
    env.DB.prepare("INSERT INTO edition_finance_snapshots (edition_id, expenses_json, payments_json, costs_finalized, created_at, updated_at) VALUES (?, '[]', '[]', 0, ?, ?)").bind(id, now, now)
  ]);
  return { status: 201, editionId: id };
}

export async function handleAdminEditionState(request, env, url, { json, sameOrigin, adminSession }) {
  if (!env.DB) return json({ error: "Database niet geconfigureerd." }, 503);
  if (!await adminSession(request, env)) return json({ error: "Niet aangemeld." }, 401);
  if (request.method !== "GET" && !sameOrigin(request)) return json({ error: "Ongeldige aanvraag." }, 403);
  const match = url.pathname.match(/^\/api\/admin\/editions\/([A-Za-z0-9_-]+)\/(state|version|next)$/);
  if (!match) return null;
  const [, editionId, action] = match;
  const now = Math.floor(Date.now() / 1000);
  if (action === "state" && request.method === "GET") {
    const state = await loadEditionState(env, editionId);
    return state ? json(state) : json({ error: "Editie niet gevonden." }, 404);
  }
  if (action === "version" && request.method === "GET") {
    const version = await editionVersion(env, editionId);
    return version ? json({ version }) : json({ error: "Editie niet gevonden." }, 404);
  }
  if (action === "state" && request.method === "PUT") {
    const body = await request.json().catch(() => null);
    const result = await saveEditionState(env, editionId, body, now);
    return result.status === 200 ? json({ saved: true, unchanged: Boolean(result.unchanged), state: result.state }) : json({ error: result.error, conflict: Boolean(result.conflict) }, result.status);
  }
  if (action === "next" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    const result = await startNextEdition(env, editionId, body, now);
    return result.status === 201 ? json({ created: true, editionId: result.editionId }, 201) : json({ error: result.error }, result.status);
  }
  return json({ error: "Niet gevonden." }, 404);
}
