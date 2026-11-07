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

async function call(DB, user, method, path, body) {
  const url = new URL("https://nieuwjaar.datuur.be" + path);
  const request = new Request(url, { method, headers: { Cookie: "ny_family_account=tok-" + user, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const response = await handleFamilyAccountApi(request, { DB }, url, deps);
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
