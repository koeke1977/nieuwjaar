// Costs a family advanced itself, and their receipts. A family may add costs and change or delete only
// the costs it entered; the organisation can change everything in the admin.
import { getExpenseShares } from "../../../src/utils/finance.js";
import { storeReceipt, receiptExists, deleteReceipt, streamReceipt, parseReceiptKey } from "../receipts.js";
import { familyAccountSession } from "./session.js";
import { euro } from "../../../src/utils/html.js";
import { logActivity } from "../activity.js";

// The registration of the signed-in user, if their family owns it.
async function ownRegistration(env, userId, registrationId, editionId) {
  return env.DB.prepare(
    "SELECT er.id, er.family_id, f.display_name AS family_name, d.status AS edition_status, fm.role FROM event_registrations er JOIN event_editions d ON d.id = er.edition_id JOIN families f ON f.id = er.family_id JOIN family_memberships fm ON fm.family_id = er.family_id WHERE er.id = ? AND er.edition_id = ? AND er.status = 'active' AND fm.user_id = ?"
  )
    .bind(registrationId, editionId, userId)
    .first();
}

export async function uploadReceipt({ request, env, json, sameOrigin, cookieValue, sha256 }) {
  if (!sameOrigin(request)) return json({ error: "Ongeldige aanvraag." }, 403);
  const session = await familyAccountSession(request, env, cookieValue, sha256);
  if (!session) return json({ error: "Je sessie is verlopen. Meld je opnieuw aan." }, 401);
  if (!env.PHOTOS) return json({ error: "Opslag niet beschikbaar." }, 503);
  const form = await request.formData().catch(() => null);
  const editionId = String(form?.get("edition") || ""),
    registrationId = String(form?.get("registrationId") || "");
  const own = await ownRegistration(env, session.user_id, registrationId, editionId);
  if (!own || own.role === "viewer" || own.edition_status === "archived")
    return json({ error: "Je kan voor deze inschrijving geen kasticket toevoegen." }, 403);
  const stored = await storeReceipt(env, form.get("file"), editionId, registrationId);
  return stored.error ? json({ error: stored.error }, 400) : json({ receipt: stored.key }, 201);
}

export async function readReceipt({ request, env, url, json, cookieValue, sha256 }) {
  const session = await familyAccountSession(request, env, cookieValue, sha256);
  if (!session) return json({ error: "Je sessie is verlopen. Meld je opnieuw aan." }, 401);
  const key = url.searchParams.get("key") || "";
  const parsed = parseReceiptKey(key);
  if (!parsed || !(await ownRegistration(env, session.user_id, parsed.registrationId, parsed.editionId)))
    return json({ error: "Niet gevonden." }, 404);
  return (await streamReceipt(env, key)) || json({ error: "Niet gevonden." }, 404);
}

