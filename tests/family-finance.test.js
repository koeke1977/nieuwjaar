import test from "node:test";
import assert from "node:assert/strict";
import { getFamilyFinanceBreakdown, getFinancialSummary, getMemberCostSummary } from "../src/utils/finance.js";
import { createD1 } from "./helpers/d1.js";
import { handleFamilyAccountApi } from "../worker/modules/family-account.js";

// Family A: 2 adults + 1 child, 10 portions. Family B: 1 adult, 90 portions. Total 100 portions.
const familyA = { id: "a", name: "Familie A", members: [
  { id: "a1", name: "Jan", type: "Volwassene", orders: { p1: 4 } },
  { id: "a2", name: "Els", type: "Volwassene", orders: { p1: 4 } },
  { id: "a3", name: "Kobe", type: "Kind", orders: { p1: 2 } }
] };
const familyB = { id: "b", name: "Familie B", members: [
  { id: "b1", name: "Piet", type: "Volwassene", orders: { p1: 90 } }
] };
const registrations = [familyA, familyB];
const expenses = [
  { id: "e1", description: "Vlees", amountCents: 40000, method: "meat", advancedBy: "b", date: "2026-12-20" },
  { id: "e2", description: "Zaalhuur", amountCents: 10000, method: "general", advancedBy: "a" },
  { id: "e3", description: "Cava", amountCents: 3001, method: "adults", advancedBy: "b" }
];
const payments = [{ id: "pay1", registrationId: "a", amountCents: 1000, date: "2026-12-30", method: "bank" }];

test("meat is split by the rule of three on ordered portions", () => {
  const finance = getFamilyFinanceBreakdown(familyA, registrations, expenses, payments);
  const meat = finance.categories.find(category => category.method === "meat");
  assert.equal(meat.familyUnits, 10);
  assert.equal(meat.totalUnits, 100);
  assert.equal(meat.familyCents, 4000, "10 of 100 portions = 10% of €400");
});

test("children never carry adult-only costs", () => {
  const finance = getFamilyFinanceBreakdown(familyA, registrations, expenses, payments);
  const kobe = finance.members.find(member => member.id === "a3");
  assert.equal(kobe.byMethod.adults, 0);
  assert.ok(kobe.byMethod.general > 0, "children do share general costs");
  const adults = finance.categories.find(category => category.method === "adults");
  assert.equal(adults.familyUnits, 2);
  assert.equal(adults.totalUnits, 3);
});

test("member amounts add up exactly to the family share and match the existing engine", () => {
  const finance = getFamilyFinanceBreakdown(familyA, registrations, expenses, payments);
  const memberTotal = finance.members.reduce((sum, member) => sum + member.totalCents, 0);
  assert.equal(memberTotal, finance.totals.shareCents);
  const engine = getFinancialSummary(registrations, expenses, payments).find(row => row.id === "a");
  assert.equal(finance.totals.shareCents, engine.shareCents);
  assert.equal(finance.totals.remainingCents, engine.remainingCents);
  const legacyMembers = getMemberCostSummary(familyA, registrations, expenses);
  assert.deepEqual(finance.members.map(member => member.totalCents), legacyMembers.map(member => member.cents));
  const categorySum = finance.categories.reduce((sum, category) => sum + category.familyCents, 0);
  assert.equal(categorySum, finance.totals.shareCents);
});

test("settlement: share minus advanced minus paid gives the amount still due", () => {
  const t = getFamilyFinanceBreakdown(familyA, registrations, expenses, payments).totals;
  assert.equal(t.advancedCents, 10000);
  assert.equal(t.paidCents, 1000);
  assert.equal(t.remainingCents, Math.max(0, t.shareCents - t.advancedCents - t.paidCents));
  assert.equal(t.creditCents, 0);
});

test("a family that advanced more than its share gets a credit", () => {
  const t = getFamilyFinanceBreakdown(familyB, registrations, expenses, payments).totals;
  assert.equal(t.remainingCents, 0);
  assert.equal(t.creditCents, t.advancedCents - t.shareCents);
  assert.ok(t.creditCents > 0);
});

test("breakdown never exposes other families' names or payments", () => {
  const finance = getFamilyFinanceBreakdown(familyA, registrations, expenses, payments.concat({ id: "pay2", registrationId: "b", amountCents: 5, method: "cash" }));
  const text = JSON.stringify(finance);
  assert.ok(!text.includes("Familie B") && !text.includes("Piet"));
  assert.deepEqual(finance.payments.map(payment => payment.id), ["pay1"]);
  assert.ok(!("advancedBy" in finance.expenses[0]));
});

test("no expenses yields an empty but valid breakdown", () => {
  const finance = getFamilyFinanceBreakdown(familyA, registrations, [], []);
  assert.equal(finance.expenses.length, 0);
  assert.equal(finance.totals.shareCents, 0);
  assert.equal(finance.totals.remainingCents, 0);
});

// ---- Route: GET /api/family-account/session returns the family's own finance ----

const sha256 = async value => Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).toString("hex");
const deps = {
  json: (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } }),
  sameOrigin: () => true,
  cookieValue: (request, name) => (request.headers.get("Cookie") || "").split(/;\s*/).map(part => part.split("=")).find(([key]) => key === name)?.[1] || "",
  sha256,
  base64Url: bytes => Buffer.from(bytes).toString("base64url"),
  fromBase64Url: text => new Uint8Array(Buffer.from(text, "base64url")),
  sendGraphMail: async () => {}
};

