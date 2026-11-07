// Afrekening per gezin per e-mail: every family's own statement (same calculation as the
// portal), sent to the family's accounts. POST /api/admin/editions/:id/settlement
//   { audience: "all" | "due" | "credit", note, testRecipient? }
// With testRecipient only one statement (the first family of the audience) goes to that address.
import { getFamilyFinanceBreakdown } from "../../src/utils/finance.js";
import { esc, euro } from "../../src/utils/html.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const parse = (json, fallback) => {
  try {
    return JSON.parse(json || "") ?? fallback;
  } catch {
    return fallback;
  }
};

// All families of the edition with their statement and the accounts that receive it.
export async function settlementStatements(env, editionId) {
  const edition = await env.DB.prepare(
    "SELECT d.label, d.config_json, e.name FROM event_editions d JOIN events e ON e.id = d.event_id WHERE d.id = ?"
  )
    .bind(editionId)
    .first();
  if (!edition) return null;
  const [rows, snapshot] = await Promise.all([
    env.DB.prepare(
      "SELECT id, family_id, data_json FROM event_registrations WHERE edition_id = ? AND status = 'active' ORDER BY created_at, id"
    )
      .bind(editionId)
      .all(),
    env.DB.prepare(
      "SELECT expenses_json, payments_json, costs_finalized FROM edition_finance_snapshots WHERE edition_id = ?"
    )
      .bind(editionId)
      .first()
  ]);
  const registrations = (rows.results || []).map(row => {
    const data = parse(row.data_json, {}) || {};
    return {
      id: row.id,
      familyId: row.family_id,
      name: String(data.name || "Gezin"),
      members: Array.isArray(data.members) ? data.members : []
    };
  });
  const expenses = parse(snapshot?.expenses_json, []) || [];
  const payments = parse(snapshot?.payments_json, []) || [];
  const familyIds = registrations.map(reg => reg.familyId);
  const accounts = familyIds.length
    ? (
        await env.DB.prepare(
          "SELECT fm.family_id, u.email, u.display_name FROM family_memberships fm JOIN family_users u ON u.id = fm.user_id WHERE u.status IN ('active', 'invited') AND fm.family_id IN (" +
            familyIds.map(() => "?").join(",") +
            ") ORDER BY u.email"
        )
          .bind(...familyIds)
          .all()
      ).results || []
    : [];
  return {
    config: parse(edition.config_json, {}) || {},
    eventTitle: edition.name + " " + edition.label,
    finalized: Boolean(snapshot?.costs_finalized),
    families: registrations.map(reg => ({
      registration: reg,
      finance: getFamilyFinanceBreakdown(reg, registrations, expenses, payments),
      recipients: accounts.filter(account => account.family_id === reg.familyId)
    }))
  };
}

const AUDIENCES = {
  all: () => true,
  due: finance => finance.totals.remainingCents > 0,
  credit: finance => finance.totals.creditCents > 0
};

// Nothing to report for a family without any share, advance, payment or refund.
const hasStatement = finance =>
  ["shareCents", "advancedCents", "paidCents", "refundedCents"].some(key => finance.totals[key]);

