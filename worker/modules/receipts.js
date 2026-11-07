// Receipts (photo or PDF) for costs, stored privately in R2 under
//   receipts/<editionId>/<registrationId>/<uuid>.<ext>
// They are never served by the public /media/ route: only the family that owns the
// registration (family portal) and the organisation (admin) can open them.

export const RECEIPT_PREFIX = "receipts/";
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;
const TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "application/pdf": "pdf" };
const KEY = /^receipts\/([A-Za-z0-9_-]{1,120})\/([A-Za-z0-9_-]{1,120})\/[0-9a-f-]{36}\.(?:jpg|png|webp|heic|heif|pdf)$/;

export function parseReceiptKey(key) {
  const match = typeof key === "string" ? key.match(KEY) : null;
  return match ? { editionId: match[1], registrationId: match[2] } : null;
}

export async function storeReceipt(env, file, editionId, registrationId) {
  if (!(file instanceof File) || !TYPES[file.type] || file.size < 1 || file.size > RECEIPT_MAX_BYTES) {
    return { error: "Gebruik een foto (JPG, PNG, WebP of HEIC) of een PDF van maximaal 10 MB." };
  }
  const key = RECEIPT_PREFIX + editionId + "/" + registrationId + "/" + crypto.randomUUID() + "." + TYPES[file.type];
  await env.PHOTOS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  return { key };
}

export async function receiptExists(env, key) {
  return Boolean(parseReceiptKey(key) && await env.PHOTOS.head(key));
}

export async function deleteReceipt(env, key) {
  if (parseReceiptKey(key)) await env.PHOTOS.delete(key).catch(() => {});
}

export async function streamReceipt(env, key) {
  const object = parseReceiptKey(key) ? await env.PHOTOS.get(key) : null;
  if (!object) return null;
  const headers = new Headers();
  object.writeHttpMetadata?.(headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Content-Disposition", "inline");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(object.body, { headers });
}

// Nightly: remove receipts that no cost refers to (e.g. uploaded but never saved), older than a day.
export async function pruneOrphanReceipts(env, now = Date.now()) {
  const referenced = new Set();
  const snapshots = await env.DB.prepare("SELECT expenses_json FROM edition_finance_snapshots").all();
  for (const row of snapshots.results || []) {
    try { for (const expense of JSON.parse(row.expenses_json || "[]")) if (expense.receipt) referenced.add(expense.receipt); } catch { /* skip */ }
  }
  let cursor, removed = 0;
  do {
    const listed = await env.PHOTOS.list({ prefix: RECEIPT_PREFIX, cursor });
    for (const object of listed.objects || []) {
      const age = now - new Date(object.uploaded || 0).getTime();
      if (!referenced.has(object.key) && age > 24 * 60 * 60 * 1000) { await env.PHOTOS.delete(object.key); removed++; }
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return removed;
}
