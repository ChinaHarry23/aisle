"use client";

import Link from "next/link";
import { CreativeStudio } from "@/components/studio/CreativeStudio";
import { PageHeader } from "@/components/ui";
import { useAisle } from "@/lib/store";
import { useMemo, useState } from "react";

export default function StudioPage() {
  const campaigns = useAisle((s) => s.campaigns);
  const initial = campaigns[0]?.id ?? "";
  const [id, setId] = useState(initial);
  const selected = useMemo(
    () => campaigns.find((c) => c.id === id) ?? campaigns[0],
    [campaigns, id],
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Content generation"
        title="Create your ads"
        actions={
          selected ? (
          <label className="text-xs text-mute">
            Campaign
            <select
              value={selected?.id}
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
          ) : null
        }
      />
      <p className="text-sm text-ink-soft">
        Finished posters stay on this account.{" "}
        <Link href="/library" className="text-signal hover:underline">
          Open the library
        </Link>
        .
      </p>
      <CreativeStudio campaign={selected} />
    </div>
  );
}
