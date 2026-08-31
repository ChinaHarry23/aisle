"use client";

import { AdCanvas } from "@/components/AdCanvas";
import { CostHover } from "@/components/studio/CostHover";
import { VideoSpot } from "@/components/studio/VideoSpot";
import { formatUsd } from "@/lib/ids";
import { getLlmOrDefault } from "@/lib/llm/catalog";
import { getModelOrDefault } from "@/lib/media/catalog";
import { quoteModel } from "@/lib/media/estimate";
import { studioSpend, withStudioDefaults } from "@/lib/media/spend";
import { useAisle } from "@/lib/store";
import type { Campaign } from "@/lib/types";
import Link from "next/link";
import { useMemo, useState } from "react";

export function CreativeStudio({ campaign }: { campaign: Campaign }) {
  const c = withStudioDefaults(campaign);
  const settings = useAisle((s) => s.settings);
  const setStudio = useAisle((s) => s.setStudio);
  const generatePosters = useAisle((s) => s.generatePosters);
  const generateAdVideo = useAisle((s) => s.generateAdVideo);
  const [mode, setMode] = useState<"posters" | "video">("posters");
  const spend = studioSpend(c);

  const imageModel = useMemo(
    () => getModelOrDefault(settings.imageModelId, "image"),
    [settings.imageModelId],
  );
  const videoModel = useMemo(
    () => getModelOrDefault(settings.videoModelId, "video"),
    [settings.videoModelId],
  );
  const copyModel = getLlmOrDefault(settings.agents.creative.modelId);
  const posterQuote = quoteModel(imageModel.id);
  const pairQuote = posterQuote.costUsd * Math.max(c.creatives.length, 2);
  const videoQuote = quoteModel(videoModel.id, { durationSec: c.videoDurationSec });
  const busy = c.studioBusy;

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

      <div className="flex gap-1 border-b border-line">
        <button
          type="button"
          onClick={() => setMode("posters")}
          className={`px-3 py-2 text-sm ${mode === "posters" ? "border-b-2 border-ink" : "text-mute"}`}
        >
          Posters
        </button>
        <button
          type="button"
          onClick={() => setMode("video")}
          className={`px-3 py-2 text-sm ${mode === "video" ? "border-b-2 border-ink" : "text-mute"}`}
        >
          Ad videos
        </button>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,260px)_1fr]">
        <div>
          {mode === "posters" ? (
            <>
              <p className="text-[11px] uppercase tracking-wider text-mute">From settings</p>
              <p className="mt-1 font-serif text-xl">{imageModel.name}</p>
              <p className="text-xs text-mute">
                {imageModel.estimateLabel} · {imageModel.provider}
              </p>
              <p className="mt-2 text-xs text-mute">
                Copy agent · {copyModel.provider} · {copyModel.name}
              </p>
              <button
                type="button"
                disabled={busy === "posters"}
                onClick={() => void generatePosters(c.id)}
                className="mt-4 w-full rounded-full bg-ink py-2.5 text-sm text-paper disabled:opacity-50"
              >
                {busy === "posters"
                  ? `Rendering on ${imageModel.name}…`
                  : `Generate posters · est. ${formatUsd(pairQuote)}`}
              </button>
              <Link href="/settings" className="mt-3 block text-xs text-signal hover:underline">
                Change image or copy model
              </Link>
            </>
          ) : (
            <>
              <p className="text-[11px] uppercase tracking-wider text-mute">From settings</p>
              <p className="mt-1 font-serif text-xl">{videoModel.name}</p>
              <p className="text-xs text-mute">
                {videoModel.estimateLabel} · {videoModel.provider}
              </p>
              <label className="mt-3 block text-[11px] uppercase tracking-wider text-mute">
                Duration this take
                <select
                  value={c.videoDurationSec}
                  onChange={(e) =>
                    setStudio(c.id, { videoDurationSec: Number(e.target.value) })
                  }
                  className="mt-1 w-full border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                >
                  {[4, 6, 8, 12].map((s) => (
                    <option key={s} value={s}>
                      {s}s · {formatUsd(quoteModel(videoModel.id, { durationSec: s }).costUsd)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={busy === "video"}
                onClick={() => void generateAdVideo(c.id)}
                className="mt-4 w-full rounded-full bg-ink py-2.5 text-sm text-paper disabled:opacity-50"
              >
                {busy === "video"
                  ? `Rendering on ${videoModel.name}…`
                  : `Generate ${c.videoDurationSec}s ad · est. ${formatUsd(videoQuote.costUsd)}`}
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
                      <AdCanvas creative={cr} className="aspect-[4/5]" />
                    </CostHover>
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
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {c.videos.map((v) => (
                <VideoSpot key={v.id} video={v} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
