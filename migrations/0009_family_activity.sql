-- What families do, for the admin's "Laatste activiteit". Purely additive: no existing table changes.
-- edition_id is NULL for account events (e.g. activating an account), which belong to no edition.
-- data holds the state before a series of edits, so quick edits can merge into one line.
CREATE TABLE IF NOT EXISTS family_activity (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  edition_id TEXT,
  family_id TEXT,
  registration_id TEXT,
  family_name TEXT NOT NULL DEFAULT '',
  actor_id TEXT,
  actor TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,
  summary TEXT NOT NULL,
  data TEXT
);

CREATE INDEX IF NOT EXISTS idx_family_activity_edition ON family_activity(edition_id, at);
CREATE INDEX IF NOT EXISTS idx_family_activity_registration ON family_activity(registration_id, type, at);
