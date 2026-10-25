/**
 * The campaign an engine command runs on. Inline /api/engine runs it; service
 * mode hands it to the durable queue, which makes its own founder cut.
 */

import { withRuntimeDefaults } from "@/lib/runtime/defaults";
import type { Command } from "@/lib/runtime/types";
import { retailUploadSchema } from "@/lib/trend/internal-retail";
import type { Campaign } from "@/lib/types";
import { WorkflowError } from "./commands";
import { founderCollectorOverrides } from "./founder-input";

/** Stored research wins over a browser copy. A draft still takes the brief the founder just edited. */
export function campaignForCommand(existing: Campaign | undefined, incoming: Campaign, command: Command): Campaign {
  if (!existing && command.type !== "START") {
    throw new WorkflowError("Start and store the campaign before submitting workflow or feedback decisions.", 409);
  }
  if (!existing && incoming.trendQuality) {
    throw new WorkflowError("No stored research version exists for this campaign.", 409);
  }
  const protectedResearch = Boolean(existing?.trendQuality || existing?.researchMode === "agent");
  const fromStore = Boolean(existing && existing.status !== "draft");
  const target = withRuntimeDefaults(fromStore ? structuredClone(existing!) : incoming);
  if (fromStore) {
    // Declared report outcomes and the spend cap are founder controls. The stored
    // copy can lag the browser's: its save is debounced, and in service mode the
    // durable snapshot replaces it. So they come from the request, filtered.
    target.collectorOverrides = founderCollectorOverrides(target, incoming.collectorOverrides);
    if (Number.isFinite(incoming.spendCapUsd) && incoming.spendCapUsd! > 0) target.spendCapUsd = incoming.spendCapUsd;
  }
  if (
    protectedResearch &&
    command.type === "RESOLVE_TREND" &&
    command.action === "provide_data" &&
    incoming.internalDataAuthorised &&
    incoming.retailUpload
  ) {
    target.retailUpload = retailUploadSchema.parse(incoming.retailUpload);
    target.internalDataAuthorised = true;
  }
  return target;
}
