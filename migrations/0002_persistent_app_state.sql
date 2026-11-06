-- Persistente snapshots per omgeving. De API geeft alleen toegang aan een geldige admin-sessie.
CREATE TABLE IF NOT EXISTS app_state (
  environment TEXT PRIMARY KEY CHECK (environment IN ('test', 'live')),
  data_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_app_state_updated_at ON app_state(updated_at);
