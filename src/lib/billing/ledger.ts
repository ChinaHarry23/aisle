/**
 * Credit balances and the ledger that explains them.
 *
 * The database layer has no transactions, so every change that must be atomic
 * is a single conditional statement: a debit only lands when the balance
 * covers it, a hold is settled by whoever flips its row first, and a monthly
 * reset only lands once per Stripe invoice (its ledger row is written first).
 * The SQL is shared by SQLite and Postgres, so it sticks to CASE expressions
 * rather than least()/greatest().
 *
 * Grant epochs: every monthly reset and every expiry bumps the account's
 * `grant_epoch`. A hold remembers the epoch it was taken in, and the unused
 * part of it is only returned within that epoch. A render that straddles a
 * renewal therefore cannot hand its hold back on top of the fresh 1,000, and a
 * cancelled user cannot get credits back after expiry. An overrun beyond the
 * hold is still charged.
 */

import { createHash, randomUUID } from "node:crypto";
import { getDatabase, type Database } from "@/lib/db";
import { freeCredits, freeGrantsPerDay, MILLI, milliForCost, PLAN } from "./plan";

type LedgerReason = "free_grant" | "monthly_reset" | "usage" | "dev_usage" | "adjust" | "expired" | "topup" | "reversal";

export type LedgerEntry = {
  id: string;
  deltaMilli: number;
  reason: LedgerReason;
  ref: string | null;
  modelId: string | null;
  costUsd: number | null;
  balanceAfterMilli: number | null;
  note: string | null;
  createdAt: string;
};

type LedgerRow = {
  id: string;
  delta_milli: number | string;
  reason: string;
  ref: string | null;
  model_id: string | null;
  cost_usd: number | string | null;
  balance_after_milli: number | string | null;
  note: string | null;
  created_at: string;
};

/** A hold older than this belonged to a call whose process died; the sweeper returns it. Longer than any route's maxDuration. */
const HOLD_TTL_MS = 20 * 60_000;

const now = () => new Date().toISOString();
const num = (value: unknown) => (value == null ? null : Number(value));

async function writeLedger(
  db: Database,
  entry: {
    userId: string;
    deltaMilli: number;
    reason: LedgerReason;
    ref?: string | null;
    modelId?: string | null;
    costUsd?: number | null;
    balanceAfterMilli?: number | null;
    note?: string | null;
  },
) {
  // (reason, ref) is unique, so a replayed grant or charge is a no-op.
  await db.execute(
    `insert into credit_ledger
       (id, user_id, delta_milli, reason, ref, model_id, cost_usd, balance_after_milli, note, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict do nothing`,
    [
      randomUUID(),
      entry.userId,
      entry.deltaMilli,
      entry.reason,
      entry.ref ?? null,
      entry.modelId ?? null,
      entry.costUsd ?? null,
      entry.balanceAfterMilli ?? null,
      entry.note ?? null,
      now(),
    ],
  );
}

/* ---------- Free credits ---------- */

/**
 * One free grant per person, not per account: lower-cased, "+tag" removed, and
 * for Gmail the dots too (they all reach the same inbox), on gmail.com.
 */
export function canonicalEmail(email: string): string {
  const clean = email.trim().toLowerCase();
  const at = clean.lastIndexOf("@");
  if (at <= 0) return clean;
  let local = clean.slice(0, at);
  let domain = clean.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus >= 0) local = local.slice(0, plus);
  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.replace(/\./g, "");
    domain = "gmail.com";
  }
  return `${local}@${domain}`;
}

/**
 * Grant the free credits to a new account when its person has not had them.
 * Team desks (role "dev") get none. The grant is claimed in `free_grants`
 * under the canonical email, and only while today's grants are under
 * FREE_GRANTS_PER_DAY, in one statement. A claim this user already holds
 * (a crash between the claim and the credit) is completed, never repeated.
 * `ignoreDailyCap` is the one-time backfill of accounts that already exist.
 */
