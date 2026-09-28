"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { makeCreatives } from "./agents";
import { uid } from "./ids";
import { requestGenerate } from "./media/client";
import { fallbackBrief, posterPrompt, videoPrompt } from "./media/prompts";
import { blankCampaign, defaultBrand, makeLog, seedCampaigns } from "./seed";
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

type Store = {
  hydrated: boolean;
  brand: BrandProfile;
  campaigns: Campaign[];
  settings: WorkspaceSettings;
  /** Last message the engine returned, surfaced on the desk. */
  engineMessage: string | null;
  /**
   * A brief handed over from another front door — today the WhatsApp desk turns
   * a Task/Goal line into a pre-filled brief. It is a starting point only: the
   * founder still completes and launches it (AHR-01).
   */
  intakeDraft: { input: Partial<CampaignInput>; source: string } | null;
  busy: Record<string, boolean>;
  setHydrated: () => void;
  hydrateFromServer: (data: {
    brand: BrandProfile;
    campaigns: Campaign[];
    settings: WorkspaceSettings;
  }) => void;
  updateBrand: (partial: Partial<BrandProfile>) => void;
  updateSettings: (partial: Partial<WorkspaceSettings>) => void;
  createCampaign: (input: CampaignInput) => string;
  setIntakeDraft: (draft: Store["intakeDraft"]) => void;
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
  generateAdVideo: (id: string) => Promise<void>;
};

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
        intakeDraft: null,
        busy: {},
        setHydrated: () => set({ hydrated: true }),
        setIntakeDraft: (draft) => set({ intakeDraft: draft }),
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
          if (!campaign) return;
          set((s) => ({
            campaigns: s.campaigns.map((c) => (c.id === id ? { ...c, studioBusy: "posters" } : c)),
          }));
          try {
            const modelId = get().settings.imageModelId;
            const brief = campaign.brief ?? fallbackBrief(campaign);
            const base =
              campaign.creatives.length > 0
                ? campaign.creatives
                : makeCreatives({ ...campaign, brief }, brief, 1);
            const next: Campaign["creatives"] = [];
            for (const cr of base) {
              const generation = await requestGenerate({
                kind: "image",
                modelId,
                prompt: posterPrompt(campaign, cr),
                aspectRatio: "4:5",
              });
              next.push({ ...cr, generation });
            }
            const cost = next.reduce((n, cr) => n + (cr.generation?.usage.costUsd ?? 0), 0);
            const tokens = next.reduce((n, cr) => n + (cr.generation?.usage.totalTokens ?? 0), 0);
            set((s) => ({
              campaigns: s.campaigns.map((c) =>
                c.id === id
                  ? {
                      ...c,
                      imageModelId: modelId,
                      creatives: next,
                      spend: { ...c.spend, mediaUsd: c.spend.mediaUsd + cost },
                      studioHistory: [
                        ...(c.studioHistory ?? []),
                        {
                          id: uid("run"),
                          at: new Date().toISOString(),
                          kind: "image" as const,
                          modelId,
                          label: "Studio posters",
                          costUsd: cost,
                          totalTokens: tokens,
                        },
                      ],
                      log: [
                        ...c.log,
                        makeLog(
                          "creative",
                          "output",
                          `Posters on ${modelId}`,
                          `est. $${cost.toFixed(3)} · ${tokens} tokens`,
                        ),
                      ],
                      updatedAt: new Date().toISOString(),
                    }
                  : c,
              ),
            }));
          } finally {
            set((s) => ({
              campaigns: s.campaigns.map((c) => (c.id === id ? { ...c, studioBusy: null } : c)),
            }));
          }
        },

        generateAdVideo: async (id) => {
          const campaign = get().campaigns.find((c) => c.id === id);
          if (!campaign) return;
          set((s) => ({
            campaigns: s.campaigns.map((c) => (c.id === id ? { ...c, studioBusy: "video" } : c)),
          }));
          try {
            const modelId = get().settings.videoModelId;
            const durationSec = campaign.videoDurationSec ?? get().settings.videoDurationSec;
            const prompt = videoPrompt(campaign, durationSec);
            const generation = await requestGenerate({
              kind: "video",
              modelId,
              prompt,
              durationSec,
              aspectRatio: "9:16",
            });
            const video = {
              id: uid("vid"),
              version: (campaign.videos?.length ?? 0) + 1,
              title: `${campaign.product} — ${durationSec}s`,
              prompt,
              durationSec,
              aspect: "9:16" as const,
              status: "ready" as const,
              generation,
            };
            set((s) => ({
              campaigns: s.campaigns.map((c) =>
                c.id === id
                  ? {
                      ...c,
                      videoModelId: modelId,
                      videos: [video, ...(c.videos ?? [])],
                      spend: { ...c.spend, mediaUsd: c.spend.mediaUsd + generation.usage.costUsd },
                      studioHistory: [
                        ...(c.studioHistory ?? []),
                        {
                          id: uid("run"),
                          at: new Date().toISOString(),
                          kind: "video" as const,
                          modelId,
                          label: `${durationSec}s ad`,
                          costUsd: generation.usage.costUsd,
                          totalTokens: generation.usage.totalTokens,
                        },
                      ],
                      log: [
                        ...c.log,
                        makeLog(
                          "creative",
                          "output",
                          `Ad video on ${modelId}`,
                          `${durationSec}s · est. $${generation.usage.costUsd.toFixed(3)} · ${generation.usage.totalTokens} tokens`,
                        ),
                      ],
                      updatedAt: new Date().toISOString(),
                    }
                  : c,
              ),
            }));
          } finally {
            set((s) => ({
              campaigns: s.campaigns.map((c) => (c.id === id ? { ...c, studioBusy: null } : c)),
            }));
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
        intakeDraft: s.intakeDraft,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Store> & {
          brand?: BrandProfile & { imageModelId?: string; videoModelId?: string };
        };
        return {
          ...current,
          brand: { ...current.brand, ...p.brand },
          intakeDraft: p.intakeDraft ?? null,
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
