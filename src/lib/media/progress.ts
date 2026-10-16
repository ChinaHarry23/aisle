import type { Campaign } from "../types";
import { listRenderJobs, renderJobForPrompt, updateRenderJob } from "./progress-store";
import { cloudRender, renderActive, type RenderProgress, type RenderStage } from "./progress-types";

type ComfyEvent = { type: string; data: { prompt_id?: string; node?: string | null; value?: number; max?: number; exception_message?: string; nodes?: Record<string, { state: string; value: number; max: number }> } };
const order: RenderStage[] = ["preparing", "queued", "loading", "sampling", "encoding", "saving", "complete"];

/** Events are associated with an already registered prompt, never a browser-supplied ID. */
export function acceptComfyProgress(event: ComfyEvent) {
  const data = event.data;
  if (!data?.prompt_id) return;
  const job = renderJobForPrompt(data.prompt_id);
  if (!job || !renderActive(job)) return;
  const planned = job.samplers?.find(sampler => sampler.node === data.node);
  const plannedTotal = job.samplers?.reduce((sum, sampler) => sum + sampler.steps, 0) ?? 0;
  let patch: Partial<RenderProgress> = {};
  if (event.type === "execution_error" || event.type === "execution_interrupted") patch = { stage: "failed", error: data.exception_message?.slice(0, 500) || "Render was interrupted." };
  else if (event.type === "execution_start") patch.stage = "loading";
  else if (event.type === "execution_success") patch.stage = "saving";
  else if (event.type === "progress" && planned && Number.isFinite(data.value) && Number.isFinite(data.max) && data.max! > 0) {
    const index = job.samplers!.indexOf(planned);
    const offset = job.samplers!.slice(0, index).reduce((sum, sampler) => sum + sampler.steps, 0);
    patch = { stage: "sampling", step: offset + Math.min(planned.steps, data.value!), totalSteps: plannedTotal };
  } else if (event.type === "progress" && data.node === job.samplerNode && !job.samplers && Number.isFinite(data.value) && Number.isFinite(data.max) && data.max! > 0) {
    patch = { stage: "sampling", step: Math.max(job.step, Math.min(data.value!, data.max!)), totalSteps: data.max! };
  } else if (event.type === "progress_state") {
    if (job.samplers?.length) {
      let step = 0;
      let allFinished = true;
      let seen = false;
      for (const sampler of job.samplers) {
        const state = data.nodes?.[sampler.node];
        if (state) seen = true;
        if (state?.state === "finished") step += sampler.steps;
        else { allFinished = false; step += Math.max(0, Math.min(sampler.steps, state?.value ?? 0)); }
      }
      patch = seen ? { stage: allFinished ? "encoding" : "sampling", step, totalSteps: plannedTotal } : { stage: "loading" };
    } else {
      const sampler = data.nodes?.[job.samplerNode];
      if (sampler) {
        patch = sampler.state === "finished"
          ? { stage: "encoding", step: job.totalSteps || sampler.max, totalSteps: job.totalSteps || sampler.max }
          : { stage: "sampling", step: Math.max(job.step, sampler.value), totalSteps: sampler.max > 1 ? sampler.max : job.totalSteps };
      } else patch.stage = "loading";
    }
  } else if (event.type === "executing") {
    patch.stage = data.node === null ? "saving" : planned || data.node === job.samplerNode ? "sampling" : ["11", "12", "13", "14"].includes(data.node ?? "") && job.kind === "video" ? "encoding" : "loading";
  }
  if (!Object.keys(patch).length) return;
  updateRenderJob(job.id, current => {
    if (patch.stage !== "failed" && order.indexOf(patch.stage!) < order.indexOf(current.stage)) return {};
    return { ...patch, ...(patch.step !== undefined ? { step: Math.max(current.step, patch.step) } : {}) };
  });
}

type Monitor = { socket?: WebSocket; connected: boolean; reconnectAt: number };
const globals = globalThis as typeof globalThis & { aisleRenderMonitor?: Monitor };
export function ensureProgressMonitor() {
  const monitor = globals.aisleRenderMonitor ??= { connected: false, reconnectAt: 0 };
  if (monitor.socket && (monitor.socket.readyState === WebSocket.OPEN || monitor.socket.readyState === WebSocket.CONNECTING)) return monitor;
  if (Date.now() < monitor.reconnectAt) return monitor;
  const url = new URL("/ws", process.env.COMFYUI_URL || "http://127.0.0.1:8188");
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(url);
  monitor.socket = socket;
  socket.onopen = () => { monitor.connected = true; };
  socket.onmessage = event => {
    if (typeof event.data !== "string") return; // Never expose binary preview frames globally.
    try { acceptComfyProgress(JSON.parse(event.data)); } catch (error) { console.error("Render progress event rejected", error instanceof Error ? error.message : "Invalid event"); }
  };
  socket.onerror = () => { monitor.connected = false; socket.close(); };
  socket.onclose = () => { monitor.connected = false; monitor.socket = undefined; monitor.reconnectAt = Date.now() + 3000; };
  return monitor;
}

