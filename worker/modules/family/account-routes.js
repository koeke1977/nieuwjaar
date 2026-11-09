// A family's own account: change password or e-mail address, see and invite who has access.
import { esc } from "../../../src/utils/html.js";
import {
  hashPassword,
  verifyFamilyPassword,
  familyLoginLimit,
  familyResetLimit,
  familyAccountSession,
  unlockFamilyEmail
} from "./session.js";
import { inviteToFamily } from "./invite.js";
import { logActivity } from "../activity.js";

const encoder = new TextEncoder();
const EXPIRED = "Je sessie is verlopen. Meld je opnieuw aan.";
const EMAIL_LINK_SECONDS = 60 * 60;
const MAX_ACCOUNTS_PER_FAMILY = 6;
const validEmail = value => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const mailHtml = (title, text) =>
  '<div style="font-family:Arial,sans-serif;color:#242424;line-height:1.6"><h2>' + title + "</h2>" + text + "</div>";
const clientIp = request => request.headers.get("CF-Connecting-IP") || "unknown";

// Checks the current password; wrong attempts count towards the login limit of this address.
async function checkPassword(env, session, password, request, { now, json, sha256, base64Url, fromBase64Url }) {
  const limiter = await familyLoginLimit(env, session.email.toLowerCase(), clientIp(request), sha256, now);
  if (limiter.blocked)
    return { refused: json({ error: "Te veel pogingen. Probeer over 15 minuten opnieuw." }, 429), limiter };
  const user = await env.DB.prepare("SELECT password_hash FROM family_users WHERE id = ?")
    .bind(session.user_id)
    .first();
  const valid =
    typeof password === "string" &&
    password.length <= 1024 &&
    user?.password_hash &&
    (await verifyFamilyPassword(password, user.password_hash, base64Url, fromBase64Url));
  if (!valid) {
    await limiter.recordFailure();
    return { refused: json({ error: "Je huidige wachtwoord is niet correct." }, 403), limiter };
  }
  return { limiter, passwordHash: user.password_hash };
}

export async function accountInfo({ request, env, json, cookieValue, sha256 }) {
  const session = await familyAccountSession(request, env, cookieValue, sha256);
  if (!session) return json({ error: EXPIRED }, 401);
  const own = await env.DB.prepare(
    "SELECT fm.family_id, fm.role, f.display_name FROM family_memberships fm JOIN families f ON f.id = fm.family_id WHERE fm.user_id = ? ORDER BY f.display_name"
  )
    .bind(session.user_id)
    .all();
  const families = [];
  for (const row of own.results || []) {
    const people = await env.DB.prepare(
      "SELECT u.id, u.display_name, u.email, u.status, fm.role FROM family_memberships fm JOIN family_users u ON u.id = fm.user_id WHERE fm.family_id = ? ORDER BY fm.created_at"
    )
      .bind(row.family_id)
      .all();
    families.push({
      id: row.family_id,
      name: row.display_name,
      role: row.role,
      people: (people.results || []).map(person => ({
        id: person.id,
        name: person.display_name,
        email: person.email,
        status: person.status,
        role: person.role,
        me: person.id === session.user_id
      }))
    });
  }
  return json({ families });
}

export async function changeName({ request, env, now, json, sameOrigin, cookieValue, sha256 }) {
  if (!sameOrigin(request)) return json({ error: "Ongeldige aanvraag." }, 403);
  const session = await familyAccountSession(request, env, cookieValue, sha256);
  if (!session) return json({ error: EXPIRED }, 401);
  const body = await request.json().catch(() => null);
  const displayName = typeof body?.displayName === "string" ? body.displayName.trim() : "";
  if (!displayName || displayName.length > 100) return json({ error: "Vul een naam in van maximaal 100 tekens." }, 400);
  await env.DB.prepare("UPDATE family_users SET display_name = ?, updated_at = ? WHERE id = ?")
    .bind(displayName, now, session.user_id)
    .run();
  return json({ changed: true, displayName });
}

