// The family account journey over the real routes and a real SQLite database:
// invited → activate → logout → login → forgot password → reset → login with the new password.
import test from "node:test";
import assert from "node:assert/strict";
import { createD1 } from "./helpers/d1.js";
import { handleFamilyAccountApi } from "../worker/modules/family-account.js";
import { handleAdminFamilyUsers } from "../worker/modules/admin-family-users.js";

const encoder = new TextEncoder();
const base64Url = bytes =>
  btoa(String.fromCharCode(...bytes))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
const fromBase64Url = value => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - (normalized.length % 4)) % 4));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
};
const sha256 = async value =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)))]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");

function client(DB) {
  const mails = [];
  let cookie = "";
  const dependencies = {
    json: (data, status = 200, headers = {}) => Response.json(data, { status, headers }),
    sameOrigin: request => {
      const origin = request.headers.get("Origin");
      return !origin || origin === new URL(request.url).origin;
    },
    cookieValue: (request, name) => {
      const entry = (request.headers.get("Cookie") || "")
        .split(";")
        .map(part => part.trim())
        .find(part => part.startsWith(name + "="));
      return entry ? entry.slice(name.length + 1) : "";
    },
    sha256,
    base64Url,
    fromBase64Url,
    sendGraphMail: async (env, to, subject, html) => mails.push({ to, subject, html })
  };
  const call = async (path, body, { method = body === undefined ? "GET" : "POST", origin } = {}) => {
    const url = new URL("https://nieuwjaar.datuur.be/api/family-account/" + path);
    const headers = { Cookie: cookie, "CF-Connecting-IP": "1.2.3.4" };
    if (origin) headers.Origin = origin;
    const request = new Request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const response = await handleFamilyAccountApi(request, { DB }, url, dependencies);
    const setCookie = response.headers.get("Set-Cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    return { status: response.status, body: await response.json(), setCookie };
  };
  return { call, mails, cookie: () => cookie };
}

async function setup() {
  const DB = createD1();
  const db = DB.raw;
  const now = Math.floor(Date.now() / 1000);
  db.prepare("INSERT INTO families (id, display_name, created_at, updated_at) VALUES ('fa', 'Gezin Jan', 1, 1)").run();
  db.prepare(
    "INSERT INTO family_users (id, email, display_name, status, created_at, updated_at) VALUES ('a1', 'jan@x.be', 'Jan', 'invited', 1, 1)"
  ).run();
  db.prepare(
    "INSERT INTO family_memberships (id, family_id, user_id, role, created_at) VALUES ('m1', 'fa', 'a1', 'owner', 1)"
  ).run();
  const token = "a".repeat(43);
  db.prepare(
    "INSERT INTO family_user_invites (id, user_id, token_hash, created_at, expires_at) VALUES ('i1', 'a1', ?, ?, ?)"
  ).run(await sha256(token), now, now + 3600);
  return { DB, token };
}

const PASSWORD = "een-lang-wachtwoord";
const NEW_PASSWORD = "nog-een-lang-wachtwoord";

test("activate, logout, login, forgot and reset password", async () => {
  const { DB, token } = await setup();
  const { call, mails, cookie } = client(DB);

  assert.equal((await call("session")).body.authenticated, false);
  assert.equal(
    (await call("login", { email: "jan@x.be", password: PASSWORD })).status,
    401,
    "an invited account cannot log in yet"
  );

  assert.equal((await call("activate", { token, password: "te-kort", displayName: "Jan" })).status, 400);
  const activated = await call("activate", { token, password: PASSWORD, displayName: "Jan P" });
  assert.equal(activated.status, 200);
  assert.match(activated.setCookie, /^ny_family_account=.+HttpOnly/i);
  const session = await call("session");
  assert.equal(session.body.authenticated, true);
  assert.equal(session.body.user.displayName, "Jan P");
  assert.equal(
    (await call("activate", { token, password: PASSWORD, displayName: "Jan" })).status,
    400,
    "an activation link works once"
  );

  assert.equal((await call("logout", {})).status, 200);
  assert.equal(cookie().split("=")[1], "");
  assert.equal((await call("session")).body.authenticated, false);

  assert.equal((await call("login", { email: "jan@x.be", password: "fout-wachtwoord" })).status, 401);
  const login = await call("login", { email: "JAN@x.be ", password: PASSWORD });
  assert.equal(login.status, 200);
  assert.equal((await call("session")).body.authenticated, true);
  assert.ok(DB.raw.prepare("SELECT last_login_at FROM family_users WHERE id = 'a1'").get().last_login_at);

  // Unknown addresses get the same answer and no mail.
  assert.equal((await call("forgot-password", { email: "onbekend@x.be" })).body.accepted, true);
  assert.equal(mails.length, 0);
  assert.equal((await call("forgot-password", { email: "jan@x.be" })).body.accepted, true);
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, "jan@x.be");
  const resetToken = mails[0].html.match(/wachtwoord-reset\/([A-Za-z0-9_-]+)/)[1];

  assert.equal((await call("reset-password", { token: resetToken, password: "kort" })).status, 400);
  const reset = await call("reset-password", { token: resetToken, password: NEW_PASSWORD });
  assert.equal(reset.status, 200);
  assert.equal((await call("session")).body.authenticated, false, "a reset ends every session");
  assert.equal((await call("reset-password", { token: resetToken, password: NEW_PASSWORD })).status, 400);

  assert.equal((await call("login", { email: "jan@x.be", password: PASSWORD })).status, 401, "old password is gone");
  assert.equal((await call("login", { email: "jan@x.be", password: NEW_PASSWORD })).status, 200);
});

