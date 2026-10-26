import type { Campaign, Creative } from "../types";
import type { AdVideo, MediaGeneration } from "./pr2-types";
import { WorkflowError } from "../workflow/commands";
import { makeLog } from "../seed";
import { getModel } from "../pr2-shims";

export type StudioMediaUpdate =
  | { kind: "image"; creativeId: string; expectedUrl?: string | null; generation: MediaGeneration }
  | { kind: "video"; sourceCreativeId: string; expectedUrl: string | null; video: AdVideo };

/** Image edits preserve copy, but the previous scene's attribution no longer describes the new image. */
export function withoutVisualInsightUses(creative: Creative): Creative {
  if (!creative.insightUses?.some((use) => use.application === "visual")) return creative;
  const ids = new Set([...(creative.unusedInsightIds ?? []), ...creative.insightUses.map((use) => use.insightId)]);
  const insightUses = creative.insightUses.filter((use) => use.application !== "visual");
  return { ...creative, insightUses, unusedInsightIds: [...ids].filter((id) => !insightUses.some((use) => use.insightId === id)) };
}

/** Only server-generated results enter here. Browser workspace PUT cannot call this. */
export function applyStudioMedia(campaign: Campaign, update: StudioMediaUpdate): Campaign {
  if (!update || !["image", "video"].includes(update.kind)) throw new WorkflowError("Unknown media update.");
  if (!["draft", "paused", "awaiting_approval"].includes(campaign.status) || campaign.founderDecision?.action === "approve") {
    throw new WorkflowError("Media can only change on an unapproved draft.", 409);
  }
  const generation = update.kind === "image" ? update.generation : update.video?.generation;
  if (!generation || generation.status !== "ok" || !generation.url || generation.kind !== update.kind || !Number.isFinite(generation.usage?.costUsd) || generation.usage.costUsd < 0) {
    throw new WorkflowError("Only a successful, metered generation can be attached.");
  }
  const source = campaign.creatives.find(c => c.id === (update.kind === "image" ? update.creativeId : update.sourceCreativeId));
  if (!source) throw new WorkflowError("Campaign source image not found.", 404);
  if ((source.generation?.url ?? null) !== (update.expectedUrl ?? null)) throw new WorkflowError("Source image changed during generation; review this result before attaching it.", 409);
  const textVideo = update.kind === "video" && generation.videoMode === "text-to-video";
  if (textVideo && (getModel(generation.modelId).videoInput !== "text" || !generation.promptId || generation.sourceImageUrl || generation.inputImageSha256)) {
    throw new WorkflowError("Text-to-video must use an explicitly supported model and retain its render ID without invented image provenance.");
  }
  if (update.kind === "video" && !textVideo && (!generation.sourceImageUrl || generation.sourceImageUrl !== source.generation?.url || !/^[a-f0-9]{64}$/.test(generation.inputImageSha256 ?? ""))) {
    throw new WorkflowError("Video has no verified link to the campaign's input image.");
  }
  const at = new Date().toISOString();
  const planningCost = generation.artDirection?.author.usage.costUsd ?? 0;
  if (!Number.isFinite(planningCost) || planningCost < 0) throw new WorkflowError("Invalid art-direction usage.");
  const next: Campaign = { ...campaign, updatedAt: at, studioBusy: null, spend: { ...campaign.spend, inferenceUsd: campaign.spend.inferenceUsd + planningCost, mediaUsd: campaign.spend.mediaUsd + generation.usage.costUsd } };
  if (update.kind === "image") {
    next.creatives = campaign.creatives.map(c => {
      if (c.id !== source.id) return c;
      const prompt = generation.artDirection?.prompt ?? c.prompt;
      return { ...(prompt === c.prompt ? c : withoutVisualInsightUses(c)), generation, prompt, status: "flagged" };
    });
  } else {
    if (campaign.videos.some(v => v.id === update.video.id)) throw new WorkflowError("Video already attached.", 409);
    next.videos = [{ ...update.video, status: "ready" }, ...campaign.videos];
  }
  next.studioHistory = [...(campaign.studioHistory || []), { id: `studio_${crypto.randomUUID()}`, at, kind: update.kind, modelId: generation.modelId, label: update.kind === "image" ? "Saved campaign image — review required" : textVideo ? "Text-to-video — review required" : "Image-to-video — review required", costUsd: generation.usage.costUsd, totalTokens: generation.usage.totalTokens }];
  next.log = [...campaign.log, makeLog("creative", "output", `Studio ${update.kind} saved`, `${generation.modelName}; persisted to campaign. ${textVideo ? `Text-to-video render: ${generation.promptId}. ` : update.kind === "video" ? `Input SHA-256: ${generation.inputImageSha256}. ` : ""}Not approved or published.`)];
  // Keep existing flags and decisions; attaching media never constitutes approval.
  return next;
}
