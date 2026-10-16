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

/**
 * `$1, $2` (Postgres style) → `?1, ?2` (SQLite numbered style). Numbered, not
 * bare `?`, so a reused `$1` binds the same value as Postgres does instead of
 * silently consuming the next slot as NULL.
 */
function toPositional(text: string): string {
  return text.replace(/\$(\d+)/g, "?$1");
}

/** Node 23 treats numbered SQLite parameters as named, not anonymous slots. */
function bindings(text: string, params: unknown[]): unknown[] {
  const indexes = [...text.matchAll(/\$(\d+)/g)].map(match => Number(match[1]));
  if (!indexes.length) return params;
  const named: Record<string, unknown> = {};
  for (const index of indexes) {
    if (index < 1 || index > params.length) throw new Error(`Missing value for SQL parameter $${index}.`);
    named[`?${index}`] = params[index - 1] ?? null;
  }
  return [named];
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
      return statement.all(...(bindings(text, params) as never[])) as T[];
    },
    async execute(text: string, params: unknown[] = []): Promise<void> {
      const statement = handle.prepare(toPositional(text));
      statement.run(...(bindings(text, params) as never[]));
    },
  };
}

/** Resolve the default file location: `<project>/data/aisle.db`. */
export function defaultSqliteFile() {
  if (process.env.AISLE_DB_FILE) return process.env.AISLE_DB_FILE;
  return path.join(process.cwd(), "data", "aisle.db");
}
