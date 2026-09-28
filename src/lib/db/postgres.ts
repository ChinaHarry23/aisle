/**
 * Postgres adapter for deployments.
 *
 * A serverless filesystem is ephemeral, so a hosted database is the only way an
 * account created in production survives the next request. This is the production
 * backend; SQLite (`./sqlite.ts`) is the development one, and both satisfy the same
 * `Database` interface so nothing above this layer knows which is in use.
 */

import { Pool } from "pg";
import type { Database, Row } from "./types";
import { DatabaseUnavailableError } from "./types";

let pool: Pool | null = null;

function connect(url: string): Pool {
  if (pool) return pool;
  pool = new Pool({
    connectionString: url,
    // Small pool: this is one founder's workspace, and serverless instances
    // multiply quickly if the pool is generous.
    max: 3,
    connectionTimeoutMillis: 8_000,
  });
  return pool;
}

export async function createPostgresDatabase(url: string): Promise<Database> {
  let client: Pool;
  try {
    client = connect(url);
    // Fail here, at selection time, so the error surfaces as "database
    // unavailable" instead of as a mystery on the first query.
    await client.query("select 1");
  } catch (error) {
    pool = null;
    throw new DatabaseUnavailableError(
      `could not reach Postgres (${error instanceof Error ? error.message : "unknown error"})`,
    );
  }

  let host = "postgres";
  try {
    host = new URL(url).host || host;
  } catch {
    // Connection strings are not always URLs; the label is cosmetic.
  }

  return {
    kind: "postgres",
    label: `postgres ${host}`,
    async query<T extends Row = Row>(text: string, params: unknown[] = []): Promise<T[]> {
      const result = await client.query(text, params as unknown[]);
      return result.rows as T[];
    },
    async execute(text: string, params: unknown[] = []): Promise<void> {
      await client.query(text, params as unknown[]);
    },
  };
}
