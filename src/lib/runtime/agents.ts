/**
 * AHR-05 agent object model (DI-02 / SCRUM-100).
 *
 * The pipeline runs as functional step handlers, but the Stage 1 class model names
 * an `AIMediaManager` that generalizes a shared `Agent` base. This module gives that
 * class a concrete Stage 2 artifact: a thin, callable wrapper whose run operations
 * (`adapt`, `schedule`, `publish`) delegate to the step handlers, so the class model
 * maps directly onto the running code without duplicating its logic.
 */

import type { AgentSlot } from "@/lib/llm/types";
import type { Campaign } from "@/lib/types";
import { runMediaAdaptation, runPublish, runSchedule, type StepEnv, type Work } from "./steps";

/** Shared base for every agent in the pipeline. */
export abstract class Agent {
  abstract readonly slot: AgentSlot;
  abstract readonly name: string;
}

/** AHR-05 — the Media Manager. Adapts, schedules and (simulated) publishes. */
export class AIMediaManager extends Agent {
  readonly slot: AgentSlot = "media";
  readonly name = "AI Media Manager";

  /** Adapt the approved master into one claim-frozen version per channel (incl. AI captions + embeds). */
  adapt(work: Work, env: StepEnv) {
    return runMediaAdaptation(work, env);
  }

  /** Propose posting times and flag scheduling conflicts. */
  schedule(work: Work, allCampaigns: Campaign[]) {
    return runSchedule(work, allCampaigns);
  }

  /** Simulate the founder-authorised release through the channel gateways. */
  publish(work: Work) {
    return runPublish(work);
  }
}