export async function changePassword(context) {
  const { request, env, now, json, sameOrigin, cookieValue, sha256, base64Url, sendGraphMail } = context;
  if (!sameOrigin(request)) return json({ error: "Ongeldige aanvraag." }, 403);
  const session = await familyAccountSession(request, env, cookieValue, sha256);
  if (!session) return json({ error: EXPIRED }, 401);
  const body = await request.json().catch(() => null);
  const next = typeof body?.newPassword === "string" ? body.newPassword : "";
  if (next.length < 12 || next.length > 1024)
    return json({ error: "Kies een nieuw wachtwoord van minstens 12 tekens." }, 400);
  const check = await checkPassword(env, session, body?.currentPassword, request, context);
  if (check.refused) return check.refused;
  const passwordHash = await hashPassword(next, base64Url);
  await env.DB.batch([
    env.DB.prepare("UPDATE family_users SET password_hash = ?, updated_at = ? WHERE id = ?").bind(
      passwordHash,
      now,
      session.user_id
    ),
    // Everywhere else is signed out; this device stays signed in.
    env.DB.prepare(
      "UPDATE family_user_sessions SET revoked_at = ? WHERE user_id = ? AND id != ? AND revoked_at IS NULL"
    ).bind(now, session.user_id, session.session_id)
  ]);
  await check.limiter.clearEmail();
  try {
    await sendGraphMail(
      env,
      session.email,
      "Je wachtwoord is gewijzigd",
      mailHtml(
        "Je wachtwoord is gewijzigd",
        "<p>Het wachtwoord van je account in het familieportaal is zonet gewijzigd. Was jij dit niet? Neem dan meteen contact op met de organisatie.</p>"
      )
    );
  } catch (error) {
    console.error("Password change notice failed:", error?.message);
  }
  return json({ changed: true });
}

// The link in the mail is signed with the current password hash: no storage needed, and it stops
// working after a password change or once the address has changed.
const signingKey = passwordHash =>
  crypto.subtle.importKey("raw", encoder.encode(passwordHash), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify"
  ]);

export async function changeEmail(context) {
  const { request, env, now, json, sameOrigin, cookieValue, sha256, base64Url, sendGraphMail } = context;
  if (!sameOrigin(request)) return json({ error: "Ongeldige aanvraag." }, 403);
  const session = await familyAccountSession(request, env, cookieValue, sha256);
  if (!session) return json({ error: EXPIRED }, 401);
  const body = await request.json().catch(() => null);
  const email = typeof body?.newEmail === "string" ? body.newEmail.trim().toLowerCase() : "";
  if (!validEmail(email)) return json({ error: "Vul een geldig nieuw e-mailadres in." }, 400);
  if (email === session.email.toLowerCase()) return json({ error: "Dit is al je e-mailadres." }, 400);
  const check = await checkPassword(env, session, body?.password, request, context);
  if (check.refused) return check.refused;
  const taken = await env.DB.prepare("SELECT 1 FROM family_users WHERE email = ?").bind(email).first();
  if (taken) return json({ error: "Dit e-mailadres is al in gebruik." }, 409);
  const limit = await familyResetLimit(env, email, clientIp(request), sha256, now);
  if (limit.blocked) return json({ error: "Te veel aanvragen. Probeer het over een uur opnieuw." }, 429);
  await limit.record();
  const payload = base64Url(
    encoder.encode(
      JSON.stringify({ u: session.user_id, o: session.email.toLowerCase(), n: email, e: now + EMAIL_LINK_SECONDS })
    )
  );
  const signature = await crypto.subtle.sign("HMAC", await signingKey(check.passwordHash), encoder.encode(payload));
  const link =
    "https://nieuwjaar.datuur.be/familie/email-bevestigen/" + payload + "." + base64Url(new Uint8Array(signature));
  try {
    await sendGraphMail(
      env,
      email,
      "Bevestig je nieuwe e-mailadres",
      mailHtml(
        "Bevestig je nieuwe e-mailadres",
        '<p>Klik om dit adres te gebruiken voor je account in het familieportaal:</p><p><a href="' +
          link +
          '">E-mailadres bevestigen</a></p><p>Deze link is 1 uur geldig. Heb je dit niet aangevraagd? Dan mag je deze e-mail negeren.</p>'
      )
    );
  } catch (error) {
    console.error("E-mail change mail failed:", error?.message);
    return json({ error: "De bevestigingsmail kon niet worden verzonden." }, 502);
  }
  return json({ sent: true });
}

