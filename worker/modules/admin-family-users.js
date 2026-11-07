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
    let result;
    try {
      result = await env.DB.prepare(
        "SELECT u.id, u.email, u.display_name, u.status, u.created_at, u.updated_at, u.last_login_at, r.id AS link_id, r.edition_id, r.registration_id, (SELECT fm.role FROM family_memberships fm JOIN event_registrations er ON er.family_id = fm.family_id WHERE fm.user_id = u.id AND er.legacy_environment = r.edition_id AND er.legacy_registration_id = r.registration_id LIMIT 1) AS membership_role FROM family_users u LEFT JOIN family_user_registrations r ON r.user_id = u.id AND r.edition_id = ? ORDER BY u.email COLLATE NOCASE, r.registration_id"
      ).bind(environment).all();
    } catch (error) {
      if (!String(error?.message || "").toLowerCase().includes("no such table")) throw error;
      result = await env.DB.prepare(
        "SELECT u.id, u.email, u.display_name, u.status, u.created_at, u.updated_at, u.last_login_at, r.id AS link_id, r.edition_id, r.registration_id, 'editor' AS membership_role FROM family_users u LEFT JOIN family_user_registrations r ON r.user_id = u.id AND r.edition_id = ? ORDER BY u.email COLLATE NOCASE, r.registration_id"
      ).bind(environment).all();
    }
    const users = new Map();
    for (const row of result.results || []) {
      if (!users.has(row.id)) users.set(row.id, {
        id: row.id, email: row.email, displayName: row.display_name, status: row.status,
        createdAt: row.created_at, lastLoginAt: row.last_login_at, registrations: []
      });
      if (row.link_id) users.get(row.id).registrations.push({
        linkId: row.link_id, registrationId: row.registration_id, environment: row.edition_id, role: row.membership_role || "editor"
      });
    }
    return json({ users: [...users.values()], environment });
  }

  const registrationEditMatch = path.match(/^\\/api\\/admin\\/families\\/registrations\\/([^/]+)$/);
  if (registrationEditMatch && request.method === "PUT") {
    if (!sameOrigin(request)) return json({ error: "Ongeldige aanvraag." }, 403);
    const registrationId = decodeURIComponent(registrationEditMatch[1]);
    const body = await request.json().catch(() => null);
    if (!body || !Number.isSafeInteger(body.revision) || typeof body.name !== "string" ||
        !body.name.trim() || body.name.trim().length > 160 || !Array.isArray(body.members) ||
        body.members.length > 30) {
      return json({ error: "Controleer de inschrijvingsnaam en de gezinsleden." }, 400);
    }
    const row = await env.DB.prepare(
      "SELECT er.id, er.data_json, er.updated_at, er.status, er.legacy_environment, er.legacy_registration_id, d.status AS edition_status, e.status AS event_status, d.config_json FROM event_registrations er JOIN event_editions d ON d.id = er.edition_id JOIN events e ON e.id = d.event_id WHERE er.id = ?"
    ).bind(registrationId).first();
    if (!row) return json({ error: "Inschrijving niet gevonden." }, 404);
    if (row.legacy_environment || row.legacy_registration_id) {
      return json({ error: "Deze historische inschrijving blijft voorlopig alleen-lezen om de oude gegevens en accountkoppelingen te beschermen." }, 409);
    }
    if (row.status === "deleted" || row.edition_status === "archived" || row.edition_status === "closed" || row.event_status === "archived") {
      return json({ error: "Deze inschrijving behoort tot een afgesloten editie en kan niet worden aangepast." }, 409);
    }
    if (Number(row.updated_at) !== body.revision) {
      return json({ error: "De inschrijving is intussen gewijzigd. Herlaad de gegevens en probeer opnieuw." }, 409);
    }
    let registration, config;
    try {
      registration = JSON.parse(row.data_json || "{}");
      config = JSON.parse(row.config_json || "{}");
    } catch {
      return json({ error: "De opgeslagen inschrijvingsgegevens zijn ongeldig. Er is niets gewijzigd." }, 500);
    }
    const catalog = (Array.isArray(config.catalog) ? config.catalog : Array.isArray(registration.catalog) ? registration.catalog : [])
      .filter(product => product && typeof product.id === "string" && product.active !== false);
    const catalogIds = new Set(catalog.map(product => product.id));
    const seen = new Set(), members = [];
    for (const person of body.members) {
      if (!person || typeof person.id !== "string" || !person.id || person.id.length > 100 ||
          typeof person.name !== "string" || !person.name.trim() || person.name.trim().length > 80 ||
          !["Volwassene", "Kind"].includes(person.type) || seen.has(person.id)) {
        return json({ error: "Controleer alle unieke gezinsleden, namen en categorieën." }, 400);
      }
      seen.add(person.id);
      const sourceOrders = person.orders && typeof person.orders === "object" && !Array.isArray(person.orders) ? person.orders : {};
      const orders = {};
      for (const [productId, rawQuantity] of Object.entries(sourceOrders)) {
        if (!catalogIds.has(productId)) continue;
        const quantity = Number(rawQuantity);
        if (!Number.isInteger(quantity) || quantity < 0 || quantity > 99) {
          return json({ error: "Een productaantal moet tussen 0 en 99 liggen." }, 400);
        }
        orders[productId] = quantity;
      }
      for (const productId of catalogIds) if (!(productId in orders)) orders[productId] = 0;
      members.push({ id: person.id, name: person.name.trim(), type: person.type, orders });
    }
    registration.name = body.name.trim();
    registration.members = members;
    registration.adults = members.filter(person => person.type === "Volwassene").length;
    registration.children = members.filter(person => person.type === "Kind").length;
    const updated = await env.DB.prepare(
      "UPDATE event_registrations SET data_json = ?, updated_at = MAX(updated_at + 1, ?) WHERE id = ? AND updated_at = ? AND legacy_environment IS NULL AND legacy_registration_id IS NULL RETURNING updated_at"
    ).bind(JSON.stringify(registration), now, registrationId, body.revision).first();
    if (!updated) return json({ error: "De inschrijving is intussen gewijzigd. Herlaad de gegevens en probeer opnieuw." }, 409);
    return json({ saved: true, revision: updated.updated_at, registration: {
      id: registrationId, name: registration.name, adults: registration.adults, children: registration.children, members: registration.members
    } });
  }

  if (path === "/api/admin/families" && request.method === "GET") {
    try {
      const rows = await env.DB.prepare(
        "SELECT f.id AS family_id, f.display_name AS family_name, f.contact_email, f.created_at AS family_created_at, er.id AS registration_id, er.status AS registration_status, er.data_json, er.updated_at AS registration_updated_at, er.legacy_environment, er.legacy_registration_id, d.id AS edition_id, d.label AS edition_label, d.status AS edition_status, d.config_json AS edition_config_json, e.id AS event_id, e.name AS event_name, e.finance_strategy, fm.user_id, fm.role, u.email, u.display_name AS user_name, u.status AS user_status FROM families f LEFT JOIN event_registrations er ON er.family_id = f.id LEFT JOIN event_editions d ON d.id = er.edition_id LEFT JOIN events e ON e.id = d.event_id LEFT JOIN family_memberships fm ON fm.family_id = f.id LEFT JOIN family_users u ON u.id = fm.user_id ORDER BY f.display_name COLLATE NOCASE, e.name, d.label, u.email COLLATE NOCASE"
      ).all();
      const families = new Map();
      for (const row of rows.results || []) {
        if (!families.has(row.family_id)) families.set(row.family_id, {
          id: row.family_id, name: row.family_name, contactEmail: row.contact_email,
          createdAt: row.family_created_at, registrations: [], accounts: []
        });
        const family = families.get(row.family_id);
        if (row.registration_id && !family.registrations.some(item => item.id === row.registration_id)) {
          let data = {}, config = {};
          try { data = JSON.parse(row.data_json || "{}"); } catch { /* Ongeldige payload blijft zichtbaar als waarschuwing. */ }
          try { config = JSON.parse(row.edition_config_json || "{}"); } catch { /* Catalogus blijft leeg bij ongeldige configuratie. */ }
          const members = Array.isArray(data.members) ? data.members : [];
          const catalog = Array.isArray(config.catalog) ? config.catalog : [];
          family.registrations.push({
            id: row.registration_id, name: data.name || family.name, status: row.registration_status,
            editionId: row.edition_id, edition: row.edition_label, editionStatus: row.edition_status,
            eventId: row.event_id, event: row.event_name, financeStrategy: row.finance_strategy,
            members: members.slice(0, 30).map(person => ({
              id: typeof person?.id === "string" ? person.id : "",
              name: typeof person?.name === "string" ? person.name.slice(0, 80) : "Onbekend",
              type: person?.type === "Kind" ? "Kind" : person?.type === "Volwassene" ? "Volwassene" : "Onbekend",
              orders: person?.orders && typeof person.orders === "object" && !Array.isArray(person.orders)
                ? Object.fromEntries(Object.entries(person.orders).filter(([id, quantity]) =>
                    catalog.some(product => product?.id === id) && Number.isInteger(Number(quantity)) && Number(quantity) > 0
                  ).map(([id, quantity]) => [id, Math.min(99, Number(quantity))]))
                : {}
            })),
            catalog: catalog.filter(product => product && typeof product.id === "string").map(product => ({
              id: product.id, name: typeof product.name === "string" ? product.name.slice(0, 100) : product.id
            })),
            updatedAt: row.registration_updated_at,
            legacyReadOnly: Boolean(row.legacy_environment || row.legacy_registration_id),
            invalidData: !row.data_json || !Object.keys(data).length
          });
        }
        if (row.user_id && !family.accounts.some(item => item.id === row.user_id)) {
          family.accounts.push({
            id: row.user_id, email: row.email, displayName: row.user_name,
            status: row.user_status, role: row.role
          });
        }
      }
      return json({ families: [...families.values()] });
    } catch (error) {
      if (String(error?.message || "").toLowerCase().includes("no such table")) {
        return json({ error: "De relationele familiestructuur is nog niet gemigreerd." }, 503);
      }
      console.error("Normalized family overview failed:", error);
      return json({ error: "Het familieoverzicht kon niet worden geladen." }, 500);
    }
  }

  if (path === "/api/admin/families" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    const name = typeof body?.name === "string" ? body.name.trim().slice(0, 160) : "";
    const contactEmail = typeof body?.contactEmail === "string" ? body.contactEmail.trim().toLowerCase() : "";
    const editionId = typeof body?.editionId === "string" ? body.editionId.trim() : "";
    const registrationName = typeof body?.registrationName === "string" ? body.registrationName.trim().slice(0, 160) : name;
    const ownerName = typeof body?.ownerDisplayName === "string" ? body.ownerDisplayName.trim().slice(0, 100) : "";
    const ownerEmail = typeof body?.ownerEmail === "string" ? body.ownerEmail.trim().toLowerCase() : "";
    if (!name || !editionId || !registrationName || !ownerName || !validEmail(ownerEmail) ||
        (contactEmail && !validEmail(contactEmail))) {
      return json({ error: "Vul familienaam, editie, inschrijvingsnaam en de naam en het e-mailadres van de eerste beheerder in." }, 400);
    }
    const edition = await env.DB.prepare(
      "SELECT d.id, d.status, e.status AS event_status FROM event_editions d JOIN events e ON e.id = d.event_id WHERE d.id = ?"
    ).bind(editionId).first();
    if (!edition) return json({ error: "De gekozen editie bestaat niet." }, 404);
    if (edition.status === "archived" || edition.status === "closed" || edition.event_status === "archived") return json({ error: "Aan een gesloten of gearchiveerde editie kan je geen nieuwe inschrijving toevoegen." }, 409);
    const existingUser = await env.DB.prepare("SELECT id, status FROM family_users WHERE email = ?").bind(ownerEmail).first();
    if (existingUser?.status === "disabled") return json({ error: "Het gekozen beheeraccount is geblokkeerd. Activeer het eerst opnieuw." }, 409);
    const familyId = crypto.randomUUID(), registrationId = crypto.randomUUID(), now = Math.floor(Date.now() / 1000);
    const userId = existingUser?.id || crypto.randomUUID();
    const needsInvite = !existingUser || existingUser.status === "invited";
    const token = needsInvite ? base64Url(crypto.getRandomValues(new Uint8Array(32))) : "";
    const statements = [
      env.DB.prepare("INSERT INTO families (id, display_name, contact_email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .bind(familyId, name, contactEmail || ownerEmail, now, now),
      env.DB.prepare("INSERT INTO event_registrations (id, edition_id, family_id, status, data_json, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?, ?)")
        .bind(registrationId, editionId, familyId, JSON.stringify({ name: registrationName, adults: 0, children: 0, members: [] }), now, now)
    ];
    if (!existingUser) statements.push(env.DB.prepare("INSERT INTO family_users (id, email, display_name, status, created_at, updated_at) VALUES (?, ?, ?, 'invited', ?, ?)")
      .bind(userId, ownerEmail, ownerName, now, now));
    statements.push(env.DB.prepare("INSERT INTO family_memberships (id, family_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)")
      .bind(crypto.randomUUID(), familyId, userId, now));
    if (needsInvite) {
      statements.push(env.DB.prepare("UPDATE family_user_invites SET revoked_at = ? WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL").bind(now, userId));
      statements.push(env.DB.prepare("INSERT INTO family_user_invites (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), userId, await sha256(token), now, now + 7 * 24 * 60 * 60));
    }
    try {
      await env.DB.batch(statements);
    } catch (error) {
      console.error("Normalized family and owner creation failed:", error);
      if (/UNIQUE|constraint/i.test(String(error?.message || ""))) return json({ error: "Er bestaat al een familie-inschrijving voor deze editie of het beheeraccount kon niet uniek worden gekoppeld." }, 409);
      return json({ error: "Familie, inschrijving en eerste beheerder konden niet samen worden aangemaakt." }, 503);
    }
    if (needsInvite) {
      try {
        const inviteUrl = "https://nieuwjaar.datuur.be/familie/activeren/" + token;
        const html = '<div style="font-family:Arial,sans-serif;color:#242424;line-height:1.6"><h2>Toegang tot een familie-inschrijving</h2><p>Dag ' + escapeHtml(ownerName) + ',</p><p>Je bent als beheerder toegevoegd aan familie ' + escapeHtml(name) + '.</p><p><a href="' + inviteUrl + '">Activeer je account</a></p><p>Deze link is 7 dagen geldig.</p></div>';
        await sendGraphMail(env, ownerEmail, "Uitnodiging familieportaal – beheerder", html);
      } catch (error) {
        console.error("First family owner invitation mail failed:", error);
        return json({ created: true, invitePending: true, mailFailed: true, familyId, registrationId,
          warning: "De familie is aangemaakt met een beheerder, maar de uitnodigingsmail kon niet worden verzonden. Verstuur de uitnodiging opnieuw." }, 201);
      }
    }
    return json({ created: true, invitePending: needsInvite, family: { id: familyId, name, contactEmail: contactEmail || ownerEmail },
      registration: { id: registrationId, name: registrationName, editionId }, owner: { userId, email: ownerEmail, role: "owner" } }, 201);
  }

  const membershipMatch = path.match(/^\/api\/admin\/families\/([^/]+)\/memberships\/([^/]+)$/);
  if (membershipMatch && ["PATCH", "DELETE"].includes(request.method)) {
    const [, familyId, userId] = membershipMatch;
    const membership = await env.DB.prepare("SELECT role FROM family_memberships WHERE family_id = ? AND user_id = ?").bind(familyId, userId).first();
    if (!membership) return json({ error: "Familiekoppeling niet gevonden." }, 404);
    if (request.method === "PATCH") {
      const body = await request.json().catch(() => null);
      const role = body?.role;
      if (!["owner", "editor", "viewer"].includes(role)) return json({ error: "Ongeldige toegangsrol." }, 400);
      if (membership.role === "owner" && role !== "owner") {
        const owners = await env.DB.prepare("SELECT COUNT(*) AS total FROM family_memberships WHERE family_id = ? AND role = 'owner'").bind(familyId).first();
        if (Number(owners?.total || 0) <= 1) return json({ error: "De laatste beheerder kan niet worden gedegradeerd. Maak eerst een andere beheerder aan." }, 409);
      }
      await env.DB.prepare("UPDATE family_memberships SET role = ? WHERE family_id = ? AND user_id = ?").bind(role, familyId, userId).run();
      return json({ updated: true, role });
    }
    if (membership.role === "owner") {
      const owners = await env.DB.prepare("SELECT COUNT(*) AS total FROM family_memberships WHERE family_id = ? AND role = 'owner'").bind(familyId).first();
      if (Number(owners?.total || 0) <= 1) return json({ error: "De laatste beheerder kan niet worden losgekoppeld. Maak eerst een andere beheerder aan." }, 409);
    }
    await env.DB.prepare("DELETE FROM family_memberships WHERE family_id = ? AND user_id = ?").bind(familyId, userId).run();
    return json({ unlinked: true });
  }

  if (path === "/api/admin/families/memberships" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    const familyId = typeof body?.familyId === "string" ? body.familyId : "";
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const displayName = typeof body?.displayName === "string" ? body.displayName.trim().slice(0, 100) : "";
    const role = body?.role || "editor";
    if (!familyId || !validEmail(email) || !displayName || !["owner", "editor", "viewer"].includes(role)) {
      return json({ error: "Vul familie, naam, geldig e-mailadres en een geldige rol in." }, 400);
    }
    const family = await env.DB.prepare("SELECT id FROM families WHERE id = ?").bind(familyId).first();
    if (!family) return json({ error: "Familie niet gevonden." }, 404);
    let user = await env.DB.prepare("SELECT id, status FROM family_users WHERE email = ?").bind(email).first();
    let newlyCreatedUser = false;
    if (user?.status === "disabled") return json({ error: "Dit account is geblokkeerd. Activeer het eerst opnieuw." }, 409);
    if (!user) {
      const userId = crypto.randomUUID();
      try {
        await env.DB.prepare("INSERT INTO family_users (id, email, display_name, status, created_at, updated_at) VALUES (?, ?, ?, 'invited', ?, ?)")
          .bind(userId, email, displayName, now, now).run();
        user = { id: userId, status: "invited" };
        newlyCreatedUser = true;
      } catch (error) {
        console.error("Family invitation account creation failed:", error);
        return json({ error: "Het account kon niet worden aangemaakt." }, 503);
      }
    }
    try {
      await env.DB.prepare("INSERT INTO family_memberships (id, family_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), familyId, user.id, role, now).run();
    } catch (error) {
      if (newlyCreatedUser) {
        try { await env.DB.prepare("DELETE FROM family_users WHERE id = ?").bind(user.id).run(); } catch (cleanupError) { console.error("New account rollback failed:", cleanupError); }
      }
      if (/UNIQUE|constraint/i.test(String(error?.message || ""))) return json({ error: "Dit account is al aan deze familie gekoppeld." }, 409);
      console.error("Family membership creation failed:", error);
      return json({ error: "De familiekoppeling kon niet veilig worden opgeslagen." }, 503);
    }
    if (newlyCreatedUser || user.status === "invited") {
      const token = base64Url(crypto.getRandomValues(new Uint8Array(32)));
      const inviteId = crypto.randomUUID();
      try {
        await env.DB.batch([
          env.DB.prepare("UPDATE family_user_invites SET revoked_at = ? WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL").bind(now, user.id),
          env.DB.prepare("INSERT INTO family_user_invites (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
            .bind(inviteId, user.id, await sha256(token), now, now + 7 * 24 * 60 * 60)
        ]);
        const inviteUrl = "https://nieuwjaar.datuur.be/familie/activeren/" + token;
        const html = '<div style="font-family:Arial,sans-serif;color:#242424;line-height:1.6"><h2>Toegang tot een familie-inschrijving</h2><p>Dag ' + escapeHtml(displayName) + ',</p><p><a href="' + inviteUrl + '">Activeer je account</a></p><p>Deze link is 7 dagen geldig.</p></div>';
        await sendGraphMail(env, email, "Uitnodiging familieportaal", html);
      } catch (error) {
        console.error("Family membership invitation mail failed:", error);
        return json({ linked: true, invited: true, mailFailed: true, error: "De koppeling is opgeslagen, maar de uitnodigingsmail kon niet worden verzonden. Verstuur de uitnodiging opnieuw vanuit accountbeheer." }, 502);
      }
    }
    return json({ linked: true, userId: user.id, role, invited: newlyCreatedUser || user.status === "invited" }, 201);
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
    let newlyCreatedUser = false;
    if (user && user.status === "disabled") return json({ error: "Dit account is geblokkeerd. Activeer het eerst opnieuw via accountbeheer." }, 409);
    if (!user) {
      const id = crypto.randomUUID();
      await env.DB.prepare("INSERT INTO family_users (id, email, display_name, status, created_at, updated_at) VALUES (?, ?, ?, 'invited', ?, ?)")
        .bind(id, email, displayName, now, now).run();
      user = { id, status: "invited" };
      newlyCreatedUser = true;
    }
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
    try {
      await env.DB.batch([
        env.DB.prepare("UPDATE family_user_invites SET revoked_at = ? WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL").bind(now, userId),
        env.DB.prepare("INSERT INTO family_user_invites (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
          .bind(crypto.randomUUID(), userId, await sha256(token), now, now + 7 * 24 * 60 * 60)
      ]);
    } catch (error) {
      console.error("Family invitation token rotation failed:", error);
      return json({ error: "De activatielink kon niet veilig worden vernieuwd. De bestaande uitnodiging bleef behouden." }, 503);
    }
    let eventName = "het evenement";
    try {
      const normalizedEvent = await env.DB.prepare(
        "SELECT e.name AS event_name FROM family_memberships fm JOIN event_registrations er ON er.family_id = fm.family_id JOIN event_editions d ON d.id = er.edition_id JOIN events e ON e.id = d.event_id WHERE fm.user_id = ? ORDER BY er.updated_at DESC LIMIT 1"
      ).bind(userId).first();
      if (normalizedEvent?.event_name) eventName = normalizedEvent.event_name;
      else {
        const linkedEdition = await env.DB.prepare("SELECT edition_id FROM family_user_registrations WHERE user_id = ? ORDER BY created_at DESC LIMIT 1").bind(userId).first();
        const linkedState = linkedEdition ? await env.DB.prepare("SELECT data_json FROM app_state WHERE environment = ?").bind(linkedEdition.edition_id).first() : null;
        const linkedData = JSON.parse(linkedState?.data_json || "{}");
        eventName = String(linkedData.activeEvent?.name || linkedData.activeEvent?.title || eventName);
      }
    } catch (error) {
      console.warn("Could not resolve event name for invitation resend:", error.message);
    }
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

  if (action === "registrations" && request.method === "PATCH") {
    const body = await request.json().catch(() => null);
    const linkId = Number(body?.linkId);
    const role = body?.role;
    if (!Number.isSafeInteger(linkId) || linkId < 1 || !["owner", "editor", "viewer"].includes(role)) {
      return json({ error: "Ongeldige koppeling of toegangsrol." }, 400);
    }
    const link = await env.DB.prepare(
      "SELECT edition_id, registration_id FROM family_user_registrations WHERE id = ? AND user_id = ?"
    ).bind(linkId, userId).first();
    if (!link) return json({ error: "Accountkoppeling niet gevonden." }, 404);
    try {
      const relational = await env.DB.prepare(
        "SELECT family_id FROM event_registrations WHERE legacy_environment = ? AND legacy_registration_id = ?"
      ).bind(link.edition_id, link.registration_id).first();
      if (!relational?.family_id) return json({ error: "De relationele familiegegevens zijn nog niet overgenomen. Pas rollen pas aan na de gecontroleerde migratie." }, 409);
      await env.DB.prepare(
        "INSERT INTO family_memberships (id, family_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(family_id, user_id) DO UPDATE SET role = excluded.role"
      ).bind("legacy-membership-" + link.edition_id + "-" + link.registration_id + "-" + userId, relational.family_id, userId, role, now).run();
      return json({ updated: true, role });
    } catch (error) {
      if (!String(error?.message || "").toLowerCase().includes("no such table")) throw error;
      return json({ error: "De relationele toegangsrollen zijn nog niet beschikbaar. Voer eerst de gecontroleerde migratie uit." }, 503);
    }
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
