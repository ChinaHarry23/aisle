"use client";

import Link from "next/link";
import { Empty, StatusBadge } from "@/components/ui";
import { channelLabel } from "@/lib/status";
import { formatDate } from "@/lib/ids";
import { useAisle } from "@/lib/store";

export default function SchedulePage() {
  const campaigns = useAisle((s) => s.campaigns);
  const items = campaigns
    .flatMap((c) => c.schedule.map((s) => ({ ...s, campaign: c.name, campaignId: c.id, cStatus: c.status })))
    .sort((a, b) => a.at.localeCompare(b.at));

  return (
    <div className="flex flex-col gap-8">
      <header>
        <p className="text-[11px] uppercase tracking-[0.2em] text-signal">Intelligent scheduling</p>
        <h1 className="font-serif text-4xl">The week on channels.</h1>
        <p className="mt-2 max-w-xl text-sm text-ink-soft">
          Media Manager places approved work using campaign dates, audience behaviour, and prior
          engagement. Conflicting volume is the founder&apos;s problem only when the calendar piles up.
        </p>
      </header>

      {items.length === 0 ? (
        <Empty title="Nothing scheduled" body="Approve a campaign and Media Manager will fill this." />
      ) : (
        <ul className="divide-y divide-line border-y border-line bg-surface">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div>
                <p className="text-xs uppercase tracking-wider text-mute">{formatDate(item.at, true)}</p>
                <Link href={`/campaigns/${item.campaignId}`} className="font-serif text-xl hover:text-signal">
                  {item.campaign}
                </Link>
                <p className="text-sm text-ink-soft">
                  {channelLabel[item.channel]} · {item.note}
                </p>
              </div>
              <StatusBadge status={item.cStatus} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
