import test from "node:test";
import assert from "node:assert/strict";
import { createD1 } from "./helpers/d1.js";
import { loadEditionState, saveEditionState, startNextEdition } from "../worker/modules/admin-edition-state.js";

const catalog = [{ id: "steak", name: "Steak", active: true, image: "/images/steak.jpg" }, { id: "kip", name: "Kip", active: true, image: null }];
const member = (id, steak = 0, type = "Volwassene") => ({ id, name: "Persoon " + id, type, orders: { steak, kip: 0 } });

function setup() {
  const DB = createD1();
  const db = DB.raw;
  db.prepare("INSERT INTO events (id, slug, name, finance_strategy, created_at, updated_at) VALUES ('ev', 'nieuwjaar', 'Nieuwjaar', 'nieuwjaar', 1, 1)").run();
  db.prepare("INSERT INTO event_editions (id, event_id, label, status, config_json, created_at, updated_at) VALUES ('ed1', 'ev', '2026–2027', 'open', ?, 1, 10)").run(JSON.stringify({ catalog }));
  db.prepare("INSERT INTO edition_finance_snapshots (edition_id, created_at, updated_at) VALUES ('ed1', 1, 20)").run();
  for (const [fam, reg] of [["fa", "ra"], ["fb", "rb"]]) {
    db.prepare("INSERT INTO families (id, display_name, created_at, updated_at) VALUES (?, ?, 1, 1)").run(fam, "Gezin " + fam);
    db.prepare("INSERT INTO event_registrations (id, edition_id, family_id, data_json, created_at, updated_at) VALUES (?, 'ed1', ?, ?, 1, 30)")
      .run(reg, fam, JSON.stringify({ name: "Gezin " + fam, members: [member(reg + "1", 1)] }));
  }
  return DB;
}
const clone = value => JSON.parse(JSON.stringify(value));
const payload = state => ({
  editionId: state.editionId, eventName: state.eventName, editionLabel: state.editionLabel, startsAt: state.startsAt, catalog: state.catalog,
  registrations: state.registrations, expenses: state.expenses, payments: state.payments,
  costsFinalized: state.costsFinalized, costsFinalizedAt: state.costsFinalizedAt,
  financeRevision: state.financeRevision, configRevision: state.configRevision
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
  data.expenses.push({ id: "e1", description: "Vlees", amountCents: 10000, date: "2026-12-01", method: "meat", advancedBy: "rb" });
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
  DB.raw.prepare("UPDATE event_registrations SET data_json = ?, updated_at = 99 WHERE id = 'rb'").run(JSON.stringify({ name: "Gezin fb", members: [member("rb1", 7)] }));
  const data = clone(base);
  data.registrations[0].name = "Gezin A hernoemd";
  const result = await saveEditionState({ DB }, "ed1", { base, data }, NOW);
  assert.equal(result.status, 200, result.error);
  assert.equal(result.state.registrations[1].members[0].orders.steak, 7, "family B's change is kept");
  assert.equal(DB.raw.prepare("SELECT display_name FROM families WHERE id = 'fa'").get().display_name, "Gezin A hernoemd");
});

test("a conflict on one row aborts the whole save: nothing is written", async () => {
  const DB = setup();
  const base = payload(await loadEditionState({ DB: DB }, "ed1"));
  DB.raw.prepare("UPDATE event_registrations SET updated_at = 99 WHERE id = 'ra'").run(); // someone edited family A
  const data = clone(base);
  data.registrations[0].members[0].orders.steak = 3;
  data.expenses.push({ id: "e1", description: "Drank", amountCents: 500, date: "2026-12-01", method: "adults", advancedBy: "ra" });
  const result = await saveEditionState({ DB }, "ed1", { base, data }, NOW);
  assert.equal(result.status, 409);
  assert.equal(JSON.parse(DB.raw.prepare("SELECT expenses_json FROM edition_finance_snapshots").get().expenses_json).length, 0, "finance not written");
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
  assert.deepEqual(result.state.registrations.map(r => r.id), ["ra", "rc"]);
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
  DB.raw.prepare("INSERT INTO family_users (id, email, display_name, status, created_at, updated_at) VALUES ('u1', 'a@x.be', 'A', 'active', 1, 1)").run();
  DB.raw.prepare("INSERT INTO family_memberships (id, family_id, user_id, role, created_at) VALUES ('m1', 'fa', 'u1', 'owner', 1)").run();
  const result = await startNextEdition({ DB }, "ed1", { label: "2027–2028", copyCatalog: true }, NOW);
  assert.equal(result.status, 201);
  assert.equal(DB.raw.prepare("SELECT status FROM event_editions WHERE id = 'ed1'").get().status, "archived");
  const next = await loadEditionState({ DB: DB }, result.editionId);
  assert.equal(next.editionStatus, "open");
  assert.deepEqual(next.catalog.map(p => p.id), ["steak", "kip"]);
  assert.equal(next.registrations.length, 0);
  assert.equal(DB.raw.prepare("SELECT COUNT(*) n FROM families").get().n, 2);
  assert.equal(DB.raw.prepare("SELECT COUNT(*) n FROM family_memberships").get().n, 1);
  assert.equal((await startNextEdition({ DB }, result.editionId, { label: "2027–2028" }, NOW)).status, 409, "duplicate label refused");
});

test("refunds and shared-kitty costs are accepted; unknown payment kinds are not", async () => {
  const DB = setup();
  const base = payload(await loadEditionState({ DB }, "ed1"));
  const data = clone(base);
  data.expenses.push({ id: "e1", description: "Zaal", amountCents: 5000, date: "2026-12-01", method: "general", advancedBy: "kas" });
  data.payments.push({ id: "p1", registrationId: "ra", amountCents: 100, date: "2026-12-02", method: "bank", kind: "refund" });
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
  assert.equal(DB.raw.prepare("SELECT COUNT(*) n FROM event_registrations WHERE family_id = 'fb'").get().n, 1, "the old row is reused");
});

test("the edition date and time are saved for the countdown", async () => {
  const DB = setup();
  const base = payload(await loadEditionState({ DB }, "ed1"));
  const result = await saveEditionState({ DB }, "ed1", { base, data: { ...clone(base), startsAt: "2026-12-31T20:00" } }, NOW);
  assert.equal(result.status, 200, result.error);
  assert.equal(result.state.startsAt, "2026-12-31T20:00");
  assert.equal((await saveEditionState({ DB }, "ed1", { base: payload(result.state), data: { ...payload(result.state), startsAt: "morgen" } }, NOW)).status, 400);
});
