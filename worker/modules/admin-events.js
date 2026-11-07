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
      const states = await env.DB.prepare("SELECT environment, data_json, updated_at FROM app_state ORDER BY environment").all();
      const links = await env.DB.prepare("SELECT edition_id, registration_id, COUNT(*) AS account_count FROM family_user_registrations GROUP BY edition_id, registration_id").all();
      const linkCounts = new Map((links.results || []).map(row => [row.edition_id + ":" + row.registration_id, Number(row.account_count) || 0]));
      const environments = [];
      let totalRegistrations = 0, linkedRegistrations = 0, orphanedLinks = 0, totalAccounts = 0;
      for (const row of states.results || []) {
        let data;
        try { data = JSON.parse(row.data_json); } catch { return json({ error: "De opgeslagen gegevens van " + row.environment + " zijn geen geldige JSON. Er is niets gewijzigd." }, 500); }
        const registrations = Array.isArray(data.registrations) ? data.registrations : [];
        const ids = new Set(registrations.map(item => item.id));
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
      return json({
        readOnly: true,
        environments,
        totals: {
          familyAccounts: Number(users?.count) || 0,
          registrations: totalRegistrations,
          registrationsWithAccounts: linkedRegistrations,
          registrationsWithoutAccounts: totalRegistrations - linkedRegistrations,
          accountLinks: totalAccounts,
          orphanedRegistrationLinks: orphanedLinks
        }
      });
    } catch (error) {
      console.error("Backfill preview failed:", error);
      return json({ error: "De migratiecontrole kon niet worden uitgevoerd. Controleer of migraties 0005 en 0007 aanwezig zijn." }, 503);
    }
  }

  return json({ error: "Niet gevonden." }, 404);
}
