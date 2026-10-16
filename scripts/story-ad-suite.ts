/** Offline production test: real editing, isolated state, no GPU / accounts / paid API calls. */
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { defaultSettings } from "../src/lib/settings";
import { blankCampaign, defaultBrand } from "../src/lib/seed";
import { allowedDurations, campaignVideoDurations, getModel, snapCampaignDuration } from "../src/lib/media/catalog";
import { ltxWorkflow } from "../src/lib/media/ltx";
import { applyStudioMedia } from "../src/lib/media/persistence";
import { createRenderJob, listRenderJobs, updateRenderJob } from "../src/lib/media/progress-store";
import { reconcileRenderJob } from "../src/lib/media/progress";
import { ProductionRepository, type ProductionInput } from "../src/lib/media/production-store";
import { workProductionOnce, type ProductionDependencies } from "../src/lib/media/production";
import { endCardSvg, probeVideo, verifyScene } from "../src/lib/media/production-edit";
import { storyAdPlan, storySourceSnapshot, type AuthoredStory } from "../src/lib/media/storyboard";
import type { Creative } from "../src/lib/types";

const dir = await mkdtemp(path.join(os.tmpdir(), "aisle-story-ad-test-"));
process.env.AISLE_MEDIA_PROGRESS_DB = path.join(dir, "progress.db");
process.env.AISLE_MEDIA_PRODUCTION_DB = path.join(dir, "productions.db");
process.env.AISLE_MEDIA_PRODUCTION_DIR = path.join(dir, "outputs");
delete process.env.VERCEL;
const run = promisify(execFile);
const campaign = blankCampaign({ name: "Offline story fixture", product: "Orchy Apple Juice", category: "Beverages", targetAudience: "Adults", objective: "A pause in an ordinary day", budget: 500, channels: ["web"], startDate: "2026-10-05", endDate: "2026-10-18", country: "AU", notes: "No invented bottle or product claims" }, defaultBrand, null, defaultSettings());
const creative: Creative = { id: "source", variant: "A", version: 1, kicker: "A moment", headline: "An apple pause.", subhead: "Draft copy", cta: "Explore Orchy", caption: "Draft", palette: { bg: "#ffffff", fg: "#000000", accent: "#aaa", muted: "#888" }, motif: "editorial", status: "draft", prompt: "Juice and a calm kitchen" };
campaign.creatives = [creative];
campaign.status = "awaiting_approval";
// Test-only authored data, never a production fallback or real-account asset.
const fixtureStory = (count: number): AuthoredStory => ({ title: "Offline authored fixture", scenes: Array.from({ length: count }, (_, i) => ({ label: `Fixture shot ${i + 1}`, prompt: `Explicit offline fixture action ${i + 1}; no live model or account is used.` })), closing: { headline: creative.headline, cta: creative.cta } });
const plan = storyAdPlan(campaign, creative, false, fixtureStory(3));
const ltxPlan = storyAdPlan(campaign, creative, true, fixtureStory(6));
assert.throws(() => storyAdPlan(campaign, creative), /no hardcoded story fallback/);
assert.deepEqual(ltxPlan.scenes.map(s => [s.startSec, s.durationSec, s.renderDurationSec]), [[0, 5, 5], [5, 5, 5], [10, 5, 5], [15, 5, 5], [20, 3, 5], [23, 3, 5]]);
assert.equal(ltxPlan.scenes.reduce((sum, s) => sum + s.durationSec, 0), 26);
assert.match(ltxPlan.scenes[2].prompt, /fixture action 3/);
assert(ltxPlan.scenes.every(s => !s.prompt.includes("supplied campaign poster")));
for (const scene of ltxPlan.scenes) {
  const graph = ltxWorkflow({ kind: "video", modelId: "comfy:ltx-2.5", prompt: scene.prompt, durationSec: scene.renderDurationSec, quality: "high" }, 1);
  assert.equal(graph["16"].inputs.length, 121);
  assert.equal(graph["28"].inputs.width, 1920);
  assert.equal(graph["28"].inputs.height, 1080);
}
assert.equal(defaultSettings().videoDurationSec, 30);
assert.equal(blankCampaign({ ...campaign, name: "New" }, defaultBrand, null).videoDurationSec, 30);
assert.deepEqual(plan.scenes.map(s => [s.startSec, s.durationSec]), [[0, 10], [10, 10], [20, 6]]);
assert.equal(plan.endCard.startSec + plan.endCard.durationSec, 30);
assert.equal(plan.endCard.headline, creative.headline); assert.equal(plan.endCard.cta, creative.cta);
assert.deepEqual(plan.scenes.map(s => s.prompt), fixtureStory(3).scenes.map(s => s.prompt));
for (const modelId of ["comfy:ltx-2.5", "comfy:minimax-h3"]) {
  assert(campaignVideoDurations(getModel(modelId)).includes(30));
  assert(!allowedDurations(getModel(modelId)).includes(30), "30s is an editor feature, not a provider duration");
  assert.equal(snapCampaignDuration(getModel(modelId), 30), 30);
}
assert(!campaignVideoDurations(getModel("google:veo-3.1-fast")).includes(30));
assert.throws(() => ltxWorkflow({ kind: "video", modelId: "comfy:ltx-2.5", prompt: "Invalid long clip", durationSec: 30 }, 1), /edited sequence/);
for (const scene of plan.scenes) assert(Number(ltxWorkflow({ kind: "video", modelId: "comfy:ltx-2.5", prompt: scene.prompt, durationSec: scene.durationSec }, 1)["16"].inputs.length) <= 361);
assert.match(endCardSvg({ ...plan, endCard: { ...plan.endCard, headline: '<script> & "exact"' } }, 1280, 720), /&lt;script&gt; &amp; &quot;exact&quot;/);
assert.throws(() => endCardSvg({ ...plan, endCard: { ...plan.endCard, headline: "unreadable ".repeat(300) } }, 1280, 720), /too long/);
console.log("PASS 30s defaults, chronological story, existing copy, input-free LTX and exact clip limits");

