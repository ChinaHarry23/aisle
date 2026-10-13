"use client";

import Link from "next/link";
import type { Campaign } from "@/lib/types";

/** The images generated for a campaign, and nothing else. Generating happens on the Content Generation page. */
export function CampaignContent({ campaign }: { campaign: Campaign }) {
  const images = campaign.creatives.flatMap((cr) =>
    cr.generation?.url ? [{ id: cr.id, url: cr.generation.url, label: `${cr.headline} (${cr.variant})` }] : [],
  );

  if (images.length === 0) {
    return (
      <p className="text-sm text-ink-soft">
        No image has been generated for this campaign yet.{" "}
        <Link href="/studio" className="text-signal hover:underline">
          Open Content Generation
        </Link>
      </p>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {images.map((img) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={img.id} src={img.url} alt={img.label} className="w-full border border-line object-cover" />
      ))}
    </div>
  );
}
