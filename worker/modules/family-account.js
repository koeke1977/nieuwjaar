import { getFamilyFinanceBreakdown } from "../../src/utils/finance.js";

const encoder = new TextEncoder();
const FAMILY_ACCOUNT_COOKIE = "ny_family_account";
const FAMILY_ACCOUNT_TTL_SECONDS = 7 * 24 * 60 * 60;

async function hashPassword(password, base64Url) {
  try {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iterations = 100000;
    const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, 256);
    return "pbkdf2$" + iterations + "$" + base64Url(salt) + "$" + base64Url(new Uint8Array(bits));
  } catch (error) {
    const name = typeof error?.name === "string" ? error.name : "Error";
    const message = typeof error?.message === "string" ? error.message : "Onbekende Web Crypto-fout";
    console.error("Family account password hashing failed:", { name, message, stack: error?.stack || "" });
    throw new Error("Family account password hashing failed (" + name + "): " + message);
  }
}

async function verifyFamilyPassword(password, stored, base64Url, fromBase64Url) {
  const [scheme, iterationsText, saltText, expected] = String(stored || "").split("$");
  const iterations = Number(iterationsText);
  if (scheme !== "pbkdf2" || !Number.isInteger(iterations) || iterations < 100000 || iterations > 100000 || !saltText || !expected) return false;
  let salt;
  try { salt = fromBase64Url(saltText); } catch { return false; }
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, 256);
  const actual = base64Url(new Uint8Array(bits));
  if (actual.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < actual.length; i++) mismatch |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return mismatch === 0;
}

function familyAccountCookie(value, maxAge) {
  return FAMILY_ACCOUNT_COOKIE + "=" + value + "; HttpOnly; Secure; SameSite=Strict; Path=/api/family-account; Max-Age=" + maxAge;
}

