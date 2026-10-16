"use client";

import { AdCanvas } from "@/components/AdCanvas";
import { CostHover } from "@/components/studio/CostHover";
import { VideoSpot } from "@/components/studio/VideoSpot";
import { GenerationInfo } from "@/components/studio/GenerationInfo";
import { RenderProgressPanel, useRenderProgress } from "@/components/studio/RenderProgress";
import { renderActive } from "@/lib/media/progress-types";
import { formatUsd } from "@/lib/ids";
import { getLlmOrDefault } from "@/lib/llm/catalog";
import { campaignVideoDurations, DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, getModel, getModelOrDefault, snapCampaignDuration, sunsetLabel } from "@/lib/media/catalog";
import { formatCredits, milliForCost } from "@/lib/billing/plan";
import { providerUsable, useMediaProviders } from "@/components/studio/useMediaProviders";
import { holdEstimateUsd, quoteModel } from "@/lib/media/estimate";
import { studioSpend, withStudioDefaults } from "@/lib/media/spend";
import { useAisle } from "@/lib/store";
import type { Campaign } from "@/lib/types";
import Link from "next/link";
import { useMemo, useState } from "react";

/**
 * "est. $0.05 · 11 credits · needs 16 available", or "free" for local renders.
 * The hold is what must be free before the render starts (token-billed calls
 * reserve a buffer), so a user is not surprised by a 402 below the estimate.
 */
function estimate(costUsd: number, holdUsd?: number) {
  if (!(costUsd > 0)) return "free, local";
  const credits = milliForCost(costUsd);
  const hold = holdUsd ? milliForCost(holdUsd) : 0;
  return `est. ${formatUsd(costUsd)} · ${formatCredits(credits)} credits${hold > credits ? ` · needs ${formatCredits(hold)} available` : ""}`;
}

/** Shown instead of a price when neither the chosen model nor local ComfyUI can render here. */
const NO_RENDERER = "No renderer available on this server — see Settings";

