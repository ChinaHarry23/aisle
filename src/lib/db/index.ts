/**
 * Database entry point.
 *
 * Chooses a backend, opens it once per process, and runs the migration. The rest
 * of the app calls `getDatabase()` and never learns which driver is underneath.
 *
 * Selection order:
 *   1. `AISLE_DB=postgres` or a `DATABASE_URL` → Postgres (deployments)
 *   2. anything else → a SQLite file (development, and any single-machine install)
 *
 * The failure mode matters as much as the happy path: an unusable database throws
 * `DatabaseUnavailableError`, which the API routes translate into an actionable
 * message instead of leaking a driver error into the signup form.
 */

import { POSTGRES_URL_VARS, databaseUrl } from "./env";
import { migrate } from "./schema";
import { createPostgresDatabase } from "./postgres";
import { createSqliteDatabase, defaultSqliteFile } from "./sqlite";
import type { Database, DatabaseKind } from "./types";
import { DatabaseUnavailableError } from "./types";

export { DatabaseUnavailableError, isDatabaseUnavailable } from "./types";
export type { Database } from "./types";

let cached: Database | null = null;
let opening: Promise<Database> | null = null;
let failure: DatabaseUnavailableError | null = null;

function configuredKind(): DatabaseKind {
  const forced = process.env.AISLE_DB?.trim().toLowerCase();
  if (forced === "postgres" || forced === "sqlite") return forced;
  return databaseUrl() ? "postgres" : "sqlite";
}

/** Where the database lives, without opening it. Used by the `npm run user` script. */
export function databaseLabel(): string {
  const kind = configuredKind();
  if (kind === "postgres") {
    const found = databaseUrl();
    if (!found) return "postgres (no connection string found)";
    try {
      return `postgres ${new URL(found.url).host} via ${found.name}`;
    } catch {
      return `postgres (${found.name} unreadable)`;
    }
  }
  return `sqlite file ${defaultSqliteFile()}`;
}

async function open(): Promise<Database> {
  const kind = configuredKind();
  if (kind === "postgres") {
    const found = databaseUrl();
    if (!found) {
      throw new DatabaseUnavailableError(
        `AISLE_DB=postgres but no connection string was found in ${POSTGRES_URL_VARS.join(", ")} — set one, or unset AISLE_DB to use the local SQLite file`,
      );
    }
    // `createPostgresDatabase` reports its own connection failures as
    // DatabaseUnavailableError, so there is nothing to translate here.
    return createPostgresDatabase(found.url);
  }
  return createSqliteDatabase(defaultSqliteFile());
}

/**
 * The process-wide database handle.
 *
 * A failed open is remembered so a broken deployment fails fast and consistently
 * rather than retrying a connection on every request.
 */
export async function getDatabase(): Promise<Database> {
  if (cached) return cached;
  if (failure) throw failure;
  if (!opening) {
    opening = (async () => {
      const db = await open();
      await migrate(db);
      cached = db;
      return db;
    })();
  }
  try {
    return await opening;
  } catch (error) {
    opening = null;
    failure =
      error instanceof DatabaseUnavailableError
        ? error
        : new DatabaseUnavailableError(
            error instanceof Error ? error.message : "unknown database error",
          );
    throw failure;
  }
}

/**
 * Forget the cached handle so the next getDatabase() reopens it (the driver
 * handle/pool is not closed). Used by tests and the maintenance scripts.
 */
export async function closeDatabase() {
  cached = null;
  opening = null;
  failure = null;
}
