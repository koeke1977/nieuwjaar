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
  if (!tokenResponse.ok) throw new Error(`Microsoft 365-aanmelding mislukt (HTTP ${tokenResponse.status}). Controleer de app-credentials.`);
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

async function encryptInviteToken(token, env) {
  const keyBytes = await crypto.subtle.digest("SHA-256", encoder.encode(env.ADMIN_PASSWORD_HASH || ""));
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(token));
  return `${base64Url(iv)}.${base64Url(new Uint8Array(encrypted))}`;
}

async function decryptInviteToken(value, env) {
  if (!value || !env.ADMIN_PASSWORD_HASH) return "";
  try {
    const [ivPart, dataPart] = value.split(".");
    const keyBytes = await crypto.subtle.digest("SHA-256", encoder.encode(env.ADMIN_PASSWORD_HASH));
    const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64Url(ivPart) }, key, fromBase64Url(dataPart));
    return new TextDecoder().decode(plain);
  } catch { return ""; }
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
    const row = await env.DB.prepare("SELECT data_json, updated_at FROM app_state WHERE environment = ?").bind(session.edition_id).first();
    if (!row) return json({ error: "De editie is niet beschikbaar." }, 404);
    let data;
    try { data = JSON.parse(row.data_json); } catch { return json({ error: "De inschrijving kon niet worden gelezen." }, 500); }
    const registration = (data.registrations || []).find(item => item.id === session.registration_id);
    if (!registration) return json({ error: "Deze inschrijving bestaat niet meer." }, 404);
    const catalog = (data.catalog || []).filter(item => item.active).map(({ id, name, image }) => ({ id, name, image: image || null, active: true }));
    const safeRegistrations = (data.registrations || []).map((item, index) => {
      if (item.id === registration.id) return registration;
      const sourceMembers = Array.isArray(item.members) ? item.members : [];
      const adults = sourceMembers.length
        ? sourceMembers.filter(person => person.type === "Volwassene").length
        : Math.max(0, Number(item.adults) || 0);
      const children = sourceMembers.length
        ? sourceMembers.filter(person => person.type === "Kind").length
        : Math.max(0, Number(item.children) || 0);
      const meat = sourceMembers.reduce((sum, person) =>
        sum + Object.values(person.orders || {}).reduce((memberSum, quantity) => memberSum + Math.max(0, Number(quantity) || 0), 0), 0);
      return {
        id: `anonymous-registration-${index}`,
        name: "",
        adults,
        children,
        members: [],
        aggregateCounts: { people: adults + children, adults, children, meat }
      };
    });
    return json({
      authenticated: true,
      edition: data.activeEvent,
      registration,
      registrations: safeRegistrations,
      expenses: (data.expenses || []).map(expense => ({
        amountCents: expense.amountCents,
        method: expense.method,
        advancedBy: expense.advancedBy === registration.id ? registration.id : null
      })),
      payments: (data.payments || []).filter(payment => payment.registrationId === registration.id),
      catalog,
      costsFinalized: Boolean(data.costsFinalized),
      revision: row.updated_at
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
    if (!Array.isArray(body?.members) || body.members.length > 30 || !Number.isSafeInteger(body.revision)) return json({ error: "Ongeldige ledenlijst of verouderde versie." }, 400);
    const stateRow = await env.DB.prepare("SELECT data_json, updated_at FROM app_state WHERE environment = ?").bind(session.edition_id).first();
    if (!stateRow) return json({ error: "De editie is niet beschikbaar." }, 404);
    if (stateRow.updated_at !== body.revision) return json({ error: "De gegevens zijn intussen gewijzigd. Herlaad de persoonlijke link en probeer opnieuw." }, 409);
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
    const updatedRow = await env.DB.prepare("UPDATE app_state SET data_json = ?, updated_at = MAX(updated_at + 1, ?) WHERE environment = ? AND updated_at = ? RETURNING updated_at")
      .bind(JSON.stringify(data), now, session.edition_id, body.revision).first();
    if (!updatedRow) return json({ error: "De gegevens zijn intussen gewijzigd. Herlaad de persoonlijke link en probeer opnieuw." }, 409);
    return json({ saved: true, registration, revision: updatedRow.updated_at });
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

  if (url.pathname === "/api/admin/family-invites" && request.method === "GET") {
    const session = await adminSession(request, env);
    if (!session) return json({ error: "Niet aangemeld." }, 401);
    const environment = url.searchParams.get("environment");
    if (!["test", "live"].includes(environment)) return json({ error: "Ongeldige omgeving." }, 400);
    let rows;
    let hasTokenColumn = true;
    try {
      rows = await env.DB.prepare(
        "SELECT id, edition_id, registration_id, token_value, created_at, expires_at, revoked_at, last_used_at FROM family_invites WHERE edition_id = ? ORDER BY created_at DESC"
      ).bind(environment).all();
    } catch {
      hasTokenColumn = false;
      rows = await env.DB.prepare(
        "SELECT id, edition_id, registration_id, created_at, expires_at, revoked_at, last_used_at FROM family_invites WHERE edition_id = ? ORDER BY created_at DESC"
      ).bind(environment).all();
    }
    const invites = await Promise.all((rows.results || []).map(async row => ({ ...row, token_value: hasTokenColumn ? await decryptInviteToken(row.token_value, env) : "" })));
    return json({ invites, migrationRequired: !hasTokenColumn });
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
    const existing = await env.DB.prepare("SELECT id, edition_id, registration_id, token_value, created_at FROM family_invites WHERE edition_id = ? AND registration_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC LIMIT 1").bind(edition, registrationId, now).first();
    if (existing?.token_value) {
      const existingToken = await decryptInviteToken(existing.token_value, env);
      if (existingToken) return json({ invite: { id: existing.id, edition_id: edition, registration_id: registrationId, created_at: existing.created_at }, url: `https://nieuwjaar.datuur.be/familie/${existingToken}`, reused: true });
    }
    if (existing) await env.DB.prepare("UPDATE family_invites SET revoked_at = ? WHERE id = ?").bind(now, existing.id).run();
    const inviteId = crypto.randomUUID();
    const token = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    const protectedToken = await encryptInviteToken(token, env);
    await env.DB.prepare("INSERT INTO family_invites (id, edition_id, registration_id, token_hash, token_value, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(inviteId, edition, registrationId, await sha256(token), protectedToken, now).run();
    return json({ invite: { id: inviteId, edition_id: edition, registration_id: registrationId, created_at: now }, url: `https://nieuwjaar.datuur.be/familie/${token}` }, 201);
  }

  if (url.pathname.startsWith("/api/admin/family-invites/") && request.method === "DELETE") {
    if (!sameOrigin(request)) return json({ error: "Ongeldige aanvraag." }, 403);
    const session = await adminSession(request, env);
    if (!session) return json({ error: "Niet aangemeld." }, 401);
    const inviteId = url.pathname.slice("/api/admin/family-invites/".length);
    const environment = url.searchParams.get("environment");
    if (!inviteId || inviteId.length > 80 || !["test", "live"].includes(environment)) return json({ error: "Ongeldige uitnodiging of omgeving." }, 400);
    const now = Math.floor(Date.now() / 1000);
    const result = await env.DB.prepare("UPDATE family_invites SET revoked_at = ? WHERE id = ? AND edition_id = ? AND revoked_at IS NULL")
      .bind(now, inviteId, environment).run();
    if (!result.meta?.changes) return json({ error: "Uitnodiging niet gevonden of al ingetrokken." }, 404);
    await env.DB.prepare("DELETE FROM family_sessions WHERE invite_id = ?").bind(inviteId).run();
    return json({ revoked: true });
  }

  if (url.pathname === "/api/admin/product-image" && request.method === "POST") {
    if (!sameOrigin(request)) return json({ error: "Ongeldige aanvraag." }, 403);
    if (!env.PHOTOS) return json({ error: "Foto-opslag is nog niet gekoppeld aan de Worker." }, 503);
    const session = await adminSession(request, env);
    if (!session) return json({ error: "Niet aangemeld." }, 401);
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    const productId = form?.get("productId");
    const environment = form?.get("environment");
    if (!(file instanceof File) || !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
        file.size < 1 || file.size > 5 * 1024 * 1024 ||
        typeof productId !== "string" || !/^[a-zA-Z0-9_-]{1,120}$/.test(productId) ||
        !["test", "live"].includes(environment)) {
      return json({ error: "Ongeldig afbeeldingsbestand. Gebruik JPG, PNG of WebP tot 5 MB." }, 400);
    }
    const extension = file.type === "image/jpeg" ? "jpg" : file.type === "image/png" ? "png" : "webp";
    const key = `products/${environment}/${productId}-${crypto.randomUUID()}.${extension}`;
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

  if (url.pathname === "/api/admin/state" && request.method === "GET") {
    const session = await adminSession(request, env);
    if (!session) return json({ error: "Niet aangemeld." }, 401);
    const rows = await env.DB.prepare("SELECT environment, data_json, updated_at FROM app_state").all();
    const environments = { test: null, live: null };
    const revisions = { test: null, live: null };
    for (const row of rows.results || []) {
      if (row.environment === "test" || row.environment === "live") {
        revisions[row.environment] = row.updated_at;
        try { environments[row.environment] = JSON.parse(row.data_json); }
        catch (error) { console.error("Invalid stored app state:", row.environment, error); }
      }
    }
    return json({ environments, revisions });
  }

  if (url.pathname === "/api/admin/state" && request.method === "PUT") {
    if (!sameOrigin(request)) return json({ error: "Ongeldige aanvraag." }, 403);
    const session = await adminSession(request, env);
    if (!session) return json({ error: "Niet aangemeld." }, 401);
    const body = await request.json().catch(() => null);
    const environment = body?.environment;
    const data = body?.data;
    const revision = body?.revision;
    if (!["test", "live"].includes(environment) || !data || typeof data !== "object" || Array.isArray(data) ||
        !data.activeEvent || typeof data.activeEvent !== "object" ||
        !Array.isArray(data.registrations) || !Array.isArray(data.expenses) ||
        !Array.isArray(data.payments) || !Array.isArray(data.catalog) ||
        !Array.isArray(data.editionArchive) ||
        !(revision === null || Number.isSafeInteger(revision))) {
      return json({ error: "Ongeldige gegevensstructuur of opslagversie." }, 400);
    }
    const serialized = JSON.stringify(data);
    if (serialized.length > 1_500_000) return json({ error: "De gegevens zijn te groot om op te slaan." }, 413);
    const now = Math.floor(Date.now() / 1000);
    const saved = await env.DB.prepare(
      "INSERT INTO app_state (environment, data_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(environment) DO UPDATE SET data_json = excluded.data_json, updated_at = MAX(app_state.updated_at + 1, excluded.updated_at) WHERE app_state.updated_at = ? RETURNING updated_at"
    ).bind(environment, serialized, now, revision).first();
    if (!saved) return json({ error: "Deze editie is intussen gewijzigd. De lokale wijzigingen zijn niet opgeslagen. Herlaad de admin om conflicten te vermijden." }, 409);
    return json({ saved: true, environment, revision: saved.updated_at });
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
