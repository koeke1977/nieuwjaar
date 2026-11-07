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

test("the one-off legacy migration routes are retired", () => {
  assert.doesNotMatch(adminEvents, /backfill/);
});
