// Signing in and out: login, logout, activation link, forgotten password, reset.
import {
  FAMILY_ACCOUNT_COOKIE,
  FAMILY_ACCOUNT_TTL_SECONDS,
  hashPassword,
  verifyFamilyPassword,
  familyAccountCookie,
  createFamilyAccountSession,
  familyLoginLimit,
  familyResetLimit,
  unlockFamilyEmail
} from "./session.js";

export async function login({ request, env, now, json, sameOrigin, sha256, base64Url, fromBase64Url }) {
  if (!sameOrigin(request)) return json({ error: "Ongeldige aanvraag." }, 403);
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !password || password.length > 1024) {
    return json({ error: "Vul een geldig e-mailadres en wachtwoord in." }, 400);
  }
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const limiter = await familyLoginLimit(env, email, ip, sha256, now);
  if (limiter.blocked) return json({ error: "Te veel aanmeldpogingen. Probeer over 15 minuten opnieuw." }, 429);
  const user = await env.DB.prepare("SELECT id, password_hash, status FROM family_users WHERE email = ?")
    .bind(email)
    .first();
  const valid =
    user?.status === "active" && user.password_hash
      ? await verifyFamilyPassword(password, user.password_hash, base64Url, fromBase64Url)
      : false;
  if (!valid) {
    await limiter.recordFailure();
    return json({ error: "E-mailadres of wachtwoord is niet correct." }, 401);
  }
  await limiter.clearEmail();
  const token = await createFamilyAccountSession(env, user.id, now, sha256, base64Url);
  await env.DB.prepare("UPDATE family_users SET last_login_at = ?, updated_at = ? WHERE id = ?")
    .bind(now, now, user.id)
    .run();
  return json({ authenticated: true }, 200, { "Set-Cookie": familyAccountCookie(token, FAMILY_ACCOUNT_TTL_SECONDS) });
}

export async function logout({ request, env, now, json, sameOrigin, cookieValue, sha256 }) {
  if (!sameOrigin(request)) return json({ error: "Ongeldige aanvraag." }, 403);
  const token = cookieValue(request, FAMILY_ACCOUNT_COOKIE);
  if (token)
    await env.DB.prepare("UPDATE family_user_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL")
      .bind(now, await sha256(token))
      .run();
  return json({ authenticated: false }, 200, { "Set-Cookie": familyAccountCookie("", 0) });
}

export async function activate({ request, env, now, json, sameOrigin, sha256, base64Url }) {
  if (!sameOrigin(request)) return json({ error: "Ongeldige aanvraag." }, 403);
  const body = await request.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const displayName = typeof body?.displayName === "string" ? body.displayName.trim().slice(0, 100) : "";
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token) || password.length < 12 || password.length > 1024 || !displayName) {
    return json(
      { error: "De activatielink, naam of het gekozen wachtwoord is ongeldig. Gebruik minstens 12 tekens." },
      400
    );
  }
  const invite = await env.DB.prepare(
    "SELECT i.id, i.user_id FROM family_user_invites i JOIN family_users u ON u.id = i.user_id WHERE i.token_hash = ? AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > ? AND u.status = 'invited'"
  )
    .bind(await sha256(token), now)
    .first();
  if (!invite) return json({ error: "Deze activatielink is ongeldig of verlopen." }, 400);
  const passwordHash = await hashPassword(password, base64Url);
  const updated = await env.DB.prepare(
    "UPDATE family_user_invites SET used_at = ? WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ? RETURNING user_id"
  )
    .bind(now, invite.id, now)
    .first();
  if (!updated) return json({ error: "Deze activatielink is al gebruikt of verlopen." }, 400);
  await env.DB.prepare(
    "UPDATE family_users SET password_hash = ?, display_name = ?, status = 'active', updated_at = ? WHERE id = ? AND status = 'invited'"
  )
    .bind(passwordHash, displayName, now, invite.user_id)
    .run();
  const sessionToken = await createFamilyAccountSession(env, invite.user_id, now, sha256, base64Url);
  return json({ activated: true }, 200, {
    "Set-Cookie": familyAccountCookie(sessionToken, FAMILY_ACCOUNT_TTL_SECONDS)
  });
}

