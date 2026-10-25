import { databaseUrl } from "@/lib/db/env";

let warned = false;

/**
 * A hosted deployment, where anyone on the internet can reach the app: Vercel
 * (VERCEL=1), any host the owner marks with AISLE_HOSTED=1, or a production
 * build on Postgres — a shared database only makes sense on a server, so a
 * host that forgot AISLE_HOSTED fails closed rather than open.
 *
 * `npm run start` on a laptop (a demo, or marking) is production mode on the
 * local SQLite file and stays a private install, so the team desks there are
 * not locked. Set AISLE_HOSTED=0 to force a local install.
 *
 * Imports only the import-free db/env.ts, so the auth layer (seeded desks) and
 * the billing layer (unlimited desks) can share it without an import cycle.
 */
export function isHosted() {
  if (process.env.AISLE_HOSTED === "0") return false;
  if (process.env.VERCEL === "1" || process.env.AISLE_HOSTED === "1") return true;
  if (process.env.NODE_ENV !== "production") return false;
  const postgres = databaseUrl() !== null;
  if (!postgres && !warned) {
    warned = true;
    console.warn("[aisle] production build on local SQLite: treating this as a private install. Set AISLE_HOSTED=1 if it is on the internet.");
  }
  return postgres;
}
