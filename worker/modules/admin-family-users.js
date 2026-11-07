const encoder = new TextEncoder();

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function validEmail(value) {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function handleAdminFamilyUsers(request, env, url, dependencies) {
  const { json, sameOrigin, adminSession, sha256, base64Url, sendGraphMail } = dependencies;
  if (!env.DB) return json({ error: "Database niet geconfigureerd." }, 503);
  const session = await adminSession(request, env);
  if (!session) return json({ error: "Niet aangemeld." }, 401);
  const path = url.pathname;
  const now = Math.floor(Date.now() / 1000);
  const base = "/api/admin/family-users";

  if (path === base && request.method === "GET") {
    const environment = url.searchParams.get("environment");
    if (!["test", "live"].includes(environment)) return json({ error: "Ongeldige omgeving." }, 400);
    const result = await env.DB.prepare(
      "SELECT u.id, u.email, u.display_name, u.status, u.created_at, u.updated_at, u.last_login_at, r.id AS link_id, r.edition_id, r.registration_id FROM family_users u LEFT JOIN family_user_registrations r ON r.user_id = u.id AND r.edition_id = ? ORDER BY u.email COLLATE NOCASE, r.registration_id"
    ).bind(environment).all();
    const users = new Map();
    for (const row of result.results || []) {
      if (!users.has(row.id)) users.set(row.id, {
        id: row.id, email: row.email, displayName: row.display_name, status: row.status,
        createdAt: row.created_at, lastLoginAt: row.last_login_at, registrations: []
      });
      if (row.link_id) users.get(row.id).registrations.push({
        linkId: row.link_id, registrationId: row.registration_id, environment: row.edition_id
      });
    }
    return json({ users: [...users.values()], environment });
  }

  if (!sameOrigin(request)) return json({ error: "Ongeldige aanvraag." }, 403);

  if (path === base && request.method === "POST") {
    const body = await request.json().catch(() => null);
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const displayName = typeof body?.displayName === "string" ? body.displayName.trim().slice(0, 100) : "";
    const environment = body?.environment;
    const registrationId = typeof body?.registrationId === "string" ? body.registrationId.trim() : "";
    if (!validEmail(email) || !displayName || !["test", "live"].includes(environment) || !registrationId || registrationId.length > 120) {
      return json({ error: "Vul een geldige naam, e-mail, omgeving en inschrijving in." }, 400);
    }
    const stateRow = await env.DB.prepare("SELECT data_json FROM app_state WHERE environment = ?").bind(environment).first();
    if (!stateRow) return json({ error: "De gekozen editie bestaat niet." }, 404);
    let data;
    try { data = JSON.parse(stateRow.data_json); } catch { return json({ error: "De editiegegevens zijn ongeldig." }, 500); }
    const registration = (data.registrations || []).find(item => item.id === registrationId);
    if (!registration) return json({ error: "De gekozen inschrijving bestaat niet in deze editie." }, 404);
    let user = await env.DB.prepare("SELECT id, status FROM family_users WHERE email = ?").bind(email).first();
    if (user && user.status === "disabled") return json({ error: "Dit account is geblokkeerd. Activeer het eerst opnieuw via accountbeheer." }, 409);
    if (!user) {
      const id = crypto.randomUUID();
      await env.DB.prepare("INSERT INTO family_users (id, email, display_name, status, created_at, updated_at) VALUES (?, ?, ?, 'invited', ?, ?)")
        .bind(id, email, displayName, now, now).run();
      user = { id, status: "invited" };
    }
    const newlyCreatedUser = user.status === "invited" && !(await env.DB.prepare("SELECT 1 AS existing FROM family_user_invites WHERE user_id = ? LIMIT 1").bind(user.id).first());
    try {
      let relational = null;
      try {
        relational = await env.DB.prepare("SELECT family_id FROM event_registrations WHERE legacy_environment = ? AND legacy_registration_id = ?").bind(environment, registrationId).first();
      } catch (error) {
        if (!String(error?.message || "").toLowerCase().includes("no such table")) throw error;
      }
      const statements = [
        env.DB.prepare("INSERT INTO family_user_registrations (user_id, edition_id, registration_id, created_at) VALUES (?, ?, ?, ?)")
          .bind(user.id, environment, registrationId, now)
      ];
      if (relational?.family_id) {
        statements.push(env.DB.prepare("INSERT INTO family_memberships (id, family_id, user_id, role, created_at) VALUES (?, ?, ?, 'editor', ?) ON CONFLICT(family_id, user_id) DO NOTHING")
          .bind("legacy-membership-" + environment + "-" + registrationId + "-" + user.id, relational.family_id, user.id, now));
      }
      await env.DB.batch(statements);
      await env.DB.prepare("UPDATE family_users SET display_name = ?, updated_at = ? WHERE id = ?").bind(displayName, now, user.id).run();
    } catch (error) {
      if (newlyCreatedUser) {
        try { await env.DB.prepare("DELETE FROM family_users WHERE id = ?").bind(user.id).run(); }
        catch (cleanupError) { console.error("Orphan invitation account cleanup failed:", cleanupError); }
      }
      if (/UNIQUE|constraint/i.test(String(error?.message || ""))) return json({ error: "Deze inschrijving is al aan dit account gekoppeld." }, 409);
      console.error("Family account link failed:", error);
      return json({ error: "De accountkoppeling kon niet veilig worden opgeslagen." }, 503);
    }
    if (user.status === "active") return json({ created: true, invited: false, userId: user.id });
    const token = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    await env.DB.prepare("UPDATE family_user_invites SET revoked_at = ? WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL").bind(now, user.id).run();
    await env.DB.prepare("INSERT INTO family_user_invites (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), user.id, await sha256(token), now, now + 7 * 24 * 60 * 60).run();
    const eventName = String(data.activeEvent?.name || data.activeEvent?.title || "het evenement");
    const activationUrl = "https://nieuwjaar.datuur.be/familie/activeren/" + token;
    const html = '<div style="font-family:Arial,sans-serif;color:#242424;line-height:1.6"><h2>Uitnodiging voor ' + escapeHtml(eventName) + '</h2><p>Dag ' + escapeHtml(displayName) + ',</p><p>Je krijgt toegang tot het deelnemersportaal voor ' + escapeHtml(eventName) + '.</p><p><a href="' + activationUrl + '">Account activeren</a></p><p>Deze eenmalige link is 7 dagen geldig. Stel bij activatie je eigen wachtwoord in.</p></div>';
    try {
      await sendGraphMail(env, email, eventName + " – activeer je account", html);
    } catch (error) {
      console.error("Family account invitation mail failed:", error.message);
      return json({ error: "Account en inschrijvingskoppeling zijn aangemaakt, maar de uitnodigingsmail kon niet worden verzonden. Gebruik opnieuw uitnodigen zodra de mailverbinding hersteld is.", userId: user.id, mailFailed: true }, 502);
    }
    return json({ created: true, invited: true, userId: user.id });
  }

  const match = path.match(/^\/api\/admin\/family-users\/([0-9a-f-]+)(?:\/(resend|sessions|registrations))?$/i);
  if (!match) return json({ error: "Niet gevonden." }, 404);
  const [, userId, action] = match;
  const user = await env.DB.prepare("SELECT id, email, display_name, status FROM family_users WHERE id = ?").bind(userId).first();
  if (!user) return json({ error: "Gebruiker niet gevonden." }, 404);

  if (action === "resend" && request.method === "POST") {
    if (user.status !== "invited") return json({ error: "Alleen openstaande uitnodigingen kunnen opnieuw worden verstuurd." }, 409);
    const token = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    await env.DB.prepare("UPDATE family_user_invites SET revoked_at = ? WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL").bind(now, userId).run();
    await env.DB.prepare("INSERT INTO family_user_invites (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), userId, await sha256(token), now, now + 7 * 24 * 60 * 60).run();
    const linkedEdition = await env.DB.prepare("SELECT edition_id FROM family_user_registrations WHERE user_id = ? ORDER BY created_at DESC LIMIT 1").bind(userId).first();
    const linkedState = linkedEdition ? await env.DB.prepare("SELECT data_json FROM app_state WHERE environment = ?").bind(linkedEdition.edition_id).first() : null;
    let eventName = "het evenement";
    try { const linkedData = JSON.parse(linkedState?.data_json || "{}"); eventName = String(linkedData.activeEvent?.name || linkedData.activeEvent?.title || eventName); } catch { /* Gebruik de neutrale benaming bij ongeldige oude data. */ }
    const url = "https://nieuwjaar.datuur.be/familie/activeren/" + token;
    const html = '<div style="font-family:Arial,sans-serif;color:#242424;line-height:1.6"><h2>Uitnodiging voor ' + escapeHtml(eventName) + '</h2><p>Dag ' + escapeHtml(user.display_name) + ',</p><p><a href="' + url + '">Activeer je account</a></p><p>Deze link is 7 dagen geldig.</p></div>';
    try { await sendGraphMail(env, user.email, eventName + " – nieuwe activatielink", html); }
    catch (error) { console.error("Family invitation resend failed:", error.message); return json({ error: "De uitnodigingsmail kon niet worden verzonden." }, 502); }
    return json({ sent: true });
  }

  if (action === "sessions" && request.method === "POST") {
    await env.DB.prepare("UPDATE family_user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(now, userId).run();
    return json({ revoked: true });
  }

  if (!action && request.method === "DELETE") {
    const body = await request.json().catch(() => null);
    if (body?.confirmEmail !== user.email || body?.removeTestRegistration !== true) {
      return json({ error: "Bevestig het exacte e-mailadres en de opruiming van de testinschrijving." }, 400);
    }

    const testLinks = await env.DB.prepare(
      "SELECT registration_id FROM family_user_registrations WHERE user_id = ? AND edition_id = 'test'"
    ).bind(userId).all();
    const testRegistrationIds = (testLinks.results || []).map(row => row.registration_id);

    if (testRegistrationIds.length) {
      const stateRow = await env.DB.prepare("SELECT data_json, updated_at FROM app_state WHERE environment = 'test'").first();
      if (stateRow) {
        let data;
        try { data = JSON.parse(stateRow.data_json); }
        catch { return json({ error: "De testeditie kon niet veilig worden gelezen. Er is niets verwijderd." }, 500); }
        const removed = new Set(testRegistrationIds);
        data.registrations = (data.registrations || []).filter(item => !removed.has(item.id));
        data.payments = (data.payments || []).filter(item => !removed.has(item.registrationId));
        data.expenses = (data.expenses || []).filter(item => !removed.has(item.advancedBy));
        data.costsFinalized = false;
        data.costsFinalizedAt = null;
        const updated = await env.DB.prepare(
          "UPDATE app_state SET data_json = ?, updated_at = MAX(updated_at + 1, ?) WHERE environment = 'test' AND updated_at = ? RETURNING updated_at"
        ).bind(JSON.stringify(data), now, stateRow.updated_at).first();
        if (!updated) return json({ error: "De testeditie is intussen gewijzigd. Herlaad het beheer en probeer opnieuw; er is geen account verwijderd." }, 409);
      }
    }

    await env.DB.prepare("DELETE FROM family_users WHERE id = ?").bind(userId).run();
    return json({ deleted: true, removedTestRegistrations: testRegistrationIds.length });
  }

  if (!action && request.method === "PATCH") {
    const body = await request.json().catch(() => null);
    const status = body?.status;
    if (!["active", "disabled"].includes(status)) return json({ error: "Ongeldige accountstatus." }, 400);
    await env.DB.prepare("UPDATE family_users SET status = ?, updated_at = ? WHERE id = ?").bind(status, now, userId).run();
    if (status === "disabled") await env.DB.prepare("UPDATE family_user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(now, userId).run();
    return json({ updated: true, status });
  }

  if (action === "registrations" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    const environment = body?.environment;
    const registrationId = typeof body?.registrationId === "string" ? body.registrationId.trim() : "";
    if (!["test", "live"].includes(environment) || !registrationId) return json({ error: "Ongeldige omgeving of inschrijving." }, 400);
    const stateRow = await env.DB.prepare("SELECT data_json FROM app_state WHERE environment = ?").bind(environment).first();
    if (!stateRow) return json({ error: "De gekozen editie bestaat niet." }, 404);
    let data;
    try { data = JSON.parse(stateRow.data_json); } catch { return json({ error: "De editiegegevens zijn ongeldig." }, 500); }
    if (!(data.registrations || []).some(item => item.id === registrationId)) return json({ error: "De inschrijving bestaat niet in deze editie." }, 404);
    try {
      let relational = null;
      try {
        relational = await env.DB.prepare("SELECT family_id FROM event_registrations WHERE legacy_environment = ? AND legacy_registration_id = ?").bind(environment, registrationId).first();
      } catch (error) {
        if (!String(error?.message || "").toLowerCase().includes("no such table")) throw error;
      }
      const statements = [
        env.DB.prepare("INSERT INTO family_user_registrations (user_id, edition_id, registration_id, created_at) VALUES (?, ?, ?, ?)")
          .bind(userId, environment, registrationId, now)
      ];
      if (relational?.family_id) {
        statements.push(env.DB.prepare("INSERT INTO family_memberships (id, family_id, user_id, role, created_at) VALUES (?, ?, ?, 'editor', ?) ON CONFLICT(family_id, user_id) DO NOTHING")
          .bind("legacy-membership-" + environment + "-" + registrationId + "-" + userId, relational.family_id, userId, now));
      }
      await env.DB.batch(statements);
    } catch (error) {
      if (/UNIQUE|constraint/i.test(String(error?.message || ""))) return json({ error: "Deze inschrijving is al aan dit account gekoppeld." }, 409);
      console.error("Family registration link failed:", error);
      return json({ error: "De accountkoppeling kon niet veilig worden opgeslagen. Er is niets gedeeltelijk gewijzigd." }, 503);
    }
    return json({ linked: true });
  }

  if (action === "registrations" && request.method === "DELETE") {
    const linkId = Number(url.searchParams.get("linkId"));
    if (!Number.isSafeInteger(linkId) || linkId < 1) return json({ error: "Ongeldige koppeling." }, 400);
    const link = await env.DB.prepare("SELECT edition_id, registration_id FROM family_user_registrations WHERE id = ? AND user_id = ?").bind(linkId, userId).first();
    await env.DB.prepare("DELETE FROM family_user_registrations WHERE id = ? AND user_id = ?").bind(linkId, userId).run();
    if (link) {
      try {
        const stillLinked = await env.DB.prepare("SELECT 1 AS linked FROM family_user_registrations WHERE user_id = ? AND edition_id = ? AND registration_id = ?").bind(userId, link.edition_id, link.registration_id).first();
        if (!stillLinked) {
          const relational = await env.DB.prepare("SELECT family_id FROM event_registrations WHERE legacy_environment = ? AND legacy_registration_id = ?").bind(link.edition_id, link.registration_id).first();
          if (relational?.family_id) await env.DB.prepare("DELETE FROM family_memberships WHERE family_id = ? AND user_id = ?").bind(relational.family_id, userId).run();
        }
      } catch (error) {
        if (!String(error?.message || "").toLowerCase().includes("no such table")) throw error;
      }
    }
    return json({ unlinked: true });
  }

  return json({ error: "Niet gevonden." }, 404);
}