export async function forgotPassword({ request, env, now, json, sameOrigin, sha256, base64Url, sendGraphMail }) {
  if (!sameOrigin(request)) return json({ error: "Ongeldige aanvraag." }, 403);
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254) {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const limit = await familyResetLimit(env, email, ip, sha256, now);
    if (limit.blocked)
      return json(
        {
          error:
            "Er werden te veel herstelmails aangevraagd. Probeer het over een uur opnieuw of vraag de organisatie om je account te ontgrendelen."
        },
        429
      );
    await limit.record();
    const user = await env.DB.prepare("SELECT id, status FROM family_users WHERE email = ?").bind(email).first();
    if (user?.status === "active") {
      const token = base64Url(crypto.getRandomValues(new Uint8Array(32)));
      await env.DB.prepare("UPDATE family_password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL")
        .bind(now, user.id)
        .run();
      await env.DB.prepare(
        "INSERT INTO family_password_resets (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)"
      )
        .bind(crypto.randomUUID(), user.id, await sha256(token), now, now + 30 * 60)
        .run();
      const resetUrl = "https://nieuwjaar.datuur.be/familie/wachtwoord-reset/" + token;
      const html =
        '<div style="font-family:Arial,sans-serif;color:#242424;line-height:1.6"><h2>Wachtwoord opnieuw instellen</h2><p>Je vroeg een nieuw wachtwoord aan voor het familieportaal.</p><p><a href="' +
        resetUrl +
        '">Wachtwoord opnieuw instellen</a></p><p>Deze link is 30 minuten geldig en kan maar één keer gebruikt worden. Heb je dit niet aangevraagd? Dan mag je deze e-mail negeren.</p></div>';
      try {
        await sendGraphMail(env, email, "Wachtwoord opnieuw instellen", html);
      } catch (error) {
        console.error("Family password reset mail failed:", error.message);
      }
    }
  }
  return json({ accepted: true });
}

export async function resetPassword({ request, env, now, json, sameOrigin, sha256, base64Url }) {
  if (!sameOrigin(request)) return json({ error: "Ongeldige aanvraag." }, 403);
  const body = await request.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token) || password.length < 12 || password.length > 1024) {
    return json({ error: "De resetlink of het gekozen wachtwoord is ongeldig. Gebruik minstens 12 tekens." }, 400);
  }
  const reset = await env.DB.prepare(
    "SELECT id, user_id FROM family_password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?"
  )
    .bind(await sha256(token), now)
    .first();
  if (!reset) return json({ error: "Deze resetlink is ongeldig of verlopen." }, 400);
  // Hash eerst: als Web Crypto faalt, blijft de resetlink bruikbaar.
  // Geef base64Url expliciet mee; hashPassword verwacht die encoder ook bij reset.
  const passwordHash = await hashPassword(password, base64Url);
  const consumed = await env.DB.prepare(
    "UPDATE family_password_resets SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ? RETURNING user_id"
  )
    .bind(now, reset.id, now)
    .first();
  if (!consumed) return json({ error: "Deze resetlink is al gebruikt of verlopen." }, 400);
  await env.DB.prepare("UPDATE family_users SET password_hash = ?, updated_at = ? WHERE id = ? AND status = 'active'")
    .bind(passwordHash, now, reset.user_id)
    .run();
  await env.DB.prepare("UPDATE family_user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
    .bind(now, reset.user_id)
    .run();
  const resetUser = await env.DB.prepare("SELECT email FROM family_users WHERE id = ?").bind(reset.user_id).first();
  if (resetUser?.email) await unlockFamilyEmail(env, resetUser.email, sha256);
  return json({ reset: true }, 200, { "Set-Cookie": familyAccountCookie("", 0) });
}
