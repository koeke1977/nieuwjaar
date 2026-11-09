// The family account journey over the real routes and a real SQLite database:
// invited → activate → logout → login → forgot password → reset → login with the new password.
import test from "node:test";
import assert from "node:assert/strict";
import { createD1 } from "./helpers/d1.js";
import { handleFamilyAccountApi } from "../worker/modules/family-account.js";
import { handleAdminFamilyUsers } from "../worker/modules/admin-family-users.js";
import { handleAdminEditionState, loadEditionState } from "../worker/modules/admin-edition-state.js";
import { listActivity, pruneActivity } from "../worker/modules/activity.js";

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
    const response = await handleFamilyAccountApi(
      request,
      { DB, PHOTOS: { delete: async () => {} } },
      url,
      dependencies
    );
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

async function activated() {
  const { DB, token } = await setup();
  const device = client(DB);
  await device.call("activate", { token, password: PASSWORD, displayName: "Jan" });
  return { DB, device };
}

test("change password: needs the current one, signs out other devices, keeps this one", async () => {
  const { DB, device } = await activated();
  const other = client(DB);
  await other.call("login", { email: "jan@x.be", password: PASSWORD });
  assert.equal((await other.call("session")).body.authenticated, true);

  const change = body => device.call("change-password", body);
  assert.equal((await change({ currentPassword: PASSWORD, newPassword: "kort" })).status, 400);
  assert.equal((await change({ currentPassword: "fout-wachtwoord", newPassword: NEW_PASSWORD })).status, 403);
  assert.equal((await change({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })).status, 200);

  assert.equal((await device.call("session")).body.authenticated, true, "this device stays signed in");
  assert.equal((await other.call("session")).body.authenticated, false, "the other device is signed out");
  assert.equal((await other.call("login", { email: "jan@x.be", password: PASSWORD })).status, 401);
  assert.equal((await other.call("login", { email: "jan@x.be", password: NEW_PASSWORD })).status, 200);
  assert.match(device.mails.at(-1).subject, /wachtwoord is gewijzigd/);
  assert.equal(
    (await client(DB).call("change-password", { currentPassword: "x", newPassword: NEW_PASSWORD })).status,
    401
  );
});

test("change e-mail: confirmed through a link to the new address, which works once", async () => {
  const { DB, device } = await activated();
  DB.raw
    .prepare(
      "INSERT INTO family_users (id, email, display_name, status, created_at, updated_at) VALUES ('b2', 'bezet@x.be', 'B', 'active', 1, 1)"
    )
    .run();
  const change = body => device.call("change-email", body);
  assert.equal((await change({ password: PASSWORD, newEmail: "geen-adres" })).status, 400);
  assert.equal((await change({ password: PASSWORD, newEmail: "JAN@x.be" })).status, 400, "same address");
  assert.equal((await change({ password: "fout-wachtwoord", newEmail: "nieuw@x.be" })).status, 403);
  assert.equal((await change({ password: PASSWORD, newEmail: "bezet@x.be" })).status, 409);
  assert.equal(device.mails.length, 0);

  assert.equal((await change({ password: PASSWORD, newEmail: "Nieuw@X.be" })).status, 200);
  const mail = device.mails.at(-1);
  assert.equal(mail.to, "nieuw@x.be");
  assert.equal((await device.call("session")).body.user.email, "jan@x.be", "nothing changes before confirmation");
  const token = mail.html.match(/email-bevestigen\/([A-Za-z0-9_.-]+)/)[1];

  const stranger = client(DB);
  const [payload, signature] = token.split(".");
  const claim = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
  const forged = base64Url(encoder.encode(JSON.stringify({ ...claim, n: "aanvaller@x.be" })));
  assert.equal((await stranger.call("confirm-email", { token: forged + "." + signature })).status, 400, "forged");
  assert.equal((await stranger.call("confirm-email", { token: "onzin" })).status, 400);

  const confirmed = await stranger.call("confirm-email", { token });
  assert.equal(confirmed.status, 200, "works without being signed in");
  assert.equal(confirmed.body.email, "nieuw@x.be");
  assert.equal((await stranger.call("confirm-email", { token })).status, 400, "a link works once");
  assert.equal(stranger.mails.at(-1).to, "jan@x.be", "the old address is told");

  assert.equal((await device.call("session")).body.user.email, "nieuw@x.be");
  assert.equal((await client(DB).call("login", { email: "jan@x.be", password: PASSWORD })).status, 401);
  assert.equal((await client(DB).call("login", { email: "nieuw@x.be", password: PASSWORD })).status, 200);
});

