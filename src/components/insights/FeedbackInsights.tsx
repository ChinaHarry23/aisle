"use client";

import { extractableInsights, normaliseInsightText, usableInsights } from "@/lib/insights";
import { useAisle } from "@/lib/store";

function areaLabel(area: string | null) {
  return area ? area.replace(/_/g, " ") : "note";
}

/** Tick saved insights to carry into the campaign being created. None start selected. */
export function InsightPicker({
  selectedIds,
  onChange,
}: {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const campaigns = useAisle((s) => s.campaigns);
  const savedInsights = useAisle((s) => s.savedInsights);
  const removeInsight = useAisle((s) => s.removeInsight);
  const insights = usableInsights(savedInsights, campaigns);
  const selected = new Set(selectedIds);

  return (
    <section className="hairline p-4">
      <p className="text-sm font-medium">Reuse saved insights</p>
      <p className="mt-1 text-xs leading-relaxed text-mute">
        Nothing is added on its own. Tick an insight to give it to this campaign. A chicken brief
        does not inherit a mandarin result unless you choose it.
      </p>
      {insights.length === 0 ? (
        <p className="mt-3 text-sm text-ink-soft">
          None saved yet. After a campaign&apos;s results, save the advice you want on its Performance tab.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {insights.map((insight) => {
            const checked = selected.has(insight.id);
            return (
              <li key={insight.id} className="flex items-start gap-3 border border-line bg-surface px-3 py-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={checked}
                  aria-label={`Use insight from ${insight.product}`}
                  onChange={() => {
                    onChange(
                      checked ? selectedIds.filter((id) => id !== insight.id) : [...selectedIds, insight.id],
                    );
                  }}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] uppercase tracking-wider text-mute">
                    {insight.product} · {insight.sourceCampaignName} · {areaLabel(insight.area)}
                  </p>
                  <p className="mt-0.5 text-sm leading-relaxed">{insight.text}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onChange(selectedIds.filter((id) => id !== insight.id));
                    removeInsight(insight.id);
                  }}
                  className="shrink-0 text-xs text-mute hover:text-ink"
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Save an accepted or edited recommendation into the library, one point at a time. */
export function SaveInsightsPanel({ campaignId }: { campaignId: string }) {
  const campaign = useAisle((s) => s.campaigns.find((item) => item.id === campaignId));
  const savedInsights = useAisle((s) => s.savedInsights);
  const saveInsights = useAisle((s) => s.saveInsights);
  if (!campaign?.recommendationDecision || campaign.recommendationDecision.action === "discarded") return null;
  const items = extractableInsights(campaign);
  if (items.length === 0) return null;
  const savedText = new Set(
    savedInsights
      .filter((insight) => insight.sourceCampaignId === campaign.id)
      .map((insight) => normaliseInsightText(insight.text)),
  );
  const pending = items.filter((item) => !savedText.has(normaliseInsightText(item.text)));

  return (
    <div className="mt-4 border-t border-line pt-3">
      <p className="text-sm font-medium">Save for a later campaign</p>
      <ul className="mt-2 flex flex-col gap-2 text-sm">
        {items.map((item) => {
          const saved = savedText.has(normaliseInsightText(item.text));
          return (
            <li key={`${item.area ?? "note"}:${item.text}`}>
              <span className="text-[10px] uppercase tracking-wider text-mute">{areaLabel(item.area)}</span>
              <p className="mt-0.5">{item.text}</p>
              <p className="mt-0.5 text-xs text-mute">{saved ? "In your insight library" : "Not saved yet"}</p>
            </li>
          );
        })}
      </ul>
      {pending.length > 0 ? (
        <button
          type="button"
          onClick={() => saveInsights(campaign.id)}
          className="mt-3 rounded-full border border-line px-4 py-2 text-sm font-medium hover:bg-paper-2"
        >
          Save {pending.length === 1 ? "this insight" : `these ${pending.length} insights`}
        </button>
      ) : (
        <p className="mt-2 text-xs text-mute">
          Saved. They stay in the library until you tick them on a new campaign.
        </p>
      )}
    </div>
  );
}
