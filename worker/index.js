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
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: fromBase64Url(salt), iterations: 310000, hash: "SHA-256" }, key, 256);
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

  if (url.pathname === "/api/admin/session" && request.method === "GET") {
    const session = await adminSession(request, env);
    return json({ authenticated: Boolean(session), expiresAt: session?.expires_at || null });
  }

  return json({ error: "Niet gevonden." }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({
        status: "ok",
        app: "nieuwjaar",
        environment: env.ENVIRONMENT || "development",
        database: Boolean(env.DB)
      });
    }

    if (url.pathname.startsWith("/api/admin/")) {
      return handleAdminApi(request, env, url);
    }

    return env.ASSETS.fetch(request);
  }
};
