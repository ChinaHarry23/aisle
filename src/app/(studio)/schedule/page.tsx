"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { ChannelIcon } from "@/components/ChannelIcon";
import { Empty, PageHeader, StatusBadge } from "@/components/ui";
import { approvalsHref } from "@/lib/approvals/queue";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/ids";
import { channelLabel } from "@/lib/status";
import { useActiveCampaigns } from "@/lib/store";
import type { ScheduleItem } from "@/lib/types";

function slotTone(status: ScheduleItem["status"]) {
  if (status === "published") return "risk-low";
  if (status === "failed") return "risk-high";
  return "status-run";
}

export default function SchedulePage() {
  const campaigns = useActiveCampaigns();
  const stack = useMemo(() => {
    return campaigns
      .map((campaign) => ({
        campaign,
        slots: [...campaign.schedule].sort((a, b) => a.at.localeCompare(b.at)),
      }))
      .filter((row) => row.slots.length > 0)
      .sort(
        (a, b) =>
          a.slots[0].at.localeCompare(b.slots[0].at) || a.campaign.name.localeCompare(b.campaign.name),
      );
  }, [campaigns]);
  const times = useMemo(
    () =>
      stack
        .flatMap((row, campaignIndex) =>
          row.slots.map((slot) => ({ slot, campaign: row.campaign, campaignIndex })),
        )
        .sort((a, b) => a.slot.at.localeCompare(b.slot.at) || a.campaign.name.localeCompare(b.campaign.name)),
    [stack],
  );
  const conflicts = campaigns.flatMap((campaign) =>
    campaign.scheduleConflicts
      .filter((conflict) => !conflict.resolved)
      .map((conflict) => ({ campaign, conflict })),
  );
  const [index, setIndex] = useState(0);
  const count = stack.length;
  const current = count === 0 ? 0 : Math.min(index, count - 1);
  const front = stack[current];

  function step(delta: number) {
    if (count < 2) return;
    setIndex((value) => (Math.min(value, count - 1) + delta + count) % count);
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Schedule"
        title="Publishing times"
        description="Every campaign that has a posting time, in one stack. Move through the campaigns, or pick a time from the full list."
      />

      {conflicts.length > 0 ? (
        <section className="flex flex-col gap-3" aria-label="Scheduling conflicts">
          <h2 className="text-sm font-medium text-ink-soft">
            {conflicts.length} {conflicts.length === 1 ? "time needs" : "times need"} a decision
          </h2>
          <ul className="flex flex-col gap-2">
            {conflicts.map(({ campaign, conflict }) => (
              <li key={conflict.id} className="hairline p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="status-chip status-wait">{conflict.kind.replace(/_/g, " ")}</span>
                  <Link href={`/campaigns/${campaign.id}?tab=channels`} className="font-medium hover:text-signal">
                    {campaign.name}
                  </Link>
                  <span className="text-xs text-mute">{channelLabel[conflict.channel]}</span>
                </div>
                <p className="mt-1 text-ink-soft">{conflict.detail}</p>
                <Link
                  href={approvalsHref("channels")}
                  className="mt-2 inline-block rounded-full border border-line px-3 py-1.5 text-xs font-medium hover:border-signal hover:bg-signal-soft hover:text-signal"
                >
                  Decide in Approvals
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {count === 0 ? (
        <Empty title="Nothing scheduled" body="Approve a campaign and its posting times will gather here." />
      ) : front ? (
        <>
          <section className="flex flex-col gap-4" aria-label="Campaign stack">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-ink-soft">
                Campaign <span className="tabular-nums text-ink">{current + 1}</span> of{" "}
                <span className="tabular-nums">{count}</span>
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  aria-label="Previous campaign"
                  disabled={count < 2}
                  onClick={() => step(-1)}
                  className="grid h-9 w-9 place-items-center rounded-full border border-line hover:bg-paper-2 disabled:opacity-40"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  type="button"
                  aria-label="Next campaign"
                  disabled={count < 2}
                  onClick={() => step(1)}
                  className="grid h-9 w-9 place-items-center rounded-full border border-line hover:bg-paper-2 disabled:opacity-40"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>

            <div className="relative">
              {count > 2 ? <div className="absolute inset-x-8 top-0 h-full rounded-[18px] border border-line bg-paper-2" /> : null}
              {count > 1 ? <div className="absolute inset-x-4 top-2 h-full rounded-[18px] border border-line bg-surface" /> : null}
              <article className="hairline relative p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-serif text-2xl tracking-tight">{front.campaign.name}</h2>
                    <p className="mt-1 text-sm text-ink-soft">
                      {front.campaign.startDate} – {front.campaign.endDate} · {front.slots.length}{" "}
                      {front.slots.length === 1 ? "posting time" : "posting times"}
                    </p>
                  </div>
                  <StatusBadge status={front.campaign.status} />
                </div>
                <ul className="mt-5 flex flex-col gap-3">
                  {front.slots.map((slot) => (
                    <li key={slot.id} className="flex items-start gap-3 border-t border-line pt-3 first:border-0 first:pt-0">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-signal/10 text-signal">
                        <ChannelIcon channel={slot.channel} size={18} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] uppercase tracking-wider text-mute">{channelLabel[slot.channel]}</p>
                        <p className="font-serif text-xl">{formatDate(slot.at, true)}</p>
                        {slot.note ? <p className="text-sm text-ink-soft">{slot.note}</p> : null}
                      </div>
                      <span className={cn("status-chip", slotTone(slot.status))}>{slot.status}</span>
                    </li>
                  ))}
                </ul>
                <Link href={`/campaigns/${front.campaign.id}?tab=channels`} className="mt-5 inline-block text-sm text-signal">
                  Open this campaign
                </Link>
              </article>
            </div>

            <ol className="flex flex-wrap gap-2" aria-label="Campaign index">
              {stack.map((row, itemIndex) => (
                <li key={row.campaign.id}>
                  <button
                    type="button"
                    aria-current={itemIndex === current ? "true" : undefined}
                    onClick={() => setIndex(itemIndex)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm",
                      itemIndex === current
                        ? "border-signal bg-signal text-white"
                        : "border-line bg-surface text-ink-soft hover:text-ink",
                    )}
                  >
                    <span className="mr-1.5 tabular-nums">{itemIndex + 1}</span>
                    {row.campaign.name}
                  </button>
                </li>
              ))}
            </ol>
          </section>

          <section className="flex flex-col gap-3" aria-label="All publishing times">
            <h2 className="font-serif text-xl">All publishing times</h2>
            <p className="text-sm text-ink-soft">
              {times.length} {times.length === 1 ? "time" : "times"} across {count}{" "}
              {count === 1 ? "campaign" : "campaigns"}. Choose one to bring that campaign to the front.
            </p>
            <ul className="flex flex-col gap-2">
              {times.map(({ slot, campaign, campaignIndex }) => (
                <li key={slot.id}>
                  <button
                    type="button"
                    onClick={() => setIndex(campaignIndex)}
                    aria-current={campaignIndex === current ? "true" : undefined}
                    className={cn(
                      "hairline flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left",
                      campaignIndex === current && "border-signal",
                    )}
                  >
                    <div>
                      <p className="text-xs uppercase tracking-wider text-mute">{formatDate(slot.at, true)}</p>
                      <p className="font-medium">{campaign.name}</p>
                      <p className="text-sm text-ink-soft">
                        {channelLabel[slot.channel]}
                        {slot.note ? ` · ${slot.note}` : ""}
                      </p>
                    </div>
                    <span className={cn("status-chip", slotTone(slot.status))}>{slot.status}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
    </div>
  );
}