async function grantFreeCredits(db: Database, userId: string, ignoreDailyCap = false): Promise<boolean> {
  const free = freeCredits() * MILLI;
  if (free <= 0) return false;
  const users = await db.query<{ email: string; role: string }>("select email, role from users where id = $1", [userId]);
  const user = users[0];
  if (user?.role === "dev") return false;
  // An id with no account row only exists in tests and owner scripts; key it on the id.
  const identity = user ? `email:${canonicalEmail(user.email)}` : `user:${userId}`;
  const at = now();
  const dayStart = `${at.slice(0, 10)}T00:00:00.000Z`;
  const claimed = await db.query(
    `insert into free_grants (identity_key, user_id, granted_at)
     select $1, $2, $3
     where cast($6 as integer) = 1
        or (select count(*) from free_grants where granted_at >= $4) < cast($5 as integer)
     on conflict do nothing
     returning identity_key`,
    [identity, userId, at, dayStart, freeGrantsPerDay(), ignoreDailyCap ? 1 : 0],
  );
  if (!claimed.length) {
    const holder = await db.query<{ user_id: string }>("select user_id from free_grants where identity_key = $1", [identity]);
    if (holder[0]?.user_id !== userId) return false; // someone else's, or today's cap is reached
  }
  const rows = await db.query<{ balance_milli: number | string }>(
    `update credit_accounts set balance_milli = balance_milli + $1, free_granted_at = $2, updated_at = $2
     where user_id = $3 and free_granted_at is null
     returning balance_milli`,
    [free, at, userId],
  );
  if (!rows.length) return false;
  await writeLedger(db, {
    userId,
    deltaMilli: free,
    reason: "free_grant",
    ref: userId,
    balanceAfterMilli: num(rows[0].balance_milli),
    note: `${freeCredits()} free credits to try cloud models`,
  });
  return true;
}

/**
 * Create the account on first use, and grant the free credits if this person
 * is due them. A grant the daily cap blocked is retried on later visits for
 * as long as the account has never received one, so an old signup is not
 * stuck at zero after the cap (or a FREE_CREDITS=0 deploy) lifts. The claim
 * on the canonical email keeps the retry to one grant per person.
 */
async function ensureCreditAccount(userId: string): Promise<void> {
  const db = await getDatabase();
  const created = await db.query(
    `insert into credit_accounts (user_id, balance_milli, free_granted_at, updated_at)
     values ($1, 0, null, $2)
     on conflict (user_id) do nothing
     returning user_id`,
    [userId, now()],
  );
  if (created.length) {
    await grantFreeCredits(db, userId);
    return;
  }
  const pending = await db.query<{ user_id: string }>(
    `select a.user_id from credit_accounts a join users u on u.id = a.user_id
     where a.user_id = $1 and a.free_granted_at is null and u.role <> 'dev'`,
    [userId],
  );
  if (pending.length) await grantFreeCredits(db, userId);
}

/**
 * Give the current trial to every non-desk account that has never had it.
 * Ignores the daily cap: these people already signed up. One canonical email
 * still receives it once. Safe to run again.
 */
export async function grantOutstandingTrials(): Promise<number> {
  const db = await getDatabase();
  const rows = await db.query<{ id: string }>(
    `select u.id from users u
     left join credit_accounts a on a.user_id = u.id
     where u.role <> 'dev' and a.free_granted_at is null`,
  );
  let granted = 0;
  for (const row of rows) {
    await db.execute(
      `insert into credit_accounts (user_id, balance_milli, free_granted_at, updated_at)
       values ($1, 0, null, $2)
       on conflict (user_id) do nothing`,
      [row.id, now()],
    );
    if (await grantFreeCredits(db, row.id, true)) granted += 1;
  }
  return granted;
}

/** One backfill per process when AISLE_TRIAL_BACKFILL=1. A failure is retried next time. */
let trialBackfill: Promise<void> | null = null;

function scheduleTrialBackfill(): Promise<void> {
  if (process.env.AISLE_TRIAL_BACKFILL !== "1") return Promise.resolve();
  if (!trialBackfill) {
    trialBackfill = grantOutstandingTrials()
      .then((count) => {
        if (count > 0) console.log(`[billing] granted the free trial to ${count} existing account(s)`);
      })
      .catch((error) => {
        trialBackfill = null;
        console.error("[billing] trial backfill failed", error instanceof Error ? error.message : error);
      });
  }
  return trialBackfill;
}

/* ---------- Holds ---------- */

/** Closed hold rows are kept this long (for support questions), then pruned by the sweeper. */
const HOLD_KEEP_MS = 30 * 86_400_000;
const PRUNE_EVERY_MS = 3_600_000;
const lastPrune = new Map<string, number>();

