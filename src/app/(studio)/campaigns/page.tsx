"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { AgentPipeline, Empty, PageHeader, StatusBadge } from "@/components/ui";
import { isArchived } from "@/lib/campaign-lifecycle";
import { channelLabel } from "@/lib/status";
import { formatDate } from "@/lib/ids";
import { useAisle } from "@/lib/store";

export default function CampaignsPage() {
  const all = useAisle((s) => s.campaigns);
  const archiveCampaign = useAisle((s) => s.archiveCampaign);
  const engineError = useAisle((s) => s.engineError);
  const campaigns = all.filter((campaign) => !isArchived(campaign));
  const trashed = all.length - campaigns.length;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Campaigns"
        title="Your campaigns"
        description="Every campaign keeps its brief, creative, checks and results in one place, and your agents all work from the same page."
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/campaigns/trash"
              className="inline-flex items-center rounded-full border border-line px-4 py-2 text-sm font-medium hover:bg-paper-2"
            >
              Trash{trashed > 0 ? ` (${trashed})` : ""}
            </Link>
            <Link
              href="/campaigns/new"
              className="inline-flex items-center gap-2 rounded-full btn-primary px-4 py-2 text-sm font-medium"
            >
              <Plus size={16} /> New campaign
            </Link>
          </div>
        }
      />

      {engineError ? <p className="text-sm text-signal">{engineError}</p> : null}

      {campaigns.length === 0 ? (
        <Empty
          title="No campaigns on the board"
          body={trashed > 0 ? "Trashed campaigns stay out of this list until you restore or delete them." : "Write a short brief and your agents will do the rest."}
        >
          {trashed > 0 ? (
            <Link href="/campaigns/trash" className="text-sm font-medium text-signal hover:underline">
              Open trash
            </Link>
          ) : (
            <Link href="/campaigns/new" className="text-sm font-medium text-signal hover:underline">
              Create your first campaign
            </Link>
          )}
        </Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {campaigns.map((c) => (
            <li key={c.id} className="hairline hairline-hover p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <Link href={`/campaigns/${c.id}`} className="min-w-0 flex-1">
                  <h2 className="truncate font-medium">{c.name}</h2>
                  <p className="mt-0.5 text-sm text-ink-soft">
                    {c.product} · {c.country} · {c.channels.map((ch) => channelLabel[ch]).join(", ")}
                  </p>
                </Link>
                <div className="flex items-center gap-2">
                  {c.running ? <span className="text-xs font-medium text-signal">Agents live</span> : null}
                  <StatusBadge status={c.status} />
                  <button
                    type="button"
                    onClick={() => void archiveCampaign(c.id)}
                    className="rounded-full border border-line px-3 py-1.5 text-xs font-medium hover:bg-paper-2"
                  >
                    Trash
                  </button>
                </div>
              </div>
              <Link href={`/campaigns/${c.id}`} className="mt-4 block">
                <AgentPipeline status={c.status} />
                <p className="mt-3 text-xs text-mute">Updated {formatDate(c.updatedAt, true)}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
