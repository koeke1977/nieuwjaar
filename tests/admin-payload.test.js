import test from "node:test";
import assert from "node:assert/strict";
import { payloadFrom } from "../src/data/environment-store.js";

test("the admin save payload keeps every stored member field (allergies, notes)", () => {
  const person = { id: "p1", name: "Emma", type: "Kind", orders: { steak: 1 }, diet: ["Glutenvrij"], notes: "geen pikant", barCents: 2100 };
  const payload = payloadFrom({ editionId: "ed", registrations: [{ id: "r1", familyId: "f1", name: "Gezin", members: [person], revision: 3 }], catalog: [], expenses: [], payments: [] });
  assert.deepEqual(payload.registrations[0].members[0], person);
});

test("the admin save payload keeps who entered an expense", () => {
  const expense = { id: "e1", description: "Drank", amountCents: 100, date: "2026-12-01", method: "adults", advancedBy: "r1", enteredBy: "family" };
  assert.deepEqual(payloadFrom({ editionId: "ed", registrations: [], catalog: [], expenses: [expense], payments: [] }).expenses[0], expense);
});

test("the admin save payload keeps the order deadline", () => {
  assert.equal(payloadFrom({ editionId: "ed", orderDeadline: "2026-12-20T23:59", registrations: [], catalog: [], expenses: [], payments: [] }).orderDeadline, "2026-12-20T23:59");
});

test("the bar is balanced when the bar bills equal the drinks bill", async () => {
  const { barBalance } = await import("../src/pages/beheer/beheer-view.js");
  const regs = [{ members: [{ barCents: 2100 }, { barCents: 900 }] }, { members: [{ barCents: 2000 }] }];
  assert.deepEqual(barBalance(regs, [{ method: "bar", amountCents: 5000 }, { method: "meat", amountCents: 9999 }]), { charged: 5000, purchases: 5000, difference: 0, used: true });
  assert.equal(barBalance(regs, [{ method: "bar", amountCents: 4500 }]).difference, 500, "too much charged");
  assert.equal(barBalance([], []).used, false, "no bar: no check");
});
