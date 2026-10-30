"use client";

import Link from "next/link";
import { useState } from "react";
import { Empty, PageHeader, StatusBadge } from "@/components/ui";
import { isArchived } from "@/lib/campaign-lifecycle";
import { formatDate } from "@/lib/ids";
import { useAisle } from "@/lib/store";

export default function TrashPage() {
  const campaigns = useAisle((s) => s.campaigns).filter((campaign) => isArchived(campaign));
  const restoreCampaign = useAisle((s) => s.restoreCampaign);
  const deleteCampaign = useAisle((s) => s.deleteCampaign);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Campaigns"
        title="Trash"
        description="Campaigns here are off the board and the agents leave them alone. Restore one to keep working, or delete it for good."
        actions={
          <Link
            href="/campaigns"
            className="inline-flex items-center rounded-full border border-line px-4 py-2 text-sm font-medium hover:bg-paper-2"
          >
            Back to campaigns
          </Link>
        }
      />

      {campaigns.length === 0 ? (
        <Empty title="Trash is empty" body="Move a campaign here when you are done with it. It will not keep stacking on the board.">
          <Link href="/campaigns" className="text-sm font-medium text-signal hover:underline">
            Back to campaigns
          </Link>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {campaigns.map((campaign) => (
            <li key={campaign.id} className="hairline flex flex-wrap items-center justify-between gap-3 p-4">
              <Link href={`/campaigns/${campaign.id}`} className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate font-medium">{campaign.name}</h2>
                  <StatusBadge status={campaign.status} />
                </div>
                <p className="mt-0.5 text-sm text-ink-soft">
                  {campaign.product} · moved {formatDate(campaign.archivedAt ?? campaign.updatedAt, true)}
                </p>
              </Link>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => restoreCampaign(campaign.id)}
                  className="rounded-full border border-line px-3 py-1.5 text-xs font-medium hover:bg-paper-2"
                >
                  Restore
                </button>
                {confirmId === campaign.id ? (
                  <button
                    type="button"
                    onClick={() => {
                      deleteCampaign(campaign.id);
                      setConfirmId(null);
                    }}
                    className="rounded-full border border-signal px-3 py-1.5 text-xs font-medium text-signal hover:bg-paper-2"
                  >
                    Delete forever
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmId(campaign.id)}
                    className="rounded-full border border-line px-3 py-1.5 text-xs font-medium hover:bg-paper-2"
                  >
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
