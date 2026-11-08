// Drives the family-portal handlers (order, people, tabs) with a tiny fake DOM and checks the state.
import test from "node:test";
import assert from "node:assert/strict";

globalThis.__HTML_STRICT__ = true;
const target = { innerHTML: "" };
const feedbackNode = { textContent: "", hidden: true, dataset: {} };
const view = {
  querySelector: sel =>
    sel === "[data-account-registrations]" ? target : sel === "[data-feedback]" ? feedbackNode : null,
  querySelectorAll: () => [],
  contains: () => false
};
globalThis.document = { hidden: false, activeElement: null, querySelector: () => view, querySelectorAll: () => [] };
globalThis.window = { confirm: () => true };
const sent = [];
globalThis.fetch = async (path, options) => {
  sent.push({ path, body: options?.body ? JSON.parse(options.body) : null });
  return { ok: false, json: async () => ({}) };
};

const { portal, account, render } = await import("../src/pages/family-auth/portal-core.js");
const family = await import("../src/pages/family-auth/family-actions.js");

test("portal: order, add and edit people, viewer cannot change anything", async () => {
  portal.view = view;
  portal.panel = "account";
  const item = {
    edition: "ed",
    event: "Nieuwjaar",
    editionLabel: "2026–2027",
    editionStatus: "open",
    accessRole: "owner",
    revision: 4,
    catalog: [{ id: "steak", name: "Steak", active: true }],
    registration: { id: "ra", name: "Jan", members: [{ id: "jan", name: "Jan", type: "Volwassene", orders: {} }] },
    finance: null
  };
  account.items = [item];
  account.activeId = "ra";
  const members = item.registration.members;
  const control = dataset => ({ dataset });

  family.editorClicks.quantity(control({ person: "jan", product: "steak", delta: "1" }), item, members);
  family.editorClicks.quantity(control({ person: "jan", product: "steak", delta: "1" }), item, members);
  assert.equal(members[0].orders.steak, 2);
  assert.match(String(target.innerHTML), /Steak|Jan/);

  const form = (attr, values, extra = {}) => {
    const node = {
      dataset: extra.dataset || {},
      elements: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { value: v }])),
      querySelectorAll: () => extra.diet || []
    };
    node.closest = sel => (sel === attr ? node : null);
    return node;
  };
  const submit = node => family.handleMemberSubmit({ target: node, preventDefault() {} });

  submit(form("[data-add-member]", { memberName: "Tom", memberType: "Avondgast" }));
  assert.equal(members.length, 2);
  assert.equal(members[1].type, "Avondgast");

  submit(
    form(
      "[data-edit-member]",
      { memberName: "Jan P", memberType: "Avondgast", notes: "geen pikant" },
      { dataset: { editMember: "jan" }, diet: [{ value: "Glutenvrij" }] }
    )
  );
  assert.equal(members[0].name, "Jan P");
  assert.deepEqual(members[0].orders, {}, "evening guests order no meat");
  assert.deepEqual(members[0].diet, ["Glutenvrij"]);
  assert.equal(members[0].notes, "geen pikant");

  item.accessRole = "viewer";
  submit(form("[data-add-member]", { memberName: "Nope", memberType: "Kind" }));
  assert.equal(members.length, 2, "viewers cannot add people");

  for (const tab of ["overview", "family", "order", "costs"]) {
    account.view.tab = tab;
    render();
    assert.ok(String(target.innerHTML).length > 100, tab + " renders");
  }

  // The immediate save goes out with this family's revision.
  await new Promise(resolve => setTimeout(resolve, 20));
  const save = sent.find(call => call.path === "/api/family-account/registration");
  assert.equal(save?.body.revision, 4);
  assert.equal(save?.body.registrationId, "ra");
});

test("portal: a person with a bar bill has no remove button and cannot be removed", () => {
  const item = account.items[0];
  item.accessRole = "owner";
  item.registration.members = [
    { id: "a", name: "An", type: "Volwassene", orders: {}, barCents: 900 },
    { id: "b", name: "Bo", type: "Kind", orders: {} }
  ];
  account.view.tab = "family";
  render();
  const page = String(target.innerHTML);
  assert.match(page, /Heeft een barrekening/);
  assert.equal(page.match(/data-action="remove-member"/g).length, 1, "only for Bo");
  family.editorClicks["remove-member"]({ dataset: { index: "0" } }, item, item.registration.members);
  assert.equal(item.registration.members.length, 2);
  assert.match(feedbackNode.textContent, /An heeft een barrekening/);
});
