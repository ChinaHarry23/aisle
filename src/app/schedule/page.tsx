"use client";

import { useState, type ComponentType } from "react";
import { FaFacebook, FaInstagram, FaLinkedin } from "react-icons/fa6";
import { Globe, Image, LayoutTemplate, MessageSquare, PanelTop, Plus } from "lucide-react";
import Link from "next/link";
import { Empty, PageHeader, StatusBadge } from "@/components/ui";
import { channelLabel } from "@/lib/status";
import { formatDate } from "@/lib/ids";
import { isArchived } from "@/lib/campaign-lifecycle";
import { useAisle } from "@/lib/store";

const SOCIALS: { name: string; icon: ComponentType<{ size?: number }>; tile: string }[] = [
  {
    name: "Instagram",
    icon: FaInstagram,
    tile: "bg-[linear-gradient(45deg,#f9a03f_0%,#e1306c_50%,#833ab4_100%)] text-white",
  },
  { name: "Facebook", icon: FaFacebook, tile: "bg-[#1877f2] text-white" },
  { name: "LinkedIn", icon: FaLinkedin, tile: "bg-[#0a66c2] text-white" },
];
const WEBSITE_ACTIONS: { label: string; icon: ComponentType<{ size?: number; className?: string }> }[] = [
  { label: "Generate hero banner", icon: Image },
  { label: "Generate landing page section", icon: LayoutTemplate },
  { label: "Generate announcement bar", icon: PanelTop },
  { label: "Generate promo popup", icon: MessageSquare },
];

export default function SchedulePage() {
  const [notice, setNotice] = useState<string | null>(null);
  const campaigns = useAisle((s) => s.campaigns).filter((campaign) => !isArchived(campaign));
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
      <PageHeader
        eyebrow="Schedule"
        title="Your week, channel by channel"
        description="Approved campaigns are placed on the days and channels that suit your audience best. If two campaigns land on the same channel at once, we flag it for you rather than moving anything on our own."
      />

      {/* Mock only: none of these buttons are wired up yet. */}
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="hairline flex flex-col gap-3 p-4">
          <h2 className="font-serif text-lg">Connect channels</h2>
          <ul className="flex flex-col gap-2">
            {SOCIALS.map(({ name, icon: Icon, tile }) => (
              <li
                key={name}
                className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5"
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tile}`}
                >
                  <Icon size={18} />
                </span>
                <span className="flex-1 text-sm font-medium">{name}</span>
                <button
                  type="button"
                  onClick={() => setNotice(`Connecting ${name} isn't available yet.`)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-medium hover:border-signal hover:bg-signal-soft hover:text-signal"
                >
                  <Plus size={13} /> Connect
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="hairline flex flex-col gap-3 p-4">
          <h2 className="flex items-center gap-2 font-serif text-lg">
            <Globe size={16} className="text-signal" /> Website
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {WEBSITE_ACTIONS.map(({ label, icon: Icon }) => (
              <button
                key={label}
                type="button"
                onClick={() => setNotice(`"${label}" isn't available yet.`)}
                className="inline-flex items-center gap-2 rounded-xl border border-line px-3 py-2.5 text-left text-sm font-medium hover:border-signal hover:bg-signal-soft hover:text-signal"
              >
                <Icon size={15} className="shrink-0" />
                {label}
              </button>
            ))}
          </div>
        </div>
        {notice ? (
          <p role="status" className="text-xs text-mute lg:col-span-2">
            {notice} This is a preview of what&rsquo;s coming.
          </p>
        ) : null}
      </section>

      {conflicts.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-signal">
            Conflicts {unresolved.length > 0 ? `— ${unresolved.length} awaiting you` : "— all resolved"}
          </h2>
          <ul className="flex flex-col gap-2">
            {conflicts.map(({ campaign, conflict }) => (
              <li key={conflict.id} className="hairline p-4 text-sm">
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
                    className="mt-2 rounded-full border border-line px-3 py-1.5 text-xs font-medium hover:border-signal hover:bg-signal-soft hover:text-signal"
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
        <Empty title="Nothing scheduled" body="Approve a campaign and its posts will show up here." />
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.id} className="hairline flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="text-xs uppercase tracking-wider text-mute">{formatDate(item.at, true)}</p>
                <Link href={`/campaigns/${item.campaignId}`} className="font-medium hover:text-signal">
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
