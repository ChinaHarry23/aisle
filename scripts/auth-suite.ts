/**
 * Accounts and storage suite.
 *
 * The signup path is the one thing that must never be broken: if it fails, nothing
 * else in Aisle is reachable. This drives the real repository, the real schema and a
 * real SQLite file on disk — in a temporary location, so it never touches the
 * workspace database.
 *
 *   node --experimental-strip-types scripts/auth-suite.ts
 */

import assert from "node:assert/strict";
import "./service-loader.mjs";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();

/* Use a throwaway database so running the suite is never destructive. */
const dbFile = path.join(root, "data", "auth-suite.db");
for (const suffix of ["", "-wal", "-shm"]) {
  const file = `${dbFile}${suffix}`;
  if (existsSync(file)) rmSync(file);
}
process.env.AISLE_DB_FILE = dbFile;
delete process.env.DATABASE_URL;

const load = <T>(relative: string) =>
  import(pathToFileURL(path.join(root, "src", relative)).href) as Promise<T>;

const db = await load<typeof import("../src/lib/db/index")>("lib/db/index.ts");
const users = await load<typeof import("../src/lib/auth/users")>("lib/auth/users.ts");
const kv = await load<typeof import("../src/lib/db/kv")>("lib/db/kv.ts");
const password = await load<typeof import("../src/lib/auth/password")>("lib/auth/password.ts");
const seeds = await load<typeof import("../src/lib/auth/seed-accounts")>("lib/auth/seed-accounts.ts");
const session = await load<typeof import("../src/lib/auth/session")>("lib/auth/session.ts");
const storage = await load<typeof import("../src/lib/auth/storage-errors")>("lib/auth/storage-errors.ts");
const nextPath = await load<typeof import("../src/lib/auth/next-path")>("lib/auth/next-path.ts");

const results: { name: string; detail: string }[] = [];
const pass = (name: string, detail: string) => results.push({ name, detail });

process.env.AUTH_SECRET = process.env.AUTH_SECRET || "suite-secret-not-for-production-use";

/* ------------------------------------------------------------- database --- */

{
  const handle = await db.getDatabase();
  assert.equal(handle.kind, "sqlite", "the default backend must be the local SQLite file");
  assert.ok(existsSync(dbFile), "the schema must create the database file");
  const rows = await handle.query<{ name: string }>(
    "select name from sqlite_master where type = 'table' order by name",
  );
  const tables = rows.map((r) => r.name);
  assert.ok(tables.includes("users"), "a users table must exist");
  assert.ok(tables.includes("kv"), "a kv table must exist");
  pass("database — schema created on first use", `${handle.label} · tables: ${tables.join(", ")}`);
}

/* --------------------------------------------------------- seeded desks --- */

{
  const alex = await users.findUserByEmail("alex@aisle.website");
  assert.ok(alex, "the team desks must exist on a fresh database");
  assert.equal(alex.role, "dev");
  assert.ok(
    await password.verifyPassword(seeds.seedPassword()!, alex.passwordHash),
    "a seeded desk must accept the documented password",
  );
  assert.equal(await users.countUsers(), seeds.SEED_ACCOUNTS.length);
  pass(
    "seeded desks sign in with the published password",
    `${seeds.SEED_ACCOUNTS.length} desks · password "${seeds.seedPassword()}"`,
  );
}

{
  // A fresh hosted database: the demo password is published, so no desk may be
  // created with it. A child process gets its own copy of the seed-once flag.
  const seedCount = (env: Record<string, string>) => {
    const dir = mkdtempSync(path.join(tmpdir(), "aisle-seed-"));
    const script = `const u = await import(${JSON.stringify(pathToFileURL(path.join(root, "src/lib/auth/users.ts")).href)});
      await u.findUserByEmail("alex@aisle.website"); console.log("COUNT=" + await u.countUsers());`;
    const child = spawnSync(process.execPath, ["--import", "./scripts/service-loader.mjs", "--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", script], {
      cwd: root,
      env: { ...process.env, AISLE_SEED_PASSWORD: "", ...env, AISLE_DB_FILE: path.join(dir, "seed.db") },
      encoding: "utf8",
    });
    rmSync(dir, { recursive: true, force: true });
    const match = /COUNT=(\d+)/.exec(child.stdout);
    assert.ok(match, child.stderr || child.stdout);
    return Number(match[1]);
  };
  assert.equal(seedCount({ VERCEL: "1" }), 0, "hosted without AISLE_SEED_PASSWORD seeds no desks");
  assert.equal(seedCount({ VERCEL: "1", AISLE_SEED_PASSWORD: "owner-chosen-pass-1" }), seeds.SEED_ACCOUNTS.length);
  pass("seeded desks — a hosted install seeds none without AISLE_SEED_PASSWORD", "fresh database in a child process");
}

