// Admin API for one event edition: routes only. The work is in ./edition/.
import { handleSettlementMail } from "./settlement-mail.js";
import { setCancelRequest } from "./edition/cancel-requests.js";
import { listActivity } from "./activity.js";
import { loadEditionState, editionVersion, startNextEdition } from "./edition/load.js";
import { saveEditionState } from "./edition/save.js";
import { validName } from "./edition/clean.js";
import { messageRecipients, messageHtml, butcherOrder, butcherMailHtml } from "./edition/mail.js";
export { loadEditionState, startNextEdition } from "./edition/load.js";
export { saveEditionState } from "./edition/save.js";
export { messageRecipients, messageHtml } from "./edition/mail.js";

export async function handleAdminEditionState(request, env, url, { json, sameOrigin, adminSession, sendGraphMail }) {
  if (!env.DB) return json({ error: "Database niet geconfigureerd." }, 503);
  if (!(await adminSession(request, env))) return json({ error: "Niet aangemeld." }, 401);
  if (request.method !== "GET" && !sameOrigin(request)) return json({ error: "Ongeldige aanvraag." }, 403);
  const match = url.pathname.match(
    /^\/api\/admin\/editions\/([A-Za-z0-9_-]+)\/(state|version|next|message|butcher|settlement|cancel-request|activity)$/
  );
  if (!match) return null;
  const [, editionId, action] = match;
  const now = Math.floor(Date.now() / 1000);
  if (action === "state" && request.method === "GET") {
    const state = await loadEditionState(env, editionId);
    return state ? json(state) : json({ error: "Editie niet gevonden." }, 404);
  }
  if (action === "version" && request.method === "GET") {
    const version = await editionVersion(env, editionId);
    return version ? json({ version }) : json({ error: "Editie niet gevonden." }, 404);
  }
  if (action === "state" && request.method === "PUT") {
    const body = await request.json().catch(() => null);
    const result = await saveEditionState(env, editionId, body, now);
    return result.status === 200
      ? json({ saved: true, unchanged: Boolean(result.unchanged), state: result.state })
      : json({ error: result.error, conflict: Boolean(result.conflict) }, result.status);
  }
  if (action === "message" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    const subject = validName(body?.subject, 150),
      message = typeof body?.message === "string" ? body.message.trim() : "";
    const audience = body?.audience === "no-order" ? "no-order" : "all";
    if (!subject || !message || message.length > 5000)
      return json({ error: "Vul een onderwerp en een bericht in (maximaal 5000 tekens)." }, 400);
    const edition = await env.DB.prepare(
      "SELECT d.label, e.name FROM event_editions d JOIN events e ON e.id = d.event_id WHERE d.id = ?"
    )
      .bind(editionId)
      .first();
    if (!edition) return json({ error: "Editie niet gevonden." }, 404);
    const recipients = await messageRecipients(env, editionId, audience);
    if (!recipients.length)
      return json({ error: "Er zijn geen ontvangers: geen enkel gezin met een account voldoet aan je keuze." }, 400);
    if (recipients.length > 300) return json({ error: "Te veel ontvangers in één keer." }, 400);
    const eventTitle = edition.name + " " + edition.label;
    let sent = 0;
    const failed = [];
    for (const recipient of recipients) {
      try {
        await sendGraphMail(
          env,
          recipient.email,
          subject,
          messageHtml({ displayName: recipient.display_name, subject, message, eventTitle })
        );
        sent++;
      } catch (error) {
        console.error("Message to family failed:", recipient.email, error?.message);
        failed.push(recipient.email);
      }
    }
    return json({ sent, failed }, failed.length && !sent ? 502 : 200);
  }

  // The organisation has decided on a family's request to cancel: the request is removed.
  if (action === "cancel-request" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    if (typeof body?.registrationId !== "string") return json({ error: "Ongeldige aanvraag." }, 400);
    await setCancelRequest(env, editionId, body.registrationId, null);
    return json({ removed: true });
  }
  if (action === "activity" && request.method === "GET") return json({ entries: await listActivity(env, editionId) });
  if (action === "settlement" && request.method === "POST")
    return handleSettlementMail(request, env, editionId, { json, sendGraphMail, now });
  if (action === "butcher" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    const recipient = typeof body?.recipient === "string" ? body.recipient.trim().toLowerCase() : "";
    const note = typeof body?.note === "string" ? body.note.trim() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) || recipient.length > 254)
      return json({ error: "Vul een geldig e-mailadres van de slager in." }, 400);
    if (note.length > 2000) return json({ error: "Het bericht mag maximaal 2000 tekens bevatten." }, 400);
    const order = await butcherOrder(env, editionId);
    if (!order) return json({ error: "Editie niet gevonden." }, 404);
    if (!order.total) return json({ error: "Er is nog niets besteld." }, 400);
    try {
      await sendGraphMail(env, recipient, "Bestelling " + order.eventTitle, butcherMailHtml({ ...order, note }));
    } catch (error) {
      console.error("Butcher mail failed:", error?.message);
      return json({ error: error?.message || "De mail kon niet worden verstuurd." }, 502);
    }
    // Remember the address and the moment (not part of the edition's revision: no save conflicts).
    const config = { ...order.config, butcherEmail: recipient, butcherSentAt: now };
    await env.DB.prepare("UPDATE event_editions SET config_json = ? WHERE id = ?")
      .bind(JSON.stringify(config), editionId)
      .run();
    return json({ sent: true, total: order.total, lines: order.lines, sentAt: now });
  }

  if (action === "next" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    const result = await startNextEdition(env, editionId, body, now);
    return result.status === 201
      ? json({ created: true, editionId: result.editionId }, 201)
      : json({ error: result.error }, result.status);
  }
  return json({ error: "Niet gevonden." }, 404);
}
