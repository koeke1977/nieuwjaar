import test from "node:test";
import assert from "node:assert/strict";
import { createD1 } from "./helpers/d1.js";
import { loadEditionState, saveEditionState, startNextEdition } from "../worker/modules/admin-edition-state.js";

const catalog = [
  { id: "steak", name: "Steak", active: true, image: "/images/steak.jpg" },
  { id: "kip", name: "Kip", active: true, image: null }
];
const member = (id, steak = 0, type = "Volwassene") => ({ id, name: "Persoon " + id, type, orders: { steak, kip: 0 } });

function setup() {
  const DB = createD1();
  const db = DB.raw;
  db.prepare(
    "INSERT INTO events (id, slug, name, finance_strategy, created_at, updated_at) VALUES ('ev', 'nieuwjaar', 'Nieuwjaar', 'nieuwjaar', 1, 1)"
  ).run();
  db.prepare(
    "INSERT INTO event_editions (id, event_id, label, status, config_json, created_at, updated_at) VALUES ('ed1', 'ev', '2026–2027', 'open', ?, 1, 10)"
  ).run(JSON.stringify({ catalog }));
  db.prepare("INSERT INTO edition_finance_snapshots (edition_id, created_at, updated_at) VALUES ('ed1', 1, 20)").run();
  for (const [fam, reg] of [
    ["fa", "ra"],
    ["fb", "rb"]
  ]) {
    db.prepare("INSERT INTO families (id, display_name, created_at, updated_at) VALUES (?, ?, 1, 1)").run(
      fam,
      "Gezin " + fam
    );
    db.prepare(
      "INSERT INTO event_registrations (id, edition_id, family_id, data_json, created_at, updated_at) VALUES (?, 'ed1', ?, ?, 1, 30)"
    ).run(reg, fam, JSON.stringify({ name: "Gezin " + fam, members: [member(reg + "1", 1)] }));
  }
  return DB;
}
const clone = value => JSON.parse(JSON.stringify(value));
const payload = state => ({
  editionId: state.editionId,
  eventName: state.eventName,
  editionLabel: state.editionLabel,
  startsAt: state.startsAt,
  catalog: state.catalog,
  registrations: state.registrations,
  expenses: state.expenses,
  payments: state.payments,
  costsFinalized: state.costsFinalized,
  costsFinalizedAt: state.costsFinalizedAt,
  financeRevision: state.financeRevision,
  configRevision: state.configRevision
});
const NOW = 2_000_000_000;

test("loads an edition with its catalog, registrations (with revisions) and finance", async () => {
  const state = await loadEditionState({ DB: setup() }, "ed1");
  assert.equal(state.eventName, "Nieuwjaar");
  assert.equal(state.editionLabel, "2026–2027");
  assert.equal(state.registrations.length, 2);
  assert.equal(state.registrations[0].revision, 30);
  assert.equal(state.registrations[0].familyId, "fa");
  assert.equal(state.financeRevision, 20);
  assert.ok(state.version);
});

test("saving changes only the rows that changed and returns fresh revisions", async () => {
  const DB = setup();
  const base = payload(await loadEditionState({ DB: DB }, "ed1"));
  const data = clone(base);
  data.registrations[0].members[0].orders.steak = 5;
  data.expenses.push({
    id: "e1",
    description: "Vlees",
    amountCents: 10000,
    date: "2026-12-01",
    method: "meat",
    advancedBy: "rb"
  });
  const result = await saveEditionState({ DB }, "ed1", { base, data }, NOW);
  assert.equal(result.status, 200, result.error);
  assert.equal(result.state.registrations[0].members[0].orders.steak, 5);
  assert.ok(result.state.registrations[0].revision > 30);
  assert.equal(result.state.registrations[1].revision, 30, "untouched family keeps its revision");
  assert.equal(result.state.expenses.length, 1);
});

test("an admin save and a family edit of another family do not conflict", async () => {
  const DB = setup();
  const base = payload(await loadEditionState({ DB: DB }, "ed1"));
  // family B saves in between (its own row only)
  DB.raw
    .prepare("UPDATE event_registrations SET data_json = ?, updated_at = 99 WHERE id = 'rb'")
    .run(JSON.stringify({ name: "Gezin fb", members: [member("rb1", 7)] }));
  const data = clone(base);
  data.registrations[0].name = "Gezin A hernoemd";
  const result = await saveEditionState({ DB }, "ed1", { base, data }, NOW);
  assert.equal(result.status, 200, result.error);
  assert.equal(result.state.registrations[1].members[0].orders.steak, 7, "family B's change is kept");
  assert.equal(
    DB.raw.prepare("SELECT display_name FROM families WHERE id = 'fa'").get().display_name,
    "Gezin A hernoemd"
  );
});

