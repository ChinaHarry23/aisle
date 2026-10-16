/** Background production survives browser navigation and checkpoints every submitted scene. */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { findUserById } from "../auth/users";
import { loadWorkspace, saveWorkspace } from "../auth/workspace";
import { mergeWorkflowCampaigns, saveWorkflowMedia, workflowEnabled } from "../workflow/gateway";
import type { Campaign } from "../types";
import { getModel } from "./catalog";
import { runGeneration } from "./generate";
import { LTX_SAMPLERS } from "./ltx";
import { applyStudioMedia, type StudioMediaUpdate } from "./persistence";
import { ensureProgressMonitor } from "./progress";
import { renderActive } from "./progress-types";
import { listRenderJobs, updateRenderJob } from "./progress-store";
import { editStoryAd, prepareEndCard, requireStoryEditor, verifyScene } from "./production-edit";
import { ProductionRepository, type ProductionInput } from "./production-store";
import { storySourceSnapshot } from "./storyboard";
import { putMedia, readMedia } from "./store";
import type { GenerateRequest, MediaGeneration } from "./types";

async function loadLatest(input: ProductionInput) {
  const user = await findUserById(input.ownerId);
  if (!user) throw new Error("The campaign owner no longer exists.");
  const workspace = await loadWorkspace(user.id, user.role);
  if (input.workflowManaged && !workflowEnabled()) throw new Error("The authoritative campaign service is unavailable; production stopped safely.");
  const campaigns = workflowEnabled() ? (await mergeWorkflowCampaigns(user.id, workspace.campaigns)).campaigns : workspace.campaigns;
  const campaign = campaigns.find(c => c.id === input.campaignId);
  if (!campaign) throw new Error("Campaign no longer exists.");
  return campaign;
}

async function saveLatest(input: ProductionInput, update: StudioMediaUpdate) {
  if (input.workflowManaged) return saveWorkflowMedia(input.ownerId, input.campaignId, update);
  const user = await findUserById(input.ownerId);
  if (!user) throw new Error("Campaign owner no longer exists.");
  const latest = await loadWorkspace(input.ownerId, user.role);
  const campaign = latest.campaigns.find(c => c.id === input.campaignId);
  if (!campaign) throw new Error("Campaign no longer exists.");
  const saved = applyStudioMedia(campaign, update);
  await saveWorkspace(input.ownerId, { ...latest, campaigns: latest.campaigns.map(c => c.id === saved.id ? saved : c) });
  return saved;
}

export type ProductionDependencies = {
  load: (input: ProductionInput) => Promise<Campaign>;
  save: (input: ProductionInput, update: StudioMediaUpdate) => Promise<Campaign>;
  render: (request: GenerateRequest, onQueued: (id: string) => void) => Promise<MediaGeneration>;
  read: typeof readMedia;
  store: typeof putMedia;
  monitor: () => unknown;
};
const defaults: ProductionDependencies = { load: loadLatest, save: saveLatest, render: runGeneration, read: readMedia, store: putMedia, monitor: ensureProgressMonitor };

