// Daily database backup to R2 (private: the public /media/ route only serves product photos).
// Each backup is one JSON file with every table's rows: backups/d1-YYYY-MM-DD.json
// Restore: scripts/backup-to-sql.mjs turns a backup file into SQL for `wrangler d1 execute`.

const PREFIX = "backups/";
const KEEP = 35;

export async function backupDatabase(env, now = new Date()) {
  if (!env.DB || !env.PHOTOS) throw new Error("Database of opslag niet gekoppeld.");
  const tables = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all();
  const dump = { createdAt: now.toISOString(), database: "nieuwjaar-db", tables: {} };
  for (const { name } of tables.results || []) {
    const rows = await env.DB.prepare('SELECT * FROM "' + name.replace(/"/g, '""') + '"').all();
    dump.tables[name] = rows.results || [];
  }
  const key = PREFIX + "d1-" + now.toISOString().slice(0, 10) + ".json";
  const body = JSON.stringify(dump);
  await env.PHOTOS.put(key, body, { httpMetadata: { contentType: "application/json" } });
  // Retention: keep the most recent KEEP daily backups.
  const listed = await env.PHOTOS.list({ prefix: PREFIX });
  const keys = (listed.objects || []).map(object => object.key).sort();
  for (const old of keys.slice(0, Math.max(0, keys.length - KEEP))) await env.PHOTOS.delete(old);
  return { key, bytes: body.length, tables: Object.keys(dump.tables).length };
}

export async function listBackups(env) {
  const listed = await env.PHOTOS.list({ prefix: PREFIX });
  return (listed.objects || []).map(object => ({ key: object.key, size: object.size, uploaded: object.uploaded }))
    .sort((a, b) => b.key.localeCompare(a.key));
}

export async function handleAdminBackups(request, env, url, { json, sameOrigin, adminSession }) {
  if (!await adminSession(request, env)) return json({ error: "Niet aangemeld." }, 401);
  if (!env.PHOTOS) return json({ error: "Opslag niet gekoppeld." }, 503);
  if (url.pathname === "/api/admin/backups" && request.method === "GET") return json({ backups: await listBackups(env) });
  if (url.pathname === "/api/admin/backups" && request.method === "POST") {
    if (!sameOrigin(request)) return json({ error: "Ongeldige aanvraag." }, 403);
    return json({ created: true, ...(await backupDatabase(env)) }, 201);
  }
  const match = url.pathname.match(/^\/api\/admin\/backups\/(d1-\d{4}-\d{2}-\d{2}\.json)$/);
  if (match && request.method === "GET") {
    const object = await env.PHOTOS.get(PREFIX + match[1]);
    if (!object) return json({ error: "Back-up niet gevonden." }, 404);
    return new Response(object.body, { headers: { "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="nieuwjaar-' + match[1] + '"', "Cache-Control": "no-store" } });
  }
  return json({ error: "Niet gevonden." }, 404);
}
