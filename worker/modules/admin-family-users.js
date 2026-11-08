// Admin API for families (global, across all events and editions) and family accounts.
//   GET    /api/admin/families                          families with registrations and accounts
//   POST   /api/admin/families/memberships              invite or link an account to a family
//   PATCH  /api/admin/families/:familyId/memberships/:userId   change role
//   DELETE /api/admin/families/:familyId/memberships/:userId   unlink account from family
//   GET    /api/admin/family-users                      all accounts with their families
//   POST   /api/admin/family-users/:id/resend           new activation mail
//   POST   /api/admin/family-users/:id/sessions         revoke sessions
//   POST   /api/admin/family-users/:id/unlock           clear the login and password-reset limits
//   PATCH  /api/admin/family-users/:id                  block / unblock
//   DELETE /api/admin/family-users/:id                  delete account (family data is kept)

import { esc } from "../../src/utils/html.js";
import { familyAccountLocks, unlockFamilyEmail } from "./family/session.js";

const INVITE_TTL_SECONDS = 7 * 24 * 60 * 60;

function validEmail(value) {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function inviteMail(displayName, familyName, inviteUrl) {
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

async function issueInvite(env, userId, now, sha256, base64Url) {
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

export async function handleAdminFamilyUsers(request, env, url, dependencies) {
  const { json, sameOrigin, adminSession, sha256, base64Url, sendGraphMail } = dependencies;
  if (!env.DB) return json({ error: "Database niet geconfigureerd." }, 503);
  if (!(await adminSession(request, env))) return json({ error: "Niet aangemeld." }, 401);
  if (request.method !== "GET" && !sameOrigin(request)) return json({ error: "Ongeldige aanvraag." }, 403);
  const path = url.pathname;
  const now = Math.floor(Date.now() / 1000);

  if (path === "/api/admin/families" && request.method === "GET") {
    const [families, registrations, accounts] = await Promise.all([
      env.DB.prepare(
        "SELECT id, display_name, contact_email, created_at FROM families ORDER BY display_name COLLATE NOCASE"
      ).all(),
      env.DB.prepare(
        "SELECT er.id, er.family_id, er.edition_id, er.status, er.data_json, er.updated_at, d.label AS edition_label, d.status AS edition_status, d.created_at AS edition_created_at, e.id AS event_id, e.name AS event_name FROM event_registrations er JOIN event_editions d ON d.id = er.edition_id JOIN events e ON e.id = d.event_id WHERE er.status = 'active' ORDER BY d.created_at DESC"
      ).all(),
      env.DB.prepare(
        "SELECT fm.family_id, fm.role, u.id, u.email, u.display_name, u.status, u.last_login_at FROM family_memberships fm JOIN family_users u ON u.id = fm.user_id ORDER BY u.email COLLATE NOCASE"
      ).all()
    ]);
    const byFamily = new Map(
      (families.results || []).map(row => [
        row.id,
        {
          id: row.id,
          name: row.display_name,
          contactEmail: row.contact_email,
          createdAt: row.created_at,
          registrations: [],
          accounts: []
        }
      ])
    );
    for (const row of registrations.results || []) {
      const family = byFamily.get(row.family_id);
      if (!family) continue;
      let data = {};
      try {
        data = JSON.parse(row.data_json || "{}");
      } catch {
        /* shown as empty */
      }
      family.registrations.push({
        id: row.id,
        editionId: row.edition_id,
        edition: row.edition_label,
        editionStatus: row.edition_status,
        eventId: row.event_id,
        event: row.event_name,
        name: String(data.name || family.name),
        members: Array.isArray(data.members) ? data.members.map(p => ({ id: p.id, name: p.name, type: p.type })) : []
      });
    }
    for (const row of accounts.results || []) {
      byFamily.get(row.family_id)?.accounts.push({
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        status: row.status,
        role: row.role,
        lastLoginAt: row.last_login_at
      });
    }
    return json({ families: [...byFamily.values()] });
  }

  if (path === "/api/admin/family-users" && request.method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT u.id, u.email, u.display_name, u.status, u.created_at, u.last_login_at, fm.family_id, fm.role, f.display_name AS family_name FROM family_users u LEFT JOIN family_memberships fm ON fm.user_id = u.id LEFT JOIN families f ON f.id = fm.family_id ORDER BY u.email COLLATE NOCASE"
    ).all();
    const users = new Map();
    for (const row of rows.results || []) {
      if (!users.has(row.id))
        users.set(row.id, {
          id: row.id,
          email: row.email,
          displayName: row.display_name,
          status: row.status,
          createdAt: row.created_at,
          lastLoginAt: row.last_login_at,
          families: []
        });
      if (row.family_id)
        users.get(row.id).families.push({ familyId: row.family_id, familyName: row.family_name, role: row.role });
    }
    const list = [...users.values()];
    const locks = await familyAccountLocks(
      env,
      list.map(user => user.email),
      sha256,
      now
    );
    for (const user of list) {
      user.loginLocked = locks.get(user.email).login;
      user.resetLocked = locks.get(user.email).reset;
    }
    return json({ users: list });
  }

  if (path === "/api/admin/families/memberships" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    const familyId = typeof body?.familyId === "string" ? body.familyId : "";
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const displayName = typeof body?.displayName === "string" ? body.displayName.trim().slice(0, 100) : "";
    const requestedRole = body?.role;
    if (
      !familyId ||
      !validEmail(email) ||
      !displayName ||
      (requestedRole && !["owner", "editor", "viewer"].includes(requestedRole))
    ) {
      return json({ error: "Vul een naam en een geldig e-mailadres in." }, 400);
    }
    const family = await env.DB.prepare("SELECT id, display_name FROM families WHERE id = ?").bind(familyId).first();
    if (!family) return json({ error: "Gezin niet gevonden. Bewaar eerst de inschrijving en probeer opnieuw." }, 404);
    const owners = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM family_memberships WHERE family_id = ? AND role = 'owner'"
    )
      .bind(familyId)
      .first();
    const role = requestedRole || (Number(owners?.total || 0) ? "editor" : "owner");
    let user = await env.DB.prepare("SELECT id, status FROM family_users WHERE email = ?").bind(email).first();
    if (user?.status === "disabled")
      return json({ error: "Dit account is geblokkeerd. Deblokkeer het eerst bij Gebruikers → Accounts." }, 409);
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
      if (/UNIQUE|constraint/i.test(String(error?.message || "")))
        return json({ error: "Dit account is al aan dit gezin gekoppeld." }, 409);
      throw error;
    }
    const invited = !user || user.status === "invited";
    if (invited) {
      try {
        const inviteUrl = await issueInvite(env, userId, now, sha256, base64Url);
        await sendGraphMail(
          env,
          email,
          "Uitnodiging familieportaal",
          inviteMail(displayName, family.display_name, inviteUrl)
        );
      } catch (error) {
        console.error("Family invitation mail failed:", error);
        return json(
          {
            linked: true,
            invited: true,
            mailFailed: true,
            error:
              "Het account is gekoppeld, maar de uitnodigingsmail kon niet worden verzonden. Probeer 'Opnieuw sturen'."
          },
          502
        );
      }
    }
    return json({ linked: true, userId, role, invited }, 201);
  }

  const membershipMatch = path.match(/^\/api\/admin\/families\/([^/]+)\/memberships\/([^/]+)$/);
  if (membershipMatch && ["PATCH", "DELETE"].includes(request.method)) {
    const [, familyId, userId] = membershipMatch;
    const membership = await env.DB.prepare("SELECT role FROM family_memberships WHERE family_id = ? AND user_id = ?")
      .bind(familyId, userId)
      .first();
    if (!membership) return json({ error: "Koppeling niet gevonden." }, 404);
    const owners = async () =>
      Number(
        (
          await env.DB.prepare(
            "SELECT COUNT(*) AS total FROM family_memberships WHERE family_id = ? AND role = 'owner'"
          )
            .bind(familyId)
            .first()
        )?.total || 0
      );
    if (request.method === "PATCH") {
      const body = await request.json().catch(() => null);
      const role = body?.role;
      if (!["owner", "editor", "viewer"].includes(role)) return json({ error: "Ongeldige rol." }, 400);
      if (membership.role === "owner" && role !== "owner" && (await owners()) <= 1)
        return json({ error: "Een gezin heeft minstens één beheerder nodig." }, 409);
      await env.DB.prepare("UPDATE family_memberships SET role = ? WHERE family_id = ? AND user_id = ?")
        .bind(role, familyId, userId)
        .run();
      return json({ updated: true, role });
    }
    await env.DB.prepare("DELETE FROM family_memberships WHERE family_id = ? AND user_id = ?")
      .bind(familyId, userId)
      .run();
    return json({ unlinked: true });
  }

  const match = path.match(/^\/api\/admin\/family-users\/([0-9a-f-]+)(?:\/(resend|sessions|unlock))?$/i);
  if (!match) return json({ error: "Niet gevonden." }, 404);
  const [, userId, action] = match;
  const user = await env.DB.prepare("SELECT id, email, display_name, status FROM family_users WHERE id = ?")
    .bind(userId)
    .first();
  if (!user) return json({ error: "Account niet gevonden." }, 404);

  if (action === "resend" && request.method === "POST") {
    if (user.status !== "invited")
      return json({ error: "Alleen openstaande uitnodigingen kunnen opnieuw worden verstuurd." }, 409);
    const family = await env.DB.prepare(
      "SELECT f.display_name FROM family_memberships fm JOIN families f ON f.id = fm.family_id WHERE fm.user_id = ? ORDER BY fm.created_at LIMIT 1"
    )
      .bind(userId)
      .first();
    try {
      const inviteUrl = await issueInvite(env, userId, now, sha256, base64Url);
      await sendGraphMail(
        env,
        user.email,
        "Uitnodiging familieportaal – nieuwe link",
        inviteMail(user.display_name, family?.display_name, inviteUrl)
      );
    } catch (error) {
      console.error("Family invitation resend failed:", error);
      return json({ error: "De uitnodigingsmail kon niet worden verzonden." }, 502);
    }
    return json({ sent: true });
  }

  if (action === "unlock" && request.method === "POST") {
    await unlockFamilyEmail(env, user.email, sha256);
    return json({ unlocked: true });
  }

  if (action === "sessions" && request.method === "POST") {
    await env.DB.prepare("UPDATE family_user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
      .bind(now, userId)
      .run();
    return json({ revoked: true });
  }

  if (!action && request.method === "PATCH") {
    const body = await request.json().catch(() => null);
    if (!["active", "disabled"].includes(body?.status)) return json({ error: "Ongeldige accountstatus." }, 400);
    if (body.status === "active" && user.status === "invited")
      return json({ error: "Een uitgenodigd account wordt actief zodra de persoon het activeert." }, 409);
    await env.DB.prepare("UPDATE family_users SET status = ?, updated_at = ? WHERE id = ?")
      .bind(body.status, now, userId)
      .run();
    if (body.status === "disabled")
      await env.DB.prepare("UPDATE family_user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
        .bind(now, userId)
        .run();
    return json({ updated: true, status: body.status });
  }

  if (!action && request.method === "DELETE") {
    const body = await request.json().catch(() => null);
    if (body?.confirmEmail !== user.email)
      return json({ error: "Bevestig het exacte e-mailadres om dit account te verwijderen." }, 400);
    // Only the account and its access are removed (sessions, invites and memberships cascade).
    await env.DB.prepare("DELETE FROM family_users WHERE id = ?").bind(userId).run();
    return json({ deleted: true });
  }

  return json({ error: "Niet gevonden." }, 404);
}
