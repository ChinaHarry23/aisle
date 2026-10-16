"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { AgentPipeline, Empty, StatusBadge } from "@/components/ui";
import { channelLabel } from "@/lib/status";
import { formatDate, formatMoney } from "@/lib/ids";
import { useAisle } from "@/lib/store";

export default function CampaignsPage() {
  const campaigns = useAisle((s) => s.campaigns);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-signal">Campaign management</p>
          <h1 className="font-serif text-4xl">The board</h1>
          <p className="mt-2 max-w-xl text-sm text-ink-soft">
            Each campaign is a shared context, not a folder of chatbots. Agents pick up the same
            brief, pass structured work, and write back to this row.
          </p>
        </div>
        <Link
          href="/campaigns/new"
          className="inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-sm text-paper"
        >
          <Plus size={14} /> New campaign
        </Link>
      </header>

      {campaigns.length === 0 ? (
        <Empty title="No campaigns yet" body="Create a brief and the agent bench will take the rest.">
          <Link href="/campaigns/new" className="text-sm text-signal">
            Create campaign
          </Link>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {campaigns.map((c) => (
            <li key={c.id}>
              <Link href={`/campaigns/${c.id}`} className="hairline block bg-surface p-5 hover:bg-surface">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-serif text-2xl">{c.name}</h2>
                    <p className="mt-1 text-sm text-ink-soft">
                      {c.product} · {formatMoney(c.budget)} · {c.country} ·{" "}
                      {c.channels.map((ch) => channelLabel[ch]).join(", ")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {c.running ? (
                      <span className="text-[11px] uppercase tracking-wider text-signal">Agents live</span>
                    ) : null}
                    <StatusBadge status={c.status} />
                  </div>
                </div>
                <div className="mt-5">
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