test("too many failed logins are blocked, another origin is refused, unknown routes give 404", async () => {
  const { DB, token } = await setup();
  const { call } = client(DB);
  await call("activate", { token, password: PASSWORD, displayName: "Jan" });
  await call("logout", {});

  const refused = await call("login", { email: "jan@x.be", password: PASSWORD }, { origin: "https://evil.example" });
  assert.equal(refused.status, 403);

  let blocked = null;
  for (let attempt = 0; attempt < 31 && !blocked; attempt++) {
    const result = await call("login", { email: "jan@x.be", password: "fout-wachtwoord" });
    if (result.status === 429) blocked = result;
  }
  assert.ok(blocked, "login is limited");
  assert.equal((await call("login", { email: "jan@x.be", password: PASSWORD })).status, 429, "also with the right one");

  assert.equal((await call("bestaat-niet")).status, 404);
  assert.equal((await call("login")).status, 404, "GET on a POST route");
  assert.equal((await call("session", {})).status, 404, "POST on a GET route");
});

test("family routes need a session: registration, register, expenses and receipts answer 401", async () => {
  const { DB } = await setup();
  const { call } = client(DB);
  assert.equal(
    (await call("registration", { edition: "e", registrationId: "r", revision: 1, members: [] }, { method: "PUT" }))
      .status,
    401
  );
  assert.equal((await call("register", { edition: "e", familyId: "fa" })).status, 401);
  assert.equal((await call("expenses", { edition: "e", registrationId: "r" })).status, 401);
  assert.equal((await call("expenses", { edition: "e", registrationId: "r" }, { method: "DELETE" })).status, 401);
  assert.equal((await call("receipts?key=x")).status, 401);
});

function adminClient(DB) {
  const tools = {
    json: (data, status = 200, headers = {}) => Response.json(data, { status, headers }),
    sameOrigin: () => true,
    adminSession: async () => true,
    sha256,
    base64Url,
    sendGraphMail: async () => {}
  };
  return async (path, method = "GET") => {
    const url = new URL("https://nieuwjaar.datuur.be/api/admin/" + path);
    const response = await handleAdminFamilyUsers(new Request(url, { method }), { DB }, url, tools);
    return { status: response.status, body: await response.json() };
  };
}

