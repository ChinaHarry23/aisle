"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  makeCreatives,
  publishCampaign,
  runCreative,
  runFromTrend,
  runMedia,
  type EngineApi,
} from "./agents";
import { uid } from "./ids";
import { requestGenerate } from "./media/client";
import { fallbackBrief, posterPrompt, videoPrompt } from "./media/prompts";
import { makeLog, blankCampaign, defaultBrand, seedCampaigns } from "./seed";
import { defaultSettings, withSettingsDefaults, type WorkspaceSettings } from "./settings";
import type { BrandProfile, Campaign, CampaignInput } from "./types";

type Store = {
  hydrated: boolean;
  brand: BrandProfile;
  campaigns: Campaign[];
  settings: WorkspaceSettings;
  runTokens: Record<string, number>;
  setHydrated: () => void;
  hydrateFromServer: (data: {
    brand: BrandProfile;
    campaigns: Campaign[];
    settings: WorkspaceSettings;
  }) => void;
  updateBrand: (partial: Partial<BrandProfile>) => void;
  updateSettings: (partial: Partial<WorkspaceSettings>) => void;
  createCampaign: (input: CampaignInput) => string;
  launch: (id: string) => void;
  pause: (id: string) => void;
  approve: (id: string, note: string) => void;
  reject: (id: string, note: string) => void;
  requestChanges: (id: string, note: string) => void;
  publish: (id: string) => void;
  resetDemo: () => void;
  setStudio: (
    id: string,
    patch: Partial<Pick<Campaign, "videoDurationSec">>,
  ) => void;
  generatePosters: (id: string) => Promise<void>;
  generateAdVideo: (id: string) => Promise<void>;
};

function previousNote(campaigns: Campaign[]): string | null {
  const published = campaigns.find((c) => c.status === "published" && c.performance);
  return published?.performance?.recommendation ?? published?.performance?.summary ?? null;
}

function engine(get: () => Store, set: (partial: Partial<Store> | ((s: Store) => Partial<Store>)) => void): EngineApi {
  return {
    read: (id) => get().campaigns.find((c) => c.id === id),
    brand: () => get().brand,
    settings: () => get().settings,
    patch: (id, partial) =>
      set((s) => ({
        campaigns: s.campaigns.map((c) => (c.id === id ? { ...c, ...partial } : c)),
      })),
    log: (id, event) =>
      set((s) => ({
        campaigns: s.campaigns.map((c) =>
          c.id === id ? { ...c, log: [...c.log, event], updatedAt: event.at } : c,
        ),
      })),
    still: (id, token) => {
      const s = get();
      const c = s.campaigns.find((x) => x.id === id);
      return Boolean(c && s.runTokens[id] === token && c.status !== "paused");
    },
  };
}

