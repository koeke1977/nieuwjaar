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

test("portal: Mijn account shows who has access; only the owner can invite and remove", async () => {
  const actions = await import("../src/pages/family-auth/account-actions.js");
  account.user = { email: "jan@x.be", displayName: "Jan" };
  account.view.settingsOpen = true;
  account.settings = {
    families: [
      {
        id: "fa",
        name: "Gezin <Jan>",
        role: "owner",
        people: [
          { id: "a1", name: "Jan", email: "jan@x.be", status: "active", role: "owner", me: true },
          { id: "b2", name: "Els", email: "els@x.be", status: "invited", role: "editor", me: false }
        ]
      }
    ]
  };
  render();
  let page = String(target.innerHTML);
  assert.match(page, /Toegang tot Gezin &lt;Jan&gt;/);
  assert.match(page, /Jan \(jij\)/);
  assert.match(page, /nog niet geactiveerd/);
  assert.equal(page.match(/data-action="remove-family-user"/g).length, 1, "only for Els, not for the owner");
  assert.match(page, /data-account-form="invite"/);
  assert.match(page, /data-account-form="password"/);
  assert.match(page, /data-account-form="email"/);

  account.settings.families[0].role = "editor";
  render();
  page = String(target.innerHTML);
  assert.ok(!page.includes('data-account-form="invite"'), "an editor cannot invite");
  assert.ok(!page.includes('data-action="remove-family-user"'), "an editor cannot remove");

  // Two different new passwords never reach the server.
  const before = sent.length;
  const form = {
    dataset: { accountForm: "password" },
    elements: {
      currentPassword: { value: "oud-wachtwoord-123" },
      newPassword: { value: "nieuw-wachtwoord-1" },
      confirmPassword: { value: "nieuw-wachtwoord-2" }
    },
    querySelector: () => ({}),
    closest: () => form,
    reset() {}
  };
  await actions.handleAccountSubmit({ target: form, preventDefault() {} });
  assert.equal(sent.length, before);
  assert.match(feedbackNode.textContent, /komen niet overeen/);

  actions.clicks["close-settings"]();
  assert.ok(!String(target.innerHTML).includes('data-account-form="password"'));
});

test("portal: wij komen niet, or that the request was passed on; not for viewers", () => {
  const item = account.items[0];
  account.view.tab = "family";
  item.accessRole = "owner";
  item.cancelRequestedAt = null;
  render();
  assert.match(String(target.innerHTML), /data-action="cancel-registration"/);
  item.cancelRequestedAt = 1800000000;
  render();
  assert.ok(!String(target.innerHTML).includes('data-action="cancel-registration"'));
  assert.match(String(target.innerHTML), /is doorgegeven aan de organisatie/);
  item.accessRole = "viewer";
  item.cancelRequestedAt = null;
  render();
  assert.ok(!String(target.innerHTML).includes('data-action="cancel-registration"'));
  item.accessRole = "owner";
});

test("portal: the order screen has photos at the controls, no cards that look tappable, and the first to order opens", async () => {
  const { helpLine } = await import("../src/pages/family-auth/family-account-view.js");
  const item = account.items[0];
  item.accessRole = "owner";
  item.ordersClosed = false;
  item.orderDeadline = null;
  item.catalog = [
    { id: "steak", name: "Steak", image: "/media/steak.jpg" },
    { id: "kip", name: "Kip", image: null }
  ];
  item.registration.members = [
    { id: "a", name: "An", type: "Volwassene", orders: { steak: 2 } },
    { id: "b", name: "Bo", type: "Kind", orders: {} },
    { id: "c", name: "Cas", type: "Volwassene", orders: {} }
  ];
  account.view = { tab: "order", editingMemberId: null, openPeople: null };
  render();
  let page = String(target.innerHTML);
  assert.ok(!page.includes('fa-product"'), "no product cards");
  assert.match(page, /fa-stepper-product"><img src="\/media\/steak.jpg"/);
  assert.match(page, /✓ Steak 2/);
  assert.ok(/data-order-person="b" open/.test(page), "the first person without an order is open");
  assert.ok(!/data-order-person="a" open/.test(page));
  assert.ok(!/data-order-person="c" open/.test(page));

  // Ordering for Bo does not close Bo's panel, although Cas is now the first without an order.
  family.editorClicks.quantity(
    { dataset: { person: "b", product: "steak", delta: "1" } },
    item,
    item.registration.members
  );
  page = String(target.innerHTML);
  assert.ok(/data-order-person="b" open/.test(page));
  assert.ok(!/data-order-person="c" open/.test(page));

  assert.equal(String(helpLine("")), "Hulp nodig? Neem contact op met de organisatie.");
  assert.equal(String(helpLine("Koen <x>")), "Hulp nodig? Koen &lt;x&gt;");
  assert.equal(String(helpLine("Koen, 0470 12 34 56")), 'Hulp nodig? Koen, <a href="tel:0470123456">0470 12 34 56</a>');
});

test("portal: the Gezin tab shows no zero amounts, and logging out is under Mijn account", () => {
  const item = account.items[0];
  item.finance = {
    expenses: [{ id: "e" }],
    finalized: false,
    totals: { shareCents: 3000 },
    categories: [{ method: "general" }, { method: "bar" }],
    members: [{ id: "a", totalCents: 3000, byMethod: { general: 3000, bar: 0 } }]
  };
  account.view = { tab: "family", editingMemberId: null, openPeople: null };
  item.registration.members = [{ id: "a", name: "An", type: "Volwassene", orders: {} }];
  render();
  let page = String(target.innerHTML);
  assert.match(page, /Hoe is dit berekend/);
  assert.match(page, /Algemeen/);
  assert.ok(!/Bar <b>/.test(page), "no Bar 0,00");
  assert.ok(!page.includes('data-action="logout"'));
  account.view.settingsOpen = true;
  account.settings = { families: [] };
  render();
  assert.match(String(target.innerHTML), /data-action="logout"/);
  account.view.settingsOpen = false;
  item.finance = null;
});
