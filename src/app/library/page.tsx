"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/ui";
import { cn } from "@/lib/cn";

type Review = "approved" | "rejected" | "sent_back" | "needs_review" | "earlier" | "unlinked";

type Asset = {
  id: string;
  kind: "image" | "video";
  campaignId: string | null;
  campaignName: string | null;
  product: string | null;
  label: string;
  modelName: string | null;
  createdAt: string;
  costUsd: number | null;
  costEstimated: boolean | null;
  inputTokens: number | null;
  outputTokens: number | null;
  review: Review;
  reasons: string[];
};

const FILTERS: { id: Review | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "needs_review", label: "Needs your review" },
  { id: "sent_back", label: "Sent back" },
  { id: "rejected", label: "Rejected" },
  { id: "approved", label: "Approved" },
  { id: "earlier", label: "Earlier versions" },
  { id: "unlinked", label: "Not on a campaign" },
];

const REVIEW_LABEL: Record<Review, string> = {
  approved: "Approved",
  rejected: "Rejected",
  sent_back: "Sent back",
  needs_review: "Needs your review",
  earlier: "Earlier version",
  unlinked: "Not on a campaign",
};

function when(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

function money(value: number) {
  return `$${value.toFixed(3)}`;
}

function costLine(asset: Asset) {
  if (asset.costUsd == null) return "Cost not on the provider bill";
  if (asset.costEstimated) return `${money(asset.costUsd)} estimated — the provider sent no usage`;
  const tokens = [asset.inputTokens, asset.outputTokens].filter((n) => n != null).join(" + ");
  return `${money(asset.costUsd)} from provider usage${tokens ? ` (${tokens} tokens)` : ""}`;
}

export default function LibraryPage() {
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Review | "all">("all");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [shown, setShown] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/library")
      .then(async (response) => {
        const body = (await response.json()) as { assets?: Asset[]; error?: string };
        if (!response.ok) throw new Error(body.error || "The library could not be read.");
        return body.assets ?? [];
      })
      .then((next) => {
        if (!cancelled) setAssets(next);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "The library could not be read.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = useMemo(() => {
    const tally = { all: assets?.length ?? 0 } as Record<string, number>;
    for (const asset of assets ?? []) tally[asset.review] = (tally[asset.review] ?? 0) + 1;
    return tally;
  }, [assets]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (assets ?? []).filter((asset) => {
      if (filter !== "all" && asset.review !== filter) return false;
      if (!needle) return true;
      const haystack = [asset.label, asset.product, asset.campaignName, asset.modelName, ...asset.reasons]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [assets, filter, query]);

  const groups = useMemo(() => {
    const map = new Map<string, { id: string; title: string; product: string | null; assets: Asset[] }>();
    for (const asset of filtered) {
      const id = asset.campaignId ?? "loose";
      const group = map.get(id) ?? {
        id,
        title: asset.campaignName || asset.product || "Not on a campaign",
        product: asset.product,
        assets: [],
      };
      group.assets.push(asset);
      map.set(id, group);
    }
    return [...map.values()];
  }, [filtered]);

  const billed = (assets ?? []).filter((asset) => asset.costUsd != null && asset.costEstimated === false);
  const estimated = (assets ?? []).filter((asset) => asset.costUsd != null && asset.costEstimated !== false);
  const billedTotal = billed.reduce((sum, asset) => sum + (asset.costUsd ?? 0), 0);
  const estimatedTotal = estimated.reduce((sum, asset) => sum + (asset.costUsd ?? 0), 0);

  async function remove(id: string) {
    setRemoving(id);
    setError(null);
    try {
      const response = await fetch(`/api/library/${encodeURIComponent(id)}`, { method: "DELETE" });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error || "That image could not be removed.");
      setAssets((current) => (current ?? []).filter((asset) => asset.id !== id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That image could not be removed.");
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Your account"
        title="Library"
        description="Grouped by campaign. Each poster keeps whether it was approved, sent back, or rejected, and what the image provider billed for that call."
      />
      {assets && assets.length > 0 ? (
        <p className="text-sm text-ink-soft">
          {assets.length} saved. Provider usage {money(billedTotal)}
          {estimatedTotal > 0 ? ` · ${money(estimatedTotal)} still an estimate` : ""}.
        </p>
      ) : null}
      <div className="flex flex-col gap-3">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search product, headline, or rejection reason"
          className="w-full border border-line bg-surface px-3 py-2.5 text-[15px] outline-none focus:border-signal"
        />
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setFilter(item.id)}
              className={cn(
                "border px-3 py-1.5 text-sm",
                filter === item.id ? "border-signal bg-signal/10 font-medium text-signal-dark" : "border-line bg-surface text-ink-soft",
              )}
            >
              {item.label}
              <span className="ml-1.5 text-xs text-mute">{counts[item.id] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>
      {error ? <p className="text-sm text-signal">{error}</p> : null}
      {assets == null && !error ? <p className="text-sm text-mute">Loading your images…</p> : null}
      {assets?.length === 0 ? (
        <p className="text-sm text-ink-soft">Nothing saved yet. Generate a poster from a campaign and it will stay here.</p>
      ) : null}
      {assets && assets.length > 0 && groups.length === 0 ? (
        <p className="text-sm text-ink-soft">Nothing matches that search.</p>
      ) : null}
      {groups.map((group) => {
        const expanded = open[group.id] ?? group.assets.length <= 8;
        const limit = shown[group.id] ?? 12;
        const visible = expanded ? group.assets.slice(0, limit) : [];
        const cost = group.assets.reduce((sum, asset) => sum + (asset.costUsd ?? 0), 0);
        return (
          <section key={group.id} className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => setOpen((current) => ({ ...current, [group.id]: !expanded }))}
              className="flex flex-wrap items-baseline justify-between gap-2 text-left"
            >
              <span>
                <span className="font-serif text-xl">{group.title}</span>
                {group.product && group.product !== group.title ? (
                  <span className="ml-2 text-sm text-mute">{group.product}</span>
                ) : null}
              </span>
              <span className="text-xs text-mute">
                {group.assets.length} · {cost > 0 ? money(cost) : "no bill yet"} · {expanded ? "Hide" : "Show"}
              </span>
            </button>
            {expanded ? (
              <>
                <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {visible.map((asset) => (
                    <li key={asset.id} className="hairline flex flex-col">
                      {asset.kind === "video" ? (
                        <video src={`/api/library/${encodeURIComponent(asset.id)}`} controls className="w-full bg-paper-2" />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`/api/library/${encodeURIComponent(asset.id)}`}
                          alt={asset.label}
                          loading="lazy"
                          className="aspect-[4/5] w-full object-cover"
                        />
                      )}
                      <div className="flex flex-1 flex-col gap-2 p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={cn(
                              "status-chip",
                              asset.review === "rejected" || asset.review === "sent_back" ? "risk-high" : asset.review === "needs_review" ? "risk-mid" : "risk-low",
                            )}
                          >
                            {REVIEW_LABEL[asset.review]}
                          </span>
                        </div>
                        <p className="font-medium leading-snug">{asset.label}</p>
                        {asset.reasons.length > 0 ? (
                          <ul className="text-xs leading-relaxed text-ink-soft">
                            {asset.reasons.slice(0, 2).map((reason) => (
                              <li key={reason}>{reason}</li>
                            ))}
                            {asset.reasons.length > 2 ? <li>{asset.reasons.length - 2} more reasons</li> : null}
                          </ul>
                        ) : null}
                        <p className="text-xs text-mute">
                          {when(asset.createdAt)}
                          {asset.modelName ? ` · ${asset.modelName}` : ""}
                        </p>
                        <p className="text-xs text-ink-soft">{costLine(asset)}</p>
                        <div className="mt-auto flex items-center justify-between gap-3 pt-1">
                          {asset.campaignId ? (
                            <Link href={`/campaigns/${asset.campaignId}`} className="text-xs text-signal hover:underline">
                              Open campaign
                            </Link>
                          ) : (
                            <span className="text-xs text-mute">Kept on this account</span>
                          )}
                          <button
                            type="button"
                            disabled={removing === asset.id}
                            onClick={() => void remove(asset.id)}
                            className="text-xs text-mute hover:text-ink disabled:opacity-50"
                          >
                            {removing === asset.id ? "Removing…" : "Remove"}
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                {group.assets.length > visible.length ? (
                  <button
                    type="button"
                    onClick={() => setShown((current) => ({ ...current, [group.id]: limit + 24 }))}
                    className="self-start text-sm text-signal hover:underline"
                  >
                    Show {Math.min(24, group.assets.length - visible.length)} more in this campaign
                  </button>
                ) : null}
              </>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
