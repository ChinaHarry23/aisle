import { cn } from "@/lib/cn";
import type { AdVideo } from "@/lib/media/types";
import { CostHover } from "./CostHover";

export function VideoSpot({ video, className }: { video: AdVideo; className?: string }) {
  const g = video.generation;
  return (
    <CostHover generation={g}>
      <article
        className={cn("relative overflow-hidden bg-ink text-paper", className)}
        style={{ aspectRatio: video.aspect.replace(":", " / ") }}
      >
        <div className="studio-ken absolute inset-0 bg-gradient-to-br from-[#1b2430] via-[#3d4f2f] to-[#c4342a]" />
        <div className="relative flex h-full flex-col justify-between p-5">
          <p className="text-[10px] uppercase tracking-[0.2em] text-signal">
            {g.modelName} · {video.durationSec}s · {video.aspect}
          </p>
          <div>
            <p className="font-serif text-2xl leading-tight">{video.title}</p>
            <p className="mt-6 flex h-12 w-12 items-center justify-center rounded-full border border-white/40 text-xs">
              ▶
            </p>
          </div>
          <p className="text-[10px] uppercase tracking-[0.16em] text-white/50">
            Ad video stub · {g.status}
          </p>
        </div>
      </article>
    </CostHover>
  );
}