test("family session includes a finance breakdown limited to the own registration", async () => {
  const DB = createD1();
  const db = DB.raw;
  const now = Math.floor(Date.now() / 1000);
  db.prepare("INSERT INTO events (id, slug, name, finance_strategy, created_at, updated_at) VALUES ('ev', 'nieuwjaar', 'Nieuwjaar', 'nieuwjaar', 1, 1)").run();
  db.prepare("INSERT INTO event_editions (id, event_id, label, status, config_json, created_at, updated_at) VALUES ('ed', 'ev', '2026–2027', 'open', ?, 1, 1)").run(JSON.stringify({ catalog: [{ id: "p1", name: "Biefstuk", active: true }] }));
  db.prepare("INSERT INTO edition_finance_snapshots (edition_id, expenses_json, payments_json, created_at, updated_at) VALUES ('ed', ?, ?, 1, 1)").run(JSON.stringify(expenses), JSON.stringify(payments));
  for (const reg of registrations) {
    db.prepare("INSERT INTO families (id, display_name, created_at, updated_at) VALUES (?, ?, 1, 1)").run("f" + reg.id, reg.name);
    db.prepare("INSERT INTO event_registrations (id, edition_id, family_id, data_json, created_at, updated_at) VALUES (?, 'ed', ?, ?, 1, 1)").run(reg.id, "f" + reg.id, JSON.stringify({ name: reg.name, members: reg.members }));
  }
  db.prepare("INSERT INTO family_users (id, email, display_name, status, created_at, updated_at) VALUES ('u1', 'jan@example.be', 'Jan', 'active', 1, 1)").run();
  db.prepare("INSERT INTO family_user_sessions (user_id, token_hash, created_at, expires_at) VALUES ('u1', ?, ?, ?)").run(await sha256("tok"), now, now + 3600);
  db.prepare("INSERT INTO family_memberships (id, family_id, user_id, role, created_at) VALUES ('m1', 'fa', 'u1', 'owner', 1)").run();

  const url = new URL("https://nieuwjaar.datuur.be/api/family-account/session");
  const response = await handleFamilyAccountApi(new Request(url, { headers: { Cookie: "ny_family_account=tok" } }), { DB }, url, deps);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.registrations.length, 1);
  const finance = body.registrations[0].finance;
  assert.equal(finance.finalized, false);
  assert.equal(finance.categories.find(category => category.method === "meat").familyCents, 4000);
  assert.ok(!JSON.stringify(body).includes("Piet"), "other families' members are not exposed");
});

test("a refund to a family that advanced too much reduces what it still gets back", () => {
  const before = getFamilyFinanceBreakdown(familyB, registrations, expenses, payments).totals;
  assert.ok(before.creditCents > 0);
  const refund = { id: "r1", registrationId: "b", amountCents: before.creditCents - 100, date: "2027-01-05", method: "bank", kind: "refund" };
  const after = getFamilyFinanceBreakdown(familyB, registrations, expenses, payments.concat(refund)).totals;
  assert.equal(after.refundedCents, before.creditCents - 100);
  assert.equal(after.creditCents, 100);
  assert.equal(after.paymentStatus, "Gedeeltelijk terugbetaald");
  const settled = getFinancialSummary(registrations, expenses, payments.concat({ ...refund, amountCents: before.creditCents })).find(row => row.id === "b");
  assert.equal(settled.creditCents, 0);
  assert.equal(settled.paymentStatus, "Terugbetaald");
  assert.equal(settled.paidCents, 0, "a refund is not counted as money paid in");
});

test("a cost paid from the shared kitty gives nobody an advance but is still shared", () => {
  const kitty = [{ id: "k1", description: "Zaal", amountCents: 9000, method: "general", advancedBy: "kas" }];
  const rows = getFinancialSummary(registrations, kitty, []);
  assert.equal(rows.reduce((sum, row) => sum + row.advancedCents, 0), 0);
  assert.equal(rows.reduce((sum, row) => sum + row.shareCents, 0), 9000);
  assert.equal(rows.reduce((sum, row) => sum + row.remainingCents, 0), 9000, "families owe the full amount to the kitty");
});

test("a personal bar bill is charged to that person only; bar purchases are not split", async () => {
  const { getFinancialSummary: summary } = await import("../src/utils/finance.js");
  const a = { id: "a", members: [{ id: "a1", name: "Jan", type: "Volwassene", orders: {}, barCents: 2100 }, { id: "a2", name: "Kobe", type: "Kind", orders: {}, barCents: 900 }] };
  const b = { id: "b", members: [{ id: "b1", name: "Piet", type: "Volwassene", orders: {} }] };
  const purchase = [{ id: "bar1", description: "Drank", amountCents: 5000, method: "bar", advancedBy: "b" }];
  const rows = summary([a, b], purchase, []);
  assert.equal(rows.find(r => r.id === "a").shareCents, 3000, "Jan 21 + Kobe 9");
  assert.equal(rows.find(r => r.id === "b").shareCents, 0, "the purchase is not split over anyone");
  assert.equal(rows.find(r => r.id === "b").creditCents, 5000, "whoever bought the drinks gets it back");
  const breakdown = getFamilyFinanceBreakdown(a, [a, b], purchase, []);
  assert.deepEqual(breakdown.members.map(m => m.byMethod.bar), [2100, 900]);
  assert.deepEqual(breakdown.members.map(m => m.totalCents), [2100, 900]);
  const bar = breakdown.categories.find(c => c.method === "bar");
  assert.equal(bar.personal, true);
  assert.equal(bar.familyCents, 3000);
  assert.deepEqual(bar.perMember.map(m => m.name), ["Jan", "Kobe"]);
  assert.equal(breakdown.expenses.length, 0, "family A does not see family B's bar purchase");
  assert.equal(getFamilyFinanceBreakdown(b, [a, b], purchase, []).expenses[0].notShared, true, "the buyer sees it in its own costs");
});
