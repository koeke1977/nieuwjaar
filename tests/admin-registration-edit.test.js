import test from "node:test";
import assert from "node:assert/strict";
import { createD1 } from "./helpers/d1.js";
import { handleAdminFamilyUsers } from "../worker/modules/admin-family-users.js";

const STATE_REVISION = 1000;
const LEGACY_REG_REVISION = 900; // differs from the app_state revision, as in production

const catalog = [
  { id: "p1", name: "Biefstuk", active: true },
  { id: "p2", name: "Kip", active: true },
  { id: "p3", name: "Oud product", active: false }
];

function seed(DB) {
  const db = DB.raw;
  const legacyData = {
    catalog,
    costsFinalized: true,
    costsFinalizedAt: "2026-01-02",
    registrations: [
      { id: "r1", name: "Familie Peeters", adults: 1, children: 1, members: [
        { id: "m1", name: "Jan", type: "Volwassene", orders: { p1: 2, p2: 0, p3: 4 } },
        { id: "m2", name: "Lies", type: "Kind", orders: { p1: 0, p2: 1, p3: 0 } }
      ] },
      { id: "r2", name: "Familie Janssens", adults: 1, children: 0, members: [
        { id: "m3", name: "An", type: "Volwassene", orders: { p1: 1, p2: 1, p3: 0 } }
      ] }
    ]
  };
  db.prepare("INSERT INTO app_state (environment, data_json, updated_at) VALUES ('live', ?, ?)").run(JSON.stringify(legacyData), STATE_REVISION);
  db.prepare("INSERT INTO events (id, slug, name, finance_strategy, created_at, updated_at) VALUES ('legacy-event-live', 'nieuwjaar', 'Nieuwjaar', 'nieuwjaar', 1, 1)").run();
  db.prepare("INSERT INTO event_editions (id, event_id, label, status, config_json, created_at, updated_at) VALUES ('legacy-edition-live', 'legacy-event-live', '2026', 'open', '{}', 1, 1)").run();
  db.prepare("INSERT INTO families (id, display_name, created_at, updated_at) VALUES ('f1', 'Familie Peeters', 1, 1), ('f2', 'Familie Nieuw', 1, 1)").run();
  db.prepare("INSERT INTO event_registrations (id, edition_id, family_id, data_json, legacy_environment, legacy_registration_id, created_at, updated_at) VALUES ('er1', 'legacy-edition-live', 'f1', ?, 'live', 'r1', 1, ?)")
    .run(JSON.stringify(legacyData.registrations[0]), LEGACY_REG_REVISION);

  // A normalized (non-legacy) edition with a finalized finance snapshot.
  db.prepare("INSERT INTO event_editions (id, event_id, label, status, config_json, created_at, updated_at) VALUES ('ed2', 'legacy-event-live', '2027', 'open', ?, 1, 1)").run(JSON.stringify({ catalog }));
  db.prepare("INSERT INTO event_registrations (id, edition_id, family_id, data_json, created_at, updated_at) VALUES ('er2', 'ed2', 'f2', ?, 1, 500)")
    .run(JSON.stringify({ name: "Familie Nieuw", members: [{ id: "n1", name: "Tom", type: "Volwassene", orders: { p1: 1, p2: 0, p3: 3 } }] }));
  db.prepare("INSERT INTO edition_finance_snapshots (edition_id, costs_finalized, costs_finalized_at, created_at, updated_at) VALUES ('ed2', 1, '2027-01-02', 1, 1)").run();
}

const deps = {
  json: (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }),
  sameOrigin: () => true,
  adminSession: async () => ({ id: "admin" })
};