export async function saveOrDeleteExpense({ request, env, now, json, sameOrigin, cookieValue, sha256 }) {
  if (!sameOrigin(request)) return json({ error: "Ongeldige aanvraag." }, 403);
  const session = await familyAccountSession(request, env, cookieValue, sha256);
  if (!session) return json({ error: "Je sessie is verlopen. Meld je opnieuw aan." }, 401);
  const body = await request.json().catch(() => null);
  const editionId = typeof body?.edition === "string" ? body.edition : "";
  const registrationId = typeof body?.registrationId === "string" ? body.registrationId : "";
  const own = await ownRegistration(env, session.user_id, registrationId, editionId);
  if (!own) return json({ error: "Deze inschrijving is niet aan je account gekoppeld." }, 403);
  if (own.role === "viewer") return json({ error: "Je hebt alleen leesrechten voor deze inschrijving." }, 403);
  if (own.edition_status === "archived") return json({ error: "Deze editie is afgesloten." }, 409);

  let input = null;
  if (request.method === "POST") {
    const raw = body?.expense || {};
    const description = typeof raw.description === "string" ? raw.description.trim() : "";
    const amountCents = Number(raw.amountCents);
    if (
      !description ||
      description.length > 120 ||
      !Number.isSafeInteger(amountCents) ||
      amountCents <= 0 ||
      amountCents > 10_000_000 ||
      typeof raw.date !== "string" ||
      Number.isNaN(Date.parse(raw.date)) ||
      !["general", "adults", "meat", "bar"].includes(raw.method)
    ) {
      return json({ error: "Controleer de omschrijving, het bedrag, de datum en de soort kost." }, 400);
    }
    input = {
      id: typeof raw.id === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(raw.id) ? raw.id : null,
      description,
      amountCents,
      date: raw.date.slice(0, 10),
      method: raw.method,
      receipt: null
    };
    if (raw.receipt) {
      const parsed = parseReceiptKey(raw.receipt);
      if (
        !parsed ||
        parsed.editionId !== editionId ||
        parsed.registrationId !== registrationId ||
        !(await receiptExists(env, raw.receipt))
      ) {
        return json({ error: "Het kasticket kon niet worden gevonden. Voeg het opnieuw toe." }, 400);
      }
      input.receipt = raw.receipt;
    }
  }
  const expenseId =
    request.method === "DELETE" ? (typeof body?.expenseId === "string" ? body.expenseId : "") : input.id;

  for (let attempt = 0; attempt < 4; attempt++) {
    let snapshot = await env.DB.prepare(
      "SELECT expenses_json, updated_at FROM edition_finance_snapshots WHERE edition_id = ?"
    )
      .bind(editionId)
      .first();
    if (!snapshot) {
      await env.DB.prepare(
        "INSERT INTO edition_finance_snapshots (edition_id, created_at, updated_at) VALUES (?, ?, ?) ON CONFLICT(edition_id) DO NOTHING"
      )
        .bind(editionId, now, now)
        .run();
      continue;
    }
    let expenses;
    try {
      expenses = JSON.parse(snapshot.expenses_json || "[]");
    } catch {
      return json({ error: "De kosten van deze editie zijn ongeldig." }, 500);
    }
    const index = expenseId ? expenses.findIndex(item => item.id === expenseId) : -1;
    if (expenseId && index < 0) return json({ error: "Deze kost bestaat niet meer." }, 404);
    if (index >= 0 && !(expenses[index].enteredBy === "family" && expenses[index].advancedBy === registrationId)) {
      return json({ error: "Deze kost werd door de organisatie ingevoerd. Vraag hen om hem aan te passen." }, 403);
    }
    let obsoleteReceipt = null;
    let activity = "";
    if (request.method === "DELETE") {
      obsoleteReceipt = expenses[index].receipt || null;
      activity = "Kost verwijderd: " + expenses[index].description + " " + euro(expenses[index].amountCents);
      expenses.splice(index, 1);
    } else {
      const receipt = input.receipt || (index >= 0 ? expenses[index].receipt : null);
      if (!receipt)
        return json(
          {
            error: "Voeg een foto van het kasticket toe. Zonder kasticket kan een kost niet worden ingediend.",
            needsReceipt: true
          },
          400
        );
      if (index >= 0 && expenses[index].receipt && expenses[index].receipt !== receipt)
        obsoleteReceipt = expenses[index].receipt;
      const expense = {
        id: input.id || "kost-" + crypto.randomUUID(),
        description: input.description,
        amountCents: input.amountCents,
        date: input.date,
        method: input.method,
        advancedBy: registrationId,
        enteredBy: "family",
        receipt
      };
      // The cost must be divisible: e.g. a meat cost needs ordered portions.
      const rows = await env.DB.prepare(
        "SELECT id, data_json FROM event_registrations WHERE edition_id = ? AND status = 'active'"
      )
        .bind(editionId)
        .all();
      const registrations = (rows.results || []).map(row => {
        let data = {};
        try {
          data = JSON.parse(row.data_json || "{}");
        } catch {
          /* empty */
        }
        return {
          id: row.id,
          members: Array.isArray(data.members) ? data.members : [],
          adults: data.adults,
          children: data.children
        };
      });
      try {
        if (expense.method !== "bar") getExpenseShares(expense, registrations, { strict: true });
      } catch (error) {
        return json({ error: error.message || "Deze kost kan nog niet verdeeld worden." }, 400);
      }
      activity =
        (index >= 0 ? "Kost gewijzigd: " : "Kost toegevoegd: ") +
        expense.description +
        " " +
        euro(expense.amountCents) +
        " (met kasticket)";
      if (index >= 0) expenses[index] = expense;
      else expenses.push(expense);
    }
    const result = await env.DB.prepare(
      "UPDATE edition_finance_snapshots SET expenses_json = ?, costs_finalized = 0, costs_finalized_at = NULL, updated_at = ? WHERE edition_id = ? AND updated_at = ?"
    )
      .bind(JSON.stringify(expenses), Math.max(now, Number(snapshot.updated_at) + 1), editionId, snapshot.updated_at)
      .run();
    if (Number(result?.meta?.changes ?? 0)) {
      await logActivity(env, {
        now,
        editionId,
        familyId: own.family_id,
        registrationId,
        familyName: own.family_name,
        actorId: session.user_id,
        actor: session.display_name || "",
        type: "cost",
        summary: activity
      });
      if (obsoleteReceipt) await deleteReceipt(env, obsoleteReceipt);
      return json({ saved: true });
    }
  }
  return json({ error: "Het is momenteel erg druk. Probeer het over enkele seconden opnieuw." }, 409);
}
