"use client";

import { CreativeStudio } from "@/components/studio/CreativeStudio";
import { Empty } from "@/components/ui";
import { useAisle } from "@/lib/store";
import Link from "next/link";
import { useMemo, useState } from "react";

export default function StudioPage() {
  const campaigns = useAisle((s) => s.campaigns);
  const initial = campaigns[0]?.id ?? "";
  const [id, setId] = useState(initial);
  const selected = useMemo(
    () => campaigns.find((c) => c.id === id) ?? campaigns[0],
    [campaigns, id],
  );

  if (!selected) {
    return (
      <Empty
        title="No campaign to design"
        body="Create a campaign first, then open the studio to try image and video models."
      >
        <Link href="/campaigns/new" className="text-sm text-signal">
          New campaign
        </Link>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-signal">Creative studio</p>
          <h1 className="font-serif text-4xl">Make the stills and the spots.</h1>
        </div>
        <label className="text-[11px] uppercase tracking-wider text-mute">
          Campaign
          <select
            value={selected.id}
            onChange={(e) => setId(e.target.value)}
            className="mt-1 block min-w-[240px] border border-line bg-surface px-3 py-2 text-sm text-ink"
          >
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <CreativeStudio campaign={selected} />
    </div>
  );
}
