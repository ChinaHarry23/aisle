/**
 * Storage adapter contract.
 *
 * Aisle only needs three things from a database: one table of accounts, one
 * key/value table for per-user documents, and a way to run a query. Keeping the
 * surface that small is what lets the same code run on the SQLite file used in
 * development and a Postgres database in production without a query builder or an
 * ORM in between.
 *
 * Every method is async even where the underlying driver is synchronous, so the
 * two adapters are interchangeable.
 */

export type Row = Record<string, unknown>;

export type DatabaseKind = "sqlite" | "postgres";

export type Database = {
  kind: DatabaseKind;
  /** Human-readable location, shown by the health endpoint. */
  label: string;
  /** Run a statement that returns rows (`SELECT`). */
  query: <T extends Row = Row>(text: string, params?: unknown[]) => Promise<T[]>;
  /** Run a statement that changes data (`INSERT` / `UPDATE` / `DELETE`). */
  execute: (text: string, params?: unknown[]) => Promise<void>;
};

/** Raised when no database is configured or it cannot be reached. */
export class DatabaseUnavailableError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(
      `No database is available: ${reason}. Accounts and workspaces cannot be stored.`,
    );
    this.name = "DatabaseUnavailableError";
    this.reason = reason;
  }
}

export function isDatabaseUnavailable(error: unknown): error is DatabaseUnavailableError {
  return error instanceof DatabaseUnavailableError;
}
