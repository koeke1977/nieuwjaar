import test from "node:test";
import assert from "node:assert/strict";
import {
  getExpenseShares,
  getFinancialSummary,
  getMemberCostSummary
} from "../src/utils/finance.js";

const registrations = [
  {
    id: "family-a",
    name: "Familie A",
    members: [
      { id: "a1", name: "Volwassene 1", type: "Volwassene", orders: { steak: 2 } },
      { id: "a2", name: "Volwassene 2", type: "Volwassene", orders: { ribs: 1 } },
      { id: "a3", name: "Kind", type: "Kind", orders: {} }
    ]
  },
  {
    id: "family-b",
    name: "Familie B",
    members: [
      { id: "b1", name: "Volwassene", type: "Volwassene", orders: { burger: 1 } }
    ]
  }
];

test("Nieuwjaar baseline: general is weighted by number of people", () => {
  assert.deepEqual(
    getExpenseShares({ amountCents: 10000, method: "general" }, registrations, { strict: true }),
    [{ id: "family-a", cents: 7500 }, { id: "family-b", cents: 2500 }]
  );
});

test("Nieuwjaar baseline: 18+ costs exclude children", () => {
  assert.deepEqual(
    getExpenseShares({ amountCents: 6000, method: "adults" }, registrations, { strict: true }),
    [{ id: "family-a", cents: 4000 }, { id: "family-b", cents: 2000 }]
  );
});

test("Nieuwjaar baseline: meat costs follow ordered portions, not headcount", () => {
  assert.deepEqual(
    getExpenseShares({ amountCents: 9001, method: "meat" }, registrations, { strict: true }),
    [{ id: "family-a", cents: 6751 }, { id: "family-b", cents: 2250 }]
  );
});

test("Nieuwjaar baseline: combined expenses, advances and partial payment stay exact", () => {
  const summary = getFinancialSummary(registrations, [
    { id: "general", amountCents: 10000, method: "general", advancedBy: "family-a" },
    { id: "adults", amountCents: 6000, method: "adults", advancedBy: "family-b" },
    { id: "meat", amountCents: 9001, method: "meat", advancedBy: "family-a" }
  ], [{ registrationId: "family-a", amountCents: 1000 }]);

  assert.deepEqual(summary.map(row => ({
    id: row.id,
    advancedCents: row.advancedCents,
    shareCents: row.shareCents,
    balanceCents: row.balanceCents,
    paidCents: row.paidCents,
    remainingCents: row.remainingCents,
    overpaidCents: row.overpaidCents
  })), [
    {
      id: "family-a", advancedCents: 19001, shareCents: 18251,
      balanceCents: 750, paidCents: 1000, remainingCents: 0, overpaidCents: 1000
    },
    {
      id: "family-b", advancedCents: 6000, shareCents: 6750,
      balanceCents: -750, paidCents: 0, remainingCents: 750, overpaidCents: 0
    }
  ]);
});

test("Nieuwjaar baseline: member-level allocation retains adult and meat eligibility", () => {
  const shares = getMemberCostSummary(registrations[0], registrations, [
    { amountCents: 3000, method: "adults" },
    { amountCents: 3000, method: "meat" }
  ]);
  assert.deepEqual(shares, [
    { id: "a1", name: "Volwassene 1", cents: 2500 },
    { id: "a2", name: "Volwassene 2", cents: 1750 },
    { id: "a3", name: "Kind", cents: 0 }
  ]);
});
