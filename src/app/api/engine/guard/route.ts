import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current";
import { evaluateGuard } from "@/lib/runtime/guard";
import type { GuardedAction } from "@/lib/runtime/types";
import type { Campaign } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  campaign?: Campaign;
  action?: GuardedAction;
  actor?: "founder" | "trend" | "creative" | "compliance" | "media";
  target?: string;
  amountUsd?: number;
};

/**
 * Boundary check — UC-01 extension 13.a.
 *
 * AHR-01 requires the system to block an agent that attempts to publish, overspend
 * or send a catalogue cover live, and to record the blocked action. Exposing the
 * guard on its own route is what makes that path inspectable: the founder can ask
 * the policy layer what would happen, and the refusal is written to the campaign
 * log rather than staying theoretical.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body?.campaign || !body.action) {
    return NextResponse.json({ error: "campaign and action are required." }, { status: 400 });
  }

  const outcome = evaluateGuard(
    {
      actor: body.actor ?? "media",
      action: body.action,
      campaign: body.campaign,
      target: body.target ?? "a distribution action",
      amountUsd: body.amountUsd,
      kind: body.campaign.channels?.includes("print") ? "catalogue_cover" : "social",
      triggeredBy: "boundary_check",
    },
    new Date().toISOString(),
  );

  return NextResponse.json({
    verdict: outcome.verdict,
    rule: outcome.rule,
    clause: outcome.clause,
    reason: outcome.reason,
    remedy: outcome.remedy,
    decision: outcome.decision,
  });
}
