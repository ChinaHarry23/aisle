/**
 * Metering for every call that spends the owner's provider keys.
 *
 * The two paid funnels — `runComplete` (agent LLMs) and `runGeneration`
 * (posters and ad videos) — take a `BillingContext`, reserve the worst case
 * before calling out, and settle the real cost after. Missing context fails
 * closed: a caller that forgot to say who is paying cannot spend platform
 * money. Local models never reach this module.
 */

import { randomUUID } from "node:crypto";
import type { SessionUser, UserRole } from "@/lib/auth/types";
import { isHosted } from "./hosted";
import { parkSettle, recordDevUsage, reserveCredits, settleCredits } from "./ledger";
import { milliForCost } from "./plan";

export type BillingContext =
  | { kind: "user"; userId: string; role: UserRole; email?: string }
  /** Offline tests and owner scripts: runs cloud calls without charging anyone. */
  | { kind: "unmetered"; reason: string };

export const UNMETERED_TEST: BillingContext = { kind: "unmetered", reason: "offline test" };

export function billingFor(user: { id: string; role: UserRole; email?: string }): BillingContext {
  return { kind: "user", userId: user.id, role: user.role, email: user.email };
}

/**
 * Who spends the owner's keys without credits. Team desks (role "dev") are
 * unlimited on a local install; on a hosted one only the ids or emails listed
 * in AISLE_UNLIMITED_USERS are, so a known desk password cannot open the tap.
 */
export function isUnlimited(ctx: BillingContext | undefined): boolean {
  if (!ctx || ctx.kind !== "user" || ctx.role !== "dev") return false;
  if (!isHosted()) return true;
  const allow = (process.env.AISLE_UNLIMITED_USERS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return allow.includes(ctx.userId.toLowerCase()) || Boolean(ctx.email && allow.includes(ctx.email.toLowerCase()));
}

/**
 * Billing for a signed-in session. Pass the SessionUser from getCurrentUser(),
 * whose role was read from the database rather than the 30-day cookie, so a
 * demoted desk stops being unlimited at once.
 */
export async function billingForSession(session: SessionUser): Promise<BillingContext> {
  return billingFor(session);
}

export type Hold = {
  ctx: BillingContext;
  ref: string;
  heldMilli: number;
  /** False for dev desks and unmetered runs: nothing was taken, nothing to settle. */
  charged: boolean;
  /** The grant epoch the hold was taken in (0 when nothing was taken). */
  epoch: number;
};

/**
 * Reserve up to `estimateUsd` of credits for one provider call. Null means the
 * caller cannot pay — no context, or not enough credits — and the call must
 * not go out on the platform key.
 */
export async function holdCredits(ctx: BillingContext | undefined, estimateUsd: number): Promise<Hold | null> {
  if (!ctx) return null;
  // NaN would round to a zero hold and let the call through for free.
  if (!Number.isFinite(estimateUsd) || estimateUsd < 0) return null;
  const ref = randomUUID();
  if (ctx.kind === "unmetered" || isUnlimited(ctx)) return { ctx, ref, heldMilli: 0, charged: false, epoch: 0 };
  const milli = milliForCost(estimateUsd);
  const epoch = await reserveCredits(ctx.userId, milli, ref);
  if (epoch === null) return null;
  return { ctx, ref, heldMilli: milli, charged: true, epoch };
}

/** Charge what the call really cost and return the rest of the hold. */
export async function settleHold(
  hold: Hold,
  actualUsd: number,
  detail: { modelId: string; note?: string },
): Promise<void> {
  const cost = Number.isFinite(actualUsd) && actualUsd > 0 ? actualUsd : 0;
  if (hold.ctx.kind === "user" && !hold.charged && cost > 0) {
    await recordDevUsage(hold.ctx.userId, { ref: hold.ref, modelId: detail.modelId, costUsd: cost, note: detail.note });
    return;
  }
  if (!hold.charged || hold.ctx.kind !== "user") return;
  const userId = hold.ctx.userId;
  const chargedMilli = milliForCost(cost);
  await onceMore(
    () =>
      settleCredits(userId, {
        heldMilli: hold.heldMilli,
        chargedMilli,
        ref: hold.ref,
        epoch: hold.epoch,
        modelId: detail.modelId,
        costUsd: cost,
        note: detail.note,
      }),
    hold.ref,
    chargedMilli,
  );
}

/** The call failed or never went out: give the whole hold back. */
export async function releaseHold(hold: Hold): Promise<void> {
  if (!hold.charged || hold.ctx.kind !== "user") return;
  const userId = hold.ctx.userId;
  await onceMore(() => settleCredits(userId, { heldMilli: hold.heldMilli, chargedMilli: 0, ref: hold.ref, epoch: hold.epoch }), hold.ref, 0);
}

/**
 * Settling is safe to repeat (the hold row is claimed once, and put back if
 * the balance update fails), so a database blip gets one retry. If both fail,
 * the charge is parked on the hold row (`pending_settle`) so the sweeper
 * applies it on the next balance check rather than returning the whole hold,
 * and the error goes to the caller to log.
 */
async function onceMore(run: () => Promise<void>, ref: string, chargedMilli: number) {
  try {
    await run();
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 200));
    try {
      await run();
    } catch (error) {
      await parkSettle(ref, chargedMilli).catch(() => false);
      throw error;
    }
  }
}
