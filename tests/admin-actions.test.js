// Drives the admin click/form handlers (src/pages/beheer/actions) with a tiny fake DOM and checks the state.
import test from "node:test";
import assert from "node:assert/strict";
globalThis.__HTML_STRICT__ = true;
let rendered = "";
const app = {
  set innerHTML(v) {
    rendered = String(v);
  },
  get innerHTML() {
    return rendered;
  }
};
globalThis.document = {
  querySelector: sel => (sel === "#app" ? app : null),
  querySelectorAll: () => [],
  activeElement: null,
  hidden: false
};
const alerts = [];
globalThis.window = { scrollTo() {}, alert: m => alerts.push(m), confirm: () => true, prompt: () => "", print() {} };
globalThis.localStorage = { getItem: () => null, setItem() {} };

const root = new URL("../src/", import.meta.url).href;
const { state } = await import(root + "data/admin-store.js");
const { applyEdition } = await import(root + "data/edition-payload.js");
const core = await import(root + "pages/beheer/admin-core.js");
const nav = await import(root + "pages/beheer/actions/navigation.js");
const reg = await import(root + "pages/beheer/actions/registrations.js");
const fin = await import(root + "pages/beheer/actions/finance.js");
const ed = await import(root + "pages/beheer/actions/edition.js");

applyEdition(
  {
    editionId: "ed",
    eventId: "ev",
    eventName: "Nieuwjaar",
    editionLabel: "2026–2027",
    editionStatus: "open",
    catalog: [{ id: "steak", name: "Steak", active: true }],
    registrations: [
      {
        id: "ra",
        familyId: "fa",
        name: "Jan",
        revision: 1,
        members: [{ id: "jan", name: "Jan", type: "Volwassene", orders: { steak: 1 } }]
      }
    ],
    expenses: [],
    payments: [],
    costsFinalized: false,
    financeRevision: 1,
    configRevision: 1
  },
  { keepUi: false }
);
state.events = [
  { id: "ev", name: "Nieuwjaar", status: "active", editions: [{ id: "ed", label: "2026–2027", status: "open" }] }
];
core.session.authenticated = true; // saving stays off: statePersistenceReady is false in this test

test("admin actions change the state and every edition tab still renders", async () => {
  const button = dataset => ({ dataset, disabled: false });
  const form = (id, values, extra = {}) => ({
    id,
    dataset: extra.dataset || {},
    elements: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { value: v, checked: !!v }])),
    querySelector: () => ({}),
    querySelectorAll: () => [],
    closest: () => null,
    reset() {}
  });
  const ev = { preventDefault() {} };
  const step = (name, fn) => {
    rendered = "";
    fn();
    assert.ok(rendered.includes("bh-app") || rendered.length > 100, name + ": rendered");
  };

  step("edition-tab finance", () => nav.clicks["edition-tab"](button({ tab: "finance" })));
  assert.equal(state.beheerEditionTab, "finance");
  step("open-family", () => nav.clicks["open-family"](button({ id: "ra" })));
  assert.equal(state.beheerFamilyId, "ra");
  step("admin-quantity +1", () =>
    reg.clicks["admin-quantity"](button({ registration: "ra", person: "jan", product: "steak", delta: "1" }))
  );
  assert.equal(state.registrations[0].members[0].orders.steak, 2);
  state.managingRegistrationId = "ra";
  await reg.forms["add-member-form"](form("add-member-form", { memberName: "Lies", memberType: "Kind" }), ev);
  assert.equal(state.registrations[0].members.length, 2);
  await fin.forms["expense-form"](
    form("add-expense-form", {
      description: "Zaal",
      amount: "90",
      date: "2026-12-01",
      method: "general",
      advancedBy: "ra"
    }),
    ev,
    "add-expense-form"
  );
  assert.equal(state.expenses.length, 1);
  assert.equal(state.expenses[0].amountCents, 9000);
  step("edit-expense", () => fin.clicks["edit-expense"](button({ id: state.expenses[0].id })));
  await fin.forms["expense-form"](
    form("edit-expense-form", {
      description: "Zaal 2",
      amount: "100",
      date: "2026-12-01",
      method: "general",
      advancedBy: "kas"
    }),
    ev,
    "edit-expense-form"
  );
  assert.equal(state.expenses[0].description, "Zaal 2");
  assert.equal(state.expenses.length, 1);
  await fin.forms["add-payment-form"](
    form("add-payment-form", { registrationId: "ra", amount: "10", date: "2027-01-02", method: "cash" }),
    ev
  );
  assert.equal(state.payments.length, 1);
  step("finalize-costs", () => fin.clicks["finalize-costs"](button({})));
  assert.equal(state.costsFinalized, true);
  step("toggle-product", () => ed.clicks["toggle-product"](button({ id: "steak" })));
  assert.equal(state.catalog[0].active, false);
  step("message-template", () => ed.clicks["message-template"](button({ template: "reminder" })));
  assert.equal(state.beheerMessageDraft.audience, "no-order");
  reg.handleBarInput({
    target: { closest: () => ({ dataset: { registration: "ra", person: "jan" }, value: "12,5" }) }
  });
  assert.equal(state.registrations[0].members[0].barCents, 1250);
  step("delete-member", () => reg.clicks["delete-member"](button({ index: "1" })));
  assert.equal(state.registrations[0].members.length, 1);
  delete state.registrations[0].members[0].barCents; // the bar bill has its own check (test below)
  step("unregister-family blocked by linked costs", () => {
    reg.clicks["unregister-family"](button({ id: "ra" }));
    core.renderApp();
  });
  assert.equal(state.registrations.length, 1);
  assert.match(alerts.at(-1), /kost\(en\) of betaling/);
  for (const s of ["overview", "registrations", "order", "finance", "bar", "products", "edition"])
    step("render " + s, () => nav.clicks["edition-tab"](button({ tab: s })));
});

