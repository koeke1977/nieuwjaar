const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));

async function requireAdmin(request, env, dependencies) {
  const session = await dependencies.adminSession(request, env);
  return session || null;
}

export async function handleAdminEvents(request, env, url, dependencies) {
  const { json, sameOrigin, adminSession } = dependencies;
  if (!env.DB) return json({ error: "Database niet geconfigureerd." }, 503);
  if (!await requireAdmin(request, env, dependencies)) return json({ error: "Niet aangemeld." }, 401);
  if (request.method !== "GET" && !sameOrigin(request)) return json({ error: "Ongeldige aanvraag." }, 403);

  if (url.pathname === "/api/admin/events" && request.method === "GET") {
    try {
      const result = await env.DB.prepare(
        "SELECT e.id, e.slug, e.name, e.description, e.finance_strategy, e.status, e.created_at, e.updated_at, d.id AS edition_id, d.label AS edition_label, d.starts_at, d.ends_at, d.status AS edition_status FROM events e LEFT JOIN event_editions d ON d.event_id = e.id ORDER BY e.created_at DESC, d.starts_at DESC, d.created_at DESC"
      ).all();
      const events = new Map();
      for (const row of result.results || []) {
        if (!events.has(row.id)) events.set(row.id, {
          id: row.id, slug: row.slug, name: row.name, description: row.description,
          financeStrategy: row.finance_strategy, status: row.status, editions: []
        });
        if (row.edition_id) events.get(row.id).editions.push({
          id: row.edition_id, label: row.edition_label, startsAt: row.starts_at,
          endsAt: row.ends_at, status: row.edition_status
        });
      }
      return json({ events: [...events.values()] });
    } catch (error) {
      console.error("Events schema unavailable:", error);
      return json({ error: "De evenementenstructuur is nog niet beschikbaar. Voer eerst database-migratie 0007 uit." }, 503);
    }
  }

  if (url.pathname === "/api/admin/events" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const description = typeof body?.description === "string" ? body.description.trim() : "";
    const financeStrategy = body?.financeStrategy;
    if (!name || name.length > 100 || description.length > 1000 ||
        !["nieuwjaar", "per_person", "per_adult", "per_order", "none"].includes(financeStrategy)) {
      return json({ error: "Vul een geldige evenementnaam, beschrijving en verdeelmethode in." }, 400);
    }
    const slug = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
    if (!slug) return json({ error: "De evenementnaam kan niet als unieke code worden gebruikt." }, 400);
    const now = Math.floor(Date.now() / 1000);
    const id = crypto.randomUUID();
    try {
      await env.DB.prepare("INSERT INTO events (id, slug, name, description, finance_strategy, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)")
        .bind(id, slug, name, description, financeStrategy, now, now).run();
      return json({ created: true, event: { id, slug, name, description, financeStrategy, status: "active", editions: [] } }, 201);
    } catch (error) {
      const message = String(error?.message || "");
      if (/UNIQUE|constraint/i.test(message)) return json({ error: "Er bestaat al een evenement met dezelfde naam/code." }, 409);
      console.error("Event creation failed:", error);
      return json({ error: "Evenement kon niet worden aangemaakt. Controleer of migratie 0007 is uitgevoerd." }, 503);
    }
  }

  const eventMatch = url.pathname.match(/^\/api\/admin\/events\/([0-9a-f-]+)$/i);
  if (eventMatch && request.method === "PATCH") {
    const eventId = eventMatch[1];
    const body = await request.json().catch(() => null);
    const current = await env.DB.prepare("SELECT id, name, description, finance_strategy, status FROM events WHERE id = ?").bind(eventId).first();
    if (!current) return json({ error: "Evenement niet gevonden." }, 404);
    const name = typeof body?.name === "string" ? body.name.trim() : current.name;
    const description = typeof body?.description === "string" ? body.description.trim() : current.description;
    const financeStrategy = body?.financeStrategy ?? current.finance_strategy;
    const status = body?.status ?? current.status;
    if (!name || name.length > 100 || description.length > 1000 ||
        !["nieuwjaar", "per_person", "per_adult", "per_order", "none"].includes(financeStrategy) ||
        !["draft", "active", "archived"].includes(status)) {
      return json({ error: "Ongeldige evenementgegevens of status." }, 400);
    }
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare("UPDATE events SET name = ?, description = ?, finance_strategy = ?, status = ?, updated_at = ? WHERE id = ?")
      .bind(name, description, financeStrategy, status, now, eventId).run();
    return json({ updated: true });
  }

  const editionMatch = url.pathname.match(/^\/api\/admin\/events\/([0-9a-f-]+)\/editions\/([0-9a-f-]+)$/i);
  if (editionMatch && request.method === "PATCH") {
    const [, eventId, editionId] = editionMatch;
    const body = await request.json().catch(() => null);
    const current = await env.DB.prepare("SELECT id, label, starts_at, ends_at, status FROM event_editions WHERE id = ? AND event_id = ?").bind(editionId, eventId).first();
    if (!current) return json({ error: "Editie niet gevonden." }, 404);
    const label = typeof body?.label === "string" ? body.label.trim() : current.label;
    const startsAt = body?.startsAt === undefined ? current.starts_at : (body.startsAt || null);
    const endsAt = body?.endsAt === undefined ? current.ends_at : (body.endsAt || null);
    const status = body?.status ?? current.status;
    if (!label || label.length > 100 || (startsAt && Number.isNaN(Date.parse(startsAt))) ||
        (endsAt && Number.isNaN(Date.parse(endsAt))) || (startsAt && endsAt && Date.parse(endsAt) < Date.parse(startsAt)) ||
        !["draft", "open", "closed", "archived"].includes(status)) {
      return json({ error: "Ongeldige editiegegevens of status." }, 400);
    }
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare("UPDATE event_editions SET label = ?, starts_at = ?, ends_at = ?, status = ?, updated_at = ? WHERE id = ? AND event_id = ?")
      .bind(label, startsAt, endsAt, status, now, editionId, eventId).run();
    return json({ updated: true });
  }

  const match = url.pathname.match(/^\/api\/admin\/events\/([0-9a-f-]+)\/editions$/i);
  if (match && request.method === "POST") {
    const eventId = match[1];
    const body = await request.json().catch(() => null);
    const label = typeof body?.label === "string" ? body.label.trim() : "";
    const startsAt = typeof body?.startsAt === "string" && body.startsAt ? body.startsAt : null;
    const endsAt = typeof body?.endsAt === "string" && body.endsAt ? body.endsAt : null;
    if (!label || label.length > 100 || (startsAt && Number.isNaN(Date.parse(startsAt))) ||
        (endsAt && Number.isNaN(Date.parse(endsAt))) || (startsAt && endsAt && Date.parse(endsAt) < Date.parse(startsAt))) {
      return json({ error: "Vul een geldige editienaam en datums in." }, 400);
    }
    const event = await env.DB.prepare("SELECT id FROM events WHERE id = ?").bind(eventId).first();
    if (!event) return json({ error: "Evenement niet gevonden." }, 404);
    const id = crypto.randomUUID(), now = Math.floor(Date.now() / 1000);
    try {
      await env.DB.prepare("INSERT INTO event_editions (id, event_id, label, starts_at, ends_at, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)")
        .bind(id, eventId, label, startsAt, endsAt, now, now).run();
      return json({ created: true, edition: { id, label, startsAt, endsAt, status: "draft" } }, 201);
    } catch (error) {
      console.error("Edition creation failed:", error);
      return json({ error: "Editie kon niet worden aangemaakt. Controleer de database-migratie." }, 503);
    }
  }

  if (url.pathname === "/api/admin/events/backfill-preview" && request.method === "GET") {
    try {
      const requiredTables = ["events", "event_editions", "families", "family_memberships", "event_registrations", "edition_finance_snapshots", "family_users", "family_user_registrations", "app_state"];
      const tableRows = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
      const availableTables = new Set((tableRows.results || []).map(row => row.name));
      const missingTables = requiredTables.filter(name => !availableTables.has(name));
      if (missingTables.length) return json({ readOnly: true, canBackfill: false, missingTables, error: "De databasestructuur is nog niet volledig gemigreerd. Er is niets gewijzigd." }, 409);
      const states = await env.DB.prepare("SELECT environment, data_json, updated_at FROM app_state ORDER BY environment").all();
      const links = await env.DB.prepare("SELECT user_id, edition_id, registration_id, COUNT(*) AS account_count FROM family_user_registrations GROUP BY user_id, edition_id, registration_id").all();
      const linkCounts = new Map();
      const accountIds = new Set();
      for (const row of links.results || []) {
        const key = row.edition_id + ":" + row.registration_id;
        linkCounts.set(key, (linkCounts.get(key) || 0) + 1);
        accountIds.add(row.user_id);
      }
      const knownUsersResult = await env.DB.prepare("SELECT id FROM family_users").all();
      const knownUsers = new Set((knownUsersResult.results || []).map(row => row.id));
      const orphanedAccounts = (links.results || []).filter(row => !knownUsers.has(row.user_id)).length;
      const environments = [];
      let totalRegistrations = 0, linkedRegistrations = 0, orphanedLinks = 0, totalAccounts = 0;
      const validationErrors = [];
      for (const row of states.results || []) {
        let data;
        try { data = JSON.parse(row.data_json); } catch { validationErrors.push("Ongeldige JSON in omgeving " + row.environment); continue; }
        if (!data || typeof data !== "object" || Array.isArray(data)) { validationErrors.push("Ongeldige gegevensstructuur in omgeving " + row.environment); continue; }
        const registrations = Array.isArray(data.registrations) ? data.registrations : [];
        const ids = new Set();
        for (const item of registrations) {
          if (!item || typeof item.id !== "string" || !item.id.trim()) validationErrors.push("Inschrijving zonder geldige ID in " + row.environment);
          else if (ids.has(item.id)) validationErrors.push("Dubbele inschrijvings-ID " + item.id + " in " + row.environment);
          else ids.add(item.id);
        }
        const linked = registrations.filter(item => linkCounts.has(row.environment + ":" + item.id));
        const accountCount = linked.reduce((sum, item) => sum + linkCounts.get(row.environment + ":" + item.id), 0);
        const knownLinks = [...linkCounts.keys()].filter(key => key.startsWith(row.environment + ":"));
        const orphaned = knownLinks.filter(key => !ids.has(key.slice(row.environment.length + 1))).length;
        totalRegistrations += registrations.length;
        linkedRegistrations += linked.length;
        totalAccounts += accountCount;
        orphanedLinks += orphaned;
        environments.push({
          environment: row.environment,
          eventName: String(data.activeEvent?.name || data.activeEvent?.title || "Onbenoemd evenement"),
          revision: row.updated_at,
          registrations: registrations.length,
          registrationsWithAccounts: linked.length,
          accountLinks: accountCount,
          registrationsWithoutAccounts: registrations.length - linked.length,
          orphanedRegistrationLinks: orphaned
        });
      }
      const users = await env.DB.prepare("SELECT COUNT(*) AS count FROM family_users").first();
      if (orphanedAccounts) validationErrors.push(orphanedAccounts + " accountkoppelingen verwijzen naar niet-bestaande accounts.");
      const unsupportedLinks = (links.results || []).filter(row => !["test", "live"].includes(row.edition_id)).length;
      if (unsupportedLinks) validationErrors.push(unsupportedLinks + " accountkoppelingen verwijzen naar onbekende oude omgevingen.");
      return json({
        readOnly: true,
        environments,
        canBackfill: validationErrors.length === 0 && orphanedLinks === 0,
        validationErrors,
        totals: {
          familyAccounts: Number(users?.count) || 0,
          registrations: totalRegistrations,
          registrationsWithAccounts: linkedRegistrations,
          registrationsWithoutAccounts: totalRegistrations - linkedRegistrations,
          accountLinks: totalAccounts,
          orphanedRegistrationLinks: orphanedLinks,
          orphanedAccountLinks: orphanedAccounts,
          unsupportedEnvironmentLinks: unsupportedLinks
        }
      });
    } catch (error) {
      console.error("Backfill preview failed:", error);
      return json({ error: "De migratiecontrole kon niet worden uitgevoerd. Controleer of migraties 0005 en 0007 aanwezig zijn." }, 503);
    }
  }

  if (url.pathname === "/api/admin/events/backfill" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    if (body?.confirm !== "MIGRATE LEGACY DATA") {
      return json({ error: "Expliciete bevestiging ontbreekt. Er is niets gewijzigd." }, 400);
    }
    try {
      // Repeat critical preflight checks here: the UI preview is not a security boundary.
      const requiredTables = ["events", "event_editions", "families", "family_memberships", "event_registrations", "edition_finance_snapshots", "family_users", "family_user_registrations", "app_state"];
      const tableRows = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
      const availableTables = new Set((tableRows.results || []).map(row => row.name));
      const missingTables = requiredTables.filter(name => !availableTables.has(name));
      if (missingTables.length) return json({ error: "Ontbrekende databasetabellen: " + missingTables.join(", ") + ". Er is niets gewijzigd." }, 409);
      const states = await env.DB.prepare("SELECT environment, data_json, updated_at FROM app_state ORDER BY environment").all();
      const links = await env.DB.prepare("SELECT user_id, edition_id, registration_id, created_at FROM family_user_registrations ORDER BY id").all();
      const linkRows = links.results || [];
      const users = await env.DB.prepare("SELECT id FROM family_users").all();
      const knownUsers = new Set((users.results || []).map(row => row.id));
      const stateByEnvironment = new Map((states.results || []).map(row => [row.environment, row]));
      const unsupportedStates = [...stateByEnvironment.keys()].filter(environment => !["test", "live"].includes(environment));
      if (unsupportedStates.length) return json({ error: "Niet-ondersteunde omgevingen: " + unsupportedStates.join(", ") + ". Er is niets gewijzigd." }, 409);
      if (!["test", "live"].every(environment => stateByEnvironment.has(environment))) return json({ error: "Zowel test als live moet aanwezig zijn. Er is niets gewijzigd." }, 409);
      if (linkRows.some(row => !knownUsers.has(row.user_id))) return json({ error: "Accountkoppelingen naar ontbrekende accounts gevonden. Er is niets gewijzigd." }, 409);
      const parsedStates = new Map();
      for (const [environment, row] of stateByEnvironment) {
        let data;
        try { data = JSON.parse(row.data_json); } catch { return json({ error: "Ongeldige JSON in " + environment + ". Er is niets gewijzigd." }, 409); }
        if (!data || typeof data !== "object" || Array.isArray(data) || !Array.isArray(data.registrations) || !Array.isArray(data.expenses || []) || !Array.isArray(data.payments || [])) return json({ error: "Ongeldige gegevensstructuur in " + environment + ". Er is niets gewijzigd." }, 409);
        const ids = new Set();
        for (const item of data.registrations) {
          if (!item || typeof item.id !== "string" || !item.id.trim() || ids.has(item.id)) return json({ error: "Ongeldige of dubbele inschrijvings-ID in " + environment + ". Er is niets gewijzigd." }, 409);
          ids.add(item.id);
        }
        parsedStates.set(environment, data);
      }
      for (const link of linkRows) {
        const data = parsedStates.get(link.edition_id);
        if (!data || !data.registrations.some(item => item.id === link.registration_id)) return json({ error: "Accountkoppeling naar ontbrekende inschrijving in " + link.edition_id + ". Er is niets gewijzigd." }, 409);
      }
      const existingTargets = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM events WHERE id IN ('legacy-event-test','legacy-event-live')) + (SELECT COUNT(*) FROM event_editions WHERE id IN ('legacy-edition-test','legacy-edition-live')) + (SELECT COUNT(*) FROM edition_finance_snapshots WHERE edition_id IN ('legacy-edition-test','legacy-edition-live')) + (SELECT COUNT(*) FROM families WHERE id LIKE 'legacy-family-test-%' OR id LIKE 'legacy-family-live-%') + (SELECT COUNT(*) FROM event_registrations WHERE id LIKE 'legacy-registration-test-%' OR id LIKE 'legacy-registration-live-%') + (SELECT COUNT(*) FROM family_memberships WHERE id LIKE 'legacy-membership-test-%' OR id LIKE 'legacy-membership-live-%') AS count").first();
      if (Number(existingTargets?.count || 0) > 0) return json({ error: "Doelrecords van een eerdere of gedeeltelijke overname bestaan al. Eerst expliciet reconciliëren; er is niets gewijzigd." }, 409);
      const knownUsers = new Set((users.results || []).map(row => row.id));
      if (linkRows.some(row => !knownUsers.has(row.user_id))) {
        return json({ error: "Er bestaan accountkoppelingen naar ontbrekende accounts. Herstel die eerst; er is niets gewijzigd." }, 409);
      }
      const statements = [];
      const now = Math.floor(Date.now() / 1000);
      const migrated = [];
      for (const row of states.results || []) {
        if (!["test", "live"].includes(row.environment)) continue;
        const data = parsedStates.get(row.environment);
        const envId = row.environment;
        const eventId = "legacy-event-" + envId;
        const editionId = "legacy-edition-" + envId;
        const eventName = String(data.activeEvent?.name || data.activeEvent?.title || (envId === "live" ? "Nieuwjaar" : "Nieuwjaar (test)")).slice(0,100);
        const financeStrategy = "nieuwjaar";
        statements.push(env.DB.prepare("INSERT OR IGNORE INTO events (id, slug, name, description, finance_strategy, settings_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, '{}', 'active', ?, ?)")
          .bind(eventId, "nieuwjaar-" + envId, eventName, "Overgenomen uit de bestaande " + envId + "-omgeving.", financeStrategy, now, now));
        statements.push(env.DB.prepare("INSERT OR IGNORE INTO event_editions (id, event_id, label, status, config_json, created_at, updated_at) VALUES (?, ?, ?, 'open', '{}', ?, ?)")
          .bind(editionId, eventId, eventName, now, now));
        statements.push(env.DB.prepare("INSERT OR IGNORE INTO edition_finance_snapshots (edition_id, expenses_json, payments_json, costs_finalized, costs_finalized_at, source_environment, source_revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(editionId, JSON.stringify(data.expenses || []), JSON.stringify(data.payments || []), data.costsFinalized ? 1 : 0, data.costsFinalizedAt || null, envId, row.updated_at, now, now));
        const registrations = Array.isArray(data.registrations) ? data.registrations : [];
        for (const registration of registrations) {
          if (!registration || typeof registration.id !== "string" || !registration.id) {
            return json({ error: "Een inschrijving in " + envId + " heeft geen geldige ID. Er is niets gewijzigd." }, 400);
          }
          const familyId = "legacy-family-" + envId + "-" + registration.id;
          const registrationId = "legacy-registration-" + envId + "-" + registration.id;
          const displayName = String(registration.name || "Inschrijving").slice(0,160);
          statements.push(env.DB.prepare("INSERT OR IGNORE INTO families (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)")
            .bind(familyId, displayName, now, now));
          statements.push(env.DB.prepare("INSERT OR IGNORE INTO event_registrations (id, edition_id, family_id, status, data_json, legacy_environment, legacy_registration_id, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)")
            .bind(registrationId, editionId, familyId, JSON.stringify(registration), envId, registration.id, now, now));
          for (const link of linkRows.filter(item => item.edition_id === envId && item.registration_id === registration.id)) {
            statements.push(env.DB.prepare("INSERT OR IGNORE INTO family_memberships (id, family_id, user_id, role, created_at) VALUES (?, ?, ?, 'editor', ?)")
              .bind("legacy-membership-" + envId + "-" + registration.id + "-" + link.user_id, familyId, link.user_id, link.created_at || now));
          }
        }
        migrated.push({ environment: envId, registrations: registrations.length, accountLinks: linkRows.filter(item => item.edition_id === envId).length, sourceRevision: row.updated_at });
      }
      if (!migrated.length) return json({ error: "Geen bestaande omgevingen gevonden om over te nemen." }, 404);
      // D1 batch is transactional: all inserts succeed together or none are committed.
      await env.DB.batch(statements);
      return json({ migrated, statements: statements.length, sourceDataPreserved: true });
    } catch (error) {
      console.error("Legacy data backfill failed:", error);
      return json({ error: "De gegevensovername is mislukt. Controleer de database en herhaal de controle; de bestaande app_state is niet aangepast." }, 503);
    }
  }

  return json({ error: "Niet gevonden." }, 404);
}