/**
 * Return holds left open by a call whose process never came back (a function
 * timeout, a deploy, a crash). Each hold row is flipped once, so only one
 * sweeper refunds it, and only within the grant epoch it was taken in.
 *
 * A hold parked as `pending_settle` (its settle failed twice) is not refunded:
 * the charge it recorded is applied instead. Closed rows older than
 * HOLD_KEEP_MS are pruned, at most once an hour per user and process.
 */
export async function sweepStaleHolds(userId: string): Promise<number> {
  const nowMs = Date.now();
  const db = await getDatabase();
  const parked = await db.query<{ ref: string; milli: number | string; epoch: number | string; charged_milli: number | string | null }>(
    "select ref, milli, epoch, charged_milli from credit_holds where user_id = $1 and status = 'pending_settle'",
    [userId],
  );
  for (const hold of parked) {
    await settleCredits(userId, {
      heldMilli: Number(hold.milli),
      chargedMilli: Number(hold.charged_milli ?? 0),
      ref: hold.ref,
      epoch: Number(hold.epoch),
      note: "Charge applied after an interrupted settle",
    }).catch((error) => console.error("[billing] parked settle failed", error instanceof Error ? error.message : error));
  }
  const stale = await db.query<{ ref: string; milli: number | string; epoch: number | string }>(
    `update credit_holds set status = 'swept'
     where user_id = $1 and status = 'open' and created_at < $2
     returning ref, milli, epoch`,
    [userId, new Date(nowMs - HOLD_TTL_MS).toISOString()],
  );
  let returned = 0;
  for (const hold of stale) {
    const milli = Number(hold.milli);
    const epoch = Number(hold.epoch);
    const rows = await db.query<{ balance_milli: number | string; grant_epoch: number | string }>(
      `update credit_accounts
       set balance_milli = balance_milli + case when grant_epoch = cast($1 as integer) then cast($2 as integer) else 0 end,
           updated_at = $3
       where user_id = $4
       returning balance_milli, grant_epoch`,
      [epoch, milli, now(), userId],
    );
    if (!rows.length || Number(rows[0].grant_epoch) !== epoch) {
      // A reset or expiry came in between: nothing to give back, but a late settle may still owe an overrun.
      await db.execute("update credit_holds set status = 'lapsed' where ref = $1 and status = 'swept'", [hold.ref]);
      continue;
    }
    returned += milli;
    await writeLedger(db, {
      userId,
      deltaMilli: milli,
      reason: "adjust",
      ref: `hold:${hold.ref}`,
      balanceAfterMilli: num(rows[0].balance_milli),
      note: "Hold released after an interrupted call",
    });
  }
  if (nowMs - (lastPrune.get(userId) ?? -Infinity) >= PRUNE_EVERY_MS) {
    if (lastPrune.size > 10_000) lastPrune.clear();
    lastPrune.set(userId, nowMs);
    // No call runs for 30 days, so no settle can still be coming for these rows.
    await db.execute(
      "delete from credit_holds where user_id = $1 and status in ('settled', 'lapsed', 'swept') and created_at < $2",
      [userId, new Date(nowMs - HOLD_KEEP_MS).toISOString()],
    );
  }
  return returned;
}

export async function balanceMilli(userId: string): Promise<number> {
  await scheduleTrialBackfill();
  await ensureCreditAccount(userId);
  await sweepStaleHolds(userId);
  const db = await getDatabase();
  const rows = await db.query<{ balance_milli: number | string }>(
    "select balance_milli from credit_accounts where user_id = $1",
    [userId],
  );
  return Number(rows[0]?.balance_milli ?? 0);
}

/**
 * Take `milli` from the balance only if it covers it, and record the hold
 * under `ref`. Returns the grant epoch the hold belongs to, or null when the
 * balance does not cover it.
 */
export async function reserveCredits(userId: string, milli: number, ref: string): Promise<number | null> {
  const amount = Math.max(0, Math.ceil(milli));
  await ensureCreditAccount(userId);
  await sweepStaleHolds(userId);
  const db = await getDatabase();
  const rows = await db.query<{ grant_epoch: number | string }>(
    `update credit_accounts set balance_milli = balance_milli - $1, updated_at = $2
     where user_id = $3 and balance_milli >= $1
     returning grant_epoch`,
    [amount, now(), userId],
  );
  if (!rows.length) return null;
  const epoch = Number(rows[0].grant_epoch);
  try {
    await db.execute(
      `insert into credit_holds (ref, user_id, milli, epoch, status, created_at)
       values ($1, $2, $3, $4, 'open', $5)`,
      [ref, userId, amount, epoch, now()],
    );
  } catch (error) {
    // No record means nothing could ever return it: undo the debit now.
    await db
      .execute(
        `update credit_accounts
         set balance_milli = balance_milli + case when grant_epoch = cast($1 as integer) then cast($2 as integer) else 0 end
         where user_id = $3`,
        [epoch, amount, userId],
      )
      .catch(() => {});
    throw error;
  }
  return epoch;
}

