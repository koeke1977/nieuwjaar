import test from "node:test";
import assert from "node:assert/strict";
import { createD1 } from "./helpers/d1.js";
import { handleFamilyAccountApi } from "../worker/modules/family-account.js";

const sha256 = async value => Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).toString("hex");
const deps = {
  json: (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } }),
  sameOrigin: () => true,
  cookieValue: (request, name) => (request.headers.get("Cookie") || "").split(/;\s*/).map(part => part.split("=")).find(([key]) => key === name)?.[1] || "",
  sha256,
  base64Url: bytes => Buffer.from(bytes).toString("base64url"),
  fromBase64Url: text => new Uint8Array(Buffer.from(text, "base64url")),
  sendGraphMail: async () => {}
};

const member = (id, steak) => ({ id, name: "Persoon " + id, type: "Volwassene", orders: { steak } });

async function setup() {
  const DB = createD1();
  const db = DB.raw;
  const now = Math.floor(Date.now() / 1000);
  db.prepare("INSERT INTO events (id, slug, name, finance_strategy, created_at, updated_at) VALUES ('ev', 'nieuwjaar', 'Nieuwjaar', 'nieuwjaar', 1, 1)").run();
  db.prepare("INSERT INTO event_editions (id, event_id, label, status, config_json, created_at, updated_at) VALUES ('ed', 'ev', '2026–2027', 'open', ?, 1, 1)").run(JSON.stringify({ catalog: [{ id: "steak", name: "Steak", active: true }, { id: "oud", name: "Oud", active: false }] }));
  db.prepare("INSERT INTO edition_finance_snapshots (edition_id, costs_finalized, costs_finalized_at, created_at, updated_at) VALUES ('ed', 1, '2026-12-31', 1, 1)").run();
  for (const id of ["a", "b"]) {
    db.prepare("INSERT INTO families (id, display_name, created_at, updated_at) VALUES (?, ?, 1, 1)").run("f" + id, id.toUpperCase());
    db.prepare("INSERT INTO event_registrations (id, edition_id, family_id, data_json, created_at, updated_at) VALUES (?, 'ed', ?, ?, 1, 100)")
      .run("r" + id, "f" + id, JSON.stringify({ name: id.toUpperCase(), members: [{ ...member(id + "1", 1), orders: { steak: 1, oud: 3 } }] }));
  }
  for (const [user, family, role] of [["ua", "fa", "owner"], ["ub", "fb", "owner"], ["ua2", "fa", "editor"], ["uv", "fa", "viewer"]]) {
    db.prepare("INSERT INTO family_users (id, email, display_name, status, created_at, updated_at) VALUES (?, ?, ?, 'active', 1, 1)").run(user, user + "@x.be", user);
    db.prepare("INSERT INTO family_user_sessions (user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)").run(user, await sha256("tok-" + user), now, now + 3600);
    db.prepare("INSERT INTO family_memberships (id, family_id, user_id, role, created_at) VALUES (?, ?, ?, ?, 1)").run("m-" + user, family, user, role);
  }
  return DB;
}

