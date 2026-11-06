import test from "node:test";
import assert from "node:assert/strict";
import {
  splitCents,
  getExpenseShares,
  getFinancialSummary,
  getMemberCostSummary
} from "../src/utils/finance.js";

test("splitCents distributes every cent without rounding loss", () => {
  const shares = splitCents(10001, [
    { id: "a", weight: 1 },
    { id: "b", weight: 1 },
    { id: "c", weight: 1 }
  ]);
  assert.deepEqual(shares.map(row => row.cents), [3334, 3334, 3333]);
  assert.equal(shares.reduce((sum, row) => sum + row.cents, 0), 10001);
});

test("splitCents safely handles an empty or zero-weight allocation", () => {
  assert.deepEqual(splitCents(2500, []), []);
  assert.deepEqual(splitCents(2500, [{ id: "a", weight: 0 }]), []);
  assert.throws(
    () => splitCents(2500, [], { strict: true }),
    /geen deelnemers of porties/
  );
});

test("getExpenseShares can safely read an old expense with no meat orders", () => {
  const expense = { amountCents: 4200, method: "meat" };
  const registrations = [{ id: "family-a", adults: 2, children: 1, members: [] }];
  assert.deepEqual(getExpenseShares(expense, registrations), []);
  assert.throws(
    () => getExpenseShares(expense, registrations, { strict: true }),
    /geen deelnemers of porties/
  );
});

test("general and adult expenses retain exact cent totals", () => {
  const registrations = [
    { id: "a", adults: 2, children: 1, members: [{ id: "1", type: "Volwassene", orders: {} }, { id: "2", type: "Volwassene", orders: {} }, { id: "3", type: "Kind", orders: {} }] },
    { id: "b", adults: 1, children: 0, members: [{ id: "4", type: "Volwassene", orders: {} }] }
  ];
  for (const method of ["general", "adults"]) {
    const shares = getExpenseShares({ amountCents: 10001, method }, registrations, { strict: true });
    assert.equal(shares.reduce((sum, row) => sum + row.cents, 0), 10001);
  }
});

test("financial summary does not crash on a legacy expense with no eligible meat orders", () => {
  const registrations = [{ id: "a", name: "A", adults: 2, children: 0, members: [] }];
  const summary = getFinancialSummary(
    registrations,
    [{ id: "old", amountCents: 1500, advancedBy: "a", method: "meat" }],
    []
  );
  assert.equal(summary[0].advancedCents, 1500);
  assert.equal(summary[0].shareCents, 0);
});

test("member summary returns an empty list without an active registration", () => {
  assert.deepEqual(getMemberCostSummary(null, [], []), []);
});

test("family finance can use anonymous aggregate totals without member records", () => {
  const registrations = [
    {
      id: "own",
      members: [{ id: "own-1", type: "Volwassene", orders: { steak: 1 } }]
    },
    {
      id: "other",
      members: [],
      aggregateCounts: { people: 3, adults: 2, children: 1, meat: 5 }
    }
  ];
  const shares = getExpenseShares({ amountCents: 8000, method: "meat" }, registrations, { strict: true });
  assert.deepEqual(shares, [
    { id: "own", cents: 1334 },
    { id: "other", cents: 6666 }
  ]);
});