// Deliberately obvious test footage; never inserted into a real user's workspace.
const files: string[] = [];
for (const [index, seconds] of [10, 10, 6].entries()) {
  const file = path.join(dir, `fixture-${index}.mp4`);
  await run("ffmpeg", ["-v", "error", "-nostdin", "-n", "-f", "lavfi", "-i", `testsrc2=size=640x360:rate=24:duration=${seconds}`, "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=48000", "-t", String(seconds), "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-pix_fmt", "yuv420p", file]);
  files.push(file);
}
const black = path.join(dir, "black.mp4");
await run("ffmpeg", ["-v", "error", "-nostdin", "-n", "-f", "lavfi", "-i", "color=black:size=320x180:rate=24:duration=5", "-c:v", "libx264", black]);
await assert.rejects(verifyScene(black, 5), /all black/);
await assert.rejects(verifyScene(files[2], 10), /too short/);
console.log("PASS actual decoder / all-black checks and short-clip rejection (no fake stretching)");

const input: ProductionInput = { ownerId: "alice", role: "beta", campaignId: campaign.id, creativeId: creative.id, expectedUrl: null, sourceSnapshot: storySourceSnapshot(campaign, creative), workflowManaged: false, plan, request: { kind: "video", modelId: "comfy:ltx-2.5", prompt: "server plan", durationSec: 30, aspectRatio: "16:9", quality: "medium", ownerId: "alice" } };
let repo = new ProductionRepository();
const progress = createRenderJob("alice", { campaignId: campaign.id, kind: "video", modelName: "LTX fixture", sourceCreativeId: creative.id, provider: "comfy" });
const queued = repo.enqueue(progress.id, input);
assert.equal(repo.get("bob", queued.id), undefined);
assert.throws(() => repo.enqueue("duplicate", input), /already has/);
repo.workerSeen("worker"); assert(repo.workerOnline());
repo.close(); repo = new ProductionRepository();
assert.equal(repo.get("alice", queued.id)?.status, "queued", "queue survives reopening storage");
updateRenderJob(progress.id, { stage: "queued", sequence: { title: "30s", current: 1, total: 3, label: "waiting", phase: "rendering", heartbeatAt: new Date().toISOString() }, createdAt: new Date(Date.now() - 180_000).toISOString() });
assert.equal((await reconcileRenderJob(listRenderJobs("alice", campaign.id)[0], campaign, async () => { throw new Error("queued production should not query a nonexistent prompt"); })).stage, "queued");
console.log("PASS durable queue, owner isolation, duplicate guard, worker health and long queue wait");

let current = structuredClone(campaign);
let calls = 0;
let storedBytes: Uint8Array | undefined;
const deps: ProductionDependencies = {
  load: async () => structuredClone(current),
  save: async (_input, update) => { current = applyStudioMedia(current, update); return current; },
  render: async (request, onQueued) => {
    const index = calls++;
    assert.equal(request.durationSec, plan.scenes[index].durationSec);
    assert.equal(request.startImageUrl, undefined);
    assert.equal(request.prompt, plan.scenes[index].prompt);
    onQueued(`offline-scene-${index}`);
    assert.equal(repo.claim("another-worker"), undefined);
    return { kind: "video", modelId: "comfy:ltx-2.5", modelName: "LTX fixture", provider: "ComfyUI", status: "ok", promptId: `offline-scene-${index}`, videoMode: "text-to-video", url: `fixture:${index}`, note: "Offline test", at: new Date().toISOString(), usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, units: request.durationSec!, unitLabel: "sec", costUsd: 0, billedAs: "fixture", latencyMs: 1000, estimate: false } };
  },
  read: async url => ({ bytes: await readFile(files[Number(url.split(":")[1])]), mime: "video/mp4", sha256: "a".repeat(64) }),
  store: async value => { storedBytes = value.bytes; return { url: "aisle-media:" + "b".repeat(64), sha256: "b".repeat(64) }; },
  monitor: () => undefined,
};
const original = structuredClone(current);
await workProductionOnce(repo, "worker", deps);
const finished = repo.get("alice", queued.id)!;
assert.equal(finished.status, "complete", finished.error);
assert.equal(calls, 3); assert(storedBytes?.length);
assert.equal(finished.generation?.durationSec, 30);
assert.equal(finished.generation?.composition?.shots.length, 4);
assert.equal(finished.generation?.composition?.reusedClips, 0);
assert.equal(finished.generation?.sourceImageUrl, undefined);
assert.equal(finished.generation?.composition?.shots.at(-1)?.kind, "end-card");
const metadata = await probeVideo(path.join(dir, "outputs", queued.id, "campaign-30s-ad.mp4"));
assert.equal(Number(metadata.format.duration), 30);
assert.equal(Number(metadata.streams.find(s => s.codec_type === "video")?.nb_frames), 720);
assert.equal(listRenderJobs("alice", campaign.id)[0].stage, "complete");
assert.equal(current.videos[0].durationSec, 30);
assert.equal(current.status, original.status); assert.deepEqual(current.creatives, original.creatives);
assert.deepEqual(current.schedule, original.schedule); assert.deepEqual(current.founderDecision, original.founderDecision);
assert.equal(await workProductionOnce(repo, "worker", deps), false, "a finished production is never resubmitted");
console.log("PASS real 30s / 720-frame edited output, three renders plus end card, persistence/reopen and no approval/publication");