test("a conflict on one row aborts the whole save: nothing is written", async () => {
  const DB = setup();
  const base = payload(await loadEditionState({ DB: DB }, "ed1"));
  DB.raw.prepare("UPDATE event_registrations SET updated_at = 99 WHERE id = 'ra'").run(); // someone edited family A
  const data = clone(base);
  data.registrations[0].members[0].orders.steak = 3;
  data.expenses.push({
    id: "e1",
    description: "Drank",
    amountCents: 500,
    date: "2026-12-01",
    method: "adults",
    advancedBy: "ra"
  });
  const result = await saveEditionState({ DB }, "ed1", { base, data }, NOW);
  assert.equal(result.status, 409);
  assert.equal(
    JSON.parse(DB.raw.prepare("SELECT expenses_json FROM edition_finance_snapshots").get().expenses_json).length,
    0,
    "finance not written"
  );
});

test("a new registration creates its family; a removed one is cancelled, not deleted", async () => {
  const DB = setup();
  const base = payload(await loadEditionState({ DB: DB }, "ed1"));
  const data = clone(base);
  data.registrations = [data.registrations[0], { id: "rc", familyId: "fc", name: "Nieuw gezin", members: [] }];
  const result = await saveEditionState({ DB }, "ed1", { base, data }, NOW);
  assert.equal(result.status, 200, result.error);
  assert.equal(DB.raw.prepare("SELECT display_name FROM families WHERE id = 'fc'").get().display_name, "Nieuw gezin");
  assert.equal(DB.raw.prepare("SELECT status FROM event_registrations WHERE id = 'rb'").get().status, "cancelled");
  assert.deepEqual(
    result.state.registrations.map(r => r.id),
    ["ra", "rc"]
  );
});

test("registering a family twice for the same edition is refused", async () => {
  const DB = setup();
  const base = payload(await loadEditionState({ DB: DB }, "ed1"));
  const data = clone(base);
  data.registrations.push({ id: "ra2", familyId: "fa", name: "Gezin fa", members: [] });
  const result = await saveEditionState({ DB }, "ed1", { base, data }, NOW);
  assert.equal(result.status, 409);
});

test("finance must reference registrations of this edition", async () => {
  const DB = setup();
  const base = payload(await loadEditionState({ DB: DB }, "ed1"));
  const data = clone(base);
  data.payments.push({ id: "p1", registrationId: "unknown", amountCents: 100, date: "2026-12-01", method: "cash" });
  assert.equal((await saveEditionState({ DB }, "ed1", { base, data }, NOW)).status, 400);
});

test("starting the next edition archives the current one; families and accounts stay", async () => {
  const DB = setup();
  DB.raw
    .prepare(
      "INSERT INTO family_users (id, email, display_name, status, created_at, updated_at) VALUES ('u1', 'a@x.be', 'A', 'active', 1, 1)"
    )
    .run();
  DB.raw
    .prepare(
      "INSERT INTO family_memberships (id, family_id, user_id, role, created_at) VALUES ('m1', 'fa', 'u1', 'owner', 1)"
    )
    .run();
  const result = await startNextEdition({ DB }, "ed1", { label: "2027–2028", copyCatalog: true }, NOW);
  assert.equal(result.status, 201);
  assert.equal(DB.raw.prepare("SELECT status FROM event_editions WHERE id = 'ed1'").get().status, "archived");
  const next = await loadEditionState({ DB: DB }, result.editionId);
  assert.equal(next.editionStatus, "open");
  assert.deepEqual(
    next.catalog.map(p => p.id),
    ["steak", "kip"]
  );
  assert.equal(next.registrations.length, 0);
  assert.equal(DB.raw.prepare("SELECT COUNT(*) n FROM families").get().n, 2);
  assert.equal(DB.raw.prepare("SELECT COUNT(*) n FROM family_memberships").get().n, 1);
  assert.equal(
    (await startNextEdition({ DB }, result.editionId, { label: "2027–2028" }, NOW)).status,
    409,
    "duplicate label refused"
  );
});

