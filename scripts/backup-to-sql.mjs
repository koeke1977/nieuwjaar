// Turn a backup file (downloaded from Instellingen → Back-ups) into SQL that restores every row.
// Usage:  node scripts/backup-to-sql.mjs nieuwjaar-d1-2026-11-08.json > restore.sql
// Then, after checking the file:  npx wrangler d1 execute nieuwjaar-db --remote --file=restore.sql
// The SQL replaces the contents of every table in the backup (in foreign-key safe order).
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/backup-to-sql.mjs <backup.json>");
  process.exit(1);
}
const dump = JSON.parse(readFileSync(file, "utf8"));
const quote = value =>
  value === null || value === undefined
    ? "NULL"
    : typeof value === "number"
      ? String(value)
      : "'" + String(value).replace(/'/g, "''") + "'";
const ident = name => '"' + name.replace(/"/g, '""') + '"';
// Parents before children, so foreign keys hold while inserting.
const order = [
  "events",
  "event_editions",
  "families",
  "family_users",
  "family_memberships",
  "event_registrations",
  "edition_finance_snapshots",
  "family_user_invites",
  "family_user_sessions",
  "family_password_resets"
];
const names = Object.keys(dump.tables).sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
const lines = ["-- Restore of " + dump.database + " backup from " + dump.createdAt, "PRAGMA defer_foreign_keys = ON;"];
for (const name of [...names].reverse()) lines.push("DELETE FROM " + ident(name) + ";");
for (const name of names) {
  for (const row of dump.tables[name]) {
    const columns = Object.keys(row);
    lines.push(
      "INSERT INTO " +
        ident(name) +
        " (" +
        columns.map(ident).join(", ") +
        ") VALUES (" +
        columns.map(column => quote(row[column])).join(", ") +
        ");"
    );
  }
}
process.stdout.write(lines.join("\n") + "\n");
