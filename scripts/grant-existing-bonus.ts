/**
 * Add 1,000 credits to every account that already exists.
 *
 *   node --env-file-if-exists=.env.local --import ./scripts/service-loader.mjs --experimental-strip-types scripts/grant-existing-bonus.ts
 *
 * The ledger ref is one per account, so running this again does not add more.
 */

import "./service-loader.mjs";

const BONUS_CREDITS = 1000;
const BONUS_REF = "existing-bonus-1000-2026-11-01";

const { closeDatabase, databaseLabel, getDatabase } = await import("../src/lib/db/index");
const { grantAdjustmentOnce, balanceMilli } = await import("../src/lib/billing/ledger");
const { formatCredits } = await import("../src/lib/billing/plan");

const db = await getDatabase();
const users = await db.query<{ id: string; email: string; role: string }>(
  "select id, email, role from users order by created_at",
);
console.log(databaseLabel());
console.log(`${users.length} existing account(s)`);

let granted = 0;
let already = 0;
for (const user of users) {
  const before = await balanceMilli(user.id);
  const added = await grantAdjustmentOnce(
    user.id,
    BONUS_CREDITS,
    `${BONUS_REF}:${user.id}`,
    "1,000 credits for accounts that already existed on 1 Nov 2026",
  );
  const after = await balanceMilli(user.id);
  if (added) granted += 1;
  else already += 1;
  console.log(
    `${added ? "granted" : "already"}  ${user.role.padEnd(6)}  ${user.email}  ${formatCredits(before)} -> ${formatCredits(after)}`,
  );
}
console.log(`granted ${granted}, already had this bonus ${already}`);
await closeDatabase();
