import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current";
import { demoWorkspace, loadWorkspace } from "@/lib/auth/workspace";
import { billingForSession } from "@/lib/billing/meter";
import {
  normaliseDraft,
  runIntakeTurn,
  type IntakeChatMessage,
  type IntakeDraftState,
} from "@/lib/intake/assistant";
import { attachableRecommendation } from "@/lib/runtime/defaults";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Simple per-user sliding-window rate limit (30 turns / minute, CE-06/CE-08). */
const WINDOW_MS = 60_000;
const MAX_TURNS_PER_MIN = 30;
const buckets = new Map<string, number[]>();

function checkRateLimit(userId: string, now = Date.now()): boolean {
  const recent = (buckets.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_TURNS_PER_MIN) {
    buckets.set(userId, recent);
    return false;
  }
  recent.push(now);
  buckets.set(userId, recent);
  return true;
}

type Body = {
  messages?: unknown;
  draft?: Partial<IntakeDraftState>;
};

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  if (!checkRateLimit(user.id)) {
    return NextResponse.json(
      {
        error:
          "Too many intake messages in a minute (limit 30/min). You can continue editing the brief in the form below.",
      },
      { status: 429 },
    );
  }

  const body = (await request.json().catch(() => null)) as Body | null;
  const rawMessages = Array.isArray(body?.messages) ? body.messages : [];
  const messages: IntakeChatMessage[] = rawMessages
    .filter(
      (m): m is { role: "user" | "assistant"; content: string } =>
        Boolean(m) &&
        typeof m === "object" &&
        ((m as { role?: unknown }).role === "user" ||
          (m as { role?: unknown }).role === "assistant") &&
        typeof (m as { content?: unknown }).content === "string",
    )
    .slice(-24)
    .map((m) => ({
      role: m.role,
      content: m.content.slice(0, 2000),
    }));

  // Brand rules and model settings always come from the server's stored workspace, never the browser body.
  const stored = await loadWorkspace(user.id, user.role).catch(() => demoWorkspace());

  const billing = await billingForSession(user);

  const priorRecommendation = attachableRecommendation(stored.campaigns);
  const draft = normaliseDraft(body?.draft);

  const output = await runIntakeTurn({
    messages,
    draft,
    brand: stored.brand,
    settings: stored.settings,
    priorRecommendation,
    billing,
  });

  return NextResponse.json(output);
}