test("refunds and shared-kitty costs are accepted; unknown payment kinds are not", async () => {
  const DB = setup();
  const base = payload(await loadEditionState({ DB }, "ed1"));
  const data = clone(base);
  data.expenses.push({
    id: "e1",
    description: "Zaal",
    amountCents: 5000,
    date: "2026-12-01",
    method: "general",
    advancedBy: "kas"
  });
  data.payments.push({
    id: "p1",
    registrationId: "ra",
    amountCents: 100,
    date: "2026-12-02",
    method: "bank",
    kind: "refund"
  });
  const ok = await saveEditionState({ DB }, "ed1", { base, data }, NOW);
  assert.equal(ok.status, 200, ok.error);
  assert.equal(ok.state.payments[0].kind, "refund");
  assert.equal(ok.state.expenses[0].advancedBy, "kas");
  const bad = clone(payload(ok.state));
  bad.payments[0].kind = "gift";
  assert.equal((await saveEditionState({ DB }, "ed1", { base: payload(ok.state), data: bad }, NOW)).status, 400);
});

test("a family can be registered again after being unregistered from the same edition", async () => {
  const DB = setup();
  let base = payload(await loadEditionState({ DB }, "ed1"));
  let data = clone(base);
  data.registrations = data.registrations.filter(r => r.id !== "rb"); // unregister family B
  let result = await saveEditionState({ DB }, "ed1", { base, data }, NOW);
  assert.equal(result.status, 200, result.error);
  base = payload(result.state);
  data = clone(base);
  data.registrations.push({ id: "rb-new", familyId: "fb", name: "Gezin fb", members: [member("rb1", 2)] });
  result = await saveEditionState({ DB }, "ed1", { base, data }, NOW + 5);
  assert.equal(result.status, 200, result.error);
  const again = result.state.registrations.find(r => r.familyId === "fb");
  assert.ok(again, "family B is registered again");
  assert.equal(again.members[0].orders.steak, 2);
  assert.equal(
    DB.raw.prepare("SELECT COUNT(*) n FROM event_registrations WHERE family_id = 'fb'").get().n,
    1,
    "the old row is reused"
  );
});

test("the edition date and time are saved for the countdown", async () => {
  const DB = setup();
  const base = payload(await loadEditionState({ DB }, "ed1"));
  const result = await saveEditionState(
    { DB },
    "ed1",
    { base, data: { ...clone(base), startsAt: "2026-12-31T20:00" } },
    NOW
  );
  assert.equal(result.status, 200, result.error);
  assert.equal(result.state.startsAt, "2026-12-31T20:00");
  assert.equal(
    (
      await saveEditionState(
        { DB },
        "ed1",
        { base: payload(result.state), data: { ...payload(result.state), startsAt: "morgen" } },
        NOW
      )
    ).status,
    400
  );
});

test("bar bills and the order deadline are saved by the admin", async () => {
  const DB = setup();
  const base = payload(await loadEditionState({ DB }, "ed1"));
  const data = clone(base);
  data.orderDeadline = "2026-12-20T23:59";
  data.registrations[0].members[0].barCents = 2100;
  data.expenses.push({
    id: "bar1",
    description: "Drank",
    amountCents: 5000,
    date: "2026-12-01",
    method: "bar",
    advancedBy: "kas"
  });
  const result = await saveEditionState({ DB }, "ed1", { base, data }, NOW);
  assert.equal(result.status, 200, result.error);
  assert.equal(result.state.orderDeadline, "2026-12-20T23:59");
  assert.equal(result.state.registrations[0].members[0].barCents, 2100);
  assert.equal(result.state.expenses[0].method, "bar");
});

test("a message goes to the accounts of the chosen families only", async () => {
  const { messageRecipients, messageHtml } = await import("../worker/modules/admin-edition-state.js");
  const DB = setup();
  for (const [user, fam, status] of [
    ["u1", "fa", "active"],
    ["u2", "fb", "invited"],
    ["u3", "fb", "disabled"]
  ]) {
    DB.raw
      .prepare(
        "INSERT INTO family_users (id, email, display_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)"
      )
      .run(user, user + "@x.be", user, status);
    DB.raw
      .prepare("INSERT INTO family_memberships (id, family_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', 1)")
      .run("m" + user, fam, user);
  }
  assert.deepEqual(
    (await messageRecipients({ DB }, "ed1", "all")).map(r => r.email).sort(),
    ["u1@x.be", "u2@x.be"],
    "disabled accounts get nothing"
  );
  DB.raw
    .prepare("UPDATE event_registrations SET data_json = ? WHERE id = 'rb'")
    .run(JSON.stringify({ name: "B", members: [member("rb1", 0)] }));
  assert.deepEqual(
    (await messageRecipients({ DB }, "ed1", "no-order")).map(r => r.email),
    ["u2@x.be"]
  );
  const html = messageHtml({
    displayName: "Jan",
    subject: "Info",
    message: "Regel 1\nRegel 2\n\n<script>x</script>",
    eventTitle: "Nieuwjaar 2026–2027"
  });
  assert.match(html, /Dag Jan,/);
  assert.match(html, /Regel 1<br>Regel 2/);
  assert.ok(!html.includes("<script>"), "message text is escaped");
  assert.match(html, /Naar het familieportaal/);
});

