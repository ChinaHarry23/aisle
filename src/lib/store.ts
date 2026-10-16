"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { blankCampaign, defaultBrand, seedCampaigns } from "./seed";
import { defaultSettings, withSettingsDefaults, type WorkspaceSettings } from "./settings";
import { sendCommand, type EngineResponse } from "./runtime/client";
import { attachableRecommendation, withRuntimeDefaults } from "./runtime/defaults";
import type {
  ChannelResultStatus,
  Command,
  GuardedAction,
  RecommendationDecision,
} from "./runtime/types";
import type { BrandProfile, Campaign, CampaignInput } from "./types";
import { getModelOrDefault } from "./media/catalog";
import { BILLING_CHANGED } from "../components/billing/events";
import type { GenerateRequest } from "./media/types";

type Store = {
  hydrated: boolean;
  brand: BrandProfile;
  campaigns: Campaign[];
  settings: WorkspaceSettings;
  /** Last message the engine returned, surfaced on the desk. */
  engineMessage: string | null;
  busy: Record<string, boolean>;
  studioPending: Record<string, "posters" | "video" | undefined>;
  /** Last Studio render refused for lack of credits (HTTP 402), shown with a Billing link. */
  studioCredits: StudioCreditsNotice | null;
  /** A paid take that could not be attached to its campaign, still downloadable. */
  studioKept: { campaignId: string; url: string } | null;
  setHydrated: () => void;
  hydrateFromServer: (data: {
    brand: BrandProfile;
    campaigns: Campaign[];
    settings: WorkspaceSettings;
  }) => void;
  updateBrand: (partial: Partial<BrandProfile>) => void;
  updateSettings: (partial: Partial<WorkspaceSettings>) => void;
  createCampaign: (input: CampaignInput) => string;
  /** AHR-01 → AHR-02. Validates the brief, then runs the bench to the next gate. */
  launch: (id: string) => Promise<void>;
  pause: (id: string) => Promise<void>;
  approve: (id: string, note: string) => Promise<void>;
  reject: (id: string, note: string) => Promise<void>;
  requestChanges: (id: string, note: string) => Promise<void>;
  /** Founder release. The guard is asked first and the refusal is recorded. */
  publish: (id: string) => Promise<void>;
  collectFeedback: (id: string) => Promise<void>;
  decideRecommendation: (
    id: string,
    action: RecommendationDecision["action"],
    text?: string,
    note?: string,
  ) => Promise<void>;
  resolveConflict: (id: string, conflictId: string, note: string) => Promise<void>;
  /**
   * Declare which channels report, so the AHR-06 gap handling can be demonstrated
   * on demand instead of waiting for a channel to go quiet.
   */
  setCollectorOverrides: (
    id: string,
    overrides: Partial<Record<Campaign["channels"][number], ChannelResultStatus>>,
  ) => void;
  /** Show the founder what the policy layer does with an out-of-bounds attempt. */
  attemptBlocked: (id: string, action: GuardedAction, note?: string) => Promise<string>;
  resetDemo: () => void;
  setStudio: (id: string, patch: Partial<Pick<Campaign, "videoDurationSec" | "spendCapUsd">>) => void;
  generatePosters: (id: string) => Promise<void>;
  generateAdVideo: (id: string, creativeId?: string, durationSec?: number, quality?: GenerateRequest["quality"], styleReference?: string) => Promise<void>;
};

export type StudioCreditsNotice = { campaignId: string; message: string; neededCredits: number; balanceCredits: number; billingUrl: string };

class StudioCreditsError extends Error {
  readonly notice: StudioCreditsNotice;
  constructor(notice: StudioCreditsNotice) {
    super(notice.message);
    this.notice = notice;
  }
}

/** A render that finished (and was charged) but could not be attached; its take stays downloadable. */
class StudioKeptError extends Error {
  readonly url: string;
  constructor(message: string, url: string) {
    super(message);
    this.url = url;
  }
}