export function settlementHtml({ displayName, familyName, eventTitle, finance, finalized, note }) {
  const cell = "padding:7px 10px;border-bottom:1px solid #e6e1d8";
  const row = (label, amount, extra = "") =>
    '<tr><td style="' +
    cell +
    extra +
    '">' +
    label +
    '</td><td style="' +
    cell +
    extra +
    ';text-align:right;white-space:nowrap">' +
    amount +
    "</td></tr>";
  const t = finance.totals;
  const lines = finance.categories
    .map(category =>
      row(
        esc(category.label) +
          (category.personal && category.perMember?.length
            ? '<br><small style="color:#6b7688">' +
              category.perMember.map(member => esc(member.name) + " " + esc(euro(member.cents))).join(" · ") +
              "</small>"
            : ""),
        esc(euro(category.familyCents))
      )
    )
    .join("");
  const bold = ";font-weight:700";
  const result =
    t.remainingCents > 0
      ? row("Nog te betalen", esc(euro(t.remainingCents)), bold + ";color:#a4421f")
      : t.creditCents > 0
        ? row("Jullie krijgen terug", esc(euro(t.creditCents)), bold + ";color:#1f7a4d")
        : row("Alles is in orde", esc(euro(0)), bold + ";color:#1f7a4d");
  const noteHtml = note
    ? note
        .replace(/\r\n/g, "\n")
        .split(/\n{2,}/)
        .map(block => "<p>" + esc(block).replace(/\n/g, "<br>") + "</p>")
        .join("")
    : "";
  return (
    '<div style="font-family:Arial,sans-serif;color:#1b2a3b;line-height:1.6;max-width:560px">' +
    '<p style="color:#b18a3d;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;margin:0 0 8px">' +
    esc(eventTitle) +
    "</p>" +
    '<h2 style="margin:0 0 16px">' +
    (finalized ? "Afrekening" : "Voorlopige afrekening") +
    " voor " +
    esc(familyName) +
    "</h2><p>Dag " +
    esc(displayName || "") +
    ",</p><p>" +
    (finalized
      ? "Alle kosten zijn binnen. Hieronder vind je wat jullie gezin betaalt."
      : "Nog niet alle kosten zijn binnen: dit is een voorlopig overzicht, de bedragen kunnen nog wijzigen.") +
    '</p><table style="border-collapse:collapse;width:100%;max-width:460px;margin:8px 0 16px">' +
    lines +
    row("Jullie aandeel", esc(euro(t.shareCents)), bold) +
    (t.advancedCents ? row("Min: door jullie voorgeschoten", "− " + esc(euro(t.advancedCents))) : "") +
    (t.paidCents ? row("Min: al betaald", "− " + esc(euro(t.paidCents))) : "") +
    (t.refundedCents ? row("Al terugbetaald aan jullie", esc(euro(t.refundedCents))) : "") +
    result +
    "</table>" +
    noteHtml +
    '<p style="margin:24px 0"><a href="https://nieuwjaar.datuur.be/familie" style="display:inline-block;padding:12px 20px;border-radius:10px;background:#14263b;color:#fff;font-weight:700;text-decoration:none">Details in het familieportaal</a></p>' +
    "<p>Groeten,<br>De organisatie van " +
    esc(eventTitle) +
    "</p></div>"
  );
}

export async function handleSettlementMail(request, env, editionId, { json, sendGraphMail, now }) {
  const body = await request.json().catch(() => null);
  const audience = Object.hasOwn(AUDIENCES, body?.audience) ? body.audience : "all";
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  const testRecipient = typeof body?.testRecipient === "string" ? body.testRecipient.trim().toLowerCase() : "";
  if (note.length > 3000) return json({ error: "Het bericht mag maximaal 3000 tekens bevatten." }, 400);
  if (testRecipient && (!EMAIL.test(testRecipient) || testRecipient.length > 254))
    return json({ error: "Vul een geldig e-mailadres in voor de proefmail." }, 400);
  const data = await settlementStatements(env, editionId);
  if (!data) return json({ error: "Editie niet gevonden." }, 404);
  const families = data.families.filter(family => hasStatement(family.finance) && AUDIENCES[audience](family.finance));
  if (!families.length) return json({ error: "Geen enkel gezin voldoet aan je keuze." }, 400);
  const subjectFor = family =>
    (data.finalized ? "Afrekening " : "Voorlopige afrekening ") + data.eventTitle + " – " + family.registration.name;
  const mail = (family, displayName) =>
    settlementHtml({
      displayName,
      familyName: family.registration.name,
      eventTitle: data.eventTitle,
      finance: family.finance,
      finalized: data.finalized,
      note
    });

  if (testRecipient) {
    const family = families.find(item => item.recipients.length) || families[0];
    try {
      await sendGraphMail(
        env,
        testRecipient,
        "[Proef] " + subjectFor(family),
        mail(family, family.recipients[0]?.display_name)
      );
    } catch (error) {
      return json({ error: error?.message || "De proefmail kon niet worden verstuurd." }, 502);
    }
    return json({ test: true, family: family.registration.name });
  }

  const withoutAccount = families.filter(family => !family.recipients.length).map(family => family.registration.name);
  const total = families.reduce((sum, family) => sum + family.recipients.length, 0);
  if (!total) return json({ error: "Geen van deze gezinnen heeft een account met een e-mailadres." }, 400);
  if (total > 300) return json({ error: "Te veel ontvangers in één keer." }, 400);
  let sent = 0;
  const failed = [];
  for (const family of families) {
    for (const recipient of family.recipients) {
      try {
        await sendGraphMail(env, recipient.email, subjectFor(family), mail(family, recipient.display_name));
        sent++;
      } catch (error) {
        console.error("Settlement mail failed:", recipient.email, error?.message);
        failed.push(recipient.email);
      }
    }
  }
  // Remember when it was sent (outside the edition's revision: no save conflicts).
  if (sent) {
    const config = { ...data.config, settlementSentAt: now };
    await env.DB.prepare("UPDATE event_editions SET config_json = ? WHERE id = ?")
      .bind(JSON.stringify(config), editionId)
      .run();
  }
  return json(
    { sent, failed, families: families.length - withoutAccount.length, withoutAccount, sentAt: sent ? now : null },
    failed.length && !sent ? 502 : 200
  );
}
