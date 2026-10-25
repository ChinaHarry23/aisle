/**
 * Workspace access for the LangGraph dev server.
 *
 * Studio has no Aisle session cookie. A run names a user and a campaign, or
 * leaves both blank and uses AISLE_STUDIO_USER_ID / the dev-alex desk and the
 * first draft. The command then goes through the same engine the desk uses,
 * and the updated campaign is written back to that workspace.
 */

import { billingFor, type BillingContext } from "@/lib/billing/meter";
import { findUserByEmail, findUserById, listUsers, ensureSeedAccounts } from "@/lib/auth/users";
import type { AuthUser } from "@/lib/auth/types";
import { loadWorkspace, saveWorkspace, type WorkspaceSnapshot } from "@/lib/auth/workspace";
import { createServerTrendRuntime } from "@/lib/agents/trend-server";
import { renderCampaignPoster } from "@/lib/media/campaign-poster";
import { isArchived } from "@/lib/campaign-lifecycle";
import { withRuntimeDefaults } from "@/lib/runtime/defaults";
import {
  openEngineWork,
  openStepEnv,
  prepareEngineInvocation,
  sealEngineWork,
  type EngineOptions,
} from "@/lib/runtime/engine";
import type { StepEnv, Work } from "@/lib/runtime/steps";
import { setShelfPriceLookup } from "@/lib/runtime/tools";
import { lookupShelfPrices } from "@/lib/retail/whichgrocer/connection";
import type { WorkspaceSettings } from "@/lib/settings";
import type { BrandProfile, Campaign } from "@/lib/types";

setShelfPriceLookup(lookupShelfPrices);

export type StudioContext = {
  campaignId?: string;
  userId?: string;
  modelId?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Assistant config, run context, or both. Blank fields fall through to the env. */
export function readStudioContext(config?: unknown, runtime?: unknown): StudioContext {
  const cfg = isRecord(config) ? config : {};
  const configurable = isRecord(cfg.configurable) ? cfg.configurable : {};
  const configContext = isRecord(cfg.context) ? cfg.context : {};
  const rt = isRecord(runtime) ? runtime : {};
  const execution = isRecord(rt.executionRuntime) ? rt.executionRuntime : {};
  const runContext = isRecord(execution.context) ? execution.context : {};
  const merged = { ...configurable, ...configContext, ...runContext };
  return {
    campaignId: text(merged.campaignId),
    userId: text(merged.userId),
    modelId: text(merged.modelId),
  };
}

async function resolveUser(requested: string): Promise<AuthUser> {
  await ensureSeedAccounts();
  let user = await findUserById(requested);
  if (!user && requested.includes("@")) user = await findUserByEmail(requested);
  if (!user) {
    const listed = await listUsers();
    user = listed[0] ? await findUserById(listed[0].id) : null;
  }
  if (!user) {
    throw new Error("No Aisle account found. Sign up in the app, or set AISLE_STUDIO_USER_ID.");
  }
  return user;
}

async function resolveStudioSubject(hint: { userId?: string; campaignId?: string }): Promise<{
  user: AuthUser;
  billing: BillingContext;
  snapshot: WorkspaceSnapshot;
  campaign: Campaign;
  settings: WorkspaceSettings;
  brand: BrandProfile;
}> {
  const requestedUser = hint.userId?.trim() || process.env.AISLE_STUDIO_USER_ID?.trim() || "dev-alex";
  const user = await resolveUser(requestedUser);
  const snapshot = await loadWorkspace(user.id, user.role);
  const campaigns = snapshot.campaigns.map(withRuntimeDefaults);
  const requestedCampaign = hint.campaignId?.trim() || process.env.AISLE_STUDIO_CAMPAIGN_ID?.trim() || "";
  const campaign = requestedCampaign
    ? campaigns.find((item) => item.id === requestedCampaign)
    : (campaigns.find((item) => item.status === "draft" && !isArchived(item)) ?? campaigns.find((item) => !isArchived(item)));
  if (!campaign) {
    const known = campaigns.map((item) => `${item.name} (${item.id}, ${item.status})`).join(", ") || "none";
    throw new Error(
      requestedCampaign
        ? `No campaign "${requestedCampaign}" in ${user.email}'s workspace. Available: ${known}.`
        : `${user.email}'s workspace has no campaigns. Create one in Aisle, then run Studio again.`,
    );
  }
  return {
    user,
    billing: billingFor(user),
    snapshot: { ...snapshot, campaigns },
    campaign,
    settings: snapshot.settings,
    brand: snapshot.brand,
  };
}

function engineOptions(userId: string, billing: BillingContext): EngineOptions {
  return {
    ownerUserId: userId,
    billing,
    llm: createServerTrendRuntime(billing),
    renderPoster: (input) =>
      renderCampaignPoster({
        campaign: input.campaign,
        creative: input.creative,
        modelId: input.modelId,
        ownerId: userId,
      }),
  };
}

/** One bench command: same work and env the desk hands to the operation graph. */
export async function loadStudioRun(input: { campaignId?: string; userId?: string }): Promise<{
  userId: string;
  work: Work;
  env: StepEnv;
}> {
  const subject = await resolveStudioSubject(input);
  const now = new Date().toISOString();
  const { work, env } = prepareEngineInvocation(
    { campaigns: subject.snapshot.campaigns, now },
    subject.campaign,
    subject.settings,
    subject.brand,
    engineOptions(subject.user.id, subject.billing),
  );
  return { userId: subject.user.id, work, env };
}

/**
 * A seat chat.
 *
 * Unlike a bench command, this does not replace an inactive run. Tool evidence
 * is recorded on the campaign; the run pointer stays where the desk left it.
 */
export async function loadStudioSeat(input: { campaignId?: string; userId?: string; modelId?: string }): Promise<{
  userId: string;
  billing: BillingContext;
  modelId?: string;
  work: Work;
  env: StepEnv;
  settings: WorkspaceSettings;
  brand: BrandProfile;
}> {
  const subject = await resolveStudioSubject(input);
  const now = new Date().toISOString();
  const options = engineOptions(subject.user.id, subject.billing);
  const work = openEngineWork(subject.campaign, now);
  const env = openStepEnv(
    { campaigns: subject.snapshot.campaigns, now },
    work.campaign,
    subject.settings,
    subject.brand,
    options,
  );
  return {
    userId: subject.user.id,
    billing: subject.billing,
    modelId: input.modelId,
    work,
    env,
    settings: subject.settings,
    brand: subject.brand,
  };
}

export async function saveStudioCampaign(userId: string, work: Work) {
  const user = await findUserById(userId);
  const latest = await loadWorkspace(userId, user?.role ?? "dev");
  const campaign = sealEngineWork(work);
  const rest = latest.campaigns.filter((item) => item.id !== campaign.id);
  await saveWorkspace(userId, { ...latest, campaigns: [campaign, ...rest] });
}