test("Gebruikers: families can be sorted by column and filtered", async () => {
  const view = await import(root + "pages/beheer/beheer-view.js");
  const nav = await import(root + "pages/beheer/actions/navigation.js");
  view.setBeheerFamilies([
    { id: "fa", name: "Jan", registrations: [], accounts: [{ id: "u1", status: "active" }] },
    { id: "fz", name: "Anna", registrations: [], accounts: [] },
    { id: "fm", name: "Mark", registrations: [], accounts: [{ id: "u2", status: "invited" }] }
  ]);
  view.setBeheerAccounts([
    { id: "u1", email: "jan@x.be", status: "active", lastLoginAt: 1794000000, families: [{ familyId: "fa" }] },
    { id: "u2", email: "mark@x.be", status: "invited", families: [{ familyId: "fm" }] }
  ]);
  Object.assign(state, { activeSection: "users", beheerUsersTab: "families", beheerUserFamilyId: null });
  const order = () => [...rendered.matchAll(/data-action="open-user-family" data-id="([^"]+)"/g)].map(m => m[1]);
  core.renderApp();
  assert.deepEqual(order(), ["fz", "fa", "fm"], "by name: Anna, Jan, Mark");
  nav.clicks["table-sort"]({ dataset: { table: "families", key: "access", first: "desc" } });
  assert.deepEqual(order(), ["fa", "fm", "fz"], "account: active, invited, none");
  nav.clicks["table-sort"]({ dataset: { table: "families", key: "access", first: "desc" } });
  assert.deepEqual(order(), ["fz", "fm", "fa"], "same column again reverses");
  nav.clicks["table-filter"]({ dataset: { table: "families", filter: "no-account" } });
  assert.deepEqual(order(), ["fz"]);
  nav.clicks["table-filter"]({ dataset: { table: "families", filter: "registered" } });
  assert.deepEqual(order(), ["fa"], "only Jan is registered in the open edition");
  nav.clicks["users-tab"]({ dataset: { tab: "accounts" } });
  nav.clicks["table-sort"]({ dataset: { table: "accounts", key: "login", first: "desc" } });
  assert.ok(rendered.indexOf("jan@x.be") < rendered.indexOf("mark@x.be"), "most recent login first");
});

test("Inschrijvingen: registrations table sorts by portions and filters families without an order", () => {
  state.registrations.push({
    id: "rz",
    familyId: "fz",
    name: "Anna",
    revision: 0,
    members: [{ id: "anna", name: "Anna", type: "Volwassene", orders: {} }]
  });
  Object.assign(state, { activeSection: "events", beheerEventView: "edition", beheerEditionTab: "registrations" });
  Object.assign(state, { beheerFamilyId: null, beheerTableFilter: {}, beheerTableSort: {} });
  const order = () => [...rendered.matchAll(/data-action="open-family" data-id="([^"]+)"/g)].map(m => m[1]);
  core.renderApp();
  assert.deepEqual(order(), ["rz", "ra"], "by name: Anna, Jan");
  nav.clicks["table-sort"]({ dataset: { table: "registrations", key: "portions", first: "desc" } });
  assert.deepEqual(order(), ["ra", "rz"], "most portions first");
  nav.clicks["table-filter"]({ dataset: { table: "registrations", filter: "no-order" } });
  assert.deepEqual(order(), ["rz"]);
  assert.match(rendered, /Nog niets/);
});

