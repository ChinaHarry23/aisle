import type { MediaGeneration } from "@/lib/media/types";
import { formatClipDuration, formatGenerationDate, formatGenerationDuration, generationTiming } from "@/lib/media/timing";

export function GenerationInfo({ generation, clipDurationSec }: { generation?: MediaGeneration; clipDurationSec?: number }) {
  const timing = generationTiming(generation);
  const successful = generation?.status === "ok" && Boolean(generation.url);
  return (
    <div className="mt-3 rounded-xl border border-line bg-surface p-3" aria-label="Generation information">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <div>
          <dt className="text-mute">{generation?.composition ? "Production time" : "Generation time"}</dt>
          <dd className="mt-1 font-medium tabular-nums text-ink">{formatGenerationDuration(timing.durationMs)}</dd>
        </div>
        <div>
          <dt className="text-mute">{clipDurationSec !== undefined ? "Video length" : "Generator"}</dt>
          <dd className="mt-1 font-medium text-ink">{clipDurationSec !== undefined ? formatClipDuration(clipDurationSec) : generation?.modelName ?? "Not recorded"}</dd>
        </div>
        {generation?.resolution ? <div className="col-span-2">
          <dt className="text-mute">Video format</dt>
          <dd className="mt-1 font-medium tabular-nums text-ink">{generation.resolution.width} × {generation.resolution.height}{generation.frameRate ? ` · ${generation.frameRate} fps` : ""}{generation.videoMode === "text-to-video" ? " · Text-to-video" : ""}</dd>
        </div> : null}
        <div className="col-span-2">
          <dt className="text-mute">Completed (Sydney time)</dt>
          <dd className="mt-1 tabular-nums text-ink">{timing.completedAt ? <time dateTime={timing.completedAt} title={timing.completedAt}>{formatGenerationDate(timing.completedAt)}</time> : "Not recorded"}</dd>
        </div>
      </dl>
      <p className="mt-2 text-[11px] leading-relaxed text-mute">
        {generation?.composition ? `New scene rendering: ${formatGenerationDuration(generation.composition.renderMs)}. Editing: ${formatGenerationDuration(generation.composition.editingMs)}. Includes queueing and model loading; excludes the earlier rendering of ${generation.composition.reusedClips} reused clip(s), interrupted attempts and idle time between runs.` : timing.durationMs !== null ? "Recorded request time includes queueing, model loading and rendering for this attempt. Earlier failed attempts and later saving are excluded." : successful ? "This asset has no recorded generation duration." : "No successfully generated asset is attached."}
      </p>
      {generation?.composition ? <details className="mt-2 text-xs text-mute">
        <summary className="cursor-pointer">Scene timeline and generation times</summary>
        <ol className="mt-2 space-y-1">
          {generation.composition.shots.map((shot, i) => <li key={`${shot.promptId ?? shot.label}-${i}`}>
            {shot.startSec !== undefined ? `${shot.startSec}–${shot.startSec + shot.durationSec}s · ` : ""}{shot.label} · {shot.durationSec}s · {shot.kind === "end-card" ? "Authored during editing" : `${formatGenerationDuration(shot.generationMs)}${shot.reused ? " (reused)" : ""}`}
          </li>)}
        </ol>
      </details> : null}
      {generation?.artDirection ? <details className="mt-3 text-xs text-mute">
        <summary className="cursor-pointer">AI art direction and story</summary>
        <p className="mt-2 font-medium text-ink">{generation.artDirection.title}</p>
        <p className="mt-1">Selling idea: {generation.artDirection.sellingIdea}</p>
        <p className="mt-1">Hook: {generation.artDirection.hook}</p>
        <ol className="mt-2 space-y-1">
          <li>Setup: {generation.artDirection.story.setup}</li>
          <li>Development: {generation.artDirection.story.development}</li>
          <li>Payoff: {generation.artDirection.story.payoff}</li>
        </ol>
        <p className="mt-2">Art director: {generation.artDirection.author.modelName} · {formatGenerationDuration(generation.artDirection.author.usage.latencyMs)} · ${generation.artDirection.author.usage.costUsd.toFixed(4)} · {generation.artDirection.version}</p>
        <p className="mt-1">Continuity: {Object.entries(generation.artDirection.continuity).filter(([key]) => key !== "visibleRecurringFace").map(([, value]) => value).join(" · ")}</p>
        {generation.artDirection.shots.length ? <details className="mt-2">
          <summary className="cursor-pointer">Shot continuity and prompts</summary>
          <ol className="mt-2 space-y-3">
            {generation.artDirection.shots.map((shot, i) => <li key={i}>
              <p className="font-medium text-ink">{i + 1}. {shot.label} · {shot.beat}</p>
              <p>Entry: {shot.entryState}</p><p>Exit: {shot.exitState}</p>
              <p className="mt-1 whitespace-pre-wrap">{shot.prompt}</p>
            </li>)}
          </ol>
        </details> : null}
        {generation.artDirection.styleReference ? <details className="mt-2">
          <summary className="cursor-pointer">Supplied creative reference</summary>
          <p className="mt-1 whitespace-pre-wrap">{generation.artDirection.styleReference}</p>
        </details> : null}
        {generation.artDirection.reviewNotes.map((note, i) => <p key={i} className="mt-1">Review: {note}</p>)}
      </details> : null}
    </div>
  );
}
