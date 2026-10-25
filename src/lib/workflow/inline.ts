/**
 * Trust boundary for inline `/api/engine`.
 *
 * The browser may say which command to run and may supply the founder's brief.
 * Brand rules, settings, and everything the agents have already produced stay
 * on the signed-in workspace. This is the same cut `WorkflowRepository.enqueue`
 * makes for the durable worker.
 */

import { applySelectedFeedback, type SavedInsight } from "@/lib/insights";
import { withRuntimeDefaults } from "@/lib/runtime/defaults";
import { blankCampaign } from "@/lib/seed";
import type { WorkspaceSettings } from "@/lib/settings";
import { retailUploadSchema } from "@/lib/trend/internal-retail";
import type { BrandProfile, Campaign } from "@/lib/types";
import { assertTransition, parseCommand, WorkflowError } from "./commands";
import { founderInput } from "./founder-input";
import type { Command } from "@/lib/runtime/types";

type StoredWorkspace = {
  brand: BrandProfile;
  settings: WorkspaceSettings;
  campaigns: Campaign[];
  savedInsights?: readonly SavedInsight[];
};

type InlineBody = {
  campaign: Campaign;
  command: unknown;
  /** Present on older clients. Never read. */
  brand?: unknown;
  /** Present on older clients. Never read. */
  settings?: unknown;
};

function founderDataAccess(raw: Campaign): Pick<Campaign, "dataAccessPolicy"> {
  if (raw.dataAccessPolicy === undefined) return {};
  const externalSources = Array.isArray(raw.dataAccessPolicy.externalSources)
    ? raw.dataAccessPolicy.externalSources.filter((name): name is string => typeof name === "string")
    : [];
  return { dataAccessPolicy: { externalSources } };
}

function freshDraft(submitted: Campaign, stored: StoredWorkspace, prior: Campaign | undefined): Campaign {
  const retail = submitted.internalDataAuthorised === true && submitted.retailUpload !== undefined
    ? retailUploadSchema.safeParse(submitted.retailUpload)
    : null;
  if (retail && !retail.success) throw new WorkflowError("Invalid aggregate retail upload.");
  const fresh = {
    ...applySelectedFeedback(
      blankCampaign(founderInput(submitted), stored.brand, null, stored.settings, null),
      stored.savedInsights ?? [],
      submitted.feedbackInsightIds,
      stored.campaigns,
    ),
    id: submitted.id,
    internalDataAuthorised: submitted.internalDataAuthorised === true,
    ...(retail?.success ? { retailUpload: retail.data } : {}),
    ...founderDataAccess(submitted),
  };
  if (prior) {
    fresh.log = prior.log;
    fresh.createdAt = prior.createdAt;
  }
  return withRuntimeDefaults(fresh);
}

/**
 * The campaign and brand the inline engine is allowed to see.
 *
 * Does not write the workspace. A refused command leaves the stored document
 * exactly as it was handed in.
 */
export function resolveInlineEngine(stored: StoredWorkspace, body: InlineBody): {
  command: Command;
  brand: BrandProfile;
  settings: WorkspaceSettings;
  campaign: Campaign;
  campaigns: Campaign[];
} {
  void body.brand;
  void body.settings;
  if (!body.campaign || typeof body.campaign.id !== "string" || !body.campaign.id) {
    throw new WorkflowError("campaign and command are required.");
  }
  const command = parseCommand(body.command);
  const prior = stored.campaigns.find((item) => item.id === body.campaign.id);
  if (!prior && body.campaign.trendQuality) {
    throw new WorkflowError("No stored research version exists for this campaign.", 409);
  }
  if (typeof prior?.archivedAt === "string" && prior.archivedAt && command.type !== "PAUSE") {
    throw new WorkflowError("This campaign is in the trash. Restore it before the agents can continue.", 409);
  }

  let campaign: Campaign;
  if (!prior || (prior.status === "draft" && command.type === "START")) {
    if (command.type !== "START") {
      throw new WorkflowError("Start a new draft before the agents can continue.", 409);
    }
    campaign = freshDraft(body.campaign, stored, prior);
  } else {
    campaign = withRuntimeDefaults(structuredClone(prior));
    if (Number.isFinite(body.campaign.spendCapUsd) && body.campaign.spendCapUsd! > 0) {
      campaign.spendCapUsd = body.campaign.spendCapUsd;
    }
    if (
      (prior.trendQuality || prior.researchMode === "agent") &&
      command.type === "RESOLVE_TREND" &&
      command.action === "provide_data" &&
      body.campaign.internalDataAuthorised &&
      body.campaign.retailUpload
    ) {
      const retail = retailUploadSchema.safeParse(body.campaign.retailUpload);
      if (!retail.success) throw new WorkflowError("Invalid aggregate retail upload.");
      campaign.retailUpload = retail.data;
      campaign.internalDataAuthorised = true;
    }
    if (command.type === "COLLECT_FEEDBACK") {
      const valid = ["ok", "no_data", "not_authorised", "late", "incomplete", "excluded"];
      campaign.collectorOverrides = Object.fromEntries(
        Object.entries(body.campaign.collectorOverrides || {}).filter(
          ([channel, status]) => campaign.channels.includes(channel as Campaign["channels"][number]) && valid.includes(status),
        ),
      );
    }
  }
  assertTransition(campaign, command);
  const campaigns = stored.campaigns.some((item) => item.id === campaign.id)
    ? stored.campaigns.map((item) => (item.id === campaign.id ? campaign : item))
    : [campaign, ...stored.campaigns];
  return { command, brand: stored.brand, settings: stored.settings, campaign, campaigns };
}