export async function workProductionOnce(repo: ProductionRepository, workerId: string, overrides: Partial<ProductionDependencies> = {}) {
  repo.workerSeen(workerId);
  const job = repo.claim(workerId);
  if (!job) return false;
  const deps = { ...defaults, ...overrides };
  const { input } = job;
  const model = getModel(input.request.modelId);
  const textVideo = model.videoInput === "text";
  const folder = path.join(/*turbopackIgnore: true*/ process.env.AISLE_MEDIA_PRODUCTION_DIR || path.resolve("data/media-productions"), job.id);
  let current = 1;
  let phase: "rendering" | "editing" = "rendering";
  let leaseValid = true;
  const sequence = () => ({ title: "30s story ad", current, total: input.plan.scenes.length, label: input.plan.scenes[current - 1].label, phase, heartbeatAt: new Date().toISOString() });
  const assertSource = async () => {
    if (!leaseValid) throw new Error("Story worker lost its lease. No more scenes were started.");
    const progress = listRenderJobs(input.ownerId, input.campaignId).find(p => p.id === job.renderId);
    if (!progress || !renderActive(progress)) throw new Error("The production stopped reporting a valid active render. Outputs are retained for recovery.");
    const campaign = await deps.load(input);
    const creative = campaign.creatives.find(c => c.id === input.creativeId);
    if (!["draft", "paused", "awaiting_approval"].includes(campaign.status) || campaign.founderDecision?.action === "approve") throw new Error("Campaign was approved or changed state. No new scenes may be generated or attached.");
    if (!creative || (creative.generation?.url ?? null) !== input.expectedUrl || storySourceSnapshot(campaign, creative) !== input.sourceSnapshot) throw new Error("The campaign brief or source creative changed during production. Review the retained scenes before attaching them.");
    return campaign;
  };
  const heartbeat = setInterval(() => {
    try { repo.workerSeen(workerId); repo.checkpoint(job); updateRenderJob(job.renderId, { sequence: sequence() }); deps.monitor(); }
    catch { leaseValid = false; }
  }, 10_000);
  try {
    await requireStoryEditor();
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, "storyboard.json"), JSON.stringify(input.plan, null, 2));
    const width = input.request.quality === "high" ? 1920 : 1280;
    const height = input.request.quality === "high" ? 1080 : 720;
    // Validate and render the full closing copy before spending time on diffusion.
    await prepareEndCard(folder, input.plan, width, height);
    await assertSource();
    deps.monitor();
    for (const [index, scene] of input.plan.scenes.entries()) {
      current = index + 1;
      await assertSource();
      updateRenderJob(job.renderId, { promptId: undefined, stage: "preparing", step: 0, totalSteps: model.id === "comfy:ltx-2.5" ? 11 : 0, samplers: model.id === "comfy:ltx-2.5" ? LTX_SAMPLERS : undefined, sequence: sequence() });
      const request: GenerateRequest = { ...input.request, prompt: scene.prompt, durationSec: scene.renderDurationSec ?? scene.durationSec };
      await writeFile(path.join(folder, `scene-${current}-request.json`), JSON.stringify(request, null, 2));
      const generation = await deps.render(request, promptId => {
        // Persist the accepted job ID before any other action; never auto-resubmit after a crash.
        repo.checkpoint(job, { shots: [...job.shots, { index, promptId }] });
        updateRenderJob(job.renderId, { promptId, stage: "queued", sequence: sequence() });
        console.log(`[story ad ${job.id}] Scene ${current}/${input.plan.scenes.length} queued: ${scene.label} (${promptId})`);
      });
      if (generation.status !== "ok" || !generation.url || !generation.promptId || generation.modelId !== model.id) throw new Error(generation.note || "Scene rendering failed. No placeholder was saved.");
      const file = path.join(folder, `scene-${current}.mp4`);
      const bytes = await deps.read(generation.url, "video", input.ownerId);
      await writeFile(file, bytes.bytes);
      repo.checkpoint(job, { shots: job.shots.map(shot => shot.index === index ? { ...shot, generation, file } : shot) });
      await writeFile(path.join(folder, `scene-${current}-result.json`), JSON.stringify(generation, null, 2));
      // Reject a broken take now, not after rendering every remaining scene.
      await verifyScene(file, scene.renderDurationSec ?? scene.durationSec);
      console.log(`[story ad ${job.id}] Scene ${current}/${input.plan.scenes.length} complete. Visual review required.`);
    }
    await assertSource();
    phase = "editing";
    updateRenderJob(job.renderId, { promptId: `production:${job.id}`, stage: "encoding", sequence: sequence() });
    const editingStarted = Date.now();
    const cut = await editStoryAd(folder, input.plan, job.shots.map(shot => shot.file!), width, height);
    const editingMs = Date.now() - editingStarted;
    const renders = job.shots.map(shot => shot.generation!);
    const renderMs = renders.reduce((sum, g) => sum + g.usage.latencyMs, 0);
    const stored = await deps.store({ ownerId: input.ownerId, kind: "video", bytes: cut.bytes, mime: "video/mp4" });
    const generation: MediaGeneration = {
      ...renders[0], url: stored.url, at: new Date().toISOString(), promptId: `production:${job.id}`,
      artDirection: input.artDirection,
      aspect: "16:9", videoMode: textVideo ? "text-to-video" : "image-to-video", durationSec: 30, resolution: { width, height }, frameRate: 24,
      note: `${input.plan.scenes.length} newly generated narrative shots (${input.plan.scenes.map(s => `${s.durationSec}s`).join(" + ")}), edited with a 4s authored brand/CTA card. Technical decode verified. Character, product, audio and brand review required; not approved or published.`,
      usage: { ...renders[0].usage, costUsd: renders.reduce((sum, g) => sum + g.usage.costUsd, 0), latencyMs: renderMs + editingMs, units: 30, unitLabel: "sec", billedAs: "Local 30s story ad", estimate: false },
      composition: { renderMs, editingMs, reusedClips: 0, shots: [...job.shots.map((shot, i) => ({ label: input.plan.scenes[i].label, startSec: input.plan.scenes[i].startSec, durationSec: input.plan.scenes[i].durationSec, promptId: shot.promptId, sourceImageUrl: shot.generation?.sourceImageUrl, inputImageSha256: shot.generation?.inputImageSha256, generationMs: shot.generation!.usage.latencyMs, reused: false, kind: "scene" as const })), { label: input.plan.endCard.label, startSec: 26, durationSec: 4, generationMs: 0, reused: false, kind: "end-card" }] },
    };
    repo.checkpoint(job, { generation });
    await writeFile(path.join(folder, "generation.json"), JSON.stringify(generation, null, 2));
    const latest = await assertSource();
    updateRenderJob(job.renderId, { stage: "saving", sequence: sequence() });
    const videoId = `vid_story_${job.id}`;
    await deps.save(input, { kind: "video", sourceCreativeId: input.creativeId, expectedUrl: input.expectedUrl, video: { id: videoId, version: latest.videos.length + 1, title: `${input.plan.title} — 30s story ad (review required)`, prompt: input.plan.scenes.map(s => `${s.startSec}–${s.startSec + s.durationSec}s: ${s.prompt}`).join("\n\n"), durationSec: 30, aspect: "16:9", status: "ready", generation } });
    const reopened = await deps.load(input);
    if (!reopened.videos.some(v => v.id === videoId && v.generation.url === stored.url)) throw new Error("Finished video was stored, but campaign attachment could not be confirmed. Recover the retained output instead of regenerating.");
    repo.checkpoint(job, { status: "complete" });
    updateRenderJob(job.renderId, { stage: "complete", sequence: sequence() });
    console.log(`[story ad ${job.id}] Verified 30s cut saved to campaign; awaiting human review.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Story production failed.";
    try { repo.checkpoint(job, { status: "failed", error: message }); } catch { /* The expired lease is recovered by the next worker. */ }
    updateRenderJob(job.renderId, { stage: "failed", error: `${message} Completed scenes are retained; do not blindly regenerate.`.slice(0, 500) });
    console.error(`[story ad ${job.id}] ${message}`);
  } finally { clearInterval(heartbeat); }
  return true;
}
