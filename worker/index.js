const SESSION_COOKIE = "ny_admin";
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const encoder = new TextEncoder();

function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function fromBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function verifyPassword(password, stored) {
  const [salt, expected] = String(stored || "").split(":");
  if (!salt || !expected) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: fromBase64Url(salt), iterations: 100000, hash: "SHA-256" }, key, 256);
  const actual = base64Url(new Uint8Array(bits));
  if (actual.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < actual.length; i++) mismatch |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return mismatch === 0;
}

function cookieValue(request, name) {
  const cookies = request.headers.get("Cookie") || "";
  const entry = cookies.split(";").map(part => part.trim()).find(part => part.startsWith(name + "="));
  return entry ? entry.slice(name.length + 1) : "";
}

function cookieHeader(value, maxAge) {
  return `${SESSION_COOKIE}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/api/admin; Max-Age=${maxAge}`;
}

function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  return !origin || origin === new URL(request.url).origin;
}

async function adminSession(request, env) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token || !env.DB) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(
    "SELECT id, expires_at FROM admin_sessions WHERE token_hash = ? AND expires_at > ?"
  ).bind(tokenHash, Math.floor(Date.now() / 1000)).first();
  return row || null;
}

async function handleFamilyApi(request, env, url) {
  if (!env.DB) return json({ error: "Database niet geconfigureerd." }, 503);
  if (url.pathname === "/api/family/session" && request.method === "POST") {
    if (!sameOrigin(request)) return json({ error: "Ongeldige aanvraag." }, 403);
    const body = await request.json().catch(() => null);
    const token = typeof body?.token === "string" ? body.token : "";
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return json({ error: "Deze gezinslink is ongeldig of ingetrokken." }, 401);
    const invite = await env.DB.prepare(
      "SELECT id, edition_id, registration_id FROM family_invites WHERE token_hash = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)"
    ).bind(await sha256(token), Math.floor(Date.now() / 1000)).first();
    if (!invite) return json({ error: "Deze gezinslink is ongeldig of ingetrokken." }, 401);
    const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
    const sessionToken = base64Url(tokenBytes);
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare("INSERT INTO family_sessions (token_hash, invite_id, edition_id, registration_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(await sha256(sessionToken), invite.id, invite.edition_id, invite.registration_id, now, now + 30 * 24 * 60 * 60).run();
    await env.DB.prepare("UPDATE family_invites SET last_used_at = ? WHERE id = ?").bind(now, invite.id).run();
    return json({ authenticated: true }, 200, {
      "Set-Cookie": `ny_family=${sessionToken}; HttpOnly; Secure; SameSite=Strict; Path=/api/family; Max-Age=${30 * 24 * 60 * 60}`
    });
  }
  if (url.pathname === "/api/family/session" && request.method === "GET") {
    const token = cookieValue(request, "ny_family");
    if (!token) return json({ authenticated: false }, 200);
    const session = await env.DB.prepare(
      "SELECT s.edition_id, s.registration_id, s.invite_id FROM family_sessions s JOIN family_invites i ON i.id = s.invite_id WHERE s.token_hash = ? AND s.expires_at > ? AND i.revoked_at IS NULL AND (i.expires_at IS NULL OR i.expires_at > ?)"
    ).bind(await sha256(token), Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000)).first();
    if (!session) return json({ authenticated: false }, 200, {
      "Set-Cookie": "ny_family=; HttpOnly; Secure; SameSite=Strict; Path=/api/family; Max-Age=0"
    });
    const row = await env.DB.prepare("SELECT data_json FROM app_state WHERE environment = ?").bind(session.edition_id).first();
    if (!row) return json({ error: "De editie is niet beschikbaar." }, 404);
    let data;
    try { data = JSON.parse(row.data_json); } catch { return json({ error: "De inschrijving kon niet worden gelezen." }, 500); }
    const registration = (data.registrations || []).find(item => item.id === session.registration_id);
    if (!registration) return json({ error: "Deze inschrijving bestaat niet meer." }, 404);
    return json({
      authenticated: true,
      edition: data.activeEvent,
      registration,
      catalog: (data.catalog || []).filter(item => item.active).map(({ id, name, image }) => ({ id, name, image: image || null })),
      costsFinalized: Boolean(data.costsFinalized)
    });
  }
  if (url.pathname === "/api/family/registration" && request.method === "PUT") {
    if (!sameOrigin(request)) return json({ error: "Ongeldige aanvraag." }, 403);
    const token = cookieValue(request, "ny_family");
    if (!token) return json({ error: "Gezinssessie verlopen." }, 401);
    const now = Math.floor(Date.now() / 1000);
    const session = await env.DB.prepare(
      "SELECT s.edition_id, s.registration_id FROM family_sessions s JOIN family_invites i ON i.id = s.invite_id WHERE s.token_hash = ? AND s.expires_at > ? AND i.revoked_at IS NULL AND (i.expires_at IS NULL OR i.expires_at > ?)"
    ).bind(await sha256(token), now, now).first();
    if (!session) return json({ error: "Deze gezinslink is niet langer geldig." }, 401);
    const body = await request.json().catch(() => null);
    if (!Array.isArray(body?.members) || body.members.length > 30) return json({ error: "Ongeldige ledenlijst." }, 400);
    const stateRow = await env.DB.prepare("SELECT data_json FROM app_state WHERE environment = ?").bind(session.edition_id).first();
    if (!stateRow) return json({ error: "De editie is niet beschikbaar." }, 404);
    let data;
    try { data = JSON.parse(stateRow.data_json); } catch { return json({ error: "De editiegegevens zijn ongeldig." }, 500); }
    const registration = (data.registrations || []).find(item => item.id === session.registration_id);
    if (!registration) return json({ error: "Deze inschrijving bestaat niet meer." }, 404);
    const catalogIds = new Set((data.catalog || []).map(item => item.id));
    const members = [];
    for (const person of body.members) {
      if (!person || typeof person.name !== "string" || !person.name.trim() || person.name.trim().length > 80 ||
          !["Volwassene", "Kind"].includes(person.type) || typeof person.id !== "string" || person.id.length > 100) {
        return json({ error: "Controleer de namen en categorieën van alle gezinsleden." }, 400);
      }
      const orders = {};
      for (const productId of catalogIds) {
        const quantity = Number(person.orders?.[productId] || 0);
        if (!Number.isInteger(quantity) || quantity < 0 || quantity > 99) return json({ error: "Ongeldig aantal in de vleesbestelling." }, 400);
        orders[productId] = quantity;
      }
      members.push({ id: person.id, name: person.name.trim(), type: person.type, orders });
    }
    registration.members = members;
    registration.adults = members.filter(person => person.type === "Volwassene").length;
    registration.children = members.filter(person => person.type === "Kind").length;
    data.costsFinalized = false;
    data.costsFinalizedAt = null;
    await env.DB.prepare("UPDATE app_state SET data_json = ?, updated_at = ? WHERE environment = ?")
      .bind(JSON.stringify(data), now, session.edition_id).run();
    return json({ saved: true, registration });
  }

  if (url.pathname === "/api/family/logout" && request.method === "POST") {
    if (!sameOrigin(request)) return json({ error: "Ongeldige aanvraag." }, 403);
    const token = cookieValue(request, "ny_family");
    if (token) await env.DB.prepare("DELETE FROM family_sessions WHERE token_hash = ?").bind(await sha256(token)).run();
    return json({ authenticated: false }, 200, {
      "Set-Cookie": "ny_family=; HttpOnly; Secure; SameSite=Strict; Path=/api/family; Max-Age=0"
    });
  }
  return json({ error: "Niet gevonden." }, 404);
}