test("reset mails are limited per address; the admin sees the lock and can unlock it", async () => {
  const { DB, token } = await setup();
  const { call, mails } = client(DB);
  const admin = adminClient(DB);
  await call("activate", { token, password: PASSWORD, displayName: "Jan" });
  const account = async () => (await admin("family-users")).body.users.find(user => user.email === "jan@x.be");
  assert.equal((await account()).resetLocked, false);

  for (let i = 0; i < 5; i++) assert.equal((await call("forgot-password", { email: "jan@x.be" })).status, 200);
  assert.equal(mails.length, 5);
  const limited = await call("forgot-password", { email: "jan@x.be" });
  assert.equal(limited.status, 429);
  assert.match(limited.body.error, /ontgrendelen/);
  assert.equal(mails.length, 5, "no sixth mail");

  // An unknown address gets exactly the same answers, so nothing is revealed.
  for (let i = 0; i < 5; i++) assert.equal((await call("forgot-password", { email: "niemand@x.be" })).status, 200);
  assert.equal((await call("forgot-password", { email: "niemand@x.be" })).status, 429);

  const locked = await account();
  assert.equal(locked.resetLocked, true);
  assert.equal(locked.loginLocked, false);
  const unlocked = await admin("family-users/" + locked.id + "/unlock", "POST");
  assert.equal(unlocked.status, 200);
  assert.equal((await account()).resetLocked, false);
  assert.equal((await call("forgot-password", { email: "jan@x.be" })).status, 200, "works again");
  assert.equal(mails.length, 6);

  // A successful reset also clears the limit.
  for (let i = 0; i < 4; i++) await call("forgot-password", { email: "jan@x.be" });
  assert.equal((await account()).resetLocked, true);
  const resetToken = mails.at(-1).html.match(/wachtwoord-reset\/([A-Za-z0-9_-]+)/)[1];
  assert.equal((await call("reset-password", { token: resetToken, password: NEW_PASSWORD })).status, 200);
  assert.equal((await account()).resetLocked, false);
});

test("the admin sees a login lock after too many wrong passwords and can unlock it", async () => {
  const { DB, token } = await setup();
  const { call } = client(DB);
  const admin = adminClient(DB);
  await call("activate", { token, password: PASSWORD, displayName: "Jan" });
  await call("logout", {});
  for (let i = 0; i < 30; i++) await call("login", { email: "jan@x.be", password: "fout-wachtwoord" });
  assert.equal((await call("login", { email: "jan@x.be", password: PASSWORD })).status, 429);
  const { users } = (await admin("family-users")).body;
  assert.equal(users[0].loginLocked, true);
  assert.equal((await admin("family-users/" + users[0].id + "/unlock", "POST")).status, 200);
  assert.equal((await admin("family-users")).body.users[0].loginLocked, false);
  assert.equal((await call("login", { email: "jan@x.be", password: PASSWORD })).status, 200);
});

test("a family cannot remove a person with a bar bill, also before the order deadline", async () => {
  const { DB, token } = await setup();
  const { call } = client(DB);
  await call("activate", { token, password: PASSWORD, displayName: "Jan" });
  const db = DB.raw;
  db.prepare(
    "INSERT INTO events (id, slug, name, finance_strategy, created_at, updated_at) VALUES ('ev', 'nieuwjaar', 'Nieuwjaar', 'nieuwjaar', 1, 1)"
  ).run();
  db.prepare(
    "INSERT INTO event_editions (id, event_id, label, status, config_json, created_at, updated_at) VALUES ('ed', 'ev', '2026', 'open', ?, 1, 1)"
  ).run(JSON.stringify({ catalog: [{ id: "steak", name: "Steak", active: true }] }));
  const jan = { id: "jan", name: "Jan", type: "Volwassene", orders: { steak: 1 } };
  const tom = { id: "tom", name: "Tom", type: "Avondgast", orders: {}, barCents: 1250 };
  const lies = { id: "lies", name: "Lies", type: "Kind", orders: {} };
  db.prepare(
    "INSERT INTO event_registrations (id, edition_id, family_id, data_json, created_at, updated_at) VALUES ('ra', 'ed', 'fa', ?, 1, 5)"
  ).run(JSON.stringify({ name: "Gezin Jan", members: [jan, tom, lies] }));
  const save = (members, revision) =>
    call("registration", { edition: "ed", registrationId: "ra", revision, members }, { method: "PUT" });
  const stored = () =>
    JSON.parse(db.prepare("SELECT data_json FROM event_registrations WHERE id = 'ra'").get().data_json);

  const refused = await save([jan, lies], 5);
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /Tom heeft een barrekening/);
  assert.equal(stored().members.length, 3, "nothing was saved");

  const withoutLies = await save([jan, tom], 5);
  assert.equal(withoutLies.status, 200, "someone without a bar bill can still be removed");
  assert.deepEqual(
    stored().members.map(person => person.id),
    ["jan", "tom"]
  );

  const tampered = await save([jan, { ...tom, barCents: 0 }], withoutLies.body.revision);
  assert.equal(tampered.status, 200);
  assert.equal(stored().members.find(person => person.id === "tom").barCents, 1250, "a family cannot change the bill");
});