test("Kassa: pay in cash (full or other amount), give money back, everything ends at zero", async () => {
  const fin = await import(root + "pages/beheer/actions/finance.js");
  const { getFinancialSummary } = await import(root + "utils/finance.js");
  state.registrations = [
    {
      id: "ra",
      familyId: "fa",
      name: "Jan",
      revision: 1,
      members: [{ id: "j", name: "Jan", type: "Volwassene", orders: {} }]
    },
    {
      id: "rz",
      familyId: "fz",
      name: "Anna",
      revision: 1,
      members: [{ id: "a", name: "Anna", type: "Volwassene", orders: {} }]
    }
  ];
  // Anna advanced the hall (100 euro): both owe 50, so Jan pays 50 and Anna gets 50 back.
  state.expenses = [
    { id: "e", description: "Zaal", amountCents: 10000, date: "2026-12-01", method: "general", advancedBy: "rz" }
  ];
  state.payments = [];
  Object.assign(state, {
    activeSection: "events",
    beheerEventView: "edition",
    beheerEditionTab: "cash",
    beheerTableFilter: {}
  });
  const balance = id => getFinancialSummary(state.registrations, state.expenses, state.payments).find(r => r.id === id);
  core.renderApp();
  assert.match(rendered, /data-action="cash-pay" data-id="ra"/);
  window.prompt = () => "20";
  fin.clicks["cash-other"]({ dataset: { id: "ra" } });
  assert.equal(balance("ra").remainingCents, 3000);
  fin.clicks["cash-pay"]({ dataset: { id: "ra" } });
  assert.equal(balance("ra").remainingCents, 0);
  fin.clicks["cash-refund"]({ dataset: { id: "rz" } });
  assert.equal(balance("rz").creditCents, 0);
  assert.deepEqual(
    state.payments.map(p => [p.registrationId, p.amountCents, p.method, p.kind || "payment", typeof p.at]),
    [
      ["ra", 2000, "cash", "payment", "number"],
      ["ra", 3000, "cash", "payment", "number"],
      ["rz", 5000, "cash", "refund", "number"]
    ]
  );
  assert.match(rendered, /Laatst in de kassa/);
  window.prompt = () => "999";
  fin.clicks["cash-other"]({ dataset: { id: "ra" } });
  assert.equal(state.payments.length, 3, "nothing open any more: no extra payment");
  fin.clicks["delete-payment"]({ dataset: { id: state.payments[2].id } });
  assert.equal(balance("rz").creditCents, 5000, "undo brings the refund back");
});

test("the admin cannot lose a bar bill by deleting a person or unregistering the family", async () => {
  const reg = await import(root + "pages/beheer/actions/registrations.js");
  state.registrations = [
    {
      id: "ra",
      familyId: "fa",
      name: "Jan",
      revision: 1,
      members: [
        { id: "j", name: "Jan", type: "Volwassene", orders: {}, barCents: 1250 },
        { id: "l", name: "Lies", type: "Kind", orders: {} }
      ]
    }
  ];
  Object.assign(state, { expenses: [], payments: [], managingRegistrationId: "ra" });
  reg.clicks["delete-member"]({ dataset: { index: "0" } });
  assert.equal(state.registrations[0].members.length, 2, "person with a bar bill stays");
  assert.match(alerts.at(-1), /Jan heeft nog een barrekening/);
  reg.clicks["unregister-family"]({ dataset: { id: "ra" } });
  assert.equal(state.registrations.length, 1, "family with a bar bill stays");
  assert.match(alerts.at(-1), /Zet die eerst op € 0 bij Bar/);
  reg.clicks["delete-member"]({ dataset: { index: "1" } });
  assert.equal(state.registrations[0].members.length, 1, "someone without a bar bill can go");
  delete state.registrations[0].members[0].barCents;
  reg.clicks["unregister-family"]({ dataset: { id: "ra" } });
  assert.equal(state.registrations.length, 0, "after clearing the bill the family can be unregistered");
});

