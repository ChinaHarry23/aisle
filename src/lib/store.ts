"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { uid } from "./ids";
import { jsonHeadersWithKey } from "./media/byo-key";
import { blankCampaign, defaultBrand, migrateLegacyBrand, seedCampaigns } from "./seed";
import {
  defaultSettings,
  withSettingsDefaults,
  type TrendSource,
  type WorkspaceSettings,
} from "./settings";
import { sendCommand, type EngineResponse } from "./runtime/client";
import { applySelectedFeedback, extractableInsights, normaliseInsightText, normaliseSavedInsights, type SavedInsight } from "./insights";
import { withRuntimeDefaults } from "./runtime/defaults";
import { isArchived } from "./campaign-lifecycle";
import { campaignCanAdvance, mergeCampaignLists } from "./runtime/resume";
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
  /** Permanently deleted campaign ids. They are not re-seeded. */
  retiredCampaignIds: string[];
  savedInsights: SavedInsight[];
  settings: WorkspaceSettings;
  /** Set when a command failed to reach the bench. Cleared by the next success. */
  engineError: string | null;
  busy: Record<string, boolean>;
  setHydrated: () => void;
  hydrateFromServer: (data: {
    brand: BrandProfile;
    campaigns: Campaign[];
    settings: WorkspaceSettings;
    retiredCampaignIds?: string[];
    savedInsights?: SavedInsight[];
  }) => void;
  updateBrand: (partial: Partial<BrandProfile>) => void;
  updateSettings: (partial: Partial<WorkspaceSettings>) => void;
  /** Adds sources, skipping any whose value is already in the list. Returns how many were new. */
  addTrendSources: (
    sources: Pick<TrendSource, "kind" | "value" | "label" | "content" | "size" | "truncated">[],
  ) => number;
  toggleTrendSource: (id: string) => void;
  removeTrendSource: (id: string) => void;
  createCampaign: (input: CampaignInput, insightIds?: string[]) => string;
  /** Keep an accepted or edited recommendation's points for a later brief. */
  saveInsights: (campaignId: string) => void;
  removeInsight: (id: string) => void;
  /** Move a campaign off the board. Agents stop. It can be restored from the trash. */
  archiveCampaign: (id: string) => Promise<void>;
  restoreCampaign: (id: string) => Promise<void>;
  /** Remove a trashed campaign for good. */
  deleteCampaign: (id: string) => Promise<void>;
  /** AHR-01 → AHR-02. Validates the brief, then runs the bench to the next gate. */
  launch: (id: string) => Promise<void>;
  /** Pick up a run that is still marked running, including after a failed hand-off. */
  resumeRunning: () => Promise<void>;
  /** Ask the bench to continue one campaign. */
  continueAgents: (id: string) => Promise<void>;
  resolveTrend: (id:string, resolution:import("@/lib/trend/quality-contracts").TrendResolution)=>Promise<void>;
  cancelTrend: (id:string,note:string)=>Promise<void>;
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
  attachRetailUpload: (id: string, upload: NonNullable<Campaign['retailUpload']>) => void;
  /** Edit the posters already generated, using the founder's description of the mistake. */
  revisePosters: (id: string, note: string) => Promise<{ ok: true; message: string } | { ok: false; error: string }>;
};

async function putWorkspace(snap: Pick<Store, "brand" | "campaigns" | "retiredCampaignIds" | "settings">) {
  try {
    await fetch("/api/workspace", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brand: snap.brand,
        campaigns: snap.campaigns,
        retiredCampaignIds: snap.retiredCampaignIds,
        settings: snap.settings,
      }),
    });
  } catch {
    // WorkspaceSync re-sends the latest snapshot on the next store change while the tab stays open.
  }
}

/**
 * Apply an engine response to a single campaign.
 *
 * The campaign is inserted when a workspace reload removed it while the request
 * was in flight, so the reply is not thrown away.
 */
