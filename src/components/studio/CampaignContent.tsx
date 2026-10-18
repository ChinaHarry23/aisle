"use client";

import { campaignMediaUrl } from "@/lib/media/url";
import type { Campaign } from "@/lib/types";

/** Pictures produced by the campaign's image step. */
export function CampaignContent({ campaign }: { campaign: Campaign }) {
  const images = campaign.creatives.flatMap((cr) => {
    const src = campaignMediaUrl(campaign.id, cr.id, cr.generation);
    return src ? [{ id: cr.id, src, label: `${cr.headline} (${cr.variant})` }] : [];
  });

  if (images.length > 0) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {images.map((img) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={img.id} src={img.src} alt={img.label} className="w-full border border-line object-cover" />
        ))}
      </div>
    );
  }

  const note = campaign.creatives.find((cr) => cr.generation)?.generation?.note;
  if (note) {
    return (
      <p className="text-sm text-ink-soft">
        The image step ran. {note}
      </p>
    );
  }

  if (campaign.status === "generating" || campaign.run?.step === "creative.receive") {
    return <p className="text-sm text-ink-soft">Image generation is running for this campaign.</p>;
  }

  return (
    <p className="text-sm text-ink-soft">
      No image yet. Launch the agents and the image step renders the posters, using a product photo when you uploaded one.
    </p>
  );
}
