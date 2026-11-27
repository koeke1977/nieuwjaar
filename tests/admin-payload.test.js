import test from "node:test";
import assert from "node:assert/strict";
import { payloadFrom } from "../src/data/edition-payload.js";

test("the admin save payload keeps every stored member field (allergies, notes)", () => {
  const person = {
    id: "p1",
    name: "Emma",
    type: "Kind",
    orders: { steak: 1 },
    diet: ["Glutenvrij"],
    notes: "geen pikant",
    barCents: 2100
  };
  const payload = payloadFrom({
    editionId: "ed",
    registrations: [{ id: "r1", familyId: "f1", name: "Gezin", members: [person], revision: 3 }],
    catalog: [],
    expenses: [],
    payments: []
  });
  assert.deepEqual(payload.registrations[0].members[0], person);
});

test("the admin save payload keeps who entered an expense", () => {
  const expense = {
    id: "e1",
    description: "Drank",
    amountCents: 100,
    date: "2026-12-01",
    method: "adults",
    advancedBy: "r1",
    enteredBy: "family"
  };
  assert.deepEqual(
    payloadFrom({ editionId: "ed", registrations: [], catalog: [], expenses: [expense], payments: [] }).expenses[0],
    expense
  );
});

test("the admin save payload keeps the order deadline", () => {
  assert.equal(
    payloadFrom({
      editionId: "ed",
      orderDeadline: "2026-12-20T23:59",
      registrations: [],
      catalog: [],
      expenses: [],
      payments: []
    }).orderDeadline,
    "2026-12-20T23:59"
  );
});

test("the bar is balanced when the bar bills equal the drinks bill", async () => {
  const { barBalance } = await import("../src/pages/beheer/beheer-view.js");
  const regs = [{ members: [{ barCents: 2100 }, { barCents: 900 }] }, { members: [{ barCents: 2000 }] }];
  assert.deepEqual(
    barBalance(regs, [
      { method: "bar", amountCents: 5000 },
      { method: "meat", amountCents: 9999 }
    ]),
    { charged: 5000, buffer: 0, purchases: 5000, difference: 0, used: true, off: false, leftover: 0 }
  );
  assert.equal(barBalance(regs, [{ method: "bar", amountCents: 4500 }]).difference, 500, "too much charged");
  assert.equal(barBalance(regs, [{ method: "bar", amountCents: 4500 }]).off, true, "without buffer: must be € 0");
  assert.equal(barBalance([], []).used, false, "no bar: no check");
});

test("with a barbuffer a surplus goes to next year and only a shortfall is a problem", async () => {
  const { barBalance } = await import("../src/pages/beheer/beheer-view.js");
  const { state } = await import("../src/data/admin-store.js");
  const regs = [{ members: [{ barCents: 2100 }, { barCents: 900 }] }, { members: [{ barCents: 2000 }] }];
  state.barBufferCents = 200;
  try {
    // 3 people x € 2 = € 6 buffer; missed tally marks of € 4 still leave € 2 over.
    const covered = barBalance(regs, [{ method: "bar", amountCents: 5400 }]);
    assert.deepEqual(
      { buffer: covered.buffer, difference: covered.difference, off: covered.off, leftover: covered.leftover },
      { buffer: 600, difference: 200, off: false, leftover: 200 }
    );
    const short = barBalance(regs, [{ method: "bar", amountCents: 5700 }]);
    assert.equal(short.off, true, "more missed than the buffer covers");
    assert.equal(short.leftover, 0);
  } finally {
    state.barBufferCents = 0;
  }
});

test("Financiën stays balanced with a barbuffer: the buffer is not a split cost", async () => {
  const { renderFinance } = await import("../src/pages/beheer/screens/finance.js");
  const { state } = await import("../src/data/admin-store.js");
  const saved = { ...state };
  Object.assign(state, {
    barBufferCents: 250,
    registrations: [
      { id: "a", name: "Familie A", members: [{ id: "a1", name: "Ben", type: "Volwassene", barCents: 1200 }] },
      { id: "b", name: "Familie B", members: [{ id: "b1", name: "Tina", type: "Kind" }] }
    ],
    expenses: [
      { id: "e1", description: "Zaal", amountCents: 3401, method: "general", advancedBy: "a", date: "2026-12-01" }
    ],
    payments: []
  });
  try {
    const out = String(renderFinance());
    assert.ok(out.includes("Sluitend: alle kosten zijn verdeeld"), "no 'niet verdeeld' because of the buffer");
    // The buffer itself is visible: € 2,50 x 2 persons = € 5,00.
    assert.ok(out.includes("Barbuffer"));
    assert.ok(/2,50 × 2 personen/.test(out.replace(/\u00a0/g, " ")));
    assert.ok(out.replace(/\u00a0/g, " ").includes("€ 5,00"));
  } finally {
    Object.assign(state, saved);
  }
});
