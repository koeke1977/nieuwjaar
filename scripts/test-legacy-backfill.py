#!/usr/bin/env python3
"""Run the legacy-to-multi-event backfill against a disposable copy of a D1 SQL export.

Usage (from repository root):
  python scripts/test-legacy-backfill.py "C:\\path\\to\\nieuwjaar-db-before-migration.sql"

This never connects to Cloudflare and never modifies the supplied backup.
"""
import json
import shutil
import sqlite3
import sys
import tempfile
import time
from pathlib import Path


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Gebruik: python scripts/test-legacy-backfill.py <pad-naar-D1-export.sql>")

    repo = Path(__file__).resolve().parents[1]
    backup = Path(sys.argv[1]).expanduser().resolve()
    require(backup.is_file(), f"Back-upbestand niet gevonden: {backup}")

    temp_dir = Path(tempfile.mkdtemp(prefix="nieuwjaar-backfill-test-"))
    db_path = temp_dir / "backfill-test.sqlite"
    print(f"Testkopie: {db_path}")

    try:
        source = sqlite3.connect(":memory:")
        source.executescript(backup.read_text(encoding="utf-8"))
        source.commit()
        source_state = source.execute(
            "SELECT environment, data_json, updated_at FROM app_state ORDER BY environment"
        ).fetchall()
        source_links = source.execute(
            "SELECT id, user_id, edition_id, registration_id, created_at "
            "FROM family_user_registrations ORDER BY id"
        ).fetchall()
        source_users = source.execute("SELECT id FROM family_users ORDER BY id").fetchall()
        require(source_state, "De export bevat geen app_state.")
        require(source_users or not source_links, "Accountkoppelingen bestaan zonder accounts.")

        shutil.copy2(backup, temp_dir / "source-export.sql")
        db = sqlite3.connect(db_path)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys = ON")
        db.executescript(backup.read_text(encoding="utf-8"))
        db.commit()

        for migration in (
            repo / "migrations" / "0007_multi_event_foundation.sql",
            repo / "migrations" / "0008_shared_family_registration_access.sql",
        ):
            db.executescript(migration.read_text(encoding="utf-8"))
            db.commit()
            print(f"{migration.name}: toegepast op testkopie")

        known_users = {row[0] for row in source_users}
        state_by_env = {}
        parsed = {}
        for environment, raw, revision in source_state:
            require(environment in ("test", "live"), f"Niet-ondersteunde omgeving: {environment}")
            data = json.loads(raw)
            require(isinstance(data, dict) and isinstance(data.get("registrations"), list),
                    f"Ongeldige app_state-structuur in {environment}")
            registrations = data["registrations"]
            ids = [item.get("id") for item in registrations if isinstance(item, dict)]
            require(len(ids) == len(registrations) and all(isinstance(x, str) and x for x in ids),
                    f"Ongeldige registratie-ID in {environment}")
            require(len(ids) == len(set(ids)), f"Dubbele registratie-ID in {environment}")
            require(isinstance(data.get("expenses", []), list), f"Ongeldige kostenlijst in {environment}")
            require(isinstance(data.get("payments", []), list), f"Ongeldige betalingenlijst in {environment}")
            parsed[environment] = data
            state_by_env[environment] = (raw, revision)

        require({"test", "live"}.issubset(state_by_env), "Zowel test als live moet aanwezig zijn.")
        for _, user_id, environment, registration_id, _ in source_links:
            require(user_id in known_users, f"Onbekend account in koppeling: {user_id}")
            require(environment in parsed, f"Onbekende omgeving in koppeling: {environment}")
            require(any(item["id"] == registration_id for item in parsed[environment]["registrations"]),
                    f"Koppeling naar ontbrekende inschrijving: {environment}/{registration_id}")

        targets = db.execute(
            "SELECT (SELECT COUNT(*) FROM events WHERE id IN ('legacy-event-test','legacy-event-live')) + "
            "(SELECT COUNT(*) FROM event_editions WHERE id IN ('legacy-edition-test','legacy-edition-live')) + "
            "(SELECT COUNT(*) FROM edition_finance_snapshots WHERE edition_id IN ('legacy-edition-test','legacy-edition-live')) + "
            "(SELECT COUNT(*) FROM families WHERE id LIKE 'legacy-family-test-%' OR id LIKE 'legacy-family-live-%') + "
            "(SELECT COUNT(*) FROM event_registrations WHERE id LIKE 'legacy-registration-test-%' OR id LIKE 'legacy-registration-live-%') + "
            "(SELECT COUNT(*) FROM family_memberships WHERE id LIKE 'legacy-membership-test-%' OR id LIKE 'legacy-membership-live-%')"
        ).fetchone()[0]
        require(targets == 0, "Testkopie bevat al doelrecords; backfill niet veilig herhaalbaar.")

        statements = []
        now = int(time.time())
        migrated = []
        for environment in ("test", "live"):
            raw, revision = state_by_env[environment]
            data = parsed[environment]
            event_id = "legacy-event-" + environment
            edition_id = "legacy-edition-" + environment
            event_name = str(
                (data.get("activeEvent") or {}).get("name")
                or (data.get("activeEvent") or {}).get("title")
                or ("Nieuwjaar" if environment == "live" else "Nieuwjaar (test)")
            )[:100]
            statements.append((
                "INSERT INTO events (id, slug, name, description, finance_strategy, settings_json, status, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, '{}', 'active', ?, ?)",
                (event_id, "nieuwjaar-" + environment, event_name,
                 "Overgenomen uit de bestaande " + environment + "-omgeving.", "nieuwjaar", now, now)
            ))
            statements.append((
                "INSERT INTO event_editions (id, event_id, label, status, config_json, created_at, updated_at) "
                "VALUES (?, ?, ?, 'open', '{}', ?, ?)",
                (edition_id, event_id, event_name, now, now)
            ))
            statements.append((
                "INSERT INTO edition_finance_snapshots (edition_id, expenses_json, payments_json, costs_finalized, costs_finalized_at, source_environment, source_revision, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (edition_id, json.dumps(data.get("expenses", []), separators=(",", ":")),
                 json.dumps(data.get("payments", []), separators=(",", ":")),
                 1 if data.get("costsFinalized") else 0, data.get("costsFinalizedAt"),
                 environment, revision, now, now)
            ))
            account_links = 0
            for registration in data["registrations"]:
                registration_id = registration["id"]
                family_id = f"legacy-family-{environment}-{registration_id}"
                new_registration_id = f"legacy-registration-{environment}-{registration_id}"
                display_name = str(registration.get("name") or "Inschrijving")[:160]
                statements.append((
                    "INSERT INTO families (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)",
                    (family_id, display_name, now, now)
                ))
                statements.append((
                    "INSERT INTO event_registrations (id, edition_id, family_id, status, data_json, legacy_environment, legacy_registration_id, created_at, updated_at) "
                    "VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)",
                    (new_registration_id, edition_id, family_id,
                     json.dumps(registration, separators=(",", ":")), environment, registration_id, now, now)
                ))
                for link_id, user_id, link_environment, link_registration_id, created_at in source_links:
                    if link_environment == environment and link_registration_id == registration_id:
                        statements.append((
                            "INSERT INTO family_memberships (id, family_id, user_id, role, created_at) VALUES (?, ?, ?, 'editor', ?)",
                            (f"legacy-membership-{environment}-{registration_id}-{user_id}",
                             family_id, user_id, created_at or now)
                        ))
                        account_links += 1
            migrated.append((environment, len(data["registrations"]), account_links))

        require(len(statements) <= 1000,
                f"Backfill zou {len(statements)} statements bevatten; productiecode weigert dit in één batch.")
        db.execute("BEGIN")
        for sql, params in statements:
            db.execute(sql, params)
        db.commit()

        require([tuple(row) for row in db.execute(
            "SELECT environment, data_json, updated_at FROM app_state ORDER BY environment"
        ).fetchall()] == [tuple(row) for row in source_state], "app_state is gewijzigd.")
        require([tuple(row) for row in db.execute(
            "SELECT id, user_id, edition_id, registration_id, created_at FROM family_user_registrations ORDER BY id"
        ).fetchall()] == [tuple(row) for row in source_links], "Bestaande accountkoppelingen zijn gewijzigd.")
        require(db.execute("SELECT COUNT(*) FROM events WHERE id LIKE 'legacy-event-%'").fetchone()[0] == 2,
                "Verwachtte niet exact twee overgenomen evenementen.")
        require(db.execute("SELECT COUNT(*) FROM event_editions WHERE id LIKE 'legacy-edition-%'").fetchone()[0] == 2,
                "Verwachtte niet exact twee overgenomen edities.")
        expected_registrations = sum(len(parsed[e]["registrations"]) for e in ("test", "live"))
        require(db.execute("SELECT COUNT(*) FROM event_registrations WHERE id LIKE 'legacy-registration-%'").fetchone()[0] == expected_registrations,
                "Aantal overgenomen inschrijvingen klopt niet.")
        require(db.execute("SELECT COUNT(*) FROM family_memberships WHERE id LIKE 'legacy-membership-%'").fetchone()[0] == len(source_links),
                "Aantal overgenomen accounttoegangen klopt niet.")
        require(db.execute("SELECT COUNT(*) FROM edition_finance_snapshots WHERE edition_id LIKE 'legacy-edition-%'").fetchone()[0] == 2,
                "Financiële snapshots ontbreken.")
        fk_errors = db.execute("PRAGMA foreign_key_check").fetchall()
        require(not fk_errors, f"Foreign-keyfouten: {fk_errors[:5]}")
        integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
        require(integrity == "ok", f"SQLite-integriteitscontrole: {integrity}")

        print("\nBACKFILL-SIMULATIE GESLAAGD")
        print("Evenementen: 2 | edities: 2 | inschrijvingen:", expected_registrations)
        print("Accounttoegangen:", len(source_links), "| financiële snapshots: 2")
        print("app_state: byte-for-byte ongewijzigd")
        print("Bestaande accountkoppelingen: ongewijzigd")
        print("Foreign keys: 0 fouten | SQLite integrity_check: ok")
        print("Dit was uitsluitend een lokale simulatie; Cloudflare D1 is niet benaderd.")
        print(f"Testdatabase blijft beschikbaar voor inspectie: {db_path}")
        db.close()
        source.close()
    except Exception:
        print("\nBACKFILL-SIMULATIE MISLUKT; de originele export is niet gewijzigd.")
        raise


if __name__ == "__main__":
    main()
