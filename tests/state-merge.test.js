import test from "node:test";
import assert from "node:assert/strict";
import { mergeEditionState } from "../src/utils/state-merge.js";

const reg = (id, steak) => ({ id, name: id, members: [{ id: id + "-1", name: "P", type: "Volwassene", orders: { steak } }] });
const base = {
  activeEvent: { name: "Nieuwjaar" },
  costsFinalized: false,
  registrations: [reg("a", 1), reg("b", 1)],
  expenses: [{ id: "e1", amountCents: 100 }],
  payments: [],
  catalog: [{ id: "steak", active: true }]
};
const clone = value => JSON.parse(JSON.stringify(value));

test("admin adds an expense while a family changed its order: both survive", () => {
  const mine = clone(base); mine.expenses.push({ id: "e2", amountCents: 500 });
  const theirs = clone(base); theirs.registrations[0] = reg("a", 5);
  const { merged, conflicts } = mergeEditionState(base, mine, theirs);
  assert.deepEqual(merged.expenses.map(e => e.id), ["e1", "e2"]);
  assert.equal(merged.registrations[0].members[0].orders.steak, 5);
  assert.deepEqual(conflicts, []);
});

test("admin edits family b while family a saved: both survive", () => {
  const mine = clone(base); mine.registrations[1].name = "B renamed";
  const theirs = clone(base); theirs.registrations[0] = reg("a", 3);
  const { merged } = mergeEditionState(base, mine, theirs);
  assert.equal(merged.registrations[0].members[0].orders.steak, 3);
  assert.equal(merged.registrations[1].name, "B renamed");
});

test("deletions are respected unless the other side changed the item", () => {
  const mine = clone(base); mine.expenses = [];
  const theirs = clone(base);
  assert.deepEqual(mergeEditionState(base, mine, theirs).merged.expenses, []);
  const theirsChanged = clone(base); theirsChanged.expenses[0].amountCents = 999;
  assert.equal(mergeEditionState(base, mine, theirsChanged).merged.expenses[0].amountCents, 999);
});

test("same item changed on both sides: mine wins and the conflict is reported", () => {
  const mine = clone(base); mine.registrations[0] = reg("a", 7);
  const theirs = clone(base); theirs.registrations[0] = reg("a", 9);
  const { merged, conflicts } = mergeEditionState(base, mine, theirs);
  assert.equal(merged.registrations[0].members[0].orders.steak, 7);
  assert.deepEqual(conflicts, ["registrations:a"]);
});

test("a family edit that reopened costs is kept when the admin did not touch the flag", () => {
  const finalBase = { ...clone(base), costsFinalized: true, costsFinalizedAt: "x" };
  const mine = clone(finalBase); mine.expenses.push({ id: "e3", amountCents: 1 });
  const theirs = { ...clone(finalBase), costsFinalized: false, costsFinalizedAt: null };
  theirs.registrations[0] = reg("a", 2);
  const { merged } = mergeEditionState(finalBase, mine, theirs);
  assert.equal(merged.costsFinalized, false);
});