/* -------------------------------------------------------------- signup ---- */

const email = "founder@example.test";
let createdId = "";

{
  const created = await users.createUser({
    name: "Bao Xinlong",
    email,
    password: "correct-horse-9",
  });
  createdId = created.id;
  assert.equal(created.email, email);
  assert.equal(created.role, "beta");

  const stored = await users.findUserByEmail(email);
  assert.ok(stored, "the account must be readable straight after creation");
  assert.ok(await password.verifyPassword("correct-horse-9", stored.passwordHash));
  assert.ok(!(await password.verifyPassword("wrong-password", stored.passwordHash)));
  pass("signup — account created and password hashed", `${created.email} (${created.role})`);
}

{
  // Uniqueness must come from the database, and email matching must be
  // case-insensitive so the same person cannot hold two desks.
  await assert.rejects(
    () => users.createUser({ name: "Duplicate", email: "FOUNDER@Example.test", password: "another-pass-1" }),
    /already has an account/,
    "a second account for the same address must be refused",
  );
  assert.equal(await users.countUsers(), seeds.SEED_ACCOUNTS.length + 1);
  pass("signup — duplicate address refused case-insensitively", "database unique index, not a read-then-write check");
}

{
  const before = await users.findUserByEmail(email);
  const normalized = await users.findUserByEmail("  FOUNDER@EXAMPLE.TEST  ");
  assert.equal(normalized?.id, before?.id, "login must normalise the address");
  pass("login — address lookup is normalised", "trimmed and lower-cased");
}

/* ------------------------------------------------------------- sessions --- */

{
  const user = await users.findUserByEmail(email);
  const token = await session.signSession(users.publicUser(user!));
  const parsed = await session.readSession(token);
  assert.equal(parsed?.id, user!.id);
  assert.equal(parsed?.email, user!.email);
  const tampered = `${token.slice(0, -3)}abc`;
  assert.equal(await session.readSession(tampered), null, "a tampered token must not verify");
  pass("session — signed cookie round trip, tampering rejected", "HS256 via AUTH_SECRET");
}

{
  // Login signs the cookie with users.session_version and getCurrentUser
  // compares it with the row, so the row must carry the same number.
  const handle = await db.getDatabase();
  const user = await users.findUserByEmail(email);
  assert.equal(user!.sessionVersion, 0);
  await handle.execute("update users set session_version = 2 where id = $1", [user!.id]);
  const bumped = await users.findUserById(user!.id);
  assert.equal(bumped!.sessionVersion, 2, "the column is read into the account");
  const token = await session.signSession({ ...users.publicUser(bumped!), sessionVersion: bumped!.sessionVersion });
  assert.equal((await session.readSession(token))!.sessionVersion, bumped!.sessionVersion, "a fresh cookie matches the row");
  await handle.execute("update users set session_version = 0 where id = $1", [user!.id]);
  pass("session — version read from the row, so bumped accounts can still sign in", "users.session_version");
}

/* ------------------------------------------------------ sign-in redirect --- */

