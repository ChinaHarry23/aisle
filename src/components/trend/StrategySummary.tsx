"use client";

import { useState, type FormEvent } from "react";
import type { Campaign } from "@/lib/types";
import { RankingReview } from "./RankingReview";
import { currentStrategy } from "@/lib/trend/strategy";
import { creativeDirectionText } from "@/lib/media/prompts";
import { useAisle } from "@/lib/store";

const channelNames: Record<string, string> = { instagram: "Instagram", web: "Website", email: "Email", print: "Print", digital_signage: "Digital signage" };

function StrategyRefinement({ campaign }: { campaign: Campaign }) {
  const requestChanges = useAisle((state) => state.requestChanges);
  const busy = useAisle((state) => state.busy[campaign.id] ?? false);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (campaign.status !== "awaiting_approval") return null;

  async function refine(event: FormEvent) {
    event.preventDefault();
    if (!note.trim() || submitting || busy) return;
    setSubmitting(true);
    setError(null);
    try {
      await requestChanges(campaign.id, note.trim());
      const commandError = useAisle.getState().engineError;
      if (commandError) setError(commandError);
      else setNote("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your changes could not be saved. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(event) => void refine(event)} className="hairline p-5 md:p-7">
      <label className="block">
        <span className="font-serif text-xl">Refine campaign direction</span>
        <span className="mt-2 block text-sm leading-relaxed text-ink-soft">Tell us what to emphasise or change. We will use the saved research to update the direction and creative concepts.</span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          disabled={busy || submitting}
          rows={3}
          maxLength={2000}
          placeholder="Focus on busy parents making a quick lunch. Show an everyday kitchen and make the product the hero."
          className="mt-4 w-full border border-line bg-surface px-3 py-2.5 text-sm outline-none focus:border-signal disabled:opacity-60"
        />
      </label>
      {error ? <p role="alert" className="mt-3 text-sm text-signal">{error}</p> : null}
      <div className="mt-3 flex justify-end"><button type="submit" disabled={!note.trim() || busy || submitting} className="rounded-full bg-signal px-5 py-2 text-sm font-semibold text-white hover:bg-signal-dark disabled:opacity-50">{busy || submitting ? "Updating your campaign…" : "Update campaign direction"}</button></div>
    </form>
  );
}

export function StrategySummary({ campaign }: { campaign: Campaign }) {
  const strategy = currentStrategy(campaign);
  if (!strategy) {
    const working = campaign.running && campaign.run?.step.startsWith("trend.");
    const angle = creativeDirectionText(campaign.brief?.angle);
    const visual = creativeDirectionText(campaign.brief?.visualDirection);
    return (
      <div className="space-y-5"><section className="hairline p-5 md:p-7" aria-label="Campaign direction">
        <p className="text-xs uppercase tracking-wide text-signal">{working ? "Developing your campaign" : "Campaign direction"}</p>
        <h3 className="mt-2 font-serif text-2xl">{working ? "Connecting the research to your next campaign" : angle || "A direction for your campaign"}</h3>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-soft">
          {working
            ? "Exploring your audience, relevant market activity and useful creative approaches. Your recommendation will appear here as part of this run."
            : campaign.strategy
              ? "The campaign details or research have changed. The next run will update the campaign direction for your revised brief."
              : campaign.brief?.keyMessage || "Launch the campaign to explore its audience, develop a message and create two distinct concepts."}
        </p>
        {visual ? <p className="mt-4 text-sm"><span className="font-medium">Visual approach: </span>{visual}</p> : null}
        {!working && campaign.researchAttempts?.length ? <p className="mt-4 text-xs text-mute">This saved run has research details below. New runs also include the campaign recommendation, channel approaches and creative concepts here.</p> : null}
      </section><StrategyRefinement campaign={campaign} /></div>
    );
  }

  return (
    <section className="space-y-5" aria-label="Campaign strategy">
      <div className="hairline p-5 md:p-7">
        <p className="text-xs uppercase tracking-wide text-signal">Recommended campaign angle</p>
        <h3 className="mt-2 max-w-4xl font-serif text-3xl leading-tight">{strategy.recommendedAngle}</h3>
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-ink-soft">{strategy.audienceMotivation}</p>
        <div className="mt-5 grid gap-5 border-t border-line pt-5 md:grid-cols-2">
          <div><h4 className="text-sm font-medium">The message to land</h4><p className="mt-2 text-sm leading-relaxed text-ink-soft">{strategy.keyMessage}</p></div>
          <div><h4 className="text-sm font-medium">What to show</h4><p className="mt-2 text-sm leading-relaxed text-ink-soft">{strategy.visualDirection}</p></div>
        </div>
        {strategy.status === "product_led" ? <p className="mt-5 text-xs text-mute">These concepts build on your product and audience brief. They are creative ideas to test, rather than established market preferences.</p> : null}
      </div>

      <RankingReview campaign={campaign} />

      {strategy.insights.length ? (
        <div className="hairline p-5 md:p-7">
          <h3 className="font-serif text-xl">What shapes this campaign</h3>
          <div className="mt-4 space-y-5">
            {strategy.insights.map((insight) => {
              const sources = insight.evidenceIds.flatMap((id) => {
                const source = campaign.evidence.find((item) => item.id === id);
                return source ? [source] : [];
              });
              return (
                <article key={insight.id} className="border-b border-line pb-5 last:border-b-0 last:pb-0">
                  <p className="text-xs text-signal">{insight.basis === "research" ? "Research insight" : insight.basis === "hypothesis" ? "Idea to test" : "Planning consideration"}</p>
                  <h4 className="mt-1 text-base font-medium">{insight.title}</h4>
                  <p className="mt-2 text-sm leading-relaxed text-ink-soft">{insight.implication}</p>
                  <p className="mt-2 text-sm leading-relaxed"><span className="font-medium">In the campaign: </span>{insight.application}</p>
                  <details className="mt-3 text-sm">
                    <summary className="cursor-pointer text-signal">Why this direction{sources.length ? ` · ${sources.length} source${sources.length === 1 ? "" : "s"}` : ""}</summary>
                    <p className="mt-3 leading-relaxed text-ink-soft">{insight.observation}</p>
                    {insight.limitation ? <p className="mt-2 text-xs leading-relaxed text-mute">{insight.limitation}</p> : null}
                    <ul className="mt-3 space-y-2 text-xs">
                      {sources.map((source) => <li key={source.id}>{/^https?:\/\//.test(source.sourceRef) ? <a href={source.sourceRef} target="_blank" rel="noreferrer" className="text-signal underline">{source.sourceName} ↗</a> : <span>{source.sourceName}</span>}<span className="text-mute"> · {source.observedAt ?? "Publication date unavailable"}</span></li>)}
                    </ul>
                  </details>
                </article>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2" aria-label="Creative concepts">
        {strategy.concepts.map((concept, index) => (
          <article className="hairline p-5" key={concept.id}>
            <p className="text-xs uppercase tracking-wide text-signal">Concept {index === 0 ? "A" : "B"}</p>
            <h3 className="mt-2 font-serif text-xl">{concept.name}</h3>
            <p className="mt-2 text-sm leading-relaxed">{concept.angle}</p>
            <p className="mt-3 text-sm leading-relaxed text-ink-soft"><span className="font-medium">Message: </span>{concept.headlineDirection}</p>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft"><span className="font-medium">Scene: </span>{concept.visualDirection}</p>
          </article>
        ))}
      </div>

      <div className="hairline p-5 md:p-7">
        <h3 className="font-serif text-xl">Make each channel work differently</h3>
        <div className="mt-4 grid gap-5 md:grid-cols-2">
          {strategy.channels.map((channel) => (
            <article key={channel.channel}>
              <h4 className="text-sm font-medium">{channelNames[channel.channel] ?? channel.channel}</h4>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">{channel.approach}</p>
              <p className="mt-2 text-xs text-mute">{channel.format}</p>
              <p className="mt-2 text-sm"><span className="font-medium">Next step: </span>{channel.cta}</p>
            </article>
          ))}
        </div>
      </div>
      <StrategyRefinement campaign={campaign} />
      {strategy.limitations.length ? <details className="hairline p-4"><summary className="cursor-pointer text-sm text-signal">Research context and open questions</summary><ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-mute">{strategy.limitations.map((limit, index) => <li key={index}>{limit}</li>)}</ul></details> : null}
    </section>
  );
}
