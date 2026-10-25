/**
 * The key/value table, on SQL.
 *
 * Workspaces are whole JSON documents, so they want a
 * document store, not a schema. Replacing the old Vercel Blob calls with two rows
 * in SQL keeps that shape while removing a network dependency (and a credential)
 * from every page save.
 *
 * `kvSet` is an upsert, so a key can be written before it has ever been read.
 */

import { getDatabase } from "./index";
import type { Row } from "./types";

type KvRow = Row & { value: string };

export async function kvGet<T>(key: string): Promise<T | null> {
  const db = await getDatabase();
  const rows = await db.query<KvRow>("select value from kv where key = $1", [key]);
  if (rows.length === 0) return null;
  try {
    return JSON.parse(rows[0].value) as T;
  } catch {
    // A corrupt document must not take a route down; treat it as absent.
    return null;
  }
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    `insert into kv (key, value, updated_at) values ($1, $2, $3)
     on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at`,
    [key, JSON.stringify(value), new Date().toISOString()],
  );
}

export async function kvKeys(prefix: string): Promise<string[]> {
  const db = await getDatabase();
  const rows = await db.query<Row & { key: string }>(
    "select key from kv where key like $1 order by key",
    [`${prefix}%`],
  );
  return rows.map((r) => r.key);
}

/** The stored text as well as the parsed value, for a later `kvSetIfUnchanged`. */
export async function kvGetRaw<T>(key: string): Promise<{ text: string; value: T | null } | null> {
  const db = await getDatabase();
  const rows = await db.query<KvRow>("select value from kv where key = $1", [key]);
  if (rows.length === 0) return null;
  const text = String(rows[0].value);
  try {
    return { text, value: JSON.parse(text) as T };
  } catch {
    return { text, value: null };
  }
}

/**
 * Write only if the row still holds `expected` (null: the key must not exist
 * yet). Returns false when another save got there first, so the caller can
 * read again and redo its change instead of overwriting that save.
 */
export async function kvSetIfUnchanged(key: string, value: unknown, expected: string | null): Promise<boolean> {
  const db = await getDatabase();
  const now = new Date().toISOString();
  const rows = expected === null
    ? await db.query<Row & { key: string }>(
        "insert into kv (key, value, updated_at) values ($1, $2, $3) on conflict (key) do nothing returning key",
        [key, JSON.stringify(value), now],
      )
    : await db.query<Row & { key: string }>(
        "update kv set value = $1, updated_at = $2 where key = $3 and value = $4 returning key",
        [JSON.stringify(value), now, key, expected],
      );
  return rows.length === 1;
}