async function handleAdminApi(request, env, url) {
  if (!env.DB) return json({ error: "Database niet geconfigureerd." }, 503);

  if (url.pathname === "/api/admin/login" && request.method === "POST") {
    if (!sameOrigin(request)) return json({ error: "Ongeldige aanvraag." }, 403);
    if (!env.ADMIN_PASSWORD_HASH) return json({ error: "Adminwachtwoord is nog niet ingesteld." }, 503);
    const body = await request.json().catch(() => null);
    const password = typeof body?.password === "string" ? body.password : "";
    if (!password || password.length > 1024) return json({ error: "Vul het adminwachtwoord in." }, 400);
    const now = Math.floor(Date.now() / 1000);
    const failures = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM auth_events WHERE event_type = 'admin_login_failed' AND created_at > ?"
    ).bind(now - 15 * 60).first();
    if ((failures?.total || 0) >= 10) return json({ error: "Te veel mislukte pogingen. Probeer over 15 minuten opnieuw." }, 429);
    const valid = await verifyPassword(password, env.ADMIN_PASSWORD_HASH);
    if (!valid) {
      await env.DB.prepare("INSERT INTO auth_events (event_type, created_at) VALUES ('admin_login_failed', ?)")
        .bind(Math.floor(Date.now() / 1000)).run();
      return json({ error: "Onjuist wachtwoord." }, 401);
    }
    const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
    const token = base64Url(tokenBytes);
    await env.DB.prepare("INSERT INTO admin_sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)")
      .bind(await sha256(token), now, now + SESSION_TTL_SECONDS).run();
    return json({ authenticated: true, expiresAt: now + SESSION_TTL_SECONDS }, 200, {
      "Set-Cookie": cookieHeader(token, SESSION_TTL_SECONDS)
    });
  }

  if (url.pathname === "/api/admin/logout" && request.method === "POST") {
    if (!sameOrigin(request)) return json({ error: "Ongeldige aanvraag." }, 403);
    const token = cookieValue(request, SESSION_COOKIE);
    if (token) await env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(await sha256(token)).run();
    return json({ authenticated: false }, 200, { "Set-Cookie": cookieHeader("", 0) });
  }

  if (url.pathname === "/api/admin/family-invites" && request.method === "GET") {
    const session = await adminSession(request, env);
    if (!session) return json({ error: "Niet aangemeld." }, 401);
    const rows = await env.DB.prepare(
      "SELECT id, edition_id, registration_id, created_at, expires_at, revoked_at, last_used_at FROM family_invites ORDER BY created_at DESC"
    ).all();
    return json({ invites: rows.results || [] });
  }

  if (url.pathname === "/api/admin/family-invites" && request.method === "POST") {
    if (!sameOrigin(request)) return json({ error: "Ongeldige aanvraag." }, 403);
    const session = await adminSession(request, env);
    if (!session) return json({ error: "Niet aangemeld." }, 401);
    const body = await request.json().catch(() => null);
    const edition = body?.edition;
    const registrationId = typeof body?.registrationId === "string" ? body.registrationId : "";
    if (!["test", "live"].includes(edition) || !registrationId || registrationId.length > 160) {
      return json({ error: "Ongeldige editie of inschrijving." }, 400);
    }
    const stateRow = await env.DB.prepare("SELECT data_json FROM app_state WHERE environment = ?").bind(edition).first();
    if (!stateRow) return json({ error: "Er zijn nog geen gegevens voor deze editie opgeslagen." }, 404);
    let appState;
    try { appState = JSON.parse(stateRow.data_json); } catch { return json({ error: "De editiegegevens zijn ongeldig." }, 500); }
    const registration = (appState.registrations || []).find(item => item.id === registrationId);
    if (!registration) return json({ error: "Deze inschrijving bestaat niet in de gekozen editie." }, 404);
    const now = Math.floor(Date.now() / 1000);
    const inviteId = crypto.randomUUID();
    const token = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    await env.DB.prepare("UPDATE family_invites SET revoked_at = ? WHERE edition_id = ? AND registration_id = ? AND revoked_at IS NULL")
      .bind(now, edition, registrationId).run();
    await env.DB.prepare("INSERT INTO family_invites (id, edition_id, registration_id, token_hash, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(inviteId, edition, registrationId, await sha256(token), now).run();
    return json({
      invite: { id: inviteId, edition_id: edition, registration_id: registrationId, created_at: now },
      url: `https://nieuwjaar.datuur.be/familie/${token}`
    }, 201);
  }

  if (url.pathname.startsWith("/api/admin/family-invites/") && request.method === "DELETE") {
    if (!sameOrigin(request)) return json({ error: "Ongeldige aanvraag." }, 403);
    const session = await adminSession(request, env);
    if (!session) return json({ error: "Niet aangemeld." }, 401);
    const inviteId = url.pathname.slice("/api/admin/family-invites/".length);
    if (!inviteId || inviteId.length > 80) return json({ error: "Ongeldige uitnodiging." }, 400);
    const now = Math.floor(Date.now() / 1000);
    const result = await env.DB.prepare("UPDATE family_invites SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
      .bind(now, inviteId).run();
    if (!result.meta?.changes) return json({ error: "Uitnodiging niet gevonden of al ingetrokken." }, 404);
    await env.DB.prepare("DELETE FROM family_sessions WHERE invite_id = ?").bind(inviteId).run();
    return json({ revoked: true });
  }

  if (url.pathname === "/api/admin/state" && request.method === "GET") {
    const session = await adminSession(request, env);
    if (!session) return json({ error: "Niet aangemeld." }, 401);
    const rows = await env.DB.prepare("SELECT environment, data_json, updated_at FROM app_state")
      .all();
    const environments = { test: null, live: null };
    for (const row of rows.results || []) {
      if (row.environment === "test" || row.environment === "live") {
        try { environments[row.environment] = JSON.parse(row.data_json); }
        catch (error) { console.error("Invalid stored app state:", row.environment, error); }
      }
    }
    return json({ environments, updatedAt: rows.results?.reduce((latest, row) => Math.max(latest, row.updated_at || 0), 0) || null });
  }

  if (url.pathname === "/api/admin/state" && request.method === "PUT") {
    if (!sameOrigin(request)) return json({ error: "Ongeldige aanvraag." }, 403);
    const session = await adminSession(request, env);
    if (!session) return json({ error: "Niet aangemeld." }, 401);
    const body = await request.json().catch(() => null);
    const environments = body?.environments;
    if (!environments || typeof environments !== "object" || Array.isArray(environments)) {
      return json({ error: "Ongeldige gegevensstructuur." }, 400);
    }
    const statements = [];
    for (const environment of ["test", "live"]) {
      const data = environments[environment];
      if (!data || typeof data !== "object" || Array.isArray(data) ||
          !data.activeEvent || typeof data.activeEvent !== "object" ||
          !Array.isArray(data.registrations) || !Array.isArray(data.expenses) ||
          !Array.isArray(data.payments) || !Array.isArray(data.catalog) ||
          !Array.isArray(data.editionArchive)) {
        return json({ error: `Ongeldige gegevens voor omgeving ${environment}.` }, 400);
      }
      const serialized = JSON.stringify(data);
      if (serialized.length > 1_500_000) return json({ error: "De gegevens zijn te groot om op te slaan." }, 413);
      statements.push(env.DB.prepare(
        "INSERT INTO app_state (environment, data_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(environment) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at"
      ).bind(environment, serialized, Math.floor(Date.now() / 1000)));
    }
    await env.DB.batch(statements);
    return json({ saved: true, updatedAt: Math.floor(Date.now() / 1000) });
  }

  if (url.pathname === "/api/admin/session" && request.method === "GET") {
    const session = await adminSession(request, env);
    return json({ authenticated: Boolean(session), expiresAt: session?.expires_at || null });
  }

  return json({ error: "Niet gevonden." }, 404);
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (url.pathname === "/api/health") {
        return json({
          status: "ok",
          app: "nieuwjaar",
          environment: env.ENVIRONMENT || "development",
          database: Boolean(env.DB)
        });
      }

      if (url.pathname.startsWith("/api/family/")) {
        return await handleFamilyApi(request, env, url);
      }

      if (url.pathname.startsWith("/api/admin/")) {
        return await handleAdminApi(request, env, url);
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error("Nieuwjaar Worker exception:", error);
      return json({ error: "Interne serverfout." }, 500);
    }
  }
};