{
  // Browsers read a backslash, or a tab or newline after the first slash, as
  // "//", which would send a fresh session to another site.
  const refused = ["//evil.com", "/\\evil.com", "/\tevil.com", "/\t/evil.com", "/\n/evil.com", "https://evil.com", "javascript:alert(1)", "/.//evil.com", "/%2e//evil.com", "/a/..//evil.com", "/login", "/login?next=/x", "/signup", "", null];
  for (const value of refused) assert.equal(nextPath.safeNextPath(value), "/", JSON.stringify(value));
  assert.equal(nextPath.safeNextPath("/campaigns/7?tab=log#top"), "/campaigns/7?tab=log#top");
  assert.equal(nextPath.safeNextPath("/a/../studio"), "/studio");
  for (const value of [...refused, "/%2F%2Fevil.com", "/loginx"]) {
    const out = nextPath.safeNextPath(value);
    assert.equal(new URL(out, "https://aisle.website").origin, "https://aisle.website", JSON.stringify(value));
  }
  pass("sign-in redirect — only same-site paths survive ?next=", `${refused.length} unsafe or looping values fall back to /`);
}

/* ------------------------------------------------------------ documents --- */

{
  await kv.kvSet(`workspace/${createdId}`, {
    brand: { retailerName: "Lane & Co." },
    campaigns: [{ id: "cmp_1" }],
    settings: { theme: "simple" },
  });
  const back = await kv.kvGet<{ brand: { retailerName: string }; campaigns: unknown[] }>(
    `workspace/${createdId}`,
  );
  assert.equal(back?.brand.retailerName, "Lane & Co.");
  assert.equal(back?.campaigns.length, 1);

  // Upsert: a second save must replace, not duplicate.
  await kv.kvSet(`workspace/${createdId}`, { brand: { retailerName: "Second Save" }, campaigns: [] });
  const replaced = await kv.kvGet<{ brand: { retailerName: string } }>(`workspace/${createdId}`);
  assert.equal(replaced?.brand.retailerName, "Second Save");

  assert.equal(await kv.kvGet("workspace/does-not-exist"), null);
  const keys = await kv.kvKeys("workspace/");
  assert.equal(keys.length, 1, "the key prefix scan must find exactly the saved document");
  pass("workspace documents — saved, read back, replaced on second save", `${keys.length} key(s)`);
}

{
  // A corrupt document must read as absent rather than throwing into a route.
  const handle = await db.getDatabase();
  await handle.execute("insert into kv (key, value, updated_at) values ($1, $2, $3)", [
    "workspace/corrupt",
    "{not json",
    new Date().toISOString(),
  ]);
  assert.equal(await kv.kvGet("workspace/corrupt"), null);
  pass("storage — a corrupt document degrades to empty, not a crash", "JSON parse guarded");
}

/* ---------------------------------------------------------- persistence --- */

{
  await db.closeDatabase();
  const reopened = await db.getDatabase();
  assert.ok(reopened.label.includes("auth-suite.db"));
  const stillThere = await users.findUserByEmail(email);
  assert.equal(stillThere?.id, createdId, "accounts must survive a process restart");
  pass("persistence — accounts survive closing and reopening the database", "real file on disk");
}

/* ------------------------------------------------------------- failures --- */

{
  // Signing a session without a secret must fail loudly rather than issue a
  // token nobody can verify.
  const original = process.env.AUTH_SECRET;
  delete process.env.AUTH_SECRET;
  await assert.rejects(() => session.signSession({ id: "x", email: "x@y.z", name: "X", role: "beta" }));
  process.env.AUTH_SECRET = original;

  const unavailable = new db.DatabaseUnavailableError("test: backend offline");
  const described = storage.describeStorageFailure(unavailable, "signup test");
  assert.equal(described.unavailable, true);
  assert.ok(
    !described.message.toLowerCase().includes("sqlite") &&
      !described.message.toLowerCase().includes("postgres"),
    "a user-facing storage message must not name the driver",
  );
  assert.ok(described.detail.includes("signup test"), "the operator detail must keep the context");
  pass("failures — missing secret and unreachable storage reported clearly", described.message.slice(0, 60));
}

await db.closeDatabase();
for (const suffix of ["", "-wal", "-shm"]) {
  const file = `${dbFile}${suffix}`;
  if (existsSync(file)) rmSync(file);
}

console.log("\nAisle accounts and storage — scenario suite\n");
for (const r of results) console.log(`  ✓ ${r.name}\n      ${r.detail}`);
console.log(`\n${results.length} scenario groups passed.\n`);