/** POST one Studio render. A 402 becomes a StudioCreditsError the UI shows with a Billing link. */
async function studioRequest(campaignId: string, body: Record<string, unknown>, fallback: string) {
  const response = await fetch("/api/studio/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campaignId, ...body }) });
  const result = await response.json().catch(() => ({}));
  // Any answer may have spent, returned or refused credits: let the header badge refetch.
  window.dispatchEvent(new Event(BILLING_CHANGED));
  if (response.status === 402) {
    // Only an in-app path is followed, whatever the response says.
    const billingUrl = typeof result.billingUrl === "string" && result.billingUrl.startsWith("/") && !result.billingUrl.startsWith("//") ? result.billingUrl : "/billing";
    throw new StudioCreditsError({ campaignId, message: result.error || "Not enough credits for this cloud render.", neededCredits: Number(result.neededCredits) || 0, balanceCredits: Number(result.balanceCredits) || 0, billingUrl });
  }
  // Only the app's own download route is linked, whatever the response says.
  if (!response.ok && typeof result.downloadUrl === "string" && result.downloadUrl.startsWith("/api/studio/download?")) throw new StudioKeptError(result.error || fallback, result.downloadUrl);
  if (!response.ok) throw new Error(result.error || fallback);
  return result as { campaign: Campaign; queued?: boolean; productionId?: string };
}

/** Apply an engine response to a single campaign, replacing it wholesale. */
function applyResult(s: Store, result: EngineResponse): Partial<Store> {
  return {
    campaigns: s.campaigns.map((c) => (c.id === result.campaign.id ? result.campaign : c)),
    engineMessage: result.message,
  };
}

export const useAisle = create<Store>()(
  persist(
    (set, get) => {
      /**
       * Run the bench until it needs the founder or finishes.
       *
       * Each ADVANCE is bounded server-side, so this loop only decides *when* to
       * ask for more work; it can never spin. Every response is applied before the
       * next request, which is why the desk updates step by step rather than
       * jumping at the end.
       */
      async function pump(id: string) {
        for (let i = 0; i < 8; i += 1) {
          const state = get();
          const campaign = state.campaigns.find((c) => c.id === id);
          if (!campaign) return;
          if (campaign.run?.status !== "running") return;
          const result = await sendCommand(
            { campaigns: state.campaigns, brand: state.brand, settings: state.settings },
            campaign,
            { type: "ADVANCE", actor: "founder" } satisfies Command,
          );
          set((s) => ({ ...applyResult(s, result), busy: { ...s.busy, [id]: false } }));
          if (!result.canAdvance) return;
        }
      }

      async function command(
        id: string,
        cmd: Command,
        options: { pumpAfter?: boolean; maxSteps?: number } = {},
      ) {
        const state = get();
        const campaign = state.campaigns.find((c) => c.id === id);
        if (!campaign) return;
        set((s) => ({ busy: { ...s.busy, [id]: true } }));
        const result = await sendCommand(
          { campaigns: state.campaigns, brand: state.brand, settings: state.settings },
          campaign,
          cmd,
          options.maxSteps,
        );
        set((s) => ({ ...applyResult(s, result), busy: { ...s.busy, [id]: false } }));
        if (options.pumpAfter !== false && result.canAdvance) await pump(id);
      }

      return {
        hydrated: false,
        brand: defaultBrand,
        campaigns: seedCampaigns(defaultBrand),
        settings: defaultSettings(),
        engineMessage: null,
        busy: {},
        studioPending: {},
        studioCredits: null,
        studioKept: null,
        setHydrated: () => set({ hydrated: true }),
        hydrateFromServer: (data) =>
          set({
            brand: data.brand,
            campaigns: (data.campaigns ?? []).map(withRuntimeDefaults),
            settings: withSettingsDefaults(data.settings),
            busy: {},
            hydrated: true,
          }),
        updateBrand: (partial) => set((s) => ({ brand: { ...s.brand, ...partial } })),
        updateSettings: (partial) =>
          set((s) => ({
            settings: {
              ...s.settings,
              ...partial,
              agents: partial.agents ? { ...s.settings.agents, ...partial.agents } : s.settings.agents,
            },
          })),

        createCampaign: (input) => {
          const state = get();
          // UC-06 step 12: only an accepted or edited recommendation travels
          // forward, and it is attached without being rewritten.
          const attachable = attachableRecommendation(state.campaigns);
          const campaign = blankCampaign(
            input,
            state.brand,
            attachable?.note ?? null,
            state.settings,
            attachable?.fromCampaignId ?? null,
          );
          set((s) => ({ campaigns: [campaign, ...s.campaigns] }));
          return campaign.id;
        },

        launch: async (id) => {
          await command(id, { type: "START", actor: "founder" });
        },
        pause: async (id) => {
          await command(id, { type: "PAUSE", actor: "founder" }, { pumpAfter: false });
        },
        approve: async (id, note) => {
          await command(id, { type: "APPROVE", actor: "founder", note });
        },
        reject: async (id, note) => {
          await command(id, { type: "REJECT", actor: "founder", note }, { pumpAfter: false });
        },
        requestChanges: async (id, note) => {
          await command(id, { type: "REQUEST_CHANGES", actor: "founder", note });
        },
        publish: async (id) => {
          await command(id, { type: "PUBLISH", actor: "founder" }, { pumpAfter: false });
        },
        collectFeedback: async (id) => {
          await command(id, { type: "COLLECT_FEEDBACK", actor: "founder" }, { pumpAfter: false });
        },
        decideRecommendation: async (id, action, text, note) => {
          await command(
            id,
            { type: "DECIDE_RECOMMENDATION", actor: "founder", action, text, note },
            { pumpAfter: false },
          );
        },
        resolveConflict: async (id, conflictId, note) => {
          await command(
            id,
            { type: "RESOLVE_CONFLICT", actor: "founder", conflictId, note },
            { pumpAfter: false },
          );
        },
        setCollectorOverrides: (id, overrides) =>
          set((s) => ({
            campaigns: s.campaigns.map((c) =>
              c.id === id ? { ...c, collectorOverrides: overrides, updatedAt: new Date().toISOString() } : c,
            ),
          })),

        attemptBlocked: async (id, action, note) => {
          const state = get();
          const campaign = state.campaigns.find((c) => c.id === id);
          if (!campaign) return "Campaign not found.";
          const result = await sendCommand(
            { campaigns: state.campaigns, brand: state.brand, settings: state.settings },
            campaign,
            { type: "ATTEMPT_BLOCKED", actor: action, note },
          );
          set((s) => applyResult(s, result));
          return result.message;
        },

        resetDemo: () =>
          set({
            brand: defaultBrand,
            campaigns: seedCampaigns(defaultBrand),
            settings: defaultSettings(),
            busy: {},
            engineMessage: null,
          }),

        setStudio: (id, patch) =>
          set((s) => ({
            campaigns: s.campaigns.map((c) =>
              c.id === id ? { ...c, ...patch, updatedAt: new Date().toISOString() } : c,
            ),
          })),

        generatePosters: async (id) => {
          const campaign = get().campaigns.find((c) => c.id === id);
          if (!campaign || get().studioPending[id]) return;
          set(s => ({ studioPending: { ...s.studioPending, [id]: "posters" }, engineMessage: null, studioCredits: null, studioKept: null }));
          try {
            if (!campaign.creatives.length) throw new Error("Launch agents to create the campaign copy first.");
            for (const cr of campaign.creatives) {
              const result = await studioRequest(id, { creativeId: cr.id, kind: "image" }, "Image generation failed.");
              set(s => ({ campaigns: s.campaigns.map(c => c.id === id ? result.campaign : c) }));
            }
            set({ engineMessage: "Images saved to the campaign. Review required; nothing was approved or published." });
          } catch (error) {
            if (error instanceof StudioCreditsError) set({ studioCredits: error.notice });
            else if (error instanceof StudioKeptError) set({ engineMessage: error.message, studioKept: { campaignId: id, url: error.url } });
            else set({ engineMessage: error instanceof Error ? error.message : "Image generation failed." });
          } finally {
            set(s => ({ studioPending: { ...s.studioPending, [id]: undefined } }));
          }
        },

        generateAdVideo: async (id, creativeId, requestedDuration, quality, styleReference) => {
          const campaign = get().campaigns.find((c) => c.id === id);
          if (!campaign || get().studioPending[id]) return;
          set(s => ({ studioPending: { ...s.studioPending, [id]: "video" }, engineMessage: null, studioCredits: null, studioKept: null }));
          try {
            const durationSec = requestedDuration ?? get().settings.videoDurationSec ?? campaign.videoDurationSec;
            const textVideo = getModelOrDefault(get().settings.videoModelId, "video").videoInput === "text";
            const source = campaign.creatives.find(c => (!creativeId || c.id === creativeId) && (textVideo || (c.generation?.status === "ok" && c.generation.url)));
            if (!source) throw new Error(textVideo ? "Launch agents to create campaign copy first." : "Generate and select a campaign image first.");
            const result = await studioRequest(id, { creativeId: source.id, kind: "video", durationSec, quality, styleReference }, "Video generation failed.");
            set(s => ({ campaigns: s.campaigns.map(c => c.id === id ? result.campaign : c), engineMessage: result.queued ? "30-second story ad queued. Scenes, editing and saving run in the background; you can leave or reload this page. Review required when finished." : "Video saved to this campaign; review required." }));
          } catch (error) {
            if (error instanceof StudioCreditsError) set({ studioCredits: error.notice });
            else if (error instanceof StudioKeptError) set({ engineMessage: error.message, studioKept: { campaignId: id, url: error.url } });
            else set({ engineMessage: error instanceof Error ? error.message : "Video generation failed." });
          } finally {
            set(s => ({ studioPending: { ...s.studioPending, [id]: undefined } }));
          }
        },
      };
    },
    {
      name: "aisle-ws-pending",
      skipHydration: true,
      partialize: (s) => ({
        brand: s.brand,
        campaigns: s.campaigns,
        settings: s.settings,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Store> & {
          brand?: BrandProfile & { imageModelId?: string; videoModelId?: string };
        };
        return {
          ...current,
          brand: { ...current.brand, ...p.brand },
          campaigns: (p.campaigns ?? current.campaigns).map(withRuntimeDefaults),
          settings: withSettingsDefaults(
            p.settings ??
              (p.brand?.imageModelId || p.brand?.videoModelId
                ? {
                    imageModelId: p.brand.imageModelId,
                    videoModelId: p.brand.videoModelId,
                  }
                : undefined),
          ),
        };
      },
    },
  ),
);
