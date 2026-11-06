-- Beveiligde familieaccounts: e-mail/wachtwoord, eenmalige onboardingtokens en server-side sessies.
-- Identiteiten zijn globaal; koppelingen naar inschrijvingen blijven per omgeving gescheiden.

CREATE TABLE IF NOT EXISTS family_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  password_hash TEXT,
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'disabled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_family_users_status ON family_users(status);

CREATE TABLE IF NOT EXISTS family_user_registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  edition_id TEXT NOT NULL CHECK (edition_id IN ('test', 'live')),
  registration_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES family_users(id) ON DELETE CASCADE,
  UNIQUE (user_id, edition_id, registration_id),
  UNIQUE (edition_id, registration_id)
);

CREATE INDEX IF NOT EXISTS idx_family_user_registrations_user
  ON family_user_registrations(user_id, edition_id);

CREATE TABLE IF NOT EXISTS family_user_invites (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  revoked_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES family_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_family_user_invites_user
  ON family_user_invites(user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_family_user_invites_expiry
  ON family_user_invites(expires_at);

CREATE TABLE IF NOT EXISTS family_user_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES family_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_family_user_sessions_user
  ON family_user_sessions(user_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_family_user_sessions_expiry
  ON family_user_sessions(expires_at);

CREATE TABLE IF NOT EXISTS family_password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES family_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_family_password_resets_user
  ON family_password_resets(user_id, expires_at);
