import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const foundation = read("../migrations/0007_multi_event_foundation.sql");
const sharedAccess = read("../migrations/0008_shared_family_registration_access.sql");
const adminEvents = read("../worker/modules/admin-events.js");

test("multi-event foundation is additive and keeps legacy source tables intact", () => {
  assert.match(foundation, /CREATE TABLE IF NOT EXISTS events/);
  assert.match(foundation, /CREATE TABLE IF NOT EXISTS event_editions/);
  assert.match(foundation, /CREATE TABLE IF NOT EXISTS families/);
  assert.match(foundation, /CREATE TABLE IF NOT EXISTS family_memberships/);
  assert.match(foundation, /CREATE TABLE IF NOT EXISTS event_registrations/);
  assert.match(foundation, /CREATE TABLE IF NOT EXISTS edition_finance_snapshots/);
  assert.doesNotMatch(foundation, /\b(?:DROP|ALTER)\s+TABLE\s+(?:app_state|family_users|family_user_registrations)\b/i);
});

test("shared registration access preserves existing links and permits multiple users", () => {
  assert.match(sharedAccess, /INSERT INTO family_user_registrations_new[\s\S]*?SELECT id, user_id, edition_id, registration_id, created_at[\s\S]*?FROM family_user_registrations/i);
  assert.match(sharedAccess, /UNIQUE\s*\(user_id, edition_id, registration_id\)/i);
  assert.doesNotMatch(sharedAccess, /UNIQUE\s*\(edition_id, registration_id\)/i);
  assert.match(sharedAccess, /FOREIGN KEY \(user_id\) REFERENCES family_users\(id\)/i);
});

test("legacy preview is read-only and checks both environments and source integrity", () => {
  const previewStart = adminEvents.indexOf('url.pathname === "/api/admin/events/backfill-preview"');
  const backfillStart = adminEvents.indexOf('url.pathname === "/api/admin/events/backfill"');
  assert.notEqual(previewStart, -1);
  assert.ok(backfillStart > previewStart);
  const preview = adminEvents.slice(previewStart, backfillStart);
  assert.match(preview, /readOnly:\s*true/);
  assert.match(preview, /\["test",\s*"live"\]/);
  assert.match(preview, /JSON\.parse\(row\.data_json\)/);
  assert.match(preview, /Array\.isArray\(data\.registrations\)/);
  assert.match(preview, /orphanedRegistrationLinks/);
  assert.match(preview, /existingTargets/);
  assert.doesNotMatch(preview, /\.run\(\)|\.batch\(/);
});

test("backfill requires explicit confirmation and validates account links before writing", () => {
  const backfillStart = adminEvents.indexOf('url.pathname === "/api/admin/events/backfill"');
  const backfill = adminEvents.slice(backfillStart);
  assert.match(backfill, /body\?\.confirm !== "MIGRATE LEGACY DATA"/);
  assert.match(backfill, /linkRows\.some\(row => !knownUsers\.has\(row\.user_id\)\)/);
  assert.match(backfill, /data\.registrations\.some\(item => item\.id === link\.registration_id\)/);
  assert.match(backfill, /INSERT OR IGNORE INTO family_memberships/);
  assert.match(backfill, /'editor'/);
  assert.match(backfill, /INSERT OR IGNORE INTO edition_finance_snapshots/);
  assert.match(backfill, /await env\.DB\.batch\(statements\)/);
  assert.match(backfill, /sourceDataPreserved:\s*true/);
  assert.doesNotMatch(backfill, /UPDATE\s+app_state|DELETE\s+FROM\s+app_state/i);
});

test("backfill has a bounded atomic batch and refuses oversized imports", () => {
  const backfillStart = adminEvents.indexOf('url.pathname === "/api/admin/events/backfill"');
  const backfill = adminEvents.slice(backfillStart);
  assert.match(backfill, /statements\.length > 1000/);
  assert.match(backfill, /Er is niets gewijzigd/);
  assert.match(backfill, /await env\.DB\.batch\(statements\)/);
});
