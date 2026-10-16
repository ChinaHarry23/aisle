import { renderingModel, runGeneration } from "@/lib/media/generate";
import { campaignVideoDurations, MEDIA_MODELS, resolveModelId, snapCampaignDuration, supportsStoryAd } from "@/lib/media/catalog";
import type { AspectRatio, GenerateRequest } from "@/lib/media/types";
import { getCurrentUser } from "@/lib/auth/current";
import { loadWorkspace, saveWorkspace } from "@/lib/auth/workspace";
import { mergeWorkflowCampaigns, saveWorkflowMedia, workflowEnabled } from "@/lib/workflow/gateway";
import { applyStudioMedia, type StudioMediaUpdate } from "@/lib/media/persistence";
import { directMedia } from "@/lib/media/art-direction";
import { readMedia } from "@/lib/media/store";
import { WorkflowError } from "@/lib/workflow/commands";
import { quoteModel } from "@/lib/media/estimate";
import type { Campaign } from "@/lib/types";
import { createRenderJob, updateRenderJob } from "@/lib/media/progress-store";
import { ensureProgressMonitor } from "@/lib/media/progress";
import { billingForSession, InsufficientCreditsError } from "@/lib/billing/meter";
import { MILLI } from "@/lib/billing/plan";
import { keptTake } from "@/lib/media/kept-take";
import { LTX_SAMPLERS } from "@/lib/media/ltx";
import { storySourceSnapshot } from "@/lib/media/storyboard";
import { ProductionRepository } from "@/lib/media/production-store";
import { requireStoryEditor } from "@/lib/media/production-edit";
import { requireServer } from "@/lib/media/comfy";

export const runtime = "nodejs";
// Cloud video polls the provider inside this request; Vercel Pro allows up to 800 s.
export const maxDuration = 800;
/** Stop waiting on the provider this long before the platform kills the function, so the hold is always settled. */
const SETTLE_MARGIN_S = 60;