const buckets = new WeakMap();
function bucketFor(DB) {
  if (!buckets.has(DB)) {
    const objects = new Map();
    buckets.set(DB, { objects,
      put: async (key, body, options) => { objects.set(key, { body, type: options?.httpMetadata?.contentType }); },
      head: async key => objects.has(key) ? { key } : null,
      get: async key => objects.has(key) ? { body: objects.get(key).body, writeHttpMetadata: headers => headers.set("Content-Type", objects.get(key).type) } : null,
      delete: async key => { objects.delete(key); } });
  }
  return buckets.get(DB);
}
async function call(DB, user, method, path, body) {
  const url = new URL("https://nieuwjaar.datuur.be" + path);
  const request = new Request(url, { method, headers: { Cookie: "ny_family_account=tok-" + user, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const response = await handleFamilyAccountApi(request, { DB, PHOTOS: bucketFor(DB) }, url, deps);
  return { status: response.status, body: await response.json() };
}
async function uploadReceipt(DB, user, registrationId, type = "image/jpeg") {
  const url = new URL("https://nieuwjaar.datuur.be/api/family-account/receipts");
  const form = new FormData();
  form.append("file", new File([new Uint8Array([1, 2, 3])], "ticket", { type }));
  form.append("edition", "ed");
  form.append("registrationId", registrationId);
  const response = await handleFamilyAccountApi(new Request(url, { method: "POST", headers: { Cookie: "ny_family_account=tok-" + user }, body: form }), { DB, PHOTOS: bucketFor(DB) }, url, deps);
  return { status: response.status, body: await response.json() };
}
const save = (DB, user, registrationId, members, revision = 100) => call(DB, user, "PUT", "/api/family-account/registration", { edition: "ed", registrationId, revision, members });
const row = (DB, id) => DB.raw.prepare("SELECT data_json, updated_at FROM event_registrations WHERE id = ?").get(id);

test("two families saving at the same time both succeed (one row per family)", async () => {
  const DB = await setup();
  assert.equal((await save(DB, "ua", "ra", [member("a1", 4)])).status, 200);
  assert.equal((await save(DB, "ub", "rb", [member("b1", 6)])).status, 200);
  assert.equal(JSON.parse(row(DB, "ra").data_json).members[0].orders.steak, 4);
  assert.equal(JSON.parse(row(DB, "rb").data_json).members[0].orders.steak, 6);
  assert.equal(DB.raw.prepare("SELECT costs_finalized FROM edition_finance_snapshots").get().costs_finalized, 0, "an order change reopens finalized costs");
});

test("two people editing the same family: the second gets a clear conflict", async () => {
  const DB = await setup();
  assert.equal((await save(DB, "ua", "ra", [member("a1", 4)])).status, 200);
  const late = await save(DB, "ua2", "ra", [member("a1", 9)]);
  assert.equal(late.status, 409);
  assert.equal(late.body.conflict, "registration");
  assert.equal(JSON.parse(row(DB, "ra").data_json).members[0].orders.steak, 4);
});

test("quantities of inactive products are kept when a family saves", async () => {
  const DB = await setup();
  await save(DB, "ua", "ra", [member("a1", 2)]);
  assert.deepEqual(JSON.parse(row(DB, "ra").data_json).members[0].orders, { oud: 3, steak: 2 });
});

test("saving without changes writes nothing and keeps finalized costs", async () => {
  const DB = await setup();
  const first = await call(DB, "ua", "GET", "/api/family-account/session");
  const own = first.body.registrations[0];
  const result = await save(DB, "ua", "ra", own.registration.members, own.revision);
  assert.equal(result.status, 200);
  assert.equal(result.body.unchanged, true);
  assert.equal(row(DB, "ra").updated_at, 100);
  assert.equal(DB.raw.prepare("SELECT costs_finalized FROM edition_finance_snapshots").get().costs_finalized, 1);
});

test("a family cannot save another family's registration, and viewers cannot save at all", async () => {
  const DB = await setup();
  assert.equal((await save(DB, "ua", "rb", [member("b1", 50)])).status, 403);
  assert.equal((await save(DB, "uv", "ra", [member("a1", 50)])).status, 403);
});

test("archived editions are not shown and cannot be edited", async () => {
  const DB = await setup();
  DB.raw.prepare("UPDATE event_editions SET status = 'archived'").run();
  assert.equal((await call(DB, "ua", "GET", "/api/family-account/session")).body.registrations.length, 0);
  assert.equal((await save(DB, "ua", "ra", [member("a1", 2)])).status, 409);
});

test("a family can register itself for a new open edition, with last year's members", async () => {
  const DB = await setup();
  DB.raw.prepare("INSERT INTO event_editions (id, event_id, label, status, config_json, created_at, updated_at) VALUES ('ed2', 'ev', '2027–2028', 'open', '{}', 2, 2)").run();
  const before = (await call(DB, "ua", "GET", "/api/family-account/session")).body;
  assert.deepEqual(before.openEditions.map(open => open.edition), ["ed2"]);
  const viewer = await call(DB, "uv", "POST", "/api/family-account/register", { edition: "ed2", familyId: "fa" });
  assert.equal(viewer.status, 403, "viewers cannot register the family");
  const result = await call(DB, "ua", "POST", "/api/family-account/register", { edition: "ed2", familyId: "fa" });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  const after = (await call(DB, "ua", "GET", "/api/family-account/session")).body;
  assert.equal(after.openEditions.length, 0);
  const next = after.registrations.find(item => item.edition === "ed2");
  assert.deepEqual(next.registration.members.map(p => p.id), ["a1"]);
  assert.deepEqual(next.registration.members[0].orders, {}, "orders start empty");
  assert.equal((await call(DB, "ua", "POST", "/api/family-account/register", { edition: "ed2", familyId: "fa" })).status, 409);
  assert.equal((await call(DB, "ub", "POST", "/api/family-account/register", { edition: "ed2", familyId: "fa" })).status, 404, "not your family");
});

test("archived editions cannot be registered for", async () => {
  const DB = await setup();
  DB.raw.prepare("INSERT INTO event_editions (id, event_id, label, status, config_json, created_at, updated_at) VALUES ('old', 'ev', '2020', 'archived', '{}', 0, 0)").run();
  assert.equal((await call(DB, "ua", "POST", "/api/family-account/register", { edition: "old", familyId: "fa" })).status, 404);
});

test("allergies and notes are saved per person, and an allergy-only change is not ignored", async () => {
  const DB = await setup();
  const result = await save(DB, "ua", "ra", [{ ...member("a1", 1), diet: ["Glutenvrij", "Onbekend"], notes: "x" }]);
  assert.equal(result.status, 400, "unknown options are refused");
  const ok = await save(DB, "ua", "ra", [{ ...member("a1", 1), diet: ["Glutenvrij"], notes: "  geen pikant " }]);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.notEqual(ok.body.unchanged, true);
  const stored = JSON.parse(row(DB, "ra").data_json).members[0];
  assert.deepEqual(stored.diet, ["Glutenvrij"]);
  assert.equal(stored.notes, "geen pikant");
  const session = (await call(DB, "ua", "GET", "/api/family-account/session")).body;
  assert.deepEqual(session.registrations[0].registration.members[0].diet, ["Glutenvrij"]);
});

test("a family can add, change and delete its own costs; not the organisation's", async () => {
  const DB = await setup();
  const ticket = (await uploadReceipt(DB, "ua", "ra")).body.receipt;
  const expense = { description: "Drank", amountCents: 3000, date: "2026-12-20", method: "general", receipt: ticket };
  const added = await call(DB, "ua", "POST", "/api/family-account/expenses", { edition: "ed", registrationId: "ra", expense });
  assert.equal(added.status, 200, JSON.stringify(added.body));
  const snapshot = () => DB.raw.prepare("SELECT expenses_json, costs_finalized FROM edition_finance_snapshots").get();
  let expenses = JSON.parse(snapshot().expenses_json);
  assert.equal(expenses.length, 1);
  assert.equal(expenses[0].advancedBy, "ra");
  assert.equal(expenses[0].enteredBy, "family");
  assert.equal(snapshot().costs_finalized, 0, "a new cost reopens the settlement");
  const id = expenses[0].id;
  assert.equal((await call(DB, "ua", "POST", "/api/family-account/expenses", { edition: "ed", registrationId: "ra", expense: { ...expense, id, amountCents: 3500 } })).status, 200);
  assert.equal(JSON.parse(snapshot().expenses_json)[0].amountCents, 3500);
  assert.equal((await call(DB, "ub", "POST", "/api/family-account/expenses", { edition: "ed", registrationId: "rb", expense: { ...expense, id, receipt: undefined } })).status, 403, "another family cannot change it");
  assert.equal((await call(DB, "uv", "POST", "/api/family-account/expenses", { edition: "ed", registrationId: "ra", expense: { ...expense, id: undefined } })).status, 403, "viewers cannot add costs");
  // A cost entered by the organisation (no enteredBy) cannot be removed by the family.
  expenses = JSON.parse(snapshot().expenses_json);
  expenses.push({ id: "org", description: "Zaal", amountCents: 9000, date: "2026-12-01", method: "general", advancedBy: "ra" });
  DB.raw.prepare("UPDATE edition_finance_snapshots SET expenses_json = ?").run(JSON.stringify(expenses));
  assert.equal((await call(DB, "ua", "DELETE", "/api/family-account/expenses", { edition: "ed", registrationId: "ra", expenseId: "org" })).status, 403);
  assert.equal((await call(DB, "ua", "DELETE", "/api/family-account/expenses", { edition: "ed", registrationId: "ra", expenseId: id })).status, 200);
  assert.deepEqual(JSON.parse(snapshot().expenses_json).map(e => e.id), ["org"]);
});

test("a meat cost cannot be entered while nobody ordered meat", async () => {
  const DB = await setup();
  DB.raw.prepare("UPDATE event_registrations SET data_json = ?").run(JSON.stringify({ name: "X", members: [{ id: "x1", name: "X", type: "Volwassene", orders: {} }] }));
  const ticket = (await uploadReceipt(DB, "ua", "ra")).body.receipt;
  const result = await call(DB, "ua", "POST", "/api/family-account/expenses", { edition: "ed", registrationId: "ra", expense: { description: "Vlees", amountCents: 1000, date: "2026-12-01", method: "meat", receipt: ticket } });
  assert.equal(result.status, 400);
});

test("a cost from a family needs a receipt that belongs to that family", async () => {
  const DB = await setup();
  const base = { description: "Brood", amountCents: 1200, date: "2026-12-20", method: "general" };
  const missing = await call(DB, "ua", "POST", "/api/family-account/expenses", { edition: "ed", registrationId: "ra", expense: base });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.needsReceipt, true);
  assert.equal((await uploadReceipt(DB, "ua", "ra", "text/html")).status, 400, "only photos and PDFs");
  assert.equal((await uploadReceipt(DB, "ua", "rb")).status, 403, "cannot upload for another family");
  const otherTicket = (await uploadReceipt(DB, "ub", "rb")).body.receipt;
  assert.equal((await call(DB, "ua", "POST", "/api/family-account/expenses", { edition: "ed", registrationId: "ra", expense: { ...base, receipt: otherTicket } })).status, 400, "cannot use another family's receipt");
  const ticket = (await uploadReceipt(DB, "ua", "ra", "application/pdf")).body.receipt;
  assert.ok(ticket.startsWith("receipts/ed/ra/") && ticket.endsWith(".pdf"), ticket);
  assert.equal((await call(DB, "ua", "POST", "/api/family-account/expenses", { edition: "ed", registrationId: "ra", expense: { ...base, receipt: ticket } })).status, 200);
  const view = async user => (await handleFamilyAccountApi(new Request("https://x/api/family-account/receipts?key=" + encodeURIComponent(ticket), { headers: { Cookie: "ny_family_account=tok-" + user } }), { DB, PHOTOS: bucketFor(DB) }, new URL("https://x/api/family-account/receipts?key=" + encodeURIComponent(ticket)), deps)).status;
  assert.equal(await view("ua"), 200, "the family can view its receipt");
  assert.equal(await view("ub"), 404, "other families cannot");
  const id = JSON.parse(DB.raw.prepare("SELECT expenses_json FROM edition_finance_snapshots").get().expenses_json)[0].id;
  await call(DB, "ua", "DELETE", "/api/family-account/expenses", { edition: "ed", registrationId: "ra", expenseId: id });
  assert.equal(bucketFor(DB).objects.has(ticket), false, "deleting the cost deletes its receipt");
});

test("after the order deadline a family cannot change its order, but can still edit allergies", async () => {
  const DB = await setup();
  DB.raw.prepare("UPDATE event_editions SET config_json = json_set(config_json, '$.orderDeadline', '2020-01-01T00:00')").run();
  const session = (await call(DB, "ua", "GET", "/api/family-account/session")).body.registrations[0];
  assert.equal(session.ordersClosed, true);
  const order = await save(DB, "ua", "ra", [member("a1", 5)]);
  assert.equal(order.status, 409);
  assert.equal(order.body.ordersClosed, true);
  const allergy = await save(DB, "ua", "ra", [{ ...member("a1", 1), diet: ["Lactosevrij"] }]);
  assert.equal(allergy.status, 200, JSON.stringify(allergy.body));
  const removeOrdered = await save(DB, "ua", "ra", [{ id: "nieuw", name: "Nieuw", type: "Kind", orders: {} }]);
  assert.equal(removeOrdered.status, 409, "removing a person with an order is also blocked");
});

test("a personal bar bill is kept when a family saves and cannot be changed by the family", async () => {
  const DB = await setup();
  DB.raw.prepare("UPDATE event_registrations SET data_json = ? WHERE id = 'ra'").run(JSON.stringify({ name: "A", members: [{ ...member("a1", 1), barCents: 2100 }] }));
  const result = await save(DB, "ua", "ra", [{ ...member("a1", 2), barCents: 0 }]);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(JSON.parse(row(DB, "ra").data_json).members[0].barCents, 2100);
});