test("a password change makes an open e-mail link invalid", async () => {
  const { DB, device } = await activated();
  await device.call("change-email", { password: PASSWORD, newEmail: "nieuw@x.be" });
  const token = device.mails.at(-1).html.match(/email-bevestigen\/([A-Za-z0-9_.-]+)/)[1];
  await device.call("change-password", { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
  assert.equal((await client(DB).call("confirm-email", { token })).status, 400);
});

test("the owner invites a partner, who can edit but not manage access; a mistaken invite can be removed", async () => {
  const { DB, device } = await activated();
  const invite = (body, who = device) => who.call("family-invite", { familyId: "fa", ...body });
  assert.equal((await invite({ displayName: "", email: "els@x.be" })).status, 400);
  assert.equal((await invite({ displayName: "Els", email: "els@x.be" })).status, 201);
  const mail = device.mails.at(-1);
  assert.equal(mail.to, "els@x.be");
  assert.match(mail.html, /Gezin Jan/);
  assert.equal((await invite({ displayName: "Els", email: "ELS@x.be" })).status, 409, "already has access");

  const people = async () => (await device.call("account")).body.families[0].people;
  const els = (await people()).find(person => person.email === "els@x.be");
  assert.equal(els.role, "editor");
  assert.equal(els.status, "invited");
  assert.equal((await people()).find(person => person.me).role, "owner");

  // The partner activates: they cannot invite or remove anyone, and nobody removes the owner here.
  const partner = client(DB);
  const token = mail.html.match(/activeren\/([A-Za-z0-9_-]+)/)[1];
  assert.equal((await partner.call("activate", { token, password: PASSWORD, displayName: "Els" })).status, 200);
  assert.equal((await invite({ displayName: "X", email: "x@x.be" }, partner)).status, 403);
  const remove = (userId, who = device) => who.call("family-invite", { familyId: "fa", userId }, { method: "DELETE" });
  assert.equal((await remove("a1", partner)).status, 403);
  assert.equal((await remove("a1")).status, 403, "the owner cannot be removed here");

  // An active account keeps existing after removal; a mistaken invitation disappears completely.
  assert.equal((await remove(els.id)).status, 200);
  assert.ok(DB.raw.prepare("SELECT 1 FROM family_users WHERE email = 'els@x.be'").get());
  await invite({ displayName: "Fout", email: "fout@x.be" });
  const typo = (await people()).find(person => person.email === "fout@x.be");
  const typoToken = device.mails.at(-1).html.match(/activeren\/([A-Za-z0-9_-]+)/)[1];
  assert.equal((await remove(typo.id)).status, 200);
  assert.equal(DB.raw.prepare("SELECT 1 FROM family_users WHERE email = 'fout@x.be'").get(), undefined);
  assert.equal(
    (await client(DB).call("activate", { token: typoToken, password: PASSWORD, displayName: "F" })).status,
    400
  );

  // Someone with an account gets a notice instead of an activation link; there is a maximum.
  assert.equal((await invite({ displayName: "Els", email: "els@x.be" })).status, 201);
  assert.match(device.mails.at(-1).html, /Naar het familieportaal/);
  for (const name of ["c", "d", "e", "f"])
    assert.equal((await invite({ displayName: name, email: name + "@x.be" })).status, 201);
  assert.equal((await invite({ displayName: "g", email: "g@x.be" })).status, 409, "maximum six accounts");
});

function seedRegistration(
  DB,
  config = {},
  members = [{ id: "jan", name: "Jan", type: "Volwassene", orders: { steak: 2 } }]
) {
  const db = DB.raw;
  db.prepare(
    "INSERT INTO events (id, slug, name, finance_strategy, created_at, updated_at) VALUES ('ev', 'feest', 'Zomerfeest', 'nieuwjaar', 1, 1)"
  ).run();
  db.prepare(
    "INSERT INTO event_editions (id, event_id, label, status, config_json, created_at, updated_at) VALUES ('ed', 'ev', '2027', 'open', ?, 1, 1)"
  ).run(JSON.stringify({ catalog: [{ id: "steak", name: "Steak", active: true }], ...config }));
  db.prepare("INSERT INTO edition_finance_snapshots (edition_id, created_at, updated_at) VALUES ('ed', 1, 1)").run();
  db.prepare(
    "INSERT INTO event_registrations (id, edition_id, family_id, data_json, created_at, updated_at) VALUES ('ra', 'ed', 'fa', ?, 1, 5)"
  ).run(JSON.stringify({ name: "Gezin Jan", members }));
}
const statusOf = DB => DB.raw.prepare("SELECT status FROM event_registrations WHERE id = 'ra'").get().status;
const cancelBody = { edition: "ed", registrationId: "ra" };

test("wij komen niet: cancels at once while no money is involved, and the family can register again", async () => {
  const { DB, device } = await activated();
  seedRegistration(DB, { orderDeadline: "2099-01-01T00:00" });
  const before = (await loadEditionState({ DB }, "ed")).version;
  const result = await device.call("cancel-registration", cancelBody);
  assert.equal(result.status, 200);
  assert.equal(result.body.cancelled, true);
  assert.equal(statusOf(DB), "cancelled");
  const mail = device.mails.at(-1);
  assert.equal(mail.to, "registratie@datuur.be");
  assert.match(mail.subject, /Gezin Jan heeft zich afgemeld voor Zomerfeest 2027/);
  assert.match(mail.html, /2 porties/);
  assert.notEqual((await loadEditionState({ DB }, "ed")).version, before, "the admin sees it through live refresh");

  const session = (await device.call("session")).body;
  assert.equal(session.registrations.length, 0);
  assert.equal(session.openEditions[0].edition, "ed", "can register again");
  assert.equal((await device.call("register", { edition: "ed", familyId: "fa" })).status, 201);
  assert.equal(statusOf(DB), "active");
});

test("wij komen niet: becomes a request once money is involved, and nothing is lost", async () => {
  const cases = [
    ["deadline passed", { orderDeadline: "2020-01-01T00:00" }, undefined, /einddatum/],
    ["order mailed", { butcherSentAt: 123 }, undefined, /slager/],
    ["bar bill", {}, [{ id: "jan", name: "Jan", type: "Volwassene", orders: {}, barCents: 500 }], /barrekening/]
  ];
  for (const [label, config, members, reason] of cases) {
    const { DB, device } = await activated();
    seedRegistration(DB, config, members);
    const result = await device.call("cancel-registration", cancelBody);
    assert.equal(result.body.requested, true, label);
    assert.equal(statusOf(DB), "active", label + ": still registered");
    assert.match(device.mails.at(-1).subject, /wil zich afmelden/);
    assert.match(device.mails.at(-1).html, reason);
  }

  const { DB, device } = await activated();
  seedRegistration(DB);
  DB.raw
    .prepare("UPDATE edition_finance_snapshots SET payments_json = ? WHERE edition_id = 'ed'")
    .run(JSON.stringify([{ id: "p", registrationId: "ra", amountCents: 100, date: "2027-01-01", method: "cash" }]));
  const revision = (await loadEditionState({ DB }, "ed")).configRevision;
  assert.equal((await device.call("cancel-registration", cancelBody)).body.requested, true);
  const count = device.mails.length;
  assert.equal((await device.call("cancel-registration", cancelBody)).body.requested, true);
  assert.equal(device.mails.length, count, "asking twice sends one mail");
  assert.ok((await device.call("session")).body.registrations[0].cancelRequestedAt, "the family sees it is requested");

  const state = await loadEditionState({ DB }, "ed");
  assert.ok(state.cancelRequests.ra.at, "the admin sees the request");
  assert.equal(state.configRevision, revision, "no change to the edition revision");

  const url = new URL("https://nieuwjaar.datuur.be/api/admin/editions/ed/cancel-request");
  const response = await handleAdminEditionState(
    new Request(url, { method: "POST", body: JSON.stringify({ registrationId: "ra" }) }),
    { DB },
    url,
    {
      json: (data, status = 200) => Response.json(data, { status }),
      sameOrigin: () => true,
      adminSession: async () => true
    }
  );
  assert.equal(response.status, 200);
  assert.deepEqual((await loadEditionState({ DB }, "ed")).cancelRequests, {});
});

test("wij komen niet: a viewer or someone from another family cannot cancel", async () => {
  const { DB, device } = await activated();
  seedRegistration(DB);
  DB.raw.prepare("UPDATE family_memberships SET role = 'viewer' WHERE user_id = 'a1'").run();
  assert.equal((await device.call("cancel-registration", cancelBody)).status, 403);
  DB.raw.prepare("DELETE FROM family_memberships WHERE user_id = 'a1'").run();
  assert.equal((await device.call("cancel-registration", cancelBody)).status, 403);
  assert.equal(statusOf(DB), "active");
});

test("no event name in the password reset mail", async () => {
  const { device } = await activated();
  await device.call("forgot-password", { email: "jan@x.be" });
  const mail = device.mails.at(-1);
  assert.ok(!/Nieuwjaar/.test(mail.subject + mail.html));
});

const feed = async DB => (await listActivity({ DB }, "ed")).map(entry => entry.summary);
const saveMembers = (device, members, revision) =>
  device.call("registration", { edition: "ed", registrationId: "ra", revision, members }, { method: "PUT" });

test("activity: an order change reads as one line, quick edits merge and undoing leaves nothing", async () => {
  const { DB, device } = await activated();
  seedRegistration(DB);
  const jan = steak => ({ id: "jan", name: "Jan", type: "Volwassene", orders: { steak } });
  const summaries = () => feed(DB).then(lines => lines.filter(line => !line.startsWith("Account")));

  let saved = await saveMembers(device, [jan(3)], 5);
  assert.deepEqual(await summaries(), ["Jan: Steak 2 → 3"]);
  saved = await saveMembers(device, [jan(4)], saved.body.revision);
  saved = await saveMembers(device, [jan(5)], saved.body.revision);
  assert.deepEqual(await summaries(), ["Jan: Steak 2 → 5"], "one line, not three");
  const entry = (await listActivity({ DB }, "ed")).find(item => item.type === "registration");
  assert.equal(entry.familyName, "Gezin Jan");
  assert.equal(entry.actor, "Jan");
  assert.equal(entry.registrationId, "ra");
  assert.equal(entry.familyId, "fa");

  saved = await saveMembers(device, [jan(2)], saved.body.revision);
  assert.deepEqual(await summaries(), [], "back to where it started: nothing to report");

  // After the merge window a new line starts.
  saved = await saveMembers(device, [jan(3)], saved.body.revision);
  DB.raw.prepare("UPDATE family_activity SET at = at - 3600 WHERE type = 'registration'").run();
  await saveMembers(device, [jan(4)], saved.body.revision);
  assert.deepEqual(await summaries(), ["Jan: Steak 3 → 4", "Jan: Steak 2 → 3"]);
});

test("activity: people are described, and allergies and notes never appear", async () => {
  const { DB, device } = await activated();
  seedRegistration(DB);
  const jan = { id: "jan", name: "Jan", type: "Volwassene", orders: { steak: 2 } };
  let saved = await saveMembers(device, [jan, { id: "tom", name: "Tom", type: "Avondgast", orders: {} }], 5);
  saved = await saveMembers(
    device,
    [
      { ...jan, diet: ["Glutenvrij"], notes: "Geheime opmerking" },
      { id: "tom", name: "Tom", type: "Avondgast", orders: {} }
    ],
    saved.body.revision
  );
  const line = (await feed(DB)).find(text => text.includes("Tom"));
  assert.match(line, /Tom toegevoegd als Avondgast/);
  assert.match(line, /Jan: allergie of opmerking gewijzigd/);
  const stored = JSON.stringify(DB.raw.prepare("SELECT * FROM family_activity").all());
  assert.ok(!/Glutenvrij|Geheime opmerking/.test(stored), "not in the feed, not in the database");
  assert.ok(!stored.includes("jan@x.be"), "no e-mail addresses");

  DB.raw.prepare("UPDATE family_activity SET at = at - 3600 WHERE type = 'registration'").run();
  await saveMembers(device, [{ ...jan, name: "Jan P", type: "Kind" }], saved.body.revision);
  const latest = (await feed(DB))[0];
  assert.match(latest, /Jan P: was Jan, nu Kind/);
  assert.match(latest, /allergie of opmerking gewijzigd/);
  assert.match(latest, /Tom verwijderd/);
});

test("activity: accounts, registering, costs, invites and cancelling are all in the feed", async () => {
  const { DB, device } = await activated();
  seedRegistration(DB);
  assert.ok((await feed(DB)).includes("Account geactiveerd"));
  assert.ok(DB.raw.prepare("SELECT last_login_at FROM family_users WHERE id = 'a1'").get().last_login_at);

  // Someone who was already active logs in for the first time; only that first time is logged.
  DB.raw.prepare("UPDATE family_users SET last_login_at = NULL WHERE id = 'a1'").run();
  await device.call("logout", {});
  await device.call("login", { email: "jan@x.be", password: PASSWORD });
  await device.call("logout", {});
  await device.call("login", { email: "jan@x.be", password: PASSWORD });
  assert.equal((await feed(DB)).filter(line => line === "Voor het eerst aangemeld").length, 1);

  await device.call("family-invite", { familyId: "fa", displayName: "Els", email: "els@x.be" });
  assert.ok((await feed(DB)).includes("Els uitgenodigd"));

  const key = "receipts/ed/ra/11111111-1111-1111-1111-111111111111.jpg";
  DB.raw.prepare("UPDATE edition_finance_snapshots SET expenses_json = ? WHERE edition_id = 'ed'").run(
    JSON.stringify([
      {
        id: "k1",
        description: "Cava",
        amountCents: 4500,
        date: "2026-12-01",
        method: "general",
        advancedBy: "ra",
        enteredBy: "family",
        receipt: key
      }
    ])
  );
  const changed = await device.call("expenses", {
    edition: "ed",
    registrationId: "ra",
    expense: { id: "k1", description: "Cava brut", amountCents: 5000, date: "2026-12-01", method: "general" }
  });
  assert.equal(changed.status, 200);
  assert.match((await feed(DB))[0], /^Kost gewijzigd: Cava brut €\s?50,00 \(met kasticket\)$/u);
  const removed = await device.call(
    "expenses",
    { edition: "ed", registrationId: "ra", expenseId: "k1" },
    { method: "DELETE" }
  );
  assert.equal(removed.status, 200);
  assert.match((await feed(DB))[0], /^Kost verwijderd: Cava brut €\s?50,00$/u);

  assert.equal((await device.call("cancel-registration", cancelBody)).body.cancelled, true);
  assert.equal((await feed(DB))[0], "Afgemeld");
  assert.equal((await device.call("register", { edition: "ed", familyId: "fa" })).status, 201);
  assert.equal((await feed(DB))[0], "Ingeschreven");
});

test("activity: the admin route lists it; another edition's lines stay out; old lines are cleaned up", async () => {
  const { DB } = await activated();
  seedRegistration(DB);
  const insert = DB.raw.prepare(
    "INSERT INTO family_activity (id, at, edition_id, family_name, type, summary) VALUES (?, ?, ?, 'G', 't', ?)"
  );
  insert.run("x1", 1000, "ander", "Andere editie");
  insert.run("x2", 1000, null, "Oud accountbericht");
  const url = new URL("https://nieuwjaar.datuur.be/api/admin/editions/ed/activity");
  const response = await handleAdminEditionState(new Request(url), { DB }, url, {
    json: (data, status = 200) => Response.json(data, { status }),
    sameOrigin: () => true,
    adminSession: async () => true
  });
  const { entries } = await response.json();
  const lines = entries.map(entry => entry.summary);
  assert.ok(lines.includes("Account geactiveerd"));
  assert.ok(lines.includes("Oud accountbericht"));
  assert.ok(!lines.includes("Andere editie"));

  // Archived more than a year ago: gone. An open edition's lines stay, however old.
  DB.raw
    .prepare(
      "INSERT INTO event_editions (id, event_id, label, status, config_json, created_at, updated_at) VALUES ('oud', 'ev', '2020', 'archived', '{}', 1, 1000)"
    )
    .run();
  insert.run("x3", 1000, "oud", "Oude editie");
  insert.run("x4", 1000, "ed", "Open editie");
  const now = 1000 + 2 * 365 * 24 * 60 * 60;
  await pruneActivity({ DB }, now);
  const left = DB.raw
    .prepare("SELECT summary FROM family_activity")
    .all()
    .map(row => row.summary);
  assert.ok(!left.includes("Oude editie"));
  assert.ok(!left.includes("Oud accountbericht"));
  assert.ok(left.includes("Open editie"));
});

test("activity: when logging fails, the family's save still succeeds", async () => {
  const { DB, device } = await activated();
  seedRegistration(DB);
  DB.raw.exec("DROP TABLE family_activity");
  const original = console.error;
  console.error = () => {};
  try {
    const saved = await saveMembers(device, [{ id: "jan", name: "Jan", type: "Volwassene", orders: { steak: 9 } }], 5);
    assert.equal(saved.status, 200);
    const data = DB.raw.prepare("SELECT data_json FROM event_registrations WHERE id = 'ra'").get().data_json;
    assert.equal(JSON.parse(data).members[0].orders.steak, 9);
    assert.equal((await device.call("cancel-registration", cancelBody)).body.cancelled, true);
  } finally {
    console.error = original;
  }
});

test("expired invitations are marked and can be sent again together; the new link works", async () => {
  const { DB, token } = await setup();
  const admin = adminClient(DB);
  const mails = [];
  const account = async () => (await admin("family-users")).body.users.find(user => user.email === "jan@x.be");
  assert.equal((await account()).inviteExpired, false, "a fresh invitation is fine");

  DB.raw.prepare("UPDATE family_user_invites SET expires_at = 1000 WHERE user_id = 'a1'").run();
  assert.equal((await account()).inviteExpired, true);
  assert.equal((await client(DB).call("activate", { token, password: PASSWORD, displayName: "Jan" })).status, 400);

  // An active account and an invitation that still works are left alone.
  const db = DB.raw;
  db.prepare(
    "INSERT INTO family_users (id, email, display_name, status, created_at, updated_at) VALUES ('c3', 'actief@x.be', 'A', 'active', 1, 1), ('c4', 'nog-geldig@x.be', 'N', 'invited', 1, 1)"
  ).run();
  db.prepare(
    "INSERT INTO family_user_invites (id, user_id, token_hash, created_at, expires_at) VALUES ('i4', 'c4', 'h4', 1, ?)"
  ).run(Math.floor(Date.now() / 1000) + 3600);

  const url = new URL("https://nieuwjaar.datuur.be/api/admin/family-users/resend-expired");
  const response = await handleAdminFamilyUsers(new Request(url, { method: "POST" }), { DB }, url, {
    json: (data, status = 200) => Response.json(data, { status }),
    sameOrigin: () => true,
    adminSession: async () => true,
    sha256,
    base64Url,
    sendGraphMail: async (env, to, subject, html) => mails.push({ to, subject, html })
  });
  assert.deepEqual(await response.json(), { sent: 1, failed: [], remaining: 0 });
  assert.deepEqual(
    mails.map(mail => mail.to),
    ["jan@x.be"]
  );
  assert.match(mails[0].html, /Gezin Jan/);
  assert.equal((await account()).inviteExpired, false);

  const newToken = mails[0].html.match(/activeren\/([A-Za-z0-9_-]+)/)[1];
  assert.equal(
    (await client(DB).call("activate", { token: newToken, password: PASSWORD, displayName: "Jan" })).status,
    200
  );
});

test("mail: the Microsoft token is reused for many mails and fetched again when it runs out", async () => {
  const { graphAccessToken, forgetGraphToken } = await import("../worker/modules/graph-token.js");
  const env = { O365_TENANT_ID: "t", O365_CLIENT_ID: "c", O365_CLIENT_SECRET: "s" };
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return { ok: true, json: async () => ({ access_token: "token" + calls, expires_in: 3600 }) };
  };
  try {
    forgetGraphToken();
    const start = 1_000_000;
    for (let i = 0; i < 30; i++) assert.equal(await graphAccessToken(env, start), "token1");
    assert.equal(calls, 1, "thirty mails, one token");
    assert.equal(await graphAccessToken(env, start + 3500 * 1000), "token2", "close to expiry: a new one");
    forgetGraphToken();
    assert.equal(await graphAccessToken(env, start), "token3", "after a refusal: a new one");
  } finally {
    globalThis.fetch = original;
    forgetGraphToken();
  }
});