export function CreativeStudio({ campaign }: { campaign: Campaign }) {
  const c = withStudioDefaults(campaign);
  const settings = useAisle((s) => s.settings);
  const generatePosters = useAisle((s) => s.generatePosters);
  const generateAdVideo = useAisle((s) => s.generateAdVideo);
  const [mode, setMode] = useState<"posters" | "video">("posters");
  const [selectedCreative, setSelectedCreative] = useState("");
  // This is an unsent take setting; workspace polling must not reset the selection.
  const [pickedDuration, setDurationSec] = useState<number | undefined>();
  const [ltxQuality, setLtxQuality] = useState<"medium" | "high">("high");
  const [styleReference, setStyleReference] = useState("");
  const spend = studioSpend(c);
  const providers = useMediaProviders();
  const credits = useAisle(s => s.studioCredits?.campaignId === c.id ? s.studioCredits : null);

  const chosenImage = useMemo(
    () => getModelOrDefault(settings.imageModelId, "image"),
    [settings.imageModelId],
  );
  const chosenVideo = useMemo(
    () => getModelOrDefault(settings.videoModelId, "video"),
    [settings.videoModelId],
  );
  // A provider this server cannot call renders on local ComfyUI, so quote and label that.
  const imageModel = providerUsable(providers, chosenImage.providerId) ? chosenImage : getModel(DEFAULT_IMAGE_MODEL);
  const videoModel = providerUsable(providers, chosenVideo.providerId) ? chosenVideo : getModel(DEFAULT_VIDEO_MODEL);
  // The fallback is ComfyUI; when that is unreachable too (a hosted server), nothing can render.
  const imageRenderable = providerUsable(providers, imageModel.providerId);
  const videoRenderable = providerUsable(providers, videoModel.providerId);
  const durationOptions = campaignVideoDurations(videoModel);
  const durationSec = snapCampaignDuration(videoModel, pickedDuration ?? settings.videoDurationSec ?? c.videoDurationSec);
  const copyModel = getLlmOrDefault(settings.agents.creative.modelId);
  const posterQuote = quoteModel(imageModel.id);
  const posterCount = Math.max(c.creatives.length, 2);
  const pairQuote = posterQuote.costUsd * posterCount;
  // Posters render one at a time: the last one still needs its full hold free.
  const pairHold = posterQuote.costUsd * (posterCount - 1) + holdEstimateUsd(imageModel, { prompt: "retail poster brief" });
  const videoQuote = quoteModel(videoModel.id, { durationSec });
  const videoHold = holdEstimateUsd(videoModel, { prompt: "retail poster brief", durationSec });
  const kept = useAisle(s => s.studioKept?.campaignId === c.id ? s.studioKept : null);
  const localBusy = useAisle(s => s.studioPending[c.id]);
  const progress = useRenderProgress(c.id);
  const activeRender = progress.jobs.find(renderActive);
  const busy = localBusy ?? (activeRender ? activeRender.kind === "video" ? "video" : "posters" : undefined);
  const message = useAisle(s => s.engineMessage);
  const usableImages = c.creatives.filter(cr => cr.generation?.status === "ok" && cr.generation.url);
  const textVideo = videoModel.videoInput === "text";
  const sources = textVideo ? c.creatives : usableImages;
  const sourceId = sources.some(cr => cr.id === selectedCreative) ? selectedCreative : sources[0]?.id;
  const source = sources.find(cr => cr.id === sourceId);
  const story = durationSec === 30 && Boolean(source);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-signal">Creative studio</p>
          <h2 className="font-serif text-3xl">Posters and ad videos.</h2>
          <p className="mt-2 max-w-xl text-sm text-ink-soft">
            Generate here. Models live in{" "}
            <Link href="/settings" className="text-signal hover:underline">
              Settings
            </Link>
            . Hover a take for tokens and cost.
          </p>
        </div>
        <p className="text-sm tabular-nums text-mute">
          This campaign studio · {formatUsd(spend.total)}
        </p>
      </div>

      <RenderProgressPanel {...progress} onViewVideo={() => setMode("video")} />

      <div className="flex gap-1 border-b border-line">
        <button
          type="button"
          onClick={() => setMode("posters")}
          className={`px-3 py-2 text-sm ${mode === "posters" ? "border-b-2 border-ink" : "text-mute"}`}
        >
          Posters ({c.creatives.length})
        </button>
        <button
          type="button"
          onClick={() => setMode("video")}
          className={`px-3 py-2 text-sm ${mode === "video" ? "border-b-2 border-ink" : "text-mute"}`}
        >
          Ad videos ({c.videos.length})
        </button>
      </div>
      {message ? (
        <p role="status" className="rounded border border-line bg-surface p-3 text-sm">
          {message}
          {kept ? <>{" "}<a href={kept.url} className="font-medium text-signal underline underline-offset-4">Download the take</a></> : null}
        </p>
      ) : null}
      {credits ? (
        <p role="alert" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {credits.message} This take needs about {credits.neededCredits.toLocaleString("en-US", { maximumFractionDigits: 1 })} credits; you have {credits.balanceCredits.toLocaleString("en-US", { maximumFractionDigits: 1 })}.{" "}
          <Link href={credits.billingUrl} className="font-medium underline underline-offset-4">Go to Billing</Link>
        </p>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,260px)_1fr]">
        <div>
          {mode === "posters" ? (
            <>
              <p className="text-[11px] uppercase tracking-wider text-mute">From settings</p>
              <p className="mt-1 font-serif text-xl">{imageModel.name}</p>
              <p className="text-xs text-mute">
                {imageModel.estimateLabel} · {imageModel.provider}
              </p>
              <ModelNotes chosen={chosenImage} runs={imageModel} renderable={imageRenderable} />
              <p className="mt-2 text-xs text-mute">
                Copy agent · {copyModel.provider} · {copyModel.name}
              </p>
              <button
                type="button"
                disabled={Boolean(busy) || c.creatives.length === 0 || !imageRenderable}
                onClick={() => void generatePosters(c.id)}
                className="mt-4 w-full rounded-full bg-ink py-2.5 text-sm text-paper disabled:opacity-50"
              >
                {busy === "posters"
                  ? `Rendering on ${activeRender?.modelName ?? imageModel.name}…`
                  : !imageRenderable ? NO_RENDERER
                  : `Generate posters · ${estimate(pairQuote, pairHold)}`}
              </button>
              <Link href="/settings" className="mt-3 block text-xs text-signal hover:underline">
                Change image or copy model
              </Link>
            </>
          ) : (
            <>
              <label className="mb-4 block text-xs">
                {textVideo ? "Creative brief — text-to-video" : "Starting image — first frame of the ad"}
                <select value={sourceId ?? ""} onChange={e => setSelectedCreative(e.target.value)} className="mt-2 block w-full rounded border border-line p-2" disabled={Boolean(busy)}>
                  {!sources.length ? <option value="">{textVideo ? "Create campaign copy first" : "Generate an image first"}</option> : null}
                  {sources.map(cr => <option key={cr.id} value={cr.id}>Variant {cr.variant} — {cr.headline}</option>)}
                </select>
              </label>
              <p className="text-[11px] uppercase tracking-wider text-mute">From settings</p>
              <p className="mt-1 font-serif text-xl">{videoModel.name}</p>
              <p className="text-xs text-mute">
                {videoModel.estimateLabel} · {videoModel.provider}
              </p>
              <ModelNotes chosen={chosenVideo} runs={videoModel} renderable={videoRenderable} />
              {textVideo ? <>
                <p className="mt-2 text-xs leading-relaxed text-mute">16:9 cinematic {story ? "story ad" : "scene"} from the campaign brief. The poster is not passed to LTX. Exact packaging and character continuity require human review.</p>
                <label className="mt-3 block text-[11px] uppercase tracking-wider text-mute">
                  LTX resolution
                  <select value={ltxQuality} onChange={e => setLtxQuality(e.target.value as "medium" | "high")} disabled={Boolean(busy)} className="mt-1 w-full border border-line bg-surface px-2 py-1.5 text-sm text-ink">
                    <option value="high">Full HD · 1920 × 1080</option>
                    <option value="medium">HD preview · 1280 × 720</option>
                  </select>
                </label>
              </> : null}
              <label className="mt-3 block text-[11px] uppercase tracking-wider text-mute">
                Ad length / test clip
                <select
                  value={durationSec}
                  onChange={(e) => setDurationSec(Number(e.target.value))}
                  disabled={Boolean(busy)}
                  className="mt-1 w-full border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                >
                  {durationOptions.map((s) => (
                    <option key={s} value={s}>
                      {s}s{s === 30 ? " complete story ad" : " test clip"} · {videoRenderable ? estimate(quoteModel(videoModel.id, { durationSec: s }).costUsd) : "not available"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mt-3 block text-xs text-mute">
                Creative direction / reference prompt (optional)
                <textarea value={styleReference} onChange={e => setStyleReference(e.target.value)} maxLength={4000} disabled={Boolean(busy)} rows={4} className="mt-2 w-full rounded border border-line bg-surface p-2 text-ink" placeholder="Paste a previous prompt or describe the style. The art director will adapt it to this product and brief." />
              </label>
              {story ? <section aria-label="30-second ad storyline" className="mt-3 rounded-xl border border-line bg-surface p-3">
                <p className="text-xs font-medium">Agent-written storyline</p>
                <p className="mt-2 text-xs text-mute">Your creative agent develops the selling idea, hook, setup, development, payoff and continuity notes from this campaign. No fixed actor or product script. The saved take includes its generated plan for review.</p>
                <p className="mt-2 text-xs text-mute">Planning: {copyModel.name} · {copyModel.providerId === "local" ? "free, local" : "billed separately in credits"}. Local edited ads track scenes, editing and saving in the background. No automatic approval or publishing.</p>
              </section> : null}
              <button
                type="button"
                disabled={Boolean(busy) || !sourceId || !videoRenderable}
                onClick={() => void generateAdVideo(c.id, sourceId, durationSec, textVideo ? ltxQuality : undefined, styleReference.trim() || undefined)}
                className="mt-4 w-full rounded-full bg-ink py-2.5 text-sm text-paper disabled:opacity-50"
              >
                {busy === "video"
                  ? `Rendering on ${activeRender?.modelName ?? videoModel.name}…`
                  : !videoRenderable ? NO_RENDERER
                  : `Generate ${durationSec}s ${story ? "story ad" : "test clip"} · ${estimate(videoQuote.costUsd, videoHold)}`}
              </button>
              <Link href="/settings" className="mt-3 block text-xs text-signal hover:underline">
                Change video model
              </Link>
            </>
          )}
        </div>

        <div>
          {mode === "posters" ? (
            c.creatives.length === 0 ? (
              <p className="text-sm text-mute">
                No posters yet. Generate here, or launch agents so copy lands first.
              </p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {c.creatives.map((cr) => (
                  <div key={cr.id}>
                    <div className="mb-2 flex justify-between text-xs text-mute">
                      <span>
                        Variant {cr.variant} · v{cr.version}
                      </span>
                      <span>{cr.generation?.modelName ?? "No model yet"}</span>
                    </div>
                    <CostHover generation={cr.generation}>
                      <AdCanvas creative={cr} campaignId={c.id} brandLabel={c.sharedContext.retailer} className="aspect-[4/5]" />
                    </CostHover>
                    <GenerationInfo generation={cr.generation} />
                    <p className="mt-2 text-xs text-mute">{cr.prompt}</p>
                  </div>
                ))}
              </div>
            )
          ) : c.videos.length === 0 ? (
            <p className="text-sm text-mute">
              No ad videos yet. Generate a spot with the video model from Settings.
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {[...c.videos].sort((a, b) => b.version - a.version).map((v) => (
                <VideoSpot key={v.id} video={v} campaignId={c.id} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Why the Studio renders on another model, and whether the chosen one is shutting down. */
function ModelNotes({ chosen, runs, renderable }: { chosen: ReturnType<typeof getModel>; runs: ReturnType<typeof getModel>; renderable: boolean }) {
  const sunset = sunsetLabel(runs);
  return (
    <>
      {!renderable
        ? <p className="mt-1 text-xs text-amber-800">{chosen.providerId === "comfy" ? "Local ComfyUI is not reachable from this server." : `${chosen.name} is not available on this server, and local ComfyUI is not reachable either.`} Pick an available cloud model in Settings.</p>
        : chosen.id !== runs.id ? <p className="mt-1 text-xs text-amber-800">{chosen.name} is not available on this server, so this renders locally.</p> : null}
      {sunset ? <p className="mt-1 text-xs text-amber-800">{sunset}.</p> : null}
      {runs.providerId !== "comfy" ? <p className="mt-1 text-xs text-mute">Cloud renders are paid in credits and charged at the provider&apos;s real cost.</p> : null}
    </>
  );
}
