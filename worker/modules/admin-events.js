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
        "SELECT e.id, e.slug, e.name, e.description, e.finance_strategy, e.status, e.created_at, e.updated_at, d.id AS edition_id, d.label AS edition_label, d.starts_at, d.ends_at, d.status AS edition_status, d.config_json AS edition_config_json FROM events e LEFT JOIN event_editions d ON d.event_id = e.id ORDER BY e.created_at DESC, d.starts_at DESC, d.created_at DESC"
      ).all();
      const events = new Map();
      for (const row of result.results || []) {
        if (!events.has(row.id)) events.set(row.id, {
          id: row.id, slug: row.slug, name: row.name, description: row.description,
          financeStrategy: row.finance_strategy, status: row.status, editions: []
        });
        if (row.edition_id) events.get(row.id).editions.push({
          id: row.edition_id, label: row.edition_label, startsAt: row.starts_at,
          endsAt: row.ends_at, status: row.edition_status,
          catalog: (() => { try { const config = JSON.parse(row.edition_config_json || "{}"); return Array.isArray(config.catalog) ? config.catalog : []; } catch { return []; } })()
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

  const eventMatch = url.pathname.match(/^\/api\/admin\/events\/([A-Za-z0-9_-]+)$/);
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

  const financeMatch = url.pathname.match(/^\/api\/admin\/editions\/([A-Za-z0-9_-]+)\/finance$/);
  if (financeMatch && request.method === "GET") {
    const editionId = financeMatch[1];
    try {
      const edition = await env.DB.prepare(
        "SELECT d.id, d.label, d.config_json, e.name AS event_name, e.finance_strategy FROM event_editions d JOIN events e ON e.id = d.event_id WHERE d.id = ?"
      ).bind(editionId).first();
      if (!edition) return json({ error: "Editie niet gevonden." }, 404);
      const snapshot = await env.DB.prepare(
        "SELECT expenses_json, payments_json, costs_finalized, costs_finalized_at, source_environment, updated_at FROM edition_finance_snapshots WHERE edition_id = ?"
      ).bind(editionId).first();
      const registrations = await env.DB.prepare(
        "SELECT id, family_id, status, data_json, updated_at FROM event_registrations WHERE edition_id = ? AND status != 'cancelled' ORDER BY created_at, id"
      ).bind(editionId).all();
      let config = {};
      try { config = JSON.parse(edition.config_json || "{}"); } catch { return json({ error: "De editieconfiguratie is ongeldig." }, 409); }
      return json({
        edition: { id: edition.id, label: edition.label, eventName: edition.event_name, financeStrategy: edition.finance_strategy },
        registrations: (registrations.results || []).map(row => {
          let data = {};
          try { data = JSON.parse(row.data_json || "{}"); } catch {}
          return { id: row.id, familyId: row.family_id, status: row.status, name: String(data.name || "Inschrijving"), adults: Number(data.adults) || 0, children: Number(data.children) || 0, members: Array.isArray(data.members) ? data.members : [] };
        }),
        catalog: Array.isArray(config.catalog) ? config.catalog : [],
        finance: {
          expenses: (() => { try { return JSON.parse(snapshot?.expenses_json || "[]"); } catch { return []; } })(),
          payments: (() => { try { return JSON.parse(snapshot?.payments_json || "[]"); } catch { return []; } })(),
          costsFinalized: Boolean(snapshot?.costs_finalized),
          costsFinalizedAt: snapshot?.costs_finalized_at || null,
          revision: Number(snapshot?.updated_at) || 0,
          legacySnapshot: Boolean(snapshot?.source_environment)
        }
      });
    } catch (error) {
      console.error("Edition finance load failed:", error);
      return json({ error: "De financiële gegevens van deze editie konden niet worden geladen." }, 503);
    }
  }

  if (financeMatch && request.method === "PUT") {
    const editionId = financeMatch[1];
    const body = await request.json().catch(() => null);
    if (!Number.isSafeInteger(body?.revision) || !Array.isArray(body?.expenses) || !Array.isArray(body?.payments) ||
        body.expenses.length > 2000 || body.payments.length > 5000 || typeof body.costsFinalized !== "boolean") {
      return json({ error: "Ongeldige financiële gegevens of revisie." }, 400);
    }
    try {
      const edition = await env.DB.prepare("SELECT id FROM event_editions WHERE id = ?").bind(editionId).first();
      if (!edition) return json({ error: "Editie niet gevonden." }, 404);
      const registrationsResult = await env.DB.prepare(
        "SELECT id FROM event_registrations WHERE edition_id = ? AND status != 'cancelled'"
      ).bind(editionId).all();
      const registrationIds = new Set((registrationsResult.results || []).map(row => row.id));
      const ids = new Set();
      const expenses = [];
      for (const item of body.expenses) {
        if (!item || typeof item.id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(item.id) || ids.has(item.id) ||
            typeof item.description !== "string" || !item.description.trim() || item.description.trim().length > 120 ||
            !Number.isSafeInteger(item.amountCents) || item.amountCents <= 0 ||
            typeof item.date !== "string" || Number.isNaN(Date.parse(item.date)) ||
            !["general", "adults", "meat"].includes(item.method) || !registrationIds.has(item.advancedBy)) {
          return json({ error: "Een uitgave bevat ongeldige gegevens. Controleer omschrijving, bedrag, datum, verdeelsleutel en voorschieter." }, 400);
        }
        ids.add(item.id);
        expenses.push({ id: item.id, description: item.description.trim(), amountCents: item.amountCents, date: item.date, method: item.method, advancedBy: item.advancedBy });
      }
      ids.clear();
      const payments = [];
      for (const item of body.payments) {
        if (!item || typeof item.id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(item.id) || ids.has(item.id) ||
            !registrationIds.has(item.registrationId) || !Number.isSafeInteger(item.amountCents) || item.amountCents <= 0 ||
            typeof item.date !== "string" || Number.isNaN(Date.parse(item.date)) || !["cash", "bank"].includes(item.method)) {
          return json({ error: "Een betaling bevat ongeldige gegevens. Controleer inschrijving, bedrag, datum en betaalmethode." }, 400);
        }
        ids.add(item.id);
        payments.push({ id: item.id, registrationId: item.registrationId, amountCents: item.amountCents, date: item.date, method: item.method });
      }
      const current = await env.DB.prepare(
        "SELECT updated_at, source_environment FROM edition_finance_snapshots WHERE edition_id = ?"
      ).bind(editionId).first();
      if (current?.source_environment) return json({ error: "Deze financiële snapshot komt uit de historische Nieuwjaar-overname en blijft ongewijzigd." }, 409);
      if ((Number(current?.updated_at) || 0) !== body.revision) return json({ error: "De financiële gegevens zijn intussen gewijzigd. Herlaad de editie en probeer opnieuw." }, 409);
      const now = Math.floor(Date.now() / 1000);
      const finalizedAt = body.costsFinalized ? (typeof body.costsFinalizedAt === "string" && !Number.isNaN(Date.parse(body.costsFinalizedAt)) ? body.costsFinalizedAt : new Date(now * 1000).toISOString()) : null;
      const result = await env.DB.prepare(
        "INSERT INTO edition_finance_snapshots (edition_id, expenses_json, payments_json, costs_finalized, costs_finalized_at, source_environment, source_revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?) ON CONFLICT(edition_id) DO UPDATE SET expenses_json = excluded.expenses_json, payments_json = excluded.payments_json, costs_finalized = excluded.costs_finalized, costs_finalized_at = excluded.costs_finalized_at, updated_at = MAX(edition_finance_snapshots.updated_at + 1, excluded.updated_at) WHERE edition_finance_snapshots.source_environment IS NULL AND edition_finance_snapshots.updated_at = ? RETURNING updated_at"
      ).bind(editionId, JSON.stringify(expenses), JSON.stringify(payments), body.costsFinalized ? 1 : 0, finalizedAt, now, now, body.revision).first();
      if (!result) return json({ error: "De financiële gegevens zijn intussen gewijzigd of horen bij een historische snapshot. Er is niets aangepast." }, 409);
      return json({ saved: true, revision: result.updated_at, expenses, payments, costsFinalized: body.costsFinalized, costsFinalizedAt: finalizedAt });
    } catch (error) {
      console.error("Edition finance save failed:", error);
      return json({ error: "De financiële gegevens konden niet veilig worden opgeslagen." }, 503);
    }
  }

  const catalogMatch = url.pathname.match(/^\/api\/admin\/events\/([A-Za-z0-9_-]+)\/editions\/([A-Za-z0-9_-]+)\/catalog$/);
  if (catalogMatch && request.method === "PUT") {
    const [, eventId, editionId] = catalogMatch;
    const body = await request.json().catch(() => null);
    if (!Array.isArray(body?.catalog) || body.catalog.length > 200) {
      return json({ error: "De catalogus moet een lijst van maximaal 200 producten zijn." }, 400);
    }
    const seen = new Set();
    const catalog = [];
    for (const raw of body.catalog) {
      const id = typeof raw?.id === "string" ? raw.id.trim() : "";
      const name = typeof raw?.name === "string" ? raw.name.trim() : "";
      const image = typeof raw?.image === "string" ? raw.image.trim() : "";
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || !name || name.length > 100 || seen.has(id) ||
          image.length > 1000 || (image && !(
            (image.startsWith("/") && !image.startsWith("//") && !/[\s\\\\]/.test(image)) ||
            (() => { try { const parsed = new URL(image); return parsed.protocol === "https:" && Boolean(parsed.hostname); } catch { return false; } })()
          ))) {
        return json({ error: "Elk catalogusitem heeft een unieke code, naam en optioneel een veilige HTTPS- of relatieve afbeeldingslocatie nodig." }, 400);
      }
      seen.add(id);
      catalog.push({ id, name, ...(image ? { image } : {}), active: raw.active !== false });
    }
    const current = await env.DB.prepare("SELECT config_json FROM event_editions WHERE id = ? AND event_id = ?").bind(editionId, eventId).first();
    if (!current) return json({ error: "Editie niet gevonden." }, 404);
    let config = {};
    try { config = JSON.parse(current.config_json || "{}"); } catch { return json({ error: "De bestaande editieconfiguratie is ongeldig. Er is niets gewijzigd." }, 409); }
    config.catalog = catalog;
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare("UPDATE event_editions SET config_json = ?, updated_at = ? WHERE id = ? AND event_id = ?")
      .bind(JSON.stringify(config), now, editionId, eventId).run();
    return json({ updated: true, catalog });
  }

  const editionMatch = url.pathname.match(/^\/api\/admin\/events\/([A-Za-z0-9_-]+)\/editions\/([A-Za-z0-9_-]+)$/);
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

  const match = url.pathname.match(/^\/api\/admin\/events\/([A-Za-z0-9_-]+)\/editions$/);
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
      await env.DB.batch([
        env.DB.prepare("INSERT INTO event_editions (id, event_id, label, starts_at, ends_at, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)")
          .bind(id, eventId, label, startsAt, endsAt, now, now),
        env.DB.prepare("INSERT INTO edition_finance_snapshots (edition_id, expenses_json, payments_json, costs_finalized, created_at, updated_at) VALUES (?, '[]', '[]', 0, ?, ?)")
          .bind(id, now, now)
      ]);
      return json({ created: true, edition: { id, label, startsAt, endsAt, status: "draft" } }, 201);
    } catch (error) {
      console.error("Edition creation failed:", error);
      return json({ error: "Editie kon niet worden aangemaakt. Controleer de database-migratie." }, 503);
    }
  }


  return json({ error: "Niet gevonden." }, 404);
}
