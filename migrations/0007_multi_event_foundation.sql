-- Additive foundation for the multi-event platform.
-- This migration intentionally leaves app_state and all existing account links untouched.
-- Existing Nieuwjaar data is copied only by a later, audited backfill.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  finance_strategy TEXT NOT NULL,
  settings_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'archived')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS event_editions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  label TEXT NOT NULL,
  starts_at TEXT,
  ends_at TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed', 'archived')),
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_event_editions_event_status
  ON event_editions(event_id, status, starts_at);

CREATE TABLE IF NOT EXISTS families (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  contact_email TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_families_contact_email
  ON families(contact_email);

-- A family can have several independent logins. A user can belong to several families.
-- Roles are deliberately small; authorization policy is enforced by the API layer.
CREATE TABLE IF NOT EXISTS family_memberships (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES family_users(id) ON DELETE CASCADE,
  UNIQUE (family_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_family_memberships_user
  ON family_memberships(user_id, family_id);

CREATE TABLE IF NOT EXISTS event_registrations (
  id TEXT PRIMARY KEY,
  edition_id TEXT NOT NULL,
  family_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'cancelled', 'archived')),
  -- Transitional payload preserves the current members/orders shape during backfill.
  data_json TEXT NOT NULL DEFAULT '{}',
  legacy_environment TEXT CHECK (legacy_environment IN ('test', 'live')),
  legacy_registration_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (edition_id) REFERENCES event_editions(id) ON DELETE RESTRICT,
  FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE RESTRICT,
  UNIQUE (edition_id, family_id),
  UNIQUE (legacy_environment, legacy_registration_id)
);

CREATE INDEX IF NOT EXISTS idx_event_registrations_edition_status
  ON event_registrations(edition_id, status);

-- Finance snapshot is transitional and auditable. It retains the original expense,
-- payment and finalization JSON without changing the legacy calculation path.
CREATE TABLE IF NOT EXISTS edition_finance_snapshots (
  edition_id TEXT PRIMARY KEY,
  expenses_json TEXT NOT NULL DEFAULT '[]',
  payments_json TEXT NOT NULL DEFAULT '[]',
  costs_finalized INTEGER NOT NULL DEFAULT 0 CHECK (costs_finalized IN (0, 1)),
  costs_finalized_at TEXT,
  source_environment TEXT CHECK (source_environment IN ('test', 'live')),
  source_revision INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (edition_id) REFERENCES event_editions(id) ON DELETE RESTRICT
);
