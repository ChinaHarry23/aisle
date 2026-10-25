/**
 * Storage adapter contract.
 *
 * Aisle only needs a way to run a query and a statement. Keeping the surface that
 * small is what lets the same SQL run on SQLite in development and Postgres in
 * production without a query builder or ORM.
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
