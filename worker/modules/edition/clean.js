// Validation of what the admin sends: members, catalog, costs and payments.
import { withDiet } from "../../../src/utils/diet.js";
import { SHARED_FUND } from "../../../src/utils/finance.js";
import { isMemberType, EVENING } from "../../../src/utils/member-types.js";
import { parseReceiptKey } from "../receipts.js";
import { ID, PRODUCT_ID, METHODS } from "./common.js";

export function validName(value, max) {
  return typeof value === "string" && value.trim() && value.trim().length <= max ? value.trim() : null;
}

export function cleanMembers(members) {
  if (!Array.isArray(members) || members.length > 30) return null;
  const ids = new Set(),
    out = [];
  for (const person of members) {
    const name = validName(person?.name, 80);
    if (
      !person ||
      typeof person.id !== "string" ||
      !ID.test(person.id) ||
      ids.has(person.id) ||
      !name ||
      !isMemberType(person.type)
    )
      return null;
    ids.add(person.id);
    const orders = {};
    for (const [productId, qty] of Object.entries(
      person.orders && typeof person.orders === "object" && !Array.isArray(person.orders) ? person.orders : {}
    )) {
      const quantity = Number(qty);
      if (!PRODUCT_ID.test(productId) || !Number.isInteger(quantity) || quantity < 0 || quantity > 99) return null;
      if (person.type !== EVENING) orders[productId] = quantity; // evening guests do not order meat
    }
    // Personal bar bill in cents (entered by the organisation).
    const barCents = person.barCents == null ? 0 : Number(person.barCents);
    if (!Number.isSafeInteger(barCents) || barCents < 0 || barCents > 10_000_000) return null;
    const clean = withDiet(
      { id: person.id, name, type: person.type, orders, ...(barCents ? { barCents } : {}) },
      person
    );
    if (!clean) return null;
    out.push(clean);
  }
  return out;
}

export function cleanCatalog(catalog) {
  if (!Array.isArray(catalog) || catalog.length > 200) return null;
  const ids = new Set(),
    out = [];
  for (const raw of catalog) {
    const id = typeof raw?.id === "string" ? raw.id.trim() : "";
    const name = validName(raw?.name, 100);
    const image = typeof raw?.image === "string" ? raw.image.trim() : "";
    const safeImage = !image || (image.startsWith("/") && !image.startsWith("//") && !/[\s\\]/.test(image));
    if (!PRODUCT_ID.test(id) || ids.has(id) || !name || image.length > 1000 || !safeImage) return null;
    ids.add(id);
    out.push({ id, name, image: image || null, active: raw.active !== false });
  }
  return out;
}

export function cleanFinance(data, registrationIds) {
  if (
    !Array.isArray(data.expenses) ||
    data.expenses.length > 2000 ||
    !Array.isArray(data.payments) ||
    data.payments.length > 5000
  )
    return null;
  const expenseIds = new Set(),
    paymentIds = new Set(),
    expenses = [],
    payments = [];
  for (const item of data.expenses) {
    const description = validName(item?.description, 120);
    if (
      !item ||
      !ID.test(String(item.id)) ||
      expenseIds.has(item.id) ||
      !description ||
      !Number.isSafeInteger(item.amountCents) ||
      item.amountCents <= 0 ||
      typeof item.date !== "string" ||
      Number.isNaN(Date.parse(item.date)) ||
      !METHODS.includes(item.method) ||
      !(registrationIds.has(item.advancedBy) || item.advancedBy === SHARED_FUND)
    )
      return null;
    expenseIds.add(item.id);
    if (item.enteredBy != null && item.enteredBy !== "family") return null;
    if (item.receipt != null && !parseReceiptKey(item.receipt)) return null;
    expenses.push({
      id: item.id,
      description,
      amountCents: item.amountCents,
      date: item.date,
      method: item.method,
      advancedBy: item.advancedBy,
      ...(item.enteredBy === "family" ? { enteredBy: "family" } : {}),
      ...(item.receipt ? { receipt: item.receipt } : {})
    });
  }
  for (const item of data.payments) {
    if (
      !item ||
      !ID.test(String(item.id)) ||
      paymentIds.has(item.id) ||
      !registrationIds.has(item.registrationId) ||
      !Number.isSafeInteger(item.amountCents) ||
      item.amountCents <= 0 ||
      typeof item.date !== "string" ||
      Number.isNaN(Date.parse(item.date)) ||
      !["cash", "bank"].includes(item.method) ||
      (item.kind != null && !["payment", "refund"].includes(item.kind))
    )
      return null;
    paymentIds.add(item.id);
    payments.push({
      id: item.id,
      registrationId: item.registrationId,
      amountCents: item.amountCents,
      date: item.date,
      method: item.method,
      ...(item.kind === "refund" ? { kind: "refund" } : {}),
      // Moment of entry (seconds), set by the Kassa; used to list the latest cash payments.
      ...(Number.isInteger(item.at) && item.at > 0 ? { at: item.at } : {})
    });
  }
  return { expenses, payments };
}