type HoldRow = { milli: number | string; epoch: number | string; status: string };

/**
 * Close a reservation: return what was held beyond the real charge and record
 * the charge. A charge above the hold (a provider overrun) still lands, so the
 * balance can dip below zero rather than a completed call going unbilled.
 *
 * - The hold row is claimed first, so a second settle or release is a no-op.
 * - After a reset or expiry (another epoch) nothing is returned; only an overrun is charged.
 * - If the sweeper already returned the hold (same epoch), the real charge lands as a fresh debit.
 *   A swept hold from an earlier epoch was forfeited at the reset (or is about to be, when the
 *   sweeper is mid-way), so it is treated as lapsed: only an overrun is charged.
 */
export async function settleCredits(
  userId: string,
  input: {
    heldMilli: number;
    chargedMilli: number;
    ref: string;
    /** The epoch the hold was taken in; only used for a hold with no stored row. */
    epoch?: number;
    modelId?: string;
    costUsd?: number;
    note?: string;
  },
): Promise<void> {
  const db = await getDatabase();
  const charged = Math.max(0, Math.ceil(input.chargedMilli));

  // `inEpoch` is added to the balance while the account is still in `epoch`;
  // in any other epoch `otherwise` applies, and only when negative (an overrun).
  let inEpoch: number;
  let otherwise: number;
  let epoch: number;
  let undo: (() => Promise<void>) | null = null;

  // An open hold, or one parked by a settle that failed earlier (claimed in that order).
  let claimed: HoldRow | undefined;
  let claimedFrom = "open";
  for (const status of ["open", "pending_settle"]) {
    claimed = (
      await db.query<HoldRow>(
        "update credit_holds set status = 'settled' where ref = $1 and status = $2 returning milli, epoch, status",
        [input.ref, status],
      )
    )[0];
    claimedFrom = status;
    if (claimed) break;
  }
  const found = claimed
    ? null
    : (await db.query<HoldRow>("select milli, epoch, status from credit_holds where ref = $1", [input.ref]))[0];
  if (claimed) {
    inEpoch = otherwise = Number(claimed.milli) - charged;
    epoch = Number(claimed.epoch);
    const previous = claimedFrom;
    undo = () => db.execute("update credit_holds set status = $2 where ref = $1 and status = 'settled'", [input.ref, previous]);
  } else if (found) {
    if (found.status !== "swept" && found.status !== "lapsed") return; // already settled
    const late = await db.query<HoldRow>(
      "update credit_holds set status = 'settled' where ref = $1 and status = $2 returning milli, epoch, status",
      [input.ref, found.status],
    );
    if (!late.length) return; // someone else settled it meanwhile
    const milli = Number(found.milli);
    // Swept in this epoch: the hold went back to the balance, so the whole charge is new.
    // Lapsed, or swept in an earlier epoch: the hold was forfeited, so only an overrun is owed.
    inEpoch = found.status === "swept" ? -charged : milli - charged;
    otherwise = milli - charged;
    epoch = found.status === "swept" ? Number(found.epoch) : -1;
    const previous = found.status;
    undo = () => db.execute("update credit_holds set status = $2 where ref = $1 and status = 'settled'", [input.ref, previous]);
  } else {
    // A hold with no stored row (taken before holds were stored).
    inEpoch = otherwise = Math.ceil(input.heldMilli) - charged;
    epoch = input.epoch ?? -1;
  }

  let balanceAfter: number | null = null;
  try {
    const rows = await db.query<{ balance_milli: number | string }>(
      `update credit_accounts
       set balance_milli = balance_milli + case
             when grant_epoch = cast($4 as integer) then cast($1 as integer)
             when cast($5 as integer) < 0 then cast($5 as integer)
             else 0 end,
           updated_at = $2
       where user_id = $3
       returning balance_milli`,
      [inEpoch, now(), userId, epoch, otherwise],
    );
    balanceAfter = num(rows[0]?.balance_milli);
  } catch (error) {
    // Put the hold back so a retry (or the sweeper) can still close it.
    if (undo) await undo().catch(() => {});
    throw error;
  }
  if (charged <= 0) return;
  await writeLedger(db, {
    userId,
    deltaMilli: -charged,
    reason: "usage",
    ref: input.ref,
    modelId: input.modelId,
    costUsd: input.costUsd,
    balanceAfterMilli: balanceAfter,
    note: input.note,
  });
}