export async function POST(req: Request) {
  const started = Date.now();
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  let renderId: string | undefined;
  try {
    const body = await req.json().catch(() => null) as GenerateRequest | null;
    if (!body?.campaignId || !body.creativeId || !["image", "video"].includes(body.kind)) throw new WorkflowError("Campaign, source creative and media kind are required.");
    const workspace = await loadWorkspace(user.id, user.role);
    const merged = workflowEnabled() ? await mergeWorkflowCampaigns(user.id, workspace.campaigns) : { campaigns: workspace.campaigns, workflowCampaignIds: [] };
    const campaign = merged.campaigns.find(c => c.id === body.campaignId);
    if (!campaign) throw new WorkflowError("Campaign not found.", 404);
    if (!["draft", "paused", "awaiting_approval"].includes(campaign.status) || campaign.founderDecision?.action === "approve") throw new WorkflowError("Only unapproved drafts can generate new media.", 409);
    const creative = campaign.creatives.find(c => c.id === body.creativeId);
    if (!creative) throw new WorkflowError("Launch agents to create campaign copy first.", 409);
    const configured = body.kind === "image" ? workspace.settings.imageModelId : workspace.settings.videoModelId;
    const modelId = configured ? resolveModelId(configured) : configured;
    if (!MEDIA_MODELS.some(m => m.id === modelId && m.kind === body.kind)) throw new WorkflowError("Unknown configured media model.");
    const runs = renderingModel({ kind: body.kind, modelId });
    const textVideo = body.kind === "video" && runs.videoInput === "text";
    let durationSec = body.durationSec ?? workspace.settings.videoDurationSec ?? campaign.videoDurationSec;
    if (body.kind === "video") {
      if (!textVideo && (creative.generation?.status !== "ok" || !creative.generation.url)) throw new WorkflowError("Choose a generated image first.");
      if (body.durationSec !== undefined && !campaignVideoDurations(runs).includes(body.durationSec)) {
        throw new WorkflowError(`${runs.name} renders ${runs.durations ? `${runs.durations.join(", ")} second` : "5 to 15 second"} clips${supportsStoryAd(runs) ? " or a 30-second edited story ad" : ""}.`);
      }
      // A saved default from another model snaps to the nearest length this one renders.
      durationSec = snapCampaignDuration(runs, durationSec);
    }
    const quote = quoteModel(runs.id, { durationSec });
    if (campaign.spend.inferenceUsd + campaign.spend.mediaUsd + quote.costUsd > (campaign.spendCapUsd ?? campaign.spend.capUsd)) throw new WorkflowError("Generation would exceed the campaign's automation budget.", 409);
    const local = runs.providerId === "comfy";
    // Google renders portrait video as 9:16; the 4:5 poster is reframed by the model.
    const aspectRatio: AspectRatio = textVideo ? "16:9" : body.kind === "video" && !local ? "9:16" : "4:5";
    if (textVideo && body.quality && !["low", "medium", "high"].includes(body.quality)) throw new WorkflowError("Choose HD preview or Full HD quality.");
    if (body.styleReference !== undefined && (typeof body.styleReference !== "string" || body.styleReference.length > 4000)) throw new WorkflowError("A style reference must be text of at most 4,000 characters.");
    const edited = body.kind === "video" && durationSec === 30 && supportsStoryAd(runs);
    // Do not pay an art director for a render the server cannot start.
    if (local) {
      try { await requireServer(); }
      catch { throw new WorkflowError("The local renderer is offline. Start ComfyUI before generating an ad; no art-direction call or render has started.", 503); }
    }
    if (edited) {
      await requireStoryEditor();
      const check = new ProductionRepository();
      try {
        if (check.hasActive(user.id, campaign.id)) throw new WorkflowError("This campaign already has an active story production; no new art-direction call started.", 409);
        if (!check.workerOnline()) throw new WorkflowError("The local story-ad worker is offline. Start the full local services before generating a 30-second ad.", 503);
      }
      finally { check.close(); }
    }
    const billing = await billingForSession(user);
    if (!billing && !local) throw new WorkflowError("Your account could not be found. Sign in again.", 401);
    const sourceSnapshot = storySourceSnapshot(campaign, creative);
    renderId = createRenderJob(user.id, { campaignId: campaign.id, kind: body.kind, modelName: runs.name, sourceCreativeId: creative.id, provider: runs.providerId }).id;
    const { direction, plan } = await directMedia({ campaign, creative, brand: workspace.brand, settings: workspace.settings, model: runs, aspect: edited ? "16:9" : aspectRatio, durationSec, edited, styleReference: body.styleReference, renderBudgetUsd: quote.costUsd }, billing);
    const prompt = direction.prompt;
    const refreshed = await loadWorkspace(user.id, user.role);
    const currentCampaigns = workflowEnabled() ? (await mergeWorkflowCampaigns(user.id, refreshed.campaigns)).campaigns : refreshed.campaigns;
    const current = currentCampaigns.find(c => c.id === campaign.id);
    const currentSource = current?.creatives.find(c => c.id === creative.id);
    if (!current || !currentSource || storySourceSnapshot(current, currentSource) !== sourceSnapshot || !["draft", "paused", "awaiting_approval"].includes(current.status) || current.founderDecision?.action === "approve") throw new WorkflowError("The brief, source or approval changed while the art director was planning. Review before rendering.", 409);
    if (edited) {
      const repo = new ProductionRepository();
      try {
        if (!repo.workerOnline()) throw new WorkflowError("The local story-ad worker is offline. Start the full local services before generating a 30-second ad.", 503);
        if (!plan) throw new WorkflowError("The art director did not provide an edited plan.", 422);
        updateRenderJob(renderId, { stage: "queued", sequence: { title: "30s story ad", current: 1, total: plan.scenes.length, label: "Waiting for the story worker", phase: "rendering", heartbeatAt: new Date().toISOString() } });
        const job = repo.enqueue(renderId, {
          ownerId: user.id, role: user.role, campaignId: campaign.id, creativeId: creative.id,
          expectedUrl: creative.generation?.url ?? null, sourceSnapshot, workflowManaged: merged.workflowCampaignIds.includes(campaign.id), plan, artDirection: direction,
          request: { kind: "video", modelId: runs.id, prompt: "Story scenes are generated from the server-authored campaign plan.", aspectRatio: "16:9", quality: body.quality ?? "high", durationSec: 30, startImageUrl: textVideo ? undefined : creative.generation!.url!, ownerId: user.id, campaignId: campaign.id, creativeId: creative.id },
        });
        // A durable worker owns the hours-long render; the HTTP response is only an acknowledgement.
        return Response.json({ queued: true, productionId: job.id, renderId, campaign, plan, direction }, { status: 202 });
      } finally { repo.close(); }
    }
    if (runs.id === "comfy:ltx-2.5") updateRenderJob(renderId, { samplers: LTX_SAMPLERS, totalSteps: 11 });
    if (local) ensureProgressMonitor();
    // Role from the database, not the 30-day cookie: a demoted desk pays at once.
    // Stop waiting on the provider before Vercel kills the function, so the hold is settled or
    // released rather than stranded. A client disconnect deliberately does not cancel a paid render.
    const budgetMs = Math.max(1_000, (maxDuration - SETTLE_MARGIN_S) * 1000 - (Date.now() - started));
    const rendered = await runGeneration(
      { kind: body.kind, modelId, prompt, durationSec, aspectRatio, quality: textVideo ? body.quality ?? "high" : undefined, startImageUrl: body.kind === "video" && !textVideo ? creative.generation!.url! : undefined, campaignId: campaign.id, creativeId: creative.id, ownerId: user.id },
      promptId => updateRenderJob(renderId!, { promptId, stage: "queued", modelName: runs.name }),
      billing,
      { strict: true, signal: AbortSignal.timeout(budgetMs) },
    );
    const generation = { ...rendered, artDirection: direction };
    if (generation.status !== "ok" || !generation.url) throw new WorkflowError(generation.note || "Generation failed; no placeholder was saved.", 502);
    updateRenderJob(renderId, { stage: "saving" });
    let saved: Campaign;
    try {
      // Pull a ComfyUI output into the local cache now, while ComfyUI still has it.
      if (generation.provider === "ComfyUI") await readMedia(generation.url, body.kind, user.id);
      const update: StudioMediaUpdate = body.kind === "image"
        ? { kind: "image", creativeId: creative.id, expectedUrl: creative.generation?.url, generation }
        : { kind: "video", sourceCreativeId: creative.id, expectedUrl: creative.generation?.url ?? null, video: { id: `vid_${crypto.randomUUID()}`, version: campaign.videos.length + 1, title: `${campaign.product} — ${textVideo ? "cinematic text-to-video" : "image-to-video"}`, prompt, durationSec: generation.durationSec ?? (generation.usage.units > 0 && !local ? generation.usage.units : durationSec), aspect: generation.aspect ?? aspectRatio, status: "ready", generation } };
      if (merged.workflowCampaignIds.includes(campaign.id)) {
        saved = await saveWorkflowMedia(user.id, campaign.id, update);
      } else {
        const latest = await loadWorkspace(user.id, user.role);
        const current = latest.campaigns.find(c => c.id === campaign.id);
        if (!current) throw new WorkflowError("Campaign no longer exists.", 409);
        saved = applyStudioMedia(current, update);
        await saveWorkspace(user.id, { ...latest, campaigns: latest.campaigns.map(c => c.id === saved.id ? saved : c) });
      }
    } catch (saveError) {
      // The render was paid for but cannot be attached (approved meanwhile, source changed, …).
      // The charge stands and the stored take stays downloadable (owner-checked): no refund,
      // or a render could be had for free by changing the poster mid-render.
      const reason = saveError instanceof Error ? saveError.message : "Saving failed.";
      const kept = keptTake(billing, generation, body.kind, reason);
      updateRenderJob(renderId, { stage: "failed", error: kept.message.slice(0, 500) });
      return Response.json(
        { error: kept.message, generation, chargedCredits: kept.chargedCredits, ...(kept.downloadUrl ? { downloadUrl: kept.downloadUrl } : {}) },
        { status: saveError instanceof WorkflowError ? saveError.status : 500 },
      );
    }
    updateRenderJob(renderId, { stage: "complete" });
    return Response.json({ generation, campaign: saved });
  } catch (error) {
    if (error instanceof InsufficientCreditsError) {
      if (renderId) updateRenderJob(renderId, { stage: "failed", error: "Not enough credits for this cloud render. Nothing was sent to the provider." });
      return Response.json({
        error: error.message,
        neededCredits: error.neededMilli / MILLI,
        balanceCredits: error.balanceMilli / MILLI,
        billingUrl: "/billing",
      }, { status: 402 });
    }
    if (renderId) updateRenderJob(renderId, { stage: "failed", error: error instanceof Error ? error.message.slice(0, 500) : "Media generation failed." });
    return Response.json({ error: error instanceof Error ? error.message : "Media generation failed." }, { status: error instanceof WorkflowError ? error.status : 500 });
  }
}
