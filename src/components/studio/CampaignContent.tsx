"use client";

import { useState, type FormEvent } from "react";
import { campaignMediaUrl } from "@/lib/media/url";
import { useAisle } from "@/lib/store";
import type { Campaign } from "@/lib/types";
import { currentStrategy } from "@/lib/trend/strategy";

/** Pictures produced by the campaign's image step, with a way to correct a bad one. */
export function CampaignContent({ campaign }: { campaign: Campaign }) {
  const revisePosters = useAisle((s) => s.revisePosters);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const revising = campaign.studioBusy === "posters";
  const strategy = currentStrategy(campaign);
  const images = campaign.creatives.flatMap((cr) => {
    const src = campaignMediaUrl(campaign.id, cr.id, cr.generation);
    return src ? [{ id: cr.id, src, label: `${cr.headline} (${cr.variant})`, creative: cr }] : [];
  });
  const reviewed = campaign.complianceReports.length > 0;
  const occasion = campaign.culturalMatch;

  async function revise(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const result = await revisePosters(campaign.id, note);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNote("");
  }

  const occasionNote = occasion ? (
    <p className="text-sm leading-relaxed text-ink-soft">
      <span className="font-medium text-ink">Occasion passed to these images: </span>
      {occasion.name} ({occasion.dateLabel}). {occasion.scene}
    </p>
  ) : null;

  if (images.length > 0) {
    return (
      <div className="flex flex-col gap-6">
        {occasionNote}
        <div className="grid gap-4 sm:grid-cols-2">
          {images.map((img) => {
            const uses = strategy && img.creative.strategyVersion === strategy.version
              ? img.creative.insightUses?.filter((use) => strategy.insights.some((insight) => insight.id === use.insightId)) ?? []
              : [];
            return (
              <figure key={img.id} className="border border-line">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.src} alt={img.label} className="w-full object-cover" />
                <figcaption className="p-4">
                  <p className="text-xs uppercase tracking-wide text-signal">Concept {img.creative.variant}</p>
                  <h3 className="mt-1 text-sm font-medium">{img.creative.headline}</h3>
                  {uses.length ? (
                    <details className="mt-3 text-sm">
                      <summary className="cursor-pointer text-signal">How this uses your campaign strategy</summary>
                      <ul className="mt-3 space-y-3">
                        {uses.map((use, index) => {
                          const insight = strategy!.insights.find((item) => item.id === use.insightId)!;
                          return <li key={`${use.insightId}:${use.application}:${index}`}><p className="font-medium">{insight.title} <span className="font-normal text-mute">· {use.application}</span></p><p className="mt-1 text-xs leading-relaxed text-ink-soft">{use.rationale}</p>{insight.basis === "hypothesis" ? <p className="mt-1 text-xs text-mute">Creative idea to test</p> : null}</li>;
                        })}
                      </ul>
                    </details>
                  ) : null}
                </figcaption>
              </figure>
            );
          })}
        </div>
        <form onSubmit={(event) => void revise(event)} className="hairline max-w-2xl p-4">
          <label className="block">
            <span className="text-sm font-medium">Refine the images</span>
            <span className="mt-1 block text-xs text-mute">
              Describe the scene or detail you want to change. Your saved campaign direction is reused when the posters are edited.
            </span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              maxLength={500}
              disabled={revising}
              placeholder="Make the scene feel like an everyday kitchen, with the product more prominent."
              className="mt-3 w-full border border-line bg-surface px-3 py-2.5 text-[15px] outline-none transition focus:border-signal focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--signal)_18%,transparent)] disabled:opacity-60"
            />
          </label>
          {campaign.imageRevisionNote ? (
            <p className="mt-2 text-xs text-mute">Last fix: {campaign.imageRevisionNote}</p>
          ) : null}
          {reviewed ? (
            <p className="mt-2 text-xs text-ink-soft">
              A compliance report already exists for the previous pictures. Check these again before approving.
            </p>
          ) : null}
          {error ? <p className="mt-2 text-sm text-signal">{error}</p> : null}
          <div className="mt-3 flex items-center justify-end">
            <button
              type="submit"
              disabled={revising || note.trim().length < 8}
              className="rounded-full bg-signal px-5 py-2 text-sm font-semibold text-white hover:bg-signal-dark disabled:opacity-50"
            >
              {revising ? "Revising…" : "Revise images"}
            </button>
          </div>
        </form>
      </div>
    );
  }

  const fallback = campaign.creatives.find((cr) => cr.generation)?.generation?.note;
  if (fallback) {
    return (
      <p className="text-sm text-ink-soft">
        The image step ran. {fallback}
      </p>
    );
  }

  if (campaign.status === "generating" || campaign.run?.step === "creative.receive") {
    return (
      <div className="flex flex-col gap-3">
        {occasionNote}
        <p className="text-sm text-ink-soft">Image generation is running for this campaign.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {occasionNote}
      <p className="text-sm text-ink-soft">
        No image yet. Launch the agents and the image step renders the posters, using a product photo when you uploaded one.
      </p>
    </div>
  );
}