/**
 * A settle that failed even after its retry: park the charge on the open hold
 * row, so the sweeper applies it on the user's next balance check instead of
 * handing the whole hold back after HOLD_TTL_MS. Best effort (the database may
 * be down); returns whether the row was parked.
 */
export async function parkSettle(ref: string, chargedMilli: number): Promise<boolean> {
  const db = await getDatabase();
  const rows = await db.query(
    "update credit_holds set status = 'pending_settle', charged_milli = $2 where ref = $1 and status = 'open' returning ref",
    [ref, Math.max(0, Math.ceil(chargedMilli))],
  );
  return rows.length > 0;
}

/**
 * A dev desk is not charged. The credit amount that call would have used is
 * still written on the ledger, and the balance is left alone.
 */
export async function recordDevUsage(
  userId: string,
  input: { ref: string; modelId?: string; costUsd: number; note?: string },
): Promise<void> {
  const db = await getDatabase();
  await writeLedger(db, {
    userId,
    deltaMilli: -milliForCost(input.costUsd),
    reason: "dev_usage",
    ref: input.ref,
    modelId: input.modelId,
    costUsd: input.costUsd,
    note: input.note,
  });
}

/* ---------- Grants from Stripe ---------- */

/**
 * A paid Stripe invoice sets the balance to the monthly allowance, once per
 * invoice: its ledger row (unique on reason + invoice id) is written first and
 * the balance only changes when that insert landed. A debt (an overrun) is
 * carried into the new month rather than forgiven, and the grant epoch moves
 * on so holds from last month return nothing.
 */
export async function resetForInvoice(userId: string, invoiceId: string): Promise<boolean> {
  const before = await balanceMilli(userId);
  const db = await getDatabase();
  const monthly = PLAN.monthlyCredits * MILLI;
  const ledgerId = randomUUID();
  const inserted = await db.query(
    `insert into credit_ledger
       (id, user_id, delta_milli, reason, ref, model_id, cost_usd, balance_after_milli, note, created_at)
     values ($1, $2, $3, 'monthly_reset', $4, null, null, $5, $6, $7)
     on conflict do nothing
     returning id`,
    [
      ledgerId,
      userId,
      monthly - before,
      invoiceId,
      monthly,
      `${PLAN.monthlyCredits.toLocaleString("en-US")} credits for this month`,
      now(),
    ],
  );
  if (!inserted.length) return false;
  let after: number;
  try {
    const rows = await db.query<{ balance_milli: number | string }>(
      `update credit_accounts
       set balance_milli = cast($1 as integer) + case when balance_milli < 0 then balance_milli else 0 end,
           grant_epoch = grant_epoch + 1,
           last_grant_ref = $2,
           updated_at = $3
       where user_id = $4
       returning balance_milli`,
      [monthly, invoiceId, now(), userId],
    );
    if (!rows.length) throw new Error(`No credit account for ${userId}.`);
    after = Number(rows[0].balance_milli);
  } catch (error) {
    // Let Stripe's retry grant it: drop the marker that says it was done.
    await db.execute("delete from credit_ledger where id = $1", [ledgerId]).catch(() => {});
    throw error;
  }
  if (after !== monthly) {
    await db.execute("update credit_ledger set delta_milli = $1, balance_after_milli = $2, note = $3 where id = $4", [
      after - before,
      after,
      `${PLAN.monthlyCredits.toLocaleString("en-US")} credits for this month, less ${((monthly - after) / MILLI).toLocaleString("en-US")} carried over`,
      ledgerId,
    ]);
  }
  return true;
}

/**
 * The subscription ended: this month's credits do not outlive it (no rollover).
 * The ledger row is written first and keyed on `ref` (the subscription id), so
 * only the first delivery of the event zeroes the balance. A debt stays, and
 * the grant epoch moves on so an in-flight hold returns nothing afterwards.
 */
