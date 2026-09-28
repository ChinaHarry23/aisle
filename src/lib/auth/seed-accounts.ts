import type { UserRole } from "./types";

/**
 * The shared team desks created on a brand-new database.
 *
 * `SEED_PASSWORD` is deliberately a published demo credential: these accounts are
 * for the class team's shared desks and the marker's walkthrough, not for anyone's
 * real data. Change it (or create your own account and stop using these) before
 * pointing the app at anything that matters — `npm run user -- password <email>`
 * changes one, and `AISLE_SEED_PASSWORD` overrides the value at seed time.
 */
export const SEED_PASSWORD = process.env.AISLE_SEED_PASSWORD || "aisle-demo-2026";

export const SEED_ACCOUNTS: {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}[] = [
  { id: "dev-alex", email: "alex@aisle.website", name: "Alex Chen", role: "dev" },
  { id: "dev-sam", email: "sam@aisle.website", name: "Sam Okonkwo", role: "dev" },
  { id: "dev-jordan", email: "jordan@aisle.website", name: "Jordan Lee", role: "dev" },
  { id: "dev-riley", email: "riley@aisle.website", name: "Riley Nguyen", role: "dev" },
  { id: "dev-casey", email: "casey@aisle.website", name: "Casey Hart", role: "dev" },
];