function applyResult(s: Store, result: EngineResponse): Partial<Store> {
  const next = result.campaign;
  if (s.retiredCampaignIds.includes(next.id)) {
    return { engineError: result.error ?? null };
  }
  const previous = s.campaigns.find((c) => c.id === next.id);
  const campaign =
    previous && isArchived(previous) && !isArchived(next) && next.archivedAt !== null
      ? { ...next, archivedAt: previous.archivedAt, running: false }
      : next;
  const exists = Boolean(previous);
  return {
    campaigns: exists ? s.campaigns.map((c) => (c.id === campaign.id ? campaign : c)) : [campaign, ...s.campaigns],
    engineError: result.error ?? null,
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
      const pumping = new Set<string>();

      async function pump(id: string) {
        if (pumping.has(id)) return;
        pumping.add(id);
        let failures = 0;
        try {
          for (let i = 0; i < 8; i += 1) {
            const state = get();
            const campaign = state.campaigns.find((c) => c.id === id);
            if (!campaign || !campaignCanAdvance(campaign)) return;
            set((s) => ({ busy: { ...s.busy, [id]: true } }));
            const result = await sendCommand(
              { campaigns: state.campaigns, brand: state.brand, settings: state.settings },
              campaign,
              { type: "ADVANCE", actor: "founder" } satisfies Command,
            );
            set((s) => ({ ...applyResult(s, result), busy: { ...s.busy, [id]: false } }));
            if (!result.error) {
              failures = 0;
              if (!result.canAdvance) return;
              continue;
            }
            // A dropped request used to stop the bench forever. Retry a few times,
            // then leave the campaign running so the next page load can try again.
            failures += 1;
            if (failures >= 3) return;
            await new Promise((resolve) => setTimeout(resolve, 1000 * failures));
          }
        } finally {
          pumping.delete(id);
        }
      }

      /**
       * One resume pass per page load. Campaigns share one saved document, so
       * they are continued one at a time rather than racing their writes.
       */
      let resuming: Promise<void> | null = null;
      const resumed = new Set<string>();

      function resumeRunning() {
        if (resuming) return resuming;
        resuming = (async () => {
          const ids = get()
            .campaigns.filter((campaign) => campaignCanAdvance(campaign) && !get().busy[campaign.id])
            .map((campaign) => campaign.id);
          for (const id of ids) {
            if (resumed.has(id)) continue;
            resumed.add(id);
            await pump(id);
          }
        })().finally(() => {
          resuming = null;
        });
        return resuming;
      }

      async function command(
        id: string,
        cmd: Command,
        options: { pumpAfter?: boolean } = {},
      ) {
        const state = get();
        const campaign = state.campaigns.find((c) => c.id === id);
        if (!campaign) return;
        set((s) => ({ busy: { ...s.busy, [id]: true } }));
        const result = await sendCommand(
          { campaigns: state.campaigns, brand: state.brand, settings: state.settings },
          campaign,
          cmd,
        );
        set((s) => ({ ...applyResult(s, result), busy: { ...s.busy, [id]: false } }));
        if (options.pumpAfter !== false && result.canAdvance) await pump(id);
      }

      return {
        hydrated: false,
        brand: defaultBrand,
        campaigns: seedCampaigns(defaultBrand),
        retiredCampaignIds: [],
        savedInsights: [],
        settings: defaultSettings(),
        engineError: null,
        busy: {},
        setHydrated: () => set({ hydrated: true }),
        hydrateFromServer: (data) => {
          const state = get();
          const retired = [...new Set([...(state.retiredCampaignIds ?? []), ...(data.retiredCampaignIds ?? [])])];
          const remote = (data.campaigns ?? []).map(withRuntimeDefaults);
          // Before the first server read, the store holds demo seeds. Only a
          // command already in flight from this tab is worth keeping.
          const local = state.hydrated ? state.campaigns : state.campaigns.filter((c) => state.busy[c.id]);
          set({
            brand: data.brand,
            campaigns: mergeCampaignLists(local, remote, state.busy)
              .filter((campaign) => !retired.includes(campaign.id))
              .map(withRuntimeDefaults),
            retiredCampaignIds: retired,
            savedInsights: normaliseSavedInsights(data.savedInsights),
            settings: withSettingsDefaults(data.settings),
            hydrated: true,
          });
          void resumeRunning();
        },
        resumeRunning,
        continueAgents: async (id) => {
          resumed.delete(id);
          await pump(id);
        },
        updateBrand: (partial) => set((s) => ({ brand: { ...s.brand, ...partial } })),
        updateSettings: (partial) =>
          set((s) => ({
            settings: {
              ...s.settings,
              ...partial,
              agents: partial.agents ? { ...s.settings.agents, ...partial.agents } : s.settings.agents,
            },
          })),
        addTrendSources: (sources) => {
          const known = new Set(get().settings.trendSources.map((t) => t.value.toLowerCase()));
          const fresh = sources.filter((src) => {
            const key = src.value.toLowerCase();
            if (known.has(key)) return false;
            known.add(key);
            return true;
          });
          if (fresh.length === 0) return 0;
          const addedAt = new Date().toISOString();
          set((s) => ({
            settings: {
              ...s.settings,
              trendSources: [
                ...s.settings.trendSources,
                ...fresh.map((src) => ({
                  ...src,
                  id: uid("src"),
                  enabled: true,
                  addedAt,
                  lastFetchedAt: null,
                })),
              ],
            },
          }));
          return fresh.length;
        },
        toggleTrendSource: (id) =>
          set((s) => ({
            settings: {
              ...s.settings,
              trendSources: s.settings.trendSources.map((t) =>
                t.id === id ? { ...t, enabled: !t.enabled } : t,
              ),
            },
          })),
        removeTrendSource: (id) =>
          set((s) => ({
            settings: {
              ...s.settings,
              trendSources: s.settings.trendSources.filter((t) => t.id !== id),
            },
          })),

        createCampaign: (input, insightIds = []) => {
          const state = get();
          const campaign = applySelectedFeedback(
            blankCampaign(input, state.brand, null, state.settings, null),
            state.savedInsights,
            insightIds,
            state.campaigns,
          );
          set((s) => ({ campaigns: [campaign, ...s.campaigns] }));
          return campaign.id;
        },
        saveInsights: (campaignId) => {
          const campaign = get().campaigns.find((item) => item.id === campaignId);
          if (!campaign) return;
          const existing = get().savedInsights;
          const known = new Set(
            existing
              .filter((insight) => insight.sourceCampaignId === campaignId)
              .map((insight) => normaliseInsightText(insight.text)),
          );
          const savedAt = new Date().toISOString();
          const fresh = extractableInsights(campaign)
            .filter((insight) => !known.has(normaliseInsightText(insight.text)))
            .map((insight) => ({ ...insight, id: uid("ins"), savedAt }));
          if (fresh.length === 0) return;
          set({ savedInsights: [...existing, ...fresh] });
        },
        removeInsight: (id) => set((s) => ({ savedInsights: s.savedInsights.filter((insight) => insight.id !== id) })),

        archiveCampaign: async (id) => {
          const current = get().campaigns.find((campaign) => campaign.id === id);
          if (!current || isArchived(current)) return;
          if (current.running) {
            await command(id, { type: "PAUSE", actor: "founder" }, { pumpAfter: false });
          }
          const archivedAt = new Date().toISOString();
          set((s) => ({
            campaigns: s.campaigns.map((campaign) =>
              campaign.id === id ? { ...campaign, archivedAt, running: false, updatedAt: archivedAt } : campaign,
            ),
          }));
          await putWorkspace(get());
        },
        restoreCampaign: async (id) => {
          const updatedAt = new Date().toISOString();
          set((s) => ({
            campaigns: s.campaigns.map((campaign) =>
              campaign.id === id ? { ...campaign, archivedAt: null, updatedAt } : campaign,
            ),
          }));
          await putWorkspace(get());
        },
        deleteCampaign: async (id) => {
          set((s) => ({
            campaigns: s.campaigns.filter((campaign) => campaign.id !== id),
            retiredCampaignIds: s.retiredCampaignIds.includes(id) ? s.retiredCampaignIds : [...s.retiredCampaignIds, id],
          }));
          await putWorkspace(get());
        },

        launch: async (id) => {
          await command(id, { type: "START", actor: "founder" });
        },
        resolveTrend:async(id,resolution)=>{await command(id,resolution);},
        cancelTrend:async(id,note)=>{await command(id,{type:'CANCEL_TREND',actor:'founder',note},{pumpAfter:false});},
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

        attachRetailUpload: (id, upload) => set(s => ({campaigns:s.campaigns.map(c => c.id === id && !c.running ? {...c,retailUpload:upload,internalDataAuthorised:true,updatedAt:new Date().toISOString()} : c)})),

        revisePosters: async (id, note) => {
          const campaign = get().campaigns.find((c) => c.id === id);
          if (!campaign) return { ok: false, error: "Campaign not found." };
          set((s) => ({
            campaigns: s.campaigns.map((c) => (c.id === id ? { ...c, studioBusy: "posters" } : c)),
          }));
          try {
            const headers = jsonHeadersWithKey(campaign.imageModelId || get().settings.imageModelId);
            const res = await fetch("/api/studio/revise", {
              method: "POST",
              headers,
              body: JSON.stringify({ campaignId: id, note }),
            });
            const json = (await res.json().catch(() => null)) as {
              campaign?: Campaign;
              error?: string;
              message?: string;
            } | null;
            if (!res.ok || !json?.campaign) {
              return { ok: false, error: json?.error ?? "The pictures could not be revised." };
            }
            const next = json.campaign;
            set((s) => ({
              campaigns: s.campaigns.map((c) => (c.id === id ? { ...next, studioBusy: null } : c)),
            }));
            return { ok: true, message: json.message ?? "Pictures revised." };
          } catch {
            return { ok: false, error: "The pictures could not be revised." };
          } finally {
            set((s) => ({
              campaigns: s.campaigns.map((c) =>
                c.id === id && c.studioBusy === "posters" ? { ...c, studioBusy: null } : c,
              ),
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
        retiredCampaignIds: s.retiredCampaignIds,
        savedInsights: s.savedInsights,
        settings: s.settings,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Store> & {
          brand?: BrandProfile & { imageModelId?: string; videoModelId?: string };
        };
        return {
          ...current,
          brand: (() => {
            const saved = p.brand ? migrateLegacyBrand(p.brand) : undefined;
            return {
              ...current.brand,
              ...saved,
              colors: { ...current.brand.colors, ...saved?.colors },
            };
          })(),
          campaigns: (p.campaigns ?? current.campaigns).map(withRuntimeDefaults),
          retiredCampaignIds: p.retiredCampaignIds ?? current.retiredCampaignIds,
          savedInsights: normaliseSavedInsights(p.savedInsights),
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

/** Campaigns not in the trash. Filters outside the selector so zustand never sees a new array from its selector. */
export function useActiveCampaigns(): Campaign[] {
  const all = useAisle((s) => s.campaigns);
  return all.filter((c) => !isArchived(c));
}
