-- Alleen gehashte scopes worden bewaard; geen e-mailadressen of IP-adressen.
CREATE TABLE IF NOT EXISTS family_login_limits (
  scope_hash TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  window_started INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_family_login_limits_window
  ON family_login_limits(window_started);
