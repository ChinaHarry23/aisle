"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { AgentPipeline, Empty, PageHeader, StatusBadge } from "@/components/ui";
import { channelLabel } from "@/lib/status";
import { formatDate } from "@/lib/ids";
import { useAisle } from "@/lib/store";

export default function CampaignsPage() {
  const campaigns = useAisle((s) => s.campaigns);
  const engineError = useAisle((s) => s.engineError);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Campaigns"
        title="Your campaigns"
        description="Every campaign keeps its brief, creative, checks and results in one place, and your agents all work from the same page."
        actions={
          <Link
            href="/campaigns/new"
            className="inline-flex items-center gap-2 rounded-full btn-primary px-4 py-2 text-sm font-medium"
          >
            <Plus size={16} /> New campaign
          </Link>
        }
      />

      {engineError ? <p className="text-sm text-signal">{engineError}</p> : null}

      {campaigns.length === 0 ? (
        <Empty title="No campaigns yet" body="Write a short brief and your agents will do the rest.">
          <Link href="/campaigns/new" className="text-sm font-medium text-signal hover:underline">
            Create your first campaign
          </Link>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {campaigns.map((c) => (
            <li key={c.id}>
              <Link href={`/campaigns/${c.id}`} className="hairline hairline-hover block p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="truncate font-medium">{c.name}</h2>
                    <p className="mt-0.5 text-sm text-ink-soft">
                      {c.product} · {c.country} ·{" "}
                      {c.channels.map((ch) => channelLabel[ch]).join(", ")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {c.running ? (
                      <span className="text-xs font-medium text-signal">Agents live</span>
                    ) : null}
                    <StatusBadge status={c.status} />
                  </div>
                </div>
                <div className="mt-4">
                  <AgentPipeline status={c.status} />
                </div>
                <p className="mt-3 text-xs text-mute">Updated {formatDate(c.updatedAt, true)}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
