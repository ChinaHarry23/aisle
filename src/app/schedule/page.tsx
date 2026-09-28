"use client";

import Link from "next/link";
import { Empty, StatusBadge } from "@/components/ui";
import { channelLabel } from "@/lib/status";
import { formatDate } from "@/lib/ids";
import { useAisle } from "@/lib/store";

export default function SchedulePage() {
  const campaigns = useAisle((s) => s.campaigns);
  const resolveConflict = useAisle((s) => s.resolveConflict);
  const items = campaigns
    .flatMap((c) => c.schedule.map((s) => ({ ...s, campaign: c.name, campaignId: c.id, cStatus: c.status })))
    .sort((a, b) => a.at.localeCompare(b.at));

  /* A conflict is a founder decision, not an automatic repair (AHR-05). */
  const conflicts = campaigns.flatMap((c) =>
    c.scheduleConflicts.map((x) => ({ campaign: c, conflict: x })),
  );
  const unresolved = conflicts.filter((x) => !x.conflict.resolved);

  return (
    <div className="flex flex-col gap-8">
      <header>
        <p className="text-[11px] uppercase tracking-[0.2em] text-signal">Intelligent scheduling</p>
        <h1 className="font-serif text-4xl">The week on channels.</h1>
        <p className="mt-2 max-w-xl text-sm text-ink-soft">
          Media Manager places approved work using campaign dates, audience behaviour, and prior
          engagement. When two campaigns collide on a channel it flags the clash for you instead of
          moving or dropping anything on its own.
        </p>
      </header>

      {conflicts.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-[11px] uppercase tracking-[0.18em] text-signal">
            Conflicts {unresolved.length > 0 ? `— ${unresolved.length} awaiting you` : "— all resolved"}
          </h2>
          <ul className="flex flex-col gap-2">
            {conflicts.map(({ campaign, conflict }) => (
              <li key={conflict.id} className="hairline bg-surface p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={
                      conflict.resolved ? "status-chip risk-low" : "status-chip status-wait"
                    }
                  >
                    {conflict.resolved ? "resolved" : conflict.kind.replace(/_/g, " ")}
                  </span>
                  <Link href={`/campaigns/${campaign.id}`} className="font-medium hover:text-signal">
                    {campaign.name}
                  </Link>
                  <span className="text-xs text-mute">{channelLabel[conflict.channel]}</span>
                </div>
                <p className="mt-1 text-ink-soft">{conflict.detail}</p>
                {!conflict.resolved ? (
                  <button
                    type="button"
                    onClick={() =>
                      void resolveConflict(campaign.id, conflict.id, "Accepted by the founder.")
                    }
                    className="mt-2 rounded-full border border-ink px-3 py-1 text-xs"
                  >
                    Accept and continue
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

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