async function put(DB, registrationId, body) {
  const url = new URL("https://nieuwjaar.datuur.be/api/admin/families/registrations/" + registrationId);
  const request = new Request(url, { method: "PUT", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
  const response = await handleAdminFamilyUsers(request, { DB }, url, deps);
  return { status: response.status, body: await response.json() };
}

const legacyEdit = {
  revision: STATE_REVISION,
  name: "Familie Peeters-Aerts",
  members: [
    { id: "m1", name: "Jan", type: "Volwassene", orders: { p1: 3 } },
    { id: "m2", name: "Lies", type: "Kind", orders: { p2: 2 } }
  ]
};

const state = DB => {
  const row = DB.raw.prepare("SELECT data_json, updated_at FROM app_state WHERE environment = 'live'").get();
  return { revision: row.updated_at, data: JSON.parse(row.data_json) };
};
const normalized = (DB, id) => JSON.parse(DB.raw.prepare("SELECT data_json FROM event_registrations WHERE id = ?").get(id).data_json);

test("admin edit of a legacy registration succeeds when its own revision differs from app_state", async () => {
  const DB = createD1(); seed(DB);
  const result = await put(DB, "er1", legacyEdit);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const after = state(DB);
  assert.equal(result.body.revision, after.revision);
  assert.ok(after.revision > STATE_REVISION);
  const legacy = after.data.registrations.find(item => item.id === "r1");
  assert.equal(legacy.name, "Familie Peeters-Aerts");
  assert.deepEqual(normalized(DB, "er1"), legacy, "normalized copy matches legacy registration");
  assert.equal(after.data.costsFinalized, false);
  assert.equal(after.data.costsFinalizedAt, null);
  // Other registrations in the same legacy state are untouched.
  assert.equal(after.data.registrations.find(item => item.id === "r2").name, "Familie Janssens");
});

test("legacy edit uses the app_state catalog and never drops order quantities", async () => {
  const DB = createD1(); seed(DB);
  await put(DB, "er1", legacyEdit);
  const [jan, lies] = state(DB).data.registrations.find(item => item.id === "r1").members;
  assert.deepEqual(jan.orders, { p1: 3, p2: 0, p3: 4 }, "inactive product p3 keeps its stored quantity");
  assert.deepEqual(lies.orders, { p1: 0, p2: 2, p3: 0 });
});

test("legacy edit with a stale revision is refused and changes nothing", async () => {
  const DB = createD1(); seed(DB);
  const before = state(DB);
  const result = await put(DB, "er1", { ...legacyEdit, revision: STATE_REVISION - 1 });
  assert.equal(result.status, 409);
  assert.deepEqual(state(DB), before);
});

test("legacy edit is atomic: a failing normalized update rolls back app_state", async () => {
  const DB = createD1({ failOn: /^UPDATE event_registrations/ }); seed(DB);
  const before = state(DB);
  const beforeNormalized = normalized(DB, "er1");
  await assert.rejects(put(DB, "er1", legacyEdit));
  assert.deepEqual(state(DB), before);
  assert.deepEqual(normalized(DB, "er1"), beforeNormalized);
});

const snapshot = DB => DB.raw.prepare("SELECT costs_finalized, costs_finalized_at FROM edition_finance_snapshots WHERE edition_id = 'ed2'").get();
const normalizedEdit = { revision: 500, name: "Familie Nieuw", members: [{ id: "n1", name: "Tom", type: "Volwassene", orders: { p1: 2 } }] };

test("normalized edit saves the registration and reopens finalized costs in one step", async () => {
  const DB = createD1(); seed(DB);
  const result = await put(DB, "er2", normalizedEdit);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(normalized(DB, "er2").members[0].orders, { p1: 2, p2: 0, p3: 3 });
  assert.deepEqual({ ...snapshot(DB) }, { costs_finalized: 0, costs_finalized_at: null });
  const revision = DB.raw.prepare("SELECT updated_at FROM event_registrations WHERE id = 'er2'").get().updated_at;
  assert.equal(result.body.revision, revision);
});

test("normalized edit with a stale revision leaves registration and finance untouched", async () => {
  const DB = createD1(); seed(DB);
  const result = await put(DB, "er2", { ...normalizedEdit, revision: 499 });
  assert.equal(result.status, 409);
  assert.equal(normalized(DB, "er2").members[0].orders.p1, 1);
  assert.equal(snapshot(DB).costs_finalized, 1);
});

test("normalized edit is atomic: a failing finance update rolls back the registration", async () => {
  const DB = createD1({ failOn: /^UPDATE edition_finance_snapshots/ }); seed(DB);
  await assert.rejects(put(DB, "er2", normalizedEdit));
  assert.equal(normalized(DB, "er2").members[0].orders.p1, 1);
  assert.equal(snapshot(DB).costs_finalized, 1);
});
