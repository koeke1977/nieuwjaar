const encoder = new TextEncoder();
const FAMILY_ACCOUNT_COOKIE = "ny_family_account";
const FAMILY_ACCOUNT_TTL_SECONDS = 7 * 24 * 60 * 60;

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 310000;
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, 256);
  return "pbkdf2$" + iterations + "$" + base64Url(salt) + "$" + base64Url(new Uint8Array(bits));
}

async function verifyFamilyPassword(password, stored) {
  const [scheme, iterationsText, saltText, expected] = String(stored || "").split("$");
  const iterations = Number(iterationsText);
  if (scheme !== "pbkdf2" || !Number.isInteger(iterations) || iterations < 100000 || iterations > 1000000 || !saltText || !expected) return false;
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

async function familyAccountSession(request, env, cookieValue, sha256) {
  const token = cookieValue(request, FAMILY_ACCOUNT_COOKIE);
  if (!token) return null;
  return env.DB.prepare(
    "SELECT s.id AS session_id, s.user_id, s.expires_at, u.email, u.display_name, u.status FROM family_user_sessions s JOIN family_users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND s.revoked_at IS NULL AND u.status = 'active'"
  ).bind(await sha256(token), Math.floor(Date.now() / 1000)).first();
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
    const user = await env.DB.prepare("SELECT id, password_hash, status FROM family_users WHERE email = ?").bind(email).first();
    const valid = user?.status === "active" && user.password_hash ? await verifyFamilyPassword(password, user.password_hash) : false;
    if (!valid) return json({ error: "E-mailadres of wachtwoord is niet correct." }, 401);
    const token = await createFamilyAccountSession(env, user.id, now, sha256, base64Url);
    await env.DB.prepare("UPDATE family_users SET last_login_at = ?, updated_at = ? WHERE id = ?").bind(now, now, user.id).run();
    return json({ authenticated: true }, 200, { "Set-Cookie": familyAccountCookie(token, FAMILY_ACCOUNT_TTL_SECONDS) });
  }

  if (path === "/api/family-account/session" && request.method === "GET") {
    const session = await familyAccountSession(request, env, cookieValue, sha256);
    if (!session) return json({ authenticated: false }, 200, { "Set-Cookie": familyAccountCookie("", 0) });
    const links = await env.DB.prepare(
      "SELECT edition_id, registration_id FROM family_user_registrations WHERE user_id = ? ORDER BY edition_id"
    ).bind(session.user_id).all();
    const registrations = [];
    const catalogByEdition = {};
    for (const link of links.results || []) {
      const stateRow = await env.DB.prepare("SELECT data_json, updated_at FROM app_state WHERE environment = ?").bind(link.edition_id).first();
      if (!stateRow) continue;
      let data;
      try { data = JSON.parse(stateRow.data_json); } catch { continue; }
      const registration = (data.registrations || []).find(item => item.id === link.registration_id);
      if (!registration) continue;
      catalogByEdition[link.edition_id] = (data.catalog || []).filter(item => item.active).map(item => ({
        id: item.id, name: item.name, image: item.image || null
      }));
      registrations.push({
        edition: link.edition_id,
        event: data.activeEvent?.name || data.activeEvent?.title || "Nieuwjaar",
        registration: {
          id: registration.id,
          name: registration.name || "",
          adults: Math.max(0, Number(registration.adults) || 0),
          children: Math.max(0, Number(registration.children) || 0),
          members: (registration.members || []).map(person => ({
            id: person.id, name: person.name, type: person.type,
            orders: person.orders && typeof person.orders === "object" ? person.orders : {}
          }))
        },
        catalog: catalogByEdition[link.edition_id],
        revision: stateRow.updated_at
      });
    }
    return json({ authenticated: true, user: { email: session.email, displayName: session.display_name }, registrations });
  }

  if (path === "/api/family-account/registration" && request.method === "PUT") {
    if (!sameOrigin(request)) return json({ error: "Ongeldige aanvraag." }, 403);
    const session = await familyAccountSession(request, env, cookieValue, sha256);
    if (!session) return json({ error: "Je sessie is verlopen. Meld je opnieuw aan." }, 401);
    const body = await request.json().catch(() => null);
    const edition = body?.edition;
    const registrationId = typeof body?.registrationId === "string" ? body.registrationId : "";
    if (!["test", "live"].includes(edition) || !registrationId || !Number.isSafeInteger(body?.revision) ||
        !Array.isArray(body?.members) || body.members.length < 1 || body.members.length > 30) {
      return json({ error: "Ongeldige inschrijvingsgegevens." }, 400);
    }
    const linked = await env.DB.prepare(
      "SELECT 1 AS linked FROM family_user_registrations WHERE user_id = ? AND edition_id = ? AND registration_id = ?"
    ).bind(session.user_id, edition, registrationId).first();
    if (!linked) return json({ error: "Deze inschrijving is niet aan je account gekoppeld." }, 403);
    const stateRow = await env.DB.prepare("SELECT data_json, updated_at FROM app_state WHERE environment = ?").bind(edition).first();
    if (!stateRow) return json({ error: "De editie is niet beschikbaar." }, 404);
    if (stateRow.updated_at !== body.revision) return json({ error: "De gegevens zijn intussen gewijzigd. Herlaad de pagina en probeer opnieuw." }, 409);
    let data;
    try { data = JSON.parse(stateRow.data_json); } catch { return json({ error: "De editiegegevens zijn ongeldig." }, 500); }
    const registration = (data.registrations || []).find(item => item.id === registrationId);
    if (!registration) return json({ error: "Deze inschrijving bestaat niet meer." }, 404);
    const catalog = (data.catalog || []).filter(item => item.active);
    const catalogIds = new Set(catalog.map(item => item.id));
    const memberIds = new Set();
    const members = [];
    for (const person of body.members) {
      if (!person || typeof person.id !== "string" || !person.id || person.id.length > 100 ||
          typeof person.name !== "string" || !person.name.trim() || person.name.trim().length > 80 ||
          !["Volwassene", "Kind"].includes(person.type)) {
        return json({ error: "Controleer de namen en categorieën van alle gezinsleden." }, 400);
      }
      if (memberIds.has(person.id)) return json({ error: "Een gezinslid komt meer dan één keer voor." }, 400);
      memberIds.add(person.id);
      const orders = { ...(person.orders && typeof person.orders === "object" && !Array.isArray(person.orders) ? person.orders : {}) };
      for (const productId of catalogIds) {
        const quantity = Number(orders[productId] ?? 0);
        if (!Number.isInteger(quantity) || quantity < 0 || quantity > 99) {
          return json({ error: "Ongeldig aantal in de vleesbestelling." }, 400);
        }
        orders[productId] = quantity;
      }
      members.push({ id: person.id, name: person.name.trim(), type: person.type, orders });
    }
    registration.members = members;
    registration.adults = members.filter(person => person.type === "Volwassene").length;
    registration.children = members.filter(person => person.type === "Kind").length;
    data.costsFinalized = false;
    data.costsFinalizedAt = null;
    const updated = await env.DB.prepare(
      "UPDATE app_state SET data_json = ?, updated_at = MAX(updated_at + 1, ?) WHERE environment = ? AND updated_at = ? RETURNING updated_at"
    ).bind(JSON.stringify(data), now, edition, body.revision).first();
    if (!updated) return json({ error: "De gegevens zijn intussen gewijzigd. Herlaad de pagina en probeer opnieuw." }, 409);
    return json({ saved: true, revision: updated.updated_at, registration });
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
    const passwordHash = await hashPassword(password);
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
    const consumed = await env.DB.prepare("UPDATE family_password_resets SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ? RETURNING user_id").bind(now, reset.id, now).first();
    if (!consumed) return json({ error: "Deze resetlink is al gebruikt of verlopen." }, 400);
    await env.DB.prepare("UPDATE family_users SET password_hash = ?, updated_at = ? WHERE id = ? AND status = 'active'").bind(await hashPassword(password), now, reset.user_id).run();
    await env.DB.prepare("UPDATE family_user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(now, reset.user_id).run();
    return json({ reset: true }, 200, { "Set-Cookie": familyAccountCookie("", 0) });
  }

  return json({ error: "Niet gevonden." }, 404);
}