export async function confirmEmail({ request, env, now, json, sameOrigin, fromBase64Url, sha256, sendGraphMail }) {
  if (!sameOrigin(request)) return json({ error: "Ongeldige aanvraag." }, 403);
  const invalid = () => json({ error: "Deze bevestigingslink is ongeldig of verlopen." }, 400);
  const body = await request.json().catch(() => null);
  const [payload, signature, extra] = String(body?.token || "").split(".");
  if (!payload || !signature || extra !== undefined || payload.length > 1000) return invalid();
  let claim, signatureBytes;
  try {
    claim = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
    signatureBytes = fromBase64Url(signature);
  } catch {
    return invalid();
  }
  if (typeof claim?.u !== "string" || typeof claim.n !== "string" || !(claim.e > now)) return invalid();
  const user = await env.DB.prepare("SELECT email, password_hash, status FROM family_users WHERE id = ?")
    .bind(claim.u)
    .first();
  if (!user?.password_hash || user.status !== "active" || user.email.toLowerCase() !== claim.o) return invalid();
  const genuine = await crypto.subtle.verify(
    "HMAC",
    await signingKey(user.password_hash),
    signatureBytes,
    encoder.encode(payload)
  );
  if (!genuine) return invalid();
  try {
    await env.DB.prepare("UPDATE family_users SET email = ?, updated_at = ? WHERE id = ?")
      .bind(claim.n, now, claim.u)
      .run();
  } catch (error) {
    if (/UNIQUE|constraint/i.test(String(error?.message || "")))
      return json({ error: "Dit e-mailadres is intussen al in gebruik." }, 409);
    throw error;
  }
  await unlockFamilyEmail(env, user.email, sha256);
  try {
    await sendGraphMail(
      env,
      user.email,
      "Je e-mailadres is gewijzigd",
      mailHtml(
        "Je e-mailadres is gewijzigd",
        "<p>Je account in het familieportaal gebruikt nu <strong>" +
          esc(claim.n) +
          "</strong>. Was jij dit niet? Neem dan meteen contact op met de organisatie.</p>"
      )
    );
  } catch (error) {
    console.error("E-mail change notice failed:", error?.message);
  }
  return json({ changed: true, email: claim.n });
}

async function ownerOf(env, userId, familyId) {
  return env.DB.prepare(
    "SELECT f.id, f.display_name FROM family_memberships fm JOIN families f ON f.id = fm.family_id WHERE fm.user_id = ? AND fm.family_id = ? AND fm.role = 'owner'"
  )
    .bind(userId, familyId)
    .first();
}