test("evening guests are accepted and never keep a meat order", async () => {
  const DB = setup();
  const base = payload(await loadEditionState({ DB }, "ed1"));
  const data = clone(base);
  data.registrations[0].members.push({
    id: "late1",
    name: "Tom",
    type: "Avondgast",
    orders: { steak: 3 },
    barCents: 1200
  });
  const result = await saveEditionState({ DB }, "ed1", { base, data }, NOW);
  assert.equal(result.status, 200, result.error);
  const tom = result.state.registrations[0].members.find(p => p.id === "late1");
  assert.equal(tom.type, "Avondgast");
  assert.deepEqual(tom.orders, {});
  assert.equal(tom.barCents, 1200);
});

test("the meat reminder skips families that only come after dinner", async () => {
  const { messageRecipients } = await import("../worker/modules/admin-edition-state.js");
  const DB = setup();
  DB.raw
    .prepare("UPDATE event_registrations SET data_json = ? WHERE id = 'ra'")
    .run(JSON.stringify({ name: "A", members: [{ id: "x", name: "X", type: "Avondgast", orders: {} }] }));
  DB.raw
    .prepare("UPDATE event_registrations SET data_json = ? WHERE id = 'rb'")
    .run(JSON.stringify({ name: "B", members: [member("y", 0)] }));
  for (const [user, fam] of [
    ["u1", "fa"],
    ["u2", "fb"]
  ]) {
    DB.raw
      .prepare(
        "INSERT INTO family_users (id, email, display_name, status, created_at, updated_at) VALUES (?, ?, ?, 'active', 1, 1)"
      )
      .run(user, user + "@x.be", user);
    DB.raw
      .prepare("INSERT INTO family_memberships (id, family_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', 1)")
      .run("m" + user, fam, user);
  }
  assert.deepEqual(
    (await messageRecipients({ DB }, "ed1", "no-order")).map(r => r.email),
    ["u2@x.be"]
  );
});

test("butcher mail: totals per product without names, evening guests left out, address remembered", async () => {
  const { handleAdminEditionState } = await import("../worker/modules/admin-edition-state.js");
  const DB = setup();
  DB.raw.prepare("UPDATE event_registrations SET data_json = ? WHERE id = 'rb'").run(
    JSON.stringify({
      name: "Gezin fb",
      members: [
        { id: "b1", name: "Piet", type: "Volwassene", orders: { steak: 2, kip: 3 } },
        { id: "b2", name: "Tom", type: "Avondgast", orders: { steak: 5 } }
      ]
    })
  );
  const mails = [];
  const tools = {
    json: (body, status = 200) => ({ status, body }),
    sameOrigin: () => true,
    adminSession: async () => true,
    sendGraphMail: async (env, to, subject, html) => mails.push({ to, subject, html })
  };
  const call = body => {
    const url = new URL("https://nieuwjaar.datuur.be/api/admin/editions/ed1/butcher");
    return handleAdminEditionState(
      new Request(url, { method: "POST", body: JSON.stringify(body) }),
      { DB },
      url,
      tools
    );
  };
  assert.equal((await call({ recipient: "geen-adres" })).status, 400);
  const result = await call({ recipient: "Slager@Voorbeeld.be", note: "Afhalen om 10 uur\n<b>graag</b>" });
  assert.equal(result.status, 200);
  assert.equal(result.body.total, 6, "1 + 2 steak and 3 kip; the evening guest's 5 steak do not count");
  assert.deepEqual(result.body.lines, [
    { name: "Steak", count: 3 },
    { name: "Kip", count: 3 }
  ]);
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, "slager@voorbeeld.be");
  assert.match(mails[0].subject, /Bestelling Nieuwjaar 2026–2027/);
  assert.ok(!/Piet|Tom|Gezin/.test(mails[0].html), "no names in the mail");
  assert.ok(!mails[0].html.includes("<b>graag"), "note is escaped");
  const state = await loadEditionState({ DB }, "ed1");
  assert.equal(state.butcherEmail, "slager@voorbeeld.be");
  assert.equal(state.configRevision, 10, "sending does not change the edition revision (no save conflicts)");
  assert.equal(state.catalog.length, 2, "catalog untouched");
});

