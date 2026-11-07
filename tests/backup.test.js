import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createD1 } from "./helpers/d1.js";
import { backupDatabase } from "../worker/modules/backup.js";

function fakeBucket() {
  const objects = new Map();
  return {
    objects,
    put: async (key, body) => { objects.set(key, String(body)); },
    get: async key => objects.has(key) ? { body: objects.get(key) } : null,
    delete: async key => { objects.delete(key); },
    list: async ({ prefix }) => ({ objects: [...objects.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key, size: objects.get(key).length })) })
  };
}

function seeded() {
  const DB = createD1();
  const db = DB.raw;
  db.prepare("INSERT INTO events (id, slug, name, finance_strategy, created_at, updated_at) VALUES ('ev', 'nieuwjaar', 'Nieuwjaar', 'nieuwjaar', 1, 1)").run();
  db.prepare("INSERT INTO event_editions (id, event_id, label, status, config_json, created_at, updated_at) VALUES ('ed', 'ev', '2026–2027', 'open', '{\"catalog\":[]}', 1, 1)").run();
  db.prepare("INSERT INTO families (id, display_name, created_at, updated_at) VALUES ('f1', 'Jan & Els''s gezin', 1, 1)").run();
  db.prepare("INSERT INTO event_registrations (id, edition_id, family_id, data_json, created_at, updated_at) VALUES ('r1', 'ed', 'f1', '{\"name\":\"Jan\"}', 1, 1)").run();
  db.prepare("INSERT INTO family_users (id, email, display_name, status, created_at, updated_at) VALUES ('u1', 'jan@x.be', 'Jan', 'active', 1, 1)").run();
  db.prepare("INSERT INTO family_memberships (id, family_id, user_id, role, created_at) VALUES ('m1', 'f1', 'u1', 'owner', 1)").run();
  return DB;
}

test("a backup is written to private storage and old backups are pruned", async () => {
  const DB = seeded();
  const PHOTOS = fakeBucket();
  for (let day = 1; day <= 40; day++) await backupDatabase({ DB, PHOTOS }, new Date(Date.UTC(2026, 10, day)));
  const keys = [...PHOTOS.objects.keys()].sort();
  assert.equal(keys.length, 35, "keeps the latest 35 backups");
  assert.equal(keys.at(-1), "backups/d1-2026-12-10.json");
  assert.ok(keys.every(key => !key.startsWith("products/")), "backups never live under the public media path");
});

test("a backup restores to identical data", async () => {
  const DB = seeded();
  const PHOTOS = fakeBucket();
  const { key } = await backupDatabase({ DB, PHOTOS }, new Date(Date.UTC(2026, 10, 8)));
  const dir = mkdtempSync(join(tmpdir(), "backup-test-"));
  const file = join(dir, "backup.json");
  writeFileSync(file, PHOTOS.objects.get(key));
  const sql = execFileSync(process.execPath, [new URL("../scripts/backup-to-sql.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), file], { encoding: "utf8" });
  const restored = createD1();
  restored.raw.exec(sql);
  for (const table of ["events", "event_editions", "families", "event_registrations", "family_users", "family_memberships"]) {
    assert.deepEqual(restored.raw.prepare("SELECT * FROM " + table).all(), DB.raw.prepare("SELECT * FROM " + table).all(), table + " restored");
  }
  assert.equal(restored.raw.prepare("PRAGMA foreign_key_check").all().length, 0);
});
