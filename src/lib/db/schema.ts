/**
 * Schema.
 *
 * Two tables carry the whole application. Keeping accounts as real rows (rather
 * than a JSON document) is what makes email uniqueness a database constraint
 * instead of a read-then-write race, which is exactly the bug the old Blob store
 * could not avoid.
 *
 * `CREATE TABLE IF NOT EXISTS` plus an additive `ALTER TABLE` for each new column
 * means the file can be opened by a newer build without a migration tool: the
 * statement is idempotent and a duplicate-column error is ignored.
 */

import type { Database } from "./types";

const TABLES = `
create table if not exists users (
  id            text primary key,
  email         text not null unique,
  name          text not null,
  role          text not null default 'beta',
  password_hash text not null,
  created_at    text not null
);

create index if not exists users_email_idx on users (email);

create table if not exists kv (
  key        text primary key,
  value      text not null,
  updated_at text not null
);
`;

/** Columns added after the first release. Duplicates are expected and ignored. */
const ADDITIVE = [
  "alter table users add column updated_at text",
  "alter table users add column last_login_at text",
];

export async function migrate(db: Database) {
  // Each statement is issued separately: `exec`-style multi-statement calls are
  // not portable between the two drivers.
  for (const statement of TABLES.split(";").map((s) => s.trim()).filter(Boolean)) {
    await db.execute(statement);
  }
  for (const statement of ADDITIVE) {
    try {
      await db.execute(statement);
    } catch {
      // Column already exists.
    }
  }
}