test("Accounts: a locked account shows a chip, the filter and an unlock button", async () => {
  const view = await import(root + "pages/beheer/beheer-view.js");
  view.setBeheerAccounts([
    { id: "a1", email: "jan@x.be", status: "active", resetLocked: true, loginLocked: false, families: [] },
    { id: "a2", email: "piet@x.be", status: "active", resetLocked: false, loginLocked: false, families: [] }
  ]);
  Object.assign(state, {
    activeSection: "users",
    beheerUsersTab: "accounts",
    beheerUserFamilyId: null,
    beheerTableSort: {},
    beheerTableFilter: {}
  });
  core.renderApp();
  assert.match(rendered, /🔒 Wachtwoordherstel/);
  assert.equal(rendered.match(/value="account-unlock"/g).length, 1, "only for the locked account");
  nav.clicks["table-filter"]({ dataset: { table: "accounts", filter: "locked" } });
  assert.ok(rendered.includes("jan@x.be") && !rendered.includes("piet@x.be"));
});

test("a family's request to cancel is visible to the admin and can be closed", async () => {
  const reg = await import(root + "pages/beheer/actions/registrations.js");
  const calls = [];
  globalThis.fetch = async (path, options) => {
    calls.push({ path, body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ removed: true }) };
  };
  state.registrations = [
    { id: "ra", familyId: "fa", name: "Jan", revision: 1, members: [] },
    { id: "rb", familyId: "fb", name: "Piet", revision: 1, members: [] }
  ];
  Object.assign(state, {
    expenses: [],
    payments: [],
    cancelRequests: { ra: { at: 1800000000 } },
    activeEditionId: "ed",
    activeSection: "events",
    beheerEventView: "edition",
    beheerEditionTab: "overview",
    beheerFamilyId: null,
    beheerTableFilter: {},
    beheerTableSort: {}
  });
  core.renderApp();
  assert.match(rendered, /📨 wil zich afmelden/);

  nav.clicks["edition-tab"]({ dataset: { tab: "registrations" } });
  nav.clicks["table-filter"]({ dataset: { table: "registrations", filter: "cancel" } });
  assert.deepEqual(
    [...rendered.matchAll(/data-action="open-family" data-id="([^"]+)"/g)].map(m => m[1]),
    ["ra"]
  );

  nav.clicks["open-family"]({ dataset: { id: "ra" } });
  assert.match(rendered, /vroeg op .* om zich af te melden/);
  await reg.clicks["dismiss-cancel-request"]({ dataset: { id: "ra" } });
  assert.equal(calls.at(-1).path, "/api/admin/editions/ed/cancel-request");
  assert.deepEqual(calls.at(-1).body, { registrationId: "ra" });
  assert.deepEqual(state.cancelRequests, {});
  assert.ok(!rendered.includes("om zich af te melden"));

  // Unregistering the family also closes its request.
  state.cancelRequests = { rb: { at: 1800000000 } };
  reg.clicks["unregister-family"]({ dataset: { id: "rb" } });
  assert.equal(calls.at(-1).body.registrationId, "rb");
  assert.equal(state.registrations.length, 1);
});

