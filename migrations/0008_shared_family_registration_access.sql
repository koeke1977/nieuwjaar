-- Allow several personal logins to access the same family registration.
-- Existing rows are copied unchanged; only the old one-account-per-registration
-- uniqueness rule is removed. No app_state or user records are deleted.

CREATE TABLE family_user_registrations_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  edition_id TEXT NOT NULL CHECK (edition_id IN ('test', 'live')),
  registration_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES family_users(id) ON DELETE CASCADE,
  UNIQUE (user_id, edition_id, registration_id)
);

INSERT INTO family_user_registrations_new (id, user_id, edition_id, registration_id, created_at)
SELECT id, user_id, edition_id, registration_id, created_at
FROM family_user_registrations;

DROP TABLE family_user_registrations;

ALTER TABLE family_user_registrations_new RENAME TO family_user_registrations;

CREATE INDEX IF NOT EXISTS idx_family_user_registrations_user
  ON family_user_registrations(user_id, edition_id);

CREATE INDEX IF NOT EXISTS idx_family_user_registrations_registration
  ON family_user_registrations(edition_id, registration_id);