export async function expireCredits(userId: string, ref: string, note: string): Promise<boolean> {
  const before = await balanceMilli(userId);
  const db = await getDatabase();
  const ledgerId = randomUUID();
  const inserted = await db.query(
    `insert into credit_ledger
       (id, user_id, delta_milli, reason, ref, model_id, cost_usd, balance_after_milli, note, created_at)
     values ($1, $2, $3, 'expired', $4, null, null, $5, $6, $7)
     on conflict do nothing
     returning id`,
    [ledgerId, userId, -Math.max(0, before), ref, Math.min(0, before), note, now()],
  );
  if (!inserted.length) return false;
  try {
    await db.execute(
      `update credit_accounts
       set balance_milli = case when balance_milli < 0 then balance_milli else 0 end,
           grant_epoch = grant_epoch + 1,
           updated_at = $1
       where user_id = $2`,
      [now(), userId],
    );
  } catch (error) {
    await db.execute("delete from credit_ledger where id = $1", [ledgerId]).catch(() => {});
    throw error;
  }
  return true;
}

/**
 * Add a bought pack to the balance, once per `ref` (the PaymentIntent id).
 * The ledger row is written first, so a replayed webhook cannot grant twice.
 */
export async function grantTopup(userId: string, credits: number, ref: string, note: string): Promise<boolean> {
  if (!ref || !Number.isFinite(credits) || credits <= 0) return false;
  await scheduleTrialBackfill();
  await ensureCreditAccount(userId);
  const milli = Math.round(credits) * MILLI;
  const db = await getDatabase();
  const ledgerId = randomUUID();
  const inserted = await db.query(
    `insert into credit_ledger
       (id, user_id, delta_milli, reason, ref, model_id, cost_usd, balance_after_milli, note, created_at)
     values ($1, $2, $3, 'topup', $4, null, null, null, $5, $6)
     on conflict do nothing
     returning id`,
    [ledgerId, userId, milli, ref, note, now()],
  );
  if (!inserted.length) return false;
  try {
    const rows = await db.query<{ balance_milli: number | string }>(
      `update credit_accounts set balance_milli = balance_milli + $1, updated_at = $2
       where user_id = $3
       returning balance_milli`,
      [milli, now(), userId],
    );
    if (!rows.length) throw new Error(`No credit account for ${userId}.`);
    await db.execute("update credit_ledger set balance_after_milli = $1 where id = $2", [num(rows[0].balance_milli), ledgerId]);
  } catch (error) {
    await db.execute("delete from credit_ledger where id = $1", [ledgerId]).catch(() => {});
    throw error;
  }
  return true;
}

/**
 * Take back one bought pack. Null when `paymentIntentId` was not a pack this
 * account received (a subscription charge still goes through expiry). False
 * when this reversal was already applied.
 */
export async function reverseTopup(
  userId: string,
  paymentIntentId: string,
  reversalRef: string,
  note: string,
): Promise<boolean | null> {
  const db = await getDatabase();
  const grants = await db.query<{ delta_milli: number | string }>(
    "select delta_milli from credit_ledger where user_id = $1 and reason = 'topup' and ref = $2",
    [userId, paymentIntentId],
  );
  const amount = Number(grants[0]?.delta_milli ?? 0);
  if (!grants.length || !Number.isFinite(amount) || amount <= 0) return null;
  const ledgerId = randomUUID();
  const inserted = await db.query(
    `insert into credit_ledger
       (id, user_id, delta_milli, reason, ref, model_id, cost_usd, balance_after_milli, note, created_at)
     values ($1, $2, $3, 'reversal', $4, null, null, null, $5, $6)
     on conflict do nothing
     returning id`,
    [ledgerId, userId, -amount, reversalRef, note, now()],
  );
  if (!inserted.length) return false;
  try {
    const rows = await db.query<{ balance_milli: number | string }>(
      `update credit_accounts set balance_milli = balance_milli - $1, updated_at = $2
       where user_id = $3
       returning balance_milli`,
      [amount, now(), userId],
    );
    if (!rows.length) throw new Error(`No credit account for ${userId}.`);
    await db.execute("update credit_ledger set balance_after_milli = $1 where id = $2", [num(rows[0].balance_milli), ledgerId]);
  } catch (error) {
    await db.execute("delete from credit_ledger where id = $1", [ledgerId]).catch(() => {});
    throw error;
  }
  return true;
}

