import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current";
import { loadWorkspace, updateWorkspace } from "@/lib/auth/workspace";
import { billingForSession } from "@/lib/billing/meter";
import { renderCampaignPoster } from "@/lib/media/campaign-poster";
import { readMedia } from "@/lib/media/store";
import { makeLlmRuntime, rewriteImagePrompts, takeUnbookedSeatCost } from "@/lib/runtime/decide";
import { makeLog } from "@/lib/seed";
import type { Campaign, Creative } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 800;

const MIN_NOTE = 8;
const MAX_NOTE = 500;

/**
 * Edit the posters already on a campaign.
 *
 * The founder's sentence goes to the Image Generation agent, which wrote the
 * original image prompt. That agent returns the prompt used to edit each poster.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { campaignId?: string; note?: string } | null;
  const note = body?.note?.replace(/\s+/g, " ").trim() ?? "";
  if (!body?.campaignId || note.length < MIN_NOTE || note.length > MAX_NOTE) {
    return NextResponse.json(
      { error: `Describe the mistake in ${MIN_NOTE}–${MAX_NOTE} characters.` },
      { status: 400 },
    );
  }

  const stored = await loadWorkspace(user.id, user.role);
  const campaign = stored.campaigns.find((item) => item.id === body.campaignId);
  if (!campaign) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  if (campaign.creatives.length === 0) {
    return NextResponse.json({ error: "There is no poster to revise yet." }, { status: 400 });
  }

  const userKey = request.headers.get("x-provider-key")?.trim() || undefined;
  const billing = await billingForSession(user);
  const llm = makeLlmRuntime(billing);
  const rewritten = await rewriteImagePrompts({
    campaign,
    brand: stored.brand,
    settings: stored.settings,
    llm,
    note,
    creatives: campaign.creatives,
  }).catch(() => ({ prompts: new Map<string, string>(), trace: null }));
  const revised = new Map<string, Creative>();
  const failures: string[] = [];
  let cost = 0;

  for (const creative of campaign.creatives) {
    let editFrom: { bytes: Buffer; mime: string; sha256: string } | undefined;
    const url = creative.generation?.status === "ok" ? creative.generation.url : undefined;
    if (url) {
      try {
        editFrom = await readMedia(url, "image", user.id);
      } catch {
        /* No readable poster: render from the product photo instead. */
      }
    }
    const agentPrompt = rewritten.prompts.get(creative.id);
    const generation = await renderCampaignPoster({
      campaign,
      creative,
      modelId: campaign.imageModelId,
      ownerId: user.id,
      userKey,
      correction: agentPrompt ? undefined : note,
      promptOverride: agentPrompt,
      editFrom,
    });
    if (generation.status !== "ok" || !generation.url) {
      failures.push(generation.note || `Variant ${creative.variant} was not revised.`);
      continue;
    }
    cost += generation.usage.costUsd ?? 0;
    revised.set(creative.id, {
      ...creative,
      version: creative.version + 1,
      status: "revised",
      prompt: agentPrompt ?? creative.prompt,
      generation,
    });
  }

  // The prompt rewrite was paid for whether or not a poster came back, and so
  // was a seat run that failed before falling back.
  const inferenceUsd = (rewritten.trace?.usage.costUsd ?? 0) + takeUnbookedSeatCost(llm);

  if (revised.size === 0) {
    if (inferenceUsd > 0) {
      await updateWorkspace(user.id, user.role, (latest) => ({
        ...latest,
        campaigns: latest.campaigns.map((item) =>
          item.id === campaign.id ? { ...item, spend: { ...item.spend, inferenceUsd: item.spend.inferenceUsd + inferenceUsd } } : item,
        ),
      })).catch(() => false);
    }
    return NextResponse.json(
      { error: failures[0] ?? "The pictures could not be revised." },
      { status: 502 },
    );
  }

  let updated: Campaign = campaign;
  const saved = await updateWorkspace(user.id, user.role, (latest) => {
    const current = latest.campaigns.find((item) => item.id === campaign.id) ?? campaign;
    updated = {
      ...current,
      imageRevisionNote: note,
      creatives: current.creatives.map((creative) => revised.get(creative.id) ?? creative),
      spend: {
        ...current.spend,
        inferenceUsd: current.spend.inferenceUsd + inferenceUsd,
        mediaUsd: current.spend.mediaUsd + cost,
      },
      log: [
        ...current.log,
        makeLog(
          "creative",
          "revision",
          rewritten.trace ? "Image Generation rewrote the revision prompt" : "Posters revised from the founder's note",
          [
            note,
            rewritten.trace
              ? `${rewritten.prompts.size} prompt(s) from ${rewritten.trace.modelName}.`
              : "The Image Generation agent did not return a prompt, so the note was sent to the image model.",
            failures.length ? failures.join(" ") : "",
          ]
            .filter(Boolean)
            .join(" "),
        ),
      ],
      updatedAt: new Date().toISOString(),
      studioBusy: null,
    };
    return { ...latest, campaigns: latest.campaigns.map((item) => (item.id === updated.id ? updated : item)) };
  }).catch(() => false);
  if (!saved) {
    return NextResponse.json({ error: "The revised pictures could not be saved. Try again." }, { status: 503 });
  }

  return NextResponse.json({
    campaign: updated,
    message: failures.length ? `Revised ${revised.size} picture(s). ${failures[0]}` : "Pictures revised.",
  });
}
