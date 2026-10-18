/* eslint-disable @next/next/no-img-element */
import { Bookmark, Heart, MessageCircle, Send } from "lucide-react";
import { campaignMediaUrl } from "@/lib/media/url";
import type { BrandProfile, Creative } from "@/lib/types";

/**
 * How the approved creative will look as an Instagram feed post: the generated
 * image (or, until one exists, the ad drawn from the creative's own palette
 * and headline) with the generated caption underneath.
 */
export function InstagramPost({
  brand,
  creative,
  campaignId,
}: {
  brand: BrandProfile;
  creative: Creative;
  campaignId?: string;
}) {
  const handle = brand.retailerName.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const image = campaignMediaUrl(campaignId, creative.id, creative.generation);

  return (
    <figure className="w-full max-w-[22rem] overflow-hidden border border-line bg-surface text-sm">
      <figcaption className="flex items-center gap-2.5 px-3 py-2.5">
        {brand.logoUrl ? (
          <img src={brand.logoUrl} alt="" className="h-8 w-8 rounded-full border border-line object-cover" />
        ) : (
          <span className="grid h-8 w-8 place-items-center rounded-full bg-signal text-xs font-semibold text-white">
            {brand.retailerName.slice(0, 1)}
          </span>
        )}
        <span className="font-semibold">{handle}</span>
      </figcaption>

      <div className="aspect-[4/5] w-full">
        {image ? (
          <img src={image} alt={creative.headline} className="h-full w-full object-cover" />
        ) : (
          <div
            className="flex h-full w-full flex-col justify-between p-6"
            style={{ background: creative.palette.bg, color: creative.palette.fg }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: creative.palette.accent }}>
              {creative.kicker}
            </p>
            <div>
              <p className="font-serif text-3xl leading-tight">{creative.headline}</p>
              <p className="mt-3 text-sm opacity-80">{creative.subhead}</p>
            </div>
            <span
              className="self-start px-4 py-2 text-xs font-semibold"
              style={{ background: creative.palette.accent, color: creative.palette.bg }}
            >
              {creative.cta}
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-4 px-3 pt-3">
        <Heart size={20} />
        <MessageCircle size={20} />
        <Send size={20} />
        <Bookmark size={20} className="ml-auto" />
      </div>
      <p className="px-3 pb-3 pt-2 leading-relaxed">
        <span className="font-semibold">{handle}</span> {creative.caption}
      </p>
    </figure>
  );
}
