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
  const data = {
    activeEvent: { name: "Nieuwjaar" }, costsFinalized: true, costsFinalizedAt: "2026-12-31",
    catalog: [{ id: "steak", name: "Steak", active: true }],
    registrations: [{ id: "a", name: "A", members: [member("a1", 1)] }, { id: "b", name: "B", members: [member("b1", 1)] }],
    expenses: [], payments: []
  };
  db.prepare("INSERT INTO app_state (environment, data_json, updated_at) VALUES ('live', ?, 100)").run(JSON.stringify(data));
  for (const [user, reg] of [["ua", "a"], ["ub", "b"], ["ua2", "a"]]) {
    db.prepare("INSERT INTO family_users (id, email, display_name, status, created_at, updated_at) VALUES (?, ?, ?, 'active', 1, 1)").run(user, user + "@x.be", user);
    db.prepare("INSERT INTO family_user_sessions (user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)").run(user, await sha256("tok-" + user), now, now + 3600);
    db.prepare("INSERT INTO family_user_registrations (user_id, edition_id, registration_id, created_at) VALUES (?, 'live', ?, 1)").run(user, reg);
  }
  return DB;
}

async function save(DB, user, registrationId, base, members, revision = 100) {
  const url = new URL("https://nieuwjaar.datuur.be/api/family-account/registration");
  const request = new Request(url, { method: "PUT", headers: { Cookie: "ny_family_account=tok-" + user, "Content-Type": "application/json" },
    body: JSON.stringify({ edition: "live", registrationId, revision, base, members }) });
  const response = await handleFamilyAccountApi(request, { DB }, url, deps);
  return { status: response.status, body: await response.json() };
}
const stored = DB => JSON.parse(DB.raw.prepare("SELECT data_json FROM app_state WHERE environment = 'live'").get().data_json);

test("two families saving with the same (now stale) shared revision both succeed", async () => {
  const DB = await setup();
  const first = await save(DB, "ua", "a", [member("a1", 1)], [member("a1", 4)]);
  const second = await save(DB, "ub", "b", [member("b1", 1)], [member("b1", 6)]); // still sends revision 100
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(second.status, 200, JSON.stringify(second.body));
  const data = stored(DB);
  assert.equal(data.registrations[0].members[0].orders.steak, 4);
  assert.equal(data.registrations[1].members[0].orders.steak, 6);
  assert.equal(data.costsFinalized, false, "an order change reopens finalized costs");
});

test("two people editing the same family: the second gets a clear conflict, nothing is lost silently", async () => {
  const DB = await setup();
  assert.equal((await save(DB, "ua", "a", [member("a1", 1)], [member("a1", 4)])).status, 200);
  const late = await save(DB, "ua2", "a", [member("a1", 1)], [member("a1", 9)]);
  assert.equal(late.status, 409);
  assert.equal(late.body.conflict, "registration");
  assert.equal(stored(DB).registrations[0].members[0].orders.steak, 4);
});

test("saving without changes does not write and keeps finalized costs", async () => {
  const DB = await setup();
  const result = await save(DB, "ua", "a", [member("a1", 1)], [member("a1", 1)]);
  assert.equal(result.status, 200);
  assert.equal(result.body.unchanged, true);
  assert.equal(stored(DB).costsFinalized, true);
  assert.equal(DB.raw.prepare("SELECT updated_at FROM app_state").get().updated_at, 100);
});

test("older clients without a base still use the shared revision lock", async () => {
  const DB = await setup();
  await save(DB, "ub", "b", [member("b1", 1)], [member("b1", 2)]);
  const legacyClient = await save(DB, "ua", "a", undefined, [member("a1", 3)], 100);
  assert.equal(legacyClient.status, 409);
});

test("a family cannot save a registration that is not theirs", async () => {
  const DB = await setup();
  const result = await save(DB, "ua", "b", [member("b1", 1)], [member("b1", 50)]);
  assert.equal(result.status, 403);
});
