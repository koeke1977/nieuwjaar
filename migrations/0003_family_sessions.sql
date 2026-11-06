-- Sessies voor gezinnen die via een persoonlijke, intrekbare uitnodigingslink aanmelden.
CREATE TABLE IF NOT EXISTS family_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  invite_id TEXT NOT NULL,
  edition_id TEXT NOT NULL CHECK (edition_id IN ('test', 'live')),
  registration_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (invite_id) REFERENCES family_invites(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_family_sessions_invite ON family_sessions(invite_id);
CREATE INDEX IF NOT EXISTS idx_family_sessions_expiry ON family_sessions(expires_at);