/** Owner-side correction, e.g. a goodwill top-up from the CLI. */
export async function adjustCredits(userId: string, deltaMilli: number, note: string): Promise<number> {
  await ensureCreditAccount(userId);
  const db = await getDatabase();
  const rows = await db.query<{ balance_milli: number | string }>(
    `update credit_accounts set balance_milli = balance_milli + $1, updated_at = $2
     where user_id = $3
     returning balance_milli`,
    [deltaMilli, now(), userId],
  );
  const after = Number(rows[0]?.balance_milli ?? 0);
  await writeLedger(db, { userId, deltaMilli, reason: "adjust", ref: randomUUID(), balanceAfterMilli: after, note });
  return after;
}

/** Spend since the latest credit grant, plus the pool those credits came from. */
export async function creditMeter(userId: string, balance: number): Promise<{ spentMilli: number; allowanceMilli: number }> {
  const db = await getDatabase();
  const grants = await db.query<{ created_at: string }>(
    `select created_at from credit_ledger
     where user_id = $1 and delta_milli > 0 and reason in ('free_grant', 'monthly_reset', 'adjust', 'topup')
     order by created_at desc limit 1`,
    [userId],
  );
  const since = grants[0]?.created_at;
  const rows = await db.query<{ spent: number | string }>(
    since
      ? `select coalesce(sum(case when delta_milli < 0 then -delta_milli else 0 end), 0) as spent
         from credit_ledger
         where user_id = $1 and created_at > $2 and reason in ('usage', 'dev_usage')`
      : `select coalesce(sum(case when delta_milli < 0 then -delta_milli else 0 end), 0) as spent
         from credit_ledger
         where user_id = $1 and reason in ('usage', 'dev_usage')`,
    since ? [userId, since] : [userId],
  );
  const spentMilli = Math.max(0, Number(rows[0]?.spent ?? 0));
  return { spentMilli, allowanceMilli: balance + spentMilli };
}

export async function recentLedger(userId: string, limit = 25): Promise<LedgerEntry[]> {
  const db = await getDatabase();
  const rows = await db.query<LedgerRow>(
    `select id, delta_milli, reason, ref, model_id, cost_usd, balance_after_milli, note, created_at
     from credit_ledger where user_id = $1
     order by created_at desc
     limit $2`,
    [userId, Math.max(1, Math.min(200, Math.floor(limit)))],
  );
  return rows.map((row) => ({
    id: row.id,
    deltaMilli: Number(row.delta_milli),
    reason: row.reason as LedgerReason,
    ref: row.ref,
    modelId: row.model_id,
    costUsd: num(row.cost_usd),
    balanceAfterMilli: num(row.balance_after_milli),
    note: row.note,
    createdAt: row.created_at,
  }));
}

/* ---------- Signup rate limit ---------- */

/** Accounts one address may open per hour. Protects the free grant from scripted signups. */
export const SIGNUPS_PER_IP_HOUR = 5;

const ipKey = (ip: string) => createHash("sha256").update(`aisle-signup:${ip}`).digest("hex").slice(0, 32);

/**
 * Claim one of this address's signups for the hour. The attempt is recorded
 * first and then counted together with every other attempt in the window, so
 * a burst of parallel signups cannot all pass a check made before any of them
 * was written: whichever count runs last sees every row that passed. An
 * attempt over the limit deletes its own row and is refused. `release` gives
 * the slot back when the signup then fails (a duplicate email, say). Only a
 * hash of the address is kept, for a day.
 */
export async function claimSignupSlot(ip: string): Promise<{ allowed: boolean; release: () => Promise<void> }> {
  const nowMs = Date.now();
  const db = await getDatabase();
  const id = randomUUID();
  const key = ipKey(ip);
  await db.execute("insert into signup_attempts (id, ip_key, created_at) values ($1, $2, $3)", [
    id,
    key,
    new Date(nowMs).toISOString(),
  ]);
  const release = async () => {
    await db.execute("delete from signup_attempts where id = $1", [id]);
  };
  const rows = await db.query<{ n: number | string }>(
    "select count(*) as n from signup_attempts where ip_key = $1 and created_at >= $2",
    [key, new Date(nowMs - 3_600_000).toISOString()],
  );
  if (Number(rows[0]?.n ?? 0) > SIGNUPS_PER_IP_HOUR) {
    await release();
    return { allowed: false, release: async () => {} };
  }
  await db.execute("delete from signup_attempts where created_at < $1", [new Date(nowMs - 86_400_000).toISOString()]);
  return { allowed: true, release };
}
