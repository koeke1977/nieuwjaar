-- Nieuwjaar: basis voor gescheiden admin-authenticatie en gezinsuitnodigingen.
-- Uitvoeren via: npx wrangler d1 migrations apply nieuwjaar-db --local
-- en daarna opnieuw met --remote voor productie.

CREATE TABLE IF NOT EXISTS admin_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry ON admin_sessions(expires_at);

CREATE TABLE IF NOT EXISTS auth_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_events_created ON auth_events(created_at);

CREATE TABLE IF NOT EXISTS family_invites (
  id TEXT PRIMARY KEY,
  edition_id TEXT NOT NULL,
  registration_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  revoked_at INTEGER,
  last_used_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_family_invites_registration ON family_invites(edition_id, registration_id);
CREATE INDEX IF NOT EXISTS idx_family_invites_expiry ON family_invites(expires_at);
