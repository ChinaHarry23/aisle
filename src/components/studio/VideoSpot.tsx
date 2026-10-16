"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import type { AdVideo } from "@/lib/media/types";
import { CostHover } from "./CostHover";
import { campaignMediaUrl } from "@/lib/media/url";
import { GenerationInfo } from "./GenerationInfo";
import { formatClipDuration } from "@/lib/media/timing";

export function VideoSpot({ video, className, campaignId }: { video: AdVideo; className?: string; campaignId?: string }) {
  const g = video.generation;
  const src = campaignMediaUrl(campaignId, video.id, g);
  const [failed, setFailed] = useState(false);
  return (
    <div className={video.aspect === "16:9" ? "md:col-span-2" : undefined}>
      <h3 className="mb-2 text-sm font-medium">{video.title}</h3>
    <CostHover generation={g}>
      <article
        className={cn("relative overflow-hidden bg-ink text-paper", className)}
        style={{ aspectRatio: video.aspect.replace(":", " / ") }}
      >
        {g.url && g.status === "ok" ? (
          <video
            src={src}
            className="absolute inset-0 h-full w-full object-cover"
            controls
            playsInline
            aria-label={video.title}
            preload="metadata"
            onError={() => setFailed(true)}
            onLoadedData={() => setFailed(false)}
          />
        ) : (
          <div className="studio-ken absolute inset-0 bg-gradient-to-br from-[#1b2430] via-[#3d4f2f] to-[#c4342a]" />
        )}
        {failed ? <p role="alert" className="absolute inset-x-3 bottom-14 rounded bg-white p-3 text-xs text-red-800">Video could not load. The saved render is retained; check the local service.</p> : null}
        {g.url && g.status === "ok" ? (
          <p className="pointer-events-none absolute left-4 top-4 text-[10px] uppercase tracking-[0.2em] text-white/80">
            {g.modelName} · {formatClipDuration(video.durationSec)}
          </p>
        ) : (
          <div className="relative flex h-full flex-col justify-between p-5">
            <p className="text-[10px] uppercase tracking-[0.2em] text-signal">
              {g.modelName} · {formatClipDuration(video.durationSec)} · {video.aspect}
            </p>
            <div>
              <p className="font-serif text-2xl leading-tight">{video.title}</p>
              <p className="mt-6 flex h-12 w-12 items-center justify-center rounded-full border border-white/40 text-xs">
                ▶
              </p>
            </div>
            <p className="text-[10px] uppercase tracking-[0.16em] text-white/50">Ad video · {g.status}</p>
          </div>
        )}
      </article>
    </CostHover>
    <GenerationInfo generation={g} clipDurationSec={video.durationSec} />
    <details className="mt-3 text-xs text-mute">
      <summary className="cursor-pointer">View creative prompt / shot plan</summary>
      <p className="mt-2 whitespace-pre-wrap leading-relaxed">{video.prompt}</p>
    </details>
    <p className="mt-2 text-xs text-mute">Generated asset · review the visuals and campaign approval before publication.</p>
    </div>
  );
}