test("Accounts: the dropdown lists what fits the account and runs it after confirmation", async () => {
  const accountsActions = await import(root + "pages/beheer/actions/accounts.js");
  const view = await import(root + "pages/beheer/beheer-view.js");
  view.setBeheerAccounts([
    { id: "a1", email: "actief@x.be", status: "active", families: [] },
    { id: "a2", email: "uitgenodigd@x.be", status: "invited", families: [] },
    { id: "a3", email: "geblokkeerd@x.be", status: "disabled", loginLocked: true, families: [] }
  ]);
  Object.assign(state, {
    activeSection: "users",
    beheerUsersTab: "accounts",
    beheerUserFamilyId: null,
    beheerTableSort: {},
    beheerTableFilter: {}
  });
  core.renderApp();
  const menuOf = email => rendered.slice(rendered.indexOf('data-email="' + email + '"')).split("</select>")[0];
  assert.match(menuOf("actief@x.be"), /Blokkeren/);
  assert.match(menuOf("actief@x.be"), /Afmelden op alle toestellen/);
  assert.ok(!/Deblokkeren|opnieuw sturen|Ontgrendelen/.test(menuOf("actief@x.be")));
  assert.match(menuOf("uitgenodigd@x.be"), /Uitnodiging opnieuw sturen/);
  assert.ok(!/Blokkeren/.test(menuOf("uitgenodigd@x.be")));
  assert.match(menuOf("geblokkeerd@x.be"), /Deblokkeren/);
  assert.match(menuOf("geblokkeerd@x.be"), /Ontgrendelen/);
  for (const email of ["actief@x.be", "uitgenodigd@x.be", "geblokkeerd@x.be"])
    assert.match(menuOf(email), /Verwijderen/);

  const calls = [];
  globalThis.fetch = async (path, options) => {
    calls.push({ path, method: options.method, body: options.body && JSON.parse(options.body) });
    return { ok: true, json: async () => ({}) };
  };
  const choose = async (value, user = "a1", email = "actief@x.be") => {
    const menu = {
      value,
      selectedOptions: [{ textContent: "Blokkeren" }],
      dataset: { user, email },
      disabled: false,
      closest: () => menu
    };
    accountsActions.handleAccountMenu({ target: menu });
    assert.equal(menu.value, "", "the dropdown goes back to Actie kiezen");
    await new Promise(resolve => setTimeout(resolve, 0));
    return menu;
  };

  const confirmed = window.confirm;
  window.confirm = () => false;
  await choose("account-status:disabled");
  assert.equal(calls.filter(call => call.method === "PATCH").length, 0, "no answer, no action");
  window.confirm = confirmed;

  await choose("account-status:disabled");
  const patch = calls.find(call => call.method === "PATCH");
  assert.equal(patch.path, "/api/admin/family-users/a1");
  assert.deepEqual(patch.body, { status: "disabled" });

  await choose("account-unlock", "a3", "geblokkeerd@x.be");
  assert.ok(calls.some(call => call.path === "/api/admin/family-users/a3/unlock"));

  const before = calls.length;
  window.prompt = () => "iets anders";
  await choose("account-delete");
  assert.equal(calls.length, before, "deleting still needs the exact e-mail address");
});

test("Laatste activiteit: new lines are marked until seen, lines open the family, the family page has its history", () => {
  const now = Math.floor(Date.now() / 1000);
  state.registrations = [{ id: "ra", familyId: "fa", name: "Jan", revision: 1, members: [] }];
  Object.assign(state, {
    expenses: [],
    payments: [],
    cancelRequests: {},
    activeSection: "events",
    beheerEventView: "edition",
    beheerEditionTab: "overview",
    beheerFamilyId: null,
    activitySeenAt: now - 100,
    activity: [
      {
        id: "1",
        at: now,
        familyId: "fa",
        registrationId: "ra",
        familyName: "Jan <x>",
        actor: "Els",
        summary: "Jan: Steak 2 → 3"
      },
      {
        id: "2",
        at: now - 200,
        familyId: "fz",
        registrationId: null,
        familyName: "Anna",
        actor: "Anna",
        summary: "Account geactiveerd"
      }
    ]
  });
  core.renderApp();
  assert.match(rendered, /Laatste activiteit/);
  assert.match(rendered, /Vandaag/);
  assert.match(rendered, /1 nieuw/);
  assert.match(rendered, /bh-tab-badge">1</);
  assert.equal(rendered.match(/bh-activity-row is-new/g).length, 1);
  assert.match(rendered, /Jan &lt;x&gt;/);
  assert.match(rendered, /door Els/);
  assert.match(rendered, /data-action="open-family" data-id="ra"/);
  assert.match(
    rendered,
    /data-action="open-user-family" data-id="fz"/,
    "a family not in this edition opens under Gebruikers"
  );

  nav.clicks["activity-seen"]();
  assert.equal(state.activitySeenAt, now);
  assert.ok(!rendered.includes("is-new"));
  assert.ok(!rendered.includes("bh-tab-badge"));

  // New activity arrives; leaving the overview marks it as seen.
  state.activity = [
    { id: "3", at: now + 50, familyId: "fa", registrationId: "ra", familyName: "Jan", actor: "", summary: "Afgemeld" },
    ...state.activity
  ];
  core.renderApp();
  assert.match(rendered, /1 nieuw/);
  nav.clicks["open-family"]({ dataset: { id: "ra" } });
  assert.equal(state.activitySeenAt, now + 50);
  assert.match(rendered, /Geschiedenis/);
  assert.match(rendered, /Steak 2 → 3/);
  assert.ok(!rendered.includes("Account geactiveerd"), "only this family's lines");

  state.activity = [];
  nav.clicks["edition-tab"]({ dataset: { tab: "overview" } });
  assert.match(rendered, /Nog geen activiteit/);
});