export const useAisle = create<Store>()(
  persist(
    (set, get) => ({
      hydrated: false,
      brand: defaultBrand,
      campaigns: seedCampaigns(defaultBrand),
      settings: defaultSettings(),
      runTokens: {},
      setHydrated: () => set({ hydrated: true }),
      hydrateFromServer: (data) =>
        set({
          brand: data.brand,
          campaigns: data.campaigns,
          settings: withSettingsDefaults(data.settings),
          runTokens: {},
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
        const campaign = blankCampaign(input, get().brand, previousNote(get().campaigns), get().settings);
        set((s) => ({ campaigns: [campaign, ...s.campaigns] }));
        return campaign.id;
      },
      launch: (id) => {
        const token = (get().runTokens[id] ?? 0) + 1;
        set((s) => ({
          runTokens: { ...s.runTokens, [id]: token },
          campaigns: s.campaigns.map((c) =>
            c.id === id ? { ...c, running: true, status: "analysing" } : c,
          ),
        }));
        void runFromTrend(id, token, engine(get, set));
      },
      pause: (id) => {
        set((s) => ({
          runTokens: { ...s.runTokens, [id]: (s.runTokens[id] ?? 0) + 1 },
          campaigns: s.campaigns.map((c) =>
            c.id === id
              ? {
                  ...c,
                  running: false,
                  status: "paused",
                  log: [
                    ...c.log,
                    makeLog("founder", "decision", "Campaign paused", "Agent bench halted. Resume by launching again."),
                  ],
                }
              : c,
          ),
        }));
      },
      approve: (id, note) => {
        const token = (get().runTokens[id] ?? 0) + 1;
        set((s) => ({
          runTokens: { ...s.runTokens, [id]: token },
          campaigns: s.campaigns.map((c) =>
            c.id === id
              ? {
                  ...c,
                  founderDecision: {
                    action: "approve",
                    note,
                    at: new Date().toISOString(),
                  },
                  sharedContext: {
                    ...c.sharedContext,
                    founderNotes: note
                      ? [...c.sharedContext.founderNotes, note]
                      : c.sharedContext.founderNotes,
                  },
                  running: true,
                  log: [
                    ...c.log,
                    makeLog(
                      "founder",
                      "decision",
                      "Approved for distribution",
                      note || "Founder signed off. Media Manager may adapt and schedule.",
                    ),
                  ],
                }
              : c,
          ),
        }));
        void runMedia(id, token, engine(get, set));
      },
      reject: (id, note) => {
        set((s) => ({
          runTokens: { ...s.runTokens, [id]: (s.runTokens[id] ?? 0) + 1 },
          campaigns: s.campaigns.map((c) =>
            c.id === id
              ? {
                  ...c,
                  status: "rejected",
                  running: false,
                  founderDecision: {
                    action: "reject",
                    note,
                    at: new Date().toISOString(),
                  },
                  creatives: c.creatives.map((cr) => ({ ...cr, status: "rejected" })),
                  log: [
                    ...c.log,
                    makeLog("founder", "decision", "Rejected", note || "Campaign will not publish."),
                  ],
                }
              : c,
          ),
        }));
      },
      requestChanges: (id, note) => {
        const token = (get().runTokens[id] ?? 0) + 1;
        set((s) => ({
          runTokens: { ...s.runTokens, [id]: token },
          campaigns: s.campaigns.map((c) =>
            c.id === id
              ? {
                  ...c,
                  running: true,
                  founderDecision: {
                    action: "changes",
                    note,
                    at: new Date().toISOString(),
                  },
                  sharedContext: {
                    ...c.sharedContext,
                    founderNotes: [...c.sharedContext.founderNotes, note],
                  },
                  log: [
                    ...c.log,
                    makeLog(
                      "founder",
                      "decision",
                      "Changes requested",
                      note || "Returned to Image Generation with founder notes.",
                    ),
                  ],
                }
              : c,
          ),
        }));
        const c = get().campaigns.find((x) => x.id === id);
        const next = (c?.creatives[0]?.version ?? 1) + 1;
        void runCreative(id, token, engine(get, set), next);
      },
      publish: (id) => {
        set((s) => ({
          campaigns: s.campaigns.map((c) => {
            if (c.id !== id) return c;
            const patch = publishCampaign(c);
            return {
              ...c,
              ...patch,
              log: [
                ...c.log,
                makeLog(
                  "media",
                  "schedule",
                  "Published",
                  "Distribution complete. Results will feed the next Trend Analyser brief.",
                ),
                makeLog(
                  "media",
                  "feedback",
                  "Performance returned to Trend Analyser",
                  patch.performance?.recommendation ?? "Loop closed.",
                ),
              ],
            };
          }),
        }));
      },
      resetDemo: () =>
        set({
          brand: defaultBrand,
          campaigns: seedCampaigns(defaultBrand),
          settings: defaultSettings(),
          runTokens: {},
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
    }),
    {
      name: "aisle-ws-pending",
      skipHydration: true,
      partialize: (s) => ({ brand: s.brand, campaigns: s.campaigns, settings: s.settings }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Store> & {
          brand?: BrandProfile & { imageModelId?: string; videoModelId?: string };
        };
        return {
          ...current,
          brand: { ...current.brand, ...p.brand },
          campaigns: p.campaigns ?? current.campaigns,
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
