/**
 * SQLite adapter built on Node's own `node:sqlite`.
 *
 * This is the default backend: one file on disk, no native module to compile, no
 * account to create, and nothing to install — which is why a fresh clone can
 * create an account immediately instead of failing on a credential it does not
 * have.
 *
 * The same SQL runs on Postgres (see `postgres.ts`), so the only dialect care
 * needed here is placeholder style: this adapter rewrites `$1`-style parameters to
 * SQLite's `?`.
 */

import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Database, Row } from "./types";
import { DatabaseUnavailableError } from "./types";

/** `$1, $2` (Postgres style) → `?` (SQLite style), in order. */
function toPositional(text: string): string {
  return text.replace(/\$(\d+)/g, "?");
}

export function createSqliteDatabase(file: string): Database {
  let handle: DatabaseSync;
  try {
    if (file !== ":memory:") {
      mkdirSync(path.dirname(file), { recursive: true });
    }
    handle = new DatabaseSync(file);
  } catch (error) {
    throw new DatabaseUnavailableError(
      `could not open the SQLite file at ${file} (${error instanceof Error ? error.message : "unknown error"})`,
    );
  }

  // WAL keeps reads from blocking the write that saves a workspace, and the busy
  // timeout absorbs the overlap between a page save and an engine command.
  for (const pragma of [
    "pragma journal_mode = WAL",
    "pragma busy_timeout = 5000",
    "pragma foreign_keys = on",
  ]) {
    try {
      handle.exec(pragma);
    } catch {
      // Pragmas are advisory here; a read-only mount can legitimately refuse them.
    }
  }

  return {
    kind: "sqlite",
    label: file === ":memory:" ? "sqlite (in-memory)" : `sqlite file ${file}`,
    async query<T extends Row = Row>(text: string, params: unknown[] = []): Promise<T[]> {
      const statement = handle.prepare(toPositional(text));
      return statement.all(...(params as never[])) as T[];
    },
    async execute(text: string, params: unknown[] = []): Promise<void> {
      const statement = handle.prepare(toPositional(text));
      statement.run(...(params as never[]));
    },
  };
}

/** Resolve the default file location: `<project>/data/aisle.db`. */
export function defaultSqliteFile() {
  if (process.env.AISLE_DB_FILE) return process.env.AISLE_DB_FILE;
  return path.join(process.cwd(), "data", "aisle.db");
}