const hdProgress = createRenderJob("alice", { campaignId: campaign.id, kind: "video", modelName: "LTX Full HD fixture", sourceCreativeId: creative.id });
const hdJob = repo.enqueue(hdProgress.id, { ...input, plan: ltxPlan, request: { ...input.request, quality: "high" }, sourceSnapshot: storySourceSnapshot(current, current.creatives[0]) });
let hdCalls = 0;
await workProductionOnce(repo, "worker", { ...deps,
  render: async (request, onQueued) => {
    const index = hdCalls++;
    assert.equal(request.durationSec, 5, "Native LTX takes stay 5s, even for a 3s edit");
    assert.equal(request.quality, "high");
    assert.equal(request.prompt, ltxPlan.scenes[index].prompt);
    onQueued(`hd-fixture-${index}`);
    return { ...finished.shots[0].generation!, promptId: `hd-fixture-${index}`, url: `fixture:${index % files.length}`, durationSec: 5 };
  },
});
const hdFinished = repo.get("alice", hdJob.id)!;
assert.equal(hdFinished.status, "complete", hdFinished.error);
assert.equal(hdCalls, 6);
assert.deepEqual(hdFinished.generation?.resolution, { width: 1920, height: 1080 });
assert.equal(hdFinished.generation?.composition?.shots.length, 7);
assert.match(hdFinished.generation!.note, /6 newly generated/);
const hdMetadata = await probeVideo(path.join(dir, "outputs", hdJob.id, "campaign-30s-ad.mp4"));
assert.equal(Number(hdMetadata.format.duration), 30);
assert.equal(Number(hdMetadata.streams.find(s => s.codec_type === "video")?.nb_frames), 720);
assert.equal(hdMetadata.streams.find(s => s.codec_type === "video")?.width, 1920);
assert.equal(hdMetadata.streams.find(s => s.codec_type === "video")?.height, 1080);
console.log("PASS six 5s takes trimmed into 26s story + 4s card: actual 1080p / 30s / 720-frame editor verification");

const secondProgress = createRenderJob("alice", { campaignId: campaign.id, kind: "video", modelName: "Fixture", sourceCreativeId: creative.id });
const failedJob = repo.enqueue(secondProgress.id, { ...input, sourceSnapshot: storySourceSnapshot(current, current.creatives[0]) });
const beforeCalls = calls;
await workProductionOnce(repo, "worker", { ...deps, load: async () => ({ ...current, founderDecision: { ...current.founderDecision, action: "approve" } } as typeof current) });
assert.equal(repo.get("alice", failedJob.id)?.status, "failed");
assert.equal(calls, beforeCalls, "approval during queue wait blocks all further generation");
console.log("PASS approval/source safety stops generation before another scene is submitted");

const partialProgress = createRenderJob("alice", { campaignId: campaign.id, kind: "video", modelName: "Fixture", sourceCreativeId: creative.id });
const partial = repo.enqueue(partialProgress.id, { ...input, sourceSnapshot: storySourceSnapshot(current, current.creatives[0]) });
let partialCalls = 0;
await workProductionOnce(repo, "worker", { ...deps, render: async (request, onQueued) => {
  const index = partialCalls++;
  onQueued(`partial-${index}`);
  if (index === 1) throw new Error("Offline failure on scene two");
  return { ...finished.shots[0].generation!, promptId: "partial-0", url: "fixture:0", durationSec: request.durationSec };
} });
const failedPartial = repo.get("alice", partial.id)!;
assert.equal(failedPartial.status, "failed"); assert.equal(failedPartial.shots.length, 2);
assert(existsSync(failedPartial.shots[0].file!)); assert.equal(failedPartial.shots[1].promptId, "partial-1");
assert.equal(await workProductionOnce(repo, "worker", deps), false);
assert.equal(current.videos.length, 2);
console.log("PASS partial-output retention, recorded submissions and no automatic duplicate generation after failure");
repo.close();
console.log(`All story-ad checks passed. Isolated test artifacts: ${dir}`);
