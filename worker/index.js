import { handleFamilyAccountApi } from "./modules/family-account.js";
import { handleAdminFamilyUsers } from "./modules/admin-family-users.js";
import { handleAdminEvents } from "./modules/admin-events.js";
import { handleAdminEditionState } from "./modules/admin-edition-state.js";
import { backupDatabase, handleAdminBackups } from "./modules/backup.js";
import { streamReceipt, pruneOrphanReceipts } from "./modules/receipts.js";
const SESSION_COOKIE = "ny_admin";
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const encoder = new TextEncoder();

function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });
}


async function sendGraphMail(env, recipient, subject, html) {
  const tenantId = env.O365_TENANT_ID, clientId = env.O365_CLIENT_ID;
  const clientSecret = env.O365_CLIENT_SECRET;
  // Transactionele mail mag uitsluitend vanuit deze mailbox vertrekken.
  const fromEmail = "registratie@datuur.be";
  if (![tenantId, clientId, clientSecret].every(value => typeof value === "string" && value.trim())) {
    throw new Error("Microsoft 365-mailinstellingen ontbreken in de Worker-secrets.");
  }
  if (env.O365_FROM_EMAIL !== fromEmail) {
    throw new Error("De ingestelde afzender moet exact registratie@datuur.be zijn.");
  }
  if (typeof recipient !== "string" || recipient.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    throw new Error("Ongeldig e-mailadres van de ontvanger.");
  }
  if (typeof subject !== "string" || !subject.trim() || subject.length > 200 || /[\r\n]/.test(subject)) {
    throw new Error("Ongeldig e-mailonderwerp.");
  }
  if (typeof html !== "string" || html.length > 100000) {
    throw new Error("Ongeldige e-mailinhoud.");
  }
  const tokenResponse = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" })
  });
  if (!tokenResponse.ok) {
    let authError = null;
    try { authError = await tokenResponse.json(); } catch { /* Microsoft-response was geen JSON. */ }
    const errorCode = typeof authError?.error === "string" ? authError.error : "unknown_error";
    const description = typeof authError?.error_description === "string"
      ? authError.error_description.replace(/[\\r\\n]+/g, " ").slice(0, 700)
      : "Microsoft gaf geen foutomschrijving terug.";
    const correlationId = typeof authError?.correlation_id === "string" ? authError.correlation_id : "";
    const traceId = typeof authError?.trace_id === "string" ? authError.trace_id : "";
    console.error("Microsoft OAuth token request failed:", {
      status: tokenResponse.status,
      error: errorCode,
      description,
      correlationId,
      traceId
    });
    throw new Error(`Microsoft 365-aanmelding mislukt (HTTP ${tokenResponse.status}, ${errorCode}): ${description}`);
  }
  const tokenData = await tokenResponse.json();
  if (!tokenData.access_token) throw new Error("Microsoft 365 gaf geen toegangstoken terug.");
  const sendResponse = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(fromEmail)}/sendMail`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${tokenData.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { subject, body: { contentType: "HTML", content: html }, toRecipients: [{ emailAddress: { address: recipient } }] }, saveToSentItems: true })
  });
  if (!sendResponse.ok) throw new Error(`Microsoft Graph heeft de e-mail geweigerd (HTTP ${sendResponse.status}). Controleer de mailboxmachtiging.`);
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

async function handleAdminApi(request, env, url) {
  if (!env.DB) return json({ error: "Database niet geconfigureerd." }, 503);

  if (url.pathname === "/api/admin/receipts" && request.method === "GET") {
    if (!await adminSession(request, env)) return json({ error: "Niet aangemeld." }, 401);
    return (await streamReceipt(env, url.searchParams.get("key") || "")) || json({ error: "Niet gevonden." }, 404);
  }

  if (url.pathname === "/api/admin/backups" || url.pathname.startsWith("/api/admin/backups/")) {
    return handleAdminBackups(request, env, url, { json, sameOrigin, adminSession });
  }

  if (url.pathname.startsWith("/api/admin/editions/")) {
    return (await handleAdminEditionState(request, env, url, { json, sameOrigin, adminSession })) || json({ error: "Niet gevonden." }, 404);
  }

  if (url.pathname === "/api/admin/events" || url.pathname.startsWith("/api/admin/events/")) {
    return handleAdminEvents(request, env, url, { json, sameOrigin, adminSession });
  }

  if (url.pathname.startsWith("/api/admin/family-users") || url.pathname.startsWith("/api/admin/families")) {
    return handleAdminFamilyUsers(request, env, url, { json, sameOrigin, adminSession, sha256, base64Url, sendGraphMail });
  }


  if (url.pathname === "/api/admin/mail-test" && request.method === "POST") {
    if (!sameOrigin(request)) return json({ error: "Ongeldige aanvraag." }, 403);
    const session = await adminSession(request, env);
    if (!session) return json({ error: "Niet aangemeld." }, 401);
    const body = await request.json().catch(() => null);
    const recipient = typeof body?.recipient === "string" ? body.recipient.trim() : "";
    if (recipient.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return json({ error: "Vul een geldig e-mailadres in." }, 400);
    const safeRecipient = recipient.replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
    const html = `<div style="font-family:Arial,sans-serif;color:#242424;line-height:1.6"><h2>Nieuwjaar – mailtest geslaagd</h2><p>Deze test bevestigt dat de Nieuwjaar-app e-mail kan versturen via Microsoft 365.</p><p>Verzonden vanuit <strong>registratie@datuur.be</strong>.</p><p>Ontvanger: ${safeRecipient}</p></div>`;
    try {
      await sendGraphMail(env, recipient, "[Nieuwjaar] Test e-mailverbinding", html);
      return json({ sent: true });
    } catch (error) {
      console.error("Microsoft Graph mail test failed:", error.message);
      return json({ error: error.message || "De testmail kon niet worden verzonden." }, 502);
    }
  }

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

  if (url.pathname === "/api/admin/product-image" && request.method === "POST") {
    if (!sameOrigin(request)) return json({ error: "Ongeldige aanvraag." }, 403);
    if (!env.PHOTOS) return json({ error: "Foto-opslag is nog niet gekoppeld aan de Worker." }, 503);
    const session = await adminSession(request, env);
    if (!session) return json({ error: "Niet aangemeld." }, 401);
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    const productId = form?.get("productId");
    if (!(file instanceof File) || !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
        file.size < 1 || file.size > 5 * 1024 * 1024 ||
        typeof productId !== "string" || !/^[a-zA-Z0-9_-]{1,120}$/.test(productId)) {
      return json({ error: "Ongeldig afbeeldingsbestand. Gebruik JPG, PNG of WebP tot 5 MB." }, 400);
    }
    const extension = file.type === "image/jpeg" ? "jpg" : file.type === "image/png" ? "png" : "webp";
    const key = `products/live/${productId}-${crypto.randomUUID()}.${extension}`;
    await env.PHOTOS.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type, cacheControl: "public, max-age=31536000, immutable" }
    });
    return json({ image: `/media/${key}` }, 201);
  }

  if (url.pathname === "/api/admin/product-image" && request.method === "DELETE") {
    if (!sameOrigin(request)) return json({ error: "Ongeldige aanvraag." }, 403);
    const session = await adminSession(request, env);
    if (!session) return json({ error: "Niet aangemeld." }, 401);
    if (!env.PHOTOS) return json({ error: "Foto-opslag is nog niet gekoppeld aan de Worker." }, 503);
    const body = await request.json().catch(() => null);
    const image = typeof body?.image === "string" ? body.image : "";
    const match = image.match(/^\/media\/(products\/(?:test|live)\/[A-Za-z0-9_-]+-[0-9a-f-]+\.(?:jpg|png|webp))$/i);
    if (!match) return json({ error: "Ongeldige fotoverwijzing." }, 400);
    await env.PHOTOS.delete(match[1]);
    return json({ deleted: true });
  }

  if (url.pathname === "/api/admin/session" && request.method === "GET") {
    const session = await adminSession(request, env);
    return json({ authenticated: Boolean(session), expiresAt: session?.expires_at || null });
  }

  return json({ error: "Niet gevonden." }, 404);
}

export default {
  // Daily backup (cron in wrangler.jsonc).
  async scheduled(event, env, ctx) {
    ctx.waitUntil(backupDatabase(env).then(result => console.log("Backup written:", result)).catch(error => console.error("Backup failed:", error)));
    ctx.waitUntil(pruneOrphanReceipts(env).then(removed => console.log("Orphan receipts removed:", removed)).catch(error => console.error("Receipt cleanup failed:", error)));
  },

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

      if (url.pathname.startsWith("/media/") && request.method === "GET") {
        if (!env.PHOTOS) return new Response("Foto-opslag niet beschikbaar.", { status: 503 });
        const key = url.pathname.slice("/media/".length);
        if (!/^products\/(?:test|live)\/[A-Za-z0-9_-]+-[0-9a-f-]+\.(?:jpg|png|webp)$/i.test(key)) return new Response("Niet gevonden.", { status: 404 });
        const object = await env.PHOTOS.get(key);
        if (!object) return new Response("Niet gevonden.", { status: 404 });
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set("ETag", object.httpEtag);
        headers.set("Cache-Control", "public, max-age=31536000, immutable");
        return new Response(object.body, { headers });
      }

      if (url.pathname.startsWith("/api/family-account/")) {
        return await handleFamilyAccountApi(request, env, url, { json, sameOrigin, cookieValue, sha256, base64Url, fromBase64Url, sendGraphMail });
      }

      if (url.pathname.startsWith("/api/admin/")) {
        return await handleAdminApi(request, env, url);
      }

      if (url.pathname.startsWith("/api/")) return json({ error: "Niet gevonden." }, 404);

      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error("Nieuwjaar Worker exception:", error);
      return json({ error: "Interne serverfout." }, 500);
    }
  }
};