async function createFamilyAccountSession(env, userId, now, sha256, base64Url) {
  const token = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare("INSERT INTO family_user_sessions (user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(userId, await sha256(token), now, now + FAMILY_ACCOUNT_TTL_SECONDS).run();
  return token;
}

async function familyLoginLimit(env, email, ip, sha256, now) {
  const emailKey = await sha256("family-email:" + email);
  const ipKey = await sha256("family-ip:" + ip);
  const rows = await env.DB.prepare(
    "SELECT scope_hash, attempts, window_started FROM family_login_limits WHERE scope_hash IN (?, ?)"
  ).bind(emailKey, ipKey).all();
  const limits = new Map((rows.results || []).map(row => [row.scope_hash, row]));
  const checks = [
    { key: emailKey, max: 30 },
    { key: ipKey, max: 100 }
  ];
  return {
    blocked: checks.some(check => {
      const row = limits.get(check.key);
      return row && now - row.window_started < 15 * 60 && row.attempts >= check.max;
    }),
    recordFailure: async () => {
      for (const check of checks) {
        const row = limits.get(check.key);
        if (!row || now - row.window_started >= 15 * 60) {
          await env.DB.prepare("INSERT INTO family_login_limits (scope_hash, attempts, window_started) VALUES (?, 1, ?) ON CONFLICT(scope_hash) DO UPDATE SET attempts = 1, window_started = excluded.window_started")
            .bind(check.key, now).run();
        } else {
          await env.DB.prepare("UPDATE family_login_limits SET attempts = attempts + 1 WHERE scope_hash = ?")
            .bind(check.key).run();
        }
      }
    },
    clearEmail: async () => {
      await env.DB.prepare("DELETE FROM family_login_limits WHERE scope_hash = ?")
        .bind(emailKey).run();
    }
  };
}

async function familyAccountSession(request, env, cookieValue, sha256) {
  const token = cookieValue(request, FAMILY_ACCOUNT_COOKIE);
  if (!token) return null;
  return env.DB.prepare(
    "SELECT s.id AS session_id, s.user_id, s.expires_at, u.email, u.display_name, u.status FROM family_user_sessions s JOIN family_users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND s.revoked_at IS NULL AND u.status = 'active'"
  ).bind(await sha256(token), Math.floor(Date.now() / 1000)).first();
}

// Family-facing finance for a normalized edition: shares are computed over all active
// registrations of the edition, but only this registration's figures are returned.
async function normalizedFamilyFinance(env, editionId, registration) {
  const [rows, snapshot] = await Promise.all([
    env.DB.prepare("SELECT id, data_json FROM event_registrations WHERE edition_id = ? AND status = 'active'").bind(editionId).all(),
    env.DB.prepare("SELECT expenses_json, payments_json, costs_finalized, costs_finalized_at FROM edition_finance_snapshots WHERE edition_id = ?").bind(editionId).first()
  ]);
  const registrations = (rows.results || []).map(row => {
    let data = {};
    try { data = JSON.parse(row.data_json || "{}"); } catch { /* telt dan als lege inschrijving */ }
    return row.id === registration.id ? registration : { id: row.id, members: Array.isArray(data.members) ? data.members : [], adults: data.adults, children: data.children };
  });
  let expenses = [], payments = [];
  try { expenses = JSON.parse(snapshot?.expenses_json || "[]"); payments = JSON.parse(snapshot?.payments_json || "[]"); } catch { /* lege afrekening */ }
  return {
    finalized: Boolean(snapshot?.costs_finalized),
    finalizedAt: snapshot?.costs_finalized_at || null,
    ...getFamilyFinanceBreakdown(registration, registrations, expenses, payments)
  };
}

// Members compared by content: key order and zero quantities do not count as a change.
function canonicalMembers(members) {
  return JSON.stringify((Array.isArray(members) ? members : []).map(person => ({
    id: String(person?.id ?? ""), name: String(person?.name ?? "").trim(), type: person?.type,
    orders: Object.entries(person?.orders && typeof person.orders === "object" ? person.orders : {})
      .filter(([, qty]) => Number(qty) > 0).map(([id, qty]) => [id, Number(qty)]).sort(([a], [b]) => a.localeCompare(b))
  })));
}

export async function handleFamilyAccountApi(request, env, url, dependencies) {
  const { json, sameOrigin, cookieValue, sha256, base64Url, fromBase64Url, sendGraphMail } = dependencies;

  if (!env.DB) return json({ error: "Database niet geconfigureerd." }, 503);
  const path = url.pathname;
  const now = Math.floor(Date.now() / 1000);

  if (path === "/api/family-account/login" && request.method === "POST") {
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
    const user = await env.DB.prepare("SELECT id, password_hash, status FROM family_users WHERE email = ?").bind(email).first();
    const valid = user?.status === "active" && user.password_hash ? await verifyFamilyPassword(password, user.password_hash, base64Url, fromBase64Url) : false;
    if (!valid) {
      await limiter.recordFailure();
      return json({ error: "E-mailadres of wachtwoord is niet correct." }, 401);
    }
    await limiter.clearEmail();
    const token = await createFamilyAccountSession(env, user.id, now, sha256, base64Url);
    await env.DB.prepare("UPDATE family_users SET last_login_at = ?, updated_at = ? WHERE id = ?").bind(now, now, user.id).run();
    return json({ authenticated: true }, 200, { "Set-Cookie": familyAccountCookie(token, FAMILY_ACCOUNT_TTL_SECONDS) });
  }

  if (path === "/api/family-account/session" && request.method === "GET") {
    const session = await familyAccountSession(request, env, cookieValue, sha256);
    if (!session) return json({ authenticated: false }, 200, { "Set-Cookie": familyAccountCookie("", 0) });
    // Access is per family (membership); a family has one registration per edition.
    // Archived editions are history and are not shown in the portal.
    const result = await env.DB.prepare(
      "SELECT er.id AS registration_id, er.edition_id, er.data_json, er.updated_at, d.label AS edition_label, d.status AS edition_status, d.config_json, e.name AS event_name, e.finance_strategy, fm.role AS membership_role FROM family_memberships fm JOIN event_registrations er ON er.family_id = fm.family_id AND er.status = 'active' JOIN event_editions d ON d.id = er.edition_id JOIN events e ON e.id = d.event_id WHERE fm.user_id = ? AND d.status != 'archived' ORDER BY d.created_at DESC, e.name"
    ).bind(session.user_id).all();
    const registrations = [];
    for (const row of result.results || []) {
      let registration, config;
      try { registration = JSON.parse(row.data_json || "{}"); config = JSON.parse(row.config_json || "{}"); } catch { continue; }
      const members = (Array.isArray(registration.members) ? registration.members : []).map(person => ({
        id: person.id, name: person.name, type: person.type,
        orders: person.orders && typeof person.orders === "object" && !Array.isArray(person.orders) ? person.orders : {}
      }));
      const own = { id: row.registration_id, name: registration.name || "", members,
        adults: members.filter(person => person.type === "Volwassene").length, children: members.filter(person => person.type === "Kind").length };
      registrations.push({
        edition: row.edition_id,
        editionLabel: row.edition_label || "Editie",
        editionStatus: row.edition_status,
        event: row.event_name || "Evenement",
        accessRole: row.membership_role || "viewer",
        registration: own,
        catalog: (Array.isArray(config.catalog) ? config.catalog : []).filter(item => item && item.active !== false).map(item => ({ id: item.id, name: item.name, image: item.image || null })),
        revision: Number(row.updated_at) || 0,
        finance: row.finance_strategy === "nieuwjaar" ? await normalizedFamilyFinance(env, row.edition_id, own) : null
      });
    }
    return json({ authenticated: true, user: { email: session.email, displayName: session.display_name }, registrations });
  }

  if (path === "/api/family-account/registration" && request.method === "PUT") {
    if (!sameOrigin(request)) return json({ error: "Ongeldige aanvraag." }, 403);
    const session = await familyAccountSession(request, env, cookieValue, sha256);
    if (!session) return json({ error: "Je sessie is verlopen. Meld je opnieuw aan." }, 401);
    const body = await request.json().catch(() => null);
    const editionId = typeof body?.edition === "string" ? body.edition : "";
    const registrationId = typeof body?.registrationId === "string" ? body.registrationId : "";
    if (!editionId || !registrationId || !Number.isSafeInteger(body?.revision) || !Array.isArray(body?.members) || body.members.length < 1 || body.members.length > 30) {
      return json({ error: "Ongeldige inschrijvingsgegevens." }, 400);
    }
    const row = await env.DB.prepare(
      "SELECT er.id, er.data_json, er.updated_at, d.config_json, d.status AS edition_status, fm.role FROM event_registrations er JOIN event_editions d ON d.id = er.edition_id JOIN family_memberships fm ON fm.family_id = er.family_id WHERE er.id = ? AND er.edition_id = ? AND er.status = 'active' AND fm.user_id = ?"
    ).bind(registrationId, editionId, session.user_id).first();
    if (!row) return json({ error: "Deze inschrijving is niet aan je account gekoppeld." }, 403);
    if (row.role === "viewer") return json({ error: "Je hebt alleen leesrechten voor deze inschrijving." }, 403);
    if (row.edition_status === "archived") return json({ error: "Deze editie is afgesloten." }, 409);
    if (Number(row.updated_at) !== body.revision) return json({ error: "Iemand anders heeft jullie inschrijving net aangepast. We tonen nu de nieuwste gegevens; controleer ze en pas opnieuw aan.", conflict: "registration" }, 409);
    let registration, config;
    try { registration = JSON.parse(row.data_json || "{}"); config = JSON.parse(row.config_json || "{}"); }
    catch { return json({ error: "De inschrijvingsgegevens zijn ongeldig." }, 500); }
    const activeIds = new Set((Array.isArray(config.catalog) ? config.catalog : []).filter(item => item && item.active !== false).map(item => item.id));
    const stored = new Map((Array.isArray(registration.members) ? registration.members : []).map(person => [person.id, person]));
    const memberIds = new Set(), members = [];
    for (const person of body.members) {
      if (!person || typeof person.id !== "string" || !/^[A-Za-z0-9_-]{1,120}$/.test(person.id) ||
          typeof person.name !== "string" || !person.name.trim() || person.name.trim().length > 80 ||
          !["Volwassene", "Kind"].includes(person.type)) {
        return json({ error: "Controleer de namen en categorieën van alle gezinsleden." }, 400);
      }
      if (memberIds.has(person.id)) return json({ error: "Een gezinslid komt meer dan één keer voor." }, 400);
      memberIds.add(person.id);
      // Keep quantities of products the family cannot edit (inactive or removed products).
      const orders = {};
      for (const [productId, qty] of Object.entries(stored.get(person.id)?.orders || {})) if (!activeIds.has(productId)) orders[productId] = qty;
      const sent = person.orders && typeof person.orders === "object" && !Array.isArray(person.orders) ? person.orders : {};
      for (const productId of activeIds) {
        const quantity = Number(sent[productId] ?? 0);
        if (!Number.isInteger(quantity) || quantity < 0 || quantity > 99) return json({ error: "Ongeldig aantal in de bestelling." }, 400);
        orders[productId] = quantity;
      }
      members.push({ id: person.id, name: person.name.trim(), type: person.type, orders });
    }
    const updatedRegistration = { ...registration, members,
      adults: members.filter(person => person.type === "Volwassene").length,
      children: members.filter(person => person.type === "Kind").length };
    const serialized = JSON.stringify(updatedRegistration);
    if (canonicalMembers(registration.members) === canonicalMembers(members)) return json({ saved: true, unchanged: true, revision: Number(row.updated_at), registration: { id: registrationId, ...updatedRegistration } });
    // One transaction: save the registration and reopen finalized edition costs,
    // the latter guarded on the exact row the first statement writes.
    const nextRevision = Math.max(body.revision + 1, now);
    const results = await env.DB.batch([
      env.DB.prepare("UPDATE event_registrations SET data_json = ?, updated_at = ? WHERE id = ? AND edition_id = ? AND updated_at = ?")
        .bind(serialized, nextRevision, registrationId, editionId, body.revision),
      env.DB.prepare("UPDATE edition_finance_snapshots SET costs_finalized = 0, costs_finalized_at = NULL, updated_at = MAX(updated_at + 1, ?) WHERE edition_id = ? AND costs_finalized = 1 AND EXISTS (SELECT 1 FROM event_registrations WHERE id = ? AND updated_at = ? AND data_json = ?)")
        .bind(now, editionId, registrationId, nextRevision, serialized)
    ]);
    if (!Number(results?.[0]?.meta?.changes ?? 0)) return json({ error: "Iemand anders heeft jullie inschrijving net aangepast. We tonen nu de nieuwste gegevens; controleer ze en pas opnieuw aan.", conflict: "registration" }, 409);
    return json({ saved: true, revision: nextRevision, registration: { id: registrationId, ...updatedRegistration } });
  }

  if (path === "/api/family-account/logout" && request.method === "POST") {
    if (!sameOrigin(request)) return json({ error: "Ongeldige aanvraag." }, 403);
    const token = cookieValue(request, FAMILY_ACCOUNT_COOKIE);
    if (token) await env.DB.prepare("UPDATE family_user_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL").bind(now, await sha256(token)).run();
    return json({ authenticated: false }, 200, { "Set-Cookie": familyAccountCookie("", 0) });
  }

  if (path === "/api/family-account/activate" && request.method === "POST") {
    if (!sameOrigin(request)) return json({ error: "Ongeldige aanvraag." }, 403);
    const body = await request.json().catch(() => null);
    const token = typeof body?.token === "string" ? body.token : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const displayName = typeof body?.displayName === "string" ? body.displayName.trim().slice(0, 100) : "";
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(token) || password.length < 12 || password.length > 1024 || !displayName) {
      return json({ error: "De activatielink, naam of het gekozen wachtwoord is ongeldig. Gebruik minstens 12 tekens." }, 400);
    }
    const invite = await env.DB.prepare(
      "SELECT i.id, i.user_id FROM family_user_invites i JOIN family_users u ON u.id = i.user_id WHERE i.token_hash = ? AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > ? AND u.status = 'invited'"
    ).bind(await sha256(token), now).first();
    if (!invite) return json({ error: "Deze activatielink is ongeldig of verlopen." }, 400);
    const passwordHash = await hashPassword(password, base64Url);
    const updated = await env.DB.prepare(
      "UPDATE family_user_invites SET used_at = ? WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ? RETURNING user_id"
    ).bind(now, invite.id, now).first();
    if (!updated) return json({ error: "Deze activatielink is al gebruikt of verlopen." }, 400);
    await env.DB.prepare("UPDATE family_users SET password_hash = ?, display_name = ?, status = 'active', updated_at = ? WHERE id = ? AND status = 'invited'")
      .bind(passwordHash, displayName, now, invite.user_id).run();
    const sessionToken = await createFamilyAccountSession(env, invite.user_id, now, sha256, base64Url);
    return json({ activated: true }, 200, { "Set-Cookie": familyAccountCookie(sessionToken, FAMILY_ACCOUNT_TTL_SECONDS) });
  }

  if (path === "/api/family-account/forgot-password" && request.method === "POST") {
    if (!sameOrigin(request)) return json({ error: "Ongeldige aanvraag." }, 403);
    const body = await request.json().catch(() => null);
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254) {
      const user = await env.DB.prepare("SELECT id, status FROM family_users WHERE email = ?").bind(email).first();
      if (user?.status === "active") {
        const token = base64Url(crypto.getRandomValues(new Uint8Array(32)));
        await env.DB.prepare("UPDATE family_password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL").bind(now, user.id).run();
        await env.DB.prepare("INSERT INTO family_password_resets (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
          .bind(crypto.randomUUID(), user.id, await sha256(token), now, now + 30 * 60).run();
        const resetUrl = "https://nieuwjaar.datuur.be/familie/wachtwoord-reset/" + token;
        const html = '<div style="font-family:Arial,sans-serif;color:#242424;line-height:1.6"><h2>Wachtwoord opnieuw instellen</h2><p>Je vroeg een nieuw wachtwoord aan voor het Nieuwjaar-familieportaal.</p><p><a href="' + resetUrl + '">Wachtwoord opnieuw instellen</a></p><p>Deze link is 30 minuten geldig en kan maar één keer gebruikt worden. Heb je dit niet aangevraagd? Dan mag je deze e-mail negeren.</p></div>';
        try { await sendGraphMail(env, email, "Nieuwjaar – wachtwoord opnieuw instellen", html); }
        catch (error) { console.error("Family password reset mail failed:", error.message); }
      }
    }
    return json({ accepted: true });
  }

  if (path === "/api/family-account/reset-password" && request.method === "POST") {
    if (!sameOrigin(request)) return json({ error: "Ongeldige aanvraag." }, 403);
    const body = await request.json().catch(() => null);
    const token = typeof body?.token === "string" ? body.token : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(token) || password.length < 12 || password.length > 1024) {
      return json({ error: "De resetlink of het gekozen wachtwoord is ongeldig. Gebruik minstens 12 tekens." }, 400);
    }
    const reset = await env.DB.prepare("SELECT id, user_id FROM family_password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?").bind(await sha256(token), now).first();
    if (!reset) return json({ error: "Deze resetlink is ongeldig of verlopen." }, 400);
    // Hash eerst: als Web Crypto faalt, blijft de resetlink bruikbaar.
    // Geef base64Url expliciet mee; hashPassword verwacht die encoder ook bij reset.
    const passwordHash = await hashPassword(password, base64Url);
    const consumed = await env.DB.prepare("UPDATE family_password_resets SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ? RETURNING user_id").bind(now, reset.id, now).first();
    if (!consumed) return json({ error: "Deze resetlink is al gebruikt of verlopen." }, 400);
    await env.DB.prepare("UPDATE family_users SET password_hash = ?, updated_at = ? WHERE id = ? AND status = 'active'").bind(passwordHash, now, reset.user_id).run();
    await env.DB.prepare("UPDATE family_user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(now, reset.user_id).run();
    const resetUser = await env.DB.prepare("SELECT email FROM family_users WHERE id = ?").bind(reset.user_id).first();
    if (resetUser?.email) {
      const emailKey = await sha256("family-email:" + resetUser.email.trim().toLowerCase());
      await env.DB.prepare("DELETE FROM family_login_limits WHERE scope_hash = ?").bind(emailKey).run();
    }
    return json({ reset: true }, 200, { "Set-Cookie": familyAccountCookie("", 0) });
  }

  return json({ error: "Niet gevonden." }, 404);
}
