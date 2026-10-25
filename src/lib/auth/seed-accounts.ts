import { isHosted } from "@/lib/billing/hosted";
import type { UserRole } from "./types";

/**
 * The shared team desks created on a brand-new database.
 *
 * Locally they use a published demo password so the class team and the marker
 * can sign in straight away. A hosted install is reachable by anyone, so there
 * the desks are seeded only when `AISLE_SEED_PASSWORD` is set, and the login
 * route still refuses the demo password for a desk created before that rule.
 * `npm run user -- password <email>` changes one desk's password.
 */
export const DEMO_SEED_PASSWORD = "aisle-demo-2026";

/** The desks' password, or null on a hosted install without AISLE_SEED_PASSWORD (the demo password does not sign in there). */
export function seedPassword(): string | null {
  return process.env.AISLE_SEED_PASSWORD || (isHosted() ? null : DEMO_SEED_PASSWORD);
}

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