// The family's owner invites someone (a partner): they can edit but not manage access.
export async function inviteFamilyAccount(context) {
  const { request, env, now, json, sameOrigin, cookieValue, sha256, base64Url, sendGraphMail } = context;
  if (!sameOrigin(request)) return json({ error: "Ongeldige aanvraag." }, 403);
  const session = await familyAccountSession(request, env, cookieValue, sha256);
  if (!session) return json({ error: EXPIRED }, 401);
  const body = await request.json().catch(() => null);
  const familyId = typeof body?.familyId === "string" ? body.familyId : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const displayName = typeof body?.displayName === "string" ? body.displayName.trim().slice(0, 100) : "";
  if (!validEmail(email) || !displayName) return json({ error: "Vul een naam en een geldig e-mailadres in." }, 400);
  const family = await ownerOf(env, session.user_id, familyId);
  if (!family) return json({ error: "Alleen de beheerder van het gezin kan iemand uitnodigen." }, 403);
  const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM family_memberships WHERE family_id = ?")
    .bind(familyId)
    .first();
  if (Number(count?.total || 0) >= MAX_ACCOUNTS_PER_FAMILY)
    return json({ error: "Een gezin kan maximaal " + MAX_ACCOUNTS_PER_FAMILY + " accounts hebben." }, 409);
  const limit = await familyResetLimit(env, email, clientIp(request), sha256, now);
  if (limit.blocked) return json({ error: "Te veel aanvragen. Probeer het over een uur opnieuw." }, 429);
  await limit.record();
  const result = await inviteToFamily(
    env,
    { familyId, familyName: family.display_name, email, displayName, role: "editor" },
    { now, sha256, base64Url, sendGraphMail }
  );
  if (result.status === "disabled")
    return json({ error: "Dit account kan niet worden toegevoegd. Vraag het aan de organisatie." }, 409);
  if (result.status === "exists") return json({ error: "Deze persoon heeft al toegang tot jullie gezin." }, 409);
  if (result.status === "mailFailed")
    return json({ error: "De uitnodigingsmail kon niet worden verzonden. Vraag het aan de organisatie." }, 502);
  if (!result.invited) {
    try {
      await sendGraphMail(
        env,
        email,
        "Je hebt toegang tot een gezin in het familieportaal",
        mailHtml(
          "Nieuwe toegang in het familieportaal",
          "<p>Je kan nu ook het gezin <strong>" +
            esc(family.display_name) +
            '</strong> beheren. <a href="https://nieuwjaar.datuur.be/familie">Naar het familieportaal</a>.</p>'
        )
      );
    } catch (error) {
      console.error("Family access notice failed:", error?.message);
    }
  }
  await logActivity(env, {
    now,
    familyId,
    familyName: family.display_name,
    actorId: session.user_id,
    actor: session.display_name || "",
    type: "invite",
    summary: displayName + " uitgenodigd"
  });
  return json({ invited: true }, 201);
}

export async function removeFamilyAccount({ request, env, json, sameOrigin, cookieValue, sha256 }) {
  if (!sameOrigin(request)) return json({ error: "Ongeldige aanvraag." }, 403);
  const session = await familyAccountSession(request, env, cookieValue, sha256);
  if (!session) return json({ error: EXPIRED }, 401);
  const body = await request.json().catch(() => null);
  const familyId = typeof body?.familyId === "string" ? body.familyId : "";
  const userId = typeof body?.userId === "string" ? body.userId : "";
  if (!(await ownerOf(env, session.user_id, familyId)))
    return json({ error: "Alleen de beheerder van het gezin kan iemand verwijderen." }, 403);
  const target = await env.DB.prepare(
    "SELECT fm.role, u.status FROM family_memberships fm JOIN family_users u ON u.id = fm.user_id WHERE fm.family_id = ? AND fm.user_id = ?"
  )
    .bind(familyId, userId)
    .first();
  if (!target) return json({ error: "Deze persoon heeft geen toegang meer." }, 404);
  if (target.role === "owner") return json({ error: "Een beheerder kan alleen de organisatie verwijderen." }, 403);
  await env.DB.prepare("DELETE FROM family_memberships WHERE family_id = ? AND user_id = ?")
    .bind(familyId, userId)
    .run();
  // A mistaken invitation leaves nothing behind: the link stops working too.
  if (target.status === "invited") {
    const other = await env.DB.prepare("SELECT 1 FROM family_memberships WHERE user_id = ?").bind(userId).first();
    if (!other) await env.DB.prepare("DELETE FROM family_users WHERE id = ? AND status = 'invited'").bind(userId).run();
  }
  return json({ removed: true });
}