type BackendJob = { status: string; execution_error?: { exception_message?: string }; outputs?: Record<string, unknown> };
export async function reconcileRenderJob(job: RenderProgress, campaign: Campaign, fetchJob: (id: string) => Promise<BackendJob>) {
  const saved = [...campaign.creatives, ...campaign.videos].some(asset => asset.generation?.status === "ok" && asset.generation.url && job.promptId && asset.generation.promptId === job.promptId);
  if (saved) return updateRenderJob(job.id, { stage: "complete", error: undefined })!;
  if (!renderActive(job)) return job;
  if (job.sequence) {
    if (Date.now() - Date.parse(job.sequence.heartbeatAt) > 300_000) return updateRenderJob(job.id, { stage: "failed", error: "The multi-scene worker stopped reporting. Completed clips are retained; recover this production instead of generating again." })!;
    if (job.sequence.phase === "editing") return job;
    if (!job.promptId) return job; // Durable queue / between scenes; worker heartbeat owns liveness.
  }
  if (cloudRender(job)) {
    // The Studio request that owns the call saves the result or marks the job failed.
    // Only a request that died (restart, function timeout) leaves it active this long.
    const limit = job.kind === "video" ? 15 * 60_000 : 6 * 60_000;
    if (Date.now() - Date.parse(job.createdAt) > limit) return updateRenderJob(job.id, { stage: "failed", error: "The cloud render stopped reporting and nothing was saved to this campaign. Check Billing before generating again." })!;
    return job;
  }
  if (!job.promptId) {
    if (Date.now() - Date.parse(job.createdAt) > 120_000) return updateRenderJob(job.id, { stage: "failed", error: "The render request stopped before it reached the backend. Please try again." })!;
    return job;
  }
  try {
    const remote = await fetchJob(job.promptId);
    if (["failed", "cancelled", "missing"].includes(remote.status)) return updateRenderJob(job.id, { stage: "failed", error: remote.status === "missing" ? "The backend no longer has this job, possibly after a restart. No saved output was found." : remote.execution_error?.exception_message?.slice(0, 500) || "The local render failed or was cancelled." })!;
    if (remote.status === "completed") {
      // An individual clip completing does not mean the entire edited ad is saved.
      if (job.sequence) return { ...job, backendOnline: true };
      if (job.stage === "saving" && Date.now() - Date.parse(job.updatedAt) > 300_000) return updateRenderJob(job.id, { stage: "failed", error: "Rendering finished, but saving to this campaign has not completed. The backend output is retained; do not generate again to recover it." })!;
      return job.stage === "saving" ? { ...job, backendOnline: true } : updateRenderJob(job.id, { stage: "saving", backendOnline: true })!;
    }
    if (remote.status === "pending") return job.stage === "queued" ? { ...job, backendOnline: true } : updateRenderJob(job.id, { stage: "queued", backendOnline: true })!;
    if (remote.status === "in_progress") return ["preparing", "queued"].includes(job.stage) ? updateRenderJob(job.id, { stage: "loading", backendOnline: true })! : { ...job, backendOnline: true };
    return { ...job, backendOnline: false };
  } catch { return { ...job, backendOnline: false }; }
}

export async function campaignRenderProgress(userId: string, campaign: Campaign) {
  const listed = listRenderJobs(userId, campaign.id);
  // Only a live local render needs the ComfyUI socket (there is none on Vercel).
  const monitor = listed.some(job => renderActive(job) && !cloudRender(job)) ? ensureProgressMonitor() : globals.aisleRenderMonitor;
  const jobs = await Promise.all(listed.map(job => reconcileRenderJob(job, campaign, async id => {
    const response = await fetch(`${(process.env.COMFYUI_URL || "http://127.0.0.1:8188").replace(/\/$/, "")}/api/jobs/${encodeURIComponent(id)}`, { cache: "no-store", signal: AbortSignal.timeout(4000) });
    if (response.status === 404) return { status: "missing" };
    if (!response.ok) throw new Error(`Render status unavailable (${response.status})`);
    return response.json();
  })));
  return { jobs, liveConnected: monitor?.connected ?? false };
}
