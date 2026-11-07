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
  nav.clicks["users-sort"]({ dataset: { table: "families", key: "access" } });
  assert.deepEqual(order(), ["fa", "fm", "fz"], "account: active, invited, none");
  nav.clicks["users-sort"]({ dataset: { table: "families", key: "access" } });
  assert.deepEqual(order(), ["fz", "fm", "fa"], "same column again reverses");
  nav.clicks["users-filter"]({ dataset: { table: "families", filter: "no-account" } });
  assert.deepEqual(order(), ["fz"]);
  nav.clicks["users-filter"]({ dataset: { table: "families", filter: "registered" } });
  assert.deepEqual(order(), ["fa"], "only Jan is registered in the open edition");
  nav.clicks["users-tab"]({ dataset: { tab: "accounts" } });
  nav.clicks["users-sort"]({ dataset: { table: "accounts", key: "login" } });
  assert.ok(rendered.indexOf("jan@x.be") < rendered.indexOf("mark@x.be"), "most recent login first");
});
