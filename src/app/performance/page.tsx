"use client";

import { formatNumber } from "@/lib/ids";
import { channelLabel } from "@/lib/status";
import { useAisle } from "@/lib/store";
import { SectionTitle, Stat } from "@/components/ui";
import Link from "next/link";

export default function PerformancePage() {
  const campaigns = useAisle((s) => s.campaigns);
  const published = campaigns.filter((c) => c.performance);
  const totals = published.reduce(
    (acc, c) => {
      const p = c.performance!;
      acc.impressions += p.impressions;
      acc.clicks += p.clicks;
      acc.conversions += p.conversions;
      return acc;
    },
    { impressions: 0, clicks: 0, conversions: 0 },
  );
  const ctr = totals.impressions ? (totals.clicks / totals.impressions) * 100 : 0;

  return (
    <div className="flex flex-col gap-8">
      <header>
        <p className="text-[11px] uppercase tracking-[0.2em] text-signal">Feedback loop</p>
        <h1 className="font-serif text-4xl">What ran. What to do next.</h1>
        <p className="mt-2 max-w-xl text-sm text-ink-soft">
          Media Manager collects results. Trend Analyser reads them before the next brief. That is
          the difference between four chatbots and a company.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <Stat label="Impressions" value={formatNumber(totals.impressions)} />
        <Stat label="Blended CTR" value={`${ctr.toFixed(1)}%`} />
        <Stat label="Conversions" value={formatNumber(totals.conversions)} />
      </section>

      {published.map((c) => {
        const p = c.performance!;
        const maxImp = Math.max(...Object.values(p.byChannel).map((x) => x.impressions), 1);
        return (
          <article key={c.id} className="hairline bg-surface p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Link href={`/campaigns/${c.id}`} className="font-serif text-2xl hover:text-signal">
                  {c.name}
                </Link>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-soft">{p.summary}</p>
              </div>
              <p className="text-sm tabular-nums text-mute">
                {formatNumber(p.impressions)} imp · {p.ctr}% CTR
              </p>
            </div>
            <ul className="mt-5 flex flex-col gap-2">
              {Object.entries(p.byChannel).map(([ch, row]) => (
                <li key={ch}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span>{channelLabel[ch as keyof typeof channelLabel] ?? ch}</span>
                    <span className="tabular-nums text-mute">
                      {formatNumber(row.impressions)} · {row.ctr}% CTR
                    </span>
                  </div>
                  <div className="h-1.5 bg-paper-2">
                    <div
                      className="h-1.5 bg-ink"
                      style={{ width: `${(row.impressions / maxImp) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-5 border-t border-line pt-4">
              <SectionTitle kicker="Returned to Trend Analyser" title="Next-cycle recommendation" />
              <p className="mt-3 text-sm leading-relaxed">{p.recommendation}</p>
            </div>
          </article>
        );
      })}
    </div>
  );
}