test("settlement mail: own statement per family to its accounts; audience, test mail, no-account families", async () => {
  const { handleAdminEditionState } = await import("../worker/modules/admin-edition-state.js");
  const DB = setup();
  // fa: 1 steak + bar for Jan; fb: 1 steak. Meat 20 euro, hall 30 euro (advanced by fb), fa paid 5 euro.
  DB.raw.prepare("UPDATE event_registrations SET data_json = ? WHERE id = 'ra'").run(
    JSON.stringify({
      name: "Gezin fa",
      members: [{ id: "jan", name: "Jan", type: "Volwassene", orders: { steak: 1 }, barCents: 1250 }]
    })
  );
  DB.raw
    .prepare("UPDATE edition_finance_snapshots SET expenses_json = ?, payments_json = ? WHERE edition_id = 'ed1'")
    .run(
      JSON.stringify([
        { id: "e1", description: "Vlees", amountCents: 2000, date: "2026-12-20", method: "meat", advancedBy: "kas" },
        { id: "e2", description: "Zaal", amountCents: 3000, date: "2026-12-01", method: "general", advancedBy: "rb" }
      ]),
      JSON.stringify([{ id: "p1", registrationId: "ra", amountCents: 500, date: "2027-01-02", method: "cash" }])
    );
  DB.raw
    .prepare(
      "INSERT INTO family_users (id, email, display_name, status, created_at, updated_at) VALUES ('u1', 'jan@x.be', 'Jan', 'active', 1, 1)"
    )
    .run();
  DB.raw
    .prepare(
      "INSERT INTO family_memberships (id, family_id, user_id, role, created_at) VALUES ('m1', 'fa', 'u1', 'owner', 1)"
    )
    .run();
  const mails = [];
  const tools = {
    json: (body, status = 200) => ({ status, body }),
    sameOrigin: () => true,
    adminSession: async () => true,
    sendGraphMail: async (env, to, subject, html) => mails.push({ to, subject, html })
  };
  const call = body => {
    const url = new URL("https://nieuwjaar.datuur.be/api/admin/editions/ed1/settlement");
    return handleAdminEditionState(
      new Request(url, { method: "POST", body: JSON.stringify(body) }),
      { DB },
      url,
      tools
    );
  };

  const test1 = await call({ audience: "all", testRecipient: "Koen@X.be", note: "Cash op het feest" });
  assert.equal(test1.status, 200);
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, "koen@x.be");
  assert.match(mails[0].subject, /^\[Proef\] Voorlopige afrekening Nieuwjaar 2026–2027 – Gezin fa$/);

  mails.length = 0;
  const sent = await call({ audience: "all", note: "Cash op het feest\n<b>x</b>" });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.sent, 1, "only fa has an account");
  assert.deepEqual(sent.body.withoutAccount, ["Gezin fb"]);
  const html = mails[0].html;
  assert.equal(mails[0].to, "jan@x.be");
  assert.match(html, /Dag Jan,/);
  assert.match(html, /Voorlopige afrekening voor Gezin fa/);
  // fa: meat 10 + hall 15 + bar 12,50 = 37,50 share; paid 5 → 32,50 to pay.
  assert.match(html, /€\s?37,50/);
  assert.match(html, /Min: al betaald/);
  assert.match(html, /Nog te betalen<\/td><td[^>]*>€\s?32,50/);
  assert.match(html, /Jan €\s?12,50/, "bar per person");
  assert.ok(!html.includes("<b>x</b>"), "note is escaped");
  assert.ok(!/Gezin fb/.test(html), "no other family in the mail");

  const credit = await call({ audience: "credit" });
  assert.equal(credit.status, 400, "fb gets money back but has no account");
  const state = await loadEditionState({ DB }, "ed1");
  assert.ok(state.settlementSentAt, "time of sending remembered");
  assert.equal(state.configRevision, 10, "no change to the edition revision");
});
