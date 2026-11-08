// Inviting an account to a family: used by the admin and by a family's own owner.
import { esc } from "../../../src/utils/html.js";

const INVITE_TTL_SECONDS = 7 * 24 * 60 * 60;

export function inviteMail(displayName, familyName, inviteUrl) {
  return (
    '<div style="font-family:Arial,sans-serif;color:#242424;line-height:1.6"><h2>Welkom in het familieportaal</h2><p>Dag ' +
    esc(displayName) +
    ",</p>" +
    (familyName
      ? "<p>Je bent uitgenodigd voor het gezin <strong>" +
        esc(familyName) +
        "</strong>. Daar kan je jullie gezinsleden en bestellingen beheren en de afrekening volgen.</p>"
      : "") +
    '<p><a href="' +
    inviteUrl +
    '">Activeer je account</a> en kies zelf een wachtwoord.</p><p>Deze link is 7 dagen geldig.</p></div>'
  );
}

export async function issueInvite(env, userId, now, sha256, base64Url) {
  const token = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE family_user_invites SET revoked_at = ? WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL"
    ).bind(now, userId),
    env.DB.prepare(
      "INSERT INTO family_user_invites (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)"
    ).bind(crypto.randomUUID(), userId, await sha256(token), now, now + INVITE_TTL_SECONDS)
  ]);
  return "https://nieuwjaar.datuur.be/familie/activeren/" + token;
}

// Links the address to the family (creating an invited account if it is new) and sends the
// activation mail when the account is not active yet.
// → { status: "disabled" | "exists" | "mailFailed" | "ok", userId, invited }
export async function inviteToFamily(env, { familyId, familyName, email, displayName, role }, tools) {
  const { now, sha256, base64Url, sendGraphMail } = tools;
  const user = await env.DB.prepare("SELECT id, status FROM family_users WHERE email = ?").bind(email).first();
  if (user?.status === "disabled") return { status: "disabled" };
  const statements = [];
  const userId = user?.id || crypto.randomUUID();
  if (!user)
    statements.push(
      env.DB.prepare(
        "INSERT INTO family_users (id, email, display_name, status, created_at, updated_at) VALUES (?, ?, ?, 'invited', ?, ?)"
      ).bind(userId, email, displayName, now, now)
    );
  statements.push(
    env.DB.prepare(
      "INSERT INTO family_memberships (id, family_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)"
    ).bind(crypto.randomUUID(), familyId, userId, role, now)
  );
  try {
    await env.DB.batch(statements);
  } catch (error) {
    if (/UNIQUE|constraint/i.test(String(error?.message || ""))) return { status: "exists" };
    throw error;
  }
  const invited = !user || user.status === "invited";
  if (invited) {
    try {
      const inviteUrl = await issueInvite(env, userId, now, sha256, base64Url);
      await sendGraphMail(env, email, "Uitnodiging familieportaal", inviteMail(displayName, familyName, inviteUrl));
    } catch (error) {
      console.error("Family invitation mail failed:", error);
      return { status: "mailFailed", userId, invited };
    }
  }
  return { status: "ok", userId, invited };
}
