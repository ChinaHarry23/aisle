"use client";

import { useEffect, useState } from "react";
import { cloudRender, renderActive, type RenderProgress as RenderJob, type RenderStage } from "@/lib/media/progress-types";
import { useAisle } from "@/lib/store";
import type { Campaign } from "@/lib/types";

const labels: Record<RenderStage, string> = { preparing: "Preparing input", queued: "Queued", loading: "Loading model / preparing frames", sampling: "Rendering", encoding: "Encoding frames and audio", saving: "Saving to campaign", complete: "Ready to review", failed: "Render needs attention" };

export function useRenderProgress(campaignId: string) {
  const [state, setState] = useState<{ campaignId: string; jobs: RenderJob[]; unavailable: boolean; liveConnected: boolean }>({ campaignId, jobs: [], unavailable: false, liveConnected: false });
  useEffect(() => {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout>;
    const applied = new Set<string>();
    async function refresh() {
      try {
        const response = await fetch(`/api/studio/progress/${encodeURIComponent(campaignId)}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]) });
        if (!response.ok) throw new Error("Progress unavailable");
        const data = await response.json() as { jobs: RenderJob[]; liveConnected: boolean; campaign?: Campaign };
        if (!controller.signal.aborted) {
          setState({ campaignId, jobs: data.jobs, liveConnected: data.liveConnected, unavailable: false });
          const completed = data.jobs.find(job => job.sequence && job.stage === "complete" && !applied.has(job.id));
          if (completed && data.campaign?.id === campaignId) {
            applied.add(completed.id);
            useAisle.setState(s => ({ campaigns: s.campaigns.map(c => c.id === campaignId ? data.campaign! : c) }));
          }
        }
      } catch {
        if (!controller.signal.aborted) setState(previous => ({ ...previous, unavailable: true }));
      } finally {
        if (!controller.signal.aborted) timeout = setTimeout(refresh, 2500);
      }
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timeout); };
  }, [campaignId]);
  return state.campaignId === campaignId ? state : { campaignId, jobs: [], unavailable: false, liveConnected: false };
}

function elapsed(start: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(start)) / 1000));
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function RenderProgressPanel({ jobs, unavailable, liveConnected, onViewVideo }: { jobs: RenderJob[]; unavailable: boolean; liveConnected: boolean; onViewVideo: () => void }) {
  const active = jobs.filter(renderActive);
  const visible = active.length ? active : jobs.slice(0, 1);
  if (!visible.length && !unavailable) return null;
  return (
    <section aria-label="Render progress" className="rounded-2xl border border-line bg-surface p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Render progress</h3>
        <span className="text-xs text-mute">{unavailable ? "Connection interrupted" : active.length ? "Updates automatically" : "Saved render status"}</span>
      </div>
      {unavailable ? <p role="status" className="mb-3 text-sm text-amber-800">Cannot refresh progress. The backend may still be working; do not generate again.</p> : null}
      {visible.map(job => {
        const done = job.stage === "complete";
        const failed = job.stage === "failed";
        const sampling = job.stage === "sampling" && job.totalSteps > 0;
        const percent = done ? 100 : sampling ? Math.min(100, Math.round(job.step / job.totalSteps * 100)) : undefined;
        const cloud = cloudRender(job);
        const disconnected = unavailable || job.backendOnline === false;
        const finishedScenes = done ? job.sequence?.total : job.sequence ? job.sequence.phase === "editing" ? job.sequence.total : Math.max(0, job.sequence.current - 1) : undefined;
        return (
          <div key={job.id} className="mt-4 first:mt-0" data-render-stage={job.stage}>
            {job.sequence ? <p className="mb-2 text-sm font-medium">{job.sequence.title} · {done ? "Finished cut saved" : job.sequence.phase === "editing" ? "Editing and validating the finished cut" : `New scene ${job.sequence.current} of ${job.sequence.total}: ${job.sequence.label}`}</p> : null}
            {job.sequence ? <p className="mb-2 text-xs text-mute">{finishedScenes} / {job.sequence.total} scenes finished · 30s final cut · closing card and saving {done ? "complete" : "follow"}. {done ? "" : "Continues in the background when you leave or reload."}</p> : null}
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm" role="status">{job.modelName} · {labels[job.stage]}</p>
              <p className="text-xs tabular-nums text-mute">{done ? "100% · Saved" : failed ? "Not completed" : `${elapsed(job.createdAt)} elapsed`}</p>
            </div>
            <div role="progressbar" aria-label={`${job.kind === "video" ? "Video" : "Image"} render progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={done ? "Complete and saved" : sampling ? `${job.step} of ${job.totalSteps} sampling steps; final encoding still follows` : labels[job.stage]} className="mt-3 h-2.5 overflow-hidden rounded-full bg-line">
              <div className={`h-full rounded-full transition-[width] duration-500 ${failed ? "bg-red-500" : done ? "bg-emerald-700" : "bg-signal"} ${percent === undefined && !failed && !disconnected ? "animate-pulse motion-reduce:animate-none" : ""}`} style={{ width: `${percent ?? (failed ? 0 : 35)}%` }} />
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-mute">
              <span>{sampling ? `${job.step} / ${job.totalSteps} sampling steps · ${percent}% sampled` : cloud && renderActive(job) && job.stage !== "saving" ? `Rendering in the cloud on ${job.modelName}. Cloud renders report no step progress; this updates when the take is saved.` : job.stage === "queued" ? "Waiting for an available backend slot" : done ? "Finished and attached to this campaign. Human review required." : failed ? job.error : job.stage === "encoding" ? "Sampling finished. The MP4 is not ready yet." : job.stage === "saving" ? "Render finished; waiting for the saved campaign asset." : "Waiting for the next backend progress event"}</span>
              {done && job.kind === "video" ? <button type="button" onClick={onViewVideo} className="font-medium text-signal underline underline-offset-4">View video</button> : null}
            </div>
            {renderActive(job) && !cloud && (disconnected || !liveConnected) ? <p className="mt-2 text-xs text-amber-800">{disconnected ? "Backend unreachable. Showing the last confirmed progress." : "Reconnecting live step updates; checking job status automatically."}</p> : null}
            {sampling ? <p className="mt-2 text-xs text-mute">This is sampling progress{job.sequence ? " for the current scene" : ""}, not total render time. {job.sequence ? "Remaining scenes, editing and saving follow." : "Encoding and saving follow."}</p> : null}
          </div>
        );
      })}
    </section>
  );
}
