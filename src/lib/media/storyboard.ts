/** Technical edit layout only. Creative content must come from the backend art director. */
import type { Campaign, Creative } from "../types";

export type StoryScene = {
  label: string; startSec: number; durationSec: number; renderDurationSec?: number; prompt: string;
  beat?: "setup" | "development" | "payoff"; entryState?: string; exitState?: string;
};
export type AuthoredStory = {
  title: string;
  scenes: Pick<StoryScene, "label" | "prompt" | "beat" | "entryState" | "exitState">[];
  closing: { headline: string; cta: string };
};
export type StoryAdPlan = {
  title: string; durationSec: 30; aspect: "16:9"; scenes: StoryScene[];
  endCard: { label: string; startSec: 26; durationSec: 4; product: string; headline: string; cta: string };
  reviewRequired: true;
};

/** These lengths are renderer/memory limits, not a product-specific script. */
export function storyLayout(textVideo = true) {
  return textVideo
    ? [5, 5, 5, 5, 3, 3].map((durationSec, i) => ({ startSec: [0, 5, 10, 15, 20, 23][i], durationSec, renderDurationSec: 5 }))
    : [10, 10, 6].map((durationSec, i) => ({ startSec: [0, 10, 20][i], durationSec, renderDurationSec: durationSec }));
}

export function storyAdPlan(campaign: Campaign, creative: Creative, textVideo = true, authored?: AuthoredStory): StoryAdPlan {
  void creative; // Source identity is retained by storySourceSnapshot, not used as a canned story.
  if (!authored) throw new Error("A live art-director plan is required; there is no hardcoded story fallback.");
  const layout = storyLayout(textVideo);
  if (authored.scenes.length !== layout.length) throw new Error("The authored shot count does not fit this renderer.");
  return {
    title: authored.title, durationSec: 30, aspect: "16:9",
    scenes: authored.scenes.map((scene, i) => ({ ...scene, ...layout[i] })),
    endCard: { label: "Brand and call to action", startSec: 26, durationSec: 4, product: campaign.product, ...authored.closing },
    reviewRequired: true,
  };
}

/** A source may be edited while rendering; never silently attach against a changed brief. */
export function storySourceSnapshot(campaign: Campaign, creative: Creative) {
  return JSON.stringify({ product: campaign.product, objective: campaign.objective, audience: campaign.targetAudience, brief: campaign.brief, context: campaign.sharedContext, creative });
}
